# Halkın Savaştaki Özerk Tepkisi

Tarih: 2026-11-07

## Ne değişti

Savunan halkın savaş tepkisi artık yalnız anlatı veya moral satırı değildir. Yüksek rıza ve dolu ambar mahalle savunmasını başlatır, savunmanın geri çekilme eşiğini %40'a indirir; kırılgan şehirde ailelerin barış heyeti eşiği %60'a çıkarır; ara durumda mahalle nöbeti standart %50 eşiğini korur. Sefer Masası savunan oyuncuya halkın hangi kendiliğinden eylemi yaptığını ve bu eylemin savunma çizgisine etkisini gösterir.

## Neden

Savaş sunumu halkın doğrudan komut almadan mahalle savunması, barış baskısı veya nöbet örgütlemesini öngörüyor. Önceki hâlde bu tavır yalnız başlangıç morali değiştiriyor, savaşın kararlarına yön vermiyordu.

## Etkilenen dosyalar

- engine/war-populace.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- tests/war-populace.test.ts

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/war-populace.test.ts tests/war-command.test.ts` başarılı: 9 test geçti.
