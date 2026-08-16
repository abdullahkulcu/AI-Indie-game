/**
 * Ortam yapılandırması.
 *
 * Sırlar yalnızca ortam değişkeninden okunur ve hiçbir zaman loglanmaz —
 * özellikle `MASTER_KEY`, oyuncuların BYOK anahtarlarını saran anahtardır
 * (§15.5).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Eksik ortam değişkeni: ${name}. .env.example dosyasına bakın.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Geliştirmede tek komutla ayağa kalkabilmek için sırların varsayılanları var;
 * üretimde ikisi de zorunlu (aşağıdaki kontrol).
 */
const devJwtSecret = 'dev-only-jwt-secret-change-me';
const devMasterKey = Buffer.alloc(32, 7).toString('base64');

export const config = {
  isProduction,
  port: optionalInt('PORT', 8080),
  host: optional('HOST', '0.0.0.0'),

  databaseUrl: optional(
    'DATABASE_URL',
    'postgres://krallik:krallik@localhost:5432/krallik',
  ),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  jwtSecret: isProduction ? required('JWT_SECRET') : optional('JWT_SECRET', devJwtSecret),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '30d'),

  /**
   * Envelope encryption'ın kök anahtarı (KEK). Base64, 32 bayt.
   * Üretimde bir KMS'ten gelmeli; burada ortam değişkeni olarak okunuyor.
   */
  masterKeyBase64: isProduction ? required('MASTER_KEY') : optional('MASTER_KEY', devMasterKey),

  corsOrigin: optional('CORS_ORIGIN', '*'),

  /** Tick worker'ın uyanma periyodu (saniye). */
  tickIntervalSeconds: optionalInt('TICK_INTERVAL_SECONDS', 60),
  /** Tick worker'ın bir turda işleyeceği azami krallık sayısı. */
  tickBatchSize: optionalInt('TICK_BATCH_SIZE', 200),
  /** Pasif mod LLM job'ının eşzamanlılık sınırı — oyuncu anahtarları rate-limit yemesin. */
  passiveLlmConcurrency: optionalInt('PASSIVE_LLM_CONCURRENCY', 4),

  /** Bir LLM çağrısının azami süresi (ms). */
  llmTimeoutMs: optionalInt('LLM_TIMEOUT_MS', 60_000),
  /** Bir General turunda izin verilen azami araç çağrısı turu. */
  llmMaxToolRounds: optionalInt('LLM_MAX_TOOL_ROUNDS', 6),

  /** Zamanı testlerde dondurabilmek için tek giriş noktası. */
  now: (): Date => new Date(),
} as const;

if (isProduction && config.masterKeyBase64 === devMasterKey) {
  throw new Error('Üretimde varsayılan MASTER_KEY kullanılamaz.');
}

export function masterKey(): Buffer {
  const key = Buffer.from(config.masterKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY 32 baytlık base64 bir değer olmalı.');
  }
  return key;
}
