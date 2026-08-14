import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { authRoutes } from "./auth/authRoutes.js";
import { mapRoutes } from "./routes/mapRoutes.js";
import { playerRoutes } from "./routes/playerRoutes.js";
import { chatRoutes } from "./routes/chatRoutes.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.corsOrigin });

  app.get("/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(mapRoutes);
  await app.register(playerRoutes);
  await app.register(chatRoutes);

  return app;
}
