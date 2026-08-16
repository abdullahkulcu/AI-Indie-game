import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { applyActions } from "../../../engine/actions";
import { tick } from "../../../engine/tick";
import type { Game, GameAction } from "../../../engine/types";
import { getDb } from "../../../db";
import { channels, gameSaves, llmCredentials, pendingDecisions, standingOrders } from "../../../db/schema";
import { decryptByok } from "../../../server/byok-crypto";
import { compactContext, rollDailyWindow, shouldWake, type StandingOrder } from "../../../server/night-shift";
import { parseStoredSave } from "../../../server/save-validation";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

type WakeReport = { userId: string; acted: boolean; detail: string; tokensUsed: boolean };

/** Gece vardiyasında General yalnızca bu araçları kullanabilir; hepsi tek adımlıktır. */
const nightTools = [
  { name: "build_structure", description: "Bir yapı kurar veya bir seviye yükseltir.", parameters: { type: "object", properties: { building_type: { type: "string" }, target_level: { type: "integer" } }, required: ["building_type", "target_level"], additionalProperties: false } },
  { name: "train_unit", description: "Mızrakçı eğitir.", parameters: { type: "object", properties: { unit_type: { type: "string", enum: ["spearman"] }, count: { type: "integer", minimum: 1, maximum: 20 } }, required: ["unit_type", "count"], additionalProperties: false } },
  { name: "host_festival", description: "Halkın rızasını artırmak için şenlik düzenler.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "no_action", description: "Bu saatte beklemek daha doğruysa hiçbir şey yapma.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false } },
];

const NIGHT_PROMPT = [
  "Sen Demirkale'deki General Aldric'sin ve Kral uyurken tek bir karar veriyorsun.",
  "Kralın kalıcı gece emrine sadık kal. Bu uyanmada EN FAZLA BİR araç çağır.",
  "Yalnızca `secenekler` listesinde gerçekten bulunan bir eylemi seç; listede olmayanı önerme.",
  "Acil durum bildirildiyse kalıcı emrin önüne geçebilirsin, ama gerekçeni tek cümleyle yaz.",
  "Beklemek daha doğruysa no_action çağır. Uzun açıklama yazma; en fazla iki cümle.",
].join("\n");

