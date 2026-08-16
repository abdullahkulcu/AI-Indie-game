-- 004_diplomacy.sql — ittifaklar, danışman-danışman müzakere, koruma ilişkisi,
-- birlik kiralama, pazar ve ikili ticaret anlaşmaları.
--
-- Temel kural (§10): hiçbir yerde serbest metinle insan-insan yazışma yok.
-- Bu yüzden şemada "oyuncudan oyuncuya mesaj" diye bir tablo YOKTUR; tüm metin
-- General'lar arasında üretilir ve oyuncuya salt-okunur transkript olarak gider.

CREATE TABLE alliances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  leader_kingdom_id UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  -- Ortak hedef (§10.2), örn. {"kind":"attack","target_kingdom_id":"..."}.
  shared_goal JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, name)
);

ALTER TABLE kingdoms
  ADD CONSTRAINT kingdoms_alliance_fk
  FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE SET NULL;

ALTER TABLE channels
  ADD CONSTRAINT channels_winner_alliance_fk
  FOREIGN KEY (winner_alliance_id) REFERENCES alliances(id) ON DELETE SET NULL;

-- Krallıklar arası ikili ilişki durumu — zoom-out sahnesindeki ticaret ve
-- düşmanlık hatları bu tablodan çizilir (üçüncü taraf ilişkiler dahil).
CREATE TABLE kingdom_relations (
  channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kingdom_a_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  kingdom_b_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  state          TEXT NOT NULL DEFAULT 'neutral'
                   CHECK (state IN ('neutral','ally','war','ceasefire','vassal','protector')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Çift kayıt olmaması için daima kingdom_a_id < kingdom_b_id tutulur.
  PRIMARY KEY (kingdom_a_id, kingdom_b_id),
  CHECK (kingdom_a_id < kingdom_b_id)
);

CREATE INDEX kingdom_relations_channel_idx ON kingdom_relations(channel_id);

-- Bir diplomatik girişimin tamamı (teklif + danışman-danışman görüşmesi).
CREATE TABLE diplomacy_threads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  from_kingdom_id     UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  to_kingdom_id       UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  proposal_type       TEXT NOT NULL
                        CHECK (proposal_type IN ('ceasefire','alliance','trade','protection_offer',
                                                 'vassalage_request','betrayal_signal','troop_rental')),
  terms               JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','rejected','expired','cancelled')),
  -- Kral'ın kendi General'ına verdiği yönlendirme ("ısrar et", "biraz daha
  -- altın teklif et", "vazgeç"). Karşı tarafa asla doğrudan gitmez.
  steering_note       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX diplomacy_threads_to_idx ON diplomacy_threads(to_kingdom_id, status);
CREATE INDEX diplomacy_threads_from_idx ON diplomacy_threads(from_kingdom_id, status);
CREATE INDEX diplomacy_threads_pending_idx ON diplomacy_threads(status) WHERE status = 'pending';

-- Görüşmenin tur tur transkripti. Oyuncu bunu izler, yönlendirir, ama karşı
-- tarafa asla yazmaz.
CREATE TABLE diplomacy_turns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           UUID NOT NULL REFERENCES diplomacy_threads(id) ON DELETE CASCADE,
  speaker_kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  message             TEXT NOT NULL,
  stance              TEXT NOT NULL DEFAULT 'open'
                        CHECK (stance IN ('open','accept','counter','reject','stall')),
  counter_terms       JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX diplomacy_turns_thread_idx ON diplomacy_turns(thread_id, created_at);

-- Koruma ilişkisi (§10.1): vasallık / haraç / tehdit / koruma teklifi —
-- hepsi aynı mekaniğin farklı yüzleri, tek tabloda.
CREATE TABLE protection_relationships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  protector_kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  vassal_kingdom_id     UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  tribute_rate          NUMERIC(5,4) NOT NULL DEFAULT 0.12,
  -- İlişkiyi kimin başlattığı, sonradan itibar hesabında anlam taşır.
  initiated_by          TEXT NOT NULL DEFAULT 'vassal'
                          CHECK (initiated_by IN ('vassal','protector','coercion')),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_tribute_at       TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','ended','broken')),
  ended_at              TIMESTAMPTZ,
  UNIQUE (vassal_kingdom_id, protector_kingdom_id)
);

CREATE INDEX protection_tribute_due_idx ON protection_relationships(next_tribute_at) WHERE status = 'active';

-- Birlik kiralama anlaşması (§10.5). Kiralanan birlikler kiracının garnizonuna
-- eklenir ama YALNIZCA savunmada kullanılabilir — bu kısıt uygulama katmanında
-- ordu oluştururken zorlanır.
CREATE TABLE troop_rentals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id            UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  lender_kingdom_id     UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  borrower_kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  unit_type             TEXT NOT NULL,
  count                 INTEGER NOT NULL CHECK (count > 0),
  -- Savaşta ölenler kalıcı kaybolur; kiracı tazminat ödemez.
  count_lost            INTEGER NOT NULL DEFAULT 0,
  fee_gold              INTEGER NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at               TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','returned','recalled','lost')),
  returned_at           TIMESTAMPTZ
);

