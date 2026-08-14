import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authPlugin.js";
import { findPlayerById, listPlayersInChannel } from "../repositories/playerRepository.js";

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/players", { preHandler: requireAuth }, async (request, reply) => {
    const player = await findPlayerById(request.playerId as string);
    if (!player?.channelId) return reply.send([]);
    const players = await listPlayersInChannel(player.channelId);
    return reply.send(players);
  });
}
