CREATE TABLE IF NOT EXISTS "faction_coalitions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "text" text NOT NULL,
  "policy_key" text NOT NULL,
  "policy_value" integer NOT NULL,
  "source_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "opened_at" bigint NOT NULL,
  "refusal_count" integer NOT NULL DEFAULT 0,
  "last_answered_at" bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_faction_coalitions_user" ON "faction_coalitions" USING btree ("user_id");
