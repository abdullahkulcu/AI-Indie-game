# Nüfus Hesabında Kapalı Çözüm

Tarih: 2026-11-07

## Ne değişti

Nüfusun büyüme ve kayıp hesabı artık tek adımlı Euler yaklaşımı yerine kapalı matematiksel çözümler kullanıyor. Büyüme konut kapasitesine yaklaşırken lojistik eğriyi, kayıp ise orantılı üstel azalmayı izliyor. Zaman aralığını parçalara bölmenin sonucu değiştirmediğini doğrulayan bir regresyon testi eklendi.

## Neden

İstemci sık aralıklarla, sunucu ise daha seyrek güncelleme çalıştırabildiği için eski yaklaşım aynı süre sonunda farklı nüfus değerleri üretebiliyordu. Bu fark, kaydın sunucuda reddedilmesine veya nüfusun görünenden farklı ilerlemesine yol açabilirdi.

## Etkilenen dosyalar

- engine/populace.ts
- tests/populace.test.ts

## Test durumu

- `npx tsc --noEmit && node --import tsx --test tests/populace.test.ts tests/engine.test.ts` — başarılı (80 test)

## Takip gereken işler

Nüfus denklemi artık kendi içinde adım-bölünmesinden bağımsızdır. Tüm oyun durumunu kapsayan uzun aralıklı `tick()` akışında, rıza ve üretim gibi birbirini etkileyen hesapların da aynı kesinlikte ortak zaman dilimlerine ayrılması ayrı bir motor iyileştirmesi olarak değerlendirilmelidir.
