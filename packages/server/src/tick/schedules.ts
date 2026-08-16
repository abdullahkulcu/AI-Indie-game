/**
 * Periyodik diplomasi ve süre bazlı işler.
 *
 * Haraç akışı (§10.1), ikili ticaret teslimatları (§10.6), birlik kiralama
 * süresinin dolması (§10.5), pazar ilanı zaman aşımı, koruma süresi uyarısı
 * (§13) ve bekleyen kararların güvenli varsayılana düşmesi (§14.5).
 */

import { BALANCE, UNITS, tileDistance, type Resource } from '@krallik/shared';
import { config } from '../config.js';
import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type {
  KingdomRow,
  MapTileRow,
  MarketOfferRow,
  PendingDecisionRow,
  ProtectionRelationshipRow,
  TradeAgreementRow,
  TroopRentalRow,
} from '../db/rows.js';
import { queueTradeCaravans } from '../game/actions.js';
import { adjustReputation } from '../game/combat.js';
import { notify } from '../game/notifications.js';
import { grantResources, spendResources } from '../game/resources.js';
import { addUnits } from '../game/state.js';
import { caravanTravelSeconds } from '@krallik/shared';

/**
 * Vasallık haracı (§10.1): kabul edilen koruma ilişkisi periyodik bir kaynak
 * akışı başlatır — vergiye benzer otomatik transfer.
 */
