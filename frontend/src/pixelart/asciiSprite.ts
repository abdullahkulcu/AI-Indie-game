import { Texture } from "pixi.js";
import { SHADOW } from "./palette";

/** Legend maps a single ASCII character to a CSS color. Two characters are
 * reserved: "." (transparent) and "$" (the caller's accent/player color,
 * substituted at raster time so one sprite definition works for every
 * player's color without redefining the art). */
export type Legend = Record<string, string>;

export interface PixelGrid {
  width: number;
  height: number;
  rows: string[];
}

const textureCache = new Map<string, Texture>();

/** Builds a fixed-width pixel grid from ASCII-art rows (each character is one
 * "big pixel"). Shorter rows are padded with transparent cells. */
export function sprite(rows: string[]): PixelGrid {
  const width = Math.max(...rows.map((r) => r.length));
  return { width, height: rows.length, rows: rows.map((r) => r.padEnd(width, ".")) };
}

/** Draws a pixel grid's non-transparent cells onto an existing canvas context,
 * offset by (offsetX, offsetY) big-pixels. Shared by `rasterize` (fresh
 * canvas) and terrain decoration stamping (existing canvas, e.g. a tree
 * stamped onto an already-drawn grass diamond). */
export function drawGridOntoContext(
  ctx: CanvasRenderingContext2D,
  grid: PixelGrid,
  legend: Legend,
  scale: number,
  offsetX = 0,
  offsetY = 0,
  accent?: string,
): void {
  for (let y = 0; y < grid.height; y += 1) {
    const row = grid.rows[y];
    for (let x = 0; x < grid.width; x += 1) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const color = ch === "$" ? accent ?? "#ffffff" : ch === "s" ? SHADOW : legend[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect((x + offsetX) * scale, (y + offsetY) * scale, scale, scale);
    }
  }
}

/** Rasterizes a pixel grid onto a canvas with hard pixel edges (no
 * anti-aliasing) - this is what actually produces the "pixel art" look. */
export function rasterize(grid: PixelGrid, legend: Legend, scale: number, accent?: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  drawGridOntoContext(ctx, grid, legend, scale, 0, 0, accent);
  return canvas;
}

/** Like `getSpriteTexture`, but the canvas is built by an arbitrary painter
 * function instead of a single ASCII grid - used for procedurally generated
 * terrain tiles (diamond base + stamped decorations). */
export function getProceduralTexture(
  key: string,
  widthPx: number,
  heightPx: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    paint(ctx);
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

/** Builds (once) and caches a PIXI Texture for a given cache key - sprites are
 * cheap to define but not free to rasterize, and the same building/unit/tile
 * type + color combination is reused many times across the map. */
export function getSpriteTexture(
  key: string,
  grid: PixelGrid,
  legend: Legend,
  scale: number,
  accent?: string,
): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = rasterize(grid, legend, scale, accent);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}
