# `run.sh` sağlık beklemesi konteyner adını sabit yazmayı bıraktı

Tarih: 2026-08-23

## Ne değişti

`wait_healthy` artık konteyner adı değil SERVİS adı alıyor ve kimliği
`docker compose ps -q <servis>` ile compose'un kendisinden soruyor. Çağrılar
`ai-indie-game-postgres-1` / `ai-indie-game-app-1` yerine `postgres` / `app`
oldu. Healthcheck'i olmayan servis için `.State.Health` boş döndüğü için o
durum artık `none` sayılıyor; boş dizge bir durum sanılmıyor. Hata mesajları
da hangi servise bakılacağını söylüyor (`./run.sh logs postgres`).

## Neden

Compose proje adı dizin adından türer. Repo `demirkale/` diye klonlandığında
konteynerler `demirkale-postgres-1` oluyor, sabit yazılan
`ai-indie-game-postgres-1` ise hiç var olmuyor; `docker inspect` "missing"
dönüyor, döngü tavana kadar bekliyor ve `./run.sh` postgres sapasağlam
ayaktayken "zamanında hazır olmadı" diye düşüyordu. Gerçek bir kurulumda
yaşandı: kayıtta postgres 07:42:21'de "ready to accept connections" derken
betik yine de öldü.

`docker-compose.yml` başındaki yorum `COMPOSE_PROJECT_NAME=demirkale-b` ile
yan yana kopya çalıştırmayı zaten öneriyordu — yani sabit ad o desteklenen
kullanımda da bozuktu.

## Etkilenen dosyalar

- run.sh

## Test durumu

`bash -n run.sh` temiz. Bu oturumda docker daemon'ı olmadığı için uçtan uca
(`./run.sh` → healthy) denenemedi; değişiklik yalnızca kimlik çözümlemesini
compose'a devrediyor, bekleme/ölme mantığı aynı kaldı.

## Takip gereken işler

`./run.sh` (push) ile `./run.sh db:up` (migrate) AYNI veritabanında
çarpışıyor: konteyner açılışta `drizzle-kit push --force` çalıştırıp tabloları
kuruyor, sonra host'tan gelen `migrate` göç defteri boş olduğu için
`0000`'dan başlayıp `relation "channel_members" already exists` ile düşüyor.
Bu da gerçek bir kurulumda yaşandı. Betik bugün bunu engellemiyor; `db:up`
başlarken defterin boş ama şemanın dolu olduğunu görüp "önce db:baseline"
diye durması gerekir.
