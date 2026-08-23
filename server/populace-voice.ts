import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { populaceDemands } from "../db/schema";
import {
  DEMAND_NOTICE_HOURS, type DemandCandidate, type DemandKind, type DemandTone,
  derivePopulaceDemands, openDemands, type VoiceSignals,
} from "../engine/populace-voice";
import type { OpenDemand } from "./populace-brief";
import { type DemandNarrator, narrateDemands } from "./populace-narrator";

/**
 * Halkın sesinin kalıcılığı. Karar mantığı `engine/populace-voice.ts` içinde saf
 * durur; burada yalnızca "koşul ne zamandan beri var" defteri tutulur.
 *
 * `server/general-ledger.ts`'in birebir aynı deseni; iki modül ayrı çünkü
 * Generalin talepleri ile halkın talepleri farklı tablolarda ve farklı süre
 * kurallarıyla yaşıyor.
 *
 * SAĞLAYICI ÇAĞRISI BU DOSYADA YOK ve olmayacak (bir test bunu doğruluyor).
 * Halk-AI'nın cümlesini `server/populace-narrator.ts` üretir; buradan ona
 * yalnızca bir fonksiyon (`narrate`) olarak geçilir. Sebep: kalıcılık modülü
 * veritabanının, anlatım modülü sağlayıcının sorumluluğu; ikisi tek dosyada
 * olsaydı "kimlik bilgisi yoksa şablona düşülür" kuralının veritabanısız tek
 * bir testi olmazdı.
 */

/** Halkın sesi için gereken durum özeti; kaynağı istemcinin bağlamıdır. */
export type VoiceContext = VoiceSignals & { channelSpeed: number };

/**
 * Talep defterini durumla eşitler ve açık talepleri döndürür.
 *
 * Süre şartı OYUN saati cinsindendir: geçen gerçek süre channel hızıyla
 * çarpılır, yani ×24 channel'da halk 4 oyun saatini 10 gerçek dakikada
 * doldurur. Aksi hâlde hızlı channel'da halkın sesi hiç duyulmazdı.
 *
 * `narrate` verilmişse (channel'ın Halk-AI kimlik bilgisi var) AÇIK taleplerin
 * cümlesi modelden gelir; verilmemişse motorun şablon cümlesi kullanılır. Model
 * yalnızca AÇIK talepler için çağrılır: süre şartını henüz geçmemiş bir aday
 * Kral'a gösterilmiyor, onun için token yakmak boşa masraf olurdu ("değirmen
 * dersi"nin maliyet tarafı).
 */
