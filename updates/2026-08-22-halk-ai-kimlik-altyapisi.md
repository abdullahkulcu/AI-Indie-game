# Halk-AI kimlik altyapısı (Fikir 0)

Tarih: 2026-08-22

## Ne değişti

Halkın kendi AI'sının kimlik bilgisi için ayrı bir model kuruldu: yeni
`populace_credentials` tablosu bir channel'a **varsayılan** kişilik+model+anahtar,
istenirse belirli krallıklara **override** tutuyor (`user_id` NULL ise satır
channel varsayılanıdır). Çözümleme sırası (krallık override'ı > channel
varsayılanı > yok) tek bir yerde, `server/populace-ai-credentials.ts` içinde
yaşıyor; veritabanı tarafı `server/populace-ai-desk.ts` → `populaceCredentialFor`.
Şifrelemede `server/byok-crypto.ts`'in ek verisi (AAD) bir **kapsam** dizgesine
genelleştirildi; kişilik listesi motorda tek kaynak oldu
(`engine/populace-persona.ts`); admin paneline anahtarı, kişiliği ve modeli
yöneten bir bölüm ve uç (`/api/admin/populace-ai`) eklendi. **Hiçbir LLM
çağrısı, prompt ya da halk metni yok** — halkın konuşması Fikir 2'nin işi.

## Neden

