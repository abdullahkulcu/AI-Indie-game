# Kuşatma erzak tüketimi

Tarih: 2026-11-06

## Ne değişti

Kuşatma artık altı oyun saatlik sabit süresi boyunca saldıran ordunun ve
garnizonun yiyecek tüketimini hesaplıyor. Saldıranın kalan ikmali kuşatma
baskısını, savunanın şehir ve garnizon erzağı ise tahkimat direncini etkiliyor.
Kuşatma bitince iki tarafın gerçek tüketimi ilgili savaş raporuna ve savunanın
defterine yazılıyor.

## Neden

Kuşatma yalnız bir süre sayacı olmamalıdır. İkmal planı, dış konvoylar ve
şehir ambarı savaş sonucunu değiştirmelidir; hesap ayrıca cron sıklığına bağlı
olmamalıdır.

## Etkilenen dosyalar

- engine/siege.ts
- server/war-desk.ts
- tests/siege.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/siege.test.ts tests/war-command.test.ts tests/war-support.test.ts tests/war-king-command.test.ts tests/war-populace.test.ts tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 26/26 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içindeki önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
