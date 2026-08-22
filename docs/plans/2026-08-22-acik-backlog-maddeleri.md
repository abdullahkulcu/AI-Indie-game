# Demirkale — Açık Backlog Maddeleri

Tarih: 2026-08-22

## Bu belge nedir, nasıl kullanılır

Bu belge, kullanıcının önceki bir oturumdan getirdiği eski bir backlog
listesinin, bu oturumda kod tabanı üzerinde **madde madde, dosya/satır
referanslarıyla doğrulanmasından** doğdu. `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`'nin
aksine bu bir vizyon/fikir belgesi değil — **işlenecek bir kontrol
listesi**dir: her madde ya bugün gerçekten var olan, doğrulanmış bir eksik
ya da bilinçli olarak ertelenmiş bir karardır. Spekülatif yeni fikir
üretmek bu belgenin amacı değildir (o iş yukarıdaki vizyon belgesinde
yaşıyor).

Her madde için: **Kaynak** (kullanıcının eski listesi + bu oturumda kod
üzerinde doğrulandı), **Bugün en yakın ne var/eksik** (gerçek dosya/satır),
**Efor**, **Açık sorular**. İki istisna var (harita çakışması ve
yayın/operasyon notu) — onlar zaten çözülmüş ya da bu kod tabanından
doğrulanamayan operasyon adımları oldukları için efor/açık soru
taşımıyor, kısaca işaretleniyor.

---

## 1. Faz 6 düzeltmesi — göçün orantılı dağılımı (KARARA BAĞLANDI)

**Kaynak:** kullanıcının eski backlog listesi + bu oturumda doğrulandı ve
kullanıcı kendisi düzeltme yönüne karar verdi.

Bugün `engine/migration.ts` → `pickMigrationTarget` boş konutu olan
adaylar arasından **rulet çarkıyla TEK bir hedef** seçiyor (ağırlık = boş
konut × çekicilik, tohumlu `rand01` ile). `app/api/cron/route.ts` →
`settleMigrations`, hedef bulunamazsa (`pick` `null` ise, satır 680) ya da
hedefin boş konutu talebi karşılamıyorsa (satır 684) fazlayı `lost`
sayacına yazıp **kalıcı olarak yok ediyor** — kodun kendi yorumu bunu
"göçmenler kaybolur, tick()'in bugüne kadarki davranışının aynısı" diye
açıkça belgeliyor (satır 641-643).

Kullanıcı bunun **yanlış** olduğunu netleştirdi: halk asla kalıcı
kaybolmamalı (gelecekte yalnızca SAVAŞ halk ölümüne yol açabilir, göç
değil). Kabul edilen yön (kullanıcının kendi kararı, iki öneriyi
birleştiriyor):

- `pickMigrationTarget`, TEK hedef yerine, boş konutu olan **TÜM**
  adaylara ağırlıklı olarak orantılı dağıtan bir sonuç döndürmeli (örn.
  bir aday göçmenlerin %60'ını, biri %40'ını alır — bugünkü ağırlık
  formülü zaten var, yalnızca "tek çekiliş" yerine "orantılı bölüştürme"ye
  dönüşür).
- Hiçbir adayda yer kalmazsa (ya da dağıtımdan artan bir kısım kalırsa),
  o kısım **KAYNAK krallığa geri dönmeli** — `lost` gibi bir sayaçla asla
  yok edilmemeli.

Bu, "açık soru" değil — **uygulanacak karar**. Ama uygulama detayları
hâlâ açık:

- **Efor:** orta. `pickMigrationTarget`'ın dönüş tipi değişir (tek
  `MigrationTarget | null` yerine bir dizi/dağıtım listesi),
  `settleMigrations`'ın döngüsü buna göre güncellenir (satır 645-701),
  `tests/migration.test.ts`'teki tek-hedef varsayımıyla yazılmış testler
  güncellenir.
