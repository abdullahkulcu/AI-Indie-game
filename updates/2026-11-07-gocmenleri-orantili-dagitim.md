# Göçmenlerin Orantılı Dağıtımı

Tarih: 2026-11-07

## Ne değişti

Göç kuyruğu artık nüfusu tek bir krallığa göndermiyor. Uygun bütün hedefler, boş konutları ve halk rızalarıyla belirlenen çekiciliklerine göre pay alıyor; toplam kapasite yetmezse yerleşemeyenler kaynak krallığa geri yazılıyor. Hedef kayıtları, kaynak dönüşü ve kuyruk satırının kapanması aynı veritabanı işlemi içinde gerçekleşiyor.

## Neden

Eski akış, kapasitesi sınırlı tek hedefi seçiyor ve hedefin alabileceğinden fazla olan nüfusu kalıcı olarak kaybediyordu. Bu hem tasarlanan çok krallıklı göç davranışını karşılamıyor hem de iki kayıt aynı anda değiştiğinde nüfusun eksik ya da çift yazılması riski taşıyordu.

## Etkilenen dosyalar

- engine/migration.ts
- app/api/cron/route.ts
- server/save-write.ts
- tests/migration.test.ts

## Test durumu

- `npx tsc --noEmit` başarılı
- `node --import tsx --test tests/migration.test.ts` başarılı (13/13)

## Takip gereken işler

- Canlı, en az üç krallıklı bir channel'da göç varışı uçtan uca gözlemlenmeli.
