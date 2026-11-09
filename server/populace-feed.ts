import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { gameSaves, populaceFeed } from "../db/schema";
import { compareVerdict, type CompareMetric } from "../engine/comparison";
import { deriveFeedCue, feedSourceKey, FEED_REFRESH_MS } from "../engine/populace-feed";
import { factionPressureOf } from "../engine/faction";
import { rates, tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { activeMembershipOf } from "./active-membership";
import { populaceCredentialFor } from "./populace-ai-desk";
import { populaceFeedNarrator, type FeedNarrator } from "./populace-feed-narrator";
import { populaceComparison } from "./world-projection";
import { parseStoredSave } from "./save-validation";
import { worldEventSummary } from "../engine/world-events";

export type PublicFeedItem = { id: string; kind: string; text: string; createdAt: number };

/** Kral ekranı yalnız kendi güncesini okur; feed hiçbir zaman General bağlamına katılmaz. */
export async function loadPopulaceFeed(userId: string, limit = 8): Promise<PublicFeedItem[]> {
  const rows = await getDb().select({ id: populaceFeed.id, kind: populaceFeed.kind, text: populaceFeed.text, createdAt: populaceFeed.createdAt })
    .from(populaceFeed).where(eq(populaceFeed.userId, userId)).orderBy(desc(populaceFeed.createdAt)).limit(limit);
  return rows;
}

function neighborWhisper(game: Game, userId: string, channelName: string, rows: Array<{ userId: string; gameState: string }>, now: number) {
  const comparison = populaceComparison({ channelName, userId, rows, now });
  if (!comparison?.averages) return null;
  const order: CompareMetric[] = ["foodRation", "popularity", "factionPressure", "taxRate"];
  for (const metric of order) {
    const verdict = compareVerdict(metric, comparison.mine[metric], comparison.averages[metric]);
    if (verdict === "worse" || verdict === "better") return verdict;
  }
  return null;
}

/**
 * Bir krallık için feed tazelemesi. Önce deterministik bağlam, sonra yalnızca
 * gereken anda model: aynı bağlam altı saat dolmadan tekrar token harcamaz.
 */
export async function refreshPopulaceFeed(input: { userId: string; game: Game; now: number; masterKey: string; channelName: string; channelId: string; channelRows: Array<{ userId: string; gameState: string }> }) {
  const game = tick(input.game, input.now);
  const cue = deriveFeedCue({
    foodRate: rates(game).food,
    constructionName: game.constructionQueue?.find(job => job.startedAt !== null)?.name ?? game.queue?.name ?? null,
    soldierUnrest: game.soldierUnrest ?? 0,
    factionPressure: factionPressureOf(game),
    worldEvent: worldEventSummary(game, input.now),
    neighborWhisper: neighborWhisper(game, input.userId, input.channelName, input.channelRows, input.now),
  });
  if (!cue) return { generated: false, reason: "Konuşmaya değer bir halk gündemi yok." };
  const sourceKey = feedSourceKey(cue, input.now);
  const [latest] = await getDb().select({ sourceKey: populaceFeed.sourceKey, createdAt: populaceFeed.createdAt })
    .from(populaceFeed).where(eq(populaceFeed.userId, input.userId)).orderBy(desc(populaceFeed.createdAt)).limit(1);
  if (latest?.sourceKey === sourceKey || (latest && input.now - latest.createdAt < FEED_REFRESH_MS && latest.sourceKey.split(":")[0] === cue.kind)) {
    return { generated: false, reason: "Aynı gündem henüz taze." };
  }
  const credential = await populaceCredentialFor(input.userId, input.masterKey);
  if (!credential) return { generated: false, reason: "Halk-AI kimliği bağlı değil." };
  const narrate: FeedNarrator = populaceFeedNarrator(credential);
  const text = await narrate(cue);
  if (!text) return { generated: false, reason: "Halk-AI bu turda konuşamadı." };
  const id = `feed:${input.userId}:${sourceKey}`;
  const inserted = await getDb().insert(populaceFeed).values({
    id, userId: input.userId, channelId: input.channelId, kind: cue.kind, text, sourceKey, createdAt: input.now,
  }).onConflictDoNothing().returning({ id: populaceFeed.id });
  return { generated: inserted.length > 0, reason: inserted.length ? "Halk güncesi yazıldı." : "Aynı gündem başka cron turunda yazıldı." };
}

/** Cron bütün kayıtları görür, fakat sadece anlamlı gündemi olan ve kimliği bağlı halk konuşur. */
export async function refreshDuePopulaceFeeds(now: number, masterKey: string) {
  const db = getDb();
  const saves = await db.select({ userId: gameSaves.userId, gameState: gameSaves.gameState }).from(gameSaves);
  const reports: Array<{ userId: string; generated: boolean }> = [];
  const rowsByChannel = new Map<string, Array<{ userId: string; gameState: string }>>();
  for (const save of saves) {
    const member = await activeMembershipOf(save.userId);
    if (!member) continue;
    const rows = rowsByChannel.get(member.channelId) ?? [];
    rows.push(save);
    rowsByChannel.set(member.channelId, rows);
  }
  for (const save of saves) {
    const game = parseStoredSave(save.gameState);
    if (!game) continue;
    const member = await activeMembershipOf(save.userId);
    if (!member) continue;
    const result = await refreshPopulaceFeed({ userId: save.userId, game: game as Game, now, masterKey, channelName: member.channelName, channelId: member.channelId, channelRows: rowsByChannel.get(member.channelId) ?? [] });
    reports.push({ userId: save.userId, generated: result.generated });
  }
  return reports;
}
