import { env } from "cloudflare:workers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { channelMembers, channels, populaceCredentials } from "../../../../db/schema";
import { isPopulacePersona, POPULACE_PERSONAS, type PopulacePersona } from "../../../../engine/populace-persona";
import { currentAdminUser } from "../../../../server/account-auth";
import { decryptScopedKey, encryptScopedKey } from "../../../../server/byok-crypto";
import { TEXT_TEMPERATURE_OPTIONS, validTextTemperature, verifyProviderConnection, type ProviderCheck } from "../../../../server/llm-provider";
import { populaceCredentialSummary, populaceScopeOf, POPULACE_SUMMARY_COLUMNS } from "../../../../server/populace-ai-credentials";

/**
 * HALK-AI KİMLİK BİLGİSİ UCU — yalnızca yöneticiye açıktır.
 *
 * Halkın token'ını oyun kurucusu öder (plan belgesi §2 madde 1), yani buraya
 * ADMIN'in kendi API anahtarı girilir. `/api/byok`'un oyuncu için taşıdığı
 * disiplinin aynısı geçerli:
 *   · Anahtar yalnızca istek gövdesinde bir kez gelir, şifreli olarak yazılır
 *     ve BİR DAHA hiçbir cevapta, logda ya da panelde görünmez.
 *   · Cevaplar `populaceCredentialSummary` üzerinden kurulur; `encrypted_key`
 *     ve `iv` sütunları SELECT edilmez (tek istisna PATCH'in model değişimi:
 *     model AES-GCM'in ek verisine yazdığı için anahtar çözülüp yeniden
 *     şifrelenmek zorunda — o değer de yalnızca bellekte kalır).
 *   · Sunucunun kullandığı model TEK KAYNAKTAN, bu tablodan okunur.
 *
 * `PATCH` kasıtlı olarak yalnızca kişilik ve model değiştirir: plan belgesinin
 * kararı "model/kişilik değiştirilebilir ama NADİREN (sezon başına gibi)".
 * Kod bunu katı bir kilitle engellemez — admin sezonun ortasında da
 * değiştirebilir — ama uç ve panel bunun halkın tonunu bozacağını açıkça
 * söyler; kural burada niyet olarak, panelde uyarı olarak yaşar.
 */

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

type SaveBody = { channelId?: string; userId?: string | null; persona?: string; provider?: string; model?: string; temperature?: unknown; apiKey?: string };
type PatchBody = { id?: string; persona?: string; model?: string; temperature?: unknown; test?: boolean };

function verificationError(check: ProviderCheck) {
  return check.ok
    ? null
    : Response.json({ error: `Bağlantı doğrulanamadı: ${check.message}`, code: check.code }, { status: 422, headers: noStore });
}

/** Override yazılabilmesi için krallığın o channel'da AKTİF üyeliği olmalı. */
async function isActiveMember(channelId: string, userId: string) {
  const [row] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId), eq(channelMembers.status, "active"))).limit(1);
  return Boolean(row);
}

async function channelExists(channelId: string) {
  const [row] = await getDb().select({ id: channels.id }).from(channels).where(eq(channels.id, channelId)).limit(1);
  return Boolean(row);
}

export async function GET(request: Request) {
  if (!(await currentAdminUser(request))) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const rows = await getDb().select(POPULACE_SUMMARY_COLUMNS).from(populaceCredentials).orderBy(populaceCredentials.channelId);
  // Kişilik listesi panele SUNUCUDAN iner; istemci kendi listesini yazmaz
  // (tek-doğru-kaynak: engine/populace-persona.ts).
  return Response.json({ personas: POPULACE_PERSONAS, temperatureOptions: TEXT_TEMPERATURE_OPTIONS, credentials: rows.map(populaceCredentialSummary) }, { headers: noStore });
}

/**
 * Kimlik bilgisini yazar ya da tümüyle değiştirir (anahtar dahil).
 *
 * `userId` boşsa satır channel VARSAYILANIDIR, doluysa o krallığa özel
 * override. Kapsam seçimi `populaceScopeOf` ile yapılır — çözümleyici de aynı
 * fonksiyonu kullanır, yoksa yazılan anahtar hiç çözülemezdi.
 */
