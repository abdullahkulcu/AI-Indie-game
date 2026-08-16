/**
 * Dünya kurulumu — channel oluşturma, harita üretimi ve katılım.
 *
 * Harita **dairesel olarak dışa doğru büyür** (§16.2): ilk katılanlar merkeze
 * yakın, yeni katılanlar sürekli çeperde başlar. Bu, geç katılanın kalabalık ve
 * gelişmiş bir çekirdeğe aniden atılmasını doğal olarak önlüyor; ayrı bir
 * "hızlandırma" mekaniği gerekmiyor.
 *
 * Tile'lar önceden değil, bir krallık yerleştikçe **çevresinde** üretilir.
 * Sebebi pratik: yüzlerce oyunculu bir haritayı baştan doldurmak yüz binlerce
 * satır demek; oysa oyuncular yalnızca kendi çevrelerindeki araziyle etkileşiyor.
 */

import {
  BALANCE,
  TERRAIN_WEIGHTS_CORE,
  TERRAIN_WEIGHTS_RIM,
  canJoinChannel,
  mineReserveCapacity,
  slotPosition,
  type ChannelType,
  type LlmRestriction,
  type TerrainType,
} from '@krallik/shared';
import { config } from '../config.js';
import { txQuery, txQueryOne, withTransaction, type Tx } from '../db/pool.js';
import type { ChannelRow, KingdomRow, MapTileRow } from '../db/rows.js';

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export interface CreateChannelInput {
  name: string;
  channelType: ChannelType;
  durationDays?: number;
  llmRestriction?: LlmRestriction | null;
  createdBy?: string | null;
  startImmediately?: boolean;
}

