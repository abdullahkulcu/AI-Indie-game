# Geri çekilen ordu takibi

Tarih: 2026-11-06

## Ne değişti

Savunan Kral, geri dönen saldırı ordusuna bir kez takip emri verebilir. Süvari yoğunluğu takipteki ek kaybı artırır, takip eden garnizon da sınırlı karşı kayıp riski taşır. Emir veritabanındaki tek `pursuit_at` damgasıyla korunur; iki sekme veya iki istek aynı takip kaybını ikinci kez yazamaz.

## Neden

Savaş planındaki savunanın geri çekilen orduya sınırlı takip fırsatı önce eksikti. Bu hamle, başarılı savunmanın yalnız saldırıyı durdurmakla kalmayıp saldıranın güvenli dönüşünü de riske atmasını sağlar; fakat tek kullanımlık ve tavanlı olduğu için kaybedeni silen bir zincire dönüşmez.

## Etkilenen dosyalar

- engine/war.ts
- db/schema.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- drizzle/pg/0021_war_pursuit.sql
- drizzle/pg/meta/_journal.json
- tests/march.test.ts

## Test durumu

- Yerel geliştirme veritabanına `0021_war_pursuit` uygulandı.
- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/march.test.ts tests/war-command.test.ts tests/war-king-command.test.ts tests/war-reporting.test.ts` geçti: 15/15.