export async function processTribute(tx: Tx, limit = 200): Promise<number> {
  const due = await txQuery<ProtectionRelationshipRow>(
    tx,
    `SELECT * FROM protection_relationships
      WHERE status = 'active' AND next_tribute_at <= now()
      ORDER BY next_tribute_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const relation of due) {
    const vassal = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
      relation.vassal_kingdom_id,
    ]);
    const protector = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
      relation.protector_kingdom_id,
    ]);

    const nextAt = new Date(
      config.now().getTime() + BALANCE.diplomacy.tributeIntervalHours * 3600_000,
    );

    if (!vassal || !protector || vassal.status !== 'active' || protector.status !== 'active') {
      await txQuery(
        tx,
        `UPDATE protection_relationships SET status = 'ended', ended_at = now() WHERE id = $1`,
        [relation.id],
      );
      continue;
    }

    // Haraç, vasalın hazinesinin bir oranı olarak alınır.
    const tributeResources: Partial<Record<Resource, number>> = {};
    for (const resource of ['gold', 'food', 'stone', 'wood', 'iron'] as Resource[]) {
      const amount = Math.floor(Number(vassal[resource] ?? 0) * relation.tribute_rate);
      if (amount > 0) tributeResources[resource] = amount;
    }

    const paid = Object.keys(tributeResources).length > 0
      ? await spendResources(tx, vassal.id, tributeResources)
      : true;

    if (!paid || Object.keys(tributeResources).length === 0) {
      // Vasal haraç ödemeyi kesti/ödeyemedi → otomatik savaş riski doğar (§10.1).
      await txQuery(
        tx,
        `UPDATE protection_relationships SET status = 'broken', ended_at = now() WHERE id = $1`,
        [relation.id],
      );
      await setRelation(tx, relation.channel_id, vassal.id, protector.id, 'war');
      await txQuery(tx, 'UPDATE kingdoms SET vassal_of_kingdom_id = NULL WHERE id = $1', [vassal.id]);

      await adjustReputation(
        tx,
        vassal.id,
        BALANCE.diplomacy.reputation.brokeCeasefire,
        'haraç ödemeyi kestik',
      );
      await notify(tx, {
        kingdomId: protector.id,
        kind: 'diplomacy',
        severity: 'warning',
        title: 'Vasalınız haracı kesti',
        body: `${vassal.name} haraç ödemeyi durdurdu. Aramızda savaş riski doğdu.`,
      });
      await notify(tx, {
        kingdomId: vassal.id,
        kind: 'diplomacy',
        severity: 'critical',
        title: 'Haraç ödenemedi',
        body: `${protector.name} ile koruma ilişkimiz bozuldu; saldırıya açığız.`,
      });
      continue;
    }

    // Kaynak anında ışınlanmaz — kervanla taşınır (§9 mekaniği yeniden kullanılıyor).
    const distance = await capitalDistance(tx, vassal, protector);
    const seconds = caravanTravelSeconds(distance);
    for (const [resource, amount] of Object.entries(tributeResources) as [Resource, number][]) {
      await queueTradeCaravans(tx, {
        channelId: relation.channel_id,
        fromKingdomId: vassal.id,
        fromTileId: vassal.capital_tile_id,
        toKingdomId: protector.id,
        toTileId: protector.capital_tile_id,
        resource,
        amount,
        seconds,
        now: config.now(),
        purpose: 'tribute',
      });
    }

    await txQuery(tx, 'UPDATE protection_relationships SET next_tribute_at = $2 WHERE id = $1', [
      relation.id,
      nextAt,
    ]);
  }

  return due.length;
}

/**
 * İkili ticaret anlaşması teslimatları (§10.6).
 *
 * Taraflardan biri teslim edemezse anlaşma "bozuldu" sayılır ve itibarı düşer —
 * anlaşmayı habersiz bırakmanın somut bedeli budur.
 */
export async function processTradeAgreements(tx: Tx, limit = 200): Promise<number> {
  const due = await txQuery<TradeAgreementRow>(
    tx,
    `SELECT * FROM trade_agreements
      WHERE status = 'active' AND next_delivery_at <= now()
      ORDER BY next_delivery_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const agreement of due) {
    const a = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
      agreement.kingdom_a_id,
    ]);
    const b = await txQueryOne<KingdomRow>(tx, 'SELECT * FROM kingdoms WHERE id = $1', [
      agreement.kingdom_b_id,
    ]);
    if (!a || !b || a.status !== 'active' || b.status !== 'active') {
      await txQuery(
        tx,
        `UPDATE trade_agreements SET status = 'cancelled', ended_at = now() WHERE id = $1`,
        [agreement.id],
      );
      continue;
    }

    const aPaid = await spendResources(tx, a.id, { [agreement.resource_a]: agreement.amount_a });
    const bPaid = await spendResources(tx, b.id, { [agreement.resource_b]: agreement.amount_b });

    if (!aPaid || !bPaid) {
      // Ödeyebilen tarafın kaynağını iade et; kimse tek taraflı zarar görmesin.
      if (aPaid) await grantResources(tx, a.id, { [agreement.resource_a]: agreement.amount_a });
      if (bPaid) await grantResources(tx, b.id, { [agreement.resource_b]: agreement.amount_b });

      const defaulter = !aPaid ? a : b;
      const other = !aPaid ? b : a;

      await txQuery(
        tx,
        'UPDATE trade_agreements SET missed_deliveries = missed_deliveries + 1 WHERE id = $1',
        [agreement.id],
      );
      await adjustReputation(
        tx,
        defaulter.id,
        BALANCE.diplomacy.reputation.brokeTradeAgreement,
        'ticaret anlaşmasının teslimatını yapamadık',
      );
      await notify(tx, {
        kingdomId: other.id,
        kind: 'diplomacy',
        severity: 'warning',
        title: 'Ticaret teslimatı aksadı',
        body: `${defaulter.name} bu dönemin teslimatını yapamadı.`,
      });

      // Üst üste üç aksama anlaşmayı bozar.
      if (agreement.missed_deliveries + 1 >= 3) {
        await txQuery(
          tx,
          `UPDATE trade_agreements SET status = 'broken', ended_at = now() WHERE id = $1`,
          [agreement.id],
        );
      } else {
        await txQuery(tx, 'UPDATE trade_agreements SET next_delivery_at = $2 WHERE id = $1', [
          agreement.id,
          new Date(config.now().getTime() + agreement.frequency_hours * 3600_000),
        ]);
      }
      continue;
    }

    const distance = await capitalDistance(tx, a, b);
    const seconds = caravanTravelSeconds(distance);
    const now = config.now();

    await queueTradeCaravans(tx, {
      channelId: agreement.channel_id,
      fromKingdomId: a.id,
      fromTileId: a.capital_tile_id,
      toKingdomId: b.id,
      toTileId: b.capital_tile_id,
      resource: agreement.resource_a,
      amount: agreement.amount_a,
      seconds,
      now,
      purpose: 'trade',
    });
    await queueTradeCaravans(tx, {
      channelId: agreement.channel_id,
      fromKingdomId: b.id,
      fromTileId: b.capital_tile_id,
      toKingdomId: a.id,
      toTileId: a.capital_tile_id,
      resource: agreement.resource_b,
      amount: agreement.amount_b,
      seconds,
      now,
      purpose: 'trade',
    });

    await txQuery(
      tx,
      'UPDATE trade_agreements SET next_delivery_at = $2, missed_deliveries = 0 WHERE id = $1',
      [agreement.id, new Date(now.getTime() + agreement.frequency_hours * 3600_000)],
    );
  }

  return due.length;
}

