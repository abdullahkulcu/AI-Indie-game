/**
 * OpenAI Chat Completions adaptörü (§15.4).
 *
 * Biçimsel özellikler:
 *  - Sistem promptu mesaj listesinin ilk elemanı (`role:"system"`).
 *  - Araç sonuçları ayrı bir rol: her sonuç kendi `role:"tool"` mesajı olur,
 *    yani bizim tek "araç sonuçları mesajı" birden fazla mesaja açılır.
 *  - Argümanlar nesne değil, JSON *string* olarak taşınır.
 *
 * `openai_compatible` sağlayıcısı da (yerel/üçüncü parti sunucular) bu
 * çevirinin aynısını kullanır; farkı yalnızca zorunlu `baseUrl`.
 */

import type {
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolDefinition,
} from '@krallik/shared';
import {
  DEFAULT_MAX_TOKENS,
  parseToolArguments,
  postJson,
  type AdapterOptions,
  type LlmAdapter,
} from '../provider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function toOpenAiTools(tools: readonly LlmToolDefinition[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.parameters },
    },
  }));
}

export function toOpenAiMessages(system: string, messages: readonly LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];

  for (const message of messages) {
    // Araç sonuçları önce gelmeli: OpenAI, `tool_calls` içeren asistan
    // mesajının hemen ardından o çağrıların yanıtlarını bekler.
    for (const result of message.toolResults ?? []) {
      out.push({ role: 'tool', content: result.content, tool_call_id: result.toolCallId });
    }

    const hasText = message.content.length > 0;
    const calls = message.toolCalls ?? [];
    if (!hasText && calls.length === 0) continue;

    const entry: OpenAiMessage = {
      role: message.role,
      content: hasText ? message.content : null,
    };
    if (calls.length > 0) {
      entry.tool_calls = calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }));
    }
    out.push(entry);
  }

  return out;
}

export function parseOpenAiResponse(payload: OpenAiResponse): LlmResponse {
  const choice = payload.choices?.[0];
  const toolCalls: LlmToolCall[] = [];

  for (const [index, call] of (choice?.message?.tool_calls ?? []).entries()) {
    const name = call.function?.name;
    if (!name) continue;
    toolCalls.push({
      id: call.id ?? `${name}-${index}`,
      name,
      arguments: parseToolArguments(call.function?.arguments),
    });
  }

  const response: LlmResponse = {
    text: (choice?.message?.content ?? '').trim(),
    toolCalls,
  };
  if (payload.usage) {
    response.usage = {
      inputTokens: payload.usage.prompt_tokens ?? 0,
      outputTokens: payload.usage.completion_tokens ?? 0,
    };
  }
  if (choice?.finish_reason) response.stopReason = choice.finish_reason;
  return response;
}

/**
 * OpenAI biçimini konuşan her uç nokta için ortak adaptör gövdesi.
 * `openaiCompatible.ts` bunu farklı bir `provider` etiketiyle yeniden kullanır.
 */
export function createOpenAiStyleAdapter(
  provider: LlmProvider,
  options: AdapterOptions,
  baseUrl: string,
): LlmAdapter {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    provider,
    model: options.model,
    async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: toOpenAiMessages(request.system, request.messages),
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = toOpenAiTools(request.tools);
        body.tool_choice = 'auto';
      }
      if (request.temperature !== undefined) body.temperature = request.temperature;

      const payload = await postJson<OpenAiResponse>({
        provider,
        url: `${root}/chat/completions`,
        headers: { authorization: `Bearer ${options.apiKey}` },
        body,
        signal,
      });

      return parseOpenAiResponse(payload);
    },
  };
}

export function createOpenAiAdapter(options: AdapterOptions): LlmAdapter {
  return createOpenAiStyleAdapter('openai', options, options.baseUrl ?? DEFAULT_BASE_URL);
}
