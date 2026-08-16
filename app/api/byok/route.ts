import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { llmCredentials } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { encryptByok } from "../../../server/byok-crypto";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const [credential] = await getDb().select({ provider: llmCredentials.provider, model: llmCredentials.model, updatedAt: llmCredentials.updatedAt }).from(llmCredentials).where(eq(llmCredentials.userId, user.id)).limit(1);
  return Response.json(credential ? { connected: true, ...credential } : { connected: false }, { headers });
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { provider?: string; model?: string; apiKey?: string };
  if ((body.provider !== "openai" && body.provider !== "anthropic") || !body.model?.trim() || !body.apiKey || body.apiKey.length < 8) {
    return Response.json({ error: "Sağlayıcı, model ve geçerli API anahtarı gerekli." }, { status: 400, headers });
  }
  const value = await encryptByok(body.apiKey, env.BYOK_MASTER_KEY, user.id, body.provider, body.model.trim());
  await getDb().insert(llmCredentials).values({ userId: user.id, provider: body.provider, model: body.model.trim(), ...value }).onConflictDoUpdate({
    target: llmCredentials.userId,
    set: { provider: body.provider, model: body.model.trim(), ...value, updatedAt: sql`CURRENT_TIMESTAMP` },
  });
  return Response.json({ connected: true, provider: body.provider, model: body.model.trim() }, { headers });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  await getDb().delete(llmCredentials).where(eq(llmCredentials.userId, user.id));
  return Response.json({ deleted: true }, { headers });
}
