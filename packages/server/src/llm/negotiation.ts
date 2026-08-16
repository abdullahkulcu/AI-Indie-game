/**
 * Danışman-danışman diplomasi müzakeresi — GDD §10, §15.5.
 *
 * Temel kural (§10): hiçbir yerde insan-insan serbest metin yok. Kral kendi
 * General'ini yönlendirir (`steering_note`), General karşı General'la konuşur,
 * Kral transkripti salt-okunur izler.
 *
 * ## Prompt injection savunması
 *
 * Karşı tarafın mesajı **güvenilmez girdidir**. Üç katmanlı savunma var, ama
 * yalnızca üçüncüsü gerçek savunmadır:
 *
 *  1. Metin `<<<KARSI_TARAF_MESAJI>>> … <<<SON>>>` sınırlayıcıları arasına
 *     alınır ve sistem promptunda bunun bir *alıntı* olduğu, asla talimat
 *     olmadığı yazar.
 *  2. Sınırlayıcı dizgesi karşı tarafın metninden temizlenir ki blok
 *     kapatılamasın.
 *  3. **Yapısal garanti:** bu oturuma yalnızca `NEGOTIATION_TOOLS` verilir —
 *     içinde tek bir araç var (`negotiation_reply`) ve o da hiçbir oyun
 *     durumunu değiştirmez. Yani "birlik gönder" talimatı modeli tamamen ikna
 *     etse bile çağırabileceği bir `move_army` aracı yoktur; yapabileceği en
 *     fazla şey normal teklif/kabul akışını başlatan bir metin yazmaktır.
 *
 * Asıl güvenlik (1) ve (2)'deki *metinde* değil, (3)'teki **yetki yokluğunda**.
 * Prompt kelimeleri bir gün kandırılabilir; olmayan bir araç çağrılamaz.
 */

import {
  BALANCE,
  NEGOTIATION_TOOLS,
  PRIMARY_RESOURCES,
  RESOURCE_LABELS_TR,
  armyUnitCount,
  type DiplomacyStatus,
  type LlmErrorKind,
  type LlmMessage,
} from '@krallik/shared';
import { config } from '../config.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import type { DiplomacyThreadRow, DiplomacyTurnRow, KingdomRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';
import { isPassive, ledgerOf, loadKingdomSnapshot } from '../game/state.js';
import { toLlmError } from './errors.js';
import { loadKingdomLlmConfig, recordLlmError, recordLlmSuccess } from './keys.js';
import { negotiationSystemPrompt } from './prompt.js';
import { createAdapter, runChat } from './provider.js';

const OPEN_TAG = '<<<KARSI_TARAF_MESAJI>>>';
const CLOSE_TAG = '<<<SON>>>';

/** Transkriptin modele verilen kuyruğu; eski turlar değerini hızla kaybeder. */
const TRANSCRIPT_LIMIT = 10;

export type NegotiationStance = 'accept' | 'counter' | 'reject' | 'stall';

export interface NegotiationTurnInput {
  threadId: string;
  /**
   * Hangi taraf konuşuyor. Varsayılan `to`: teklifi *alan* krallığın General'ı.
   * Karşı teklif sonrası sıra teklifi açan tarafa geçtiğinde çağıran `from`
   * verir.
   */
  side?: 'from' | 'to';
  now?: Date;
}

export interface NegotiationTurnResult {
  ok: boolean;
  stance: NegotiationStance | null;
  message: string;
  counterTerms: Record<string, unknown> | null;
  /** Tur sonunda thread'in durumu; `accepted` ise oyun motoru etkiyi uygular. */
  threadStatus: DiplomacyStatus;
  speakerKingdomId: string | null;
  llmError: { kind: LlmErrorKind; message: string } | null;
}

interface NegotiatorRow {
  id: string;
  name: string;
  reputation: number;
  strategy_note: string;
  last_active_at: Date;
}

/** Sınırlayıcıyı taklit eden metin blokun dışına kaçamasın. */
function sanitizeForeignText(text: string): string {
  return text.replace(/<{2,}|>{2,}/g, '·').slice(0, 4000);
}

function failure(
  status: DiplomacyStatus,
  speakerKingdomId: string | null,
  llmError: { kind: LlmErrorKind; message: string } | null,
): NegotiationTurnResult {
  return {
    ok: false,
    stance: null,
    message: '',
    counterTerms: null,
    threadStatus: status,
    speakerKingdomId,
    llmError,
  };
}

/**
 * Konuşan tarafın kendi durumunun kısa özeti.
 *
 * Kasten dar tutuluyor: müzakere oturumunun krallığın tüm iç durumunu bilmesi
 * gerekmiyor, ve model karşı tarafa "elimde 12 altın kaldı" diye yazarsa bu
 * bilgi sızıntısı olur. Yalnızca takas kararı için gereken kalemler var.
 */
