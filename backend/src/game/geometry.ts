export function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function step(from: number, to: number): number {
  if (from === to) return 0;
  return from < to ? 1 : -1;
}

/** One tick's worth of movement toward a target tile (diagonal moves allowed). */
export function stepToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } {
  return { x: fromX + step(fromX, toX), y: fromY + step(fromY, toY) };
}
