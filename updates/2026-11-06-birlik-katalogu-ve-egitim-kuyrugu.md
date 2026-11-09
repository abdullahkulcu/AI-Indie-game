# Birlik Kataloğu ve Ayrı Eğitim Kuyruğu

Tarih: 2026-11-06

## Ne değişti

Beş birlik türü (Mızrakçı, Kılıçlı, Okçu, Süvari ve Kuşatma Ekibi) tek bir katalogda tanımlandı. Birliklerin insan gücü, kuruluş maliyeti, eğitim süresi, saatlik altın/yiyecek bakımı, saldırı, savunma, hız ve kuşatma değeri buradan okunuyor.

Kışla eğitimi artık inşaat kuyruğundan ayrı ilerliyor; bir yapı yükselirken asker eğitimi de sürebiliyor. Ordu ekranı birlik kartlarını, Kışla seviye kilitlerini, canlı bakım yükünü ve etkin eğitimi gösteriyor. General ile gece vardiyasının araç şemaları da yeni birlikleri tanıyor.

## Neden

Sefer ve birebir savaş sisteminin güvenilir bir ekonomik tabana ihtiyacı var. Birlik türleri, nüfus yükleri ve bakım giderleri birden fazla yerde yazılırsa savaş sonucu, ekran ve General önerileri birbirinden sapar. Bu faz yalnızca birlik ekonomisini ve eğitimi tamamlar; oyuncular arası sefer/savaş bundan sonraki fazdır.

## Etkilenen dosyalar

- engine/units.ts
- engine/types.ts
- engine/actions.ts
- engine/tick.ts
- engine/populace.ts
- engine/raids.ts
- engine/founding.ts
- server/save-validation.ts
- server/general-risk.ts
- server/night-shift.ts
- app/api/general/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- app/globals.css
- tests/units.test.ts

## Test durumu

- `node --import tsx --test tests/units.test.ts tests/engine.test.ts tests/raids.test.ts tests/save-validation.test.ts tests/general-risk.test.ts` — 127/127 geçti.
- Hedefli ESLint kontrolü geçti.
- `npx tsc --noEmit` geçti.
- `git diff --check` geçti.

## Takip gereken işler

- Faz B: sunucu sahipli sefer kaydı, harita rotası, toplanma/gidiş/dönüş ve savunma doktrini.
- Faz C: deterministik üç safhalı savaş çözümü ve savaş raporu.
