# Halkın kamusal güncesi

Tarih: 2026-11-06

## Ne değişti

Halk sekmesine “Meydan Güncesi” eklendi. Cron, yalnızca konuşmaya değer bir durum olduğunda Halk-AI ile kısa bir atmosferik not üretip `populace_feed` tablosuna yazıyor; Kral bu notları salt-okunur olarak görüyor.

## Neden

Halkın yalnızca talep açtığında değil, gündelik hayatta da yaşayan bir topluluk gibi görünmesi gerekiyordu. Sistem, oyun sonucunu veya General kararlarını etkilemeden bu hissi verir.

## Etkilenen dosyalar

- engine/populace-feed.ts
- server/populace-feed.ts
- server/populace-feed-narrator.ts
- app/api/populace-feed/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0026_populace_feed.sql
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/populace-feed.test.ts

## Test durumu

`npx tsc --noEmit`, hedefli feed/anlatıcı testleri, `npm run lint`, tam `npm test` (678 test), `npm run build` ve `git diff --check` başarıyla çalıştı. Lint yalnızca daha önceden var olan `KingdomGame.tsx` Hook bağımlılığı uyarısını veriyor; hata yok.

## Takip gereken işler

- `0026_populace_feed` migration'ı henüz veritabanına uygulanmadı.
