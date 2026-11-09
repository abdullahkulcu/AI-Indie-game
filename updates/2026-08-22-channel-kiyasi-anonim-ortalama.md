# Channel kıyası: anonim ortalama paneli (Fikir 1)

Tarih: 2026-08-22

## Ne değişti

"Diyar" sekmesine, Kralın dört ölçütünü (rıza, yiyecek istihkakı, vergi oranı,
muhalefet baskısı) channel'daki diğer sancakların ANONİM ortalamasıyla yan yana
gösteren bir panel eklendi. Ortalama `server/world-projection.ts` içindeki yeni
`channelAverages` fonksiyonunda hesaplanıyor; `GET /api/world`'ün zaten okuduğu
kayıtlar üzerinde çalışıyor, yani ikinci bir DB turu yok ve hiçbir AI çağrısı
yok. Ölçüt listesi, her ölçütte "iyi" olan yön (yüksek rıza iyi, yüksek vergi
KÖTÜ) ve gizlilik alt sınırı motorda tek kaynak olarak yaşıyor
(`engine/comparison.ts`). Kuruluş koruması süren krallıklar ve Kralın kendisi
ortalamaya girmiyor; uygun aday sayısı 3'ün altındaysa sunucu sayı üretmiyor,
panel de gerekçesini yazıyor.

## Neden

Kral bugüne kadar kendi krallığının durumunu ölçebileceği hiçbir dış referansa
sahip değildi: 40 rıza felaket mi, yoksa bu channel'da olağan mı belli
olmuyordu. Bu, `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`
belgesindeki Fikir 1'in kararlaştırılmış hâli ve "halkın diğer krallıklarla
kıyaslaması" vizyonunun AI'sız, en ucuz ilk adımı: kıyaslama VERİSİ önce var
olmalı ki üstüne bir talep ya da bir AI cümlesi oturabilsin.

Üç sınır bilinçli olarak veri katmanına çizildi, arayüze bırakılmadı:

- **Kimlik sızmaz.** İstemciye yalnızca ortalama iner; hangi değerin kime ait
  olduğu hiç gönderilmez (`server/world-projection.ts`'in geri kalanındaki
  "alanları tek tek yaz" disiplininin aynısı).
- **Koruma altındaki krallık sayılmaz.** Dış kese ve göç sistemleri de aynı
  krallıkları hariç tutuyor; kural üçüncü kez elle yazılmasın diye aynı
  gerekçeyle uygulandı.
- **Küçük channel sızıntısına karşı alt sınır.** Plan belgesi bu riski açıkça
  not ediyordu: iki sancağın "ortalaması", kendi değerini bilen bir Kral için
  rakibin değerini birebir çözer. `COMPARE_MIN_SAMPLE = 3` altında sunucu sayı
  ÜRETMEZ — arayüzü karartmak yeterli olmazdı, çünkü sayı yine istemciye
  inerdi.

Agregasyon `server/world-projection.ts`'e konuldu çünkü o dosya zaten "başka
bir krallığın dışarıdan görünen yüzü"nün tek karar noktası. Ölçüt sözlüğü ise
motora alındı: plan belgesinin kararına göre Fikir 13 (sessiz kıyaslama) ve
Fikir 24 (channel pazar endeksi) bu ortalamayı PAYLAŞACAK, yani hesap ve yön
tanımı baştan yeniden kullanılabilir yazıldı.

## Etkilenen dosyalar

- engine/comparison.ts (yeni: ölçüt listesi, "iyi" yönü, `compareValuesOf`, `compareVerdict`, `COMPARE_MIN_SAMPLE`)
- server/world-projection.ts (`channelAverages`, `ChannelAverages`)
- app/api/world/route.ts (`GET` yanıtına `compare` alanı)
- components/KingdomGame.tsx (diyar sekmesindeki kıyas paneli, `channelCompare` durumu)
- app/game.css (`.channel-compare` ve kıyas ızgarası; `tabular-nums`)
- tests/channel-averages.test.ts (yeni, 8 test)
- package.json (`test` betiğine yeni dosya eklendi)
- docs/PHASES.md (§4 "Canlı Dünya ve Halk AI" dizisi açıldı)

## Test durumu

- `npx tsc --noEmit` → temiz.
- `npm test` → 491 test, 491 geçti (önceki 483 + yeni 8).
- `npm run lint` → 0 hata, 1 uyarı (`components/KingdomGame.tsx` içindeki
  ÖNCEDEN VAR OLAN `react-hooks/exhaustive-deps` uyarısı; bu değişiklikle
  ilgisi yok).
- `npm run build` → başarılı (panelin JSX'i gerçekten derleniyor).
- `npm run test:site` çalıştırılmadı: bu daldaki iki testi
  (`tests/rendered-html.test.mjs`) bu değişiklikten ÖNCE de başarısız —
  `app/_sites-preview/SkeletonPreview.tsx` ve `codex-preview` meta etiketi bu
  dalda yok.

## Takip gereken işler

- Fikir 13 (sessiz kıyaslama) ve Fikir 24 (pazar endeksi) uygulanırken
  `channelAverages` ÇAĞRILMALI, ikinci bir ortalama hesabı yazılmamalı. Fikir
  13'ün kararı "saatlik cron turunda" diyor; o iş `app/api/cron/route.ts`'te
  bu fonksiyonu çağıracak.
- Ortalama şu an her `/api/world` isteğinde (10 saniyede bir) yeniden
  hesaplanıyor. Kayıtlar zaten okunduğu için maliyeti yalnızca `parseStoredSave`
  ayrıştırması; channel çok büyürse bir önbellek gerekebilir, bugün gerekmiyor.
