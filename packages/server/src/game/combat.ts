/**
 * Savaş çözümlemesi — GDD §8, §9, §12.
 *
 * İki ölçek var: küçük akın **tek tick'te anında**, büyük muharebe/kuşatma
 * **çok-tick'li** çözülür. Kuşatmanın çok-tick'li olması yalnızca bir tempo
 * tercihi değil; takviye penceresini (§8.2) mümkün kılan şey o. Savunanın
 * müttefiki, kendi sefer süresi kuşatma bitmeden yetişirse çatışmaya katılıp
 * dengeyi çevirebilir — mesafe böylece diplomasinin de para birimi oluyor.
 */

import {
  BALANCE,
  UNITS,
  addArmies,
  armyCarryCapacity,
  armyUnitCount,
  estimatedSiegeRounds,
  isSiegeEngagement,
  marchSeconds,
  normalizeArmy,
  resolveBattle,
  subtractArmies,
  tileDistance,
  wallIntegrity,
  type ArmyComposition,
  type Resource,
  type ResourceBundle,
  type Tactic,
  type UnitType,
} from '@krallik/shared';
import { config } from '../config.js';
import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type {
  ArmyRow,
  KingdomRow,
  MapTileRow,
  SiegeReinforcementRow,
  SiegeRow,
  TroopRentalRow,
} from '../db/rows.js';
import { notify, recordRegionActivity } from './notifications.js';
import { grantResources } from './resources.js';
import {
  addUnits,
  fortificationOf,
  ledgerOf,
  loadKingdomSnapshot,
  type KingdomSnapshot,
} from './state.js';

// ---------------------------------------------------------------------------
// Ordu varışı
// ---------------------------------------------------------------------------

/**
 * Varış zamanı gelmiş bir orduyu çözer (§15.3 adım 3).
 * Çağıran taraf krallık kilidini ve transaction'ı yönetir.
 */
export async function resolveArmyArrival(tx: Tx, army: ArmyRow): Promise<void> {
  const now = config.now();

  if (army.intent === 'return') {
    await completeReturn(tx, army);
    return;
  }

  const targetTile = army.target_tile_id
    ? await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [army.target_tile_id])
    : null;
  if (!targetTile) {
    // Hedef ortadan kalktıysa ordu geri döner; birlikleri kaybetmek haksızlık olurdu.
    await sendArmyHome(tx, army, {});
    return;
  }

  const attacker = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
    army.kingdom_id,
  ]);
  if (!attacker) return;

  switch (army.intent) {
    case 'scout':
      await resolveScout(tx, army, targetTile, attacker);
      return;
    case 'reinforce':
      await resolveReinforce(tx, army, targetTile, attacker, now);
      return;
    case 'raid':
    case 'attack':
      await resolveOffensive(tx, army, targetTile, attacker, now);
      return;
    default:
      await sendArmyHome(tx, army, {});
  }
}

/** Keşif: çatışma yok, istihbarat raporu döner, ordu geri gider. */
async function resolveScout(
  tx: Tx,
  army: ArmyRow,
  tile: MapTileRow,
  attacker: KingdomRow,
): Promise<void> {
  const owner = tile.owner_kingdom_id
    ? await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [tile.owner_kingdom_id])
    : null;

  let body: string;
  if (!owner) {
    body = `${tile.x},${tile.y} boş görünüyor. Arazi: ${tile.terrain_type}.`;
  } else {
    const snapshot = await loadKingdomSnapshot(owner.id, tx);
    const fort = snapshot ? fortificationOf(snapshot) : null;
    const garrisonSize = snapshot ? armyUnitCount(snapshot.garrison) : 0;
    body =
      `${owner.name} toprağı. Nüfus ~${Math.round(owner.population)}. ` +
      `Garnizonda kabaca ${garrisonSize} birlik görüldü. ` +
      (fort ? `Sur Sv.${fort.wallLevel}, Kale Sv.${fort.keepLevel}, ${fort.towerLevels.length} kule.` : '');
  }

  await notify(tx, {
    kingdomId: attacker.id,
    kind: 'battle_report',
    title: 'Keşif raporu',
    body,
    relatedId: army.id,
  });

  await sendArmyHome(tx, army, {});
}

/**
 * Takviye: hedef kendi toprağımız ya da müttefikimizse garnizona katılır.
 * Hedefte devam eden bir kuşatma varsa doğrudan ona katılır (§8.2).
 */
