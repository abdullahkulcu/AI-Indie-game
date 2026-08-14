import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authPlugin.js";
import { listChannels, countPlayersInChannel } from "../repositories/channelRepository.js";
import { joinChannel, ChannelJoinError } from "../game/onboarding.js";
import { findPlayerById } from "../repositories/playerRepository.js";

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/channels", { preHandler: requireAuth }, async (_request, reply) => {
    const channels = await listChannels();
    const withCounts = await Promise.all(
      channels.map(async (channel) => ({
        ...channel,
        playerCount: await countPlayersInChannel(channel.id),
      })),
    );
    return reply.send(withCounts);
  });

  app.post("/channels/:channelId/join", { preHandler: requireAuth }, async (request, reply) => {
    const playerId = request.playerId as string;
    const { channelId } = request.params as { channelId: string };

    const player = await findPlayerById(playerId);
    if (player?.channelId) {
      return reply.code(409).send({ error: "Zaten bir kanala katildiniz." });
    }

    try {
      await joinChannel(playerId, channelId);
      return reply.send({ channelId });
    } catch (err) {
      if (err instanceof ChannelJoinError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
