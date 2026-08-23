# Maden tükenince ortaya çıkan fırsat (Fikir 23)

Tarih: 2026-08-23

## Ne değişti

Damar tükendiğinde (`oreRemaining <= 0`) aynı bölgede tohumlu bir keşif
beliriyor: define (altın), yıkık kale (taş) ya da terk edilmiş galeri (demir).
Tür, miktar ve konum `engine/mine.ts` → `mineFindOf` ile channel + tükenme
anından türetiliyor. Fırsatı **tek bir sancak** alıyor; kazanan koşullu bir
veritabanı UPDATE'iyle belirleniyor. Ulaşmak için madende işçi bulundurmak
şart; kimse almazsa fırsat beklemede kalıyor ve sonradan da alınabiliyor.
Yeni bir tablo eklendi (`shared_mine_finds`), mevcut tablolara dokunulmadı.

## Neden

Damar bugüne kadar tükenince üretim sessizce duruyordu: madenin ölümü hiçbir
şey tetiklemiyordu ve panel bir süre sonra anlamsız bir kutuya dönüşüyordu.
Vizyonun "kendi kendine yaşayan dünya" ekseni tam olarak bunu istiyor —
bitişin bir olaya dönüşmesi, kim ilk fark edip tepki verirse kazandığı kısa ve
yoğun bir an (günlük alışkanlık motivasyonuna da katkı).

**Tek-kazananlı olmasının gerekçesi** plan kararında yazılı ve Fikir 22'nin
sürekli paylaşımlı doğasından bilinçli olarak farklı: maden işbirlikçi ve
rekabetçi bir yer, tükenme-sonrası olay ise tek bir an. İkisi tutarsızlık
değil, farklı anları temsil ediyor.

**Neden ayrı tablo (plandan sapma).** Plan notu "mevcut UNIQUE index
kaldırılmalı ya da aktif bir durum alanı eklenmeli" diyordu, çünkü
`idx_shared_mines_channel` channel başına tek maden satırına izin veriyor.
Index KALDIRILMADI: o index madenin tekilliğini veritabanı seviyesinde tutan
şey ve `app/api/mine/route.ts` madeni `mine:<channelId>` kimliğiyle upsert
ediyor — kaldırmak, yıkıcı olmayan bir migrasyonu yıkıcı bir belirsizliğe
çevirirdi (ve "iki maden satırı" ihtimali madenin bütün hesabını yeniden
düşünmeyi gerektirirdi). Fırsat ayrı bir tabloda durunca migrasyon tamamen
additive kalıyor. Planın gerçek niyeti "damarın satırı fırsatı taşıyamaz" idi;
o niyet karşılandı, yalnızca yolu değişti.

**Neden cron değil.** Plan yeni bir cron adımından söz ediyordu. Maden zaten
TEMBEL ilerliyor (yalnızca birisi sayfaya baktığında, bkz. `tickMine`) ve
fırsatı aynı ritme bağlamak madenin kendi felsefesini koruyor;
`app/api/cron/route.ts`'e hiç dokunulmadı. Fırsat kaçırılınca beklemede
kaldığı için gecikmenin bir bedeli yok — plan kararının "affedici tasarım"
tercihi bunu zaten mümkün kılıyor.

**Tohumun anı neden kaba.** Maden tembel ilerlediği için damarın son cevherini
alan oyuncu tükenme anını bir ölçüde SEÇEBİLİR. Milisaniye hassasiyetli bir
tohum "hangi anda yoklarsam define çıkar" diye taranabilirdi. İki fren
kondu: an bir oyun saatine yuvarlanıyor (`mineFindSeedAt`) ve ödül bantları
dar tutuldu — en iyi ile en kötü fırsat arasındaki fark ×2'nin altında, ve bir
test bandı genişletmeye çalışan bir değişikliği yakalıyor.

**Miktar tabloda TUTULMUYOR**, her okumada tohumdan türüyor. Sayıyı tabloya
yazmak ikinci bir kopya olurdu (tek-doğru-kaynak) ve daha önemlisi:
istemcinin bildirebileceği bir alan hiç var olmuyor. `commons` istismarının
dersi buydu; aynı disiplin Fikir 24'ün pazar endeksinde de uygulanmıştı.

