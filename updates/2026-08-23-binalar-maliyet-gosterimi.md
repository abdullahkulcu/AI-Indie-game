# BİNALAR sekmesinde maliyet gösterimi: kilitli yapıda boş satır ve İngilizce anahtarlar

Tarih: 2026-08-23

## Ne değişti

`components/KingdomGame.tsx`'in BİNALAR bloğunda iki hata düzeltildi.
(1) Kilitli yapıların maliyeti artık basılıyor: `buildOptions` bilinçli olarak
yalnızca şimdi emredilebilen yapıları döndürdüğü için arayüz `?? {}` ile
yedekliyor ve "Sonraki emir maliyeti ·" yazıp arkasını boş bırakıyordu; yedek
hesap artık `buildOptions`ın kullandığı AYNI `costFor` fonksiyonuyla yapılıyor.
(2) Maliyet kalemleri motorun İngilizce anahtarı yerine (`wood 148`) Türkçe
etiketle basılıyor (`odun 148`) — `resourceLabels` bu dosyada zaten import
ediliyordu ve başka üç yerde kullanılıyordu.

## Neden

İkisi de canlı tarayıcıda görüldü. Boş maliyet satırı bir kozmetik kusur değil
bilgi kaybı: Pazar, Sur, Değirmen, Bira Evi, Evlilik Dairesi ve Tiyatro
kilitliyken oyuncu o yapı için NE biriktireceğini oyunun hiçbir yerinden
öğrenemiyordu — oysa Sur 500 taş istiyor, yani günler önceden planlanması
gereken bir hedef. İngilizce anahtarlar ise arayüzün geri kalanı tamamen
Türkçeyken tek başına duran bir tutarsızlıktı.

Yedek maliyet elle yeniden hesaplanmadı, `costFor` çağrıldı: maliyet formülü
bu kod tabanında bir zamanlar dört ayrı yerde elle yazılıydı ve tek kaynağa
indirilmesi gerekti (CLAUDE.md kısıt #5). Arayüz kendi çarpanını kurmuyor.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- tests/binalar-maliyet.test.ts (yeni)
- package.json (test listesi)

## Test durumu

- `npx tsc --noEmit` temiz.
- `npm test` 604/604 geçiyor (601 + 3 yeni).
- `npm run lint` 0 hata (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı
  önceden var).
- Gerçek tarayıcıda (Playwright + Chromium, çalışan dev sunucusu) BİNALAR
  sekmesinin 16 satırı okundu: boş maliyet satırı 0, İngilizce anahtar 0,
  `pageerror` yok. Kilitli satırlar artık maliyet gösteriyor
  (örn. Sur → "taş 500 · odun 100").
- Yeni test MUTASYONLA sınandı: iki düzeltme kasten geri alındığında ilgili
  iki iddia kırıldı (3 testten 2'si), düzeltme geri konduğunda üçü de geçti.
  Yani test gerçekten bu iki hatayı yakalıyor.

## Takip gereken işler

Aynı denetim turunda bulunan ve DAHA CİDDİ olan bir sorun bu değişikliğin
dışında bırakıldı: **verginin kimin elinde olduğu arayüzde dört ayrı şekilde
anlatılıyor.** Gerçek davranış "Kral doğrudan çevirir" (HALK sekmesindeki
−5/+5 düğmeleri çalışıyor), ama DEFTER'de kaydırıcı devre dışı ve "General'i
ikna etmelisin" diyor, Rehber IV. adım "vergiyi düğmeyle değiştirmezsin"
diyor, ve "Generalin yetkileri" kartı "Vergi ayarla"yı yetki listesine
koyarken hemen altında "Kral doğrudan çevirir" yazıyor — aynı kart kendisiyle
çelişiyor. Bu, kuralın tek kaynaktan okunmayıp altı yere elle yazılmasının
sonucu. Düzeltilmedi çünkü dokunacağı satırlar şu anda paralel çalışan bir
agent'ın (HALK/rıza kapsamı) elinde; o iş inince tek geçişte ele alınmalı.
