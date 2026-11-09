# Süresi dolan müzakere masaları

Tarih: 2026-11-07

## Ne değişti

Divan ritminde süresi geçen açık veya imza bekleyen müzakere masaları artık
kalıcı olarak `expired` durumuna geçiriliyor. Cron yanıtı kaç masanın bu
şekilde kapandığını da bildiriyor.

## Neden

Önceden süre kontrolü yalnızca ekran ve konuşma kuralında yapılıyordu; satır
veritabanında açık kalıyordu. Bu hem ölü kayıt biriktiriyor hem de Generalin
gecikmiş masayı değerlendirme ihtimalini doğuruyordu.

## Etkilenen dosyalar

- app/api/cron/route.ts
- tests/negotiation.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/negotiation.test.ts` — geçti.
