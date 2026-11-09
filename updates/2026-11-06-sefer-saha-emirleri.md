# Sefer saha emirleri

Tarih: 2026-11-06

## Ne değişti

Yürüyüşteki saldırı ordusuna “ilerle”, “mevzide kal” ve “geri çekil” emri
gönderme eklendi. Kral başkentteyse emir haberci hızında sahaya ulaşır; Kral
cephedeyse sonraki savaş kontrolünde derhal uygulanır. Henüz ulaşmamış ikinci
bir emir gönderilemez; ordu temasa geçtiyse geç kalan emir Defter'e rapor
olarak düşer.

## Neden

Sefer sürecinde karar, ekranda bir anlık düğme değişimi olmamalıdır. Oyuncu
emrin yetişip yetişmeyeceğini hesaba katmalı; General de emrin varışına kadar
önceden seçilen yaklaşımı korumalıdır.

## Etkilenen dosyalar

- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- db/schema.ts
- drizzle/pg/0019_war_field_commands.sql
- docs/VERITABANI-SOZLUGU.md
- tests/war-command.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/war-command.test.ts tests/war-support.test.ts tests/war-king-command.test.ts tests/war-populace.test.ts tests/march.test.ts tests/battle.test.ts tests/war-reporting.test.ts` — 22/22 geçti.
- `npm run lint` — hata yok; `components/KingdomGame.tsx` içindeki önceden var olan tek React Hook bağımlılık uyarısı sürüyor.
- Yerel PostgreSQL'e `war_commands` tablosu ve indeksleri uygulandı.
