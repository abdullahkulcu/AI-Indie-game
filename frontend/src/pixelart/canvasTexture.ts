import { Texture } from "pixi.js";

/** Small texture-caching layer shared by tiles.ts/sprites.ts. All game art is
 * generated on demand by drawing flat, smooth-edged vector shapes (rounded
 * rects, circles, curves) onto a canvas with anti-aliasing on - a clean
 * "flat design" strategy-game look, not pixel art - then cached as a PixiJS
 * texture since the same building/unit/tile type + color combination is
 * reused many times across the map. */

const textureCache = new Map<string, Texture>();

export function getProceduralTexture(
  key: string,
  widthPx: number,
  heightPx: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    paint(ctx, widthPx, heightPx);
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  textureCache.set(key, texture);
  return texture;
}
