import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { currentUser } from "../../../server/account-auth";
import { getDb } from "../../../db";
import { gameSaves, referendums } from "../../../db/schema";
import { isReferendumTopic, referendumCooldownMs, referendumQuestion, referendumSupport, referendumVerdict } from "../../../engine/referendum";
import type { Game } from "../../../engine/types";
import { populaceCredentialFor } from "../../../server/populace-ai-desk";
import { narrateReferendum } from "../../../server/referendum-narrator";
import { parseStoredSave } from "../../../server/save-validation";
import { tick } from "../../../engine/tick";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

function publicRow(row: typeof referendums.$inferSelect) {
  return { id: row.id, topic: row.topic, question: row.question, support: row.support, verdict: row.verdict, text: row.text, askedAt: row.askedAt };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const [row] = await getDb().select().from(referendums).where(eq(referendums.userId, user.id)).orderBy(desc(referendums.askedAt)).limit(1);
  return Response.json({ result: row ? publicRow(row) : null }, { headers });
}

/** General'in araç çağrısı bu uca gelir; Kral sonucu görür ama oy bağlayıcı değildir. */
export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { topic?: unknown };
  if (!isReferendumTopic(body.topic)) return Response.json({ error: "Geçerli bir halk oylaması konusu gerekli." }, { status: 400, headers });
  const db = getDb();
  const [[save], [last]] = await Promise.all([
    db.select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1),
    db.select().from(referendums).where(eq(referendums.userId, user.id)).orderBy(desc(referendums.askedAt)).limit(1),
  ]);
  const stored = save ? parseStoredSave(save.gameState) : null;
  if (!stored) return Response.json({ error: "Geçerli krallık kaydı gerekli." }, { status: 409, headers });
  const now = Date.now();
  const game = tick(stored as Game, now);
  const remaining = last ? referendumCooldownMs(game.speed) - (now - last.askedAt) : 0;
  if (remaining > 0) return Response.json({ error: `Halk son oylamanın ardından henüz dinleniyor; ${Math.ceil(remaining / 3_600_000)} saat sonra yeniden sorabilirsiniz.` }, { status: 429, headers });
  const credential = await populaceCredentialFor(user.id, env.BYOK_MASTER_KEY);
  if (!credential) return Response.json({ error: "Halk-AI kimliği bağlı değil; halk oylaması yapılamaz." }, { status: 409, headers });
  const support = referendumSupport({ topic: body.topic, popularity: game.popularity, factionPressure: game.factionPressure, taxRate: game.taxRate, foodRation: game.foodRation });
  const verdict = referendumVerdict(support);
  const text = await narrateReferendum(credential, body.topic, verdict);
  if (!text) return Response.json({ error: "Halk sözcüsü bu oylamada tamamlanmış bir yanıt veremedi." }, { status: 503, headers });
  const row = { id: crypto.randomUUID(), userId: user.id, topic: body.topic, question: referendumQuestion(body.topic), support, verdict, text, askedAt: now };
  await db.insert(referendums).values(row);
  return Response.json({ result: publicRow(row) }, { status: 201, headers });
}
