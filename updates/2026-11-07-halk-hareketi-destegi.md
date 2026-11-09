# Halk Hareketi Desteği

Tarih: 2026-11-07

## Ne değişti

Dolaylı Mücadele'deki pasif “Halk hareketlerini destekleme” kartı çalışır bir siyasi operasyona dönüştürüldü. Hedefte zaten kıpırdayan bir muhalefet yoksa gönderilemez; varsa propaganda hattından daha pahalı, ayrı kayda geçen ve biraz daha güçlü bir destek etkisi bırakır.

## Neden

Kart kullanıcıya sunulmasına rağmen oyun motorunda karşılığı yoktu. Yeni hat yoktan isyan üretmez ve mevcut muhalefeti hedef alır; bu yüzden propaganda ile aynı düğmenin farklı adı değildir.

## Etkilenen dosyalar

- engine/agitation.ts
- db/schema.ts
- server/agitation-desk.ts
- app/api/world/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- tests/agitation.test.ts

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/agitation.test.ts tests/faction.test.ts tests/propaganda-narrator.test.ts` başarılı (68 test).
