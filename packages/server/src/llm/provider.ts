/**
 * Sağlayıcıdan bağımsız LLM adaptör katmanı — GDD §15.4.
 *
 * Oyuncu kendi anahtarını getiriyor (§14.6), dolayısıyla hangi sağlayıcının
 * kullanılacağını biz seçmiyoruz. Oyunun geri kalanı tek bir iç arayüz
 * (`LlmAdapter`) görür; Anthropic/OpenAI/Google farkları yalnızca
 * `adapters/` altındaki dört dosyada yaşar.
 *
 * Sağlayıcı SDK'ları bilinçli olarak kullanılmıyor: dört adaptörün de tek
 * ihtiyacı bir POST isteği ve JSON ayrıştırması. SDK'lar bağımlılık yüzeyini
 * büyütür, sürüm uyumsuzluklarını içeri taşır ve dördünü birbirinden farklı
 * biçimlere sokardı.
 */

import type { LlmProvider, LlmRequest, LlmResponse } from '@krallik/shared';
import { config } from '../config.js';
import { LlmError, classifyHttpStatus, classifyNetworkError } from './errors.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createGoogleAdapter } from './adapters/google.js';
import { createOpenAiAdapter } from './adapters/openai.js';
import { createOpenAiCompatibleAdapter } from './adapters/openaiCompatible.js';

/** Modelin bir turda üretebileceği azami çıktı; araç çağrıları kısa olur. */
export const DEFAULT_MAX_TOKENS = 2048;

export interface AdapterOptions {
  /** Düz metin API anahtarı. Yalnızca bellekte yaşar, asla loglanmaz (§15.5). */
  apiKey: string;
  model: string;
  /** `openai_compatible` için zorunlu; diğerlerinde sağlayıcı varsayılanını ezer. */
  baseUrl?: string | undefined;
}

export interface LlmAdapter {
  readonly provider: LlmProvider;
  readonly model: string;
  chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export type AdapterFactory = (options: AdapterOptions) => LlmAdapter;

const BUILT_IN: Record<LlmProvider, AdapterFactory> = {
  anthropic: createAnthropicAdapter,
  openai: createOpenAiAdapter,
  google: createGoogleAdapter,
  openai_compatible: createOpenAiCompatibleAdapter,
};

/**
 * Testlerin ve ileride eklenecek sağlayıcıların yerleşik fabrikayı
 * değiştirebilmesi için küçük bir kayıt defteri. Boş kaldığı sürece davranış
 * `BUILT_IN` ile birebir aynı.
 */
const overrides = new Map<LlmProvider, AdapterFactory>();

export function registerAdapter(provider: LlmProvider, factory: AdapterFactory): void {
  overrides.set(provider, factory);
}

export function resetAdapterOverrides(): void {
  overrides.clear();
}

export function createAdapter(provider: LlmProvider, options: AdapterOptions): LlmAdapter {
  const factory = overrides.get(provider) ?? BUILT_IN[provider];
  if (!factory) {
    throw new LlmError('invalid_request', `Bilinmeyen sağlayıcı: ${provider}`, { provider });
  }
  if (!options.apiKey) {
    throw new LlmError('auth', 'API anahtarı yok.', { provider });
  }
  if (!options.model) {
    throw new LlmError('invalid_request', 'Model seçilmemiş.', { provider });
  }
  return factory(options);
}

/**
 * Tek çağrılık zaman aşımı. Her adaptör kendi `fetch`'inde bunu bir kez daha
 * `AbortSignal.any` ile birleştirir; böylece hem çağıranın iptali hem de üst
 * sınır aynı anda geçerli olur.
 */
export async function runChat(adapter: LlmAdapter, request: LlmRequest): Promise<LlmResponse> {
  return adapter.chat(request, AbortSignal.timeout(config.llmTimeoutMs));
}

export interface PostJsonOptions {
  provider: LlmProvider;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

/** Hata gövdesi log'a/mesaja girebilsin diye kısaltılır. */
function truncate(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Dört adaptörün ortak HTTP yolu.
 *
 * Anahtar `headers` içinde gelir ve bu fonksiyon hiçbir koşulda `headers`'ı
 * log'a ya da hata mesajına yazmaz — §15.5'in "anahtar asla düz metin
 * loglanmaz" kuralı burada uygulanır.
 */
export async function postJson<T>(options: PostJsonOptions): Promise<T> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(config.llmTimeoutMs)]);

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: JSON.stringify(options.body),
      signal,
    });
  } catch (error) {
    throw new LlmError(
      classifyNetworkError(error),
      `Sağlayıcıya ulaşılamadı (${options.provider}).`,
      { provider: options.provider, cause: error },
    );
  }

  const text = await response.text();

  if (!response.ok) {
    throw new LlmError(
      classifyHttpStatus(response.status, text),
      `Sağlayıcı ${response.status} döndü: ${truncate(text)}`,
      { provider: options.provider, status: response.status },
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new LlmError('unknown', 'Sağlayıcı yanıtı JSON olarak çözülemedi.', {
      provider: options.provider,
      status: response.status,
      cause: error,
    });
  }
}

/**
 * Model bazen araç argümanlarını bozuk JSON olarak üretir. Turu komple
 * düşürmek yerine boş argümanla geçiriyoruz: backend zaten her argümanı
 * yeniden doğruluyor (§15.5) ve model hata mesajını görüp kendini düzeltebilir.
 */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}