Plan belgesinin sabit kararı (`docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`,
§2 madde 1): General'in token'ını oyuncu, Halk'ın token'ını **oyun kurucusu**
öder. Bugünkü `llm_credentials` tablosu bunu taşıyamıyor, çünkü birincil
anahtarı `user_id` — "kullanıcı başına tek satır". Halk-AI'da ise bir
channel'ın varsayılanı ile o channel içindeki krallık override'larının BİR
ARADA yaşaması gerekiyor (Fikir 0'ın "karışık kimlik seviyesi" kararı). Ayrıca
Fikir 2/7/8/9/15/16'nın hepsi bu kimlik bilgisine bağımlı; altyapı önce
kurulmazsa her fikir kendi geçici çözümünü üretir ve öncelik sırası altı yerde
ayrı ayrı yazılırdı.

**Asıl tasarım sorunu şifrelemedeydi.** `byok-crypto`'nun `additionalData`'sı
`(userId, provider, model, version)` alıyor ve anahtarı bir KULLANICIYA
bağlıyor — bu, bir kullanıcının anahtarının başkası adına çözülememesini
sağlayan güvenlik özelliği. Halk-AI anahtarının sahibi bir kullanıcı değil, bir
channel. İki yol vardı; seçilen yol **(a) genelleştirme**:

- AAD'nin kimlik bölümü artık bir **kapsam** (`ByokScope`) dizgesi. Oyuncu
  kapsamı ÇIPLAK `userId` olarak yazılıyor (`userScope`), yani v1 AAD baytları
  harfiyen korunuyor ve bugüne kadar şifrelenmiş HER oyuncu anahtarı çözülmeye
  devam ediyor. Kardeş fonksiyon çifti (yol b) yazmak da çalışırdı ama iki
  fonksiyon çifti aynı AAD biçimini iki yerde kurar ve ilk sapmada biri
  diğerinin anahtarını çözemez hâle gelirdi (CLAUDE.md kısıt #5).
- Yeni kapsamlar kendi ad alanını taşıyor: `halk-ai:channel:<id>` ve
  `halk-ai:kingdom:<channelId>:<userId>`. Kullanıcı kimlikleri
  `crypto.randomUUID()` ürünü olduğu ve iki nokta içermediği için bir kapsam
  dizgesi bir userId'ye asla eşit olamaz — kapsamlar birbirine karışamaz.
- `ByokScope` marka tipli: kapsam bekleyen yere elle bir kimlik dizgesi
  geçirmek DERLEME hatası. "channelId'yi userId parametresine kaçak sokma"
  hatası böylece tekrar edilemez hâle geldi.

Geriye dönük uyum **kanıtla** sabitlendi: testteki altın örnek (şifre metni +
iv + sır) DEĞİŞİKLİKTEN ÖNCEKİ koda `git show HEAD:server/byok-crypto.ts` ile
ulaşılıp onunla üretildi ve yeni kodla çözülüyor. `userScope`'u
`user:${userId}` yapan geçici bir mutasyon bu testi gerçekten kırdı (sonra
geri alındı), yani test taşıyıcı.

Sır disiplini (CLAUDE.md kısıt #4) tasarımın başında kuruldu, sonradan yama
olarak değil: anahtar yalnızca istek gövdesinde bir kez geliyor, şifreli
yazılıyor ve bir daha hiçbir cevapta, logda ya da panelde görünmüyor. Panelin
okuduğu SELECT listesi (`POPULACE_SUMMARY_COLUMNS`) `encrypted_key`/`iv`/
`key_version`'ı hiç içermiyor; cevaplar sır sütunlarını yayılımla değil tek tek
atlayan bir özet fonksiyonundan kuruluyor (`intelReportOf`'un izin-listesi
deseni). Anahtarın çözüldüğü tek yer, modelin AAD'ye yazması yüzünden zorunlu
olan "model değişiminde yeniden şifrele" yolu ve çözümleyicinin kendisi; iki
yerde de değer yalnızca bellekte kalıyor ve hata metinleri yutuluyor.

## Etkilenen dosyalar

- `engine/populace-persona.ts` (yeni — kişilik listesi, tek kaynak; saf sabit)
- `server/byok-crypto.ts` (kapsam genellemesi; `encryptByok`/`decryptByok`
  imzaları ve ürettikleri AAD değişmedi)
- `server/populace-ai-credentials.ts` (yeni — kapsam seçimi, öncelik kuralı,
  çözme, sır taşımayan özet; `../db` import ETMİYOR ki testten çağrılabilsin)
- `server/populace-ai-desk.ts` (yeni — `populaceCredentialFor`: aktif üyelik +
  tek sorgu + saf kural)
- `db/schema.ts` (`populaceCredentials` tablosu)
- `drizzle/pg/0006_bent_inertia.sql`, `drizzle/pg/meta/0006_snapshot.json`,
  `drizzle/pg/meta/_journal.json` (`npm run db:generate` ile üretildi)
- `app/api/admin/populace-ai/route.ts` (yeni — GET/PUT/PATCH/DELETE, hepsi
  yönetici yetkisi arıyor)
- `app/api/admin/route.ts` (oyuncu satırlarına `channelIds`: override seçimi
  channel KİMLİĞİ ister, channel adları tekil değil)
- `app/admin/page.tsx`, `app/admin.css` (Halk-AI bölümü ve uyarı metinleri)
- `tests/populace-ai-credentials.test.ts` (yeni, 19 test), `package.json`

## Test durumu

- `npx tsc --noEmit` → temiz
- `npm test` → **521 test, 521 geçti** (öncesi 502; 19'u bu paketten)
- `npm run lint` → 0 hata, 1 UYARI (`components/KingdomGame.tsx`
  `exhaustive-deps`, bu paketten ÖNCE de vardı)
- `npm run db:generate` → yalnızca yeni tabloyu üretti; ikinci çağrı
  "No schema changes" dedi (şema ile migration'lar tutarlı)
- `npm run build` → başarılı; `/api/admin/populace-ai` yolu kayıtlı görünüyor

## Takip gereken işler

- **Migration üretimi salt EKLEME.** `0006` yalnızca `CREATE TABLE
  populace_credentials` + üç yabancı anahtar + iki kısmi unique index içeriyor;
  mevcut hiçbir tabloya/sütuna dokunmuyor, veri taşımıyor. Yine de üretim
  şemasını değiştiriyor: dağıtımda migration'ın uygulanması gerekir, yoksa uç
  "relation does not exist" ile 500 döner.
- Ana şifreleme sırrı olarak mevcut `BYOK_MASTER_KEY` kullanıldı; ayrı bir
  `POPULACE_MASTER_KEY` açılmadı. Kapsam ayrımı kriptografik olarak AAD ile
  sağlanıyor, ama admin anahtarlarını oyuncu anahtarlarından bağımsız
  döndürmek (rotate) istenirse ayrı bir sır gerekir.
- Kimlik bilgisi var ama anahtar çözülemiyorsa (ana anahtar değişmiş, satır
  elle bozulmuş) çözümleyici `null` dönüyor: halk deterministik sesine düşer,
  panelde satır "bağlı" görünmeye devam eder. Panelde bir "sağlık/test"
  düğmesi (anahtarı gerçekten çözebiliyor muyuz) ileride eklenebilir; sır
  loglanamayacağı için bugün bu ayrım sessiz.
- Kişilik/model değişimi kodda KİLİTLİ DEĞİL: karar "nadiren, sezon başına"
  diyor ve bu, uçtaki yorum ile paneldeki uyarı metni olarak yaşıyor.
  Gerçekten kilitlenmesi istenirse (ör. sezon başladıktan sonra PATCH'i
  reddetmek) channel'ın `startsAt` alanına bakan bir kural gerekir.
