-- 003_military.sql — ordular, kuşatmalar, kervanlar, savaş raporları.

CREATE TABLE armies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id      UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- {"spearman": 30, "archer": 20} biçiminde birim tipi → adet.
  composition     JSONB NOT NULL,
  origin_tile_id  UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  target_tile_id  UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  departs_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrives_at      TIMESTAMPTZ NOT NULL,
  intent          TEXT NOT NULL CHECK (intent IN ('attack','reinforce','scout','raid','return')),
  -- Mesafeye bağlı güç cezası (§8.3); varışta yeniden hesaplanmaz, yola
  -- çıkarken dondurulur ki oyuncu ne göndereceğini bilerek göndersin.
  fatigue_factor  NUMERIC(5,3) NOT NULL DEFAULT 1.0,
  tactic          TEXT NOT NULL DEFAULT 'frontal'
                    CHECK (tactic IN ('ambush','frontal','withdraw_to_keep','terrain_advantage')),
  distance_tiles  INTEGER NOT NULL DEFAULT 0,
  -- Yağmadan/fetihten dönerken taşıdığı kaynaklar.
  carried_resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'marching'
                    CHECK (status IN ('marching','engaged','besieging','returning','disbanded','garrisoned')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX armies_kingdom_idx ON armies(kingdom_id);
-- Tick'in her dakika taradığı asıl indeks: varış zamanı gelmiş ordular.
CREATE INDEX armies_due_idx ON armies(arrives_at) WHERE status IN ('marching','returning');
CREATE INDEX armies_target_idx ON armies(target_tile_id) WHERE status = 'marching';

CREATE TABLE sieges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  army_id               UUID NOT NULL REFERENCES armies(id) ON DELETE CASCADE,
  attacker_kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  defender_kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  target_tile_id        UUID NOT NULL REFERENCES map_tiles(id) ON DELETE CASCADE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_round         INTEGER NOT NULL DEFAULT 0,
  max_rounds            INTEGER NOT NULL,
  -- Sur/kale dayanıklılığı kademeli aşınır — anında düşmez (§8.2).
  wall_integrity        NUMERIC(12,2) NOT NULL,
  wall_integrity_max    NUMERIC(12,2) NOT NULL,
  next_round_at         TIMESTAMPTZ NOT NULL,
  -- Savunanın seçtiği taktik; aktif modda oyuncu, pasif modda strateji notuna
  -- göre General belirler (§8.3).
  defender_tactic       TEXT NOT NULL DEFAULT 'withdraw_to_keep',
  attacker_tactic       TEXT NOT NULL DEFAULT 'frontal',
  status                TEXT NOT NULL DEFAULT 'ongoing'
                          CHECK (status IN ('ongoing','attacker_won','defender_won','withdrawn')),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sieges_due_idx ON sieges(next_round_at) WHERE status = 'ongoing';
CREATE INDEX sieges_defender_idx ON sieges(defender_kingdom_id) WHERE status = 'ongoing';
CREATE INDEX sieges_attacker_idx ON sieges(attacker_kingdom_id) WHERE status = 'ongoing';

-- Kuşatmaya sonradan katılan takviyeler (§8.2 takviye penceresi).
CREATE TABLE siege_reinforcements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  siege_id     UUID NOT NULL REFERENCES sieges(id) ON DELETE CASCADE,
  army_id      UUID NOT NULL REFERENCES armies(id) ON DELETE CASCADE,
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  side         TEXT NOT NULL CHECK (side IN ('attacker','defender')),
  composition  JSONB NOT NULL,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX siege_reinforcements_siege_idx ON siege_reinforcements(siege_id);

CREATE TABLE caravans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id      UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  origin_tile_id  UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  target_tile_id  UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  -- Hedef başka bir krallıksa (ticaret/haraç) doğrudan onun deposuna boşalır.
  target_kingdom_id UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  resource_type   TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  departs_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrives_at      TIMESTAMPTZ NOT NULL,
  -- Kervanlar yolda pusuya düşürülemez (bilinçli tasarım kararı, §9) —
  -- bu yüzden bir "status" dışında savaş alanı yok.
  purpose         TEXT NOT NULL DEFAULT 'conquest_transfer'
                    CHECK (purpose IN ('conquest_transfer','trade','tribute')),
  status          TEXT NOT NULL DEFAULT 'in_transit'
                    CHECK (status IN ('in_transit','delivered','cancelled')),
  related_offer_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX caravans_due_idx ON caravans(arrives_at) WHERE status = 'in_transit';
CREATE INDEX caravans_kingdom_idx ON caravans(kingdom_id);

-- Fethedilmiş bölgelerde bekleyen, henüz kervanla taşınmamış kaynaklar (§9).
-- Bölge tekrar el değiştirirse taşınmamış kaynaklar yeni sahibine geçer.
CREATE TABLE tile_stockpiles (
  tile_id     UUID NOT NULL REFERENCES map_tiles(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tile_id, resource)
);

CREATE TABLE battle_reports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id           UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  attacker_kingdom_id  UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  defender_kingdom_id  UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  tile_id              UUID REFERENCES map_tiles(id) ON DELETE SET NULL,
  siege_id             UUID REFERENCES sieges(id) ON DELETE SET NULL,
  intent               TEXT NOT NULL,
  mode                 TEXT NOT NULL CHECK (mode IN ('raid','siege_round','siege_final')),
  attacker_won         BOOLEAN NOT NULL,
  attack_power         NUMERIC(14,2) NOT NULL,
  defense_power        NUMERIC(14,2) NOT NULL,
  attacker_losses      JSONB NOT NULL DEFAULT '{}'::jsonb,
  defender_losses      JSONB NOT NULL DEFAULT '{}'::jsonb,
  plunder              JSONB NOT NULL DEFAULT '{}'::jsonb,
  wall_damage          NUMERIC(12,2) NOT NULL DEFAULT 0,
  wall_integrity_after NUMERIC(12,2),
  capital_fell         BOOLEAN NOT NULL DEFAULT FALSE,
  narrative            TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX battle_reports_attacker_idx ON battle_reports(attacker_kingdom_id, created_at DESC);
CREATE INDEX battle_reports_defender_idx ON battle_reports(defender_kingdom_id, created_at DESC);
