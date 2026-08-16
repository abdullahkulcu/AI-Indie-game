import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves, sessions, users } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
async function admin(request: Request) { const user = await currentUser(request); return user?.role === "admin" ? user : null; }

export async function GET(request: Request) {
  if (!(await admin(request))) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const db = getDb();
  const [playerRows, channelRows, memberships, saves] = await Promise.all([
    db.select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, status: users.status, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users).orderBy(users.createdAt),
    db.select({ id: channels.id, name: channels.name, slug: channels.slug, status: channels.status, speed: channels.speed, durationDays: channels.durationDays, maxPlayers: channels.maxPlayers, startsAt: channels.startsAt, endsAt: channels.endsAt }).from(channels).orderBy(channels.createdAt),
    db.select({ userId: channelMembers.userId, channelId: channelMembers.channelId, status: channelMembers.status }).from(channelMembers),
    db.select({ userId: gameSaves.userId, gameState: gameSaves.gameState, updatedAt: gameSaves.updatedAt }).from(gameSaves),
  ]);
  const saveMap = new Map(saves.map((save) => { try { const game = JSON.parse(save.gameState) as { kingdomName?: string }; return [save.userId, { kingdomName: game.kingdomName ?? "—", updatedAt: save.updatedAt }]; } catch { return [save.userId, { kingdomName: "Bozuk kayıt", updatedAt: save.updatedAt }]; } }));
  const nameMap = new Map(channelRows.map((channel) => [channel.id, channel.name]));
  return Response.json({
    players: playerRows.map((player) => ({ ...player, save: saveMap.get(player.id) ?? null, channels: memberships.filter((member) => member.userId === player.id && member.status === "active").map((member) => nameMap.get(member.channelId) ?? member.channelId) })),
    channels: channelRows.map((channel) => ({ ...channel, playerCount: memberships.filter((member) => member.channelId === channel.id && member.status === "active").length })),
  }, { headers: noStore });
}

export async function POST(request: Request) {
  const actor = await admin(request); if (!actor) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const body = await request.json() as { name?: string; speed?: number; durationDays?: number; maxPlayers?: number };
  const name = body.name?.trim() ?? "", speed = Number(body.speed), durationDays = Number(body.durationDays), maxPlayers = Number(body.maxPlayers);
  if (name.length < 3 || ![1, 4, 24].includes(speed) || durationDays < 1 || durationDays > 365 || maxPlayers < 2 || maxPlayers > 10_000) return Response.json({ error: "Channel alanları geçersiz." }, { status: 400, headers: noStore });
  const slug = `${name.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
  const startsAt = new Date(), endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
  const row = { id: crypto.randomUUID(), name, slug, speed, durationDays, maxPlayers, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), createdBy: actor.id };
  await getDb().insert(channels).values(row);
  return Response.json({ channel: { ...row, status: "active", playerCount: 0 } }, { status: 201, headers: noStore });
}

export async function PATCH(request: Request) {
  const actor = await admin(request); if (!actor) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const body = await request.json() as { type?: "player" | "channel"; id?: string; status?: "active" | "inactive" };
  if (!body.id || !["active", "inactive"].includes(body.status ?? "")) return Response.json({ error: "Geçersiz işlem." }, { status: 400, headers: noStore });
  if (body.type === "player") {
    if (body.id === actor.id && body.status === "inactive") return Response.json({ error: "Kendi admin hesabınızı pasife alamazsınız." }, { status: 400, headers: noStore });
    await getDb().update(users).set({ status: body.status! }).where(eq(users.id, body.id));
    if (body.status === "inactive") await getDb().delete(sessions).where(eq(sessions.userId, body.id));
  } else if (body.type === "channel") {
    await getDb().update(channels).set({ status: body.status! }).where(eq(channels.id, body.id));
    if (body.status === "inactive") await getDb().update(channelMembers).set({ status: "inactive" }).where(and(eq(channelMembers.channelId, body.id), eq(channelMembers.status, "active")));
  } else return Response.json({ error: "Geçersiz tür." }, { status: 400, headers: noStore });
  return Response.json({ updated: true }, { headers: noStore });
}
