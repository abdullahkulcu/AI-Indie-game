# Oyun tasarımı değerlendirmesi — yedi sekme, oyuncunun gözünden

Tarih: 2026-08-23
Bakış açısı: oyun tasarımı (arayüz mühendisliği değil). Ölçüt sırası:
**(1) kolay kullanım**, **(2) gerçekçilik**. Kontrast/piksel/hizalama denetimi
bu belgenin konusu DEĞİL.

## Nasıl bakıldı

`http://127.0.0.1:3001` üzerinde çalışan canlı oyun, Playwright + Chromium ile
gerçek tarayıcıda gezildi. 1440×950'de yedi sekmenin hepsi açıldı, ekran
görüntüleri alındı, panel yükseklikleri ve düğme durumları ölçüldü; Meclis'te
gerçek bir emir gönderildi; Pazar ve Müzakere yaprakları, iki bilgi kartı ve
Rehber turu açıldı; 1280×800 ve 1024×768 denendi. Kuruluş akışı önceki
oturumdan alınan ekran görüntüleriyle (`pw/70-adim-*.png`) incelendi.

Ekran görüntüleri: `pw/ux-1440-{meclis,binalar,halk,ordu,istihbarat,defter,diyar}.png`,
`pw/ux-meclis-emir.png`, `pw/ux-pazar.png`, `pw/ux-muzakere.png`, `pw/ux-1280.png`,
`pw/ux-1024.png`, `pw/70-adim-3.png`, `pw/70-adim-4.png`.

**Test ortamının sınırları — okurken akılda tutulmalı.** Bu channel'da TEK
krallık var, defterler boş, kışla yok, ordu yok, pazar kurulmamış ve General
bağlı değil. Yani gördüğüm çoğu ekran oyunun "birinci günü". Boş durumlar
hakkındaki yargılarım bu yüzden GÜÇLÜ (birinci gün her oyuncunun yaşadığı
gündür); dolu panellerin sıkışması hakkındaki yargılarım ise ÇIKARIM, ölçüm
değil — nerede öyle olduğunu bulgunun içinde söylüyorum. Google Fonts bu
ortamda kapalı olduğu için tipografi yedek font yığınında görüldü; bu yüzden
"yazı çok küçük / hiyerarşi zayıf" türü yargılarımı yalnızca ölçülen `font-size`
değerlerine ve göz hizasına değil, **hiyerarşinin yapısına** dayandırdım.

---

## Kısa yargı tablosu

| Sekme | Yargı |
|---|---|
| MECLİS | **Var olmayı hak ediyor — ama bugün boş bir oda.** Oyunun kalbi, en zayıf ekran. |
| BİNALAR | **Çalışıyor, ama kataloğa dönüşmüş.** Kararı öne çıkarmıyor; gruplanmalı. |
| HALK | **Var olmayı hak ediyor, ama sıralaması ters.** Rızayı ilişki değil gösterge olarak sunuyor. |
| ORDU | **Var olmayı hak ediyor — boşken altı kere "sıfır" diyor.** Boş durumu tek karta inmeli. |
| İSTİHBARAT | **Var olmayı hak ediyor, adı yanlış, sütun ayrımı görünmüyor.** Oyunun tezi ekranda kaybolmuş. |
| DEFTER | **Var olmayı hak ETMİYOR — bugünkü hâliyle.** Üst şeridin kopyası. Yerine gerçek vakayiname gelmeli. |
| DİYAR | **Çalışıyor, ama yanlış şeyi barındırıyor.** Vakayiname burada duruyor; olması gereken yerde değil. |

**Yedi sekme çok mu?** Hayır — **altı doğru sekme var, yedincisi yanlış
sekme.** Sorun sayı değil, DEFTER'in içeriğinin başka yerde, DİYAR'ın içinde
duran vakayinamenin de burada olması. Ayrıca navigasyonun DIŞINDA iki karar
yüzeyi daha var (Pazar ve Müzakere yaprakları, haritanın sol alt köşesinde) —
gerçek yüzey sayısı yedi değil dokuz.

---

## Bulgu 1 — Vergiyi kim çeviriyor? Oyun dört farklı cevap veriyor

**Ne gördüm.** Aynı oyunda, aynı anda, dört yer:

1. **HALK** sekmesi: "Vergi oranı %15" ve altında çalışan **−5 / +5** düğmeleri.
   Kral doğrudan çeviriyor, General'e sormuyor. (`ux-1440-halk.png`)
