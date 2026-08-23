# Devir belgesi — Demirkale oyun tasarımı denetimi

Tarih: 2026-08-23 · Bu paket başka bir oturumda kaldığı yerden devam etmek için hazırlandı.

## 1. Amaç (Kralın kendi ifadesiyle)

> "UI uzmanından istediğim geliştirme yapması değil. 15+ yıllık bir uzmanlık
> deneyimi olduğunu düşünsün ve kendisi game design tarafında bir uzman olsun.
> Playwright ile sekmeleri tek tek dolaşsın ve bir kullanıcının oyunda
> dolaşırken sekmeleri gerçekten anlamlı mı anlamlı değil mi kolay anlaşılıyor
> mu gibi soruları yanıtlasın ve bana alternatif ve kolay anlaşılır mockuplar
> yayınlasın. Burdaki kriterlerimlerinden en önemlisi kolay kullanım diğeri ise
> gerçekçilik."

**İki ölçüt, bu sırayla:**
1. **KOLAY KULLANIM (en önemli).** Oyuncu bu sekmede ne yapacağını, neyin ne işe
   yaradığını, bir sonraki hamlesinin ne olması gerektiğini çabucak anlıyor mu?
   Anlamıyorsa tam olarak nerede kayboluyor?
2. **GERÇEKÇİLİK.** Ekran bir ortaçağ krallığını yönetmek gibi mi hissettiriyor,
   yoksa bir tablonun hücrelerini doldurmak gibi mi?

Erişilebilirlik denetimi kapsam DIŞI bırakıldı (ayrı bir işin konusu).
Kod yazma da kapsam dışıydı: `components/KingdomGame.tsx` ve `app/game.css` o
sırada paralel çalışan iki agent'ın elindeydi, üç yönlü çakışma olmasın diye
tasarımcıya "yalnızca yeni dosya yaz, mockup yayınla" dendi.

## 2. Agent'a verilen tam görev tanımı

**Rol:** UI geliştiricisi DEĞİL. 15+ yıllık bir oyun tasarımcısı. CSS diff'i
yazmıyor; "bu ekran oyuncuya ne öğretiyor, ne saklıyor, oyuncu buradan çıkarken
ne yapacağını biliyor mu" sorusunu cevaplıyor.

**Yöntem:** Playwright ile yedi sekmeyi TEK TEK dolaşmak (`MECLİS`, `BİNALAR`,
`HALK`, `ORDU`, `İSTİHBARAT`, `DEFTER`, `DİYAR`), ayrıca kuruluş akışını (dünya
seç → sancak dik → General bağla) yeni bir oyuncu gibi baştan geçmek.

**Her sekmede cevaplaması istenen sorular:**
- Bu sekme var olmayı hak ediyor mu? Yoksa başka bir sekmenin içinde mi durmalı?
  Yedi sekme çok mu?
- Sekmenin adı içeriğini doğru anlatıyor mu?
- Oyuncu bu sekmeye girdiğinde ilk 3 saniyede ne öğreniyor? En önemli şey mi?
- Buradan çıkarken ne yapacağını biliyor mu? Sekme bir karar mı sunuyor, yoksa
  sadece durum mu bildiriyor?
- Bir şey açıklanmadan varsayılıyor mu (bir mekanik, bir eşik, bir bedel)?
- Aynı bilgi başka bir sekmede de duruyor mu? Nerede olmalı?
- Sekmeler arası anlatı akışı var mı? Oyuncu doğal olarak hangi sırayla dolaşır?

**Özellikle işaretlenen iki sekme:**
- **İSTİHBARAT** — zafer skoru iki sütunlu (askersiz üstünlük / askeri katkı) ve
  bu ayrım oyunun bütün fikri ("asker olmadan da kazanılır"). Oyuncu bunu
  ekrandan anlıyor mu, yoksa iki sütun eşit ağırlıkta mı duruyor?
- **HALK** — oyunun kalbi halkın rızası, ama ekran bunu bir gösterge olarak mı
  bir ilişki olarak mı sunuyor?

**Teslim (a) Değerlendirme:** sekme sekme net yargı — "çalışıyor",
"bölünmeli", "birleşmeli", "adı yanlış". Kaçamak cevap yok; iyi olan sekme
için de iyi denecek.

**Teslim (b) MOCKUP'LAR — asıl iş:** en az üç sekme için alternatif tasarım,
her biri "bugün böyle / önerim böyle" karşılaştırmalı, altında iki-üç cümle
gerekçe. Statik HTML/CSS. **Mevcut görsel dil (ağırbaşlı, "resmî defter"
hissi, ortaçağ tonu) KORUNACAK — modern SaaS dashboard'una çevirmek
gerçekçilik ölçütünü ihlal eder.** Hem açık hem koyu temada okunabilir.

## 3. Ne teslim edildi

| Dosya | Ne |
|---|---|
| `2026-08-23-oyun-tasarimi-degerlendirmesi.md` | 11 bulgu, sekme sekme yargı, anlatı akışı, gerçek bozukluklar |
| `sekme-taslaklari.html` | Mockup'ların kaynağı — dört sekme için "bugün / önerim" |
| `updates-kaydi.md` | Projenin zorunlu `updates/` kaydı |

Yayınlanmış hâli (artifact):
**https://claude.ai/code/artifact/7a9e93c5-a065-4e10-9c15-2120c7df02f6**

