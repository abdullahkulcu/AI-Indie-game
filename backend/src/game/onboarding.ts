import { MAP_SIZE } from "../models/types.js";
import { listPlayers } from "../repositories/playerRepository.js";
import { claimTile, insertStructure } from "../repositories/mapRepository.js";
import { spawnUnit } from "../repositories/unitRepository.js";
import { startingPosition, MAX_PLAYERS } from "./mapService.js";

function clampToMap(value: number): number {
  return Math.max(0, Math.min(MAP_SIZE - 1, value));
}

export { MAX_PLAYERS };

export async function isGameFull(): Promise<boolean> {
  const players = await listPlayers();
  return players.length >= MAX_PLAYERS;
}

/** Gives a freshly registered player their first foothold on the shared map:
 * a claimed starting tile, a free base, and a starting army + caravan unit.
 * Callers must check `isGameFull()` before creating the player row - this MVP
 * has a single shared map with a fixed number of starting corners. */
export async function joinGame(playerId: string): Promise<void> {
  const players = await listPlayers();
  const slotIndex = players.findIndex((p) => p.id === playerId);
  if (slotIndex === -1 || slotIndex >= MAX_PLAYERS) {
    throw new Error("Oyun dolu: maksimum oyuncu sayisina ulasildi.");
  }
  const { x, y } = startingPosition(slotIndex);

  await claimTile(x, y, playerId);
  await insertStructure(playerId, "base", x, y);
  // Units spawn beside the base rather than on top of it - both for
  // gameplay sense (a town center's garrison isn't standing inside it) and
  // so the map doesn't render three sprites stacked on one tile.
  await spawnUnit(playerId, "army", clampToMap(x + 1), y);
  await spawnUnit(playerId, "caravan", x, clampToMap(y + 1));
}
