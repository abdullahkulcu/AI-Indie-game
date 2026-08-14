import type { ResourceType, TileTerrain } from "../types";

/** Mirrors backend/src/game/mapService.ts exactly - terrain and resource
 * deposits are a pure function of (channel seed, x, y), never shipped in
 * bulk from the server. Keeping the algorithm in sync here is what lets the
 * frontend render/pan a 300x300 map without ever fetching a tile grid: it
 * computes the same terrain the server would for any (x, y) in view. */

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

export type DepositType = Extract<ResourceType, "stone" | "iron" | "gold">;

export function depositFor(seed: number, x: number, y: number): DepositType | null {
  if (terrainFor(seed, x, y) !== "mountain") return null;
  const h = hash2(seed + 1000, x, y);
  if (h < 0.55) return "stone";
  if (h < 0.9) return "iron";
  return "gold";
}
