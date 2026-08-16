/**
 * Ekonomi tick'i — üretim, popülerlik, nüfus, itibar (§15.3 adım 5).
 *
 * Üretim **lazy** hesaplanır: her tick'te `üretim_hızı × geçen_süre` formülüyle
 * son tick'ten bu yana geçen pencere çözülür. Bu, tick'in gecikmesi ya da
 * sunucunun bir süre kapalı kalması durumunda kaynak kaybı olmamasını sağlıyor —
 * krallık "oyun kapalıyken bile hayatta" (GDD giriş) olduğu için bu şart.
 */

import {
  BALANCE,
  BUILDINGS,
  advancePopularity,
  advancePopulation,
  computeProduction,
  driftReputation,
  popularityTarget,
  revoltChance,
  type Resource,
} from '@krallik/shared';
import { config } from '../config.js';
import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type { BuildingInstanceRow, KingdomRow, WorldEventRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';
import {
  activeFestivalBonus,
  availableWorkersOf,
  ledgerOf,
  levelsOfType,
  loadKingdomSnapshot,
  populationCapacityOf,
  storageCapacityOf,
  totalUpkeepFoodOf,
  writeLedger,
} from '../game/state.js';

/** Bir krallığın ekonomisini son tick'ten bu yana ilerletir. */
export async function advanceKingdomEconomy(tx: Tx, kingdomId: string): Promise<void> {
  const snapshot = await loadKingdomSnapshot(kingdomId, tx);
  if (!snapshot) return;
  const { kingdom } = snapshot;

  const now = config.now();
  const elapsedMs = now.getTime() - kingdom.last_tick_at.getTime();
  const hours = elapsedMs / 3_600_000;

  // Çok kısa aralıkları atla: her dakikalık tick'te tam bir üretim hesabı
  // yapmak gereksiz; 30 saniyenin altındaki pencereler bir sonrakine devreder.
  if (hours < 30 / 3600) return;

  // Fethedilmiş krallıklar üretmez.
  if (kingdom.status !== 'active') {
    await txQuery(tx, 'UPDATE kingdoms SET last_tick_at = $2 WHERE id = $1', [kingdomId, now]);
    return;
  }

  // --- Aktif dünya olaylarının çarpanları (§11) --------------------------
  const events = await txQuery<WorldEventRow>(
    tx,
    `SELECT * FROM world_events
      WHERE affected_kingdom_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [kingdomId],
  );
  let foodMultiplier = 1;
  for (const event of events) {
    if (event.type === 'bountiful_harvest') {
      foodMultiplier *= BALANCE.worldEvents.bountifulHarvest.foodMultiplier;
    }
  }

  // --- Üretim zinciri ---------------------------------------------------
  const capacity = storageCapacityOf(snapshot);
  const production = computeProduction({
    buildings: snapshot.buildings
      .filter((b) => b.level > 0)
      .map((b) => {
        const tile = snapshot.buildingTiles.get(b.id);
        const entry = {
          id: b.id,
          type: b.type,
          level: b.level,
          terrain: tile?.terrain_type ?? snapshot.capitalTile?.terrain_type ?? 'plains',
        } as const;
        return BUILDINGS[b.type].hasMineReserve
          ? { ...entry, mineReserveRemaining: tile?.mine_reserve_remaining ?? 0 }
          : entry;
      }),
    stock: ledgerOf(kingdom),
    capacity,
    hours,
    population: kingdom.population,
    availableWorkers: availableWorkersOf(snapshot),
    taxRate: kingdom.tax_rate,
    foodMultiplier,
    armyUpkeepFoodPerHour: totalUpkeepFoodOf(snapshot),
  });

  await writeLedger(tx, kingdomId, production.finalStock);

  // Maden rezervlerinin tükenmesi (§4.1).
  for (const [buildingId, consumed] of Object.entries(production.mineReserveConsumed)) {
    if (consumed <= 0) continue;
    const building = snapshot.buildings.find((b) => b.id === buildingId);
    if (!building?.tile_id) continue;
    await txQuery(
      tx,
      `UPDATE map_tiles
          SET mine_reserve_remaining = GREATEST(0, COALESCE(mine_reserve_remaining, 0) - $2)
        WHERE id = $1`,
      [building.tile_id, consumed],
    );
    await maybeWarnDepletion(tx, kingdomId, building, snapshot.buildingTiles.get(buildingId)?.mine_reserve_remaining ?? 0, consumed);
  }

  // --- Popülerlik (§6) ---------------------------------------------------
  const recent = await recentBattleOutcomes(tx, kingdomId);
  const underSiege = await isUnderSiege(tx, kingdomId);

  const target = popularityTarget({
    taxRate: kingdom.tax_rate,
    foodBalancePerHour: production.foodBalancePerHour,
    population: kingdom.population,
    aleStock: production.finalStock.ale,
    cheeseStock: production.finalStock.cheese,
    chapelLevels: levelsOfType(snapshot, 'chapel'),
    townSquareLevels: levelsOfType(snapshot, 'town_square'),
    recentDefeats: recent.defeats,
    recentDefenseVictories: recent.defenseVictories,
    recentAttackVictories: recent.attackVictories,
    underSiege,
    festivalBonus: activeFestivalBonus(kingdom, now),
  });

  let popularity = advancePopularity(kingdom.popularity, target, hours);
  if (underSiege) {
    popularity = Math.max(0, popularity - BALANCE.popularity.underSiegePenaltyPerHour * hours);
  }

  // --- Nüfus (§6.1) ------------------------------------------------------
  const population = advancePopulation({
    population: kingdom.population,
    capacity: populationCapacityOf(snapshot),
    popularity,
    foodBalancePerHour: production.foodBalancePerHour,
    hours,
  });

  // --- İtibar (§10.3) — zamanla nötre doğru çok yavaş kayar --------------
  const reputation = driftReputation(kingdom.reputation, hours);

  await txQuery(
    tx,
    // `peak_population` integer, `population` numeric: aynı parametreyi iki
    // farklı tipte kullanmak Postgres'te "inconsistent types" hatası veriyor,
    // bu yüzden zirve nüfus ayrı bir parametre olarak yuvarlanmış gidiyor.
    `UPDATE kingdoms
        SET popularity = $2, population = $3, reputation = $4,
            peak_population = GREATEST(peak_population, $5),
            last_tick_at = $6
      WHERE id = $1`,
    [kingdomId, popularity, population, reputation, Math.round(population), now],
  );

  // --- İsyan riski (§6) --------------------------------------------------
  if (popularity < BALANCE.popularity.revoltThreshold) {
    await maybeRevolt(tx, kingdom, snapshot.buildings, popularity, hours);
  } else if (
    popularity < BALANCE.popularity.migrationThreshold &&
    kingdom.popularity >= BALANCE.popularity.migrationThreshold
  ) {
    // Eşiği yeni geçtiyse bir kez uyar; her tick'te bildirim yağmuru olmasın.
    await notify(tx, {
      kingdomId,
      kind: 'world_event',
      severity: 'warning',
      title: 'Halk hoşnutsuz',
      body:
        `Popülerlik ${popularity.toFixed(0)}/100'e düştü. Göç başladı ve üretim yavaşlıyor. ` +
        'Vergiyi düşürmek, yiyecek arzını artırmak ya da şenlik düzenlemek gerekiyor.',
    });
  }

  // --- Depo taşması uyarısı ---------------------------------------------
  const wastedTotal = Object.values(production.wasted).reduce((s, v) => s + (v ?? 0), 0);
  if (wastedTotal > capacity * 0.05) {
    await notify(tx, {
      kingdomId,
      kind: 'world_event',
      severity: 'warning',
      title: 'Ambar taştı',
      body:
        `Depo kapasitesi dolduğu için ${Math.round(wastedTotal)} birim üretim ziyan oldu. ` +
        'Ambarı yükseltmeli ya da fazlayı pazarda satmalıyız.',
    });
  }
}

