ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "blockade_settled_at" bigint;
ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "blockade_pressure" integer DEFAULT 0 NOT NULL;

DROP INDEX IF EXISTS "idx_wars_attacker_active";
DROP INDEX IF EXISTS "idx_wars_defender_active";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wars_attacker_active" ON "wars" USING btree ("attacker_id") WHERE "status" in ('gathering','marching','engaged','siege','blockade','returning');
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wars_defender_active" ON "wars" USING btree ("defender_id") WHERE "status" in ('gathering','marching','engaged','siege','blockade','returning');
