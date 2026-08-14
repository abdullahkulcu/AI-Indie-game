import type { Texture } from "pixi.js";
import { getProceduralTexture } from "./canvasTexture";
import { lighten, shade } from "./color";
import { flag, groundShadow } from "./shapes";
import { CROP, METAL, SKIN, SKIN_SHADOW, STONE, THATCH, WALL, WOOD } from "./palette";

/** Building and unit art, drawn as flat, gradient-shaded vector shapes
 * (rounded rects, circles, simple paths) rather than pixel art or downloaded
 * image files - keeps every visual asset in version-controlled code with no
 * external asset dependency. Buildings stay in neutral materials with an
 * accent-colored flag/banner or decoration; units wear the accent (with real
 * light/dark shading derived from it) as their tunic/wagon color, matching
 * how Age of Empires-era games showed ownership without recoloring the whole
 * sprite. Buildings render noticeably larger than units so a town center
 * dwarfs a soldier standing next to it. */

export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market" | "mine";
export type UnitType = "army" | "caravan" | "mob";

/** Wild mobs have no owner/accent color - a fixed, dull, hostile tone marks
 * them as neutral wildlife/bandits rather than a recolorable player unit. */
const MOB_TONE = { dark: "#3a2e22", mid: "#5a4636", light: "#7a5f42" };
const MOB_EYE = "#e63946";

const BUILDING_W = 116;
const BUILDING_H = 138;
const UNIT_W = 56;
const UNIT_H = 92;

function verticalFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  top: string,
  bottom: string,
): CanvasGradient {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBase(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 4;
  const bodyW = 66;
  const bodyH = 48;
  const bodyTop = bottomY - bodyH;

  groundShadow(ctx, cx, bottomY + 2, bodyW * 0.62, 9);

  ctx.fillStyle = STONE.dark;
  roundRect(ctx, cx - bodyW / 2 - 3, bottomY - 8, bodyW + 6, 10, 3);
  ctx.fill();

  roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 6);
  ctx.fillStyle = verticalFill(ctx, 0, bodyTop, bodyH, WALL.light, WALL.mid);
  ctx.fill();

  ctx.fillStyle = WOOD.dark;
  roundRect(ctx, cx - 8, bottomY - 22, 16, 22, 3);
  ctx.fill();

  const roofTop = bodyTop - 30;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2 - 6, bodyTop + 4);
  ctx.lineTo(cx, roofTop);
  ctx.lineTo(cx + bodyW / 2 + 6, bodyTop + 4);
  ctx.closePath();
  ctx.fillStyle = verticalFill(ctx, 0, roofTop, bodyTop + 4 - roofTop, THATCH.light, THATCH.dark);
  ctx.fill();

  flag(ctx, cx, roofTop - 20, 20, accent);
}

function drawFarm(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 6;
  const plotW = 84;
  const plotH = 44;
  const top = bottomY - plotH;

  groundShadow(ctx, cx, bottomY + 2, plotW * 0.56, 9);

  roundRect(ctx, cx - plotW / 2, top, plotW, plotH, 6);
  ctx.fillStyle = "#5a4a2c";
  ctx.fill();
  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 3;
  roundRect(ctx, cx - plotW / 2, top, plotW, plotH, 6);
  ctx.stroke();

  const rows = 3;
  const cols = 5;
  const padX = 8;
  const padY = 8;
  const cellW = (plotW - padX * 2) / cols;
  const cellH = (plotH - padY * 2) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cellX = cx - plotW / 2 + padX + col * cellW;
      const cellY = top + padY + row * cellH;
      ctx.fillStyle = (row + col) % 2 === 0 ? CROP.mid : CROP.light;
      roundRect(ctx, cellX + 1.5, cellY + 1.5, cellW - 3, cellH - 3, 2);
      ctx.fill();
    }
  }

  const poleX = cx + plotW / 2 - 4;
  const poleTop = top - 16;
  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(poleX, top);
  ctx.lineTo(poleX, poleTop);
  ctx.stroke();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(poleX, poleTop - 5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  roundRect(ctx, poleX - 6, poleTop - 1, 12, 10, 3);
  ctx.fill();
}

