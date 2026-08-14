import type { Texture } from "pixi.js";
import { drawGridOntoContext, getProceduralTexture, sprite, type Legend } from "./asciiSprite";
import { DIRT, GRASS, LEAVES, OUTLINE, STONE, WALL, WATER, WOOD } from "./palette";

/** Isometric diamond terrain tiles, generated procedurally (base tone dither +
 * a couple of stamped decorations) instead of loaded from image files - this
 * keeps every visual asset in version-controlled code. Ratio is the classic
 * 2:1 isometric diamond used by Age of Empires-era tile engines. */

export const TILE_GRID_W = 16;
export const TILE_GRID_H = 8;
export const TILE_SCALE = 4;
export const TILE_PX_W = TILE_GRID_W * TILE_SCALE;
export const TILE_PX_H = TILE_GRID_H * TILE_SCALE;

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function isInsideDiamond(px: number, py: number): boolean {
  if (px < 0 || py < 0 || px >= TILE_GRID_W || py >= TILE_GRID_H) return false;
  const nx = (px + 0.5 - TILE_GRID_W / 2) / (TILE_GRID_W / 2);
  const ny = (py + 0.5 - TILE_GRID_H / 2) / (TILE_GRID_H / 2);
  return Math.abs(nx) + Math.abs(ny) <= 1.0;
}

function paintDiamondBase(
  ctx: CanvasRenderingContext2D,
  tones: { dark: string; mid: string; light: string },
): void {
  for (let py = 0; py < TILE_GRID_H; py += 1) {
    for (let px = 0; px < TILE_GRID_W; px += 1) {
      if (!isInsideDiamond(px, py)) continue;
      const isEdge =
        !isInsideDiamond(px, py - 1) ||
        !isInsideDiamond(px, py + 1) ||
        !isInsideDiamond(px - 1, py) ||
        !isInsideDiamond(px + 1, py);
      const h = hash2(px, py);
      const color = isEdge ? OUTLINE : h < 0.18 ? tones.dark : h > 0.85 ? tones.light : tones.mid;
      ctx.fillStyle = color;
      ctx.fillRect(px * TILE_SCALE, py * TILE_SCALE, TILE_SCALE, TILE_SCALE);
    }
  }
}

function stamp(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  legend: Legend,
  offsetGridX: number,
  offsetGridY: number,
): void {
  drawGridOntoContext(ctx, sprite(rows), legend, TILE_SCALE, offsetGridX, offsetGridY);
}

const TREE_ROWS = [".L.", "LLl", ".T."];
const TREE_LEGEND: Legend = { L: LEAVES.dark, l: LEAVES.light, T: WOOD.dark };

const ROCK_ROWS = ["..h..", ".mMm.", "MMMMM"];
const ROCK_LEGEND: Legend = { M: STONE.mid, m: STONE.light, h: WALL.light };

const FOAM_ROWS = ["f.f"];
const FOAM_LEGEND: Legend = { f: WATER.foam };

export type TileTerrain = "plains" | "forest" | "mountain" | "water";

export function getTileTexture(terrain: TileTerrain): Texture {
  switch (terrain) {
    case "plains":
      return getProceduralTexture(`tile:plains`, TILE_PX_W, TILE_PX_H, (ctx) => {
        paintDiamondBase(ctx, GRASS);
      });
    case "forest":
      return getProceduralTexture(`tile:forest`, TILE_PX_W, TILE_PX_H, (ctx) => {
        paintDiamondBase(ctx, GRASS);
        stamp(ctx, TREE_ROWS, TREE_LEGEND, 4, 1);
        stamp(ctx, TREE_ROWS, TREE_LEGEND, 9, 2);
        stamp(ctx, TREE_ROWS, TREE_LEGEND, 6, 4);
      });
    case "mountain":
      return getProceduralTexture(`tile:mountain`, TILE_PX_W, TILE_PX_H, (ctx) => {
        paintDiamondBase(ctx, DIRT);
        stamp(ctx, ROCK_ROWS, ROCK_LEGEND, 5, 2);
      });
    case "water":
      return getProceduralTexture(`tile:water`, TILE_PX_W, TILE_PX_H, (ctx) => {
        paintDiamondBase(ctx, WATER);
        stamp(ctx, FOAM_ROWS, FOAM_LEGEND, 4, 2);
        stamp(ctx, FOAM_ROWS, FOAM_LEGEND, 8, 5);
      });
    default:
      return getProceduralTexture(`tile:plains`, TILE_PX_W, TILE_PX_H, (ctx) => {
        paintDiamondBase(ctx, GRASS);
      });
  }
}
