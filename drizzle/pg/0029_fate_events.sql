CREATE TABLE IF NOT EXISTS "fate_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "source_key" text NOT NULL,
  "title" text NOT NULL,
  "text" text NOT NULL,
  "discussion" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "opened_at" bigint NOT NULL,
  "resolved_at" bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fate_events_source" ON "fate_events" USING btree ("user_id","source_key");
CREATE INDEX IF NOT EXISTS "idx_fate_events_user_recent" ON "fate_events" USING btree ("user_id","opened_at");
