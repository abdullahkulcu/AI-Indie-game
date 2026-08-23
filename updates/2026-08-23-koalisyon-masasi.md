# Koalisyon masası — muhalefetle pazarlık (Fikir 8)

Tarih: 2026-08-23

## Ne değişti

Muhalefet baskısı `FACTION_THRESHOLDS.organized` eşiğini geçtiğinde (yani bir
elebaşı çıktığında) halkın sesi listesinde yeni bir talep açılıyor:
`muhalefet`. Elebaşı Kral'a masa teklif ediyor ("halkın yükü hafifletilirse
dağılırız"), `defiant` eşiğinde talep acile dönüşüyor. Talebin cümlesi Fikir
2'nin mevcut Halk-AI boru hattından geçiyor. `engine/ledger.ts` iki yeni tür
kazandı (`faction_settled`, `faction_defied`) ve General'in defteri Kral'ın
masayı tekrar tekrar geçiştirmesini artan ağırlıkla sertleşen bir cümleye
çeviriyor. Yan iyileştirme: `LedgerKind` artık `LEDGER_KINDS` dizisinden
türüyor.

## Neden

İç muhalefetin bugüne kadar Kral'la hiçbir etkileşimi yoktu. Baskı büyüyor,
garnizonun zapt gücünü kırıyor, Kral panelde bir çubuk ve bir isim görüyordu —
ama o isimle konuşamıyordu bile. Mekanik bir ceza olarak doğru çalışıyordu ama
bir AKTÖR üretmiyordu. Masa o eksiği kapatıyor: karşısında pazarlık yapılabilen
biri var.

Talebin çaresinin rızayı yükselten emirler olması bir uzlaşma değil, mekaniğin
zorunlu sonucu. `engine/faction.ts` Kral'ın muhalefeti bastıracak bir emri
OLMADIĞINI taşıyıcı ilke olarak yazıyor; masa yeni bir çıkış açsaydı o ilkeyi
arka kapıdan iptal ederdi. Bu yüzden "kabul etmek" halkın hayatını düzeltmek
demek ve elebaşı bir imza karşılığında değil, rıza gerçekten yükselince
dağılıyor. Çare listesinin kıyas talebiyle aynı yerden okunması da aynı
disiplin: "muhalefet baskısı nasıl erir" sorusu iki yerde ayrı cevaplanmasın.

Sertleşmenin dilde kalması bilinçli ve teknik bir zorunluluk. En doğal görünen
yol baskının BİRİKME HIZINI eşiğe bağlı olarak büyütmekti; denenmedi çünkü
kısıt #2'yi ihlal ediyor. `advanceFaction`'ın mevcut hız seçimi güvenliğini tek
bir şeye borçlu: `start < target` karşılaştırması aralık boyunca hiç dönmüyor.
Eşik-bağımlı bir hız ise aralığın ortasında döner — sunucunun tek adımı
eşik-öncesi hızı bütün aralığa uygular, istemcinin saniyelik adımları eşiği
geçtiği yerde hızı değiştirir. `factionPressure` `SERVER_DERIVED` olduğu için
bu sapma 409 üretmez, yani hatayı GİZLER. Sessizce ayrışan bir motor, gürültülü
ayrışan bir motordan daha kötüdür. Gerekçe `engine/faction.ts` içinde kalıcı bir
"buraya sertleşme hızı eklemeyin" yorumu olarak duruyor.

