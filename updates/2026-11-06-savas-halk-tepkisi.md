# Savaşta halk tepkisi

Tarih: 2026-11-06

## Ne değişti

Sınırda sefer ilan edildiğinde savunan krallığın halk durumu artık üç
deterministik tepki üretir: halk desteği, temkinli bekleyiş veya barış baskısı.
Bu tepki savunma moraline doğrudan girer ve savunan oyuncuya savaş defterinde
anlatılır. Saha savaşı ve kuşatma sonundaki asker/ganimet kaybı, savunanın
rızasını düşürüp iç baskısını artırır.

## Neden

Savaş yalnız birlik sayısı ve kaynak kaybı olmamalıdır. Halkın güveni,
ambarın dayanıklılığı ve mevcut iç baskı savunma kararını değiştirmeli; savaş
sonrası Divan'da hissedilir bir sonuç bırakmalıdır.

## Etkilenen dosyalar

- engine/war-populace.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- db/schema.ts
- drizzle/pg/0016_war_populace_response.sql
- docs/VERITABANI-SOZLUGU.md
- tests/war-populace.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/war-populace.test.ts tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 17/17 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içindeki önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- Yerel PostgreSQL'e savaş halk tepkisi alanları uygulandı.
