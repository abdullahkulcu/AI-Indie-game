# Divan yedek gündemini okundu işaretleme

Tarih: 2026-08-26

## Ne değişti

AI belgesi henüz cron tarafından üretilmemişken gösterilen deterministik Divan gündemi artık Kral tarafından kapatılabilir. Okundu işareti sunucuda, o anki oyun durumundan türetilen kaynak anahtarıyla saklanır; aynı durum için cron tekrar gündem açmaz, anlamlı değişimde ise normal gündem akışı devam eder.

## Neden

Kartlar kural yedeği gösterirken “Okudum” düğmesinin pasif kalması, kullanıcıya gösterilen bir gündemi kapatmasını engelliyordu.

## Etkilenen dosyalar

- app/api/council/route.ts
- components/KingdomGame.tsx
- server/council-briefing.ts

## Test durumu

- `npm run build` geçti.