function drawSawmill(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 4;
  const logsH = 16;
  const bodyW = 68;
  const bodyH = 44;
  const bodyTop = bottomY - logsH - bodyH;

  groundShadow(ctx, cx, bottomY + 2, bodyW * 0.6, 9);

  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? WOOD.mid : WOOD.light;
    roundRect(ctx, cx - bodyW / 2 + i * (bodyW / 4), bottomY - logsH, bodyW / 4 - 2, logsH - 2, 3);
    ctx.fill();
  }

  roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 6);
  ctx.fillStyle = verticalFill(ctx, 0, bodyTop, bodyH, WALL.light, WALL.mid);
  ctx.fill();

  const bladeR = 15;
  const bladeCx = cx;
  const bladeCy = bodyTop + bodyH * 0.42;
  ctx.fillStyle = STONE.mid;
  ctx.beginPath();
  ctx.arc(bladeCx, bladeCy, bladeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = STONE.light;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(bladeCx, bladeCy);
    ctx.lineTo(bladeCx + Math.cos(a) * bladeR, bladeCy + Math.sin(a) * bladeR);
    ctx.stroke();
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(bladeCx, bladeCy, 4, 0, Math.PI * 2);
  ctx.fill();

  flag(ctx, cx + bodyW / 2 - 6, bodyTop - 20, 20, accent);
}

function drawBarracks(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 4;
  const towerW = 26;
  const towerH = 46;
  const towerTop = bottomY - towerH;
  const gap = 30;

  groundShadow(ctx, cx, bottomY + 2, 60, 9);

  ctx.fillStyle = verticalFill(ctx, 0, towerTop, 20, WALL.light, WALL.mid);
  roundRect(ctx, cx - gap / 2 - towerW / 2, towerTop + 20, gap + towerW, 22, 4);
  ctx.fill();

  for (const side of [-1, 1]) {
    const tx = cx + side * (gap / 2 + towerW / 2) - towerW / 2;
    roundRect(ctx, tx, towerTop, towerW, towerH, 4);
    ctx.fillStyle = verticalFill(ctx, 0, towerTop, towerH, WALL.light, WALL.mid);
    ctx.fill();

    const roofTop = towerTop - 18;
    ctx.beginPath();
    ctx.moveTo(tx - 3, towerTop + 3);
    ctx.lineTo(tx + towerW / 2, roofTop);
    ctx.lineTo(tx + towerW + 3, towerTop + 3);
    ctx.closePath();
    ctx.fillStyle = STONE.dark;
    ctx.fill();

    flag(ctx, tx + towerW / 2, roofTop - 18, 18, accent);
  }

  ctx.fillStyle = "#241a12";
  roundRect(ctx, cx - 8, bottomY - 20, 16, 20, 3);
  ctx.fill();
}

