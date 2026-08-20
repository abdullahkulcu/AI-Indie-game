import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";
export { hashPassword, verifyPassword } from "./password-auth";

const COOKIE = "demirkale_session";
export const ADMIN_COOKIE = "demirkale_admin_session";
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

/**
 * Çerezin `Secure` bayrağı BAĞLANTIYA bakar — sabit değildir.
 *
 * Kusur: bayrak her zaman yazılıyordu ama `deploy/nginx.conf` yalnızca 80'i
 * dinliyor. `http://<vm-ip>` üzerinden tarayıcı çerezi HİÇ saklamıyor ve
 * kimse giriş yapamıyordu. (Yerelde çalışıyordu çünkü tarayıcı 127.0.0.1'i
 * güvenli sayar; gerçek IP'de saymaz.)
 *
 * GÜVENLİK ZAYIFLAMAZ: HTTPS üzerinden gelen istekte `Secure` MUTLAKA yazılır.
 * Kararı isteğin kendisi verir — nginx'in eklediği `X-Forwarded-Proto` ya da
 * doğrudan bağlantıda URL şeması. Böylece TLS'li dağıtımda çerez korumalı,
 * TLS'siz yerel/VM kurulumunda ise oyun oynanabilir olur.
 */
export function isSecureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLocaleLowerCase("en-US");
  if (forwarded) return forwarded === "https";
  try { return new URL(request.url).protocol === "https:"; } catch { return false; }
}

function cookieAttributes(secure: boolean) {
  return `Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

export async function createSession(userId: string, cookieName = COOKIE, secure = true) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token), expiresAt = Date.now() + 30 * 86_400_000;
  await getDb().insert(sessions).values({ tokenHash, userId, expiresAt });
  // Süresi dolmuş satırlar sonsuza kadar birikiyordu; her yeni oturumda ucuz
  // bir temizlik yapılır (cron turunda da genel bir süpürme var).
  await pruneExpiredSessions();
  return { token, cookie: `${cookieName}=${token}; ${cookieAttributes(secure)}; Max-Age=2592000` };
}

/**
 * Süresi geçmiş oturum satırlarını siler.
 *
 * Tek indeksli, tek koşullu bir DELETE; oturum açma yolunda da çağrılabilecek
 * kadar ucuz. `sessions` tablosu aksi halde sonsuza kadar büyüyordu: her giriş
 * bir satır ekliyor, hiçbir şey silmiyordu.
 */
export async function pruneExpiredSessions(now = Date.now()) {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, now));
}

function cookieValue(request: Request, cookieName = COOKIE) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
}

async function userForCookie(request: Request, cookieName: string) {
  const token = cookieValue(request, cookieName); if (!token) return null;
  const tokenHash = await sha256(token);
  const [row] = await getDb().select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role, status: users.status })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, Date.now()), eq(users.status, "active"))).limit(1);
  return row ?? null;
}

export async function currentUser(request: Request) { return userForCookie(request, COOKIE); }

export async function currentAdminUser(request: Request) {
  const dedicated = await userForCookie(request, ADMIN_COOKIE);
  if (dedicated?.role === "admin") return dedicated;
  const regular = await currentUser(request);
  return regular?.role === "admin" ? regular : null;
}

export async function destroySession(request: Request, cookieName = COOKIE) {
  const token = cookieValue(request, cookieName); if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
  // Silme çerezi de aynı bayraklarla yazılmalı: bayraklar tutmazsa tarayıcı
  // eski çerezi silmez ve çıkış yapılamaz.
  return `${cookieName}=; ${cookieAttributes(isSecureRequest(request))}; Max-Age=0`;
}
