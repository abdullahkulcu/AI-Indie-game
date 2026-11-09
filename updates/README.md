# `updates/` klasörü

Bu klasör, Demirkale üzerinde yapılan her anlamlı değişikliğin kısa bir
kaydını tutar. Kuralın tam metni ve gerekçesi kök dizindeki `CLAUDE.md`
içinde ("Yeni kural — her update sonrası `updates/` kaydı" bölümü) —
burada yalnızca formatı özetliyoruz, tekrar açıklamıyoruz.

## Format

- Dosya adı: `updates/YYYY-MM-DD-kisa-slug.md`
- İçerik: `# Başlık`, `Tarih:`, `## Ne değişti`, `## Neden`,
  `## Etkilenen dosyalar`, `## Test durumu`, (varsa) `## Takip gereken işler`.

## Ne zaman eklenir

Bug fix, yeni özellik, refactor, altyapı değişikliği — küçük yazım/typo
düzeltmeleri hariç, HER görev tamamlandığında. Bir görevi bu kayıt olmadan
"bitti" saymak `CLAUDE.md`'de emir kipiyle yasaklanmıştır.

## Kronoloji

Dosyalar tarih sırasıyla okunabilir (dosya adları zaten `YYYY-MM-DD` ile
başlar). Yeni bir dosya eklerken mevcutları düzenlemeyin — her update kendi
dosyasında kalıcıdır.
