# Divan çağrısının işlenmesi ve görünürlüğü

Tarih: 2026-11-09

## Ne değişti

Divan'ın arka plan turu artık yalnızca hâlâ hesabı bulunan krallıkların kayıtlarını işliyor. Böylece silinmiş hesaplardan kalmış oyun kayıtları, bütün oyuncuların Divan gündeminin üretilmesini engellemiyor. Meclis ekranına ayrıca Kralın çağrısını, toplantı saatini ve gündemin hangi aşamada olduğunu açıkça gösteren bir toplanma emri kartı eklendi.

## Neden

Yetim iki oyun kaydı Divan belgesi yazılırken hesap ilişkisi hatası doğuruyor, bu da çağrılmış toplantının ekrana hiç gelmemesine yol açıyordu. Çağrı kayda geçse bile önceki tasarım yalnızca küçük bir üst bilgi gösterdiği için Kral toplantının sıraya alındığını kolayca fark edemiyordu.

## Etkilenen dosyalar

- server/council-briefing.ts
- app/api/cron/route.ts
- components/KingdomGame.tsx
- app/globals.css

## Test durumu

- Arka plan turu elle tetiklendi; çağrılmış Divan üç görüş ile üretildi ve `called` toplantı kaydı oluşturuldu.
- `./run.sh check`: tip kontrolü temiz; lint hatasız (projede var olan bir React Hook uyarısı sürüyor).
- `node --import tsx --test tests/council-advisors.test.ts tests/istihbarat-tab.test.ts`: 27 test geçti.
- `git diff --check`: temiz.
