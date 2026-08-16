/**
 * Defter — hazine, nüfus ve üretim özeti.
 *
 * Ana kaynaklar hep açık; ara ürünler (buğday, un, cevher…) katlanabilir bir
 * bölümde. Ara ürün stoğunun şişmesi zincirdeki darboğazın en erken işareti
 * olduğu için oraya saatlik net akışı da yazıyoruz.
 */

import { useState } from 'react';
import type { KingdomStateDto, Resource } from '@krallik/shared';
import { PRIMARY_RESOURCES, RESOURCES, RESOURCE_LABELS_TR } from '@krallik/shared';
import { Icon, RESOURCE_ICONS } from '../components/Icon';
import { num, pct, signed } from '../lib/format';

export function DefterTab({ kingdom }: { kingdom: KingdomStateDto }) {
  const [showIntermediates, setShowIntermediates] = useState(false);

  const primary = PRIMARY_RESOURCES as readonly Resource[];
  const intermediates = RESOURCES.filter((r) => !primary.includes(r));

  const storedTotal = RESOURCES.filter((r) => r !== 'gold').reduce(
    (sum, r) => sum + kingdom.resources[r],
    0,
  );

  return (
    <div>
      {primary.map((resource) => (
        <LedgerRow
          key={resource}
          resource={resource}
          amount={kingdom.resources[resource]}
          perHour={kingdom.netProductionPerHour[resource] ?? 0}
        />
      ))}

      <button
        className="collapse-btn"
        type="button"
        onClick={() => setShowIntermediates((v) => !v)}
        aria-expanded={showIntermediates}
      >
        {showIntermediates ? '▾' : '▸'} Ara ürünler ({intermediates.length})
      </button>
      {showIntermediates &&
        intermediates.map((resource) => (
          <LedgerRow
            key={resource}
            resource={resource}
            amount={kingdom.resources[resource]}
            perHour={kingdom.netProductionPerHour[resource] ?? 0}
          />
        ))}

      <hr className="divider" />

      <div className="summary-row">
        <span>Nüfus</span>
        <b>
          {num(kingdom.scores.population)} / {num(kingdom.scores.populationCapacity)}
        </b>
      </div>
      <div className="summary-row">
        <span>Çalışabilir halk</span>
        <b>{num(kingdom.scores.availableWorkers)}</b>
      </div>
      <div className="summary-row">
        <span>Askerdeki nüfus</span>
        <b>{num(kingdom.scores.militaryPopulation)}</b>
      </div>
      <div className="summary-row">
        <span>Toplam bina</span>
        <b>{kingdom.buildings.length}</b>
      </div>
      <div className="summary-row">
        <span>Vergi oranı</span>
        <b>%{Math.round(kingdom.scores.taxRate)}</b>
      </div>
      <div className="summary-row">
        <span>Yiyecek dengesi</span>
        <b>{signed(kingdom.foodBalancePerHour)}/sa</b>
      </div>

      <div className="gauge-label">
        <span>Halkın Rızası</span>
        <b>{Math.round(kingdom.scores.popularity)}/100</b>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill${kingdom.scores.popularity < 35 ? ' wine' : ''}`}
          style={{ width: pct(kingdom.scores.popularity, 100) }}
        />
      </div>

      <div className="gauge-label">
        <span>Depo</span>
        <b>
          {num(storedTotal)}/{num(kingdom.storageCapacity)}
        </b>
      </div>
      <div className="gauge-track">
        <div
          className={`gauge-fill brass`}
          style={{ width: pct(storedTotal, kingdom.storageCapacity) }}
        />
      </div>
      {storedTotal >= kingdom.storageCapacity && (
        <p className="bld-warn">Depo dolu — üretilen fazla kaynak ziyan oluyor.</p>
      )}
    </div>
  );
}

function LedgerRow({
  resource,
  amount,
  perHour,
}: {
  resource: Resource;
  amount: number;
  perHour: number;
}) {
  return (
    <div className="ledger-row">
      <Icon name={RESOURCE_ICONS[resource]} className="ledger-icon" />
      <span className="ledger-label">{RESOURCE_LABELS_TR[resource]}</span>
      <span className="ledger-value">{num(amount)}</span>
      <span className={`ledger-delta ${perHour < 0 ? 'neg' : 'pos'}`}>
        {perHour === 0 ? '—' : `${signed(perHour)}/sa`}
      </span>
    </div>
  );
}
