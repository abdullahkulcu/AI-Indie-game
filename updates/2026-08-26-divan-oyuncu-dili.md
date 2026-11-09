# Divan oyuncu dili

Tarih: 2026-08-26

## Ne değişti

Divan ekranındaki oyuncuya görünen `cron` ifadesi kaldırıldı. Gündem okunduktan sonra ekran, bir sonraki Divanın krallık durumunu yaklaşık bir saat içinde yeniden değerlendireceğini söyler.

## Neden

Cron teknik bir altyapı terimidir; oyuncunun anlaması gereken şey, Divanın tekrar ne zaman durumu gözden geçireceğidir.

## Etkilenen dosyalar

- components/KingdomGame.tsx

## Test durumu

- Metin değişikliği; çalıştırılabilir davranış değişmedi.
