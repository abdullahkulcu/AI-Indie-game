import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import { OPENAI_TOOLS, type ToolCall } from "./actionSchema.js";

export interface LlmDecision {
  reply: string | null;
  toolCalls: ToolCall[];
}

/** Single LLM provider for the MVP (BYOK: the caller's own OpenAI key). A
 * multi-provider/league system is explicitly out of scope for v1 - swapping
 * this for another provider later only requires a new module with this same
 * shape, called from llmOrchestrator.ts. */
export async function requestStrategicDecision(
  apiKey: string,
  messages: ChatCompletionMessageParam[],
): Promise<LlmDecision> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    messages,
    tools: OPENAI_TOOLS,
    tool_choice: "auto",
    temperature: 0.4,
  });

  const message = completion.choices[0]?.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
    .filter((call) => call.type === "function")
    .map((call) => ({ name: call.function.name, arguments: call.function.arguments }));

  return { reply: message?.content ?? null, toolCalls };
}
