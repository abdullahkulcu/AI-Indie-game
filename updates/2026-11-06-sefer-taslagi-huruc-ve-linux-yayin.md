# Sefer taslağı, huruç, barış ve Linux yayın güvenliği

Tarih: 2026-11-06

## Ne değişti

General artık keşfedilmiş bir komşu için hedef, amaç, yaklaşım ve geri çekilme eşiği içeren düzenlenebilir bir Sefer Masası taslağı bırakabiliyor. Taslak asker veya erzak harcamıyor, savaşı başlatmıyor ve oyuncuyu başka bir ekrana zorlamıyor; mühür yine Kralda kalıyor. Savunma doktrini ve gelen savaşa karşı cevap General aracından kalıcı olarak ayarlanabiliyor.

Kuşatma savunmasına huruç, savaş sonuna barış belgesi ve savaş puanından türeyen ilk diplomatik şart eklendi. Tekrarlanan huruç/barış isteği yarış koşullarına karşı veritabanı damgalarıyla kilitlendi. Üretim Docker örtüsü artık PostgreSQL'in geliştirme portunu kapatıyor; uygulama ve cron aynı gizli ayar dosyasını açıkça okuyor.

## Neden

Generalin önerisi yalnız sohbet metni olduğunda oyuncu planı tekrar kurmak zorunda kalıyordu. Savaşın karar zincirinin huruç, geri çekilme ve diplomatik kapanış içermesi; ayrıca canlı Linux kurulumunda gizli ayarların uygulamaya ulaşması ve veritabanının internete açık kalmaması gerekiyordu.

## Etkilenen dosyalar

- engine/actions.ts
- engine/war.ts
- engine/battle.ts
- server/war-desk.ts
- app/api/general/route.ts
- app/api/war/route.ts
- components/KingdomGame.tsx
- components/WarCampaignWorkspace.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0012_war_sally.sql
- drizzle/pg/0013_war_peace_offer.sql
- docker-compose.yml
- docker-compose.prod.yml
- deploy/LINUX.md
- docs/plans/2026-08-25-asker-ve-birebir-savas-sistemi.md
- docs/audits/2026-11-06-sefer-ve-yayin-dogrulama.md
- tests/general-world-actions.test.ts
- tests/istihbarat-tab.test.ts
- tests/march.test.ts

## Test durumu

- `npm test` — 646 geçti, 0 başarısız.
- `npx tsc --noEmit` — başarılı.
- `npm run lint` — 0 hata; KingdomGame içindeki mevcut React Hook bağımlılık uyarısı devam ediyor.
- `npm run build` — başarılı.
- `DOMAIN=example.invalid docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tls.yml config --quiet` — başarılı.
