import { env } from "./config/env.js";
import { migrate } from "./db/migrate.js";
import { seedTilesIfEmpty } from "./repositories/mapRepository.js";
import { generateTiles } from "./game/mapService.js";
import { buildServer } from "./server.js";
import { createSocketServer, broadcastTick } from "./ws/socketServer.js";
import { runTick } from "./game/tickService.js";

async function main() {
  await migrate();
  await seedTilesIfEmpty(generateTiles());

  const app = await buildServer();
  await app.ready();

  const io = createSocketServer(app.server);

  setInterval(() => {
    runTick()
      .then((result) => broadcastTick(io, result.snapshot))
      .catch((err) => app.log.error({ err }, "tick failed"));
  }, env.tickIntervalMs);

  await app.listen({ port: env.port, host: "0.0.0.0" });
  app.log.info(`Tick interval: ${env.tickIntervalMs}ms`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", err);
  process.exit(1);
});
