import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
export { hashPassword, verifyPassword } from "./password-auth";

const COOKIE = "demirkale_session";
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inviteMatches(code: string, expectedHash?: string) {
  return Boolean(code && expectedHash && (await sha256(code.trim())) === expectedHash);
}

export async function createSession(userId: string) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token), expiresAt = Date.now() + 30 * 86_400_000;
  await getDb().insert(sessions).values({ tokenHash, userId, expiresAt });
  return { token, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` };
}

function cookieValue(request: Request) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
}

export async function currentUser(request: Request) {
  const token = cookieValue(request); if (!token) return null;
  const tokenHash = await sha256(token);
  const [row] = await getDb().select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, status: users.status })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, Date.now()), eq(users.status, "active"))).limit(1);
  return row ?? null;
}

export async function destroySession(request: Request) {
  const token = cookieValue(request); if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
