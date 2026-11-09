# Halk vizyonu durum denetimi

Tarih: 2026-11-07

## Ne değişti

Vizyon belgesindeki Fikir 0, 1, 2, 3, 13 ve 16 için kod–belge karşılaştırması yapıldı. Çalışan kimlik altyapısı, anonim kıyas, Halk-AI anlatımı, dolaylı mücadele/zafer göstergesi, sessiz kıyas talebi ve Meclis'e doğrudan halk sesi maddeleri artık belgedeki uygulama durumu notlarıyla açıkça işaretlendi.

## Neden

Eski "eksik" anlatımı, çalışmakta olan sistemlerin yeniden yapılmasına ve gerçek açıkların görünmez kalmasına yol açıyordu. Belgeyi mevcut kodun tekil kaynaklarına bağlamak, kalan işi doğru ayırmak için gerekliydi.

## Etkilenen dosyalar

- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md
- docs/plans/2026-08-22-acik-backlog-maddeleri.md

## Test durumu

- Kaynak denetimi: `engine/populace-voice.ts`, `server/world-projection.ts`, `server/populace-ai-desk.ts`, `app/api/general/route.ts`, `components/KingdomGame.tsx`, `engine/populace.ts`
- İlgili mevcut testler: `tests/channel-averages.test.ts`, `tests/populace-voice.test.ts`, `tests/populace-interjection.test.ts`, `tests/victory.test.ts`, `tests/populace.test.ts`
- `npm test` — 742 test geçti.
- Bu değişiklik yalnızca dokümantasyon durum kaydıdır; kod değişmediği için ayrı üretim derlemesi çalıştırılmadı.

## Takip gereken işler

- Slack fikirleri (4 ve 12), kullanıcı kararı gereği beklemede.
- Göreceli göç (17) ve tükenen maden sonrasındaki define/yıkık kale fırsatı (23) kullanıcı tarafından ertelendi.
- Eşzamanlı inşaat kuyruğu ve vatandaş cüzdanı, kapsamı tanımlanmamış büyük tasarım açıkları olarak sürüyor.
