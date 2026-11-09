# Gece Vardiyası: Defter ve Çoklu Hamle

Tarih: 2026-11-07

## Ne değişti

Gece vardiyasının başarılı biçimde uyguladığı emirler artık General'in kalıcı defterine de işleniyor. Çevrimdışı başlatılan şenlik, eğitim veya inşa emri; bulut kaydı başarıyla yazıldıktan sonra, Kral çevrimiçiyken kullanılan aynı defter kurallarıyla değerlendirilir.

Kalıcı emir artık Kralın açıkça istediği durumda uyanış başına bir, iki veya üç hamlelik plan taşıyabilir. General tek sağlayıcı çağrısında sıralı plan üretir; yalnız güvenli gece araçları kabul edilir, günlük tavan kalan hamle sayısını sınırlar ve yalnız başarıyla uygulanan eylemler sayaç ile deftere girer. Onay bekleyen emirde ise Kralın önüne her zaman tek somut hamle konur.

## Neden

General gece vardiyasında krallık adına karar almasına rağmen ertesi gün kendi hafızasında bu hamlelerin hiçbir izi yoktu. Bu, General'in Kral'a geçmiş davranışlar hakkında eksik ve tutarsız konuşmasına yol açıyordu. Ayrıca veritabanındaki `max_actions_per_wake` alanı hiç okunmadığı için iki veya üç hamlelik bir yetki, ayarlanmış görünse bile fiilen çalışmıyordu.

## Etkilenen dosyalar

- server/night-shift.ts
- app/api/cron/route.ts
- app/api/general/route.ts
- tests/night-shift.test.ts
- docs/plans/2026-08-22-acik-backlog-maddeleri.md

## Test durumu

- `npx tsc --noEmit && node --import tsx --test tests/night-shift.test.ts tests/ledger.test.ts` — başarılı (40 test)
- `npm test` — başarılı (732 test)
- `npm run build` — başarılı (mevcut büyük istemci paketi uyarısı dışında)
