CREATE TABLE IF NOT EXISTS "diplomatic_relations" (
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "source_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "standing" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("channel_id", "source_user_id", "target_user_id")
);
CREATE INDEX IF NOT EXISTS "idx_diplomatic_relations_source" ON "diplomatic_relations" USING btree ("channel_id", "source_user_id");
