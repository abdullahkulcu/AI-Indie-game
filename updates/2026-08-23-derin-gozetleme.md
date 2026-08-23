# Derin gözetleme — rakip halkın moralini casuslukla öğrenmek (Fikir 5)

Tarih: 2026-08-23

## Ne değişti

Ajan görevi ikiye ayrıldı: `scout` (bugüne kadarki bedava keşif) ve `deep`
(DERİN GÖZETLEME). Yeni tür 300 altına mal olur, başarı ihtimali daha düşük
(%6, karşı-istihbarat ayaktaysa %2), tespit edilme ihtimali daha yüksek
(%60/%90) ve ajan yolda üç kat uzun kalır; başarılı olursa rapora hedef
halkın **kaba moral etiketi** ("Huzursuz") eklenir — kesin sayı asla.
Görev türlerinin tablosu ve zarı yeni ve saf bir motor dosyasına taşındı
(`engine/intel.ts`); zar artık `crypto.getRandomValues` yerine
`engine/raids.ts`'in tohumlu `rand01` desenini kullanıyor. Bedel dış kesenin
omurgasıyla düşüyor: gönderenin sunucudaki kaydından, sürüm korumalı, görev
satırıyla tek işlemde.

## Neden

Kral bugün bir dış keseyi hangi krallığa göndereceğine körlemesine karar
veriyordu: keşif raporu nüfus ve asker veriyor ama halkın hâli hakkında
hiçbir şey söylemiyordu. "Bu krallığın halkı zaten huzursuz, kesem daha çok
işe yarar" gibi stratejik bir seçim ancak bu bilgiyle doğuyor — yani madde
vizyonun "asker olmadan savaş kazanmak" ekseninin doğrudan bir parçası.

Bilginin standart rapora EKLENMEMESİ bilinçli: `intelReportOf`'un taşıyıcı
felsefesi "kesin sayı değil, kaba çerçeve" ve "kumar orada". Moral bilgisi
bedava gelseydi bu kumarın bir kısmı ücretsiz kalkacaktı; ayrı, pahalı ve
kolay yakalanan bir görev olarak sunulunca bilgi bir BEDEL karşılığı alınıyor.

Asimetrik bilgi kısıtı (plan belgesi §2, karar 2) ihlal edilmiyor ve bu kodda
da yorum olarak yazılı: burada Halk-AI kendi krallığından bilgi sızdırmıyor,
Kral KENDİ istihbarat aracıyla RAKİBİN halkını gözetliyor — tamamen farklı
bir kanal. General hâlâ halka gidip soramıyor.

Zarın tohumlu olmasının gerekçesi bir istismar kapısı: motor istemciye de
paketlendiği için `rand01` oyuncuya açıktır. Tohum tahmin edilebilir bir
şeyden (hedef kimliği + saat) kurulsaydı Kral görevi göndermeden önce sonucu
hesaplayıp yalnızca kazanan turlarda ajan yollardı. Tohumun öngörülemez
parçası bu yüzden SUNUCUDA üretilen görev kimliği (UUID) — hiçbir cevapta
istemciye inmiyor.

`mood` alanının yalnızca dolu olduğunda EKLENMESİ de bir disiplin kararı:
`null` yazılsaydı standart raporun alan listesi değişecek ve "raporda hangi
alanlar var" güvencesini tutan mevcut test (`tests/world-projection.test.ts`
→ "ajan raporu ambarı vermez") gevşetilmek zorunda kalacaktı. O test bir
sızıntı bekçisidir; olduğu gibi bırakıldı ve hâlâ ileride sessizce eklenen
bir alanı yakalayacak.

## Etkilenen dosyalar

- `engine/intel.ts` (YENİ — görev türleri, bedel/ihtimal/süre tablosu, tohumlu zar)
- `server/world-projection.ts` (`IntelReport.mood`, `intelReportOf(kingdom, mood)`, `moodLabelOf`)
- `app/api/world/route.ts` (`deep_scout` eylemi, bedelin tek işlemde düşmesi, tohumlu çözüm, `intel.deepCost`)
- `db/schema.ts` (`intel_missions.kind`)
- `drizzle/pg/0008_redundant_vengeance.sql` + `drizzle/pg/meta/0008_snapshot.json`, `_journal.json`
- `components/KingdomGame.tsx` (yalnızca `diyar` sekmesi bloğu: "DERİN GÖZETLEME" düğmesi, moral satırı, `deepIntel` state'i)
- `app/game.css` (`.intel-actions`, `.deep-scout`, `.intel-mood`)
- `docs/ARCHITECTURE.md` (§2 tablo satırı, §3.10 istihbarat bölümü)
- `tests/intel.test.ts` (YENİ, 12 test), `package.json` (test listesi)

## Şema notu

Migrasyon: `drizzle/pg/0008_redundant_vengeance.sql`. Tek satır:
`ALTER TABLE "intel_missions" ADD COLUMN "kind" text DEFAULT 'scout' NOT NULL;`
Tamamen **additive**; `DROP TABLE`, `TRUNCATE` ya da `DROP COLUMN` yok.
Varsayılan `scout` olduğu için sütun eklenmeden önce yazılmış bütün satırlar
standart keşif sayılır.

**Save şemasına alan EKLENMEDİ** (kısıt #3 hiç devreye girmedi): moral etiketi
hedefin kaydından TÜRETİLİR (`popularity` + askerin bastırma gücü) ve yalnızca
`intel_missions.report` içindeki JSON'a yazılır; oyuncunun kaydında karşılığı
olan bir alan yok. Derin gözetlemenin bedeli de mevcut `resources.gold`
alanından düşüyor.

## Test durumu

Gerçekten çalıştırılan komutlar:

- `npx tsc --noEmit` → temiz (çıktı yok).
- `npm test` → `# tests 613 / # pass 613 / # fail 0` (madde öncesi 601'di; 12 yeni test).
- `npm run lint` → `0 errors, 1 warning` — uyarı `components/KingdomGame.tsx`
  içindeki önceden var olan ve kabul edilmiş `react-hooks/exhaustive-deps`.
- `npm run build` → "Build complete" (şema değiştiği için çalıştırıldı).

Yeni testler MUTASYONLA sınandı: (a) derin gözetlemenin bedeli 0 yapıldı,
(b) zarın tohumu sabit dizgeye çevrildi, (c) `intelReportOf` her raporda
etiket taşıyacak şekilde bozuldu. Üç mutasyon dört testi kırdı ("daha pahalı,
daha düşük ihtimalli", "zar tohumludur", "ihtimal gerçekten ihtimaldir",
"standart keşif raporu moral bilgisi TAŞIMAZ"); mutasyonlar geri alındıktan
sonra 12/12 yeşil.

## Takip gereken işler

- Derin gözetleme `components/ChannelWorldMap.tsx` (channel haritası
  penceresi) içinden çağrılamıyor; oradaki `onScout` yalnızca standart keşfi
  yolluyor. Bilinçli bir kapsam sınırıdır, eksik değil — haritadan da
  yollanması istenirse o dosyaya küçük bir düğme eklemek yeterli.
- Bedel (300 altın) ve ihtimaller (%6/%2) DENGE tahminidir; canlı bir
  channel'da "hiç tutmuyor" ya da "çok ucuz" çıkarsa tek yerden
  (`engine/intel.ts` → `INTEL_MISSIONS`) ayarlanır.
