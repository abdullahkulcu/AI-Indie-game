import { pool } from "../db/pool.js";
import type { Structure, StructureType, Tile } from "../models/types.js";
import { terrainFor } from "../game/mapService.js";

/** Only ownership claims are persisted (see schema.sql) - terrain for any
 * (x, y) is computed on demand via mapService.terrainFor. */
export async function listClaimedTiles(channelId: string, seed: number): Promise<Tile[]> {
  const result = await pool.query<{ x: number; y: number; owner_player_id: string }>(
    `SELECT x, y, owner_player_id FROM tile_claims WHERE channel_id = $1`,
    [channelId],
  );
  return result.rows.map((row) => ({
    x: row.x,
    y: row.y,
    terrain: terrainFor(seed, row.x, row.y),
    ownerPlayerId: row.owner_player_id,
  }));
}

export async function getTileClaim(
  channelId: string,
  x: number,
  y: number,
): Promise<{ ownerPlayerId: string } | null> {
  const result = await pool.query<{ owner_player_id: string }>(
    `SELECT owner_player_id FROM tile_claims WHERE channel_id = $1 AND x = $2 AND y = $3`,
    [channelId, x, y],
  );
  const row = result.rows[0];
  return row ? { ownerPlayerId: row.owner_player_id } : null;
}

export async function claimTile(
  channelId: string,
  x: number,
  y: number,
  playerId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO tile_claims (channel_id, x, y, owner_player_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, x, y) DO UPDATE SET owner_player_id = $4`,
    [channelId, x, y, playerId],
  );
}

export async function listStructures(channelId: string): Promise<Structure[]> {
  const result = await pool.query<{
    id: string;
    owner_player_id: string;
    channel_id: string;
    type: StructureType;
    x: number;
    y: number;
    level: number;
    created_at: string;
  }>(
    `SELECT id, owner_player_id, channel_id, type, x, y, level, created_at
     FROM structures WHERE channel_id = $1`,
    [channelId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ownerPlayerId: row.owner_player_id,
    channelId: row.channel_id,
    type: row.type,
    x: row.x,
    y: row.y,
    level: row.level,
    createdAt: row.created_at,
  }));
}

export async function insertStructure(
  ownerPlayerId: string,
  channelId: string,
  type: StructureType,
  x: number,
  y: number,
): Promise<Structure> {
  const result = await pool.query<{
    id: string;
    owner_player_id: string;
    channel_id: string;
    type: StructureType;
    x: number;
    y: number;
    level: number;
    created_at: string;
  }>(
    `INSERT INTO structures (owner_player_id, channel_id, type, x, y)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, owner_player_id, channel_id, type, x, y, level, created_at`,
    [ownerPlayerId, channelId, type, x, y],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    ownerPlayerId: row.owner_player_id,
    channelId: row.channel_id,
    type: row.type,
    x: row.x,
    y: row.y,
    level: row.level,
    createdAt: row.created_at,
  };
}
