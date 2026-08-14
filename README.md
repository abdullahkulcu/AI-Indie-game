# AI Indie Game - MVP

Web tabanli, 2D haritali (300x300, izometrik), coklu kanal/oda destekli
multiplayer strateji oyunu (Stronghold Crusader'a yakin bir mantik/gorunum
hedefleniyor). Oyuncular sabit sayida kanaldan (lobiden) birine katilir,
haritada rastgele bir bolgede baslar; birimleri dogrudan yonetmez, kendi
OpenAI API anahtarlariyla (BYOK) baglanan bir "general" AI'ya sohbet yoluyla
strateji anlatir. AI, saglanan `attack` / `trade` / `build` / `recruit`
fonksiyonlarindan birini cagirarak karar verir; her cagri sunucudaki bagimsiz
kural motorundan (rule engine) gecmeden asla oyun durumuna uygulanmaz.

Ekonomi: dag karolarindaki maden yataklarina (`stone`/`iron`/`gold`) `mine`
insa edip pasif kaynak uretimi baslatabilir, kazandiklariyla ticaret yapip
kislada (`barracks`) `recruit` ile yeni asker egitebilirsiniz.

Kapsam ve tasarim kararlari icin bkz. [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Mimari ozet

```
backend/   Node.js + TypeScript + Fastify + Socket.io + PostgreSQL + Redis
frontend/  React + TypeScript + Vite + PixiJS (2D grid render)
```

- **Kanallar** (`backend/src/repositories/channelRepository.ts`): sabit sayida
  (varsayilan 3, `schema.sql`'de tanimli) lobi/oda. Her kanalin kendi haritasi
  (farkli bir `seed`), oyunculari ve tick dongusu var; `GET /channels` +
  `POST /channels/:id/join` ile katilinir (bkz. `game/onboarding.ts`).
- **Buyuk harita, sifir bulk depolama** (`backend/src/game/mapService.ts`):
  terrain ve maden yataklari `(seed, x, y)`'nin saf bir fonksiyonu - hicbir
  tile onceden DB'ye yazilmiyor, sadece sahiplik iddialari (`tile_claims`)
  saklaniyor. Bu sayede 300x300'luk harita "bulk tile" maliyeti getirmiyor;
  frontend ayni fonksiyonu (`frontend/src/game/terrainMap.ts`) yerelde
  calistirip kamerayla gezilen pencereyi hesaplar.
- **Tick dongusu** (`backend/src/game/tickService.ts`): her `TICK_INTERVAL_MS`
  (varsayilan 45s) HER kanal icin ayri ayri calisir; otonom birim FSM'ini
  ilerletir, madenlerden pasif kaynak uretimi uygular, ve her oyuncu icin
  periyodik bir LLM degerlendirmesi tetikler.
- **Oyuncu tetiklemeli tur** (`backend/src/game/playerTurnService.ts`): oyuncu
  sohbet mesaji gonderdiginde tick'i beklemeden aninda calisir (websocket
  `chat:send` veya `POST /chat/send`).
- **Kural motoru** (`backend/src/rules/ruleEngine.ts`): LLM'den gelen HER
  aksiyonu (attack/trade/build/recruit) bagimsiz olarak dogrular - sahiplik,
  menzil, kaynak yeterliligi, harita sinirlari, maden yatagi kontrolu vb.
  LLM'e hicbir zaman guvenilmez. `npm run test --workspace backend` ile
  calisan birim testleri burada.
- **Otonom birim state machine** (`backend/src/game/stateMachine.ts`): saldiriya
  ugrayan birim otomatik misilleme yapar; atanmis gorev (patrol/raid/hold/escort)
  yeni bir LLM karari gelene kadar her tick tekrar calistirilir.
- **LLM orkestrasyonu** (`backend/src/llm/`): gizli sistem promptu + oyuncunun
  kendi birim/yapi/kaynaklarini ve yakinindaki bilinen maden yataklarini iceren
  bir durum ozetini olusturur (`promptBuilder.ts` - butun 300x300 harita
  degil), OpenAI'a function-calling ile sorar (`openaiProvider.ts`), yaniti
  dogrulanmis `GameAction`'lara cevirir (`actionSchema.ts`), ve tumunu
  birlestirir (`llmOrchestrator.ts`).

## Gereksinimler

- Node.js >= 20
- PostgreSQL 16 ve Redis 7 (yerel kurulum veya `docker compose up -d`)

## Kurulum

```bash
npm install

cp backend/.env.example backend/.env
# KEY_VAULT_SECRET icin gercek bir deger uretin:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ciktisini backend/.env icindeki KEY_VAULT_SECRET'e yazin

cp frontend/.env.example frontend/.env

docker compose up -d   # postgres + redis (veya kendi yerel kurulumunuzu kullanin)

npm run --workspace backend migrate
```

## Calistirma

```bash
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173
```

Kayit olduktan sonra bir kanal secip katilmaniz gerekir; katilinca haritada
rastgele (diger oyunculardan uzak) bir baslangic karesi, bir "base" yapisi ve
bir army + bir caravan birimi otomatik verilir. Sohbet panelinden strateji
yazmadan once ayarlardan kendi OpenAI API anahtarinizi baglamaniz gerekir
(anahtar sunucuda AES-256-GCM ile sifreli saklanir, asla geri gosterilmez).

Harita 300x300 oldugu icin tek ekranda gosterilmez; fare ile surukleyerek
veya haritanin altindaki yon butonlariyla kaydirabilirsiniz (kamera
oyuncunun kendi ussunde baslar).

## Test ve tip kontrolu

```bash
npm run test --workspace backend       # kural motoru birim testleri (vitest)
npm run typecheck --workspace backend
npm run typecheck --workspace frontend
```

## Kapsam disi (v1)

Coklu LLM saglayici/model sistemi, otomatik acilan/kapanan kanallar (kanal
sayisi sabit), odeme/abonelik, gelismis grafik/animasyon, mobil uyum,
oyuncular arasi serbest chat/diplomasi, tam fog-of-war (deposit gorunurlugu
disinda) - bkz. gelistirme plani.
