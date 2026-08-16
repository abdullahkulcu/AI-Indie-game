import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const rows = await getDb().select({ id: channels.id, name: channels.name, slug: channels.slug, speed: channels.speed, durationDays: channels.durationDays, maxPlayers: channels.maxPlayers, startsAt: channels.startsAt, endsAt: channels.endsAt, players: sql<number>`count(${channelMembers.userId})` })
    .from(channels).leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.status, "active")))
    .where(eq(channels.status, "active")).groupBy(channels.id).orderBy(channels.createdAt);
  return Response.json({ channels: rows }, { headers: noStore });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const body = await request.json() as { channelId?: string };
  if (!body.channelId) return Response.json({ error: "Channel gerekli." }, { status: 400, headers: noStore });
  const [channel] = await getDb().select().from(channels).where(and(eq(channels.id, body.channelId), eq(channels.status, "active"))).limit(1);
  if (!channel) return Response.json({ error: "Channel aktif değil." }, { status: 404, headers: noStore });
  const [{ count }] = await getDb().select({ count: sql<number>`count(*)` }).from(channelMembers).where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"), ne(channelMembers.userId, user.id)));
  if (Number(count) >= channel.maxPlayers) return Response.json({ error: "Channel dolu." }, { status: 409, headers: noStore });
  await getDb().update(channelMembers).set({ status: "inactive" }).where(and(eq(channelMembers.userId, user.id), eq(channelMembers.status, "active")));
  await getDb().insert(channelMembers).values({ userId: user.id, channelId: channel.id }).onConflictDoUpdate({ target: [channelMembers.userId, channelMembers.channelId], set: { status: "active" } });
  return Response.json({ joined: true }, { headers: noStore });
}
