/**
 * İlk Bağlantı (Onboarding) — GDD §14.7 katman 3.
 *
 * Oyuncu yeni bir model/anahtar bağladığında sistem bir **tanışma çağrısı**
 * yapar. Bu çağrı iki işi birden görüyor:
 *
 *   1. Bağlantının gerçekten çalıştığını doğruluyor — anahtar hatalıysa ya da
 *      model desteklenmiyorsa hata *burada*, gerçek bir tick beklemeden
 *      yakalanıyor.
 *   2. General kendini tanıtıp Kral'ın başlangıç stratejisini soruyor; strateji
 *      notu bir form yerine doğal bir sohbetle oluşuyor ve mevcut Meclis
 *      arayüzüyle birebir örtüşüyor.
 *
 * Kritik sıralama: anahtar **yalnızca çağrı başarılı olursa** kaydedilir.
 * Bozuk bir anahtarın veritabanına yerleşip her saat başı hata üretmesini
 * istemiyoruz.
 */

import type { LlmErrorKind, LlmProvider, LlmRestriction } from '@krallik/shared';
import { config } from '../config.js';
import { queryOne } from '../db/pool.js';
import type { ChannelRow, KingdomRow } from '../db/rows.js';
import { loadKingdomSnapshot } from '../game/state.js';
import { buildKingdomContext } from './context.js';
import { llmErrorMessageTr, toLlmError } from './errors.js';
import { appendChatMessage } from './general.js';
import { markOnboarded, recordLlmSuccess, saveKingdomLlmSettings } from './keys.js';
import { onboardingSystemPrompt } from './prompt.js';
import { createAdapter, runChat } from './provider.js';

export interface OnboardingInput {
  kingdomId: string;
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | undefined;
}

export interface OnboardingResult {
  ok: boolean;
  /** Başarılıysa General'ın tanışma sözleri. */
  greeting?: string;
  error?: string;
  errorKind?: LlmErrorKind;
}

/**
 * Channel'ın LLM kısıtını (§16.1) uygular.
 *
 * GDD'nin kendi notu: bir oyuncunun gerçekten iddia ettiği modeli kullandığını
 * kanıtlamak kritik değil — bu best-effort bir kontrol. Amaç hile önlemek
 * değil, BYOK'un yarattığı model kalitesi farkını admin'in isteğe bağlı olarak
 * sınırlayabilmesi.
 */
export function checkLlmRestriction(
  restriction: LlmRestriction | null,
  provider: LlmProvider,
  model: string,
): string | null {
  if (!restriction) return null;

  if (restriction.allowedProviders && restriction.allowedProviders.length > 0) {
    if (!restriction.allowedProviders.includes(provider)) {
      return `Bu channel yalnızca şu sağlayıcıları kabul ediyor: ${restriction.allowedProviders.join(', ')}.`;
    }
  }

  if (restriction.allowedModels && restriction.allowedModels.length > 0) {
    const normalized = model.toLowerCase();
    const allowed = restriction.allowedModels.some((m) => normalized.includes(m.toLowerCase()));
    if (!allowed) {
      return `Bu channel yalnızca şu modelleri kabul ediyor: ${restriction.allowedModels.join(', ')}.`;
    }
  }

  if (restriction.minTier === 'frontier') {
    // Kaba bir isim eşlemesi; kesin bir kademe kaydı tutmuyoruz çünkü model
    // listeleri sağlayıcı tarafında sürekli değişiyor.
    const frontierHints = ['opus', 'fable', 'gpt-5', 'o3', 'gemini-3', 'ultra', 'pro'];
    if (!frontierHints.some((hint) => model.toLowerCase().includes(hint))) {
      return 'Bu channel yalnızca üst-seviye modellere açık.';
    }
  }

  return null;
}

export async function runOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  const kingdom = await queryOne<KingdomRow>('SELECT * FROM kingdoms WHERE id = $1', [
    input.kingdomId,
  ]);
  if (!kingdom) {
    return { ok: false, error: 'Krallık bulunamadı.' };
  }

  const channel = await queryOne<ChannelRow>('SELECT * FROM channels WHERE id = $1', [
    kingdom.channel_id,
  ]);

  const restrictionError = checkLlmRestriction(
    channel?.llm_restriction ?? null,
    input.provider,
    input.model,
  );
  if (restrictionError) {
    return { ok: false, error: restrictionError, errorKind: 'invalid_request' };
  }

  let adapter;
  try {
    adapter = createAdapter(input.provider, {
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
    });
  } catch (error) {
    const llmError = toLlmError(error, input.provider);
    return { ok: false, error: llmError.message, errorKind: llmError.kind };
  }

  // Tanışma çağrısında araç verilmiyor: General'ın daha Kral'la tanışmadan
  // krallığın durumunu değiştirmesini istemiyoruz. Bu tur salt sohbet.
  const snapshot = await loadKingdomSnapshot(input.kingdomId);
  if (!snapshot) return { ok: false, error: 'Krallık durumu yüklenemedi.' };

  const context = await buildKingdomContext({
    snapshot,
    mode: 'active',
    now: config.now(),
  });

  try {
    const response = await runChat(adapter, {
      system: onboardingSystemPrompt(),
      messages: [
        {
          role: 'user',
          content:
            `Krallığın adı: ${kingdom.name}.\n\n` +
            `Güncel durum:\n${context.text}\n\n` +
            'Kendini Kral\'a tanıt, krallığın şu anki hâline dair kısa bir değerlendirme yap ' +
            've Kral\'ın bu sezon nasıl bir strateji izlemek istediğini sor. Kısa tut.',
        },
      ],
      maxTokens: 700,
    });

    const greeting = response.text.trim();
    if (greeting.length === 0) {
      return {
        ok: false,
        error: 'Model boş yanıt döndürdü; farklı bir model deneyin.',
        errorKind: 'invalid_request',
      };
    }

    // Bağlantı çalışıyor — ancak şimdi kaydediyoruz.
    await saveKingdomLlmSettings({
      kingdomId: input.kingdomId,
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    });
    await markOnboarded(input.kingdomId, config.now());
    await recordLlmSuccess(input.kingdomId, config.now());

    await appendChatMessage({
      kingdomId: input.kingdomId,
      role: 'system',
      content: `General bağlandı: ${input.provider} / ${input.model}.`,
    });
    await appendChatMessage({
      kingdomId: input.kingdomId,
      role: 'general',
      content: greeting,
      tokenUsage: response.usage ?? null,
    });

    return { ok: true, greeting };
  } catch (error) {
    const llmError = toLlmError(error, input.provider);
    // Başarısız bağlantı kaydedilmez; oyuncu düzeltip tekrar deneyebilir.
    return {
      ok: false,
      error: `${llmErrorMessageTr(llmError.kind)} (${llmError.message})`,
      errorKind: llmError.kind,
    };
  }
}
