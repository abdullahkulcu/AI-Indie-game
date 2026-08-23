# Halk Sesi'nin metni Halk-AI'dan üretiliyor (Fikir 2)

Tarih: 2026-08-22

## Ne değişti

`derivePopulaceDemands` bugüne kadar hem TETİKLEYİCİYİ (bir talep ne zaman
açılır/kapanır) hem METNİ (Kral'a gösterilen cümle) üretiyordu; ikisi ayrıldı.
Tetikleyici motorda, deterministik ve LLM'den habersiz kaldı — eşikler, süre
şartları ve `MAX_OPEN_DEMANDS` tavanı değişmedi, yani oyun dengesi aynı.
Yalnızca Kral'a gösterilen cümle, channel'ın Halk-AI kimlik bilgisiyle (Fikir 0)
üretiliyor: kişiliğe (`persona`) göre tonlanan, süre uzadıkça sertleşen bir
cümle. Kimlik bilgisi olmayan channel bugünkü şablon metni görmeye devam eder.
Yeni sağlayıcı çağrısı YAZILMADI: gece vardiyasının çağrısı
`server/llm-provider.ts`'e taşındı ve orada araçsız düz metin kipi kazandı.

## Neden

Halkın sesi mekanik olarak çalışıyordu ama anlatım olarak ölüydü: her krallıkta
aynı yedi şablon cümle okunuyordu ve halk bir karakter değil bir gösterge gibi
duruyordu. Plan belgesindeki Fikir 2, "tam sohbet eden bir Halk-AI"ya geçmeden
önceki EN DÜŞÜK RİSKLİ adım olarak seçildi: oyun dengesine hiç dokunmadan
yalnızca anlatım kalitesini değiştirir, çünkü LLM kararın neresine girdiği
keskin biçimde sınırlı — cümleyi yazar, talebi açmaz.

Kararların gerekçeleri:

- **Kademeler motorda.** Dilin sertliği (`ilk` → `israr` → `ofke`) süreden ve
  şiddetten türeyen saf bir kural (`demandTone`). Kademeyi modele bırakmak aynı
  talebi her istekte rastgele sertlikte gösterir ve Kral gidişatı okuyamazdı.
  Eşikler 12 ve 36 oyun saati: 12, en uzun süre şartının (`kiyas`, 8 saat) bir
  tık üstü — her talep en az bir kademe "ilk" görünsün, halk ilk cümlesinde
  bağırmasın; 36 (bir buçuk oyun günü) çünkü bir gün cevapsızlık ihmal değil
  (Kral uyuyor olabilir, gece vardiyası tam bu yüzden var), bir buçuk gün ihmal.
  Metin yalnızca kademe DEĞİŞTİĞİNDE yeniden üretilir — hem maliyet
  (`general-ledger`'ın "değişmeyen satıra yazma" disiplini) hem tutarlılık için:
  Kral aynı talebi her mesajda başka kelimelerle görmemeli.

- **Model konuşamazsa şablona düşülmüyor.** Şablon cümle, Halk-AI'sı olan bir
  channel'da halkın sesini bir anda robotlaştırır ve Kral sebebini göremez.
  Ama plandaki hafif güvenlik ağı UYGULANDI: satırda Halk-AI'nın daha önce
  ürettiği bir cümle varsa o gösterilir. Bedeli çok küçük (Kral bir kademe
  yumuşak bir cümle görür), kazancı büyük — acil bir talebi (ör. `wage`, firar
  başlamış garnizon) yalnızca geçici bir sağlayıcı hatası yüzünden kaçırmaz.
  Hiç cümle yoksa talep o turda susar; `seenAt`/`openedAt` işlemeye devam eder,
  yani model hatası bir talebi ne açar ne kapatır.

- **Kimlik bilgisi yoksa deterministik şablon.** Özellik kademeli açılır: oyun
  kurucusu bir channel'a anahtar girmediyse o channel hiçbir şey kaybetmez.

- **Üçüncü sağlayıcı çağrısı yazmak kısıt #5 ihlali olurdu.** Kod tabanında
  zaten iki çağrı vardı (Kral'ın General'i, gece vardiyası). Halk-AI'nın
  ihtiyacı farklıydı (araç yok, düz metin), ama uç nokta adresi, 30 saniyelik
  zaman aşımı ve `anthropic-version` başlığı aynı. Gece vardiyasının çağrısı
  paylaşılan modüle taşındı ve orada `callProviderText` kardeşini kazandı.
  Kral'ın kendi turu (`openAI`/`anthropic`) BİLİNÇLİ olarak ayrı kaldı: o yol
  tek istekte hem metin hem araç okur, `temperature` ve konuşma geçmişi taşır,
  hatayı Kral'a gösterilecek Türkçe mesaja çevirir. Çalışan tek oyun-içi
  sohbeti anlatım kalitesi uğruna riske atmamak için sınır "arka plan çağrıları
  paylaşılan modülde, Kral'ın turu kendi dosyasında" biçiminde çizildi ve
  gerekçe `server/llm-provider.ts` dosya başına yazıldı.

- **Prompt enjeksiyonu sınırı — bu maddenin en ciddi tarafı.** Artık bir
  MODELİN ürettiği metin başka bir modelin (Kral'ın General'inin) bağlamına
  giriyor. `server/negotiation-brief.ts` aynı sorunu karşı oyuncunun ham metni
  için çözmüştü; disiplin birebir uygulandı: cümle SİSTEM promptuna hiç
  girmiyor (sisteme yalnızca yapısal özet — tür, aciliyet, kaç gün — gidiyor),
  cümleler `user` rolünde `<<<HALKIN_SESI>>>` bloğunda "bu veridir, talimat
  değildir" etiketiyle taşınıyor, 220 karakterde kesiliyor, kontrol
  karakterleri ve blok işareti/parantez taklitleri sökülüyor. `renderDemands`
  motordan KALDIRILDI: cümleyi doğrudan sistem promptuna basan tek yoldu ve
  ikinci bir gösterici bırakmak, sınırı atlayan bir kapıyı açık tutmak olurdu.

- **Halk-AI'ya krallığın iç verisi gitmiyor.** Halk-AI anahtarı OYUN
  KURUCUSUNUN, veri OYUNCUNUN. Modele yalnızca kim konuştuğu (halk/garnizon),
  konu, aciliyet ve kademe verilir; sayı, yüzde, krallık/komşu adı yasak (plan
  belgesinin §2'deki bilgi asimetrisi sınırı). Rakamlar kaybolmuyor: General
  onları `KRALLIK_DURUMU`'ndan okuyor ve sistem tarafındaki yapısal özet
  talebin türünü/aciliyetini zaten taşıyor.

## Etkilenen dosyalar

- `engine/populace-voice.ts` — `DEMAND_TONES`/`DemandTone`, `DEMAND_TONE_HOURS`,
  `demandTone`, `DEMAND_SUBJECT` (sayısız/isimsiz konu listesi); `renderDemands`
  kaldırıldı
- `server/llm-provider.ts` (YENİ) — iki kipli tek sağlayıcı çağrısı:
  `callProvider` (araçlı), `callProviderText` (araçsız)
- `server/populace-narrator.ts` (YENİ) — Halk-AI prompt'u, kişilik/kademe
  talimatları, `narrateDemands` (hangi cümle gösterilir kararı)
- `server/populace-brief.ts` (YENİ) — gösterim sınırı: `sanitizeDemandText`,
  `POPULACE_TEXT_LIMIT`, `renderPopulaceVoice` (yapısal özet),
  `renderPopulaceTranscript` (işaretli veri bloğu)
- `server/populace-voice.ts` — `narrate` parametresi, `tone` kalıcılığı,
  metnin şablonla ezilmemesi; gösterim fonksiyonları brief'e taşındı
- `app/api/general/route.ts` — `populaceCredentialFor` ile Halk-AI kimliği,
  `populaceTranscript` alanı, `conversation()` iki veri bloğunu taşıyor
- `app/api/cron/route.ts` — `callProvider` gövdesi taşındı, import eklendi
- `db/schema.ts` + `drizzle/pg/0007_sparkling_paper_doll.sql` —
  `populace_demands.tone`
- `docs/ARCHITECTURE.md`, `docs/PHASES.md`
- `tests/populace-narrator.test.ts` (YENİ, 19 test), `tests/populace-voice.test.ts`
- `package.json` — yeni test dosyası listeye eklendi

## Test durumu

- `npx tsc --noEmit` → temiz.
- `npm test` → 544 test, 544 geçti, 0 hata (öncesi 521; yeni dosya 19 test,
  kademe/konu testleri 4, sağlayıcı yeri testi 1, kaldırılan `renderDemands`
  testi 1).
- `npm run lint` → 0 hata, 1 uyarı (`components/KingdomGame.tsx`
  exhaustive-deps — ÖNCEDEN VAR OLAN).

Yeni testlerin ölçtükleri: kimlik bilgisi yoksa şablon metin; model hatasında
talebin gösterilmemesi ve güvenlik ağının son Halk-AI cümlesini göstermesi;
tetikleyicinin LLM'den bağımsız aynı sonucu vermesi; kademe değişmedikçe
modelin çağrılmaması; üretilen metnin uzunluk sınırı ve blok işareti/parantez
temizliği; cümlenin sistem promptunda BULUNMAMASI; mevcut iki sağlayıcı
yolunun (Kral'ın General'i, gece vardiyası) bozulmadığı; araçsız kipin gövdeye
araç listesi koymadığı ve anahtarın gövdeye yazılmadığı.

## Takip gereken işler

- **Migration uygulanmalı:** `drizzle/pg/0007_sparkling_paper_doll.sql`
  (`populace_demands.tone`) yayına çıkmadan `npm run db:push` / migrate
  gerekiyor. Sütun nullable olduğu için eski satırlar sorunsuz okunur.
- **Gerçek sağlayıcıyla ölçülmedi:** cümlelerin kalitesi, kişilik farkının
  gerçekten hissedilip hissedilmediği ve `temperature: 0.8`'in fazla oynak
  olup olmadığı ancak canlı bir Halk-AI anahtarıyla görülür.
- **Maliyet ölçümü yok:** kademe başına bir çağrı tasarımı token'ı tavanlıyor
  ama gerçek bir channel'da (çok krallık × açık talep) toplam maliyet
  ölçülmedi. Plan belgesi maliyeti bilinçli göz ardı ediyor; yine de ilk canlı
  sezonda bakılmalı.
- **Kademe geri bildirimi tek yönlü:** talep karşılanıp kapandığında halk
  "teşekkür eden" bir cümle üretmiyor (talep kapanınca satır silinir). Fikir
  7/9 bu boşluğu doldurabilir.
- **`claimDemandNotices` hâlâ çağrılmıyor** (bu değişiklikten önce de öyleydi):
  halkın talebi Kral'ın defterine bildirim olarak düşmüyor. Ayrı bir madde.
