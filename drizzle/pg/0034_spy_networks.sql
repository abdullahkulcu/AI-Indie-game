CREATE TABLE IF NOT EXISTS "spy_networks" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "source_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'deploying',
  "deploys_at" bigint NOT NULL,
  "next_report_at" bigint,
  "last_report_at" bigint,
  "latest_report" text,
  "exposed_at" bigint,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_spy_networks_active_pair" ON "spy_networks" USING btree ("source_user_id", "target_user_id") WHERE "status" IN ('deploying', 'active');
CREATE INDEX IF NOT EXISTS "idx_spy_networks_due" ON "spy_networks" USING btree ("status", "deploys_at", "next_report_at");
CREATE INDEX IF NOT EXISTS "idx_spy_networks_source" ON "spy_networks" USING btree ("source_user_id", "created_at");
