# Gece vardiyasının iki eksiği kapandı

Tarih: 2026-08-23

## Ne değişti

**3a. `max_actions_per_wake` artık okunuyor.** `runOne`'ın tek hamlelik gövdesi
bir iç fonksiyona (`performTurn`) alındı ve etrafına bütçeyle sınırlı bir döngü
kuruldu. Bütçe kuralı `server/night-shift.ts` → `wakeBudget` içinde saf ve
testli: Kralın uyanış başına verdiği hak ile günlük tavandan KALANIN küçüğü, en
az 1. Döngü her hamleden sonra TAZE kaydı okuyor ve `shouldWake`'i YENİDEN
soruyor.

**3b. Gece vardiyası deftere yazıyor.** Döngüden sonra `deriveLedgerEvents` +
`appendToLedger` çağrılıyor. YENİ BİR DEFTER TÜRÜ EKLENMEDİ.

## Neden

**3a:** Sütun (varsayılan 1) ve `StandingOrder` tipi baştan beri bu alanı
taşıyordu ama hiçbir yerde okunmuyordu — kod her uyanışta örtük olarak bir
hamle varsayıyordu. Kral "gece en fazla üç iş yap" dese de bir iş yapılıyordu;
yani ayar oyuncuya yalan söylüyordu. Uzun uzaklaşan oyuncu için gecenin
verimini belirleyen şey tam olarak bu.

**3b:** `appendToLedger` yalnızca Kral çevrimiçiyken çağrılıyordu, yani gece
vardiyasının yaptığı hiçbir şey General'in hafızasına girmiyordu — ertesi gün
"dün gece ne oldu" diye hatırlamıyordu.

**Bir düzeltme:** Bu maddeyi ilk anlatırken "sabah General'in gece ne yaptığını
göremiyorsun" demiştim; YANLIŞTI. `runOne` her hamlede kayda "GECE VARDİYASI"
bildirimi düşürüyor, yani Kral gece olanı zaten görüyor. Eksik olan Kralın
görüşü değil, General'in HAFIZASIYDI.

## Açık soruların cevabı

Backlog belgesi iki soru bırakmıştı.

**"Birden çok hamlede her biri ayrı ayrı mı değerlendirilir?"** Evet, tam bir
tur olarak. Döngü her hamleden önce taze kaydı okuyor ve `shouldWake`'i
yeniden soruyor; böylece araya giren durumlar kendiliğinden saygı görüyor
(inşaat kuyruğu doldu, karşılanabilir emir kalmadı, günlük tavana ulaşıldı).
Motorun kapıları — garnizon vetosu dâhil — `applyActions` üzerinden her
hamlede tekrar çalışıyor. "Hamle yapılabilir mi" kuralı hâlâ TEK yerde.

**"Ledger'a hangi türle girecek, yeni bir tür mü gerekir?"** Gerekmedi.
`deriveLedgerEvents`in ürettiği türlerin çoğu krallığın DURUMUNDAN doğuyor
(açlık, tokluk, firar, ödenmiş maaş, boşalan hazine) ve gece sonundaki durum da
bir durumdur. Kral-General sohbetine özgü sinyaller (itirazın ezilmesi,
reddetme, geri adım, talep karşılama, koalisyon masası) gece KAPALI geçiliyor —
masada Kral yok. Şenlik, gecenin gerçekten uyguladığı eylemden geliyor.

## Bilinçli davranış değişikliği

Anahtar çözme adımı sağlayıcı çağrısının `try`'ından çıkarıldı. Eskiden
çözülemeyen bir anahtar "Sağlayıcı hatası: …" olarak raporlanıyor ve
`tokensUsed: true` sayılıyordu; oysa hiç token harcanmamıştı. Artık ayrı ve
doğru bir sonuç veriyor: "BYOK anahtarı çözülemedi; General sessiz.",
`tokensUsed: false`. Ayrıca anahtar döngüden ÖNCE bir kez çözülüyor — çok
hamleli bir uyanışta her hamlede yeniden çözmek gereksiz iş olurdu.

## Etkilenen dosyalar

- server/night-shift.ts (`wakeBudget` — saf, testli)
- app/api/cron/route.ts (`performTurn`, bütçe döngüsü, defter yazımı)
- tests/gece-vardiyasi-butce.test.ts (yeni)
- package.json (test listesi)

Motora, şemaya ve defterin tür listesine DOKUNULMADI.

## Test durumu

- `npx tsc --noEmit` temiz · `npm test` 702/702 · `npm run lint` 0 hata
  (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var) ·
  `npm run build` başarılı.
- MUTASYON: bütçeyi günlük tavandan kopardığımda, defter yazımını sildiğimde ve
  döngüdeki yeniden-karar sorgusunu atladığımda dokuz testten dördü kırıldı.
- CANLI DOĞRULAMA (çalışan sunucu + gerçek Postgres): uyanış başına 3 hamle
  isteyen bir kalıcı emir kuruldu ve cron tetiklendi. Cron temiz döndü, emir
  doğru okundu (`max_actions_per_wake=3`) ve BYOK olmadığı için beklenen
  sonucu verdi. Sonra çözülemeyen bir kimlik bilgisi konuldu: yeni yol doğru
  çalıştı — "BYOK anahtarı çözülemedi", `llmCalls: 0`, `tokensUsed: false`.
  Test verisi silindi.

## Takip gereken işler

Çok hamleli döngü GERÇEK bir sağlayıcı anahtarıyla denenmedi — bu ortamda BYOK
anahtarı yok. Döngünün kendisi, bütçesi ve karar yenilemesi testli, ama iki
ardışık gerçek LLM hamlesi sahada bir kez izlenmeli.