async function resolveReinforce(
  tx: Tx,
  army: ArmyRow,
  tile: MapTileRow,
  attacker: KingdomRow,
  now: Date,
): Promise<void> {
  const ownerId = tile.owner_kingdom_id;
  if (!ownerId) {
    await sendArmyHome(tx, army, {});
    return;
  }

  const allowed = ownerId === attacker.id || (await areAllied(tx, attacker.id, ownerId));
  if (!allowed) {
    await sendArmyHome(tx, army, {});
    await notify(tx, {
      kingdomId: attacker.id,
      kind: 'battle_report',
      severity: 'warning',
      title: 'Takviye reddedildi',
      body: 'Hedef krallıkla müttefik değiliz; birlikler geri dönüyor.',
      relatedId: army.id,
    });
    return;
  }

  const siege = await txQueryOne<SiegeRow>(
    tx,
    `SELECT * FROM sieges WHERE target_tile_id = $1 AND status = 'ongoing' FOR UPDATE`,
    [tile.id],
  );

  if (siege) {
    // Takviye penceresi açık: bu ordu bir sonraki round'dan itibaren savunmaya katılır.
    await txQuery(
      tx,
      `INSERT INTO siege_reinforcements (siege_id, army_id, kingdom_id, side, composition)
       VALUES ($1, $2, $3, 'defender', $4)`,
      [siege.id, army.id, attacker.id, JSON.stringify(army.composition)],
    );
    await txQuery(tx, `UPDATE armies SET status = 'besieging' WHERE id = $1`, [army.id]);

    await notify(tx, {
      kingdomId: siege.defender_kingdom_id,
      kind: 'siege_round',
      severity: 'info',
      title: 'Takviye yetişti',
      body: `${attacker.name} krallığından ${armyUnitCount(army.composition)} birlik kuşatma savunmasına katıldı.`,
      relatedId: siege.id,
    });

    // Yardıma gitmek itibarı yükseltir (§10.3).
    if (ownerId !== attacker.id) {
      await adjustReputation(tx, attacker.id, BALANCE.diplomacy.reputation.cameToAid, 'müttefikin yardımına gitti');
    }
    return;
  }

  // Kuşatma yoksa birlikler hedef krallığın garnizonuna katılır.
  await addUnits(tx, ownerId, army.composition);
  await txQuery(tx, `UPDATE armies SET status = 'disbanded' WHERE id = $1`, [army.id]);

  if (ownerId !== attacker.id) {
    await adjustReputation(tx, attacker.id, BALANCE.diplomacy.reputation.cameToAid, 'müttefike takviye gönderdi');
    await notify(tx, {
      kingdomId: ownerId,
      kind: 'diplomacy',
      title: 'Takviye geldi',
      body: `${attacker.name} krallığından ${armyUnitCount(army.composition)} birlik garnizonunuza katıldı.`,
    });
  }
  void now;
}

/** Saldırı ya da akın. Kuşatma eşiği aşılıyorsa çok-tick'li sürece dönüşür. */
async function resolveOffensive(
  tx: Tx,
  army: ArmyRow,
  tile: MapTileRow,
  attacker: KingdomRow,
  now: Date,
): Promise<void> {
  const defenderId = tile.owner_kingdom_id;

  // Sahipsiz tile: çatışma yok, doğrudan ele geçirilir (yalnızca `attack`).
  if (!defenderId) {
    if (army.intent === 'attack') {
      await txQuery(tx, 'UPDATE map_tiles SET owner_kingdom_id = $2 WHERE id = $1', [tile.id, attacker.id]);
      await txQuery(tx, 'UPDATE kingdoms SET tiles_conquered = tiles_conquered + 1 WHERE id = $1', [
        attacker.id,
      ]);
      await notify(tx, {
        kingdomId: attacker.id,
        kind: 'battle_report',
        title: 'Toprak ele geçirildi',
        body: `${tile.x},${tile.y} sahipsizdi; direnişle karşılaşmadan bayrağımızı diktik.`,
        relatedId: army.id,
      });
    }
    await sendArmyHome(tx, army, {});
    return;
  }

  const defenderSnapshot = await loadKingdomSnapshot(defenderId, tx);
  if (!defenderSnapshot) {
    await sendArmyHome(tx, army, {});
    return;
  }

  const fortification = tile.is_capital
    ? fortificationOf(defenderSnapshot)
    : // Sınır tile'ında kale/sur bonusu yok; yalnızca arazi savunuyor.
      { keepLevel: 0, wallLevel: 0, towerLevels: [], moatLevel: 0, gateLevel: 0 };

  const attackerArmy = normalizeArmy(army.composition);
  const defenderArmy = normalizeArmy(defenderSnapshot.garrison);

  const siegeMode = isSiegeEngagement({
    army: attackerArmy,
    wallLevel: fortification.wallLevel,
    intent: army.intent,
  });

  if (siegeMode) {
    await startSiege(tx, {
      army,
      attacker,
      defender: defenderSnapshot,
      tile,
      fortification,
      now,
    });
    return;
  }

  // --- Anlık akın (§8.1) -------------------------------------------------
  const attackerSnapshot = await loadKingdomSnapshot(attacker.id, tx);
  const outcome = resolveBattle({
    attacker: {
      army: attackerArmy,
      tactic: army.tactic,
      popularity: attacker.popularity,
      chapelLevels: attackerSnapshot ? levelsOf(attackerSnapshot, 'chapel') : [],
      distanceTiles: army.distance_tiles,
    },
    defender: {
      army: defenderArmy,
      tactic: 'frontal',
      popularity: defenderSnapshot.kingdom.popularity,
      chapelLevels: levelsOf(defenderSnapshot, 'chapel'),
    },
    terrain: tile.terrain_type,
    fortification: tile.is_capital ? fortification : undefined,
    mode: 'raid',
    defenderStock: ledgerOf(defenderSnapshot.kingdom),
  });

  await applyDefenderCasualties(tx, defenderSnapshot, outcome.casualties.defender);

  const survivors = subtractArmies(attackerArmy, outcome.casualties.attacker);

  // Yağma: kazanan taraf, taşıma kapasitesi kadarını alır.
  let plunder: ResourceBundle = {};
  if (outcome.attackerWon && Object.keys(outcome.plunder).length > 0) {
    plunder = capPlunderToCapacity(outcome.plunder, armyCarryCapacity(survivors));
    for (const [resource, amount] of Object.entries(plunder) as [Resource, number][]) {
      await txQuery(
        tx,
        `UPDATE kingdoms SET ${resource} = GREATEST(0, ${resource} - $2) WHERE id = $1`,
        [defenderId, amount],
      );
    }
  }

  // `attack` niyetiyle kazanılan sınır tile'ı el değiştirir (§8.5).
  let tileCaptured = false;
  if (outcome.attackerWon && army.intent === 'attack' && !tile.is_capital) {
    await txQuery(tx, 'UPDATE map_tiles SET owner_kingdom_id = $2 WHERE id = $1', [tile.id, attacker.id]);
    await txQuery(tx, 'UPDATE kingdoms SET tiles_conquered = tiles_conquered + 1 WHERE id = $1', [
      attacker.id,
    ]);
    tileCaptured = true;
  }

  const narrative = buildNarrative({
    attackerName: attacker.name,
    defenderName: defenderSnapshot.kingdom.name,
    outcome,
    mode: 'raid',
    tileCaptured,
  });

  await writeBattleReport(tx, {
    channelId: army.channel_id,
    attackerKingdomId: attacker.id,
    defenderKingdomId: defenderId,
    tileId: tile.id,
    siegeId: null,
    intent: army.intent,
    mode: 'raid',
    outcome,
    plunder,
    wallIntegrityAfter: null,
    capitalFell: false,
    narrative,
  });

  await notifyBothSides(tx, {
    attackerId: attacker.id,
    defenderId,
    attackerName: attacker.name,
    defenderName: defenderSnapshot.kingdom.name,
    narrative,
    armyId: army.id,
  });

  await recordRegionActivity(tx, {
    channelId: army.channel_id,
    originX: tile.x,
    originY: tile.y,
    severity: 'routine',
    summary: narrative,
    relatedKingdomIds: [attacker.id, defenderId],
  });

  await sendArmyHome(tx, { ...army, composition: survivors }, plunder);
}

