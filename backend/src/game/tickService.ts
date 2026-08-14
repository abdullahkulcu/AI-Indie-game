import type { ActionStatus, GameAction, GameStateSnapshot, ResourceType } from "../models/types.js";
import { validateAction, BUILD_COSTS } from "../rules/ruleEngine.js";
import { applyCombat, advanceAutonomousUnits } from "./stateMachine.js";
import { loadSnapshot, cacheSnapshot, setCurrentTickNumber } from "./gameStateService.js";
import { nextTickNumber, recordTick } from "../repositories/tickLogRepository.js";
import { saveUnits, removeDeadUnits } from "../repositories/unitRepository.js";
import { adjustResources } from "../repositories/playerRepository.js";
import { claimTile, insertStructure } from "../repositories/mapRepository.js";
import { listRecentChat, saveChatMessage } from "../repositories/chatRepository.js";
import { orchestrateDecision } from "../llm/llmOrchestrator.js";

interface AppliedActionLogEntry {
  playerId: string;
  action: GameAction;
  status: ActionStatus;
  reason: string | null;
}

/** Applies one already-validated action's effects on top of the in-memory
 * snapshot, and persists the side effects (resources/tiles/structures) that
 * the end-of-tick batch save doesn't otherwise cover. Units are mutated only
 * in-memory here and persisted once, in bulk, at the end of the tick. */
export async function applyAction(
  snapshot: GameStateSnapshot,
  playerId: string,
  action: GameAction,
  tickNumber: number,
): Promise<GameStateSnapshot> {
  if (action.type === "attack") {
    const { units } = applyCombat(snapshot.units, action.unitId, action.targetUnitId, tickNumber);
    return { ...snapshot, units };
  }

  if (action.type === "trade") {
    await Promise.all([
      adjustResources(playerId, {
        [action.offerResource]: -action.offerAmount,
        [action.requestResource]: action.requestAmount,
      }),
      adjustResources(action.targetPlayerId, {
        [action.offerResource]: action.offerAmount,
        [action.requestResource]: -action.requestAmount,
      }),
    ]);
    const resources = snapshot.resources.map((r) => {
      if (r.playerId === playerId) {
        return {
          ...r,
          [action.offerResource]: r[action.offerResource] - action.offerAmount,
          [action.requestResource]: r[action.requestResource] + action.requestAmount,
        };
      }
      if (r.playerId === action.targetPlayerId) {
        return {
          ...r,
          [action.offerResource]: r[action.offerResource] + action.offerAmount,
          [action.requestResource]: r[action.requestResource] - action.requestAmount,
        };
      }
      return r;
    });
    return { ...snapshot, resources };
  }

  // build
  const cost = BUILD_COSTS[action.structureType];
  await Promise.all([
    claimTile(action.x, action.y, playerId),
    adjustResources(
      playerId,
      Object.fromEntries(Object.entries(cost).map(([resource, amount]) => [resource, -amount])),
    ),
  ]);
  const structure = await insertStructure(playerId, action.structureType, action.x, action.y);

  const tiles = snapshot.tiles.map((t) =>
    t.x === action.x && t.y === action.y ? { ...t, ownerPlayerId: playerId } : t,
  );
  const resources = snapshot.resources.map((r) => {
    if (r.playerId !== playerId) return r;
    const updated = { ...r };
    for (const [resource, amount] of Object.entries(cost) as Array<[ResourceType, number]>) {
      updated[resource] = updated[resource] - amount;
    }
    return updated;
  });

  return { ...snapshot, tiles, resources, structures: [...snapshot.structures, structure] };
}

export interface TickResult {
  tickNumber: number;
  snapshot: GameStateSnapshot;
  actionLog: AppliedActionLogEntry[];
  replies: Array<{ playerId: string; reply: string }>;
}

/** Runs one full simulation tick:
 *  1) autonomous FSM step (retaliation, task repetition) for every unit
 *  2) one LLM strategic evaluation per player (periodic - not a continuous loop)
 *  3) every candidate action re-validated by the rule engine before it is applied
 *  4) persist + return the resulting snapshot for broadcast
 */
export async function runTick(): Promise<TickResult> {
  const tickNumber = await nextTickNumber();
  let snapshot = await loadSnapshot(tickNumber);

  const autonomous = advanceAutonomousUnits(snapshot.units, tickNumber);
  snapshot = { ...snapshot, units: autonomous.units };

  const actionLog: AppliedActionLogEntry[] = [];
  const replies: Array<{ playerId: string; reply: string }> = [];

  for (const player of snapshot.players) {
    const recentChat = await listRecentChat(player.id);

    let candidateActions: GameAction[] = [];
    let reply: string | null = null;
    try {
      const orchestration = await orchestrateDecision({
        playerId: player.id,
        state: snapshot,
        recentChat,
        triggerMessage: null,
      });
      candidateActions = orchestration.candidateActions;
      reply = orchestration.reply;
    } catch (err) {
      // A single player's LLM call failing (rate limit, bad key, network) must
      // never take down the whole tick for everyone else.
      reply = null;
      candidateActions = [];
    }

    for (const action of candidateActions) {
      const validation = validateAction(snapshot, player.id, action);
      if (!validation.valid) {
        actionLog.push({
          playerId: player.id,
          action,
          status: "rejected",
          reason: validation.reason ?? "bilinmeyen sebep",
        });
        continue;
      }
      snapshot = await applyAction(snapshot, player.id, action, tickNumber);
      actionLog.push({ playerId: player.id, action, status: "accepted", reason: null });
    }

    if (reply) {
      await saveChatMessage(player.id, "assistant", reply);
      replies.push({ playerId: player.id, reply });
    }
  }

  const aliveUnits = snapshot.units.filter((u) => u.hp > 0);
  const deadUnitIds = snapshot.units.filter((u) => u.hp <= 0).map((u) => u.id);
  snapshot = { ...snapshot, units: aliveUnits };

  await saveUnits(aliveUnits);
  await removeDeadUnits(deadUnitIds);
  await recordTick(tickNumber, actionLog);
  await setCurrentTickNumber(tickNumber);
  await cacheSnapshot(snapshot);

  return { tickNumber, snapshot, actionLog, replies };
}
