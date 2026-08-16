import { and, desc, eq, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves, intelDefenses, intelMissions } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { projectPublicKingdom, worldPosition } from "../../../server/world-projection";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function channelFor(userId: string, channelId: string) {
  const [channel] = await getDb().select({ id: channels.id, name: channels.name, speed: channels.speed }).from(channels).where(and(eq(channels.id, channelId), eq(channels.status, "active"))).limit(1);
  if (!channel) return null;
  const [membership] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, userId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  return membership ? channel : null;
}

async function resolveDueMissions(userId: string, channelId: string, channelName: string) {
  const due = await getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channelId), eq(intelMissions.status, "pending"), lte(intelMissions.completesAt, Date.now()), or(eq(intelMissions.sourceUserId, userId), eq(intelMissions.targetUserId, userId))));
  for (const mission of due) {
    const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, mission.targetUserId)).limit(1);
    const snapshot = save ? projectPublicKingdom(mission.targetUserId, save.gameState, channelName) : null;
    const succeeded = Boolean(snapshot) && crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 100 < mission.successChance;
    const detected = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 100 < mission.detectionChance;
    const status = succeeded ? "succeeded" as const : detected ? "detected" as const : "failed" as const;
    await getDb().update(intelMissions).set({ status, report: succeeded && snapshot ? JSON.stringify(snapshot) : null, resolvedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(intelMissions.id, mission.id), eq(intelMissions.status, "pending")));
  }
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim();
  if (!channelId) return response({ error: "Channel gerekli." }, 400);
  const channel = await channelFor(user.id, channelId);
  if (!channel) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  await resolveDueMissions(user.id, channel.id, channel.name);
  const [rows, missions, defense, incoming] = await Promise.all([
    getDb().select({ userId: channelMembers.userId, gameState: gameSaves.gameState }).from(channelMembers).innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId)).where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"), ne(channelMembers.userId, user.id))).orderBy(channelMembers.joinedAt),
    getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.sourceUserId, user.id))).orderBy(desc(intelMissions.completesAt)),
    getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, user.id)).limit(1),
    getDb().select({ id: intelMissions.id }).from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.targetUserId, user.id), eq(intelMissions.status, "detected"))).limit(10),
  ]);
  const latest = new Map<string, typeof missions[number]>();
  missions.forEach(mission => { if (!latest.has(mission.targetUserId)) latest.set(mission.targetUserId, mission); });
  const kingdoms = rows.flatMap(row => {
    const snapshot = projectPublicKingdom(row.userId, row.gameState, channel.name);
    if (!snapshot) return [];
    const mission = latest.get(row.userId), discovered = mission?.status === "succeeded";
    let report: typeof snapshot | null = null;
    if (discovered && mission?.report) try { report = JSON.parse(mission.report) as typeof snapshot; } catch { report = null; }
    return [{ id: snapshot.id, name: discovered ? snapshot.name : null, terrain: snapshot.terrain, position: worldPosition(channel.id, snapshot.id), discovered, mission: mission ? { status: mission.status, completesAt: mission.completesAt, successChance: mission.successChance } : null, report }];
  });
  return response({ channel, kingdoms, defense: { active: Boolean(defense[0]?.activeUntil && defense[0].activeUntil > Date.now()), activeUntil: defense[0]?.activeUntil ?? null }, incomingAlerts: incoming.length });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as { action?: "scout" | "defend"; channelId?: string; targetId?: string };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const channel = await channelFor(user.id, body.channelId);
  if (!channel) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  if (body.action === "defend") {
    const activeUntil = Date.now() + 3_600_000;
    await getDb().insert(intelDefenses).values({ userId: user.id, level: 1, activeUntil }).onConflictDoUpdate({ target: intelDefenses.userId, set: { level: 1, activeUntil, updatedAt: sql`CURRENT_TIMESTAMP` } });
    return response({ defended: true, activeUntil });
  }
  if (body.action !== "scout" || !body.targetId || body.targetId === user.id) return response({ error: "Geçersiz keşif hedefi." }, 400);
  const [target] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, body.targetId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!target) return response({ error: "Hedef bu channel'da değil." }, 404);
  const [recent] = await getDb().select().from(intelMissions).where(and(eq(intelMissions.sourceUserId, user.id), eq(intelMissions.targetUserId, target.userId))).orderBy(desc(intelMissions.completesAt)).limit(1);
  if (recent && recent.completesAt > Date.now() - 300_000) return response({ error: recent.status === "pending" ? "Ajan zaten yolda." : "Yeni ajan göndermek için beş dakika beklemelisiniz." }, 429);
  const [targetDefense] = await getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, target.userId)).limit(1);
  const defended = Boolean(targetDefense?.activeUntil && targetDefense.activeUntil > Date.now()), successChance = defended ? 3 : 10, detectionChance = defended ? 75 : 30;
  const completesAt = Date.now() + Math.max(15_000, Math.round(90_000 / Math.max(1, channel.speed)));
  await getDb().insert(intelMissions).values({ id: crypto.randomUUID(), channelId: channel.id, sourceUserId: user.id, targetUserId: target.userId, successChance, detectionChance, completesAt });
  return response({ sent: true, completesAt, successChance });
}
