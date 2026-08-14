import { pool } from "../db/pool.js";
import type { AssignedTask, Unit, UnitState, UnitType } from "../models/types.js";

interface UnitRow {
  id: string;
  owner_player_id: string;
  channel_id: string;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  attack: number;
  state: UnitState;
  target_unit_id: string | null;
  assigned_task: AssignedTask | null;
  cooldown_until_tick: number;
  updated_at: string;
}

const UNIT_COLUMNS = `id, owner_player_id, channel_id, type, x, y, hp, max_hp, attack, state,
            target_unit_id, assigned_task, cooldown_until_tick, updated_at`;

function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    ownerPlayerId: row.owner_player_id,
    channelId: row.channel_id,
    type: row.type,
    x: row.x,
    y: row.y,
    hp: row.hp,
    maxHp: row.max_hp,
    attack: row.attack,
    state: row.state,
    targetUnitId: row.target_unit_id,
    assignedTask: row.assigned_task,
    cooldownUntilTick: row.cooldown_until_tick,
    updatedAt: row.updated_at,
  };
}

export async function listUnits(channelId: string): Promise<Unit[]> {
  const result = await pool.query<UnitRow>(`SELECT ${UNIT_COLUMNS} FROM units WHERE channel_id = $1`, [
    channelId,
  ]);
  return result.rows.map(toUnit);
}

export async function spawnUnit(
  ownerPlayerId: string,
  channelId: string,
  type: UnitType,
  x: number,
  y: number,
  hp = 20,
  attack = 4,
): Promise<Unit> {
  const result = await pool.query<UnitRow>(
    `INSERT INTO units (owner_player_id, channel_id, type, x, y, hp, max_hp, attack)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
     RETURNING ${UNIT_COLUMNS}`,
    [ownerPlayerId, channelId, type, x, y, hp, attack],
  );
  return toUnit(result.rows[0]);
}

/** Bulk-persists the post-tick state of every unit. Called once per tick after
 * the state machine + validated actions have produced the next snapshot. */
export async function saveUnits(units: Unit[]): Promise<void> {
  if (units.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const unit of units) {
      await client.query(
        `UPDATE units
         SET x = $1, y = $2, hp = $3, state = $4, target_unit_id = $5,
             assigned_task = $6, cooldown_until_tick = $7, updated_at = now()
         WHERE id = $8`,
        [
          unit.x,
          unit.y,
          unit.hp,
          unit.state,
          unit.targetUnitId,
          unit.assignedTask ? JSON.stringify(unit.assignedTask) : null,
          unit.cooldownUntilTick,
          unit.id,
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

export async function removeDeadUnits(unitIds: string[]): Promise<void> {
  if (unitIds.length === 0) return;
  await pool.query(`DELETE FROM units WHERE id = ANY($1::uuid[])`, [unitIds]);
}

export async function assignTask(unitId: string, task: AssignedTask | null): Promise<void> {
  await pool.query(
    `UPDATE units SET assigned_task = $1, state = $2, target_unit_id = NULL, updated_at = now() WHERE id = $3`,
    [task ? JSON.stringify(task) : null, task ? "executing_task" : "idle", unitId],
  );
}
