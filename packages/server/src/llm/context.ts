/**
 * Dinamik durum enjeksiyonu — GDD §14.7 katman 2.
 *
 * Katman 1 sabit ve önbelleklenebilir; burası her çağrıda yeniden üretilen
 * kısımdır. §14.7'nin kapanış notu belirleyici: paket **kompakt ve
 * yapılandırılmış** olmalı, ham düzyazı değil — zayıf/ucuz bir model de bunu
 * işleyebilmeli. Bu yüzden her bölüm satır başına bir olgu taşıyan, kısaltılmış
 * bir tablo gibi yazılır.
 *
 * Bütçe: ~4000 token (`CONTEXT_TOKEN_BUDGET`). Aşılırsa bölümler **en düşük
 * değerliden başlayarak** düşürülür (bölge bülteni → pazar → olaylar → …);
 * krallığın hayatta kalmasına dair bölümler (tehditler, kaynaklar, bekleyen
 * kararlar) asla düşmez.
 */

import {
  BALANCE,
  RESOURCE_LABELS_TR,
  PRIMARY_RESOURCES,
  armyUnitCount,
  computeProduction,
  type ArmyComposition,
  type ResourceLedger,
} from '@krallik/shared';
import { query } from '../db/pool.js';
import type { PendingDecisionRow } from '../db/rows.js';
import {
  availableWorkersOf,
  decreeQuotaInfoOf,
  deployableGarrisonOf,
  fortificationOf,
  isPassive,
  isProtected,
  keepLevelOf,
  ledgerOf,
  populationCapacityOf,
  productionBuildingsOf,
  storageCapacityOf,
  totalUpkeepFoodOf,
  type KingdomSnapshot,
} from '../game/state.js';

/** Hedeflenen üst sınır. Aşılırsa düşük değerli bölümler kırpılır. */
export const CONTEXT_TOKEN_BUDGET = 4000;

/**
 * Kaba token tahmini. Türkçe metin İngilizceden daha kötü tokenlaşır; 3
 * karakter/token temkinli bir üst sınır tahmini verir.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export interface ContextInput {
  snapshot: KingdomSnapshot;
  mode: 'active' | 'passive';
  now: Date;
}

export interface KingdomContext {
  text: string;
  estimatedTokens: number;
  /** Üst katman bunları ayrıca kullanır (onay akışı), yeniden sorgulamasın. */
  pendingDecisions: PendingDecisionRow[];
  /** Bütçe yüzünden atılan bölümler — testlerde ve teşhiste işe yarar. */
  droppedSections: string[];
}

interface Section {
  key: string;
  body: string;
  /** Büyük sayı = önce atılır. 0 = asla atılmaz. */
  dropOrder: number;
}