function drawMarket(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 4;
  const tentW = 78;
  const tentTop = bottomY - 56;
  const awningH = 20;

  groundShadow(ctx, cx, bottomY + 2, tentW * 0.55, 9);

  const stripes = 6;
  for (let i = 0; i < stripes; i += 1) {
    const x0 = cx - tentW / 2 + (i * tentW) / stripes;
    const x1 = cx - tentW / 2 + ((i + 1) * tentW) / stripes;
    ctx.beginPath();
    ctx.moveTo(x0, tentTop + awningH);
    ctx.lineTo(x1, tentTop + awningH);
    ctx.lineTo(cx, tentTop);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? accent : lighten(accent, 0.5);
    ctx.fill();
  }

  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * (tentW / 2 - 4), tentTop + awningH);
    ctx.lineTo(cx + side * (tentW / 2 - 4), bottomY - 14);
    ctx.stroke();
  }

  const counterW = tentW - 14;
  roundRect(ctx, cx - counterW / 2, bottomY - 16, counterW, 16, 3);
  ctx.fillStyle = WOOD.mid;
  ctx.fill();

  const goods: Array<[number, string]> = [
    [-0.32, CROP.light],
    [-0.1, CROP.mid],
    [0.12, STONE.light],
    [0.32, CROP.light],
  ];
  for (const [t, color] of goods) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + t * counterW, bottomY - 20, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMine(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = BUILDING_W / 2;
  const bottomY = BUILDING_H - 4;
  const shaftW = 34;
  const shaftH = 22;
  const shaftTop = bottomY - shaftH;
  const frameTop = shaftTop - 34;

  groundShadow(ctx, cx, bottomY + 2, 42, 9);

  ctx.fillStyle = verticalFill(ctx, 0, shaftTop - 10, shaftH + 10, WALL.mid, WALL.mid);
  roundRect(ctx, cx - shaftW / 2 - 12, shaftTop - 10, shaftW + 24, shaftH + 10, 5);
  ctx.fill();

  roundRect(ctx, cx - shaftW / 2, shaftTop, shaftW, shaftH, 4);
  ctx.fillStyle = "#1a1410";
  ctx.fill();

  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 22, shaftTop);
  ctx.lineTo(cx, frameTop);
  ctx.lineTo(cx + 22, shaftTop);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 12, shaftTop - 12);
  ctx.lineTo(cx + 12, shaftTop - 12);
  ctx.stroke();

  flag(ctx, cx, frameTop - 18, 18, accent);
}

const BUILDING_PAINTERS: Record<StructureType, (ctx: CanvasRenderingContext2D, accent: string) => void> = {
  base: drawBase,
  farm: drawFarm,
  sawmill: drawSawmill,
  barracks: drawBarracks,
  market: drawMarket,
  mine: drawMine,
};

