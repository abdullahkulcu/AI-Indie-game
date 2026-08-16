import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { gameSaves, users } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { createSession, currentUser, destroySession, hashPassword, inviteMatches, verifyPassword } from "../../../server/account-auth";

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
  if (body.action === "register") {
    const displayName = body.displayName?.trim() ?? "";
    if (displayName.length < 2 || displayName.length > 40) return Response.json({ error: "Oyuncu adı 2–40 karakter olmalı." }, { status: 400, headers });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "Bu e-posta zaten kayıtlı." }, { status: 409, headers });
    const id = crypto.randomUUID();
    const role = await inviteMatches(body.adminInvite ?? "", env.ADMIN_INVITE_HASH) ? "admin" : "player";
    await db.insert(users).values({ id, email, displayName, passwordHash: await hashPassword(password), role });
    // Önceki özel sürümdeki hesap bağlı krallığı yeni oyun hesabına bir kez taşır.
    const platformUser = await getChatGPTUser();
    if (platformUser) {
      const [legacy] = await db.select().from(gameSaves).where(eq(gameSaves.userId, platformUser.userId)).limit(1);
      if (legacy) await db.insert(gameSaves).values({ ...legacy, userId: id }).onConflictDoNothing();
    }
    const session = await createSession(id);
    return Response.json({ user: { id, email, displayName, role, status: "active" } }, { status: 201, headers: { ...headers, "set-cookie": session.cookie } });
  }
  if (body.action === "login") {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return Response.json({ error: "E-posta veya şifre hatalı." }, { status: 401, headers });
    if (user.status !== "active") return Response.json({ error: "Bu hesap yönetici tarafından pasife alındı." }, { status: 403, headers });
    await db.update(users).set({ lastLoginAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    const session = await createSession(user.id);
    return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, status: user.status } }, { headers: { ...headers, "set-cookie": session.cookie } });
  }
  return Response.json({ error: "Geçersiz işlem." }, { status: 400, headers });
}
