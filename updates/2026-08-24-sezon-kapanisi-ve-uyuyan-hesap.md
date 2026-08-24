# Sezon süresi bitince krallık donuyor, bir aydır hareketsiz hesap siliniyor

Tarih: 2026-08-24

## Ne değişti

Cron'a iki tur eklendi (`server/lifecycle-desk.ts`, kuralları
`server/lifecycle.ts`):

1. **`closeEndedChannels`** — `channels.endsAt` geçmiş aktif sezonlar tek
   işlemde pasife alınıyor, üyelikleri de pasife düşüyor ve her üyenin
   defterine bir "SEZON" satırı yazılıyor.
2. **`purgeDormantAccounts`** — bir aydır hareket etmemiş hesaplar siliniyor.

Ayrıca `app/api/save/route.ts`: aktif üyeliği olmayan Kralın yazması artık
**423 (Locked)** ile reddediliyor ve `GET` cevabına `frozen` bayrağı eklendi.

Cron sırası bilinçli: kapanış EN BAŞTA (turun geri kalanı o sezonu
kendiliğinden atlar), silme EN SONDA (cascade, turların okuduğu satırları
altlarından çekmesin).

## Neden

**Sezon hiç bitmiyordu.** `channels.endsAt` kuruluşta yazılıyordu ama
**hiçbir yer okumuyordu** — tek okuyucusu `/api/channels`'ın "kaç gün kaldı"
etiketiydi. Süresi dolmuş sezon sonsuza kadar açık kalıyor, cron onu
ticklemeye devam ediyor, oyuncular bitmiş sezonda oynamayı sürdürüyordu.

**Ve sessiz bir kusur daha vardı.** `PUT /api/save`, aktif üyelik
bulunamadığında `channelSpeed: 1` varsayılanına düşüp kaydı KABUL EDİYORDU.
İki sonucu vardı: (a) bitmiş sezonda oyun sürüyordu, (b) ×24 tempolu bir
sezonun Kralı sezon kapandığı an farkında olmadan ×1 tempoya geçiyor ve büyüme
tavanlarını yeni tempoya göre doğrulatıyordu. Artık kapı kapalı.

423 seçildi, 409 DEĞİL: 409 istemciye "kopyan eski, sunucudakini al ve devam
et" demek ve istemci tam olarak bunu yapıyor — donmuş kayıtta sonsuz döngü
olurdu.

### Silmenin en önemli kararı: ölçüt "son giriş" DEĞİL

`lastLoginAt`'e bakan bir silme **aktif oynayan oyuncuyu silerdi.** Oturum
çerezi 30 gün yaşıyor (`server/account-auth.ts`), yani her gün oynayan bir Kral
bir daha hiç giriş yapmadan bir ay geçirebilir; eşik de tam 30 gün. Ölçüt bu
yüzden "son görülme":

```
en yeni( coalesce(last_login_at, created_at), coalesce(game_saves.updated_at, created_at) )
```

`game_saves.updated_at` oynarken 5 saniyede bir ilerlediği için gerçek bir
"son görülme" damgası ve bedava geliyor — yeni kolon ya da fazladan yazma yok.
Kaydı olmayan hesapta ölçüt girişe, girişi de yoksa kuruluşa düşüyor.

### Silmenin emniyetleri

- `admin` ASLA silinmiyor.
- Bir channel ya da Halk-AI kimliği OLUŞTURMUŞ hesap silinmiyor. Bu iki yabancı
  anahtar `NO ACTION` (kasıtlı — sezon tarihini koruyor) ve silme denemesi hata
  verip bütün cron turunu düşürürdü. Sayısı rapora `protected` olarak yazılıyor
  ki sessizce atlanmış olmasın.
- Tur başına en fazla `PURGE_BATCH` (200) hesap: hatalı bir eşik bütün tabloyu
  bir seferde götüremez.
- **`game_saves`in `users`a yabancı anahtarı YOK** (şemada `primaryKey`,
  referans değil). Cascade onu temizlemiyor, bu yüzden aynı işlemde ELLE
  siliniyor; yoksa her silinen hesap arkasında sonsuza kadar yaşayan bir krallık
  kaydı bırakırdı. Bu, şemayı okumadan yazılsa kaçırılacak bir ayrıntıydı.
