# Channel-geneli pazar endeksi (Fikir 24)

Tarih: 2026-08-22

## Ne değişti

Komşu sancakların açık pazar emirlerinden çıkan net akış artık yerel fiyatı
gerçekten oynatıyor (±%6): satış akışı channel çapında bolluk sayılıp fiyatı
düşürüyor, alım akışı kıtlık sayılıp yükseltiyor. Toplamlar Fikir 1'in
`channelAverages` taramasından geliyor (ikinci bir channel sorgusu yok), çarpana
çeviren kural `engine/market.ts` → `channelPriceIndex` içinde tek kaynakta.
Endeks `GET /api/world` yanıtında salt okunur iniyor; kayda hiç girmiyor.
`engine/market.ts`'in "bu dosya yalnızca krallık içini ilgilendirir" yorumu bu
istisnayı anlatacak biçimde güncellendi.

## Neden

Her krallığın pazarı bugüne kadar kesinlikle izoleydi: bir sancağın büyük
alım/satımı komşusunun fiyatına hiç dokunmuyordu. Channel bir arada duruyor ama
iktisadi olarak birbirinden habersiz yaşıyordu; bu, "kendi kendine yaşayan
dünya" hedefinin pazar tarafındaki en büyük boşluğuydu. Plan belgesindeki karar
(2026-08-22) etkinin salt bilgi değil GERÇEK bir mekanik olmasını, eşiğin
channel büyüklüğüne göre ölçeklenmesini ve altyapının Fikir 1 ile paylaşılmasını
şart koşuyordu.

Bu maddenin asıl işi mekanik değil, İKİ RİSKİ KAPATMAKTI:

**1. İstismar.** `commons` istismarının (bkz. `server/save-validation.ts`,
"HALKIN DEFTERİ SUNUCUNUN") yeni bir sürümü doğabilirdi: istemci endeksi kendi
lehine bildirir, fiyatı kırar/şişirir ve üç denetimin (`checkMarketOrders` /
`checkGrowth` / `checkAgainstSimulation`) hiçbiri görmezdi çünkü hepsi kabul
aralığının içinde kalırdı. Çözüm `commons`'takinden bir adım ileri gitti:
endeks **kayda hiç girmedi**. Şemada alan olmadığı için istemcinin
bildirebileceği bir endeks yok ve `.strict()` şema böyle bir alan taşıyan kaydı
doğrudan reddediyor. Kralın kendi emirleri de endeksine girmiyor
(`excludeUserId`), yani kimse kendi fiyatını kıpırdatamıyor.

**2. Save reddi = ilerleme kaybı (CLAUDE.md #2).** Fiyat canlı bir channel
sayısına bağlanırsa istemci (saniyelik adımlar) ile sunucu (tek büyük adım) ayrı
fiyat hesaplar ve meşru kayıt 409 alır. İki sınırla kapatıldı:

- Endeks `livingCost`'a **girmiyor**. Geçim endeksi `tick()` içinde rızaya
  dönüşüyor; channel'dan gelen bir çarpan pencere içinde değişse iki taraf ayrı
  rızaya varırdı. `commonsGlut` da tam bu sebeple rızanın dışında tutuluyor.
- Endeks fiyat çarpanını mevcut `[PRICE_FLOOR, PRICE_CEILING]` aralığının
  **içinde** oynatıyor, dolayısıyla `orderGoldBounds` hiç genişlemedi. Aralık
  genişlese ya meşru emir tavanı aşıp 409 alırdı ya da her emir için istismar
  payı büyürdü. Emrin altını verilirken `gold` alanına damgalanıyor ve kapanışta
  `orderPayout` ile tek kalemde ödeniyor: iki taraf da canlı bir sayı değil
  damgayı okuyor.

Eşik sabit bir birim sayısı değil, channel'ın kendi normal kilerinin bir oranı
(`MARKET_INDEX.share`) ve channel hızına bölünmüş hâli — böylece küçük ve büyük,
yavaş ve hızlı channel'larda adil kalıyor. Etki hafif ve **iki yönlü** (satışa da
alışa da işliyor), makasın (SPREAD 1.6) çok altında: endeks bir fırsat değil,
bir hava durumu. Tek yönlü olsaydı Kral lehine olan kolu seçip onu bedava bir
indirime çevirirdi.

