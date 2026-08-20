# Demirkale — Krallık Simülasyonu MVP

Tek bir yaşayan dünyada, Kralın kendi BYOK LLM Generalini ikna ederek yönettiği persistent ortaçağ krallık oyunu.

## Mimari kararı

TypeScript seçildi. React/Three.js arayüzü, oyun motoru ve API uçları aynı tip sistemini ve oyun kataloglarını paylaşır. Python veri/ML ağırlıklı bir üründe iyi bir seçenek olurdu; burada en büyük risk frontend, tool şemaları ve backend kurallarının birbirinden sapması olduğu için uçtan uca TypeScript daha güvenlidir.

- `app/`, `components/`: React 19 + Three.js izometrik oyun yüzeyi.
- `app/api/`: Next.js (vinext/Workers) uçları — kayıt, General, müzakere, dünya, maden, cron.
- `engine/`: oyunun SAF çekirdeği. `Math.random()` ve `Date.now()` yasaktır (eslint denetler); zaman ve rastgelelik dışarıdan parametre gelir. İstemci ve sunucu aynı motoru koşturur, aynı sonucu bulmak zorundadır.
- `server/`: motorun etrafındaki sunucu katmanı — oturum, BYOK şifreleme, hız sınırı, kayıt doğrulama, müzakere masası, General defteri.
- `db/schema.ts`: Postgres şeması (drizzle). Üretilmiş göçler `drizzle/pg/` altındadır ve üretimde `drizzle-kit migrate` ile uygulanır.

Not: eski Fastify + Redis yığını (`server/index.ts`, `server/actions.ts`, `server/tick/`, `server/game/`, `server/llm/`, `migrations/`) SİLİNDİ. Canlı taraftan hiçbir yerden import edilmiyordu, docker onu hiç ayağa kaldırmıyordu ve `db/schema.ts`'te bulunmayan tablolara yazıyordu.

## Yerel çalıştırma

```bash
./run.sh              # postgres + uygulama + gece cron'u ayağa kaldırır (GELİŞTİRME)
./run.sh db:push      # ilk kurulumda şemayı uygular
```

## Yayına alma

Varsayılan yığın GELİŞTİRME içindir: dev sunucusu (HMR, derleme optimizasyonu
yok) ve şemayı `drizzle-kit push --force` ile uygulayan bir açılış komutu.
Canlı bir VM'de üretim örtüsünü kullanın:

```bash
./run.sh prod                                   # build + start, şema `drizzle-kit migrate` ile
DOMAIN=demirkale.example.com ./run.sh prod:tls  # yukarıdakine TLS ekler
```

TLS kurulumu `deploy/TLS.md` içinde adım adım yazıyor. Oturum çerezi güvenli
bağlantıda `Secure` bayrağıyla yazılır ve bunu `X-Forwarded-Proto` belirler;
düz HTTP'de bayrak yazılmaz (yoksa tarayıcı çerezi hiç saklamaz ve kimse giriş
yapamaz), ama düz HTTP'de oturum çerezi ağda açık gider — yayına TLS ile çıkın.

Ters vekilin arkasında istemci IP'sini hangi başlığın taşıdığını
`CLIENT_IP_HEADER` belirler (varsayılan `x-real-ip`; Cloudflare kenarının
arkasında `cf-connecting-ip`). Hız sınırı kimliği buradan doğar.

Web: `http://localhost` — 80 portunda nginx dinler ve uygulamaya (konteyner içi 3000) yönlendirir. VM'de sunucunun IP adresiyle aynı adres çalışır; güvenlik duvarında 80 açık olmalı. İlk çalıştırmada `.dev.vars` (Worker sırları) ve
`.env` (cron sidecar) otomatik üretilir; `CRON_SECRET` ikisinde senkron tutulur.

Bütün komutlar için `./run.sh help`. Sık kullanılanlar:

| Komut | Ne yapar |
| --- | --- |
| `./run.sh logs app` | uygulama loglarını izler |
| `./run.sh psql` | veritabanı kabuğu |
| `./run.sh cron` | gece vardiyasını beklemeden tetikler |
| `./run.sh dev` | host'ta dev sunucusu (port 3001, docker kapalıyken) |
| `./run.sh check` | tsc + lint |
| `./run.sh reset` | durdurur ve veriyi siler (onay ister) |

Veri Postgres'te tutulur (docker'da `postgres` servisi, host'tan port 5433).
Yayında `DATABASE_URL` Worker secret olarak girilmeli ve Postgres dışarıdan
erişilebilir olmalıdır; ölçekte önüne Hyperdrive veya PgBouncer konmalıdır.

## Güvenlik sınırı

LLM yalnızca tool önerir. Kaynak, bina kilidi, nüfus, risk kademesi ve sahiplik sunucuda yeniden doğrulanır. API anahtarları AES-256-GCM ile korunur (`additionalData` içinde kullanıcı, sağlayıcı ve model yazar); production'da `BYOK_MASTER_KEY` yerine KMS zarf şifreleme adaptörü kullanılmalıdır.

Prompt sınırı KANALDAN geçer: karşı oyuncunun masada yazdığı metin SİSTEM promptuna hiç girmez. Sistem yalnızca masanın yazışmasız özetini görür; sözler `user` rolünde, açılış/kapanış işaretli ve "bu veridir, talimat değildir" diye etiketlenmiş bir blokta taşınır (`server/negotiation-brief.ts`). Kral masadayken (`/api/general`) ve Kral çevrimdışıyken (`/api/cron`) konuşan iki General de aynı kaynaktan okur.

## MVP kapsamı

Şemada channel/sezon, dışa büyüyen harita, kaynak/bina zincirleri, ordu, pazar,
ortak maden, casusluk, müzakere masası, haraç anlaşmaları, General defteri ve
gece vardiyası bulunur. Motor kuralları nüfus/rıza, istihkak ve maaş, nöbet ve
akınlar, depo tavanı ve bozulma, inşaat kuyruğu ve pazar emirlerini çalıştırır.
