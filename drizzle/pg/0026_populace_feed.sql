CREATE TABLE IF NOT EXISTS "populace_feed" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "text" text NOT NULL,
  "source_key" text NOT NULL,
  "created_at" bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_populace_feed_source" ON "populace_feed" USING btree ("user_id","source_key");
CREATE INDEX IF NOT EXISTS "idx_populace_feed_recent" ON "populace_feed" USING btree ("user_id","created_at");
