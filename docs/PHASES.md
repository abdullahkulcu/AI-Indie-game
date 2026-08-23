# Demirkale — Geliştirme Fazları

**Bu belge nasıl güncellenir:** Yeni bir faz tamamlandığında ya da yeni bir
proje/faz dizisi başladığında, bu dosyaya ilgili bölüme yeni bir madde eklenir
— eskiler SİLİNMEZ, yalnızca durumları (✅/🔄/🔴) güncellenir. Her madde
gerçek bir `git log` kanıtına (commit hash'i) dayanmalı; "muhtemelen böyle
oldu" tahmini yazılmaz. Emin olunmayan bir eşleşme "muhtemelen"/"kesin commit
eşleşmesi doğrulanamadı" diye açıkça işaretlenir, kesinmiş gibi sunulmaz.

## 1. Genel kilometre taşları

Git geçmişinin (`git log --oneline`, 130+ commit) baştan sona okunmasıyla
çıkarılan büyük dönemeçler:

1. **MVP kuruluşu** (`229a5e9` "Add MVP scaffold" → `1325bd5` "Build Demirkale
   kingdom simulation MVP" → `e366079` "Make kingdom progression visible").
   Bu dönemde harita render tarzı birkaç kez değişti (izometrik pixel-art →
   flat top-down → tekrar izometrik, bkz. `4c05032`, `efc37bc`,
   `b9d2b57`), yani MVP'nin görsel kimliği erken oturmadı.
2. **Motorun tek modüle taşınması** — `96e512a` "Oyun motorunu paylaşılan
   engine/ modülüne taşı". Bu commit, istemci ve sunucunun aynı kod yolunu
   çalıştırma ilkesinin (`docs/ARCHITECTURE.md` §1.1) kod tabanındaki başlangıç
   noktasıdır.
3. **Halk sistemi ve akınlar** — `dc8d3a7` "Halk sistemi: istihkak, mutluluk,
   iş bırakma, isyan ve asker maaşı", `f6b4aa0` "Dağ akınları ve nöbet
   sistemi". Nüfus/rıza modeli ve garnizon savunması buradan itibaren var.
4. **Veritabanı göçü** — `650fd0b` "Veritabanını D1/SQLite'tan Postgres'e
   taşı". Eski Fastify + Redis + D1 yığını burada terk edilmeye başlandı
   (README'de not edildiği üzere `server/index.ts`, `server/tick/`,
   `server/game/`, `server/llm/`, `migrations/` sonradan tamamen silindi;
   hiçbiri canlı taraftan import edilmiyordu).
5. **Güvenlik sertleştirme (P0)** — `e4e677e` "P0 güvenlik düzeltmeleri: kayıt
   doğrulama, hesap sızıntıları, hız sınırı" ve devamında `55313aa` "Prompt
   güvenliği, dağıtım ve determinizm: kalan 16 madde". Bu dönem
   `server/save-validation.ts`'in `.strict()` şemasını, hız sınırlarını ve
   prompt-injection sınırını (`server/negotiation-brief.ts`) kalıcı hâle
   getirdi.
6. **Müzakere / pazar / ortak maden / haraç** — `67958eb` "Müzakere masası:
   tablolar, uç nokta ve haraç ödemesi" ile başlayıp `d75558a` "Müzakere,
   pazar, depo ve haraç turunu main'e al" ile ana dala alındı; `57bb5df`
   "Haraç motorunu ve cron'un haraç turunu onar" ve `2cf22a9` "Değirmen'e
   gerçek etki ver, ortak madenin cevherini oyuncuya teslim et" ile
   pekiştirildi.
7. **"Akıllı Halk ve Asker" projesi** — bkz. §2 aşağıda. Bu, en son ve hâlâ
   kısmen açık olan proje dizisidir.

## 2. "Akıllı Halk ve Asker" projesi — Faz 0-9

Bu proje, halkın ve garnizonun edilgen sayaçlar olmaktan çıkıp krallığa geri
konuşan/direnen/örgütlenen aktörlere dönüşmesini hedefler: halkın sesi
(taleplerini açıkça söylemesi), garnizonun vetosu, iç muhalefet (uzun süre düşük
rızanın örgütlü muhalefete dönüşmesi) ve komşu krallıkların birbirine
uygulayabileceği "yumuşak saldırı" araçları (dış kese, haydut yönlendirme).

**Kaynak notu:** Bu projenin faz numaralandırması, önceki oturumun devir-teslim
belgesinde (`DEVIRTESLIM-2026-08-21.md`) yalnızca durum tablosu olarak
geçiyor ("Faz 0-5, 7-9 ✅ TAMAM", "Faz 6 🔴 BACKLOG") — fazların birebir
içerik tanımlarını taşıyan orijinal plan artifact'ı bu oturumdan erişilemedi
(`https://claude.ai/code/artifact/c5a6b585-...` "not found"). Aşağıdaki
Faz 0 tanımı git commit mesajından BİREBİR alınmıştır (kesin). Faz 1-5 ve 7
için parantez içindeki commit'ler `main` dalındaki "akıllı halk" worktree
dalının (`c14aa38` ile birleştirilen 6 commit'lik dizi, taban: `8cb49eb`)
gerçekleştirdiği sistemlerle İÇERİK olarak eşleşiyor ve gerçek kod/test
dosyalarıyla (`engine/faction.ts`, `engine/agitation.ts`,
`engine/populace-voice.ts`, `tests/faction.test.ts`, `tests/agitation.test.ts`,
`tests/populace-voice.test.ts`) doğrulanmıştır; ancak commit'lerin HANGİ
sıra numarasına (Faz 1 mi Faz 3 mü) karşılık geldiği plan belgesi olmadan
kesin değildir — bu yüzden "muhtemelen" ibaresiyle işaretlenmiştir. Faz 8 ve
9'un içeriği bu oturumda ayırt edilemedi; DEVIRTESLIM'in "0-5, 7-9 tamam"
özetine güvenilerek TAMAMLANDI sayılmıştır ama hangi kod parçasına karşılık
geldiği doğrulanamamıştır.

| Faz | Durum | İçerik | Commit(ler) | Dosyalar |
| --- | --- | --- | --- | --- |
| **Faz 0** | ✅ TAMAM (kesin) | Güvenlik sertleştirmesi: `commons`, `peopleLeft`/`migrationDrift`/`peopleJoined` sunucu-türevi hâle getirildi; akın travması yalnızca GERÇEK yağmada tetiklenecek şekilde düzeltildi (püskürtülen akın artık rızayı cezalandırmıyor). | `8cb49eb` | `engine/tick.ts`, `engine/raids.ts`, `server/save-validation.ts` |
| **Faz 1** (muhtemelen) | ✅ TAMAM | Halkın sesi: halk ve garnizonun açık talepleri, garnizon vetosu (aktif emirleri huzursuzluk eşiğine göre engelleme). | `e701da0` "Halkın sesi duyulsun, garnizon emri geri çevirebilsin" | `engine/populace-voice.ts`, `server/populace-voice.ts`, `db/schema.ts` → `populace_demands` |
| **Faz 2** (muhtemelen) | ✅ TAMAM | Göç bildirimlerinin GEREKÇE göstermesi: Kral nüfusunun neden eridiğini artık görüyor (`heaviestGrievance`). | `0c043de` "Göç bildirimi sebebini söylesin" | `engine/populace.ts` (`GRIEVANCE_LABELS`, `heaviestGrievance`), `engine/tick.ts` |
| **Faz 3** (muhtemelen) | ✅ TAMAM | İç muhalefet: rıza uzun süre düşük kalırsa elebaşı çıkıyor; kapalı-çözümlü üstel biriktirme/erime, Kral'ın bunu güçle bastıracak bir emri YOK. | `beb822c` "İç hizip: rıza uzun süre düşük kalırsa elebaşı çıksın" (commit mesajı, terim değişikliğinden ÖNCE yazıldığı için "hizip" diyor — tarihsel alıntı, olduğu gibi bırakıldı) | `engine/faction.ts`, `tests/faction.test.ts` |
| **Faz 4** (muhtemelen) | ✅ TAMAM | Dış kese — altın: komşu krallığın halkına ya da askerine para gönderme (muhalefet baskısı/asker huzursuzluğu enjeksiyonu), zar yok, iki kademeli ifşa. | `1b7d651` "Dış kese — altın: komşunun halkını ya da askerini satın al" | `engine/agitation.ts`, `server/agitation-desk.ts`, `db/schema.ts` → `agitations` |
| **Faz 5** (muhtemelen) | ✅ TAMAM | Dış kese — mal: hedefin pazarına mal yığarak satış getirisini düşürme (`commonsGlut`), rızaya ya da alışa dokunmaz. | `4aa4ad8` "Dış kese — mal: hedefin pazarını boz, ambarını doldurma" | `engine/agitation.ts` (`GLUT`, `applyGlut`), `engine/market.ts` (`pricingStock`) |
| **Faz 6** | ✅ **TAMAM** | **Göçün çok krallığa dağılması.** Krallığı terk eden nüfus artık channel'daki aktif ve kuruluş koruması bitmiş başka bir krallığa, boş konut + rızadan doğan ağırlıklı bir seçimle (tohumlu `rand01`, `Math.random()` yok) gerçekten ulaşıyor. Orijinal tasarım belgesi erişilemez olduğu için kod tabanından rekonstrükte edildi (dış kese/ortak madenin "kaynakta olay olur, cron hedefe gecikmeli yazar" deseni). | `f143657`, `f74687b` | `engine/migration.ts`, `server/migration-desk.ts`, `app/api/cron/route.ts` (`settleMigrations`), `app/api/save/route.ts`, `db/schema.ts` → `migrations`, `tests/migration.test.ts` |
| **Faz 7** (muhtemelen) | ✅ TAMAM | Haydut yönlendirme: Kral, dağ yollarındaki eşkıyayı komşusunun kalesine doğru çekebiliyor; yalnızca akın SIKLIĞINI ve haydut ağırlığını kaydırır, şiddete dokunmaz. | `80f23af` "Haydut yönlendirme: eşkıyayı komşunun kalesine çek" | `engine/agitation.ts` (`LURE`, `applyLure`, `lureAt`), `engine/raids.ts` (`pickKind` içindeki `lure` parametresi) |
| **Faz 8** | ✅ TAMAM (DEVIRTESLIM'e göre; içerik bu oturumda doğrulanamadı) | Bilinmiyor — muhtemelen Faz 0-7'nin sunucu tarafı sertleştirmesi (`server/save-validation.ts` → `SERVER_DERIVED` listesinin 9 alanı tek fonksiyonda toplanması) ile örtüşüyor olabilir. | `c14aa38` (merge) içinde | `server/save-validation.ts` |
| **Faz 9** | ✅ TAMAM (DEVIRTESLIM'e göre; içerik bu oturumda doğrulanamadı) | Bilinmiyor — muhtemelen arayüz entegrasyonu (`components/KingdomGame.tsx`'teki "DIŞ KESE" paneli, muhalefet göstergesi) ile örtüşüyor olabilir. | `c14aa38` (merge) içinde | `components/KingdomGame.tsx` |

### Faz 6 hakkında ek not

`DEVIRTESLIM-2026-08-21.md`, Faz 6'yı şöyle tanımlıyor: *"göçün çok krallığa
dağılması"*, ve durumunu şöyle işaretliyor: *"🔴 BACKLOG, hiç başlanmadı —
worktree agent bilinçli olarak burada durduruldu"*. Bu belge ilk yazıldığında
(2026-08-22, sabah) `engine/tick.ts` içindeki göç mantığı hâlâ tek krallık
içi bir defterdi; aynı gün ilerleyen saatlerde ayrı bir agent tarafından
implemente edildi (bkz. `updates/2026-08-22-faz6-goc-dagilimi.md`) ve
yukarıdaki tablo güncellendi. Faz 6'nın kapsamı da (orijinal tasarım belgesi
hâlâ erişilemediği için) kod tabanından rekonstrükte edildi — bkz.
`engine/migration.ts`'in başındaki gerekçe yorumu.

## 3. Sonraki oturumlar için

Bu tabloyu güncellerken:

- Yeni bir faz TAMAMLANDIĞINDA: durumu ✅ yap, commit hash'i(leri) ekle,
  "muhtemelen" ibaresini kaldır (artık gerçek bir kod incelemesiyle
  doğrulandıysa).
- Faz 6 uygulanmaya başladığında: durumu 🔄 DEVAM EDİYOR yap, hangi
  dosyaların değiştiğini not et.
- Akıllı Halk projesi dışında yeni bir proje/faz dizisi başladığında: §2'nin
  altına yeni bir bölüm (§4, §5, ...) olarak ekleyin — mevcut tabloyu
  değiştirmeyin.

## 4. "Canlı Dünya ve Halk AI" projesi

Bu dizi, `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md` içinde
karara bağlanmış 26 maddenin (Fikir 0-25) hayata geçirilmesini takip eder:
krallığın izole bir tabelalar tablosu olmaktan çıkıp channel'ın geri kalanıyla
konuşan, kıyaslanan ve etkileşen bir yere dönüşmesi.

**Numaralandırma notu:** Bu dizide faz numarası UYDURULMAZ; her madde plan
belgesindeki **Fikir numarasıyla** anılır. İkinci bir numaralandırma açmak,
Akıllı Halk projesinde yaşanan "hangi commit hangi faza denk geliyordu"
belirsizliğinin (bkz. §2'nin kaynak notu) aynısını üretirdi.

**Kapsam notu:** Aşağıdaki tablo yalnızca TAMAMLANANLARI listeler. Açık
maddelerin tanımı, gerekçesi ve kararları plan belgesinde yaşar; buraya
kopyalanmaz (tek-doğru-kaynak). Bir madde bittiğinde tabloya gerçek commit
hash'iyle yeni bir satır eklenir.

| Madde | Durum | İçerik | Commit(ler) | Dosyalar |
| --- | --- | --- | --- | --- |
| **Fikir 0** | ✅ TAMAM (kesin) | **Halk-AI kimlik altyapısı (admin finanse eder, channel bazlı).** Halkın token'ını oyun kurucusu ödüyor: yeni `populace_credentials` tablosu bir channel'a **varsayılan** persona+anahtar, istenirse belirli krallıklara **override** tutuyor (`user_id` NULL = varsayılan; iki KISMİ unique index bu ikiliği DB seviyesinde koruyor). Çözümleme sırası — krallık override'ı > channel varsayılanı > yok — TEK yerde yaşıyor; Fikir 2/7/8/9/15/16 kendi sırasını kurmayacak, `populaceCredentialFor`u çağıracak. Şifrelemede AAD'nin kimlik bölümü bir **kapsam** dizgesine genelleştirildi (`ByokScope`, marka tipli): oyuncu kapsamı çıplak `userId` olarak yazıldığı için v1 AAD baytları bit düzeyinde korundu ve mevcut oyuncu anahtarları çözülmeye devam ediyor (testteki sabit "altın örnek" değişiklikten ÖNCEKİ kodla üretildi). Kişilik listesi motorda tek kaynak; şema kısıtı, uç doğrulaması ve admin paneli aynı diziden okuyor. Anahtar hiçbir cevapta/logda/panelde görünmüyor: panel sorgusu `encrypted_key`/`iv`'yi hiç SELECT etmiyor. **Hiçbir LLM çağrısı yok** — bu paket yalnızca altyapı. | `d066511` | `engine/populace-persona.ts` (kişilik listesi — tek kaynak), `server/byok-crypto.ts` (`ByokScope`, `userScope`/`populaceChannelScope`/`populaceKingdomScope`, `encryptScopedKey`/`decryptScopedKey`), `server/populace-ai-credentials.ts` (öncelik kuralı, kapsam seçimi, sır taşımayan özet), `server/populace-ai-desk.ts` (`populaceCredentialFor`), `db/schema.ts` + `drizzle/pg/0006_bent_inertia.sql`, `app/api/admin/populace-ai/route.ts`, `app/admin/page.tsx`, `app/api/admin/route.ts` (`channelIds`), `tests/populace-ai-credentials.test.ts` |
| **Fikir 1** | ✅ TAMAM (kesin) | **Channel ortalamasını panelde göstermek.** "Diyar" sekmesi, Kralın dört ölçütünü (rıza, yiyecek istihkakı, vergi oranı, muhalefet baskısı) channel'ın ANONİM ortalamasıyla yan yana gösteriyor. Kimin hangi değere sahip olduğu istemciye hiç inmez; kuruluş koruması süren krallıklar ve Kralın kendisi ortalamaya girmez; aday sayısı gizlilik alt sınırının (3 sancak) altındaysa sunucu sayı üretmez. AI çağrısı yok, yeni DB turu yok — `GET /api/world`'ün zaten okuduğu satırlar üzerinde çalışır. | `2ada90d` | `engine/comparison.ts` (ölçüt listesi, "iyi" yönü, alt sınır), `server/world-projection.ts` (`channelAverages`), `app/api/world/route.ts`, `components/KingdomGame.tsx`, `app/game.css`, `tests/channel-averages.test.ts` |
| **Fikir 13** | ✅ TAMAM (kesin) | **Sessiz kıyaslama — halk kendini komşu sancaklarla kıyaslar.** Fikir 1'in anonim ortalaması artık Kral'a bir gösterge olmakla kalmıyor, Halk'ın kendi tarafında bir BASKIYA dönüşüyor: yeni bir talep türü (`DemandKind = "kiyas"`) ekmek ve maaşla AYNI `MAX_OPEN_DEMANDS` tavanını paylaşarak açılıyor. Bilgi akışı tek yönlü ve sınır koda yazılı: metin hiçbir krallık adı taşımaz ve HİÇ sayı vermez, yalnızca nitel bir kıyas kurar (bir test bunu doğrular). Eşik: ölçüt başına fark (rıza 10, istihkak 10, vergi 6, muhalefet 15), en az iki ölçütte birden geride olma şartı, 8 oyun saati kesintisiz süre. Ortalama gizlilik alt sınırının altındaysa (`averages: null`) talep KESİNLİKLE açılmaz; kıyas asla `urgent` olmaz, yani somut taleplerin önüne geçmez. **RİTİM SAPMASI:** karar "saatlik cron turunda" diyordu; `syncPopulaceDemands` bugün yalnızca Kral General'le konuşurken çağrıldığı için kıyas talep senkronunun ritmine bağlandı — gerekçe ve kabul edilen sonuç `updates/2026-08-22-sessiz-kiyaslama.md`'de. AI çağrısı yok; istek başına tek ek DB sorgusu. | `3b91835` | `engine/populace-voice.ts` (`"kiyas"` türü, `VOICE_THRESHOLDS.kiyas`, `VoiceSignals.comparison`, `comparisonDemand`), `server/world-projection.ts` (`populaceComparison` — `channelAverages`'i paylaşır), `app/api/general/route.ts` (`loadComparison`; üyelik artık `activeMembershipOf`'tan), `tests/populace-voice.test.ts` |

Fikir 1'in agregasyonu bilinçli olarak **paylaşılan altyapı** hâlinde
yazıldı: plan belgesinin kararlarına göre Fikir 13 (sessiz kıyaslama, Halkın
kendi tarafında bir talep olarak) ve Fikir 24 (channel-geneli pazar endeksi)
kendi ortalamalarını hesaplamaz, `channelAverages`'ı çağırır. Fikir 13 bunu
uyguladı (`populaceComparison` aynı fonksiyonu çağırıyor, kendi ortalamasını
kurmuyor); Fikir 24 uygulanırken ilk bakılacak yer aynı şekilde
`server/world-projection.ts` ve `engine/comparison.ts`.
