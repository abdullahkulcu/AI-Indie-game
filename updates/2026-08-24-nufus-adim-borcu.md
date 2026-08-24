# Nüfus hesabının adım borcu kapatıldı

Tarih: 2026-08-24

## Ne değişti

Üç değişiklik, hepsi kısıt #2 için:

1. **`populationChange` kapalı çözüme geçti.** Kayıp artık üstel
   (`P × expm1(r·t)`), büyüme lojistik
   (`P(t) = C·P₀·e^(k·t) / (C + P₀·(e^(k·t) − 1))`). Eskiden ikisi de
   `P × oran × saat` diye doğrusaldı.
2. **`MAX_STEP_HOURS` 24'ten 1'e indi**, `MAX_STEP_COUNT` 400'den 4200'e çıktı
   (en uzun sezon her tempoda tavana çarpmadan sığıyor).
3. **`tick` istihkak oranını adımın boyuyla değil sabit bir saatlik pencereyle
   okuyor** (`servedRations(g)`), yani panelin ve halkın sesinin zaten okuduğu
   pencereyle aynı.

Yan etki olarak `tests/faction.test.ts` içindeki iki testin senaryosu
değiştirildi — sebebi aşağıda, "Kaba adımın uydurduğu muhalefet".

## Neden

`populationChange` oransal bir süreci doğrusal yazıyordu. Böyle bir biçimde
toplam, sürenin kaç adıma bölündüğüne bağlıdır: aynı 24 saat tek adımda
`P × (1 + r×24)`, 24 adımda `P × (1 + r)²⁴` verir. İstemci saniyelik adımlar
atarken sunucu tek çağrı yaptığı için iki taraf farklı nüfus hesaplıyor ve
meşru kayıt reddediliyordu. Doğrusal biçim ayrıca YANLIŞTI: yeterince uzun bir
aralıkta nüfusu eksiye düşürüyordu.

Kapalı çözüm ×1 ve ×4 tempoyu TAM sıfıra indirdi ama ×24 tempoda %45 sapma
kaldı. Kökü ikinci ve daha sinsi bir yerdeydi: nüfus oranı rızanın KESİKLİ
bandından okunuyor (`MoodState.populationRate`) ve rıza da hedefe doğru yürüyen
bir gecikme süzgeci (`approachMood`, 5 puan/saat). 24 saatlik bir dilimde
süzgeç bir adımda 120 puan yürüyebildiği için rıza doğrudan hedefe SIÇRIYOR;
sunucu "Kaynıyor" bandına düşüp nüfusu 249'da donduruyor, istemcinin saniyelik
adımları 41 rızada kalıp 363'e çıkıyordu.

Bu süzgecin kapalı çözümü YOK, çünkü hedef nüfusa, nüfus da rızaya bağlı
(kapalı devre). Kapalı çözümü olmayan bir yerde yapılacak şey adımı süzgecin
çözünürlüğüne indirmek: bir saatlik dilimde süzgeç en fazla 5 puan yürüyor,
yani ölçeğinin %5'i. Sapma dilim boyuyla birlikte iniyor — 24 saat %49.8 (RED),
6 saat %12.1 (RED), 2 saat %2.8, 1 saat %1.07 — ve 1 saat seçildi.

Üçüncü değişiklik daha küçük ama aynı aileden: `satisfaction` bir PENCERE
İNTEGRALİDİR. Aynı kıt krallıkta 24 saatlik pencere asker maaşı payını %62,
bir saatlik pencere %100 gösteriyor. Motorun adımın boyunu pencere olarak
kullanması hem kısıt #2 ihlaliydi hem de panelin oyuncuya gösterdiği rakamdan
sapıyordu — panel (`components/KingdomGame.tsx`) ve halkın sesi
(`engine/populace-voice.ts`) ZATEN varsayılan bir saatlik pencereyi okuyordu,
motor tek ayrıksı okuyucuydu.

### Kaba adımın uydurduğu muhalefet

Dilim bire indirilince `tests/faction.test.ts` içindeki iki test düştü ve
sebebini ölçtüm. Test `popularity: 20` ile başlayıp sekiz saat ilerletiyordu;
o krallığın hedef rızası ~50 olduğu için rıza yukarı tırmanıyor:

| Yol | Muhalefet baskısı | Deftere "MUHALEFET" yazdı mı |
| --- | --- | --- |
| Eski motor (tek 8 saatlik adım) | 42.88 | evet |
| Yeni motor (8 × 1 saat) | 11.99 | hayır |
| **Oyuncunun ekranı (8 saniyelik×3600 adım)** | **9.99** | **hayır** |

