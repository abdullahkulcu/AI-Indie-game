import { pool } from "../db/pool.js";
import type { Player, Resources } from "../models/types.js";
import type { EncryptedSecret } from "../crypto/keyVault.js";

interface PlayerRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
  };
}

export async function createPlayer(
  username: string,
  email: string,
  passwordHash: string,
): Promise<Player> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PlayerRow>(
      `INSERT INTO players (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash],
    );
    const player = result.rows[0];
    await client.query(`INSERT INTO resources (player_id) VALUES ($1)`, [player.id]);
    await client.query("COMMIT");
    return toPlayer(player);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function findPlayerByEmailWithHash(
  email: string,
): Promise<(Player & { passwordHash: string }) | null> {
  const result = await pool.query<PlayerRow>(
    `SELECT id, username, email, password_hash, created_at FROM players WHERE email = $1`,
    [email],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...toPlayer(row), passwordHash: row.password_hash };
}

export async function findPlayerById(id: string): Promise<Player | null> {
  const result = await pool.query<PlayerRow>(
    `SELECT id, username, email, created_at FROM players WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toPlayer(row) : null;
}

export async function listPlayers(): Promise<Player[]> {
  const result = await pool.query<PlayerRow>(
    `SELECT id, username, email, created_at FROM players ORDER BY created_at ASC`,
  );
  return result.rows.map(toPlayer);
}

export async function getResources(playerId: string): Promise<Resources | null> {
  const result = await pool.query<{
    player_id: string;
    gold: number;
    wood: number;
    food: number;
  }>(`SELECT player_id, gold, wood, food FROM resources WHERE player_id = $1`, [playerId]);
  const row = result.rows[0];
  if (!row) return null;
  return { playerId: row.player_id, gold: row.gold, wood: row.wood, food: row.food };
}

export async function listResources(): Promise<Resources[]> {
  const result = await pool.query<{
    player_id: string;
    gold: number;
    wood: number;
    food: number;
  }>(`SELECT player_id, gold, wood, food FROM resources`);
  return result.rows.map((row) => ({
    playerId: row.player_id,
    gold: row.gold,
    wood: row.wood,
    food: row.food,
  }));
}

export async function adjustResources(
  playerId: string,
  delta: Partial<Record<"gold" | "wood" | "food", number>>,
): Promise<void> {
  const sets: string[] = [];
  const values: Array<number | string> = [];
  let idx = 1;
  for (const [key, amount] of Object.entries(delta)) {
    if (amount === undefined) continue;
    sets.push(`${key} = ${key} + $${idx}`);
    values.push(amount);
    idx += 1;
  }
  if (sets.length === 0) return;
  values.push(playerId);
  await pool.query(`UPDATE resources SET ${sets.join(", ")} WHERE player_id = $${idx}`, values);
}

export async function upsertApiKey(playerId: string, secret: EncryptedSecret): Promise<void> {
  await pool.query(
    `INSERT INTO player_api_keys (player_id, provider, encrypted_key, iv, auth_tag, updated_at)
     VALUES ($1, 'openai', $2, $3, $4, now())
     ON CONFLICT (player_id)
     DO UPDATE SET encrypted_key = $2, iv = $3, auth_tag = $4, updated_at = now()`,
    [playerId, secret.encrypted, secret.iv, secret.authTag],
  );
}

export async function getApiKey(playerId: string): Promise<EncryptedSecret | null> {
  const result = await pool.query<{ encrypted_key: string; iv: string; auth_tag: string }>(
    `SELECT encrypted_key, iv, auth_tag FROM player_api_keys WHERE player_id = $1`,
    [playerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { encrypted: row.encrypted_key, iv: row.iv, authTag: row.auth_tag };
}

export async function hasApiKey(playerId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM player_api_keys WHERE player_id = $1`, [
    playerId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
