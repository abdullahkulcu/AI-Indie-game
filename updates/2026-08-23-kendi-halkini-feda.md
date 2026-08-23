# Kral kendi halkını feda edebilir — ve halk bunu fark eder (Fikir 18)

Tarih: 2026-08-23

## Ne değişti

Göç Kralın KENDİ kararından doğduysa (istihkakı tam payın altına kendi eliyle
indirmiş ya da vergiyi nötr noktanın üstüne çıkarmış) halk bunu fark ediyor ve
itibar kişi başına zedeleniyor. Karar `engine/populace.ts` içinde saf bir
fonksiyonda (`deliberateExodus` + `EXODUS_PENALTY`) yaşıyor, `engine/tick.ts`
yalnızca uyguluyor ve göç bildirimine bir cümle ekliyor. `FULL_RATION` ve
`TAX_NEUTRAL` sabitleri, üç ayrı okuyucusu çıktığı için dışa verildi.

Yeni bir DOĞRUDAN HEDEFLEME aracı EKLENMEDİ: `engine/migration.ts`'in "hedef
adaylar arasından seçilir, gönderen seçmez" ilkesi olduğu gibi korunuyor. Kral
yalnızca kendi rızasını düşürerek göçü dolaylı tetikler, kimin alacağını asla
seçemez. Plan belgesindeki karar bunu böyle bağlamıştı.

## Neden

Vizyonun "asker olmadan savaş kazanmak" ekseninin en karanlık ucu bu: kendi
halkını boşaltmak da bir hamle. Ama bedelsiz olursa istismar olur — bu yüzden
doğal rıza/nüfus kaybının ÜSTÜNE itibar cezası bindi. Fikir 14'ün ("halk ilan
edilen payla sofraya geleni kıyaslar") mekanizmasıyla aynı aileden: halkın
Kralı yakalama yeteneği.

## Bu maddede bir kısıt #2 ihlali bulundu ve düzeltildi

İlk sürüm cezanın kapısını `heaviestGrievance`'a bağlıyordu. O bir
KAZANAN-HEPSİNİ-ALIR karşılaştırması, yani hangi şikâyetin en ağır olduğu adım
başındaki duruma bağlı ve adım büyüklüğü değişince TAKLA ATIYOR. Ölçüldü
(nüfus 400, kapasite 500, rıza 15, vergi %45, istihkak %40, 24 saat):

| Yol | İtibar |
| --- | --- |
| Sunucu — tek büyük adım | 50 → **50** (ceza HİÇ uygulanmadı) |
| İstemci — dakikalık adımlar | 50 → **20** |

Sıfır ile tam ceza arasında 30 puanlık fark, çünkü kaba adımda en ağır şikâyet
kalabalıklık, ince adımda vergi çıkıyordu. Kısıt #2 tam olarak bunu yasaklıyor.

Kapı Kralın KENDİ AYARINA bağlandı: `foodRation` ve `taxRate` tur içinde sabit
(yalnızca emirle değişir), dolayısıyla her adım büyüklüğünde aynı cevap gelir.
Gerekçe seçimi de büyüklük karşılaştırması değil SABİT SIRA (pay kısılmışsa
"food", değilse vergi yüksekse "tax"). Anlamı da böylesi doğru: Fikir 18 "Kral
bilerek payı kıstı mı" sorusudur, "hangi şikâyet en gürültülü" değil.

Kalan sapma (ölçüldü: 2,8–3,2 puan) cezadan değil `peopleLeft`in kendi
sapmasından geliyor — `populationChange`in bilinen adım-bölünmesi borcu
(`docs/plans/2026-08-22-acik-backlog-maddeleri.md`). O borç bu maddenin kapsamı
dışında; itibar `server/save-validation.ts` → `serverDerived` tarafından
koşulsuz üzerine yazıldığı için meşru bir kaydı reddetmiyor.

## Etkilenen dosyalar

- engine/populace.ts (`FULL_RATION`, `TAX_NEUTRAL`, `EXODUS_PENALTY`, `deliberateExodus`)
- engine/tick.ts (cezanın uygulanması + göç bildirimine eklenen cümle)
- tests/kendi-halkini-feda.test.ts (yeni)
- package.json (test listesi)

## Test durumu

- `npx tsc --noEmit` temiz.
- `npm test` 646/646 geçiyor.
- `npm run lint` 0 hata (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var).
- Adım-bölünmesi ölçümü elle yapıldı (yukarıdaki tablo) ve kalıcı bir teste
  bağlandı: itibar sapması `|Δ peopleLeft| × reputationPerPerson` sınırını
  aşamaz. Test İKİ senaryo koşuyor (küçük ve kalabalık krallık) çünkü küçük
  krallıkta takla hiç görünmüyordu — yalnızca onu ölçen bir test boş bir
  garanti olurdu.
- MUTASYONLA sınandı: eski `heaviestGrievance` kapısı geri konduğunda beş
  testten üçü kırılıyor (sınır testi dahil), düzeltme geri konduğunda beşi de
  geçiyor.

## Takip gereken işler

"İki yol da AYNI kararı verir" diye daha güçlü bir iddia yazılamadı ve sebebi
bu madde değil: bildirim eşiği (`drift <= -LEDGER_STEP`) birikime bağlı, birikim
de `populationChange` borcunu taşıyor, dolayısıyla pencerenin kesildiği anda bir
yol eşiği geçmiş diğeri geçmemiş olabilir. O borç kapanınca testteki sınır
iddiası eşitliğe sıkılaştırılabilir — teste bu not düşüldü.
