# Admin AI model ve temperature ayarları

Tarih: 2026-08-26

## Ne değişti

Yönetim panelindeki Halk-AI kimliği formuna sağlayıcıya uygun model öneri
listesi ve OpenAI için temperature seçimi eklendi. Alanlar görünür
seçim kutuları olarak sunulur; temperature seçenekleri API henüz yanıt vermese
bile istemci yedek listesiyle görünür. Seçilen temperature,
kimlik kaydında tutulur; Halk/Garnizon anlatımı ve Divan görüşü bu aynı ayarı
kullanır.

## Neden

Yönetici, channel'ın halka ait AI sesini anahtarı değiştirmeden model ve
anlatım çeşitliliği bakımından yönetebilmelidir. Canlı doğrulama artık gerçek
oyun çağrısındaki model + temperature ikilisiyle yapılır; test ile oyun
isteğinin ayrışması önlenir.

## Etkilenen dosyalar

- app/admin/page.tsx
- app/api/admin/populace-ai/route.ts
- app/api/council/route.ts
- server/llm-provider.ts
- server/populace-ai-credentials.ts
- server/populace-ai-desk.ts
- server/populace-narrator.ts
- db/schema.ts
- drizzle/pg/0008_populace_temperature.sql

## Test durumu

- `node --import tsx --test tests/populace-ai-credentials.test.ts tests/populace-narrator.test.ts tests/council-advisors.test.ts`: 47/47 geçti.
- `npx tsc --noEmit --types node,react,react-dom`: geçti.
- `npm test`: 618/618 geçti.
- `npm run lint`: 0 hata; `components/KingdomGame.tsx` içindeki önceden mevcut tek Hook bağımlılık uyarısı sürüyor.
- `npm run build`: geçti.

## Düzeltme notu

Anthropic'te seçilemeyen "sağlayıcı varsayılanı" değeri `null` olarak
gönderildiğinde sayı doğrulamasına takılıyordu. Bu değer artık geçerli kabul
ediliyor ve canlı bağlantı testine temperature parametresi olmadan gidiyor.

## Takip gereken işler

- Dağıtımdan önce `drizzle/pg/0008_populace_temperature.sql` göçü üretim
  Postgres veritabanına uygulanmalı.
- Yerel çalışan Postgres'e aynı sütun `IF NOT EXISTS` korumasıyla uygulandı.
