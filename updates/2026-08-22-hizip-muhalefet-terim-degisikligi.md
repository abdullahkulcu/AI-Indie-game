# "Hizip" terimi "muhalefet" olarak değiştirildi

Tarih: 2026-08-22

## Ne değişti

Oyuncuya görünen tüm metinlerde "hizip" terimi **"muhalefet"** ile değiştirildi:
durum etiketleri (`Örgütlü hizip` → `Örgütlü muhalefet`, `Hizip yok` →
`Muhalefet yok`), defter bildirimi türü (`kind: "HİZİP"` → `"MUHALEFET"`),
panel başlığı (`İÇ HİZİP` → `İÇ MUHALEFET`), uyarı metni, General'in
doktrinindeki satır ve `send_purse` aracının açıklaması. General'e giden
bağlam anahtarı da `populace.hizip` → `populace.muhalefet` oldu (tip,
üretim noktası ve prompt üçü birlikte).

Ayrıca plan belgesindeki Fikir 8'in adı, kullanıcının kararıyla
"Hizip müzakere masası" → **"Koalisyon masası"** yapıldı.

Kod içindeki İngilizce adlar (`factionPressure`, `factionState`,
`factionLeaderName`, `.faction-*` CSS sınıfları) DEĞİŞMEDİ — yalnızca
görünen Türkçe metinler çevrildi.

## Neden

Proje sahibi "hizip" kelimesinin ne anlama geldiğini sordu. Kelime oyunun
Osmanlı registerine uygun olsa da tanınırlığı düşük; oyuncuyu bir an
durdurup düşündüren bir terim, arayüzde maliyet demek. "Muhalefet" aynı
şeyi anlatıyor ve ilk okumada anlaşılıyor.

"Ayaklanma"/"başkaldırı" gibi alternatifler ELENDİ: oyun `İsyan` kelimesini
zaten iki yerde kullanıyor (halkın en düşük ruh hâli ve garnizonun isyanı),
bu yüzden isyan-komşusu bir terim karışıklık yaratırdı.

## Etkilenen dosyalar

- `engine/faction.ts` (etiketler, bildirimler, yorumlar)
- `engine/tick.ts` (bildirim türü)
- `components/KingdomGame.tsx` (panel, uyarı, bağlam anahtarı)
- `app/api/general/route.ts` (tip, doktrin satırı, `send_purse` açıklaması)
- `engine/agitation.ts`, `engine/populace.ts`, `engine/types.ts`,
  `server/save-validation.ts`, `app/api/cron/route.ts`, `app/game.css` (yorumlar)
- `tests/faction.test.ts`, `tests/agitation.test.ts` (test adları + iki iddia)
- `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`,
  `docs/ARCHITECTURE.md`, `docs/PHASES.md`

## Test durumu

- `npx tsc --noEmit`: temiz.
- `npm test`: 483/483 geçti.
- `npm run lint`: 0 hata (1 önceden var olan, ilgisiz `exhaustive-deps` uyarısı).

## Dikkat edilen iki tuzak

1. **`factionLeaderName`'in tohum dizgesi DEĞİŞTİRİLMEDİ.**
   `hash(\`${kingdomName}|${foundedAt}|hizip\`)` içindeki `"hizip"` bir metin
   değil, bir kimliktir. Terim değişikliğiyle birlikte onu da güncellemek
   doğal görünüyor ama yapılsaydı hash değişir, hash değişince HER MEVCUT
   KRALLIĞIN elebaşısının adı bir gecede başka biri olurdu. Dosyaya bunu
   açıklayan kalıcı bir yorum eklendi.

2. **Eski kayıtlardaki `kind: "HİZİP"` bildirimleri reddedilmiyor.**
   `server/save-validation.ts` `notices[].kind` alanını `z.string()` olarak
   tutuyor (enum DEĞİL), bu yüzden şema değişikliği gerekmedi ve geçmiş
   bildirimler yazıldığı gibi kalıyor. Enum olsaydı bu değişiklik tüm eski
   kayıtları reddederdi (CLAUDE.md kısıt #3).

Ayrıca `docs/PHASES.md`'de alıntılanan gerçek commit mesajı (`beb822c`
"İç hizip: …") tarihsel alıntı olduğu için OLDUĞU GİBİ bırakıldı; blanket
replace onu da değiştirmişti, geri alındı.