// ---------------------------------------------------------------------------
// Kuşatma
// ---------------------------------------------------------------------------

async function startSiege(
  tx: Tx,
  params: {
    army: ArmyRow;
    attacker: KingdomRow;
    defender: KingdomSnapshot;
    tile: MapTileRow;
    fortification: ReturnType<typeof fortificationOf>;
    now: Date;
  },
): Promise<void> {
  const { army, attacker, defender, tile, fortification, now } = params;

  const integrity = Math.max(1, wallIntegrity(fortification));
  const estimated = estimatedSiegeRounds({
    army: normalizeArmy(army.composition),
    fortification,
    terrain: tile.terrain_type,
  });

  const nextRoundAt = new Date(now.getTime() + BALANCE.combat.siegeRoundIntervalSeconds * 1000);

  const siege = await txQueryOne<{ id: string }>(
    tx,
    `INSERT INTO sieges
       (channel_id, army_id, attacker_kingdom_id, defender_kingdom_id, target_tile_id,
        max_rounds, wall_integrity, wall_integrity_max, next_round_at, attacker_tactic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)
     RETURNING id`,
    [
      army.channel_id,
      army.id,
      attacker.id,
      defender.kingdom.id,
      tile.id,
      BALANCE.combat.siegeMaxRounds,
      integrity,
      nextRoundAt,
      army.tactic,
    ],
  );

  await txQuery(tx, `UPDATE armies SET status = 'besieging' WHERE id = $1`, [army.id]);

  // Kuşatma birimi olmayan ordu için erken uyarı: tahmini round sayısı üst
  // sınırı aşıyorsa kuşatma büyük ihtimalle başarısız olacak (§8.2).
  const hopeless = estimated > BALANCE.combat.siegeMaxRounds;
  await notify(tx, {
    kingdomId: attacker.id,
    kind: 'siege_round',
    severity: hopeless ? 'warning' : 'info',
    title: 'Kuşatma başladı',
    body: hopeless
      ? `${defender.kingdom.name} kuşatma altına alındı, ancak surları bu orduyla kırmamız ` +
        `tahminen ${estimated === Number.POSITIVE_INFINITY ? 'imkânsız' : `${estimated} round`} sürer — ` +
        `${BALANCE.combat.siegeMaxRounds} round sınırını aşıyor. Kuşatma makinesi olmadan geri çekilmek zorunda kalabiliriz.`
      : `${defender.kingdom.name} kuşatma altına alındı. Surların düşmesi tahminen ${estimated} round sürecek.`,
    relatedId: siege?.id ?? null,
  });

  await notify(tx, {
    kingdomId: defender.kingdom.id,
    kind: 'siege_round',
    severity: 'critical',
    title: 'Kuşatma altındayız!',
    body:
      `${attacker.name} surlarımızın önünde. Kuşatma her ${BALANCE.combat.siegeRoundIntervalSeconds / 3600} saatte ` +
      'bir round ilerleyecek. Müttefiklerinizden takviye isteyebilir, taktik değiştirebilirsiniz.',
    relatedId: siege?.id ?? null,
  });

  await recordRegionActivity(tx, {
    channelId: army.channel_id,
    originX: tile.x,
    originY: tile.y,
    severity: 'major',
    summary: `${attacker.name}, ${defender.kingdom.name} krallığını kuşatma altına aldı.`,
    relatedKingdomIds: [attacker.id, defender.kingdom.id],
  });
}

