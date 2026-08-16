/**
 * Tick servisi — GDD §15.3.
 *
 * Ayrı bir background worker olarak koşar (API sürecinden bağımsız). Her dakika
 * uyanır ve şu sırayla ilerler:
 *
 *   1. Tamamlanma zamanı geçmiş inşaat/eğitim kuyruklarını işler.
 *   2. Varış zamanı gelen orduları çözer → akın anında, kuşatma round'lu.
 *   3. Varış zamanı gelen kervanları çözer → kaynak transferi.
 *   4. Popülerlik/nüfus/itibar güncellemesi (lazy üretimle birlikte).
 *   5. Rastgele dünya olayı tetikleyicisi.
 *   6. Saat başı: emir kotası yenilemesi.
 *   7. Saat başı: pasif mod LLM karar paketi + bekleyen diplomasi görüşmeleri.
 *
 * §16.5 gereği bu servis **güncelleme sırasında da çalışmaya devam etmeli**;
 * bu yüzden her adım kendi transaction'ında ve `FOR UPDATE SKIP LOCKED` ile
 * yazıldı — iki worker sürümü aynı anda ayakta olsa bile aynı satırı iki kez
 * işlemez, rolling deployment güvenli olur.
 */

import { config } from '../config.js';
import { closePool, query, withTransaction } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import type { ArmyRow, SiegeRow } from '../db/rows.js';
import { resolveArmyArrival, resolveSiegeRound } from '../game/combat.js';
import { closeRedis, withKingdomLock, withTickLock } from '../redis.js';
import { advanceKingdomEconomy } from './economy.js';
import {
  dispatchMajorRegionEvents,
  expireDiplomacyThreads,
  publishRegionBulletins,
  refillQuotas,
  runPassiveTurns,
  runPendingNegotiations,
} from './hourly.js';
import { completeBuildings, completeCaravans, completeSpyMissions, completeTraining } from './queues.js';
import {
  expireMarketOffers,
  expirePendingDecisions,
  processRentalExpiry,
  processTradeAgreements,
  processTribute,
  warnProtectionEnding,
} from './schedules.js';
import { checkChannelEndings } from './season.js';
import { pruneExpiredEvents, rollWorldEvents } from './worldEvents.js';

export interface TickStats {
  buildings: number;
  training: number;
  armies: number;
  sieges: number;
  caravans: number;
  spies: number;
  economies: number;
  worldEvents: number;
  durationMs: number;
}

/** Bir tick turu. Hata alan adım diğerlerini durdurmaz. */
export async function runTick(): Promise<TickStats> {
  const started = Date.now();
  const stats: TickStats = {
    buildings: 0,
    training: 0,
    armies: 0,
    sieges: 0,
    caravans: 0,
    spies: 0,
    economies: 0,
    worldEvents: 0,
    durationMs: 0,
  };

  // --- 1. Kuyruklar ------------------------------------------------------
  await step('kuyruklar', async () => {
    await withTransaction(async (tx) => {
      stats.buildings = await completeBuildings(tx);
      stats.training = await completeTraining(tx);
    });
  });

  // --- 2. Ordu varışları -------------------------------------------------
  await step('ordular', async () => {
    const due = await query<ArmyRow>(
      `SELECT * FROM armies
        WHERE status IN ('marching','returning') AND arrives_at <= now()
        ORDER BY arrives_at
        LIMIT $1`,
      [config.tickBatchSize],
    );

    for (const army of due) {
      // Krallık kilidi: aynı krallığın kaynakları iki yerden değişmesin.
      const done = await withKingdomLock(army.kingdom_id, async () => {
        await withTransaction(async (tx) => {
          // Kilit alındıktan sonra satırı tazele: başka bir worker bu arada
          // çözmüş olabilir.
          const fresh = await tx.query<ArmyRow>(
            `SELECT * FROM armies WHERE id = $1 AND status IN ('marching','returning') FOR UPDATE`,
            [army.id],
          );
          const row = fresh.rows[0];
          if (!row) return;
          await resolveArmyArrival(tx, row);
        });
        return true;
      });
      if (done) stats.armies += 1;
    }
  });

  // --- 2b. Kuşatma round'ları -------------------------------------------
  await step('kuşatmalar', async () => {
    const due = await query<SiegeRow>(
      `SELECT * FROM sieges
        WHERE status = 'ongoing' AND next_round_at <= now()
        ORDER BY next_round_at
        LIMIT $1`,
      [config.tickBatchSize],
    );

    for (const siege of due) {
      const done = await withKingdomLock(siege.defender_kingdom_id, async () => {
        await withTransaction(async (tx) => {
          const fresh = await tx.query<SiegeRow>(
            `SELECT * FROM sieges WHERE id = $1 AND status = 'ongoing' FOR UPDATE`,
            [siege.id],
          );
          const row = fresh.rows[0];
          if (!row) return;
          await resolveSiegeRound(tx, row);
        });
        return true;
      }, 60_000);
      if (done) stats.sieges += 1;
    }
  });

  // --- 3. Kervanlar ve casuslar -----------------------------------------
  await step('kervanlar', async () => {
    await withTransaction(async (tx) => {
      stats.caravans = await completeCaravans(tx);
      stats.spies = await completeSpyMissions(tx);
    });
  });

  // --- 4. Ekonomi (üretim + popülerlik + nüfus + itibar) -----------------
  await step('ekonomi', async () => {
    const kingdoms = await query<{ id: string }>(
      `SELECT k.id FROM kingdoms k
         JOIN channels c ON c.id = k.channel_id
        WHERE k.status = 'active' AND c.status = 'active'
        ORDER BY k.last_tick_at
        LIMIT $1`,
      [config.tickBatchSize],
    );

    for (const kingdom of kingdoms) {
      const done = await withKingdomLock(kingdom.id, async () => {
        await withTransaction(async (tx) => {
          await advanceKingdomEconomy(tx, kingdom.id);
        });
        return true;
      }, 20_000);
      if (done) stats.economies += 1;
    }
  });

  // --- 5. Periyodik diplomasi/süre işleri --------------------------------
  await step('zamanlanmış işler', async () => {
    await withTransaction(async (tx) => {
      await processTribute(tx);
      await processTradeAgreements(tx);
      await processRentalExpiry(tx);
      await expireMarketOffers(tx);
      await expirePendingDecisions(tx);
      await expireDiplomacyThreads(tx);
      await warnProtectionEnding(tx);
    });
  });

  // --- 6. Dünya olayları -------------------------------------------------
  await step('dünya olayları', async () => {
    await withTransaction(async (tx) => {
      stats.worldEvents = await rollWorldEvents(tx);
      await pruneExpiredEvents(tx);
    });
  });

  // --- 7. Bölgesel duyum akışı ------------------------------------------
  await step('duyum akışı', async () => {
    await withTransaction(async (tx) => {
      await dispatchMajorRegionEvents(tx);
      await publishRegionBulletins(tx);
    });
  });

  // --- 8. Saat başı: kota yenileme --------------------------------------
  await step('kota yenileme', async () => {
    await withTransaction(async (tx) => {
      await refillQuotas(tx);
    });
  });

  // --- 9. Sezon sonu / kazanma koşulu -----------------------------------
  await step('sezon kontrolü', async () => {
    await withTransaction(async (tx) => {
      await checkChannelEndings(tx);
    });
  });

  stats.durationMs = Date.now() - started;
  return stats;
}

