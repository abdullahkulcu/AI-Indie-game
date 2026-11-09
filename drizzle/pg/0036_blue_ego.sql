ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "next_at" bigint;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "council_meeting_history" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source_key" text NOT NULL,
  "voices" text NOT NULL,
  "generated_at" bigint NOT NULL,
  "next_at" bigint,
  "read_at" bigint,
  "outcome" text DEFAULT 'Gündem Kralın yanıtını bekliyor.' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_council_meeting_history_recent" ON "council_meeting_history" USING btree ("user_id", "generated_at");
--> statement-breakpoint
INSERT INTO "council_meeting_history" ("id", "user_id", "source_key", "voices", "generated_at", "next_at", "read_at", "outcome")
SELECT
  "user_id" || ':' || "generated_at"::text,
  "user_id", "source_key", "voices", "generated_at", "next_at", "read_at",
  CASE WHEN "read_at" IS NULL THEN 'Gündem Kralın yanıtını bekliyor.' ELSE 'Kral gündemi okudu; bağlayıcı kararlar Krallık Defteri''ne işlendi.' END
FROM "council_briefings"
ON CONFLICT ("id") DO NOTHING;