2. **DEFTER** sekmesi: aynı vergi oranı, **devre dışı** bir kaydırıcı ve altında
   "*Değiştirmek için General'i ikna etmelisin.*" (`ux-1440-defter.png`)
3. **Rehber**, IV. adım (DEFTER): "*Defterde saatlik değerleri izlersin fakat
   vergiyi düğmeyle değiştirmezsin. General'i rakamlar ve gerekçelerle ikna
   etmelisin.*"
4. **"Generalin yetkileri"** bilgi kartı: yetki listesinde "**Vergi ayarla**"
   yazıyor; aynı kartın en altındaki notta ise "*Vergi ve istihkakları Kral
   doğrudan çevirir — General uygulamaz*".

**Niçin sorun.** Bu bir yazım hatası değil, **oyunun sözleşmesinin dört farklı
sürümü.** Demirkale'nin bütün cazibesi "Kral doğrudan yönetmez, Generalini
ikna eder" fikri. Vergi de bu oyunda en sık dokunulan koldur. Oyuncu ilk
saatinde bu kolun kime ait olduğunu öğrenemiyorsa, oyunun temel gerilimini
öğrenemiyor demektir: Rehber ona ikna etmeyi öğretiyor, HALK sekmesi düğme
veriyor, DEFTER düğmeyi kilitliyor. Üçünden hangisinin doğru olduğunu
anlamanın tek yolu deneyip görmek. Bu, oyunu değil arayüzü çözmek.

**Yargı.** Tek bir cevap seçilmeli ve o cevap dört yerde birden anlatılmalı.
Kodun davranışı (HALK'taki `setPolicy`) doğru cevap gibi görünüyor: vergi ve
istihkaklar **Kralın fermanı**, yapılar ve asker **Generalin işi**. O hâlde
DEFTER'in kilitli kaydırıcısı ve Rehber IV yanlış; bilgi kartındaki "Vergi
ayarla" maddesi de listeden çıkmalı. **Bu, listedeki en ciddi problem** —
tek bir metin düzeltmesi değil, oyunun kendini nasıl tanıttığı.

---

## Bulgu 2 — MECLİS: oyunun kalbi, boş bir oda

**Ne gördüm.** 1440×950'de MECLİS sekmesi: bir danışman satırı ("General
sessiz · BYOK bağlantısı bekleniyor"), iki küçük rozet (◆ İlk hedef, ◆
Generalin yetkileri), sonra **540 piksel bomboş alan**, en altta bir yazı
kutusu: "Generalinize buyruğunuzu iletin…". (`ux-1440-meclis.png`)

Yazı kutusuna "Kışla kur." yazıp gönderdim. Cevap geldi: **"Saray Kâtibi:
General bağlantısı etkin değil. Hesabındaki BYOK bağlantısını yenilemelisin."**
— ve ekranın ortasına bir BYOK modalı açıldı. (`ux-meclis-emir.png`)

**Niçin sorun — iki kat.**

*Kolay kullanım.* Oyunun bütün etkileşim modeli bu sekmede yaşıyor ve sekme
oyuncuya ne söyleyeceğine dair **hiçbir örnek vermiyor.** Boş bir metin kutusu,
LLM ile konuşan bir oyunda en pahalı boşluktur: oyuncu "ne yazabilirim?"
sorusunun cevabını bilmez. "Kışla kur" mu, "Kışla kurmayı düşünüyorum, ne
dersin?" mü, "Kuzeydeki komşuya karşı savunma istiyorum" mu? Üçü de çok farklı
oyunlar. Arayüz üçünü de mümkün kılıyor, hiçbirini önermiyor.

*Gerçekçilik.* "Meclis" kelimesi bir oda vaat ediyor: masa, katılanlar,
gündem. Ekranda oda yok — bir sohbet penceresi var. Krallığın divanı boş
duruyor, gündemi yok, geçmiş oturumların tutanağı yok. Halk araya girdiğinde
(`.message.populace`) oda dolmaya başlıyor ama boşken oda olduğu hiç
anlaşılmıyor.

*Ve en kötüsü:* General bağlı değilken metin kutusu **açık kalıyor.** Oyuncu
yazıyor, gönderiyor, hiçbir şey olmuyor gibi görünüyor, sonra teknik bir cümle
("BYOK bağlantısı") ve bir modal. Bağlı olmadığı en baştan belliydi — kutu o
zaman neden yazılabilir durumda?

