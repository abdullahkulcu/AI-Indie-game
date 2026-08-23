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

/**
 * ŞİFRELEME KAPSAMI (scope) — anahtarın KİMİN ADINA saklandığını söyleyen dizge.
 *
 * Neden ayrı bir kavram: bu dosya kurulduğunda tek bir sahip vardı (oyuncu) ve
 * `additionalData` doğrudan `userId` alıyordu. Halk-AI (bkz. Fikir 0) ile
 * anahtarın sahibi artık bir kullanıcı DEĞİL — bir channel, ya da channel
 * içindeki tek bir krallık. `channelId`'yi `userId` parametresine geçirmek
 * çalışırdı ama imza yalan söylerdi: sonraki okuyucu onu bir oyuncu anahtarı
 * sanar ve "bir kullanıcının anahtarı başkası adına çözülemez" güvenlik akıl
 * yürütmesi sessizce çürür.
 *
 * Bu yüzden AAD'nin kimlik bölümü GENELLEŞTİRİLDİ: artık bir kapsam dizgesi.
 * İki kural bunu güvenli tutar:
 *  1. **v1 biçimi bit düzeyinde korunur.** Oyuncu kapsamı ÇIPLAK `userId`
 *     olarak yazılır (`userScope`), yani bugüne kadar şifrelenmiş her oyuncu
 *     anahtarının AAD baytları harfiyen aynı kalır ve çözülmeye devam eder.
 *     Bu bir tercih değil zorunluluk: bozulsaydı tüm oyuncular Generalini
 *     kaybederdi (`tests/populace-ai-credentials.test.ts` içinde ESKİ kodla
 *     üretilmiş sabit bir şifre metni bunu her turda kanıtlar).
 *  2. **Yeni kapsamlar kendi ad alanını taşır** (`halk-ai:channel:…`,
 *     `halk-ai:kingdom:…`). Kullanıcı kimlikleri `crypto.randomUUID()`
 *     ürünüdür ve iki nokta içermez; bir kapsam dizgesi bir userId'ye asla
 *     eşit olamaz, dolayısıyla kapsamlar birbirine karışamaz.
 *
 * Marka (`ByokScope`) tipi kasıtlı: kapsam bekleyen yere elle bir kimlik
 * dizgesi geçirmek DERLEME hatası olur, yani "channelId'yi userId yerine
 * kaçak sokma" hatası tekrar edilemez.
 */
declare const scopeBrand: unique symbol;
export type ByokScope = string & { readonly [scopeBrand]: true };

/** Oyuncunun kendi anahtarı. Kapsam çıplak `userId`'dir — v1 biçimi budur, DEĞİŞTİRİLEMEZ. */
export function userScope(userId: string): ByokScope {
  return userId as ByokScope;
}

/** Halk-AI'nın channel varsayılanı: sahibi bir kullanıcı değil, channel'ın kendisidir. */
export function populaceChannelScope(channelId: string): ByokScope {
  return `halk-ai:channel:${channelId}` as ByokScope;
}

/**
 * Halk-AI'nın tek bir krallığa özel anahtarı (channel varsayılanının override'ı).
 * Kapsam channel'ı DA taşır: aynı kullanıcının başka bir channel'daki override'ı
 * bu anahtarı çözemez.
 */
export function populaceKingdomScope(channelId: string, userId: string): ByokScope {
  return `halk-ai:kingdom:${channelId}:${userId}` as ByokScope;
}

function additionalData(scope: ByokScope, provider: string, model: string, version: string) {
  return encoder.encode(`demirkale-byok:${version}:${scope}:${provider}:${model}`);
}

/**
 * Kapsamlı şifreleme — tüm sahiplerin ortak çekirdeği.
 *
 * Model AAD'ye girer: model değişimi anahtarı ÇÖZ + YENİDEN ŞİFRELE demektir
 * (bkz. `app/api/byok/route.ts` PATCH'in gerekçesi). Aynı kural Halk-AI
 * kimlik bilgisi için de geçerli.
 */
export async function encryptScopedKey(apiKey: string, secret: string, scope: ByokScope, provider: string, model: string, version = "v1") {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(scope, provider, model, version) }, await encryptionKey(secret), encoder.encode(apiKey));
  return { encryptedKey: encodeBase64Url(new Uint8Array(encrypted)), iv: encodeBase64Url(iv), keyVersion: version };
}

/** Kapsamlı çözme. Kapsam, sağlayıcı, model ya da sürüm uyuşmazsa AES-GCM reddeder. */
export async function decryptScopedKey(encryptedKey: string, iv: string, secret: string, scope: ByokScope, provider: string, model: string, version = "v1") {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(iv), additionalData: additionalData(scope, provider, model, version) }, await encryptionKey(secret), decodeBase64Url(encryptedKey));
  return decoder.decode(decrypted);
}

/** Oyuncunun BYOK anahtarını şifreler. İmza ve üretilen AAD v1'de olduğu gibidir. */
export async function encryptByok(apiKey: string, secret: string, userId: string, provider: string, model: string, version = "v1") {
  return encryptScopedKey(apiKey, secret, userScope(userId), provider, model, version);
}

/** Oyuncunun BYOK anahtarını çözer. İmza ve beklenen AAD v1'de olduğu gibidir. */
export async function decryptByok(encryptedKey: string, iv: string, secret: string, userId: string, provider: string, model: string, version = "v1") {
  return decryptScopedKey(encryptedKey, iv, secret, userScope(userId), provider, model, version);
}
