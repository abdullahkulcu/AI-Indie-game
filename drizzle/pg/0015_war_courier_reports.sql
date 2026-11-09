ALTER TABLE "war_events" ADD COLUMN IF NOT EXISTS "visible_at" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "war_reports" ADD COLUMN IF NOT EXISTS "available_at" bigint DEFAULT 0 NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_war_reports_delivery" ON "war_reports" USING btree ("user_id","available_at");
