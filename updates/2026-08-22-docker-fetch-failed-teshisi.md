# Docker "fetch failed" teşhisi

Tarih: 2026-08-22

## Ne değişti

Kod değişikliği YAPILMADI — bu bir teşhis/olay kaydıdır. Geliştirme
ortamında `@cloudflare/vite-plugin`'in Miniflare/workerd köprüsü çökmüş,
bunun sonucunda her istek (GET dahil) "fetch failed" hatasıyla 500
döndürmeye başlamıştı. `docker compose restart app` komutuyla sorun anlık
olarak çözüldü.

## Neden

Kullanıcı yerel geliştirme ortamında oyunu açamıyordu; her sayfa isteği
500 ile geri dönüyordu. Kök sebep kesin olarak doğrulanmadı ama en olası
açıklama şu: workerd'in yerel durumu (`.wrangler/state`) bir önceki
çalışmadan bozuk kalmış olması ya da bir çökme sonrasında köprünün kendini
toparlayamaması. Bu, `vite.config.ts` içindeki Cloudflare eklentisinin
(Miniflare üzerinden) her isteği bir workerd izole ortamına yönlendirmesiyle
ilgili bir kırılganlık olabilir.

## Etkilenen dosyalar

Yok (yalnızca konteyner yeniden başlatıldı; kod değişmedi).

## Test durumu

`docker compose restart app` sonrası uygulama normal yanıt vermeye başladı;
bu manüel olarak doğrulandı. Otomatik bir test veya health-check bu senaryoyu
kapsamıyor.

## Takip gereken işler

Kalıcı bir otomatik-iyileşme (autoheal) mekanizması henüz eklenmedi.
`docker-compose.yml`'deki `app` servisinin healthcheck'i zaten var
(`node -e "fetch('http://127.0.0.1:3000/')..."`) ama başarısız healthcheck
konteyneri otomatik yeniden başlatmıyor (`restart: unless-stopped` yalnızca
üretim örtüsünde `docker-compose.prod.yml` içinde tanımlı, taban dosyada
yok). Backlog önerisi: ya taban dosyaya da `restart` politikası eklemek ya da
healthcheck başarısızlığında konteyneri yeniden başlatan ayrı bir "autoheal"
sidecar (örn. `willfarrell/autoheal` imajı) eklemek. Kök sebebin
`.wrangler/state` bozulması mı yoksa başka bir şey mi olduğu da hâlâ kesin
doğrulanmadı; bir sonraki tekrarda `docker compose logs app` çıktısı
saklanmalı.
