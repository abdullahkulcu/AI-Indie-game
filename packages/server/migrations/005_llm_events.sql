-- 005_llm_events.sql — Meclis sohbeti, kademeli karar kayıtları, bildirimler,
-- dünya olayları, bölgesel duyum akışı, aksiyon logu ve idempotency.

-- Kral ile General arasındaki sohbet (§14.1). Diplomasi transkriptleri ayrı
-- tabloda; burası yalnızca kendi danışmanınla konuşma.
CREATE TABLE chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('king','general','system')),
  content      TEXT NOT NULL,
  -- Bu turda General'ın yürüttüğü aksiyonlar ve sonuçları.
  actions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Pasif modda alınmış bir "karar paketi" özeti mi (§14.2).
  is_passive_summary BOOLEAN NOT NULL DEFAULT FALSE,
  token_usage  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_kingdom_idx ON chat_messages(kingdom_id, created_at DESC);

-- Büyük/riskli kararlar otomatik uygulanmaz; General öneri hazırlar, Kral
-- karar verir. Kral süresinde yanıt vermezse en güvenli seçenek uygulanır
-- (genelde: hiçbir şey yapma) ve karar loglanır (§14.5).
CREATE TABLE pending_decisions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id                  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  proposed_action_json        JSONB NOT NULL,
  general_recommendation_text TEXT NOT NULL,
  -- Aksiyonun neden "büyük karar" sayıldığı — backend'de hesaplanır, LLM'e
  -- bırakılmaz ki General kendini "bu rutin" diye ikna edemesin (§15.5).
  risk_reasons                JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_severity               NUMERIC(4,3) NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                  TIMESTAMPTZ NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'awaiting'
                                CHECK (status IN ('awaiting','approved','rejected','expired_safe_default')),
  resolved_at                 TIMESTAMPTZ,
  resolution_note             TEXT
);

CREATE INDEX pending_decisions_kingdom_idx ON pending_decisions(kingdom_id, status);
CREATE INDEX pending_decisions_expiry_idx ON pending_decisions(expires_at) WHERE status = 'awaiting';

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  related_id  UUID,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);

CREATE INDEX notifications_kingdom_idx ON notifications(kingdom_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications(kingdom_id) WHERE read_at IS NULL;

-- Rastgele dünya olayları (§11). Pasif modda bile işler.
CREATE TABLE world_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  type                TEXT NOT NULL
                        CHECK (type IN ('bountiful_harvest','plague','bandit_raid','traveling_merchant')),
  affected_kingdom_id UUID REFERENCES kingdoms(id) ON DELETE CASCADE,
  region_id           TEXT,
  triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  effect_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Olayın etkisi uygulandı mı (tek seferlik olanlar için).
  applied             BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX world_events_kingdom_idx ON world_events(affected_kingdom_id, triggered_at DESC);
CREATE INDEX world_events_active_idx ON world_events(expires_at) WHERE expires_at IS NOT NULL;

-- Bölgesel Duyum Akışı (§10.4): salt-okunur bilgi akışı. Rutin aktivite 6
-- saatte bir toplu bülten, büyük olaylar anında ayrı kayıt.
CREATE TABLE region_bulletins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id          UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('routine_digest','major_event')),
  summary             TEXT NOT NULL,
  related_kingdom_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX region_bulletins_kingdom_idx ON region_bulletins(kingdom_id, created_at DESC);

-- Bölgesel aktivite ham kaydı; 6 saatlik bülten bunlardan özetlenir.
CREATE TABLE region_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- Olayın merkezi — hangi krallıkların "bölge"sine düştüğü buradan hesaplanır.
  origin_x    INTEGER NOT NULL,
  origin_y    INTEGER NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'routine' CHECK (severity IN ('routine','major')),
  summary     TEXT NOT NULL,
  related_kingdom_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX region_activity_channel_idx ON region_activity(channel_id, created_at DESC);

-- Her durum değiştiren aksiyonun denetim kaydı. Anomali tespiti (§15.5) ve
-- "yokluğunda şunları yaptım" özeti bunun üzerinden üretilir.
CREATE TABLE action_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id    UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  action_name   TEXT NOT NULL,
  arguments     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ok            BOOLEAN NOT NULL,
  error_code    TEXT,
  message       TEXT NOT NULL DEFAULT '',
  quota_spent   NUMERIC(5,2) NOT NULL DEFAULT 0,
  tier          TEXT NOT NULL DEFAULT 'routine' CHECK (tier IN ('routine','major')),
  -- Aktif mod (Kral yönlendirdi) mi, pasif mod (General kendi karar verdi) mi.
  source        TEXT NOT NULL DEFAULT 'active' CHECK (source IN ('active','passive','system')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX action_log_kingdom_idx ON action_log(kingdom_id, created_at DESC);

-- Idempotency (§15.5): her LLM fonksiyon çağrısı bir nonce taşır; ağ hatası
-- sonrası tekrarlanan çağrı çift işlenmez.
CREATE TABLE action_idempotency (
  nonce       TEXT PRIMARY KEY,
  kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX action_idempotency_cleanup_idx ON action_idempotency(created_at);

-- Anomali işaretleri (§15.5): üretim hızından çok daha hızlı artan kaynak gibi
-- istatistiksel sapmalar otomatik işaretlenir.
CREATE TABLE anomaly_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX anomaly_flags_open_idx ON anomaly_flags(created_at DESC) WHERE reviewed_at IS NULL;

-- Sezon sonu arşivi (§12, §16.1).
CREATE TABLE season_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  finished_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  winner_alliance_id  UUID REFERENCES alliances(id) ON DELETE SET NULL,
  winner_kingdom_id   UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  standings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (channel_id)
);
