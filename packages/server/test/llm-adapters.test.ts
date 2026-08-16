/**
 * Sağlayıcı adaptör katmanı testleri (§15.4).
 *
 * Ağa çıkmaz: `fetch` sahteleniyor ve adaptörlerin gönderdiği gövde ile
 * ayrıştırdıkları yanıt sınanıyor. Kritik olan, aynı iç arayüzün dört farklı
 * sağlayıcı biçimine doğru çevrilmesi — BYOK modelinde bir oyuncunun
 * Anthropic, bir diğerinin OpenAI kullanması normal.
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createAdapter, runChat } from '../dist/llm/provider.js';
import {
  classifyHttpStatus,
  classifyNetworkError,
  llmErrorMessageTr,
  isPlayerActionableError,
} from '../dist/llm/errors.js';
import type { LlmRequest } from '@krallik/shared';

const originalFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function mockFetch(responseBody: unknown, status = 200): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const TOOL_REQUEST: LlmRequest = {
  system: 'Sen bir Generalsın.',
  messages: [{ role: 'user', content: 'Kışlayı yükselt.' }],
  tools: [
    {
      name: 'build_structure',
      description: 'Bina inşa eder.',
      parameters: {
        type: 'object',
        properties: {
          building_type: { type: 'string', description: 'Bina tipi.' },
          target_level: { type: 'integer', description: 'Hedef seviye.' },
        },
        required: ['building_type', 'target_level'],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

test('anthropic adaptörü aracı input_schema olarak gönderir', async () => {
  const { calls } = mockFetch({
    content: [
      { type: 'text', text: 'Emriniz üzerine kışlayı yükseltiyorum.' },
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'build_structure',
        input: { building_type: 'barracks', target_level: 2 },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 120, output_tokens: 40 },
  });

  const adapter = createAdapter('anthropic', { apiKey: 'sk-test', model: 'claude-opus-5' });
  const response = await runChat(adapter, TOOL_REQUEST);

  const call = calls[0];
  assert.ok(call, 'istek gönderilmiş olmalı');
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  // Anahtar x-api-key başlığında gider ve asla gövdeye yazılmaz.
  assert.equal(call.headers['x-api-key'], 'sk-test');
  assert.ok(!JSON.stringify(call.body).includes('sk-test'));

  const tools = call.body.tools as { name: string; input_schema: unknown }[];
  assert.equal(tools[0]?.name, 'build_structure');
  assert.ok(tools[0]?.input_schema, 'Anthropic şemayı input_schema altında bekler');
  assert.equal(call.body.system, TOOL_REQUEST.system);

  assert.match(response.text, /kışlayı/i);
  assert.equal(response.toolCalls.length, 1);
  assert.equal(response.toolCalls[0]?.name, 'build_structure');
  assert.deepEqual(response.toolCalls[0]?.arguments, {
    building_type: 'barracks',
    target_level: 2,
  });
  assert.equal(response.usage?.inputTokens, 120);
});

test('anthropic adaptörü araç sonucunu tool_result bloğuna çevirir', async () => {
  const { calls } = mockFetch({ content: [{ type: 'text', text: 'Tamamdır.' }] });

  const adapter = createAdapter('anthropic', { apiKey: 'sk-test', model: 'claude-sonnet-5' });
  await runChat(adapter, {
    ...TOOL_REQUEST,
    messages: [
      { role: 'user', content: 'Kışlayı yükselt.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tu_1', name: 'build_structure', arguments: {} }],
      },
      {
        role: 'user',
        content: '',
        toolResults: [{ toolCallId: 'tu_1', content: 'İnşaat başladı.' }],
      },
    ],
  });

  const messages = calls[0]?.body.messages as { role: string; content: unknown }[];
  const last = messages[messages.length - 1];
  const blocks = last?.content as { type: string; tool_use_id?: string }[];
  assert.equal(blocks[0]?.type, 'tool_result');
  assert.equal(blocks[0]?.tool_use_id, 'tu_1');
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

test('openai adaptörü aracı function.parameters olarak gönderir', async () => {
  const { calls } = mockFetch({
    choices: [
      {
        message: {
          content: 'Kışla yükseltiliyor.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'build_structure',
                arguments: '{"building_type":"barracks","target_level":2}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 90, completion_tokens: 30 },
  });

  const adapter = createAdapter('openai', { apiKey: 'sk-oai', model: 'gpt-5' });
  const response = await runChat(adapter, TOOL_REQUEST);

  const call = calls[0];
  // HTTP başlıkları büyük/küçük harf duyarsız; adaptör küçük harf kullanıyor.
  assert.equal(call?.headers['authorization'], 'Bearer sk-oai');

  const tools = call?.body.tools as { type: string; function: { name: string; parameters: unknown } }[];
  assert.equal(tools[0]?.type, 'function');
  assert.equal(tools[0]?.function.name, 'build_structure');
  assert.ok(tools[0]?.function.parameters);

  // Sistem promptu OpenAI'de ayrı bir mesaj olarak gider.
  const messages = call?.body.messages as { role: string }[];
  assert.equal(messages[0]?.role, 'system');

  // Argümanlar string JSON olarak gelir ve ayrıştırılmış olmalı.
  assert.deepEqual(response.toolCalls[0]?.arguments, {
    building_type: 'barracks',
    target_level: 2,
  });
  assert.equal(response.usage?.inputTokens, 90);
});

test('openai adaptörü araç sonucunu role:tool mesajına çevirir', async () => {
  const { calls } = mockFetch({ choices: [{ message: { content: 'Tamam.' } }] });

  const adapter = createAdapter('openai', { apiKey: 'sk-oai', model: 'gpt-5' });
  await runChat(adapter, {
    ...TOOL_REQUEST,
    messages: [
      { role: 'user', content: 'Yükselt.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'build_structure', arguments: {} }],
      },
      {
        role: 'user',
        content: '',
        toolResults: [{ toolCallId: 'call_1', content: 'Başladı.' }],
      },
    ],
  });

  const messages = calls[0]?.body.messages as { role: string; tool_call_id?: string }[];
  const toolMessage = messages.find((m) => m.role === 'tool');
  assert.ok(toolMessage, 'araç sonucu role:tool olarak gitmeli');
  assert.equal(toolMessage.tool_call_id, 'call_1');
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

test('google adaptörü aracı functionDeclarations olarak gönderir', async () => {
  const { calls } = mockFetch({
    candidates: [
      {
        content: {
          parts: [
            { text: 'Kışla yükseltiliyor.' },
            {
              functionCall: {
                name: 'build_structure',
                args: { building_type: 'barracks', target_level: 2 },
              },
            },
          ],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 25 },
  });

  const adapter = createAdapter('google', { apiKey: 'AIza-test', model: 'gemini-3-pro' });
  const response = await runChat(adapter, TOOL_REQUEST);

  const call = calls[0];
  assert.ok(call);
  const tools = call.body.tools as { functionDeclarations: { name: string }[] }[];
  assert.equal(tools[0]?.functionDeclarations[0]?.name, 'build_structure');
  // Google sistem promptunu ayrı bir alanda bekler.
  assert.ok(call.body.systemInstruction);

  assert.equal(response.toolCalls[0]?.name, 'build_structure');
  assert.deepEqual(response.toolCalls[0]?.arguments, {
    building_type: 'barracks',
    target_level: 2,
  });
});

// ---------------------------------------------------------------------------
// OpenAI uyumlu
// ---------------------------------------------------------------------------

test('openai-uyumlu adaptör verilen baseUrl\'i kullanır', async () => {
  const { calls } = mockFetch({ choices: [{ message: { content: 'Merhaba.' } }] });

  const adapter = createAdapter('openai_compatible', {
    apiKey: 'local-key',
    model: 'llama-3',
    baseUrl: 'http://localhost:11434/v1',
  });
  await runChat(adapter, { system: 'x', messages: [{ role: 'user', content: 'y' }] });

  assert.ok(calls[0]?.url.startsWith('http://localhost:11434/v1'), `beklenmedik url: ${calls[0]?.url}`);
});

test('baseUrl olmadan openai-uyumlu adaptör oluşturulamaz', () => {
  assert.throws(() =>
    createAdapter('openai_compatible', { apiKey: 'k', model: 'm' }),
  );
});

// ---------------------------------------------------------------------------
// Hata sınıflandırması (§14.6)
// ---------------------------------------------------------------------------

test('HTTP durum kodları doğru hata sınıfına eşlenir', () => {
  assert.equal(classifyHttpStatus(401), 'auth');
  assert.equal(classifyHttpStatus(403), 'auth');
  assert.equal(classifyHttpStatus(429), 'rate_limit');
  assert.equal(classifyHttpStatus(500), 'provider_unavailable');
  assert.equal(classifyHttpStatus(503), 'provider_unavailable');
  assert.equal(classifyHttpStatus(404), 'invalid_request');
});

test('bağlam taşması 400 içinden ayrıştırılır', () => {
  assert.equal(
    classifyHttpStatus(400, 'maximum context length is 200000 tokens'),
    'context_length',
  );
  assert.equal(classifyHttpStatus(400, 'invalid model name'), 'invalid_request');
});

test('ağ hataları sağlayıcı erişilemez olarak sınıflanır', () => {
  assert.equal(classifyNetworkError(new TypeError('fetch failed')), 'provider_unavailable');
  const aborted = new Error('aborted');
  aborted.name = 'AbortError';
  assert.equal(classifyNetworkError(aborted), 'provider_unavailable');
});

test('oyuncunun düzeltebileceği hatalar ayırt edilir', () => {
  // auth ve rate_limit oyuncunun kendi hesabıyla ilgili — bildirim gitmeli.
  assert.equal(isPlayerActionableError('auth'), true);
  assert.equal(isPlayerActionableError('rate_limit'), true);
  // Geçici sağlayıcı arızası için oyuncuyu rahatsız etmenin anlamı yok.
  assert.equal(isPlayerActionableError('provider_unavailable'), false);
});

test('hata mesajları Türkçe ve oyuncuya dönük', () => {
  for (const kind of ['auth', 'rate_limit', 'context_length', 'provider_unavailable'] as const) {
    const message = llmErrorMessageTr(kind);
    assert.ok(message.length > 10, `${kind} için anlamlı bir mesaj olmalı`);
  }
});
