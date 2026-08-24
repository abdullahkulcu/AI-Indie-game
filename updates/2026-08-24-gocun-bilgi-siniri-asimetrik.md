# Göçün bilgi sınırı asimetrik oldu: gelen adres verir, giden bırakmaz

Tarih: 2026-08-24

## Ne değişti

Varış bildirimi artık göçmenlerin GELDİĞİ SANCAĞIN ADINI söylüyor:
&laquo;23 kişi Demirkale sancağından göç etti; sınırınızdan geçip
yerleştiler.&raquo; Önce adsızdı (&laquo;komşu bir sancaktan&raquo;).

Ters yön değişmedi ve değişmemesi kuralın kendisi: göç eden krallığın defterine
halkının NEREYE gittiği yazılmıyor — &laquo;Göç eden 20 kişi kendine yeni bir
yurt bulamadı ve geri döndü.&raquo;

`migrationArrivalNotice(count, from = "")` ikinci bir parametre aldı; `from`
boşsa (kaynağın kaydı okunamıyor, hesabı silinmiş) eski adsız cümleye düşüyor.
Ad `server/negotiation-desk.ts` → `displayNameOf` ile çözülüyor, yani tek
yerden ve PUBLIC projeksiyondan.

## Neden

Bilgi sınırı yanlış tarafa asimetrikti. Kural dış keseden
(`engine/agitation.ts`) kopyalanmıştı: kese GİZLİCE gönderilir, o yüzden
göndereni saklanır. Göç öyle bir olay değil — halk hedefin **sınırından geçerek**
gelir, yani karşılayan Kral onlara nereden geldiklerini sorabilir. Saklamak
fiziksel olarak tutarsızdı.

Öteki yön ise gerçekten saklı kalmalı: Kral kendi sınırından çıkanı uğurlar,
komşunun sınırından geçtiğini görmez. Yani iki yön aynı olay değil ve aynı
kuralı almamaları gerekiyordu.

Yeni bir istihbarat kanalı açılmıyor: `displayNameOf` adı
`server/world-projection.ts` → `projectPublicKingdom` üstünden okuyor, yani
dünya haritasının zaten gösterdiği bilgi. Değişen tek şey o bilginin defterde
okunabilir hâle gelmesi. Kaynağın nüfusunun ne kadar eridiği yine
söylenmiyor — hedef yalnızca kendi sayımını biliyor.

Kaynağın adı yalnızca yerleşecek biri varsa çözülüyor, yani boşa sorgu
atılmıyor.

## Etkilenen dosyalar

- engine/migration.ts (`migrationArrivalNotice` ikinci parametre + asimetrinin
  gerekçesi iki bildirimin yorumunda karşılıklı yazılı)
- app/api/cron/route.ts (`channels.name` sorguya eklendi, `displayNameOf`
  çağrısı, fonksiyon başlığındaki bilgi-sınırı notu)
- tests/migration.test.ts

## Test durumu

- `npm test` → **740/740 geçti** (739'dan 740'a; bir test ikiye ayrıldı, iki
  kopya test birleştirildi).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:132`, önceden
  de vardı).

MUTASYON TESTİ, iki kural kasten bozuldu ve ikisi de yakalandı:

| Mutasyon | Sonuç |
| --- | --- |
| Varış bildirimi kaynağı yine saklıyor | 1 test düştü |
| Dönüş bildirimi komşu adı sızdırıyor | 2 test düştü |

CANLI DOĞRULAMA (gerçek Postgres + gerçek `/api/cron`, üç krallık):

- Demirkale'den çıkan 30 kişi Akkale'ye 23, Karakale'ye 7 dağıldı. İkisinin de
  defterinde: **&laquo;… kişi Demirkale sancağından göç etti; sınırınızdan
  geçip yerleştiler.&raquo;**
- Komşuların konutu doluyken çıkan 20 kişi kaynağa döndü. Demirkale'nin
  defterinde: **&laquo;Göç eden 20 kişi kendine yeni bir yurt bulamadı ve geri
  döndü.&raquo;** — hiçbir komşu adı geçmiyor.

## Takip gereken işler

- Türkçe ek uyumu bilinçli olarak ATLANDI: cümle eki özel ada değil
  &laquo;sancak&raquo; sözcüğüne bağlıyor (`${from} sancağından`), böylece
  krallık adının son ünlüsüne göre -den/-dan seçmek gerekmiyor. Kral adları
  serbest metin olduğu için bu tek güvenli biçim.
