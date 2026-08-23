# Halkın sesi General'e bağlı olmaktan çıktı

Tarih: 2026-08-23

## Ne değişti

Halkın talep defteri artık kendi turunda eşitleniyor ve arayüz onu General'e
dokunmadan okuyabiliyor. Üç parça:

1. **`engine/populace-voice.ts` → `voiceSignalsOf`** (yeni, SAF): halkın sesi
   için gereken sinyalleri bir krallık kaydından türetir. Motor katmanında
   duruyor çünkü hiçbir yan etkisi yok.
2. **`server/populace-round.ts` → `refreshPopulaceVoice`** (yeni): aktif
   channel'ların aktif üyeleri için defteri eşitler. `app/api/cron` içine
   sarılı bir tur olarak bağlandı. **MODEL ÇAĞIRMAZ**, sıfır token harcar.
3. **`GET /api/world` → `populaceDemands`**: açık talepler salt okunur olarak
   iniyor (`loadOpenDemands`, yeni). Arayüz dünya yoklamasında bunu okuyor.

## Neden

Talepler bugüne kadar YALNIZCA `app/api/general` içinden eşitleniyordu ve
istemciye de yalnızca o cevapla ulaşıyordu. İki sonucu vardı; ikincisi ağır:

1. Kral uzun süre konuşmazsa halk susuyordu.
2. **General'i HİÇ bağlamayan Kral halkın sesini HİÇ duymuyordu.** Kuruluş
   akışı "GENERAL SESSİZKEN BAŞLA" seçeneğini açıkça sunuyor, yani bu istisnai
   bir durum değil desteklenen bir oyun biçimi — ve o biçimde oyunun kalbi olan
   halk tamamen görünmezdi. HALK sekmesi sonsuza kadar "Sessiz" diyordu.

Plan belgesindeki karar da "kıyaslama saatlik cron turunda yenilenir" diyordu.
Ben bunu daha önce bilinçli olarak talep senkronunun ritmine bağlamış ve sapmayı
belgelemiştim; gerekçelerimden ikisi hâlâ geçerli (maliyet, tek ritim) ama
üçüncüsü yanlış çıktı: "diğer tüm talepler de yalnızca Kral konuşurken açılıyor"
demek, General'siz oyuncunun hiç talep görmediğini kabul etmek demekti. Tur o
kararın gereği.

## Neden model çağrılmıyor

Saatlik bir tur her oyuncu için model çağırsa fatura oyuncu sayısıyla çarpılırdı
("değirmen dersi"nin maliyet tarafı). Bu turda talepler motorun deterministik
şablon cümlesiyle açılıyor. Halk-AI'nın kendi sesi Kral'ın turunda devreye
girmeye devam ediyor — orada anlatıcı veriliyor ve cümle modelden geliyor.

## İki yolun aynı sayıyı üretmesi

Sinyaller iki yerden doğuyor artık: istemcinin gönderdiği bağlam ve sunucunun
kayıttan türetmesi. **Farklı sayı üretirlerse aynı krallık için talep bir yolda
açılıp ötekinde açılmaz.** Bu yüzden `voiceSignalsOf` istemci bağlamının
kullandığı formülleri ve YUVARLAMALARI birebir taklit ediyor
(`servedRations(g)`, `factionPressureOf(g)`, geçim endeksi, `Math.round`). Bir
test bunu iddia ediyor.

## Etkilenen dosyalar

- engine/populace-voice.ts (`voiceSignalsOf` — saf)
- server/populace-round.ts (yeni: `refreshPopulaceVoice`)
- server/populace-voice.ts (`loadOpenDemands` — salt okuma)
- app/api/cron/route.ts (sarılı tur + rapor alanı)
- app/api/world/route.ts (`populaceDemands`)
- components/KingdomGame.tsx (dünya yoklamasından okuma)
- tests/halk-sesi-turu.test.ts (yeni)
- package.json (test listesi)

Motorun karar mantığına, save şemasına ve `populace_demands` tablosunun şekline
DOKUNULMADI.

## Test durumu

- `npx tsc --noEmit` temiz · `npm test` 715/715 · `npm run lint` 0 hata
  (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var) ·
  `npm run build` başarılı.
- MUTASYON: tura anlatıcı verdiğimde, dünya ucuna eşitleme koyduğumda ve
  yuvarlamayı bozduğumda testler kırılıyor. Yuvarlama mutasyonu İLK DENEMEDE
  YAKALANMADI — test senaryomda değer tesadüfen tam sayıydı. Kısmi doyum
  senaryosu hesaplanarak seçildi (ambarda 1 yiyecek → fiilî pay %23,81) ve
  senaryonun gerçekten kesirli değer ürettiğini doğrulayan bir koruma da
  eklendi, yoksa iddia yine boşa dönerdi.
- CANLI DOĞRULAMA (çalışan sunucu + gerçek Postgres + Chromium), BYOK anahtarı
  OLMAYAN oyuncuyla: halk kızdırıldı (istihkak %35, vergi %45, rıza 18) ve cron
  tetiklendi. Tur iki talep adayı açtı, `llmCalls: 0`. Süre şartı henüz
  dolmadığı için talepler KAPALI kaldı (doğru davranış). Koşul 24 saat
  öncesinden beri sürüyor sayılınca tur ikisini de açtı (`spoke: 1`, yine
  `llmCalls: 0`), `GET /api/world` ikisini taşıdı ve HALK sekmesi
  **"2 açık talep"** gösterdi — General'e hiç dokunulmadan. Test verisi geri
  alındı.

## Takip gereken işler

Fikir 16'nın meclis balonu (halkın Kral'ın sözünü kesmesi) General'siz oyunda
devreye girmiyor, çünkü balon sohbet turunun içine ekleniyor ve sohbet yok.
Bu tutarlı bir davranış — kesilecek bir konuşma yok — ama halkın acil sesinin
General'siz oyuncuya nasıl ulaşacağı ayrı bir tasarım kararı.
