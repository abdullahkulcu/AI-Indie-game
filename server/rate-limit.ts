import { lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { rateLimits } from "../db/schema";

export type RateLimitRule = { scope: string; limit: number; windowMs: number };

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

// Kaba kuvvet ve kota tüketimine karşı sabit pencereli sınırlar.
export const RATE_LIMITS = {
  login: { scope: "login", limit: 8, windowMs: 15 * 60_000 },
  register: { scope: "register", limit: 5, windowMs: 60 * 60_000 },
  adminLogin: { scope: "admin-login", limit: 5, windowMs: 15 * 60_000 },
  general: { scope: "general", limit: 40, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

// Cloudflare kenarı gerçek istemci IP'sini bu başlıkta verir. Yerelde başlık yoktur;
// o durumda tek bir "local" kovasına düşeriz, bu da geliştirmede sınırı test etmeyi mümkün kılar.
export function clientIp(request: Request) {
  const header = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "";
  return header.trim().slice(0, 64) || "local";
}

function bucketKey(scope: string, identity: string) {
  return `${scope}:${identity.toLocaleLowerCase("en-US").slice(0, 160)}`;
}

/**
 * Sayacı tek bir upsert deyimiyle artırır; pencere dolmuşsa aynı deyimde sıfırlar.
 * Tek deyim olduğu için eşzamanlı isteklerde okuma-yazma yarışı oluşmaz.
 */
export async function consumeRateLimit(rule: RateLimitRule, identity: string): Promise<RateLimitResult> {
  const now = Date.now(), expiredBefore = now - rule.windowMs, bucket = bucketKey(rule.scope, identity);
  const [row] = await getDb().insert(rateLimits).values({ bucket, count: 1, windowStart: now }).onConflictDoUpdate({
    target: rateLimits.bucket,
    set: {
      count: sql`case when ${rateLimits.windowStart} <= ${expiredBefore} then 1 else ${rateLimits.count} + 1 end`,
      windowStart: sql`case when ${rateLimits.windowStart} <= ${expiredBefore} then ${now} else ${rateLimits.windowStart} end`,
    },
  }).returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  const count = Number(row?.count ?? 1), windowStart = Number(row?.windowStart ?? now);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000));
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterSeconds };
}

/** Başarılı girişten sonra sayacı sıfırlar; doğru şifreyi bilen kullanıcı cezalandırılmaz. */
export async function clearRateLimit(rule: RateLimitRule, identity: string) {
  await getDb().delete(rateLimits).where(sql`${rateLimits.bucket} = ${bucketKey(rule.scope, identity)}`);
}

/** Süresi geçmiş kovaları temizler; tabloyu sınırsız büyümekten korumak için ara sıra çağrılır. */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60_000) {
  await getDb().delete(rateLimits).where(lt(rateLimits.windowStart, Date.now() - olderThanMs));
}

export function rateLimitResponse(result: RateLimitResult, message: string) {
  return Response.json({ error: message }, {
    status: 429,
    headers: { "cache-control": "no-store", "retry-after": String(result.retryAfterSeconds) },
  });
}
