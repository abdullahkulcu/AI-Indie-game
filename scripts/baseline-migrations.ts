/**
 * Mevcut veritabanını göç defterine "uygulanmış" olarak damgalar.
 *
 * NEDEN VAR: bu proje uzun süre açılışta `drizzle-kit push --force` çalıştırdı,
 * yani şema diff'lenerek kuruldu ve `drizzle.__drizzle_migrations` defteri hiç
 * yazılmadı. Üretim yolu `drizzle-kit migrate`'e geçince o veritabanında migrate
 * 0000'dan başlamak ister, tablolar zaten var olduğu için düşer ve UYGULAMA HİÇ
 * AÇILMAZ. Ölçüldü: push ile kurulmuş veritabanında `drizzle-kit migrate` çıkış
 * kodu 1 veriyor ve hiçbir şey uygulamıyor.
 *
 * Bu betik ŞEMAYI DEĞİŞTİRMEZ. Yalnızca defteri, o şemayı üretecek göçler zaten
 * uygulanmış gibi doldurur. Tek seferlik ve yalnızca ESKİ veritabanları için:
 * sıfırdan kurulan veritabanında `./run.sh db:up` doğrudan çalışır.
 *
 * Kullanım:  ./run.sh db:baseline
 *
 * Damgalamadan ÖNCE şemanın gerçekten güncel olduğundan emin olun
 * (`./run.sh db:push` ile son hâline getirin); aksi hâlde eksik bir şema
 * "göçler uygulanmış" diye işaretlenir ve eksik sütun sessizce kalır.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const FOLDER = join(process.cwd(), "drizzle", "pg");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL gerekli."); process.exit(1); }

type Entry = { tag: string; when: number };
const journal = JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8")) as { entries: Entry[] };

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

  const { rows } = await client.query<{ hash: string }>('SELECT hash FROM "drizzle"."__drizzle_migrations"');
  const known = new Set(rows.map(row => row.hash));

  let stamped = 0;
  for (const entry of journal.entries) {
    // drizzle-kit dosya İÇERİĞİNİN sha256'sını saklar; aynı hesabı burada da yaparız.
    const sql = readFileSync(join(FOLDER, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (known.has(hash)) { console.log(`atlandı (zaten damgalı): ${entry.tag}`); continue; }
    await client.query('INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)', [hash, entry.when]);
    console.log(`damgalandı: ${entry.tag}`);
    stamped += 1;
  }
  console.log(stamped === 0 ? "defter zaten güncel." : `${stamped} göç uygulanmış olarak işaretlendi.`);
} finally {
  await client.end();
}
