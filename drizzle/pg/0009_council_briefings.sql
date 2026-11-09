CREATE TABLE IF NOT EXISTS "council_briefings" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "voices" text NOT NULL,
  "connections" text NOT NULL,
  "source_key" text NOT NULL,
  "generated_at" bigint NOT NULL,
  "read_at" bigint,
  "reminder_count" integer DEFAULT 0 NOT NULL,
  "refreshing_at" bigint
);
CREATE INDEX IF NOT EXISTS "idx_council_briefings_unread" ON "council_briefings" USING btree ("read_at","generated_at");
