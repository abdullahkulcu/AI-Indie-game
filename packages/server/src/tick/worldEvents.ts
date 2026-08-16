/**
 * Rastgele dünya olayları — GDD §11.
 *
 * Kritik nokta: bu olaylar **pasif modda bile** işler. Oyuncu hiç giriş
 * yapmasa bile dünya durağan hissetmesin diye olay tetikleyicisi tick
 * servisinde, LLM'den bağımsız çalışır; General'ın rolü olaya *tepki vermek*,
 * olayı üretmek değil.
 */

import { BALANCE, armyUnitCount, resolveBattle, type WorldEventType } from '@krallik/shared';
import { config } from '../config.js';
import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type { KingdomRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';
import { fortificationOf, loadKingdomSnapshot } from '../game/state.js';

interface EventDefinition {
  type: WorldEventType;
  titleTr: string;
  weight: number;
}

const EVENT_TABLE: EventDefinition[] = [
  { type: 'bountiful_harvest', titleTr: 'Bereketli Hasat', weight: BALANCE.worldEvents.weights.bountiful_harvest },
  { type: 'plague', titleTr: 'Veba', weight: BALANCE.worldEvents.weights.plague },
  { type: 'bandit_raid', titleTr: 'Haydut Baskını', weight: BALANCE.worldEvents.weights.bandit_raid },
  { type: 'traveling_merchant', titleTr: 'Gezgin Tüccar', weight: BALANCE.worldEvents.weights.traveling_merchant },
];

function pickEvent(): EventDefinition {
  const total = EVENT_TABLE.reduce((s, e) => s + e.weight, 0);
  let roll = Math.random() * total;
  for (const event of EVENT_TABLE) {
    roll -= event.weight;
    if (roll <= 0) return event;
  }
  // Ağırlıklar pozitif olduğu için buraya normalde ulaşılmaz.
  return EVENT_TABLE[0]!;
}

/** Uygun krallıklar için olay çekilişi yapar. */
export async function rollWorldEvents(tx: Tx, limit = 100): Promise<number> {
  const candidates = await txQuery<KingdomRow>(
    tx,
    `SELECT k.* FROM kingdoms k
      JOIN channels c ON c.id = k.channel_id
      WHERE k.status = 'active' AND c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM world_events e
           WHERE e.affected_kingdom_id = k.id
             AND e.triggered_at > now() - ($1 || ' hours')::interval
        )
      ORDER BY random()
      LIMIT $2`,
    [String(BALANCE.worldEvents.cooldownHours), limit],
  );

  let triggered = 0;

  for (const kingdom of candidates) {
    // Kontrol periyodu başına olasılık; tick her dakika koştuğu için olasılığı
    // periyoda oranla ölçekliyoruz, yoksa olaylar çok sık düşerdi.
    const perTickChance =
      BALANCE.worldEvents.chancePerCheck /
      ((BALANCE.worldEvents.checkIntervalHours * 3600) / config.tickIntervalSeconds);
    if (Math.random() >= perTickChance) continue;

    const event = pickEvent();
    await applyEvent(tx, kingdom, event);
    triggered += 1;
  }

  return triggered;
}

async function applyEvent(tx: Tx, kingdom: KingdomRow, event: EventDefinition): Promise<void> {
  const now = config.now();

  switch (event.type) {
    case 'bountiful_harvest': {
      const expiresAt = new Date(
        now.getTime() + BALANCE.worldEvents.bountifulHarvest.durationHours * 3600_000,
      );
      await insertEvent(tx, kingdom, event, expiresAt, {
        foodMultiplier: BALANCE.worldEvents.bountifulHarvest.foodMultiplier,
      });
      await notify(tx, {
        kingdomId: kingdom.id,
        kind: 'world_event',
        title: event.titleTr,
        body: `Tarlalar beklenenden cömert çıktı; ${BALANCE.worldEvents.bountifulHarvest.durationHours} saat boyunca yiyecek üretimi %50 arttı.`,
      });
      return;
    }

    case 'plague': {
      const loss = kingdom.population * BALANCE.worldEvents.plague.populationLoss;
      await txQuery(
        tx,
        `UPDATE kingdoms
            SET population = GREATEST(0, population - $2),
                popularity = GREATEST(0, popularity - $3)
          WHERE id = $1`,
        [kingdom.id, loss, BALANCE.worldEvents.plague.popularityDrop],
      );
      await insertEvent(tx, kingdom, event, null, { populationLost: Math.round(loss) });
      await notify(tx, {
        kingdomId: kingdom.id,
        kind: 'world_event',
        severity: 'critical',
        title: event.titleTr,
        body: `Veba yayıldı: ${Math.round(loss)} kişi kaybedildi, halkın morali bozuldu.`,
      });
      return;
    }

    case 'traveling_merchant': {
      const expiresAt = new Date(
        now.getTime() + BALANCE.worldEvents.travelingMerchant.durationHours * 3600_000,
      );
      await insertEvent(tx, kingdom, event, expiresAt, {
        rateBonus: BALANCE.worldEvents.travelingMerchant.rateBonus,
      });
      await notify(tx, {
        kingdomId: kingdom.id,
        kind: 'world_event',
        title: event.titleTr,
        body: `Bir kervan surlarımızın dibine kondu; ${BALANCE.worldEvents.travelingMerchant.durationHours} saat boyunca ticarette elverişli kur sunuyor.`,
      });
      return;
    }

    case 'bandit_raid': {
      // Garnizonu sınayan küçük bir saldırı. Gerçek savaş formülünü kullanır,
      // böylece "ordumu tamamen sefere gönderdim" hatası burada da bedel öder.
      const snapshot = await loadKingdomSnapshot(kingdom.id, tx);
      if (!snapshot) return;

      const defenderSize = armyUnitCount(snapshot.garrison);
      const banditCount = Math.max(
        4,
        Math.round(defenderSize * BALANCE.worldEvents.banditRaid.armyScale) + 3,
      );

      const outcome = resolveBattle({
        attacker: {
          army: { macebearer: banditCount },
          tactic: 'frontal',
          popularity: 50,
          chapelLevels: [],
          distanceTiles: 0,
        },
        defender: {
          army: snapshot.garrison,
          tactic: 'withdraw_to_keep',
          popularity: kingdom.popularity,
          chapelLevels: snapshot.buildings.filter((b) => b.type === 'chapel').map((b) => b.level),
        },
        terrain: snapshot.capitalTile?.terrain_type ?? 'plains',
        fortification: fortificationOf(snapshot),
        mode: 'raid',
      });

      // Yalnızca savunanın kayıpları uygulanır; haydutlar oyuncu varlığı değil.
      for (const [type, lost] of Object.entries(outcome.casualties.defender)) {
        if (lost && lost > 0) {
          await txQuery(
            tx,
            `UPDATE unit_stocks SET count = GREATEST(0, count - $3)
              WHERE kingdom_id = $1 AND unit_type = $2`,
            [kingdom.id, type, lost],
          );
        }
      }

      // Savunma başarısızsa haydutlar biraz kaynak da götürür.
      if (outcome.attackerWon) {
        await txQuery(
          tx,
          `UPDATE kingdoms
              SET gold = GREATEST(0, gold * 0.92), food = GREATEST(0, food * 0.9)
            WHERE id = $1`,
          [kingdom.id],
        );
      }

      await insertEvent(tx, kingdom, event, null, {
        banditCount,
        repelled: !outcome.attackerWon,
      });

      await notify(tx, {
        kingdomId: kingdom.id,
        kind: 'world_event',
        severity: outcome.attackerWon ? 'warning' : 'info',
        title: event.titleTr,
        body: outcome.attackerWon
          ? `Yaklaşık ${banditCount} haydut garnizonumuzu aştı ve depolarımızdan bir miktar götürdü. Savunmamız yetersiz kaldı.`
          : `Yaklaşık ${banditCount} haydut sınırımızı zorladı ama garnizonumuz onları püskürttü.`,
      });
      return;
    }
  }
}

async function insertEvent(
  tx: Tx,
  kingdom: KingdomRow,
  event: EventDefinition,
  expiresAt: Date | null,
  effect: Record<string, unknown>,
): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO world_events (channel_id, type, affected_kingdom_id, expires_at, effect_json, applied)
     VALUES ($1, $2, $3, $4, $5, TRUE)`,
    [kingdom.channel_id, event.type, kingdom.id, expiresAt, JSON.stringify(effect)],
  );
}

/** Süresi dolmuş olayları temizler (aktif çarpanlar sorgusunu hafif tutmak için). */
export async function pruneExpiredEvents(tx: Tx): Promise<void> {
  await txQueryOne(
    tx,
    `DELETE FROM world_events
      WHERE expires_at IS NOT NULL AND expires_at < now() - INTERVAL '7 days'
      RETURNING id`,
  );
}
