declare module "cloudflare:workers" {
  export const env: { DB: D1Database; ADMIN_INVITE_HASH?: string };
}
