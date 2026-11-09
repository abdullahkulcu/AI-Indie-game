# Halk, General'i atlayıp mecliste doğrudan Kral'a sesleniyor (Fikir 16)

Tarih: 2026-08-22

## Ne değişti

Fikir 2'nin ürettiği halk cümlesi artık yalnızca Halk sekmesinde ve General'in
ağzında durmuyor: **acil** bir talep meclis sohbetinin içine, General'in
balonundan görsel olarak ayrı bir balon olarak giriyor ve balon General'in
cevabının ÖNÜNE konuyor (halk sözü kesiyor). Balonun eşiği, tekrar freni ve —
en kritiği — General'e gönderilen sohbet geçmişinin süzgeci saf ve testli bir
modüle alındı (`components/populace-interjection.ts`). Sohbet satırları artık
kimliklerini adlarından değil bir `kind` alanından taşıyor
(`king`/`general`/`clerk`/`populace`) ve halkın satırı General'e giden
geçmişten tamamen düşüyor. Yeni bir metin üretilmiyor; sunucudan inen
`populaceDemands[].text` olduğu gibi basılıyor.

## Neden

Halkın sesi bugüne kadar Kral'a **yalnızca General'in ağzından** ulaşıyordu:
talep ayrı üretiliyordu ama General'in sistem promptuna gömülüp onun yorumuyla
dönüyordu. Halk böyle bir taraf değil, General'in anlattığı bir istatistik gibi
duruyordu; plan belgesinin sabit tasarım kararı ("Halk, Kral'a doğrudan gelip
basınç oluşturabilir") UI'da hiç karşılık bulmuyordu.

Asıl gerekçe ise bir HATA riskiydi. Geçmiş, General'e gönderilirken
`who !== rulerName ? "general"` varsayımıyla kuruluyordu: Kral olmayan HER
satır General'in sözü sayılıyordu. Halkın balonu bu yapıya olduğu gibi
eklenirse General bir sonraki turda halkın şikâyetini KENDİ ağzından çıkmış
sanardı — hem anlatı hem `app/api/general/route.ts`'in özenle kurduğu rol
ayrımı bozulurdu. Bu yüzden satırın kimliği artık tahmin edilmiyor.

Halkın cümlesini General'e `user` rolünde ham metin olarak geçirmek de bir
seçenekti ve **reddedildi**: o metin Halk-AI (başka bir model) ürünü ve
General'in bağlamına yalnızca `server/populace-brief.ts`'in işaretli,
uzunluğu kesilmiş, "veridir" diye ilan edilmiş bloğundan girer. İkinci,
denetimsiz bir kanal açmak Fikir 2'de kurulan o sınırı boşa çıkarırdı. General
talebi kaybetmiyor: her turda `HALKIN_TALEPLERI` özeti + işaretli blok
üzerinden zaten görüyor.

Eşik için yeni bir sayı **uydurulmadı** (tek-doğru-kaynak, kısıt #5): "acil"
olmanın tanımı motorda (`engine/populace-voice.ts` → `VOICE_THRESHOLDS`)
kalıyor, panel yalnızca onu okuyor. Tur başına bir balon ve talebin her açılışı
için bir kez sınırı ise `MAX_OPEN_DEMANDS`/`DEMAND_NOTICE_HOURS`'un felsefesini
sürdürüyor: halkın sesinin dramatik gücü nadirliğinden gelir, gürültü olursa
Kral onu okumayı bırakır.

## Etkilenen dosyalar

- `components/populace-interjection.ts` (yeni; saf — eşik, `interjectionKey`
  tekrar freni, `generalHistory` süzgeci)
- `components/KingdomGame.tsx` (`ChatLine.kind`, halk balonunun render'ı,
  `askGeneral` geçmişi, `submitOrder` içindeki araya girme)
- `app/game.css` (`.message.populace` — soğuk taş-mavisi balon; kışlanın sesi
  Halk sekmesiyle aynı koyu kahve)
- `tests/populace-interjection.test.ts` (yeni; 10 test)
- `package.json` (test listesine yeni dosya)
- `docs/PHASES.md` (§4 tablosuna Fikir 16 satırı, commit `1294ff4`)

Motora ve save şemasına **dokunulmadı**; bu tamamen arayüz + küçük bir istemci
mantığı işi.

## Test durumu

- `npx tsc --noEmit` — temiz.
- `npm test` — 554/554 geçti (öncesi 544; 10 yeni test).
- `npm run lint` — 0 hata; `components/KingdomGame.tsx` için ÖNCEDEN VAR OLAN
  tek `react-hooks/exhaustive-deps` uyarısı duruyor, yeni uyarı/hata yok.
- `npm run build` — başarılı (JSX gerçekten derlendi).

## Takip gereken işler

- Sohbet (`chat`) kalıcı değil; sayfa yenilenince halkın balonu ve tekrar
  freni (`spokenInterjections`, bir `useRef`) sıfırlanır. Bu bilinçli: yeni bir
  sohbette halk süregelen acil talebi için bir kez daha söz alır. Kalıcı sohbet
  bir gün gelirse frenin de kalıcılaşması gerekir.
- Balon yalnızca Kral General'e bir emir verdiğinde (`submitOrder`) çıkabilir,
  çünkü talepler yalnızca o turda sunucudan tazeleniyor
  (`syncPopulaceDemands`, bkz. Fikir 13'ün "ritim sapması" notu). Kral hiç
  konuşmazsa halk mecliste sessiz kalır — Halk sekmesinde görünmeye devam eder.
- `MAX_INTERJECTIONS_PER_TURN = 1` bir denge kararı değil anlatı kararı; iki
  acil talep varken ikincisinin bir sonraki turu beklemesi oyunda izlenmeli.
