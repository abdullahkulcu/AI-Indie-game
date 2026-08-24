# Uzun uzaklaşan oyuncunun kaydı artık reddedilmiyor

Tarih: 2026-08-24

## Ne değişti

`engine/tick.ts` uzun aralığı artık kırpmıyor, `MAX_STEP_HOURS` (24 oyun saati)
büyüklüğünde dilimlere bölüp hepsini uyguluyor. Eski gövde `tickStep` adıyla
olduğu gibi duruyor (kendi kırpması da duruyor); `tick` yalnızca bölmeyi
üstlendi. Dilim sayısının tavanı var (`MAX_STEP_COUNT = 400`) ve tavana
çarpıldığında kalan süre tek dilimde kapanıyor — sayı iki tarafta aynı olduğu
için bu sapma üretmiyor.

Bu değişiklik ADLI BİR KURALI DEĞİŞTİRDİ: `tests/engine.test.ts` içindeki
"çevrimdışı kazanç 24 saatle sınırlıdır" testi kaldırıldı ve yerine dört yeni
test geldi. Gerekçesi aşağıda; testin başına da yazıldı.

## Neden

Tavan ÇAĞRI BAŞINA çalışıyordu ve `lastTickAt` yine `now` damgalanıyordu, yani
24 saati aşan süre sessizce yok sayılıyordu. Ama sekmesini açık bırakan
oyuncunun istemcisi saniyelik adımlar attığı için tavana HİÇ çarpmıyor ve
sürenin tamamını işliyordu. Aynı `now` için iki taraf farklı sonuç hesaplıyordu
— kısıt #2'nin tam olarak yasakladığı şey — ve bedelini meşru oyuncu ödüyordu:
kaydı 409 ile reddediliyor, ilerlemesi kayboluyordu.

Tavanı adım bölünmesinden bağımsız kılmanın tek yolu üretimi kayıtta TAŞINAN
bir alana bağlamaktı, yani yeni bir save alanı: gerçek bir tasarım ve şema
değişikliği. Bu turun kapsamı "eksik kalmış ve tam çalışmayı engelleyen şeyler"
olduğu için o yol seçilmedi. Onun yerine 24 saat ADIM BÜYÜKLÜĞÜ sınırı olarak
kaldı ve süre tamamen uygulanıyor.

Ekonomi başıboş kalmıyor, çünkü sınırı zaten başka mekanizmalar çiziyor:
kaynağı depo tavanı (`engine/storage.ts` → `storageCaps`), nüfusu kapasite
(`capacityFor`). Ölçüm bunu doğruladı: bir haftalık uzaklaşmada odun depo
tavanına oturuyor, nüfus kapasitenin altında kalıyor. İki iddia da teste
bağlandı.

## Etkilenen dosyalar

- engine/tick.ts (`MAX_STEP_HOURS`, `MAX_STEP_COUNT`, `tick` döngüsü, `tickStep`)
- tests/engine.test.ts
- docs/ARCHITECTURE.md (bölüm 1.1'e dilimleme paragrafı)

## Test durumu

- `npm test` → 726/726 geçti (725'ten 726'ya; eski tek iddia yerine dört test).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:132`, önceden
  de vardı).

MUTASYON TESTİ, dört kural kasten bozuldu:

| Mutasyon | Sonuç |
| --- | --- |
| Dilimleme kaldırıldı (eski tek-çağrı hâli) | 2 test düştü |
| Dilim boyu 48 saat yapıldı | 1 test düştü |
| Dilim sonu hesabında tempoya bölünmedi | **İLK TURDA YAKALANMADI** |
| Tavana çarpınca kalan süre kapatılmadı | 1 test düştü |

Üçüncü mutasyonu hiçbir test yakalamadı: bütün iddialar ×1 tempodaydı, oysa
hata yalnızca hızlı channel'da görünüyor (dilim 24 GERÇEK saat olurdu ve ×24
tempoda sürenin çoğu kaybolurdu). ×24 tempoda iki saatlik uzaklaşmanın tam iki
dilim olduğunu iddia eden bir test eklendi; mutasyon tekrar denendiğinde
düştü.

ÖLÇÜM — istemci (5 dakikalık adımlarla sürenin tamamı) ile sunucunun
simülasyonu karşılaştırıldı ve gerçek `validateGameSave`'den geçirildi:

| Senaryo | Önce | Sonra |
| --- | --- | --- |
| ×1, 72 saat | RED — nüfus %80 sapma | KABUL — %4.3 |
| ×1, 30 saat | RED — %12.4 | KABUL — %3.6 |
| ×1, 7 gün | RED — %187.8 | KABUL — −%1.8 |
| ×24, 2 saat | RED — %40.6 | KABUL — %4.9 |
| ×1, 20 saat (kontrol) | KABUL — %2.6 | KABUL — %2.6 (birebir aynı) |
| ×4, 24 saat | RED — %114.4 | RED — %24.2 |
| ×24, 6 saat | RED — %162.5 | RED — %52.1 |

Kontrol satırı önemli: 24 saatin altındaki aralık tek dilim olduğu için
davranış birebir aynı kaldı — suçlunun tam olarak tavan olduğunu da bu
gösteriyor.

CANLI DOĞRULAMA (gerçek Postgres + gerçek `PUT /api/save`, aynı DB durumu, aynı
72 saatlik uzaklaşma, büyümeye yeri olan bir krallık):

- Düzeltme öncesi motorla: **HTTP 409** — "Bildirilen food miktarı sunucunun
  ürettiği değerin üzerinde."
- Düzeltme sonrası motorla: **HTTP 200** — `{"saved":true}`.

## Takip gereken işler

- Tablodaki son iki satır (×4/24 saat ve ×24/6 saat) HÂLÂ reddediliyor ve sebebi
  bu iş DEĞİL: `populationChange`'in bilinen adım borcu. Sapma toplam oyun
  saatiyle büyüyor (96 oyun saati → %24, 144 oyun saati → %52). Kuyruğun 8.
  işi tam olarak bu.
- Çevrimdışı kazancı gerçekten sınırlamak istenirse doğru yol kayda taşınan bir
  "biriken süre" alanıdır (şemaya + `SERVER_DERIVED`'a aynı değişiklikte
  eklenmek şartıyla). Bu bir tasarım kararı; bu turda alınmadı.
