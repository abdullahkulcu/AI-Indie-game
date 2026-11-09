# Haritadaki maden ekibi sayısı düzeltildi

Tarih: 2026-11-08

## Ne değişti

Diyar Haritasındaki ortak maden düğmesi, üzerinde yazanla tutarlı biçimde en fazla beş işçi gönderir. Maden kapasitesi yetersizse hata artık boş yuva ve istenen işçi sayısını açıkça belirtir.

## Neden

Harita düğmesi “5 işçi gönder” yazarken arka planda nüfusun yüzde onunu göndermeye çalışıyordu. Büyük nüfuslu krallıklarda bu sayı madenin 60 kişilik ortak kapasitesini aşıyor ve boş yer olsa bile yanıltıcı bir “yer kalmadı” mesajı üretiyordu.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- app/api/mine/route.ts

## Test durumu

- `npm run lint`: hata yok; mevcut React Hook bağımlılık uyarısı sürüyor.
- `node --import tsx --test tests/mine.test.ts tests/mine-roster.test.ts`: 19 geçti, 0 başarısız.