/** Bir kuşatma round'unu çözer (§8.2). */
export async function resolveSiegeRound(tx: Tx, siege: SiegeRow): Promise<void> {
  const now = config.now();

  const army = await txQueryOne<ArmyRow>(tx, 'SELECT * FROM armies WHERE id = $1', [siege.army_id]);
  const tile = await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [
    siege.target_tile_id,
  ]);
  const attackerSnapshot = await loadKingdomSnapshot(siege.attacker_kingdom_id, tx);
  const defenderSnapshot = await loadKingdomSnapshot(siege.defender_kingdom_id, tx);

  if (!army || !tile || !attackerSnapshot || !defenderSnapshot) {
    await closeSiege(tx, siege, 'withdrawn', 'Kuşatma çözülemedi; taraflardan biri ortadan kalktı.');
    return;
  }

  // Takviyeler her round yeniden toplanır — geç yetişen bir müttefik sonraki
  // round'dan itibaren dengeyi değiştirebilir.
  const reinforcements = await txQuery<SiegeReinforcementRow>(
    tx,
    'SELECT * FROM siege_reinforcements WHERE siege_id = $1',
    [siege.id],
  );

  let attackerArmy = normalizeArmy(army.composition);
  let defenderArmy = normalizeArmy(defenderSnapshot.garrison);
  for (const r of reinforcements) {
    if (r.side === 'attacker') attackerArmy = addArmies(attackerArmy, r.composition);
    else defenderArmy = addArmies(defenderArmy, r.composition);
  }

  if (armyUnitCount(attackerArmy) === 0) {
    await closeSiege(tx, siege, 'defender_won', 'Kuşatan ordu tamamen eridi.');
    await finishSiegeArmies(tx, siege, {});
    return;
  }

  const fortification = {
    ...fortificationOf(defenderSnapshot),
    // Sur bütünlüğü aşındıkça savunma bonusu da düşer.
    wallLevel: Math.max(
      0,
      Math.round(
        fortificationOf(defenderSnapshot).wallLevel *
          (siege.wall_integrity / Math.max(1, siege.wall_integrity_max)),
      ),
    ),
  };

  const outcome = resolveBattle({
    attacker: {
      army: attackerArmy,
      tactic: siege.attacker_tactic,
      popularity: attackerSnapshot.kingdom.popularity,
      chapelLevels: levelsOf(attackerSnapshot, 'chapel'),
      distanceTiles: army.distance_tiles,
    },
    defender: {
      army: defenderArmy,
      tactic: siege.defender_tactic,
      popularity: defenderSnapshot.kingdom.popularity,
      chapelLevels: levelsOf(defenderSnapshot, 'chapel'),
    },
    terrain: tile.terrain_type,
    fortification,
    mode: 'siege_round',
    defenderStock: ledgerOf(defenderSnapshot.kingdom),
  });

  // Kayıpları uygula.
  await applyDefenderCasualties(tx, defenderSnapshot, outcome.casualties.defender);
  const survivingAttackers = subtractArmies(attackerArmy, outcome.casualties.attacker);

  // Takviye orduları kendi paylarına düşen kaybı alır; sadeleştirme için
  // saldıran tarafın kayıpları ana orduya yazılır.
  const mainArmyAfter = subtractArmies(normalizeArmy(army.composition), outcome.casualties.attacker);
  await txQuery(tx, 'UPDATE armies SET composition = $2 WHERE id = $1', [
    army.id,
    JSON.stringify(mainArmyAfter),
  ]);

  const newIntegrity = Math.max(0, siege.wall_integrity - outcome.wallDamage);
  const round = siege.current_round + 1;

  const narrative = buildNarrative({
    attackerName: attackerSnapshot.kingdom.name,
    defenderName: defenderSnapshot.kingdom.name,
    outcome,
    mode: 'siege_round',
    round,
    wallIntegrityRatio: newIntegrity / Math.max(1, siege.wall_integrity_max),
  });

  await writeBattleReport(tx, {
    channelId: siege.channel_id,
    attackerKingdomId: siege.attacker_kingdom_id,
    defenderKingdomId: siege.defender_kingdom_id,
    tileId: tile.id,
    siegeId: siege.id,
    intent: 'attack',
    mode: 'siege_round',
    outcome,
    plunder: {},
    wallIntegrityAfter: newIntegrity,
    capitalFell: false,
    narrative,
  });

  await notifyBothSides(tx, {
    attackerId: siege.attacker_kingdom_id,
    defenderId: siege.defender_kingdom_id,
    attackerName: attackerSnapshot.kingdom.name,
    defenderName: defenderSnapshot.kingdom.name,
    narrative,
    armyId: siege.id,
    kind: 'siege_round',
  });

  // --- Sonuç kontrolü ---------------------------------------------------
  if (newIntegrity <= 0) {
    await txQuery(
      tx,
      'UPDATE sieges SET wall_integrity = 0, current_round = $2 WHERE id = $1',
      [siege.id, round],
    );
    await closeSiege(tx, siege, 'attacker_won', 'Surlar düştü.');
    await resolveConquest(tx, {
      siege,
      tile,
      attacker: attackerSnapshot,
      defender: defenderSnapshot,
      survivingAttackers,
    });
    return;
  }

  if (armyUnitCount(survivingAttackers) === 0) {
    await closeSiege(tx, siege, 'defender_won', 'Kuşatan ordu yok edildi.');
    await finishSiegeArmies(tx, siege, {});
    await onDefenseVictory(tx, siege.defender_kingdom_id);
    return;
  }

  if (round >= siege.max_rounds) {
    // Kuşatma birimi olmayan ordu yüksek seviyeli suru süre içinde düşüremedi:
    // "başarısız kuşatma" sonucu, saldıran geri çekilir (§8.2).
    await closeSiege(tx, siege, 'withdrawn', 'Kuşatma süresi doldu; saldırgan geri çekildi.');
    await finishSiegeArmies(tx, siege, {});
    await onDefenseVictory(tx, siege.defender_kingdom_id);
    await notify(tx, {
      kingdomId: siege.attacker_kingdom_id,
      kind: 'siege_round',
      severity: 'warning',
      title: 'Kuşatma başarısız',
      body:
        `${siege.max_rounds} round sonunda surları kıramadık; ordu geri çekiliyor. ` +
        'Bir dahaki sefere mancınık ya da trebuşet götürmeden bu kaleyi zorlamak anlamsız.',
      relatedId: siege.id,
    });
    return;
  }

  await txQuery(
    tx,
    'UPDATE sieges SET current_round = $2, wall_integrity = $3, next_round_at = $4 WHERE id = $1',
    [
      siege.id,
      round,
      newIntegrity,
      new Date(now.getTime() + BALANCE.combat.siegeRoundIntervalSeconds * 1000),
    ],
  );
}

