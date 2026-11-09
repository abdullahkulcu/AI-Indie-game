# Savunanın savaş hasarı

Tarih: 2026-11-07

## Ne değişti

Saha savaşı ya da kuşatma sonrasında savunan krallığa kaybın büyüklüğüne göre süreli üretim aksaması eklendi. Etki yalnızca süresi boyunca üretimi düşürür, Halk ekranında kalan toparlanma süresiyle ve savunanın savaş raporunda görünür; süresi bittiğinde motor tarafından kaldırılır. Kayıt doğrulayıcı bu alanı sunucu-türevi kabul ettiği için istemci kendi cezasını silemez.

## Neden

Savaş planında savunan tarafın asker ve ganimet kaybının yanında şehir ekonomisi ile halkın günlük hayatına da yansıması gerekiyordu. Önceden bu sonuç yalnız metinde kalıyordu.

## Etkilenen dosyalar

- engine/types.ts
- engine/tick.ts
- engine/war-populace.ts
- server/war-desk.ts
- server/save-validation.ts
- components/KingdomGame.tsx
- tests/engine.test.ts
- tests/war-populace.test.ts
- tests/save-validation.test.ts
- tests/war-reporting.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `npm test` geçti: 727 test.
- `npm run build` geçti. Yalnız mevcut istemci parça boyutu uyarısı sürüyor.
