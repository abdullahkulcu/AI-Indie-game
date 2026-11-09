import { and, eq } from "drizzle-orm";
import { currentUser } from "../../../server/account-auth";
import { getDb } from "../../../db";
import { factionCoalitions, gameSaves } from "../../../db/schema";
import { factionSettlement } from "../../../engine/faction";
import { applyPolicy } from "../../../engine/policy";
import { tick } from "../../../engine/tick";
import type { Game } from "../../../engine/types";
import { coalitionFor } from "../../../server/faction-coalition";
import { parseStoredSave } from "../../../server/save-validation";
import { writeSaveIfUnchanged } from "../../../server/save-write";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

/** Ekran açılışı sadece açık masayı okur; Halk-AI çağrısı cron'a aittir. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  return Response.json({ demand: await coalitionFor(user.id) }, { headers });
}

/**
 * Kralın yanıtı metni değil, motorun önceden tanımlı politika sonucunu uygular.
 * Böylece masa bir sohbet kısayolu değil, sürüm korumalı gerçek bir oyun kararıdır.
 */
export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { decision?: "accept" | "decline" };
  if (body.decision !== "accept" && body.decision !== "decline") return Response.json({ error: "Masa için kabul veya ret gerekli." }, { status: 400, headers });
  const db = getDb();
  const [row, saved] = await Promise.all([
    db.select().from(factionCoalitions).where(and(eq(factionCoalitions.userId, user.id), eq(factionCoalitions.status, "open"))).limit(1),
    db.select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1),
  ]).then(([coalitions, saves]) => [coalitions[0], saves[0]] as const);
  if (!row) return Response.json({ error: "Yanıt bekleyen bir koalisyon talebi yok." }, { status: 409, headers });
  if (!saved) return Response.json({ error: "Krallık kaydı bulunamadı." }, { status: 409, headers });
  if ((row.policyKey !== "taxRate" && row.policyKey !== "foodRation") || !Number.isFinite(row.policyValue)) return Response.json({ error: "Koalisyon talebi geçersiz." }, { status: 409, headers });
  const base = parseStoredSave(saved.gameState);
  if (!base) return Response.json({ error: "Krallık kaydı okunamadı." }, { status: 409, headers });
  const now = Date.now();
  const current = tick(base as Game, now);
  const outcome = factionSettlement(current.factionPressure ?? 0, body.decision, row.refusalCount);
  const afterPolicy = body.decision === "accept"
    ? applyPolicy(current, { key: row.policyKey, value: row.policyValue }, now).game
    : current;
  const result: Game = {
    ...afterPolicy,
    factionPressure: outcome.pressure,
    notices: [{
      kind: "MUHALEFET",
      text: body.decision === "accept"
        ? "Koalisyon masasında uzlaşıldı; meydandaki baskı şimdilik çekildi."
        : "Koalisyon talebi geri çevrildi; meydandaki sözcüler daha sert konuşmaya başladı.",
      at: now,
    }, ...afterPolicy.notices].slice(0, 20),
  };
  const written = await writeSaveIfUnchanged(user.id, saved.revision, result);
  if (!written) return Response.json({ error: "Krallık durumu değişti; ekranı yenileyip yeniden deneyin." }, { status: 409, headers });
  if (body.decision === "accept") {
    await db.update(factionCoalitions).set({ status: "accepted", lastAnsweredAt: now }).where(and(eq(factionCoalitions.userId, user.id), eq(factionCoalitions.status, "open")));
  } else {
    await db.update(factionCoalitions).set({ refusalCount: row.refusalCount + 1, lastAnsweredAt: now }).where(and(eq(factionCoalitions.userId, user.id), eq(factionCoalitions.status, "open")));
  }
  return Response.json({ game: result, revision: saved.revision + 1, demand: body.decision === "decline" ? await coalitionFor(user.id) : null }, { headers });
}
