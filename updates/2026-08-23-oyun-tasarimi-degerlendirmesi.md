# Oyun tasarımı değerlendirmesi ve sekme taslakları

Tarih: 2026-08-23

## Ne değişti

Kod DEĞİŞMEDİ. Canlı oyun (127.0.0.1:3001) Playwright + Chromium ile gerçek
tarayıcıda gezildi; yedi sekme, kuruluş akışı, Pazar/Müzakere yaprakları ve
Rehber turu oyun tasarımı gözüyle incelendi. İki yeni belge eklendi:
`docs/plans/2026-08-23-oyun-tasarimi-degerlendirmesi.md` (sekme sekme yargı,
11 bulgu) ve `docs/plans/sekme-taslaklari.html` (dört sekme için "bugün böyle /
önerim böyle" karşılaştırmalı tasarım taslakları; Artifact olarak yayımlandı:
<https://claude.ai/code/artifact/7a9e93c5-a065-4e10-9c15-2120c7df02f6>).

## Neden

Arayüz yedi sekmeye çıktı ve son eklenen İSTİHBARAT sekmesi oyunun tezini
("asker olmadan da kazanılır") taşıyor. Bu tezin ekranda gerçekten okunup
okunmadığı, ve genel olarak oyuncunun her sekmeden "ne yapacağını bilerek"
çıkıp çıkmadığı ölçülmemişti. Denetim, düzeltmeden ÖNCE yapıldı: KingdomGame.tsx
ve game.css o sırada iki başka çalışmanın elindeydi, bu yüzden bilinçli olarak
hiçbir kod dosyasına dokunulmadı — bulgular uygulanmaya hazır tasarım kararları
olarak belgelendi.

En ciddi bulgu tek bir metin hatası değil: **vergiyi kimin çevirdiği sorusuna
oyun aynı anda dört farklı cevap veriyor** (HALK'ta çalışan −5/+5 düğmeleri,
DEFTER'de "General'i ikna etmelisin" diyen kilitli kaydırıcı, Rehber IV. adım,
ve kendisiyle çelişen "Generalin yetkileri" kartı). Bu, oyunun kendini nasıl
tanıttığıyla ilgili; oyuncu ilk saatinde en sık kullanacağı kolun kime ait
olduğunu öğrenemiyor.

## Etkilenen dosyalar

- docs/plans/2026-08-23-oyun-tasarimi-degerlendirmesi.md (yeni)
- docs/plans/sekme-taslaklari.html (yeni)

Kod dosyası değişmedi.

## Test durumu

tsc/lint/test çalıştırılmadı — kod değişikliği yok, iki belge eklendi.
Taslak sayfası Chromium'da hem açık hem koyu temada denendi: JS hatası yok,
yatay taşma yok, `scrollWidth == innerWidth` (1240 px).

Canlı oyun denetiminin ölçüm sonuçları: yedi sekme gezilirken konsolda hata,
4xx/5xx istek ya da kırık düzen görülmedi; 1440×950, 1280×800 ve 1024×768'te
yatay taşma yok.

## Takip gereken işler

Kod tarafında uygulanmayı bekleyen somut kusurlar (hepsi
`components/KingdomGame.tsx`):

1. **Vergi anlatısının tek kaynağa çekilmesi.** DEFTER'in kilitli kaydırıcısı,
   Rehber IV. adım metni ve "Generalin yetkileri" kartındaki "Vergi ayarla"
   maddesi, kodun gerçek davranışıyla (HALK'taki `setPolicy`) çelişiyor.
2. **Kilitli yapı satırlarında maliyet boş basılıyor.** `buildOptions(game)`
   kilitli yapıyı döndürmediği için `cost` boş nesne kalıyor ama JSX
   "Sonraki emir maliyeti ·" etiketini yine basıyor (Değirmen, Pazar, Sur,
   Bira Evi, Evlilik Dairesi, Tiyatro). Oyuncu Kale Sv.2'ye çıkmadan Pazar'ın
   kaça kurulduğunu öğrenemiyor, dolayısıyla ona biriktiremiyor.
3. **Yapı maliyetleri İngilizce motor anahtarlarıyla yazılı** ("wood 148",
   "gold 66 · stone 47"); arayüzün geri kalanı Türkçe. `resourceLabels` mevcut
   ve bu satırda kullanılmıyor.
4. **General bağlı değilken Meclis yazı kutusu açık kalıyor.** Oyuncu emir
   yazıp gönderebiliyor; uyarı ancak gönderdikten sonra ve teknik bir dille
   ("BYOK bağlantısı") geliyor.
5. **`.rotate-toggle` ile sahne başlığının eyebrow'u sıfır boşlukla yan yana.**
   Ölçüldü: düğmenin sağ kenarı 143 px, "YENİ BAŞKENT · OVA" metninin sol
   kenarı 143 px. Üst üste binme yok ama araya boşluk da yok.

Tasarım tarafında bekleyen kararlar taslak sayfasında görselleştirildi:
MECLİS'e gündem, HALK'a rıza manşeti, zafer skoruna 5'e 2 terazi, DEFTER'in
yerine gerçek vakayiname, ve sekme şeridinin sırası/adları.
