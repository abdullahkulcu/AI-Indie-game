# Süresi dolan müzakere masası artık kapanıyor

Tarih: 2026-08-23

## Ne değişti

Süre dolduğunda masanın DURUMU yazılıyor. Kural `engine/negotiation.ts` içinde
iki ayrı saf fonksiyona ayrıldı: `isExpired` geçiş kuralıdır ("süpürme bu satırı
şimdi kapatmalı mı"), `isTimedOut` durum sorusudur ("bu masa zamanla bitmiş mi").
Süpürmeyi `server/negotiation-desk.ts` → `expireStaleTables` yapıyor ve iki
yerden çağrılıyor: gece vardiyası (channel geneli) ve masa okuma yolu (o
channel için), böylece Kral defterini açtığı anda doğruyu görüyor. Arayüzde
durum etiketi artık "SÜRESİ DOLDU" gösteriyor ve iki "cevap bekliyor" sayacı
süresi bitmiş masayı saymıyor.

## Neden

`"expired"` durumu şemada ve motorda tanımlıydı, `tests/negotiation.test.ts`
onu test ediyordu, ama YAZAN hiçbir yol yoktu. Sonucu görünür bir hataydı:
`loadTablesFor` hiç süre süzgeci içermediği için süresi geçmiş masa Kralın
defterinde `open` olarak duruyor, arayüz ona canlıymış gibi tur sayacı
gösteriyor (`3/14 söz`) ve en kötüsü — `agreed`/`declined` dışındaki her masa
"cevap bekliyor" sayıldığı için MÜZAKERE düğmesinde **temizlenmesi imkânsız
bir rozet** bırakıyordu. Kral masaya tıkladığında yalnızca "Müzakere süresi
doldu" duvarına çarpıyordu.

Backlog belgesindeki "masalar sorgulardan `expiresAt` süzgeciyle dışlanıyor"
ifadesi bu yol için YANLIŞTI; yalnızca gece vardiyasının sorgusu süzüyordu ve
süzmek durumu yazmıyor.

## İki fonksiyonun ayrı durmasının sebebi

Bu ayrımı ilk sürümde yapmamıştım ve gerçek bir hataya yol açtı: arayüz
yalnızca `isExpired`i okuyordu. Süpürme satırı `expired` damgaladıktan SONRA o
kural `false` dönüyor (kapatılacak bir şey kalmadı), dolayısıyla arayüz masaya
yine tur sayacı gösteriyordu. Canlı tarayıcıda görüldü, sonra ayrıldı ve
ikisinin farkı hem yorumda hem testte sabitlendi.

## Etkilenen dosyalar

- engine/negotiation.ts (`EXPIRABLE_STATUSES`, `isExpired`, `isTimedOut`)
- server/negotiation-desk.ts (`expireStaleTables`, okuma yoluna bağlandı)
- app/api/cron/route.ts (gece vardiyası süpürmesi)
- components/KingdomGame.tsx (durum etiketi + iki bekleyen sayacı)
- tests/negotiation-expiry.test.ts (yeni)
- package.json (test listesi)

## Test durumu

- `npx tsc --noEmit` temiz · `npm test` 687/687 · `npm run lint` 0 hata
  (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var) ·
  `npm run build` başarılı.
- Yeni test MUTASYONLA sınandı: motor eşiği kaydırıldığında, nihai durumlar
  süresi dolabilir listesine eklendiğinde, arayüzdeki sayaç koruması
  kaldırıldığında ve okuma yolundaki süpürme silindiğinde sekiz testten altısı
  kırılıyor.
- CANLI DOĞRULAMA (çalışan sunucu + gerçek Postgres + Chromium): süresi iki saat
  önce dolmuş bir masa kuruldu. Okuma öncesi DB `open`, okuma sonrası
  `expired`; API `expired` döndü; arayüzde etiket "SÜRESİ DOLDU" ve MÜZAKERE
  rozeti kayboldu. Masa yaşayan hâle getirildiğinde rozet ve tur sayacı geri
  geldi (regresyon kontrolü). `agreed` durumuna alınıp süresi çok önceye
  çekildiğinde süpürme ona HİÇ dokunmadı — yürürlükteki anlaşma güvende.
  Test verisi silindi.

## Bir yan düzeltme

Sayaç kontrolünü ilk yazdığımda 20 saniyede bir dönen yoklama effect'inin
içine `now` durumunu soktum; lint bunu yeni bir `exhaustive-deps` uyarısı
olarak yakaladı. `now`'u bağımlılığa eklemek zamanlayıcıyı her saniye kurup
yıkardı, o yüzden yoklamanın içinde `Date.now()` okunuyor — semantik olarak da
doğrusu bu, çünkü yoklama gerçek saate göre karar vermeli.
