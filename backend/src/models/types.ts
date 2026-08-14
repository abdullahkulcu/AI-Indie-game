export const MAP_SIZE = 20;

export type ResourceType = "gold" | "wood" | "food";

export interface Player {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Resources {
  playerId: string;
  gold: number;
  wood: number;
  food: number;
}

export type TileTerrain = "plains" | "forest" | "mountain" | "water";

export interface Tile {
  x: number;
  y: number;
  terrain: TileTerrain;
  ownerPlayerId: string | null;
}

export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market";

export interface Structure {
  id: string;
  ownerPlayerId: string;
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

export type GameAction = AttackAction | TradeAction | BuildAction;

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
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** Full snapshot handed to the rule engine / LLM orchestrator for a single decision. */
export interface GameStateSnapshot {
  tickNumber: number;
  mapSize: number;
  tiles: Tile[];
  units: Unit[];
  structures: Structure[];
  resources: Resources[];
  players: Player[];
}
