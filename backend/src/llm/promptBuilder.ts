import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatMessage, GameStateSnapshot } from "../models/types.js";

/**
 * The system prompt is never sent to the client - the UI only ever shows the
 * player's own chat turns and the assistant's natural-language reply. It fixes
 * the model's role (advisor whose decisions are executed by the game, not a
 * chatbot) and reminds it that only the three provided tools can affect state.
 */
const SYSTEM_PROMPT = `Sen bir 2D strateji savas oyununda bir oyuncunun ozel yapay zeka "generali"sin.
Oyuncu sana dogal dille strateji/talimat anlatir; sen bu talimatlari degerlendirip
saglanan fonksiyonlar (attack, trade, build) araciligiyla somut kararlar alirsin.
Kurallar:
- Oyun durumunu asla serbest metinle degistiremezsin; sadece attack/trade/build
  fonksiyon caGrilariyla aksiyon alabilirsin. Bu cagrilar sunucuda ayrica
  dogrulanir; gecersiz bir cagri reddedilir.
- Sadece sana verilen JSON durumundaki gercek id'leri (unit_id, target_unit_id,
  target_player_id) kullan; id uydurma.
- Sadece oyuncunun kendi birimlerini/kaynaklarini yonetebilirsin.
- Her tur 0 veya daha fazla fonksiyon cagrisi yapabilirsin. Sadece fikir
  aliyor ya da bilgi veriyorsan fonksiyon cagirmadan kisa bir dogal dil yaniti
  yeterlidir.
- Yanitlarin kisa ve oz olsun; oyuncuya bir general gibi rapor ver.`;

function playerContext(state: GameStateSnapshot, playerId: string): string {
  const ownUnits = state.units.filter((u) => u.ownerPlayerId === playerId);
  const enemyUnits = state.units.filter((u) => u.ownerPlayerId !== playerId);
  const ownStructures = state.structures.filter((s) => s.ownerPlayerId === playerId);
  const ownResources = state.resources.find((r) => r.playerId === playerId);

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
    visibleEnemyUnits: enemyUnits.map((u) => ({
      id: u.id,
      ownerPlayerId: u.ownerPlayerId,
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
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
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
