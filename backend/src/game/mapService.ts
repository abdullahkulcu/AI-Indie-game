import { MAP_SIZE } from "../models/types.js";
import type { DepositType, TileTerrain } from "../models/types.js";

/** Terrain (and resource deposits) for the big fixed-size map are a pure
 * function of (channel seed, x, y), never stored per-tile - that's what
 * makes a 300x300 map cheap: there is nothing to pre-seed, and no per-tile
 * row to read for the vast majority of tiles nobody has touched. Only
 * ownership claims (see mapRepository.ts) are actually persisted. */

function hash2(seed: number, x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export function terrainFor(seed: number, x: number, y: number): TileTerrain {
  const h = hash2(seed, x, y);
  if (h < 0.06) return "water";
  if (h < 0.16) return "mountain";
  if (h < 0.34) return "forest";
  return "plains";
}

/** Only mountain tiles carry a mineable deposit - stone is common, iron
 * less so, gold rare (mirrors Stronghold-style quarry/iron-mine/gold-mine
 * scarcity). */
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

/** Picks a random buildable (plains) starting tile at least `minDistance`
 * from every existing player start in the channel, backing off the distance
 * requirement if the map is getting crowded rather than looping forever. */
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
      if (terrainFor(seed, x, y) !== "plains") continue;
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
