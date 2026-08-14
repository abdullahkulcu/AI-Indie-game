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

/** Starting corner positions for up to 8 players, spread toward the map edges. */
export function startingPosition(slotIndex: number): { x: number; y: number } {
  const margin = 2;
  const max = MAP_SIZE - 1 - margin;
  const corners = [
    { x: margin, y: margin },
    { x: max, y: max },
    { x: margin, y: max },
    { x: max, y: margin },
    { x: Math.floor(MAP_SIZE / 2), y: margin },
    { x: Math.floor(MAP_SIZE / 2), y: max },
    { x: margin, y: Math.floor(MAP_SIZE / 2) },
    { x: max, y: Math.floor(MAP_SIZE / 2) },
  ];
  return corners[slotIndex % corners.length];
}
