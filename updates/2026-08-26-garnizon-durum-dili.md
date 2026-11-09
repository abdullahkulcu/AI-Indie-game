# Garnizon durum dili

Tarih: 2026-08-26

## Ne değişti

Garnizon ekranındaki belirsiz `yürür` durumu `UYGULANABİLİR` olarak değiştirildi. Sakin kışla açıklaması da emirlerin uygulanabilir olduğunu açıkça ifade ediyor.

## Neden

`Yürür` hukuk dili gibi algılanıyor ve oyuncuya bir emrin gerçekten uygulanıp uygulanamayacağını yeterince net anlatmıyordu.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- engine/populace-voice.ts

## Test durumu

- `node --import tsx --test tests/populace-voice.test.ts` geçti (40 test).
