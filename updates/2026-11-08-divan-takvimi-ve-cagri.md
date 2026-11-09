# Takvimli Divan ve Kral Çağrısı

Tarih: 2026-11-08

## Ne değişti

Divan için oyun günü başına olağan toplantı ritmi görünür hale getirildi. Kral artık açık gündem yokken `DİVANI TOPLA` ile toplantı talebi bırakabiliyor; talep en erken uygun saate alınıyor ve aynı toplantı tekrar tekrar çağrılamıyor. Toplantı geçmişi artık olağan, Kral çağrısı ve acil durum oturumlarını birbirinden ayırıyor.

`council_briefings` tablosuna çağrının bırakıldığı ve toplantının yapılacağı zamanı tutan iki alan, `council_meeting_history` tablosuna da oturum türü eklendi. Yerel geliştirme veritabanı şeması güncellendi.

Arka plan denetim aralığı beş dakikaya indirildi. Böylece özellikle Hızlı Taç'ta Kralın çağrısı saatlik denetimi beklemek yerine hedeflenen saate yakın işlenir; tek başına daha fazla AI çağrısı açılmaz.

## Neden

Kralın yeni Divanın ne zaman toplanacağını görmesi, gerektiğinde toplantı istemesi ve toplantıların art arda açılmaması gerekiyordu. Bu altyapı, yaşayan dünyada sonraki gerçek Divan kararları ve General yetki sınırları için takvimli, maliyeti kontrollü başlangıç noktasıdır.

## Etkilenen dosyalar

- server/council-schedule.ts
- server/council-briefing.ts
- app/api/council/route.ts
- components/KingdomGame.tsx
- app/globals.css
- docker-compose.yml
- db/schema.ts
- drizzle/pg/0037_council_calls.sql
- docs/demirkale-yasayan-dunya-karar-sunumu.pptx
- tests/council-advisors.test.ts
- tests/istihbarat-tab.test.ts

## Test durumu

- `node --import tsx --test tests/council-advisors.test.ts tests/istihbarat-tab.test.ts` → başarılı (27 test)
- `./run.sh check` → TypeScript temiz; önceden var olan tek React hook bağımlılığı uyarısı sürüyor
- `git diff --check` → temiz
- `./run.sh db:push` → yerel Postgres şeması uygulandı
- Yerel Postgres doğrulaması → `call_requested_at`, `call_due_at`, `meeting_type` sütunları mevcut
- Sunum `.pptx` paketi doğrulandı ve sayfa görselleriyle görsel kontrol yapıldı

## Takip gereken işler

- Divan gündem maddelerini ayrı ayrı kabul/ertele/uygula kararlarına ve Defter sonuçlarına bağlamak
- Generalin çevrimdışı yetki modu ile bütçe ve geri dönüş sınırlarını tasarlamak
- Oyuncu dönüşünde dünya özeti ekranını eklemek
