# Anthropic Sonnet 5 örnekleme uyumu

Tarih: 2026-08-26

## Ne değişti

Anthropic arka plan metin çağrıları ile General sohbet çağrısından isteğe bağlı
`temperature` alanı kaldırıldı. Sağlayıcı uyumluluğu
`compatibleSamplingOptions` yardımcısında tek kaynağa alındı ve OpenAI'nin
mevcut örnekleme davranışı korundu.

## Neden

`claude-sonnet-5` geçerli bir model olmasına rağmen uyarlamalı düşünme açıkken
varsayılan dışı `temperature` değeri 400 yanıtı üretiyordu. Admin bağlantı testi
bu alanı göndermediği için başarılı olurken Meclis'teki Halk ve Garnizon
çağrıları bağlantı hatasına düşüyordu.

## Etkilenen dosyalar

- server/llm-provider.ts
- app/api/general/route.ts
- tests/council-advisors.test.ts
- docs/ARCHITECTURE.md

## Test durumu

- `node --import tsx --test tests/council-advisors.test.ts tests/populace-narrator.test.ts`: 26/26 geçti.
- `npx tsc --noEmit --types node,react,react-dom`: geçti.
- `npm test`: 618/618 geçti.
- `npm run lint`: 0 hata; `components/KingdomGame.tsx` içindeki önceden mevcut tek React Hook bağımlılık uyarısı sürüyor.
- `npm run build`: geçti; `/api/council` ve `/api/general` rotaları üretim paketinde yer aldı.
