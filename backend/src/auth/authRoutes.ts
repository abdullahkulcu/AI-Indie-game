import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, login, register } from "./authService.js";
import { requireAuth } from "./authPlugin.js";
import { encryptSecret } from "../crypto/keyVault.js";
import { getResources, hasApiKey, upsertApiKey } from "../repositories/playerRepository.js";
import { isGameFull, joinGame, MAX_PLAYERS } from "../game/onboarding.js";

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const apiKeySchema = z.object({
  apiKey: z.string().min(20),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    if (await isGameFull()) {
      return reply
        .code(409)
        .send({ error: `Oyun dolu: bu MVP en fazla ${MAX_PLAYERS} oyuncuyu destekliyor.` });
    }
    try {
      const result = await register(body.data.username, body.data.email, body.data.password);
      await joinGame(result.player.id);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    try {
      const result = await login(body.data.email, body.data.password);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ error: err.message });
      }
      throw err;
    }
  });

  // BYOK: kullanicinin kendi LLM API key'ini baglamasi. Anahtar hicbir zaman
  // geri okunmaz/gosterilmez; sadece sunucu tarafinda LLM cagrisi icin cozulur.
  app.post("/auth/api-key", { preHandler: requireAuth }, async (request, reply) => {
    const body = apiKeySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }
    const encrypted = encryptSecret(body.data.apiKey);
    await upsertApiKey(request.playerId as string, encrypted);
    return reply.send({ connected: true });
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const playerId = request.playerId as string;
    const [resources, keyConnected] = await Promise.all([
      getResources(playerId),
      hasApiKey(playerId),
    ]);
    return reply.send({ playerId, resources, apiKeyConnected: keyConnected });
  });
}
