import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatMessage, GameStateSnapshot } from "../models/types.js";
import { findNearbyDeposits } from "../game/mapService.js";

/**
 * The system prompt is never sent to the client - the UI only ever shows the
 * player's own chat turns and the assistant's natural-language reply. It fixes
 * the model's role (advisor whose decisions are executed by the game, not a
 * chatbot) and reminds it that only the four provided tools can affect state.
 */
const SYSTEM_PROMPT_TEMPLATE = `Sen bir 2D strateji savas oyununda bir oyuncunun ozel yapay zeka "generali"sin.
Oyuncu sana dogal dille strateji/talimat anlatir; sen bu talimatlari degerlendirip
saglanan fonksiyonlar (attack, trade, build, recruit, assign_task) araciligiyla
somut kararlar alirsin.
Ekonomi: gold/wood/food'a ek olarak stone ve iron var. Bunlari kazanmanin yolu
maden yataklarinin (dag karolari) uzerine 'mine' tipi yapi insa etmek - o zaman
o kaynak her tick otomatik uretilir. Kazandigin kaynaklarla ticaret yapip
altin biriktirebilir, altin+yiyecekle kislanda 'recruit' fonksiyonuyla yeni
asker egitebilirsin.
Savas: 'attack' fonksiyonu SADECE iki birim zaten bitisik karedeyken calisir.
Birimler birbirinden uzaktaysa (cogunlukla oyle olur, harita cok buyuk) once
'assign_task' ile birimi hedefe dogru yurutmen gerekir - 'raid' gorevi yol
uzerinde menzile giren dusmana otomatik saldirir, 'patrol' sadece hedefe gidip
bekler. Bir birim yurumeden asla dusmana ulasamaz.
Haritada, sahibi olmayan (ownerPlayerId=null, type='mob') vahsi ve dusmanca
birimler de var - baska bir oyuncu ile karsilasmadan once pratik yapmak veya
kaynak kazanmak icin uzerlerine 'raid' gorevi verip savasabilirsin; onlar
sadece kendilerine saldirilirsa karsilik verir, oyuncuyu kendileri aramazlar.
Harita cok buyuk (__MAP_SIZE__x__MAP_SIZE__); sadece kendi birimlerine/yapilarina
yakin bolgeyi ve orada bilinen maden yataklarini goruyorsun - butun haritayi
degil.
Kurallar:
- Oyun durumunu asla serbest metinle degistiremezsin; sadece attack/trade/build/
  recruit/assign_task fonksiyon cagrilariyla aksiyon alabilirsin. Bu cagrilar
  sunucuda ayrica dogrulanir; gecersiz bir cagri reddedilir.
- Sadece sana verilen JSON durumundaki gercek id'leri (unit_id, target_unit_id,
  target_player_id, structure_id) kullan; id uydurma.
- Sadece oyuncunun kendi birimlerini/kaynaklarini yonetebilirsin.
- Her tur 0 veya daha fazla fonksiyon cagrisi yapabilirsin. Sadece fikir
  aliyor ya da bilgi veriyorsan fonksiyon cagirmadan kisa bir dogal dil yaniti
  yeterlidir.
- Yanitlarin kisa ve oz olsun; oyuncuya bir general gibi rapor ver.`;

const DEPOSIT_SCAN_RADIUS = 20;

function playerContext(state: GameStateSnapshot, playerId: string): string {
  const ownUnits = state.units.filter((u) => u.ownerPlayerId === playerId);
  const enemyUnits = state.units.filter((u) => u.ownerPlayerId !== playerId);
  const ownStructures = state.structures.filter((s) => s.ownerPlayerId === playerId);
  const ownResources = state.resources.find((r) => r.playerId === playerId);

  const anchors = [...ownUnits, ...ownStructures].map((a) => ({ x: a.x, y: a.y }));
  const knownDeposits = findNearbyDeposits(state.seed, anchors, DEPOSIT_SCAN_RADIUS, state.mapSize);

  const summary = {
    tick: state.tickNumber,
    mapSize: state.mapSize,
    yourResources: ownResources ?? null,
    yourUnits: ownUnits.map((u) => ({
      id: u.id,
      type: u.type,
      x: u.x,
      y: u.y,
      hp: u.hp,
      state: u.state,
    })),
    yourStructures: ownStructures.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y })),
    knownDeposits,
    visibleEnemyUnits: enemyUnits.map((u) => ({
      id: u.id,
      // null = a wild, neutral-hostile mob (nobody's general) rather than
      // another player's unit.
      ownerPlayerId: u.ownerPlayerId,
      type: u.type,
      x: u.x,
      y: u.y,
      hp: u.hp,
    })),
    otherPlayers: state.players.filter((p) => p.id !== playerId).map((p) => p.id),
  };

  return `Guncel oyun durumu (JSON):\n${JSON.stringify(summary)}`;
}

export function buildMessages(
  state: GameStateSnapshot,
  playerId: string,
  recentChat: ChatMessage[],
  triggerMessage: string | null,
): ChatCompletionMessageParam[] {
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replaceAll("__MAP_SIZE__", String(state.mapSize));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: playerContext(state, playerId) },
  ];

  for (const msg of recentChat) {
    if (msg.role === "system") continue;
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({
    role: "user",
    content:
      triggerMessage ??
      "(Otomatik tick tetiklemesi - yeni talimat yok, mevcut stratejini degerlendirip gerekirse aksiyon al.)",
  });

  return messages;
}