**Yargı.** Sekme kalmalı, boşluğu dolmalı. Boş meclis, bir **gündem**
göstermeli: krallığın şu andaki üç açık meselesi (yiyecek dengesi, kapasite,
kışla eksikliği) ve her birinin yanında Kralın söyleyebileceği hazır bir söz.
General bağlı değilken kutu kapanmalı ve kutunun yerine tek bir şey gelmeli:
"Generalin sessiz. Meclis onu bağlayana kadar toplanamaz. → GENERALİ BAĞLA".

---

## Bulgu 3 — İSTİHBARAT: oyunun tezi ekranda görünmüyor

**Ne gördüm.** Sekmenin başlığı "İSTİHBARAT · ASKERSİZ SAVAŞ · 0 PUAN". Altında
"ZAFER SKORU · SEZON ÖLÇÜTÜ" ve **üç eşit sütun**: ASKERSİZ ÜSTÜNLÜK 0 ·
ASKERİ KATKI 0 · TOPLAM 0. Sonra yedi kalem tek bir düz liste hâlinde: Sessiz
kese, Yakalanan kese, Karşı-istihbarat, Nüfus defteri (net), İtibar,
Püskürtülen akın, Yarılan savunma. (`ux-1440-istihbarat.png`)

`engine/victory.ts` okunduğunda ilk beşinin `column:"quiet"`, son ikisinin
`column:"martial"` olduğu görülüyor. Ekranda bu ayrımı taşıyan tek şey, satır
başlığının rengi: sessiz kalemler `#3a2f1d`, askerî kalemler `#6d3325`. Bu iki
kahverengi yan yana durmadıkça birbirinden ayırt edilemez — ve zaten yan yana
durmuyorlar, alt alta duruyorlar.

**Niçin sorun.** Bu sekmenin bütün varlık nedeni "**asker olmadan da
kazanılır**" cümlesi. Ekran bunu şu üç şekilde söylemiyor:

1. **Üç eşit sütun**, üç eşit rakam. TOPLAM bir bileşen değil, ikisinin
   toplamıdır — ama görsel olarak üçüncü bir kardeş gibi duruyor. Oyuncu
   "üç ölçütüm var" diye okuyor.
2. **Hangi kalem hangi sütunu besliyor** hiç yazmıyor. Yedi kalem düz bir
   liste. "İtibar" puanının askersiz sütuna yazıldığını oyuncu asla öğrenemez —
   ve bu tam olarak öğrenmesi gereken şey: itibar bir savaş aracı.
3. **Doktrin okuması** — "SESSİZ ÜSTÜNLÜK" / "KILIÇ VE SUR" / "İKİ ELLE" —
   yorumun kalbi ve koyu şeridin sağ ucunda minik bir etiket olarak duruyor.
   Oyuncuya "senin oyun tarzın şu" diyen tek cümle, ekranın en gözden kaçan
   noktasında.

Ayrıca **5'e 2** bir asimetri var: sessiz sütunu besleyen beş kalem, askerî
sütunu besleyen iki kalem. Bu bir tasarım kararı ve iyi bir karar — oyun
gerçekten askersiz yolu ödüllendiriyor. Ama ekran bu asimetriyi hiç
göstermiyor; iki eşit sütun gösteriyor. Yani **oyun tezini savunuyor, arayüz
tezi saklıyor.**

**Sekmenin adı.** "İSTİHBARAT" içeriğin yarısını anlatıyor. Sekmede zafer
skoru, karşı-istihbarat, dış kese ve haydut yönlendirme var — yani "komşuya
YÖNELİK her şey" ve "sezonu nasıl kazanıyorum". Bunların hiçbiri istihbarat
değil; istihbarat (ajan gönderme) **DİYAR** sekmesinde duruyor. Ad ile içerik
birbirini kaçırmış. **ASKERSİZ SAVAŞ** ya da **SESSİZ SAVAŞ** içeriği doğru
anlatır ve sekme şeridindeki en uzun etiketi de kısaltır.

**Yargı.** Sekme kalmalı, adı değişmeli, sütunlar eşitlikten çıkmalı.

---

## Bulgu 4 — DEFTER var olmayı hak etmiyor; gerçek defter DİYAR'ın dibinde

**Ne gördüm.** DEFTER sekmesi (`ux-1440-defter.png`) tam olarak şunları
içeriyor:

- Altı kaynak ve saatlik değişimleri — **üst şeritte aynı anda, her sekmede
  görünen** altı sayının birebir kopyası.
