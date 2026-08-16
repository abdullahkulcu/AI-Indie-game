-- 001_core.sql — kullanıcılar, channel'lar, krallıklar, harita.
--
-- GDD §15.2'deki veri modeli taslağının somut hâli. §16.5 gereği tüm şema
-- değişiklikleri additive (expand-and-contract) olmalı: sütun eklenir, kod
-- ikisini de destekler, veri taşınır, eski sonra temizlenir. Bu ilk göç
-- taban şemayı kurar.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- kullanıcı
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ
);

-- Hesap düzeyinde kalıcı profil (§16.4). Krallıkları mekanik olarak birbirine
-- bağlamaz; yalnızca uzun vadeli bağlılık için istatistik taşır.
CREATE TABLE user_profiles (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  titles                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_channels_won       INTEGER NOT NULL DEFAULT 0,
  highest_population_ever  INTEGER NOT NULL DEFAULT 0,
  total_kingdoms_conquered INTEGER NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- channel
CREATE TABLE channels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  channel_type       TEXT NOT NULL CHECK (channel_type IN ('season', 'short', 'recurring')),
  -- §16.1: admin hangi sağlayıcı/modellerin kabul edileceğini belirleyebilir.
  -- NULL = kısıtsız "Açık" channel.
  llm_restriction    JSONB,
  duration_days      INTEGER NOT NULL,
  started_at         TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'active', 'finished')),
  winner_alliance_id UUID,
  winner_kingdom_id  UUID,
  -- §16.5: her channel başladığı kural setiyle biter. Denge sabitleri
  -- burada dondurulur, ortada değişen dengeler devam eden oyunu bozmaz.
  balance_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Harita dairesel olarak dışa büyür; bir sonraki katılımcının alacağı slot.
  next_slot_index    INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX channels_status_idx ON channels(status) WHERE status <> 'finished';

