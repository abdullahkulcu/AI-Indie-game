# Divan düzenli değerlendirme aralığı

Tarih: 2026-08-26

## Ne değişti

Divan, saatlik kontrolünü koruyor. Karar bağlamı değiştiğinde hemen yeni gündem üretirken, hiçbir değişiklik yoksa da son gündemden en geç 12 saat sonra yeni bir değerlendirme hazırlıyor. Oyuncuya gösterilen “bir saat içinde” ifadesi bu davranışı açıklayan doğru metinle değiştirildi.

## Neden

Oyuncu bir saat sonra mutlaka yeni yorum geleceğini sanıyordu. Böylece saatlik kontrol ile yeni gündem garantisinin farklı şeyler olduğu açıkça anlatılıyor ve uzun sakin dönemlerde Divan sessiz kalmıyor.

## Etkilenen dosyalar

- server/council-schedule.ts
- server/council-briefing.ts
- components/KingdomGame.tsx
- tests/council-advisors.test.ts

## Test durumu

- `node --import tsx --test tests/council-advisors.test.ts`: başarılı (10/10)
- `npx tsc --noEmit`: mevcut çalışma ağacındaki eksik tip paketleri nedeniyle başlamadan hata verdi (`@types/react`, `@types/node` ve benzeri); değişiklikten kaynaklanan TypeScript hatası doğrulanamadı.
