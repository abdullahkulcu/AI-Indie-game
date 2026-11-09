ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "defender_civic_response" text DEFAULT 'watch' NOT NULL;
ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "defender_morale_bonus" integer DEFAULT 0 NOT NULL;