- Devre dışı bir vergi kaydırıcısı ve yanlış bir açıklama (Bulgu 1).
- Altta yaklaşık 230 piksel boşluk.

Aynı zamanda: krallığın gerçek vakayinamesi — `game.notices`, yani "OVA
parseli tahsis edildi", "Krallığınız dış çeperdeki boş parsele kuruldu. Dört
günlük korumanız başladı." — **DİYAR sekmesinin en altında**, ortak maden ve
komşu listesinin arkasında duruyor. (`ux-1440-diyar.png`) Akın kayıtları ise
üçüncü bir yerde, ORDU sekmesindeki `.raid-log` içinde.

**Niçin sorun.** "Defter" bu oyunun en güçlü kelimesi. Ortaçağ bir kâtibin
tuttuğu kayıt demek: **ne oldu, kimin eliyle, ne zaman.** Oyuncu DEFTER'e
girerken tarih bulmayı umuyor; anlık bir bakiye buluyor — hem de zaten
ekranda duran bir bakiye. Bu, oyuncunun günde bir kere baktığı, gece
vardiyasında ne olduğunu öğrenmek istediği kalıcı bir oyunda **en pahalı
kayıp**: "ben yokken ne oldu" sorusunun cevabı hiçbir sekmenin adında yazmıyor.

*Gerçekçilik açısından* daha da kötü: bir hükümdarın defteri bir anlık
görüntü değildir. Bugünkü DEFTER bir muhasebe hücresi tablosu; olması gereken
şey bir kâtibin gün gün yazdığı tutanak.

**Yargı — bu sekme bugünkü hâliyle KALDIRILMALI ve yerine gerçek defter
gelmeli.** İki adım:
1. Altı kaynak satırı silinmeli (üst şeritte var, oradan okunuyor).
2. `game.notices` DİYAR'ın dibinden, akın kayıtları da ORDU'dan buraya
   taşınmalı; sekme **VAKAYİNAME** (ya da adı DEFTER kalarak içeriği tutanak)
   olmalı: günlere ayrılmış, türüne göre işaretlenmiş bir kayıt akışı.

Bu, yedi sekmeyi yediye bırakır ama yedincisini gerçekten gerekli kılar.

---

## Bulgu 5 — HALK: rıza bir gösterge gibi sunuluyor, oysa bir ilişki

**Ne gördüm.** HALK sekmesine girildiğinde ekranın ilk 675 pikselinde şunlar
var, bu sırayla (`ux-1440-halk.png`):

1. Bir talimat paragrafı ("Ferman senin, uygulama Generalin").
2. "HALKIN SESİ · **Sessiz**" — bir yokluk bildirimi ve onu açıklayan bir
   paragraf.
3. Üç kutu: **ÜRETİM ÇARPANI ×1.00** · NÜFUS 100/150 · GÜNLÜK YİYECEK 84.
4. NÜFUS DEFTERİ ve içindeki beş satır.

Rızanın kendisi — sayı 50, durum "Huzursuz" — bu sekmede **yok**. Üst şeritte,
ekranın öbür ucunda, 8 piksellik bir etikette duruyor. Sekmenin kendi
başlığında sağa yapışmış küçük bir "Huzursuz" var.

İstihkak, vergi, asker maaşı ve şenlik kolları — yani oyuncunun bu sekmede
yapabileceği **tek şey** — panelin 1770 pikselinin yaklaşık 1000. pikselinden
sonra başlıyor. Kaydırmadan hiçbiri görünmüyor.

**Niçin sorun.** Bu sekme oyunun kalbi: rıza düşerse muhalefet doğar, ordu
zapt edemez, nüfus göç eder. Ama oyuncu sekmeye girince ilk öğrendiği şey
"**üretim çarpanı ×1.00**" oluyor — bir katsayı. Bu, halkı bir **verimlilik
parametresi** olarak sunmak demek: "insanlarım şu anda ×1.00 verimli". Oyunun
söylemek istediği şey bu değil; oyunun söylemek istediği şey "**halkın huzursuz
ve nedeni şu**".

*Gerçekçilik açısından* fark büyük. Bir hükümdar halkını çarpan olarak
düşünmez; **kimin neye kızgın olduğunu** düşünür. Ekran ise bir hesap
tablosunun satırları gibi duruyor: çarpan, nüfus, ihtiyaç, yerleşen, göç eden,
boş konut, madende çalışan, silah altında. Sekiz sayı ve hiçbirinin yanında
"bu yüzden şunu yapmalısın" yok — o cümleler var ama daha aşağıda, kolların
yanında.

