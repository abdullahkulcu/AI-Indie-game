/**
 * Bildirim sistemi (§15.1).
 *
 * Uygulama içi bildirimler tek bir tablodan akar; saldırı uyarıları, kuşatma
 * round raporları, pasif mod özetleri ve koruma süresi uyarıları hep buradan
 * geçer. Push/e-posta entegrasyonu bu fonksiyonun arkasına eklenebilir —
 * çağıran taraf değişmez.
 */

import type { NotificationKind, NotificationSeverity } from '@krallik/shared';
import { txQuery, type Tx } from '../db/pool.js';

export interface NotifyInput {
  kingdomId: string;
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  relatedId?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function notify(tx: Tx, input: NotifyInput): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO notifications (kingdom_id, kind, severity, title, body, related_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.kingdomId,
      input.kind,
      input.severity ?? 'info',
      input.title,
      input.body,
      input.relatedId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
    ],
  );
}

/**
 * Bölgesel duyum akışına (§10.4) ham bir kayıt düşer.
 *
 * `severity: 'major'` olanlar (bir başkentin düşmesi, savaş ilanı, ihanet)
 * beklemeden anında bildirim olarak dağıtılır; `routine` olanlar 6 saatte bir
 * LLM tarafından özetlenip toplu bülten hâlinde gider.
 */
export async function recordRegionActivity(
  tx: Tx,
  input: {
    channelId: string;
    originX: number;
    originY: number;
    severity: 'routine' | 'major';
    summary: string;
    relatedKingdomIds?: string[];
  },
): Promise<void> {
  await txQuery(
    tx,
    `INSERT INTO region_activity (channel_id, origin_x, origin_y, severity, summary, related_kingdom_ids)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.channelId,
      input.originX,
      input.originY,
      input.severity,
      input.summary,
      JSON.stringify(input.relatedKingdomIds ?? []),
    ],
  );
}
