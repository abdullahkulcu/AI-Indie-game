export function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function step(from: number, to: number, speed: number): number {
  const delta = to - from;
  if (delta === 0) return 0;
  const clamped = Math.min(Math.abs(delta), speed);
  return delta > 0 ? clamped : -clamped;
}

/** How many tiles a unit covers per tick while marching toward an assigned
 * task. The map is large (up to 500x500) and players can spawn well over a
 * hundred tiles apart, so a single tile/tick would make closing distance to
 * fight impractically slow - this keeps marches on the order of tens of
 * ticks rather than hundreds. */
export const UNIT_MOVE_SPEED = 4;

/** One tick's worth of movement toward a target tile (diagonal moves allowed,
 * up to `speed` tiles per axis, never overshooting the target). */
export function stepToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number = UNIT_MOVE_SPEED,
): { x: number; y: number } {
  return { x: fromX + step(fromX, toX, speed), y: fromY + step(fromY, toY, speed) };
}
