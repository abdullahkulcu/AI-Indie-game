# AI Indie Game - MVP

Web tabanli, 2D haritali (20x20), 4-8 oyunculu multiplayer strateji oyunu.
Oyuncular birimleri dogrudan yonetmez; kendi OpenAI API anahtarlariyla (BYOK)
baglanan bir "general" AI'ya sohbet yoluyla strateji anlatir. AI, saglanan
`attack` / `trade` / `build` fonksiyonlarindan birini cagirarak karar verir;
her cagri sunucudaki bagimsiz kural motorundan (rule engine) gecmeden asla
oyun durumuna uygulanmaz.

Kapsam ve tasarim kararlari icin bkz. [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Mimari ozet

```
backend/   Node.js + TypeScript + Fastify + Socket.io + PostgreSQL + Redis
frontend/  React + TypeScript + Vite + PixiJS (2D grid render)
```

- **Tick dongusu** (`backend/src/game/tickService.ts`): her `TICK_INTERVAL_MS`
  (varsayilan 45s) bir kez calisir; otonom birim FSM'ini ilerletir ve her
  oyuncu icin periyodik bir LLM degerlendirmesi tetikler.
- **Oyuncu tetiklemeli tur** (`backend/src/game/playerTurnService.ts`): oyuncu
  sohbet mesaji gonderdiginde tick'i beklemeden aninda calisir (websocket
  `chat:send` veya `POST /chat/send`).
- **Kural motoru** (`backend/src/rules/ruleEngine.ts`): LLM'den gelen HER
  aksiyonu (attack/trade/build) bagimsiz olarak dogrular - sahiplik, menzil,
  kaynak yeterliligi, harita sinirlari vb. LLM'e hicbir zaman guvenilmez.
  `npm run test --workspace backend` ile calisan birim testleri burada.
- **Otonom birim state machine** (`backend/src/game/stateMachine.ts`): saldiriya
  ugrayan birim otomatik misilleme yapar; atanmis gorev (patrol/raid/hold/escort)
  yeni bir LLM karari gelene kadar her tick tekrar calistirilir.
- **LLM orkestrasyonu** (`backend/src/llm/`): gizli sistem promptu + oyuncunun
  gordugu durum ozetini olusturur (`promptBuilder.ts`), OpenAI'a function-calling
  ile sorar (`openaiProvider.ts`), yaniti dogrulanmis `GameAction`'lara cevirir
  (`actionSchema.ts`), ve tumunu birlestirir (`llmOrchestrator.ts`).

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

Kayit olduktan sonra oyuncuya haritada bir baslangic karesi, bir "base" yapisi
ve bir army + bir caravan birimi otomatik verilir. Sohbet panelinden strateji
yazmadan once ayarlardan kendi OpenAI API anahtarinizi baglamaniz gerekir
(anahtar sunucuda AES-256-GCM ile sifreli saklanir, asla geri gosterilmez).

## Test ve tip kontrolu

```bash
npm run test --workspace backend       # kural motoru birim testleri (vitest)
npm run typecheck --workspace backend
npm run typecheck --workspace frontend
```

## Kapsam disi (v1)

Coklu model/lig sistemi, odeme/abonelik, gelismis grafik/animasyon, mobil
uyum, oyuncular arasi serbest chat/diplomasi - bkz. gelistirme plani.
