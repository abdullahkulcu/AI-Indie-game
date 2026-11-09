# Savunma takviyesi

Tarih: 2026-11-06

## Ne değişti

Savunan Kral, yaklaşan seferin uyarısını aldıktan sonra eğitimini tamamlayan yeni birlikleri Savunma Hattı'na ekleyebiliyor. İlk ilan anındaki garnizon zaten savunma kaydına alınmış olduğundan yalnız sonradan yetişen ek birlikler seçilebiliyor; aynı asker iki kez eklenemiyor. Takviye ayrıntısı saldırana anında değil, saha haberiyle görünür oluyor.

## Neden

Savunan tarafın saldırı uyarısından sonra nöbet, savunma yaklaşımı ve takviye bileşimini değiştirebilmesi savaş planının açık bir gereksinimiydi. Önceki kayıtta savunma birlikleri ilan anında donuyor, hazırlık süresinde biten eğitimler fiilen savaşa katılamıyordu.

## Etkilenen dosyalar

- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- tests/war-command.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/march.test.ts tests/battle.test.ts tests/siege.test.ts tests/war-command.test.ts tests/war-support.test.ts tests/war-king-command.test.ts tests/war-populace.test.ts tests/war-reporting.test.ts` geçti: 28/28.