/**
 * Fetih — GDD §12 ve §9'un istisnası.
 *
 * Başkent düşerse krallık dağılır ve "bekleyen bir sahip" kalmadığı için kalan
 * tüm kaynaklar **tek seferde** fatihe geçer; kervan gerekmez. Sınır tile'ı
 * düştüğünde ise kaynaklar tile'da birikir ve kervanla taşınması gerekir.
 */
async function resolveConquest(
  tx: Tx,
  params: {
    siege: SiegeRow;
    tile: MapTileRow;
    attacker: KingdomSnapshot;
    defender: KingdomSnapshot;
    survivingAttackers: ArmyComposition;
  },
): Promise<void> {
  const { siege, tile, attacker, defender, survivingAttackers } = params;

  if (!tile.is_capital) {
    // Sınır tile'ı el değiştirdi. Savaştan sağ kalan erzak fatihin malı sayılır
    // ama otomatik ışınlanmaz — tile'da birikir (§9).
    await txQuery(tx, 'UPDATE map_tiles SET owner_kingdom_id = $2 WHERE id = $1', [
      tile.id,
      attacker.kingdom.id,
    ]);
    await txQuery(tx, 'UPDATE kingdoms SET tiles_conquered = tiles_conquered + 1 WHERE id = $1', [
      attacker.kingdom.id,
    ]);

    await notify(tx, {
      kingdomId: attacker.kingdom.id,
      kind: 'conquest',
      title: 'Bölge ele geçirildi',
      body:
        `${tile.x},${tile.y} artık bizim. Bölgede kalan kaynaklar orada duruyor — ` +
        'ana krallığa taşımak için nakliye kervanı göndermeliyiz.',
      relatedId: tile.id,
    });

    await finishSiegeArmies(tx, siege, {});
    return;
  }

  // --- Başkent düştü: krallık dağılır ---------------------------------
  const spoils = ledgerOf(defender.kingdom);
  await grantResources(tx, attacker.kingdom.id, spoils as ResourceBundle);

  // Fethedilen krallığın deposu boşaltılır.
  await txQuery(
    tx,
    `UPDATE kingdoms SET gold=0, food=0, stone=0, wood=0, iron=0, ale=0,
       wheat=0, flour=0, hops=0, milk=0, ore=0, weapons=0, cheese=0,
       status='fallen', fell_at=now(), conquered_by_kingdom_id=$2
     WHERE id = $1`,
    [defender.kingdom.id, attacker.kingdom.id],
  );

  // Tüm toprakları fatihe geçer.
  const captured = await txQuery<{ id: string }>(
    tx,
    'UPDATE map_tiles SET owner_kingdom_id = $2, is_capital = FALSE WHERE owner_kingdom_id = $1 RETURNING id',
    [defender.kingdom.id, attacker.kingdom.id],
  );

  await txQuery(
    tx,
    'UPDATE kingdoms SET tiles_conquered = tiles_conquered + $2 WHERE id = $1',
    [attacker.kingdom.id, captured.length],
  );
  await txQuery(
    tx,
    `UPDATE user_profiles SET total_kingdoms_conquered = total_kingdoms_conquered + 1, updated_at = now()
      WHERE user_id = $1`,
    [attacker.kingdom.user_id],
  );

  // Vasallık ve ticaret ilişkileri sona erer.
  await txQuery(
    tx,
    `UPDATE protection_relationships SET status = 'ended', ended_at = now()
      WHERE (vassal_kingdom_id = $1 OR protector_kingdom_id = $1) AND status = 'active'`,
    [defender.kingdom.id],
  );
  await txQuery(
    tx,
    `UPDATE trade_agreements SET status = 'cancelled', ended_at = now()
      WHERE (kingdom_a_id = $1 OR kingdom_b_id = $1) AND status = 'active'`,
    [defender.kingdom.id],
  );

  const narrative =
    `${attacker.kingdom.name} orduları ${defender.kingdom.name} başkentinin surlarını yıktı. ` +
    `Krallık dağıldı; ${captured.length} tile ve hazinede kalan her şey fatihin oldu.`;

  await writeBattleReport(tx, {
    channelId: siege.channel_id,
    attackerKingdomId: attacker.kingdom.id,
    defenderKingdomId: defender.kingdom.id,
    tileId: tile.id,
    siegeId: siege.id,
    intent: 'attack',
    mode: 'siege_final',
    outcome: {
      attackPower: 0,
      defensePower: 0,
      attackerShare: 1,
      attackerWon: true,
      casualties: { attacker: {}, defender: {} },
      plunder: spoils as ResourceBundle,
      wallDamage: 0,
    },
    plunder: spoils as ResourceBundle,
    wallIntegrityAfter: 0,
    capitalFell: true,
    narrative,
  });

  // §12: oyuncu önce son savaş raporunu görür, sonra KENDİSİ seçer —
  // izleyici kalmak ya da mülteci krallığı olarak yeniden başlamak.
  // Bu otomatik değil; bu yüzden burada yalnızca bildirim gönderiliyor.
  await notify(tx, {
    kingdomId: defender.kingdom.id,
    kind: 'conquest',
    severity: 'critical',
    title: 'Başkentiniz düştü',
    body:
      `${attacker.kingdom.name} başkentinizi ele geçirdi. Son savaş raporunu inceleyin, ` +
      'ardından izleyici olarak kalmayı ya da haritanın tarafsız bir köşesinde mülteci krallığı olarak yeniden başlamayı seçebilirsiniz.',
    relatedId: siege.id,
  });

  await notify(tx, {
    kingdomId: attacker.kingdom.id,
    kind: 'conquest',
    severity: 'info',
    title: 'Zafer! Bir krallık fethedildi',
    body: narrative,
    relatedId: siege.id,
  });

  await recordRegionActivity(tx, {
    channelId: siege.channel_id,
    originX: tile.x,
    originY: tile.y,
    severity: 'major',
    summary: narrative,
    relatedKingdomIds: [attacker.kingdom.id, defender.kingdom.id],
  });

  await finishSiegeArmies(tx, siege, {});
  void survivingAttackers;
}

