import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { AuthError, verifyToken } from "./authService.js";

declare module "fastify" {
  interface FastifyRequest {
    playerId?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Yetkilendirme basligi eksik." });
    return;
  }
  try {
    request.playerId = verifyToken(header.slice("Bearer ".length));
  } catch (err) {
    if (err instanceof AuthError || err instanceof jwt.JsonWebTokenError) {
      reply.code(401).send({ error: "Gecersiz veya suresi dolmus token." });
      return;
    }
    throw err;
  }
}
