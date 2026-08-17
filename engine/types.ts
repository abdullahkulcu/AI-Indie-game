/**
 * Oyun motorunun ortak tipleri. Bu klasör hem tarayıcı hem sunucu tarafından
 * kullanılır; buraya Cloudflare, React veya DOM'a bağlı hiçbir şey girmemeli.
 */

export type Key = "gold" | "food" | "stone" | "wood" | "iron" | "ale";
export type Res = Record<Key, number>;
export type TerrainId = "plain" | "forest" | "mountain" | "riverbank";

export type Building = { type: string; name: string; category: string; level: number };

export type Queue = {
  kind: "building" | "unit";
  type: string;
  name: string;
  targetLevel?: number;
  count?: number;
  startedAt?: number;
  completesAt: number;
};

export type Notice = { kind: string; text: string; at: number };

export type Game = {
  version: 2;
  kingdomName: string;
  rulerName: string;
  channel: string;
  channelId?: string;
  speed: number;
  terrain: TerrainId;
  foundedAt: number;
  lastTickAt: number;
  protectionEndsAt: number;
  resources: Res;
  population: number;
  capacity: number;
  popularity: number;
  reputation: number;
  loyalty: number;
  taxRate: number;
  quota: number;
  quotaAt: number;
  buildings: Building[];
  units: Record<string, number>;
  queue: Queue | null;
  notices: Notice[];
  provider: string | null;
  model: string | null;
  generalConnected: boolean;
  strategyNote?: string;
  startingReserveGranted?: boolean;
  /** Halk sistemi. Eski kayıtlarda bulunmayabilir; motor varsayılanları uygular. */
  foodRation?: number;
  aleRation?: number;
  soldierPay?: number;
  /** Maaşı eksik ödenen askerlerin biriken huzursuzluğu (0-100). */
  soldierUnrest?: number;
};

export type GameAction = { name: string; arguments: Record<string, unknown> };

export const RESOURCE_KEYS: Key[] = ["gold", "food", "stone", "wood", "iron", "ale"];
