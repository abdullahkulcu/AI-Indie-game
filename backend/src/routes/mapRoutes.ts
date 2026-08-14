import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authPlugin.js";
import { getCachedSnapshot, getCurrentTickNumber, loadSnapshot } from "../game/gameStateService.js";

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/map", { preHandler: requireAuth }, async (_request, reply) => {
    const cached = await getCachedSnapshot();
    if (cached) return reply.send(cached);
    const tickNumber = await getCurrentTickNumber();
    return reply.send(await loadSnapshot(tickNumber));
  });
}
