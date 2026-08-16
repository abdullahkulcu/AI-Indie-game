/**
 * Ordu — garnizon, seferdeki ordular, kuşatmalar ve kervanlar.
 *
 * Kuşatma kartı savunmanın tek doğrudan müdahale noktası: taktik seçimi emir
 * kotasından düşmediği için (zaten olmakta olan bir olaya tepki) Kral'ın kendi
 * eliyle değiştirebileceği bir alan olarak bırakıldı.
 */

import { useState } from 'react';
import type { ArmyComposition, ArmyDto, CaravanDto, KingdomStateDto, SiegeDto, Tactic, UnitType } from '@krallik/shared';
import { RESOURCE_LABELS_TR, TACTICS, UNITS, armyUnitCount } from '@krallik/shared';
import { useKingdom } from '../state/useKingdom';
import { INTENT_TR, TACTIC_TR, etaFrom, num, pct } from '../lib/format';

function CompositionGrid({ composition }: { composition: ArmyComposition }) {
  const entries = Object.entries(composition).filter(
    ([, count]) => typeof count === 'number' && count > 0,
  ) as [UnitType, number][];

  if (entries.length === 0) return <p className="empty-note">Birlik yok.</p>;

  return (
    <div className="troop-grid">
      {entries.map(([unit, count]) => (
        <div className="troop-cell" key={unit}>
          <span>{UNITS[unit].nameTr}</span>
          <b>{num(count)}</b>
        </div>
      ))}
    </div>
  );
}

export function OrduTab({ kingdom }: { kingdom: KingdomStateDto }) {
  const ownSieges = kingdom.sieges;

  return (
    <div>
      <p className="sub-title">Garnizon ({num(armyUnitCount(kingdom.garrison))} birlik)</p>
      <CompositionGrid composition={kingdom.garrison} />

      {kingdom.trainingQueue.length > 0 && (
        <>
          <p className="sub-title spaced">Eğitim Sırası</p>
          {kingdom.trainingQueue.map((entry) => (
            <div className="card" key={entry.id}>
              <div className="card-head">
                <span className="card-title">
                  {num(entry.count)} {UNITS[entry.unitType].nameTr}
                </span>
                <span className="card-meta">{etaFrom(entry.completesAt) ?? 'tamamlandı'}</span>
              </div>
            </div>
          ))}
        </>
      )}

      <p className="sub-title spaced">Yoldaki Ordular</p>
      {kingdom.armies.length === 0 && <p className="empty-note">Sefere çıkmış ordu yok.</p>}
      {kingdom.armies.map((army) => (
        <ArmyCard key={army.id} army={army} selfId={kingdom.id} />
      ))}

      <p className="sub-title spaced">Kuşatmalar</p>
      {ownSieges.length === 0 && <p className="empty-note">Aktif kuşatma yok.</p>}
      {ownSieges.map((siege) => (
        <SiegeCard key={siege.id} siege={siege} selfId={kingdom.id} />
      ))}

      <p className="sub-title spaced">Kervanlar</p>
      {kingdom.caravans.length === 0 && <p className="empty-note">Yolda kervan yok.</p>}
      {kingdom.caravans.map((caravan) => (
        <CaravanCard key={caravan.id} caravan={caravan} />
      ))}
    </div>
  );
}

function ArmyCard({ army, selfId }: { army: ArmyDto; selfId: string }) {
  const own = army.ownerKingdomId === selfId;
  const eta = etaFrom(army.arrivesAt);
  return (
    <div className={`card${own ? '' : ' danger'}`}>
      <div className="card-head">
        <span className="card-title">
          {INTENT_TR[army.intent]} · {own ? 'ordunuz' : army.ownerKingdomName}
        </span>
        <span className="card-meta">{eta ? `varış ${eta}` : 'varmak üzere'}</span>
      </div>
      <CompositionGrid composition={army.composition} />
      <div className="card-line">
        <span>Yorgunluk</span>
        <b>×{army.fatigueFactor.toFixed(2)}</b>
      </div>
    </div>
  );
}

function SiegeCard({ siege, selfId }: { siege: SiegeDto; selfId: string }) {
  const { runAction } = useKingdom();
  const defending = siege.defenderKingdomId === selfId;
  const [tactic, setTactic] = useState<Tactic>(defending ? siege.defenderTactic : siege.attackerTactic);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const apply = async (next: Tactic) => {
    setTactic(next);
    setBusy(true);
    setNote(null);
    try {
      const result = await runAction('choose_tactic', { siege_id: siege.id, tactic: next });
      setNote(result.message);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Taktik değiştirilemedi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card${defending ? ' danger' : ''}`}>
      <div className="card-head">
        <span className="card-title">
          {siege.attackerKingdomName} → {siege.defenderKingdomName}
        </span>
        <span className="card-meta">
          Round {siege.currentRound}/{siege.maxRounds}
        </span>
      </div>

      <div className="card-line">
        <span>Sur bütünlüğü</span>
        <b>
          {num(siege.wallIntegrity)}/{num(siege.wallIntegrityMax)}
        </b>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill${siege.wallIntegrity / Math.max(1, siege.wallIntegrityMax) < 0.35 ? ' wine' : ' brass'}`}
          style={{ width: pct(siege.wallIntegrity, siege.wallIntegrityMax) }}
        />
      </div>

      <div className="card-line">
        <span>Sonraki round</span>
        <b>{etaFrom(siege.nextRoundAt) ?? 'birazdan'}</b>
      </div>
      <div className="card-line">
        <span>Takviye penceresi</span>
        <b>{etaFrom(siege.reinforcementWindowClosesAt) ?? 'kapandı'}</b>
      </div>

      <div className="tactic-row">
        <label className="sr-only" htmlFor={`tactic-${siege.id}`}>
          Kuşatma taktiği
        </label>
        <select
          id={`tactic-${siege.id}`}
          className="select-field"
          value={tactic}
          disabled={busy}
          onChange={(e) => void apply(e.target.value as Tactic)}
        >
          {TACTICS.map((t) => (
            <option key={t} value={t}>
              {TACTIC_TR[t]}
            </option>
          ))}
        </select>
      </div>
      {note && <p className="bld-warn">{note}</p>}
    </div>
  );
}

function CaravanCard({ caravan }: { caravan: CaravanDto }) {
  const purpose =
    caravan.purpose === 'trade' ? 'Ticaret' : caravan.purpose === 'tribute' ? 'Haraç' : 'Fetih aktarımı';
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{purpose}</span>
        <span className="card-meta">{etaFrom(caravan.arrivesAt) ?? 'varmak üzere'}</span>
      </div>
      <div className="card-line">
        <span>{RESOURCE_LABELS_TR[caravan.resourceType]}</span>
        <b>{num(caravan.amount)}</b>
      </div>
    </div>
  );
}
