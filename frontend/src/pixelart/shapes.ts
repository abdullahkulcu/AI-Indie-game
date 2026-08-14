/** Small canvas drawing helpers shared by tiles.ts/sprites.ts, all in the same
 * flat/vector visual language: soft rounded shapes, gentle gradients, and a
 * single shared drop-shadow style - no hard pixel edges. */

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
