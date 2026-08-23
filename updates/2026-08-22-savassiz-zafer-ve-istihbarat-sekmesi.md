# Savaşsız zafer: İSTİHBARAT sekmesi ve zafer skoru

Tarih: 2026-08-22

## Ne değişti

Plan belgesindeki **Fikir 3** ("asker olmadan savaşı ana anlatıya taşımak") ve
altındaki 2026-08-22 kararı uygulandı. Arayüze yedinci bir sekme — **İSTİHBARAT**
— eklendi ve komşuya yönelik üç panel ("DIŞ KESE", "KARŞI-İSTİHBARAT", "HAYDUT
YÖNLENDİRME") `diyar` ve `ordu` sekmelerinden oraya **taşındı**; eski yerlerinde
kopyaları bırakılmadı. Sekmenin başına **zafer skoru** konuldu: sezon ölçütü
`engine/victory.ts` içinde saf ve tek kaynak olarak yaşıyor, askersiz üstünlük
ile askeri katkıyı ayrı iki sütunda gösteriyor. Sunucu tarafında
`channelVictoryStanding` channel içindeki sıramızı hesaplıyor; komşunun skoru,
adı ve kalemleri istemciye hiç inmiyor. General'in sistem promptuna savaşsız
zafer doktrini eklendi (katsayı yazılmadı).

## Neden

Oyunun iddiası "asıl mesele savaşmak değil" ama arayüz bunun tersini
söylüyordu: sabotaj araçları iki ayrı sekmenin dibinde birer satırdı, bina ve
asker ise en baştaydı. Mekanik zaten TAMDI (Faz 4/5/7); eksik olan görünürlük ve
çerçevelemeydi.

İkinci eksik, "zafer"in bu oyunda hiç tanımlanmamış olmasıydı — channel'lar
yalnızca süreye bağlı bitiyor (`channels.durationDays`), yani Kral iyi mi kötü
mü oynadığını okuyabileceği hiçbir ölçüte sahip değildi. Skorun **iki sütunlu**
olması bir süsleme değil, maddenin bütün fikri: tek bir sayı "askersiz kazandım"
ile "surumu iyi savundum"u aynı torbaya atar ve vizyonun ayrımını görünmez
kılar.

## Verilen yargı kararları (ve gerekçeleri)

**Muhalefet paneli `halk` sekmesinde KALDI.** Plan metni "dış kese, haydut
yönlendirme ve muhalefet" diyordu ama muhalefet **kendi** halkımızın rızasıyla
ilgilidir ve tek çıkışı istihkak/vergi/konut kararlarıdır
(`engine/faction.ts`); onu İSTİHBARAT'a almak, halkı komşu gibi bir "hedef"
sayan yanlış bir okuma üretirdi. Kural şu hâle getirildi: **bu sekme dışa,
`halk` sekmesi içe bakar.** Aynı gerekçeyle akın defteri (püskürtülen/yarılan +
son akınlar) `ordu` sekmesinde bırakıldı; oraya taşınan tek şey "eşkıya kimin
eliyle bu tarafa çekiliyor" satırı oldu, çünkü o bir garnizon raporu değil
komşuya dair bir istihbarat bulgusudur.

**Channel kıyası (Fikir 1) ve ajan/keşif listesi `diyar`da bırakıldı.** İkisi de
komşuya dair, yani taşınmaları savunulabilirdi; ama karar metni üç paneli
sayıyor ve keşif listesi taşınırsa `diyar` sekmesi harita+arazi kabuğuna iner.
Kapsam karar metninin harfinde tutuldu.

**Yeni DB sütunu / save şeması alanı açılmadı.** Skorun bütün girdileri zaten
vardı: `reputation`, `peopleJoined`/`peopleLeft`, `raidsRepelled`/
`raidsSuffered` (kayıt) ve `agitations.status` (veritabanı). Bu yüzden CLAUDE.md
kısıt #3 hiç devreye girmedi — şema, `SERVER_DERIVED` listesi ve `engine/types.ts`
değişmedi.

## Zafer skorunun formülü

Askersiz sütun (`quiet`):

| Kalem | Puan |
| --- | --- |
| Sessizce ulaşan kese (`status="settled"`) | **+6** / kese, **hedef başına en çok 6 kese** |
| Yakalanan kesemiz (`status="exposed"`) | **−3** / kese (tavansız) |
| Karşı-istihbaratımızın yakaladığı yabancı kese | **+4** / kese |
| Nüfus defterinin NET bakiyesi (`peopleJoined − peopleLeft`) | **+0,25** / kişi (eksiye de düşer) |
| İtibarın kuruluş değerinden (50) sapması | **+0,6** / puan (iki yöne) |

Askeri sütun (`martial`):

| Kalem | Puan |
| --- | --- |
| Kayıpsız püskürtülen akın | **+3** |
| Surdan içeri giren akın | **−4** |

Her satır ayrı yuvarlanır ve sütun toplamı yuvarlanmış satırlardan çıkar, yani
panelde görünen satırlar sütuna birebir toplanır (kıyas panelindeki aynı
disiplin). `total = quiet + martial`. Doktrin etiketi sütunların ağırlığını
okur: askersiz sütun askerinin en az iki katıysa "SESSİZ ÜSTÜNLÜK", askeri sütun
öndeyse "KILIÇ VE SUR", ikisi de sıfır/eksiyse "HENÜZ ÖLÇÜLEN BİR ŞEY YOK".

**İstismar frenleri** (üçü de kodda yorumlu, üçü de testli):

1. **Göç çevrimi.** Puan `peopleJoined`'a değil NET bakiyeye yazılır. Rızayı
   düşürüp yükselterek halkı göçe zorlayıp geri toplamak defterin iki tarafını
   eşit büyütür → net sıfır. Net eksiye de düşebilir: halkını kaybetmek sessiz
   savaşı kaybetmektir, nötr değil.
2. **Ölü sancağı sondalamak.** Sessiz kese hedef başına tavanlı; tavan olmasa en
   verimli strateji, nöbet kurmayan (dolayısıyla asla ifşa etmeyen) terk edilmiş
   tek bir sancağa gün boyu kese yağdırmak olurdu. Tavan mekaniğin kendisini
   yansıtıyor: kesenin etkisi de tavanlı ve sönümlü
   (`AGITATION.commons.cap / perPurse ≈ 1,2 kese`).
3. **Danışıklı ifşa.** İki Kral anlaşıp biri diğerine kese gönderse: yakalayan
   +4, gönderen −3 (kese) ve −6 (itibar ×0,6) → çift toplamda −5 puan ve 600
   altın. Kârlı değil.

Ayrıca ceza kalemine tavan uygulanmadı: tavan cezaya da işlese, aynı hedefe
altıdan fazla kese yollayıp hepsi yakalanan Kral son keselerinin bedelini
ödemezdi. `pending` keseler hiç sayılmaz — kaderi belli olmayan kese ne puan ne
ceza getirir.

**Skor bir göstergedir:** sezonu bitirmez, kimseyi kazanan ilan etmez. Otomatik
sezon kapanışı ayrı bir iştir.

## Gizlilik

Sıralama sunucuda hesaplanır (`channelVictoryStanding`) ve istemciye yalnızca
**kendi** kese defterimiz + **sıra sayımız** iner. Komşunun skoru, kimliği ve
kalemleri hiçbir koşulda gitmez. Gizlilik alt sınırı Fikir 1 ile aynı sabittir
(`COMPARE_MIN_SAMPLE`): bizden başka en az üç sancak yoksa sıra HİÇ üretilmez —
iki sancaklı bir sıralamada "1/2" görmek komşunun skorunu kendi skorumuzla
birebir çözerdi. Kuruluş koruması süren sancak (Kralın kendisi dâhil)
sıralamaya girmez.

## Etkilenen dosyalar

- `engine/victory.ts` (yeni — formül, istismar frenleri, doktrin okunuşu)
- `server/world-projection.ts` (`channelVictoryStanding`)
- `app/api/world/route.ts` (`victory` alanı, `VICTORY_PURSE_LIMIT`)
- `components/KingdomGame.tsx` (`istihbarat` sekmesi, taşınan paneller, skor paneli)
- `app/game.css` (`.tabs.seven`, `.victory-*`; ölen `.raid-lure` kuralı kaldırıldı)
- `app/api/general/route.ts` (savaşsız zafer doktrini — katsayı YOK)
- `tests/victory.test.ts`, `tests/istihbarat-tab.test.ts` (yeni)
- `package.json` (iki yeni test dosyası listeye eklendi)
- `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`

## Test durumu

Dördü de temiz:

- `npx tsc --noEmit` → hata yok.
- `npm test` → **580 test, 580 geçti** (önceki 554 + 26 yeni).
- `npm run lint` → 0 hata, 1 uyarı (`components/KingdomGame.tsx`
  `react-hooks/exhaustive-deps` — bu değişiklikten ÖNCE de vardı).
- `npm run build` → başarılı.

`tests/istihbarat-tab.test.ts` bilinçli olarak kaynak metnini denetler: bu kod
tabanında hiç render testi yok ve taşımanın gerçek riski mantık değil muhasebe
(panel kaybolur, kopya kalır, düğme çağırdığı fonksiyondan kopar). Test her
paneli TEK bir sekme bloğunda arıyor ve düğmelerin çağrılarının bağlı olduğunu
doğruluyor; paneli ileride taşıyan bir değişiklik bu testi güncellemek zorunda
kalacak, yani taşıma sessizce olmayacak.

## Takip gereken işler

- **Sezonun otomatik kapanışı ve kazanan ilanı** yazılmadı (karar gereği). Skor
  bugün yalnızca bir göstergedir.
- **`peopleJoined` ayrıştırılamıyor:** doğal büyüme, `call_settlers` kervanı ve
  komşudan gelen göç aynı sayaca yazılıyor; gelen göçmenin KAYNAĞI hiçbir yerde
  saklanmıyor (`migrations` tablosu hedefi kuyruğa alma anında seçmez). Bu yüzden
  "komşudan çekilen halk" payı bugünkü veriyle ölçülemedi ve kalem ölçülü
  ağırlıkta bırakıldı. Kaynak taşınırsa bu kalem keskinleştirilebilir.
- **Katsayılar sahada ölçülmedi.** Ölçekler "aktif bir sezonda üç kalem
  birbirini bastırmasın" mantığıyla seçildi; gerçek bir channel'ın sonunda
  sütunların dengesine bakmak gerekir.
- **Sıra kayıtlı durumdan çıkıyor**, kendi skorumuz ise canlı durumdan; sıra
  kılpayı gecikebilir. Kaba bir gösterge olarak kabul edildi.