- **Açık sorular:**
  - Geri dönüş anlık mı (kaynağın nüfusuna hemen geri eklenir) yoksa yeni
    bir "dönüş yolculuğu" kaydı mı (`migrations` tablosuna ikinci bir
    satır, kendi `completesAt`'iyle)?
  - Orantılı dağıtımda yuvarlama nasıl yapılır (kesirli göçmen olmaz;
    hangi adayın "artan birimi" alacağı nasıl belirlenir — bugünkü
    `userId` sıralamasıyla tohumlu determinizm korunmalı mı)?
  - Tek bir cron turunda kaç adaya bölünebileceğine bir tavan var mı, yoksa
    boş konutu olan TÜM adaylar (channel büyükse onlarca krallık olabilir)
    pay alabilir mi?

---

## 2. Müzakere arayüzü — Kral kendi eliyle cevap yazamıyor

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.

`app/api/negotiate/route.ts` satır 156-160, `action==="reply"` işleyicisi
`speaker: body.speaker === "general" ? "general" : "king"` ile **tam
hazır** — sunucu tarafı Kralın kendi adına mesaj yazmasını zaten
destekliyor. Ama `components/KingdomGame.tsx` satır 312'de `action:"reply"`
yalnızca `speaker:"general"` sabit üretiliyor (General'in `reply_negotiation`
aracı çağrıldığında, satır 296-312). Kralın kendi serbest metnini
yazabildiği tek yerler: `envoyMessage` (masa **açarken**, satır 191,
419-420) ve `envoyTerm.note` (şart **sunarken**, satır 220-231). Açık bir
masada düz metinle cevap verecek bir input/buton yok.

- **Bugün en yakın ne var / eksik:** sunucu ucu hazır, yalnızca arayüzde
  bir metin kutusu + `action:"reply", speaker:"king"` gönderen bir
  fonksiyon eksik.
- **Efor:** küçük.
- **Açık sorular:**
  - Kral cevap yazınca General bu turda hiç konuşmasın mı, yoksa Kral
    yazdıktan sonra General de ayrıca konuşabilir mi?
  - Kralın yazdığı serbest metin, mevcut `MAX_MESSAGE_LENGTH` sınırına mı
    tabi olacak, yoksa ekstra bir filtre (küfür/enjeksiyon vb.) gerekir
    mi?

---

## 3. Gece vardiyası / kalıcı emir — iki ayrı eksik

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.

**3a. `max_actions_per_wake` hiç okunmuyor.** `db/schema.ts:149` →
`standingOrders.maxActionsPerWake` sütunu (varsayılan 1) tanımlı,
`server/night-shift.ts`'teki `StandingOrder` tipi de bu alanı taşıyor
(satır 20). Ama `app/api/cron/route.ts` → `runOne` (satır 91) içinde bu
alan **hiçbir yerde okunmuyor** — kod her uyanışta örtük olarak en fazla 1
eylem varsayımıyla yazılmış (`actionsToday` her çağrıda 1 artıyor, satır
189/201).

**3b. Gece vardiyası deftere hiç yazmıyor.** `appendToLedger`
(`server/general-ledger.ts:39`) yalnızca `app/api/general/route.ts`
içinden çağrılıyor (satır 479, 575 — Kral çevrimiçiyken General'le
konuştuğu akış). `app/api/cron/route.ts` bu fonksiyonu hiç import
etmiyor — gece vardiyasının yaptığı/yapmadığı hiçbir şey
`general_ledger`'a girmiyor, General ertesi gün "dün gece ne oldu" diye
hatırlamıyor.

- **Efor:** orta — ikisi de `runOne`'a dokunur. `maxActionsPerWake`
  desteği bugün tek bir öneri hesaplayan akışı bir döngüye çevirmeyi
  gerektirir; ledger entegrasyonu, `deriveLedgerEvents`'in (bugün yalnızca
  Kral-General sohbet turu için tasarlı) gece vardiyası bağlamında ne
  üreteceğinin tanımlanmasını gerektirir — doğrudan uymayabilir.
- **Açık sorular:**
  - `maxActionsPerWake > 1` olursa her eylem ayrı ayrı mı değerlendirilir
    (garnizon vetosu, risk değerlendirmesi her biri için tekrar mı
    çalışır)?
  - Ledger'a gece vardiyası turları hangi `LedgerKind` ile girecek — yeni
    bir tür mü gerekir?

---

## 4. İnşaat — eşzamanlı kuyruk yok

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.

`engine/types.ts:85` → `queue: Queue | null` — tek yuvalı, bir krallık
aynı anda yalnızca bir inşaat sürdürebiliyor.

