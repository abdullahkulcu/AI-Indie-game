CREATE TABLE IF NOT EXISTS "referendums" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "topic" text NOT NULL,
  "question" text NOT NULL,
  "support" integer NOT NULL,
  "verdict" text NOT NULL,
  "text" text NOT NULL,
  "asked_at" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_referendums_user_recent" ON "referendums" USING btree ("user_id","asked_at");
