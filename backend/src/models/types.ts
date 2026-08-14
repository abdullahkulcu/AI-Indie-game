/** Map size is very large but still fixed (not truly infinite/chunk-streamed):
 * 500x500 is big enough that no player will realistically reach an edge, while
 * staying simple - terrain is a pure function of (channel seed, x, y) rather
 * than a pre-seeded row per tile, so the size costs nothing extra to store. */
export const MAP_SIZE = 500;

export type ResourceType = "gold" | "wood" | "food" | "stone" | "iron";

/** A fixed lobby the player joins (not auto-scaling); each has its own map
 * (same size, different terrain via its seed), players, and tick loop. */
export interface Channel {
  id: string;
  name: string;
  mapSize: number;
  maxPlayers: number;
  seed: number;
}

export interface Player {
  id: string;
  username: string;
  email: string;
  channelId: string | null;
  createdAt: string;
}

export interface Resources {
  playerId: string;
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
}

export type TileTerrain = "plains" | "forest" | "mountain" | "water" | "desert" | "oasis";

/** Large-scale biome a tile falls in - determines which fine-grained terrain
 * types can appear there (see mapService.terrainFor). Desert is the dominant
 * region (Stronghold Crusader-style arid map), with rockier highlands and
 * greener grassland patches breaking it up. */
export type Region = "desert" | "grassland" | "highlands";

/** Terrain/deposits are computed on demand from (channel seed, x, y) - see
 * mapService.ts - so only claimed tiles (a player owns them) exist as rows.
 * This `Tile` shape is the hydrated view (computed terrain + a claim if any)
 * used by the rule engine and the API, not a 1:1 mirror of a DB table. */
export interface Tile {
  x: number;
  y: number;
  terrain: TileTerrain;
  ownerPlayerId: string | null;
}

/** A resource deposit a mine can be built directly on. */
export type DepositType = "stone" | "iron" | "gold";

export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market" | "mine";

export interface Structure {
  id: string;
  ownerPlayerId: string;
  channelId: string;
  type: StructureType;
  x: number;
  y: number;
  level: number;
  createdAt: string;
}

/** Autonomous unit FSM state. The state machine drives this every tick; the
 * LLM only ever sets `assignedTask` / issues one-off orders via validated actions. */
export type UnitState = "idle" | "moving" | "attacking" | "retaliating" | "executing_task";

export type UnitType = "army" | "caravan";

export interface AssignedTask {
  kind: "patrol" | "hold_position" | "raid" | "escort_trade";
  targetX?: number;
  targetY?: number;
  targetUnitId?: string;
}

export interface Unit {
  id: string;
  ownerPlayerId: string;
  channelId: string;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  state: UnitState;
  targetUnitId: string | null;
  assignedTask: AssignedTask | null;
  cooldownUntilTick: number;
  updatedAt: string;
}

/** Structured, function-calling-shaped actions. This is the ONLY vocabulary the
 * LLM is allowed to speak in — never free text applied directly to state. */
export type AttackAction = {
  type: "attack";
  unitId: string;
  targetUnitId: string;
};

export type TradeAction = {
  type: "trade";
  offerResource: ResourceType;
  offerAmount: number;
  requestResource: ResourceType;
  requestAmount: number;
  targetPlayerId: string;
};

export type BuildAction = {
  type: "build";
  structureType: StructureType;
  x: number;
  y: number;
};

/** Trains a new army unit at one of the player's own barracks, funded by
 * gold/food - the "recruit soldiers with your trade earnings" mechanic. */
export type RecruitAction = {
  type: "recruit";
  structureId: string;
};

/** Orders one of the player's own units to march toward a tile (and, for
 * "raid", to engage any enemy it comes into range of along the way) - the
 * only way a unit ever crosses more than one tile, since the autonomous FSM
 * only re-executes an already-assigned task, it never invents one. Without
 * this, recruited soldiers can never close distance to reach an enemy: the
 * `attack` action alone requires the two units already be adjacent. */
export type AssignTaskAction = {
  type: "assign_task";
  unitId: string;
  task: AssignedTask;
};

export type GameAction = AttackAction | TradeAction | BuildAction | RecruitAction | AssignTaskAction;

export type ActionStatus = "accepted" | "rejected";

export interface ActionLogEntry {
  id: string;
  tickNumber: number;
  playerId: string;
  action: GameAction;
  status: ActionStatus;
  reason: string | null;
  createdAt: string;
}

export interface TickLog {
  id: string;
  tickNumber: number;
  createdAt: string;
  actions: ActionLogEntry[];
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  playerId: string;
  channelId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** A deposit the player has "discovered" by having a unit/structure near it -
 * stands in for full fog-of-war/exploration without needing per-tile reveal
 * state at this map size. */
export interface KnownDeposit {
  x: number;
  y: number;
  resource: DepositType;
}

/** Full snapshot handed to the rule engine / LLM orchestrator for a single
 * decision. `tiles` holds only claimed tiles (ownership), not the whole map -
 * terrain for any (x, y) is computed via mapService.terrainFor(seed, x, y). */
export interface GameStateSnapshot {
  channelId: string;
  seed: number;
  tickNumber: number;
  mapSize: number;
  tiles: Tile[];
  units: Unit[];
  structures: Structure[];
  resources: Resources[];
  players: Player[];
}
