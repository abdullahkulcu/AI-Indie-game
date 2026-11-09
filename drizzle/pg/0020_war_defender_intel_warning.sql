ALTER TABLE "wars" ADD COLUMN IF NOT EXISTS "defender_alert_at" bigint NOT NULL DEFAULT 0;

-- Eski savaşlar ilan edildiği anda zaten görünürdü; göç sırasında onları
-- geriye dönük saklamak yerine mevcut davranışı koruyoruz.
UPDATE "wars" SET "defender_alert_at" = "created_at" WHERE "defender_alert_at" = 0;
