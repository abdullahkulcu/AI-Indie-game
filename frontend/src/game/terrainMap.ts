import type { ResourceType, TileTerrain } from "../types";

/** Mirrors backend/src/game/mapService.ts exactly - terrain and resource
 * deposits are a pure function of (channel seed, x, y), never shipped in
 * bulk from the server. Keeping the algorithm in sync here is what lets the
 * frontend render/pan a 500x500 map without ever fetching a tile grid: it
 * computes the same terrain the server would for any (x, y) in view.
 *
 * Terrain is generated in two layers: a large-scale smooth "region"
 * (desert/grassland/highlands, via value noise) and per-tile fine detail
 * chosen from whichever palette fits that region. */

function hash2(seed: number, x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

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

export type Region = "desert" | "grassland" | "highlands";

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

export type DepositType = Extract<ResourceType, "stone" | "iron" | "gold">;

export function depositFor(seed: number, x: number, y: number): DepositType | null {
  if (terrainFor(seed, x, y) !== "mountain") return null;
  const h = hash2(seed + 1000, x, y);
  if (h < 0.55) return "stone";
  if (h < 0.9) return "iron";
  return "gold";
}
