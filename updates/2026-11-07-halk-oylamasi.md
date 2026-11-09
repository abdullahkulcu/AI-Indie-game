# General Aracılığıyla Halk Oylaması

Tarih: 2026-11-07

## Ne değişti

General artık Kral açıkça vergi veya istihkak değişikliği için kamuoyu sorduğunda halk oylaması başlatabiliyor. Oylama sonucu Halk ekranında kalıcı olarak gösteriliyor; destek oranı krallığın ölçülen rıza, muhalefet, vergi ve istihkak durumundan hesaplanıyor. Halk-AI yalnız sonucu kısa bir dille açıklıyor, hiçbir politika kendiliğinden uygulanmıyor.

## Neden

Kralın halkın nabzını doğrudan ölçebilmesi isteniyordu; fakat modelin oyun sonucunu uydurmaması ve oylamanın zorunlu bir ferman hâline gelmemesi gerekiyordu. Haftalık oyun zamanı sınırı aynı sorunun tekrar tekrar sorulmasını önler.

## Etkilenen dosyalar

- engine/referendum.ts
- app/api/referendum/route.ts
- server/referendum-narrator.ts
- server/general-action-fallback.ts
- app/api/general/route.ts
- components/KingdomGame.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0028_referendums.sql
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/referendum.test.ts
- tests/general-world-actions.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- `npm test -- --test-reporter=dot` geçti: 685 test.
- `npm run lint` hata vermedi; `KingdomGame.tsx` içindeki önceden var olan Hook bağımlılık uyarısı sürüyor.
- `npm run build` geçti.