Kapanma vakti geçmiş emirler akıştan süzülüyor: böyle bir emir ancak o oyuncunun
istemcisi `tick()` attığında kayıttan düşer, yani terk edilmiş bir sancağın
kaydında sonsuza kadar durur ve süzülmeseydi tek bir ölü sancak channel'ın
fiyatını kalıcı olarak eğerdi. Bu şart aynı zamanda endeksin kendi kendine
sönmesini sağlıyor — ayrı bir sönüm terimi gerekmedi.

## Etkilenen dosyalar

- `engine/market.ts` (`MARKET_INDEX`, `NEUTRAL_INDEX`, `channelPriceIndex`,
  `indexedMultiplier`; `unitPrice`/`fillOrder`/`marketPrices` endeks alıyor;
  dosya başındaki izolasyon yorumu ve `livingCost` sınırı güncellendi)
- `engine/actions.ts` (`marketState` ve `applyActions` opsiyonel endeks alıyor)
- `server/world-projection.ts` (`channelAverages` aynı döngüde pazar toplamlarını
  da biriktiriyor; `ChannelAverages.market`)
- `app/api/world/route.ts` (endeksi üretip salt okunur olarak veriyor)
- `components/KingdomGame.tsx` (endeksi dünya yanıtından alıp pazara geçiriyor,
  Krala gösteren not)
- `app/globals.css` (`.market-index`)
- `tests/channel-market-index.test.ts` (yeni, 21 test)
- `tests/channel-averages.test.ts` (dönüş şekli `market: null` ile büyüdü)
- `package.json` (yeni test dosyası listeye eklendi)

## Test durumu

Dördü de temiz:

- `npx tsc --noEmit` → hata yok
- `npm test` → **575 test, 575 geçti, 0 başarısız** (taban 554 + 21 yeni)
- `npm run lint` → 0 hata, 1 uyarı (`react-hooks/exhaustive-deps`) — bu uyarı
  DEĞİŞİKLİK ÖNCESİ de aynen vardı, yalnızca satır numarası kaydı
- `npm run build` → tamamlandı

Yeni testler kararın şart koştuğu her başlığı kapsıyor: adım-bölünmesi
bağımsızlığı, istemcinin bildirdiği alanın reddi, endeks alanı olmayan eski
kaydın kabulü, eşiğin nüfus VE hız ile ölçeklenmesi, kabul aralığının
genişlememesi, Kralın kendi emirlerinin sayılmaması, gizlilik alt sınırı ve
uçtan uca "endeks gerçekten altını değiştiriyor".

**Mutasyon testi yapıldı.** Geçim endeksi sınırının testi ilk yazılışında
`livingCost`'u kendisiyle kıyaslıyordu ve endeks bilerek `livingCost`'a
sızdırıldığında sızıntıyı YAKALAMADI. Test beklenen değeri `priceMultiplier`'dan
elle kuracak biçimde yeniden yazıldı; aynı mutasyon artık kırılıyor.

## Takip gereken işler

- **Mevcut bir adım-bölünmesi sapması bulundu ve bu değişiklikle İLGİSİ YOK.**
  `tick()` halkın defterini ilerletirken referans stoğu (`commonsReference`)
  pencere başındaki nüfustan okuyor; nüfus pencere içinde değişirse tek büyük
  adım ile dakikalık adımlar AYRI yere geliyor (ölçülen: nüfus 500→250 düşen 6
  saatlik bir pencerede `commons.wood` 2000'e karşı 1764, ~%12 sapma).
  Değişiklikler geri alınıp (`git stash`) aynı ölçüm yapıldığında sayılar
  BİREBİR aynı çıktı, yani sapma bu maddeden önce de vardı. Rıza sapması ihmal
  edilebilir (~1e-13) olduğu için bugün 409 üretip üretmediği belirsiz;
  `advanceCommons` çağrısının referansını pencere boyunca sabitlemek ya da nüfus
  değişimini kapalı çözüme katmak ayrı bir madde olarak incelenmeli.
- Endeks yalnızca dünya yanıtı geldikten sonra etkili; ilk yükleme ile ilk
  dünya turu (10 saniye) arasında nötr. Nötr = bugünkü davranış olduğu için
  güvenli, ama Kral ilk saniyelerde fiyatın kıpırdadığını görebilir.
- Endeksi hareket ettirmek için gerçek kaynak ve gerçek makas maliyeti gerekiyor,
  ama iki oyuncunun anlaşıp birbirinin endeksini oynatması teorik olarak mümkün
  (±%6 ile sınırlı). Denge tarafı izlenmeli.