/** Maden rezervi kritik eşiğe inince bir kez uyarır (§4.1). */
async function maybeWarnDepletion(
  tx: Tx,
  kingdomId: string,
  building: BuildingInstanceRow,
  remainingBefore: number,
  consumed: number,
): Promise<void> {
  if (!building.tile_id) return;
  const tile = await txQueryOne<{ mine_reserve_remaining: number | null; mine_reserve_capacity: number | null }>(
    tx,
    'SELECT mine_reserve_remaining, mine_reserve_capacity FROM map_tiles WHERE id = $1',
    [building.tile_id],
  );
  if (!tile?.mine_reserve_capacity) return;

  const after = tile.mine_reserve_remaining ?? 0;
  const capacity = tile.mine_reserve_capacity;
  const ratioBefore = (after + consumed) / capacity;
  const ratioAfter = after / capacity;

  // Taper eşiğini bu tick'te geçtiyse haber ver — üretim artık düşmeye başladı.
  if (ratioBefore >= BALANCE.mine.taperThreshold && ratioAfter < BALANCE.mine.taperThreshold) {
    await notify(tx, {
      kingdomId,
      kind: 'world_event',
      severity: 'warning',
      title: 'Maden tükenmeye başladı',
      body:
        `Madenin rezervi %${Math.round(ratioAfter * 100)} seviyesine indi; üretim bu noktadan sonra ` +
        'doğrusal olarak düşecek. Yeni bir maden tile\'ı bulmayı ya da derin kazıyı değerlendirmeliyiz.',
      relatedId: building.id,
    });
  } else if (ratioBefore > 0 && ratioAfter <= 0) {
    await notify(tx, {
      kingdomId,
      kind: 'world_event',
      severity: 'critical',
      title: 'Maden tükendi',
      body:
        'Maden artık üretim yapmıyor. İki seçeneğimiz var: yeni bir maden tile\'ı bulup/fethedip ' +
        'oraya taşınmak, ya da derin kazı ile rezervi kısmen geri kazanmak.',
      relatedId: building.id,
    });
  }
  void remainingBefore;
}

