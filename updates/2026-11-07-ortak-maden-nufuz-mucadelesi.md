# Ortak madende nüfuz mücadelesi

Tarih: 2026-11-07

## Ne değişti

Ortak maden için 24 üretim oyun-saatlik bir nüfuz penceresi eklendi. Pencerede en çok işçi-emeği biriktiren krallık, sonraki pencerede etkin rakip üretiminin %10'unu alır; toplam cevher sabit kalır. Maden paneli sahiplik ve pencere ilerlemesini gösterir.

## Neden

Maden yalnızca herkesin kendi payını aldığı pasif bir üretim alanıydı. Kabul edilen tasarım, nüfus yoğunluğunu uzun vadeli ama anlık işçi oynatmayla istismar edilemeyen stratejik bir rekabete dönüştürür.

## Etkilenen dosyalar

- engine/mine.ts
- db/schema.ts
- drizzle/pg/0035_shared_mine_influence.sql
- drizzle/pg/meta/_journal.json
- app/api/mine/route.ts
- components/KingdomGame.tsx
- app/globals.css
- tests/mine.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/mine.test.ts tests/mine-roster.test.ts` başarılı (19 test).
- `npm run build` başarılı.
- `git diff --check` başarılı.
