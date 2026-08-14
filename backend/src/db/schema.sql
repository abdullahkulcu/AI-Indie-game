-- Multiplayer MVP schema: a fixed set of channels (lobbies), each with its
-- own very large (but not chunk-streamed) map. Terrain/resource deposits are
-- a pure function of (channel seed, x, y) - see mapService.ts - so tiles are
-- NOT pre-seeded; only ownership claims are persisted, and only for tiles a
-- player has actually claimed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  map_size INTEGER NOT NULL DEFAULT 300,
  max_players INTEGER NOT NULL DEFAULT 8,
  seed INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_channel ON players(channel_id);

-- Kullanicinin kendi LLM API key'i (BYOK). Hicbir zaman duz metin saklanmaz;
-- AES-256-GCM ile sifrelenir (bkz. src/crypto/keyVault.ts).
CREATE TABLE IF NOT EXISTS player_api_keys (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai',
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resources (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  gold INTEGER NOT NULL DEFAULT 200,
  wood INTEGER NOT NULL DEFAULT 100,
  food INTEGER NOT NULL DEFAULT 100,
  stone INTEGER NOT NULL DEFAULT 0,
  iron INTEGER NOT NULL DEFAULT 0
);

-- Tile OWNERSHIP claims only - terrain itself is computed, never stored.
CREATE TABLE IF NOT EXISTS tile_claims (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  owner_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_tile_claims_owner ON tile_claims(channel_id, owner_player_id);

CREATE TABLE IF NOT EXISTS structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_structures_channel ON structures(channel_id);

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  attack INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  target_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
  assigned_task JSONB,
  cooldown_until_tick INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_units_channel ON units(channel_id);
CREATE INDEX IF NOT EXISTS idx_units_owner ON units(channel_id, owner_player_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_player ON chat_messages(player_id, created_at);

CREATE TABLE IF NOT EXISTS tick_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  tick_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, tick_number)
);

CREATE TABLE IF NOT EXISTS action_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  tick_number INTEGER NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_log_channel_tick ON action_log_entries(channel_id, tick_number);

-- Fixed lobby list. Each channel gets a distinct seed so their maps look
-- different; safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO channels (name, map_size, max_players, seed) VALUES
  ('Kanal 1', 300, 8, 1),
  ('Kanal 2', 300, 8, 2),
  ('Kanal 3', 300, 8, 3)
ON CONFLICT (name) DO NOTHING;
