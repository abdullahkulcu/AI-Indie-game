/**
 * Migration çalıştırıcı.
 *
 * GDD §16.5: şema değişiklikleri geriye dönük uyumlu (additive) olmalı ve tick
 * servisi güncelleme sırasında da çalışmaya devam etmeli. Bu yüzden migration'lar
 * sıralı, tek yönlü ve idempotent uygulanır — bir dosya bir kez çalışır, kaydı
 * `schema_migrations` tablosunda tutulur, rolling deployment sırasında iki sürüm
 * aynı anda ayakta kalabilir.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closePool, pool } from './pool.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const justApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      // Her migration tek bir transaction içinde; yarım uygulanmış şema kalmaz.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      justApplied.push(file);
      console.log(`[migrate] uygulandı: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[migrate] BAŞARISIZ: ${file}`);
      throw error;
    } finally {
      client.release();
    }
  }

  if (justApplied.length === 0) {
    console.log('[migrate] şema güncel, uygulanacak migration yok.');
  }

  return justApplied;
}

// Doğrudan çalıştırıldığında (npm run migrate) CLI gibi davran; başka bir
// modülden import edildiğinde yalnızca `runMigrations` dışa açılır.
const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryPoint === import.meta.url) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
