import { listPlayers } from "../repositories/playerRepository.js";
import { claimTile, insertStructure } from "../repositories/mapRepository.js";
import { spawnUnit } from "../repositories/unitRepository.js";
import { startingPosition } from "./mapService.js";

/** Gives a freshly registered player their first foothold on the shared map:
 * a claimed starting tile, a free base, and a starting army + caravan unit. */
export async function joinGame(playerId: string): Promise<void> {
  const players = await listPlayers();
  const slotIndex = players.findIndex((p) => p.id === playerId);
  const { x, y } = startingPosition(slotIndex >= 0 ? slotIndex : players.length);

  await claimTile(x, y, playerId);
  await insertStructure(playerId, "base", x, y);
  await spawnUnit(playerId, "army", x, y);
  await spawnUnit(playerId, "caravan", x, y);
}
