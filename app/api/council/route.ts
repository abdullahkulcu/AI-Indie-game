import { currentUser } from "../../../server/account-auth";
import { acknowledgeBriefing, acknowledgeFallbackBriefing, briefingFor, recentCouncilMeetingsFor, requestCouncilCall } from "../../../server/council-briefing";
import { getDb } from "../../../db";
import { gameSaves } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { parseStoredSave } from "../../../server/save-validation";
import type { Game } from "../../../engine/types";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

/** Ekran açılışı yalnızca önbellekteki Divan belgesini OKUR; model çağırmaz. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const [briefing, meetings] = await Promise.all([briefingFor(user.id), recentCouncilMeetingsFor(user.id)]);
  return Response.json({ briefing, meetings }, { headers });
}

/** Kralın gündemi gördüğünü işaretler. Bir sonraki anlamlı cron değişimi yeni belge üretebilir. */
export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { action?: string };
  if (body.action !== "acknowledge" && body.action !== "call") return Response.json({ error: "Bu Divan işlemi tanınmıyor." }, { status: 400, headers });
  const now = Date.now();
  if (body.action === "call") {
    const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
    const game = save ? parseStoredSave(save.gameState) : null;
    if (!game) return Response.json({ error: "Divan çağrısı için geçerli krallık kaydı gerekli." }, { status: 409, headers });
    const result = await requestCouncilCall(user.id, game as Game, now);
    if ("error" in result) return Response.json(result, { status: 409, headers });
    return Response.json({ briefing: result.briefing, meetings: await recentCouncilMeetingsFor(user.id), scheduledAt: result.scheduledAt, alreadyScheduled: result.alreadyScheduled }, { headers });
  }
  const briefing = await briefingFor(user.id);
  if (briefing && briefing.sessionStage !== "concluded") {
    return Response.json({ error: "Divan oturumu henüz sürüyor; General sonucu Kralın önüne getirdiğinde gündem kapanabilir." }, { status: 409, headers });
  }
  const existing = await acknowledgeBriefing(user.id, now);
  if (existing) return Response.json({ briefing: existing, meetings: await recentCouncilMeetingsFor(user.id) }, { headers });
  const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  const game = save ? parseStoredSave(save.gameState) : null;
  if (!game) return Response.json({ error: "Gündemi kapatmak için geçerli krallık kaydı gerekli." }, { status: 409, headers });
  // Eski bulut kayıtlarında artık kullanılmayan quota alanı bulunmayabilir.
  // Divan özeti bu alanı okumaz; kayıt şema tarafından doğrulanmış olduğundan
  // burada güncel motor görünümüne daraltmak güvenlidir.
  return Response.json({ briefing: await acknowledgeFallbackBriefing(user.id, game as Game, now), meetings: await recentCouncilMeetingsFor(user.id) }, { headers });
}
