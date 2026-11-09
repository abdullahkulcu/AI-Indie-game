# Channel geneli dünya olayları

Tarih: 2026-11-06

## Ne değişti

Channel kimliğine bağlı, deterministik dünya olayları eklendi. Bereketli Hasat,
Ilıman Mevsim, Kuraklık ve Sert Kış aynı channel'daki tüm krallıklara aynı
zamanda gelir; arazi ile Ambar/Değirmen/Depo hazırlığı üretime olan gerçek
etkiyi değiştirir. Diyar Haritası yaklaşan veya sürmekte olan olayı gösterir;
General, Divan ve gece vardiyası aynı kısa bağlamı görür.

## Neden

Dünya yalnızca Kralın veya komşuların komutlarından ibaret kalmamalıydı.
Olayları yalnız metin olarak değil, üretim döngüsüne ve Defter'e bağlı kurmak;
erken General uyarısını oyuncunun hazırlanabileceği gerçek bir karara çevirdi.

## Etkilenen dosyalar

- engine/world-events.ts
- engine/tick.ts
- engine/market.ts
- components/KingdomGame.tsx
- components/ChannelWorldMap.tsx
- app/world-map.css
- app/api/general/route.ts
- server/council-advisors.ts
- server/council-briefing.ts
- server/night-shift.ts
- package.json
- tests/world-events.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/world-events.test.ts tests/engine.test.ts tests/council-advisors.test.ts tests/night-shift.test.ts` başarılı: 77 test geçti.
- `npm test -- --test-reporter=dot` başarılı: 670 test geçti.
- `npm run build` başarılı.
- `npm run lint` hata vermeden tamamlandı; daha önce de bulunan tek
  `react-hooks/exhaustive-deps` uyarısı sürüyor.
