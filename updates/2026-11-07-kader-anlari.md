# Divanda Kader anları

Tarih: 2026-11-07

## Ne değişti

Muhalefetin meydan okuması, düşük istihkak ve kışla huzursuzluğu için nadir Kader ikilemleri eklendi. Cron bu eşikleri yalnız bir kez kalıcı olay olarak açar; Divan kartında Kral ikilemi Generalle tartışabilir veya erteleyebilir.

## Neden

Kralın verdiği emirlere tepki veren sistemin yanında, oyunun büyük kırılmalarda kendi gündemini önermesi gerekiyordu. Bu kartlar otomatik karar vermez ve yeni bir model çağrısı başlatmaz; token maliyetini büyütmeden görünür bir karar anı yaratır.

## Etkilenen dosyalar

- engine/fate.ts
- server/fate-desk.ts
- app/api/fate/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0029_fate_events.sql
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/fate.test.ts

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/fate.test.ts tests/faction.test.ts tests/night-shift.test.ts tests/council-advisors.test.ts` başarılı (50 test).
- `npm test` başarılı (692 test); `npm run build` başarılı.

## Takip gereken işler

- `0029_fate_events.sql` uygulama ortamına migration akışıyla geçirilmelidir; bu görevde veritabanına doğrudan uygulanmadı.
