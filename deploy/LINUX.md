# Demirkale — Linux sunucuda tam kurulum

Bu rehber Ubuntu 24.04 LTS üzerinde tek bir VM ve Docker Compose için yazılmıştır. Uygulama, PostgreSQL ve zamanlayıcı aynı özel Docker ağında çalışır; yalnız nginx internete açılır. Üretim örtüsü PostgreSQL'in geliştirme için kullanılan 5433 portunu da kapatır.

## 1. Sunucuyu hazırlayın

En az 2 vCPU, 4 GB RAM ve 30 GB kalıcı disk önerilir. DNS'te alan adınızın `A` kaydını sunucunun genel IP'sine yöneltin.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Oturumu kapatıp yeniden açın; ardından Docker'ı doğrulayın:

```bash
docker --version
docker compose version
```

Yalnız SSH, HTTP ve HTTPS'i açın. PostgreSQL'in üretimde yayınlanan bir host portu yoktur.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 2. Kodu alın ve üretim sırlarını oluşturun

```bash
sudo mkdir -p /srv/demirkale
sudo chown "$USER":"$USER" /srv/demirkale
git clone <GIT_DEPOSU_URL> /srv/demirkale
cd /srv/demirkale
```

`.dev.vars` konteynerde Worker sırlarını taşır. Dosyayı elle oluşturun; örnek değer veya geliştirme davet kodu kullanmayın.

```bash
umask 077
BYOK_KEY="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"
CRON_KEY="$(openssl rand -hex 24)"
ADMIN_CODE="buraya-tek-seferlik-guclu-davet-kodu-yazin"
ADMIN_HASH="$(printf %s "$ADMIN_CODE" | sha256sum | awk '{print $1}')"
cat > .dev.vars <<EOF
BYOK_MASTER_KEY=$BYOK_KEY
ADMIN_INVITE_HASH=$ADMIN_HASH
CRON_SECRET=$CRON_KEY
DATABASE_URL=postgres://demirkale:demirkale@postgres:5432/demirkale
# Cloudflare proxy kullanılacaksa: CLIENT_IP_HEADER=cf-connecting-ip
CLIENT_IP_HEADER=x-real-ip
EOF
chmod 600 .dev.vars
unset BYOK_KEY CRON_KEY ADMIN_CODE ADMIN_HASH
```

`BYOK_MASTER_KEY` sonradan değişirse mevcut oyuncu anahtarları çözülemez. Bu değeri şifreli parola kasasında saklayın; git'e, sohbet kayıtlarına veya loglara koymayın.

## 3. İlk üretim çalıştırması

İlk önce yalnız geçici HTTP ile uygulamanın derlenip veritabanı göçlerinin uygulandığını doğrulayın:

```bash
./run.sh prod
./run.sh logs app
curl -I http://127.0.0.1/
```

`app` sağlıklı olduktan sonra gerçek yayın için HTTPS kurun. Sertifika almadan önce 80 portunu kullanan yığını durdurun:

```bash
./run.sh down
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d oyun.ornekalanadi.com
DOMAIN=oyun.ornekalanadi.com ./run.sh prod:tls
```

Tarayıcıdan `https://oyun.ornekalanadi.com` adresini açın. İlk yönetici hesabı yalnız `ADMIN_INVITE_HASH` üretirken kullandığınız davet koduyla kaydolabilir. Başarılı kayıttan sonra bu kodu imha edin.

## 4. Sağlık kontrolleri

```bash
./run.sh ps
./run.sh logs app
./run.sh logs cron
curl -fsS https://oyun.ornekalanadi.com/ >/dev/null && echo "web hazır"
```

Cron konteyneri düzenli olarak `/api/cron` çağırır. Savaş, yürüyüş, kuşatma, halk ve gece vardiyası gibi zamanlı durumlar bu çağrıyla ilerler. Cron logunda sürekli `401` görürseniz `.dev.vars` içindeki `CRON_SECRET` değerini kontrol edin; uygulama ve cron aynı dosyayı okur.

## 5. Yedekleme ve geri yükleme

Her gece PostgreSQL yedeği alın. Yedek klasörünü uygulama diski dışında, erişimi kısıtlı bir depoya da kopyalayın.

```bash
sudo mkdir -p /var/backups/demirkale
sudo chmod 700 /var/backups/demirkale
docker compose exec -T postgres pg_dump -U demirkale -d demirkale | gzip > /var/backups/demirkale/demirkale-$(date +%F).sql.gz
```

Geri yükleme veri kaybı yaratır; önce mevcut yedeği alın, sonra uygulamayı durdurun:

```bash
./run.sh down
gunzip -c /var/backups/demirkale/demirkale-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U demirkale -d demirkale
DOMAIN=oyun.ornekalanadi.com ./run.sh prod:tls
```

## 6. Sürüm yükseltme

Göçler uygulama açılışında `drizzle-kit migrate` ile sıralı işlenir. Üretimde `db:push` kullanmayın; şema farkını yıkıcı biçimde uygulayabilir.

```bash
cd /srv/demirkale
git fetch --all --prune
git pull --ff-only
DOMAIN=oyun.ornekalanadi.com ./run.sh prod:tls
./run.sh logs app
```

Eski bir geliştirme veritabanı daha önce `db:push` ile kurulmuşsa yalnız bir kez şu sırayı uygulayın: `./run.sh db:push`, `./run.sh db:baseline`, `./run.sh db:up`. Sıfırdan kurulan üretim veritabanında bunu yapmayın.

## 7. Sertifika yenileme

Certbot yenilerken nginx 80/443'ü bırakmalıdır. Kök kullanıcının zamanlayıcısına aşağıdakini ekleyin; alan adını kendi alanınızla değiştirin:

```cron
15 3 * * * certbot renew --quiet --pre-hook 'cd /srv/demirkale && ./run.sh down' --post-hook 'cd /srv/demirkale && DOMAIN=oyun.ornekalanadi.com ./run.sh prod:tls'
```

## 8. Olay anında güvenli sıralama

- Uygulama hata veriyor ama Postgres sağlıklıysa: `./run.sh logs app` ile başlayın; `.dev.vars` içindeki sırları ekrana basmayın.
- Veri bozulması şüphesinde: önce SQL yedeği alın, sonra yazan konteynerleri `./run.sh down` ile durdurun.
- API anahtarı şüphesinde: oyuncunun BYOK bağlantısını panelden yeniden bağlatın; `BYOK_MASTER_KEY` yalnız mevcut tüm anahtarları yeniden şifrelemeye hazır olduğunuzda değiştirilebilir.
- Savaşların ilerlemediği şüphesinde: `./run.sh logs cron` ve `./run.sh cron` ile yalnız zamanlayıcı erişimini doğrulayın; oyun kayıtlarını elle değiştirmeyin.