export async function createChannel(input: CreateChannelInput): Promise<ChannelRow> {
  const durationDays = input.durationDays ?? BALANCE.channel.defaultSeasonDays;
  const now = config.now();
  const startedAt = input.startImmediately === false ? null : now;
  const endsAt = startedAt ? new Date(startedAt.getTime() + durationDays * 86_400_000) : null;

  return withTransaction(async (tx) => {
    const row = await txQueryOne<ChannelRow>(
      tx,
      `INSERT INTO channels
         (name, channel_type, llm_restriction, duration_days, started_at, ends_at, status,
          balance_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.name,
        input.channelType,
        input.llmRestriction ? JSON.stringify(input.llmRestriction) : null,
        durationDays,
        startedAt,
        endsAt,
        startedAt ? 'active' : 'pending',
        // §16.5: her channel başladığı kural setiyle biter. Denge sabitlerinin
        // anlık görüntüsü burada dondurulur; ortada değişen dengeler devam eden
        // oyunu bozmaz.
        JSON.stringify(BALANCE),
        input.createdBy ?? null,
      ],
    );
    if (!row) throw new Error('Channel oluşturulamadı.');
    return row;
  });
}

export function remainingHours(channel: ChannelRow, now = config.now()): number {
  if (channel.status === 'finished' || !channel.ends_at) return 0;
  return Math.max(0, (channel.ends_at.getTime() - now.getTime()) / 3_600_000);
}

/**
 * GDD §16.2: kalan süresi Yeni Oyuncu Koruması'na eşit ya da daha kısa olan
 * channel'a katılmak anlamsızdır — koruma channel'dan uzun sürerdi.
 */
export function joinBlockedReason(channel: ChannelRow, now = config.now()): string | null {
  if (channel.status === 'finished') return 'Bu channel sona erdi.';
  if (channel.status === 'pending') return 'Bu channel henüz başlamadı.';
  const hours = remainingHours(channel, now);
  if (!canJoinChannel(hours)) {
    return `Kalan süre (${Math.round(hours)} saat) yeni oyuncu korumasından (${BALANCE.protection.durationHours} saat) kısa; katılım kapalı.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arazi üretimi
// ---------------------------------------------------------------------------

function weightedTerrain(weights: ReadonlyArray<readonly [TerrainType, number]>): TerrainType {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [terrain, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return terrain;
  }
  return weights[0]?.[0] ?? 'plains';
}

/**
 * Merkeze yakın bölgelerde daha değerli/kısıtlı arazi, kenarlarda daha bol ama
 * daha az verimli arazi (§2). Merkezden uzaklık arttıkça ağırlık tablosu
 * "çeper" tablosuna kayar.
 */
function terrainForPosition(x: number, y: number): TerrainType {
  const distanceFromCenter = Math.max(Math.abs(x), Math.abs(y));
  const coreRadius = BALANCE.channel.ringRadiusStep * 2;
  return distanceFromCenter <= coreRadius
    ? weightedTerrain(TERRAIN_WEIGHTS_CORE)
    : weightedTerrain(TERRAIN_WEIGHTS_RIM);
}

/** Belirtilen alandaki eksik tile'ları üretir; var olanlara dokunmaz. */
export async function ensureTiles(
  tx: Tx,
  channelId: string,
  centerX: number,
  centerY: number,
  radius: number,
): Promise<MapTileRow[]> {
  const created: MapTileRow[] = [];

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      const terrain = terrainForPosition(x, y);

      // Dağ tile'ları maden rezervi taşır (§4.1) — maden nereye kurulabileceği
      // coğrafyaya bağlı olsun diye rezerv tile'a yazılır, binaya değil.
      const carriesReserve = terrain === 'mountain';
      const reserve = carriesReserve ? mineReserveCapacity(1) : null;

      const row = await txQueryOne<MapTileRow>(
        tx,
        `INSERT INTO map_tiles (channel_id, x, y, terrain_type, mine_reserve_capacity, mine_reserve_remaining)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (channel_id, x, y) DO NOTHING
         RETURNING *`,
        [channelId, x, y, terrain, reserve],
      );
      if (row) created.push(row);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// Katılım
// ---------------------------------------------------------------------------

export interface JoinResult {
  kingdom: KingdomRow;
  capitalTile: MapTileRow;
}

/** Başlangıç binaları — GDD §5.1'de Kale Sv.1 "temel kapasite, 6 bina slotu". */
const STARTING_BUILDINGS: { type: string; level: number }[] = [
  { type: 'keep', level: 1 },
  { type: 'town_square', level: 1 },
  { type: 'wheat_farm', level: 1 },
  { type: 'woodcutter', level: 1 },
  { type: 'quarry', level: 1 },
  { type: 'granary', level: 1 },
];

/** Başlangıç garnizonu — savunmasız başlamamak için sembolik bir kuvvet. */
const STARTING_UNITS: Record<string, number> = {
  spearman: 10,
  archer: 5,
};

export async function joinChannel(params: {
  userId: string;
  channelId: string;
  kingdomName: string;
}): Promise<JoinResult> {
  return withTransaction(async (tx) => {
    const channel = await txQueryOne<ChannelRow>(
      tx,
      'SELECT * FROM channels WHERE id = $1 FOR UPDATE',
      [params.channelId],
    );
    if (!channel) throw new Error('Channel bulunamadı.');

    const blocked = joinBlockedReason(channel);
    if (blocked) throw new Error(blocked);

    const existing = await txQueryOne<{ id: string }>(
      tx,
      'SELECT id FROM kingdoms WHERE user_id = $1 AND channel_id = $2',
      [params.userId, params.channelId],
    );
    if (existing) throw new Error('Bu channel\'da zaten bir krallığınız var.');

    // Slot ayır ve konumu hesapla — harita dışa doğru büyür.
    const slotIndex = channel.next_slot_index;
    await txQuery(tx, 'UPDATE channels SET next_slot_index = next_slot_index + 1 WHERE id = $1', [
      channel.id,
    ]);

    let position = slotPosition(slotIndex);

    // Çakışma olursa (aynı konumda başka başkent) dışa doğru kaydır.
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const occupied = await txQueryOne<{ id: string }>(
        tx,
        'SELECT id FROM map_tiles WHERE channel_id = $1 AND x = $2 AND y = $3 AND is_capital = TRUE',
        [channel.id, position.x, position.y],
      );
      if (!occupied) break;
      position = slotPosition(slotIndex + attempt + 1);
    }

    const territoryRadius = BALANCE.channel.startingTerritoryRadius;
    // Çevresini de üret ki komşu araziler ve genişleme hedefleri hazır olsun.
    await ensureTiles(tx, channel.id, position.x, position.y, territoryRadius + 3);

    const capitalTile = await txQueryOne<MapTileRow>(
      tx,
      'SELECT * FROM map_tiles WHERE channel_id = $1 AND x = $2 AND y = $3',
      [channel.id, position.x, position.y],
    );
    if (!capitalTile) throw new Error('Başkent tile üretilemedi.');

    const now = config.now();
    const protectionEndsAt = new Date(now.getTime() + BALANCE.protection.durationHours * 3600_000);

    const kingdom = await txQueryOne<KingdomRow>(
      tx,
      `INSERT INTO kingdoms (user_id, channel_id, name, capital_tile_id, protection_ends_at,
                             decree_quota_remaining, decree_quota_last_refill_at,
                             popularity, reputation, general_loyalty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        params.userId,
        channel.id,
        params.kingdomName.slice(0, 60),
        capitalTile.id,
        protectionEndsAt,
        // Kale Sv.1 kotası (§14.4).
        2,
        now,
        BALANCE.popularity.neutral + 5,
        BALANCE.diplomacy.reputation.start,
        BALANCE.general.loyaltyStart,
      ],
    );
    if (!kingdom) throw new Error('Krallık oluşturulamadı.');

    // Başkent ve çevresindeki tile'lar krallığın olur.
    await txQuery(
      tx,
      `UPDATE map_tiles
          SET owner_kingdom_id = $1
        WHERE channel_id = $2
          AND owner_kingdom_id IS NULL
          AND GREATEST(ABS(x - $3), ABS(y - $4)) <= $5`,
      [kingdom.id, channel.id, position.x, position.y, territoryRadius],
    );
    await txQuery(tx, 'UPDATE map_tiles SET is_capital = TRUE WHERE id = $1', [capitalTile.id]);

    const ownedTiles = await txQuery<MapTileRow>(
      tx,
      'SELECT * FROM map_tiles WHERE owner_kingdom_id = $1',
      [kingdom.id],
    );

    // Başlangıç binaları. Üretim binaları arazi çarpanı en yüksek tile'a konur.
    for (const building of STARTING_BUILDINGS) {
      const tile =
        building.type === 'keep' || building.type === 'town_square' || building.type === 'granary'
          ? capitalTile
          : (pickBestTile(ownedTiles, building.type) ?? capitalTile);

      await txQuery(
        tx,
        `INSERT INTO building_instances (kingdom_id, type, level, tile_id)
         VALUES ($1, $2, $3, $4)`,
        [kingdom.id, building.type, building.level, tile.id],
      );
    }

    for (const [unitType, count] of Object.entries(STARTING_UNITS)) {
      await txQuery(
        tx,
        'INSERT INTO unit_stocks (kingdom_id, unit_type, count) VALUES ($1, $2, $3)',
        [kingdom.id, unitType, count],
      );
    }

    await txQuery(
      tx,
      `INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [params.userId],
    );

    await txQuery(
      tx,
      `INSERT INTO notifications (kingdom_id, kind, severity, title, body)
       VALUES ($1, 'protection_ending', 'info', $2, $3)`,
      [
        kingdom.id,
        `${params.kingdomName} kuruldu`,
        `Krallığınız ${capitalTile.x},${capitalTile.y} konumunda kuruldu. ` +
          `${BALANCE.protection.durationHours} saat boyunca saldırıya karşı korumalısınız — ` +
          'bu süreyi ekonominizi kurmak için kullanın. Ayarlar sayfasından General\'inizi bağlamayı unutmayın.',
      ],
    );

    return { kingdom, capitalTile };
  });
}

function pickBestTile(tiles: MapTileRow[], buildingType: string): MapTileRow | null {
  // Basit tercih: oduncu ormanı, taş ocağı/maden dağı, tarla ova/nehir kenarını sever.
  const preference: Record<string, TerrainType[]> = {
    woodcutter: ['forest', 'riverbank', 'plains'],
    quarry: ['mountain', 'pass', 'plains'],
    mine: ['mountain', 'pass'],
    wheat_farm: ['riverbank', 'plains'],
    hops_farm: ['riverbank', 'plains'],
    apple_orchard: ['riverbank', 'plains'],
    dairy_farm: ['plains', 'riverbank'],
  };
  const wanted = preference[buildingType];
  if (!wanted) return tiles[0] ?? null;

  for (const terrain of wanted) {
    const match = tiles.find((t) => t.terrain_type === terrain);
    if (match) return match;
  }
  return tiles[0] ?? null;
}

/**
 * §12: başkenti düşen oyuncu **mülteci krallığı** olarak yeniden başlamayı
 * seçebilir — haritanın tarafsız bir köşesinde küçük bir krallıkla, önceki
 * gelişiminin çoğunu kaybederek. Bu (a) izleyici kalmaya tercih edilen yoldur
 * çünkü oyuncuyu tamamen oyundan atmaz.
 */
export async function restartAsRefugee(params: {
  userId: string;
  fallenKingdomId: string;
}): Promise<JoinResult> {
  return withTransaction(async (tx) => {
    const fallen = await txQueryOne<KingdomRow>(
      tx,
      `SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [params.fallenKingdomId, params.userId],
    );
    if (!fallen) throw new Error('Krallık bulunamadı.');
    if (fallen.status !== 'fallen') throw new Error('Bu krallık hâlâ ayakta.');

    const channel = await txQueryOne<ChannelRow>(tx, 'SELECT * FROM channels WHERE id = $1', [
      fallen.channel_id,
    ]);
    if (!channel || channel.status !== 'active') throw new Error('Channel artık aktif değil.');

    // Eski krallık kaydı "mülteci" olarak işaretlenir; yeni krallık en dış
    // halkada, tarafsız bir köşede kurulur.
    await txQuery(tx, `UPDATE kingdoms SET status = 'refugee' WHERE id = $1`, [fallen.id]);

    const slotIndex = channel.next_slot_index;
    await txQuery(tx, 'UPDATE channels SET next_slot_index = next_slot_index + 1 WHERE id = $1', [
      channel.id,
    ]);
    const position = slotPosition(slotIndex);

    await ensureTiles(tx, channel.id, position.x, position.y, 2);
    const capitalTile = await txQueryOne<MapTileRow>(
      tx,
      'SELECT * FROM map_tiles WHERE channel_id = $1 AND x = $2 AND y = $3',
      [channel.id, position.x, position.y],
    );
    if (!capitalTile) throw new Error('Mülteci başkenti üretilemedi.');

    const now = config.now();
    const kingdom = await txQueryOne<KingdomRow>(
      tx,
      `INSERT INTO kingdoms (user_id, channel_id, name, capital_tile_id, protection_ends_at,
                             decree_quota_remaining, decree_quota_last_refill_at,
                             llm_provider, llm_model, llm_base_url,
                             api_key_encrypted, api_key_iv, api_key_tag, api_key_wrapped_dek,
                             strategy_note)
       VALUES ($1, $2, $3, $4, $5, 2, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        params.userId,
        channel.id,
        `${fallen.name} (Mülteci)`,
        capitalTile.id,
        // Mülteciye de koruma verilir; yoksa anında tekrar ezilir.
        new Date(now.getTime() + BALANCE.protection.durationHours * 3600_000),
        now,
        // BYOK ayarları taşınır — oyuncu anahtarını yeniden girmek zorunda kalmasın.
        fallen.llm_provider,
        fallen.llm_model,
        fallen.llm_base_url,
        fallen.api_key_encrypted,
        fallen.api_key_iv,
        fallen.api_key_tag,
        fallen.api_key_wrapped_dek,
        fallen.strategy_note,
      ],
    );
    if (!kingdom) throw new Error('Mülteci krallığı oluşturulamadı.');

    await txQuery(tx, 'UPDATE map_tiles SET owner_kingdom_id = $1, is_capital = TRUE WHERE id = $2', [
      kingdom.id,
      capitalTile.id,
    ]);

    // Mülteci krallığı gelişiminin çoğunu kaybeder: yalnızca Kale ve Meydan Sv.1.
    for (const type of ['keep', 'town_square']) {
      await txQuery(
        tx,
        'INSERT INTO building_instances (kingdom_id, type, level, tile_id) VALUES ($1, $2, 1, $3)',
        [kingdom.id, type, capitalTile.id],
      );
    }
    await txQuery(
      tx,
      `INSERT INTO unit_stocks (kingdom_id, unit_type, count) VALUES ($1, 'spearman', 5)`,
      [kingdom.id],
    );

    return { kingdom, capitalTile };
  });
}
