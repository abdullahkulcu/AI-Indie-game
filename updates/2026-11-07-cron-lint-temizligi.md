# Cron lint temizliği

Tarih: 2026-11-07

## Ne değişti

Cron yolundaki kullanılmayan `UNIT_TYPES` ithali kaldırıldı.

## Neden

Lint hatası, kod kalitesi denetiminin başarısız olmasına neden oluyor ve gerçek uyarıları gölgeleyebiliyordu.

## Etkilenen dosyalar

- app/api/cron/route.ts

## Test durumu

- `npm run lint` — hata yok; mevcut React hook bağımlılığı uyarısı sürüyor.
