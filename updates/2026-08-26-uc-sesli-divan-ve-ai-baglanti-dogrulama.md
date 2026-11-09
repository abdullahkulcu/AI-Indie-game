# Üç sesli Divan ve AI bağlantı doğrulaması

Tarih: 2026-08-26

## Ne değişti

Meclis, Halk Meclisi, Garnizon ve Generalin ayrı görüşlerini aynı karar belgesinin çevresinde gösteren üç sesli Divan hâline getirildi; General sohbeti ayrı sekmede kalıyor ve gönderilen söz artık Meclis'e yönlendirmiyor. Üst çubukta üç AI bağlantısı ayrı ayrı görünürken Halk ve Garnizon channel kimliğini farklı çıkar promptlarıyla kullanıyor. Sağlayıcı çağrıları başarısız olduğunda anahtar/model/kota/yetki/zaman aşımı nedenleri sır taşımadan ayrıştırılıyor; admin Halk-AI kaydı ve model değişimi gerçek bir küçük çağrı başarıyla tamamlanmadan yazılmıyor. Admin paneli global taşma kilidinden bağımsız dikey kaydırma alanına kavuştu ve Pazar miktar alanındaki effect tabanlı state düzeltmesi kaldırıldı.

## Neden

Kayıtlı bir model adının görünmesi gerçek bağlantının çalıştığı anlamına gelmediği için Divan yalnızca “Bağlantı hatası” gösteriyor, yönetici de hatalı anahtar veya modeli başarıyla kaydettiğini sanıyordu. Ayrıca Generalle her konuşmanın Meclis'e dönmesi iki ekranın görevini karıştırıyor; Halk ve asker görüşlerinin bağımsız AI sesleri olarak görünmesini engelliyordu. Admin sayfası da uygulamanın `body` taşma kilidi nedeniyle uzun içerikte aşağı kaydırılamıyordu.

## Etkilenen dosyalar

- app/api/council/route.ts
- app/api/admin/populace-ai/route.ts
- app/api/general/route.ts
- app/admin/page.tsx
- app/admin-scroll.css
- app/globals.css
- components/KingdomGame.tsx
- components/MarketWorkspace.tsx
- server/council-advisors.ts
- server/general-ai-desk.ts
- server/llm-provider.ts
- server/rate-limit.ts
- tests/council-advisors.test.ts
- tests/populace-ai-credentials.test.ts
- tests/istihbarat-tab.test.ts
- docs/ARCHITECTURE.md
- package.json

## Test durumu

- `npx tsc --noEmit --types node,react,react-dom` → başarılı.
- `npm run lint` → hata yok; `KingdomGame.tsx` içindeki daha önce var olan tek hook bağımlılığı uyarısı sürüyor.
- `npm test` → 617/617 başarılı.
- `npm run build` → başarılı; `/api/council` ve `/api/admin/populace-ai` rotaları üretim çıktısında yer alıyor.

## Takip gereken işler

- Halk ve Garnizon bugün aynı channel kimliğinin iki ayrı kişiliğidir. İleride ayrı sağlayıcı/persona faturası istenirse kimlik şeması rol kapsamıyla genişletilmelidir.
