/**
 * Kimlik doğrulama ve yetkilendirme.
 *
 * Basit e-posta/parola + JWT. Oyunun güvenlik ağırlığı burada değil, aksiyon
 * doğrulamasında (§15.5) — ama her isteğin hangi krallığa dokunmaya yetkili
 * olduğu burada belirleniyor.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@krallik/shared';
import { hashPassword, verifyPassword } from '../crypto.js';
import { query, queryOne } from '../db/pool.js';
import type { KingdomRow, UserRow } from '../db/rows.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  };
}

/** Token'ı doğrular ve `request.authUser`'ı doldurur. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const payload = await request.jwtVerify<{ sub: string }>();
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [payload.sub]);
    if (!user) {
      await reply.code(401).send({ error: 'Oturum geçersiz.' });
      return;
    }
    request.authUser = toAuthUser(user);
    // Son görülme bilgisi; pasif/aktif ayrımı krallık düzeyinde tutuluyor ama
    // hesap düzeyinde de bir iz bırakmak istatistikler için yararlı.
    void query('UPDATE users SET last_seen_at = now() WHERE id = $1', [user.id]).catch(() => {});
  } catch {
    await reply.code(401).send({ error: 'Kimlik doğrulaması gerekli.' });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!request.authUser?.isAdmin) {
    await reply.code(403).send({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
  }
}

/**
 * Krallığın istekte bulunan kullanıcıya ait olduğunu doğrular.
 *
 * Bu kontrol tek bir yerde toplanıyor çünkü atlanması durumunda bir oyuncu
 * başkasının krallığına emir verebilirdi — LLM katmanının prompt injection
 * savunması (§15.5) da bu garantiye yaslanıyor.
 */
export async function loadOwnedKingdom(
  request: FastifyRequest,
  reply: FastifyReply,
  kingdomId: string,
): Promise<KingdomRow | null> {
  const kingdom = await queryOne<KingdomRow>('SELECT * FROM kingdoms WHERE id = $1', [kingdomId]);
  if (!kingdom) {
    await reply.code(404).send({ error: 'Krallık bulunamadı.' });
    return null;
  }
  if (kingdom.user_id !== request.authUser?.id) {
    await reply.code(403).send({ error: 'Bu krallık size ait değil.' });
    return null;
  }
  return kingdom;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{ Body: { email?: string; password?: string; displayName?: string } }>(
    '/api/auth/register',
    async (request, reply) => {
      const email = (request.body.email ?? '').trim().toLowerCase();
      const password = request.body.password ?? '';
      const displayName = (request.body.displayName ?? '').trim() || email.split('@')[0] || 'Kral';

      if (!email.includes('@') || password.length < 8) {
        return reply
          .code(400)
          .send({ error: 'Geçerli bir e-posta ve en az 8 karakterlik bir parola gerekli.' });
      }

      const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      if (existing) {
        return reply.code(409).send({ error: 'Bu e-posta zaten kayıtlı.' });
      }

      const passwordHash = await hashPassword(password);
      const user = await queryOne<UserRow>(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *`,
        [email, passwordHash, displayName.slice(0, 60)],
      );
      if (!user) return reply.code(500).send({ error: 'Kullanıcı oluşturulamadı.' });

      await query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

      const token = app.jwt.sign({ sub: user.id });
      return reply.send({ token, user: toAuthUser(user) });
    },
  );

  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/login',
    async (request, reply) => {
      const email = (request.body.email ?? '').trim().toLowerCase();
      const password = request.body.password ?? '';

      const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      // Kullanıcı yoksa da parola doğrulaması yapılmış gibi davranmıyoruz;
      // kayıt sayfası zaten e-postanın varlığını açık ediyor, ek karmaşıklığın
      // güvenlik getirisi yok.
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return reply.code(401).send({ error: 'E-posta ya da parola hatalı.' });
      }

      const token = app.jwt.sign({ sub: user.id });
      return reply.send({ token, user: toAuthUser(user) });
    },
  );

  // Oturum doğrulama ucu doğrudan `AuthUser` döndürür; hesap profili (§16.4)
  // ayrı bir uçta, çünkü her sayfa yüklemesinde istatistik sorgusu gereksiz.
  app.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) =>
    reply.send(request.authUser),
  );

  app.get('/api/auth/profile', { preHandler: requireAuth }, async (request, reply) => {
    const profile = await queryOne<{
      titles: string[];
      total_channels_won: number;
      highest_population_ever: number;
      total_kingdoms_conquered: number;
    }>(
      `SELECT titles, total_channels_won, highest_population_ever, total_kingdoms_conquered
         FROM user_profiles WHERE user_id = $1`,
      [request.authUser!.id],
    );

    return reply.send({
      userId: request.authUser!.id,
      displayName: request.authUser!.displayName,
      titles: profile?.titles ?? [],
      totalChannelsWon: profile?.total_channels_won ?? 0,
      highestPopulationEver: profile?.highest_population_ever ?? 0,
      totalKingdomsConquered: profile?.total_kingdoms_conquered ?? 0,
    });
  });
}
