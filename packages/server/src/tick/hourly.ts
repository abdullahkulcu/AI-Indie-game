/**
 * Saat başı işler — §15.3 adım 7 ve 8.
 *
 *  7. Her krallığın emir kotası Kale seviyesine göre yenilenir (§14.4).
 *  8. Pasif moddaki krallıklar için General'a "karar paketi" çağrısı yapılır;
 *     bekleyen diplomasi görüşmeleri de strateji notuna göre yanıtlanır.
 *
 * Ayrıca Bölgesel Duyum Akışı'nın (§10.4) 6 saatlik toplu bülteni burada
 * üretilir.
 */

import { BALANCE, refillDecreeQuota, decreeQuotaCap, tileDistance } from '@krallik/shared';
import { config } from '../config.js';
import { query, txQuery, withTransaction, type Tx } from '../db/pool.js';
import type { DiplomacyThreadRow, KingdomRow, RegionActivityRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';
import { keepLevelOf, loadKingdomSnapshot } from '../game/state.js';
import { withKingdomLock } from '../redis.js';

/**
 * Emir kotası yenilemesi.
 *
 * Kullanılmayan kota bir sonraki saate devreder, en fazla 2 saatlik kota
 * birikebilir (§14.4) — seyrek giren oyuncu cezalandırılmaz, sonsuz biriktirme
 * de engellenir. Bu iş tek bir toplu UPDATE ile yapılabilirdi, ama Kale
 * seviyesi krallığa göre değiştiği için kotayı bina tablosundan okumak gerekiyor.
 */
export async function refillQuotas(tx: Tx, limit = 1000): Promise<number> {
  const due = await txQuery<KingdomRow>(
    tx,
    `SELECT * FROM kingdoms
      WHERE status = 'active'
        AND decree_quota_last_refill_at <= now() - INTERVAL '1 hour'
      ORDER BY decree_quota_last_refill_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  const now = config.now();

  for (const kingdom of due) {
    const snapshot = await loadKingdomSnapshot(kingdom.id, tx);
    if (!snapshot) continue;

    const keepLevel = keepLevelOf(snapshot);
    const hoursElapsed =
      (now.getTime() - kingdom.decree_quota_last_refill_at.getTime()) / 3_600_000;

    const next = refillDecreeQuota({
      current: kingdom.decree_quota_remaining,
      keepLevel,
      hoursElapsed,
    });

    // Yenileme zamanını tam saat sayısı kadar ilerlet; kalan dakikalar bir
    // sonraki yenilemeye devretsin, yoksa kesirli saatler sürekli yutulurdu.
    const wholeHours = Math.floor(hoursElapsed);
    const newRefillAt = new Date(
      kingdom.decree_quota_last_refill_at.getTime() + wholeHours * 3_600_000,
    );

    await txQuery(
      tx,
      'UPDATE kingdoms SET decree_quota_remaining = $2, decree_quota_last_refill_at = $3 WHERE id = $1',
      [kingdom.id, Math.min(next, decreeQuotaCap(keepLevel)), newRefillAt],
    );
  }

  return due.length;
}

/**
 * Bölgesel Duyum Akışı — 6 saatlik toplu bülten (§10.4).
 *
 * Bülten metni burada **deterministik** olarak derlenir, LLM ile değil. Sebebi
 * §14.6: oyuncunun anahtarı geçersizse General sessize düşer, ama dünyanın
 * haberleri akmaya devam etmeli. General bu bülteni bir sonraki turunda
 * bağlamında görür ve Kral'a kendi diliyle aktarır — özetleme katmanı orada
 * gerçekleşir, akışın kendisi ise anahtardan bağımsız çalışır.
 */
export async function publishRegionBulletins(tx: Tx): Promise<number> {
  const intervalHours = BALANCE.diplomacy.regionBulletinIntervalHours;

  const kingdoms = await txQuery<KingdomRow & { cap_x: number; cap_y: number }>(
    tx,
    `SELECT k.*, t.x AS cap_x, t.y AS cap_y
       FROM kingdoms k
       JOIN map_tiles t ON t.id = k.capital_tile_id
       JOIN channels c ON c.id = k.channel_id
      WHERE k.status = 'active' AND c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM region_bulletins b
           WHERE b.kingdom_id = k.id
             AND b.kind = 'routine_digest'
             AND b.created_at > now() - ($1 || ' hours')::interval
        )
      LIMIT 500`,
    [String(intervalHours)],
  );

  let published = 0;

  for (const kingdom of kingdoms) {
    const activity = await txQuery<RegionActivityRow>(
      tx,
      `SELECT * FROM region_activity
        WHERE channel_id = $1
          AND severity = 'routine'
          AND created_at > now() - ($2 || ' hours')::interval
        ORDER BY created_at DESC
        LIMIT 40`,
      [kingdom.channel_id, String(intervalHours)],
    );

    // "Bölge" tanımı: başkente belirli bir tile-mesafesi içindekiler — uzak
    // bölgeler akışı kirletmesin (§10.4).
    const nearby = activity.filter(
      (a) =>
        tileDistance(
          { x: kingdom.cap_x, y: kingdom.cap_y },
          { x: a.origin_x, y: a.origin_y },
        ) <= BALANCE.diplomacy.regionRadiusTiles,
    );

    if (nearby.length === 0) continue;

    const lines = nearby.slice(0, 8).map((a) => `• ${a.summary}`);
    const summary = `Bölgenizde son ${intervalHours} saatte şunlar oldu:\n${lines.join('\n')}`;
    const related = [...new Set(nearby.flatMap((a) => a.related_kingdom_ids))];

    await txQuery(
      tx,
      `INSERT INTO region_bulletins (kingdom_id, kind, summary, related_kingdom_ids)
       VALUES ($1, 'routine_digest', $2, $3)`,
      [kingdom.id, summary, JSON.stringify(related)],
    );
    published += 1;
  }

  return published;
}

/**
 * Büyük/dramatik olaylar (bir başkentin düşmesi, savaş ilanı, ihanet) beklemeden
 * anında ayrı bildirim olarak dağıtılır (§10.4).
 */
export async function dispatchMajorRegionEvents(tx: Tx): Promise<number> {
  const events = await txQuery<RegionActivityRow>(
    tx,
    `SELECT * FROM region_activity
      WHERE severity = 'major' AND created_at > now() - INTERVAL '15 minutes'`,
  );
  if (events.length === 0) return 0;

  let delivered = 0;

  for (const event of events) {
    const kingdoms = await txQuery<{ id: string; x: number; y: number }>(
      tx,
      `SELECT k.id, t.x, t.y
         FROM kingdoms k
         JOIN map_tiles t ON t.id = k.capital_tile_id
        WHERE k.channel_id = $1 AND k.status = 'active'`,
      [event.channel_id],
    );

    for (const kingdom of kingdoms) {
      const distance = tileDistance(kingdom, { x: event.origin_x, y: event.origin_y });
      if (distance > BALANCE.diplomacy.regionRadiusTiles) continue;

      // Aynı olayı iki kez göndermemek için varlık kontrolü.
      const existing = await txQuery<{ id: string }>(
        tx,
        `SELECT id FROM region_bulletins
          WHERE kingdom_id = $1 AND kind = 'major_event' AND summary = $2`,
        [kingdom.id, event.summary],
      );
      if (existing.length > 0) continue;

      await txQuery(
        tx,
        `INSERT INTO region_bulletins (kingdom_id, kind, summary, related_kingdom_ids)
         VALUES ($1, 'major_event', $2, $3)`,
        [kingdom.id, event.summary, JSON.stringify(event.related_kingdom_ids)],
      );
      await notify(tx, {
        kingdomId: kingdom.id,
        kind: 'region_bulletin',
        severity: 'warning',
        title: 'Diyardan mühim haber',
        body: event.summary,
      });
      delivered += 1;
    }
  }

  return delivered;
}

/**
 * Pasif mod turu (§14.2).
 *
 * Saatlik zamanlanmış görev uyanır, oyuncunun strateji notuna ve güncel dünya
 * durumuna bakar, rutin kararları doğrudan uygular, büyük kararları onaya
 * bırakır. LLM katmanı bunu yürütür; buradaki iş yalnızca *kimin* uygun
 * olduğunu bulmak ve eşzamanlılığı sınırlamak.
 */
export async function runPassiveTurns(): Promise<number> {
  const candidates = await query<{ id: string }>(
    `SELECT k.id
       FROM kingdoms k
       JOIN channels c ON c.id = k.channel_id
      WHERE k.status = 'active'
        AND c.status = 'active'
        -- BYOK anahtarı olmayan krallıkta General zaten sessizdir (§14.6).
        AND k.api_key_encrypted IS NOT NULL
        AND k.last_active_at < now() - ($1 || ' minutes')::interval
        AND (k.last_passive_run_at IS NULL OR k.last_passive_run_at < now() - INTERVAL '1 hour')
        AND k.decree_quota_remaining >= 1
      ORDER BY k.last_passive_run_at NULLS FIRST
      LIMIT $2`,
    [String(BALANCE.general.passiveAfterMinutes), config.tickBatchSize],
  );

  if (candidates.length === 0) return 0;

  // LLM katmanı isteğe bağlı olarak yüklenir: henüz kurulmamışsa ya da
  // yüklenemezse tick servisi çalışmaya devam etmeli (§14.6 ruhu).
  const llm = await loadGeneralModule();
  if (!llm) return 0;

  let processed = 0;
  const concurrency = Math.max(1, config.passiveLlmConcurrency);
  const queue = [...candidates];

  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;

      // Aynı krallık aynı anda tick ve pasif tur tarafından işlenmesin.
      await withKingdomLock(
        next.id,
        async () => {
          try {
            await llm.runGeneralTurn({ kingdomId: next.id, mode: 'passive' });
            processed += 1;
          } catch (error) {
            // Bir oyuncunun sağlayıcı hatası diğerlerini durdurmamalı.
            console.error(`[hourly] pasif tur başarısız (${next.id}):`, (error as Error).message);
          } finally {
            await withTransaction(async (tx) => {
              await txQuery(tx, 'UPDATE kingdoms SET last_passive_run_at = now() WHERE id = $1', [
                next.id,
              ]);
            });
          }
        },
        120_000,
      );
    }
  });

  await Promise.all(workers);
  return processed;
}

/**
 * Bekleyen diplomasi görüşmelerini yanıtlar (§15.3 adım 8).
 * Karşı taraf pasifse strateji notuna göre General karar verir.
 */
export async function runPendingNegotiations(): Promise<number> {
  const threads = await query<DiplomacyThreadRow>(
    `SELECT t.* FROM diplomacy_threads t
       JOIN kingdoms k ON k.id = t.to_kingdom_id
      WHERE t.status = 'pending'
        AND k.status = 'active'
        AND k.api_key_encrypted IS NOT NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
        -- Karşı General'ın henüz konuşmadığı görüşmeler.
        AND NOT EXISTS (
          SELECT 1 FROM diplomacy_turns d
           WHERE d.thread_id = t.id AND d.speaker_kingdom_id = t.to_kingdom_id
        )
      ORDER BY t.created_at
      LIMIT 50`,
  );

  if (threads.length === 0) return 0;

  const llm = await loadNegotiationModule();
  if (!llm) return 0;

  let handled = 0;
  for (const thread of threads) {
    try {
      await llm.runNegotiationTurn({ threadId: thread.id });
      handled += 1;
    } catch (error) {
      console.error(`[hourly] müzakere turu başarısız (${thread.id}):`, (error as Error).message);
    }
  }
  return handled;
}

/** Süresi dolan diplomasi tekliflerini kapatır. */
export async function expireDiplomacyThreads(tx: Tx): Promise<number> {
  const rows = await txQuery<{ id: string }>(
    tx,
    `UPDATE diplomacy_threads
        SET status = 'expired', resolved_at = now()
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= now()
      RETURNING id`,
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// LLM katmanının gevşek bağlanması
// ---------------------------------------------------------------------------

interface GeneralModule {
  runGeneralTurn(input: { kingdomId: string; mode: 'active' | 'passive'; kingMessage?: string }): Promise<unknown>;
}

interface NegotiationModule {
  runNegotiationTurn(input: { threadId: string }): Promise<unknown>;
}

let generalModule: GeneralModule | null | undefined;
let negotiationModule: NegotiationModule | null | undefined;

/**
 * LLM katmanı dinamik olarak yüklenir.
 *
 * Böylece formül-tabanlı tick (üretim, kuyruklar, savaş) LLM katmanı hiç
 * yüklenmese bile çalışır — §14.6'nın "kingdom ölmez, sadece yeni inisiyatif
 * durur" garantisi mimari düzeyde sağlanmış olur.
 */
async function loadGeneralModule(): Promise<GeneralModule | null> {
  if (generalModule !== undefined) return generalModule;
  try {
    generalModule = (await import('../llm/general.js')) as unknown as GeneralModule;
  } catch (error) {
    console.warn('[hourly] LLM katmanı yüklenemedi, pasif turlar atlanıyor:', (error as Error).message);
    generalModule = null;
  }
  return generalModule;
}

async function loadNegotiationModule(): Promise<NegotiationModule | null> {
  if (negotiationModule !== undefined) return negotiationModule;
  try {
    negotiationModule = (await import('../llm/negotiation.js')) as unknown as NegotiationModule;
  } catch (error) {
    console.warn('[hourly] müzakere katmanı yüklenemedi:', (error as Error).message);
    negotiationModule = null;
  }
  return negotiationModule;
}