async function callProvider(provider: string, model: string, apiKey: string, context: unknown): Promise<GameAction | null> {
  const userContent = `DURUM=${JSON.stringify(context)}`;
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 400, system: NIGHT_PROMPT, messages: [{ role: "user", content: userContent }], tools: nightTools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }),
    });
    if (!response.ok) throw new Error(`anthropic ${response.status}`);
    const data = await response.json() as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
    const call = data.content?.find(part => part.type === "tool_use");
    return call?.name ? { name: call.name, arguments: call.input ?? {} } : null;
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_completion_tokens: 400, messages: [{ role: "system", content: NIGHT_PROMPT }, { role: "user", content: userContent }], tools: nightTools.map(tool => ({ type: "function", function: tool })), tool_choice: "auto" }),
  });
  if (!response.ok) throw new Error(`openai ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) return null;
  try { return { name: call.name, arguments: JSON.parse(call.arguments ?? "{}") as Record<string, unknown> }; }
  catch { return null; }
}

async function runOne(row: typeof standingOrders.$inferSelect, now: number): Promise<WakeReport> {
  const db = getDb();
  const finish = async (detail: string, acted: boolean, tokensUsed: boolean) => {
    await db.update(standingOrders).set({ lastRunAt: now, lastOutcome: detail }).where(eq(standingOrders.userId, row.userId));
    return { userId: row.userId, acted, detail, tokensUsed };
  };

  const [save] = await db.select().from(gameSaves).where(eq(gameSaves.userId, row.userId)).limit(1);
  const stored = save ? parseStoredSave(save.gameState) : null;
  if (!stored) return finish("Okunabilir bulut kaydı yok.", false, false);

  const game = tick(stored as Game, now);
  const order: StandingOrder = { ...row, lastRunAt: row.lastRunAt ?? null };
  const window = rollDailyWindow(order, now);
  const decision = shouldWake({ ...order, ...window }, game, now);

  // Ön eleme: model çağrılmadan karar verilir, bu uyanma sıfır token harcar.
  if (!decision.act) return finish(decision.reason, false, false);

  const [credential] = await db.select().from(llmCredentials).where(eq(llmCredentials.userId, row.userId)).limit(1);
  if (!credential) return finish("BYOK bağlantısı yok; General sessiz.", false, false);

  let proposed: GameAction | null = null;
  try {
    const apiKey = await decryptByok(credential.encryptedKey, credential.iv, env.BYOK_MASTER_KEY, row.userId, credential.provider, credential.model, credential.keyVersion);
    proposed = await callProvider(credential.provider, credential.model, apiKey, compactContext(game, order, decision));
  } catch (error) {
    return finish(`Sağlayıcı hatası: ${error instanceof Error ? error.message : "bilinmiyor"}`, false, true);
  }
  if (!proposed || proposed.name === "no_action") {
    return finish(`General beklemeyi seçti: ${String(proposed?.arguments.reason ?? "gerekçe yok")}`, false, true);
  }

  // Yalnızca öneri yetkisi varsa uygulamayız; Kralın onayına bırakılır.
  if (row.autonomy === "ask") {
    await db.insert(pendingDecisions).values({
      userId: row.userId, action: JSON.stringify(proposed), reasons: JSON.stringify([`Gece emriniz gereği önerim: ${proposed.name}`]),
      riskLevel: "elevated", expiresAt: now + 12 * 3_600_000,
    }).onConflictDoUpdate({
      target: pendingDecisions.userId,
      set: { action: JSON.stringify(proposed), reasons: JSON.stringify([`Gece emriniz gereği önerim: ${proposed.name}`]), riskLevel: "elevated", expiresAt: now + 12 * 3_600_000 },
    });
    return finish(`Öneri hazırlandı, onayınız bekleniyor: ${proposed.name}`, false, true);
  }

  const applied = applyActions(game, [proposed], now);
  const succeeded = applied.results.some(line => line.startsWith("✓"));
  const summary = applied.results[0] ?? "Motor eylemi uygulamadı.";
  const next: Game = {
    ...applied.game,
    notices: [{ kind: "GECE VARDİYASI", text: summary.replace(/^[✓✕] /, ""), at: now }, ...applied.game.notices].slice(0, 20),
  };
  await db.insert(gameSaves).values({ userId: row.userId, gameState: JSON.stringify(next) }).onConflictDoUpdate({
    target: gameSaves.userId,
    set: { gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` },
  });
  if (succeeded) {
    await db.update(standingOrders).set({ actionsToday: window.actionsToday + 1, dayStartedAt: window.dayStartedAt }).where(eq(standingOrders.userId, row.userId));
  }
  return finish(summary, succeeded, true);
}

export async function POST(request: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET tanımlı değil." }, { status: 503, headers });
  if (request.headers.get("x-cron-secret") !== secret) {
    return Response.json({ error: "Yetkisiz." }, { status: 401, headers });
  }

  const now = Date.now();
  // Yalnızca Kralın onayladığı, aktif channel'daki emirler işlenir. Emri olmayan
  // hesap bu sorguya hiç girmez; o oyuncu için tek satır kod bile çalışmaz.
  const rows = await getDb().select({ order: standingOrders }).from(standingOrders)
    .innerJoin(channels, eq(channels.id, standingOrders.channelId))
    .where(and(eq(standingOrders.status, "active"), eq(channels.status, "active")));

  const reports: WakeReport[] = [];
  for (const row of rows) {
    try { reports.push(await runOne(row.order, now)); }
    catch (error) { reports.push({ userId: row.order.userId, acted: false, detail: `Hata: ${error instanceof Error ? error.message : "bilinmiyor"}`, tokensUsed: false }); }
  }
  return Response.json({
    ranAt: new Date(now).toISOString(),
    considered: rows.length,
    acted: reports.filter(report => report.acted).length,
    llmCalls: reports.filter(report => report.tokensUsed).length,
    reports,
  }, { headers });
}
