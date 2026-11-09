# Halkın Ferman ile Fiilî Pay Arasındaki Sesi

Tarih: 2026-11-07

## Ne değişti

Halkın sesi artık fermanla ilan edilen yiyecek/maaş istihkakı ile fiilen dağıtılabilen pay arasındaki büyük farkı ayrı bir talep olarak görünür kılıyor. Yiyecek eksik ulaşıyorsa halk, maaş eksik ulaşıyorsa garnizon Kralın verdiği sözün tutulmasını ister.

## Neden

Bir istihkakı kâğıt üzerinde %100'e çekmek, ambar veya hazine yetersizse sonucu garanti etmez. Bu fark daha önce yalnızca sayısal etkide kalıyor, halkın anlatısına girmiyordu.

## Etkilenen dosyalar

- engine/populace-voice.ts
- components/KingdomGame.tsx
- app/api/general/route.ts
- tests/populace-voice.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

- `npx tsc --noEmit && node --import tsx --test tests/populace-voice.test.ts` — başarılı (40 test)
