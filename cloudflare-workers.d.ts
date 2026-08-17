declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    ADMIN_INVITE_HASH?: string;
    BYOK_MASTER_KEY: string;
    /** Gece vardiyası cron ucunu koruyan paylaşımlı sır; tanımsızsa uç kapalıdır. */
    CRON_SECRET?: string;
    /** Postgres bağlantı dizesi; yerelde .dev.vars, yayında Worker secret. */
    DATABASE_URL?: string;
  };
}
