import { MAP_SIZE } from "../models/types.js";
import type { DepositType, Region, TileTerrain } from "../models/types.js";

/** A channel's usable map starts small and grows with its population instead
 * of exposing the full 500x500 from the first join - less empty space to
 * wander for an early, mostly-empty channel, while a full 8-player channel
 * still gets the whole map. Never shrinks (see channelRepository.growMapSize). */
const MIN_CHANNEL_MAP_SIZE = 100;
const MAP_SIZE_GROWTH_PER_PLAYER = 50;

export function mapSizeForPlayerCount(playerCount: number): number {
  return Math.min(MAP_SIZE, MIN_CHANNEL_MAP_SIZE + playerCount * MAP_SIZE_GROWTH_PER_PLAYER);
}

/** Terrain (and resource deposits) for the big fixed-size map are a pure
 * function of (channel seed, x, y), never stored per-tile - that's what
 * makes a 500x500 map cheap: there is nothing to pre-seed, and no per-tile
 * row to read for the vast majority of tiles nobody has touched. Only
 * ownership claims (see mapRepository.ts) are actually persisted.
 *
 * Terrain is generated in two layers, like a real biome map:
 *  1) a large-scale smooth "region" (desert/grassland/highlands) - this is
 *     what makes different parts of the map look and play differently
 *     instead of the whole map being one uniform texture;
 *  2) per-tile fine detail (forest/mountain/water/desert/oasis) chosen from
 *     whichever palette fits that region.
 */

function hash2(seed: number, x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise: bilinear-interpolates a coarse hash grid (spaced
 * `cellSize` tiles apart) so large regions form soft blobs instead of static
 * per-tile noise. */
function valueNoise(seed: number, x: number, y: number, cellSize: number): number {
  const gx = x / cellSize;
  const gy = y / cellSize;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const sx = smoothstep(gx - x0);
  const sy = smoothstep(gy - y0);

  const n00 = hash2(seed, x0, y0);
  const n10 = hash2(seed, x0 + 1, y0);
  const n01 = hash2(seed, x0, y0 + 1);
  const n11 = hash2(seed, x0 + 1, y0 + 1);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

const REGION_CELL = 70;
const REGION_SEED_OFFSET = 9001;
const OASIS_CELL = 14;
const OASIS_SEED_OFFSET = 5000;

export function regionFor(seed: number, x: number, y: number): Region {
  const n = valueNoise(seed + REGION_SEED_OFFSET, x, y, REGION_CELL);
  if (n < 0.32) return "highlands";
  if (n < 0.52) return "grassland";
  return "desert";
}

function isOasisPatch(seed: number, x: number, y: number): boolean {
  return valueNoise(seed + OASIS_SEED_OFFSET, x, y, OASIS_CELL) > 0.78;
}

export function terrainFor(seed: number, x: number, y: number): TileTerrain {
  const region = regionFor(seed, x, y);
  const local = hash2(seed, x, y);

  if (region === "desert") {
    if (isOasisPatch(seed, x, y) && local < 0.55) return "oasis";
    if (local < 0.07) return "mountain";
    return "desert";
  }

  if (region === "highlands") {
    if (local < 0.48) return "mountain";
    if (local < 0.6) return "desert";
    if (local < 0.72) return "forest";
    return "plains";
  }

  // grassland
  if (local < 0.05) return "water";
  if (local < 0.12) return "mountain";
  if (local < 0.32) return "forest";
  return "plains";
}

/** Only mountain tiles carry a mineable deposit - stone is common, iron
 * less so, gold rare (mirrors Stronghold-style quarry/iron-mine/gold-mine
 * scarcity). Mountains cluster in the highlands region, so mining
 * naturally concentrates there. */
export function depositFor(seed: number, x: number, y: number): DepositType | null {
  if (terrainFor(seed, x, y) !== "mountain") return null;
  const h = hash2(seed + 1000, x, y);
  if (h < 0.55) return "stone";
  if (h < 0.9) return "iron";
  return "gold";
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

const BUILDABLE_START_TERRAIN: TileTerrain[] = ["plains", "desert"];

/** Picks a random buildable starting tile (plains or open desert - a
 * Stronghold keep is built directly on sand just as often as on grass) at
 * least `minDistance` from every existing player start in the channel,
 * backing off the distance requirement if the map is getting crowded rather
 * than looping forever. */
export function randomStartingPosition(
  seed: number,
  existing: Array<{ x: number; y: number }>,
  mapSize: number = MAP_SIZE,
): { x: number; y: number } {
  const margin = 5;
  let minDistance = 30;

  for (let round = 0; round < 6; round += 1) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = margin + Math.floor(Math.random() * (mapSize - margin * 2));
      const y = margin + Math.floor(Math.random() * (mapSize - margin * 2));
      if (!BUILDABLE_START_TERRAIN.includes(terrainFor(seed, x, y))) continue;
      const farEnough = existing.every((p) => chebyshev(p.x, p.y, x, y) >= minDistance);
      if (farEnough) return { x, y };
    }
    minDistance = Math.floor(minDistance / 2);
  }
  // Last resort (should be unreachable with a sane maxPlayers/map-size ratio).
  return { x: Math.floor(mapSize / 2), y: Math.floor(mapSize / 2) };
}

/** Deposits within `radius` of any of the given anchor points (a player's own
 * units/structures) - stands in for "what this player has scouted" so the
 * LLM/frontend get a bounded, relevant list instead of scanning the whole map. */
export function findNearbyDeposits(
  seed: number,
  anchors: Array<{ x: number; y: number }>,
  radius: number,
  mapSize: number = MAP_SIZE,
): Array<{ x: number; y: number; resource: DepositType }> {
  const found = new Map<string, { x: number; y: number; resource: DepositType }>();
  for (const anchor of anchors) {
    const minX = Math.max(0, anchor.x - radius);
    const maxX = Math.min(mapSize - 1, anchor.x + radius);
    const minY = Math.max(0, anchor.y - radius);
    const maxY = Math.min(mapSize - 1, anchor.y + radius);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        if (chebyshev(anchor.x, anchor.y, x, y) > radius) continue;
        const deposit = depositFor(seed, x, y);
        if (!deposit) continue;
        found.set(`${x}:${y}`, { x, y, resource: deposit });
      }
    }
  }
  return [...found.values()];
}
