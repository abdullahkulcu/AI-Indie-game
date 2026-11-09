# Kral Seferdeyken Naiplik

Tarih: 2026-11-07

## Ne değişti

Kral cephede komuta ettiği aktif sefer ve dönüş yolunda, büyük başkent kararları sunucu tarafında ertelenir. General artık inşa, vergi/istihkak, şenlik, göç, sürekli talimat, dış keşif ve normal diplomasi emirlerini uygulayamaz; Hazinedar pazar işlemlerini, General ise savunma emirlerini sürdürebilir. Elçilik rotası da yeni masaları ve normal diplomatik yazışmayı kapatır; savaşa bağlı ateşkes belgesi istisna olarak açık kalır. Sefer Masası, başkentin naiplikte olduğunu ve dönüşte oluşacak rıza yıpranmasını gösterir.

## Neden

Kralın cepheye gitmesi yalnızca moral ve anlık haber avantajı veriyor, başkent yönetimindeki bedeli fiilen işlemiyordu. Bu değişiklik, sefer komutası sunumundaki “Kral kalede / Kral seferde” seçimini gerçek bir yönetim tercihi yapar ve istemci yoluyla kuralın aşılmasını önler.

## Etkilenen dosyalar

- engine/war-regency.ts
- server/war-regency.ts
- app/api/general/route.ts
- app/api/negotiate/route.ts
- components/WarCampaignWorkspace.tsx
- tests/war-regency.test.ts
- package.json

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/war-regency.test.ts tests/war-king-command.test.ts tests/war-command.test.ts` başarılı: 9 test geçti.
- `npm test` başarılı: 723 test geçti.
- `npm run build` başarılı.
