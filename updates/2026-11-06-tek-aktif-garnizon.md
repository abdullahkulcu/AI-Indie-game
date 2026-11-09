# Tek aktif garnizon

Tarih: 2026-11-06

## Ne değişti

Sefer ilanı denetimi artık oyuncunun yalnız saldıran değil savunan olduğu etkin savaşları da kontrol ediyor. Savunmadaki bir Krallık, aynı garnizondaki birlikleri ikinci bir saldırı seferine ayıramaz.

## Neden

Önceki sorgu sadece `attackerId` alanını denetliyordu. Bir Krallık savunma savaşı içindeyken başka bir hedefe saldırı başlatabilirdi; iki savaş aynı askerleri bağımsız kuvvet gibi kullanırdı.

## Etkilenen dosyalar

- app/api/war/route.ts
- tests/war-command.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/war-command.test.ts tests/march.test.ts tests/war-reporting.test.ts` geçti: 15/15.
