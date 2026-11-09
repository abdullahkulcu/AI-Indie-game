# AI rehber dosyaları

Tarih: 2026-08-26

## Ne değişti

General, Halk Meclisi ve Garnizon için ayrı rehber dosyaları; hepsinin ortak güvenlik ve üslup kurallarını taşıyan bir ana rehber eklendi. Rehber birleştiricisi, General sohbeti, Divan, Halk anlatımı, gece vardiyası ve çevrimdışı müzakere yollarının sistem mesajına rolüne uygun rehberi ekliyor. Workers ortamında dosya sistemi olmadığından rehberler ayrı TypeScript metin modülleri olarak derleme anında uygulamaya katılıyor.

## Neden

Rol kurallarının dağınık prompt metinlerinde kaybolmasını önlemek ve her LLM çağrısının aynı temel oyun davranışını görmesini sağlamak için tek kaynaklı, düzenlenebilir rehber dosyaları gerekliydi.

## Etkilenen dosyalar

- ai-guides/ortak-kurallar.ts
- ai-guides/general.ts
- ai-guides/halk.ts
- ai-guides/garnizon.ts
- server/ai-guides.ts
- app/api/general/route.ts
- app/api/cron/route.ts
- server/council-advisors.ts
- server/populace-narrator.ts
- tests/council-advisors.test.ts

## Test durumu

- `npm test -- --test-name-pattern='AI çağrısı|Divan metni|Halk ve garnizon'` geçti (628 test).
- `npm run build` geçti.
