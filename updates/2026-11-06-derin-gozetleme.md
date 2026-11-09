# Derin gözetleme ajan görevi

Tarih: 2026-11-06

## Ne değişti

Normal keşiften ayrı bir `deep_observation` ajan görevi eklendi. Görev 100
altın harcar, iki kat yol süresi kullanır ve daha düşük başarı/yüksek açığa
çıkma ihtimali taşır; başarılı rapor yalnızca hedef halkın kaba ruh hâli
etiketini normal açık istihbarata ekler.

## Neden

Kral hedefteki toplumsal kırılganlığı stratejik olarak değerlendirebilsin,
ama karşı tarafın kesin rıza değeri, ambarı, maaşı veya nöbet düzeni gizli
kalsın istendi. Ayrı görev, bu bilgi avantajının risksiz normal keşfe
dönüşmesini engeller.

## Etkilenen dosyalar

- engine/intelligence.ts
- server/world-projection.ts
- app/api/world/route.ts
- db/schema.ts
- drizzle/pg/0024_deep_intel_observation.sql
- drizzle/pg/meta/_journal.json
- components/KingdomGame.tsx
- components/ChannelWorldMap.tsx
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- docs/VERITABANI-SOZLUGU.md
- tests/intelligence.test.ts
- tests/istihbarat-tab.test.ts
- package.json

## Test durumu

- Hedefli istihbarat, dünya projeksiyonu ve arayüz taşıma testleri başarılı:
  22 test geçti.
- `npx tsc --noEmit` başarılı.
- `npm test -- --test-reporter=dot` başarılı: 673 test geçti.
- `npm run build` başarılı.
- `npm run lint` hata vermeden tamamlandı; bu değişiklikten önce de bulunan
  tek `react-hooks/exhaustive-deps` uyarısı sürüyor.

## Takip gereken işler

- `0024_deep_intel_observation.sql` hazırlık migration'ıdır; canlı veritabanına
  uygulanması ayrıca onay gerektirir.
