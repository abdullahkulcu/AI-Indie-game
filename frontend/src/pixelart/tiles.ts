import type { Texture } from "pixi.js";
import { getProceduralTexture } from "./canvasTexture";
import { blobPath, groundShadow, speckleTexture } from "./shapes";
import { DIRT, GRASS, LEAVES, SAND, STONE, WATER, WOOD } from "./palette";

/** Isometric diamond terrain tiles, generated procedurally - gradient-filled
 * diamonds with a painterly speckle texture (see speckleTexture) and layered
 * decorations, rather than pixel art or downloaded image files - this keeps
 * every visual asset in version-controlled code with no external asset
 * dependency. Ratio is the classic 2:1 isometric diamond used by Age of
 * Empires-era tile engines. */

export const TILE_PX_W = 96;
export const TILE_PX_H = 48;

function diamondPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w, h / 2);
  ctx.lineTo(w / 2, h);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
}

function paintDiamondBase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tones: { dark: string; mid: string; light: string },
  textureSeed = 1,
): void {
  diamondPath(ctx, w, h);
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, tones.light);
  gradient.addColorStop(0.55, tones.mid);
  gradient.addColorStop(1, tones.dark);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Painterly texture pass - clipped to the diamond so it never bleeds past
  // the tile edge, then a soft rim-light along the upper-left (the "sun"
  // side) and a matching shade along the lower-right for real dimensionality
  // instead of a flat gradient.
  ctx.save();
  diamondPath(ctx, w, h);
  ctx.clip();
  speckleTexture(ctx, w, h, tones.dark, tones.light, 260, textureSeed);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = tones.light;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.08, h * 0.46);
  ctx.lineTo(w * 0.46, h * 0.08);
  ctx.stroke();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = tones.dark;
  ctx.beginPath();
  ctx.moveTo(w * 0.54, h * 0.92);
  ctx.lineTo(w * 0.92, h * 0.54);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(10, 14, 20, 0.2)";
  ctx.lineWidth = 1;
  diamondPath(ctx, w, h);
  ctx.stroke();
  ctx.restore();
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  groundShadow(ctx, x, y + 2 * scale, 7 * scale, 2.4 * scale);
  ctx.fillStyle = WOOD.dark;
  ctx.fillRect(x - 1 * scale, y - 2 * scale, 2 * scale, 6 * scale);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x - 1 * scale, y - 2 * scale, 2 * scale, 6 * scale);

  const canopy = [
    { dx: -3, dy: -8, r: 5.4, color: LEAVES.dark },
    { dx: 3, dy: -7, r: 5, color: LEAVES.mid },
    { dx: -1, dy: -10, r: 4.2, color: LEAVES.mid },
    { dx: 0, dy: -11, r: 4.6, color: LEAVES.light },
  ];
  for (const c of canopy) {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(x + c.dx * scale, y + c.dy * scale, c.r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // A small highlight fleck on the sun-facing side of the canopy - reads as
  // dappled light rather than one flat blob of green.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = LEAVES.light;
  ctx.beginPath();
  ctx.arc(x - 1.5 * scale, y - 12 * scale, 1.8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function rockCluster(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, seed: number): void {
  groundShadow(ctx, x, y + 1.5 * scale, 9 * scale, 3 * scale);
  ctx.fillStyle = STONE.dark;
  blobPath(ctx, x - 1.5 * scale, y - 1 * scale, 6.5 * scale, 7, 0.24, seed);
  ctx.fill();
  ctx.fillStyle = STONE.mid;
  blobPath(ctx, x + 3 * scale, y - 1.5 * scale, 5 * scale, 7, 0.24, seed + 5);
  ctx.fill();
  ctx.fillStyle = STONE.light;
  blobPath(ctx, x, y - 5 * scale, 3.2 * scale, 6, 0.2, seed + 9);
  ctx.fill();

  // Crack/facet lines give the rock a carved, faceted look instead of a
  // smooth pebble silhouette.
  ctx.save();
  ctx.strokeStyle = "rgba(10, 10, 12, 0.35)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - 3 * scale, y - 2 * scale);
  ctx.lineTo(x - 0.5 * scale, y + 1.5 * scale);
  ctx.moveTo(x + 1 * scale, y - 3 * scale);
  ctx.lineTo(x + 2.5 * scale, y);
  ctx.stroke();
  ctx.restore();
}

function duneHighlights(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = SAND.dark;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (const [sx, sy, ex, ey, cx, cy] of [
    [w * 0.22, h * 0.62, w * 0.5, h * 0.5, w * 0.36, h * 0.44],
    [w * 0.42, h * 0.82, w * 0.78, h * 0.66, w * 0.6, h * 0.62],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

function waterFoam(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = WATER.foam;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const [sx, sy, ex, ey, cx, cy] of [
    [w * 0.28, h * 0.42, w * 0.56, h * 0.42, w * 0.42, h * 0.34],
    [w * 0.4, h * 0.66, w * 0.7, h * 0.66, w * 0.55, h * 0.58],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

function oasisPool(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10 * scale);
  gradient.addColorStop(0, WATER.light);
  gradient.addColorStop(1, WATER.dark);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = WATER.foam;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function palm(ctx: CanvasRenderingContext2D, x: number, groundY: number, scale: number, lean: number): void {
  groundShadow(ctx, x, groundY + 1 * scale, 5 * scale, 1.8 * scale);
  const topX = x + lean * scale;
  const topY = groundY - 12 * scale;
  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 1.6 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, groundY);
  ctx.quadraticCurveTo(x + lean * 0.6 * scale, groundY - 7 * scale, topX, topY);
  ctx.stroke();

  for (const angle of [-70, -25, 25, 70]) {
    const rad = (angle * Math.PI) / 180;
    ctx.strokeStyle = LEAVES.mid;
    ctx.lineWidth = 1.4 * scale;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(
      topX + Math.sin(rad) * 5 * scale,
      topY - 2 * scale,
      topX + Math.sin(rad) * 8 * scale,
      topY + Math.cos(rad) * 2 * scale + 2 * scale,
    );
    ctx.stroke();
  }
  ctx.fillStyle = LEAVES.dark;
  ctx.beginPath();
  ctx.arc(topX, topY, 1.6 * scale, 0, Math.PI * 2);
  ctx.fill();
}

export type TileTerrain = "plains" | "forest" | "mountain" | "water" | "desert" | "oasis";

export function getTileTexture(terrain: TileTerrain): Texture {
  const w = TILE_PX_W;
  const h = TILE_PX_H;
  const scale = h / 24;

  switch (terrain) {
    case "plains":
      return getProceduralTexture(`tile:plains`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, GRASS, 11);
      });
    case "forest":
      return getProceduralTexture(`tile:forest`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, GRASS, 12);
        tree(ctx, w * 0.34, h * 0.52, scale);
        tree(ctx, w * 0.64, h * 0.38, scale * 0.9);
        tree(ctx, w * 0.52, h * 0.7, scale * 0.85);
      });
    case "mountain":
      return getProceduralTexture(`tile:mountain`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, DIRT, 13);
        rockCluster(ctx, w * 0.5, h * 0.56, scale, 3);
      });
    case "water":
      return getProceduralTexture(`tile:water`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, WATER, 14);
        waterFoam(ctx, w, h);
      });
    case "desert":
      return getProceduralTexture(`tile:desert`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, SAND, 15);
        duneHighlights(ctx, w, h);
      });
    case "oasis":
      return getProceduralTexture(`tile:oasis`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, SAND, 16);
        oasisPool(ctx, w * 0.5, h * 0.58, scale);
        palm(ctx, w * 0.24, h * 0.66, scale * 0.9, -1);
        palm(ctx, w * 0.76, h * 0.44, scale * 0.8, 1);
      });
    default:
      return getProceduralTexture(`tile:plains`, w, h, (ctx) => {
        paintDiamondBase(ctx, w, h, GRASS, 11);
      });
  }
}
