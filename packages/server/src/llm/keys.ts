/**
 * BYOK anahtarının yüklenmesi, saklanması ve sağlayıcı hatalarının krallık
 * satırına işlenmesi — GDD §14.6.
 *
 * Anahtar veritabanında yalnızca zarf şifrelemesiyle (bkz. `../crypto.ts`)
 * durur; burada çözülüp doğrudan adaptöre verilir ve hiçbir yere yazılmaz.
 * Bu dosyadaki hiçbir fonksiyon anahtarı — maskelenmiş hâli dışında — log'a,
 * hata mesajına ya da bildirime koymaz (§15.5).
 */

import type { LlmErrorKind, LlmProvider } from '@krallik/shared';
import { query, queryOne, txQuery, txQueryOne, withTransaction } from '../db/pool.js';
import type { KingdomRow } from '../db/rows.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { config } from '../config.js';
import { notify } from '../game/notifications.js';
import { llmErrorMessageTr, llmErrorTitleTr } from './errors.js';

/** Aynı hata için bildirimi bu sıklıktan daha sık tekrarlamayız. */
const ERROR_NOTIFICATION_COOLDOWN_HOURS = 6;

export interface KingdomLlmConfig {
  kingdomId: string;
  provider: LlmProvider;
  model: string;
  baseUrl: string | undefined;
  /** Düz metin anahtar — yalnızca çağrı süresince bellekte. */
  apiKey: string;
}

interface LlmColumns {
  llm_provider: LlmProvider | null;
  llm_model: string | null;
  llm_base_url: string | null;
  api_key_encrypted: Buffer | null;
  api_key_iv: Buffer | null;
  api_key_tag: Buffer | null;
  api_key_wrapped_dek: Buffer | null;
}

/**
 * Krallığın anahtarını çözüp döndürür.
 *
 * `null` dönmesi bir hata değil, tanımlı bir oyun durumudur: anahtar yoksa
 * General sessizdir (§14.6). Çağıran taraf bunu `llm_error` bildirimiyle
 * karşılar, istisna fırlatmaz.
 */
export async function loadKingdomLlmConfig(kingdomId: string): Promise<KingdomLlmConfig | null> {
  const row = await queryOne<LlmColumns & { id: string }>(
    `SELECT id, llm_provider, llm_model, llm_base_url,
            api_key_encrypted, api_key_iv, api_key_tag, api_key_wrapped_dek
       FROM kingdoms WHERE id = $1`,
    [kingdomId],
  );
  if (!row) return null;
  if (!row.llm_provider || !row.llm_model) return null;
  if (!row.api_key_encrypted || !row.api_key_iv || !row.api_key_tag || !row.api_key_wrapped_dek) {
    return null;
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret({
      ciphertext: row.api_key_encrypted,
      iv: row.api_key_iv,
      authTag: row.api_key_tag,
      wrappedDek: row.api_key_wrapped_dek,
    });
  } catch {
    // Kök anahtar döndürülmüş ya da satır kurcalanmış olabilir. Çözülemeyen
    // anahtar pratikte "anahtar yok" ile aynı: oyuncu yeniden girmeli.
    await recordLlmError(kingdomId, 'auth', 'Saklanan anahtar çözülemedi.');
    return null;
  }

  return {
    kingdomId,
    provider: row.llm_provider,
    model: row.llm_model,
    baseUrl: row.llm_base_url ?? undefined,
    apiKey,
  };
}

export interface SaveLlmSettingsInput {
  kingdomId: string;
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | undefined;
}

/**
 * Anahtarı şifreleyip kaydeder ve önceki hata durumunu temizler.
 *
 * Çağrı sırası önemli: `onboarding.ts` önce bağlantıyı dener, ancak başarılı
 * olursa burayı çağırır — bozuk bir anahtarın veritabanına yerleşip her tick'te
 * hata üretmesini istemiyoruz (§14.7 katman 3).
 */
