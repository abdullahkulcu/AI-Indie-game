/**
 * Diplomasi — danışman-danışman görüşmeleri, pazar ve mevcut anlaşmalar.
 *
 * Tasarımın kritik noktası: Kral karşı tarafa asla doğrudan yazmaz. Transkript
 * salt-okunurdur; girdi kutusu yalnızca kendi General'inize verilen bir
 * yönlendirmedir ve arayüz metni bunu açıkça söyler (GDD §10).
 */

import { useState } from 'react';
import type {
  DiplomacyThreadDto,
  DiplomacyTurnDto,
  KingdomStateDto,
  MarketOfferDto,
  RentedTroopsDto,
} from '@krallik/shared';
import { RESOURCE_LABELS_TR, UNITS } from '@krallik/shared';
import { useKingdom } from '../state/useKingdom';
import {
  DIPLOMACY_STATUS_TR,
  PROPOSAL_TR,
  STANCE_TR,
  etaFrom,
  num,
  timeAgo,
} from '../lib/format';

export function DiplomasiTab({ kingdom }: { kingdom: KingdomStateDto }) {
  const { diplomacy, market } = useKingdom();

  const openThreads = diplomacy.filter((t) => t.status === 'pending');
  const settledTrades = diplomacy.filter((t) => t.status === 'accepted' && t.proposalType === 'trade');

  return (
    <div>
      <p className="sub-title">Görüşmeler</p>
      {openThreads.length === 0 && <p className="empty-note">Sürmekte olan görüşme yok.</p>}
      {openThreads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}

      <p className="sub-title spaced">Pazar İlanları</p>
      {market.length === 0 && <p className="empty-note">Pazarda açık ilan yok.</p>}
      {market.map((offer) => (
        <OfferCard key={offer.id} offer={offer} />
      ))}

      <p className="sub-title spaced">Ticaret Anlaşmaları</p>
      {settledTrades.length === 0 && <p className="empty-note">Yürürlükte ticaret anlaşması yok.</p>}
      {settledTrades.map((thread) => (
        <div className="card" key={thread.id}>
          <div className="card-head">
            <span className="card-title">{thread.counterpartyKingdomName}</span>
            <span className="card-meta">{timeAgo(thread.updatedAt)}</span>
          </div>
          <TermsList terms={thread.terms} />
        </div>
      ))}

      <p className="sub-title spaced">Koruma İlişkileri</p>
      <ProtectionSummary kingdom={kingdom} />

      <p className="sub-title spaced">Kiralık Birlikler</p>
      {kingdom.rentedIn.length === 0 && kingdom.rentedOut.length === 0 && (
        <p className="empty-note">Kiralama anlaşmanız yok.</p>
      )}
      {kingdom.rentedIn.map((rental) => (
        <RentalCard key={rental.id} rental={rental} direction="in" />
      ))}
      {kingdom.rentedOut.map((rental) => (
        <RentalCard key={rental.id} rental={rental} direction="out" />
      ))}
    </div>
  );
}

function ThreadCard({ thread }: { thread: DiplomacyThreadDto }) {
  const { steerDiplomacy } = useKingdom();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const send = async () => {
    const text = note.trim();
    if (!text) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await steerDiplomacy(thread.id, text);
      setNote('');
      setFeedback(result.message);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Yönlendirme iletilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          {thread.counterpartyKingdomName} · {PROPOSAL_TR[thread.proposalType]}
        </span>
        <span className="card-meta">{DIPLOMACY_STATUS_TR[thread.status]}</span>
      </div>
      <div className="card-line">
        <span>Karşı tarafın itibarı</span>
        <b>{Math.round(thread.counterpartyReputation)}</b>
      </div>
      <TermsList terms={thread.terms} />

      <div className="transcript" aria-label="Danışman görüşmesi kaydı">
        {thread.transcript.length === 0 ? (
          <p className="empty-note">Henüz söz alınmadı.</p>
        ) : (
          thread.transcript.map((turn) => <TranscriptTurn key={turn.id} turn={turn} />)
        )}
      </div>

      {thread.canSteer ? (
        <>
          <p className="steer-note">
            Bu kutu karşı tarafa gitmez. Yalnızca <b>kendi General'inizi</b> yönlendirirsiniz; sözü o
            kurar, tavizi o verir.
          </p>
          <div className="steer-row">
            <label className="sr-only" htmlFor={`steer-${thread.id}`}>
              General'inize yönlendirme
            </label>
            <input
              id={`steer-${thread.id}`}
              className="input-field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sert dur, demiri 300'ün altına verme…"
              disabled={busy}
            />
            <button className="btn btn-small" type="button" disabled={busy || !note.trim()} onClick={() => void send()}>
              İlet
            </button>
          </div>
        </>
      ) : (
        <p className="steer-note">Bu görüşmede yönlendirme yapılamaz.</p>
      )}
      {feedback && <p className="bld-warn">{feedback}</p>}
    </div>
  );
}

