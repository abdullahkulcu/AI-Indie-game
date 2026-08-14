import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authPlugin.js";
import { listPlayers } from "../repositories/playerRepository.js";

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/players", { preHandler: requireAuth }, async (_request, reply) => {
    const players = await listPlayers();
    return reply.send(players);
  });
}
