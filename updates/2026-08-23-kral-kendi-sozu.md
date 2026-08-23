# Kral müzakere masasına kendi eliyle cevap yazabiliyor

Tarih: 2026-08-23

## Ne değişti

Masa kartına bir "KENDİ SÖZÜNÜ YAZ" düğmesi ve çok satırlı bir kutu eklendi.
Gönderilen söz veritabanına `speaker: "king"` olarak yazılıyor ve masanın söz
sayacından bir hak düşüyor. Düğmenin görünüp görünmeyeceğine motorun kendi
kuralı (`canSpeak`) karar veriyor; panelde ikinci bir eşik yok.

Yeni bir kural, yeni bir alan ve yeni bir uç YAZILMADI. Eklenen şey bir kanal.

## Neden

`/api/negotiate` gövdedeki `speaker` alanını zaten okuyordu ve "general"
değilse "king" yazıyordu — yani sunucu bu yolu baştan beri destekliyordu. Ama
arayüzde onu çağıran hiçbir düğme yoktu: `action:"reply"` yalnızca General'in
araç çağrısından, sabit `speaker:"general"` ile gidiyordu.

Sonucu şuydu: Kral masayı AÇARKEN (`envoyMessage`) ve ŞART SUNARKEN
(`proposeTerms` — o da `speaker:"king"` gönderiyor) kendi cümlesini
yazabiliyordu, ama masa kurulduktan sonra **şart taşımayan düz bir cevap**
yazmanın hiçbir yolu yoktu. Pazarlığın ortasında "peki, ama sınırda nöbeti de
azaltalım" demek isteyen Kral bunu Generaline anlatmak zorundaydı.

Diplomasi bu oyunun en insani yeri; Kral'ın orada susması vizyonla çelişiyordu.

## İki kanal ayrı kaldı

General'in araç yolu olduğu gibi duruyor ve hâlâ `speaker:"general"`
gönderiyor. İkisinin ayrı kalması önemli: aynı masada iki ses var ve
karışırlarsa karşı taraf kiminle konuştuğunu bilemez. Teste ikisinin de
korunduğu ayrıca yazıldı.

## Etkilenen dosyalar

- components/KingdomGame.tsx (`envoyReply` taslağı, `kingReply`, panel düğmesi
  ve kutusu, `canSpeak` okuması)
- app/globals.css (`.envoy-term-form textarea` — mevcut kutu ailesine katıldı)
- tests/kral-kendi-sozu.test.ts (yeni)
- package.json (test listesi)

Sunucuya, motora, şemaya ve API sözleşmesine DOKUNULMADI.

## Test durumu

- `npx tsc --noEmit` temiz · `npm test` 693/693 · `npm run lint` 0 hata
  (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var) ·
  `npm run build` başarılı.
- MUTASYON: gönderiyi "general"a çevirdiğimde ve motorun kapısını panelde elle
  yazılmış bir eşikle değiştirdiğimde altı testten ikisi kırıldı.
- CANLI DOĞRULAMA (çalışan sunucu + gerçek Postgres + Chromium): yaşayan bir
  masa kuruldu, General'in bir sözü konuldu. Düğme çıktı, kutu açıldı, söz
  gönderildi. Masa günlüğünde iki söz göründü ve veritabanında ikincisi
  `speaker=king`, `side=target` olarak yazıldı; söz sayacı 2'den 3'e çıktı.
- KAPI DENETİMİ (canlı): masa süresi geçmiş hâle getirildiğinde düğme
  KAYBOLDU; söz tavanı (14) dolduruldğunda da kayboldu. Panel motorun kuralını
  gerçekten okuyor. Test verisi silindi.
