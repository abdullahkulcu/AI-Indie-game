import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authPlugin.js";
import { getCachedSnapshot, getCurrentTickNumber, loadSnapshot } from "../game/gameStateService.js";
import { findPlayerById } from "../repositories/playerRepository.js";
import { getChannel } from "../repositories/channelRepository.js";

/** The snapshot stays cheap to ship even on a 300x300 map: only claimed
 * tiles are included (see gameStateService.loadSnapshot) - the frontend
 * computes plain terrain for whatever's in its viewport itself, the same
 * deterministic way the backend does. */
export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/map", { preHandler: requireAuth }, async (request, reply) => {
    const player = await findPlayerById(request.playerId as string);
    if (!player?.channelId) {
      return reply.code(409).send({ error: "Once bir kanala katilmaniz gerekiyor." });
    }
    const channel = await getChannel(player.channelId);
    if (!channel) return reply.code(404).send({ error: "Kanal bulunamadi." });

    const cached = await getCachedSnapshot(channel.id);
    if (cached) return reply.send(cached);
    const tickNumber = await getCurrentTickNumber(channel.id);
    return reply.send(await loadSnapshot(channel, tickNumber));
  });
}
