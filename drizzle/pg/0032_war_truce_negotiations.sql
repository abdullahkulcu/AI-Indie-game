ALTER TABLE "negotiations" ADD COLUMN IF NOT EXISTS "war_id" text REFERENCES "wars"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_negotiations_war" ON "negotiations" USING btree ("war_id");
