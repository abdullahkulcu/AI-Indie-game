# Ortak madende nüfuz mücadelesi (Fikir 22)

Tarih: 2026-08-23

## Ne değişti

Ortak maden artık tamamen eşitlikçi değil: damarda açık üstünlüğü olan krallık
"bölge sahibi" sayılıyor ve ötekilerin **aktif üretiminden** %10 pay alıyor.
Ölçüt anlık işçi sayısı değil, kapalı çözümlü üstel bir zaman ağırlıklı
ortalama (`shared_mine_workers.worker_avg`, zaman sabiti 24 oyun saati);
sahiplik ayrıca 6 oyun saatlik, mutlak zamana oturan pencerelere kilitli
(`shared_mines.influence_user_id` / `influence_window`) ve pencere içinde
değişmiyor. `engine/mine.ts`'in "kimse başkasının payını yemez" yorumu bu
istisnayı ve sınırlarını anlatacak şekilde yeniden yazıldı. Nüfus tavanı (%20)
karara uygun olarak değişmedi.

## Neden

Ortak maden bugüne kadar rekabetin en zayıf olduğu yerdi: yuva sınırı dışında
kimsenin kimseyle bir alıp veremediği yoktu, herkes kendi işçisinin
ürettiğini alıyordu. Vizyonun "ekonomisini bozmak" ekseninin maden tarafı bu
yüzden ölüydü — madene işçi göndermek bir kaynak kararıydı, bir strateji
değil. Nüfuz payı, EMEK YOĞUNLUĞUYLA bir kaynağa hükmetmeyi (ve buna karşı
koymayı) gerçek bir karar hâline getiriyor.

İlkenin terk edilmesi bir kaza değil, plan belgesindeki açık bir karar
(2026-08-22, Fikir 22): "nüfuz payı aktif üretimden çalınır". Kararın ikinci
yarısı da uygulandı: "uygulanırken dosyanın kendi yorumu da güncellenmeli" —
CLAUDE.md'nin tek-doğru-kaynak disiplini gereği kod bir ilkeyi söylüyorsa ve o
ilke artık kısmen geçersizse, yorum sessizce eskimiş bırakılmaz.

**Ölçütün ortalama olmasının gerekçesi** kararda yazılı: anlık işçi sayısı
tartılsaydı krallıklar her hesapta işçi sayısını oynatıp "sahiplik kapma"
yarışına girerdi. Ortalama, sahipliği bir süre boyunca gerçekten madende emek
tutmuş olana veriyor.

**Pencere kilidinin gerekçesi ikili.** Biri denge: sahiplik bir pencere
boyunca sabit kalıyor, yani rakip bir hamlenin karşılığı bir sonraki pencerede
alınıyor. Diğeri ve daha kritik olanı CLAUDE.md kısıt #2: sahiplik SÜREKSİZ
bir karardır (eşiği geçtin/geçmedin) ve "o anki ortalamaya" göre seçilseydi,
hesabın kaç parçaya bölündüğü sahibin ne zaman değiştiğini belirlerdi — 5
dakikalık adımlarla yürüyen bir sunucu, tek adımda yürüyenden farklı bir
cevher dağıtımı üretirdi. Çözüm, kod tabanının bu soruna verdiği yerleşik
cevabın aynısı: mutlak zamana oturan pencereler ve hesabın pencere
sınırlarından bölünerek yürütülmesi (`engine/raids.ts` → `resolveRaids`).
Ortalamanın kapalı çözümlü üstel olması (`engine/faction.ts` → `advanceFaction`
ile aynı gerekçe) bölünebilirliğin ikinci yarısı.

**İstismar frenleri** (üçü de yorumda ve testte):

1. **Nüfuz cevher ÜRETMEZ.** Pay, aynı hesapta ötekilerin çıkardığı cevherden
   alınır; damardan çıkan toplam ve damarın bakiyesi değişmez. Bu test
   olmasaydı "sahibe ekle" satırının "ötekilerden düş" satırından ayrı düşmesi
   sessiz bir cevher basma makinesi olurdu — mutasyonla denendi, test kırıldı.
2. **Gıyabında sahiplik yok.** Ortalaması yüksek bir krallık işçilerini çekip
   pencerenin kalanında bedavaya pay toplayamaz; sahiplik için o an madende
   işçi bulundurmak şart.
3. **Kılpayı üstünlük yetmez** (`INFLUENCE_DOMINANCE` = 1.25): pencere
   başlarında bir yuva sniping yarışı doğmasın.