Ayrıca ilk iki blok da **boş durum**: biri talimat, biri "Sessiz". Yani oyuncu
sekmeye girdiğinde ekranın üst üçte biri, hiçbir şey olmadığını anlatmakla
geçiyor.

**Boş durumlar öğretici mi?** "HALKIN SESİ · Sessiz" bloğunun metni aslında
**iyi**: "*Talep ancak bir eşik saatlerce aşılı kalırsa açılır; anlık
dalgalanma masaya gelmez.*" Bu cümle mekaniği öğretiyor, yokluğu bildirmiyor.
Bu doğru yapılmış bir boş durum ve kod tabanının başka yerlerine örnek olmalı.
Sorun metinde değil, **sırada**: öğretici bir boş durum ekranın en tepesinde
duramaz.

**Yargı.** Sekme kalmalı, sırası tersine dönmeli: rıza ve gerekçesi en üste,
kollar hemen altına, defter en alta. Rıza bir sayı olarak değil, **bir cümle
olarak** açılmalı: "Halk huzursuz. Sebep: vergi %15 ve bira yok. Elindeki üç
kol şunlar."

---

## Bulgu 6 — BİNALAR: karar değil katalog

**Ne gördüm.** Kale kartından sonra **17 satır**, hepsi aynı ağırlıkta, hepsinde
aynı "EMİR VER" düğmesi. (`ux-1440-binalar.png`) Her satırın solunda kategori
yazıyor: Ekonomi, Ekonomi, Ekonomi, Yönetim, Askerî, Ekonomi, Ekonomi,
Ekonomi… Kategori sekiz kez tekrar ediyor ama **hiçbir şeyi gruplamıyor.**

Maliyet satırları: "Sonraki emir maliyeti · **wood 148**", "**gold 66 · stone
47**". Oyunun her yerinde ODUN / ALTIN / TAŞ yazan kaynaklar burada İngilizce
motor anahtarlarıyla yazılı.

Kilitli satırlarda maliyet **hiç yok**: "Kale Sv.2 gerekli · Sonraki emir
maliyeti ·" ve arkası boş.

**Niçin sorun.** Oyuncunun bu sekmeye gelme sebebi "sıradaki yapım ne olmalı"
sorusu. Ekran ona 17 eşit seçenek veriyor ve hiçbirini işaretlemiyor: hangisi
şu an karşılanabilir, hangisi ambarı boşaltır, hangisi rızayı kurtarır. Karar
verecek bir Kral değil, bir katalogda gezinen bir müşteri gibi duruyor.

İngilizce maliyet anahtarları küçük bir hata gibi görünüyor ama **gerçekçiliği
doğrudan kırıyor**: parşömen bir defterde "wood 148" yazması, oyuncuya bir an
için motoru gösteriyor.

Kilitli yapıların maliyetsizliği ise **planlamayı imkânsızlaştırıyor**: oyuncu
Pazar'a ne kadar taş gerektiğini Kale Sv.2'ye çıkmadan öğrenemiyor, dolayısıyla
ona doğru biriktiremiyor. Kilit "henüz göremezsin" değil "henüz yapamazsın"
olmalı.

**Yargı.** Sekme kalmalı. Üç değişiklik: kategoriye göre grupla (tekrarlayan
etiketi başlığa çıkar), karşılanabilirliği görünür kıl, kilitli satırlarda
maliyeti göster. Ve maliyetleri Türkçe kaynak adlarıyla yaz — `resourceLabels`
zaten var, `engine/catalog.ts` içindeki tek kaynaktan okunuyor.

---

## Bulgu 7 — ORDU: sıfır ordu için altı panel

**Ne gördüm.** Ne kışlası ne askeri olan bir krallıkta ORDU sekmesi şunları
gösteriyor (`ux-1440-ordu.png`), hepsi sırayla:

1. "Orduyu General yönetir" talimat kutusu.
2. ⚔ "Henüz Kışlanız yok · Kışla kurulması için General'e stratejik gerekçeni
   ilet." — **düğmesi olmayan** bir boş durum.
3. "Mızrakçı **0** · Savunma 16 · Hız 6".
4. "GARNİZON DURUMU · Garnizon yok · Huzursuzluk **0**" ve askerin veto
   hakları üzerine iki cümlelik bir paragraf — **hiç askeri olmayan** bir
   krallıkta.
5. "Nöbet oranı **%60**" — sıfır asker için yüzde altmış — ve iki **devre dışı**
   düğme, niçin devre dışı oldukları yazmıyor.
