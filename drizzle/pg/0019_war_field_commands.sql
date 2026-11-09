CREATE TABLE IF NOT EXISTS "war_commands" (
  "id" text PRIMARY KEY NOT NULL,
  "war_id" text NOT NULL REFERENCES "wars"("id") ON DELETE CASCADE,
  "issuer_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "status" text DEFAULT 'en_route' NOT NULL,
  "sent_at" bigint NOT NULL,
  "arrives_at" bigint NOT NULL,
  "applied_at" bigint
);
CREATE INDEX IF NOT EXISTS "idx_war_commands_arrival" ON "war_commands" USING btree ("status","arrives_at");
CREATE INDEX IF NOT EXISTS "idx_war_commands_issuer" ON "war_commands" USING btree ("issuer_id","sent_at");
