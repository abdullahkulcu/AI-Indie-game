import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves, sharedMines, sharedMineWorkers } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { projectPublicKingdom } from "../../../server/world-projection";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function context(userId: string, channelId: string) {
  const [channel] = await getDb().select({ id: channels.id, name: channels.name, speed: channels.speed }).from(channels).where(and(eq(channels.id, channelId), eq(channels.status, "active"))).limit(1);
  if (!channel) return null;
  const [member] = await getDb().select().from(channelMembers).where(and(eq(channelMembers.userId, userId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!member) return null;
  const id = `mine:${channel.id}`;
  await getDb().insert(sharedMines).values({ id, channelId: channel.id, lastTickAt: Date.now() }).onConflictDoNothing();
  const [mine] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, id)).limit(1);
  return mine ? { channel, mine } : null;
}

async function tickMine(mine: typeof sharedMines.$inferSelect, speed: number) {
  const workers = await getDb().select({ total: sql<number>`coalesce(sum(${sharedMineWorkers.workers}), 0)` }).from(sharedMineWorkers).where(eq(sharedMineWorkers.mineId, mine.id));
  const totalWorkers = Number(workers[0]?.total ?? 0), elapsedHours = Math.min(6, Math.max(0, (Date.now() - mine.lastTickAt) / 3_600_000));
  const produced = Math.min(mine.oreRemaining, Math.floor(totalWorkers * 4 * speed * elapsedHours));
  if (produced > 0 || Date.now() - mine.lastTickAt > 30_000) await getDb().update(sharedMines).set({ oreRemaining: mine.oreRemaining - produced, extractedOre: mine.extractedOre + produced, lastTickAt: Date.now() }).where(eq(sharedMines.id, mine.id));
  return { ...mine, oreRemaining: mine.oreRemaining - produced, extractedOre: mine.extractedOre + produced, totalWorkers };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim();
  if (!channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  const mine = await tickMine(value.mine, value.channel.speed);
  const rows = await getDb().select({ userId: sharedMineWorkers.userId, workers: sharedMineWorkers.workers, gameState: gameSaves.gameState }).from(sharedMineWorkers).innerJoin(gameSaves, eq(gameSaves.userId, sharedMineWorkers.userId)).where(eq(sharedMineWorkers.mineId, mine.id));
  const participants = rows.flatMap(row => {
    const kingdom = projectPublicKingdom(row.userId, row.gameState, value.channel.name);
    return kingdom ? [{ id: row.userId, name: kingdom.name, workers: row.workers, self: row.userId === user.id }] : [];
  });
  return response({ mine: { id: mine.id, name: mine.name, oreRemaining: mine.oreRemaining, extractedOre: mine.extractedOre, totalWorkers: mine.totalWorkers, position: { x: -52, z: 8 } }, participants });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as { channelId?: string; action?: "join" | "leave"; workers?: number };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, body.channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  await tickMine(value.mine, value.channel.speed);
  if (body.action === "leave") {
    await getDb().delete(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, value.mine.id), eq(sharedMineWorkers.userId, user.id)));
    return response({ working: false });
  }
  if (body.action !== "join") return response({ error: "Geçersiz maden emri." }, 400);
  const workers = Math.max(1, Math.min(20, Math.floor(Number(body.workers) || 5)));
  await getDb().insert(sharedMineWorkers).values({ mineId: value.mine.id, userId: user.id, workers }).onConflictDoUpdate({ target: [sharedMineWorkers.mineId, sharedMineWorkers.userId], set: { workers } });
  return response({ working: true, workers });
}
