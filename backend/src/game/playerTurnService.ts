import type { ActionStatus, GameAction, GameStateSnapshot } from "../models/types.js";
import { validateAction } from "../rules/ruleEngine.js";
import { applyAction } from "./tickService.js";
import { loadSnapshot, getCurrentTickNumber, cacheSnapshot } from "./gameStateService.js";
import { listRecentChat, saveChatMessage } from "../repositories/chatRepository.js";
import { recordTick } from "../repositories/tickLogRepository.js";
import { orchestrateDecision } from "../llm/llmOrchestrator.js";

export interface PlayerTurnResult {
  reply: string | null;
  actions: Array<{ action: GameAction; status: ActionStatus; reason: string | null }>;
  snapshot: GameStateSnapshot;
}

/**
 * Player-triggered strategic decision, run immediately (outside the fixed
 * tick cadence) when the player sends a chat message - the other path into
 * the LLM besides the periodic per-tick evaluation in tickService.ts.
 * Candidate actions still go through the exact same rule engine gate.
 */
export async function runPlayerTurn(playerId: string, message: string): Promise<PlayerTurnResult> {
  await saveChatMessage(playerId, "user", message);

  const tickNumber = await getCurrentTickNumber();
  let snapshot = await loadSnapshot(tickNumber);
  const recentChat = await listRecentChat(playerId);

  const orchestration = await orchestrateDecision({
    playerId,
    state: snapshot,
    recentChat,
    triggerMessage: message,
  });

  const actions: PlayerTurnResult["actions"] = [];
  for (const action of orchestration.candidateActions) {
    const validation = validateAction(snapshot, playerId, action);
    if (!validation.valid) {
      actions.push({ action, status: "rejected", reason: validation.reason ?? "bilinmeyen sebep" });
      continue;
    }
    snapshot = await applyAction(snapshot, playerId, action, tickNumber);
    actions.push({ action, status: "accepted", reason: null });
  }

  if (actions.length > 0) {
    await recordTick(
      tickNumber,
      actions.map((a) => ({ playerId, action: a.action, status: a.status, reason: a.reason })),
    );
  }

  if (orchestration.reply) {
    await saveChatMessage(playerId, "assistant", orchestration.reply);
  }

  await cacheSnapshot(snapshot);

  return { reply: orchestration.reply, actions, snapshot };
}