async function closeSiege(
  tx: Tx,
  siege: SiegeRow,
  status: 'attacker_won' | 'defender_won' | 'withdrawn',
  note: string,
): Promise<void> {
  await txQuery(tx, `UPDATE sieges SET status = $2, resolved_at = now() WHERE id = $1`, [
    siege.id,
    status,
  ]);
  void note;
}

/** Kuşatma bitince ilgili orduları evine yollar. */
async function finishSiegeArmies(
  tx: Tx,
  siege: SiegeRow,
  plunder: ResourceBundle,
): Promise<void> {
  const army = await txQueryOne<ArmyRow>(tx, 'SELECT * FROM armies WHERE id = $1', [siege.army_id]);
  if (army) await sendArmyHome(tx, army, plunder);

  const reinforcements = await txQuery<SiegeReinforcementRow>(
    tx,
    'SELECT * FROM siege_reinforcements WHERE siege_id = $1',
    [siege.id],
  );
  for (const r of reinforcements) {
    const reinforcingArmy = await txQueryOne<ArmyRow>(tx, 'SELECT * FROM armies WHERE id = $1', [
      r.army_id,
    ]);
    if (reinforcingArmy) await sendArmyHome(tx, reinforcingArmy, {});
  }
  await txQuery(tx, 'DELETE FROM siege_reinforcements WHERE siege_id = $1', [siege.id]);
}

// ---------------------------------------------------------------------------
// Ordu dönüşü
// ---------------------------------------------------------------------------

/** Orduyu geri yola çıkarır (yağma yükünü taşıyarak). */
async function sendArmyHome(
  tx: Tx,
  army: ArmyRow,
  plunder: ResourceBundle,
): Promise<void> {
  const composition = normalizeArmy(army.composition);

  if (armyUnitCount(composition) === 0) {
    // Ordu yok oldu; taşıdığı yağma da kayboldu.
    await txQuery(tx, `UPDATE armies SET status = 'disbanded', composition = '{}'::jsonb WHERE id = $1`, [
      army.id,
    ]);
    return;
  }

  const originTile = army.origin_tile_id
    ? await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [army.origin_tile_id])
    : null;
  const currentTile = army.target_tile_id
    ? await txQueryOne<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = $1', [army.target_tile_id])
    : null;

  const distance =
    originTile && currentTile ? tileDistance(originTile, currentTile) : army.distance_tiles;
  const seconds = marchSeconds(
    composition,
    distance,
    originTile?.terrain_type ?? 'plains',
  );

  const carried = { ...(army.carried_resources ?? {}) } as ResourceBundle;
  for (const [resource, amount] of Object.entries(plunder) as [Resource, number][]) {
    carried[resource] = (carried[resource] ?? 0) + amount;
  }

  await txQuery(
    tx,
    `UPDATE armies
        SET status = 'returning', intent = 'return', composition = $2,
            target_tile_id = origin_tile_id, origin_tile_id = $3,
            departs_at = now(), arrives_at = $4, carried_resources = $5,
            distance_tiles = $6
      WHERE id = $1`,
    [
      army.id,
      JSON.stringify(composition),
      army.target_tile_id,
      new Date(config.now().getTime() + seconds * 1000),
      JSON.stringify(carried),
      distance,
    ],
  );
}

