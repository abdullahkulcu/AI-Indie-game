/**
 * Krallık durumunun tek noktadan yüklenmesi ve türetilmiş değerler.
 *
 * Hem HTTP route'ları, hem tick servisi, hem de LLM bağlam paketi aynı
 * `KingdomSnapshot` üzerinden çalışır. Aynı hesabın iki yerde farklı yapılması,
 * "LLM'in gördüğü durum ile backend'in doğruladığı durum" arasında sapma
 * yaratırdı — §15.5'in doğrudan ihlali.
 */

import {
  BALANCE,
  BUILDINGS,
  RESOURCES,
  armyPopulationCost,
  armyUpkeepFood,
  buildingSlots,
  decreeQuotaCap,
  decreeQuotaPerHour,
  mineReserveCapacity,
  populationCapacity,
  storageCapacity,
  type ArmyComposition,
  type BuildingType,
  type Fortification,
  type ProductionBuilding,
  type Resource,
  type ResourceLedger,
  type TerrainType,
  type UnitType,
} from '@krallik/shared';
import type { QueryResultRow } from 'pg';
import { query, queryOne, txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type {
  ArmyRow,
  BuildingInstanceRow,
  ChannelRow,
  KingdomRow,
  MapTileRow,
  TrainingQueueRow,
  TroopRentalRow,
  UnitStockRow,
} from '../db/rows.js';

export interface KingdomSnapshot {
  kingdom: KingdomRow;
  channel: ChannelRow;
  capitalTile: MapTileRow | null;
  ownedTiles: MapTileRow[];
  buildings: BuildingInstanceRow[];
  /** Bina kimliği → üzerinde bulunduğu tile. */
  buildingTiles: Map<string, MapTileRow>;
  unitStocks: UnitStockRow[];
  trainingQueue: TrainingQueueRow[];
  /** Evdeki garnizon (yolda olmayan birimler). */
  garrison: ArmyComposition;
  /** Kiralanmış olarak garnizonda duran birlikler (§10.5 — yalnızca savunmada). */
  rentedIn: TroopRentalRow[];
  rentedOut: TroopRentalRow[];
  armies: ArmyRow[];
}

// ---------------------------------------------------------------------------
// Yükleme
// ---------------------------------------------------------------------------

const KINGDOM_COLUMNS = '*';

export async function loadKingdomSnapshot(
  kingdomId: string,
  tx?: Tx,
): Promise<KingdomSnapshot | null> {
  // `pg` satır tiplerini `QueryResultRow` ile kısıtlıyor; satır arayüzlerimiz
  // index signature taşımadığı için aynı kısıtı burada da kullanıyoruz.
  const run = tx
    ? <T extends QueryResultRow>(sql: string, params: unknown[]) =>
        txQuery<T>(tx, sql, params as never[])
    : <T extends QueryResultRow>(sql: string, params: unknown[]) =>
        query<T>(sql, params as never[]);

  const kingdomRows = await run<KingdomRow>(
    `SELECT ${KINGDOM_COLUMNS} FROM kingdoms WHERE id = $1`,
    [kingdomId],
  );
  const kingdom = kingdomRows[0];
  if (!kingdom) return null;

  const [channelRows, tiles, buildings, unitStocks, trainingQueue, armies, rentedIn, rentedOut] =
    await Promise.all([
      run<ChannelRow>('SELECT * FROM channels WHERE id = $1', [kingdom.channel_id]),
      run<MapTileRow>('SELECT * FROM map_tiles WHERE owner_kingdom_id = $1 ORDER BY x, y', [
        kingdomId,
      ]),
      run<BuildingInstanceRow>(
        'SELECT * FROM building_instances WHERE kingdom_id = $1 ORDER BY created_at',
        [kingdomId],
      ),
      run<UnitStockRow>('SELECT * FROM unit_stocks WHERE kingdom_id = $1', [kingdomId]),
      run<TrainingQueueRow>(
        'SELECT * FROM training_queue WHERE kingdom_id = $1 ORDER BY completes_at',
        [kingdomId],
      ),
      run<ArmyRow>(
        `SELECT * FROM armies
          WHERE kingdom_id = $1 AND status IN ('marching','engaged','besieging','returning')
          ORDER BY arrives_at`,
        [kingdomId],
      ),
      run<TroopRentalRow>(
        `SELECT * FROM troop_rentals WHERE borrower_kingdom_id = $1 AND status = 'active'`,
        [kingdomId],
      ),
      run<TroopRentalRow>(
        `SELECT * FROM troop_rentals WHERE lender_kingdom_id = $1 AND status = 'active'`,
        [kingdomId],
      ),
    ]);

  const channel = channelRows[0];
  if (!channel) return null;

  // Binaların üzerinde durduğu tile'lar başkasının toprağında olamaz, ama
  // fethedilmiş tile'lar da sahiplik değiştirdiği için ayrıca çekiyoruz.
  const tileIds = buildings.map((b) => b.tile_id).filter((id): id is string => id !== null);
  const extraTiles =
    tileIds.length > 0
      ? await run<MapTileRow>('SELECT * FROM map_tiles WHERE id = ANY($1::uuid[])', [tileIds])
      : [];

  const tileById = new Map<string, MapTileRow>();
  for (const t of [...tiles, ...extraTiles]) tileById.set(t.id, t);

  const buildingTiles = new Map<string, MapTileRow>();
  for (const b of buildings) {
    const tile = b.tile_id ? tileById.get(b.tile_id) : undefined;
    if (tile) buildingTiles.set(b.id, tile);
  }

  const capitalTile = kingdom.capital_tile_id
    ? (tileById.get(kingdom.capital_tile_id) ??
      (await run<MapTileRow>('SELECT * FROM map_tiles WHERE id = $1', [kingdom.capital_tile_id]))[0] ??
      null)
    : null;

  const garrison: ArmyComposition = {};
  for (const stock of unitStocks) {
    if (stock.count > 0) garrison[stock.unit_type] = stock.count;
  }
  // Kiralanan birlikler kiracının garnizonuna eklenir — ama yalnızca savunmada
  // kullanılabilirler; sefer oluştururken `deployableGarrison` kullanılır.
  for (const rental of rentedIn) {
    const alive = rental.count - rental.count_lost;
    if (alive > 0) garrison[rental.unit_type] = (garrison[rental.unit_type] ?? 0) + alive;
  }

  return {
    kingdom,
    channel,
    capitalTile,
    ownedTiles: tiles,
    buildings,
    buildingTiles,
    unitStocks,
    trainingQueue,
    garrison,
    rentedIn,
    rentedOut,
    armies,
  };
}

// ---------------------------------------------------------------------------
// Türetilmiş değerler
// ---------------------------------------------------------------------------

/** Krallık satırından kaynak defterini çıkarır. */
export function ledgerOf(kingdom: KingdomRow): ResourceLedger {
  const ledger = {} as ResourceLedger;
  for (const r of RESOURCES) {
    ledger[r] = Number(kingdom[r] ?? 0);
  }
  return ledger;
}

export function keepLevelOf(snapshot: KingdomSnapshot): number {
  const keep = snapshot.buildings.find((b) => b.type === 'keep');
  return keep ? keep.level : 1;
}

export function levelsOfType(snapshot: KingdomSnapshot, type: BuildingType): number[] {
  return snapshot.buildings.filter((b) => b.type === type && b.level > 0).map((b) => b.level);
}

export function highestLevelOfType(snapshot: KingdomSnapshot, type: BuildingType): number {
  return snapshot.buildings
    .filter((b) => b.type === type)
    .reduce((max, b) => Math.max(max, b.level), 0);
}

export function fortificationOf(snapshot: KingdomSnapshot): Fortification {
  return {
    keepLevel: keepLevelOf(snapshot),
    wallLevel: highestLevelOfType(snapshot, 'wall'),
    towerLevels: levelsOfType(snapshot, 'tower'),
    moatLevel: highestLevelOfType(snapshot, 'moat'),
    gateLevel: highestLevelOfType(snapshot, 'gate'),
  };
}

export function storageCapacityOf(snapshot: KingdomSnapshot): number {
  return storageCapacity(keepLevelOf(snapshot), levelsOfType(snapshot, 'granary'));
}

export function populationCapacityOf(snapshot: KingdomSnapshot): number {
  return populationCapacity(keepLevelOf(snapshot), levelsOfType(snapshot, 'town_square'));
}

/**
 * Üretime katılan binalar. Yükseltme sürerken bina eski seviyesinde çalışmaya
 * devam eder (seviye 0'daki yeni inşaat hariç) — inşaat sırasında üretimin
 * tamamen durması gereksiz derecede cezalandırıcı olurdu.
 */
export function productionBuildingsOf(snapshot: KingdomSnapshot): ProductionBuilding[] {
  const capitalTerrain: TerrainType = snapshot.capitalTile?.terrain_type ?? 'plains';
  return snapshot.buildings
    .filter((b) => b.level > 0)
    .map((b) => {
      const tile = snapshot.buildingTiles.get(b.id);
      const building: ProductionBuilding = {
        id: b.id,
        type: b.type,
        level: b.level,
        terrain: tile?.terrain_type ?? capitalTerrain,
      };
      if (BUILDINGS[b.type].hasMineReserve) {
        building.mineReserveRemaining =
          tile?.mine_reserve_remaining ?? mineReserveCapacity(b.level);
      }
      return building;
    });
}

/** Ordu ve garnizonun toplam nüfus maliyeti. */
export function militaryPopulationOf(snapshot: KingdomSnapshot): number {
  // Kiralanan birliklerin nüfus maliyeti kiralayana ait (§10.5) — kiracıya
  // yüklenmemeli, bu yüzden ham `unit_stocks` üzerinden hesaplanır.
  const own: ArmyComposition = {};
  for (const stock of snapshot.unitStocks) {
    if (stock.count > 0) own[stock.unit_type] = stock.count;
  }
  let total = armyPopulationCost(own);
  for (const army of snapshot.armies) {
    total += armyPopulationCost(army.composition);
  }
  // Eğitim kuyruğundaki birimler henüz nüfus tüketmez; tamamlanınca tüketirler.
  return total;
}

/** Binalarda çalışabilecek sivil nüfus. */
export function availableWorkersOf(snapshot: KingdomSnapshot): number {
  return Math.max(0, snapshot.kingdom.population - militaryPopulationOf(snapshot));
}

/**
 * Erzak tüketen tüm birlikler: garnizon (kiralananlar dahil — kiracı erzağı
 * üstlenir, §10.5) + seferdeki ordular.
 */
export function totalUpkeepFoodOf(snapshot: KingdomSnapshot): number {
  let total = armyUpkeepFood(snapshot.garrison);
  for (const army of snapshot.armies) {
    total += armyUpkeepFood(army.composition);
  }
  return total;
}

/**
 * Sefere çıkarılabilir birlikler.
 *
 * GDD §10.5: kiralanan birlikler kiracının garnizonuna eklenir ama **sadece
 * savunmada** kullanılabilir — kiracı bunları saldırıya çıkaramaz. Doğrudan
 * satın alınan Kiralık Asker'den (`mercenary`) farkı tam olarak budur.
 */
export function deployableGarrisonOf(snapshot: KingdomSnapshot): ArmyComposition {
  const own: ArmyComposition = {};
  for (const stock of snapshot.unitStocks) {
    if (stock.count > 0) own[stock.unit_type] = stock.count;
  }
  return own;
}

export function buildingSlotsUsedOf(snapshot: KingdomSnapshot): number {
  // Kale bir slot tüketmez; krallığın kendisidir.
  return snapshot.buildings.filter((b) => b.type !== 'keep').length;
}

export function buildingSlotsTotalOf(snapshot: KingdomSnapshot): number {
  return buildingSlots(keepLevelOf(snapshot));
}

export function decreeQuotaInfoOf(snapshot: KingdomSnapshot): {
  remaining: number;
  cap: number;
  perHour: number;
} {
  const keepLevel = keepLevelOf(snapshot);
  return {
    remaining: snapshot.kingdom.decree_quota_remaining,
    cap: decreeQuotaCap(keepLevel),
    perHour: decreeQuotaPerHour(keepLevel),
  };
}

/** Krallık yeni oyuncu koruması altında mı (§13). */
export function isProtected(kingdom: KingdomRow, now: Date): boolean {
  return kingdom.protection_ends_at !== null && kingdom.protection_ends_at.getTime() > now.getTime();
}

/**
 * Krallık pasif modda mı — son X dakikadır aktif chat açmamışsa öyle sayılır
 * (§14.2). Aktif olmak ekstra emir vermiyor, yalnızca zamanlama esnekliği
 * sağlıyor (§14.4), bu yüzden bu ayrım sadece *kimin karar verdiğini* belirler.
 */
export function isPassive(kingdom: KingdomRow, now: Date): boolean {
  const idleMs = now.getTime() - kingdom.last_active_at.getTime();
  return idleMs > BALANCE.general.passiveAfterMinutes * 60_000;
}

/** Aktif şenlik bonusu (§6.2); süresi dolmuşsa 0. */
export function activeFestivalBonus(kingdom: KingdomRow, now: Date): number {
  if (!kingdom.festival_bonus_until) return 0;
  if (kingdom.festival_bonus_until.getTime() <= now.getTime()) return 0;
  return kingdom.festival_bonus_value;
}

// ---------------------------------------------------------------------------
// Yazma yardımcıları
// ---------------------------------------------------------------------------

/**
 * Kaynak defterini krallık satırına yazar.
 *
 * Negatif değer yazılmasına izin verilmez: bir tick sırasında yiyecek açığı
 * stoğu sıfırın altına itmiş olabilir; borç kavramı yok, sıfırda durur ve
 * eksik kalan tüketim popülerlik/moral üzerinden cezalandırılır.
 */
export async function writeLedger(
  tx: Tx,
  kingdomId: string,
  ledger: ResourceLedger,
): Promise<void> {
  const columns = RESOURCES.map((r, i) => `${r} = $${i + 2}`).join(', ');
  const values = RESOURCES.map((r) => Math.max(0, Number(ledger[r] ?? 0)));
  await txQuery(tx, `UPDATE kingdoms SET ${columns} WHERE id = $1`, [kingdomId, ...values]);
}

/** Tek bir kaynak kalemini atomik olarak artırır/azaltır. */
export async function adjustResource(
  tx: Tx,
  kingdomId: string,
  resource: Resource,
  delta: number,
): Promise<void> {
  await txQuery(
    tx,
    `UPDATE kingdoms SET ${resource} = GREATEST(0, ${resource} + $2) WHERE id = $1`,
    [kingdomId, delta],
  );
}

export async function adjustUnitStock(
  tx: Tx,
  kingdomId: string,
  unitType: UnitType,
  delta: number,
): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO unit_stocks (kingdom_id, unit_type, count)
       VALUES ($1, $2, GREATEST(0, $3))
     ON CONFLICT (kingdom_id, unit_type)
       DO UPDATE SET count = GREATEST(0, unit_stocks.count + $3)`,
    [kingdomId, unitType, delta],
  );
}

export async function addUnits(
  tx: Tx,
  kingdomId: string,
  units: ArmyComposition,
): Promise<void> {
  for (const [type, count] of Object.entries(units) as [UnitType, number][]) {
    if (count > 0) await adjustUnitStock(tx, kingdomId, type, count);
  }
}

export async function removeUnits(
  tx: Tx,
  kingdomId: string,
  units: ArmyComposition,
): Promise<void> {
  for (const [type, count] of Object.entries(units) as [UnitType, number][]) {
    if (count > 0) await adjustUnitStock(tx, kingdomId, type, -count);
  }
}

export async function loadChannel(channelId: string): Promise<ChannelRow | null> {
  return queryOne<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
}

export async function loadTile(tileId: string, tx?: Tx): Promise<MapTileRow | null> {
  return tx
    ? txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [tileId])
    : queryOne<MapTileRow>('SELECT * FROM map_tiles WHERE id = $1', [tileId]);
}

export async function loadTileAt(
  channelId: string,
  x: number,
  y: number,
  tx?: Tx,
): Promise<MapTileRow | null> {
  const sql = 'SELECT * FROM map_tiles WHERE channel_id = $1 AND x = $2 AND y = $3';
  return tx
    ? txQueryOne<MapTileRow>(tx, sql, [channelId, x, y])
    : queryOne<MapTileRow>(sql, [channelId, x, y]);
}
