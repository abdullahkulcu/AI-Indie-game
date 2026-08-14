import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authPlugin.js";
import { listRecentChat } from "../repositories/chatRepository.js";
import { runPlayerTurn, NoChannelError } from "../game/playerTurnService.js";

const sendSchema = z.object({ message: z.string().min(1).max(2000) });

/** REST fallback for chat (the primary path is the websocket "chat:send"
 * event in src/ws/socketServer.ts; both call the same runPlayerTurn). */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/chat/history", { preHandler: requireAuth }, async (request, reply) => {
    const history = await listRecentChat(request.playerId as string);
    return reply.send(history);
  });

  app.post("/chat/send", { preHandler: requireAuth }, async (request, reply) => {
    const body = sendSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    try {
      const result = await runPlayerTurn(request.playerId as string, body.data.message);
      return reply.send(result);
    } catch (err) {
      if (err instanceof NoChannelError) {
        return reply.code(409).send({ error: err.message });
      }
      request.log.error({ err }, "chat/send failed");
      return reply.code(502).send({ error: "Generaliniz su anda karar veremiyor, tekrar deneyin." });
    }
  });
}
