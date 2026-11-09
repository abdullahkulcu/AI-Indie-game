import type { GameAction } from "../engine/types";
import type { DeskTool } from "./negotiation-brief";

/**
 * ARKA PLANDAKİ TEK SAĞLAYICI ÇAĞRISI — iki kipli.
 *
 * Bu dosya `app/api/cron/route.ts` içindeki `callProvider`ın TAŞINMIŞ hâlidir;
 * yeni bir çağrı yazılmadı. Sebebi kısıt #5: Halk-AI (plan belgesi Fikir 2)
 * sağlayıcıya "araçsız, düz metin" olarak gitmek zorundaydı ve bunun için üçüncü
 * bir `fetch("https://api.openai.com/...")` yazmak, uç nokta adresini, zaman
 * aşımını, `anthropic-version` başlığını ve hata desenini bir yerde daha elle
 * tekrar etmek olurdu. Bu kod tabanında böyle bir kopya HER seferinde sessizce
 * saptı.
 *
 * İki kip AYNI gövdeyi paylaşır, yalnızca cevabın okunuşu değişir:
 *  - `callProvider`     → araç çağrılı; gece vardiyası ve çevrimdışı masa.
 *  - `callProviderText` → araçsız düz metin; Halk-AI'nın sesi.
 *
 * KRALIN GENERALİ BURAYA TAŞINMADI ve bu bilinçli. `app/api/general/route.ts`
 * içindeki `openAI`/`anthropic` aynı istekte HEM metin HEM araç çağrısı okur,
 * konuşma geçmişi taşır, hatayı Kral'a gösterilecek Türkçe
 * mesaja (`providerError`) çevirir ve sağlayıcı gövdesini ham metin olarak
 * saklar. O yolu bu iki kipe sıkıştırmak, çalışan tek oyun-içi sohbeti anlatım
 * kalitesi uğruna riske atmak olurdu; sınır bu yüzden "arka plan çağrıları
 * burada, Kral'ın kendi turu orada" biçiminde çizildi.
 *
 * SIR DİSİPLİNİ (kısıt #4): `apiKey` yalnızca isteğin başlığına yazılır. Bu
 * dosyada hiçbir `console` çağrısı yoktur ve hata mesajları sağlayıcının
 * gövdesini taşımaz — gövde bazı sağlayıcılarda isteğin başlığını yankılar.
 */

/** Sağlayıcıya verilen en uzun süre. İki kip de aynı tavanı kullanır. */
export const PROVIDER_TIMEOUT_MS = 30_000;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type BaseInput = {
  provider: string;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
};

export type ProviderFailureCode = "authentication" | "permission" | "model" | "quota" | "timeout" | "network" | "provider" | "empty";

export type ProviderFailure = { ok: false; code: ProviderFailureCode; message: string };
export type ProviderCheck = { ok: true } | ProviderFailure;

/** Halk/Garnizon anlatımının mevcut davranışını koruyan varsayılan değer. */
export const DEFAULT_TEXT_TEMPERATURE = 0.8;
export const TEXT_TEMPERATURE_OPTIONS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

