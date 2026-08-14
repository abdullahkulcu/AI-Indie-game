/** Small canvas drawing helpers shared by tiles.ts/sprites.ts, all in the same
 * flat/vector visual language: soft rounded shapes, gentle gradients, and a
 * single shared drop-shadow style - no hard pixel edges. */

export function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** Scatters small semi-transparent dark/light speckles across whatever is
 * currently clipped (caller sets up the clip path, e.g. a tile diamond or a
 * building wall) - turns a flat gradient fill into something that reads as a
 * painted/textured surface instead of a smooth vector gradient. Deterministic
 * per seed so a cached texture always looks the same. */
export function speckleTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  darkColor: string,
  lightColor: string,
  count: number,
  seed: number,
): void {
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const n1 = hash(seed + i * 3.107);
    const n2 = hash(seed + i * 7.719 + 41.3);
    const n3 = hash(seed + i * 13.37 + 91.7);
    const x = n1 * w;
    const y = n2 * h;
    const isLight = n3 > 0.5;
    ctx.fillStyle = isLight ? lightColor : darkColor;
    ctx.globalAlpha = 0.05 + n3 * 0.14;
    const r = 0.5 + n3 * 1.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Soft contact shadow every building/unit/decoration sits on, so flat shapes
 * still read as standing "on" the ground instead of floating. */
export function groundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(6, 10, 16, 0.32)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** An irregular rounded blob (rock outcrop, foliage clump) built from N points
 * around a center with per-point radius jitter from a deterministic seed, so
 * it reads as organic rather than a perfect circle/polygon. */
export function blobPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  points = 8,
  jitter = 0.22,
  seed = 1,
): void {
  const angleStep = (Math.PI * 2) / points;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const angle = i * angleStep;
    const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const wobble = 1 + (n - Math.floor(n) - 0.5) * 2 * jitter;
    const r = radius * wobble;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r * 0.75; // slightly flattened, ground-hugging
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A small triangular pennant flag on a thin pole, the recurring "this is
 * yours" accent marker on every building. */
export function flag(
  ctx: CanvasRenderingContext2D,
  x: number,
  topY: number,
  poleHeight: number,
  color: string,
): void {
  ctx.strokeStyle = "rgba(20, 20, 25, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, topY + poleHeight);
  ctx.lineTo(x, topY);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x + poleHeight * 0.42, topY + poleHeight * 0.14);
  ctx.lineTo(x, topY + poleHeight * 0.28);
  ctx.closePath();
  ctx.fill();
}

/** Clips speckleTexture to a rectangle - the wall-surface equivalent of a
 * tile's painterly ground texture, so timber/stone walls read as a textured
 * material rather than a flat gradient fill. */
export function wallTexture(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  darkColor: string,
  lightColor: string,
  seed: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  speckleTexture(ctx, w, h, darkColor, lightColor, Math.max(24, Math.floor((w * h) / 10)), seed);
  ctx.restore();
}

/** A small framed window with a warm lit interior and a cross-mullion - the
 * single detail that most reads as "building" rather than "colored box" at a
 * glance. */
export function windowPane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(20, 14, 8, 0.6)";
  ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = "#f2c46b";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(20, 14, 8, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.restore();
}

/** Horizontal shingle lines clipped to a roof polygon - breaks up a flat
 * triangular roof fill into overlapping courses like a real thatch/tile roof. */
export function roofShingleLines(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  color: string,
  lines = 4,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.clip();

  const minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const minX = Math.min(...points.map((p) => p[0])) - 12;
  const maxX = Math.max(...points.map((p) => p[0])) + 12;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  for (let i = 1; i < lines; i += 1) {
    const y = minY + ((maxY - minY) * i) / lines;
    ctx.beginPath();
    ctx.moveTo(minX, y);
    ctx.lineTo(maxX, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** A few soft, rising, fading circles above a chimney - the small bit of
 * "this place is alive" motion cue Stronghold-style town centers use. */
export function chimneySmoke(ctx: CanvasRenderingContext2D, x: number, y: number, seed = 1): void {
  ctx.save();
  for (let i = 0; i < 4; i += 1) {
    const n = hash(seed + i * 3.3);
    const px = x + Math.sin(seed + i) * 3 + (n - 0.5) * 5;
    const py = y - i * 8 - n * 3;
    const r = 2.6 + i * 1.5;
    ctx.globalAlpha = 0.24 - i * 0.05;
    ctx.fillStyle = "#d8d8d8";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
