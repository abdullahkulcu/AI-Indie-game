import type { Channel, GameStateSnapshot } from "../models/types.js";
import { listPlayersInChannel, listResourcesInChannel } from "../repositories/playerRepository.js";
import { listClaimedTiles, listStructures } from "../repositories/mapRepository.js";
import { listUnits } from "../repositories/unitRepository.js";
import { redis } from "../db/redis.js";

/** Loads the authoritative state snapshot for one channel from Postgres.
 * Ground tiles are NOT bulk-loaded here - only claimed ones (see
 * mapRepository.listClaimedTiles); everything else in a channel (units,
 * structures, players) is small enough at MVP scale (<=8 players) to reload
 * in full each time. Redis is reserved for the fast-changing "current tick"
 * pointer per channel and for caching the snapshot between the tick loop and
 * concurrent websocket reads. */
export async function loadSnapshot(channel: Channel, tickNumber: number): Promise<GameStateSnapshot> {
  const [tiles, units, structures, resources, players] = await Promise.all([
    listClaimedTiles(channel.id, channel.seed),
    listUnits(channel.id),
    listStructures(channel.id),
    listResourcesInChannel(channel.id),
    listPlayersInChannel(channel.id),
  ]);
  return {
    channelId: channel.id,
    seed: channel.seed,
    tickNumber,
    mapSize: channel.mapSize,
    tiles,
    units,
    structures,
    resources,
    players,
  };
}

function tickKey(channelId: string): string {
  return `game:${channelId}:current_tick`;
}

export async function getCurrentTickNumber(channelId: string): Promise<number> {
  const value = await redis.get(tickKey(channelId));
  return value ? Number(value) : 0;
}

export async function setCurrentTickNumber(channelId: string, tickNumber: number): Promise<void> {
  await redis.set(tickKey(channelId), String(tickNumber));
}

const SNAPSHOT_CACHE_TTL_SECONDS = 120;

function snapshotKey(channelId: string): string {
  return `game:${channelId}:snapshot`;
}

/** Cached copy of the latest snapshot for read-heavy consumers (REST /map, new
 * websocket connections) so they don't each trigger a full Postgres reload. */
export async function cacheSnapshot(snapshot: GameStateSnapshot): Promise<void> {
  await redis.set(
    snapshotKey(snapshot.channelId),
    JSON.stringify(snapshot),
    "EX",
    SNAPSHOT_CACHE_TTL_SECONDS,
  );
}

export async function getCachedSnapshot(channelId: string): Promise<GameStateSnapshot | null> {
  const raw = await redis.get(snapshotKey(channelId));
  return raw ? (JSON.parse(raw) as GameStateSnapshot) : null;
}
