# Eşzamansız sefer, saha savaşı ve kuşatma

Tarih: 2026-11-06

## Ne değişti

Seferlerin sunucuya ait kalıcı savaş kayıtları eklendi. Keşfedilmiş hedefe birlik, erzak, yaklaşım ve geri çekilme eşiğiyle sefer planlanabiliyor; birlikler garnizondan ayrılıyor, yürüyüş ve dönüş cron ile ilerliyor. Üç safhalı deterministik saha savaşı, kuşatma sonucu, kayıp/ganimet dönüşü ve savunma doktrini eklendi. Diyar haritasındaki keşfedilmiş krallıktan Sefer Masası açılabiliyor.

Linux yayını için sır üretimi, HTTPS, sağlık kontrolü, yedek/geri yükleme ve yükseltme adımlarını kapsayan bir kurulum rehberi de eklendi.

## Neden

Asker türleri yalnızca eğitim ekranında kalmamalı; gerçek bir seferde ikmal, arazi, karşı birlik, moral ve zaman riski taşımalıydı. Savaşın istemci kaydına yazılması aynı birliğin iki kez kullanılmasına veya sonuçların yenilemeyle değişmesine yol açacağından ortak durum veritabanında, sonuç çözücüsü saf motorda tutuldu.

## Etkilenen dosyalar

- engine/march.ts
- engine/battle.ts
- engine/siege.ts
- engine/war.ts
- server/war-desk.ts
- app/api/war/route.ts
- app/api/cron/route.ts
- db/schema.ts
- drizzle/pg/0010_wars.sql
- drizzle/pg/0011_war_siege.sql
- components/WarCampaignWorkspace.tsx
- components/ChannelWorldMap.tsx
- components/KingdomGame.tsx
- deploy/LINUX.md
- deploy/TLS.md
- README.md
- docs/plans/2026-08-25-asker-ve-birebir-savas-sistemi.md

## Test durumu

- `npm test` — 643 test geçti.
- `npx tsc --noEmit` — geçti.
- `npm run lint` — hata yok; KingdomGame içindeki önceden var olan tek React hook bağımlılığı uyarısı sürüyor.
- `npm run build` — derleme komutu tamamlandı.
- `git diff --check` — geçti.

## Takip gereken işler

- Generalin doğal dildeki sefer önerisini Sefer Masası'na yapılandırılmış taslak olarak düşürmek.
- Birden fazla bağımsız cephe açılacaksa garnizon rezervlerini ayrı bir sürümde modellemek.
