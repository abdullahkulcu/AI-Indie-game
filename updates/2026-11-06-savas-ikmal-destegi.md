# Savaş ikmal desteği

Tarih: 2026-11-06

## Ne değişti

Sefer Masası'na tarafsız krallıkların açık bir savaşa saldıran veya savunan
taraf adına yiyecek gönderebildiği ikmal desteği eklendi. Konvoylar zaman
harcar; aktif savaşa zamanında ulaşan destek ordunun erzağına eklenir ve
sınırlı moral kazandırır. Geç kalan konvoyun yükü savaş alanındaki yerel
ihtiyaç sahiplerine bırakılır ve destekçiye durum raporu gelir.

## Neden

Savaş, yalnız iki taraf arasında kapalı bir sayaç olmamalıdır. Uzak bir
krallığın yardım kararı, rota ve zaman riski taşımalı; hem savaş sonucunu hem
de daha sonraki diplomatik ilişkiyi görünür biçimde etkilemelidir.

## Etkilenen dosyalar

- engine/march.ts
- engine/war.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- db/schema.ts
- drizzle/pg/0018_war_support_convoys.sql
- docs/VERITABANI-SOZLUGU.md
- tests/war-support.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/war-support.test.ts tests/war-king-command.test.ts tests/war-populace.test.ts tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 21/21 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içindeki önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- Yerel PostgreSQL'e `war_supports` tablosu ve destek moral alanları uygulandı.
