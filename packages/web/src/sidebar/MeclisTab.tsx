/**
 * Meclis — Kral ile General'in yazıştığı yer.
 *
 * Üç katman: (1) General sessize düştüyse uyarı bandı, (2) onay bekleyen büyük
 * kararlar (§14.5), (3) sohbet kaydı. Yürütülen aksiyonlar mesajın altında
 * küçük çipler olarak görünür — General'in ne yaptığı, ne söylediğinden ayrı
 * okunabilsin diye.
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ChatMessageDto, ExecutedActionDto, LlmStatusDto, PendingDecisionDto } from '@krallik/shared';
import { useKingdom } from '../state/useKingdom';
import { useRouter } from '../state/router';
import { actionLabel, clockOf, etaFrom } from '../lib/format';

export function MeclisTab({ kingdomId, llm }: { kingdomId: string; llm: LlmStatusDto | null }) {
  const { chat, decisions, sendChat, respondDecision } = useKingdom();
  const { navigate } = useRouter();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Yeni mesaj geldikçe kaydı en alta sabitle.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);
    setError(null);
    setPressed(true);
    window.setTimeout(() => setPressed(false), 160);
    try {
      await sendChat(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Buyruk iletilemedi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="tab-pane-fill">
      {llm?.silent && (
        <div className="alert alert-critical" role="alert">
          <strong>General sessize düştü</strong>
          Anahtarınızı kontrol edin — krallık işlemeye devam ediyor, ancak yeni inisiyatif alınmıyor.
          {llm.lastErrorKind ? ` (Son hata: ${llm.lastErrorKind})` : ''}{' '}
          <a
            href="#/ayarlar"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'settings', kingdomId });
            }}
          >
            Ayarlara git
          </a>
        </div>
      )}

      {llm && !llm.configured && !llm.silent && (
        <div className="alert alert-warning">
          <strong>General'iniz henüz konuşamıyor</strong>
          Bir sağlayıcı ve anahtar tanımlayın.{' '}
          <a
            href="#/ayarlar"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'settings', kingdomId });
            }}
          >
            Ayarlara git
          </a>
        </div>
      )}

      <div className="advisor-row">
        <div className="advisor-badge" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3l2 4 4 .6-3 3 .7 4.2L12 13l-3.7 1.8L9 10.6l-3-3 4-.6 2-4z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="advisor-name">Başvezir</div>
          <div className="advisor-role">Saray Danışmanınız</div>
        </div>
      </div>

      {decisions.map((decision) => (
        <DecisionCard
          key={decision.id}
          decision={decision}
          onRespond={(response) => respondDecision(decision.id, response)}
        />
      ))}

      <div className="chat-log" ref={logRef} aria-live="polite" aria-label="Meclis kaydı">
        {chat.length === 0 && (
          <div className="msg system">Meclis henüz toplanmadı. İlk buyruğunuzu iletin.</div>
        )}
        {chat.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <form className="chat-input-row" onSubmit={onSubmit}>
        <label htmlFor="chatInput" className="sr-only">
          Danışmanınıza buyruğunuzu yazın
        </label>
        <input
          type="text"
          id="chatInput"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Buyruğunuzu iletin…"
          autoComplete="off"
          disabled={sending}
        />
        <button
          type="submit"
          className={`seal-btn${pressed ? ' pressed' : ''}`}
          aria-label="Buyruğu mühürle ve gönder"
          disabled={sending}
        >
          ✦
        </button>
      </form>
    </div>
  );
}

function ChatMessage({ message }: { message: ChatMessageDto }) {
  const role = message.role === 'king' ? 'player' : message.role === 'general' ? 'advisor' : 'system';
  const who = message.role === 'king' ? 'Siz' : message.role === 'general' ? 'Başvezir' : 'Saray Kâtibi';

  return (
    <div className={`msg ${role}`}>
      {role !== 'system' && (
        <span className="who">
          {who}
          {message.isPassiveSummary && <span className="msg-passive">PASİF ÖZET</span>}{' '}
          <span className="msg-passive">{clockOf(message.createdAt)}</span>
        </span>
      )}
      {message.content}
      {message.actions.length > 0 && (
        <div className="action-chips">
          {message.actions.map((action, i) => (
            <ActionChip key={`${message.id}-${i}`} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionChip({ action }: { action: ExecutedActionDto }) {
  return (
    <span className={`action-chip ${action.ok ? 'ok' : 'fail'}`} title={JSON.stringify(action.arguments)}>
      {action.ok ? '✓' : '✕'} {actionLabel(action.name)}
      {!action.ok && action.message ? ` — ${action.message}` : ''}
      {action.quotaSpent > 0 && <span className="chip-quota">−{action.quotaSpent} kota</span>}
    </span>
  );
}

function DecisionCard({
  decision,
  onRespond,
}: {
  decision: PendingDecisionDto;
  onRespond: (response: 'approve' | 'reject') => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const eta = etaFrom(decision.expiresAt);

  const respond = async (response: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await onRespond(response);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="decision-card">
      <p className="decision-title">Onayınız bekleniyor · {actionLabel(decision.proposedAction.name)}</p>
      <p className="decision-rec">{decision.generalRecommendation}</p>
      <p className="decision-args">{JSON.stringify(decision.proposedAction.arguments)}</p>
      {decision.riskReasons.length > 0 && (
        <ul className="risk-list">
          {decision.riskReasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
      <div className="decision-actions">
        <button className="btn btn-small btn-approve" type="button" disabled={busy} onClick={() => void respond('approve')}>
          Onayla
        </button>
        <button className="btn btn-small btn-reject" type="button" disabled={busy} onClick={() => void respond('reject')}>
          Reddet
        </button>
      </div>
      <p className="decision-expiry">
        {eta ? `Yanıt verilmezse ${eta} içinde güvenli varsayılan uygulanır.` : 'Süresi doldu — güvenli varsayılan uygulanıyor.'}
      </p>
    </div>
  );
}