Yani eski kaba adım, oyuncunun hiç yaşamadığı bir muhalefet krizini
UYDURUYORDU ve `serverDerived` bu uydurma değeri oyuncunun dürüst değerinin
üzerine yazıyordu. İki test o uydurmayı doğruluyordu. Testlerin NİYETİ (baskı
ilerliyor mu, istemcinin bildirdiği değer yok sayılıyor mu) korundu; senaryo
istihkakı sıfırlayan bir krallığa çevrildi — orada hedef rıza dibe oturduğu
için rıza hareket etmiyor ve tek dilim ile saniyelik adımlar aynı sayıyı
veriyor (42.88 = 42.88). İkinci test artık sabit bir sayıya değil sunucunun
kendi `tick`'ine bağlı.

## Etkilenen dosyalar

- engine/populace.ts (`populationChange` kapalı çözüm)
- engine/tick.ts (`MAX_STEP_HOURS`, `MAX_STEP_COUNT`, `servedRations(g)`)
- tests/nufus-adim-borcu.test.ts (yeni, 13 test)
- tests/faction.test.ts (iki senaryo düzeltildi)
- package.json (yeni test dosyası koşu listesine eklendi)
- docs/ARCHITECTURE.md (dilim paragrafı güncellendi)

## Test durumu

- `npm test` → **739/739 geçti** (726'dan 739'a).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:132`, önceden
  de vardı).

MUTASYON TESTİ, beş kural kasten bozuldu:

| Mutasyon | Sonuç |
| --- | --- |
| Kayıp yine doğrusal | 2 test düştü |
| Büyüme yine doğrusal | 3 test düştü |
| Dilim 24 saate geri | 2 test düştü |
| Kapasiteyi aşmış krallık da büyüsün | 1 test düştü |
| `servedRations` yine adım penceresiyle | **İLK TURDA YAKALANMADI** |

Beşinciyi hiçbir test yakalamadı, çünkü dilim bir saate indikten sonra motor
zaten hiçbir zaman bir saatten uzun bir pencere geçmiyor — mutasyon neredeyse
etkisiz kalıyor. Kıt bir krallıkta pencerenin GERÇEKTEN fark ettiğini
(24 saat %62 / 1 saat %100) gösterip ardından motorun adım boyunu pencere
olarak kullanmadığını iddia eden bir test eklendi; mutasyon tekrar denendiğinde
düştü.

ÖLÇÜM — istemci (sürenin tamamı, küçük adımlarla) ile sunucunun simülasyonu
gerçek `validateGameSave`'den geçirildi. "İş 7 sonrası" sütunu yalnızca
dilimlemenin, "iş 8 sonrası" sütunu bu işin katkısı:

| Senaryo | Başlangıç | İş 7 sonrası | İş 8 sonrası |
| --- | --- | --- | --- |
| ×1, 30 saat | RED %12.4 | KABUL %3.6 | KABUL %0.0 |
| ×1, 72 saat | RED %80.0 | KABUL %4.3 | KABUL %0.0 |
| ×1, 7 gün | RED %187.8 | KABUL −%1.8 | KABUL %0.0 |
| ×1, 20 saat (kontrol) | KABUL %2.6 | KABUL %2.6 | KABUL %0.0 |
| ×24, 2 saat | RED %40.6 | KABUL %4.9 | KABUL %0.0 |
| ×4, 24 saat | RED %114.4 | RED %24.2 | KABUL %1.6 |
| ×24, 6 saat | RED %162.5 | RED %52.1 | KABUL %0.0 |

Yedi senaryonun yedisi kabul ediliyor, altısında sapma TAM SIFIR.

CANLI DOĞRULAMA (gerçek Postgres + gerçek `PUT /api/save`, channel ×24 tempoya
alındı, aynı DB durumu, aynı 6 saatlik uzaklaşma):

- İş 7 sonundaki motorla: **HTTP 409** — "Bildirilen nüfus sunucunun
  hesapladığı büyümenin üzerinde."
- Bu işten sonra: **HTTP 200** — `{"saved":true}`.

Maliyet ölçüldü: bir haftalık toparlama (×1) 2.8 ms, en kötü durum (×24, tüm
sezon = 4032 dilim) 118 ms ve yalnızca gerçekten o kadar uzun kalmış tek bir
istekte ödeniyor. Normal kayıt aralığı 5 saniye, yani tek dilim.

## Takip gereken işler

- Rızanın gecikme süzgeci hâlâ kapalı çözümsüz; sapma dilim boyuyla sınırlı,
  sıfır değil. Ölçülen en kötü kalan sapma %1.6 ve tolerans %8. Süzgeci gerçekten
  kapalı çözüme çevirmek rıza modelini yeniden tasarlamak demek (kesikli
  bandların yerine sürekli bir eğri) — tasarım kararı, bu turda alınmadı.
- `MAX_STEP_HOURS` bir performans/doğruluk dengesi. Düşürülürse sapma azalır,
  maliyet artar; yükseltilirse ölçülen sapmalar geri gelir. Değiştirilecekse
  `tests/nufus-adim-borcu.test.ts` içindeki iddia da bilinçli olarak
  güncellenmeli.
