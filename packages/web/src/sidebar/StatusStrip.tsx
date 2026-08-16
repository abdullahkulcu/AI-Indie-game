import type { KingdomScoresDto } from '@krallik/shared';
import { pct } from '../lib/format';

/**
 * "Genel Durum" şeridi — referanstaki üç çubuk: General'in sadakati, kalan emir
 * kotası ve krallığın itibarı. Kenar çubuğunun en üstünde, sekmeden bağımsız
 * olarak hep görünür.
 */
export function StatusStrip({ scores }: { scores: KingdomScoresDto | null }) {
  const loyalty = scores?.generalLoyalty ?? 0;
  const reputation = scores?.reputation ?? 0;
  const quota = scores?.decreeQuotaRemaining ?? 0;
  const quotaCap = scores?.decreeQuotaCap ?? 0;

  return (
    <div className="general-status">
      <div className="gs-row">
        <span className="gs-label">Sadakat</span>
        <div className="gs-track">
          <div className="gs-fill gs-fill-loyalty" style={{ width: pct(loyalty, 100) }} />
        </div>
        <span className="gs-value">{Math.round(loyalty)}</span>
      </div>
      <div className="gs-row">
        <span className="gs-label">Emir Kotası</span>
        <div className="gs-track">
          <div className="gs-fill gs-fill-quota" style={{ width: pct(quota, Math.max(1, quotaCap)) }} />
        </div>
        <span className="gs-value">
          {Math.floor(quota)}/{quotaCap}
        </span>
      </div>
      <div className="gs-row">
        <span className="gs-label">İtibar</span>
        <div className="gs-track">
          <div className="gs-fill gs-fill-rep" style={{ width: pct(reputation, 100) }} />
        </div>
        <span className="gs-value">{Math.round(reputation)}</span>
      </div>
    </div>
  );
}
