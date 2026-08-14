import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  jwtSecret: required("JWT_SECRET"),
  keyVaultSecret: required("KEY_VAULT_SECRET"),
  tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 45000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Tek bir LLM saglayici/model MVP kapsaminda: sadece OpenAI, sadece bu model.
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};
