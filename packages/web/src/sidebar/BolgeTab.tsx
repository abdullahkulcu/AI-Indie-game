/**
 * Bölge — GDD §10.4 bölgesel duyum akışı.
 *
 * Bilinçli olarak salt-okunur: burası bir sohbet değil, kâhyaların derlediği
 * duyum dökümüdür. Bu yüzden giriş kutusu yok ve arayüz metni bunu açıkça söyler.
 * Rutin özetler soluk ve italik, büyük olaylar şarap rengi kenarla ayrışır.
 */

import type { RegionBulletinDto } from '@krallik/shared';
import { useKingdom } from '../state/useKingdom';
import { timeAgo } from '../lib/format';

export function BolgeTab() {
  const { bulletins } = useKingdom();

  const sorted = [...bulletins].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  return (
    <div>
      <p className="sub-title">Bölgesel Duyumlar</p>
      <p className="steer-note">
        Kâhyalarınızın altı saatte bir derlediği bölge dökümü ve anında ulaşan büyük olaylar. Buradan
        kimseye söz iletemezsiniz — yalnızca dinlersiniz.
      </p>

      {sorted.length === 0 && <p className="empty-note">Bölgeden henüz duyum gelmedi.</p>}

      {sorted.map((bulletin) => (
        <BulletinCard key={bulletin.id} bulletin={bulletin} />
      ))}
    </div>
  );
}

function BulletinCard({ bulletin }: { bulletin: RegionBulletinDto }) {
  const major = bulletin.kind === 'major_event';
  return (
    <div className={`bulletin ${major ? 'major' : 'routine'}`}>
      <span className="kind">{major ? 'BÜYÜK OLAY' : 'RUTİN DÖKÜM'}</span>
      {bulletin.summary}
      <span className="time">{timeAgo(bulletin.createdAt)}</span>
    </div>
  );
}
