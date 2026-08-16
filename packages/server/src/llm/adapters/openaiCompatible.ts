/**
 * OpenAI-uyumlu üçüncü parti uç noktalar (yerel sunucular, aracı servisler).
 *
 * Ayrı bir dosya olmasının tek sebebi `baseUrl`'in burada **zorunlu** olması:
 * varsayılana düşmek, oyuncunun kendi sunucusuna gitmesi gereken isteği
 * sessizce OpenAI'a — ve oyuncunun anahtarını yanlış tarafa — göndermek olurdu.
 */

import type { LlmProvider } from '@krallik/shared';
import { LlmError } from '../errors.js';
import { createOpenAiStyleAdapter } from './openai.js';
import type { AdapterOptions, LlmAdapter } from '../provider.js';

const PROVIDER: LlmProvider = 'openai_compatible';

export function createOpenAiCompatibleAdapter(options: AdapterOptions): LlmAdapter {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    throw new LlmError(
      'invalid_request',
      'OpenAI-uyumlu sağlayıcı için sunucu adresi (baseUrl) zorunludur.',
      { provider: PROVIDER },
    );
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new LlmError('invalid_request', 'Sunucu adresi http(s) ile başlamalı.', {
      provider: PROVIDER,
    });
  }
  return createOpenAiStyleAdapter(PROVIDER, options, baseUrl);
}
