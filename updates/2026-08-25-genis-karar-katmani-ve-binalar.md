# Geniş karar katmanı ve Binalar ekranı

Tarih: 2026-08-25

## Ne değişti

Yerel krallık sahnesindeki eski dar sağ panel, ekranın merkezinde çalışan geniş ve responsive bir karar katmanına dönüştürüldü. Savaş ekranının uzun tek kolon yerleşimi masaüstünde karar kartlarına ayrıldı; üst kaynak şeridi ile alttaki mühür menüsünün dar ekran taşmaları giderildi. Binalar ekranı son arayüz prototipindeki bilgi mimarisine uyarlandı: solda canlı verili üç üretim zinciri, sağda gerçek katalog/seviye/kilit/maliyet bilgilerini kullanan kompakt yapı kartları bulunuyor. Oyuncuya görünen “Askersiz Savaş” dili de “Dolaylı Mücadele” olarak düzeltildi.

## Neden

Eski 390 piksellik sağ panel sahneyi sıkıştırıyor, uzun içerikleri gereksiz bir dikey akışa çeviriyor ve küçük ekranlarda üst şerit ile ana menünün kaybolmasına neden oluyordu. Binalar ekranı da onaylanan prototipteki üretim zinciri + kompakt kart düzeni yerine eski emir listesini gösteriyordu; yeni düzen yapının ekonomi ve savunma üzerindeki sonucunu karar verilmeden önce anlaşılır kılıyor.

## Etkilenen dosyalar

- app/globals.css
- components/KingdomGame.tsx
- tests/istihbarat-tab.test.ts
- tests/victory.test.ts

## Test durumu

- `npm test` — 603 test geçti.
- `npx tsc --noEmit --pretty false --types node,react,react-dom,three` — geçti.
- `git diff --check` — geçti.
- Standart `npx tsc --noEmit` proje kodundan bağımsız olarak `node_modules/@types` altındaki `node 2`, `react 2` vb. yinelenmiş klasörleri örtük tip paketi saydığı için TS2688 veriyor.
- `npm run dev` bu ortamda Vite başlığından sonra dinleme portu açmadan bekledi; bu nedenle canlı tarayıcı görsel testi tamamlanamadı.

## Takip gereken işler

- Yinelenmiş `node_modules` klasörleri temizlendikten sonra standart `./run.sh check` ve gerçek tarayıcıda geniş/dar ekran görsel kontrolü çalıştırılmalı.
