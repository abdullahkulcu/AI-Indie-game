/**
 * PostgreSQL bağlantı havuzu ve küçük bir sorgu yardımcısı.
 *
 * ORM kullanılmıyor: oyunun sıcak yolu (tick servisi) yüzlerce krallığı dakikada
 * bir tarayan toplu sorgulardan oluşuyor ve bunların şeklini elle kontrol etmek
 * istiyoruz. Buna karşılık tip güvenliği kaybolmasın diye her sorgunun satır
 * tipi çağrı yerinde açıkça veriliyor.
 */

import pg from 'pg';
import { config } from '../config.js';

// NUMERIC sütunları JS'e string olarak gelir (pg varsayılanı, hassasiyet
// kaybını önlemek için). Oyun içi miktarlarımız 1e15'in çok altında olduğundan
// number'a çevirmek güvenli ve kodun geri kalanını fazlasıyla basitleştiriyor.
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
// int8 (bigint) — sayaçlar için.
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.isProduction ? 20 : 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // Havuzdaki boşta bir bağlantının kopması ölümcül değil; pg yenisini açar.
  console.error('[db] boştaki bağlantı hatası:', err.message);
});

export type QueryParam = string | number | boolean | null | Date | Buffer | object;

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: readonly QueryParam[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as QueryParam[]);
  return result.rows;
}

/** Tek satır bekleyen sorgular için; hiç satır yoksa `null`. */
export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params: readonly QueryParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export type Tx = pg.PoolClient;

/**
 * Transaction sarmalayıcı.
 *
 * Emir kotasının düşürülmesi ve kaynak harcaması gibi işlemler tek bir
 * transaction içinde olmak zorunda (§15.5) — aksi hâlde eşzamanlı iki çağrı
 * aynı kotayı iki kez harcayabilirdi.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Bağlantı zaten koptuysa rollback da başarısız olur; asıl hatayı taşıyalım.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function txQuery<T extends pg.QueryResultRow>(
  tx: Tx,
  text: string,
  params: readonly QueryParam[] = [],
): Promise<T[]> {
  const result = await tx.query<T>(text, params as QueryParam[]);
  return result.rows;
}

export async function txQueryOne<T extends pg.QueryResultRow>(
  tx: Tx,
  text: string,
  params: readonly QueryParam[] = [],
): Promise<T | null> {
  const rows = await txQuery<T>(tx, text, params);
  return rows[0] ?? null;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
