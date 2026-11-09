# Sefer Masası karar katmanı

Tarih: 2026-11-06

## Ne değişti

Sefer Masası, ana uygulamadan ayrılan tam ekran bir sayfa olmaktan çıkarıldı. Artık Savaş bölümünün içindeki geniş karar katmanında açılıyor; kale sahnesi, üst kaynak şeridi ve alt mühür menüsü görünür kalıyor.

## Neden

Kral sefer emrini verirken krallık bağlamını kaybetmemeli. Aynı katman yapısı Ordu, Diyar ve diğer karar alanlarıyla tutarlı bir geçiş sağlar.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- app/globals.css
- tests/istihbarat-tab.test.ts

## Test durumu

- `node --import tsx --test tests/istihbarat-tab.test.ts` — 15/15 geçti.
- `npx tsc --noEmit` — geçti.
