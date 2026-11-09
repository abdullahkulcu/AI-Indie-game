# Kralın sefer komutası

Tarih: 2026-11-06

## Ne değişti

Sefer planına “General komuta eder” ve “Kral cephede komuta eder” seçeneği
eklendi. Kral cephedeyse ilk saha savaşında sabit moral desteği verir ve kendi
tarafının saha raporu haberci beklemeden görünür. Kralın yokluğu 24 oyun
saatini geçerse, dönüşte başkentin rızasına süreyle orantılı siyasi maliyet
uygulanır.

## Neden

Kralın savaşta bulunması yalnız rol yapma tercihi olmamalıdır. Oyuncu haber
kalitesi ve komuta gücü karşılığında başkentin uzun süre ihmal edilmesi riskini
bilinçli biçimde seçebilmelidir.

## Etkilenen dosyalar

- engine/war.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- db/schema.ts
- drizzle/pg/0017_war_king_command.sql
- docs/VERITABANI-SOZLUGU.md
- tests/war-king-command.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/war-king-command.test.ts tests/war-populace.test.ts tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 19/19 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içindeki önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- Yerel PostgreSQL'e `king_leads` alanı uygulandı.
