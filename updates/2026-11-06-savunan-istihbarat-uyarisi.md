# Savunan istihbarat uyarısı

Tarih: 2026-11-06

## Ne değişti

Savaş ilanında savunanın uyarı zamanı artık sabit değil. Savunanın saldıran hakkında taze ve başarılı ajan raporu varsa seferi toplanma anında öğrenir; yoksa sınır gözcüleri ordunun yürüyüşe geçmesiyle kimliği teyit eder. Uyarı gelene kadar savunanın Sefer Masası savaşın kimliğini, birliklerini ve olaylarını göstermez.

## Neden

Savaş planı, istihbarat seviyesinin savunana erken veya geç tepki penceresi açmasını gerektiriyordu. Önceki davranış bütün savunanlara aynı anda bütün bilgiyi veriyor ve keşif yatırımının anlamını azaltıyordu.

## Etkilenen dosyalar

- engine/war.ts
- db/schema.ts
- app/api/war/route.ts
- server/war-desk.ts
- drizzle/pg/0020_war_defender_intel_warning.sql
- drizzle/pg/meta/_journal.json
- tests/march.test.ts

## Test durumu

- Yerel geliştirme veritabanına `0020_war_defender_intel_warning` uygulandı.
- `npx tsc --noEmit` geçti.
- `node --import tsx --test tests/march.test.ts tests/war-command.test.ts tests/war-king-command.test.ts tests/war-reporting.test.ts` geçti: 14/14.
