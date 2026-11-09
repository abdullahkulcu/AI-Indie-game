# Sefer haberci raporları

Tarih: 2026-11-06

## Ne değişti

Saha savaşı, kuşatma sonucu ve huruç artık Krala gerçekleştiği anda ayrıntılı
olarak görünmüyor. Her iki tarafa da yol mesafesinden hesaplanan bir haberci
varış zamanı atanıyor; Sefer Masası bu sürede yalnızca “haberci bekleniyor”
durumunu gösteriyor. Savaş puanı ve barış şartı seçeneği de haber gelmeden
gizleniyor.

## Neden

Kral savaş alanında değilken muharebenin sonucunu anında bilemez. Bu gecikme,
seferin belirsizliğini görünür kılar ve raporların oyun kararına gerçek bir
anlam katmasını sağlar.

## Etkilenen dosyalar

- engine/march.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- db/schema.ts
- drizzle/pg/0015_war_courier_reports.sql
- docs/VERITABANI-SOZLUGU.md
- tests/march.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 13/13 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içinde önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- Yerel PostgreSQL'e `visible_at` ve `available_at` alanları ile teslimat indeksi uygulandı.
