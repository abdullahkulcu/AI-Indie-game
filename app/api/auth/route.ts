import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";
import { createSession, currentUser, destroySession, hashPassword, inviteMatches, verifyPassword } from "../../../server/account-auth";
import { RATE_LIMITS, clearRateLimit, clientIp, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ user: null }, { status: 401, headers });
  return Response.json({ user }, { headers });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: string; email?: string; password?: string; displayName?: string; adminInvite?: string };
  if (body.action === "logout") {
    const cookie = await destroySession(request);
    return Response.json({ loggedOut: true }, { headers: { ...headers, "set-cookie": cookie } });
  }
  const email = body.email?.trim().toLocaleLowerCase("en-US") ?? "", password = body.password ?? "";
  if (!emailPattern.test(email) || password.length < 8 || password.length > 128) {
    return Response.json({ error: "Geçerli e-posta ve en az 8 karakterli şifre gerekli." }, { status: 400, headers });
  }
  const db = getDb();
  const ip = clientIp(request);
  if (body.action === "register") {
    const registerLimit = await consumeRateLimit(RATE_LIMITS.register, `ip:${ip}`);
    if (!registerLimit.allowed) return rateLimitResponse(registerLimit, "Çok fazla kayıt denemesi. Lütfen sonra tekrar deneyin.");
    const displayName = body.displayName?.trim() ?? "";
    if (displayName.length < 2 || displayName.length > 40) return Response.json({ error: "Oyuncu adı 2–40 karakter olmalı." }, { status: 400, headers });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "Bu e-posta zaten kayıtlı." }, { status: 409, headers });
    const id = crypto.randomUUID();
    const hasInvite = Boolean(body.adminInvite?.trim()), validInvite = await inviteMatches(body.adminInvite ?? "", env.ADMIN_INVITE_HASH);
    if (hasInvite && !validInvite) return Response.json({ error: "Yönetici davet kodu geçersiz." }, { status: 403, headers });
    let role: "admin" | "player" = "player";
    if (validInvite) {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"));
      if (Number(count) > 0) return Response.json({ error: "Yönetici davet kodu daha önce kullanılmış." }, { status: 409, headers });
      role = "admin";
    }
    await db.insert(users).values({ id, email, displayName, passwordHash: await hashPassword(password), role });
    // Eski platform kaydını yeni hesaba taşıyan göç kaldırıldı: kaynak kimlik istemcinin
    // gönderdiği `oai-authenticated-user-*` başlığından geliyordu ve hedef kullanıcı kimliği
    // /api/world üzerinden herkese açık olduğu için başkasının krallığı klonlanabiliyordu.
    const session = await createSession(id);
    return Response.json({ user: { id, email, displayName, role, status: "active" } }, { status: 201, headers: { ...headers, "set-cookie": session.cookie } });
  }
  if (body.action === "login") {
    // Hem IP hem hesap bazında sayarız: tek IP'den çok hesap denemesi de,
    // dağıtık IP'lerden tek hesaba yüklenme de sınırlanır.
    const [byIp, byEmail] = await Promise.all([
      consumeRateLimit(RATE_LIMITS.login, `ip:${ip}`),
      consumeRateLimit(RATE_LIMITS.login, `email:${email}`),
    ]);
    if (!byIp.allowed || !byEmail.allowed) {
      const worst = byIp.retryAfterSeconds > byEmail.retryAfterSeconds ? byIp : byEmail;
      return rateLimitResponse(worst, "Çok fazla hatalı giriş denemesi. Lütfen sonra tekrar deneyin.");
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return Response.json({ error: "E-posta veya şifre hatalı." }, { status: 401, headers });
    if (user.status !== "active") return Response.json({ error: "Bu hesap yönetici tarafından pasife alındı." }, { status: 403, headers });
    await db.update(users).set({ lastLoginAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    await Promise.all([clearRateLimit(RATE_LIMITS.login, `ip:${ip}`), clearRateLimit(RATE_LIMITS.login, `email:${email}`)]);
    const session = await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status } }, { headers: { ...headers, "set-cookie": session.cookie } });
  }
  return Response.json({ error: "Geçersiz işlem." }, { status: 400, headers });
}
