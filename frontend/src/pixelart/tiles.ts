import type { Texture } from "pixi.js";
import { drawGridOntoContext, getProceduralTexture, sprite, type Legend } from "./asciiSprite";
import { DIRT, GRASS, LEAVES, OUTLINE, SNOW, STONE, WATER, WOOD } from "./palette";

/** Flat top-down terrain tiles (WorldBox-style sandbox map, not an isometric
 * diamond grid): a plain square per tile, seamless against its neighbors,
 * with a couple of simple stamped decorations (trees/a mountain peak/wave
 * dashes) for forest/mountain/water. Generated procedurally instead of
 * loaded from image files. */

export const TILE_GRID = 10;
export const TILE_SCALE = 4;
export const TILE_PX = TILE_GRID * TILE_SCALE;

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function paintFlatBase(
  ctx: CanvasRenderingContext2D,
  tones: { dark: string; mid: string; light: string },
): void {
  for (let py = 0; py < TILE_GRID; py += 1) {
    for (let px = 0; px < TILE_GRID; px += 1) {
      const h = hash2(px, py);
      // Mostly the mid tone with light speckling, so terrain reads as a flat
      // color at a glance instead of a heavily dithered/noisy texture.
      const color = h < 0.08 ? tones.dark : h > 0.92 ? tones.light : tones.mid;
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

const TREE_ROWS = [".OGO.", "OGGGO", "OGgGO", ".OGO.", "..T..", "..T.."];
const TREE_LEGEND: Legend = { O: OUTLINE, G: LEAVES.mid, g: LEAVES.light, T: WOOD.dark };

const PEAK_ROWS = ["..h..", ".ppp.", "ppppp", "OOOOO"];
const PEAK_LEGEND: Legend = { h: SNOW, p: STONE.mid, O: STONE.dark };

const WAVE_ROWS = ["f.f.f"];
const WAVE_LEGEND: Legend = { f: WATER.foam };

export type TileTerrain = "plains" | "forest" | "mountain" | "water";

export function getTileTexture(terrain: TileTerrain): Texture {
  switch (terrain) {
    case "forest":
      return getProceduralTexture(`tile:forest`, TILE_PX, TILE_PX, (ctx) => {
        paintFlatBase(ctx, GRASS);
        stamp(ctx, TREE_ROWS, TREE_LEGEND, 0, 1);
        stamp(ctx, TREE_ROWS, TREE_LEGEND, 5, 3);
      });
    case "mountain":
      return getProceduralTexture(`tile:mountain`, TILE_PX, TILE_PX, (ctx) => {
        paintFlatBase(ctx, DIRT);
        stamp(ctx, PEAK_ROWS, PEAK_LEGEND, 3, 3);
      });
    case "water":
      return getProceduralTexture(`tile:water`, TILE_PX, TILE_PX, (ctx) => {
        paintFlatBase(ctx, WATER);
        stamp(ctx, WAVE_ROWS, WAVE_LEGEND, 1, 2);
        stamp(ctx, WAVE_ROWS, WAVE_LEGEND, 3, 6);
      });
    case "plains":
    default:
      return getProceduralTexture(`tile:plains`, TILE_PX, TILE_PX, (ctx) => {
        paintFlatBase(ctx, GRASS);
      });
  }
}
