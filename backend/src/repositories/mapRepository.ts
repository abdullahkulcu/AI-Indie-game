import { pool } from "../db/pool.js";
import type { Structure, StructureType, Tile, TileTerrain } from "../models/types.js";

export async function seedTilesIfEmpty(tiles: Tile[]): Promise<void> {
  const existing = await pool.query("SELECT 1 FROM tiles LIMIT 1");
  if ((existing.rowCount ?? 0) > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const tile of tiles) {
      await client.query(
        `INSERT INTO tiles (x, y, terrain, owner_player_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (x, y) DO NOTHING`,
        [tile.x, tile.y, tile.terrain, tile.ownerPlayerId],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listTiles(): Promise<Tile[]> {
  const result = await pool.query<{
    x: number;
    y: number;
    terrain: TileTerrain;
    owner_player_id: string | null;
  }>(`SELECT x, y, terrain, owner_player_id FROM tiles`);
  return result.rows.map((row) => ({
    x: row.x,
    y: row.y,
    terrain: row.terrain,
    ownerPlayerId: row.owner_player_id,
  }));
}

export async function claimTile(x: number, y: number, playerId: string): Promise<void> {
  await pool.query(`UPDATE tiles SET owner_player_id = $1 WHERE x = $2 AND y = $3`, [
    playerId,
    x,
    y,
  ]);
}

export async function listStructures(): Promise<Structure[]> {
  const result = await pool.query<{
    id: string;
    owner_player_id: string;
    type: StructureType;
    x: number;
    y: number;
    level: number;
    created_at: string;
  }>(`SELECT id, owner_player_id, type, x, y, level, created_at FROM structures`);
  return result.rows.map((row) => ({
    id: row.id,
    ownerPlayerId: row.owner_player_id,
    type: row.type,
    x: row.x,
    y: row.y,
    level: row.level,
    createdAt: row.created_at,
  }));
}

export async function insertStructure(
  ownerPlayerId: string,
  type: StructureType,
  x: number,
  y: number,
): Promise<Structure> {
  const result = await pool.query<{
    id: string;
    owner_player_id: string;
    type: StructureType;
    x: number;
    y: number;
    level: number;
    created_at: string;
  }>(
    `INSERT INTO structures (owner_player_id, type, x, y)
     VALUES ($1, $2, $3, $4)
     RETURNING id, owner_player_id, type, x, y, level, created_at`,
    [ownerPlayerId, type, x, y],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    ownerPlayerId: row.owner_player_id,
    type: row.type,
    x: row.x,
    y: row.y,
    level: row.level,
    createdAt: row.created_at,
  };
}
