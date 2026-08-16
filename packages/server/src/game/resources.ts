/**
 * Kaynak harcama ve kota düşürme — atomik.
 *
 * GDD §15.5: emir kotası kontrolü ve düşürülmesi backend'de atomik bir işlem
 * olmalı, bypass edilemez olmalı. Aynı şey kaynaklar için de geçerli: iki
 * eşzamanlı istek aynı 100 altını iki kez harcayamamalı. Bu yüzden her ikisi de
 * "koşullu UPDATE" olarak yazıldı — önce oku sonra yaz değil, tek ifadede
 * kontrol et ve düş.
 */

import { RESOURCES, type Resource, type ResourceBundle } from '@krallik/shared';
import { txQuery, type Tx } from '../db/pool.js';

/**
 * Maliyeti krallığın deposundan düşer.
 *
 * @returns Yeterli kaynak yoksa `false` — hiçbir şey değişmez.
 */
export async function spendResources(
  tx: Tx,
  kingdomId: string,
  cost: ResourceBundle,
): Promise<boolean> {
  const entries = (Object.entries(cost) as [Resource, number][]).filter(
    ([resource, amount]) => amount > 0 && (RESOURCES as readonly string[]).includes(resource),
  );
  if (entries.length === 0) return true;

  const setClauses: string[] = [];
  const whereClauses: string[] = [];
  const params: (string | number)[] = [kingdomId];

  for (const [resource, amount] of entries) {
    params.push(amount);
    const idx = params.length;
    setClauses.push(`${resource} = ${resource} - $${idx}`);
    // Koşul aynı ifadede: yetersizse hiçbir satır güncellenmez.
    whereClauses.push(`${resource} >= $${idx}`);
  }

  const rows = await txQuery<{ id: string }>(
    tx,
    `UPDATE kingdoms SET ${setClauses.join(', ')}
      WHERE id = $1 AND ${whereClauses.join(' AND ')}
      RETURNING id`,
    params,
  );

  return rows.length > 0;
}

/** Kaynak ekler (yağma, ticaret, kervan varışı). Depo üst sınırı çağıranın işi. */
export async function grantResources(
  tx: Tx,
  kingdomId: string,
  bundle: ResourceBundle,
): Promise<void> {
  const entries = (Object.entries(bundle) as [Resource, number][]).filter(
    ([resource, amount]) => amount > 0 && (RESOURCES as readonly string[]).includes(resource),
  );
  if (entries.length === 0) return;

  const setClauses: string[] = [];
  const params: (string | number)[] = [kingdomId];
  for (const [resource, amount] of entries) {
    params.push(amount);
    setClauses.push(`${resource} = ${resource} + $${params.length}`);
  }

  await txQuery(tx, `UPDATE kingdoms SET ${setClauses.join(', ')} WHERE id = $1`, params);
}

/**
 * Kaynakları depo kapasitesiyle sınırlayarak ekler; taşan kısım ziyan olur.
 * Altın kapasiteden muaftır (hazine ayrı tutulur).
 */
export async function grantResourcesCapped(
  tx: Tx,
  kingdomId: string,
  bundle: ResourceBundle,
  capacity: number,
): Promise<void> {
  const entries = (Object.entries(bundle) as [Resource, number][]).filter(
    ([resource, amount]) => amount > 0 && (RESOURCES as readonly string[]).includes(resource),
  );
  if (entries.length === 0) return;

  const setClauses: string[] = [];
  const params: (string | number)[] = [kingdomId];
  for (const [resource, amount] of entries) {
    params.push(amount);
    const amountIdx = params.length;
    if (resource === 'gold') {
      setClauses.push(`gold = gold + $${amountIdx}`);
    } else {
      params.push(capacity);
      setClauses.push(
        `${resource} = LEAST(${resource} + $${amountIdx}, GREATEST(${resource}, $${params.length}))`,
      );
    }
  }

  await txQuery(tx, `UPDATE kingdoms SET ${setClauses.join(', ')} WHERE id = $1`, params);
}

/**
 * Emir kotasından düşer (§14.4).
 *
 * @returns Kota yetmiyorsa `false`.
 */
export async function spendDecreeQuota(
  tx: Tx,
  kingdomId: string,
  amount = 1,
): Promise<boolean> {
  if (amount <= 0) return true;
  const rows = await txQuery<{ decree_quota_remaining: number }>(
    tx,
    `UPDATE kingdoms
        SET decree_quota_remaining = decree_quota_remaining - $2
      WHERE id = $1 AND decree_quota_remaining >= $2
      RETURNING decree_quota_remaining`,
    [kingdomId, amount],
  );
  return rows.length > 0;
}

/** Başarısız olan bir aksiyondan sonra kotayı iade eder. */
export async function refundDecreeQuota(
  tx: Tx,
  kingdomId: string,
  amount = 1,
): Promise<void> {
  if (amount <= 0) return;
  await txQuery(
    tx,
    'UPDATE kingdoms SET decree_quota_remaining = decree_quota_remaining + $2 WHERE id = $1',
    [kingdomId, amount],
  );
}

/** Toplam maliyetin kaba altın karşılığı — risk değerlendirmesi için (§14.5). */
export function estimateGoldValue(bundle: ResourceBundle): number {
  // Kaba dönüşüm oranları; kesin bir ekonomi modeli değil, yalnızca "bu harcama
  // hazineye göre büyük mü" sorusuna cevap veren bir ölçek.
  const weights: Partial<Record<Resource, number>> = {
    gold: 1,
    food: 0.4,
    stone: 0.6,
    wood: 0.5,
    iron: 1.6,
    ale: 1.2,
    weapons: 3,
    cheese: 0.8,
    flour: 0.5,
    wheat: 0.3,
    hops: 0.4,
    milk: 0.3,
    ore: 0.8,
  };
  let total = 0;
  for (const [resource, amount] of Object.entries(bundle) as [Resource, number][]) {
    if (amount > 0) total += amount * (weights[resource] ?? 0.5);
  }
  return total;
}