/** Yönetim ucundaki sayısal sınırın tek kaynağı. */
export function validTextTemperature(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Sağlayıcı/model uyumluluğunun tek kaynağı.
 *
 * Anthropic'in uyarlamalı düşünme kullanan güncel modelleri, varsayılan dışı
 * `temperature` değerini geçersiz istek (400) olarak reddeder. Model adlarını
 * burada tek tek kovalamak gelecekte yeniden kırılacağı için Anthropic'e bu
 * isteğe bağlı parametreyi hiç göndermiyoruz; ton sistem promptuyla kurulur.
 */
export function compatibleSamplingOptions(provider: string, temperature?: number): { temperature?: number } {
  return provider === "anthropic" || temperature === undefined ? {} : { temperature };
}

/**
 * Sağlayıcının ham hata gövdesini istemciye taşımadan yönlendirici bir neden
 * üretir. `callProviderText` yalnızca sağlayıcı adı + HTTP durumunu fırlatır;
 * anahtar ve sağlayıcının olası yankı gövdesi bu sınıra hiç ulaşmaz.
 */
export function describeProviderFailure(error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = /^(?:openai|anthropic) (\d{3})$/.exec(message)?.[1];
  if (status === "401") return { ok: false, code: "authentication", message: "API anahtarı sağlayıcı tarafından reddedildi." };
  if (status === "403") return { ok: false, code: "permission", message: "Anahtarın bu modele erişim yetkisi yok." };
  if (status === "404") return { ok: false, code: "model", message: "Model adı sağlayıcıda bulunamadı." };
  if (status === "429") return { ok: false, code: "quota", message: "Sağlayıcı kotası veya hız sınırı aşıldı." };
  if (status === "400") return { ok: false, code: "model", message: "Model adı ya da istek sağlayıcı tarafından geçersiz bulundu." };
  if (status?.startsWith("5")) return { ok: false, code: "provider", message: "Sağlayıcı geçici olarak yanıt veremiyor." };
  if (error instanceof DOMException && error.name === "TimeoutError") return { ok: false, code: "timeout", message: "Sağlayıcı bağlantısı zaman aşımına uğradı." };
  return { ok: false, code: "network", message: "Sağlayıcıya ağ bağlantısı kurulamadı." };
}

const anthropicHeaders = (apiKey: string) => ({
  "x-api-key": apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
  "content-type": "application/json",
});

const openAiHeaders = (apiKey: string) => ({
  authorization: `Bearer ${apiKey}`,
  "content-type": "application/json",
});

/**
 * Araç çağrılı kip. Hem gece vardiyası hem de Kral çevrimdışıyken masaya oturan
 * General buradan geçer; iki ayrı çağrı yazılsaydı biri araç şemasını, öbürü
 * zaman aşımını farklı kurar ve fark ancak yayında görülürdü.
 */
export async function callProvider(input: BaseInput & { tools: DeskTool[] }): Promise<GameAction | null> {
  const maxTokens = input.maxTokens ?? 400;
  if (input.provider === "anthropic") {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: anthropicHeaders(input.apiKey),
      body: JSON.stringify({ model: input.model, max_tokens: maxTokens, system: input.system, messages: [{ role: "user", content: input.user }], tools: input.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`anthropic ${response.status}`);
    const data = await response.json() as { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> };
    const call = data.content?.find(part => part.type === "tool_use");
    return call?.name ? { name: call.name, arguments: call.input ?? {} } : null;
  }
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: openAiHeaders(input.apiKey),
    body: JSON.stringify({ model: input.model, max_completion_tokens: maxTokens, messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }], tools: input.tools.map(tool => ({ type: "function", function: tool })), tool_choice: "auto" }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`openai ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) return null;
  try { return { name: call.name, arguments: JSON.parse(call.arguments ?? "{}") as Record<string, unknown> }; }
  catch { return null; }
}

/**
 * ARAÇSIZ kip: modelden yalnızca düz metin ister.
 *
 * Araç listesi GÖNDERİLMEZ (boş dizi olarak da değil): Halk-AI'nın oyun
 * durumuna dokunmasının hiçbir yolu olmamalı. Halk emir vermez, konuşur — bu
 * yüzden "araç yok" bu kipin eksiği değil, taşıyıcı kuralıdır.
 *
 * Boş/whitespace cevapta `null` döner; çağıran bunu "model konuşmadı" diye ele
 * alır (bkz. `server/populace-narrator.ts`). Hata YUTULMAZ, yükseltilir:
 * "gösterme ya da son bilinen cümleye düş" kararı çağıranın kararıdır.
 */
export async function callProviderText(input: BaseInput & { temperature?: number }): Promise<string | null> {
  const maxTokens = input.maxTokens ?? 200;
  if (input.provider === "anthropic") {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: anthropicHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model, max_tokens: maxTokens,
        ...compatibleSamplingOptions("anthropic", input.temperature),
        system: input.system, messages: [{ role: "user", content: input.user }],
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`anthropic ${response.status}`);
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
    return text || null;
  }
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: openAiHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model, max_completion_tokens: maxTokens,
      ...compatibleSamplingOptions("openai", input.temperature),
      messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`openai ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return text || null;
}

/**
 * Admin kimliği yazılmadan önce gerçek, çok küçük bir sağlayıcı çağrısıyla
 * anahtar + model ikilisini doğrular. Bu kontrolün başarılı olması yalnızca
 * kaydın varlığını değil, modelin gerçekten konuşabildiğini ifade eder.
 */
export async function verifyProviderConnection(input: Pick<BaseInput, "provider" | "model" | "apiKey"> & { temperature?: number }): Promise<ProviderCheck> {
  try {
    const text = await callProviderText({
      ...input,
      system: "Bu bir bağlantı doğrulamasıdır. Yalnızca TAMAM yaz.",
      user: "Bağlantıyı doğrula.",
      maxTokens: 12,
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    });
    return text
      ? { ok: true }
      : { ok: false, code: "empty", message: "Model bağlantı testine boş yanıt verdi." };
  } catch (error) {
    return describeProviderFailure(error);
  }
}
