# Demirkale — Canlı Dünya ve Halk AI Vizyonu

Tarih: 2026-08-22

## Bu belge nedir, nasıl kullanılır

Bu bir **spesifikasyon değil, tartışma belgesidir** — `docs/PHASES.md`'nin
aksine, burada anlatılanların hiçbiri henüz uygulanmaya karar verilmiş
"faz" değildir. Amaç, Kral'ın (kullanıcının) verdiği vizyonu kod tabanının
gerçek durumuna oturtmak, somut fikirler üretmek ve **karar bekleyen açık
soruları görünür kılmak**. Her fikrin yanında bir "Açık sorular" bölümü var;
bunlar cevaplandıkça bu belge güncellenir (yeni bölüm eklenir, eski
silinmez — `docs/PHASES.md`'nin güncelleme kuralıyla aynı disiplin).
Sıralama bir öneridir, bir taahhüt değil. Maliyet (Halk AI'sının token
faturası) bilinçli olarak hiçbir fikri elemek için kullanılmadı; büyük
fikirlerin yanında "maliyet burada konuşulacak" notu var, o kadar.

Her fikrin yanında bir **Kaynak** satırı var: kimin önerisi olduğu
(Kral'ın kendi vizyon paragrafından doğrudan çıkan, önceki oturumda
Claude'un önerdiği somut senaryolar, ya da bu belgeyi yazan oturumun
kendi ürettiği) açıkça işaretlendi — hangi fikrin tamamen orijinal
olduğu bu satırdan okunur.

**Kapsam notu:** Bu belge, kullanıcının açık isteğiyle, YALNIZCA
Halk-AI vizyonuyla (kullanıcının halkı ve General'i ayrı bir AI olarak
canlandırma fikri) sınırlıdır. Askerler/savaş yapısı, ortak maden, pazar
ve channel-genelinde dünya olayları gibi konularda ayrı fikirler
üretilebilir ama bunlar KASITLI olarak bu belgenin dışında tutuldu —
kullanıcı önce onları ayrı bir sohbette değerlendirip karara bağlayacak,
karar netleştikten sonra (bu belgeye ya da ayrı bir belgeye) eklenecek.

## 1. Vizyon (birebir, Kral'ın kendi ifadesiyle)

> Ben aslında kendi kendine yaşayan ve sürekli hayatta olduğu hissini veren,
> asıl meselenin savaşmak değil bazen halkı kendine çekmek veya onların
> ekonomisini bozmak veya iç karışıklık yaratarak asker olmadan bile savaş
> kazanmak [olduğu bir oyun istiyorum]. Halkın yeri geldiği zaman kralın
> arkasında durduğu yeri geldiğinde de kralına karşı çıktığı, gerçekten
> demokrasi ve strateji ile çalışacağı ve aynı zamanda sadece kralın akıl
> kattığı değil bazen oyunun kraldan daha akıllı olduğu ve bu süreçlerin
> gerçek hayata bazen bir Slack bildirimiyle gelip "kralım böyle böyle oldu
> ne yapalım" gibi diyeceği ve sürecin Slack üzerinden bile devam
> edebileceği, uzun soluklu ve insanların günlük olarak en az 1 saat
> bakması gereken bir oyun yaratmak istiyorum.

## 2. Sabit tasarım kararları (tartışmaya kapalı)

Bu iki karar aynı oturumda netleşti ve aşağıdaki HER fikir buna göre
süzülmeli — biri bunlardan birini ihlal ediyorsa fikir değil, kısıt
ihlalidir.

1. **General ve Halk, tamamen farklı iki AI.** General'in token'ı
   oyuncunun kendi BYOK anahtarından gelir (bugün olduğu gibi,
   `llm_credentials` tablosu, `server/byok-crypto.ts`). Halkın token'ını
   **oyun kurucusu (admin/işletmeci)** öder — channel bazında, farklı
   model / farklı "kişilik" (isyankâr, zeki-istekli, bağlı-itaatkâr)
   verilebilir. Bu, bugünkü `llm_credentials` şemasının (kullanıcı başına
   tek satır, kullanıcının kendi şifrelediği anahtar) Halk AI'sı için
   **kullanılamayacağı** anlamına gelir — ayrı bir kimlik bilgisi modeli
   gerekir (bkz. Fikir 0).
2. **Bilgi akışı kesin asimetrik.** Halk, Kral'ın/krallığın iç verisine
   (kaynaklar, ordu, bina, hazine) erişemez. Halk'ın kendi refahını
   (rıza/mutluluk gibi) channel'daki diğer krallıkların halklarıyla
   kıyaslaması serbest. General, halka **gidip soramaz** — Halk-AI'sının
   bir sorgu API'si yok. Ama Halk, kendi kıyaslamasına dayanarak Kral'a
   doğrudan gelip isyan/talep/basınç oluşturabilir. Bilgi **tek yönlü**
   akar: halk-kıyaslaması → Kral'ın bilgisi. Ters yönde asla.
   **TEK BİLİNÇLİ İSTİSNA (bkz. Fikir 9, karar 2026-08-22):** Referandum
   fikri için kullanıcı bu kuralı KASITLI olarak esnetti — Kral (General
   aracılığıyla) halka AÇIKÇA ve HALKIN DA BİLEREK cevap verdiği bir soru
   sorabilir. Bu, General'in gizlice bilgi sızdırmasından farklı: açık,
   karşılıklı, Kral'ın başlattığı bir davettir. Bu istisna yalnızca
   referandum mekanizmasına özeldir, genel kuralı geçersiz kılmaz.

## 3. Bugünkü kod tabanı — bu vizyonun üstüne oturacağı zemin

Kısa bir harita (tam ayrıntı `docs/ARCHITECTURE.md`'de):

- **Halkın sesi bugün zaten var ama tamamen deterministik ve metni
  sabit.** `engine/populace-voice.ts` → `derivePopulaceDemands`, krallığın
  durumundan (istihkak, vergi, huzursuzluk, doluluk) talep üretir; metin
  kod içinde şablon string'dir (`text: food < ... ? \`Halk ekmek
  istiyor...\` : ...`). Hiçbir LLM çağrısı yoktur. `server/populace-voice.ts`
  bu talebin ne zamandan beri açık olduğunu tutar. **Halk'ın bir "sesi" var
  ama bir "AI'sı" yok** — vizyonun istediği şey bu ayrımın üstüne kurulacak.
- **Nominal ve fiilî değer zaten ayrı tutuluyor.** `foodRation` (Kral'ın
  ayarladığı yüzde) ile `servedFood` (ambar yetmiyorsa fiilen dağıtılan,
  daha düşük olabilen miktar) bugün de farklı alanlar
  (`engine/populace.ts`, `engine/market.ts`'in "kâğıt üstünde vs fiilen
  dağıtılan" ilkesi) — bu ayrım aşağıdaki Fikir 14'ün doğal zemini.
- **Göç hedefi zaten göreceli bir kıyasla seçiliyor, ama gitme kararının
  kendisi mutlak.** `engine/migration.ts` → `pickMigrationTarget`
  channel'daki adaylar arasında (boş konut × çekicilik) ağırlıklı bir
  seçim yapıyor; ama bir krallıktan nüfusun AYRILMA kararı
  (`engine/populace.ts` → `populationChange`) yalnızca o krallığın KENDİ
  mutlak rızasına bakıyor, komşularla kıyas yok (bkz. Fikir 17).
- **Asker olmadan savaş zaten var ama UI'da gömülü.** `engine/agitation.ts`
  (dış kese: altın→hizip baskısı veya asker huzursuzluğu, mal kesesi→pazar
  bozma, haydut yönlendirme→akın sıklığını kaydırma) ve `engine/faction.ts`
  (iç hizip: rıza uzun süre düşükse elebaşı çıkar, Kral'ın bastıracak bir
  emri **yok**, yalnızca rızayı yükselterek erir). Bunlar `diyar` sekmesinde
  "DIŞ KESE" paneli olarak var ama oyunun ana anlatısı hâlâ "bina kur, asker
  eğit". Faz 6 ile (bugün, bu oturumda tamamlandı — bkz. aşağıdaki not)
  göç artık channel'daki başka bir krallığa gerçekten ulaşıyor, yani
  "halkı kendine çekmek" mekaniğinin bir parçası (pasif göç) zaten
  çalışıyor durumda.
- **Gece vardiyası altyapısı zaten proaktif bir "General" için hazır.**
  `app/api/cron/route.ts` → `runOne`, saatte bir standing order'ları
  kontrol eder, model yalnızca gerçekten yapılacak bir şey varsa çağrılır
  (`server/night-shift.ts` → `shouldWake`, token disiplini). Bu, "Kader"
  katmanı gibi proaktif bir sistemin oturacağı **hazır bir iskelet**tir.
- **Tek yönlü bildirim kanalı zaten var.** `server/king-notice.ts` →
  `noteToKing`, sunucunun Kral'ın defterine (`game.notices`) yazdığı TEK
  yer. Bugün yalnızca oyun içi; Slack'e gitmiyor.
- **Asimetrik bilgi sınırı zaten bir yerde uygulanmış — örnek alınabilir.**
  `server/world-projection.ts` → `intelReportOf`: ajan raporu asker/kale/
  nüfus verir ama ambar/nöbet/maaş/rıza **vermez**; alanlar tek tek
  yazılır (`...kingdom` yayılmaz), "yeni alan sessizce sızmasın" diye.
  Halk-AI'sının Kral'a neyi gösterip göstermeyeceği tasarlanırken bu
  desen (izin listesi, red listesi değil) doğrudan kopyalanabilir.
- **Halk'ın sesi bugün her zaman General'in ağzından geçiyor.**
  `app/api/general/route.ts` → `loadPopulaceVoice`, Halk'ın talebini
  `body.memoryLines`'a ekleyip General'in sistem promptuna gömüyor —
  yani teknik olarak Kral'a konuşan hep General'dir, Halk'ın "sesi" bir
  veri bloğu olarak ona görünür (bkz. Fikir 16).
- **Düzeltme notu — `docs/PHASES.md` bir noktada eskimiş:** O belge Faz
  6'yı ("göçün çok krallığa dağılması") hâlâ "🔴 BACKLOG — HENÜZ
  YAPILMADI" diye işaretliyor. Ama bu oturumda kod tabanında doğrulandı:
  Faz 6 **bugün tamamlandı** (`updates/2026-08-22-faz6-goc-dagilimi.md`,
  `engine/migration.ts`, `db/schema.ts` → `migrations` tablosu,
  `app/api/cron/route.ts` → `settleMigrations`, 483 test geçiyor). Bu
  belge o düzeltmeyi yapmıyor (kapsam dışı, salt planlama görevi) ama
  aşağıdaki fikirler doğru zemine (Faz 6 TAMAM) göre yazıldı.

## 4. Fikir listesi (önerilen sıra)

Sıralama mantığı: önce AI gerektirmeyen/ucuz olanlar, sonra Halk-AI'nın
kimlik altyapısı, sonra o altyapıyı kullanan fikirler, en sonda büyük
mimari katmanlar (Kader, Slack iki-yönlü). Numaralar öncelik değil sıradır.

---

### 0. Halk-AI kimlik altyapısı (admin finanse eder, channel bazlı)

**Kaynak:** Kral'ın vizyon paragrafı + aynı oturumda netleşen sabit karar (§2, madde 1).

Vizyonun "Halk'ın token'ını admin öder, channel bazında farklı model/
kişilik" kararının **teknik ön koşulu**. Bugünkü `llm_credentials`
tablosu kullanıcı başınadır ve kullanıcının kendi anahtarını şifreler
(`server/byok-crypto.ts`, `additionalData` içinde `userId` taşır) — bu
modelin Halk-AI'sı için doğrudan kullanılması hem kavramsal olarak yanlış
hem de `byok-crypto`'nun "anahtar başka kullanıcıya kopyalanıp
çözülemez" tasarımıyla çakışır. Gereken: channel'a (ya da krallığa) bağlı
yeni bir kimlik bilgisi tablosu ve admin panelinde (`app/admin/page.tsx`)
bunu yöneten bir ekran.

- **Hizmet ettiği:** Halk'ın "kendi AI'sı olması" vizyonunun tamamı buna
  bağımlı; aşağıdaki her Halk-AI fikri (2, 7, 15) bunun üstüne kurulur.
- **Efor:** büyük — yeni tablo, yeni şifreleme akışı, yeni admin ekranı.
- **Açık sorular:**
  - Persona başına tek model mi, yoksa admin dilediği zaman değiştirebilir
    mi? Değiştirirse geçmiş konuşma/ton tutarlılığı bozulur mu?
  - Kimlik bilgisi channel'a mı (bir channel = bir persona, o channel'daki
    TÜM krallıkların halkı aynı "sesi" konuşur) yoksa krallığa mı bağlı
    (her krallığın halkı ayrı persona)? Vizyondaki "biri isyankâr, biri
    zeki, biri itaatkâr" ifadesi krallık bazlı persona'yı işaret ediyor
    gibi duruyor — bu, channel bazlıdan çok daha fazla admin anahtarı
    (ve maliyet) demek. Hangisi?
  - Admin'in kendi API anahtarını girdiği bir arayüz güvenlik açısından
    `llm_credentials`'ın aynı kısıtlarına (asla SELECT/log/commit'e
    girmeme, CLAUDE.md kısıt #4) tabi olacak — bu, tasarımın en başında
    netleşmeli, sonradan yama olarak eklenmemeli.

- **Karar (2026-08-22):**
  - Model/kişilik **değiştirilebilir ama nadiren** (ör. sezon başına) —
    tam sabit değil, admin dilediği anda değil.
  - Kimlik seviyesi **karışık**: admin channel'a bir varsayılan persona
    atar; isterse belirli krallıklara özel farklı bir persona verebilir
    (override). Başlangıçta düşük maliyet (channel varsayılanı yeter),
    ihtiyaç halinde krallık bazlı detaylandırma imkanı açık kalır.

---

### 1. Channel ortalamasını (anonim, AI'sız) panelde göstermek

**Kaynak:** Claude'un önerisi (ilk brief, "hızlı/mevcut altyapıya oturanlar" #3).

Kral'ın "diyar" sekmesinde, kendi krallığının rızasını/istihkakını
channel'daki DİĞER krallıkların ortalamasıyla (anonim, isimsiz) yan yana
gösteren basit bir panel. Hiçbir AI çağrısı yok — yalnızca `game_saves`
tablosundaki channel üyelerinin `popularity`/`foodRation` gibi alanlarının
ortalaması, `server/world-projection.ts`'in zaten yaptığı gibi
tek tek okunup özetlenir.

- **Hizmet ettiği:** "halkın diğer krallıklarla kıyaslaması" vizyonunun en
  ucuz, AI'sız ilk versiyonu; Fikir 2'nin (Halk-AI'nın konuşması) ve Fikir
  13'ün (sessiz kıyaslama) önkoşulu — kıyaslama VERİSİ önce var olmalı ki
  bir talep ya da AI ona bakıp bir şey söylesin.
- **Bugün en yakın ne var / eksik:** `server/world-projection.ts` benzer
  bir "başka krallığın dışa görünen yüzü" deseni kuruyor ama tek krallık
  için, tek seferlik. Eksik olan: channel genelinde bir agregasyon sorgusu
  ve bunu "diyar" sekmesine bir kart olarak ekleyen UI.
- **Efor:** hızlı — yeni bir API ucu (`GET /api/world` içine eklenebilir)
  ve `ChannelWorldMap.tsx`/`KingdomGame.tsx`'e küçük bir panel.
- **Açık sorular:**
  - Ortalamaya hangi metrikler girsin — yalnızca rıza mı, yoksa istihkak/
    vergi/hizip baskısı gibi daha fazla eksen mi? Fazla eksen "asimetrik
    bilgi" sınırına (Kral'ın rakip krallığın İÇ verisine erişememesi
    gerektiği) ne kadar yaklaşıyor — ortalama anonim olsa bile "channel
    ortalama vergisi %22" gibi bir sayı Kral'a rakiplerin iç kararları
    hakkında dolaylı bilgi sızdırır mı?
  - Kuruluş koruması süren krallıklar ortalamaya girsin mi (dış kese ve
    göç sistemlerinin ikisi de bu krallıkları hariç tutuyor, aynı kural
    burada da geçerli olmalı gibi duruyor, ama teyit gerekir)?

- **Karar (2026-08-22):**
  - Ortalamaya **rıza + istihkak + vergi + hizip baskısı** girer (zengin
    kıyaslama tercih edildi). Not: küçük channel'larda (az sayıda krallık)
    bu ortalama tek bir rakibin durumunu neredeyse birebir yansıtabilir —
    channel büyüklüğü arttıkça bu sızıntı riski doğal olarak seyrelir;
    uygulamada bir alt sınır (ör. en az N aktif krallık yoksa panel
    gösterilmez) gerekip gerekmediği ayrıca değerlendirilmeli.
  - Kuruluş koruması süren krallıklar ortalamaya **girmez** (dış kese/göç
    ile aynı kural).

---

### 2. Halk Sesi'nin metnini Halk-AI'dan üretmek (köprü fikri)

**Kaynak:** orijinal (bu belge için üretildi).

Bugün `derivePopulaceDemands` hem TETİKLEYİCİYİ (bir talep ne zaman
açılır) hem METNİ (Kral'a gösterilen cümle) üretiyor — ikisi de
deterministik. Bu fikir onları ayırır: **tetikleyici deterministik kalır**
(engine'in saflık kısıtı bozulmaz, testler hâlâ geçerli kalır), ama talep
açıldığında Kral'a gösterilecek CÜMLE, Halk-AI'sına (Fikir 0'ın
altyapısıyla) "şu durumdasın, bir şey söyle" diye sorulup üretilir. Bu,
tam bir sohbet Halk-AI'sına geçmeden önce **en düşük riskli ilk adım**dır:
oyun dengesi hiç değişmez, yalnızca anlatım kalitesi değişir.

- **Hizmet ettiği:** "halkın gerçek bir sesi olması" — bugünkü şablon
  metinler ("Halk ekmek istiyor: istihkak %60'e indi...") yerine her
  krallığa özgü, persona'ya göre değişen bir ton.
  Ayrıca "kendi kendine yaşıyor hissi"ne doğrudan katkı.
- **Bugün en yakın ne var / eksik:** `engine/populace-voice.ts` →
  `DemandCandidate.text` zaten yapılandırılmış bir veri (kind, severity,
  hangi eylemler karşılar) taşıyor; eksik olan bu yapının LLM'e
  gönderilip METNİN yerine geçecek bir cümle üretilmesi ve bunun
  `server/populace-voice.ts`'te (ya da yeni bir `server/populace-voice-ai.ts`
  dosyasında) önbelleklenmesi (her istekte yeniden üretmemek için —
  `general-ledger.ts`'in "değişmeyen satıra yazma" disiplini örnek
  alınabilir).
- **Efor:** orta — yeni bir server modülü + Fikir 0'ın altyapısı hazırsa
  üstüne kolayca oturur; Fikir 0 hazır değilse geçici olarak TEK bir admin
  anahtarıyla (channel/persona ayrımı olmadan) prototiplenebilir.
- **Açık sorular:**
  - Metin her okumada mı üretilir yoksa talep açıldığı AN'da bir kez
    üretilip `populace_demands` tablosunda mı saklanır (maliyet ve
    tutarlılık için ikincisi mantıklı görünüyor — talep süredursun aynı
    cümle tekrar etmemeli mi, yoksa süre uzadıkça cümle sertleşmeli mi,
    tıpkı `engine/ledger.ts`'teki `weight` arttıkça dilin sertleşmesi
    gibi)?
  - LLM çağrısı başarısız olursa (sağlayıcı hatası) şablon metne (bugünkü
    davranışa) mı düşülür? Muhtemelen evet ama bu açıkça karara
    bağlanmalı — sessiz düşüş "Halk'ın sesi kesildi" gibi görünmemeli.

- **Karar (2026-08-22):**
  - Metin, `engine/ledger.ts`'teki ağırlık deseniyle tutarlı olarak
    **süre uzadıkça yeniden üretilir ve dil sertleşir** (maliyet bilinçli
    olarak göz ardı edildi, bkz. genel not).
  - LLM çağrısı başarısız olursa talep **bu turda hiç gösterilmez**
    (şablona düşülmez). Not: bu, Kral'ın acil bir talebi (ör. `wage`
    ivedi) yalnızca sağlayıcı hatası yüzünden kaçırabileceği anlamına
    gelir — kabul edilen bir risk, ama uygulamada bir tekrar-deneme
    (retry) ya da "son bilinen metni göster" gibi hafif bir güvenlik ağı
    düşünülebilir.

---

### 3. Asker olmadan savaşı ana anlatıya taşımak

**Kaynak:** Claude'un önerisi (ilk brief, "hızlı/mevcut altyapıya oturanlar" #2).

Dış kese, mal kesesi, haydut yönlendirme ve iç hizip bugün `diyar`
sekmesinde küçük bir panel olarak duruyor; oyunun "asıl meselesi" bunlar
değil bina/asker gibi görünüyor. Bu fikir kod değişikliği değil, **konum
ve anlatım** değişikliği: General'in sistem promptuna (`gamePrompt`)
"savaşsız zafer" doktrinini daha güçlü işlemek, UI'da bu araçları "meclis"
ya da yeni bir "İSTİHBARAT" sekmesine öne çıkarmak, ve belki bir "zafer
skoru" göstergesine (bir krallığın kaç komşuyu asker kullanmadan zayıflattığı)
eklemek.

- **Hizmet ettiği:** "asıl mesele savaşmak değil" vizyonunun doğrudan
  karşılığı.
- **Bugün en yakın ne var / eksik:** Mekanik TAM (Faz 4/5/7, bkz. §3),
  eksik olan yalnızca görünürlük ve çerçeveleme.
- **Efor:** hızlı — UI yeniden düzenleme + prompt metni değişikliği,
  yeni sistem yok.
- **Açık sorular:**
  - "Zafer" bu oyunda hiç tanımlanmadı (channel'lar süreye bağlı bitiyor,
    bkz. `channels.durationDays`) — asker olmadan kazanmanın somut bir
    ölçütü olacak mı (örn. sezon sonunda en yüksek nüfus/rıza), yoksa bu
    tamamen anlatısal mı kalacak?
  - Yeni bir sekme mi (yedi sekmeye çıkmak `components/KingdomGame.tsx`'teki
    `Tab` tipini ve `tabs six` CSS sınıfını değiştirir) yoksa mevcut
    `diyar`'ın içinde mi büyütülecek?

- **Karar (2026-08-22):**
  - Somut bir **"zafer skoru"** olacak (sezon sonu ölçütü) — yeni bir
    puanlama sistemi tasarımı gerektirir, bu maddeyi tek başına "hızlı"
    olmaktan çıkarır (bkz. güncellenmiş efor notu aşağıda).
  - Bu araçlar yeni bir **"İSTİHBARAT" sekmesinde** öne çıkar — `Tab`
    tipi yediye çıkar, `KingdomGame.tsx`'teki sekme CSS'i güncellenir.
  - **Efor güncellemesi:** kararlar nedeniyle bu madde artık "hızlı"
    değil **"orta"** — yeni sekme + zafer skoru formülü + formülün nasıl
    hesaplanacağı (hangi olaylar kaç puan) ayrı bir tasarım gerektiriyor.

---

### 4. Slack bildirimi (tek yönlü)

**Kaynak:** Claude'un önerisi (ilk brief, "hızlı/mevcut altyapıya oturanlar" #1).

Kritik bir olay (hizip eşiği aşıldı, dış kese ifşa oldu, garnizon isyan
etti, gece vardiyası riskli bir öneri hazırladı) olduğunda `noteToKing`'in
yazdığı satırın **aynı anda** bir Slack webhook'una da gitmesi. Kral
oyunu açık tutmadan "krallığında bir şey oluyor" bilgisini alır.

- **Hizmet ettiği:** "gerçek hayata bir Slack bildirimiyle gelmesi" ve
  "günlük en az 1 saat bakma" alışkanlığı — bildirim olmadan oyuncu
  krizi kaçırıp giriş yapmayı unutur.
- **Bugün en yakın ne var / eksik:** `server/king-notice.ts` → `noteToKing`
  TEK yazma noktası; bu, Slack entegrasyonunun ekleneceği DOĞRU ve TEK
  yer (tek-doğru-kaynak ilkesiyle uyumlu — CLAUDE.md kısıt #5). Eksik olan:
  Kral'ın kendi Slack webhook URL'sini kaydedebileceği bir alan (yeni
  tablo ya da `channel_members`'a sütun) ve `noteToKing` içinde koşullu bir
  `fetch`.
  **Not:** bu proje Cloudflare Workers üzerinde çalışıyor; `fetch` zaten
  native, sorun değil. Ama HER bildirim Slack'e gitmemeli — `noteToKing`
  günde onlarca kez çağrılıyor (haraç, göç, kese, gece vardiyası), hepsi
  Slack'e giderse spam olur.
- **Efor:** hızlı-orta — webhook URL saklama (sır değil ama yine de
  kullanıcıya özel bir veri, dikkatli ele alınmalı) + `noteToKing`'e bir
  "önem eşiği" parametresi eklemek (bugün `kind: string` serbest metin,
  bir `severity` alanı yok — bu da eklenmeli).
- **Açık sorular:**
  - Hangi `kind`'lar Slack'e gitsin? Bugünkü `kind` değerleri serbest
    string ("GECE VARDİYASI", "HARAÇ", "KESE", "GÖÇ", "MÜZAKERE") —
    bunlardan hangileri "acil" sayılır? Yeni bir `urgent: boolean` alanı
    `noteToKing`'e eklenmeli mi (bu, `game.notices`'in şeklini değiştirir,
    save şemasının `.strict()` olması nedeniyle CLAUDE.md kısıt #3
    devreye girer — dikkatli yapılmalı)?
  - Webhook tek oyuncuya mı (kişisel Slack DM/kanalı) yoksa admin'e mi
    (tüm channel'ın olaylarını gören tek bir "işletme kanalı")? Vizyon
    metni "kralım böyle böyle oldu ne yapalım" diyor — bu, oyuncunun
    KENDİ Slack'ine gitmesini işaret ediyor gibi.
  - Rate limit / günlük tavan olacak mı (bir krallık kriz içindeyse
    saatte 10 bildirim gitmesin diye)?

- **Karar (2026-08-22): BEKLEMEDE.** Kullanıcı Slack entegrasyonunu (bu
  madde ve Fikir 12) şimdilik plana dahil etmek istemiyor — açık sorular
  yanıtlanmadı, karar verilmedi. İleride ayrıca ele alınacak.

---

### 5. Düşman halkının moralini casuslukla öğrenmek

**Kaynak:** orijinal (bu belge için üretildi).

Bugünkü ajan raporu (`server/world-projection.ts` → `intelReportOf`)
BİLİNÇLİ olarak rıza/moral gibi "yumuşak" verileri vermiyor ("kumar
orada" diye yorumlanmış). Bu fikir, YENİ bir ajan görevi türü (ya da
mevcut `send_scout`'un daha riskli/pahalı bir çeşidi) önerir: başarılı
olursa hedefin `populace.mood`/`moodState` bilgisini (yalnızca genel
durum: "Huzursuz" gibi, kesin sayı değil) rapora ekler. Bu, Halk-AI'sının
kendi krallığından bilgi sızdırması DEĞİL (asimetrik bilgi kısıtını
ihlal etmez) — Kral'ın KENDİ istihbarat aracıyla RAKİBİN halkını
gözetlemesidir, tamamen farklı bir kanal.

- **Hizmet ettiği:** "halkı kendine çekmek/ekonomisini bozmak" — bir
  kesenin hangi krallığa gönderileceğine karar vermek için bugün Kral
  körlemesine seçim yapıyor (yalnızca nüfus/kale seviyesi görünür); moral
  bilgisi olsa "bu krallığın halkı zaten huzursuz, kesem daha çok işe
  yarar" gibi stratejik bir seçim doğar.
- **Bugün en yakın ne var / eksik:** `intel_missions` tablosu ve
  `app/api/world/route.ts`'teki ajan gönderme akışı TAM var; eksik olan
  yalnızca rapor içeriğine yeni bir alan eklemek (`IntelReport`'a
  `moodState` gibi kaba bir alan) ve muhtemelen bu ayrıntı için başarı
  ihtimalini biraz düşürmek (bugünküyle aynı zar ama daha riskli bilgi
  daha düşük ihtimalle mi gelmeli?).
- **Efor:** hızlı-orta — mevcut ajan sistemine küçük bir ek, yeni tablo
  yok.
- **Açık sorular:**
  - Kesin sayı (`popularity: 34`) mı yoksa yalnızca durum etiketi
    (`moodState.label: "Huzursuz"`) mı? `intelReportOf`'un bugünkü
    felsefesi ("kesin sayı değil, kaba çerçeve") ikincisini işaret ediyor.
  - Bu bilgi raporun standart bir parçası mı, yoksa ayrı (daha pahalı/daha
    riskli) bir "derin gözetleme" görevi mi olmalı?

- **Karar (2026-08-22):**
  - Rapor yalnızca **kaba durum etiketi** verir ("Huzursuz" gibi), kesin
    sayı asla — `intelReportOf`'un mevcut felsefesiyle tutarlı.
  - Bu bilgi standart keşif raporunun parçası DEĞİL, **ayrı ve daha
    riskli/pahalı bir "derin gözetleme" görevi** olarak sunulur — daha
    düşük başarı ihtimali, daha yüksek bedel.

---

### 6. Kritik kararlarda "halkın nabzı" göstergesi

**Kaynak:** Claude'un önerisi (ilk brief, "wow" #2).

Savaş ilanı, ittifak, ağır vergi gibi büyük kararlar önerildiğinde
(General'in `propose_action`/`pending_decision` akışında), Kral'a
karardan ÖNCE halkın muhtemel tepkisinin bir özeti gösterilir — "halkın
rızası zaten 35, bu karar muhtemelen hizip baskısını hızlandırır" gibi.
Veto değil, güçlü bir sinyal.

- **Hizmet ettiği:** "halkın yeri geldiğinde kralın arkasında durması,
  yeri geldiğinde karşı çıkması" — kararın SONRASINI değil ÖNCESİNİ
  görünür kılarak demokratik baskıyı bir tahmine dönüştürür.
- **Bugün en yakın ne var / eksik:** `server/general-risk.ts` (risk
  kademesi zaten kodda hesaplanıyor, CLAUDE.md'nin "itiraz kararı kodda
  verilir" ilkesiyle uyumlu) ve `engine/faction.ts` → `factionTarget`
  (mevcut rızadan hedef hizip baskısını hesaplayan saf fonksiyon zaten
  var). Eksik olan: bu ikisini birleştirip `pending_decisions` akışına
  "bu kararın halk üzerindeki tahmini etkisi" alanı eklemek.
- **Efor:** orta — yeni bir hesaplama fonksiyonu (muhtemelen
  `engine/faction.ts` ya da `engine/populace.ts` içinde, saf) + UI'da
  onay ekranına bir gösterge.
- **Açık sorular:**
  - Bu tahmin hangi kararlar için gösterilsin — yalnızca `severe` risk
    kademesindekiler mi (bugünkü `RiskLevel`), yoksa `elevated` dahil mi?
  - Sayısal bir yüzde mi ("rıza tahmini -8 puan") yoksa nitel bir etiket
    mi ("Halk bunu hoş karşılamaz")? Sayısal olursa oyuncular bunu
    optimize etmeye başlar (min-maxing), nitel kalırsa daha atmosferik
    ama daha az "strateji" hissi verir — vizyon ikisini de istiyor
    ("gerçekten demokrasi VE strateji").

- **Karar (2026-08-22):**
  - Gösterge **`elevated` + `severe`** risk kademelerinde görünür (yalnızca
    `severe` değil).
  - Gösterge **nitel bir etiket** olacak ("Halk bunu hoş karşılamaz" gibi),
    sayısal tahmin yok — min-maxing riski bilinçli olarak tercih edilmedi.

---

### 7. Halk'ın kendi kamusal "feed"i

**Kaynak:** orijinal (bu belge için üretildi).

Yeni bir UI paneli (belki `halk` sekmesinde): Halk-AI'sının, Kral'a talep
sunmadığı zamanlarda bile kendi aralarında "konuştuğu" izlenimi veren kısa,
periyodik, AI-üretimi flavor metinleri ("Pazar meydanında bu sabah ekmek
fiyatı konuşuluyor" gibi). Kral'a doğrudan bir talep DEĞİL — yalnızca
"dünya kendi kendine yaşıyor" hissini güçlendiren pasif bir günlük/gazete.

- **Hizmet ettiği:** doğrudan "kendi kendine yaşayan ve sürekli hayatta
  olduğu hissini veren" vizyon cümlesi — belki listedeki EN DOĞRUDAN
  karşılık.
- **Bugün en yakın ne var / eksik:** Hiçbir karşılığı yok; en yakın
  benzer desen `game.notices` (kısa, biriken, sınırlı bildirim listesi)
  ama o CİDDİ oyun olaylarını taşıyor (haraç, göç, kese), bu panel
  ATMOSFERİK ve ciddiyetsiz olmalı. Yeni bir tablo (`populace_feed` gibi)
  ve periyodik (muhtemelen cron'un saatlik turuna binen, "gece vardiyası
  token disiplini" desenini taklit eden — yalnızca gerçekten bir şey
  varsa üret) bir üretim akışı gerekir.
- **Efor:** büyük — Fikir 0'ın altyapısını gerektirir, yeni tablo, yeni
  cron adımı, yeni UI paneli.
- **Açık sorular:**
  - Bu feed yalnızca KENDİ krallığının halkını mı gösterir, yoksa (vizyon
    "kıyaslama serbest" dediği için) ara sıra "komşu sancakta böyle
    oluyormuş" diye ANONİM bir çapraz-referans da mı içerir? İkincisi
    asimetrik bilgi sınırına daha yakın durur ve dikkatli tasarlanmalı —
    isim/kimlik asla sızmamalı (`intelReportOf`'un "tek tek alan yazma"
    disipliniyle).
  - Periyot ne olmalı — saatte bir mi (cron'a biner, ucuz) yoksa Kral
    sekmeyi her açtığında mı (daha pahalı, ama daha "canlı")?

- **Karar (2026-08-22):**
  - Feed **ara sıra anonim çapraz-referans da içerir** ("komşu sancakta
    böyleymiş" gibi) — isim/kimlik asla sızmamalı, `intelReportOf`'un
    "tek tek alan yazma" disipliniyle dikkatli tasarlanmalı.
  - Üretim **saatte bir, cron'a biner** (yalnızca gerçekten bir şey varsa
    üretilir, gece vardiyası token disipliniyle tutarlı).

---

### 8. Hizip müzakere masası — iç muhalefetle pazarlık

**Kaynak:** orijinal (bu belge için üretildi).

Bugün iç hizibin (`engine/faction.ts`) TEK çıkışı rızayı yükseltmek;
Kral'ın elebaşıyla doğrudan bir etkileşimi yok. Bu fikir, mevcut
müzakere masası desenini (`engine/negotiation.ts` — konu listesi, tur
sınırı, şart sunma/imzalama) krallık-içi bir "masaya" uygular: elebaşı
(`factionLeaderName`) belli bir baskı eşiğinde (örn. `organized`) Kral'a
somut bir talep iletebilir ("vergiyi düşür, dokunmayalım" gibi) ve Kral
bunu KABUL ya da RED edebilir — kabul ederse baskı hızlı düşer (bugünkü
yavaş `easeRate`'ten daha hızlı bir "anlaşma indirimi"), reddederse baskı
normal seyrine (mevcut kapalı-çözüm) devam eder.

- **Hizmet ettiği:** "iç karışıklık yaratarak asker olmadan savaş
  kazanma" fikrinin AYNADAKİ karşılığı — rakibin hizbini KIŞKIRTMAK
  bugün varken, KENDİ hizbiyle PAZARLIK etmek yok; ikisi birlikte
  "demokrasi ve strateji" cümlesine daha güçlü hizmet eder.
- **Bugün en yakın ne var / eksik:** `engine/negotiation.ts`'in TÜM
  mekaniği (tur sınırı, şart doğrulama, imza yetkisi) doğrudan yeniden
  kullanılabilir bir desen; eksik olan bunu iki KRALLIK arasında değil,
  Kral ile kendi hizbi arasında çalıştıracak ince bir uyarlama (karşı
  tarafın "General"i yok, sabit/deterministik bir tepki fonksiyonu var).
  CLAUDE.md kısıt #5 (tek-doğru-kaynak) burada özellikle önemli: bu yeni
  mekanik `negotiation.ts`'i KOPYALAMAMALI, ondan faktörize edilmiş ortak
  parçaları (tur/süre sınırı gibi) yeniden kullanmalı.
- **Efor:** orta-büyük — `engine/faction.ts`'e yeni saf fonksiyonlar
  (`factionDemand`, `factionSettlement` gibi) + muhtemelen yeni bir küçük
  tablo (aktif bir "hizip talebi" bekliyorsa) + UI.
  **Karar sonrası not:** talep LLM'den üretileceği için bu fikir artık
  Halk-AI kimlik altyapısını (Fikir 0) GEREKTİRİYOR — Fikir 0'dan önce
  yapılamaz (aşağıdaki orijinal analiz bunun tersini varsayıyordu).
- **Açık sorular:**
  - Elebaşının talebi LLM'den mi (Fikir 0 sonrası, daha "akıllı" ve
    öngörülemez) yoksa deterministik bir talep şablonu mu (bugünkü
    `factionNotice` gibi, daha basit ve test edilebilir)? İkisi arasında
    net bir sıralama tercihi gerekiyor.
  - Kral talebi reddederse VE tekrar tekrar reddederse elebaşı "sertleşir"
    mi (örn. `engine/ledger.ts`'teki `weight` artan dil sertliği deseni
    burada da uygulanabilir mi)?

- **Karar (2026-08-22):**
  - Talep **LLM'den üretilir** — bu madde artık **Fikir 0'a bağımlı**,
    önce Halk-AI kimlik altyapısı hazır olmalı (yukarıdaki "Fikir 0'dan
    önce de yapılabilir" notu artık geçerli değil).
  - Kral ısrarla reddederse **elebaşı sertleşir** (dil/baskı hızlanır),
    `engine/ledger.ts`'teki artan ağırlık deseniyle tutarlı.

---

### 9. Referandum — Kral'ın halka soru sorması

**Kaynak:** orijinal (bu belge için üretildi).

Kral'ın (General aracılığıyla) halka "vergiyi yükseltsem mi" gibi bir
soru "sorabildiği" (aslında halka değil, sisteme) ve halkın (nüfus,
mevcut rıza, hizip baskısı gibi mevcut sinyallerin AĞIRLIKLI bir
fonksiyonu olarak, LLM olmadan) "evet/hayır" ya da bir yüzde döndürdüğü
basit bir mekanik. Sonuç BAĞLAYICI değil — yalnızca bir sinyal (Fikir 6
ile örtüşür ama bu, Kral'ın kendi başlattığı, AKTİF bir sorgu; 6 pasif
bir gösterge).

- **Hizmet ettiği:** "gerçekten demokrasi ile çalışması" cümlesinin en
  DOĞRUDAN karşılığı — oyuncuya "oy sorma" hissi veren tek fikir bu.
- **Bugün en yakın ne var / eksik:** Hiçbir karşılığı yok; en yakın
  YAPISAL benzerlik `engine/populace-voice.ts`'in sinyal-tabanlı karar
  deseni (girdi → ağırlıklı sonuç, zar yok). Yeni bir saf fonksiyon
  (`engine/referendum.ts`?) ve yeni bir General aracı (`hold_referendum`)
  gerekir.
- **Efor:** orta — engine'de yeni saf modül, yeni araç şeması
  (`app/api/general/route.ts` → `actionTools`), UI'da sonucun gösterimi.
- **Açık sorular:**
  - Bu asimetrik bilgi kısıtını ihlal eder mi? Halk'a "soru sormak" ile
    "Halk-AI'sına sormak" arasındaki çizgi net değil — eğer sonuç
    deterministik bir formülden geliyorsa (LLM yok) ihlal yok, ama LLM'e
    (Fikir 0 sonrası) bağlanırsa bu doğrudan "General halka gidip
    sorabilir" hâline gelir, yani SABİT karara (§2, madde 2) aykırı olur.
    **Bu yüzden referandumun LLM'siz kalması muhtemelen zorunlu, tercih
    değil.**
  - Ne sıklıkla kullanılabilir (spam'e karşı bir tavan gerekir, tıpkı
    `host_festival`/müzakere masası tavanları gibi)?

- **Karar (2026-08-22):**
  - Referandum **LLM'e bağlanır** — bu, §2 madde 2'deki sabit kurala
    bilinçli bir istisnadır (yukarıdaki §2 güncellemesine bakın). Artık
    bu madde de Fikir 0'ın (Halk-AI kimlik altyapısı) bir uzantısı.
  - Kullanım sıklığı: **haftada 1** gibi bir tavan (günlük değil, ama
    sezon başına birkaçtan daha sık).

---

### 10. Günlük "Halk Meclisi Saati" — alışkanlık motoru

**Kaynak:** orijinal (bu belge için üretildi).

Her gerçek günde bir kez (örn. Kral'ın son giriş saatine göre kayan bir
pencere ya da sabit bir channel saati), açık halk talepleri varsa
baskıları biraz hızlanır; Kral o pencere içinde giriş yapıp en az bir
talebe cevap verirse (ya da bilinçli olarak reddederse) baskı normal
hızına döner. Bu, "günde en az 1 saat bakma" ihtiyacını KOZMETİK bir
hatırlatmadan (Fikir 4, Slack) ÖTEYE taşıyıp OYUN MEKANİĞİNİN kendisine
gömer.

- **Hizmet ettiği:** "insanların günlük olarak en az 1 saat bakması
  gereken bir oyun" — doğrudan bu cümle.
- **Bugün en yakın ne var / eksik:** `engine/populace-voice.ts` →
  `DEMAND_NOTICE_HOURS` (aynı tür için bildirimler arası minimum süre) ve
  `MAX_OPEN_DEMANDS` zaten "Kral'ı yormama" prensibiyle tasarlanmış;
  bu fikir TERSİNİ ekliyor — "Kral'ı hiç gelmemekten caydırma". Yeni bir
  zaman penceresi kavramı (`server/` katmanında, `night-shift.ts`'teki
  `rollDailyWindow` deseniyle aynı aile) gerekir.
- **Efor:** orta — yeni bir saf fonksiyon (muhtemelen
  `engine/populace-voice.ts`'e eklenen bir "ihmal cezası" çarpanı) + bunu
  `moodTarget`/`factionTarget`'a bağlayan bir sunucu hesaplaması.
- **Açık sorular:**
  - Bu bir CEZA mı (girmezsen baskı hızlanır) yoksa bir ÖDÜL mü
    (girersen baskı yavaşlar, girmesen bugünkü hız devam eder)? İlki
    oyuncuyu daha güçlü zorlar ama "oyunun beni cezalandırdığı" hissi
    verebilir; vizyonun tonuna (baskıcı değil, yaşayan bir dünya) ikinci
    daha yakın duruyor.
  - Farklı channel hızları (`channels.speed`: 1/4/24) bu günlük pencereyi
    nasıl etkiler — hızlı bir channel'da "gerçek gün" ile "oyun günü"
    arasındaki fark nasıl ölçülür?

- **Karar (2026-08-22):**
  - **CEZA** olacak: Kral pencerede giriş yapıp cevap vermezse baskı
    hızlanır.
  - Pencere **channel hızıyla ölçeklenen oyun-içi gün** olarak ölçülür
    (gerçek 24 saat değil). Bu, `docs/plans/2026-08-22-acik-backlog-maddeleri.md`'deki
    "General'in günlük sayacı channel hızından bağımsız" maddesiyle AYNI
    kategoride bir düzeltme — ikisi birlikte, tutarlı bir "oyun-içi gün"
    tanımıyla ele alınmalı (`server/night-shift.ts`'teki `DAY_MS` bu
    tanımın TEK KAYNAĞI olmalı, ikinci bir yerde ayrı hesaplanmamalı).

---

### 11. "Kader" katmanı — oyunun Kral'dan akıllı olduğu anlar

**Kaynak:** Claude'un önerisi (ilk brief, "wow" #1).

Gece vardiyası altyapısını (zaten proaktif, zaten token-disiplinli)
genişleterek, standing order'ı OLMASA bile, çok nadir ve büyük anlarda
(örn. hizip `defiant` eşiğine ilk kez ulaştığında, ya da bir komşu
kesesi ifşa olduğunda) General'in KENDİLİĞİNDEN bir ikilem sunması:
"Kralım, şöyle bir seçenek var, ne yapalım?" — emrin cevabı değil,
emrin KENDİSİ General'den gelir.

- **Hizmet ettiği:** "bazen oyunun kraldan daha akıllı olduğu" —
  vizyonun en "wow" cümlesi.
- **Bugün en yakın ne var / eksik:** `app/api/cron/route.ts` → `runOne`
  zaten standing order VARSA proaktif çalışıyor; eksik olan standing
  order YOKKEN de (ya da standing order'dan bağımsız, salt "büyük bir
  eşik geçildi" sinyaliyle) bir öneri üretebilmesi. `pending_decisions`
  tablosu (bugün yalnızca General'in RİSKLİ bir emri Kral'a sorduğu
  akışta kullanılıyor) aynı şekilde bir "Kader önerisi" taşıyabilir —
  yeni bir tablo gerekmeyebilir.
- **Efor:** büyük — yeni bir eşik-tespit katmanı (hangi olaylar "Kader
  konuşur" tetikler), token maliyeti dikkatli sınırlanmalı (spam
  olmaması için — `night-shift.ts`'in disiplini burada da şart).
- **Açık sorular:**
  - Bu, Halk-AI'sından mı General'den mi konuşuyor? Vizyon "oyunun kendisi"
    diyor — bu üçüncü bir ses mi (ne General ne Halk, oyunun kendi
    anlatıcısı), yoksa General'in kendi doktrinini aşan bir anı mı?
    Üçüncü bir ses yeni bir kimlik/persona demek (yine Fikir 0 benzeri
    bir maliyet sorusu, ama bu sefer admin değil kimin ödediği belirsiz).
  - Tetikleyici eşikler ne kadar nadir olmalı — günde bir kez mi, sezonda
    birkaç kez mi? Çok sık olursa "Kader" sıradanlaşır, vizyonun istediği
    "bazen" kelimesi kaybolur.

- **Karar (2026-08-22):**
  - **General'in kendi doğrusunu aşan bir anı** olarak konuşur — üçüncü
    bir ses/persona GEREKMİYOR, mevcut General kimliğine oturur, yeni bir
    "kimin ödediği" sorusu açmaz.
  - Tetikleyici eşikler **sezonda birkaç kez** görülecek kadar nadir
    olmalı.

---

### 12. Slack üzerinden iki yönlü karar

**Kaynak:** Claude'un önerisi (ilk brief, "wow" #3).

Fikir 4'ün (tek yönlü bildirim) doğal devamı: Slack mesajına bir emoji
tepkisi ya da thread cevabı ile gerçek bir oyun kararı verilebilmesi
("👍 = onayla", ya da bir metin cevabı General'e "mesaj" olarak iletilir).

- **Hizmet ettiği:** "sürecin Slack üzerinden bile devam edebileceği" —
  vizyonun en somut "Slack" cümlesi.
- **Bugün en yakın ne var / eksik:** Hiçbir karşılığı yok; bu, dışarıdan
  gelen bir isteğin (Slack webhook/event API) `app/api/general/route.ts`'in
  bugün YALNIZCA oturum açmış bir Kral'dan kabul ettiği isteklere
  (`currentUser(request)`, oturum çerezi) eşdeğer bir yetkiyle
  bağlanması gerektiği anlamına gelir — YENİ bir kimlik doğrulama yolu
  (Slack imzası/token'ı → hangi `userId`) gerekir.
- **Efor:** büyük — yeni bir API ucu (Slack event/interaction webhook'u),
  yeni bir kimlik eşleme tablosu (Slack user/channel → Demirkale userId),
  ve bekleyen kararın (`pending_decisions`) Slack'ten de
  onaylanabilmesi.
- **Açık sorular:**
  - Slack'ten verilen karar, gece emrine (standing order, otonom yetki)
    mi eşdeğer olsun, yoksa yalnızca `pending_decisions`'taki TEK bir
    bekleyen öneriyi onaylama/reddetme ile mi sınırlı kalsın? Vizyon
    metni geniş bir yetki ima ediyor ("süreç Slack üzerinden devam
    edebilir") ama güvenlik açısından (bir Slack mesajının ele
    geçirilmesi/yanlış kanala düşmesi riski) dar bir yetkiyle başlamak
    daha güvenli görünüyor.
  - Bu Fikir 4'ten (webhook URL) tamamen ayrı bir entegrasyon türü
    (OAuth app, Slack Bot Token) gerektirir — aynı "Slack" kelimesi
    altında iki farklı teknik yatırım var, bu ayrım kullanıcıya açıkça
    anlatılmalı.

- **Karar (2026-08-22): BEKLEMEDE.** Fikir 4 ile aynı gerekçeyle Slack
  entegrasyonu şimdilik ele alınmıyor.

---

### 13. Sessiz kıyaslama — Halk'ın arka planda sürekli channel kıyaslaması

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Halk'ın kendi refahını komşu krallıkların halklarıyla kıyaslaması bir
kerelik bir "panel açık" olayı değil, ARKA PLANDA SÜREKLİ işleyen bir
sinyaldir; yalnızca eşik aşıldığında (bugünkü `derivePopulaceDemands`'ın
"anlık dalgalanmada talep açılmaz" ilkesiyle aynı disiplinle) Kral'a bir
talep/basınç olarak yüzeye çıkar. Fikir 1 (channel ortalamasını panelde
göstermek) bu sinyali Kral'a DOĞRUDAN bir gösterge olarak sunarken, bu
fikir aynı veriyi Halk'ın KENDİ tarafında, yeni bir talep türü
(`DemandKind` — örn. `"kıyas"`) olarak işler: "komşu sancakta halk çok
daha rahat yaşıyor, biz neden böyleyiz" diye AÇIKÇA gelen bir talep.

- **Hizmet ettiği:** asimetrik bilgi akışının (Halk kıyaslar → Kral'a
  baskı, ters yönde asla) EN SAF hâli — Kral hiçbir zaman "komşunun
  verisine" erişmez, yalnızca KENDİ halkının bu veriye dayanan
  TEPKİSİNİ görür.
- **Bugün en yakın ne var / eksik:** `engine/populace-voice.ts`'in TÜM
  iskeleti (DemandKind, VOICE_THRESHOLDS, `minGameHours` süzgeci)
  doğrudan genişletilebilir; eksik olan yalnızca yeni bir `DemandKind` ve
  bu talebin girdisi olacak channel-ortalaması hesabı (Fikir 1'in
  agregasyon sorgusu).
- **Efor:** orta — Fikir 1'in agregasyon sorgusu hazırsa üstüne oturan
  küçük bir ek; hazır değilse ikisi birlikte tasarlanmalı.
- **Açık sorular:**
  - Bu talep diğer taleplerle (ekmek, maaş) AYNI `MAX_OPEN_DEMANDS`
    tavanını mı paylaşır, yoksa ayrı bir kategori mi? Aynıysa, "kıyas"
    talebi diğer daha somut taleplerin (ekmek) önüne geçip yer
    kaplayabilir.
  - Kıyaslama hangi sıklıkla yenilenir — her tick'te mi (pahalı, sürekli
    sorgu) yoksa saatlik cron turunda mı (Fikir 1 ile aynı ritimde olmalı)?

- **Karar (2026-08-22):**
  - "Kıyas" talebi **aynı `MAX_OPEN_DEMANDS` tavanını** diğer taleplerle
    paylaşır — ayrı bir kategori açılmadı.
  - Yenileme **saatlik cron turunda**, Fikir 1'in agregasyon sorgusuyla
    aynı ritimde.

---

### 14. "General'in verdiği söz" ile Halk'ın gerçek yaşadığı arasındaki fark

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Bugün oyun zaten NOMİNAL değer (Kral'ın ayarladığı `foodRation: %100`)
ile FİİLEN DAĞITILAN değeri (`servedFood` — ambar yetmiyorsa gerçekte
daha az) ayırıyor (bkz. §3). Bu fikir, bu farkı Halk-AI'sının
SESLENDİRDİĞİ açık bir "ikiyüzlülük" anlatısına çevirir: General/Kral
"istihkakı %100'e çıkardım" dese de, Halk "ama tabağımda hâlâ yarım ekmek
var" diye buna açıkça itiraz edebilir.

- **Hizmet ettiği:** "halkın yeri geldiğinde kralına karşı çıkması" —
  burada karşı çıkış bir TALEP değil, bir HESAP SORMA; General'in
  doğruluğu sorgulanıyor. Bu, oyunun "General her zaman haklı" hissini
  kırar.
- **Bugün en yakın ne var / eksik:** Fark (`foodRation` vs `servedFood`)
  zaten hesaplanıyor ve `server/populace-voice.ts`'e taşınıyor
  (`servedFood ?? foodRation` düşüşü `app/api/general/route.ts` →
  `loadPopulaceVoice` içinde görülüyor); eksik olan bu farkın kendisinin
  bir SİNYAL olarak (yalnızca mutlak eşik değil, NOMİNAL-FİİLİ makası)
  yeni bir talep/ton tetiklemesi.
- **Efor:** hızlı-orta — yeni bir hesap (`servedFood - nominalFood`
  farkı) ve buna bağlı bir metin/ton; Fikir 2'nin (Halk sesi AI'laşması)
  İÇİNE doğal olarak oturur.
- **Açık sorular:**
  - Bu fark yalnızca yiyecekte mi ölçülür, yoksa maaş (`soldierPay` vs
    fiilen ödenen) gibi başka nominal/fiili çiftlerine de mi genelleşir?
  - General bu farkı Kral'a AÇIKÇA itiraf ediyor mu (bugünkü dürüst
    General doktrinine uygun) yoksa Halk'ın bunu YAKALAMASI bir "General
    yalan söyledi" anı mı olur — ikincisi çok daha güçlü bir anlatı ama
    General'in bugünkü "asla uygulamadığı eylemi uyguladım demez"
    ilkesiyle (CLAUDE.md'deki "Kesin işlem kuralı") gerilimli,
    netleştirilmeli.

- **Karar (2026-08-22):**
  - Fark baştan **genel bir desen** olarak kurulur (yiyecek + maaş
    birlikte), tek bir dar örnekle sınırlı kalmaz.
  - **Halk yakalar, "General yalan söyledi" hissi doğar.** Bunu
    CLAUDE.md'nin "General uygulamadığı eylemi uyguladım demez" ilkesiyle
    uzlaştıran ayrım: General teknik olarak yalan söylemez — istihkakı
    GERÇEKTEN %100'e çıkardı, eylem fiilen uygulandı; yalnızca SONUCU
    (ambarın yetmediğini, fiilen daha azının dağıtıldığını) Krala
    kendiliğinden söylemedi. Halk bu eksikliği yakalayıp seslendirir.
    İlke ihlal edilmiyor, yalnızca "eksik açıklama" ile "yanlış iddia"
    arasındaki çizgi kullanılıyor.

---

### 15. Propaganda — enformasyon silahı olarak Halk-AI

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Bugünkü dış kese (`engine/agitation.ts`) yalnızca SAYISAL bir etki
taşıyor (hizip baskısına +9.6 puan gibi); içerik/anlatı taşımıyor. Bu
fikir, Halk-AI'sının (Fikir 0'ın altyapısıyla) kesenin yanında ya da
yerine bir "söylenti/propaganda metni" üretip hedefin Halk'ına
ulaştırmasını önerir — etkinin SAYISAL tarafı yine `engine/agitation.ts`'in
deterministik kuralları içinde kalır (dengeyi bozmamak için), yalnızca
ANLATI katmanı AI'dan gelir.

- **Hizmet ettiği:** "onların ekonomisini bozmak/halkı kendine çekmek" —
  dış keseye bir DİL/İÇERİK boyutu katarak sabotajı daha "canlı" hâle
  getirir.
- **Bugün en yakın ne var / eksik:** `engine/agitation.ts`'in üç taşıyıcı
  ilkesi (sabit fiyat, hedefte kaynak alanı yazılmaz, damga-tabanlı
  sönüm) SAYISAL etki için zaten tam; `AGITATION_NOTICE`/
  `agitationExposedNotice` gibi metinler bugün de var ama ŞABLON. Eksik
  olan: bu şablonların Halk-AI'dan üretilen bir metinle değişmesi.
- **Efor:** orta — Fikir 2 (Halk sesi AI'laşması) ile aynı ailede,
  `AGITATION_NOTICE` sabit string tablosunun yerine bir LLM çağrısı.
- **Açık sorular:**
  - Propagandanın İÇERİĞİ neyi hedef alabilir — yalnızca "birileri
    parayla dolaşıyor" gibi genel mi, yoksa hedefin GERÇEK bir zaafını
    (örn. düşük istihkakını) işaret eden bir metin mi? İkincisi,
    gönderenin hedefin KAMUYA AÇIK/kıyaslanabilir verisi dışında bir şey
    BİLMEMESİ gerektiği için asimetrik bilgi sınırıyla dikkatli
    uzlaştırılmalı.
  - Metnin hedefin KENDİ Halk-AI persona'sına (isyankâr/itaatkâr) göre
    farklı "tutması" (isyankâr bir halk propagandaya daha çok inanır) mı
    beklenir — bu, Fikir 0'ın persona kararına doğrudan bağlı.

- **Karar (2026-08-22):**
  - İçerik **yalnızca genel/belirsiz** kalır ("birileri parayla
    dolaşıyor" gibi) — hedefin gerçek/kamuya açık verisine dayanan somut
    bir zaaf işaret etmez, asimetrik bilgi sınırına en güvenli seçenek.
  - **Persona etkiler**: isyankâr bir halk propagandaya daha çok inanır,
    itaatkâr bir halk daha az — Fikir 0'ın persona kararını anlamlı kılan
    bir sonuç.

---

### 16. Halk'ın General'i atlayıp doğrudan Kral'a sesi

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Bugün Halk'ın sesi her zaman General'in ağzından, `gamePrompt`'a eklenen
bir blok (`memoryLines`) olarak Kral'a ulaşıyor — General bu talepleri
"gündeme getiriyor" ama teknik olarak konuşan hep General. Bu fikir,
belirli (nadir, yüksek şiddetli) anlarda Halk'ın General'i ATLAYIP
doğrudan Kral'a hitap eden, ayrı bir "ses" olarak UI'da (farklı bir
mesaj balonu/portre) belirmesini önerir — General'in yorumundan
BAĞIMSIZ, filtrelenmemiş bir cümle.

- **Hizmet ettiği:** "kendi kendine yaşayan dünya" hissini güçlendirir —
  Halk artık yalnızca General'in ANLATTIĞI bir istatistik değil, kendi
  sesiyle konuşan ayrı bir taraf olur; sabit tasarım kararının ("Halk,
  Kral'a doğrudan gelip basınç oluşturabilir") en somut UI karşılığı.
- **Bugün en yakın ne var / eksik:** `app/api/general/route.ts` →
  `loadPopulaceVoice`, Halk'ın talebini `body.memoryLines`'a EKLEYİP
  General'in sistem promptuna gömüyor — yani mimari olarak Halk'ın
  "sesi" zaten ayrı üretiliyor (`renderPopulaceVoice`), yalnızca UI'da
  General'in mesajının İÇİNE karışıyor. Sunucu tarafında veri zaten ayrı
  dönüyor (`populaceDemands: voice.open`), yalnızca `halk` sekmesinde
  gösteriliyor, `meclis` sekmesinde değil. Eksik olan: bu ayrı üretilmiş
  metnin `meclis` sekmesinde AYRI bir konuşma balonu olarak (General'in
  cevabından önce/sonra, farklı bir görsel kimlikle) gösterilmesi.
- **Efor:** hızlı-orta — çoğunlukla UI; sunucu verisi zaten hazır.
- **Açık sorular:**
  - Bu, `meclis` sohbetinin İÇİNE mi girsin (Kral'ın General'le konuştuğu
    akışı böler, daha dramatik) yoksa ayrı, sekmeler-arası bir bildirim
    mi (daha az müdahaleci)?
  - Halk'ın bu doğrudan sesi LLM-üretimi mi (Fikir 2/0'a bağımlı) yoksa
    bugünkü şablon metin mi — muhtemelen bu fikir Fikir 2
    TAMAMLANDIKTAN sonra çok daha güçlü olur, önce yalnızca "konumu"
    değiştirmek (şablon metinle) bir ilk adım olabilir.

- **Karar (2026-08-22):**
  - Halk'ın sesi **meclis sohbetinin İÇİNE**, ayrı bir konuşma balonu
    olarak girer — Kral'ın General'le konuştuğu akışı böler, en dramatik
    seçenek.
  - Bu madde **Fikir 2 tamamlanana kadar beklenir** — şimdi şablon metinle
    başlamak yerine, ikisi birlikte güçlü bir versiyon olarak gelecek.
    Sıralama: **Fikir 0 → Fikir 2 → Fikir 16.**

---

### 17. Göçün gerekçesi göreceli olabilir

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Bugün bir krallıktan nüfus AYRILMA kararı (`engine/populace.ts` →
`populationChange`, negatif `populationRate`) yalnızca o krallığın KENDİ
mutlak rızasına bakar — komşularla kıyas yok. Bu fikir, ayrılma eğilimine
(yalnızca HEDEF seçimine değil, gitme kararının KENDİSİNE) bir GÖRECELİ
bileşen ekler: krallık mutlak olarak "Huzursuz" bile olsa, komşular ÇOK
daha iyiyse göç eğilimi artar; komşular da kötüyse (herkes zorluk
çekiyorsa) mutlak olarak aynı rızada bile göç daha az olur.

- **Hizmet ettiği:** "kendi kendine yaşayan dünya" ve Fikir 13'ün (sessiz
  kıyaslama) doğal bir SONUCU — kıyaslama yalnızca bir ŞİKAYET üretmekle
  kalmaz, gerçek bir DAVRANIŞA (ayrılma kararına) dönüşür.
- **Bugün en yakın ne var / eksik:** `engine/migration.ts` →
  `pickMigrationTarget` zaten HEDEFİ seçerken göreceli bir kıyas yapıyor
  (`ATTRACTIVENESS_FLOOR` + popülerlik ağırlığı, adaylar arasında rulet);
  ama AYRILMA KARARININ KENDİSİ (`engine/populace.ts` → `STATES`
  tablosundaki `populationRate`) tamamen mutlak. Eksik olan:
  `populationChange`'e (ya da onu çağıran `engine/tick.ts`'e)
  channel'daki komşuların ortalama rızasını bir girdi olarak vermek.
- **Efor:** orta — `engine/populace.ts`'e yeni bir parametre (saf kalır,
  dışarıdan `channelAveragePopularity` gibi bir sayı verilir) +
  `server/save-validation.ts`'in bu ortalamayı hesaplayıp `tick()`'e
  geçirmesi (bugün `tick()` yalnızca KENDİ krallığının verisiyle
  çağrılıyor — bu, "channel bazlı girdi"nin `tick()`'e ilk girişi olur).
- **Açık sorular:**
  - `engine/`'in saflık ilkesi bozulmaz (girdi hâlâ dışarıdan geliyor)
    ama bu, `tick()`'in imzasına YENİ bir zorunlu parametre eklemek
    demek — bugün `tick(game, now)` yalnızca iki argüman alıyor, bu ne
    kadar büyük bir değişiklik, kaç çağrı noktasını (`app/api/cron`,
    `server/save-validation.ts`, istemci) etkiler?
  - Bu ortalama ne sıklıkla güncellenir — her `tick()` çağrısında YENİDEN
    mi hesaplanır (pahalı, her krallığın kaydını okumak gerekir) yoksa
    saatlik bir önbellek mi (bayat ama ucuz)?

- **Karar (2026-08-22): BEKLEMEDE.** `tick()`'in imzasını değiştirmek
  (yeni zorunlu bir channel-ortalaması parametresi) kod tabanının en
  hassas noktalarından birine (CLAUDE.md kısıt #2) dokunuyor — kullanıcı
  bunu şimdilik ertelemeyi tercih etti. İleride ele alınırsa: güncelleme
  **saatlik önbellek** olacak, Fikir 1/13 ile aynı ritimde.

---

### 18. Kral rakiplerini zayıflatmak için kendi halkını feda edebilir

**Kaynak:** Claude'un önerisi (kullanıcıyla ayrı sohbette verilen senaryo).

Bugünkü göç sistemi (Faz 6) YALNIZCA pasif bir sonuç: nüfus ayrılır,
`pickMigrationTarget` UYGUN adaylar arasından (kapasitesi olan, kuruluş
koruması bitmiş) AĞIRLIKLI bir seçim yapar — Kral'ın bu hedefi SEÇME gibi
bir yetkisi yok. Bu fikir, Kral'ın (ya da General'in) BİLEREK kendi
rızasını düşürüp (örn. istihkakı kısarak) nüfus kaybını hızlandırmasının,
ve bu göçün BELİRLİ bir rakibi (kapasitesi en dolu olanı doldurup
boğarak, ya da müttefikini büyüterek) etkilemek için STRATEJİK olarak
kullanılabilmesinin altını çizer.

- **Hizmet ettiği:** "iç karışıklık yaratarak asker olmadan savaş
  kazanma" fikrinin EN RADİKAL ucu — burada silah düşmana değil KENDİ
  halkına yöneliyor, dolaylı yoldan üçüncü bir tarafı etkiliyor.
  Vizyonun "bazen kralın arkasında bazen karşısında" gerilimine de hizmet
  eder: böyle bir Kral'ın kendi halkı bunu ANLARSA (bkz. Fikir 14'ün
  "ikiyüzlülük" mekanizması) hizip baskısı çok hızlı tırmanır — kendi
  kendini cezalandıran bir strateji.
- **Bugün en yakın ne var / eksik:** Hiçbir karşılığı yok —
  `pickMigrationTarget` hedefi YÖNLENDİRİLEMEZ biçimde (kaynak krallığın
  hiçbir girdisi olmadan) seçiyor; bu BİLİNÇLİ bir tasarım
  (`engine/migration.ts`'in kendi yorumu: hedef ADAYLAR arasından
  ağırlıklı seçilir, gönderen seçmez). Bu fikir bu tasarımı YA korur
  (Kral yalnızca DOLAYLI olarak, kendi rızasını düşürerek göçü tetikler,
  hedefi seçemez — "silahlandırma" kısmı zayıf ama tasarımla tutarlı) YA
  DA doğrudan hedefleme ekler (tasarımla ÇATIŞIR, dış kesenin/haydut
  yönlendirmenin yaptığı gibi "hedef seç, gönder" bir araca dönüşür).
- **Efor:** değişken — dolaylı versiyon (mevcut sistemin üstüne hiçbir
  şey eklemeden, yalnızca ANLATI/farkındalık) hızlı; doğrudan hedefleme
  versiyonu (yeni bir eylem, `engine/migration.ts`'in "gönderen seçmez"
  ilkesini BİLİNÇLİ olarak terk etmek) orta-büyük.
- **Açık sorular:**
  - Bu, `engine/migration.ts`'in "hedef adaylar arasından seçilir,
    gönderen seçmez" tasarım ilkesiyle DOĞRUDAN ÇATIŞIYOR — bu ilke
    KORUNSUN mu (o zaman bu fikir yalnızca dolaylı/anlatısal kalır)
    yoksa BİLİNÇLİ olarak gevşetilsin mi (yeni bir "sürgün" aracı,
    doğrudan hedef seçimiyle)? Bu, mevcut bir tasarım kararını YENİDEN
    AÇMAK anlamına gelir ve öyle ele alınmalı.
  - Kendi halkını feda etmenin bir MALİYETİ olmalı (yoksa "bedelsiz
    saldırı aracı" olur, dış kesenin dikkatli dengelenmiş verimsizlik
    oranlarına aykırı düşer) — bu maliyet yalnızca rıza/nüfus kaybı mı,
    yoksa Fikir 14'ün ikiyüzlülük mekanizmasıyla BAĞLANTILI bir itibar/
    hizip cezası da mı devreye girmeli?

---

## 5. Genel (fikirler-arası) açık sorular

Yukarıdaki her fikrin kendine özgü sorularının yanında, TÜM listeyi
etkileyen sorular:

1. **Faz sırası:** Bu belge bir sıralama ÖNERİYOR (§4'teki numaralar) ama
   hangi fikir hangi "faz" olacak, `docs/PHASES.md`'deki gibi
   numaralandırılacak mı, yoksa bu vizyon kendi bağımsız faz dizisi mi
   olacak (CLAUDE.md → `docs/PHASES.md` güncelleme kuralı "yeni bir proje/
   faz dizisi başladığında §4 olarak ekleyin" diyor — bu vizyon o yeni
   dizi mi)?
2. **Maliyet ne zaman konuşulacak:** Fikir 0 (Halk-AI kimlik altyapısı)
   olmadan Fikir 2/7/15 (LLM'li versiyonları) hiçbiri gerçek anlamda
   çalışmaz. Maliyet konuşması ne zaman, kim tarafından yapılacak — Fikir
   0'ın İÇİNDE mi (o zaman Fikir 0 hem altyapı hem bütçe kararı taşır),
   yoksa ayrı bir karar noktası mı?
3. **Test edilebilirlik:** `engine/` kısıtı (Math.random/Date.now yasak,
   ESLint ile otomatik denetleniyor) LLM çağıran hiçbir kodun `engine/`
   içine giremeyeceği anlamına gelir — bu zaten mimarinin doğal sonucu
   (LLM çağrıları hep `server/`/`app/api/` katmanında), ama Halk-AI'nın
   ürettiği METİN'in oyun durumuna (`game_saves`) yazılıp yazılmayacağı
   (yazılırsa save şemasının `.strict()` kısıtına yeni alan eklemek
   gerekir, CLAUDE.md kısıt #3) her fikir için ayrı ayrı netleşmeli.
4. **Mevcut tasarım ilkelerinin yeniden açılması:** Fikir 17 ve 18,
   `engine/populace.ts`/`engine/migration.ts`'in bugünkü BİLİNÇLİ
   sınırlarına (ayrılma kararı mutlaktır; hedef gönderen tarafından
   seçilemez) dokunuyor. Bu iki fikir onaylanırsa, ilgili dosyalardaki
   "neden böyle" yorumlarının da (CLAUDE.md'nin "tek-doğru-kaynak" ve
   "geçmişte gerçek hata olarak yaşandı" disipliniyle tutarlı biçimde)
   güncellenmesi gerekecek — sessizce üstüne yazılamaz.
5. **"Kısmen tamamlandı" karışıklığı:** `docs/PHASES.md`'nin Faz 6
   konusunda eskimiş olması (§3'teki not), bu projenin faz belgelerinin
   ne kadar sadık tutulduğu konusunda bir uyarı işareti — bu yeni vizyon
   dizisi başladığında aynı hatayı tekrarlamamak için (özellikle bu kadar
   çok fikir varken) her fazın TAMAMLANDIĞI anda `docs/PHASES.md`'ye
   gerçek commit referanslarıyla işlenmesi disiplini baştan
   benimsenmeli.

## 6. Askeri, ekonomik ve dünya olayları fikirleri (ayrı sohbette karara bağlandı)

Bu bölüm, Kral'ın §0'daki kapsam notunda ayrı tutulan konuyu (askerler/
savaş yapısı, ortak maden, pazar, channel-genelinde dünya olayları) ayrı
bir sohbette değerlendirip KABUL ettiği yedi fikri içerir. Halk-AI
bölümünden (§4, Fikir 0-18) BAĞIMSIZDIR — hiçbiri Fikir 0'ın (Halk-AI
kimlik altyapısı) admin-finanse AI'sını gerektirmez, hepsi saf `engine/`
mekaniği ya da mevcut General/müzakere altyapısının genişlemesidir. Aynı
sohbette değerlendirilip **reddedilen** iki fikir (askeri blöf/yanıltma,
gizli kartel/fiyat manipülasyonu) kasıtlı olarak bu belgede yer almıyor.
Aşağıdaki her madde KABUL edildi — kalan açık sorular "yapılsın mı"
değil, "nasıl/ne zaman yapılsın" sorularıdır.

---

### 19. Birlik ruhu / deneyimi ekseni

**Kaynak:** Kullanıcı ile karara bağlanan fikir (askeri/ekonomik fikirler turu).

Sürekli kazanan (akını püskürten) birlik zamanla daha sadık/kendinden
emin hâle gelir; sürekli kaybeden ya da uzun süre maaşsız kalan birlik
firar riskini daha hızlı taşır. Bugünkü `soldierUnrest` tek eksenli
(yalnızca NEGATİF) modelin üstüne POZİTİF bir ikinci eksen eklenir.

- **Hizmet ettiği:** "asker olmadan ama zamanla kazanma" temasının ordu
  tarafı — savaşın kendisi değil ORDUNUN İÇ HÂLİ bir strateji ekseni
  olur; ayrıca "kendi kendine yaşayan dünya" hissine katkı (ordu da
  zamanla kendi "kişiliğini" kazanır).
- **Bugün en yakın ne var / eksik:** `engine/populace.ts` →
  `soldierUnrestAfter` (maaşa bağlı huzursuzluk, tek eksen, yalnızca
  negatif) ve `engine/raids.ts` → `defenseOf` içindeki `reliability`
  (huzursuzluğa bağlı güvenilirlik çarpanı) zaten "askerin iç hâli savaş
  gücünü etkiler" ilkesinin bir versiyonu. Eksik olan: pozitif tarafı
  biriktiren bir alan (deneyim/moral) ve bunun `defenseOf`/`suppression`
  hesaplarına nasıl gireceği.
- **Efor:** orta — `engine/populace.ts`/`engine/raids.ts`'e yeni bir saf
  alan + `Game` tipine yeni bir server-türevi alan (save şeması
  `.strict()`, CLAUDE.md kısıt #3 — aynı değişiklikte şemaya eklenmeli).
- **Açık sorular:**
  - Deneyim akın PÜSKÜRTÜLDÜĞÜNDE mi (savunma başarılı), yoksa yalnızca
    UZUN SÜRE tam maaş ödendiğinde mi birikir — ikisi birden mi?
  - Birim öldüğünde (akın kaybı) bu deneyim de mi kaybolur, yoksa
    "ordunun ortalaması" olarak (birim bazlı değil, tek bir istatistik
    olarak) birikimli mi kalır?
  - Bu eksen `defenseOf.power`'a doğrudan girer mi (güçlü ordu daha da
    güçlenir — kartopu/dengesizlik riski) yoksa önce yalnızca anlatı/
    panel göstergesi olarak mı başlar? Hangi fazda, hangi öncelikte ele
    alınmalı?

---

### 20. Channel-geneli paralı asker havuzu

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Zengin-az nüfuslu bir krallık, kalabalık-fakir bir krallıktan (nüfus
fazlası olan) asker "kiralayabilir" — ekonomik gücü doğrudan askeri güce
çevirir, savaşmadan güçlenmenin ekonomik bir yolu.

- **Hizmet ettiği:** "halkı kendine çekmek" ve "ekonomisini bozmak"
  temalarının ordu tarafı — bir krallığın nüfus fazlasını parayla başka
  bir krallığın savunmasına kiralaması.
- **Bugün en yakın ne var / eksik:** Hiçbir karşılığı yok — `units`
  tamamen krallık-içi bir stoktur, `train_unit` yalnızca kendi
  nüfusundan asker üretir. En yakın yapısal desen
  `engine/negotiation.ts`'in müzakere/şart altyapısı — yeni bir
  `NEGOTIATION_TOPICS` girdisi (TEK KAYNAK ilkesi gereği doğrudan orada
  yaşamalı) olarak kurulabilir.
- **Efor:** büyük — yeni müzakere konusu + asker transferi kuralı
  (kiralanan asker kimin nüfusundan/ordusundan sayılır).
- **Açık sorular:**
  - Kiralanan asker kiracının `units`'ine mi yazılır (savunma gücü
    artar, nüfus artmaz) yoksa ayrı bir `units.mercenary` kategorisi mi
    açılır?
  - Kiralayan krallık bunu yalnızca CAYDIRICILIK (savaşsız güç gösterme)
    için mi kullanır, yoksa gerçek akın/abluka savunmasında fiilen
    kullanılan bir asker mi olur — ikisi çok farklı dengeler gerektirir,
    hangisi (ya da ikisi birden) hedefleniyor?
  - Kiralama süresi/ücreti nasıl belirlenir — sabit fiyat mı (dış kesenin
    600 altın sabit-fiyat deseni gibi) yoksa serbest müzakereyle mi?
  - Kiralanan asker akında/abluka'da kaybolursa bu kayıp kime ait
    sayılır — kiracıya mı (parasını ödedi, riski o taşır) yoksa
    kiralayan krallığa mı (kendi vatandaşı öldü)?

---

### 21. Uzun süreli abluka

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Anlık akının aksine günlerce süren, sinsi bir baskı — bir krallığın
ordusunu komşusunun sınırında "beklemede" tutması, savaş ilan etmeden;
hedefin nöbet oranını yükseltmeye zorlaması (asker az kaybıyla, ZAMANLA
kazanma).

- **Hizmet ettiği:** "iç karışıklık yaratarak asker olmadan savaş
  kazanma" — doğrudan savaşmadan, YALNIZCA tehdidin kendisiyle hedefi
  zayıflatan bir araç; haydut yönlendirmenin (Faz 7) "gizli" hâlinin
  AÇIK ve SÜREKLİ versiyonu.
- **Bugün en yakın ne var / eksik:** `engine/agitation.ts` → `LURE`
  (haydut yönlendirme) kavramsal olarak en yakın: "hedefi nöbet oranını
  yükseltmeye zorlamak, asıl kazanç budur" cümlesi birebir bu fikrin
  gerekçesi. Fark: lure GİZLİ ve haydut üzerinden dolaylı, abluka AÇIK
  ve doğrudan (Kral'ın kendi ordusu görünür şekilde sınırda durur).
- **Efor:** büyük — yeni bir süreklilik durumu (dış kese gibi zamanlı
  ama TEK SEFERLİK değil SÜREGELEN bir kayıt), hedefin bunu ne zaman
  fark ettiği/ne zaman bittiği kuralları.
- **Açık sorular:**
  - Abluka sırasında Kral'ın KENDİ ordusu ne yapıyor sayılır (üretimden
    mi düşer, kendi savunmasını mı zayıflatır) — bir bedeli olmalı,
    yoksa "bedelsiz sürekli baskı" aracı dış kesenin dikkatli
    dengelenmiş maliyet modelini (yaklaşık 14 kat verimsizlik gibi)
    anlamsız kılar.
  - Abluka imzalı bir saldırmazlık anlaşmasını (`agreements`) ihlal
    sayılır mı (`punishAgitator`'ın bugün dış kese için yaptığı gibi bir
    ihanet cezası burada da işler mi)?
  - Abluka ne kadar sürebilir — bir tavan var mı, yoksa Kral dilediği
    kadar sürdürebilir mi (sürdürme maliyeti olmadan sonsuz abluka
    dengeyi bozar)?
  - Bu, Fikir 19 (birlik deneyimi) ile aynı fazda mı ele alınmalı —
    abluka sırasında ordunun deneyimi/morali de mi etkilenir?

---

### 22. Ortak madende nüfuz mücadelesi

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Damarda en çok işçi bulunduran krallık "bölge sahibi" sayılıp küçük bir
öncelik/pay avantajı kazanır.

- **Hizmet ettiği:** "ekonomisini bozmak" temasının maden tarafı — savaş
  değil, EMEK YOĞUNLUĞUYLA bir kaynağa hükmetme; ortak madenin bugünkü
  "tamamen eşitlikçi" doğasına REKABET katarak onu daha canlı/stratejik
  hâle getirir.
- **Bugün en yakın ne var / eksik:** `engine/mine.ts` → `settleMine`
  bugün TAMAMEN eşitlikçi: her krallık yalnızca KENDİ işçisinin
  ürettiğini alır, sıra yalnızca damar bittiğinde (userId'ye göre sabit,
  adil bir sırayla) devreye girer — "en çok işçi = avantaj" kavramı hiç
  yok. Dosyanın kendi yorumu bunu açıkça ilke olarak koymuş: "kimse
  başkasının payını yemez" — bu fikir BİLİNÇLİ olarak bu ilkeye küçük
  bir istisna getiriyor.
- **Efor:** orta — `settleMine`'a yeni bir saf hesap katmanı (işçi
  sayısına göre pay çarpanı).
- **Açık sorular:**
  - Bu "nüfuz payı" başka bir krallığın AKTİF üretiminden mi çalınır (o
    zaman "kimse başkasının payını yemez" ilkesi BİLİNÇLİ olarak kısmen
    terk edilmiş olur) yoksa yalnızca damarın TÜKENME anındaki artık/
    kalıntı payı mı paylaşılır (aktif üretimden hiçbir şey alınmaz,
    ilkeyle çatışmaz)? Bu, fikrin en kritik tasarım kararı.
  - "En çok işçi" ölçütü ANLIK mı (her hesapta değişebilir) yoksa bir
    süre boyunca (örn. son 24 saat ortalaması) sabit mi tutulur — anlık
    olursa krallıklar sürekli işçi sayısını değiştirip "sahiplik" kapma
    yarışına girebilir; bu istenen bir dinamik mi?
  - Nüfusun ne kadarının madene ayrılabileceği tavanı (`send_miners`
    bugün nüfusun %20'si) bu rekabetle birlikte yeniden mi
    değerlendirilmeli (rekabet daha çok işçi göndermeyi teşvik eder)?

---

### 23. Maden tükenince ortaya çıkan yeni fırsat (define, yıkık kale)

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Cevher biterse aynı bölgede periyodik olarak yeni bir kaynak/fırsat
(define, yıkık kale gibi tematik bir keşif) belirir; ilk ulaşan krallık
alır — kısa, yoğun bir yarış anı.

- **Hizmet ettiği:** "kendi kendine yaşayan dünya" — madenin bitmesi bir
  SON değil, yeni bir olayın BAŞLANGICI olur; periyodik bir "büyük olay"
  ritmi ekler (günlük alışkanlık motivasyonuna da katkı — kim ilk fark
  edip tepki verirse kazanır).
- **Bugün en yakın ne var / eksik:** `shared_mines` tablosu tek bir
  channel-başına-tek-maden varsayımıyla kurulu
  (`idx_shared_mines_channel` UNIQUE index — bkz. `db/schema.ts`); bugün
  damar tükendiğinde (`oreRemaining <= 0`) hiçbir yeni olay
  tetiklenmiyor, üretim sessizce durur. En yakın desen
  `app/api/cron/route.ts`'teki `settleAgitations`/`settleMigrations`
  ailesi ("kaynakta olay olur, cron hedefe gecikmeli yazar").
- **Efor:** orta-büyük — şema değişikliği (UNIQUE index kaldırılmalı ya
  da "aktif" bir durum alanı eklenmeli), yeni bir cron adımı, tematik
  içerik (define/yıkık kale metinleri).
- **Açık sorular:**
  - Yeni fırsatın konumu/türü/büyüklüğü tohumlu mu (channel adı +
    tükenme anı, `engine/raids.ts`'in `rand01`/`engine/world-map.ts`'in
    `jitter` deseniyle) yoksa admin mi belirliyor?
  - "İlk ulaşan alır" gerçek bir YARIŞ mı (kim önce işçi/asker gönderirse
    tüm fırsatı alır) yoksa Fikir 22'deki gibi kısmen paylaşımlı mı — bu
    iki maden fikrinin tutarlı bir felsefesi olmalı (madende asıl ton
    rekabet mi işbirliği mi)?
  - Fırsat kaçırılırsa (belirli bir süre içinde kimse ulaşmazsa) ne olur
    — sonsuza dek beklemede mi kalır, yoksa kaybolup damar boş mu kalır?

---

### 24. Channel-geneli pazar endeksi

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Bir krallığın büyük bir alım/satımı yalnızca kendi pazarını değil,
komşularının fiyatını da (küçük bir sızıntı/yayılma etkisiyle) etkiler —
"dünyanın kendi kendine yaşadığı" hissini pazar tarafında güçlendirir.

- **Hizmet ettiği:** "kendi kendine yaşayan dünya" — bugün her krallığın
  pazarı KESİNLİKLE izole (`engine/market.ts`'in kendi yorumu: "Bu dosya
  yalnızca krallık içini ilgilendirir. Channel çapındaki oyuncular arası
  pazar AYRI bir iştir"); bu fikir kasıtlı olarak ayrılmış bu iki dünyayı
  ince bir köprüyle birleştiriyor.
- **Bugün en yakın ne var / eksik:** `engine/market.ts`'in
  `commonsOf`/`priceMultiplier`/`fillOrder` fonksiyonları TAMAMEN
  krallık-içi (nüfus, `commons` stoğu). Channel-geneli bir "sızıntı"
  için iki yol var: (a) her krallığın fiyatına küçük bir
  channel-ortalaması düzeltmesi eklemek (agregasyon — Fikir 1/13'teki
  channel-ortalaması sorgusuyla aynı ailede), ya da (b) büyük bir emrin
  (`fillOrder` çağrısının) bir yan etkisi olarak komşu kayıtlara küçük
  bir puan yazmak (`engine/agitation.ts`'in "kaynakta olay olur, hedefe
  gecikmeli yazılır" desenine yakın, ama YAN ETKİ/pasif olmalı — kese
  gibi saldırgan bir araç değil).
- **Efor:** orta-büyük — hangi mekanizma seçilirse seçilsin yeni bir
  hesap katmanı ve muhtemelen yeni bir server-türevi alan.
- **Açık sorular:**
  - Etki YÖNÜ ne — yalnızca "haberdar olma" (Fikir 1/13 gibi salt bilgi)
    mı, yoksa GERÇEKTEN fiyatı değiştiren bir mekanik mi? İkincisi çok
    daha büyük bir dengeleme işi ister ve `engine/market.ts`'in bugünkü
    izolasyon ilkesini kısmen terk eder — bu BİLİNÇLİ bir tercih olarak
    netleşmeli.
  - Büyük bir emrin eşiği ne (hangi büyüklükteki alım/satım "channel'ı
    etkiler" sayılır) — bu eşik channel nüfusuna/hızına göre mi
    ölçeklenir?
  - Bu endeks Fikir 13'ün (sessiz kıyaslama) ya da Fikir 1'in (channel
    ortalaması) agregasyon altyapısını mı paylaşır, yoksa bağımsız bir
    sistem mi kurar?

---

### 25. Tohumlu, channel-genelinde dünya olayları (mevsim/kıtlık)

**Kaynak:** Kullanıcı ile karara bağlanan fikir.

Akınlar gibi tohumlu/deterministik ama TEK krallığı değil TÜM channel'ı
aynı anda etkileyen olaylar (kıtlık, sert kış, bereketli hasat) — Kral
kontrol edemez, yalnızca General buna karşı hazırlık önerebilir.

- **Hizmet ettiği:** "kendi kendine yaşayan dünya" ve "oyunun kraldan
  akıllı olması" — Fikir 11'i ("Kader" katmanı) TAMAMLAYAN ikinci bir
  sürpriz kaynağı: Fikir 11 General'in KENDİ önerisiyken, bu DIŞSAL/
  doğa kaynaklıdır.
- **Bugün en yakın ne var / eksik:** `engine/raids.ts`'in TÜM deseni
  (tohum = `kingdomName + foundedAt + pencere indeksi`, pencere mutlak
  zamana oturur, `rand01`) doğrudan örnek alınabilir; TEK fark tohumun
  KRALLIK yerine CHANNEL bazlı olması gerekir (`channelId + pencere
  indeksi` gibi) — böylece aynı channel'daki HERKES aynı olayı aynı anda
  yaşar. Bugün böyle bir "channel tohumu" hiç kullanılmıyor.
- **Efor:** büyük — yeni bir engine modülü (`engine/world-events.ts`?),
  cron'da yeni bir tur (channel başına bir kez, krallık başına değil —
  bu maliyet açısından ÖNEMLİ bir fark, bugünkü cron turlarının hepsi
  krallık/anlaşma bazlı döngüler).
- **Açık sorular:**
  - Olay tüm krallıklara AYNI mı etkir (örn. herkesin yiyecek üretimi
    %20 düşer) yoksa arazi/hazırlığa göre FARKLI mı (dağ arazisi kıştan
    daha çok etkilenir gibi, `raids.ts`'in arazi-bazlı ağırlıklandırma
    deseni)? İkincisi daha zengin ama çok daha karmaşık.
  - Kabul edilen tanım hem olumsuz (kıtlık, sert kış) hem olumlu
    (bereketli hasat) örnekler içeriyor — iki yönün SIKLIK ORANI ne
    olmalı (yarı yarıya mı, yoksa olumsuz ağırlıklı mı)?
  - General'in "buna karşı hazırlık önerebilmesi" ne anlama geliyor —
    olay GELMEDEN ÖNCE bir uyarı sinyali mi var (Fikir 11'in "Kader"
    katmanıyla AYNI altyapı, gece vardiyasının proaktif uyanması), yoksa
    yalnızca olay olduktan SONRA mı General yorum yapar? Öncesi
    seçilirse bu fikir Fikir 11 ile aynı fazda tasarlanmalı.
  - Bu, tüm channel-geneli fikirlerin (22, 23, 24) ortak bir
    "channel-events" cron altyapısını mı paylaşmalı, yoksa her biri ayrı
    mı inşa edilmeli?
