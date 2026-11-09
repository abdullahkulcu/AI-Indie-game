# Uzun süreli abluka

Tarih: 2026-11-06

## Ne değişti

Sefer Masası'na açık sınır ablukası eklendi. Abluka kuvveti hedefe yürür,
sınırda kalırken erzak tüketir; hedefte zamanla halk/garnizon baskısı
oluşturur ve erzak bittiğinde otomatik olarak dönüşe geçer. Abluka boyunca
birliklerin saha deneyimi de tam oyun günlerinde artar.

## Neden

Anlık yağma ve kuşatmadan farklı olarak, asker kaybı yerine ikmal, zaman ve
kendi garnizonundan vazgeçme maliyetiyle baskı kuran uzun süreli bir strateji
gerekiyordu. Bu, hedefin iç düzenini doğrudan savaş ilanı olmadan zorlar;
ancak imzalı saldırmazlığı ihlal ederse anlaşma bozulur ve itibar bedeli doğar.

## Etkilenen dosyalar

- engine/blockade.ts
- engine/war.ts
- engine/units.ts
- server/war-desk.ts
- app/api/war/route.ts
- app/api/general/route.ts
- components/WarCampaignWorkspace.tsx
- components/KingdomGame.tsx
- db/schema.ts
- drizzle/pg/0022_war_blockade.sql
- docs/VERITABANI-SOZLUGU.md
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- tests/blockade.test.ts

## Test durumu

- `node --import tsx --test tests/blockade.test.ts tests/units.test.ts tests/march.test.ts tests/siege.test.ts` — geçti (23 test)
- `npx tsc --noEmit` — geçti
- `npm run lint` — hata yok; KingdomGame'teki önceden var olan tek hook bağımlılığı uyarısı sürüyor
- `git diff --check` — geçti
- `npm test -- --test-reporter=dot` — geçti (662 test)
