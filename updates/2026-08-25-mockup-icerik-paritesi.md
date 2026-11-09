# Mockup içerik paritesi

Tarih: 2026-08-25

## Ne değişti

Karar katmanındaki dört ana bölüm, mockuptaki on bir gerçek çalışma sayfasına ayrıldı: Divan altında Meclis, General ve Defter; Krallık altında Binalar, Halk ve Pazar; Savaş altında Ordu ve Dolaylı Mücadele; Diyar altında Harita, İlişkiler ve Müzakere. Sayfalar yalnızca yeni bir kabukla değil, mockuptaki karar belgesi, danışman görüşleri, toplumsal gruplar, sorunlar, hazırlık özeti, operasyon kurucu, kronolojik akış, ilişki kartları, anlaşma belgesi ve elçi yazışmaları gibi içeriklerle dolduruldu. Pazar ve Diyar bileşenleri aynı gerçek oyun kurallarını kullanan gömülü çalışma alanları hâline getirildi.

Dolaylı Mücadele akışı operasyon → hedef → yöntem/kaynak → General adımlarını izliyor. Motorun desteklemediği düşük/yoğun yaklaşım, kalıcı casus ağı ve ayrı halk hareketi örgütleme sistemi çalışıyormuş gibi sunulmuyor; bunlar arayüzde açıkça geliştirme bekleyen seçenekler olarak gösteriliyor.

## Neden

Önceki uygulama mockupın genel yerleşimini taşıyor, fakat sayfa içeriklerinin çoğu eski paneller olarak kalıyor veya hiç bulunmuyordu. Oyuncunun her sayfada hangi kararı verebileceğini ve kararın hangi gerçek oyun verisine dayandığını aynı bilgi mimarisi içinde görmesi gerekiyordu.

## Etkilenen dosyalar

- components/KingdomGame.tsx
- components/ChannelWorldMap.tsx
- components/MarketWorkspace.tsx
- app/globals.css
- app/world-map.css
- tests/istihbarat-tab.test.ts

## Test durumu

- `npx tsc --noEmit --pretty false --types node,react,react-dom,three` — başarılı.
- `node --import tsx --test tests/istihbarat-tab.test.ts` — 14/14 başarılı.
- `npm test` — 609/609 başarılı.
- `git diff --check` — başarılı.

## Takip gereken işler

- Yerel geliştirme sunucusu bu çalışma ortamında Vinext başlığından sonra port dinlemeye geçmediği için tarayıcı tabanlı son piksel kontrolü yapılamadı.
- Halk hareketlerini ayrı bir operasyon ve düşük/yoğun yaklaşım seçeneklerini gerçek mekanik hâline getirmek için önce oyun motoru ve sunucu eylemlerinin eklenmesi gerekir.
