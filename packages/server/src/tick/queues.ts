/**
 * Zaman damgalı kuyrukların çözümü — §15.3 adım 2 ve 4.
 *
 * Bu iş formül-tabanlı: LLM'den tamamen bağımsız çalışır. GDD §14.6'nın kritik
 * garantisi bu — oyuncunun API anahtarı geçersizse bile inşaat biter, eğitim
 * tamamlanır, kervan varır. General sessize düşer, krallık ölmez.
 */

import { BUILDINGS, UNITS, mineReserveCapacity, type Resource } from '@krallik/shared';
import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type { BuildingInstanceRow, CaravanRow, SpyMissionRow, TrainingQueueRow } from '../db/rows.js';
import { adjustReputation } from '../game/combat.js';
import { notify } from '../game/notifications.js';
import { grantResources } from '../game/resources.js';
import { addUnits, loadKingdomSnapshot, storageCapacityOf } from '../game/state.js';

/** Tamamlanma zamanı geçmiş bina yükseltmelerini uygular. */
export async function completeBuildings(tx: Tx, limit = 500): Promise<number> {
  const due = await txQuery<BuildingInstanceRow>(
    tx,
    `SELECT * FROM building_instances
      WHERE upgrade_completes_at IS NOT NULL AND upgrade_completes_at <= now()
      ORDER BY upgrade_completes_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const building of due) {
    const newLevel = building.upgrading_to_level ?? building.level + 1;
    await txQuery(
      tx,
      `UPDATE building_instances
          SET level = $2, upgrading_to_level = NULL,
              upgrade_started_at = NULL, upgrade_completes_at = NULL
        WHERE id = $1`,
      [building.id, newLevel],
    );

    // Maden yükseltildiğinde rezerv kapasitesi de büyür (§4.1): yeni kapasite
    // ile eski kapasite arasındaki fark rezerve eklenir.
    if (BUILDINGS[building.type].hasMineReserve && building.tile_id) {
      const capacity = mineReserveCapacity(newLevel);
      await txQuery(
        tx,
        `UPDATE map_tiles
            SET mine_reserve_capacity = $2,
                mine_reserve_remaining = COALESCE(mine_reserve_remaining, 0) + ($2 - COALESCE(mine_reserve_capacity, 0))
          WHERE id = $1`,
        [building.tile_id, capacity],
      );
    }

    await notify(tx, {
      kingdomId: building.kingdom_id,
      kind: 'world_event',
      title: 'İnşaat tamamlandı',
      body: `${BUILDINGS[building.type].nameTr} Sv.${newLevel} hazır.`,
      relatedId: building.id,
    });
  }

  return due.length;
}

/** Tamamlanan eğitimleri garnizona ekler. */
export async function completeTraining(tx: Tx, limit = 500): Promise<number> {
  const due = await txQuery<TrainingQueueRow>(
    tx,
    `SELECT * FROM training_queue
      WHERE completes_at <= now()
      ORDER BY completes_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const entry of due) {
    await addUnits(tx, entry.kingdom_id, { [entry.unit_type]: entry.count });
    await txQuery(tx, 'DELETE FROM training_queue WHERE id = $1', [entry.id]);

    await notify(tx, {
      kingdomId: entry.kingdom_id,
      kind: 'world_event',
      title: 'Eğitim tamamlandı',
      body: `${entry.count} ${UNITS[entry.unit_type].nameTr} garnizona katıldı.`,
    });
  }

  return due.length;
}

/**
 * Varan kervanları boşaltır (§9, §10.6).
 *
 * Kervan hedefi bir krallıksa doğrudan deposuna, değilse tile'daki stoğa
 * boşalır. Depo kapasitesi aşılırsa fazlası ziyan olur — depo yönetimi de
 * lojistiğin parçası.
 */
