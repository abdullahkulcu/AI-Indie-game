import type { Unit } from "../models/types.js";
import { chebyshevDistance, stepToward } from "./geometry.js";

/**
 * Classic autonomous unit FSM. This runs every tick for every unit and never
 * calls the LLM: it only handles the two behaviors units must perform on their
 * own between (or without) strategic LLM decisions -
 *   1) automatic retaliation when attacked, and
 *   2) repeating a previously assigned task (patrol / hold / raid / escort)
 * until it's complete or overridden by a new player-approved LLM action.
 */

const ATTACK_RANGE = 1;
const COOLDOWN_TICKS = 1;

export interface CombatEvent {
  attackerId: string;
  targetId: string;
  damage: number;
  targetDied: boolean;
}

/** Resolves a single attack between two units, immutably. Shared by both
 * LLM-issued (rule-engine-validated) attacks and autonomous FSM attacks. */
export function applyCombat(
  units: Unit[],
  attackerId: string,
  targetId: string,
  tickNumber: number,
): { units: Unit[]; event: CombatEvent } {
  const attacker = units.find((u) => u.id === attackerId);
  const target = units.find((u) => u.id === targetId);
  if (!attacker || !target) {
    throw new Error("applyCombat: attacker or target not found");
  }

  const damage = attacker.attack;
  const newTargetHp = Math.max(0, target.hp - damage);
  const targetDied = newTargetHp === 0;

  const next = units.map((u) => {
    if (u.id === attackerId) {
      return { ...u, cooldownUntilTick: tickNumber + COOLDOWN_TICKS, state: "attacking" as const, targetUnitId: targetId };
    }
    if (u.id === targetId) {
      if (targetDied) {
        return { ...u, hp: 0 };
      }
      // Auto-retaliation: an attacked unit that survives turns to fight back
      // next tick, regardless of what it was doing before.
      return { ...u, hp: newTargetHp, state: "retaliating" as const, targetUnitId: attackerId };
    }
    return u;
  });

  return { units: next, event: { attackerId, targetId, damage, targetDied } };
}

/** Advances every unit that isn't waiting on a fresh LLM/player decision:
 * continues attacks/retaliation in range, and re-executes assigned tasks. */
export function advanceAutonomousUnits(
  units: Unit[],
  tickNumber: number,
): { units: Unit[]; events: CombatEvent[] } {
  let current = units;
  const events: CombatEvent[] = [];

  for (const unit of units) {
    const live = current.find((u) => u.id === unit.id);
    if (!live || live.hp <= 0) continue;

    if (live.state === "retaliating" || live.state === "attacking") {
      const target = current.find((u) => u.id === live.targetUnitId);
      const targetGone = !target || target.hp <= 0;
      const inRange =
        target && chebyshevDistance(live.x, live.y, target.x, target.y) <= ATTACK_RANGE;

      if (!targetGone && inRange && live.cooldownUntilTick <= tickNumber) {
        const result = applyCombat(current, live.id, live.targetUnitId as string, tickNumber);
        current = result.units;
        events.push(result.event);
        continue;
      }
      if (targetGone || !inRange) {
        current = revertToTaskOrIdle(current, live.id);
      }
      continue;
    }

    if (live.state === "executing_task" && live.assignedTask) {
      current = executeTask(current, live.id, tickNumber);
    }
  }

  return { units: current, events };
}

function revertToTaskOrIdle(units: Unit[], unitId: string): Unit[] {
  return units.map((u) => {
    if (u.id !== unitId) return u;
    return {
      ...u,
      targetUnitId: null,
      state: u.assignedTask ? "executing_task" : "idle",
    };
  });
}

function executeTask(units: Unit[], unitId: string, tickNumber: number): Unit[] {
  const unit = units.find((u) => u.id === unitId);
  if (!unit?.assignedTask) return units;
  const task = unit.assignedTask;

  if (task.kind === "raid" && task.targetX !== undefined && task.targetY !== undefined) {
    const enemyInRange = units.find(
      (candidate) =>
        candidate.id !== unitId &&
        candidate.hp > 0 &&
        candidate.ownerPlayerId !== unit.ownerPlayerId &&
        chebyshevDistance(unit.x, unit.y, candidate.x, candidate.y) <= ATTACK_RANGE,
    );
    if (enemyInRange && unit.cooldownUntilTick <= tickNumber) {
      return applyCombat(units, unitId, enemyInRange.id, tickNumber).units;
    }
  }

  const targetX = task.targetX ?? unit.x;
  const targetY = task.targetY ?? unit.y;
  if (unit.x === targetX && unit.y === targetY) {
    // Arrived: the task simply persists (re-executed every tick) until a new
    // assignment replaces it - this is the "repeating assigned task" behavior.
    return units;
  }
  const moved = stepToward(unit.x, unit.y, targetX, targetY);
  return units.map((u) => (u.id === unitId ? { ...u, x: moved.x, y: moved.y } : u));
}
