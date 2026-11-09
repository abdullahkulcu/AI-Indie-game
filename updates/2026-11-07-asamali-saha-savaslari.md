# Aşamalı saha savaşları

Tarih: 2026-11-07

## Ne değişti

Saha savaşı artık temasın ardından atış, hat çatışması ve takip olmak üzere üç ayrı zamanlanmış safhada çözülür. Her safhanın sonucu savaş defterine ve haberci raporuna ayrı düşer; Kral yürüyüşte veya safhalar arasındayken ilerleme, mevzide kalma ya da geri çekilme emri verebilir. Sefer Masası bir sonraki safhanın zamanını, mevcut safha sayacını, sahadaki birlik sayısını, morali ve ikmali gösterir; savunan Kral veya dışarıdan gönüllü birlik gönderen komşu da safhalar arasındaki açık pencerede takviye yetiştirebilir. Savunmaya yardım itibar kazandırır; saldırana ikmal veya geçiş hakkı vermek sınırlı itibar bedeli taşır. Bu destekler artık iki savaşan Krallıkla karşılıklı diplomatik ilişki hafızasına da yazılır ve Diyar/İlişkiler ekranında görünür. Savunan halkın rızası ve iç baskısı her saha kaybında ilerler; ganimet ve itibar ise yalnız kesin sonuçta yazılır. Savaş sürerken açılan ateşkes belgesi de artık Elçilik Masası'na bağlıdır: elçi yoldayken bir sonraki tırmanma safhası sınırlı süre ertelenir; karşı Kral imzalarsa çatışma durur, ancak saldıran ordu zaman alan gerçek dönüş yolunu tamamlar.

## Neden

Tek cron turunda tamamlanan savaş, Kralın cephede karar vermesine ve haberci gecikmesini hissetmesine fırsat bırakmıyordu. Safhalar aynı deterministik hesapla çalışmaya devam eder; yalnızca karar ve rapor pencereleri takvime yayılır.

## Etkilenen dosyalar

- engine/battle.ts
- engine/march.ts
- engine/war.ts
- db/schema.ts
- drizzle/pg/0031_war_battle_phases.sql
- drizzle/pg/0032_war_truce_negotiations.sql
- drizzle/pg/0033_diplomatic_relations.sql
- drizzle/pg/meta/_journal.json
- server/war-desk.ts
- app/api/negotiate/route.ts
- components/WarCampaignWorkspace.tsx
- tests/battle.test.ts
- tests/war-command.test.ts
- tests/war-reporting.test.ts
- tests/war-support.test.ts
- tests/war-populace.test.ts
- tests/war-truce.test.ts
- package.json

## Test durumu

- `npx tsc --noEmit` başarılı.
- `npm test` başarılı: 720 test geçti.
- `npm run build` başarılı.
- `npm run lint` hata vermedi; `components/KingdomGame.tsx` içinde önceden bulunan bir React Hook bağımlılık uyarısı sürüyor.

## Takip gereken işler

- Canlı veritabanı için `0030_war_support_kinds.sql`, `0031_war_battle_phases.sql`, `0032_war_truce_negotiations.sql` ve `0033_diplomatic_relations.sql` migration'ları dağıtım sırasında uygulanmalı.