**Kazananın veritabanında belirlenmesi** yarış koşulu için zorunlu: "önce oku,
sonra yaz" biçiminde yazılsaydı aynı saniyede gelen iki Kral fırsatı iki kez
alırdı. Ödül yazılamazsa (kayıt bu arada değiştiyse) fırsat `pending`e geri
dönüyor — yoksa ödül ortadan kaybolurdu; madenin cevher iadesinde de aynı
desen var.

## Etkilenen dosyalar

- `engine/mine.ts` (`MINE_FINDS` kataloğu, `MINE_FIND_KINDS`, `mineFindSeedAt`, `mineFindOf`)
- `db/schema.ts` (`shared_mine_finds` tablosu)
- `drizzle/pg/0010_natural_gorgon.sql` + `drizzle/pg/meta/0010_snapshot.json`, `_journal.json`
- `app/api/mine/route.ts` (`findFor`, `findView`, `claimFind`, GET cevabındaki `find` alanı)
- `components/KingdomGame.tsx` (yalnızca `diyar` sekmesi: fırsat kutusu, `MineFindView` tipi, `mineAction("claim_find")`)
- `app/game.css` (`.mine-find`)
- `docs/ARCHITECTURE.md` (§2 yeni tablo satırı, §3.5 maden bölümü)
- `tests/mine-find.test.ts` (YENİ, 5 test), `package.json` (test listesi)

## Şema notu

Migrasyon: `drizzle/pg/0010_natural_gorgon.sql` — bir `CREATE TABLE`, üç
`ADD CONSTRAINT` (FK) ve bir `CREATE INDEX`. Tamamen **additive**: mevcut
hiçbir tabloya, sütuna ya da index'e dokunmuyor; `DROP`/`TRUNCATE` yok.
`shared_mines` üzerindeki UNIQUE index bilinçli olarak yerinde bırakıldı
(gerekçe yukarıda).

**Save şemasına alan EKLENMEDİ** (kısıt #3 devreye girmedi): ödül mevcut
`resources.gold` / `stone` / `iron` kalemlerine yazılıyor, defter kaydı
mevcut `notices` yapısını kullanıyor (`kind: "FIRSAT"` — şema `kind`'ı
serbest metin olarak kabul ediyor, yeni bir enum değeri gerekmedi).

## Test durumu

Gerçekten çalıştırılan komutlar:

- `npx tsc --noEmit` → temiz.
- `npm test` → `# tests 631 / # pass 631 / # fail 0` (madde öncesi 626; 5 yeni test).
- `npm run lint` → `0 errors, 1 warning` (bilinen `exhaustive-deps`).
- `npm run build` → "Build complete" (şema değişti).

Yeni testler MUTASYONLA sınandı: (a) tür tohumdan değil sabit seçildi,
(b) tükenme anının kova yuvarlaması kaldırıldı, (c) define bandı ×10
genişletildi. Üç mutasyon üç testi kırdı (tohum, kova, dar bant); geri
alındıktan sonra 5/5 yeşil.

## Takip gereken işler

- Fırsat `components/ChannelWorldMap.tsx` haritasında ÇİZİLMİYOR; konum sapması
  (`offset`) sunucudan iniyor ve panelde yazıyla gösteriliyor. Haritada bir
  işaret olarak çizmek ayrı ve küçük bir iş (o dosya bu turda kapsam dışıydı).
- Fırsat channel başına BİR kez çıkar (damar bir kez tükenir). Plan
  "periyodik olarak yeni bir kaynak/fırsat" ihtimalinden de söz ediyordu;
  periyodiklik uygulanmadı, çünkü damarın kendisi yeniden dolmuyor. Damarın
  yeniden dolması ya da ikinci bir damar istenirse bu tablo (mineId başına
  satır) buna hazır.
- Fırsatın ortaya çıkışı Kral'ın defterine (`notices`) YAZILMIYOR: yalnızca
  panelde görünür. "Kim ilk fark ederse" yarışının bir parçası olarak bilinçli
  bırakıldı ama bir bildirim istenirse `server/king-notice.ts` deseni hazır.
