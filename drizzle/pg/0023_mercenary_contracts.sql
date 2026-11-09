CREATE TABLE IF NOT EXISTS "mercenary_contracts" (
  "id" text PRIMARY KEY NOT NULL,
  "channel_id" text NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
  "agreement_id" text NOT NULL REFERENCES "agreements"("id") ON DELETE CASCADE,
  "lessor_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "renter_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "count" integer NOT NULL,
  "fee" integer NOT NULL,
  "started_at" bigint NOT NULL,
  "ends_at" bigint NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "returned_at" bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_mercenary_contract_agreement" ON "mercenary_contracts" USING btree ("agreement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_mercenary_contract_renter_active" ON "mercenary_contracts" USING btree ("renter_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "idx_mercenary_contract_due" ON "mercenary_contracts" USING btree ("status","ends_at");
CREATE INDEX IF NOT EXISTS "idx_mercenary_contract_lessor" ON "mercenary_contracts" USING btree ("lessor_id","status");
