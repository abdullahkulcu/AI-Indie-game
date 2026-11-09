CREATE TABLE IF NOT EXISTS "wars" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "attacker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "defender_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "objective" text NOT NULL,
  "status" text DEFAULT 'gathering' NOT NULL,
  "target_terrain" text NOT NULL,
  "distance" double precision NOT NULL,
  "march_hours" double precision NOT NULL,
  "created_at" bigint NOT NULL,
  "departs_at" bigint NOT NULL,
  "arrives_at" bigint NOT NULL,
  "returns_at" bigint,
  "resolved_at" bigint,
  "revision" integer DEFAULT 1 NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_wars_channel_status" ON "wars" USING btree ("channel_id","status");
CREATE INDEX IF NOT EXISTS "idx_wars_attacker_status" ON "wars" USING btree ("attacker_id","status");
CREATE INDEX IF NOT EXISTS "idx_wars_defender_status" ON "wars" USING btree ("defender_id","status");
CREATE INDEX IF NOT EXISTS "idx_wars_pair_finished" ON "wars" USING btree ("attacker_id","defender_id","resolved_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wars_attacker_active" ON "wars" USING btree ("attacker_id") WHERE "status" in ('gathering','marching','engaged','siege','returning');
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wars_defender_active" ON "wars" USING btree ("defender_id") WHERE "status" in ('gathering','marching','engaged','siege','returning');

CREATE TABLE IF NOT EXISTS "war_armies" (
  "war_id" text NOT NULL REFERENCES "wars"("id") ON DELETE CASCADE,
  "side" text NOT NULL,
  "units" text NOT NULL,
  "supply" integer DEFAULT 0 NOT NULL,
  "initial_supply" integer DEFAULT 0 NOT NULL,
  "approach" text DEFAULT 'balanced' NOT NULL,
  "withdraw_threshold" integer DEFAULT 50 NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("war_id","side")
);

CREATE TABLE IF NOT EXISTS "war_defenses" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "doctrine" text DEFAULT 'balanced' NOT NULL,
  "updated_at" bigint NOT NULL,
  PRIMARY KEY ("user_id","channel_id")
);

CREATE TABLE IF NOT EXISTS "war_events" (
  "war_id" text NOT NULL REFERENCES "wars"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "kind" text NOT NULL,
  "message" text NOT NULL,
  "at" bigint NOT NULL,
  PRIMARY KEY ("war_id","sequence")
);

CREATE TABLE IF NOT EXISTS "war_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "war_id" text NOT NULL REFERENCES "wars"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "created_at" bigint NOT NULL,
  "read_at" bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_war_reports_once" ON "war_reports" USING btree ("war_id","user_id","kind");
CREATE INDEX IF NOT EXISTS "idx_war_reports_user" ON "war_reports" USING btree ("user_id","read_at","created_at");