function TranscriptTurn({ turn }: { turn: DiplomacyTurnDto }) {
  return (
    <div className={`transcript-turn${turn.isOwn ? ' own' : ''}`}>
      <span className="who">
        {turn.isOwn ? "General'iniz" : `${turn.speakerKingdomName} General'i`}
        <span className="transcript-stance">[{STANCE_TR[turn.stance]}]</span>
      </span>
      {turn.message}
    </div>
  );
}

function TermsList({ terms }: { terms: Record<string, unknown> }) {
  const entries = Object.entries(terms);
  if (entries.length === 0) return null;
  return (
    <div>
      {entries.map(([key, value]) => (
        <div className="card-line" key={key}>
          <span>{key}</span>
          <b>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</b>
        </div>
      ))}
    </div>
  );
}

function OfferCard({ offer }: { offer: MarketOfferDto }) {
  const { runAction } = useKingdom();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await runAction('accept_market_offer', { offer_id: offer.id });
      setNote(result.message);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'İlan kabul edilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          {offer.kingdomName}
          {offer.isOwn ? ' (sizin ilanınız)' : ''}
        </span>
        <span className="card-meta">{etaFrom(offer.expiresAt) ?? 'süresi doldu'}</span>
      </div>
      <div className="card-line">
        <span>Veriyor</span>
        <b>
          {num(offer.offerAmount)} {RESOURCE_LABELS_TR[offer.offerResource]}
        </b>
      </div>
      <div className="card-line">
        <span>İstiyor</span>
        <b>
          {num(offer.requestAmount)} {RESOURCE_LABELS_TR[offer.requestResource]}
        </b>
      </div>
      <div className="card-line">
        <span>Mesafe · sefer</span>
        <b>
          {offer.distanceTiles} tile · {offer.estimatedTrips} sefer
        </b>
      </div>
      {!offer.isOwn && (
        <div className="bld-actions">
          <button className="btn btn-small" type="button" disabled={busy} onClick={() => void accept()}>
            Kabul Et
          </button>
        </div>
      )}
      {note && <p className="bld-warn">{note}</p>}
    </div>
  );
}

function ProtectionSummary({ kingdom }: { kingdom: KingdomStateDto }) {
  const rows: string[] = [];
  if (kingdom.protectionEndsAt) {
    const eta = etaFrom(kingdom.protectionEndsAt);
    rows.push(eta ? `Başlangıç koruması ${eta} sonra bitiyor.` : 'Başlangıç korumanız sona erdi.');
  }
  if (kingdom.vassalOfKingdomName) {
    rows.push(`${kingdom.vassalOfKingdomName} himayesindesiniz (haraç ödüyorsunuz).`);
  }
  for (const vassal of kingdom.vassals) {
    rows.push(`${vassal.name} sizin himayenizde.`);
  }
  if (kingdom.allianceName) rows.push(`İttifak: ${kingdom.allianceName}`);

  if (rows.length === 0) return <p className="empty-note">Koruma ya da tabiiyet ilişkiniz yok.</p>;
  return (
    <div className="card">
      {rows.map((row, i) => (
        <div className="card-line" key={i}>
          <span>{row}</span>
        </div>
      ))}
    </div>
  );
}

function RentalCard({ rental, direction }: { rental: RentedTroopsDto; direction: 'in' | 'out' }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          {direction === 'in' ? 'Kiraladığınız' : 'Kiraya verdiğiniz'} · {rental.counterpartyKingdomName}
        </span>
        <span className="card-meta">{etaFrom(rental.endsAt) ?? 'süre doldu'}</span>
      </div>
      <div className="card-line">
        <span>{UNITS[rental.unitType].nameTr}</span>
        <b>{num(rental.count)}</b>
      </div>
      <div className="card-line">
        <span>Ücret</span>
        <b>{num(rental.feeGold)} altın</b>
      </div>
    </div>
  );
}
