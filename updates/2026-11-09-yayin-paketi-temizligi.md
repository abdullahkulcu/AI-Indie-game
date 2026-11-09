# Yayın paketi temizliği

Tarih: 2026-11-09

## Ne değişti

Yayın kaynağından geçici sunum oluşturma klasörü, iç içe kopyalanmış yerel depo,
PowerPoint/PDF sunum çıktıları ve sunum inceleme artıkları çıkarıldı. Çalışan
uygulama kodu, veritabanı göçleri, testler, yapay zekâ rehberleri ve temel
mimari/yayın belgeleri korunmuştur. Yayın denetiminde eksik olan son iki Divan
göç kaydı da sıralı göç defterine eklendi.
Üretim başlatmasında derleme çıktısının salt-okunur kaynak ağacına yazılamadığı
görüldü. Kaynak ağacı yazılabilir yapılmadan, kapsayıcı başlangıcında geçici bir
çalışma alanına kopyalanıp derleme yalnız orada yapıldı. macOS'ta geçici bellek
alanı çalıştırılabilir ikili dosyalara izin vermediği için bu alan kapsayıcıya
özel, çalıştırılabilir bir Docker hacmine taşındı.
Üretim başlangıcı ayrıca Cloudflare bağlarını destekleyen Worker çalışma zamanına
alındı; Node sunucusu bu bağları çözemediği için zamanlayıcı çağrısı 500 dönüyordu.

## Neden

Kopya depo içinde yerel çalışma ayarları bulunuyordu; sunum ve render
çıktıları ise uygulamanın çalışması için gerekli değildi. Yayın paketi yalnızca
tekrar üretilebilir kaynak ve işletim için gereken belgeleri içermelidir.
Göç dosyasının tek başına durması yeterli değildir; üretim çalıştırıcısının onu
görmesi için sıralı göç defterinde de yer alması gerekir.

## Etkilenen dosyalar

- .tmp/
- demirkale/
- docs/demirkale-*.pptx
- docs/demirkale-*.pdf
- docs/demirkale-*.inspect.ndjson
- docs/audits/
- drizzle/pg/meta/_journal.json
- docker-compose.prod.yml

## Test durumu

- `npm test` → 745 test başarılı.
- `./run.sh check` → tip kontrolü temiz; mevcut tek React Hook uyarısı dışında lint hatası yok.
- `npm run build` → üretim derlemesi başarılı.
