-- MVP schema: tek harita, tek oyun instance'i.
-- Kimlik icin UUID kullanilir; buyume ile birlikte cok haritali/coklu oda
-- senaryosuna gecmek icin bir gun sonra "game_id" kolonu eklemek yeterli olacak sekilde tasarlandi.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  gold INTEGER NOT NULL DEFAULT 200,
  wood INTEGER NOT NULL DEFAULT 100,
  food INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS tiles (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  terrain TEXT NOT NULL DEFAULT 'plains',
  owner_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
  PRIMARY KEY (x, y)
);

CREATE TABLE IF NOT EXISTS structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (x, y)
);

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_units_owner ON units(owner_player_id);
CREATE INDEX IF NOT EXISTS idx_units_position ON units(x, y);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_player ON chat_messages(player_id, created_at);

CREATE TABLE IF NOT EXISTS tick_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_number INTEGER NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_number INTEGER NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_log_tick ON action_log_entries(tick_number);
