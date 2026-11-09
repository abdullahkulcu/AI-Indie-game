# Sefer channel temposu

Tarih: 2026-11-06

## Ne değişti

Sefer rotası ve toplanma süreleri artık channel temposuna göre gerçek bir sefer takvimi kullanıyor. En uzun rota Hızlı Taç'ta bir gün, Sınır Boyu'nda iki gün, standart sezonda dört gün sürüyor. İkmal ihtiyacı ile kuşatma tüketimi aynı uzatılmış oyun zamanına bağlandı; Sefer Masası hem oyun saatini hem de takvimdeki tahmini süreyi gösteriyor.

## Neden

Önceki hesap en uzun rotayı standart sezonda en fazla bir güne sıkıştırıyordu. Bu, destek gönderme, haberci, geri çekilme ve Kralın cephede kalma kararları için yeterli bir zaman penceresi bırakmıyordu; ayrıca sefer uzasa bile ikmal hesabı kısa kalıyordu.

## Etkilenen dosyalar

- engine/march.ts
- server/war-desk.ts
- components/WarCampaignWorkspace.tsx
- tests/march.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/march.test.ts tests/siege.test.ts tests/battle.test.ts tests/war-command.test.ts tests/war-support.test.ts tests/war-king-command.test.ts tests/war-populace.test.ts tests/war-reporting.test.ts` geçti: 27/27.
