import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";
import { ADMIN_COOKIE, createSession, currentAdminUser, destroySession, isSecureRequest, verifyPassword } from "../../../server/account-auth";
import { RATE_LIMITS, clearRateLimit, clientIp, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const user = await currentAdminUser(request);
  return user ? Response.json({ user }, { headers }) : Response.json({ user: null }, { status: 401, headers });
}

export async function POST(request: Request) {
  const body = await request.json() as { action?: "login" | "logout"; email?: string; password?: string };
  if (body.action === "logout") {
    const cookie = await destroySession(request, ADMIN_COOKIE);
    return Response.json({ loggedOut: true }, { headers: { ...headers, "set-cookie": cookie } });
  }
  const email = body.email?.trim().toLocaleLowerCase("en-US") ?? "", password = body.password ?? "";
  const ip = clientIp(request);
  // İKİ kova: IP ve e-posta. IP başlığı ters vekile bağlıdır; e-posta kovası
  // başlık yanlış yapılandırılsa bile yönetici hesabına kaba kuvvet uygulamayı
  // durdurur.
  const [byIp, byEmail] = await Promise.all([
    consumeRateLimit(RATE_LIMITS.adminLogin, `ip:${ip}`),
    consumeRateLimit(RATE_LIMITS.adminLogin, `email:${email}`),
  ]);
  const limit = byIp.allowed ? byEmail : byIp;
  if (!limit.allowed) return rateLimitResponse(limit, "Çok fazla yönetici giriş denemesi. Lütfen sonra tekrar deneyin.");
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.role !== "admin" || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: "Yönetici e-postası veya şifresi hatalı." }, { status: 401, headers });
  }
  if (user.status !== "active") return Response.json({ error: "Yönetici hesabı pasif." }, { status: 403, headers });
  await getDb().update(users).set({ lastLoginAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
  await Promise.all([clearRateLimit(RATE_LIMITS.adminLogin, `ip:${ip}`), clearRateLimit(RATE_LIMITS.adminLogin, `email:${email}`)]);
  const session = await createSession(user.id, ADMIN_COOKIE, isSecureRequest(request));
  return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status } }, { headers: { ...headers, "set-cookie": session.cookie } });
}
