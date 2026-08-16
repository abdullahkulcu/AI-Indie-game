/**
 * Redis: krallık kilitleri ve hafif sayaçlar.
 *
 * GDD §15.1: aynı krallığın aynı anda birden fazla tick/aksiyon tarafından
 * işlenmesini önlemek için kilit gerekiyor. Kotanın kendisi Postgres'te atomik
 * güncelleniyor (§15.5) — Redis burada *doğruluğun* değil, boşuna iş yapmanın
 * önüne geçiyor: tick worker ile bir oyuncunun chat isteği aynı krallığa aynı
 * anda girmesin diye.
 */

import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  retryStrategy: (times: number) => Math.min(times * 200, 3000),
});

redis.on('error', (err: Error) => {
  console.error('[redis] hata:', err.message);
});

/**
 * Kilidi yalnızca sahibi bırakabilsin diye Lua ile karşılaştır-ve-sil.
 * Süresi dolmuş bir kilidi başkası almışsa, geciken sahip onu silemez.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface Lock {
  key: string;
  token: string;
}

export async function acquireLock(
  key: string,
  ttlMs = 30_000,
): Promise<Lock | null> {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? { key, token } : null;
}

export async function releaseLock(lock: Lock): Promise<void> {
  try {
    await redis.eval(RELEASE_SCRIPT, 1, lock.key, lock.token);
  } catch (error) {
    // Kilit nasılsa TTL ile düşer; bırakamamak veri bütünlüğünü bozmaz.
    console.warn('[redis] kilit bırakılamadı:', (error as Error).message);
  }
}

/**
 * Bir krallık üzerinde kilitli çalıştırır. Kilit alınamazsa `null` döner —
 * çağıran taraf "şu an başkası işliyor, sonraki tick'te bakarım" diyebilir.
 */
export async function withKingdomLock<T>(
  kingdomId: string,
  fn: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T | null> {
  const lock = await acquireLock(`lock:kingdom:${kingdomId}`, ttlMs);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

/** Tick turlarının çakışmaması için tekil worker kilidi. */
export async function withTickLock<T>(
  name: string,
  fn: () => Promise<T>,
  ttlMs = 55_000,
): Promise<T | null> {
  const lock = await acquireLock(`lock:tick:${name}`, ttlMs);
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
