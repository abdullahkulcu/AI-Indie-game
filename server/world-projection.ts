export type PublicKingdom = {
  id: string;
  name: string;
  ruler: string;
  terrain: string;
  keepLevel: number;
  population: number;
  buildingCount: number;
  army: number;
  resources: Record<string, number>;
};

export function worldPosition(channelId: string, userId: string) {
  let hash = 2166136261;
  for (const char of `${channelId}:${userId}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  const unsigned = hash >>> 0, angle = (unsigned % 360) * Math.PI / 180, radius = 34 + ((unsigned >>> 9) % 3) * 12;
  return { x: Math.round(Math.cos(angle) * radius * 10) / 10, z: Math.round(Math.sin(angle) * radius * 10) / 10 };
}

export function projectPublicKingdom(userId: string, gameState: string, expectedChannelName: string): PublicKingdom | null {
  try {
    const game = JSON.parse(gameState) as {
      kingdomName?: unknown;
      rulerName?: unknown;
      channel?: unknown;
      terrain?: unknown;
      population?: unknown;
      buildings?: Array<{ type?: unknown; level?: unknown }>;
      units?: Record<string, unknown>;
      resources?: Record<string, unknown>;
    };
    if (game.channel !== expectedChannelName || typeof game.kingdomName !== "string" || !game.kingdomName.trim()) return null;
    const buildings = Array.isArray(game.buildings) ? game.buildings : [];
    const keep = buildings.find(building => building?.type === "keep");
    return {
      id: userId,
      name: game.kingdomName.trim().slice(0, 36),
      ruler: typeof game.rulerName === "string" ? game.rulerName.trim().slice(0, 30) : "Bilinmeyen Hükümdar",
      terrain: typeof game.terrain === "string" ? game.terrain : "plain",
      keepLevel: Math.max(1, Math.min(6, Math.floor(Number(keep?.level) || 1))),
      population: Math.max(0, Math.floor(Number(game.population) || 0)),
      buildingCount: buildings.length,
      army: Object.values(game.units ?? {}).reduce<number>((total, amount) => total + Math.max(0, Math.floor(Number(amount) || 0)), 0),
      resources: Object.fromEntries(Object.entries(game.resources ?? {}).map(([key, amount]) => [key, Math.max(0, Math.floor(Number(amount) || 0))])),
    };
  } catch {
    return null;
  }
}
