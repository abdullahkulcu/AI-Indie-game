-- 002_buildings_units.sql — binalar, inşaat kuyruğu, birim stokları, eğitim kuyruğu.

CREATE TABLE building_instances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id            UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,
  level                 INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  -- Yükseltme sürerken: hedef seviye ve tamamlanma anı. Tick bu zamanı geçmiş
  -- kayıtları işleyip `level`'ı yükseltir (§15.3 adım 2).
  upgrading_to_level    INTEGER,
  upgrade_started_at    TIMESTAMPTZ,
  upgrade_completes_at  TIMESTAMPTZ,
  -- Binanın hangi tile üzerinde olduğu; arazi çarpanı ve maden rezervi
  -- buradan okunur.
  tile_id               UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  -- Derin kazı kaç kez kullanıldı — maliyeti her seferinde 1.5× artar (§4.1).
  deep_excavations_used INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX building_instances_kingdom_idx ON building_instances(kingdom_id);
CREATE INDEX building_instances_pending_idx
  ON building_instances(upgrade_completes_at)
  WHERE upgrade_completes_at IS NOT NULL;

-- Aynı tipten tek kopyaya izin verilen binalar için benzersizlik, uygulama
-- katmanında MULTI_INSTANCE_BUILDINGS listesiyle kontrol edilir; burada
-- kısmi indeksle zorlamak yerine esneklik korunur (kule/tarla/maden çoklu).

CREATE TABLE unit_stocks (
  kingdom_id UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  unit_type  TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (kingdom_id, unit_type)
);

CREATE TABLE training_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  unit_type    TEXT NOT NULL,
  count        INTEGER NOT NULL CHECK (count > 0),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completes_at TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX training_queue_kingdom_idx ON training_queue(kingdom_id);
CREATE INDEX training_queue_due_idx ON training_queue(completes_at);
