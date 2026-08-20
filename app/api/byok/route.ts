import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { llmCredentials } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { decryptByok, encryptByok } from "../../../server/byok-crypto";

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

/**
 * Modeli anahtarı yeniden girmeden değiştirir — MODEL SEÇİMİNİN TEK KAYNAĞI.
 *
 * Kusur şuydu: model üç yerde duruyordu (llm_credentials.model, game.model,
 * paneldeki seçim) ve /api/general saklı kimlik bilgisi varken modeli SAKLI
 * olandan okuyordu. Kral panelden modeli değiştirip anahtarını yeniden
 * girmediğinde panel yeni modeli gösteriyor, sunucu eskisini kullanıyor ve
 * fatura yanlış modele yazılıyordu.
 *
 * Model, anahtarın AES-GCM `additionalData` alanında da yazar (bkz.
 * server/byok-crypto). Bu yüzden model değişimi anahtarı ÇÖZ + YENİDEN ŞİFRELE
 * demektir; sütunu tek başına güncellemek çözmeyi bozar ve General susardı.
 *
 * Sağlayıcı burada DEĞİŞTİRİLEMEZ: OpenAI anahtarı Anthropic'te çalışmaz, o
 * yüzden sağlayıcı değişimi yeni anahtar ister (PUT).
 */
export async function PATCH(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  const body = await request.json() as { model?: string; provider?: string };
  const model = body.model?.trim();
  if (!model) return Response.json({ error: "Model gerekli." }, { status: 400, headers });
  const [credential] = await getDb().select().from(llmCredentials).where(eq(llmCredentials.userId, user.id)).limit(1);
  if (!credential) return Response.json({ error: "Kayıtlı BYOK bağlantısı bulunamadı." }, { status: 404, headers });
  if (body.provider && body.provider !== credential.provider) {
    return Response.json({ error: "Sağlayıcıyı değiştirmek için API anahtarını yeniden girmelisiniz." }, { status: 409, headers });
  }
  if (model === credential.model) return Response.json({ connected: true, provider: credential.provider, model }, { headers });

  let apiKey: string;
  try {
    apiKey = await decryptByok(credential.encryptedKey, credential.iv, env.BYOK_MASTER_KEY, user.id, credential.provider, credential.model, credential.keyVersion);
  } catch {
    return Response.json({ error: "Kayıtlı BYOK bağlantısı çözülemedi; anahtarınızı yeniden bağlayın." }, { status: 409, headers });
  }
  // Yeni model yeni `additionalData` demektir; anahtar onun altında yeniden şifrelenir.
  const value = await encryptByok(apiKey, env.BYOK_MASTER_KEY, user.id, credential.provider, model);
  await getDb().update(llmCredentials).set({ model, ...value, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(llmCredentials.userId, user.id));
  return Response.json({ connected: true, provider: credential.provider, model }, { headers });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers });
  await getDb().delete(llmCredentials).where(eq(llmCredentials.userId, user.id));
  return Response.json({ deleted: true }, { headers });
}
