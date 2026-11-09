ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "attacker_support_morale" integer DEFAULT 0 NOT NULL;
ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "defender_support_morale" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "war_supports" (
  "id" text PRIMARY KEY NOT NULL,
  "war_id" text NOT NULL REFERENCES "wars"("id") ON DELETE CASCADE,
  "supporter_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "side" text NOT NULL,
  "food" integer NOT NULL,
  "status" text DEFAULT 'en_route' NOT NULL,
  "sent_at" bigint NOT NULL,
  "arrives_at" bigint NOT NULL,
  "delivered_at" bigint
);
CREATE INDEX IF NOT EXISTS "idx_war_supports_arrival" ON "war_supports" USING btree ("status","arrives_at");
CREATE INDEX IF NOT EXISTS "idx_war_supports_supporter" ON "war_supports" USING btree ("supporter_id","sent_at");
