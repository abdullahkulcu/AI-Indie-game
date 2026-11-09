# Divan oturum tutanağı ve General yönetimi

Tarih: 2026-11-09

## Ne değişti

Divan artık tek seferlik üç görüşten oluşmuyor. Açılış sözlerinden sonra General oturumu yönetiyor, Halk ile Garnizon Generalin ara değerlendirmesine karşılık veriyor ve General uygulanabilir öncelikleri Kralın önüne bırakarak toplantıyı kapatıyor. Her aşama beş gerçek dakika arayla arka planda ilerliyor; tam tutanak hem açık Divanda hem son üç toplantı kaydında saklanıyor.
Meclis açık kaldığında belge de düzenli olarak yenilenir; yeni söz için sayfayı kapatıp açmak gerekmez.

## Neden

Yaşayan dünya hedefinde Divanın bir bildirim değil, zaman alan ve tarafların birbirini dinlediği bir yönetim süreci olması gerekiyor. Kral, sonuç gelmeden gündemi kapatamıyor; böylece karar öncesi tartışmanın bütün izini görebiliyor.

## Etkilenen dosyalar

- db/schema.ts
- drizzle/pg/0038_council_discussion.sql
- server/council-briefing.ts
- app/api/council/route.ts
- components/KingdomGame.tsx
- app/globals.css
- docs/ARCHITECTURE.md

## Test durumu

- Yerel veritabanı şeması `./run.sh db:push` ile uygulandı.
- Açık Kral çağrısı yeni tutanak akışına alındı; açılışta üç söz ve sonraki konuşma zamanı kalıcı kayda yazıldı.
- `./run.sh check`: tip kontrolü temiz; lint hatasız (projede önceden bulunan bir React Hook uyarısı sürüyor).
- `node --import tsx --test tests/council-advisors.test.ts tests/istihbarat-tab.test.ts`: 27 test geçti.
- `git diff --check`: temiz.
