ALTER TABLE "shared_mines" ADD COLUMN IF NOT EXISTS "vein" integer DEFAULT 0 NOT NULL;
ALTER TABLE "shared_mines" ADD COLUMN IF NOT EXISTS "position_x" integer DEFAULT -52 NOT NULL;
ALTER TABLE "shared_mines" ADD COLUMN IF NOT EXISTS "position_z" integer DEFAULT 8 NOT NULL;
