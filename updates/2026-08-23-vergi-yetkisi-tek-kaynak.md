# Verginin kimin elinde olduğu tek sesle söyleniyor

Tarih: 2026-08-23

## Ne değişti

Yetkinin cümlesi ve Kralın kendi çevirdiği kolların adları `engine/policy.ts`'e
alındı (`POLICY_AUTHORITY_NOTE`, `POLICY_LABELS`). Arayüzdeki dört yer artık o
tek kaynaktan okuyor:

- **HALK sekmesi** notu ve **"Generalin yetkileri" kartı** notu AYNI dizgeyi
  basıyor; iki elle yazılmış kopya kaldırıldı.
- **Yetki listesinden "Vergi ayarla" çıkarıldı.** O kol Kralın; General'in
  yetkisi değil. Kart artık kendisiyle çelişmiyor.
- **DEFTER sekmesindeki** kilitli kaydırıcının altındaki metin düzeltildi:
  "General'i ikna etmelisin" yerine "vergi oranını HALK sekmesinden kendiniz
  çevirirsiniz; burası rapordur". Kaydırıcı kilitli KALDI — Defter bir rapor
  sekmesi, aynı kumandanın ikinci bir kopyası kurulmadı.
- **Başlangıç rehberinin IV. adımı** düzeltildi.

## Neden

Oyun aynı soruya dört farklı cevap veriyordu. Gerçek davranış şu: vergiyi ve
istihkakları Kral doğrudan çevirir, HALK sekmesindeki düğmeler gerçekten
çalışır. Buna karşı DEFTER "General'i ikna etmelisin" diyor, rehber "düğmeyle
değiştirmezsin" diyor, yetkiler kartı "Vergi ayarla"yı General'in listesine
koyup hemen altındaki satırda "Kral doğrudan çevirir" yazıyordu.

Bu bir yazım hatası değil, kuralın altı yere elle yazılmasının sonucuydu
(CLAUDE.md kısıt #5). Sonucu somut: Defter'deki kilitli kaydırıcıyı gören
oyuncu, çalışan düğmelere hiç dokunmuyor — oyunun en sık kullanılan kolu.

`engine/policy.ts` doğruyu BAŞTAN BERİ söylüyordu: dosyanın ilk yorumu "Kralın
doğrudan çevirdiği ayarlar" diyor ve `PolicyKey` tam olarak o üç kolu sayıyor.
Eksik olan kural değil, arayüzün onu OKUMASIYDI.

## Etkilenen dosyalar

- engine/policy.ts (`POLICY_LABELS`, `POLICY_AUTHORITY_NOTE`)
- components/KingdomGame.tsx (dört yer tek kaynağa bağlandı)
- tests/vergi-yetkisi.test.ts (yeni)
- package.json (test listesi)

Davranış değişmedi: hiçbir kumanda eklenmedi, kaldırılmadı ya da kilidi
açılmadı. Değişen tek şey oyunun ne söylediği.

## Test durumu

- `npx tsc --noEmit` temiz · `npm test` 707/707 · `npm run lint` 0 hata
  (`KingdomGame.tsx`'teki tek `exhaustive-deps` uyarısı önceden var) ·
  `npm run build` başarılı.
- MUTASYON: üç yalanı kasten geri koydum. İlk denemede **biri yakalanmadı** —
  desenim JSX'in `&apos;` kaçışını hesaba katmıyordu, yani test o yalanı
  görmüyordu. Desen genişletildi ve üçü de yakalandı (beş testten ikisi/üçü
  kırılıyor).
- CANLI DOĞRULAMA (çalışan sunucu + Chromium): HALK notu ile yetki kartının
  notu artık BİREBİR aynı cümle. Yetki listesinde "Vergi ayarla" yok, ama
  General'in gerçek işleri (asker maaşı, nöbet oranı, yapı kurma) yerinde.
  DEFTER "Vergi oranını HALK sekmesinden kendiniz çevirirsiniz; burası rapordur"
  diyor.
- REGRESYON (canlı): vergi düğmeleri çalışıyor — %15'ten %0'a indirildi ve
  motorun kıskacı doğru davrandı: sıfırda azaltma düğmesi devre dışı, artırma
  açık. Politika değişince arayüzün MECLİS'e atlaması BİLİNÇLİ ve eski
  davranış (`setPolicy` sonunda `setTab("meclis")` — Kral General'in görüşünü
  okusun diye); ilk ölçümümde bunu panel bozulması sandım, kodu okuyup
  düzelttim. Test krallığının vergisi %15'e geri alındı.