/** Dönen ordu: birlikler garnizona, yağma depoya. */
async function completeReturn(tx: Tx, army: ArmyRow): Promise<void> {
  const composition = normalizeArmy(army.composition);
  if (armyUnitCount(composition) > 0) {
    await addUnits(tx, army.kingdom_id, composition);
  }

  const carried = (army.carried_resources ?? {}) as ResourceBundle;
  if (Object.keys(carried).length > 0) {
    await grantResources(tx, army.kingdom_id, carried);
    await notify(tx, {
      kingdomId: army.kingdom_id,
      kind: 'battle_report',
      title: 'Ordu döndü',
      body: `Birliklerimiz ganimetle döndü: ${describePlunder(carried)}.`,
      relatedId: army.id,
    });
  }

  await txQuery(tx, `UPDATE armies SET status = 'disbanded' WHERE id = $1`, [army.id]);
}

// ---------------------------------------------------------------------------
// Kayıp uygulaması
// ---------------------------------------------------------------------------

/**
 * Savunanın kayıplarını uygular.
 *
 * Kritik ayrıntı (§10.5): kiralanan birlikler kiracıyı savunurken ölürse
 * **kalıcı olarak kaybolur ve kiracı tazminat ödemez** — kiralayanın bilerek
 * aldığı risktir. Bu yüzden kayıp önce kiralık birliklerden düşülür ve
 * `troop_rentals.count_lost` artırılır; böylece süre sonunda yalnızca sağ
 * kalanlar geri döner.
 */
async function applyDefenderCasualties(
  tx: Tx,
  defender: KingdomSnapshot,
  losses: ArmyComposition,
): Promise<void> {
  for (const [type, lostCount] of Object.entries(losses) as [UnitType, number][]) {
    if (!lostCount || lostCount <= 0) continue;
    let remaining = lostCount;

    // Önce kiralanan birliklerden düş.
    const rentals = defender.rentedIn.filter((r) => r.unit_type === type);
    for (const rental of rentals) {
      if (remaining <= 0) break;
      const alive = rental.count - rental.count_lost;
      if (alive <= 0) continue;
      const take = Math.min(alive, remaining);
      remaining -= take;
      await txQuery(
        tx,
        'UPDATE troop_rentals SET count_lost = count_lost + $2 WHERE id = $1',
        [rental.id, take],
      );
      await notifyRentalLoss(tx, rental, take);
    }

    if (remaining > 0) {
      await txQuery(
        tx,
        `UPDATE unit_stocks SET count = GREATEST(0, count - $3)
          WHERE kingdom_id = $1 AND unit_type = $2`,
        [defender.kingdom.id, type, remaining],
      );
    }
  }
}

async function notifyRentalLoss(tx: Tx, rental: TroopRentalRow, lost: number): Promise<void> {
  await notify(tx, {
    kingdomId: rental.lender_kingdom_id,
    kind: 'battle_report',
    severity: 'warning',
    title: 'Kiraladığınız birlikler kayıp verdi',
    body:
      `Kiraya verdiğiniz ${UNITS[rental.unit_type].nameTr} birliklerinden ${lost} tanesi ` +
      'savunma sırasında öldü. Bu birlikler kalıcı olarak kayboldu; tazminat ödenmiyor.',
    relatedId: rental.id,
  });
}

