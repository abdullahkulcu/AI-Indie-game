import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { parseTimestamp, parseStoredSave, validateGameSave } from "../../../server/save-validation";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** Oyuncunun gerçekten üye olduğu aktif channel; kayıttaki channel iddiası buna karşı doğrulanır. */
async function activeChannel(userId: string) {
  const [row] = await getDb().select({ name: channels.name, speed: channels.speed })
    .from(channelMembers).innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(eq(channelMembers.userId, userId), eq(channelMembers.status, "active"), eq(channels.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const [save] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  if (!save) return Response.json({ game: null, user: { displayName: user.displayName } }, { headers: noStore });
  const game = parseStoredSave(save.gameState);
  // Bozuk veya artık şemaya uymayan kayıt istemciyi kilitlemesin: kayıt yokmuş gibi
  // davranıp kuruluş akışına düşürürüz.
  if (!game) {
    return Response.json({ game: null, corrupt: true, user: { displayName: user.displayName } }, { headers: noStore });
  }
  return Response.json({ game, revision: save.revision, updatedAt: save.updatedAt, user: { displayName: user.displayName } }, { headers: noStore });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const body = await request.json() as { game?: unknown };

  const [existing] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  const channel = await activeChannel(user.id);
  const result = validateGameSave(body.game, {
    previous: existing ? parseStoredSave(existing.gameState) : null,
    previousUpdatedAt: existing ? parseTimestamp(existing.updatedAt) : null,
    channelSpeed: channel?.speed ?? 1,
    channelName: channel?.name ?? null,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: noStore });

  const encoded = JSON.stringify(result.game);
  if (encoded.length > 200_000) return Response.json({ error: "Oyun kaydı çok büyük." }, { status: 413, headers: noStore });
  await getDb().insert(gameSaves).values({ userId: user.id, gameState: encoded }).onConflictDoUpdate({
    target: gameSaves.userId,
    set: { gameState: encoded, revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` },
  });
  return Response.json({ saved: true }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  await getDb().delete(gameSaves).where(eq(gameSaves.userId, user.id));
  return Response.json({ deleted: true }, { headers: noStore });
}
