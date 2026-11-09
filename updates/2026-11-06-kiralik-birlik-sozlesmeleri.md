# Kiralık birlik sözleşmeleri

Tarih: 2026-11-06

## Ne değişti

Müzakereye `kiralık birlik` konusu eklendi. İmza anında taraflar asker sayısını,
peşin altın bedelini, kiralayan tarafı ve süreyi belirliyor; sözleşme iki
krallığın kaydıyla aynı işlemde yazılıyor. Kiralık Birlik ayrı bir birlik
türü olarak garnizon, akın, abluka ve sefer hesaplarına katılıyor; kışlada
eğitilemiyor. Süre sonunda sağ kalan birlikler kiralayanın nüfusuna döner;
kiracı aktif seferdeyse dönüş sefer bitene ertelenir.

## Neden

Plan belgesindeki Fikir 20, zengin fakat az nüfuslu bir krallığın ekonomik
gücünü başka bir krallığın askerî kapasitesine çevirebilmesini istiyordu.
Kayıpların kiralayan krallığa ait kalması ve tek aktif kiracı sözleşmesi,
bu gücün ücretsiz ve izlenemez bir kalkana dönüşmesini engeller.

## Etkilenen dosyalar

- engine/units.ts
- engine/actions.ts
- engine/negotiation.ts
- db/schema.ts
- drizzle/pg/0023_mercenary_contracts.sql
- drizzle/pg/meta/_journal.json
- app/api/negotiate/route.ts
- app/api/cron/route.ts
- app/api/general/route.ts
- server/negotiation-brief.ts
- server/general-negotiation-guard.ts
- components/KingdomGame.tsx
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/units.test.ts
- tests/negotiation.test.ts
- tests/general-negotiation-guard.test.ts

## Test durumu

- `npx tsc --noEmit` geçti.
- Hedefli müzakere, birlik, savaş ve abluka testleri geçti (93 test).
- `npm test -- --test-reporter=dot` geçti (664 test).
- `npm run build` geçti.
- `npm run lint` sıfır hata ile geçti; `components/KingdomGame.tsx` içindeki
  önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- `git diff --check` geçti.

## Takip gereken işler

- `0022_war_blockade.sql` ve bu değişikliğin `0023_mercenary_contracts.sql`
  göçleri yerel veritabanına henüz uygulanmadı. Kullanıcının açık onayıyla
  normal migration akışı üzerinden uygulanmalı.