6. "Püskürtülen 0 · Yarılan 0 · Dağlardan henüz akın gelmedi."

**Niçin sorun.** Altı blok, altı kez "hiçbir şey yok" diyor. Bu, oyuncuya
ordusunun olmadığını öğretmiyor — onu zaten biliyor — **ordusu olduğunda
ekranın nasıl görüneceğini** öğretmeye çalışıyor ve bunu ona ordusu yokken
yapıyor. Sonuç: altı blok gürültü.

İkinci sorun daha ciddi: sekmenin tek çıkış yolu ("kışla kur") **bir cümle
olarak** yazılı ama **tıklanacak bir şey değil.** Kışla düğmesi BİNALAR
sekmesinde duruyor. Boş durum ne yapılacağını söylüyor, yapmanı sağlamıyor.

Üçüncüsü: "%60 nöbet oranı" sıfır asker için anlamsız bir sayı ama canlı bir
ayar gibi duruyor. Oyuncu bunu 60 askerinin %60'ı sanabilir.

**Yargı.** Sekme kalmalı — ordu bu oyunda gerçek bir sistem. Ama boş hâli
**tek bir karta** inmeli: "Kışlanız yok. Ordu yok demek: akın geldiğinde
savunma gücünüz 0, halkı zapt edecek kimse yok. → KIŞLA KUR (odun 170 · taş
140 — ambarınızda var)". Garnizon huzursuzluğu, veto listesi ve nöbet oranı
ilk asker eğitilene kadar hiç çizilmemeli.

---

## Bulgu 8 — DİYAR çalışıyor, ama iki yükü fazla taşıyor

**Ne gördüm.** DİYAR (`ux-1440-diyar.png`): başkent arazisi kartı, Channel
kıyası, ortak maden, komşu sancak listesi ve **en altta vakayiname kayıtları**.

**İyi olan.** Channel kıyasının boş durumu bu kod tabanının en iyi yazılmış
boş metni: "*Kıyas için yeterli sancak yok: ortalama en az 3 sancaktan
hesaplanır. Daha azında 'ortalama' tek bir komşunun defterini olduğu gibi ele
verirdi.*" Bu, yokluğu bildirmiyor — **bir tasarım kararını gerekçesiyle
öğretiyor.** Oyuncu buradan gizlilik alt sınırı diye bir şey olduğunu ve
niçin olduğunu öğreniyor. Bu metin standart olmalı.

