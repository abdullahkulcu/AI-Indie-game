/**
 * Diyar — mini harita, haberci ruloları ve skor tablosu.
 *
 * Mini harita `realm.tiles`ten üretilir: her tile referanstaki gibi altıgene
 * yakın bir çokgen, sahibinin rengiyle. Kendi başkentiniz beyaz nokta ve adla
 * işaretlenir, çekişmeli tile'lar kesik pirinç konturla.
 */

import type { MapTileDto, NotificationDto, NotificationKind, RealmViewDto } from '@krallik/shared';
import { Icon } from '../components/Icon';
import { useKingdom } from '../state/useKingdom';
import { num, timeAgo } from '../lib/format';

const HEX_W = 22;
const HEX_H = 13;

const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  attack_incoming: 'i-crossed',
  siege_round: 'i-siege',
  battle_report: 'i-sword',
  passive_summary: 'i-scroll',
  protection_ending: 'i-shield',
  decision_required: 'i-star',
  diplomacy: 'i-scroll',
  world_event: 'i-bell',
  caravan_arrived: 'i-ore',
  llm_error: 'i-bell',
  region_bulletin: 'i-banner',
  conquest: 'i-keep',
  season_end: 'i-banner',
};

/** Sahip kimliğinden kararlı bir renk üretir — aynı krallık hep aynı tonda. */
function ownerColor(ownerId: string | null, selfId: string): string {
  if (!ownerId) return '#3a332a';
  if (ownerId === selfId) return 'var(--brass)';
  let hash = 0;
  for (let i = 0; i < ownerId.length; i++) hash = (hash * 31 + ownerId.charCodeAt(i)) >>> 0;
  const palette = ['var(--teal)', 'var(--wine)', '#4a5c33', '#5a4a37', '#33506b'];
  return palette[hash % palette.length] ?? '#3a332a';
}

function hexPoints(cx: number, cy: number): string {
  return [
    [cx - HEX_W / 2, cy - HEX_H / 2],
    [cx, cy - HEX_H],
    [cx + HEX_W / 2, cy - HEX_H / 2],
    [cx + HEX_W / 2, cy + HEX_H / 2],
    [cx, cy + HEX_H],
    [cx - HEX_W / 2, cy + HEX_H / 2],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

function MiniMap({ realm }: { realm: RealmViewDto }) {
  if (realm.tiles.length === 0) {
    return <p className="empty-note">Harita verisi yok.</p>;
  }

  const xs = realm.tiles.map((t) => t.x);
  const ys = realm.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = (maxX - minX + 2) * HEX_W;
  const height = (maxY - minY + 2) * HEX_H * 1.5;

  const contested = new Set(realm.contestedTiles.map((c) => `${c.x},${c.y}`));

  const place = (tile: MapTileDto) => {
    const cx = (tile.x - minX) * HEX_W + HEX_W * (0.75 + ((tile.y - minY) % 2) * 0.5);
    const cy = (tile.y - minY) * HEX_H * 1.5 + HEX_H * 1.2;
    return { cx, cy };
  };

  const selfTile = realm.tiles.find((t) => t.isCapital && t.ownerKingdomId === realm.self.id);

  return (
    <div className="mini-map-wrap">
      <svg
        className="mini-map-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Yakın çevredeki topraklar"
      >
        {realm.tiles.map((tile) => {
          const { cx, cy } = place(tile);
          const isContested = contested.has(`${tile.x},${tile.y}`);
          return (
            <polygon
              key={tile.id}
              points={hexPoints(cx, cy)}
              // CSS değişkenleri sunum özniteliğinde her tarayıcıda çözülmüyor;
              // bu yüzden renkler `style` üzerinden veriliyor.
              style={{ fill: ownerColor(tile.ownerKingdomId, realm.self.id) }}
              stroke={isContested ? '#c08a34' : '#241d16'}
              strokeWidth={isContested ? 1.2 : 0.8}
              strokeDasharray={isContested ? '3,2' : undefined}
            >
              <title>
                {`${tile.x},${tile.y} · ${tile.ownerKingdomName ?? 'sahipsiz'}`}
              </title>
            </polygon>
          );
        })}
        {selfTile &&
          (() => {
            const { cx, cy } = place(selfTile);
            return (
              <g key="capital">
                <circle cx={cx} cy={cy} r={3} fill="#e9dbb8" stroke="#241d16" strokeWidth={0.8} />
                <text
                  x={cx}
                  y={cy + HEX_H + 8}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontSize={9}
                  fill="#e9dbb8"
                >
                  {realm.self.name}
                </text>
              </g>
            );
          })()}
      </svg>
    </div>
  );
}

export function DiyarTab({ realm }: { realm: RealmViewDto | null }) {
  const { notifications, markNotificationRead } = useKingdom();

  return (
    <div>
      <p className="sub-title">Yakın Diyar</p>
      {realm ? <MiniMap realm={realm} /> : <p className="empty-note">Harita yükleniyor…</p>}

      <p className="sub-title spaced">Son Haberler</p>
      {notifications.length === 0 && <p className="empty-note">Haberci Ruloları boş.</p>}
      {notifications.slice(0, 12).map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onRead={() => void markNotificationRead(notification.id)}
        />
      ))}

      <p className="sub-title spaced">Skorlar — Nüfusa Göre</p>
      {realm?.scoreboard.length ? (
        realm.scoreboard.map((entry) => (
          <div
            key={entry.kingdomId}
            className={`score-row${entry.kingdomId === realm.self.id ? ' me' : ''}`}
          >
            <span className="score-rank">{entry.rank}</span>
            <span className="score-name">
              {entry.name}
              {entry.kingdomId === realm.self.id ? ' (siz)' : ''}
            </span>
            <span className="score-pop">{num(entry.population)}</span>
          </div>
        ))
      ) : (
        <p className="empty-note">Skor tablosu henüz hazır değil.</p>
      )}
    </div>
  );
}

function NotificationCard({
  notification,
  onRead,
}: {
  notification: NotificationDto;
  onRead: () => void;
}) {
  const unread = notification.readAt === null;
  return (
    <div
      className={`scroll-card${unread ? ' unread' : ''}${
        notification.severity === 'critical' ? ' critical' : ''
      }`}
    >
      <Icon name={NOTIFICATION_ICON[notification.kind] ?? 'i-bell'} className="scroll-icon" />
      <div className="scroll-body">
        <span className="scroll-title">{notification.title}</span>
        <div>{notification.body}</div>
        <span className="time">{timeAgo(notification.createdAt)}</span>
      </div>
      {unread && (
        <button
          className="btn btn-small"
          type="button"
          onClick={onRead}
          aria-label={`${notification.title} bildirimini okundu işaretle`}
        >
          ✓
        </button>
      )}
    </div>
  );
}
