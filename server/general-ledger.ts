import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { generalLedger, generalRequests } from "../db/schema";
import {
  LEDGER_LIMIT, type LedgerEntry, type LedgerKind,
  pruneLedger, recordEvents, renderLedger,
} from "../engine/ledger";
import { type DerivedRequest, type RequestKind, renderRequests } from "../engine/general-requests";

/**
 * Defterin ve taleplerin kalıcılığı. Karar mantığı `engine/ledger.ts` ile
 * `engine/general-requests.ts` içinde saf durur; burada yalnızca okuma/yazma var.
 */

/** Kral'a ve modele gösterilecek talep biçimi; API cevabındaki `requests` alanı. */
export type OpenRequest = {
  id: string;
  kind: RequestKind;
  text: string;
  severity: "normal" | "urgent";
  /** Talebin ilk açıldığı an (epoch ms). */
  since: number;
};

export async function loadLedger(userId: string): Promise<LedgerEntry[]> {
  const rows = await getDb().select().from(generalLedger).where(eq(generalLedger.userId, userId));
  return rows.map(row => ({
    kind: row.kind as LedgerKind,
    weight: row.weight,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  }));
}

/**
 * Olayları deftere işler ve sınırı aşan maddeleri siler.
 * Değişmeyen satırlara hiç yazılmaz; her istekte gereksiz UPDATE üretmemek için.
 */
export async function appendToLedger(userId: string, kinds: LedgerKind[], now: number): Promise<LedgerEntry[]> {
  if (!kinds.length) return loadLedger(userId);
  const before = await loadLedger(userId);
  const merged = pruneLedger(recordEvents(before, kinds, now), LEDGER_LIMIT);

  const db = getDb();
  const changed = merged.filter(entry => {
    const previous = before.find(item => item.kind === entry.kind);
    return !previous || previous.weight !== entry.weight || previous.lastSeenAt !== entry.lastSeenAt;
  });
  for (const entry of changed) {
    const values = {
      userId, kind: entry.kind, weight: entry.weight,
      firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt,
    };
    await db.insert(generalLedger).values(values).onConflictDoUpdate({
      target: [generalLedger.userId, generalLedger.kind],
      set: { weight: values.weight, lastSeenAt: values.lastSeenAt },
    });
  }

  // Budamada düşen maddeler tablodan da silinir; aksi halde tablo sınırsız büyür.
  const dropped = before.filter(entry => !merged.some(item => item.kind === entry.kind)).map(entry => entry.kind);
  if (dropped.length) {
    await db.delete(generalLedger)
      .where(and(eq(generalLedger.userId, userId), inArray(generalLedger.kind, dropped)));
  }
  return merged;
}

export async function loadOpenRequests(userId: string): Promise<OpenRequest[]> {
  const rows = await getDb().select().from(generalRequests).where(eq(generalRequests.userId, userId));
  return rows.map(toOpenRequest).sort(bySeverityThenAge);
}

/**
 * Talep listesini durumla eşitler: yeni koşullar açılır, düzelen koşullar
 * kapanır. `since` yalnızca yeni açılan talepte bugüne kurulur; süregelen
 * talebin yaşı korunur ki General "üç gündür istiyorum" diyebilsin.
 *
 * Dönen `resolved`, koşulu düzeldiği için kapanan taleplerdir; çağıran taraf
 * bunların Kral'ın emriyle mi yoksa kendiliğinden mi kapandığını ayırt eder.
 */
export async function syncRequests(
  userId: string,
  derived: DerivedRequest[],
  now: number,
): Promise<{ open: OpenRequest[]; resolved: RequestKind[] }> {
  const db = getDb();
  const existing = await getDb().select().from(generalRequests).where(eq(generalRequests.userId, userId));
  const existingKinds = new Set(existing.map(row => row.kind));
  const derivedKinds = new Set<string>(derived.map(request => request.kind));

  for (const request of derived) {
    if (existingKinds.has(request.kind)) {
      // Metin ve aciliyet tazelenir; `raisedAt` korunur.
      await db.update(generalRequests)
        .set({ text: request.text, severity: request.severity })
        .where(and(eq(generalRequests.userId, userId), eq(generalRequests.kind, request.kind)));
      continue;
    }
    await db.insert(generalRequests)
      .values({ userId, kind: request.kind, text: request.text, severity: request.severity, raisedAt: now })
      .onConflictDoNothing();
  }

  const resolved = existing.filter(row => !derivedKinds.has(row.kind)).map(row => row.kind as RequestKind);
  if (resolved.length) {
    await db.delete(generalRequests)
      .where(and(eq(generalRequests.userId, userId), inArray(generalRequests.kind, resolved)));
  }

  const open = derived.map(request => ({
    id: `${request.kind}`,
    kind: request.kind,
    text: request.text,
    severity: request.severity,
    since: existing.find(row => row.kind === request.kind)?.raisedAt ?? now,
  }));
  return { open: open.sort(bySeverityThenAge), resolved };
}

const toOpenRequest = (row: typeof generalRequests.$inferSelect): OpenRequest => ({
  id: row.kind,
  kind: row.kind as RequestKind,
  text: row.text,
  severity: row.severity,
  since: row.raisedAt,
});

/** Acil talepler önce, sonra en eskiden yeniye: en uzun süredir bekleyen üstte. */
const bySeverityThenAge = (a: OpenRequest, b: OpenRequest) =>
  (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1) || a.since - b.since;

/**
 * Defteri ve talepleri modelin sistem promptuna girecek bloğa çevirir.
 * Boş bölümler hiç yazılmaz; her istekte gönderildiği için token'a dikkat edilir.
 */
export function renderGeneralMemory(entries: LedgerEntry[], requests: OpenRequest[], now: number): string[] {
  const lines: string[] = [];
  const ledger = renderLedger(entries, now);
  if (ledger) {
    lines.push(
      "DEFTERİN — Kral hakkında zamanla biriktirdiğin gözlemler. Bunlar senin hafızan; uygun düştüğünde geçmişe atıfta bulun ama her cevapta sicil okuma.",
      ledger,
    );
  }
  if (requests.length) {
    lines.push(
      "SENİN TALEPLERİN — krallığın durumundan doğan, Kral'dan istediğin şeyler. Konuşma uygun düştüğünde bunlardan birini KENDİN gündeme getir; Kral sormasa bile hatırlat. Hepsini birden sıralama, en fazla birini öne çıkar.",
      renderRequests(requests.map(request => ({ text: withAge(request, now), severity: request.severity }))),
    );
  }
  return lines;
}

function withAge(request: OpenRequest, now: number) {
  const hours = Math.floor((now - request.since) / 3_600_000);
  if (hours < 24) return request.text;
  return `${request.text} (${Math.floor(hours / 24)} gündür bekliyorum)`;
}
