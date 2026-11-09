# Birlik deneyimi ve garnizon gücü

Tarih: 2026-11-06

## Ne değişti

Akınları başarıyla püskürten nöbetteki birlikler artık tür bazında saha deneyimi kazanıyor. Deneyim doğrudan garnizon savunmasına ölçülü bir katkı veriyor; yeni eğitimli askerler ortalamayı seyreltirken kayıp verilen birliklerin deneyimi de onlarla birlikte kayboluyor. Ordu ekranında toplam ve tür başına saha deneyimi gösteriliyor.

## Neden

Kabul edilen askerî tasarımda savunma başarısının kalıcı bir askerî sonucu olması, fakat deneyimin bedelsiz ya da istemciden değiştirilebilir olmaması isteniyordu. Bu değişiklik, deneyimli garnizonun anlamlılaşmasını sağlar ve yeni asker eğitimini tek başına bedelsiz güç artışı olmaktan çıkarır.

## Etkilenen dosyalar

- engine/types.ts
- engine/units.ts
- engine/raids.ts
- engine/tick.ts
- engine/founding.ts
- server/save-validation.ts
- components/KingdomGame.tsx
- tests/units.test.ts
- tests/raids.test.ts
- tests/save-validation.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/units.test.ts tests/raids.test.ts tests/save-validation.test.ts` geçti (67 test).
- `npm run lint` geçti; önceden var olan `KingdomGame.tsx` React Hook bağımlılık uyarısı sürüyor, hata yok.