// ---------------------------------------------------------------------------
// Küçük biçimlendiriciler
// ---------------------------------------------------------------------------

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** "3sa 12dk" / "8dk" — saniye yerine oyuncunun düşündüğü birimlerle. */
function until(target: Date | null, now: Date): string {
  if (!target) return '—';
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 'şimdi';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}dk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}sa ${rest}dk` : `${hours}sa`;
}

function armyTr(army: ArmyComposition): string {
  const parts = Object.entries(army)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type, count]) => `${type} ${count}`);
  return parts.length > 0 ? parts.join(', ') : 'yok';
}

/**
 * Yaklaşan düşman ordusunun büyüklüğü yuvarlanarak verilir: gözcü raporu kesin
 * sayım değildir, kesin bilgi casusla gelir (§10.2).
 */
function approximateSize(count: number): string {
  if (count <= 0) return 'bilinmiyor';
  const step = count < 50 ? 10 : count < 200 ? 25 : 50;
  return `~${Math.round(count / step) * step}`;
}

function ledgerTr(ledger: ResourceLedger, capacity: number): string {
  const primary = PRIMARY_RESOURCES.map((resource) => {
    const amount = round(ledger[resource]);
    if (resource === 'gold') return `${RESOURCE_LABELS_TR[resource]} ${amount}`;
    return `${RESOURCE_LABELS_TR[resource]} ${amount}/${capacity}`;
  });
  // Ara ürünler yalnızca stok varsa yazılır — sıfır satırları bütçe israfı.
  const intermediates = (['wheat', 'flour', 'hops', 'milk', 'ore', 'weapons', 'cheese'] as const)
    .filter((resource) => ledger[resource] >= 1)
    .map((resource) => `${RESOURCE_LABELS_TR[resource]} ${round(ledger[resource])}`);
  return [...primary, ...intermediates].join(' | ');
}

// ---------------------------------------------------------------------------
// Veritabanı sorguları
// ---------------------------------------------------------------------------

interface IncomingArmyRow {
  id: string;
  intent: string;
  arrives_at: Date;
  composition: ArmyComposition;
  attacker_name: string;
}

interface SiegeContextRow {
  id: string;
  side: 'attacker' | 'defender';
  current_round: number;
  max_rounds: number;
  wall_integrity: number;
  wall_integrity_max: number;
  next_round_at: Date;
  counterparty_name: string;
}

interface RelationContextRow {
  state: string;
  other_id: string;
  other_name: string;
  other_reputation: number;
}

interface ThreadContextRow {
  id: string;
  proposal_type: string;
  terms: Record<string, unknown>;
  from_kingdom_id: string;
  counterparty_name: string;
  counterparty_reputation: number;
  updated_at: Date;
}

interface MarketOfferContextRow {
  id: string;
  offer_resource: string;
  offer_amount: number;
  request_resource: string;
  request_amount: number;
  seller_name: string;
}

interface WorldEventContextRow {
  type: string;
  expires_at: Date | null;
}

interface NotificationContextRow {
  kind: string;
  title: string;
  created_at: Date;
}

interface BulletinContextRow {
  kind: string;
  summary: string;
  created_at: Date;
}

interface ProtectionContextRow {
  protector_kingdom_id: string;
  vassal_kingdom_id: string;
  tribute_rate: number;
  protector_name: string;
  vassal_name: string;
}

// ---------------------------------------------------------------------------
// Bağlam paketi
// ---------------------------------------------------------------------------

export async function buildKingdomContext(input: ContextInput): Promise<KingdomContext> {
  const { snapshot, now } = input;
  const kingdomId = snapshot.kingdom.id;
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const [
    pendingDecisions,
    incoming,
    sieges,
    relations,
    threads,
    offers,
    worldEvents,
    notifications,
    bulletins,
    protections,
  ] = await Promise.all([
    query<PendingDecisionRow>(
      `SELECT * FROM pending_decisions
        WHERE kingdom_id = $1 AND status = 'awaiting'
        ORDER BY created_at LIMIT 5`,
      [kingdomId],
    ),
    query<IncomingArmyRow>(
      `SELECT a.id, a.intent, a.arrives_at, a.composition, k.name AS attacker_name
         FROM armies a
         JOIN map_tiles t ON t.id = a.target_tile_id
         JOIN kingdoms k ON k.id = a.kingdom_id
        WHERE t.owner_kingdom_id = $1
          AND a.kingdom_id <> $1
          AND a.status IN ('marching','engaged','besieging')
        ORDER BY a.arrives_at LIMIT 6`,
      [kingdomId],
    ),
    query<SiegeContextRow>(
      `SELECT s.id,
              CASE WHEN s.attacker_kingdom_id = $1 THEN 'attacker' ELSE 'defender' END AS side,
              s.current_round, s.max_rounds, s.wall_integrity, s.wall_integrity_max, s.next_round_at,
              k.name AS counterparty_name
         FROM sieges s
         JOIN kingdoms k
           ON k.id = CASE WHEN s.attacker_kingdom_id = $1 THEN s.defender_kingdom_id
                          ELSE s.attacker_kingdom_id END
        WHERE s.status = 'ongoing'
          AND (s.attacker_kingdom_id = $1 OR s.defender_kingdom_id = $1)
        ORDER BY s.next_round_at LIMIT 4`,
      [kingdomId],
    ),
    query<RelationContextRow>(
      `SELECT r.state,
              CASE WHEN r.kingdom_a_id = $1 THEN r.kingdom_b_id ELSE r.kingdom_a_id END AS other_id,
              k.name AS other_name,
              k.reputation AS other_reputation
         FROM kingdom_relations r
         JOIN kingdoms k
           ON k.id = CASE WHEN r.kingdom_a_id = $1 THEN r.kingdom_b_id ELSE r.kingdom_a_id END
        WHERE r.kingdom_a_id = $1 OR r.kingdom_b_id = $1
        ORDER BY r.updated_at DESC LIMIT 10`,
      [kingdomId],
    ),
    query<ThreadContextRow>(
      `SELECT d.id, d.proposal_type, d.terms, d.from_kingdom_id, d.updated_at,
              k.name AS counterparty_name, k.reputation AS counterparty_reputation
         FROM diplomacy_threads d
         JOIN kingdoms k
           ON k.id = CASE WHEN d.from_kingdom_id = $1 THEN d.to_kingdom_id ELSE d.from_kingdom_id END
        WHERE d.status = 'pending' AND (d.from_kingdom_id = $1 OR d.to_kingdom_id = $1)
        ORDER BY d.updated_at DESC LIMIT 5`,
      [kingdomId],
    ),
    query<MarketOfferContextRow>(
      `SELECT o.id, o.offer_resource, o.offer_amount, o.request_resource, o.request_amount,
              k.name AS seller_name
         FROM market_offers o
         JOIN kingdoms k ON k.id = o.kingdom_id
        WHERE o.channel_id = $1 AND o.status = 'open' AND o.kingdom_id <> $2
        ORDER BY o.created_at DESC LIMIT 5`,
      [snapshot.kingdom.channel_id, kingdomId],
    ),
    query<WorldEventContextRow>(
      `SELECT type, expires_at FROM world_events
        WHERE affected_kingdom_id = $1 AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY triggered_at DESC LIMIT 3`,
      [kingdomId, now],
    ),
    query<NotificationContextRow>(
      `SELECT kind, title, created_at FROM notifications
        WHERE kingdom_id = $1 AND created_at > $2 AND kind <> 'llm_error'
        ORDER BY created_at DESC LIMIT 6`,
      [kingdomId, dayAgo],
    ),
    query<BulletinContextRow>(
      `SELECT kind, summary, created_at FROM region_bulletins
        WHERE kingdom_id = $1 ORDER BY created_at DESC LIMIT 2`,
      [kingdomId],
    ),
    query<ProtectionContextRow>(
      `SELECT p.protector_kingdom_id, p.vassal_kingdom_id, p.tribute_rate,
              kp.name AS protector_name, kv.name AS vassal_name
         FROM protection_relationships p
         JOIN kingdoms kp ON kp.id = p.protector_kingdom_id
         JOIN kingdoms kv ON kv.id = p.vassal_kingdom_id
        WHERE p.status = 'active'
          AND (p.protector_kingdom_id = $1 OR p.vassal_kingdom_id = $1)
        LIMIT 5`,
      [kingdomId],
    ),
  ]);

  const sections: Section[] = [];
  const kingdom = snapshot.kingdom;
  const keepLevel = keepLevelOf(snapshot);
  const quota = decreeQuotaInfoOf(snapshot);
  const storage = storageCapacityOf(snapshot);
  const ledger = ledgerOf(kingdom);

  // --- Krallık künyesi ---------------------------------------------------
  sections.push({
    key: 'krallik',
    dropOrder: 0,
    body: [
      '## KRALLIK',
      `ad: ${kingdom.name} | kale sv${keepLevel} | konum: ${
        snapshot.capitalTile ? `(${snapshot.capitalTile.x},${snapshot.capitalTile.y}) ${snapshot.capitalTile.terrain_type}` : 'bilinmiyor'
      }`,
      `nüfus ${Math.round(kingdom.population)}/${Math.round(populationCapacityOf(snapshot))} · boştaki işçi ${Math.round(availableWorkersOf(snapshot))}`,
      `popülerlik ${round(kingdom.popularity, 1)} · itibar ${round(kingdom.reputation, 1)} · sadakatim ${round(kingdom.general_loyalty, 1)} · vergi %${kingdom.tax_rate}`,
      `emir kotası ${round(quota.remaining, 1)}/${quota.cap} (saatlik +${quota.perHour})`,
      `mod: ${input.mode === 'passive' ? 'PASİF — Kral çevrimdışı, kararı sen vereceksin' : 'AKTİF — Kral Meclis\'te'}`,
      isProtected(kingdom, now)
        ? `yeni oyuncu koruması: ${until(kingdom.protection_ends_at, now)} kaldı (saldırı seferi çıkaramazsın)`
        : 'yeni oyuncu koruması: yok',
      isPassive(kingdom, now) && input.mode === 'active'
        ? 'not: Kral uzun süredir sessizdi, yeni döndü.'
        : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  });

  // --- Kaynaklar ---------------------------------------------------------
  sections.push({
    key: 'kaynaklar',
    dropOrder: 0,
    body: ['## KAYNAKLAR', `depo tavanı ${storage} (altın sınırsız)`, ledgerTr(ledger, storage)].join('\n'),
  });

  // --- Tehditler ---------------------------------------------------------
  const threatLines: string[] = [];
  for (const army of incoming) {
    threatLines.push(
      `- ${army.attacker_name} → niyet:${army.intent} · ${approximateSize(armyUnitCount(army.composition))} birim · varış ${until(army.arrives_at, now)}`,
    );
  }
  for (const siege of sieges) {
    threatLines.push(
      `- KUŞATMA[${siege.id}] ${siege.side === 'defender' ? 'savunmadasın' : 'kuşatıyorsun'} · rakip ${siege.counterparty_name} · round ${siege.current_round}/${siege.max_rounds} · sur ${Math.round(siege.wall_integrity)}/${Math.round(siege.wall_integrity_max)} · sıradaki round ${until(siege.next_round_at, now)}`,
    );
  }
  if (threatLines.length > 0) {
    sections.push({
      key: 'tehditler',
      dropOrder: 0,
      body: ['## TEHDİTLER', ...threatLines].join('\n'),
    });
  }

  // --- Bekleyen kararlar -------------------------------------------------
  if (pendingDecisions.length > 0) {
    sections.push({
      key: 'bekleyen_kararlar',
      dropOrder: 0,
      body: [
        '## KRAL ONAYI BEKLEYEN KARARLAR',
        ...pendingDecisions.map(
          (decision) =>
            `- [${decision.id}] ${decision.proposed_action_json.name} ${JSON.stringify(
              decision.proposed_action_json.arguments,
            )} · gerekçe: ${decision.risk_reasons.join(' ')} · süre ${until(decision.expires_at, now)}`,
        ),
      ].join('\n'),
    });
  }

  // --- Strateji notu -----------------------------------------------------
  sections.push({
    key: 'strateji',
    dropOrder: 0,
    body: `## KRAL'IN STRATEJİ NOTU\n${kingdom.strategy_note.trim() || '(boş — Kral henüz bir yön belirtmedi)'}`,
  });

  // --- Ordu --------------------------------------------------------------
  const fort = fortificationOf(snapshot);
  const armyLines = [
    `garnizon (savunma): ${armyTr(snapshot.garrison)}`,
    `sefere çıkarılabilir: ${armyTr(deployableGarrisonOf(snapshot))}`,
    `tahkimat: kale sv${fort.keepLevel} · sur sv${fort.wallLevel} · kule ${fort.towerLevels.join('/') || 'yok'} · hendek sv${fort.moatLevel} · kapı sv${fort.gateLevel}`,
    `erzak yükü: ${round(totalUpkeepFoodOf(snapshot), 1)} yiyecek/saat`,
  ];
  for (const army of snapshot.armies) {
    armyLines.push(
      `- sefer[${army.intent}] ${armyTr(army.composition)} → varış ${until(army.arrives_at, now)} · durum ${army.status}`,
    );
  }
  for (const training of snapshot.trainingQueue) {
    armyLines.push(
      `- eğitimde ${training.unit_type} ×${training.count} → ${until(training.completes_at, now)}`,
    );
  }
  for (const rental of snapshot.rentedIn) {
    armyLines.push(
      `- kiralanmış ${rental.unit_type} ×${rental.count - rental.count_lost} (YALNIZCA savunma) → iade ${until(rental.ends_at, now)}`,
    );
  }
  for (const rental of snapshot.rentedOut) {
    armyLines.push(
      `- kiraya verilmiş ${rental.unit_type} ×${rental.count - rental.count_lost} → dönüş ${until(rental.ends_at, now)}`,
    );
  }
  sections.push({ key: 'ordu', dropOrder: 3, body: ['## ORDU', ...armyLines].join('\n') });

  // --- Binalar -----------------------------------------------------------
  const buildingLines = snapshot.buildings.map((building) => {
    const tile = snapshot.buildingTiles.get(building.id);
    const bits = [`${building.type} sv${building.level}`, `[${building.id}]`];
    if (tile) bits.push(tile.terrain_type);
    if (building.upgrading_to_level && building.upgrade_completes_at) {
      bits.push(`→sv${building.upgrading_to_level} (${until(building.upgrade_completes_at, now)})`);
    }
    if (tile?.mine_reserve_capacity) {
      const share = Math.round(((tile.mine_reserve_remaining ?? 0) / tile.mine_reserve_capacity) * 100);
      bits.push(`rezerv %${share}`);
    }
    return `- ${bits.join(' · ')}`;
  });
  sections.push({
    key: 'binalar',
    dropOrder: 4,
    body: ['## BİNALAR', ...buildingLines].join('\n'),
  });

  // --- Üretim projeksiyonu ----------------------------------------------
  // Bir saatlik ileri projeksiyon; asıl hesabı tick yapar, buradaki kopya
  // yalnızca General'a darboğazı *gösterir* (aynı saf fonksiyon kullanılır,
  // dolayısıyla iki farklı gerçek doğmaz).
  const projection = computeProduction({
    buildings: productionBuildingsOf(snapshot),
    stock: ledger,
    capacity: storage,
    hours: 1,
    population: kingdom.population,
    availableWorkers: availableWorkersOf(snapshot),
    taxRate: kingdom.tax_rate,
    armyUpkeepFoodPerHour: totalUpkeepFoodOf(snapshot),
  });
  const bottleneckLines = projection.bottlenecks.slice(0, 4).map((bottleneck) => {
    const cause =
      bottleneck.reason === 'input_shortage'
        ? `girdi eksik (${bottleneck.limitingResource})`
        : bottleneck.reason === 'worker_shortage'
          ? 'işçi eksik'
          : bottleneck.reason === 'storage_full'
            ? 'depo dolu'
            : 'rezerv tükendi';
    return `- ${bottleneck.buildingType} · kapasite %${Math.round(bottleneck.utilization * 100)} · ${cause}`;
  });
  sections.push({
    key: 'uretim',
    dropOrder: 5,
    body: [
      '## ÜRETİM (1 saatlik projeksiyon)',
      `yiyecek dengesi: ${round(projection.foodBalancePerHour, 1)}/saat · işçi doluluğu %${Math.round(projection.workerUtilization * 100)}`,
      ...(bottleneckLines.length > 0 ? ['darboğazlar:', ...bottleneckLines] : ['darboğaz yok']),
    ].join('\n'),
  });

  // --- Diplomasi ---------------------------------------------------------
  const diplomacyLines: string[] = [];
  for (const relation of relations) {
    const flag =
      relation.other_reputation < BALANCE.diplomacy.lowReputationThreshold ? ' ⚠GÜVENİLMEZ' : '';
    diplomacyLines.push(
      `- ${relation.other_name} [${relation.other_id}] · ilişki: ${relation.state} · itibar ${round(relation.other_reputation)}${flag}`,
    );
  }
  for (const protection of protections) {
    diplomacyLines.push(
      protection.protector_kingdom_id === kingdomId
        ? `- KORUYUCUSUSUN: ${protection.vassal_name} · haraç %${round(protection.tribute_rate * 100, 1)}`
        : `- VASALISIN: ${protection.protector_name} · haraç %${round(protection.tribute_rate * 100, 1)}`,
    );
  }
  for (const thread of threads) {
    const direction = thread.from_kingdom_id === kingdomId ? 'senin teklifin' : 'gelen teklif';
    diplomacyLines.push(
      `- görüşme[${thread.id}] ${direction} · ${thread.proposal_type} · karşı taraf ${thread.counterparty_name} (itibar ${round(thread.counterparty_reputation)}) · şartlar ${JSON.stringify(thread.terms)}`,
    );
  }
  if (diplomacyLines.length > 0) {
    sections.push({
      key: 'diplomasi',
      dropOrder: 3,
      body: ['## DİPLOMASİ', ...diplomacyLines].join('\n'),
    });
  }

  // --- Olaylar ve bildirimler -------------------------------------------
  const eventLines: string[] = [];
  for (const event of worldEvents) {
    eventLines.push(`- dünya olayı: ${event.type} · biter ${until(event.expires_at, now)}`);
  }
  for (const notification of notifications) {
    eventLines.push(`- ${notification.kind}: ${notification.title}`);
  }
  if (eventLines.length > 0) {
    sections.push({ key: 'olaylar', dropOrder: 6, body: ['## SON OLAYLAR', ...eventLines].join('\n') });
  }

  // --- Pazar -------------------------------------------------------------
  if (offers.length > 0) {
    sections.push({
      key: 'pazar',
      dropOrder: 7,
      body: [
        '## PAZARDAKİ AÇIK İLANLAR',
        ...offers.map(
          (offer) =>
            `- [${offer.id}] ${offer.seller_name}: ${round(offer.offer_amount)} ${offer.offer_resource} → ${round(offer.request_amount)} ${offer.request_resource}`,
        ),
      ].join('\n'),
    });
  }

  // --- Bölgesel duyum akışı ---------------------------------------------
  if (bulletins.length > 0) {
    sections.push({
      key: 'bolge',
      dropOrder: 8,
      body: [
        '## BÖLGE BÜLTENİ',
        ...bulletins.map((bulletin) => `- (${bulletin.kind}) ${bulletin.summary}`),
      ].join('\n'),
    });
  }

  // --- Bütçe kırpması ----------------------------------------------------
  const droppedSections: string[] = [];
  let kept = sections;
  let text = render(kept);
  while (estimateTokens(text) > CONTEXT_TOKEN_BUDGET) {
    const droppable = kept.filter((section) => section.dropOrder > 0);
    if (droppable.length === 0) break;
    let worst = droppable[0]!;
    for (const section of droppable) {
      if (section.dropOrder > worst.dropOrder) worst = section;
    }
    droppedSections.push(worst.key);
    kept = kept.filter((section) => section !== worst);
    text = render(kept);
  }

  return {
    text,
    estimatedTokens: estimateTokens(text),
    pendingDecisions,
    droppedSections,
  };
}

function render(sections: Section[]): string {
  return ['# KRALLIK DURUMU', ...sections.map((section) => section.body)].join('\n\n');
}
