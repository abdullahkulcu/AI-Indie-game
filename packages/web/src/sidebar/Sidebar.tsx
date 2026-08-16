/**
 * Yüzen kenar çubuğu: üstte "Genel Durum" şeridi, altında sekmeler.
 *
 * Sekme gövdesi tek kaydırma alanıdır; Meclis sekmesi ise dikey olarak kendini
 * doldurur (sohbet kaydı büyür, giriş satırı altta sabit kalır) — referanstaki
 * `tab-content.active[data-tab-content="meclis"]` davranışının karşılığı.
 */

import { useState } from 'react';
import type { KingdomStateDto, RealmViewDto } from '@krallik/shared';
import { StatusStrip } from './StatusStrip';
import { MeclisTab } from './MeclisTab';
import { BinalarTab } from './BinalarTab';
import { DefterTab } from './DefterTab';
import { DiyarTab } from './DiyarTab';
import { BolgeTab } from './BolgeTab';
import { OrduTab } from './OrduTab';
import { DiplomasiTab } from './DiplomasiTab';
import { useKingdom } from '../state/useKingdom';

type TabKey = 'meclis' | 'binalar' | 'defter' | 'diyar' | 'bolge' | 'ordu' | 'diplomasi';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'meclis', label: 'Meclis' },
  { key: 'binalar', label: 'Binalar' },
  { key: 'defter', label: 'Defter' },
  { key: 'diyar', label: 'Diyar' },
  { key: 'bolge', label: 'Bölge' },
  { key: 'ordu', label: 'Ordu' },
  { key: 'diplomasi', label: 'Diplomasi' },
];

export function Sidebar({
  kingdomId,
  kingdom,
  realm,
}: {
  kingdomId: string;
  kingdom: KingdomStateDto | null;
  realm: RealmViewDto | null;
}) {
  const [active, setActive] = useState<TabKey>('meclis');
  const { decisions, notifications } = useKingdom();

  const pendingCount = decisions.length;
  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  return (
    <div className="sidebar-float sidebar-panel">
      <StatusStrip scores={kingdom?.scores ?? null} />

      <div className="tabs" role="tablist" aria-label="Krallık panelleri">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn${active === tab.key ? ' active' : ''}`}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            aria-controls={`panel-${tab.key}`}
            id={`tab-${tab.key}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
            {tab.key === 'meclis' && pendingCount > 0 && <span className="tab-dot" aria-label="onay bekliyor" />}
            {tab.key === 'diyar' && unreadCount > 0 && <span className="tab-dot" aria-label="okunmamış haber" />}
          </button>
        ))}
      </div>

      <div className="tab-body" id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`}>
        {active === 'meclis' && <MeclisTab kingdomId={kingdomId} llm={kingdom?.llm ?? null} />}
        {active === 'binalar' &&
          (kingdom ? <BinalarTab kingdom={kingdom} /> : <p className="empty-note">Yükleniyor…</p>)}
        {active === 'defter' &&
          (kingdom ? <DefterTab kingdom={kingdom} /> : <p className="empty-note">Yükleniyor…</p>)}
        {active === 'diyar' && <DiyarTab realm={realm} />}
        {active === 'bolge' && <BolgeTab />}
        {active === 'ordu' &&
          (kingdom ? <OrduTab kingdom={kingdom} /> : <p className="empty-note">Yükleniyor…</p>)}
        {active === 'diplomasi' &&
          (kingdom ? <DiplomasiTab kingdom={kingdom} /> : <p className="empty-note">Yükleniyor…</p>)}
      </div>
    </div>
  );
}
