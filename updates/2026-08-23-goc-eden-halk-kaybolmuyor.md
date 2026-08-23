# Göç eden halk artık kaybolmuyor

Tarih: 2026-08-23

## Ne değişti

Göçün varışı tek hedef seçmekten çıkıp channel'daki TÜM uygun adaylara oranlı
dağıtıma döndü (`engine/migration.ts` → `spreadMigrants`, eski
`pickMigrationTarget`/`arrivingMigrants` yerine). Hedef bulunamayan göçmenler
artık silinmiyor: üç aşamalı şelale — (1) hedeflere oranlı dağıtım, (2) yer
bulamayanların kaynağa dönüşü (kaynağın kendi boş konutu kadarı), (3) ne
hedefte ne evde yer kalmadıysa kervan PENDING kalıp `count`u yalnızca hâlâ yol
alan kişiye inerek sonraki turda yeniden deniyor. Dağıtım tamamen
belirlenimci: rulet çarkı ve tohum kalktı, yerine oranlı pay + en büyük kalan
yöntemi geldi.

## Neden

`settleMigrations` hedef seçemediğinde göçmenleri `lost` sayıp SİLİYORDU ve bu
nadir bir uç durum değildi: tek kişilik bir channel'da aday listesi HER ZAMAN
boş olduğu için her göç dalgası halkın buharlaşmasıyla bitiyordu. Kral
nüfusunun neden eridiğini göremiyordu. Ayrıca tek hedef seçimi, Faz 6'nın kendi
başlığındaki ("göçün ÇOK KRALLIĞA dağılması") sözü tutmuyordu.

Dönüş `peopleJoined`e yazılıyor ve bu kasıtlı: bu kişiler ayrılırken
`peopleLeft`e yazılmıştı, dönünce iki defter birbirini götürüyor. Aksi hâlde
zafer puanının baktığı NET (giren − çıkan, bkz. `engine/victory.ts`) yer
bulamayıp geri dönen her dalgada kalıcı olarak düşerdi — kimse gitmemiş
olmasına rağmen.

## Etkilenen dosyalar

- engine/migration.ts
- app/api/cron/route.ts
- tests/migration.test.ts

## Test durumu

- `npm test` → 722/722 geçti (migration dosyası 19 → 20 test).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:132`, bu
  değişiklikten önce de vardı).
- MUTASYON TESTİ, altı kural kasten bozuldu ve hepsi yakalandı: en büyük kalan
  turunun kaldırılması (2 test düştü), `returning`in her zaman 0 dönmesi (2),
  boş konut tavanının kaldırılması (1), çekicilik ağırlığının kaldırılması (2),
  taban çekiciliğin 0'lanması (1), `userId` sıralamasının kaldırılması (1).
- CANLI DOĞRULAMA (gerçek Postgres + gerçek `/api/cron`, üç krallık): 90 kişi
  üç kervanla yola çıktı, 90 kişi hesaba geçti, sıfır kayıp.
  - Dağıtım: 30 kişi → Akkale 23 + Karakale 7 (rızası yüksek olan daha büyük
    pay aldı, kaynayan krallık da payını aldı).
  - Dönüş: hiçbir komşuda yer yokken 30 kişi kaynağa döndü, nüfus 103.64 →
    133.64, deftere "yeni bir yurt bulamadı ve geri döndü" satırı düştü.
  - Yolda bekleme: hiç kimsede yer yokken satır PENDING kaldı (30); Akkale'de
    12 konut açılınca 12'si yerleşti ve `count` 18'e indi; kaynakta yer
    açılınca kalan 18'i eve döndü ve satır settled oldu.
  - Not: cron kapasiteyi kaydın `capacity` alanından değil `capacityFor`dan
    okuyor (tek doğru kaynak); canlı ölçüm bunu da doğruladı.

## Takip gereken işler

- `migrations.count` alanının anlamı artık "yola çıkan" değil "hâlâ yol alan".
  Alanın tek okuyucusu `settleMigrations`, bu yüzden hiçbir görüntü bozulmadı;
  ileride bir yerde "kaç kişi göç etti" gösterilecekse `sent_at` anındaki
  değer değil `peopleLeft` defteri kullanılmalı.
- Kervanın sonsuza dek PENDING kalması teorik olarak mümkün (herkesin konutu
  kalıcı olarak dolu). İş yükü tek satır/tur olduğu için sınırlı, ve channel
  kapanınca sorgudan düşüyor.
- Bu işin HTML sunumu HENÜZ HAZIRLANMADI (önceki beş iş için hazırlanmıştı).
