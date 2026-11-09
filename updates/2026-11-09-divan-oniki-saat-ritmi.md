# Divan için on iki saatlik ritim

Tarih: 2026-11-09

## Ne değişti

Olağan Divan döngüsü ve Kralın yeni toplantı çağrıları, channel hızından
bağımsız olarak gerçek zamanda on iki saatlik aralığa alındı. Eski hız-temelli
kayıtların arayüzde bir saatlik eski vakti göstermemesi için, gösterilen sıradaki
olağan Divan zamanı toplantı damgasından yeniden türetiliyor.

Normal durum değişimleri artık Divanı takvimden önce açmıyor; yalnızca acil
öncelikteki halk veya garnizon baskısı erken toplantı başlatabiliyor.

## Neden

Divanın sık açılması onu yaşayan bir yönetim oturumu yerine tekrar eden bir
bildirime dönüştürüyordu. On iki saatlik ritim, Kralın kararları arasında
sonuçların oluşmasına zaman bırakırken savaş, kıtlık ve benzeri gerçek acil
durumları istisna olarak korur.

## Etkilenen dosyalar

- server/council-schedule.ts
- server/council-briefing.ts
- tests/council-advisors.test.ts
- docs/demirkale-yasayan-dunya-gelistirme-kararlari.pptx
- docs/demirkale-yasayan-dunya-gelistirme-kararlari.pdf

## Test durumu

- `npm test`: 745 test başarılı.
- `./run.sh check`: tip kontrolü temiz; önceden var olan bir React Hook uyarısı dışında lint hatası yok.
- Sunum paket bütünlüğü `unzip -t` ile doğrulandı ve LibreOffice ile 15 slayt görsel olarak kontrol edildi.

## Takip gereken işler

- Kullanıcının paylaştığı General sohbeti gözlemleri not edildi: Divan bağlamındaki serbest soru ve devam talepleri, müzakere akışına yönlendirilmemeli; General konu bağlamını koruyarak uygulanabilir sonraki adımı anlatmalı. Bu turda davranış değişikliği yapılmadı.