/** Taşıma kapasitesini aşan yağmayı orantılı olarak kırpar. */
function capPlunderToCapacity(plunder: ResourceBundle, capacity: number): ResourceBundle {
  const total = Object.values(plunder).reduce((s, v) => s + (v ?? 0), 0);
  if (total <= capacity || total <= 0) return plunder;
  const ratio = capacity / total;
  const out: ResourceBundle = {};
  for (const [resource, amount] of Object.entries(plunder) as [Resource, number][]) {
    const take = Math.floor((amount ?? 0) * ratio);
    if (take > 0) out[resource] = take;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function levelsOf(snapshot: KingdomSnapshot, type: string): number[] {
  return snapshot.buildings.filter((b) => b.type === type && b.level > 0).map((b) => b.level);
}

async function areAllied(tx: Tx, a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const relation = await txQueryOne<{ state: string }>(
    tx,
    'SELECT state FROM kingdom_relations WHERE kingdom_a_id = $1 AND kingdom_b_id = $2',
    [low, high],
  );
  if (relation && (relation.state === 'ally' || relation.state === 'vassal' || relation.state === 'protector')) {
    return true;
  }
  // Aynı ittifakın üyeleri de müttefiktir.
  const rows = await txQuery<{ alliance_id: string | null }>(
    tx,
    'SELECT alliance_id FROM kingdoms WHERE id = ANY($1::uuid[])',
    [[a, b]],
  );
  const ids = rows.map((r) => r.alliance_id);
  return ids.length === 2 && ids[0] !== null && ids[0] === ids[1];
}

export async function adjustReputation(
  tx: Tx,
  kingdomId: string,
  delta: number,
  reason: string,
): Promise<void> {
  await txQuery(
    tx,
    'UPDATE kingdoms SET reputation = LEAST(100, GREATEST(0, reputation + $2)) WHERE id = $1',
    [kingdomId, delta],
  );
  if (Math.abs(delta) >= 5) {
    await notify(tx, {
      kingdomId,
      kind: 'diplomacy',
      severity: delta < 0 ? 'warning' : 'info',
      title: delta < 0 ? 'İtibarımız zedelendi' : 'İtibarımız yükseldi',
      body: `${reason} (${delta > 0 ? '+' : ''}${delta.toFixed(0)} itibar).`,
    });
  }
}

/** Savunma zaferi popülerliği yükseltir (§8.5). */
async function onDefenseVictory(tx: Tx, kingdomId: string): Promise<void> {
  await txQuery(
    tx,
    'UPDATE kingdoms SET popularity = LEAST(100, popularity + $2) WHERE id = $1',
    [kingdomId, BALANCE.popularity.defenseVictoryBonus],
  );
}

interface WriteReportInput {
  channelId: string;
  attackerKingdomId: string;
  defenderKingdomId: string;
  tileId: string;
  siegeId: string | null;
  intent: string;
  mode: 'raid' | 'siege_round' | 'siege_final';
  outcome: ReturnType<typeof resolveBattle>;
  plunder: ResourceBundle;
  wallIntegrityAfter: number | null;
  capitalFell: boolean;
  narrative: string;
}

async function writeBattleReport(tx: Tx, input: WriteReportInput): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO battle_reports
       (channel_id, attacker_kingdom_id, defender_kingdom_id, tile_id, siege_id, intent, mode,
        attacker_won, attack_power, defense_power, attacker_losses, defender_losses, plunder,
        wall_damage, wall_integrity_after, capital_fell, narrative)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      input.channelId,
      input.attackerKingdomId,
      input.defenderKingdomId,
      input.tileId,
      input.siegeId,
      input.intent,
      input.mode,
      input.outcome.attackerWon,
      Math.round(input.outcome.attackPower),
      Math.round(input.outcome.defensePower),
      JSON.stringify(input.outcome.casualties.attacker),
      JSON.stringify(input.outcome.casualties.defender),
      JSON.stringify(input.plunder),
      Math.round(input.outcome.wallDamage),
      input.wallIntegrityAfter,
      input.capitalFell,
      input.narrative,
    ],
  );
}

async function notifyBothSides(
  tx: Tx,
  params: {
    attackerId: string;
    defenderId: string;
    attackerName: string;
    defenderName: string;
    narrative: string;
    armyId: string;
    kind?: 'battle_report' | 'siege_round';
  },
): Promise<void> {
  const kind = params.kind ?? 'battle_report';
  // Sonuç her iki oyuncuya da bir savaş raporu (Haberci Ruloları) olarak bildirilir (§8.5).
  await notify(tx, {
    kingdomId: params.attackerId,
    kind,
    title: 'Savaş raporu',
    body: params.narrative,
    relatedId: params.armyId,
  });
  await notify(tx, {
    kingdomId: params.defenderId,
    kind,
    severity: 'warning',
    title: 'Savaş raporu',
    body: params.narrative,
    relatedId: params.armyId,
  });
}

function buildNarrative(params: {
  attackerName: string;
  defenderName: string;
  outcome: ReturnType<typeof resolveBattle>;
  mode: 'raid' | 'siege_round';
  round?: number;
  wallIntegrityRatio?: number;
  tileCaptured?: boolean;
}): string {
  const { attackerName, defenderName, outcome } = params;
  const attackerLost = Object.values(outcome.casualties.attacker).reduce((s, v) => s + (v ?? 0), 0);
  const defenderLost = Object.values(outcome.casualties.defender).reduce((s, v) => s + (v ?? 0), 0);

  if (params.mode === 'siege_round') {
    const wallPct = Math.round((params.wallIntegrityRatio ?? 0) * 100);
    return (
      `Kuşatma ${params.round}. round: ${attackerName} ${attackerLost} birlik, ` +
      `${defenderName} ${defenderLost} birlik kaybetti. Surların dayanıklılığı %${wallPct} seviyesinde.`
    );
  }

  const verdict = outcome.attackerWon
    ? `${attackerName} üstünlük kurdu`
    : `${defenderName} saldırıyı püskürttü`;
  const plunderNote =
    Object.keys(outcome.plunder).length > 0 ? ` Ganimet: ${describePlunder(outcome.plunder)}.` : '';
  const captureNote = params.tileCaptured ? ' Sınır tile el değiştirdi.' : '';

  return (
    `${attackerName} ile ${defenderName} arasında çarpışma: ${verdict}. ` +
    `Kayıplar — saldıran ${attackerLost}, savunan ${defenderLost}.${plunderNote}${captureNote}`
  );
}

function describePlunder(bundle: ResourceBundle): string {
  const labels: Partial<Record<Resource, string>> = {
    gold: 'altın',
    food: 'yiyecek',
    stone: 'taş',
    wood: 'odun',
    iron: 'demir',
    ale: 'bira',
  };
  const parts: string[] = [];
  for (const [resource, amount] of Object.entries(bundle) as [Resource, number][]) {
    if (amount && amount > 0) {
      parts.push(`${Math.round(amount)} ${labels[resource] ?? resource}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'yok';
}

export { describePlunder };
export type { Tactic };
