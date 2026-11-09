# Meclis sorusu ve müzakere bağlamı ayrımı

Tarih: 2026-08-26

## Ne değişti

General'e yöneltilen Meclis/Divan soruları ayrı bir niyet olarak tanımlandı. Bu sorularda açık müzakere masalarının özeti ve yazışmaları General bağlamından çıkarılıyor; mevcut Halk, Garnizon ve General görüşleri sınırları belli bir veri bloğunda gönderiliyor.

## Neden

General, "Divandaki üç görüşü karşılaştır" sorusuna açık bir müzakere masasının haraç veya karşı teklif ayrıntılarıyla cevap veriyordu. Meclis sorusu artık yalnızca Divan görüşlerini, krallık durumunu ve uygulanabilir yönetim kararlarını kapsar.

## Etkilenen dosyalar

- app/api/general/route.ts
- server/general-council-context.ts
- tests/general-council-context.test.ts

## Test durumu

- `node --import tsx --test tests/general-council-context.test.ts tests/general-negotiation-guard.test.ts`: başarılı (8/8)
- `npx eslint app/api/general/route.ts server/general-council-context.ts tests/general-council-context.test.ts`: başarılı
