# TLS — Demirkale'yi HTTPS ile yayına almak

Oturum çerezi güvenli bağlantıda `Secure` bayrağıyla yazılır ve bayrağı
`X-Forwarded-Proto` belirler (`server/account-auth.ts` → `isSecureRequest`).
Yani:

* **HTTPS** üzerinden gelen istekte çerez **her zaman** `Secure` alır.
* Düz HTTP'de bayrak yazılmaz — aksi halde tarayıcı çerezi hiç saklamaz ve
  `http://<vm-ip>` üzerinden **kimse giriş yapamaz**. (Yerelde `127.0.0.1`
  çalışıyor olması yanıltıcıdır: tarayıcı loopback'i güvenli sayar, gerçek IP'yi
  saymaz.)

Bu, TLS'i **isteğe bağlı kılmaz**. Düz HTTP'de oturum çerezi ağda açık gider.
Gerçek bir VM'de aşağıdaki adımları uygulayın.

## 1. Alan adını VM'ye yöneltin

`A` kaydı VM'nin genel IP'sini göstermeli. Let's Encrypt doğrulaması buna bakar.

## 2. Sertifikayı alın

Konteynerlerin dışında, host'ta, bir kez:

```bash
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d demirkale.example.com   # 80 boşken
```

Sertifikalar `/etc/letsencrypt/live/<alan-adı>/` altına düşer.
`./run.sh` çalışırken 80 portu nginx'te olduğu için ya önce `./run.sh down`
deyin ya da `--webroot` kullanın.

## 3. TLS profiliyle kaldırın

```bash
DOMAIN=demirkale.example.com docker compose --profile tls up -d
```

`tls` profili `nginx` yerine `nginx-tls` servisini çalıştırır:

* 80 ve 443'ü dinler, 80'i kalıcı olarak 443'e yönlendirir,
* `/etc/letsencrypt` dizinini salt-okunur bağlar,
* `X-Forwarded-Proto https` gönderir → çerez `Secure` yazılır,
* sahtelenebilir `CF-Connecting-IP` / `True-Client-IP` başlıklarını siler
  (bkz. `server/rate-limit.ts`).

Düz profil (`docker compose up -d`) yalnızca 80'i dinleyen `nginx` servisini
çalıştırır ve **yerel geliştirme içindir**.

## 4. Yenileme

```bash
sudo certbot renew --pre-hook 'docker compose --profile tls stop nginx-tls' \
                   --post-hook 'docker compose --profile tls start nginx-tls'
```

## Cloudflare'in arkasındaysanız

TLS'i Cloudflare bitiriyorsa nginx yerine kenar sertifikası kullanılır. O
durumda iki ayar gerekir:

1. Cloudflare "Full (strict)" modda olmalı; "Flexible" mod kenardan sonrasını
   düz HTTP yapar ve `X-Forwarded-Proto` yine `https` gelir ama trafik açıktır.
2. `CLIENT_IP_HEADER=cf-connecting-ip` verin. Cloudflare bu başlığı istemcinin
   gönderdiğini atıp kendisi yazar, dolayısıyla sahtelenemez. Bunu vermezseniz
   uygulama `x-real-ip` okur ve kenarın arkasında bütün istekler tek kovaya
   düşer (sınırlar aşırı sıkı çalışır).