CREATE INDEX troop_rentals_due_idx ON troop_rentals(ends_at) WHERE status = 'active';
CREATE INDEX troop_rentals_borrower_idx ON troop_rentals(borrower_kingdom_id) WHERE status = 'active';
CREATE INDEX troop_rentals_lender_idx ON troop_rentals(lender_kingdom_id) WHERE status = 'active';

-- Genel Pazar: anonim ilan panosu (§10.6). İlanlar herkese (düşmanlar dahil)
-- görünür — kasıtlı bir istihbarat sızıntısı.
CREATE TABLE market_offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kingdom_id        UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  offer_resource    TEXT NOT NULL,
  offer_amount      NUMERIC(12,2) NOT NULL CHECK (offer_amount > 0),
  request_resource  TEXT NOT NULL,
  request_amount    NUMERIC(12,2) NOT NULL CHECK (request_amount > 0),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','accepted','expired','cancelled')),
  accepted_by_kingdom_id UUID REFERENCES kingdoms(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_at       TIMESTAMPTZ
);

CREATE INDEX market_offers_open_idx ON market_offers(channel_id, status) WHERE status = 'open';
CREATE INDEX market_offers_expiry_idx ON market_offers(expires_at) WHERE status = 'open';

-- İkili ticaret anlaşması (§10.6): periyodik, otomatik devam eden değişim.
CREATE TABLE trade_agreements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kingdom_a_id      UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  kingdom_b_id      UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  resource_a        TEXT NOT NULL,
  amount_a          NUMERIC(12,2) NOT NULL CHECK (amount_a > 0),
  resource_b        TEXT NOT NULL,
  amount_b          NUMERIC(12,2) NOT NULL CHECK (amount_b > 0),
  frequency_hours   INTEGER NOT NULL DEFAULT 24,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_delivery_at  TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','cancelled','broken')),
  -- Anlaşmayı habersiz bırakmak (teslimatı durdurmak) itibarı düşürür;
  -- kaç kez aksatıldığı burada tutulur.
  missed_deliveries INTEGER NOT NULL DEFAULT 0,
  ended_at          TIMESTAMPTZ
);

CREATE INDEX trade_agreements_due_idx ON trade_agreements(next_delivery_at) WHERE status = 'active';
CREATE INDEX trade_agreements_parties_idx ON trade_agreements(kingdom_a_id, kingdom_b_id);

-- Casusluk görevleri (§10.2).
CREATE TABLE spy_missions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id         UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  origin_kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  target_kingdom_id  UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  mission            TEXT NOT NULL CHECK (mission IN ('gather_intel','sabotage')),
  departs_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolves_at        TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'in_transit'
                       CHECK (status IN ('in_transit','succeeded','caught','failed')),
  result             JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spy_missions_due_idx ON spy_missions(resolves_at) WHERE status = 'in_transit';