/**
 * Kiralama süresi dolduğunda birlikler otomatik döner (§10.5).
 * Yalnızca **sağ kalanlar** döner; savaşta ölenler kalıcı kayıptır.
 */
export async function processRentalExpiry(tx: Tx, limit = 200): Promise<number> {
  const due = await txQuery<TroopRentalRow>(
    tx,
    `SELECT * FROM troop_rentals
      WHERE status = 'active' AND ends_at <= now()
      ORDER BY ends_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const rental of due) {
    const survivors = Math.max(0, rental.count - rental.count_lost);
    if (survivors > 0) {
      await addUnits(tx, rental.lender_kingdom_id, { [rental.unit_type]: survivors });
    }
    await txQuery(
      tx,
      `UPDATE troop_rentals SET status = $2, returned_at = now() WHERE id = $1`,
      [rental.id, survivors > 0 ? 'returned' : 'lost'],
    );

    // Taahhüdü süresi boyunca eksiksiz tamamlamak itibarı yükseltir (§10.3).
    await adjustReputation(
      tx,
      rental.lender_kingdom_id,
      BALANCE.diplomacy.reputation.keptPromise,
      'kiralama anlaşmasını sonuna kadar sürdürdük',
    );

    await notify(tx, {
      kingdomId: rental.lender_kingdom_id,
      kind: 'diplomacy',
      title: 'Kiralanan birlikler döndü',
      body:
        `${survivors} ${UNITS[rental.unit_type].nameTr} geri döndü` +
        (rental.count_lost > 0 ? `; ${rental.count_lost} tanesi savunmada öldü.` : '.'),
      relatedId: rental.id,
    });
    await notify(tx, {
      kingdomId: rental.borrower_kingdom_id,
      kind: 'diplomacy',
      title: 'Kiralık birlikler ayrıldı',
      body: `${UNITS[rental.unit_type].nameTr} birlikleri süre dolduğu için garnizonumuzdan ayrıldı.`,
      relatedId: rental.id,
    });
  }

  return due.length;
}

/** Süresi dolan pazar ilanlarını kapatır ve rezerve edilen kaynağı iade eder. */
export async function expireMarketOffers(tx: Tx, limit = 500): Promise<number> {
  const due = await txQuery<MarketOfferRow>(
    tx,
    `SELECT * FROM market_offers
      WHERE status = 'open' AND expires_at <= now()
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const offer of due) {
    await txQuery(tx, `UPDATE market_offers SET status = 'expired' WHERE id = $1`, [offer.id]);
    // İlan verilirken rezerve edilen kaynak geri verilir.
    await grantResources(tx, offer.kingdom_id, { [offer.offer_resource]: offer.offer_amount });
  }

  return due.length;
}

