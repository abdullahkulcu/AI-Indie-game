/**
 * Binalar — kategoriye göre gruplanmış tek sütun liste (referanstaki düzen).
 *
 * Her satır binanın o anki durumunu tek bakışta anlatır: ne ürettiği, kalan
 * süre, ilerleme. Darboğaz varsa satır kırmızıya döner ve sınırlayan kaynağı
 * adıyla söyler — GDD §4'teki "darboğazı ölçebilirsin" sözünün arayüz karşılığı.
 */

import { useState } from 'react';
import type { BuildingCategory, BuildingDto, KingdomStateDto, Resource } from '@krallik/shared';
import { BUILDINGS, RESOURCE_LABELS_TR } from '@krallik/shared';
import { Icon } from '../components/Icon';
import { useKingdom } from '../state/useKingdom';
import { BOTTLENECK_REASON_TR, etaFrom, num, pct, progressRatio } from '../lib/format';

const CATEGORY_TITLES: Record<BuildingCategory, string> = {
  economy: 'Ekonomi',
  military: 'Askeri',
  administration: 'Yönetim',
};

const CATEGORY_ORDER: BuildingCategory[] = ['economy', 'military', 'administration'];

function outputText(building: BuildingDto): string {
  const entries = Object.entries(building.outputPerHour).filter(
    ([, value]) => typeof value === 'number' && value > 0,
  );
  if (entries.length === 0) return 'Üretim yok';
  const names = entries.map(([resource]) => RESOURCE_LABELS_TR[resource as Resource]).join(' + ');
  return `Üretiyor: ${names}`;
}

export function BinalarTab({ kingdom }: { kingdom: KingdomStateDto }) {
  const grouped = new Map<BuildingCategory, BuildingDto[]>();
  for (const building of kingdom.buildings) {
    const category = BUILDINGS[building.type].category;
    const list = grouped.get(category) ?? [];
    list.push(building);
    grouped.set(category, list);
  }

  const storedTotal = Object.entries(kingdom.resources)
    .filter(([resource]) => resource !== 'gold') // altın depo kapasitesine girmez
    .reduce((sum, [, value]) => sum + value, 0);

  return (
    <div>
      {CATEGORY_ORDER.map((category) => {
        const list = grouped.get(category);
        if (!list?.length) return null;
        return (
          <div key={category}>
            <p className="bld-cat-title">{CATEGORY_TITLES[category]}</p>
            {list.map((building) => (
              <BuildingRow
                key={building.id}
                building={building}
                storedTotal={storedTotal}
                storageCapacity={kingdom.storageCapacity}
              />
            ))}
          </div>
        );
      })}
      <p className="empty-note">
        Bina slotu: {kingdom.buildingSlotsUsed}/{kingdom.buildingSlotsTotal} · Yeni yapı için
        General'inize buyruk verin.
      </p>
    </div>
  );
}

function BuildingRow({
  building,
  storedTotal,
  storageCapacity,
}: {
  building: BuildingDto;
  storedTotal: number;
  storageCapacity: number;
}) {
  const { runAction } = useKingdom();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const def = BUILDINGS[building.type];

  const upgrading = building.upgradingToLevel !== null;
  const eta = etaFrom(building.upgradeCompletesAt);
  const progress = progressRatio(building.upgradeStartedAt, building.upgradeCompletesAt);
  const bottleneck = building.bottleneck;
  const depleted = building.status === 'depleted';

  const rowClass = bottleneck ? 'bld-row bottleneck' : depleted ? 'bld-row depleted' : 'bld-row';

  const reserveRatio =
    building.mineReserveRemaining !== null && building.mineReserveCapacity
      ? building.mineReserveRemaining / building.mineReserveCapacity
      : null;

  const dig = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await runAction('deep_excavation', { building_id: building.id });
      setNote(result.message);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Derin kazı başarısız oldu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={rowClass}>
      <Icon name={def.icon} className="bld-icon" />
      <div className="bld-info">
        <div className="bld-name-row">
          <span className="bld-name">{def.nameTr}</span>
          <span className="bld-lvl">
            Sv.{building.level}
            {upgrading ? `→${building.upgradingToLevel}` : ''}
          </span>
        </div>

        {upgrading ? (
          <>
            <div className="bld-status">
              <span>Yükseltiliyor</span>
              {eta && <span className="bld-eta">{eta}</span>}
            </div>
            <div className="bld-progress">
              <div className="bld-progress-fill" style={{ width: pct(progress, 1) }} />
            </div>
          </>
        ) : building.type === 'granary' ? (
          <>
            <div className="bld-status">
              <span>Kapasite</span>
              <span className="bld-eta">
                {num(storedTotal)}/{num(storageCapacity)}
              </span>
            </div>
            <div className="bld-progress">
              <div className="bld-progress-fill" style={{ width: pct(storedTotal, storageCapacity) }} />
            </div>
          </>
        ) : building.status === 'producing' ? (
          <div className="bld-status">
            <span>{outputText(building)}</span>
          </div>
        ) : (
          <div className="bld-status idle">
            <span>{depleted ? 'Rezerv tükendi' : 'Boşta — girdi bekleniyor'}</span>
          </div>
        )}

        {bottleneck && (
          <div className="bld-warn">
            Darboğaz: {BOTTLENECK_REASON_TR[bottleneck.reason] ?? bottleneck.reason}
            {bottleneck.limitingResource
              ? ` — ${RESOURCE_LABELS_TR[bottleneck.limitingResource]} yetmiyor`
              : ''}{' '}
            · kapasitenin %{Math.round(bottleneck.utilization * 100)}'i kullanılıyor
          </div>
        )}

        {reserveRatio !== null && (
          <>
            <div className="bld-status">
              <span>Rezerv</span>
              <span className="bld-eta">
                {num(building.mineReserveRemaining ?? 0)}/{num(building.mineReserveCapacity ?? 0)}
              </span>
            </div>
            <div className="bld-progress">
              <div
                className={`bld-progress-fill reserve${reserveRatio < 0.2 ? ' low' : ''}`}
                style={{ width: pct(reserveRatio, 1) }}
              />
            </div>
            {reserveRatio <= 0 && (
              <div className="bld-actions">
                <button className="btn btn-small" type="button" disabled={busy} onClick={() => void dig()}>
                  Derin Kazı ({building.deepExcavationsUsed}. kez)
                </button>
              </div>
            )}
          </>
        )}

        {note && <div className="bld-warn">{note}</div>}
      </div>
    </div>
  );
}
