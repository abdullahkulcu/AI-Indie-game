import { env } from "./config/env.js";
import { migrate } from "./db/migrate.js";
import { listChannels } from "./repositories/channelRepository.js";
import { buildServer } from "./server.js";
import { createSocketServer, broadcastTick } from "./ws/socketServer.js";
import { runTick } from "./game/tickService.js";

async function main() {
  await migrate(); // also seeds the fixed channel list (idempotent)

  const app = await buildServer();
  await app.ready();

  const io = createSocketServer(app.server);

  setInterval(() => {
    listChannels()
      .then((channels) =>
        Promise.all(
          channels.map((channel) =>
            runTick(channel)
              .then((result) => broadcastTick(io, result.snapshot))
              .catch((err) => app.log.error({ err, channel: channel.name }, "tick failed")),
          ),
        ),
      )
      .catch((err) => app.log.error({ err }, "failed to list channels for tick loop"));
  }, env.tickIntervalMs);

  await app.listen({ port: env.port, host: "0.0.0.0" });
  app.log.info(`Tick interval: ${env.tickIntervalMs}ms`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", err);
  process.exit(1);
});
