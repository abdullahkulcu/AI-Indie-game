import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../db";
import { gameSaves, negotiationMessages, negotiations } from "../db/schema";
import { sideOf, type Negotiation, type Side, type Terms } from "../engine/negotiation";
import { projectPublicKingdom } from "./world-projection";
import { briefTable, type DeskMessage, type TableBrief } from "./negotiation-brief";

/**
 * Masaların veritabanından okunuşu.
 *
 * Sıralama BİR yerde durur. Kralın arayüzü, Kralın Generali ve Kral yokken
 * konuşan General aynı listeyi aynı sırada görür; aksi halde araç çağrısındaki
 * `table_ordinal` üç yerde üç farklı masaya denk gelirdi.
 */

/** Bir Kralın önünde duran masa sayısı; arayüz de model de bu kadarını görür. */
export const TABLE_LIST_LIMIT = 20;

export type DeskRow = { negotiation: Negotiation; messages: DeskMessage[]; side: Side };

/** Satırı motorun anladığı biçime çevirir. Bozuk JSON şartı yok sayılır. */
export function toEngine(row: typeof negotiations.$inferSelect): Negotiation {
  let proposed: Terms | null = null;
  try { proposed = row.proposed ? JSON.parse(row.proposed) as Terms : null; } catch { proposed = null; }
  return {
    id: row.id, channelId: row.channelId, initiatorId: row.initiatorId, targetId: row.targetId,
    topic: row.topic, status: row.status, turns: row.turns,
    proposed, proposedBy: row.proposedBy,
    openedAt: row.openedAt, expiresAt: row.expiresAt, lastTurnAt: row.lastTurnAt,
  };
}

/** Bu Kralın masaları, kanonik sırada (en son konuşulan en üstte). */
export async function loadTablesFor(userId: string, channelId: string): Promise<DeskRow[]> {
  const db = getDb();
  const rows = await db.select().from(negotiations)
    .where(and(
      eq(negotiations.channelId, channelId),
      or(eq(negotiations.initiatorId, userId), eq(negotiations.targetId, userId)),
    ))
    .orderBy(desc(negotiations.lastTurnAt)).limit(TABLE_LIST_LIMIT);
  if (!rows.length) return [];

  const messages = await db.select().from(negotiationMessages)
    .where(inArray(negotiationMessages.negotiationId, rows.map(row => row.id)))
    .orderBy(negotiationMessages.at);

  return rows.map(row => ({
    negotiation: toEngine(row),
    side: sideOf(row, userId)!,
    messages: messages.filter(message => message.negotiationId === row.id)
      .map(message => ({ side: message.side, speaker: message.speaker, body: message.body, at: message.at })),
  }));
}

/**
 * Karşı krallığın gösterilecek adı. Keşfedilmemişse isim verilmez — müzakere,
 * ajanla yapılan keşfin yerini tutmaz.
 */
export async function displayNameOf(userId: string, channelName: string) {
  const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
  const kingdom = save ? projectPublicKingdom(userId, save.gameState, channelName) : null;
  return kingdom?.name ?? "Bilinmeyen Sancak";
}

/** Masaları modele gösterilecek özete çevirir; sıra numaraları listeyle aynıdır. */
export async function briefsFor(userId: string, channelId: string, channelName: string): Promise<TableBrief[]> {
  const desk = await loadTablesFor(userId, channelId);
  // Kendi krallığımızın adı; General bunu bilmezse imzalayacak isim bulamıyor.
  const own = await displayNameOf(userId, channelName);
  return Promise.all(desk.map(async (row, index) => briefTable({
    own,
    negotiation: row.negotiation,
    messages: row.messages,
    side: row.side,
    counterpart: await displayNameOf(row.side === "initiator" ? row.negotiation.targetId : row.negotiation.initiatorId, channelName),
    ordinal: index + 1,
  })));
}
