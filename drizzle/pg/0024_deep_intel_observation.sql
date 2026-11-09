ALTER TABLE "intel_missions" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'scout' NOT NULL;
