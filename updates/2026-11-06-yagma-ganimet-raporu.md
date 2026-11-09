# Yağma ganimet raporu

Tarih: 2026-11-06

## Ne değişti

Başarılı yağma, artık saha raporunda ele geçirilen altın ve yiyecek miktarını
gösteriyor. Sefer döndüğünde saldıran Kralın raporu, kalan erzakla birlikte
ambara giren ganimeti de açıkça yazıyor; savunan tarafa ise sınır acil
durumunun sona erdiği bildiriliyor.

## Neden

Ganimet gerçekte hesaplanıp ambara eklenmesine rağmen genel dönüş metni bunu
söylemiyordu. Oyuncu ödülün alınmadığını sanıyordu.

## Etkilenen dosyalar

- server/war-desk.ts
- tests/war-reporting.test.ts

## Test durumu

- `node --import tsx --test tests/war-reporting.test.ts tests/battle.test.ts` — 6/6 geçti.
- `npx tsc --noEmit` — geçti.
