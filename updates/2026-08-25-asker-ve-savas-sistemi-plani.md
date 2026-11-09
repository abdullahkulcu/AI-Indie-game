# Asker çeşitleri ve birebir savaş sistemi planı

Tarih: 2026-08-25

## Ne değişti

Yeni asker sınıfları ve oyuncular arası birebir savaş için geliştirme öncesi tasarım planı hazırlandı. Plan; Mızrakçı, Kılıçlı, Okçu, Süvari ve Kuşatma Ekibinin insan gücü, kuruluş maliyeti, bakım gideri, saldırı/savunma, hız, kuşatma değeri ve eğitim süresini içeriyor. Ayrıca harita yol süresi, ikmal, üç safhalı deterministik çatışma, kuşatma, savaş amaçları, kartopu frenleri, teknik mimari, test stratejisi ve beş geliştirme fazı tanımlandı.

Aynı içeriğin karar odaklı 13 slaytlık PowerPoint sunumu oluşturuldu. Sunumdaki yeni değerler uygulanmış oyun değerleri değil, simülasyonla doğrulanması gereken dengeleme hipotezleri olarak işaretlendi.

## Neden

Mevcut oyunda yalnız Mızrakçı bulunuyor ve akın savunması birlik türlerini ayırmıyor. Oyuncular arası savaşı eklemeden önce yeni birliklerin ekonomi, nüfus, zaman ve bakım yüküyle birlikte tek bir modelde tanımlanması; çapraz oyuncu savaşının sunucuya ait, deterministik ve çevrimdışı oyuncuya adil bir süreç olarak planlanması gerekiyordu.

## Etkilenen dosyalar

- docs/plans/2026-08-25-asker-ve-birebir-savas-sistemi.md
- docs/demirkale-asker-ve-savas-sistemi-plani.pptx

## Test durumu

- PowerPoint 13 slayt olarak üretildi ve her slayt PNG olarak render edilip görsel olarak incelendi.
- `slides_test.py` — başarılı; taşma tespit edilmedi.
- PowerPoint yeniden render edildi; son düzeltme sonrası teknik mimari slaydı tekrar kontrol edildi.

## Takip gereken işler

- Geliştirmeden önce planın sonundaki altı tasarım kararı oyuncu/ürün sahibi tarafından onaylanmalı.
- Önerilen denge değerleri Faz A sırasında otomatik simülasyonlarla ayarlanmalı.
