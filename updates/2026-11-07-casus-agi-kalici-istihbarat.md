# Kalıcı casus ağı

Tarih: 2026-11-07

## Ne değişti

Başarıyla keşfedilmiş bir sancakta 300 altın karşılığında Casus Ağı kurulabiliyor. Ağ önce yerleşiyor, sonra her 12 oyun saatinde kamuya açık istihbarat raporunu yeniliyor; sonuçlar Kralın Defter'ine yazılıyor. Hedef yalnızca şüpheli faaliyeti görür; karşı-istihbarat nöbeti ağın yerleşmesi veya rapor turunda açıksa gönderen ve operasyon açığa çıkar.

## Neden

Mockup'ta planlı kalan casus ağı seçeneğinin gerçek bir oyun etkisi yoktu. Bu değişiklik, ekran açılmasına bağlı olmayan ve gizli ambar/maaş bilgisi sızdırmayan kalıcı istihbarat döngüsünü ekler.

## Etkilenen dosyalar

- engine/intelligence.ts
- db/schema.ts
- drizzle/pg/0034_spy_networks.sql
- drizzle/pg/meta/_journal.json
- app/api/world/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- tests/intelligence.test.ts
- tests/istihbarat-tab.test.ts
- docs/ARCHITECTURE.md
- docs/VERITABANI-SOZLUGU.md

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/intelligence.test.ts tests/istihbarat-tab.test.ts` başarılı (20 test).
- `npm run build` başarılı.
- `git diff --check` başarılı.
