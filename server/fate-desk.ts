import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { fateEvents, gameSaves } from "../db/schema";
import { fateCueOf, fateSourceKey, type FateKind } from "../engine/fate";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { activeMembershipOf } from "./active-membership";
import { parseStoredSave } from "./save-validation";

export type FateEvent = {
  id: string;
  kind: FateKind;
  title: string;
  text: string;
  discussion: string;
  status: "open" | "discussed" | "deferred";
  openedAt: number;
};

function publicEvent(row: typeof fateEvents.$inferSelect): FateEvent | null {
  if (row.kind !== "defiant_opposition" && row.kind !== "empty_tables" && row.kind !== "garrison_breaking") return null;
  if (row.status !== "open" && row.status !== "discussed" && row.status !== "deferred") return null;
  return { id: row.id, kind: row.kind, title: row.title, text: row.text, discussion: row.discussion, status: row.status, openedAt: row.openedAt };
}

/** Kralın ekranı yalnız son açık Kader anını okur; burada model çağrısı yoktur. */
export async function openFateFor(userId: string): Promise<FateEvent | null> {
  const [row] = await getDb().select().from(fateEvents)
    .where(eq(fateEvents.userId, userId)).orderBy(desc(fateEvents.openedAt)).limit(1);
  const event = row ? publicEvent(row) : null;
  return event?.status === "open" ? event : null;
}

/** Kral ikilemi Generalle konuşmayı seçer ya da şimdilik erteler; ferman yoktur. */
export async function resolveFateEvent(userId: string, id: string, choice: "discuss" | "defer", now: number) {
  const [row] = await getDb().select().from(fateEvents).where(eq(fateEvents.id, id)).limit(1);
  if (!row || row.userId !== userId || row.status !== "open") return null;
  const status = choice === "discuss" ? "discussed" as const : "deferred" as const;
  const [updated] = await getDb().update(fateEvents).set({ status, resolvedAt: now })
    .where(eq(fateEvents.id, id)).returning();
  return updated ? publicEvent(updated) : null;
}

/** Cron her kaydı denetler; aynı sezon ve eşik için yalnız ilk olay yazılır. */
export async function refreshDueFateEvents(now: number) {
  const rows = await getDb().select({ userId: gameSaves.userId, gameState: gameSaves.gameState }).from(gameSaves);
  const reports: Array<{ userId: string; created: boolean }> = [];
  for (const row of rows) {
    const member = await activeMembershipOf(row.userId);
    if (!member) continue;
    const stored = parseStoredSave(row.gameState);
    if (!stored) continue;
    const game = tick(stored as Game, now);
    const cue = fateCueOf(game);
    if (!cue) { reports.push({ userId: row.userId, created: false }); continue; }
    const sourceKey = fateSourceKey(game, cue);
    const inserted = await getDb().insert(fateEvents).values({
      id: `fate:${row.userId}:${sourceKey}`, userId: row.userId, channelId: member.channelId,
      kind: cue.kind, sourceKey, title: cue.title, text: cue.text, discussion: cue.discussion,
      status: "open", openedAt: now,
    }).onConflictDoNothing().returning({ id: fateEvents.id });
    reports.push({ userId: row.userId, created: inserted.length > 0 });
  }
  return reports;
}
