const encoder = new TextEncoder();

// Cloudflare Workers' Web Crypto implementation caps PBKDF2 at 100,000 rounds.
// The round count is encoded with each hash so the format remains upgradeable.
export const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${bytesToBase64(salt)}:${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, count, saltText, expectedText] = encoded.split(":");
  if (scheme !== "pbkdf2" || !count || !saltText || !expectedText) return false;
  const iterations = Number(count);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltText), iterations }, key, 256);
  const actual = new Uint8Array(bits), expected = base64ToBytes(expectedText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}
