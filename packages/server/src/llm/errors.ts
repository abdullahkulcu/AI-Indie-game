/**
 * Sağlayıcı hatalarının sınıflandırılması — GDD §14.6 / §15.4.
 *
 * BYOK modelinde hata toleransı asıl mühendislik yükü: bir oyuncunun anahtarı
 * geçersizse ya da rate-limit yediyse sistem çökmemeli, o krallığın General'ı
 * "sessize" düşmeli. Bunu yapabilmek için önce hatanın *cinsini* bilmemiz
 * gerekiyor — geçici bir 503 ile kalıcı bir 401 aynı davranışı hak etmiyor.
 *
 * Bu dosya ağ ya da veritabanına dokunmaz; saf sınıflandırmadır ve test edilir.
 */

import type { LlmErrorKind, LlmProvider } from '@krallik/shared';

/** Hata gövdesinden anlaşılabilen "bağlam penceresi taştı" işaretleri. */
const CONTEXT_OVERFLOW_SIGNALS = [
  'context length',
  'context_length',
  'context window',
  'maximum context',
  'too many tokens',
  'token limit',
  'tokens exceed',
  'prompt is too long',
  'input is too long',
  'string too long',
  'exceeds the maximum',
  'reduce the length',
];

export interface LlmErrorOptions {
  provider?: LlmProvider;
  status?: number;
  cause?: unknown;
}

/**
 * Adaptör katmanının fırlattığı tek hata tipi. Üst katman (`general.ts`)
 * yalnızca `kind` alanına bakarak davranışına karar verir; sağlayıcıya özgü
 * ayrıntı buradan yukarı sızmaz.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly provider: LlmProvider | undefined;
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, message: string, options: LlmErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LlmError';
    this.kind = kind;
    this.provider = options.provider;
    this.status = options.status;
  }
}

export function looksLikeContextOverflow(body: string): boolean {
  const lower = body.toLowerCase();
  return CONTEXT_OVERFLOW_SIGNALS.some((signal) => lower.includes(signal));
}

/**
 * HTTP durum kodu → hata cinsi.
 *
 * 400'ün iki farklı anlamı var: bağlam penceresi taşması (paketi küçültüp
 * tekrar denenebilir) ile gerçekten bozuk istek (kod hatası, tekrar denemek
 * anlamsız). Ayrımı yalnızca gövdedeki metinden çıkarabiliyoruz.
 */
export function classifyHttpStatus(status: number, body = ''): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider_unavailable';
  // 408/409: sağlayıcı tarafında geçici; yeniden denemeye değer.
  if (status === 408 || status === 409) return 'provider_unavailable';
  if (status === 400 && looksLikeContextOverflow(body)) return 'context_length';
  // 413 (payload too large) da fiilen bağlam taşmasıdır.
  if (status === 413) return 'context_length';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

/**
 * `fetch` seviyesindeki hatalar. Zaman aşımı ve DNS/TCP kopması oyuncunun
 * anahtarıyla ilgili değil — bunları `provider_unavailable` sayıyoruz ki
 * geçici bir kesinti General'ı kalıcı olarak sessize düşürmesin.
 */
export function classifyNetworkError(error: unknown): LlmErrorKind {
  if (error instanceof LlmError) return error.kind;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'provider_unavailable';
    if (error.name === 'TypeError') return 'provider_unavailable';
  }
  return 'unknown';
}

export function toLlmError(error: unknown, provider?: LlmProvider): LlmError {
  if (error instanceof LlmError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const options: LlmErrorOptions = { cause: error };
  if (provider) options.provider = provider;
  return new LlmError(classifyNetworkError(error), message, options);
}

/**
 * General'ın "sessize düşmesi" (§14.6) yalnızca oyuncunun müdahalesini
 * gerektiren hatalarda anlamlı. Geçici sağlayıcı kesintisinde de yeni karar
 * alınmaz ama bu kalıcı bir arıza değildir — bildirimin tonu buna göre değişir.
 */
export function isPlayerActionableError(kind: LlmErrorKind): boolean {
  return kind === 'auth' || kind === 'rate_limit' || kind === 'invalid_request';
}

/** Oyuncuya gösterilecek Türkçe açıklama — anahtarın kendisi asla geçmez. */
export function llmErrorMessageTr(kind: LlmErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'API anahtarınız reddedildi. Ayarlar sayfasından anahtarınızı kontrol edin — General\'ınız o zamana dek yeni karar alamayacak.';
    case 'rate_limit':
      return 'Sağlayıcınız istek sınırına ulaştı. Bir süre sonra tekrar denenecek; bu sırada General yeni inisiyatif almayacak.';
    case 'context_length':
      return 'Durum paketi seçtiğiniz modelin bağlam penceresine sığmadı. Daha geniş bağlamlı bir model seçmeyi düşünün.';
    case 'provider_unavailable':
      return 'Sağlayıcıya ulaşılamadı. Krallığın üretimi ve kuyrukları işlemeye devam ediyor; General bir sonraki tur tekrar denenecek.';
    case 'invalid_request':
      return 'Sağlayıcı isteği reddetti. Seçtiğiniz model adı bu sağlayıcıda geçerli olmayabilir.';
    default:
      return 'General ile bağlantı kurulamadı. Krallık işlemeye devam ediyor, yeni kararlar duraklatıldı.';
  }
}

/** Bildirim başlığı — `notifications.title` alanı için. */
export function llmErrorTitleTr(kind: LlmErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'General sessize düştü: anahtar geçersiz';
    case 'rate_limit':
      return 'General sessize düştü: istek sınırı';
    case 'context_length':
      return 'General sessize düştü: bağlam penceresi yetersiz';
    default:
      return 'General\'a ulaşılamıyor';
  }
}