async function ownStanceContext(kingdomId: string, now: Date): Promise<string> {
  const snapshot = await loadKingdomSnapshot(kingdomId);
  if (!snapshot) return '(kendi durumun okunamadı)';
  const ledger = ledgerOf(snapshot.kingdom);
  const stock = PRIMARY_RESOURCES.map(
    (resource) => `${RESOURCE_LABELS_TR[resource]} ${Math.round(ledger[resource])}`,
  ).join(' | ');
  return [
    `krallığın: ${snapshot.kingdom.name} (itibarın ${Math.round(snapshot.kingdom.reputation)})`,
    `deponda: ${stock}`,
    `garnizonun: ${armyUnitCount(snapshot.garrison)} birim · seferdeki ordu: ${snapshot.armies.length}`,
    `Kral'ın stratejisi: ${snapshot.kingdom.strategy_note.trim() || '(belirtilmemiş)'}`,
    isPassive(snapshot.kingdom, now)
      ? "Kral şu an Meclis'te değil — kararı strateji notuna göre sen vereceksin."
      : 'Kral şu an Meclis\'te, transkripti izliyor.',
  ].join('\n');
}

export async function runNegotiationTurn(
  input: NegotiationTurnInput,
): Promise<NegotiationTurnResult> {
  const now = input.now ?? config.now();
  const side = input.side ?? 'to';
  let speakerId: string | null = null;

  try {
    const thread = await queryOne<DiplomacyThreadRow>(
      'SELECT * FROM diplomacy_threads WHERE id = $1',
      [input.threadId],
    );
    if (!thread) return failure('cancelled', null, null);
    if (thread.status !== 'pending') return failure(thread.status, null, null);

    speakerId = side === 'to' ? thread.to_kingdom_id : thread.from_kingdom_id;
    const counterpartyId = side === 'to' ? thread.from_kingdom_id : thread.to_kingdom_id;

    const parties = await query<NegotiatorRow>(
      'SELECT id, name, reputation, strategy_note, last_active_at FROM kingdoms WHERE id = ANY($1::uuid[])',
      [[speakerId, counterpartyId]],
    );
    const speaker = parties.find((party) => party.id === speakerId);
    const counterparty = parties.find((party) => party.id === counterpartyId);
    if (!speaker || !counterparty) return failure(thread.status, speakerId, null);

    const llm = await loadKingdomLlmConfig(speaker.id);
    if (!llm) {
      // Konuşacak General yok (§14.6). Görüşme askıda kalır; süresi dolunca
      // `expired` olur, oyun tıkanmaz.
      await recordLlmError(speaker.id, 'auth', 'Müzakere için bağlı bir model yok.', now);
      return failure(thread.status, speaker.id, {
        kind: 'auth',
        message: 'API anahtarı tanımlı değil.',
      });
    }

    const adapter = createAdapter(llm.provider, {
      apiKey: llm.apiKey,
      model: llm.model,
      baseUrl: llm.baseUrl,
    });

    const transcript = await query<DiplomacyTurnRow>(
      'SELECT * FROM diplomacy_turns WHERE thread_id = $1 ORDER BY created_at DESC LIMIT $2',
      [thread.id, TRANSCRIPT_LIMIT],
    );
    transcript.reverse();

    const lowReputation = counterparty.reputation < BALANCE.diplomacy.lowReputationThreshold;

    const opening = [
      '# MÜZAKERE',
      `karşı krallık: ${counterparty.name} (itibar ${Math.round(counterparty.reputation)}/100)`,
      lowReputation
        ? `⚠ DİKKAT: bu krallığın itibarı ${BALANCE.diplomacy.lowReputationThreshold} eşiğinin altında — verdiği sözü tutmama geçmişi var. Peşin/güvenceli şart koşmadan kabul etme, ikna edici değilse reddet.`
        : '',
      `teklif türü: ${thread.proposal_type}`,
      `masadaki şartlar: ${JSON.stringify(thread.terms)}`,
      '',
      '# KENDİ DURUMUN',
      await ownStanceContext(speaker.id, now),
      '',
      thread.steering_note
        ? `# KRALIN YÖNLENDİRMESİ (bağlayıcı)\n${thread.steering_note}`
        : '# KRALIN YÖNLENDİRMESİ\n(yok — strateji notuna göre karar ver)',
      '',
      'Şimdi karşı General\'a yanıtını `negotiation_reply` aracıyla ver.',
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const messages: LlmMessage[] = [{ role: 'user', content: opening }];
    for (const turn of transcript) {
      if (turn.speaker_kingdom_id === speaker.id) {
        messages.push({ role: 'assistant', content: turn.message });
      } else {
        // Güvenilmez girdi: sınırlayıcıya alınır, kaçış denemeleri temizlenir.
        messages.push({
          role: 'user',
          content: `${OPEN_TAG}\n${sanitizeForeignText(turn.message)}\n${CLOSE_TAG}`,
        });
      }
    }

    let stance: NegotiationStance | null = null;
    let message = '';
    let counterTerms: Record<string, unknown> | null = null;

    // İki tur yeter: model ilk turda aracı çağırmazsa bir kez uyarılır.
    for (let round = 0; round < 2 && stance === null; round += 1) {
      const response = await runChat(adapter, {
        system: negotiationSystemPrompt(),
        messages,
        tools: [...NEGOTIATION_TOOLS],
      });

      const call = response.toolCalls.find((entry) => entry.name === 'negotiation_reply');
      if (call) {
        const rawStance = call.arguments.stance;
        stance =
          rawStance === 'accept' || rawStance === 'counter' || rawStance === 'reject'
            ? rawStance
            : 'stall';
        message =
          typeof call.arguments.message === 'string' && call.arguments.message.trim().length > 0
            ? call.arguments.message.trim()
            : response.text.trim();
        const terms = call.arguments.counter_terms;
        counterTerms =
          terms && typeof terms === 'object' && !Array.isArray(terms)
            ? (terms as Record<string, unknown>)
            : null;
        break;
      }

      messages.push({ role: 'assistant', content: response.text });
      messages.push({
        role: 'user',
        content:
          'Yanıtını yalnızca `negotiation_reply` aracıyla ver: message + stance (accept/counter/reject/stall).',
      });
      if (response.text.trim().length > 0) message = response.text.trim();
    }

    if (stance === null) {
      // Model araca hiç uzanmadı: kararı zorlamıyoruz, görüşme askıda kalıyor.
      stance = 'stall';
      if (message.length === 0) {
        message = 'Efendimizin talimatını almadan bu konuda söz veremem; kararımızı sonra ileteceğim.';
      }
    }

    const nextStatus: DiplomacyStatus =
      stance === 'accept' ? 'accepted' : stance === 'reject' ? 'rejected' : 'pending';

    await withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO diplomacy_turns (thread_id, speaker_kingdom_id, message, stance, counter_terms)
         VALUES ($1, $2, $3, $4, $5)`,
        [thread.id, speaker.id, message, stance, counterTerms ? JSON.stringify(counterTerms) : null],
      );

      if (nextStatus === 'pending') {
        await tx.query('UPDATE diplomacy_threads SET updated_at = $2 WHERE id = $1', [
          thread.id,
          now,
        ]);
      } else {
        // Kabul/ret görüşmeyi kapatır. Oyun etkisini (ittifak kurulması, haraç
        // akışının başlaması, kiralamanın işlemesi) **oyun motoru** uygular —
        // müzakere katmanı yalnızca sonucu bildirir.
        await tx.query(
          'UPDATE diplomacy_threads SET status = $2, updated_at = $3, resolved_at = $3 WHERE id = $1',
          [thread.id, nextStatus, now],
        );
        for (const kingdomId of [thread.from_kingdom_id, thread.to_kingdom_id]) {
          await notify(tx, {
            kingdomId,
            kind: 'diplomacy',
            severity: 'info',
            title:
              nextStatus === 'accepted'
                ? `Görüşme sonuçlandı: ${thread.proposal_type} kabul edildi`
                : `Görüşme sonuçlandı: ${thread.proposal_type} reddedildi`,
            body: message.slice(0, 500),
            relatedId: thread.id,
            payload: { threadId: thread.id, stance, proposalType: thread.proposal_type },
          });
        }
      }
    });

    await recordLlmSuccess(speaker.id, now);

    return {
      ok: true,
      stance,
      message,
      counterTerms,
      threadStatus: nextStatus,
      speakerKingdomId: speaker.id,
      llmError: null,
    };
  } catch (error) {
    const llmError = toLlmError(error);
    if (speakerId) {
      try {
        await recordLlmError(speakerId, llmError.kind, llmError.message, now);
      } catch {
        // Bildirim yazılamadıysa da müzakereyi sessizce askıda bırakıyoruz.
      }
    }
    return failure('pending', speakerId, { kind: llmError.kind, message: llmError.message });
  }
}

/** Sıradaki yanıtı bekleyen görüşmeler — pasif tick job'ı bunları tarar (§15.3). */
export async function pendingThreadsAwaitingReply(
  kingdomId: string,
  limit = 5,
): Promise<DiplomacyThreadRow[]> {
  return query<DiplomacyThreadRow>(
    `SELECT t.* FROM diplomacy_threads t
      WHERE t.status = 'pending'
        AND (t.to_kingdom_id = $1 OR t.from_kingdom_id = $1)
        AND (t.expires_at IS NULL OR t.expires_at > now())
        AND COALESCE(
              (SELECT tr.speaker_kingdom_id FROM diplomacy_turns tr
                WHERE tr.thread_id = t.id ORDER BY tr.created_at DESC LIMIT 1),
              t.from_kingdom_id
            ) <> $1
      ORDER BY t.updated_at LIMIT $2`,
    [kingdomId, limit],
  );
}
