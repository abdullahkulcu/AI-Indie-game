# Faz 6: göçün çok krallığa dağılması

Tarih: 2026-08-22

## Ne değişti

"Akıllı Halk ve Asker" projesinin son eksik parçası olan Faz 6 tamamlandı.
Şimdiye kadar bir krallıktan ayrılan nüfus (`engine/tick.ts` → `peopleLeft`)
yalnızca bir "GÖÇ" bildirimi bırakıp yok oluyordu. Artık bu nüfus, channel'daki
aktif ve kuruluş koruması bitmiş başka bir krallığa (boş konut + rızadan doğan
ağırlıklı bir seçimle, `engine/raids.ts`'in tohumlu `rand01`'i kullanılarak —
`Math.random()` yok) gerçekten ulaşabiliyor.

Yeni dosyalar: `engine/migration.ts` (saf hedef seçimi), `server/migration-desk.ts`
(göç kuyruğa alma), `tests/migration.test.ts` (13 test). Değişen dosyalar:
`app/api/cron/route.ts` (`settleMigrations` — dış kese/ortak maden ile aynı
"kaynakta olay olur, cron hedefe gecikmeli yazar" deseni), `app/api/save/route.ts`
(normal kayıtta kuyruğa alma), `db/schema.ts` (yeni `migrations` tablosu).

## Neden

Bu, DEVIRTESLIM-2026-08-21.md'de "🔴 BACKLOG, hiç başlanmadı" olarak işaretli
tek açık iş kalemiydi; "akıllı halk" projesinin kapanması için gerekliydi.

## Etkilenen dosyalar

- `engine/migration.ts` (yeni)
- `server/migration-desk.ts` (yeni)
- `tests/migration.test.ts` (yeni)
- `app/api/cron/route.ts`
- `app/api/save/route.ts`
- `db/schema.ts`
- `drizzle/pg/0004_whole_the_fallen.sql`, `0005_parched_centennial.sql` (+ meta)
- `package.json` (test listesi)

## Test durumu

- `tsc --noEmit`: temiz.
- `npm run lint`: 0 hata (1 önceden var olan, ilgisiz `exhaustive-deps` uyarısı hariç).
- `npm test`: 483 test geçti (470 önceki + 13 yeni).

## Takip gereken işler

**ÖNEMLİ — üretime almadan önce kontrol edin:** Bu işi yaparken, `db/schema.ts`
içindeki `agitations`/`populace_demands` tabloları ve `channel_members.accepts_agitation`
alanının hiçbir zaman `drizzle-kit generate` ile migration dosyasına dökülmediği
fark edildi (muhtemelen geçmişte `db:push` kullanılıp `db:generate` unutulmuş).
Bunun için AYRI bir düzeltme migration'ı (`0004_whole_the_fallen.sql`) üretildi.
**Üretim veritabanınızda `drizzle-kit migrate` çalıştırmadan önce şunu kontrol
edin:** `select to_regclass('public.agitations')`. Sonuç DOLU ise (tablo zaten
varsa), bu migration'ı olduğu gibi çalıştırmayın — drizzle'ın migration takip
tablosuna elle "uygulandı" olarak işlemeniz gerekir, aksi hâlde "relation already
exists" hatasıyla üretim açılışı durur (bkz. `docker-compose.prod.yml`'deki
`migrate` başarısızsa açılışın durduğu not).

Ayrıca gözden geçirilmesi gereken tasarım varsayımları (orijinal Faz 6 tasarım
belgesi artık erişilemediği için kod tabanından rekonstrükte edildi):
- Kuruluş koruması süren krallıklar göçmen alamaz (dış kesenin aynı kuralına dayanır).
- Hedef seçimi channel'daki TÜM aktif krallıklar arasından yapılıyor;
  `engine/world-map.ts`'teki konum yalnızca görsel, bir komşuluk kısıtı olarak
  kullanılmadı.
- Yeni bir `SERVER_DERIVED` alanı gerekmedi (`population`/`peopleJoined` zaten
  var olan alanlara yazılıyor).

Commit'ler: `f143657` (eksik migration'ı üret), `f74687b` (Faz 6'nın kendisi).
