/**
 * Sezon/channel sonu ve kazanma koşulu — GDD §12 ve §16.1.
 *
 * "Son ayakta kalan" modeli: bir krallığın başkenti fethedilirse o krallık
 * dağılır. Sezon, tek bir ittifak/krallık kalana kadar **ya da** azami süre
 * dolana kadar devam eder — hangisi önce gelirse.
 */

import { txQuery, txQueryOne, type Tx } from '../db/pool.js';
import type { ChannelRow } from '../db/rows.js';
import { notify } from '../game/notifications.js';

interface Survivor {
  id: string;
  name: string;
  user_id: string;
  alliance_id: string | null;
  peak_population: number;
  tiles_conquered: number;
  fell_at: Date | null;
}

/** Aktif channel'ları tarar; bitmesi gerekenleri kapatır. */
export async function checkChannelEndings(tx: Tx): Promise<number> {
  const channels = await txQuery<ChannelRow>(
    tx,
    `SELECT * FROM channels WHERE status = 'active' FOR UPDATE SKIP LOCKED`,
  );

  let closed = 0;

  for (const channel of channels) {
    const survivors = await txQuery<Survivor>(
      tx,
      `SELECT id, name, user_id, alliance_id, peak_population, tiles_conquered, fell_at
         FROM kingdoms
        WHERE channel_id = $1 AND status = 'active'`,
      [channel.id],
    );

    const timeUp = channel.ends_at !== null && channel.ends_at.getTime() <= Date.now();

    // Tek bir ittifak/krallık kaldıysa sezon biter. Aynı ittifakın üyeleri
    // birlikte kazanır — bu yüzden benzersiz ittifak sayısına bakılır;
    // ittifaksız her krallık kendi başına bir "taraf" sayılır.
    const factions = new Set(
      survivors.map((k) => k.alliance_id ?? `solo:${k.id}`),
    );
    const lastStanding = survivors.length > 0 && factions.size <= 1;

    if (!timeUp && !lastStanding) continue;
    // Hiç krallık kalmadıysa da (herkes düştü) channel kapanmalı.
    if (survivors.length === 0 && !timeUp) {
      // Kimse kalmadıysa da bitir; aksi hâlde channel sonsuza kadar açık kalır.
    }

    await closeChannel(tx, channel, survivors, timeUp && !lastStanding);
    closed += 1;
  }

  return closed;
}

async function closeChannel(
  tx: Tx,
  channel: ChannelRow,
  survivors: Survivor[],
  byTimeout: boolean,
): Promise<void> {
  // Liderlik tablosu: en uzun ayakta kalan / en çok toprak fetheden önde.
  const all = await txQuery<Survivor & { status: string; display_name: string }>(
    tx,
    `SELECT k.id, k.name, k.user_id, k.alliance_id, k.peak_population, k.tiles_conquered,
            k.fell_at, k.status, u.display_name
       FROM kingdoms k
       JOIN users u ON u.id = k.user_id
      WHERE k.channel_id = $1`,
    [channel.id],
  );

  const standings = [...all]
    .sort((a, b) => {
      // Ayakta olanlar önce; sonra fetih sayısı, sonra zirve nüfus.
      const aAlive = a.status === 'active' ? 1 : 0;
      const bAlive = b.status === 'active' ? 1 : 0;
      if (aAlive !== bAlive) return bAlive - aAlive;
      if (a.tiles_conquered !== b.tiles_conquered) return b.tiles_conquered - a.tiles_conquered;
      return b.peak_population - a.peak_population;
    })
    .map((k, index) => ({
      rank: index + 1,
      kingdomId: k.id,
      kingdomName: k.name,
      ownerDisplayName: k.display_name,
      survivedUntil: k.fell_at ? k.fell_at.toISOString() : null,
      tilesConquered: k.tiles_conquered,
      peakPopulation: k.peak_population,
    }));

  const winner = survivors[0] ?? null;
  const winnerAllianceId = winner?.alliance_id ?? null;

  await txQuery(
    tx,
    `UPDATE channels
        SET status = 'finished', winner_alliance_id = $2, winner_kingdom_id = $3
      WHERE id = $1`,
    [channel.id, winnerAllianceId, winner?.id ?? null],
  );

  await txQuery(
    tx,
    `INSERT INTO season_results (channel_id, winner_alliance_id, winner_kingdom_id, standings)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id) DO UPDATE SET standings = EXCLUDED.standings`,
    [channel.id, winnerAllianceId, winner?.id ?? null, JSON.stringify(standings)],
  );

  // Hesap düzeyindeki kalıcı profil güncellenir (§16.4).
  for (const survivor of survivors) {
    await txQuery(
      tx,
      `INSERT INTO user_profiles (user_id, total_channels_won, highest_population_ever)
       VALUES ($1, 1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET total_channels_won = user_profiles.total_channels_won + 1,
             highest_population_ever = GREATEST(user_profiles.highest_population_ever, $2),
             updated_at = now()`,
      [survivor.user_id, survivor.peak_population],
    );
  }

  const reason = byTimeout
    ? 'Channel süresi doldu.'
    : 'Haritada tek bir taraf kaldı.';

  for (const kingdom of all) {
    await notify(tx, {
      kingdomId: kingdom.id,
      kind: 'season_end',
      severity: 'info',
      title: 'Sezon sona erdi',
      body:
        `${reason} ` +
        (winner
          ? `Galip: ${winner.name}. `
          : 'Ayakta kalan olmadı. ') +
        'Liderlik tablosu arşivlendi.',
      payload: { standings },
    });
  }
}

/**
 * Ayakta kalan tek krallık kaldığında bu kontrolü hızlandırmak için, bir
 * fetih hemen sonrasında da çağrılabilir.
 */
export async function checkChannelEnding(tx: Tx, channelId: string): Promise<boolean> {
  const channel = await txQueryOne<ChannelRow>(
    tx,
    `SELECT * FROM channels WHERE id = $1 AND status = 'active' FOR UPDATE`,
    [channelId],
  );
  if (!channel) return false;

  const survivors = await txQuery<Survivor>(
    tx,
    `SELECT id, name, user_id, alliance_id, peak_population, tiles_conquered, fell_at
       FROM kingdoms WHERE channel_id = $1 AND status = 'active'`,
    [channelId],
  );

  const factions = new Set(survivors.map((k) => k.alliance_id ?? `solo:${k.id}`));
  // Tek krallık kaldıysa sezon biter; sıfır krallıkta da (herkes düştüyse)
  // channel'ı açık bırakmanın anlamı yok.
  if (survivors.length > 1 && factions.size > 1) return false;

  await closeChannel(tx, channel, survivors, false);
  return true;
}