/**
 * Saatlik LLM işleri ayrı bir turda koşar: sağlayıcı çağrıları dakikalık
 * tick'ten çok daha uzun sürebilir, onu bloklamamalı.
 */
export async function runHourlyLlmJobs(): Promise<{ passive: number; negotiations: number }> {
  const passive = await runPassiveTurns();
  const negotiations = await runPendingNegotiations();
  return { passive, negotiations };
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    // Bir adımın çökmesi tüm tick'i düşürmemeli; bir sonraki turda tekrar denenir.
    console.error(`[tick] "${name}" adımı başarısız:`, error);
  }
}

// ---------------------------------------------------------------------------
// Worker döngüsü
// ---------------------------------------------------------------------------

let running = true;

async function main(): Promise<void> {
  console.log('[tick] worker başlıyor…');
  await runMigrations();

  let lastLlmRun = 0;

  const loop = async (): Promise<void> => {
    while (running) {
      const started = Date.now();

      // Tick kilidi: birden fazla worker örneği ayakta olsa bile aynı turu
      // iki kez koşmasınlar.
      const stats = await withTickLock(
        'main',
        () => runTick(),
        config.tickIntervalSeconds * 1000 - 5_000,
      );

      if (stats) {
        const touched =
          stats.buildings + stats.training + stats.armies + stats.sieges + stats.caravans;
        if (touched > 0 || stats.worldEvents > 0) {
          console.log(
            `[tick] ${stats.durationMs}ms — bina:${stats.buildings} eğitim:${stats.training} ` +
              `ordu:${stats.armies} kuşatma:${stats.sieges} kervan:${stats.caravans} ` +
              `casus:${stats.spies} ekonomi:${stats.economies} olay:${stats.worldEvents}`,
          );
        }
      }

      // Saatlik LLM işleri: pasif mod karar paketleri ve müzakereler.
      if (Date.now() - lastLlmRun >= 3_600_000) {
        lastLlmRun = Date.now();
        const llmStats = await withTickLock('llm-hourly', () => runHourlyLlmJobs(), 20 * 60_000);
        if (llmStats && (llmStats.passive > 0 || llmStats.negotiations > 0)) {
          console.log(
            `[tick] saatlik LLM — pasif tur:${llmStats.passive} müzakere:${llmStats.negotiations}`,
          );
        }
      }

      const elapsed = Date.now() - started;
      const wait = Math.max(1000, config.tickIntervalSeconds * 1000 - elapsed);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  };

  await loop();
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[tick] ${signal} alındı, kapatılıyor…`);
  running = false;
  // Devam eden turun bitmesine kısa bir pay bırak; yarım kalan transaction
  // zaten rollback olur, ama gereksiz gürültü çıkarmasın.
  setTimeout(() => {
    void Promise.allSettled([closePool(), closeRedis()]).then(() => process.exit(0));
  }, 1500);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const entryPoint = process.argv[1] ?? '';
if (entryPoint.includes('worker')) {
  main().catch((error: unknown) => {
    console.error('[tick] ölümcül hata:', error);
    process.exit(1);
  });
}
