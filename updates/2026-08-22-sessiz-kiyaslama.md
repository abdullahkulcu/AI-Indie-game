# Sessiz kıyaslama — halk kendini komşu sancaklarla kıyaslasın

Tarih: 2026-08-22

## Ne değişti

Plan belgesindeki **Fikir 13 (sessiz kıyaslama)** uygulandı: halk artık yalnızca
kendi mutlak hâline değil, channel'daki komşu sancakların ANONİM ortalamasına da
bakıyor ve geride kaldığında yeni bir talep türü (`DemandKind = "kiyas"`) açıyor.
Talep, ekmek ve maaş gibi diğer taleplerle **aynı `MAX_OPEN_DEMANDS` tavanını
paylaşır** — kıyas için ayrı bir kategori ya da ayrı bir tavan açılmadı.
Ortalamanın hesabı yeniden yazılmadı; Fikir 1'in `channelAverages` fonksiyonu
`server/world-projection.ts` içine eklenen `populaceComparison` üzerinden
paylaşılıyor. Motor tarafı saf kaldı: kıyas verisi `VoiceSignals.comparison`
alanıyla dışarıdan parametre olarak giriyor.

## Neden

Vizyon belgesinin taşıyıcı ilkesi **asimetrik bilgi akışı**: Kral komşusunun
verisine erişmez, yalnızca kendi halkının o veriye verdiği TEPKİYİ görür. Fikir 1
aynı ortalamayı Kral'a doğrudan bir gösterge olarak veriyordu; bu madde aynı
veriyi Halk'ın kendi tarafında bir BASKIYA çeviriyor. Böylece "komşu sancakta
halk daha rahat yaşıyor, biz neden böyleyiz" cümlesi oyunda gerçekten kurulabilir
hâle geliyor ve kıyas paneli tek yönlü bir okuma aracı olmaktan çıkıp dünyanın
canlı bir baskı kanalına dönüşüyor.

