# Karar odaklı arayüzün ilk geliştirme dilimi

Tarih: 2026-08-24

## Ne değişti

Yedi yatay sekme, mockup'taki bilgi mimarisine uygun biçimde Divan, Krallık,
Savaş ve Diyar ana bölümlerinde toplandı; Krallık ile Savaş kendi bağlamsal alt
menülerini açıyor. Kullanıcının seçtiği Game-icons.net çizimleri yerel bir SVG
sprite ve ortak React bileşeni üzerinden üst marka, General kimliği, ana menü
ve istihbarat kartına bağlandı. Üst kaynak şeridi inceltildi ve mühür biçimli
ana menü ekranın altına alındı.

Gelen propaganda ve diğer dolaylı faaliyetleri kapatma davranışı hem arayüzden
hem API'den kaldırıldı. Hedef üyeliğinin eski `accepts_agitation` değeri artık
operasyonu reddetmiyor; savunma karşı-istihbaratın etki azaltma, ifşa ve
misilleme fırsatı üretme sonuçlarıyla anlatılıyor. Eski veritabanı kolonu bu
dilimde migration gerektirmemek için yalnızca uyumluluk alanı olarak bırakıldı
ve uygulama tarafından okunmuyor.

## Neden

Eski yedi sekmeli şerit oyunun ana karar alanlarını aynı düzeyde gösteriyor ve
oyuncunun Divan, iç yönetim, savaş/dolaylı mücadele ve dünya haritası arasındaki
ilişkiyi kurmasını zorlaştırıyordu. Ayrıca propaganda hattını tamamen kapatmak,
tasarlanan karşı-istihbarat döngüsünü ve oyuncular arası dolaylı mücadeleyi
ortadan kaldırıyordu.

## Etkilenen dosyalar

- components/GameIcon.tsx
- components/KingdomGame.tsx
- public/game-icons.svg
- public/GAME-ICONS-LICENSE.md
- app/globals.css
- app/api/world/route.ts
- server/agitation-desk.ts
- db/schema.ts
- tests/agitation.test.ts
- tests/istihbarat-tab.test.ts
- tsconfig.json
- eslint.config.mjs

## Test durumu

- `npm test`: 602 test geçti, 0 hata.
- Değiştirilen dört TypeScript/TSX dosyası `typescript.transpileModule` ile
  sözdizimi doğrulamasından geçti.
- `npm run lint`: bu ortamda dört dakikadan uzun süre çıktı üretmeden çalıştığı
  için durduruldu; sonuç alınamadı.
- `npm run dev`: vinext başlangıç mesajından sonra yerel porta yanıt vermediği
  için tarayıcı görsel doğrulaması bu dilimde tamamlanamadı.

## Takip gereken işler

- Divan ana yüzeyini yerel sahne üzerinde geniş karar belgesi düzenine taşımak.
- General görüşmesini gerektiğinde sağdan açılan bağımsız panele dönüştürmek.
- Eski `accepts_agitation` kolonunu ayrı ve güvenli bir migration ile kaldırmak.
- Yerel geliştirme sunucusunun başlangıçta beklemesinin nedenini incelemek ve
  masaüstü/dar ekran görsel doğrulamasını tamamlamak.