Ortak maden bloğu da doğru bilgiyi veriyor ("Madencilik halkın içinden çıkar:
nüfusunuzun en fazla %20'si… Madendeki her el tarlada eksiktir") — bu cümle
gerçekçilik açısından mükemmel, bir kaynağı bir insan maliyetine bağlıyor.

**Sorun.** İki şey burada olmamalı:
- **Vakayiname** (Bulgu 4) — DEFTER'e.
- **Ajan gönderme** düğmeleri. "İSTİHBARAT" adlı bir sekme varken casus
  göndermek DİYAR'da duruyor. Karşı-istihbarat İSTİHBARAT'ta, istihbaratın
  kendisi DİYAR'da. Bu ikisi aynı sekmede olmalı.

Ayrıca "10 İŞÇİ GÖNDER" düğmesi **bedelini taşımıyor**: bedel (nüfusunun
%10'u tarladan çekilecek) düğmenin üstündeki iki küçük paragrafta yazılı.
Düğme kararın kendisi; bedeli düğmede olmalı.

**Yargı.** Sekme kalmalı. Vakayinameyi ve ajan gönderimini devret, maden
düğmesine bedelini yaz.

---

## Bulgu 9 — Pazar navigasyonun dışında

**Ne gördüm.** Kaynağı altına çeviren **tek** yer — Pazar — yedi sekmenin
hiçbirinde değil. Haritanın sol alt köşesinde, "⚖ PAZAR" yazan yüzen bir
yaprak. Yanında ikinci bir yaprak: "⚑ MÜZAKERE". (`ux-pazar.png`,
`ux-muzakere.png`)

Pazar kurulmamışken yaprağın içeriği tek satır: "*Pazarımız yok; hiçbir kaynak
altına çevrilemez. Kale Sv.2'de Pazar kurulabilir.*"

**Niçin sorun.** Ekonominin en önemli kolu ve diplomasinin tamamı, sekme
şeridinde adı geçmeyen iki köşe düğmesinde. Oyuncu yedi sekmeyi gezip
"ekonomimi nasıl paraya çeviriyorum?" sorusuna cevap bulamıyor, çünkü cevap
sekmelerde değil. Bu, gerçek yüzey sayısını dokuza çıkarıyor ve dokuzun ikisi
görünmez.

**Bundan emin değilim.** Bunun bilinçli bir tasarım olma ihtimali var:
Pazar ve Müzakere haritanın üstünde durarak "dünyaya bakan" işler olduklarını
söylüyor olabilir; ayrıca sekme şeridi yedide zaten sıkışmış durumda
(İSTİHBARAT düğmesinin yazısı diğerlerinden küçültülmüş). Yine de en azından
sekme şeridinde ya da MECLİS'te bir işaret olmalı: oyuncu bu iki yaprağı
tesadüfen bulmamalı.

---

## Bulgu 10 — Kuruluş: "General sessizken başla" bir tuzak kapısı

**Ne gördüm.** Kuruluşun III. adımında üç düğme yan yana duruyor
(`70-adim-4.png`): **GERİ** · **GENERAL SESSİZKEN BAŞLA** · **GENERALİ BAĞLA VE
TAHTA ÇIK**. Ortadaki düğme, GERİ ile birebir aynı biçimde (aynı çerçeve, aynı
punto, aynı renk) duruyor — yani ikincil bir kaçış yolu gibi.

**Niçin sorun.** Bu düğmeye basan oyuncu, **oyunun ana etkileşimi kapalı** bir
oyuna giriyor: MECLİS sekmesi boş bir oda oluyor (Bulgu 2), yapı kurmak,
asker eğitmek, ajan göndermek — General'in yetkisindeki her şey — çalışmıyor.
Ekran bunu söylemiyor. "Sessizken" kelimesi geçici bir sessizlik ima ediyor,
oysa kapalı olan şey oyunun yarısı.

Aynı ekranda ikinci bir sorun: kart oyuncuya **niçin** bir API anahtarı
istendiğini söylemeden önce **nasıl şifrelendiğini** anlatıyor ("AES-GCM ile
şifreli kaydedilir"). Güvenlik doğru bir detay ama oyuncunun o anda sorduğu
soru bu değil; sorduğu soru "bu anahtar bana ne kazandırıyor, bana kaça mal
olur". İkisinin de cevabı ekranda yok.

**Yargı.** Düğme kalmalı — anahtarı olmayan oyuncuya kapı kapatılmamalı — ama
**bedeli düğmenin yanında yazmalı**: "General olmadan Meclis toplanmaz; yapı,
asker ve ajan emirleri çalışmaz. Vergi ve istihkakları çevirmeye devam
edebilirsin. Anahtarı sonradan bağlayabilirsin." Ve III. adım şu sırayla
konuşmalı: General ne yapar → bu yüzden anahtar gerekir → anahtar şöyle
korunur.

---

## Bulgu 11 — Arazi seçimi kalıcı, açıklaması yedi punto

**Ne gördüm.** Kuruluşun II. adımında dört arazi kartı (`70-adim-3.png`).
Başlığın altında: "*Başlangıç arazisi — görünüşü ve üretimi kalıcı olarak
değiştirir*". Kartların içindeki bonuslar çok küçük: "+%25 odun · +%16 savunma
· yavaş hareket", "+%30 taş/demir · +%25 savunma · çok yavaş hareket".

**Niçin sorun.** Bu, oyuncunun 84 günlük bir sezonda geri alamayacağı ilk ve
tek kalıcı seçimi — ve karar üç kısaltılmış istatistikle veriliyor. Dahası
"**yavaş hareket**" hiç açıklanmıyor: neyin hareketi? Ordunun mu, elçinin mi,
tüccarın mı? Oyuncu daha oyunu görmeden, ne olduğunu bilmediği bir mekanikte
kalıcı bir ceza kabul ediyor.

**Yargı.** Kartlar aynı kalabilir, ama seçilen arazinin altındaki detay
şeridi bir **cümle** söylemeli, üç kısaltma değil: "Dağ: taş ve demir bol,
surun daha güçlü, ama askerin ve elçinin yola çıkışı yavaş — savunmacı bir
sezon." Bir de "hareket"in neyi etkilediği bir kez yazılmalı.

---

## Sekmeler arası anlatı akışı

Bugünkü sıra: MECLİS · BİNALAR · HALK · ORDU · İSTİHBARAT · DEFTER · DİYAR.

Oyuncunun günlük döngüsü aslında şu: **(1) ben yokken ne oldu → (2) halkım ne
hâlde → (3) ne inşa/eğit edeceğim → (4) dışarıda ne var → (5) Generale ne
söyleyeceğim.** Yani oyuncu doğal olarak *vakayinameyle başlar, meclisle
biter.* Bugünkü şerit tam tersini öneriyor: meclisle başlıyor (ve meclis boş),
vakayiname ise hiçbir yerde adı geçmeyen bir yerde (DİYAR'ın dibinde) duruyor.

MECLİS'in birinci sırada olması yine de savunulabilir — orası oyunun kimliği
ve ilk açılan sekme olması doğru. Ama o zaman MECLİS'in kendisi "ben yokken ne
oldu" sorusuna cevap vermeli: gündemi, gece vardiyasının özetini ve halkın
araya giren sesini taşımalı. Bugün taşımıyor; bomboş.

**Öneri sıra:** MECLİS (gündemli) · HALK · BİNALAR · ORDU · DİYAR ·
ASKERSİZ SAVAŞ · VAKAYİNAME. İçe bakan sekmeler solda, dışa bakanlar sağda,
kayıt en sonda.

---

## Gezerken karşılaştığım gerçek bozukluklar

Bunlar tasarım yargısı değil, gördüğüm somut kusurlar:

1. **Kilitli yapı satırlarında maliyet boş basılıyor.** "Sonraki emir maliyeti
   ·" ve arkasında hiçbir şey yok (Değirmen, Pazar, Sur, Bira Evi, Evlilik
   Dairesi, Tiyatro satırları). `buildOptions(game)` kilitli yapıyı
   döndürmediği için `cost` boş nesne kalıyor; JSX yine de etiketi basıyor.
   Ekran görüntüsü: `ux-1440-binalar.png`.
2. **Maliyetler İngilizce motor anahtarlarıyla yazılı** ("wood 148", "gold 66 ·
   stone 47") — arayüzün geri kalanı Türkçe. `resourceLabels` mevcut ve
   kullanılmıyor.
3. **`.rotate-toggle` ile sahne başlığının eyebrow'u sıfır boşlukla yan yana.**
   Ölçtüm: düğmenin sağ kenarı 143px, "YENİ BAŞKENT · OVA" metninin sol kenarı
   143px. **Üst üste binme YOK** — ama aralarında hiç boşluk da yok, ekran
   görüntüsünde çakışma gibi okunuyor (`ux-1440-meclis.png`).
4. **General bağlı değilken Meclis yazı kutusu açık.** Oyuncu emir yazıp
   gönderebiliyor; cevap ancak gönderdikten sonra geliyor ve teknik bir dille
   ("BYOK bağlantısı") geliyor.
5. **Konsol temiz.** Yedi sekmeyi gezerken hiç JS hatası, 4xx/5xx isteği ya da
   kırık düzen görülmedi. 1280×800 ve 1024×768'te yatay taşma yok; konsey
   paneli 388px sabit kalıyor ve sahne daralıyor (1024'te 3B sahne 614px'e
   iniyor). Bu iyi haber.

---

## Mockup'lar

Bu değerlendirmeye dayanan alternatif tasarımlar ayrı bir sayfada yayımlandı;
dört sekme için "bugün böyle / önerim böyle" karşılaştırması içerir:
**MECLİS**, **HALK**, **ASKERSİZ SAVAŞ** (bugünkü İSTİHBARAT) ve
**VAKAYİNAME** (bugünkü DEFTER'in yerine).

**Yayımlanan taslak sayfası:**
<https://claude.ai/code/artifact/7a9e93c5-a065-4e10-9c15-2120c7df02f6>

Kaynak dosya: `docs/plans/sekme-taslaklari.html` (yalnız-okunur tasarım
gösterimi; oyunun bileşen kodu DEĞİL). Taslakların içi oyunun kendi paletiyle
(`app/game.css`, `app/globals.css`) ve konsey panelinin gerçek genişliğinde
(392 px) çizildi — asıl kısıt bu, her karar o sütuna sığmak zorunda.

Seçim gerekçesi: MECLİS oyunun kalbi ve en boş ekran; HALK oyunun kalbi ve
sırası ters; İSTİHBARAT oyunun tezini taşıyor ve tezi saklıyor; DEFTER var
olmayı hak etmeyen tek sekme. BİNALAR ve ORDU'nun sorunları gerçek ama
düzeltmeleri daha küçük ve mekaniği değiştirmiyor.
