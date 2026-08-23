# İlan edilen pay ile fiilen verilen arasındaki makas (Fikir 14)

Tarih: 2026-08-23

## Ne değişti

Halkın sesine yeni bir talep türü eklendi: `vaat`. Kralın İLAN ETTİĞİ pay
(`foodRation`, `soldierPay`) ile ambarın/hazinenin FİİLEN karşıladığı pay
(`servedRations().food` / `.pay`) arasındaki fark artık ölçülüyor ve eşiği
aşarsa halk bunu Krala kendi ağzından söylüyor. Ölçü `engine/populace-voice.ts`
içinde ayrı ve dışa açık bir saf fonksiyondur (`promiseGaps`); eşik ve kapı
`VOICE_THRESHOLDS.vaat` içinde tek kaynakta durur. Talebin açılması için Kralın
en az TAM payı ilan etmiş olması şartı var (`promise: 100`) ve talep asla
`urgent` olmuyor. İstemci bağlamına tek yeni alan eklendi (`populace.servedPay`),
General'in promptuna bir doktrin satırı girdi.

## Neden

Oyunun "General her zaman haklı" hissini kırmak için. Bugüne kadar Kral bir
istihkak emri verdiğinde geri bildirim yalnızca "uyguladım"dı; ambarın o
istihkakı karşılayamadığı bilgisi hiçbir yerde SESLENDİRİLMİYORDU — panelde
`servedFood` duruyordu ama kimse onu Kralın yüzüne vurmuyordu. Sonuç: Kral
istihkakı %150'ye çekip sorunu çözdüğünü sanabiliyor, halkın hayatı hiç
değişmemiş olabiliyordu ve bu sessizlik oyunun en dramatik anını (halkın
kralına hesap sorması) hiç doğurmuyordu.

İkinci ve daha önemli gerekçe bir ilke gerilimini çözmek: CLAUDE.md'nin "Kesin
işlem kuralı" General'in uygulamadığı eylemi uyguladım demesini yasaklıyor. Bu
madde o kuralı ihlal ETMİYOR — General emri gerçekten çağırdı, ilan edilen oran
gerçekten değişti. Söylemediği şey sonuçtu. Yani ortada "yanlış iddia" değil
"eksik açıklama" var ve bu ayrım kodda kalıcı bir yorum olarak yazılı: gelecekte
biri bu bloğu ilke ihlali sanıp geri almasın.

Makas ölçüsünün ayrı bir fonksiyon olmasının gerekçesi kısıt #5: Fikir 18
(Kralın kendi halkını feda etmesi) "halk fark etti mi" sorusunu aynı yerden
okuyacak. İki madde kendi ölçüsünü yazsaydı sessizce birbirinden saparlardı.

Şemaya hiç dokunulmadı: `populace_demands.kind` serbest metin sütunudur
(enum kısıtı yok), dolayısıyla yeni bir talep türü migration istemiyor ve
`.strict()` save şeması hiç devreye girmiyor.

## Etkilenen dosyalar

- engine/populace-voice.ts (`DemandKind` → `vaat`, `VOICE_THRESHOLDS.vaat`,
  `VoiceSignals.nominalFood`/`nominalPay`/`servedPay`, `promiseGaps`,
  `promiseDemand`, `DEMAND_SUBJECT.vaat`, ilke-gerilimi yorumu)
- app/api/general/route.ts (`populace.servedPay` alanı, `loadPopulaceVoice`
  içinde nominal alanların geçirilmesi, makas doktrini)
- components/KingdomGame.tsx (`kingdomContext` → `populace.servedPay`)
- tests/populace-voice.test.ts (10 yeni test)

## Test durumu

- `npx tsc --noEmit` → temiz (çıkış 0).
- `npm test` → 611 test, 611 pass, 0 fail (taban 601; 10 yeni test eklendi,
  mevcut testlerin hiçbiri değişmedi ve hiçbiri zayıflatılmadı).
- `npm run lint` → 0 hata, 1 uyarı (`KingdomGame.tsx` içindeki önceden var
  olan `exhaustive-deps`; taban durumuyla aynı).
- Yeni testler MUTASYONLA sınandı, dördü de yakalandı:
  1. `promise` kapısı kaldırıldı → "Kral tam pay İLAN ETMEDİYSE..." kırıldı.
  2. Askersiz krallık şartı kaldırıldı → "maaş makası kışlanın sesidir..." kırıldı.
  3. `severity` `urgent`e çevrildi → iki test kırıldı (yeni ve mevcut kıyas testi).
  4. Yapı süzgeci (`buildingTypes`) kaldırıldı → "makas iki yoldan kapanır..." kırıldı.

## Takip gereken işler

- Halk sekmesinde makas talebi diğer talepler gibi görünüyor (`populace-voice`
  bloğu tür-bağımsız çalışıyor), ayrı bir görsel vurgu yok. Kralın "bu bir
  hesap sorma, talep değil" ayrımını panelde de görmesi istenirse ayrı bir
  rozet eklenebilir.
- `servedPay` göndermeyen eski bir istemci bağlamında maaş kanalı hiç
  ölçülmez (kademeli açılım). Bu bilinçli; istemci güncellenince kendiliğinden
  devreye girer.
