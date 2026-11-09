# Mockup etkileşimleri ve karar çalışma alanları

Tarih: 2026-08-25

## Ne değişti

Diyar haritasındaki sancak paneline istihbarat seviyesi, rapora dayalı bilinen zayıflıklar, diplomatik durum ve doğrudan müzakereye geçiş eklendi. Yerel sahnedeki bina gövdeleri ve etiketleri tıklanabilir hâle getirildi; seçim, binanın kısa bilgisini ve yapı kararlarına geçişi açıyor. Eski küçük Pazar çekmecesi karşılaştırma tablosu ile iki yönlü işlem panelinden oluşan tam çalışma alanıyla değiştirildi; Müzakere ekranı da masa seçimi, anlaşma belgesi ve elçi yazışmalarını birlikte gösteren geniş düzene taşındı. Sahne etiketlerinin karar katmanlarının üstüne çıkmasına neden olan z-index sırası düzeltildi.

## Neden

Uygulanan arayüz mockup'ta onaylanan bilgi mimarisini taşımıyordu: Diyar yalnızca ham rapor gösteriyor, binalar etkileşimsiz kalıyor, Pazar ve Müzakere eski çekmece düzenini kullanıyor ve sahne isimleri açık menülerin üstüne çıkıyordu. Oyuncunun haritadan bağlam okuyup tek akışta karar verebilmesi ve ana sahneyi kaybetmeden ayrıntıya geçebilmesi için bu eksikler giderildi.

## Etkilenen dosyalar

- components/KingdomScene.tsx
- components/KingdomGame.tsx
- components/ChannelWorldMap.tsx
- components/MarketWorkspace.tsx
- app/globals.css
- app/world-map.css
- tests/istihbarat-tab.test.ts

## Test durumu

- `npx tsc --noEmit --pretty false --types node,react,react-dom,three` — başarılı.
- `node --import tsx --test tests/istihbarat-tab.test.ts` — 13/13 başarılı.
- `npm test` — 608/608 başarılı.
- Değişen dosyalara yönelik ESLint çağrısı 90 saniye boyunca çıktı üretmeden bekledi ve elle sonlandırıldı; hata raporu üretmedi.
- `npm run dev` başlangıç başlığından sonra port açmadığı için tarayıcıda görsel QA yapılamadı.

## Takip gereken işler

- Yerel `vinext dev` başlangıcının neden port açmadığı ayrıca teşhis edilmeli; çalışır geliştirme sunucusunda geniş ve dar ekran görsel kontrolü yapılmalı.
