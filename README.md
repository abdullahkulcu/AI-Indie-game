# Demirkale — Krallık Simülasyonu MVP

Tek bir yaşayan dünyada, Kralın kendi BYOK LLM Generalini ikna ederek yönettiği persistent ortaçağ krallık oyunu.

## Mimari kararı

TypeScript seçildi. React/Three.js arayüzü, Fastify API, dakikalık worker ve LLM adaptörleri aynı tip sistemini ve oyun kataloglarını paylaşır. Python veri/ML ağırlıklı bir üründe iyi bir seçenek olurdu; burada en büyük risk frontend, tool şemaları ve backend kurallarının birbirinden sapması olduğu için uçtan uca TypeScript daha güvenlidir.

- `app/`, `components/`: React 19 + Three.js izometrik oyun yüzeyi.
- `server/index.ts`: Fastify REST API ve channel/kingdom/BYOK uçları.
- `server/actions.ts`: LLM çıktısından bağımsız, atomik emir kotası ve önkoşul doğrulaması.
- `server/tick/`: Lazy kaynak üretimi, kuyruklar, kervanlar, kuşatmalar, olaylar ve saatlik pasif General.
- `server/llm/`: OpenAI, Anthropic ve OpenAI-uyumlu sağlayıcı adaptörleri; AES-256-GCM BYOK saklama; üç katmanlı kompakt bağlam.
- `migrations/`: PostgreSQL veri modeli ve 26 bina / 17 birim kataloğu.
- Redis: aynı krallık ve global tick için dağıtık kilit.

## Yerel çalıştırma

```bash
./run.sh              # postgres + uygulama + gece cron'u ayağa kaldırır
./run.sh db:push      # ilk kurulumda şemayı uygular
```

Web: `http://localhost` (80 portu; konteyner içinde 3000). İlk çalıştırmada `.dev.vars` (Worker sırları) ve
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

LLM yalnızca tool önerir. Kaynak, bina kilidi, nüfus, mesafe, kiralanabilir birlik, emir kotası, risk kademesi ve sahiplik sunucuda yeniden doğrulanır. API anahtarları log redaction ve AES-256-GCM ile korunur; production'da `BYOK_MASTER_KEY` yerine KMS zarf şifreleme adaptörü kullanılmalıdır.

## MVP kapsamı

Migration'larda channel/sezon, dışa büyüyen harita, kaynak/bina zincirleri, ordu ve kuşatma, kervan, vasallık, ittifak, itibar, asker kiralama, pazar/periyodik ticaret, casusluk, dünya olayları, bölgesel bülten, sezon sonucu ve kalıcı profil bulunur. Kural modülleri maden taper/derin kazı, nüfus/popülerlik, şenlik azalan getirisi, hareket/yorgunluk, savaş, fetih ve kazanma koşullarını çalıştırır.
