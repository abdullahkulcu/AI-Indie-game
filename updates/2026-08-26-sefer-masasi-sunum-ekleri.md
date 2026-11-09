# Sefer Masası sunum ekleri

Tarih: 2026-08-26

## Ne değişti

Asker ve birebir savaş sistemi sunumuna dört düzenlenebilir örnek UI slaytı eklendi: Sefer Masası, sefer öncesi plan ve erzak, savaş sisi ile gecikmeli komuta, kralın sefere katılması ve naiplik. Kaynak sunumun ilk 13 slaytı korunarak yeni sürüm 17 slayta çıkarıldı.

## Neden

Savaş tasarımının yalnızca kuralları değil, oyuncunun bu kuralları hangi karar ekranlarında göreceği de Claude ile paylaşılabilir hale getirildi.

## Etkilenen dosyalar

- docs/demirkale-asker-ve-savas-sistemi-plani-sefer-masasi.pptx

## Test durumu

- `check_template_fidelity.mjs`: başarılı
- `slides_test.py`: başarılı, taşma bulunmadı
- 17 slayt render edilip kaynak slaytlar ile dört yeni UI slaytı görsel olarak kontrol edildi.
