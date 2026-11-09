# Belirsiz emirlerde müzakere güvenlik kapısı

Tarih: 2026-08-26

## Ne değişti

Generalin müzakere araç çağrıları için sunucu tarafında ayrı bir niyet ve güncel masa doğrulaması eklendi. Belirsiz emirler artık masa açamaz veya mevcut masaya mesaj gönderemez; kapalı masa, olmayan sıra numarası ve hayali hedef de istemciye hata döndürmeden önce engellenir. General promptu da belirsiz emri müzakereye çevirmemesi için güncellendi. Önceki turdan kalmış, yanlış sınıflandırılmış bekleyen müzakere eylemi de Kralın kısa onayıyla yeniden çalıştırılmak yerine silinir.

## Neden

Model, genel bir emri zaman zaman müzakere cevabı olarak yorumluyor; kapalı masaya gönderilen bu istek oyuncuya "Bu masa kapandı" teknik hatası olarak görünüyordu. Müzakere ancak Kral açıkça bu niyeti belirttiğinde yürümeli.

## Etkilenen dosyalar

- app/api/general/route.ts
- server/general-negotiation-guard.ts
- tests/general-negotiation-guard.test.ts
- package.json

## Test durumu

- `npm test` geçti (624 test).
- `node --import tsx --test tests/general-negotiation-guard.test.ts tests/general-guard.test.ts tests/negotiation.test.ts` geçti (61 test).
- `npm run lint` geçti; önceden mevcut olan `components/KingdomGame.tsx` React Hook bağımlılık uyarısı sürüyor.
- `npx tsc --noEmit`, çalışma alanındaki mevcut bozuk bağımlılık tip klasörü adları (`eslint 2`, `node 2` vb.) nedeniyle başlamadan durdu.