/**
 * Zaman aşımına uğrayan bekleyen kararlar (§14.5).
 *
 * Kral süresinde yanıt vermezse General **en güvenli/muhafazakâr seçeneği**
 * uygular — genelde: hiçbir şey yapma. Oyun kilitlenmez ama riskli bir şeye
 * kendiliğinden girilmez. Karar Kral için loglanır.
 */
export async function expirePendingDecisions(tx: Tx, limit = 300): Promise<number> {
  const due = await txQuery<PendingDecisionRow>(
    tx,
    `SELECT * FROM pending_decisions
      WHERE status = 'awaiting' AND expires_at <= now()
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );

  for (const decision of due) {
    await txQuery(
      tx,
      `UPDATE pending_decisions
          SET status = 'expired_safe_default', resolved_at = now(), resolution_note = $2
        WHERE id = $1`,
      [
        decision.id,
        'Kral süresinde yanıt vermedi; en güvenli seçenek (hiçbir şey yapmama) uygulandı.',
      ],
    );

    await notify(tx, {
      kingdomId: decision.kingdom_id,
      kind: 'decision_required',
      title: 'Bekleyen karar zaman aşımına uğradı',
      body:
        `"${decision.proposed_action_json.name}" kararı için onayınızı bekledim ama yanıt gelmedi. ` +
        'Krallığı riske atmamak adına hiçbir şey yapmadım; karar kayıtlara geçti.',
      relatedId: decision.id,
    });
  }

  return due.length;
}

/** Koruma süresi bitmeden önce uyarı gönderir (§13). */
export async function warnProtectionEnding(tx: Tx): Promise<number> {
  const warnAt = BALANCE.protection.warningBeforeHours;
  const due = await txQuery<{ id: string; name: string; protection_ends_at: Date }>(
    tx,
    `SELECT k.id, k.name, k.protection_ends_at
       FROM kingdoms k
      WHERE k.status = 'active'
        AND k.protection_ends_at IS NOT NULL
        AND k.protection_ends_at > now()
        AND k.protection_ends_at <= now() + ($1 || ' hours')::interval
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.kingdom_id = k.id AND n.kind = 'protection_ending'
        )`,
    [String(warnAt)],
  );

  for (const kingdom of due) {
    const hoursLeft = Math.max(
      0,
      Math.round((kingdom.protection_ends_at.getTime() - config.now().getTime()) / 3600_000),
    );
    await notify(tx, {
      kingdomId: kingdom.id,
      kind: 'protection_ending',
      severity: 'warning',
      title: 'Koruma süreniz bitiyor',
      body: `Koruma süreniz ${hoursLeft} saat sonra bitiyor. Savunmanızı hazırlamak ister misiniz?`,
    });
  }

  return due.length;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

async function capitalDistance(tx: Tx, a: KingdomRow, b: KingdomRow): Promise<number> {
  if (!a.capital_tile_id || !b.capital_tile_id) return 10;
  const tiles = await txQuery<MapTileRow>(tx, 'SELECT * FROM map_tiles WHERE id = ANY($1::uuid[])', [
    [a.capital_tile_id, b.capital_tile_id],
  ]);
  if (tiles.length < 2) return 10;
  const [first, second] = tiles;
  return first && second ? tileDistance(first, second) : 10;
}

/** İki krallık arasındaki ilişki durumunu ayarlar (a<b normalizasyonuyla). */
export async function setRelation(
  tx: Tx,
  channelId: string,
  kingdomA: string,
  kingdomB: string,
  state: 'neutral' | 'ally' | 'war' | 'ceasefire' | 'vassal' | 'protector',
): Promise<void> {
  const [low, high] = kingdomA < kingdomB ? [kingdomA, kingdomB] : [kingdomB, kingdomA];
  await txQuery(
    tx,
    `INSERT INTO kingdom_relations (channel_id, kingdom_a_id, kingdom_b_id, state)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (kingdom_a_id, kingdom_b_id)
       DO UPDATE SET state = $4, updated_at = now()`,
    [channelId, low, high, state],
  );
}
