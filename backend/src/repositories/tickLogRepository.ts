import { pool } from "../db/pool.js";
import type { ActionLogEntry, ActionStatus, GameAction } from "../models/types.js";

export async function nextTickNumber(): Promise<number> {
  const result = await pool.query<{ max: number | null }>(
    `SELECT MAX(tick_number) as max FROM tick_logs`,
  );
  return (result.rows[0]?.max ?? 0) + 1;
}

export async function recordTick(
  tickNumber: number,
  actions: Array<{ playerId: string; action: GameAction; status: ActionStatus; reason: string | null }>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tick_logs (tick_number) VALUES ($1) ON CONFLICT (tick_number) DO NOTHING`,
      [tickNumber],
    );
    for (const entry of actions) {
      await client.query(
        `INSERT INTO action_log_entries (tick_number, player_id, action_type, payload, status, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tickNumber,
          entry.playerId,
          entry.action.type,
          JSON.stringify(entry.action),
          entry.status,
          entry.reason,
        ],
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

export async function recentActionLog(limit = 50): Promise<ActionLogEntry[]> {
  const result = await pool.query<{
    id: string;
    tick_number: number;
    player_id: string;
    action_type: string;
    payload: GameAction;
    status: ActionStatus;
    reason: string | null;
    created_at: string;
  }>(
    `SELECT id, tick_number, player_id, action_type, payload, status, reason, created_at
     FROM action_log_entries ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    tickNumber: row.tick_number,
    playerId: row.player_id,
    action: row.payload,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
