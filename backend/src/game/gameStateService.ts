import { MAP_SIZE } from "../models/types.js";
import type { GameStateSnapshot } from "../models/types.js";
import { listPlayers, listResources } from "../repositories/playerRepository.js";
import { listStructures, listTiles } from "../repositories/mapRepository.js";
import { listUnits } from "../repositories/unitRepository.js";
import { redis } from "../db/redis.js";

const CURRENT_TICK_KEY = "game:current_tick";

/** Loads the authoritative state snapshot from Postgres. At MVP scale (single
 * 20x20 map, <=8 players) a full reload per tick is cheap and simplest to reason
 * about; Redis is reserved for the fast-changing "current tick" pointer and for
 * caching the snapshot between the tick loop and concurrent websocket reads. */
export async function loadSnapshot(tickNumber: number): Promise<GameStateSnapshot> {
  const [tiles, units, structures, resources, players] = await Promise.all([
    listTiles(),
    listUnits(),
    listStructures(),
    listResources(),
    listPlayers(),
  ]);
  return { tickNumber, mapSize: MAP_SIZE, tiles, units, structures, resources, players };
}

export async function getCurrentTickNumber(): Promise<number> {
  const value = await redis.get(CURRENT_TICK_KEY);
  return value ? Number(value) : 0;
}

export async function setCurrentTickNumber(tickNumber: number): Promise<void> {
  await redis.set(CURRENT_TICK_KEY, String(tickNumber));
}

const SNAPSHOT_CACHE_KEY = "game:snapshot";
const SNAPSHOT_CACHE_TTL_SECONDS = 120;

/** Cached copy of the latest snapshot for read-heavy consumers (REST /map, new
 * websocket connections) so they don't each trigger a full Postgres reload. */
export async function cacheSnapshot(snapshot: GameStateSnapshot): Promise<void> {
  await redis.set(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot), "EX", SNAPSHOT_CACHE_TTL_SECONDS);
}

export async function getCachedSnapshot(): Promise<GameStateSnapshot | null> {
  const raw = await redis.get(SNAPSHOT_CACHE_KEY);
  return raw ? (JSON.parse(raw) as GameStateSnapshot) : null;
}
