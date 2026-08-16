const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(secret: string) {
  const raw = decodeBase64Url(secret);
  if (raw.byteLength !== 32) throw new Error("BYOK şifreleme anahtarı yapılandırılmamış.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function additionalData(userId: string, provider: string, model: string, version: string) {
  return encoder.encode(`demirkale-byok:${version}:${userId}:${provider}:${model}`);
}

export async function encryptByok(apiKey: string, secret: string, userId: string, provider: string, model: string, version = "v1") {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(userId, provider, model, version) }, await encryptionKey(secret), encoder.encode(apiKey));
  return { encryptedKey: encodeBase64Url(new Uint8Array(encrypted)), iv: encodeBase64Url(iv), keyVersion: version };
}

export async function decryptByok(encryptedKey: string, iv: string, secret: string, userId: string, provider: string, model: string, version = "v1") {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(iv), additionalData: additionalData(userId, provider, model, version) }, await encryptionKey(secret), decodeBase64Url(encryptedKey));
  return decoder.decode(decrypted);
}
