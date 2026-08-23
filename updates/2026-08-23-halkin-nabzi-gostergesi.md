# Kritik kararlarda "halkın nabzı" göstergesi (Fikir 6)

Tarih: 2026-08-23

## Ne değişti

`engine/faction.ts` içine saf bir `populacePulse(popularity, pressure)`
fonksiyonu eklendi: mevcut rızanın işaret ettiği muhalefet baskısı
(`factionTarget`) ile bugünkü baskıyı okuyup dört nitel kademe döndürüyor
(`steady`/`grumbling`/`hostile`/`breaking`). `RiskAssessment` artık bu nabzı
taşıyor ve `server/general-risk.ts` içindeki yeni `pulseNote` kapısı onu
yalnızca `elevated` ve `severe` kademelerde General'in itiraz/teyit/ret notuna
ekliyor. `KingdomSnapshot`a opsiyonel `factionPressure` alanı, istemci
bağlamındaki muhalefet bloğundan besleniyor. Yeni UI bloğu yok: gösterge
Kralın kararı verdiği yerde, meclis sohbetindeki notun içinde görünüyor.

## Neden

Bugüne kadar halkın tepkisi yalnızca kararın SONRASINDA görünüyordu: Kral
vergiyi %35'e çekiyor, birkaç oyun saati sonra rıza düşüyor, sonra bir gün
sonra muhalefet bildirimi geliyordu. Kararın kendisi anında ise halk hiç
görünmüyordu — yani "demokratik baskı" mekanikte vardı ama Kralın karar
verirken önüne gelmiyordu. Gösterge o boşluğu kapatıyor: kararın SONRASINI
değil ÖNCESİNİ görünür kılarak baskıyı bir tahmine dönüştürüyor.

Ölçünün `factionTarget`ten okunması bilinçli. Bugünkü baskıya bakmak yanıltıcı
olurdu: rıza yeni çökmüşse baskı hâlâ 0'dır (üstel birikim zaman alır) ve
gösterge "halk arkanızda" derdi — tam da uyarması gereken anda. `factionTarget`
gidişatı söylüyor, dolayısıyla nabız Kralın henüz hissetmediği şeyi haber
veriyor.

Nitel kalması ve kapının iki kademeyi birden kapsaması plan belgesinin
bağlayıcı kararlarıdır; ikisi de yeniden tartışılmadı. Sayısal bir tahmin
("rıza −8 puan") Kralı eşiğin bir puan altında kalmayı öğrenmeye çağırırdı ve
halk bir aktörden bir formüle dönüşürdü.

`pulseNote`un dışa açık olmasının tek gerekçesi testtir ve gerekçesi kodda
yazılı: kapı `reviewProposedActions` üzerinden sınanamıyordu, çünkü `low`
kademede o fonksiyon zaten hiç not üretmiyor — kapıyı kaldıran bir mutasyon
tek bir testi bile kırmadan geçiyordu. Bu, ilk yazdığım testin hiçbir şeyi
yakalamadığının somut kanıtıydı ve düzeltildi.

## Etkilenen dosyalar

- engine/faction.ts (`PopulacePulseId`, `PopulacePulse`, `PULSES`,
  `populacePulse`)
- server/general-risk.ts (`KingdomSnapshot.factionPressure`,
  `RiskAssessment.pulse`, `pulseNote`, üç not dalına eklenmesi)
- app/api/general/route.ts (`snapshotOf` → `factionPressure`)
- tests/general-review.test.ts (7 yeni test)

## Test durumu

- `npx tsc --noEmit` → temiz (çıkış 0).
- `npm test` → 618 test, 618 pass, 0 fail (Fikir 14 sonrası taban 611; 7 yeni
  test). Mevcut testlerin hiçbiri değişmedi: `tests/general-review.test.ts`
  notları önek/parça eşlemesiyle (`/^⏸/`, `/Onayınızı bekliyorum/`) ölçtüğü
  için notun sonuna eklenen nabız cümlesi hiçbir iddiayı bozmadı.
- `npm run lint` → 0 hata, 1 uyarı (önceden var olan `exhaustive-deps`).
- Mutasyonla sınandı, dördü de yakalandı:
  1. Kapı yalnızca `severe`e indirildi → "nabız ORTA riskte de gösterilir" kırıldı.
  2. `low` kapısı kaldırıldı → "nabız RUTİN emirde gösterilmez" kırıldı
     (İLK HÂLİYLE KIRILMIYORDU; bkz. yukarıdaki "Neden").
  3. `factionTarget` (gidişat) girdisi kaldırıldı → dört test kırıldı.
  4. Etikete bir sayı sızdırıldı → "NİTEL ETİKET" testi kırıldı.

## Takip gereken işler

- Gösterge şu an yalnızca meclis sohbetindeki notta görünüyor. Plan belgesinin
  ön analizi "UI'da onay ekranına bir gösterge" diyordu ama bağlayıcı KARAR
  yalnızca kademeleri ve nitelliği sabitliyor; bu oyunda onay ekranı meclis
  sohbetidir. Kral ayrı bir görsel rozet isterse `halk` sekmesine
  `assessment.pulse` üzerinden eklenebilir — nabız ikinci kez hesaplanmasın.
