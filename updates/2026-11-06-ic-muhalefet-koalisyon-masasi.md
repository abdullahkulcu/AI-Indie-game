# İç muhalefet koalisyon masası

Tarih: 2026-11-06

## Ne değişti

Örgütlü iç muhalefet artık Halk ekranında koalisyon masası açabiliyor. Halk-AI
talebin kısa cümlesini üretirken, istenecek politika ile kabul/red sonucunun
etkisi `engine/faction.ts`te deterministik olarak tanımlandı. Saatlik tur aynı
talep için tekrar çağrı yapmaz; ret sayısı yükseldiğinde bir sonraki söz daha
sert yazılır.

## Neden

Muhalefetin daha önce tek çözümü rızanın kendiliğinden yükselmesiydi. Kralın
elebaşıyla doğrudan, anlaşılır ve gerçek politika sonucu doğuran bir karar
alanına ihtiyacı vardı; bunun LLM metninin oyun kurallarını değiştirmesine izin
vermeden kurulması gerekiyordu.

## Etkilenen dosyalar

- engine/faction.ts
- server/faction-coalition.ts
- server/faction-coalition-narrator.ts
- app/api/faction-coalition/route.ts
- app/api/cron/route.ts
- db/schema.ts
- drizzle/pg/0027_faction_coalitions.sql
- components/KingdomGame.tsx
- app/globals.css
- tests/faction.test.ts
- tests/populace-feed.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

`npx tsc --noEmit`, `npm test -- --test-reporter=dot` (681 test başarılı),
`npm run lint` (0 hata; KingdomGame'te mevcut Hook bağımlılığı uyarısı) ve
`npm run build` başarılı.

## Takip gereken işler

`0027_faction_coalitions.sql` diğer bekleyen şema değişiklikleriyle birlikte
canlı veritabanına uygulanmak için kullanıcı onayı bekler.
