/**
 * Anthropic Messages API adaptörü (§15.4).
 *
 * Biçimsel özellikler:
 *  - Sistem promptu ayrı bir üst düzey alan (`system`), mesaj listesinin içinde
 *    değil. Sabit sistem promptunu (§14.7 katman 1) her çağrıda birebir aynı
 *    göndermemizin sebebi de bu: oyuncu isterse kendi hesabında prompt caching
 *    açabilsin (§15.4).
 *  - Araç sonuçları ayrı bir mesaj rolü değil, `user` mesajının içindeki
 *    `tool_result` blokları.
 */

import type {
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolDefinition,
} from '@krallik/shared';
import { DEFAULT_MAX_TOKENS, postJson, type AdapterOptions, type LlmAdapter } from '../provider.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/** Anthropic'in kararlı API sürümü; model adından bağımsızdır. */
const API_VERSION = '2023-06-01';

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  content?: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

export function toAnthropicTools(tools: readonly LlmToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.parameters },
  }));
}

export function toAnthropicMessages(messages: readonly LlmMessage[]): AnthropicMessage[] {
  return messages.map((message) => {
    const blocks: AnthropicContentBlock[] = [];

    // Araç sonuçları bloğun başında durmalı — Anthropic aynı `user` mesajında
    // önce `tool_result`, sonra serbest metin bekliyor.
    for (const result of message.toolResults ?? []) {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: result.toolCallId,
        content: result.content,
      };
      if (result.isError) block.is_error = true;
      blocks.push(block);
    }

    if (message.content.length > 0) {
      blocks.push({ type: 'text', text: message.content });
    }

    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
    }

    // Düz metin mesajlarda blok dizisine gerek yok; hem daha az token hem de
    // sağlayıcının en çok test edilmiş yolu.
    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      return { role: message.role, content: message.content };
    }
    return { role: message.role, content: blocks };
  });
}

export function parseAnthropicResponse(payload: AnthropicResponse): LlmResponse {
  const texts: string[] = [];
  const toolCalls: LlmToolCall[] = [];

  for (const block of payload.content ?? []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (block.type === 'tool_use' && block.name) {
      toolCalls.push({
        id: block.id ?? `${block.name}-${toolCalls.length}`,
        name: block.name,
        arguments:
          block.input && typeof block.input === 'object' && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {},
      });
    }
  }

  const response: LlmResponse = { text: texts.join('\n').trim(), toolCalls };
  if (payload.usage) {
    response.usage = {
      inputTokens: payload.usage.input_tokens ?? 0,
      outputTokens: payload.usage.output_tokens ?? 0,
    };
  }
  if (payload.stop_reason) response.stopReason = payload.stop_reason;
  return response;
}

export function createAnthropicAdapter(options: AdapterOptions): LlmAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    provider: 'anthropic',
    model: options.model,
    async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = toAnthropicTools(request.tools);
      }
      if (request.temperature !== undefined) body.temperature = request.temperature;

      const payload = await postJson<AnthropicResponse>({
        provider: 'anthropic',
        url: `${baseUrl}/v1/messages`,
        headers: {
          'x-api-key': options.apiKey,
          'anthropic-version': API_VERSION,
        },
        body,
        signal,
      });

      return parseAnthropicResponse(payload);
    },
  };
}
