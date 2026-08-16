/**
 * Google Gemini (generateContent) adaptörü (§15.4).
 *
 * En çok sapan biçim bu:
 *  - Roller `user` / `model` (assistant değil).
 *  - Sistem promptu ayrı bir `systemInstruction` alanı.
 *  - Araçlar `tools[0].functionDeclarations` altında toplanır.
 *  - Şema tipleri büyük harf (`STRING`, `OBJECT`) ve `additionalProperties`
 *    desteklenmez — bu yüzden şemayı olduğu gibi geçiremiyoruz, çeviriyoruz.
 *  - Araç sonucu çağrı kimliğiyle değil, **fonksiyon adıyla** eşleşir. Bizim
 *    iç modelimizde her araç çağrısının kimliği var; bu yüzden Gemini'de
 *    kimliği `ad#sıra` biçiminde üretip sonucu yazarken adı geri çıkarıyoruz.
 */

import type {
  JsonSchema,
  JsonSchemaProperty,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmToolDefinition,
} from '@krallik/shared';
import { DEFAULT_MAX_TOKENS, postJson, type AdapterOptions, type LlmAdapter } from '../provider.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** `toolCallId` içinde adı taşımak için ayırıcı; ad hiçbir araçta '#' içermez. */
const ID_SEPARATOR = '#';

interface GeminiSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiSchema;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const TYPE_MAP: Record<JsonSchemaProperty['type'], string> = {
  string: 'STRING',
  integer: 'INTEGER',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};

function toGeminiProperty(property: JsonSchemaProperty): GeminiSchema {
  const schema: GeminiSchema = { type: TYPE_MAP[property.type] };
  if (property.description) schema.description = property.description;
  if (property.enum) schema.enum = [...property.enum];
  if (property.items) schema.items = toGeminiProperty(property.items);
  if (property.properties) {
    const nested: Record<string, GeminiSchema> = {};
    for (const [key, value] of Object.entries(property.properties)) {
      nested[key] = toGeminiProperty(value);
    }
    schema.properties = nested;
  }
  // `minimum`/`maximum` Gemini şemasında yok; sınırlar zaten backend'de
  // yeniden doğrulanıyor (§15.5), açıklama metninde de yazıyor.
  return schema;
}

export function toGeminiSchema(parameters: JsonSchema): GeminiSchema | undefined {
  const entries = Object.entries(parameters.properties);
  // Parametresiz araçlar (`get_kingdom_status`, `host_festival`) için boş bir
  // OBJECT göndermek bazı sürümlerde reddediliyor; alanı hiç göndermiyoruz.
  if (entries.length === 0) return undefined;

  const properties: Record<string, GeminiSchema> = {};
  for (const [key, value] of entries) {
    properties[key] = toGeminiProperty(value);
  }
  const schema: GeminiSchema = { type: 'OBJECT', properties };
  if (parameters.required && parameters.required.length > 0) {
    schema.required = [...parameters.required];
  }
  return schema;
}

export function toGeminiTools(
  tools: readonly LlmToolDefinition[],
): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  const declarations = tools.map((tool) => {
    const declaration: GeminiFunctionDeclaration = {
      name: tool.name,
      description: tool.description,
    };
    const parameters = toGeminiSchema(tool.parameters);
    if (parameters) declaration.parameters = parameters;
    return declaration;
  });
  return [{ functionDeclarations: declarations }];
}

/** `ad#sıra` biçimindeki kimlikten fonksiyon adını geri çıkarır. */
export function functionNameFromToolCallId(id: string): string {
  const index = id.lastIndexOf(ID_SEPARATOR);
  return index > 0 ? id.slice(0, index) : id;
}

export function toGeminiContents(messages: readonly LlmMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const message of messages) {
    const results = message.toolResults ?? [];
    if (results.length > 0) {
      out.push({
        role: 'user',
        parts: results.map((result) => ({
          functionResponse: {
            name: functionNameFromToolCallId(result.toolCallId),
            // Gemini `response` alanında nesne bekler; sonucu tek alanlı bir
            // zarfa sarıyoruz (metin sonucu doğrudan string kabul edilmiyor).
            response: { result: result.content, is_error: result.isError === true },
          },
        })),
      });
    }

    const parts: GeminiPart[] = [];
    if (message.content.length > 0) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      parts.push({ functionCall: { name: call.name, args: call.arguments } });
    }
    if (parts.length > 0) {
      out.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
  }

  return out;
}

export function parseGeminiResponse(payload: GeminiResponse): LlmResponse {
  const candidate = payload.candidates?.[0];
  const texts: string[] = [];
  const toolCalls: LlmToolCall[] = [];

  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      texts.push(part.text);
    }
    if (part.functionCall?.name) {
      toolCalls.push({
        id: `${part.functionCall.name}${ID_SEPARATOR}${toolCalls.length}`,
        name: part.functionCall.name,
        arguments:
          part.functionCall.args && typeof part.functionCall.args === 'object'
            ? part.functionCall.args
            : {},
      });
    }
  }

  const response: LlmResponse = { text: texts.join('\n').trim(), toolCalls };
  if (payload.usageMetadata) {
    response.usage = {
      inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
    };
  }
  if (candidate?.finishReason) response.stopReason = candidate.finishReason;
  return response;
}

export function createGoogleAdapter(options: AdapterOptions): LlmAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    provider: 'google',
    model: options.model,
    async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: toGeminiContents(request.messages),
        generationConfig: {
          maxOutputTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        },
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = toGeminiTools(request.tools);
      }

      const payload = await postJson<GeminiResponse>({
        provider: 'google',
        url: `${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`,
        // Anahtar sorgu dizesine değil başlığa konur: URL'ler proxy/erişim
        // loglarına düşer, başlıklar düşmez (§15.5).
        headers: { 'x-goog-api-key': options.apiKey },
        body,
        signal,
      });

      return parseGeminiResponse(payload);
    },
  };
}