Mockup'lar dört sekmeyi kapsıyor: MECLİS, HALK, İSTİHBARAT→SESSİZ SAVAŞ,
DEFTER→VAKAYİNAME; artı iki ek bölüm (dört-sesli vergi çelişkisi, şerit sırası
önerisi). Taslakların içi oyunun kendi paletiyle ve **konsey panelinin gerçek
genişliğinde (392 px)** çizilmiş — asıl kısıt bu.

## 4. Kısa yargı tablosu

| Sekme | Yargı |
|---|---|
| MECLİS | Var olmayı hak ediyor — ama bugün boş bir oda. Oyunun kalbi, en zayıf ekran. |
| BİNALAR | Çalışıyor, ama kataloğa dönüşmüş. Kararı öne çıkarmıyor; gruplanmalı. |
| HALK | Var olmayı hak ediyor, ama sıralaması ters. Rızayı ilişki değil gösterge olarak sunuyor. |
| ORDU | Var olmayı hak ediyor — boşken altı kere "sıfır" diyor. Boş durumu tek karta inmeli. |
| İSTİHBARAT | Var olmayı hak ediyor, adı yanlış, sütun ayrımı görünmüyor. Oyunun tezi ekranda kaybolmuş. |
| DEFTER | Var olmayı hak ETMİYOR — bugünkü hâliyle üst şeridin kopyası. Yerine gerçek vakayiname gelmeli. |
| DİYAR | Çalışıyor, ama yanlış şeyi barındırıyor (vakayiname burada duruyor). |

**Yedi sekme çok mu?** Hayır — altı doğru sekme var, yedincisi yanlış sekme.
Ayrıca navigasyonun DIŞINDA iki karar yüzeyi daha var (Pazar ve Müzakere
yaprakları), yani gerçek yüzey sayısı yedi değil dokuz.

## 5. Bağımsız olarak DOĞRULADIĞIM bulgular

Bunları kendim koda bakıp teyit ettim; devralan oturum yeniden ölçmek zorunda değil.

- **Vergi çelişkisi GERÇEK ve dört sesli.** Gerçek davranış: Kral doğrudan
  çeviriyor (HALK sekmesindeki −5/+5 düğmeleri çalışıyor). Buna karşı:
  DEFTER'de kaydırıcı `disabled` + "General'i ikna etmelisin"; Rehber IV. adım
  "vergiyi düğmeyle değiştirmezsin"; "Generalin yetkileri" kartı yetki
  listesine "Vergi ayarla"yı koyuyor ve hemen altında "Kral doğrudan çevirir"
  yazıyor — kart kendisiyle çelişiyor. Kuralın altı yere elle yazılmasının
  sonucu; CLAUDE.md kısıt #5'in yasakladığı şey. **DÜZELTİLMEDİ.**
- **İSTİHBARAT sütun dengesizliği GERÇEK.** `engine/victory.ts` sayıldı:
  askersiz sütun 5 kalem, askerî sütun 2 kalem besliyor; ekran üç *eşit* sütun
  gösteriyor. **DÜZELTİLMEDİ.**
- **Kilitli yapıda boş maliyet — DÜZELTİLDİ** (commit `ed04e9c`). Kilitli
  satırlar "Sonraki emir maliyeti ·" yazıp arkasını boş bırakıyordu.
- **Maliyetler İngilizce motor anahtarıyla — DÜZELTİLDİ** (aynı commit).
  "wood 148" → "odun 148".

## 6. Agent'ın YANLIŞ olan bir iddiası

Raporunda "`docs/` ve `updates/` git'te takip edilmiyor" demiş — **yanlış**,
takipli. Ayrıca kendi worktree'sinin HEAD'i geride kaldığı için denetimi ana
checkout üzerinden yapmış; bunu kendisi fark edip söylemesi doğruydu, ama o
yüzden branch'i birleştirilmedi, yalnızca belgeleri alındı.

## 7. Devralan oturum için açık maddeler

- **Kral "tam olarak istediğim gibi değil" dedi ama nedenini söylemedi.** İlk
  iş bunu netleştirmek: eksik olan mockup sayısı mı, kapsanan sekmeler mi,
  önerilerin radikallik derecesi mi, yoksa sunum biçimi mi?
- Mockup'lar dört sekmeyi kapsıyor; ORDU ve BİNALAR için taslak YOK (bulgu var,
  taslak yok).
- Değerlendirme oyunun **birinci günü** üzerinden yapıldı: test channel'ında
  tek krallık, defterler boş, kışla ve pazar kurulmamış, General bağlı değil.
  Boş durum yargıları güçlü, DOLU panellerin sıkışması hakkındaki yargılar
  çıkarım.
- Google Fonts test ortamında kapalıydı; tipografi yedek yığında görüldü. Bu
  yüzden yargılar punto ölçülerine değil hiyerarşinin yapısına dayandırıldı.
- Pazar ve Müzakere'nin navigasyon dışında olması bilinçli bir tasarım olabilir
  (şerit yedide zaten sıkışmış) — agent bunu bir bulgu olarak yazdı ama kararın
  Krala ait olduğunu belirtti.

## 8. Oyunu tekrar gezmek için (teknik not)

Denetim, oyunun ÇALIŞAN bir kopyası üzerinde yapıldı. Kurulum:
Postgres + `vinext dev` (port 3001), Chromium
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, WebGL için
`--use-gl=swiftshader --enable-unsafe-swiftshader`, Google Fonts'u
`ctx.route("https://fonts.g**", r => r.abort())` ile kesmek gerekiyor
(bu ortamda proxy yüzünden `ERR_CONNECTION_RESET` veriyor — oyun hatası değil).
Test hesapları: oyuncu `oyuncu@demirkale.test`, admin `kral@demirkale.test`.
