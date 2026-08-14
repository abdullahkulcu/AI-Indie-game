# Gelistirme Plani

Bu belge iki seyi kapsar: (1) bu MVP iskeletinin hangi sirayla insa edildigi -
ayni sirayla ilerlemek, bagimliliklari doğru kurmanin en kolay yolu - ve
(2) MVP sonrasi neyin, hangi sirayla eklenecegi.

## 1. Dosya olusturma sirasi (bu iskeletin insa sirasi)

Her adim bir onceki adimin uzerine kurulur; boylece hicbir modul, henuz var
olmayan bir seye bagimli olmaz.

1. **Proje iskeleti**: root `package.json` (npm workspaces), `.gitignore`,
   `docker-compose.yml` (postgres+redis).
2. **Backend config**: `backend/tsconfig.json`, `backend/.env.example`,
   `src/config/env.ts`, `src/db/pool.ts`, `src/db/redis.ts`.
3. **Veri modelleri**: `src/models/types.ts` (Player, Tile, Unit, Resources,
   Structure, GameAction, GameStateSnapshot...), `src/db/schema.sql`,
   `src/db/migrate.ts`. Once tipler, sonra semayi tiplere gore yazmak,
   ikisinin senkron kalmasini kolaylastirir.
4. **Auth + BYOK key vault**: `src/crypto/keyVault.ts` (AES-256-GCM),
   `src/repositories/playerRepository.ts`, `src/auth/authService.ts`,
   `src/auth/authPlugin.ts`, `src/auth/authRoutes.ts`. Diger her sey bir
   `playerId`'ye ihtiyac duydugu icin auth erken gelir.
5. **Kural motoru** (`src/rules/ruleEngine.ts` + `ruleEngine.test.ts`):
   kasitli olarak simulasyondan *once* yazildi - saf, DB'siz, sadece
   `GameStateSnapshot` + `GameAction` alip `ValidationResult` donen fonksiyonlar
   oldugu icin simulasyon tasarimindan bagimsiz test edilebilir.
6. **Harita + oyun durumu + state machine**: `src/game/mapService.ts`,
   `src/game/geometry.ts`, `src/game/stateMachine.ts`,
   `src/repositories/{mapRepository,unitRepository,tickLogRepository,chatRepository}.ts`,
   `src/game/gameStateService.ts`.
7. **LLM orkestrasyonu**: `src/llm/actionSchema.ts` (tool tanimlari + zod),
   `src/llm/promptBuilder.ts`, `src/llm/openaiProvider.ts`,
   `src/llm/llmOrchestrator.ts`. Kural motoru zaten var oldugu icin, LLM
   ciktisi hangi sekle girerse girsin nasil dogrulanacagi netti.
8. **Tick dongusu + oyuncu tetiklemeli tur**: `src/game/tickService.ts`
   (`applyAction` dahil), `src/game/onboarding.ts`,
   `src/game/playerTurnService.ts`.
9. **HTTP/WS yuzeyi**: `src/routes/{mapRoutes,playerRoutes,chatRoutes}.ts`,
   `src/ws/socketServer.ts`, `src/server.ts`, `src/index.ts`.
10. **Frontend**: `frontend/package.json`, vite/tsconfig, `src/types.ts`,
    `src/api/{client,socket}.ts`, `src/components/{AuthForm,ApiKeyModal,
    MapGrid,ChatPanel,PlayerHud}.tsx`, `src/App.tsx`, `src/main.tsx`.

## 2. MVP sonrasi yol haritasi (oncelik sirasiyla)

1. **Oyun ici geri bildirim dongusu**: birim olumu/saldiri/insa olaylarinin
   frontend'de gorsel/animasyonlu bildirimi (su an sadece state snapshot'i
   yeniden ciziliyor).
2. **Coklu model/lig sistemi**: `src/llm/openaiProvider.ts` zaten tek bir
   `requestStrategicDecision(apiKey, messages)` arayuzu etrafinda izole
   edildi. Ikinci bir saglayici eklemek icin:
   - Ayni imzaya sahip yeni bir `anthropicProvider.ts` (veya benzeri) yazin.
   - `llmOrchestrator.ts` icine `provider` parametresi ekleyip saglayiciyi
     `player_api_keys.provider` kolonuna gore secin (kolon zaten var).
   - "Lig" kavrami icin oyuncu bazinda saglayici/model tercihini ayri bir
     tabloya tasiyin; MVP'de bu bilgi zaten `player_api_keys.provider`'da.
3. **Yeni aksiyon tipi eklemek** (orn. `scout` / `fortify`):
   - `src/models/types.ts`: `GameAction` union'ina yeni tip ekleyin.
   - `src/llm/actionSchema.ts`: zod semasi + OpenAI tool tanimi + parse dali.
   - `src/rules/ruleEngine.ts`: `validateX` fonksiyonu + `validateAction`
     switch'ine dal + test.
   - `src/game/tickService.ts`: `applyAction` icine efekt.
4. **Odeme/abonelik sistemi**: kapsam disi kalmaya devam eder; eklenecekse
   `players` tablosuna `plan` kolonu ve ayri bir billing servisi onerilir.
5. **Fog of war / gorunurluk kisitlari**: su an tum birimler herkese
   gorunuyor (`promptBuilder.ts` -> `playerContext`). Kisitlamak icin
   Chebyshev mesafesine gore filtreleme eklemek yeterli.
6. **Gelismis grafik/animasyon, mobil uyum**: kapsam disi (bkz. ana prompt).
7. **Oyuncular arasi serbest chat/diplomasi**: kapsam disi; eklenirse ayri
   bir `player_messages` tablosu + moderasyon katmani gerekir.

## 3. Bilinen MVP kisitlamalari (bilinclidir, kapsam geregi)

- Tek harita/instance, coklu oda yok.
- Trade aksiyonu pazarlik icermez: iki tarafin da kaynagi varsa aninda
  gerceklesir (karsi tarafin onayi yok).
- LLM cagrisi basarisiz olursa (rate limit, gecersiz anahtar, ag hatasi) o
  oyuncunun turu sessizce atlanir; diger oyuncular ve tick etkilenmez.
- Redis, tick dongusunde tam bir Postgres-yerine-gecen state store degil;
  sadece "guncel tick numarasi" ve kisa sureli snapshot cache'i icin
  kullanilir (bkz. `src/game/gameStateService.ts`). Bu olcekte (<=8 oyuncu,
  20x20 harita) her tick'te Postgres'ten tam yeniden yukleme yeterince
  ucuzdur; ölçek buyudukce Redis'in rolu genisletilebilir.
