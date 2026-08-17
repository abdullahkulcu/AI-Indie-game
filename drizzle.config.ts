import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/pg",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://demirkale:demirkale@127.0.0.1:5433/demirkale" },
});
