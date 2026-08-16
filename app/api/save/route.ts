import { eq, sql } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { gameSaves } from "../../../db/schema";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const [save] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.userId)).limit(1);
  if (!save) return Response.json({ game: null, user: { displayName: user.displayName } }, { headers: noStore });
  try {
    return Response.json({ game: JSON.parse(save.gameState), revision: save.revision, updatedAt: save.updatedAt, user: { displayName: user.displayName } }, { headers: noStore });
  } catch {
    return Response.json({ error: "Bulut kaydı okunamadı." }, { status: 500, headers: noStore });
  }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const body = await request.json() as { game?: unknown };
  const game = body.game as { version?: number; kingdomName?: string } | undefined;
  if (!game || game.version !== 2 || typeof game.kingdomName !== "string") {
    return Response.json({ error: "Geçersiz oyun kaydı." }, { status: 400, headers: noStore });
  }
  const encoded = JSON.stringify(game);
  if (encoded.length > 200_000) return Response.json({ error: "Oyun kaydı çok büyük." }, { status: 413, headers: noStore });
  await getDb().insert(gameSaves).values({ userId: user.userId, gameState: encoded }).onConflictDoUpdate({
    target: gameSaves.userId,
    set: { gameState: encoded, revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` },
  });
  return Response.json({ saved: true }, { headers: noStore });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  await getDb().delete(gameSaves).where(eq(gameSaves.userId, user.userId));
  return Response.json({ deleted: true }, { headers: noStore });
}
