# Sefer ikmal kalemleri

Tarih: 2026-11-07

## Ne değişti

Sefer Masası artık yalnızca tek bir asgari yiyecek sayısı göstermiyor.
Gidiş, mücadele, dönüş ve yüzde 20 güvenlik payı ayrı kalemler halinde
hesaplanıp gösteriliyor. Bu ayrımın hesabı `engine/march.ts` içinde tek
kaynak olarak tutuluyor; ilan edildiğinde ayrılan toplam da aynı hesapla
belirleniyor.

Savaş Defteri'nde de sahadaki olay anı ile habercinin saraya ulaştığı an
ayrı gösteriliyor. Böylece Kral, raporun eski bir saha bilgisini taşıdığını
görerek karar verebiliyor.


## Neden

Savaş sunumundaki sefer kuralı, Kralın ne kadar erzağın neden istendiğini
görebilmesini gerektiriyor. Tek toplam değer süre ve ikmal kararlarını
denetlenemez kılıyor; özellikle uzun rotalarda eksik erzakla sefer açılmış
gibi algılanmasına yol açıyordu.

## Etkilenen dosyalar

- engine/march.ts
- app/api/war/route.ts
- components/WarCampaignWorkspace.tsx
- app/globals.css
- tests/march.test.ts
- tests/war-reporting.test.ts

## Test durumu

- `npx tsc --noEmit` — geçti.
- `node --import tsx --test tests/march.test.ts tests/war-reporting.test.ts tests/war-support.test.ts` — 16/16 geçti.
