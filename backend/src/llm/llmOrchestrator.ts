import type { ChatMessage, GameAction, GameStateSnapshot } from "../models/types.js";
import { getApiKey } from "../repositories/playerRepository.js";
import { decryptSecret } from "../crypto/keyVault.js";
import { buildMessages } from "./promptBuilder.js";
import { requestStrategicDecision } from "./openaiProvider.js";
import { parseToolCall } from "./actionSchema.js";

export interface OrchestrationResult {
  reply: string | null;
  candidateActions: GameAction[];
  parseErrors: string[];
}

/**
 * Turns a player's free-text strategy (or a periodic tick trigger) into
 * candidate structured actions. This is orchestration only - it never mutates
 * game state itself. Every candidate action still has to pass the rule engine
 * (src/rules/ruleEngine.ts) before the tick service applies it.
 */
export async function orchestrateDecision(params: {
  playerId: string;
  state: GameStateSnapshot;
  recentChat: ChatMessage[];
  triggerMessage: string | null;
}): Promise<OrchestrationResult> {
  const encrypted = await getApiKey(params.playerId);
  if (!encrypted) {
    return {
      reply: "Once ayarlardan kendi OpenAI API anahtarinizi baglamaniz gerekiyor.",
      candidateActions: [],
      parseErrors: [],
    };
  }

  const apiKey = decryptSecret(encrypted);
  const messages = buildMessages(params.state, params.playerId, params.recentChat, params.triggerMessage);
  const decision = await requestStrategicDecision(apiKey, messages);

  const candidateActions: GameAction[] = [];
  const parseErrors: string[] = [];
  for (const call of decision.toolCalls) {
    const parsed = parseToolCall(call);
    if (parsed.action) {
      candidateActions.push(parsed.action);
    } else if (parsed.error) {
      parseErrors.push(parsed.error);
    }
  }

  return { reply: decision.reply, candidateActions, parseErrors };
}
