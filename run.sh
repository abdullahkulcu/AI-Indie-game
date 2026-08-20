#!/usr/bin/env bash
#
# Demirkale — tek giriş noktası.
#
#   ./run.sh              docker yığınını başlat (postgres + app + cron)
#   ./run.sh help         bütün komutlar
#
set -euo pipefail
cd "$(dirname "$0")"

DEV_VARS=".dev.vars"
APP_URL="http://localhost:${WEB_PORT:-80}"
PG_HOST_URL="postgres://demirkale:demirkale@127.0.0.1:${PG_PORT:-5433}/demirkale"
PG_CONTAINER_URL="postgres://demirkale:demirkale@postgres:5432/demirkale"

bold(){ printf '\033[1m%s\033[0m\n' "$*"; }
info(){ printf '  %s\n' "$*"; }
warn(){ printf '\033[33m  ! %s\033[0m\n' "$*"; }
die(){ printf '\033[31m  ✕ %s\033[0m\n' "$*" >&2; exit 1; }

need(){ command -v "$1" >/dev/null 2>&1 || die "$1 bulunamadı."; }

# .dev.vars worker sırlarını tutar (miniflare okur). Yoksa güvenli varsayılanlarla üretilir.
ensure_dev_vars(){
  [ -f "$DEV_VARS" ] && return 0
  need node
  bold "$DEV_VARS bulunamadı, oluşturuluyor"
  local key hash invite secret
  key=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''))")
  invite="demirkale-admin-local"
  hash=$(node -e "console.log(require('crypto').createHash('sha256').update('$invite').digest('hex'))")
  secret=$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")
  cat > "$DEV_VARS" <<EOF
# Yerel Worker sırları. Yayına taşınmaz; git'e girmez.
BYOK_MASTER_KEY=$key
# sha256("$invite") — kayıt formunda bu davet kodu ile ilk admin açılır.
ADMIN_INVITE_HASH=$hash
CRON_SECRET=$secret
DATABASE_URL=$PG_CONTAINER_URL
EOF
  info "yönetici davet kodu: $invite"
}

read_dev_var(){ grep -E "^$1=" "$DEV_VARS" 2>/dev/null | head -1 | cut -d= -f2-; }

wait_healthy(){
  local name="$1" limit="${2:-60}" i=0 state
  while [ "$i" -lt "$limit" ]; do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo missing)
    [ "$state" = "healthy" ] && return 0
    [ "$state" = "unhealthy" ] && die "$name sağlıksız. ./run.sh logs ile bakın."
    sleep 5; i=$((i+1))
  done
  die "$name zamanında hazır olmadı. ./run.sh logs ile bakın."
}

cmd_up(){
  need docker; ensure_dev_vars
  bold "Demirkale ayağa kaldırılıyor"
  docker compose up -d
  wait_healthy ai-indie-game-postgres-1 24
  info "postgres hazır"
  wait_healthy ai-indie-game-app-1 60
  info "uygulama hazır → $APP_URL"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}'
  echo
  info "ilk kurulumda şemayı kurun:  ./run.sh db:push"
  info "logları izlemek için:        ./run.sh logs"
}

cmd_down(){ need docker; docker compose down; }
cmd_reset(){
  need docker
  warn "Bu, Postgres verisi dahil bütün docker volume'lerini siler."
  read -r -p "  emin misiniz? [e/H] " answer
  [ "$answer" = "e" ] || [ "$answer" = "E" ] || { info "vazgeçildi"; return 0; }
  docker compose down -v
}
cmd_logs(){ need docker; docker compose logs -f "${1:-}"; }
cmd_ps(){ need docker; ensure_dev_vars; docker compose ps; }

# Şema ve veri. Host'tan çalıştığı için 5433 portu kullanılır.
cmd_db_push(){ need npx; bold "şema Postgres'e uygulanıyor"; DATABASE_URL="$PG_HOST_URL" npx drizzle-kit push; }
cmd_db_migrate(){ need npx; bold "D1 verisi Postgres'e taşınıyor"; DATABASE_URL="$PG_HOST_URL" npx tsx scripts/migrate-d1-to-postgres.ts; }
cmd_psql(){ need docker; docker compose exec postgres psql -U demirkale -d demirkale; }

# Host'ta dev sunucusu: docker'daki postgres'e 5433 üzerinden bağlanır ve
# konteynerle aynı anda çalışmaması için ayrı port kullanır.
cmd_dev(){
  need npm; ensure_dev_vars
  warn "docker'daki app servisi çalışıyorsa önce ./run.sh down çalıştırın."
  info "host dev sunucusu → http://localhost:3001"
  DATABASE_URL="$PG_HOST_URL" VINEXT_NO_DEV_LOCK=1 npx vinext dev --port 3001
}

cmd_test(){ need npm; npm test; }
cmd_check(){ need npx; bold "tip kontrolü"; npx tsc --noEmit && info "temiz"; bold "lint"; npm run lint; }

# Gece vardiyasını beklemeden tetikler.
cmd_cron(){
  ensure_dev_vars
  local secret; secret=$(read_dev_var CRON_SECRET)
  bold "gece vardiyası tetikleniyor"
  curl -s -X POST "$APP_URL/api/cron" -H "x-cron-secret: $secret" -H 'content-type: application/json'
  echo
}

cmd_help(){
  cat <<'EOF'
Demirkale çalıştırma komutları

  ./run.sh                 docker yığınını başlat (postgres + app + cron)
  ./run.sh down            durdur
  ./run.sh reset           durdur ve VERİYİ SİL (onay ister)
  ./run.sh logs [servis]   logları izle (app | cron | postgres)
  ./run.sh ps              servis durumu

  ./run.sh db:push         şemayı Postgres'e uygula
  ./run.sh db:migrate      eski D1 verisini Postgres'e taşı
  ./run.sh psql            veritabanı kabuğu

  ./run.sh dev             host'ta dev sunucusu (port 3001, docker kapalıyken)
  ./run.sh test            testleri çalıştır
  ./run.sh check           tsc + lint
  ./run.sh cron            gece vardiyasını hemen tetikle

İlk kurulum:
  ./run.sh && ./run.sh db:push
EOF
}

case "${1:-up}" in
  up|"")        cmd_up ;;
  down)         cmd_down ;;
  reset)        cmd_reset ;;
  logs)         cmd_logs "${2:-}" ;;
  ps)           cmd_ps ;;
  db:push)      cmd_db_push ;;
  db:migrate)   cmd_db_migrate ;;
  psql)         cmd_psql ;;
  dev)          cmd_dev ;;
  test)         cmd_test ;;
  check)        cmd_check ;;
  cron)         cmd_cron ;;
  help|-h|--help) cmd_help ;;
  *)            die "bilinmeyen komut: $1  (./run.sh help)" ;;
esac