export async function syncPopulaceDemands(
  userId: string,
  context: VoiceContext,
  now: number,
  narrate: DemandNarrator | null = null,
): Promise<{ open: OpenDemand[]; closed: DemandKind[]; derived: DemandCandidate[] }> {
  const db = getDb();
  const speed = Math.max(1, Number(context.channelSpeed) || 1);
  const candidates = derivePopulaceDemands(context);
  const rows = await db.select().from(populaceDemands).where(eq(populaceDemands.userId, userId));
  const byKind = new Map(rows.map(row => [row.kind, row]));
  const candidateKinds = new Set<string>(candidates.map(candidate => candidate.kind));

  // Koşulu düzelen talep silinir: süre baştan sayılır, "bir kez açıldı hep
  // açık kalır" hâline düşmez.
  const closed = rows.filter(row => !candidateKinds.has(row.kind)).map(row => row.kind as DemandKind);
  if (closed.length) {
    await db.delete(populaceDemands)
      .where(and(eq(populaceDemands.userId, userId), inArray(populaceDemands.kind, closed)));
  }

  const held: Partial<Record<DemandKind, number>> = {};
  for (const candidate of candidates) {
    const existing = byKind.get(candidate.kind);
    const seenAt = existing?.seenAt ?? now;
    held[candidate.kind] = Math.max(0, (now - seenAt) / 3_600_000 * speed);
    if (existing) {
      await db.update(populaceDemands)
        // METİN BURADA EZİLMEZ (Halk-AI varken): satırdaki cümle modelin ürettiği
        // cümle olabilir ve her senkronda şablonla üzerine yazmak, kademe
        // değişmediği hâlde modeli her istekte yeniden çağırmaya (ve Kral'ın
        // gözünde cümlenin sürekli değişmesine) yol açardı. Halk-AI yoksa tersi
        // doğru: şablon geri yazılır ve `tone` temizlenir, yani channel
        // anahtarını kaybederse halkın sesi sessizce deterministiğe döner.
        .set({
          severity: candidate.severity, voice: candidate.voice,
          ...(narrate ? {} : { text: candidate.text, tone: null }),
        })
        .where(and(eq(populaceDemands.userId, userId), eq(populaceDemands.kind, candidate.kind)));
      continue;
    }
    await db.insert(populaceDemands).values({
      userId, kind: candidate.kind, voice: candidate.voice,
      // Yeni satır şablon metinle açılır: sütun NOT NULL ve talep henüz
      // açılmamış olabilir. `tone` NULL kaldığı için Halk-AI varsa bu metin
      // Kral'a HİÇ gösterilmez — açıldığı anda modelden gerçek cümle gelir.
      text: candidate.text, severity: candidate.severity, seenAt: now,
    }).onConflictDoNothing();
  }

  const opened = openDemands(candidates, held);
  // `openedAt` yalnızca ilk açılışta yazılır; süregelen talebin yaşı korunur ki
  // halk "üç gündür ekmek istiyoruz" diyebilsin. Bu döngü ANLATIMDAN ÖNCE ve
  // ondan bağımsız işler: sağlayıcı hatası bir talebin defterdeki yaşını
  // sıfırlamaz, yalnızca o turda sesini keser.
  for (const demand of opened) {
    const existing = byKind.get(demand.kind);
    if (existing?.openedAt) continue;
    await db.update(populaceDemands).set({ openedAt: now })
      .where(and(eq(populaceDemands.userId, userId), eq(populaceDemands.kind, demand.kind)));
  }

  // Cümleler: Halk-AI varsa modelden, yoksa motorun şablonundan. Karar
  // `narrateDemands` içinde TEK yerde yaşıyor.
  const narrated = await narrateDemands({
    open: opened,
    stored: rows.map(row => ({ kind: row.kind as DemandKind, text: row.text, tone: row.tone as DemandTone | null })),
    heldGameHours: held,
    narrate,
  });
  for (const demand of narrated) {
    // Şablon yolunda metin yukarıdaki döngüde zaten yazıldı; burada yalnızca
    // Halk-AI'nın yeni ürettiği cümle kalıcılaşır.
    if (!demand.store || !demand.tone) continue;
    await db.update(populaceDemands).set({ text: demand.text, tone: demand.tone })
      .where(and(eq(populaceDemands.userId, userId), eq(populaceDemands.kind, demand.kind)));
  }

  return {
    open: narrated.map(demand => ({
      kind: demand.kind, voice: demand.voice, text: demand.text, severity: demand.severity,
      since: byKind.get(demand.kind)?.openedAt ?? now,
    })),
    closed,
    // `derived` DIŞARI VERİLİR çünkü `OpenDemand` `satisfiedBy` taşımıyor:
    // "Kral bu turdaki emirle hangi talebi kapattı" sorusunu ancak adayların
    // kendisi cevaplayabilir (`demandsSatisfiedBy`). `server/general-ledger.ts`
    // → `loadGeneralMemory` de aynı gerekçeyle `derived` döndürüyor; desen
    // kopyalanmadı, aynısı kullanıldı.
    derived: candidates,
  };
}

/** Süre şartını geçmiş ama henüz bildirilmemiş talepler; tür başına 6 oyun saati. */
export async function claimDemandNotices(
  userId: string,
  open: OpenDemand[],
  channelSpeed: number,
  now: number,
): Promise<DemandKind[]> {
  if (!open.length) return [];
  const db = getDb();
  const speed = Math.max(1, Number(channelSpeed) || 1);
  const rows = await db.select().from(populaceDemands).where(eq(populaceDemands.userId, userId));
  const due = open.filter(demand => {
    const row = rows.find(item => item.kind === demand.kind);
    const last = row?.lastNoticeAt ?? 0;
    return (now - last) / 3_600_000 * speed >= DEMAND_NOTICE_HOURS;
  }).map(demand => demand.kind);
  if (due.length) {
    await db.update(populaceDemands).set({ lastNoticeAt: now })
      .where(and(eq(populaceDemands.userId, userId), inArray(populaceDemands.kind, due)));
  }
  return due;
}

export type { DemandCandidate };