function drawArmy(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = UNIT_W / 2;
  const bottomY = UNIT_H - 6;

  groundShadow(ctx, cx, bottomY, 14, 4.5);

  ctx.fillStyle = "#241a12";
  roundRect(ctx, cx - 8, bottomY - 20, 6, 20, 2);
  ctx.fill();
  roundRect(ctx, cx + 2, bottomY - 20, 6, 20, 2);
  ctx.fill();

  const bodyTop = bottomY - 48;
  const bodyH = 30;
  roundRect(ctx, cx - 12, bodyTop, 24, bodyH, 7);
  ctx.fillStyle = verticalFill(ctx, 0, bodyTop, bodyH, lighten(accent, 0.2), shade(accent, 0.7));
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.moveTo(cx - 12, bodyTop + 6);
  ctx.lineTo(cx - 12, bodyTop + bodyH);
  ctx.moveTo(cx + 12, bodyTop + 6);
  ctx.lineTo(cx + 12, bodyTop + bodyH);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(cx, bodyTop - 10, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SKIN_SHADOW;
  ctx.beginPath();
  ctx.arc(cx - 3, bodyTop - 7, 1.6, 0, Math.PI * 2);
  ctx.arc(cx + 3, bodyTop - 7, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = METAL;
  ctx.beginPath();
  ctx.arc(cx, bodyTop - 14, 10.5, Math.PI, Math.PI * 2);
  ctx.fill();

  const swordX = cx + 15;
  ctx.strokeStyle = METAL;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(swordX, bodyTop + 2);
  ctx.lineTo(swordX, bodyTop - 22);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(swordX - 4, bodyTop + 2);
  ctx.lineTo(swordX + 4, bodyTop + 2);
  ctx.stroke();
  ctx.fillStyle = WOOD.dark;
  roundRect(ctx, swordX - 1.5, bodyTop + 2, 3, 8, 1);
  ctx.fill();
}

function drawCaravan(ctx: CanvasRenderingContext2D, accent: string): void {
  const cx = UNIT_W / 2;
  const bottomY = UNIT_H - 10;

  groundShadow(ctx, cx, bottomY + 6, 22, 5);

  for (const wx of [cx - 14, cx + 14]) {
    ctx.fillStyle = WOOD.dark;
    ctx.beginPath();
    ctx.arc(wx, bottomY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = METAL;
    ctx.lineWidth = 1.4;
    for (const a of [0, 60, 120]) {
      const rad = (a * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(rad) * 7, bottomY - Math.sin(rad) * 7);
      ctx.lineTo(wx + Math.cos(rad) * 7, bottomY + Math.sin(rad) * 7);
      ctx.stroke();
    }
    ctx.fillStyle = METAL;
    ctx.beginPath();
    ctx.arc(wx, bottomY, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const bodyW = 40;
  const bodyH = 20;
  const bodyTop = bottomY - 8 - bodyH;
  roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 5);
  ctx.fillStyle = verticalFill(ctx, 0, bodyTop, bodyH, lighten(accent, 0.15), shade(accent, 0.75));
  ctx.fill();

  const canopyTop = bodyTop - 14;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2 + 2, bodyTop + 2);
  ctx.quadraticCurveTo(cx, canopyTop - 4, cx + bodyW / 2 - 2, bodyTop + 2);
  ctx.lineTo(cx + bodyW / 2 - 2, bodyTop);
  ctx.quadraticCurveTo(cx, canopyTop - 8, cx - bodyW / 2 + 2, bodyTop);
  ctx.closePath();
  ctx.fillStyle = lighten(accent, 0.55);
  ctx.fill();
}

function drawMob(ctx: CanvasRenderingContext2D): void {
  const cx = UNIT_W / 2;
  const bottomY = UNIT_H - 6;

  groundShadow(ctx, cx, bottomY, 14, 4.5);

  ctx.fillStyle = "#1a140e";
  roundRect(ctx, cx - 8, bottomY - 18, 6, 18, 2);
  ctx.fill();
  roundRect(ctx, cx + 2, bottomY - 18, 6, 18, 2);
  ctx.fill();

  const bodyTop = bottomY - 44;
  const bodyH = 28;
  roundRect(ctx, cx - 12, bodyTop, 24, bodyH, 6);
  ctx.fillStyle = verticalFill(ctx, 0, bodyTop, bodyH, MOB_TONE.mid, MOB_TONE.dark);
  ctx.fill();

  // Hooded head with glowing eyes - reads as a hostile silhouette at a
  // glance, distinct from the helmeted player soldier.
  ctx.fillStyle = MOB_TONE.dark;
  ctx.beginPath();
  ctx.arc(cx, bodyTop - 9, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MOB_EYE;
  ctx.beginPath();
  ctx.arc(cx - 3, bodyTop - 9, 1.6, 0, Math.PI * 2);
  ctx.arc(cx + 3, bodyTop - 9, 1.6, 0, Math.PI * 2);
  ctx.fill();

  const clubX = cx + 15;
  ctx.strokeStyle = WOOD.dark;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(clubX, bodyTop + 4);
  ctx.lineTo(clubX + 2, bodyTop - 14);
  ctx.stroke();
  ctx.fillStyle = STONE.dark;
  ctx.beginPath();
  ctx.arc(clubX + 2, bodyTop - 17, 5, 0, Math.PI * 2);
  ctx.fill();
}

const UNIT_PAINTERS: Record<UnitType, (ctx: CanvasRenderingContext2D, accent: string) => void> = {
  army: drawArmy,
  caravan: drawCaravan,
  mob: drawMob,
};

export function getBuildingTexture(type: StructureType, accent: string): Texture {
  return getProceduralTexture(`building:${type}:${accent}`, BUILDING_W, BUILDING_H, (ctx) => {
    BUILDING_PAINTERS[type](ctx, accent);
  });
}

export function getUnitTexture(type: UnitType, accent: string): Texture {
  return getProceduralTexture(`unit:${type}:${accent}`, UNIT_W, UNIT_H, (ctx) => {
    UNIT_PAINTERS[type](ctx, accent);
  });
}