-- ----------------------------------------------------------------- krallık
CREATE TABLE kingdoms (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id                  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  capital_tile_id             UUID,

  -- Kaynak defteri. Ara ürünler (un, cevher, süt...) de burada tutulur;
  -- zincirin bir halkası darboğaz olduğunda ara ürün stoğunun şişmesi
  -- doğrudan ölçülebilir olsun diye.
  gold      NUMERIC(14,2) NOT NULL DEFAULT 750,
  food      NUMERIC(14,2) NOT NULL DEFAULT 600,
  stone     NUMERIC(14,2) NOT NULL DEFAULT 400,
  wood      NUMERIC(14,2) NOT NULL DEFAULT 500,
  iron      NUMERIC(14,2) NOT NULL DEFAULT 60,
  ale       NUMERIC(14,2) NOT NULL DEFAULT 0,
  wheat     NUMERIC(14,2) NOT NULL DEFAULT 0,
  flour     NUMERIC(14,2) NOT NULL DEFAULT 0,
  hops      NUMERIC(14,2) NOT NULL DEFAULT 0,
  milk      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ore       NUMERIC(14,2) NOT NULL DEFAULT 0,
  weapons   NUMERIC(14,2) NOT NULL DEFAULT 40,
  cheese    NUMERIC(14,2) NOT NULL DEFAULT 0,

  population        NUMERIC(12,2) NOT NULL DEFAULT 60,
  popularity        NUMERIC(6,2)  NOT NULL DEFAULT 55 CHECK (popularity BETWEEN 0 AND 100),
  reputation        NUMERIC(6,2)  NOT NULL DEFAULT 60 CHECK (reputation BETWEEN 0 AND 100),
  general_loyalty   NUMERIC(6,2)  NOT NULL DEFAULT 75 CHECK (general_loyalty BETWEEN 0 AND 100),
  tax_rate          INTEGER       NOT NULL DEFAULT 20 CHECK (tax_rate BETWEEN 0 AND 100),

  protection_ends_at        TIMESTAMPTZ,
  alliance_id               UUID,
  vassal_of_kingdom_id      UUID REFERENCES kingdoms(id) ON DELETE SET NULL,

  -- Emir kotası (§14.4). Kota kontrolü ve düşürülmesi backend'de atomik;
  -- LLM tarafından bypass edilemez (§15.5).
  decree_quota_remaining      NUMERIC(6,2) NOT NULL DEFAULT 2,
  decree_quota_last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- BYOK (§14.6). Anahtar yalnızca şifreli saklanır; düz metin hiçbir zaman
  -- loglanmaz, yalnızca sağlayıcı isteği anında bellekte çözülür.
  llm_provider          TEXT,
  llm_model             TEXT,
  llm_base_url          TEXT,
  api_key_encrypted     BYTEA,
  api_key_iv            BYTEA,
  api_key_tag           BYTEA,
  api_key_wrapped_dek   BYTEA,
  llm_last_error_kind   TEXT,
  llm_last_error_at     TIMESTAMPTZ,
  llm_last_success_at   TIMESTAMPTZ,
  llm_onboarded_at      TIMESTAMPTZ,

  -- Pasif modda kararların alındığı genel strateji notu (§14.2).
  strategy_note     TEXT NOT NULL DEFAULT 'Önce ekonomiyi büyüt, savunmada kal, komşularla iyi geçin.',
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tick_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_passive_run_at TIMESTAMPTZ,

  -- Şenlik azalan getirisi için pencere sayacı (§6.2).
  festivals_in_window     INTEGER NOT NULL DEFAULT 0,
  festival_window_started_at TIMESTAMPTZ,
  festival_bonus_until    TIMESTAMPTZ,
  festival_bonus_value    NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- §12: başkenti düşen oyuncu izlemeyi ya da mülteci olarak yeniden başlamayı
  -- seçer. Bu otomatik değil; rapor görüldükten sonraki bilinçli karardır.
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'fallen', 'spectating', 'refugee')),
  fell_at           TIMESTAMPTZ,
  conquered_by_kingdom_id UUID REFERENCES kingdoms(id) ON DELETE SET NULL,

  peak_population   INTEGER NOT NULL DEFAULT 60,
  tiles_conquered   INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Bir hesap aynı channel'da yalnızca tek krallık yönetir (§16.4: farklı
  -- channel'larda ayrı ve bağımsız krallıklar serbest).
  UNIQUE (user_id, channel_id)
);

CREATE INDEX kingdoms_channel_idx ON kingdoms(channel_id);
CREATE INDEX kingdoms_user_idx ON kingdoms(user_id);
CREATE INDEX kingdoms_active_idx ON kingdoms(channel_id, status) WHERE status = 'active';
CREATE INDEX kingdoms_vassal_idx ON kingdoms(vassal_of_kingdom_id) WHERE vassal_of_kingdom_id IS NOT NULL;

-- ------------------------------------------------------------------ harita
CREATE TABLE map_tiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id             UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  x                      INTEGER NOT NULL,
  y                      INTEGER NOT NULL,
  terrain_type           TEXT NOT NULL
                           CHECK (terrain_type IN ('plains','forest','mountain','riverbank','pass','barren')),
  owner_kingdom_id       UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  is_capital             BOOLEAN NOT NULL DEFAULT FALSE,
  -- Maden tile'ları için kalan rezerv (§4.1). NULL = maden yok.
  mine_reserve_remaining NUMERIC(14,2),
  mine_reserve_capacity  NUMERIC(14,2),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, x, y)
);

CREATE INDEX map_tiles_owner_idx ON map_tiles(owner_kingdom_id) WHERE owner_kingdom_id IS NOT NULL;
CREATE INDEX map_tiles_channel_pos_idx ON map_tiles(channel_id, x, y);

ALTER TABLE kingdoms
  ADD CONSTRAINT kingdoms_capital_tile_fk
  FOREIGN KEY (capital_tile_id) REFERENCES map_tiles(id) ON DELETE SET NULL;
