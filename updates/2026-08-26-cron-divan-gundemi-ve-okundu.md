# Cron Divan gündemi ve okundu akışı

Tarih: 2026-08-26

## Ne değişti

Divan'ın Halk, Garnizon ve General görüşleri ekran açılışında üretilmek yerine `council_briefings` tablosunda saklanmaya başlandı. Cron, değerlendirmeden önce kaydı saf `tick()` ile kendi zamanına taşır; yalnızca gündem yoksa, Kral önceki gündemi okuduktan sonra karar bağlamı değişmişse veya okunmamış gündem 24 saat beklemişse görüş üretir. Meclis ekranındaki düğme artık "Okudum" onayıdır; belge yalnızca okunur ve yeni gündem için cron beklenir.
Divan metinleri en fazla iki tam cümleye yönlendirilir, çağrı tavanı 110 tokene çekilir ve token tavanında yarım kalan yanıt son tamamlanmış cümleye kırpılır; tamamlanmış cümle yoksa kural yedeği gösterilir. Önceden önbelleğe alınmış yarım metinler de okunurken aynı süzgeçten geçer; böylece yeni bir model çağrısı yapılmadan güvenilir yedek ses kullanılır.
General, Halk ve Garnizon için ayrı rehber dosyaları ile ortak AI kuralları eklendi. Kralın General sohbeti, Divan, Halk sesi, gece vardiyası ve çevrimdışı müzakere çağrıları ilgili rol rehberini sistem mesajında birlikte taşır.

## Neden

Her ekran açılışında üç bağımsız LLM çağrısı yapılıyor, aynı görüş tekrar tekrar üretiliyor ve gereksiz token harcanıyordu. Okunmamış gündemi sabitlemek hem Kralın karar akışını sakinleştirir hem LLM maliyetini sınırlar.

## Etkilenen dosyalar

- app/api/council/route.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- db/schema.ts
- drizzle/pg/0009_council_briefings.sql
- server/council-briefing.ts
- server/council-advisors.ts
- server/ai-guides.ts
- ai-guides/ortak-kurallar.ts
- ai-guides/general.ts
- ai-guides/halk.ts
- ai-guides/garnizon.ts
- server/council-schedule.ts
- docs/ARCHITECTURE.md
- tests/council-advisors.test.ts
- tests/populace-ai-credentials.test.ts

## Test durumu

- `npm test` geçti (626 test).
- `npm run lint` geçti; önceden mevcut olan `components/KingdomGame.tsx` React Hook bağımlılık uyarısı sürüyor.
- `npm run build` geçti.
- Yerel Docker Postgres'e `council_briefings` tablosu ve indeksi eklendi.

## Takip gereken işler

- Üretim ortamında `drizzle/pg/0009_council_briefings.sql` migration'ı uygulanmalı.
