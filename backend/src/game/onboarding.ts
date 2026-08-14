import { getChannel, countPlayersInChannel, growMapSize } from "../repositories/channelRepository.js";
import { setPlayerChannel, createResources } from "../repositories/playerRepository.js";
import { claimTile, insertStructure, listStructures } from "../repositories/mapRepository.js";
import { spawnUnit } from "../repositories/unitRepository.js";
import { randomStartingPosition, mapSizeForPlayerCount } from "./mapService.js";

export class ChannelJoinError extends Error {}

/** Assigns a player to a channel and gives them their first foothold on that
 * channel's map: a random starting tile (far from other players already
 * there), a free base, and a starting army + caravan unit beside it. */
export async function joinChannel(playerId: string, channelId: string): Promise<void> {
  const channel = await getChannel(channelId);
  if (!channel) throw new ChannelJoinError("Kanal bulunamadi.");

  const playerCount = await countPlayersInChannel(channelId);
  if (playerCount >= channel.maxPlayers) {
    throw new ChannelJoinError(`Kanal dolu: en fazla ${channel.maxPlayers} oyuncu.`);
  }

  // The map grows with the channel's population rather than exposing the
  // full 500x500 from the first join - see mapService.mapSizeForPlayerCount.
  const grownMapSize = mapSizeForPlayerCount(playerCount + 1);
  const effectiveMapSize = Math.max(channel.mapSize, grownMapSize);
  if (grownMapSize > channel.mapSize) {
    await growMapSize(channelId, grownMapSize);
  }

  const existingBases = (await listStructures(channelId))
    .filter((s) => s.type === "base")
    .map((s) => ({ x: s.x, y: s.y }));
  const { x, y } = randomStartingPosition(channel.seed, existingBases, effectiveMapSize);

  await setPlayerChannel(playerId, channelId);
  await createResources(playerId, channelId);
  await claimTile(channelId, x, y, playerId);
  await insertStructure(playerId, channelId, "base", x, y);
  // Units spawn beside the base rather than on top of it - both for
  // gameplay sense (a town center's garrison isn't standing inside it) and
  // so the map doesn't render multiple sprites stacked on one tile.
  await spawnUnit(playerId, channelId, "army", x + 1, y);
  await spawnUnit(playerId, channelId, "caravan", x, y + 1);
}
