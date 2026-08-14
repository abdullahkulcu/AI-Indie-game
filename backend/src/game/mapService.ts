import { MAP_SIZE } from "../models/types.js";
import type { Tile, TileTerrain } from "../models/types.js";

/** Deterministic terrain generator so a fresh map is reproducible for a given size. */
export function generateTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let x = 0; x < MAP_SIZE; x += 1) {
    for (let y = 0; y < MAP_SIZE; y += 1) {
      tiles.push({ x, y, terrain: terrainFor(x, y), ownerPlayerId: null });
    }
  }
  return tiles;
}

function terrainFor(x: number, y: number): TileTerrain {
  // A handful of lakes and mountain/forest belts; everything else is plains.
  if ((x === 9 || x === 10) && y >= 9 && y <= 10) return "water";
  if (x % 7 === 0 && y % 5 === 0) return "mountain";
  if ((x + y) % 6 === 0) return "forest";
  return "plains";
}

const MARGIN = 2;
const MAX_COORD = MAP_SIZE - 1 - MARGIN;

/** Starting corner positions, one per player slot - MVP is scoped to a
 * single shared map with a fixed number of starting corners. */
const STARTING_CORNERS = [
  { x: MARGIN, y: MARGIN },
  { x: MAX_COORD, y: MAX_COORD },
  { x: MARGIN, y: MAX_COORD },
  { x: MAX_COORD, y: MARGIN },
  { x: Math.floor(MAP_SIZE / 2), y: MARGIN },
  { x: Math.floor(MAP_SIZE / 2), y: MAX_COORD },
  { x: MARGIN, y: Math.floor(MAP_SIZE / 2) },
  { x: MAX_COORD, y: Math.floor(MAP_SIZE / 2) },
];

export const MAX_PLAYERS = STARTING_CORNERS.length;

export function startingPosition(slotIndex: number): { x: number; y: number } {
  return STARTING_CORNERS[slotIndex % STARTING_CORNERS.length];
}
