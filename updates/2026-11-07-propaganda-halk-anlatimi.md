# Propaganda Halk Anlatımı

Tarih: 2026-11-07

## Ne değişti

Halka gönderilen propaganda kesesi hedefe ulaştığında, hedefin yapılandırılmış Halk-AI kişiliğine uygun tek cümlelik ve belirsiz bir söylenti bildirimi üretilir. İsyankâr, zeki-istekli ve bağlı-itaatkâr halkların propaganda baskısını algılama payı da dar bir aralıkta ayrışır.

## Neden

Propaganda daha önce yalnızca sayısal bir taşıyıcıydı; hedef halkın kişiliği sonucu görünür ya da hissedilir biçimde etkilemiyordu. Sayısal oyun kuralı deterministik kaldı, model yalnız anlatı katmanında kullanıldı ve yapılandırılmamış channel'larda eski davranış korunuyor.

## Etkilenen dosyalar

- engine/populace-persona.ts
- engine/agitation.ts
- server/propaganda-narrator.ts
- app/api/cron/route.ts
- tests/agitation.test.ts
- tests/propaganda-narrator.test.ts
- docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md

## Test durumu

- `npx tsc --noEmit` başarılı.
- `node --import tsx --test tests/agitation.test.ts tests/propaganda-narrator.test.ts` başarılı (42 test).
