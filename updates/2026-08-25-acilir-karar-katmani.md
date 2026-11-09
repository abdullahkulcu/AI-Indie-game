# Açılır karar katmanı

Tarih: 2026-08-25

## Ne değişti

Geniş karar katmanı kalıcı bir ekran olmaktan çıkarılıp açılıp kapanabilen bir çalışma alanına dönüştürüldü. Oyun ilk açıldığında yerel krallık sahnesi tam görünür; alttaki mühürlerden biri seçilince ilgili bölüm açılır. Seçili mühre yeniden basmak veya katmandaki “Sahneye dön” düğmesi paneli kapatır; rehber ve General görüşmesi gibi bağlamlar gerektiğinde paneli kendileri açar.

## Neden

Kalıcı geniş panel ana krallık sahnesini neredeyse tamamen örtüyor ve oyuncunun binalarla, harita görünümüyle ve sahne üzerindeki bilgi kartlarıyla ilişkisini koparıyordu. Yeni davranış, yerel sahneyi oyunun ana yüzeyi olarak korurken ayrıntılı karar ekranlarını ihtiyaç anında erişilebilir tutuyor.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- app/globals.css
- tests/istihbarat-tab.test.ts

## Test durumu

- `npm test` — 603 test geçti.
- `npx tsc --noEmit --pretty false --types node,react,react-dom,three` — geçti.
- `git diff --check` — geçti.