Plan belgesinin ön analizinde geçen "anlaşma indirimi" (kabul edilince baskının
normalden hızlı erimesi) de yapılmadı ve bunun iki gerekçesi var: (a) bağlayıcı
"Karar (2026-08-22)" yalnızca iki şeyi sabitliyor — talebin LLM'den üretilmesi
ve ısrarlı reddin elebaşıyı sertleştirmesi; indirim kararın değil ön analizin
bir cümlesiydi. (b) İndirim `advanceFaction`'a bir "anlaşma damgası" ister, o da
`engine/types.ts` ile `.strict()` save şemasına yeni bir alan demek (kısıt #3)
ve bu turda o dosyalara dokunma yetkisi Agent B'deydi.

`LEDGER_KINDS` refactor'ünün sebebi somut: türlerin tam listesi ikinci bir kopya
olarak `tests/ledger.test.ts` içinde elle yazılıydı. Yeni bir tür eklendiğinde
test onu hiç görmüyor, yani cümlesi olmayan bir tür sessizce geçebiliyordu —
tam da bu commit'te olacak şey.

## Etkilenen dosyalar

- engine/populace-voice.ts (`muhalefet` türü, `VOICE_THRESHOLDS.muhalefet`,
  `VoiceSignals.factionPressure`/`factionLeader`, `factionDemand`,
  `DEMAND_SUBJECT.muhalefet`)
- engine/faction.ts ("buraya sertleşme hızı eklemeyin" gerekçesi)
- engine/ledger.ts (`LEDGER_KINDS` dizisi, `faction_settled`/`faction_defied`,
  `phraseFor` dalları, `STATEFUL` listesi, `LedgerSignals` bayrakları)
- server/populace-voice.ts (`syncPopulaceDemands` artık `derived` döndürüyor)
- app/api/general/route.ts (masa girdileri, `recordTurn` içinde masa
  eşleştirmesi, koalisyon doktrini)
- tests/populace-voice.test.ts (7 yeni test), tests/ledger.test.ts (4 yeni test
  + elle yazılı tür listesinin kaldırılması)

## Test durumu

- `npx tsc --noEmit` → temiz (çıkış 0).
- `npm test` → 641 test, 641 pass, 0 fail (Fikir 15 sonrası taban 630; 11 yeni
  test).
- `npm run lint` → 0 hata, 1 uyarı (önceden var olan `exhaustive-deps`).
- Mevcut bir test DEĞİŞTİRİLDİ ve bu bir GÜÇLENDİRMEDİR, zayıflatma değil:
  "her madde türü bir cümle üretir" testindeki elle yazılı tür listesi
  `LEDGER_KINDS` ile değiştirildi ve üç ayrı ağırlıkta (1/2/5) sınanmaya
  başlandı. Eski hâli 11 türü tek ağırlıkta ölçüyordu; yeni hâli 13 türü üç
  ağırlıkta ölçüyor.
- Mutasyonla sınandı, altısı da yakalandı:
  1. Eşik `organized` yerine `stirring` yapıldı → 2 test kırıldı.
  2. Çareye `set_watch_ratio`/`train_unit` eklendi (faction.ts ilkesinin
     ihlali) → 2 test kırıldı.
  3. Elebaşı adı yoksa talep kapatıldı → 5 test kırıldı.
  4. Karşılama ve geçiştirme birlikte sayıldı → 1 test kırıldı.
  5. `faction_defied` `STATEFUL` listesinden çıkarıldı → 2 test kırıldı.
  6. Ağırlıkla sertleşme kaldırıldı → 2 test kırıldı.

## Takip gereken işler

- "Anlaşma indirimi" (kabul edilince baskının hızlı erimesi) yapılmadı; yukarıda
  gerekçesi var. Kral bunu isterse `engine/types.ts` + `server/save-validation.ts`
  içinde bir damga alanı (`factionSettledAt`) gerekir ve kapalı çözümlü
  yazılabilir. Şema yetkisi olan bir turda ele alınmalı.
- Masa talebi `MAX_OPEN_DEMANDS` (2) tavanını paylaşıyor. Muhalefet örgütlüyken
  krallıkta genelde başka talepler de açıktır; `defiant` eşiğinde masa acil
  olduğu için öne geçer, `organized` eşiğinde ekmek/maaş gibi acil bir talebin
  arkasında kalabilir. Bilinçli: en acil sıkıntı önce gelir.
