# Savaş, diplomasi ve halk sunumu

Tarih: 2026-08-26

## Ne değişti

Asker ve savaş sistemi sunumuna beş yeni örnek UI slaytı eklendi. Yeni ekler savunan tarafın hasarını, takviye veya müzakere kararını, kanal mesafesine göre 1-4 günlük savaş süresini, savaşın sonlandırılmasını ve halkın savaş sırasındaki bağımsız eylemlerini anlatıyor.

## Neden

Savaşın yalnız saldıran ordu için değil, iki krallık, harita mesafesi, diplomasi ve halk üzerinde eşzamanlı sonuçlar doğurduğunu tasarım kararlarıyla görünür kılmak için.

## Etkilenen dosyalar

- docs/demirkale-asker-ve-savas-sistemi-plani-sefer-masasi-diplomasi.pptx

## Test durumu

- `check_template_fidelity.mjs`: başarılı
- `slides_test.py`: başarılı, taşma bulunmadı
- 22 slayt render edildi; yeni beş slayt tam boyutta görsel olarak kontrol edildi.
