# Savunma zaferi itibarı

Tarih: 2026-11-06

## Ne değişti

Sınır savaşında saldırıyı püskürten veya huruçla kuşatma hattını yaran savunan Krallık 3 itibar kazanıyor. Kural 100 puan tavanında kalıyor ve sonuç bildirimi bu kazanımı açıkça belirtiyor.

## Neden

Savaş planı püskürtülen saldırının savunana savaş puanı ile itibar katkısı vermesini istiyordu. Önceki akış savaş puanını değiştiriyor, ancak kalıcı `reputation` alanına hiçbir etkide bulunmuyordu.

## Etkilenen dosyalar

- engine/war.ts
- server/war-desk.ts
- tests/march.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/march.test.ts tests/battle.test.ts tests/siege.test.ts tests/war-command.test.ts tests/war-king-command.test.ts tests/war-reporting.test.ts` geçti: 26/26.
