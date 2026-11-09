# Divan toplantı geçmişi

Tarih: 2026-11-08

## Ne değişti

Divan'ın tek güncel belgesine ek olarak, toplantılar kalıcı bir geçmişte saklanmaya başladı. Meclis sayfası son üç toplantıyı, son toplantının zamanını ve planlanan sonraki olağan Divanı gösteriyor; Defter de aynı üç kaydı karar akışının üstünde sunuyor. Kral gündemi okuduğunda geçmiş kaydına bu durum işleniyor.

## Neden

Önceki yapıda yeni bir Divan belgesi eskisini ezdiği için Kral toplantıların ne zaman yapıldığını ve daha önce hangi görüşlerin sunulduğunu takip edemiyordu. Güncel gündem yalın kalırken son üç toplantının izlenebilir olması gerekiyordu.

## Etkilenen dosyalar

- db/schema.ts
- drizzle/pg/0036_blue_ego.sql
- drizzle/pg/meta/_journal.json
- drizzle/pg/meta/0036_snapshot.json
- server/council-briefing.ts
- app/api/council/route.ts
- components/KingdomGame.tsx
- app/globals.css
- tests/istihbarat-tab.test.ts

## Test durumu

- `./run.sh check` — tip kontrolü temiz; önceden var olan bir React Hook bağımlılık uyarısı kaldı.
- `npm test` — 745 test geçti.
- `node --import tsx --test tests/istihbarat-tab.test.ts` — 17 arayüz sözleşmesi geçti.
- `git diff --check` — temiz.
- `./run.sh db:push` — yerel geliştirme veritabanında `next_at` ve `council_meeting_history` şeması uygulandı.
- `./run.sh db:baseline` — önceden push ile kurulmuş yerel veritabanının 37 migration kaydı Drizzle defterine damgalandı.
- Yerel geçiş doğrulaması — mevcut 2 Divan belgesi geçmiş tablosuna taşındı.

## Takip gereken işler

- Başka eski push-kurulumlu ortamlar da üretim migration yoluna geçmeden önce proje yönergesindeki `db:push`, ardından `db:baseline` akışını bir kez izlemelidir.
