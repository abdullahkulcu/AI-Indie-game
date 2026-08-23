import { populaceCredentials } from "../db/schema";
import { type PopulacePersona } from "../engine/populace-persona";
import { type ByokScope, decryptScopedKey, populaceChannelScope, populaceKingdomScope } from "./byok-crypto";

/**
 * HALK-AI KİMLİK BİLGİSİNİN KURALI — kapsam, öncelik ve dışa görünen özet.
 *
 * "Bu krallığın halkı hangi anahtarla, hangi modelle ve hangi kişilikle
 * konuşur?" sorusunun cevabı YALNIZCA burada verilir. Plan belgesindeki Fikir
 * 2/7/8/9/15/16 hep buradan okur; hiçbiri kendi sırasını kurmaz. Sıra iki yere
 * yazıldığında (bir uçta override öncelikli, başka uçta channel varsayılanı)
 * halkın sesi aynı oyunda iki farklı kişilik konuşurdu — bu kod tabanının en
 * sık hata sınıfı tam olarak budur (CLAUDE.md kısıt #5).
 *
 * ÇÖZÜMLEME SIRASI (plan belgesi, Fikir 0 → "Karar (2026-08-22)"):
 *   1. krallığa özel satır (channel + user)  → varsa o
 *   2. channel varsayılanı (channel + NULL)  → varsa o
 *   3. hiçbiri                               → Halk-AI YOK (null)
 *
 * Bu dosya `getDb`'ye DOKUNMAZ: satırlar dışarıdan verilir, ana şifreleme
 * anahtarı parametredir. Sebep `server/world-projection.ts` ile aynı — `../db`
 * (dolayısıyla `cloudflare:workers`) import edilseydi bu kuralın testten
 * çağrılabilen tek bir testi olmazdı. Veritabanı tarafı
 * `server/populace-ai-desk.ts` içindedir ve o dosya buradaki kuralı çağırır.
 *
 * SIR DİSİPLİNİ: `resolvePopulaceCredential` çözülmüş anahtarı döndürür, çünkü
 * çağıranın sağlayıcıya gitmesi için gerekiyor. O değer loglanmaz, deftere
 * (`notices`) yazılmaz, hiçbir HTTP cevabına konmaz. Panele/uçlara dönecek
 * özet için `populaceCredentialSummary` vardır ve o fonksiyon şifreli anahtarı
 * ile iv'yi ASLA taşımaz (CLAUDE.md kısıt #4).
 */

/** Çözümleme için gereken satır — sır taşıyan alanlar dahil. */
export type PopulaceCredentialRow = {
  id: string;
  channelId: string;
  userId: string | null;
  persona: PopulacePersona;
  provider: "openai" | "anthropic";
  model: string;
  encryptedKey: string;
  iv: string;
  keyVersion: string;
};

/** Kimlik bilgisinin hangi seviyeden geldiği; panelde ve testte okunur. */
export type PopulaceCredentialSource = "kingdom" | "channel";

export type ResolvedPopulaceCredential = {
  channelId: string;
  source: PopulaceCredentialSource;
  persona: PopulacePersona;
  provider: "openai" | "anthropic";
  model: string;
  /** ÇÖZÜLMÜŞ anahtar. Loglanmaz, cevaba konmaz, deftere yazılmaz. */
  apiKey: string;
};

/**
 * Kapsam seçimi — yazma ve okuma AYNI kuralı kullanır.
 *
 * Admin ucu anahtarı şifrelerken, çözümleyici onu çözerken bu fonksiyonu
 * çağırır. İki tarafta ayrı ayrı yazılsaydı ilk sapmada anahtar yazılabilir
 * ama çözülemez hâle gelirdi ve hata ancak halk konuşmaya çalıştığında
 * görünürdü.
 */
export function populaceScopeOf(channelId: string, userId: string | null): ByokScope {
  return userId ? populaceKingdomScope(channelId, userId) : populaceChannelScope(channelId);
}

/**
 * Satırlar arasından bu krallık için geçerli olanı seçer. SAF: veritabanına ve
 * saate dokunmaz, bu yüzden sırası testte doğrudan ölçülebilir.
 */
export function pickPopulaceCredential<T extends { channelId: string; userId: string | null }>(
  rows: readonly T[],
  channelId: string,
  userId: string,
): { row: T; source: PopulaceCredentialSource } | null {
  const scoped = rows.filter((row) => row.channelId === channelId);
  const override = scoped.find((row) => row.userId === userId);
  if (override) return { row: override, source: "kingdom" };
  const fallback = scoped.find((row) => row.userId === null);
  return fallback ? { row: fallback, source: "channel" } : null;
}

/**
 * Satırı seçer VE anahtarı çözer.
 *
 * `null` üç halde döner ve çağıran üçünü aynı şekilde ele almalıdır — "Halk-AI
 * yok, deterministik davran": (1) channel'a hiç kimlik bilgisi girilmemiş,
 * (2) yalnızca başka krallıkların override'ı var, (3) satır var ama anahtar
 * çözülemedi (ana anahtar değişmiş ya da satır elle bozulmuş). Üçüncü hâlde
 * hata YUTULUR: mesajı sır hakkında bilgi taşıyabilir, bu yüzden ne loglanır
 * ne cevaba konur.
 */
export async function resolvePopulaceCredential(
  rows: readonly PopulaceCredentialRow[],
  channelId: string,
  userId: string,
  masterKey: string,
): Promise<ResolvedPopulaceCredential | null> {
  const picked = pickPopulaceCredential(rows, channelId, userId);
  if (!picked) return null;
  const { row, source } = picked;
  try {
    const apiKey = await decryptScopedKey(
      row.encryptedKey, row.iv, masterKey,
      populaceScopeOf(row.channelId, row.userId),
      row.provider, row.model, row.keyVersion,
    );
    return { channelId: row.channelId, source, persona: row.persona, provider: row.provider, model: row.model, apiKey };
  } catch {
    return null;
  }
}

/**
 * Panele/uca dönecek özet. Sır taşıyan alanları BİLEREK yayılım (`...row`) ile
 * değil tek tek yazar — `server/world-projection.ts`'in `intelReportOf`
 * desenindeki aynı gerekçe: yayılım kullanılsaydı şemaya eklenen yeni bir sır
 * sütunu sessizce cevaba sızardı.
 */
export function populaceCredentialSummary(row: {
  id: string;
  channelId: string;
  userId: string | null;
  persona: PopulacePersona;
  provider: "openai" | "anthropic";
  model: string;
  updatedAt?: Date | string | null;
}) {
  return {
    id: row.id,
    channelId: row.channelId,
    userId: row.userId,
    scope: (row.userId ? "kingdom" : "channel") as PopulaceCredentialSource,
    persona: row.persona,
    provider: row.provider,
    model: row.model,
    connected: true,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * Özetin SELECT listesi — tek yerde yaşasın diye burada.
 *
 * `encrypted_key`/`iv`/`key_version` BİLEREK yok: admin panelinin okuduğu
 * sorgu sırra hiç dokunmaz, yani bir gözden kaçma cevaba sır sızdıramaz
 * (bir test bu listenin içeriğini doğrular).
 */
export const POPULACE_SUMMARY_COLUMNS = {
  id: populaceCredentials.id,
  channelId: populaceCredentials.channelId,
  userId: populaceCredentials.userId,
  persona: populaceCredentials.persona,
  provider: populaceCredentials.provider,
  model: populaceCredentials.model,
  updatedAt: populaceCredentials.updatedAt,
} as const;