export async function saveKingdomLlmSettings(input: SaveLlmSettingsInput): Promise<void> {
  const secret = encryptSecret(input.apiKey);
  await query(
    `UPDATE kingdoms
        SET llm_provider = $2,
            llm_model = $3,
            llm_base_url = $4,
            api_key_encrypted = $5,
            api_key_iv = $6,
            api_key_tag = $7,
            api_key_wrapped_dek = $8,
            llm_last_error_kind = NULL,
            llm_last_error_at = NULL
      WHERE id = $1`,
    [
      input.kingdomId,
      input.provider,
      input.model,
      input.baseUrl ?? null,
      secret.ciphertext,
      secret.iv,
      secret.authTag,
      secret.wrappedDek,
    ],
  );
}

/** Oyuncu anahtarını kaldırdığında: şifreli alanlar sıfırlanır, model kalır. */
export async function clearKingdomLlmKey(kingdomId: string): Promise<void> {
  await query(
    `UPDATE kingdoms
        SET api_key_encrypted = NULL, api_key_iv = NULL,
            api_key_tag = NULL, api_key_wrapped_dek = NULL
      WHERE id = $1`,
    [kingdomId],
  );
}

export async function markOnboarded(kingdomId: string, now = config.now()): Promise<void> {
  await query('UPDATE kingdoms SET llm_onboarded_at = $2 WHERE id = $1', [kingdomId, now]);
}

export async function recordLlmSuccess(kingdomId: string, now = config.now()): Promise<void> {
  await query(
    `UPDATE kingdoms
        SET llm_last_success_at = $2, llm_last_error_kind = NULL, llm_last_error_at = NULL
      WHERE id = $1`,
    [kingdomId, now],
  );
}

/**
 * "Sessize düşme" kaydı (§14.6): hata cinsi krallık satırına yazılır ve
 * oyuncuya bir `llm_error` bildirimi düşer.
 *
 * Bildirim tekrar tekrar üretilmez — pasif moddaki bir krallık saatte bir
 * denendiği için, aynı hatayı her turda bildirmek gelen kutusunu boğardı.
 * Hata cinsi değiştiğinde ya da soğuma süresi dolduğunda yeniden bildirilir.
 */
export async function recordLlmError(
  kingdomId: string,
  kind: LlmErrorKind,
  detail?: string,
  now = config.now(),
): Promise<void> {
  await withTransaction(async (tx) => {
    const before = await txQueryOne<Pick<KingdomRow, 'llm_last_error_kind' | 'llm_last_error_at'>>(
      tx,
      'SELECT llm_last_error_kind, llm_last_error_at FROM kingdoms WHERE id = $1 FOR UPDATE',
      [kingdomId],
    );
    if (!before) return;

    await txQuery(
      tx,
      'UPDATE kingdoms SET llm_last_error_kind = $2, llm_last_error_at = $3 WHERE id = $1',
      [kingdomId, kind, now],
    );

    const sameKind = before.llm_last_error_kind === kind;
    const lastAt = before.llm_last_error_at;
    const cooledDown =
      lastAt === null ||
      now.getTime() - lastAt.getTime() > ERROR_NOTIFICATION_COOLDOWN_HOURS * 3_600_000;

    if (sameKind && !cooledDown) return;

    await notify(tx, {
      kingdomId,
      kind: 'llm_error',
      severity: kind === 'auth' ? 'critical' : 'warning',
      title: llmErrorTitleTr(kind),
      body: llmErrorMessageTr(kind),
      payload: detail ? { kind, detail } : { kind },
    });
  });
}

/** Krallık şu an "sessiz" mi — arayüzdeki `LlmStatusDto.silent` bunun karşılığı. */
export function isSilent(kingdom: Pick<KingdomRow, 'llm_last_error_kind' | 'api_key_encrypted'>): boolean {
  return kingdom.api_key_encrypted === null || kingdom.llm_last_error_kind !== null;
}
