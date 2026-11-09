ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "battle_phase" integer DEFAULT 0 NOT NULL;
ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "next_battle_at" bigint;
ALTER TABLE "war_armies" ADD COLUMN IF NOT EXISTS "morale" integer DEFAULT 70 NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_wars_battle_phase" ON "wars" USING btree ("status", "next_battle_at");
