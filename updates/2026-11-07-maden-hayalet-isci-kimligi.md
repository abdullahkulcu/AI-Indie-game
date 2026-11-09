# Ortak madende hayalet işçi temizliği

Tarih: 2026-11-07

## Ne değişti

Ortak madenin işçi listesi, kapasite hesabından önce etkin channel üyeliği ve krallığın `channelId` kaydıyla doğrulanıyor. Channel değiştirmiş, kaydı bozulmuş ya da artık bu channel'a ait olmayan işçi satırları siliniyor; ilgili krallığın `mineWorkers` alanı da sıfırlanıyor.

Diyar haritası ve ilişki ekranındaki müzakere/anlaşma eşlemesi de görüntülenen krallık adı yerine karşı hesabın kayıt kimliğini kullanıyor. Aynı adlı iki krallık artık birbirinin ilişki durumunu gösteremez.

## Neden

Eski işçi satırları Diyar panelinde görünmediği hâlde 60 ortak maden yuvasını doldurabiliyordu. Bu, "Madende yer kalmadı" hatasının görünür katılımcılarla çelişmesine neden oluyordu. Sahiplik ve kapasite denetimi isimle değil yalnızca kullanıcı kaydı ve channel kimliğiyle yapılır.

## Etkilenen dosyalar

- app/api/mine/route.ts
- app/api/negotiate/route.ts
- server/mine-roster.ts
- components/KingdomGame.tsx
- tests/mine-roster.test.ts
- tests/negotiation.test.ts
- tests/war-reporting.test.ts
- package.json

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/mine-roster.test.ts tests/mine.test.ts` başarılı (16 test).
- `npm test` başarılı (692 test); `npm run build` başarılı.
