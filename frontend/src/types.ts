export type ResourceType = "gold" | "wood" | "food" | "stone" | "iron";
export type TileTerrain = "plains" | "forest" | "mountain" | "water" | "desert" | "oasis";
export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market" | "mine";
export type UnitState = "idle" | "moving" | "attacking" | "retaliating" | "executing_task";
export type UnitType = "army" | "caravan";

export interface Channel {
  id: string;
  name: string;
  mapSize: number;
  maxPlayers: number;
  seed: number;
  playerCount: number;
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

export interface Tile {
  x: number;
  y: number;
  terrain: TileTerrain;
  ownerPlayerId: string | null;
}

export interface Structure {
  id: string;
  ownerPlayerId: string;
  type: StructureType;
  x: number;
  y: number;
  level: number;
}

export interface Unit {
  id: string;
  ownerPlayerId: string;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: UnitState;
}

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

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  playerId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface AuthResult {
  player: Player;
  token: string;
}
