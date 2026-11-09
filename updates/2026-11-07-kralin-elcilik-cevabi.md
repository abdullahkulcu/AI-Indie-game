# Kralın Elçilik cevabı

Tarih: 2026-11-07

## Ne değişti

Açık Elçilik masalarına Kralın kendi sözüyle cevap yazabileceği alan eklendi.
Mesaj, General değil Kral kimliğiyle yazılır; konuşma hakkı ve mesaj uzunluğu
sunucunun kullandığı müzakere kurallarından okunur.

## Neden

Sunucu `reply` emrinde Kralın mesajını zaten destekliyor, ancak arayüz yalnız
Generalin araç çağrısıyla cevap yazabiliyordu. Bu, Kralın aktif bir masada
doğrudan diplomasi yürütmesini engelliyordu.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- app/globals.css
- tests/negotiation.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/negotiation.test.ts` — geçti.
