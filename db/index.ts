import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Postgres bağlantısı.
 *
 * ÖNEMLİ: Workers runtime'ı bir istekte açılan I/O nesnesinin başka bir istekte
 * kullanılmasına izin vermez. Modül seviyesinde havuz tutulduğunda ilk istek
 * çalışır, sonrakiler "Worker's code had hung" ile askıda kalır. Bu yüzden her
 * çağrı kendi havuzunu açar ve bağlantı kısa bir boşta kalma süresinden sonra
 * kendiliğinden kapanır.
 *
 * Yayında bu, istek başına TCP+TLS el sıkışması demektir; ölçekte Cloudflare
 * Hyperdrive veya PgBouncer gibi bir havuzlayıcı önüne konmalıdır.
 */

function connectionString() {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL tanımlı değil. Yerelde .dev.vars dosyasına, yayında Worker secret olarak eklenmeli."
    );
  }
  return url;
}

export function getDb() {
  const url = connectionString();
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 8_000,
    // Sorgu bittikten kısa süre sonra bağlantı kapanır; istekler arası paylaşım olmaz.
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
    // Yönetilen sağlayıcılar TLS ister; yerel docker'da sertifika doğrulaması yapılmaz.
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(pool, { schema });
}