- Rapor yalnızca SAYI veriyor; e-posta, ad ya da kimlik hiçbir yere yazılmıyor
  ve silme loglanmıyor (kısıt #4).

## Etkilenen dosyalar

- server/lifecycle.ts (yeni — eşikler ve cümle, DB'ye dokunmuyor)
- server/lifecycle-desk.ts (yeni — iki tur)
- app/api/cron/route.ts (iki tur bağlandı, rapora `seasons` ve `dormant`)
- app/api/save/route.ts (donmuş kayıt kapısı + `frozen` bayrağı)
- tests/yasam-dongusu.test.ts (yeni, 9 test)
- package.json (test koşu listesi)

## Test durumu

- `npm test` → **749/749 geçti** (740'tan 749'a).
- `npx tsc --noEmit` → temiz.
- `npm run lint` → 0 hata (tek uyarı `components/KingdomGame.tsx:132`, önceden
  de vardı).

CANLI DOĞRULAMA — gerçek Postgres + gerçek `/api/cron` + gerçek HTTP.

**Sezon kapanışı:** `ends_at` bir saat geçmişe alındı, cron çalıştı.
`{channels: 1, frozen: 3, noticed: 3}` — channel `inactive`, üç üyeliğin üçü
`inactive`, üç krallığın defterinde de *"Test Sezonu I sezonu kapandı.
Krallığınız bu haliyle donduruldu; artık ilerlemiyor."* Ardından aynı oyuncuyla:
`GET /api/save` → **200, `frozen: true`** (kayıt okunuyor, silinmedi);
`PUT /api/save` → **423**, *"Sezonunuz kapandı; krallığınız donduruldu ve artık
ilerlemiyor."*

**Uyuyan hesap silme:** altı vaka kuruldu, cron çalıştı,
`{deleted: 2, protected: 1}`.

| Vaka | Kurulum | Beklenen | Sonuç |
| --- | --- | --- | --- |
| Gerçekten uykuda | 40 gün önce giriş, kayıt da 40 gün önce | silinsin | silindi |
| **Her gün oynayan, 40 gündür giriş yok** | giriş 40 gün önce, kayıt BUGÜN | **kalsın** | **kaldı** |
| Hiç giriş yapmamış, kaydı yok | 40 gün önce açılmış | silinsin | silindi |
| Yeni hesap | 2 gün önce açılmış, giriş yok | kalsın | kaldı |
| Uykuda ama channel kurmuş | 40 gün + `created_by` | kalsın | kaldı (`protected: 1`) |
| Admin, 40 gündür giriş yok | 40 gün | kalsın | kaldı |

Silmeden sonra sahipsiz `game_saves` satırı sayısı: **0**.

## Takip gereken işler

- **Arayüz donmuş kaydı henüz göstermiyor.** `frozen` bayrağı sunucudan
  geliyor ama istemci onu okumuyor: sezonu kapanmış oyuncu saniyede bir
  tick'lemeye ve beş saniyede bir kaydetmeye devam eder, her seferinde 423 alır
  ve durum çubuğunda "YEREL YEDEK" görür. Yani ilerlediğini sanır. Sıradaki iş
  bu: `frozen` gelince tick ve kayıt döngüsünü durdurmak ve sebebini yazan bir
  bant göstermek.
- Silme UYARISIZ. Bir hafta önceden e-posta ya da defter uyarısı yok. Kullanıcı
  isterse iki aşamalı bir akış (önce "uyuyor" işareti, sonra silme) eklenebilir.
- Silme, canlı bir sezonun ortasındaki uykuda oyuncuyu da siler ve cascade onun
  müzakerelerini/anlaşmalarını götürür; yani KOMŞULARININ imzalı anlaşmaları da
  kaybolur. Cron sırası bunu azaltıyor (sezonlar önce kapanıyor) ama tamamen
  engellemiyor. Bilinçli bir kabul.