/** Aşırı düşük popülerlikte isyan: rastgele bina hasarı ya da üretim durması. */
async function maybeRevolt(
  tx: Tx,
  kingdom: KingdomRow,
  buildings: BuildingInstanceRow[],
  popularity: number,
  hours: number,
): Promise<void> {
  const chance = revoltChance(popularity, hours);
  if (Math.random() >= chance) return;

  // Kale ve sur hedef alınmaz; isyan bir savaş değil, sivil huzursuzluk.
  const candidates = buildings.filter(
    (b) => b.level > 1 && b.type !== 'keep' && b.type !== 'wall',
  );
  if (candidates.length === 0) return;

  const victim = candidates[Math.floor(Math.random() * candidates.length)];
  if (!victim) return;

  await txQuery(tx, 'UPDATE building_instances SET level = GREATEST(1, level - 1) WHERE id = $1', [
    victim.id,
  ]);

  await notify(tx, {
    kingdomId: kingdom.id,
    kind: 'world_event',
    severity: 'critical',
    title: 'İsyan çıktı!',
    body:
      `Halk ayaklandı ve ${BUILDINGS[victim.type].nameTr} binasına zarar verdi (bir seviye düştü). ` +
      'Popülerlik acilen yükseltilmeli, yoksa bu tekrarlayacak.',
    relatedId: victim.id,
  });
}

/** Son 24 saatteki savaş sonuçları — popülerlik hesabına girer (§8.5). */
async function recentBattleOutcomes(
  tx: Tx,
  kingdomId: string,
): Promise<{ defeats: number; defenseVictories: number; attackVictories: number }> {
  const rows = await txQuery<{
    attacker_kingdom_id: string | null;
    defender_kingdom_id: string | null;
    attacker_won: boolean;
  }>(
    tx,
    `SELECT attacker_kingdom_id, defender_kingdom_id, attacker_won
       FROM battle_reports
      WHERE (attacker_kingdom_id = $1 OR defender_kingdom_id = $1)
        AND created_at > now() - INTERVAL '24 hours'
        AND mode <> 'siege_round'`,
    [kingdomId],
  );

  let defeats = 0;
  let defenseVictories = 0;
  let attackVictories = 0;

  for (const row of rows) {
    const wasAttacker = row.attacker_kingdom_id === kingdomId;
    if (wasAttacker) {
      if (row.attacker_won) attackVictories += 1;
      else defeats += 1;
    } else {
      if (row.attacker_won) defeats += 1;
      else defenseVictories += 1;
    }
  }

  return { defeats, defenseVictories, attackVictories };
}

async function isUnderSiege(tx: Tx, kingdomId: string): Promise<boolean> {
  const row = await txQueryOne<{ id: string }>(
    tx,
    `SELECT id FROM sieges WHERE defender_kingdom_id = $1 AND status = 'ongoing' LIMIT 1`,
    [kingdomId],
  );
  return row !== null;
}

/**
 * Anomali tespiti (§15.5): bir kaynak, mümkün olan üretim hızının çok üstünde
 * arttıysa işaretlenir. Otomatik bir ceza uygulanmaz — insan incelemesi için
 * kayıt düşülür, çünkü meşru sebepleri de olabilir (büyük bir fetih ganimeti).
 */
export async function flagResourceAnomalies(
  tx: Tx,
  kingdomId: string,
  before: Record<Resource, number>,
  after: Record<Resource, number>,
  maxExpectedPerHour: Record<Resource, number>,
  hours: number,
): Promise<void> {
  for (const [resource, afterValue] of Object.entries(after) as [Resource, number][]) {
    const delta = afterValue - (before[resource] ?? 0);
    const ceiling = (maxExpectedPerHour[resource] ?? 0) * hours;
    // 3× tolerans: yağma ve ticaret meşru sıçramalar yaratabilir.
    if (delta > Math.max(500, ceiling * 3)) {
      await txQuery(
        tx,
        `INSERT INTO anomaly_flags (kingdom_id, kind, detail) VALUES ($1, 'resource_spike', $2)`,
        [kingdomId, JSON.stringify({ resource, delta, ceiling, hours })],
      );
    }
  }
}
