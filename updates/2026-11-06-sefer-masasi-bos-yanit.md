# Sefer Masası boş yanıt hatası

Tarih: 2026-11-06

## Ne değişti

Sefer Masası, savaş ucu boş ya da JSON olmayan bir yanıt döndürdüğünde ham ayrıştırma hatasını göstermiyor. Bunun yerine Kral'a savaş defterinin geçici olarak yanıt veremediğini söyleyen anlaşılır bir hata mesajı gösteriyor.

## Neden

Yerel geliştirme veritabanında savaş tabloları oluşturulmadan açık kalan eski uygulama süreci, `/api/war` çağrısında boş 500 yanıt veriyordu. İstemci bu yanıtı doğrudan JSON olarak okumaya çalıştığı için asıl neden yerine teknik `Unexpected end of JSON input` metni görünüyordu.

## Etkilenen dosyalar

- components/WarCampaignWorkspace.tsx

## Test durumu

- Yerel geliştirme veritabanına `drizzle-kit push --force` ile eksik şema uygulandı; `wars`, `war_armies`, `war_defenses`, `war_events` ve `war_reports` tabloları doğrulandı.
- Canlı yerel uygulama günlüğünde `/api/war` çağrıları 200 dönüyor.
- `npm test` — 646 geçti, 0 başarısız.
- `npx tsc --noEmit` — başarılı.
- `npm run lint` — 0 hata; KingdomGame içindeki mevcut React Hook bağımlılık uyarısı devam ediyor.
