# Kapanan müzakere masası Kralın önünden kalkıp geçmişe düşüyor

Tarih: 2026-08-24

## Ne değişti

Elçilik defteri ikiye bölündü: **önünde duran masalar** ve **geçmiş**.
Kapanmış masa (`agreed`, `declined`, `expired`) artık canlı listede durmuyor;
panelin altında katlanmış bir "GEÇMİŞ MASALAR" bölümünde duruyor ve açan
tutanağın tamamını okuyabiliyor.

Bölme TEK yerde yapılıyor (`server/negotiation-desk.ts` → `loadTablesFor`
artık `{ live, closed }` döndürüyor), kural da tek yerde
(`engine/negotiation.ts` → `CLOSED_STATUSES` / `isClosedTable`).

General de artık YALNIZCA canlı masaları görüyor (`briefsFor` canlı listeden
besleniyor).

## Neden

Kapanmış masa Kralın önünde duruyordu ve "cevap bekliyor" gibi görünüyordu;
imzalanmış bir masayı görüp anlaşmanın hâlâ pazarlıkta olduğunu sanmak
mümkündü. Kullanıcının kendi ifadesiyle: kapı kapandıysa onu orada görmeye
gerek yok, geçmiş olarak bir listede bakabilir.

İki yan kazanç:

- **Sıra numarası düzeldi.** General'in araç çağrısındaki `table_ordinal` ile
  Kralın panelde gördüğü numara AYNI masayı göstermek zorunda
  (`server/negotiation-desk.ts` dosya başındaki değişmez). Kapanmış masalar
  listede sayıldığı için numaralar kapanmış masaların üstünden atlıyordu.
  Bölme `loadTablesFor` içinde yapıldığı için iki taraf artık aynı diziyi aynı
  sırayla okuyor — çağıranlar kendi filtresini kurmuyor, ki bir gün biri
  filtreyi değiştirip numaraları kaydırmasın.
- **General boşa token harcamıyor.** Söz söyleyemeyeceği bir masayı okumuyor.

## Bu değişiklikte düzeltilen iki tek-kaynak ihlali

1. Paneldeki "cevap bekliyor" filtresi kapanmış durumları ELLE sayıyordu
   (`status!=="agreed" && status!=="declined"`) ve **`expired`'ı atlıyordu.**
   Artık motorun `isClosedTable` kuralını okuyor.
2. Masanın durum etiketi (`ŞART SUNULDU` / `ANLAŞILDI` / `REDDEDİLDİ` /
   `SÜRESİ DOLDU`) panelde satır içinde yazılıydı. Geçmiş listesi de aynı
   etiketlere ihtiyaç duyduğu için ikinci bir kopya çıkacaktı; tek bir
   `masaDurumu` yardımcısına alındı. Testi artık her etiketin kod tabanında
   **tek kez** yazıldığını da iddia ediyor.

## Etkilenen dosyalar

- engine/negotiation.ts (`CLOSED_STATUSES`, `isClosedTable`)
- server/negotiation-desk.ts (`Desk` tipi, `loadTablesFor` ikiye bölüyor,
  `briefsFor` canlı listeden besleniyor)
- app/api/negotiate/route.ts (`tables` + `history`, ortak `shape`)
- components/KingdomGame.tsx (`masaDurumu` yardımcısı, geçmiş bölümü,
  filtrenin motor kuralını okuması)
- app/globals.css (geçmiş bölümünün stilleri)
- tests/negotiation-expiry.test.ts

## Test durumu

- `npm test` → **750/750 geçti** (749'dan 750'ye).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:147`, önceden
  de vardı).

CANLI DOĞRULAMA — gerçek Postgres, beş masa kuruldu (`open`,
`awaiting_king`, `agreed`, `declined`, `expired`):

- `GET /api/negotiate` → `tables: [awaiting_king, open]`,
  `history: [agreed, declined, expired]`. Sıra iki yarıda da `lastTurnAt`
  azalan.
- Tarayıcıda (Playwright): panel başlığı **"2 masa · 0 anlaşma · 3 geçmiş"**,
  önünde iki masa kartı, altında **"GEÇMİŞ MASALAR 3"** düğmesi. Açılınca
  `Karakale · ANLAŞILDI`, `Karakale · REDDEDİLDİ`, `Akkale · SÜRESİ DOLDU`;
  ilkini açınca tutanak (`Ittifak kabul.`) görünüyor. JS hatası yok.

## Takip gereken işler

- Geçmiş listesi `TABLE_LIST_LIMIT` (20) ile sınırlı ve bu sınır artık İKİ
  yarının TOPLAMI için geçerli: çok masa açan bir Kralda eski geçmiş kayıtları
  listeden düşer. Gerçek bir arşiv isteniyorsa geçmişin kendi sorgusu ve kendi
  sayfalaması olmalı.
- Geçmiş bölümü mobil genişlikte de çalışıyor ama ayrı bir sekme değil, panelin
  içinde; sekme sırası tasarım turunda ele alınacaksa buraya da bakılmalı.
