# Savaşta Birlik Desteği ve Geçiş Hakkı

Tarih: 2026-11-07

## Ne değişti

Uzak savaş ekranına iki yeni karar eklendi: savunana gönüllü birlik yollamak ve saldırana geçiş hakkı vermek. Gönüllü birlikler destekçinin garnizonundan ayrılır, savaş alanına zamanla varır, aldıkları kayıplar kendi birlik havuzlarına yazılır ve hayatta kalanlar sefer bitince yalnız kendi kayıt kimliklerine döner. Geçiş hakkı, saldıran ordunun kalan rota süresini yüzde on beş azaltır ve güncellenen varış zamanı savaş takvimine yazılır.

## Neden

Sefer tasarımında destek yalnız yiyecekten ibaret değildi: savunana birlik, saldırana geçiş hakkı ve bunların zaman/rota sonucu açıkça isteniyordu. Önceki uygulama yalnız ikmal konvoyunu taşıyordu; birlikleri kopyalamadan ve kaybetmeden savaşta kullanacak, geçiş iznini de gerçek bir takvim etkisine çevirecek kalıcı bir akış yoktu.

## Etkilenen dosyalar

- engine/march.ts
- server/war-desk.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- app/globals.css
- db/schema.ts
- drizzle/pg/0030_war_support_kinds.sql
- drizzle/pg/meta/_journal.json
- tests/war-support.test.ts

## Test durumu

- `npx tsc --noEmit` başarılı
- `node --import tsx --test tests/war-support.test.ts tests/war-reporting.test.ts` başarılı (9/9)

## Takip gereken işler

- `0030_war_support_kinds.sql` canlı veritabanına uygulanmalı.
- Üç hesapla birlik desteğinin cepheye varışı, kaybı ve dönüşü uçtan uca denenmeli.
