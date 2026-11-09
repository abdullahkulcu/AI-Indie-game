ALTER TABLE "war_supports" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'supply' NOT NULL;
ALTER TABLE "war_supports" ADD COLUMN IF NOT EXISTS "units" text DEFAULT '{}' NOT NULL;
ALTER TABLE "war_supports" ADD COLUMN IF NOT EXISTS "returned_at" bigint;
CREATE INDEX IF NOT EXISTS "idx_war_supports_return" ON "war_supports" USING btree ("kind", "status");
