# Kritik kararlarda halk nabzı

Tarih: 2026-11-06

## Ne değişti

Generalin teyit istediği orta ve ağır riskli emirler artık nitel bir halk nabzı sinyali taşıyor. Bu sinyal bekleyen karar ile saklanıyor ve General ekranında, Kral onay vermeden önce gösteriliyor.

## Neden

Riskli bir kararın yalnızca kaynak ve askerî tarafı değil, halkın olası tepkisi de görünür olmalıydı. Bilgiyi sayısal tahmine çevirmeden stratejik bir bağlam sağlamak hedeflendi.

## Etkilenen dosyalar

- server/general-risk.ts
- app/api/general/route.ts
- components/KingdomGame.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0025_pending_decision_people_pulse.sql
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/general-risk.test.ts

## Test durumu

`npx tsc --noEmit`, hedefli General risk testleri, `npm run lint`, tam `npm test` (674 test), `npm run build` ve `git diff --check` başarıyla çalıştı. Lint yalnızca daha önceden var olan `KingdomGame.tsx` Hook bağımlılığı uyarısını veriyor; hata yok.

## Takip gereken işler

- `0024_deep_intel_observation` ve `0025_pending_decision_people_pulse` migration'ları henüz veritabanına uygulanmadı.
