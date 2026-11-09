# Günlük Divan ve Açık Gündem Baskısı

Tarih: 2026-11-07

## Ne değişti

Divan çevrimi artık channel hızına göre 24 oyun saati sürüyor. Kral açık Halk veya Garnizon gündemini bu çevrimde kapatmazsa, sonraki Divan üretilirken muhalefet baskısı mevcut rıza sorununa göre az miktarda hızlanıyor ve bu durum deftere yazılıyor.

## Neden

Divan'ın yalnızca okunacak bir rapor değil, yaşayan krallığın önceliklerini takip eden bir karar ritmi olması gerekiyordu. Ceza, kaynak silmek ya da rızası düzelmiş krallığı yeniden kötüleştirmek yerine yalnız mevcut toplumsal baskıyı ilerletir.

## Etkilenen dosyalar

- engine/faction.ts
- engine/game-time.ts
- server/council-schedule.ts
- server/council-briefing.ts
- server/night-shift.ts
- app/api/cron/route.ts
- docs/ARCHITECTURE.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/faction.test.ts
- tests/council-advisors.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- Hedefli Divan, muhalefet ve gece vardiyası testleri geçti.
- `npm test` başarılı (692 test).
- `npm run lint` sıfır hata ile tamamlandı; daha önceden var olan tek Hook bağımlılığı uyarısı sürüyor.
- `npm run build` başarılı.
