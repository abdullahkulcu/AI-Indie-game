# Lint temizliği: admin panel ve KingdomGame

Tarih: 2026-08-22

## Ne değişti

`app/admin/page.tsx` ve `components/KingdomGame.tsx` içindeki 12 eslint
hatası temizlendi: kullanılmayan importlar, kaçırılmamış tırnak karakterleri
(`react/no-unescaped-entities`), düz `<a>` etiketinin `next/link`'e
çevrilmesi, `useEffect` içinde doğrudan `setState` çağrısının düzeltilmesi ve
`jsx-a11y` klavye eşdeğeri (keyboard equivalent) uyarılarının giderilmesi.

## Neden

`npm run lint` kırmızıydı ve bu, `./run.sh check` akışını (tsc + lint) her
çalıştırdığında gürültü üretiyordu. Hatalar gerçek davranış bozukluğu
taşımıyordu (çoğu erişilebilirlik ve stil kuralı) ama birikince yeni,
gerçek hataların fark edilmesini zorlaştırıyordu.

## Etkilenen dosyalar

- `app/admin/page.tsx`
- `components/KingdomGame.tsx`

## Test durumu

- `tsc --noEmit`: temiz.
- `npm test`: 470 test geçti.
- `npm run lint`: belirtilen 12 hata giderildi (bu iki dosya için).

## Takip gereken işler

Yok.

Commit: `ac244e6` — "Lint hatalarını temizle: admin panel ve KingdomGame"
