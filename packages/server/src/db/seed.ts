/**
 * Geliştirme seed'i.
 *
 * Bir sezon channel'ı, bir kısa channel ve birkaç krallık kurar; böylece
 * frontend'i boş bir dünyaya bakmadan açabilirsiniz. Hiçbir LLM anahtarı
 * yazmaz — General'lar sessiz başlar, oyuncu ayarlardan kendi anahtarını
 * bağlar (§14.6).
 */

import { hashPassword } from '../crypto.js';
import { closePool, query, queryOne, withTransaction } from './pool.js';
import { runMigrations } from './migrate.js';
import { createChannel, joinChannel } from '../game/world.js';
import { setRelation } from '../tick/schedules.js';
import type { ChannelRow, KingdomRow } from './rows.js';

const DEMO_PASSWORD = 'krallik1234';

const DEMO_USERS = [
  { email: 'demirkale@example.com', displayName: 'Demirkale Kralı', kingdom: 'Demirkale' },
  { email: 'kizilorman@example.com', displayName: 'Kızılorman Kralı', kingdom: 'Kızılorman' },
  { email: 'karatas@example.com', displayName: 'Karataş Kralı', kingdom: 'Karataş' },
  { email: 'yesilvadi@example.com', displayName: 'Yeşilvadi Kralı', kingdom: 'Yeşilvadi' },
  { email: 'kurtbogan@example.com', displayName: 'Kurtboğan Kralı', kingdom: 'Kurtboğan' },
  { email: 'tasyurek@example.com', displayName: 'Taşyürek Kralı', kingdom: 'Taşyürek' },
];

async function ensureUser(
  email: string,
  displayName: string,
  isAdmin = false,
): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return existing.id;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const row = await queryOne<{ id: string }>(
    'INSERT INTO users (email, password_hash, display_name, is_admin) VALUES ($1,$2,$3,$4) RETURNING id',
    [email, passwordHash, displayName, isAdmin],
  );
  if (!row) throw new Error(`Kullanıcı oluşturulamadı: ${email}`);
  await query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [row.id]);
  return row.id;
}

async function main(): Promise<void> {
  await runMigrations();

  const adminId = await ensureUser('admin@example.com', 'Yönetici', true);

  const existingChannel = await queryOne<ChannelRow>(
    `SELECT * FROM channels WHERE name = $1`,
    ['Birinci Sezon'],
  );

  const channel =
    existingChannel ??
    (await createChannel({
      name: 'Birinci Sezon',
      channelType: 'season',
      durationDays: 75,
      llmRestriction: null,
      createdBy: adminId,
    }));

  // İkinci bir channel: LLM kısıtlı kısa etkinlik (§16.1) — channel listesi
  // ekranının farklı tipleri gösterebildiğini görmek için.
  const shortExists = await queryOne<{ id: string }>('SELECT id FROM channels WHERE name = $1', [
    'Bir Haftalık Turnuva',
  ]);
  if (!shortExists) {
    await createChannel({
      name: 'Bir Haftalık Turnuva',
      channelType: 'short',
      durationDays: 7,
      llmRestriction: { allowedProviders: ['anthropic', 'openai'], minTier: 'frontier' },
      createdBy: adminId,
    });
  }

  const kingdomIds: string[] = [];

  for (const demo of DEMO_USERS) {
    const userId = await ensureUser(demo.email, demo.displayName);
    const existing = await queryOne<KingdomRow>(
      'SELECT * FROM kingdoms WHERE user_id = $1 AND channel_id = $2',
      [userId, channel.id],
    );
    if (existing) {
      kingdomIds.push(existing.id);
      continue;
    }

    const result = await joinChannel({
      userId,
      channelId: channel.id,
      kingdomName: demo.kingdom,
    });
    kingdomIds.push(result.kingdom.id);
    console.log(`[seed] ${demo.kingdom} kuruldu (${result.capitalTile.x},${result.capitalTile.y})`);
  }

  // Birkaç ilişki kur: referans sahnedeki ticaret ve düşmanlık hatlarının
  // gerçek veriyle çizildiğini görmek için (üçüncü taraf ilişkiler dahil).
  await withTransaction(async (tx) => {
    const [demirkale, kizilorman, karatas, yesilvadi, kurtbogan, tasyurek] = kingdomIds;
    if (!demirkale || !kizilorman || !karatas || !yesilvadi || !kurtbogan || !tasyurek) return;

    await setRelation(tx, channel.id, demirkale, kizilorman, 'ally');
    await setRelation(tx, channel.id, demirkale, karatas, 'war');
    // Demirkale'ye dokunmayan bir savaş — zoom-out'ta yine de görünmeli.
    await setRelation(tx, channel.id, yesilvadi, tasyurek, 'war');
    await setRelation(tx, channel.id, kizilorman, kurtbogan, 'ally');

    // Üçüncü taraf ticaret hattı.
    const now = new Date();
    await tx.query(
      `INSERT INTO trade_agreements
         (channel_id, kingdom_a_id, kingdom_b_id, resource_a, amount_a, resource_b, amount_b,
          frequency_hours, next_delivery_at)
       VALUES ($1,$2,$3,'iron',300,'food',400,24,$4)
       ON CONFLICT DO NOTHING`,
      [channel.id, kizilorman, yesilvadi, new Date(now.getTime() + 24 * 3600_000)],
    );

    // Açık bir pazar ilanı.
    await tx.query(
      `INSERT INTO market_offers
         (channel_id, kingdom_id, offer_resource, offer_amount, request_resource, request_amount, expires_at)
       VALUES ($1,$2,'iron',500,'gold',800,$3)`,
      [channel.id, kurtbogan, new Date(now.getTime() + 48 * 3600_000)],
    );
  });

  console.log('\n[seed] tamamlandı.');
  console.log(`[seed] channel: ${channel.name} (${channel.id})`);
  console.log('[seed] giriş bilgileri:');
  console.log(`[seed]   admin@example.com / ${DEMO_PASSWORD} (yönetici)`);
  for (const demo of DEMO_USERS) {
    console.log(`[seed]   ${demo.email} / ${DEMO_PASSWORD}  → ${demo.kingdom}`);
  }
  console.log(
    '\n[seed] General\'lar sessiz başlar; Ayarlar sayfasından kendi LLM anahtarınızı bağlayın.',
  );
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[seed] hata:', error);
    process.exit(1);
  });
