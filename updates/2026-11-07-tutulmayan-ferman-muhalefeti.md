# Tutulmayan Fermanın Muhalefet Bedeli

Tarih: 2026-11-07

## Ne değişti

İlan edilen yiyecek ya da asker maaşı fiilen dağıtılamadığında, görünür fark yeterince büyükse iç muhalefet baskısı daha yüksek bir hedefe ve daha hızlı bir eğriye yöneliyor. Göç hedefini seçen yeni bir araç eklenmedi; halk yalnızca kendi yaşadığı sonuç üzerinden tepki veriyor.

## Neden

Halkın fermanla gerçek dağıtım arasındaki farkı dile getirmesi tek başına mekanik sonuç doğurmuyordu. Vizyon belgesindeki kabul edilmiş karar, bu tür açık çelişkinin doğal rıza/nüfus kaybına ek olarak siyasi bedel üretmesiydi.

## Etkilenen dosyalar

- engine/faction.ts
- engine/tick.ts
- tests/faction.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/faction.test.ts tests/populace-voice.test.ts` başarılı (66 test).
