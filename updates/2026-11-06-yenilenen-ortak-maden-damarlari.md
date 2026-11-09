# Yenilenen ortak maden damarları

Tarih: 2026-11-06

## Ne değişti

Ortak demir damarı tükendiğinde son cevher önce ambarlara teslim ediliyor; ardından ekipler köylerine dönüyor ve aynı channel için deterministik konumlu yeni bir demir damarı açılıyor. Aktif damarın sırası ve harita konumu artık veritabanında saklanıyor; Diyar haritası bu konumu doğrudan okuyor. Maden işçisi sayısı da sunucu-türevi yapıldı; eski bir sekme işçileri hayalet biçimde madende bırakamaz.

## Neden

Önceki akış, cevheri sıfıra kadar düşürse de dünya için bir sonraki saha üretmiyor ve işçileri yerel üretimden eksik bırakabiliyordu. Bu değişiklik, madenin tükenmesini oyunun sonunda donan bir durum değil, Kralın yeniden işçi atayacağı yeni bir dünya fırsatı haline getirir.

## Etkilenen dosyalar

- engine/mine.ts
- engine/world-map.ts
- app/api/mine/route.ts
- app/api/world/route.ts
- db/schema.ts
- drizzle/pg/0014_shared_mine_veins.sql
- drizzle/pg/meta/_journal.json
- server/save-validation.ts
- components/KingdomGame.tsx
- tests/mine.test.ts
- docs/ARCHITECTURE.md
- docs/VERITABANI-SOZLUGU.md

## Test durumu

- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/mine.test.ts tests/world-map.test.ts` geçti (22 test).
- `npm run lint` hata vermeden geçti; `KingdomGame.tsx` içinde önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