Ayrıca **ortalama panele inmiyor**: yalnızca sahibin adı, pay oranı ve pencere
uzunluğu iniyor. Ortalama sahipliğin ölçütü olduğu için sızması "kaç işçiyle
geçebilirim" hesabını birebir çözerdi. İstemcinin bildirdiği hiçbir sayı bu
karara girmiyor — işçi sayısı zaten sunucudaki kayıttan türeyen tavanla
sınırlı, ortalama ve sahiplik tamamen sunucuda yaşıyor.

## Etkilenen dosyalar

- `engine/mine.ts` (dosya başı yorumu, `INFLUENCE_*` sabitleri, `advanceWorkerAvg`, `dominantMiner`, `influenceWindowAt`/`influenceWindowMs`, `settleMine`'ın pencere döngüsü)
- `db/schema.ts` (`shared_mine_workers.worker_avg`, `shared_mines.influence_user_id`, `shared_mines.influence_window`)
- `drizzle/pg/0009_bright_dark_beast.sql` + `drizzle/pg/meta/0009_snapshot.json`, `_journal.json`
- `app/api/mine/route.ts` (ortalamanın ve sahipliğin kalıcılığı, `influence` alanı)
- `components/KingdomGame.tsx` (yalnızca `diyar` sekmesi: maden panelinde sahiplik satırı, `MineInfluenceView` tipi)
- `app/game.css` (`.mine-influence`, `.shared-mine i.owner`)
- `docs/ARCHITECTURE.md` (§2 iki tablo satırı, §3.5 maden bölümü)
- `tests/mine-influence.test.ts` (YENİ, 13 test), `package.json` (test listesi)

## Şema notu

Migrasyon: `drizzle/pg/0009_bright_dark_beast.sql` — üç `ADD COLUMN` ve bir
`ADD CONSTRAINT` (FK, `on delete set null`). Tamamen **additive**;
`DROP TABLE`, `TRUNCATE`, `DROP COLUMN` yok. Varsayılanlar (`worker_avg` = 0,
`influence_window` = 0, `influence_user_id` = NULL) sayesinde mevcut satırlar
sahipliği sıfırdan kazanır; eski veriye dokunulmuyor.

**Save şemasına alan EKLENMEDİ** (kısıt #3 devreye girmedi): nüfuzun bütün
durumu maden tablolarında yaşıyor, oyuncunun kaydına yalnızca eskiden olduğu
gibi teslim edilen cevher (`resources.iron`) yazılıyor.

## Test durumu

Gerçekten çalıştırılan komutlar:

- `npx tsc --noEmit` → temiz.
- `npm test` → `# tests 626 / # pass 626 / # fail 0` (madde öncesi 613; 13 yeni test).
  Mevcut `tests/mine.test.ts`'in 12 testi (adım-bölünmesi testi dâhil) dokunulmadan geçti.
- `npm run lint` → `0 errors, 1 warning` (bilinen `exhaustive-deps`).
- `npm run build` → "Build complete" (şema değişti).

Yeni testler MUTASYONLA sınandı, dördü de yakalandı:

1. Pay ötekilerden DÜŞÜLMEDEN sahibe eklendi (cevher basma) → 2 test kırıldı.
2. Pencere kilidi kaldırıldı (`if (window !== influence.window)` → `if (true)`)
   → sahipliğin el değiştirdiği adım-bölünmesi testi kırıldı. İLK HÂLİYLE bu
   mutasyon YAKALANMIYORDU: ilk yazdığım pencere testi ortalamanın kendisi
   zaten koruduğu için hiçbir şey ölçmüyordu. Test, sahipliğin gerçekten el
   değiştirdiği (×24 hızlı channel, ortalaması yükselen rakip) bir senaryoya
   çevrildi ve ancak o zaman mutasyonu yakaladı.
3. Ortalama doğrusal (adım-bağımlı) yapıldı → 3 test kırıldı.
4. "O an işçisi olmalı" şartı kaldırıldı → gıyabında sahiplik testi kırıldı.

## Takip gereken işler

- Pay oranı (%10), ortalama zaman sabiti (24 oyun saati), pencere (6 oyun
  saati), taban (5 ortalama işçi) ve üstünlük katsayısı (1.25) DENGE
  tahminidir; hepsi `engine/mine.ts`'in başındaki `INFLUENCE_*` sabitlerinde
  tek kaynakta duruyor.
- Bölge sahipliği General'in bağlamına GİRMİYOR: Kral madeni panelden
  görüyor ama General'e "madende sahiplik kaybediyoruz" diyecek bir veri
  akmıyor. Ayrı bir madde olarak değerlendirilebilir.