export async function PUT(request: Request) {
  const actor = await currentAdminUser(request);
  if (!actor) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const body = await request.json() as SaveBody;
  const channelId = body.channelId?.trim() ?? "";
  const userId = body.userId?.trim() ? body.userId.trim() : null;
  const model = body.model?.trim() ?? "";
  const temperature = body.provider === "anthropic" ? null : body.temperature;
  if (!channelId || !isPopulacePersona(body.persona)) return Response.json({ error: "Channel ve geçerli bir halk kişiliği gerekli." }, { status: 400, headers: noStore });
  if ((body.provider !== "openai" && body.provider !== "anthropic") || !model || !body.apiKey || body.apiKey.length < 8) {
    return Response.json({ error: "Sağlayıcı, model ve geçerli API anahtarı gerekli." }, { status: 400, headers: noStore });
  }
  if (temperature !== undefined && temperature !== null && !validTextTemperature(temperature)) return Response.json({ error: "Temperature 0 ile 1 arasında bir sayı olmalı." }, { status: 400, headers: noStore });
  if (!(await channelExists(channelId))) return Response.json({ error: "Channel bulunamadı." }, { status: 404, headers: noStore });
  if (userId && !(await isActiveMember(channelId, userId))) {
    return Response.json({ error: "Krallık bu channel'ın aktif üyesi değil." }, { status: 400, headers: noStore });
  }
  const check = await verifyProviderConnection({ provider: body.provider, model, apiKey: body.apiKey, ...(temperature === undefined || temperature === null ? {} : { temperature }) });
  const checkError = verificationError(check);
  if (checkError) return checkError;
  const persona: PopulacePersona = body.persona;
  const value = await encryptScopedKey(body.apiKey, env.BYOK_MASTER_KEY, populaceScopeOf(channelId, userId), body.provider, model);
  const db = getDb();
  const scopeFilter = and(eq(populaceCredentials.channelId, channelId), userId ? eq(populaceCredentials.userId, userId) : isNull(populaceCredentials.userId));
  const [existing] = await db.select({ id: populaceCredentials.id }).from(populaceCredentials).where(scopeFilter).limit(1);
  if (existing) {
    await db.update(populaceCredentials).set({ persona, provider: body.provider, model, temperature: temperature ?? null, ...value, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(populaceCredentials.id, existing.id));
  } else {
    await db.insert(populaceCredentials).values({ id: crypto.randomUUID(), channelId, userId, persona, provider: body.provider, model, temperature: temperature ?? null, ...value, createdBy: actor.id });
  }
  const [saved] = await db.select(POPULACE_SUMMARY_COLUMNS).from(populaceCredentials).where(scopeFilter).limit(1);
  return Response.json({ credential: saved ? populaceCredentialSummary(saved) : null }, { status: existing ? 200 : 201, headers: noStore });
}

/**
 * Kişiliği ve/veya modeli anahtarı yeniden girmeden değiştirir.
 *
 * Model değişimi anahtarı ÇÖZ + YENİDEN ŞİFRELE demektir: model AES-GCM'in ek
 * verisinde yazar (bkz. server/byok-crypto.ts). Sütunu tek başına güncellemek
 * anahtarı çözülemez hâle getirir ve halk sessizce susardı — `/api/byok`'ta
 * bu tam olarak yaşandı, aynı hata burada tekrar edilmiyor.
 */
export async function PATCH(request: Request) {
  if (!(await currentAdminUser(request))) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const body = await request.json() as PatchBody;
  const id = body.id?.trim() ?? "";
  const model = body.model?.trim();
  if (!id || (!body.persona && !model && body.temperature === undefined && !body.test)) return Response.json({ error: "Kimlik ve değiştirilecek en az bir alan gerekli." }, { status: 400, headers: noStore });
  if (body.persona !== undefined && !isPopulacePersona(body.persona)) return Response.json({ error: "Geçersiz halk kişiliği." }, { status: 400, headers: noStore });
  const db = getDb();
  const [row] = await db.select().from(populaceCredentials).where(eq(populaceCredentials.id, id)).limit(1);
  if (!row) return Response.json({ error: "Halk-AI kimlik bilgisi bulunamadı." }, { status: 404, headers: noStore });
  const persona = (body.persona ?? row.persona) as PopulacePersona;
  const targetModel = model || row.model;
  const targetTemperature = row.provider === "anthropic" ? null : body.temperature === undefined ? row.temperature : body.temperature;
  if (targetTemperature !== null && !validTextTemperature(targetTemperature)) return Response.json({ error: "Temperature 0 ile 1 arasında bir sayı olmalı." }, { status: 400, headers: noStore });
  const mustVerify = Boolean(body.test || targetModel !== row.model || targetTemperature !== row.temperature);
  let decryptedKey: string | null = null;
  if (mustVerify) {
    const scope = populaceScopeOf(row.channelId, row.userId);
    try {
      decryptedKey = await decryptScopedKey(row.encryptedKey, row.iv, env.BYOK_MASTER_KEY, scope, row.provider, row.model, row.keyVersion);
    } catch {
      // Hata metni sır taşıyabilir; yutulur, yerine yönlendirici bir mesaj döner.
      return Response.json({ error: "Saklı anahtar çözülemedi; anahtarı yeniden girin." }, { status: 409, headers: noStore });
    }
    const check = await verifyProviderConnection({ provider: row.provider, model: targetModel, apiKey: decryptedKey, ...(targetTemperature === null ? {} : { temperature: targetTemperature }) });
    const checkError = verificationError(check);
    if (checkError) return checkError;
    if (body.test) {
      const summary = populaceCredentialSummary(row);
      return Response.json({ credential: summary, verified: true }, { headers: noStore });
    }
  }
  if (!model || model === row.model) {
    await db.update(populaceCredentials).set({ persona, temperature: targetTemperature, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(populaceCredentials.id, id));
  } else {
    const scope = populaceScopeOf(row.channelId, row.userId);
    const value = await encryptScopedKey(decryptedKey!, env.BYOK_MASTER_KEY, scope, row.provider, model);
    await db.update(populaceCredentials).set({ persona, model, temperature: targetTemperature, ...value, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(populaceCredentials.id, id));
  }
  const [saved] = await db.select(POPULACE_SUMMARY_COLUMNS).from(populaceCredentials).where(eq(populaceCredentials.id, id)).limit(1);
  return Response.json({ credential: saved ? populaceCredentialSummary(saved) : null }, { headers: noStore });
}

/** Satırı siler. Channel varsayılanı silinirse o channel'da Halk-AI susar. */
export async function DELETE(request: Request) {
  if (!(await currentAdminUser(request))) return Response.json({ error: "Yönetici yetkisi gerekli." }, { status: 403, headers: noStore });
  const body = await request.json() as { id?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "Kimlik gerekli." }, { status: 400, headers: noStore });
  await getDb().delete(populaceCredentials).where(eq(populaceCredentials.id, id));
  return Response.json({ deleted: true }, { headers: noStore });
}
