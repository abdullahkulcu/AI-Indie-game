# Eşzamanlı inşaat sırası

Tarih: 2026-11-08

## Ne değişti

İnşaatlar artık Kale seviyesine göre birden çok şantiyede eşzamanlı yürüyebiliyor. Dolu şantiyelerde yeni işler kaynakları ayrılarak bekleme sırasına ekleniyor; iş iptal edilirse ayrılan envanter eksiksiz ambara dönüyor. Binalar ekranına inşaat ve asker eğitiminin ayrı hatlarda görüldüğü Kraliyet İşleri panosu eklendi.

## Neden

Tek işlik eski kuyruk, krallık büyüdükçe gelişimi yapay biçimde yavaşlatıyor ve Kralın planladığı işleri görünmez kılıyordu. Kaynakların sıraya alınırken ayrılması, aynı malzemenin ikinci kez harcanmasını engeller; iptal seçeneği de yanlış planı geri alınabilir yapar.

## Etkilenen dosyalar

- engine/construction.ts
- engine/actions.ts
- engine/tick.ts
- engine/types.ts
- engine/founding.ts
- server/save-validation.ts
- server/night-shift.ts
- server/council-briefing.ts
- server/populace-feed.ts
- components/KingdomGame.tsx
- app/globals.css
- tests/engine.test.ts
- tests/night-shift.test.ts
- tests/save-validation.test.ts

## Test durumu

- `node --import tsx --test tests/engine.test.ts tests/night-shift.test.ts tests/save-validation.test.ts` — 105 başarılı
- `./run.sh check` — tip kontrolü temiz; lint 0 hata (KingdomGame içindeki önceden var olan 1 React bağımlılık uyarısı sürüyor)
- `npm test` — 745 başarılı, 0 başarısız
- `git diff --check` — temiz