export async function completeCaravans(tx: Tx, limit = 500): Promise<number> {
  const due = await txQuery<CaravanRow>(
    tx,
    `SELECT * FROM caravans
      WHERE status = 'in_transit' AND arrives_at <= now()
      ORDER BY arrives_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const caravan of due) {
    const recipientId = caravan.target_kingdom_id;

    if (recipientId) {
      const snapshot = await loadKingdomSnapshot(recipientId, tx);
      if (snapshot && snapshot.kingdom.status === 'active') {
        const capacity = storageCapacityOf(snapshot);
        const current = Number(snapshot.kingdom[caravan.resource_type] ?? 0);
        const room =
          caravan.resource_type === 'gold'
            ? Number.POSITIVE_INFINITY
            : Math.max(0, capacity - current);
        const delivered = Math.min(caravan.amount, room);

        if (delivered > 0) {
          await grantResources(tx, recipientId, { [caravan.resource_type]: delivered });
        }

        await notify(tx, {
          kingdomId: recipientId,
          kind: 'caravan_arrived',
          title: 'Kervan ulaştı',
          body:
            `${Math.round(delivered)} ${resourceName(caravan.resource_type)} teslim alındı.` +
            (delivered < caravan.amount
              ? ` Ambar dolu olduğu için ${Math.round(caravan.amount - delivered)} birim ziyan oldu.`
              : ''),
          relatedId: caravan.id,
        });
      }
    } else if (caravan.target_tile_id) {
      // Hedef sahipsiz bir tile: kaynak orada birikir.
      await txQuery(
        tx,
        `INSERT INTO tile_stockpiles (tile_id, resource, amount)
         VALUES ($1, $2, $3)
         ON CONFLICT (tile_id, resource) DO UPDATE
           SET amount = tile_stockpiles.amount + $3, updated_at = now()`,
        [caravan.target_tile_id, caravan.resource_type, caravan.amount],
      );
    }

    await txQuery(tx, `UPDATE caravans SET status = 'delivered' WHERE id = $1`, [caravan.id]);

    // Tamamlanan ticaret teslimatı itibarı hafifçe yükseltir (§10.3 "adil ticaret").
    if (caravan.purpose === 'trade') {
      await adjustReputation(tx, caravan.kingdom_id, 0.5, 'ticaret teslimatı tamamlandı');
    }
  }

  return due.length;
}

/** Casus görevlerini çözer (§10.2). */
export async function completeSpyMissions(tx: Tx, limit = 200): Promise<number> {
  const due = await txQuery<SpyMissionRow>(
    tx,
    `SELECT * FROM spy_missions
      WHERE status = 'in_transit' AND resolves_at <= now()
      ORDER BY resolves_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const mission of due) {
    const target = await loadKingdomSnapshot(mission.target_kingdom_id, tx);
    if (!target) {
      await txQuery(tx, `UPDATE spy_missions SET status = 'failed' WHERE id = $1`, [mission.id]);
      continue;
    }

    // Karşı istihbarat: hedefin kendi casus sayısı yakalanma olasılığını artırır.
    const counterSpies = target.garrison.spy ?? 0;
    const catchChance = Math.min(0.65, 0.15 + counterSpies * 0.08);
    const caught = Math.random() < catchChance;

    if (caught) {
      await txQuery(
        tx,
        `UPDATE spy_missions SET status = 'caught', result = $2 WHERE id = $1`,
        [mission.id, JSON.stringify({ caught: true })],
      );
      // Yakalanmak itibarı düşürür — casusluk bedava değil.
      await adjustReputation(tx, mission.origin_kingdom_id, -6, 'casusumuz yakalandı');
      await notify(tx, {
        kingdomId: mission.origin_kingdom_id,
        kind: 'diplomacy',
        severity: 'warning',
        title: 'Casusumuz yakalandı',
        body: `${target.kingdom.name} casusumuzu ele geçirdi. İtibarımız zedelendi.`,
      });
      await notify(tx, {
        kingdomId: mission.target_kingdom_id,
        kind: 'diplomacy',
        severity: 'warning',
        title: 'Bir casus yakalandı',
        body: 'Topraklarımızda yabancı bir casus ele geçirildi.',
      });
      continue;
    }

    if (mission.mission === 'gather_intel') {
      const intel = {
        population: Math.round(target.kingdom.population),
        garrison: target.garrison,
        buildings: target.buildings.map((b) => ({ type: b.type, level: b.level })),
        resources: {
          gold: Math.round(target.kingdom.gold),
          food: Math.round(target.kingdom.food),
          iron: Math.round(target.kingdom.iron),
        },
      };
      await txQuery(
        tx,
        `UPDATE spy_missions SET status = 'succeeded', result = $2 WHERE id = $1`,
        [mission.id, JSON.stringify(intel)],
      );
      await notify(tx, {
        kingdomId: mission.origin_kingdom_id,
        kind: 'diplomacy',
        title: 'İstihbarat raporu geldi',
        body:
          `${target.kingdom.name}: nüfus ~${intel.population}, garnizonda ` +
          `${Object.values(target.garrison).reduce((s, v) => s + (v ?? 0), 0)} birlik, ` +
          `hazinede ~${intel.resources.gold} altın.`,
        payload: intel,
      });
    } else {
      // Sabotaj: rastgele bir üretim binasını bir seviye düşürür.
      const targets = target.buildings.filter(
        (b) => b.level > 1 && BUILDINGS[b.type].category === 'economy',
      );
      const victim = targets[Math.floor(Math.random() * targets.length)];
      if (victim) {
        await txQuery(
          tx,
          'UPDATE building_instances SET level = GREATEST(1, level - 1) WHERE id = $1',
          [victim.id],
        );
        await notify(tx, {
          kingdomId: mission.target_kingdom_id,
          kind: 'world_event',
          severity: 'warning',
          title: 'Sabotaj!',
          body: `${BUILDINGS[victim.type].nameTr} binamız sabote edildi ve bir seviye kaybetti.`,
        });
      }
      await txQuery(
        tx,
        `UPDATE spy_missions SET status = 'succeeded', result = $2 WHERE id = $1`,
        [mission.id, JSON.stringify({ sabotaged: victim?.type ?? null })],
      );
      await notify(tx, {
        kingdomId: mission.origin_kingdom_id,
        kind: 'diplomacy',
        title: 'Sabotaj başarılı',
        body: victim
          ? `${target.kingdom.name} krallığının ${BUILDINGS[victim.type].nameTr} binası sekteye uğratıldı.`
          : 'Casusumuz döndü ama hedefte sabote edilecek uygun bir bina bulamadı.',
      });
    }
  }

  return due.length;
}

function resourceName(resource: Resource): string {
  const labels: Record<Resource, string> = {
    gold: 'altın',
    food: 'yiyecek',
    stone: 'taş',
    wood: 'odun',
    iron: 'demir',
    ale: 'bira',
    wheat: 'buğday',
    flour: 'un',
    hops: 'şerbetçiotu',
    milk: 'süt',
    ore: 'ham cevher',
    weapons: 'silah/zırh',
    cheese: 'peynir',
  };
  return labels[resource];
}

export { resourceName };
