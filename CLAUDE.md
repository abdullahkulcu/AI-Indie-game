# Demirkale — proje rehberi

Demirkale, Cloudflare Workers üzerinde ("vinext" — Vite + wrangler/Miniflare)
çalışan, Kralın kendi BYOK LLM Generalini ikna ederek yönettiği çok oyunculu
persistent ortaçağ krallık simülasyonudur. Kod tabanı ve dokümantasyon TÜRKÇE.

Tam mimari ve şema için → **`docs/ARCHITECTURE.md`**
Geliştirme fazlarının dökümü için → **`docs/PHASES.md`**

Bu dosya kısa ve öz tutulur; detay yukarıdaki iki belgede yaşar, buraya
kopyalanmaz.

## Değişmez kısıtlar

Bunlar bu kod tabanının hiç değişmeyen kuralları. Bir değişiklik bunlardan
birini ihlal ediyorsa — yorumda "geçici" yazsa bile — durdurup düzeltin.

1. **`engine/` saf kalmalı.** `Math.random()` ve `Date.now()` (ve parametresiz
   `new Date()`, `crypto` global'i) YASAKTIR; zaman ve rastgelelik dışarıdan
   `now: number` parametresi ve tohumlu FNV-1a karması olarak gelir. Bu artık
   yalnızca yorumda değil, `eslint.config.mjs` içindeki `engine/**/*.ts`
   kural bloğuyla OTOMATİK denetleniyor — `npm run lint` bunu yakalar.
2. **Oyun durumu hesaplamaları adım-bölünmesinden bağımsız olmalı.** İstemci
   saniyede bir `tick()` atar, sunucu (`server/save-validation.ts`) tek büyük
   adımda `tick()` atar. İkisi aynı `now` için AYNI sonucu üretmek zorunda —
   kapalı-çözüm olmayan bir üstel ya da sıra-bağımlı bir toplama sapmaya yol
   açar ve sapma meşru bir kaydın 409 ile reddine, dolayısıyla oyuncunun
   ilerleme kaybına yol açar. Bu tarihte birden fazla kez gerçek bir hata
   olarak yaşandı (bkz. `engine/storage.ts`, `engine/market.ts` içindeki
   "kapalı çözüm" yorumları).
3. **Save şeması `.strict()`.** `server/save-validation.ts` içindeki
   `gameSaveSchema` bilinmeyen HİÇBİR alanı kabul etmez. Yeni bir
   server-derived alan `engine/types.ts`'e eklenip AYNI değişiklikte şemaya
   ve gerekiyorsa `SERVER_DERIVED` listesine eklenmezse, o alanı taşıyan
   TÜM kayıtlar reddedilir — bu, sessizce ilerleme kaybı demektir.
4. **Sır yazma/loglama/commit yasak.** API anahtarı, şifre hash'i, session
   token, cookie hiçbir `console.log`, defter kaydı (`notices`) ya da git
   commit'ine girmez. `llm_credentials.encrypted_key`/`iv` hiçbir yerde
   SELECT edilip görüntülenmez.
5. **Tek-doğru-kaynak ilkesi.** Bir kural yalnızca BİR yerde yaşar; kopyası
   başka bir dosyada elle tekrar yazılmaz. Bu ilke bu kod tabanında
   defalarca ihlal edilip düzeltildi — örnekler: bina kataloğu ve maliyet
   formülü önce dört ayrı yerde elle yazılıyordu (`components/KingdomGame.tsx`
   içindeki `found()`, `kingdomContext(null)` yedeği, `server/save-validation.ts`
   içindeki `STARTING_STATE`, ve nüfus kapasitesi formülü) ve `engine/founding.ts`
   ile tek kaynağa indirildi; müzakere konu listesi (`NEGOTIATION_TOPICS`)
   önce hem uçta hem araç şemasında elle yazılıyordu ve `engine/negotiation.ts`
   tek kaynağa alındı; pazar emrinin "verilirken ne çıkar / kapanınca ne
   girer" kuralı (`orderCost`/`orderPayout`) önce `engine/actions.ts` ve
   `server/save-validation.ts`'de ayrı ayrı yazılıyordu, `engine/market.ts`'e
   taşındı. Yeni bir kural eklerken önce "bu zaten bir yerde var mı" diye
   sorun.

## Yeni kural — her update sonrası `updates/` kaydı (ZORUNLU)

Bundan sonra bu projede yapılan **her anlamlı değişiklik/görev**
tamamlandığında (bug fix, yeni özellik, refactor, altyapı değişikliği — küçük
yazım/typo düzeltmeleri hariç), kök dizindeki `updates/` klasörüne yeni bir
dosya EKLENİR. Bu kaydı yapmadan bir görevi "bitti" saymak YASAKTIR — atlamak
demek gelecekteki oturumların bu değişikliği hiç görmemesi demektir.

**Dosya adı:** `updates/YYYY-MM-DD-kisa-slug.md`
(örn. `updates/2026-08-22-lint-temizligi.md`). Aynı gün birden fazla update
varsa slug'ı farklılaştırın (`-2`, `-3` değil, açıklayıcı ikinci bir slug).

**İçerik şablonu:**

```markdown
# Başlık

Tarih: YYYY-MM-DD

## Ne değişti

(özet, 2-5 cümle)

## Neden

(WHY — hangi sorunu çözdü / hangi ihtiyacı karşıladı; "ne" değil "niçin")

## Etkilenen dosyalar

- path/to/file.ts
- ...

## Test durumu

(tsc/lint/test sonucu — gerçekten çalıştırılan komutlar ve sonuçları)

## Takip gereken işler

(varsa; yoksa bu bölüm atlanabilir)
```

Format ve kuralın tam metni için → `updates/README.md`.

## Diğer notlar

- Komut satırı: `./run.sh help` tüm sık kullanılan komutları listeler
  (`./run.sh check` = tsc + lint, `./run.sh cron` = gece vardiyasını beklemeden
  tetikle).
- Test çalıştırma: `npm test` (37 dosya, `node --import tsx --test`).
- UI sekmeleri: `meclis`, `binalar`, `halk`, `ordu`, `istihbarat`, `defter`,
  `diyar`
  (`components/KingdomGame.tsx`).
