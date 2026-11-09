ALTER TABLE "shared_mines" ADD COLUMN IF NOT EXISTS "influence_owner_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "shared_mines" ADD COLUMN IF NOT EXISTS "influence_game_hours" double precision NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "shared_mine_influence" (
  "mine_id" text NOT NULL REFERENCES "shared_mines"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "worker_hours" double precision NOT NULL DEFAULT 0,
  PRIMARY KEY ("mine_id", "user_id")
);
