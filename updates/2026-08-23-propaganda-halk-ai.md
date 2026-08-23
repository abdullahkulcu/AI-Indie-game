# Propaganda — enformasyon silahı olarak Halk-AI (Fikir 15)

Tarih: 2026-08-23

## Ne değişti

Dış kesenin hedefin defterine düşürdüğü satır artık `AGITATION_NOTICE` sabit
tablosundan değil, hedefin Halk-AI'sından geliyor. `server/populace-narrator.ts`
içine ikinci bir anlatıcı eklendi (`propagandaNarrator`, `propagandaPrompt`) ve
"bu satır ne olacak" kararı tek yerde toplandı (`agitationNotice`). Modele
verilen tek şey `engine/agitation.ts` içindeki yeni `AGITATION_SUBJECT`
tablosudur: kesenin TÜRÜNDEN türeyen, hedefin verisini taşımayan genel bir konu.
Ayrıca kişiliğin sayısal bir etkisi oldu: `AGITATION_BELIEF` çarpanı halka giden
kesenin (`gold_commons`) payını ölçekliyor. `app/api/cron/route.ts` →
`settleAgitations` hedefin kimlik bilgisini `populaceCredentialFor` ile tek
kapıdan çözüp ikisini de besliyor.

## Neden

Dış kese bugüne kadar yalnızca bir sayı taşıyordu: muhalefet baskısına +9,6
puan. Hedef Kral defterinde her seferinde AYNI cümleyi görüyordu, dolayısıyla
sabotaj oyunun içinde bir olay değil bir sayaç hareketiydi — ve tekrar eden
sabit metin oyuncuyu satırı okumamaya alıştırıyordu. Söylentinin halkın kendi
ağzından çıkması sabotajı yeniden bir olaya çeviriyor.

İçeriğin belirsiz kalması bir üslup tercihi değil, bir güvenlik sınırı. Gönderen
Kral hedefin iç verisini bilmiyor (plan §2). Söylenti hedefin gerçek zaafına
işaret etseydi iki yönlü sızıntı olurdu: gönderen hedefin defterini dolaylı
olarak öğrenirdi, hedef ise kendi panelinde o zaafı görüp "yabancı benim
ambarımı biliyor" sonucuna varırdı. Bu yüzden konular hedefin DURUMUNDAN değil
kesenin TÜRÜNDEN türetiliyor: türü gönderen zaten kendisi seçmiştir, yeni bilgi
yoktur.

İnanç çarpanının yalnızca `gold_commons`a uygulanmasının sebebi, kararın bir
ENFORMASYON etkisinden söz etmesi. Askerin kesesinde inanç değil çıkar işler;
mal yığını ve dağdaki eşkıya ise halkın neye inandığından bağımsız fiziksel
etkilerdir. Çarpanı hepsine uygulamak kişiliği bir "genel sabotaj zayıflığı"na
çevirirdi.

İfşa satırının deterministik kalması: o satır bir söylenti değil,
karşı-istihbaratın gönderenin adını taşıyan kesin raporudur. Modelin o ismi
yeniden yazmasına izin vermek, ifşanın tek somut çıktısını bulanıklaştırırdı.

Model hatasında ŞABLONA düşülüyor ve bu, halkın sesindeki (`narrateDemands`)
karardan bilinçli olarak farklı. Orada talep susar çünkü talep süregelen bir
durumdur ve bir sonraki istekte yeniden denenir. Kesenin varışı ise TEK
SEFERLİK bir olaydır: cron o satırı yazamazsa Kral yabancı bir elin krallığına
dokunduğunu hiç öğrenmez. Sağlayıcı hatasının bir sabotajı tamamen silmesi
kabul edilemez.

## Etkilenen dosyalar

- engine/agitation.ts (`AGITATION_BELIEF`, `agitationBelief`,
  `AGITATION_SUBJECT`, `applyAgitation`'a `persona` parametresi)
- server/populace-narrator.ts (`propagandaNarrator`, `propagandaPrompt`,
  `PROPAGANDA_PROMPT`, `BELIEF_INSTRUCTION`, `agitationNotice`)
- app/api/cron/route.ts (`settleAgitations` içinde kimlik bilgisi çözümü ve
  satırın `agitationNotice`ten alınması)
- tests/agitation.test.ts (5 yeni test), tests/populace-narrator.test.ts
  (7 yeni test)

## Test durumu

- `npx tsc --noEmit` → temiz (çıkış 0).
- `npm test` → 630 test, 630 pass, 0 fail (Fikir 6 sonrası taban 618; 12 yeni
  test). Mevcut testlerin hiçbiri değişmedi ve hiçbiri zayıflatılmadı —
  `applyAgitation`'ın yeni `persona` parametresi varsayılan `null` olduğu için
  mevcut 8 çağrının sonucu birebir aynı kaldı ve bir test bunu doğruluyor.
- `npm run lint` → 0 hata, 1 uyarı (önceden var olan `exhaustive-deps`).
- Mutasyonla sınandı, dördü de yakalandı:
  1. İnanç bütün kanallara uygulandı → "inanç YALNIZCA halka giden keseye" kırıldı.
  2. İfşa satırı da modelden alındı → "İFŞA yolunda model HİÇ çağrılmaz" kırıldı.
  3. Model hatasında şablona düşmek kaldırıldı → "ŞABLONA DÜŞÜLÜR" kırıldı.
  4. Konuya somut bir zaaf ("ambar boş") sızdırıldı → "ASİMETRİK BİLGİ SINIRI"
     kırıldı.
- **Denge ölçümü, gözle değil sayıyla:** ilk yazdığım çarpan (1,25) TEK kesenin
  tavana çakmasına yol açıyordu (9,6 × 1,25 = 12 → tavan 11,5) ve bu, mekaniğin
  "keseler art arda birikir" dokusunu o kişilikte tamamen siliyordu. Test bunu
  yakaladı; çarpan 1,15'e indirildi (üst sınır `cap/perPurse` ≈ 1,198) ve o
  sınırı koruyan bir iddia teste eklendi.

## Takip gereken işler

- Kese başına bir model çağrısı ve bir DB sorgusu eklendi (yalnızca kese
  GERÇEKTEN vardığında ve yalnızca ifşa OLMAYAN yolda). Kese tavanları
  (gönderen başına günde 4, hedef başına 3) bunu doğal olarak sınırlıyor, ama
  oyun kurucusunun faturası bu maddeyle birlikte kese hacmine de bağlanıyor —
  maliyet konuşması yapılırken bu kalem hatırlanmalı.
- Söylenti satırı `game.notices` içine yazılıyor; `notices[].text` şema sınırı
  400 karakter, `POPULACE_TEXT_LIMIT` 220, yani sınır rahat. Şema değişmedi.
