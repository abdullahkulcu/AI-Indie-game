/**
 * HTTP API süreci.
 *
 * Tick servisinden (`src/tick/worker.ts`) ayrı bir süreç olarak koşar. Ayrım
 * kasıtlı: oyun dünyası, API isteği gelsin gelmesin ilerlemeli (oyun kapalıyken
 * bile krallık "hayatta"), ve bir API dağıtımı sırasında tick durmamalı
 * (§16.5 rolling deployment).
 */

import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { closeRedis } from './redis.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerRoutes } from './http/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'debug',
      // API anahtarları ve parolalar loglara asla düşmemeli (§15.5).
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.password',
          'req.body.apiKey',
          'body.apiKey',
        ],
        censor: '[gizlendi]',
      },
    },
    bodyLimit: 1_000_000,
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    credentials: true,
  });

  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn },
  });

  registerAuthRoutes(app);
  registerRoutes(app);

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error }, 'istek başarısız');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.code(status).send({
      // 5xx'te iç hata mesajını sızdırmıyoruz; 4xx'te mesaj oyuncuya yararlı.
      error:
        status >= 500
          ? 'Sunucuda beklenmedik bir sorun oluştu.'
          : (error.message || 'İstek işlenemedi.'),
    });
  });

  return app;
}

async function main(): Promise<void> {
  await runMigrations();
  const app = await buildApp();

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API ${config.host}:${config.port} üzerinde dinliyor`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} alındı, kapatılıyor…`);
    await app.close();
    await Promise.allSettled([closePool(), closeRedis()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const entryPoint = process.argv[1] ?? '';
if (entryPoint.endsWith('api.ts') || entryPoint.endsWith('api.js')) {
  main().catch((error: unknown) => {
    console.error('[api] ölümcül hata:', error);
    process.exit(1);
  });
}
