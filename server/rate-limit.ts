import { env } from "cloudflare:workers";
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
  /**
   * Müzakere yazma emirleri. Masa açma ve söz hakkı zaten engine/negotiation.ts
   * içindeki canOpen/canSpeak ile tavanlı; ama `set_open` hiçbir kurala takılmıyor
   * ve tamamen sınırsız yazılabiliyordu. Sınır HESAP bazındadır (`user:${id}`):
   * masa açan da, Generalin anahtarını yakan da hesaptır, IP değil — paylaşılan
   * çıkış IP'si arkasındaki Krallar birbirinin kotasını yemesin.
   */
  negotiate: { scope: "negotiate", limit: 60, windowMs: 60 * 60_000 },
  /**
   * Müzakere masasının OKUNMASI (`GET /api/negotiate`). Tamamen sınırsızdı;
   * her istek masaları, mesajları ve anlaşmaları çekip her karşı taraf için
   * ayrı bir kayıt okuyor, yani ucuz değil.
   *
   * SINIR PANELİ BOĞMAZ: panel 20 saniyede bir yokluyor = saatte 180 istek.
   * 600, bunun üç katından fazlasıdır; aynı hesabın üç sekmesi açık olsa bile
   * sınıra değmez ama saniyede onlarca istek atan bir betik değer.
   */
  negotiateRead: { scope: "negotiate-read", limit: 600, windowMs: 60 * 60_000 },
  /**
   * Krallık kaydı (`PUT /api/save`).
   *
   * Kayıt sıklığının tek freni şimdiye kadar İSTEMCİDEYDİ (components/
   * KingdomGame.tsx, 5 saniyede bir) ve uç tamamen açıktı. Sunucunun büyüme
   * denetimi ise payını istek başına ödüyordu; saniyede 10 kayıt atan bir
   * betik saniyede yarım milyon altın basabiliyordu. Pay artık pencereye
   * bağlı (bkz. server/save-validation.ts) ama isteğin kendisi de ucuz
   * olmamalı: her kayıt tam bir motor simülasyonu koşturur.
   *
   * SINIR MEŞRU İSTEMCİYİ BOĞMAZ: 5 saniyede bir kayıt = dakikada 12, beş
   * dakikada 60 istek. 120, bunun tam iki katıdır — aynı hesabın iki sekmesi
   * açık olsa bile sınıra değmez. Sınır HESAP bazındadır (`user:${id}`);
   * paylaşılan çıkış IP'si arkasındaki Krallar birbirinin kotasını yemesin.
   * 429 yiyen istemci yerel kaydını korur ve 5 saniye sonra yeniden dener.
   */
  save: { scope: "save", limit: 120, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * İstemci IP'sini taşıyan başlık — DAĞITIMA bağlıdır, koda gömülmez.
 *
 * Kusur: sıra `cf-connecting-ip` → `x-real-ip` biçiminde SABİT yazılıydı ve
 * `deploy/nginx.conf` yalnızca `X-Real-IP`'yi eziyordu. İstemci her istekte
 * rastgele bir `cf-connecting-ip` göndererek kendine yeni kova açıyor,
 * login (8/15dk), register (5/saat) ve admin-login (5/15dk) sınırlarının
 * ÜÇÜ birden devre dışı kalıyordu. Sabit bir sıra listesi her zaman en zayıf
 * halkayı seçer: hangi başlığın gerçek olduğunu yalnızca dağıtım bilir.
 *
 *   CLIENT_IP_HEADER=x-real-ip         kendi nginx'imizin arkasında (VARSAYILAN;
 *                                      nginx bunu $remote_addr ile ezer ve
 *                                      CF-Connecting-IP'yi tamamen siler)
 *   CLIENT_IP_HEADER=cf-connecting-ip  doğrudan Cloudflare kenarının arkasında;
 *                                      CF istemcinin gönderdiğini atıp kendi
 *                                      değerini yazdığı için sahtelenemez
 *   CLIENT_IP_HEADER=""                ters vekil yok: hiçbir başlığa güvenilmez
 *
 * Başlık okunsa bile değeri DOĞRULANIR: IP'ye benzemeyen içerik tek bir kovaya
 * düşer, yani "her istekte yeni kova" numarası çöp veriyle de yapılamaz.
 */
const DEFAULT_IP_HEADER = "x-real-ip";

/** Kaba IPv4/IPv6 biçim denetimi; amaç ayrıştırmak değil, çöp değeri elemek. */
function looksLikeIp(value: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || /^[0-9a-fA-F:]{2,45}$/.test(value);
}

export function clientIp(request: Request) {
  const header = (env.CLIENT_IP_HEADER ?? DEFAULT_IP_HEADER).trim().toLocaleLowerCase("en-US");
  if (!header) return "local";
  const raw = (request.headers.get(header) ?? "").split(",")[0].trim();
  return raw && looksLikeIp(raw) ? raw.slice(0, 45) : "local";
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
