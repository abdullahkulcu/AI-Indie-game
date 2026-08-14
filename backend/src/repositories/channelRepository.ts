import { pool } from "../db/pool.js";
import type { Channel } from "../models/types.js";

interface ChannelRow {
  id: string;
  name: string;
  map_size: number;
  max_players: number;
  seed: number;
}

function toChannel(row: ChannelRow): Channel {
  return { id: row.id, name: row.name, mapSize: row.map_size, maxPlayers: row.max_players, seed: row.seed };
}

export async function listChannels(): Promise<Channel[]> {
  const result = await pool.query<ChannelRow>(
    `SELECT id, name, map_size, max_players, seed FROM channels ORDER BY name ASC`,
  );
  return result.rows.map(toChannel);
}

export async function getChannel(channelId: string): Promise<Channel | null> {
  const result = await pool.query<ChannelRow>(
    `SELECT id, name, map_size, max_players, seed FROM channels WHERE id = $1`,
    [channelId],
  );
  const row = result.rows[0];
  return row ? toChannel(row) : null;
}

export async function countPlayersInChannel(channelId: string): Promise<number> {
  const result = await pool.query(`SELECT count(*) FROM players WHERE channel_id = $1`, [channelId]);
  return Number(result.rows[0]?.count ?? 0);
}

