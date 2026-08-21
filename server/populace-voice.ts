import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { populaceDemands } from "../db/schema";
import {
  DEMAND_NOTICE_HOURS, type DemandCandidate, type DemandKind,
  derivePopulaceDemands, openDemands, renderDemands, type VoiceSignals,
} from "../engine/populace-voice";

/**
 * Halkın sesinin kalıcılığı. Karar mantığı `engine/populace-voice.ts` içinde saf
 * durur; burada yalnızca "koşul ne zamandan beri var" defteri tutulur.
 *
 * `server/general-ledger.ts`'in birebir aynı deseni; iki modül ayrı çünkü
 * Generalin talepleri ile halkın talepleri farklı tablolarda ve farklı süre
 * kurallarıyla yaşıyor.
 */

export type OpenDemand = {
  kind: DemandKind;
  voice: "commons" | "garrison";
  text: string;
  severity: "normal" | "urgent";
  /** Talebin fiilen açıldığı an (epoch ms). */
  since: number;
};

/** Halkın sesi için gereken durum özeti; kaynağı istemcinin bağlamıdır. */
export type VoiceContext = VoiceSignals & { channelSpeed: number };

/**
 * Talep defterini durumla eşitler ve açık talepleri döndürür.
 *
 * Süre şartı OYUN saati cinsindendir: geçen gerçek süre channel hızıyla
 * çarpılır, yani ×24 channel'da halk 4 oyun saatini 10 gerçek dakikada
 * doldurur. Aksi hâlde hızlı channel'da halkın sesi hiç duyulmazdı.
 */
export async function syncPopulaceDemands(
  userId: string,
  context: VoiceContext,
  now: number,
): Promise<{ open: OpenDemand[]; closed: DemandKind[] }> {
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
        .set({ text: candidate.text, severity: candidate.severity, voice: candidate.voice })
        .where(and(eq(populaceDemands.userId, userId), eq(populaceDemands.kind, candidate.kind)));
      continue;
    }
    await db.insert(populaceDemands).values({
      userId, kind: candidate.kind, voice: candidate.voice,
      text: candidate.text, severity: candidate.severity, seenAt: now,
    }).onConflictDoNothing();
  }

  const opened = openDemands(candidates, held);
  // `openedAt` yalnızca ilk açılışta yazılır; süregelen talebin yaşı korunur ki
  // halk "üç gündür ekmek istiyoruz" diyebilsin.
  for (const demand of opened) {
    const existing = byKind.get(demand.kind);
    if (existing?.openedAt) continue;
    await db.update(populaceDemands).set({ openedAt: now })
      .where(and(eq(populaceDemands.userId, userId), eq(populaceDemands.kind, demand.kind)));
  }

  return {
    open: opened.map(demand => ({
      kind: demand.kind, voice: demand.voice, text: demand.text, severity: demand.severity,
      since: byKind.get(demand.kind)?.openedAt ?? now,
    })),
    closed,
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

/**
 * Halkın sesini modelin sistem promptuna girecek bloğa çevirir.
 *
 * SIFIR EK MODEL ÇAĞRISI: bu blok Kralın zaten başlattığı turun promptuna
 * biner. Kral konuşmazsa blok hiç yazılmaz ve harcanan token 0'dır.
 */
export function renderPopulaceVoice(open: OpenDemand[], now: number): string[] {
  if (!open.length) return [];
  return [
    "HALKIN SESİ — halkın ve kışlanın Kral'dan istedikleri. Bunlar senin taleplerin DEĞİL; sen yalnızca aktarıcısın. Uygun düştüğünde birini gündeme getir, hepsini sıralama. Halka emir verilmez: bir dilekçe süreci, ceza ya da bastırma aracı YOKTUR; talep ancak yönetimle kapanır.",
    renderDemands(open.map(demand => ({ text: withAge(demand, now), severity: demand.severity, voice: demand.voice }))),
  ];
}

function withAge(demand: OpenDemand, now: number) {
  const hours = Math.floor((now - demand.since) / 3_600_000);
  if (hours < 24) return demand.text;
  return `${demand.text} (${Math.floor(hours / 24)} gündür bekliyorlar)`;
}

export type { DemandCandidate };