- **Efor:** büyük — `queue` diziye dönüşür; motor (`engine/tick.ts`,
  `engine/actions.ts`), şema (`server/save-validation.ts`), sunucu,
  General'in `build_structure` aracı, arayüz (`components/KingdomGame.tsx`)
  ve gece vardiyası hepsi etkilenir. (Kullanıcının kendi notu: "orta-büyük
  iş.")
- **Açık sorular:**
  - Eşzamanlı kaç inşaat yuvası olacak — sabit mi, yoksa bir binaya mı
    bağlı (örn. Kale seviyesi arttıkça yuva sayısı artar mı)?
  - Kaynak rezervasyonu nasıl olur — birden fazla inşaat aynı anda kaynak
    mı kilitler, yoksa yalnızca sıraya girdiği anda mı düşülür?

---

## 5. Ölü alanlar

**5a. `"expired"` durumu hiç yazılmıyor.** `engine/negotiation.ts` →
`NegotiationStatus` (satır 56-61) ve `db/schema.ts:299` bu değeri
tanımlıyor, `tests/negotiation.test.ts` (satır 379-381) `canDecline`
üzerinden test ediyor — ama `app/api/negotiate/route.ts`'te
`db.update(negotiations)` çağrılarının hiçbiri (`"declined"`, satır 188;
`"agreed"`, satır 212) `"expired"` yazmıyor. Süresi geçen masalar
sorgulardan `expiresAt` filtresiyle dışlanıyor ama DB'deki durumları hiç
değişmiyor — kalıcı "ölü" satırlar birikiyor.

- **Bugün en yakın ne var / eksik:** durum tanımlı ve test edilmiş, yazan
  bir yol yok.
- **Efor:** küçük — cron'a bir temizlik adımı (`update ... where status
  in (open, awaiting_king) and expiresAt <= now`).
- **Açık sorular:** yok — kapsamı net, tek bir sorgu eklemek yeterli.

**5b. Harita çakışması — TAMAMLANDI, aksiyon gerekmiyor.**
`engine/world-map.ts` satır 11-12'deki yorum ("Önceki hash tabanlı
yerleşim 300 oyuncuda 36 tam çakışma üretiyordu") ve
`tests/world-map.test.ts` satır 27-46'daki testler ("300 oyuncuda tam
çakışma yok" / "300 oyuncuda üst üste binme yok") bunun çözüldüğünü
doğruluyor — konumlar artık üyelik sırasından deterministik türetiliyor,
hash tabanlı çakışma riski yok. Bu madde backlog'dan düşürülmeli.

---

## 6. Ekonomi — halkın parası (büyük, tasarlanmadı)

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.

`engine/types.ts` → `Game` yalnızca krallık hazinesini taşıyor
(`resources.gold`, `RESOURCE_KEYS`); bireysel vatandaş cüzdanı/bütçesi
diye bir kavram yok. Kullanıcının kendi notu: "büyük, tasarlanmadı." Bu,
bilinen bir açık alan olarak kaydediliyor — henüz tasarım aşamasında
olmadığı için spekülatif alt-soru üretilmiyor.

---

## 7. Büyük özellikler — duraklatılmış

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.
`app/api/general/route.ts` satır 160'taki General'in kendi sistem
promptu bile şunu söylüyor: *"Ticaret, diplomasi, ittifak, saldırı,
kuşatma, kaynak bağışı, kredi, kervan ve pazarlık gibi araç listesinde
karşılığı olmayan işleri yapabilirmiş gibi konuşma... Kral olmayan bir
şeyi isterse 'bu krallıkta böyle bir şey yok' diye açıkça söyle."* —
yani bu dört alt madde kod tarafından da açıkça "yok" diye işaretlenmiş
durumda.

- **7a. Savaş sistemi.** Kral açıkça "BAŞLATMA" dedi — kullanıcı isteğiyle
  duraklatıldı. Efor/açık soru üretilmiyor.
- **7b. Kervan pazarı (oyuncular arası doğrudan ticaret).** Bugün yalnızca
  müzakere/haraç üzerinden dolaylı kaynak transferi var
  (`engine/negotiation.ts`'in `tributeAmount`/`tributeRate` şartları),
  doğrudan bir pazar mekanizması yok.
- **7c. Bölgeye özel üretim kolları.** `engine/catalog.ts`'te terrain
  başına yalnızca üretim çarpanları var (örn. `mountain: { stone: 1.3,
  iron: 1.3, ... }`), altın yıkama/deri/kömür gibi terrain'e özgü YENİ
  bina/kaynak türü yok.
- **7d. Gerçek hayat bildirimleri.** `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`'de
  (Fikir 4: Slack bildirimi, tek yönlü; Fikir 12: Slack üzerinden iki
  yönlü karar) zaten ele alınıyor — burada tekrar edilmiyor, yalnızca
  referans veriliyor.

---

## 8. Denge kaygıları (ölçüm gerekiyor, aksiyon değil)

**Kaynak:** kullanıcının eski backlog listesi, bu oturumda doğrulandı.
Bunlar henüz bug değil, gözlem — "Efor" değil "Ölçüm gerekiyor" başlığıyla
kaydediliyor.

- **Dağ arazisi çifte ceza olabilir.** `engine/catalog.ts` →
  `mountain: { defense: 1.25 }` (+%25 savunma) tanımlı, ama
  `engine/raids.ts` → `mountain: { chance: .24, weights: { mountain_raiders: .5 } }`
  — dağ arazisi hem **en yüksek akın ihtimaline** (%24, diğer üç
  terrain'de .13-.16) hem de **en ağır akın türünün** (Dağ Akıncıları,
  `power: 16`, listedeki en yüksek değer) **en yüksek ihtimaline** (%50)
  aynı anda sahip. Savunma bonusunun bunu telafi edip etmediği
  ölçülmedi.
- **`DAY_MS` channel hızından bağımsız.** `server/night-shift.ts:30` →
  `const DAY_MS = 24 * 60 * 60_000` — sabit gerçek-zaman 24 saat,
  `channels.speed` (×1/×4/×24) çarpanından tamamen bağımsız. Hızlı bir
  channel'da oyun-içi bir "gün" çok daha hızlı geçtiği için, General'in
  günlük eylem tavanı (`dailyActionCap`) o channel'da orantısız kısıtlayıcı
  olabilir.
- **Varsayılan nöbet oranı ve taş/odun asimetrisi — doğrulanmadı.** Bu
  ikisi için kodda tek, net bir sabit bulunamadı; ayrıca bakılması
  gerekiyor. Dürüstçe işaretleniyor: bu alt madde henüz teyit edilmedi,
  uydurulmadı.

---

## 9. Yayın/operasyon

**Kaynak:** kullanıcının eski backlog listesi.

TLS/prod profili hazır ama uçtan uca denenmedi. Bu, kod tabanından
doğrulanabilecek bir madde değil — kullanıcının kendisinin yapması
gereken bir operasyon adımı. Efor/açık soru üretilmiyor.

---

## Bağımsız teknik borç — `populationChange` adım-bölünmesi bağımsızlığı

**Kaynak:** bu oturumda, CLAUDE.md kısıt #2'yi tararken ayrıca bulundu.

Bu, kod tabanının **en hassas** noktasına dokunuyor (CLAUDE.md kısıt #2:
istemcinin saniyelik `tick()`'i ile sunucunun tek-büyük-adım `tick()`'i
aynı `now` için AYNI sonucu üretmek zorunda). `engine/populace.ts` →
`populationChange` (satır 270-281):

```ts
export function populationChange(state, population, capacity, buildings, hours) {
  if (population <= 0 || hours <= 0) return 0;
  if (state.populationRate < 0) return population * state.populationRate * hours;
  const room = capacity > 0 ? Math.max(0, 1 - population / capacity) : 0;
  return population * state.populationRate * growthMultiplier(buildings) * room * hours;
}
```

Büyümede `room = 1 - population/capacity` terimi adım **içinde sabit**
varsayılıyor (gerçekte nüfus arttıkça bu terim değişir); kayıpta da
kapalı-çözüm bir üstel değil, `population × rate × hours` (düz Euler
yaklaşıklığı). Bu, `engine/faction.ts` → `advanceFaction` ve
`engine/market.ts` → `advanceCommons`'ın izlediği kapalı-çözüm üstel
desenden **farklı** — o iki fonksiyon adım-bölünmesinden matematiksel
olarak bağımsız olduğunu garanti ederken, `populationChange` için bu
garanti YOK.

`tests/populace.test.ts` satır 182-187'deki tek ilgili test yalnızca kaba
bir büyüklük kontrolü yapıyor ("bir haftada 24'ten 240'a çıkmalı, çıkan:
...") — tek-büyük-adım ile saatlik-küçük-adımların birbirine **eşit**
olduğunu doğrulayan hiçbir test yok. CLAUDE.md'nin kendi notuna göre
(kısıt #2) bu tür bir sapma bu tarihte birden fazla kez gerçek bir hataya
(`engine/storage.ts`, `engine/market.ts`'teki "kapalı çözüm" yorumlarına
yol açan olaylar) dönüşmüş; `populationChange` bu listeye henüz
girmedi ama aynı riski taşıyor.

- **Efor:** orta-büyük — iki yoldan biri:
  1. `populationChange`'i `advanceCommons`/`advanceFaction` gibi
     kapalı-çözüm üstel forma çevirmek (davranış hafifçe değişir,
     dikkatli kalibrasyon ister).
  2. Matematiği değiştirmeden, yalnızca "büyük fark yaratmadığını" ölçüp
     kabul eden bir adım-bölünmesi-bağımsızlığı testi eklemek (davranışı
     değiştirmez, yalnızca bugünkü sapmanın kabul edilebilir sınırlarda
     kaldığını belgeler).
- **Açık soru:** hangi yaklaşım tercih edilecek — matematiği düzelt mi,
  yoksa mevcut sapmanın kabul edilebilir olduğunu bir testle belgeleyip
  öyle mi bırak?