Bilgi sınırı bu yüzden kodun içine yazıldı, yoruma bırakılmadı: kıyas metni
**hiçbir krallık adı/kimliği taşımaz** ve **hiç sayı vermez** ("komşu sancakta
vergi %12" gibi bir cümle Krala komşunun verisini birebir verirdi). Yalnızca
nitel bir kıyas kurulur ("oradaki sofralar bizimkinden dolu"). Bu sınırı bir
test doğruluyor.

## Mimari sapma — kararda "cron" yazıyordu, ritim talep senkronuna bağlandı

Plan belgesindeki karar "kıyaslama saatlik cron turunda yenilenir, Fikir 1 ile
aynı ritimde" diyordu. Uygulama bunu **cron'a değil, talep senkronunun ritmine**
bağladı. Bu bilinçli bir sapmadır ve gerekçesi:

- `syncPopulaceDemands` bugün **YALNIZCA** `app/api/general/route.ts` →
  `loadPopulaceVoice`'tan çağrılıyor; `app/api/cron/route.ts` halk taleplerine
  hiç dokunmuyor. Kıyası cron'a taşımak, oyuncu-başına saatlik yeni bir talep
  turu açmak demekti — anlamlı bir maliyet ve karmaşıklık artışı.
- Kararın "saatlik" vurgusunun amacı **her tick'te yeniden hesaplamamak**tı; bu
  yol o amacı zaten sağlıyor (kıyas yalnızca Kral General'le konuştuğunda, tek
  bir ek DB sorgusuyla hesaplanır).
- Diğer TÜM talepler de yalnızca Kral konuşurken açılıyor. Kıyası ayrı bir ritme
  koymak halkın sesinde iki farklı davranış yaratırdı.

**Sonuç (kabul edilen davranış):** Kral uzun süre General'le konuşmazsa kıyas
talebi de o süre boyunca yenilenmez. Bu, bugün bütün halk talepleri için geçerli
olan davranışın aynısıdır — kıyasa özel bir gerileme değil.

Sapma yalnızca burada değil, kodun içinde de belgelendi: `loadComparison`
fonksiyonunun başlığında ve `server/world-projection.ts` → `channelAverages`
yorumundaki "Fikir 13" satırında.

## Eşikler ve neden bu değerler

`VOICE_THRESHOLDS.kiyas` içinde, diğer kalemlerle aynı desende:

- `margin` — bir ölçütte "belirgin geride" saymak için gereken en küçük fark.
  Ölçekler ortak olmadığı için ölçüt başına ayrı yazıldı: rıza **10** (normal
  krallık 42-46 ile iyi krallık 62-67 arasındaki ~20 puanlık bandın yarısı),
  istihkak **10** (`bread` eşiğiyle, 100 → 85, aynı mertebe), vergi **6**
  (0-50 bandının ~sekizde biri), muhalefet baskısı **15**
  (`FACTION_THRESHOLDS.stirring` = 20'nin bir tık altı; iyi yönetilen krallıkta
  baskı 0 olduğu için bu fark ancak bizde gerçek örgütlenme varken doğar).
- `metrics: 2` — talep için **iki** ölçütte birden geride olmak şart. Tek
  ölçütte geride olmak meşru bir tercih olabilir (Kral bilinçli olarak yüksek
  vergiyle inşaat yapıyordur); iki ölçütte birden geride olmak ise halkın
  hayatının gerçekten daha zor olması demek.
- `hours: 8` — listenin en uzun süre şartı (`bread`in iki katı). Kıyas bir
  aciliyet değil arka plan sinyali; ayrıca ortalama komşular oynadıkça kayar,
  kısa bir süre şartı komşunun tek hamlesini bizim halkımızın talebine çevirirdi.

Dosyanın felsefesine iki noktada uyuldu: **iyi yönetilen krallıkta talep hiç
açılmaz** (ortalamadan iyiysek kıyas doğmaz) ve **tek tick'lik dalgalanma talep
açmaz** (8 oyun saati kesintisiz süre şartı).

`urgent` eşiği KASITLI olarak eklenmedi: kıyas talebi hiçbir zaman acil olmaz ve
aday listesinde en sonda durur. Bu, plan belgesinin kendi açık sorusunu ("kıyas
talebi diğer daha somut taleplerin önüne geçip yer kaplayabilir") doğrudan
cevaplıyor — açlık ya da firar gibi acil bir talep varken kıyas tavandaki yeri
ondan alamaz.

## "Değirmen dersi"nin buradaki karşılığı

İki yerde uygulandı:

1. **Ortalama yoksa talep açılmaz.** `channelAverages` gizlilik alt sınırının
   (`COMPARE_MIN_SAMPLE` = 3 sancak) altında `averages: null` döner; o durumda
   kıyas talebi KESİNLİKLE doğmaz. Dayanağı olmayan bir kıyas Kralı ölçüsüz bir
   işe çağırırdı.
2. **Talep yalnızca geride olduğumuz ölçütün emriyle kapanır.** `satisfiedBy`,
   fiilen geride kaldığımız ölçütlerin çarelerinin birleşimidir; Kral ilgisiz
   bir masrafa çağrılmaz. Muhalefet baskısının çaresi rızayı yükselten emirler
   olarak yazıldı, çünkü `engine/faction.ts` gereği bastırma emri YOKTUR.

## Tek-doğru-kaynak notları

- Ölçüt listesi, "iyi" yön ve gizlilik alt sınırı `engine/comparison.ts`'ten
  okunuyor; `engine/populace-voice.ts` bunların hiçbirini yeniden yazmıyor.
- Ortalamanın hesabı `channelAverages`'te kalıyor; `populaceComparison` onu
  çağırıyor, kendi ortalamasını kurmuyor.
- Kıyasın İKİ tarafı da aynı boru hattından geçiyor (`parseStoredSave` →
  `compareValuesOf`). "Bizdeki değer"i istemcinin gönderdiği bağlamdan okumak
  ölçeği bozardı: istemci bağlamında muhalefet baskısı hiç yok ve istihkak
  kâğıt üstündeki değil fiilen dağıtılan orandır.
- `loadPopulaceVoice` içindeki elle yazılmış üyelik sorgusu silindi; artık tek
  kaynak olan `activeMembershipOf`'tan okuyor. Eski kopya channel'ın kendi
  durumunu hiç sormuyordu ve sırasızdı — kapatılmış bir sezonun üyeliğini
  seçebiliyordu.

## Save şeması

Kayda yeni bir alan YAZILMADI; `VoiceSignals.comparison` yalnızca istek başına
hesaplanan bir girdi. Dolayısıyla CLAUDE.md kısıt #3 (`.strict()` şema) devreye
girmiyor ve eski kayıtlar etkilenmiyor. `populace_demands.kind` kolonu serbest
metin olduğu için yeni `"kiyas"` türü için DB göçü de gerekmiyor.

## Etkilenen dosyalar

- `engine/populace-voice.ts` (`"kiyas"` türü, `VOICE_THRESHOLDS.kiyas`,
  `VoiceSignals.comparison`, `comparisonDemand`, `COMPARE_COMPLAINT`,
  `COMPARE_REMEDY`)
- `server/world-projection.ts` (`populaceComparison`; `channelAverages`
  yorumundaki Fikir 13 ritim notu)
- `app/api/general/route.ts` (`loadPopulaceVoice` artık `activeMembershipOf`
  kullanıyor; yeni `loadComparison`)
- `tests/populace-voice.test.ts` (11 yeni test)
- `docs/PHASES.md` (§4 tablosuna Fikir 13 satırı)

## Test durumu

- `npx tsc --noEmit` → temiz (çıktı yok).
- `npm test` → **502 test, 502 geçti, 0 başarısız** (önceki 491 + 11 yeni).
- `npm run lint` → 0 hata, 1 uyarı: `components/KingdomGame.tsx` içindeki
  ÖNCEDEN VAR OLAN `react-hooks/exhaustive-deps` uyarısı. Bu değişiklikle
  ilgisiz.

## Takip gereken işler

- **Arayüz:** "halk" sekmesi açık talepleri metinlerinden gösterdiği için yeni
  tür kendiliğinden görünüyor; kıyas talebine özel bir ikon/etiket istenirse
  ayrı bir iş.
- **Ritim:** İleride cron'a oyuncu-başına bir tur eklenirse (Fikir 24 gibi başka
  bir madde bunu zaten gerektirebilir) kıyasın oraya taşınması yeniden
  değerlendirilebilir; o zaman bu belgedeki sapma notu güncellenmeli.
