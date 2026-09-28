import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ollamaConfig, requestStructuredCompletion } from './ollama.ts';
import { activeAiProvider, defaultAiProviderName } from './provider.ts';
import { envConnections } from './connections.ts';
import { parseRewriteRequest } from './cv-rewrite-request.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ['OLLAMA_BASE_URL', 'OLLAMA_TIMEOUT_MS', 'AI_PROVIDER']) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});
const input = { schemaName: 'test', jsonSchema: { type: 'object' }, messages: [{ role: 'user', content: 'Synthetic test' }] };

test('Ollama is selectable, configurable as default, and accepted by both request parsers', async () => {
  process.env.AI_PROVIDER = 'ollama';
  assert.equal(defaultAiProviderName(), 'ollama');
  assert.equal(activeAiProvider().providerName, 'ollama');
  assert.ok(envConnections().find(p => p.id === 'ollama')?.available);
  assert.deepEqual(await parseRewriteRequest(new Request('http://localhost', { method: 'POST', body: '{"provider":"ollama"}' })), { ok: true, provider: 'ollama' });
});

test('sends schema-constrained native Ollama requests through ngrok', async () => {
  process.env.OLLAMA_BASE_URL = 'https://example.test/v1/';
  assert.equal(ollamaConfig().baseUrl, 'https://example.test');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/api/chat');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.format, input.jsonSchema);
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(options.headers['ngrok-skip-browser-warning'], 'true');
    assert.equal(body.options.num_predict, 1234);
    return Response.json({ message: { content: '{"ready":true}' }, done: true });
  };
  const result = await requestStructuredCompletion({ ...input, maxTokens: 1234 });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.content), { ready: true });
});

test('handles missing models, malformed responses, and output truncation', async () => {
  for (const [response, kind] of [
    [new Response('', { status: 404 }), 'http'],
    [new Response('<html>ngrok</html>'), 'invalid_response'],
    [Response.json({ message: { content: '{}' }, done_reason: 'length' }), 'invalid_response'],
    [Response.json({ message: { content: '' } }), 'invalid_response'],
  ]) {
    globalThis.fetch = async () => response;
    const result = await requestStructuredCompletion(input);
    assert.equal(result.ok, false);
    assert.equal(result.kind, kind);
  }
});

test('reports timeouts while reading the response body correctly', async () => {
  process.env.OLLAMA_TIMEOUT_MS = '5';
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  });
  assert.equal((await requestStructuredCompletion(input)).kind, 'timeout');
});

test('a dropped connection names the transport error and is re-sent once; a second drop fails', async () => {
  const reset = () => { const error = new TypeError('fetch failed'); error.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }); throw error; };
  let calls = 0;
  globalThis.fetch = async () => { calls++; if (calls === 1) reset(); return { ok: true, json: async () => ({ message: { content: '{"ok":true}' } }) }; };
  const recovered = await requestStructuredCompletion(input);
  assert.equal(recovered.ok, true); assert.equal(calls, 2, 'the same request is re-sent after a transport failure');
  calls = 0;
  globalThis.fetch = async () => { calls++; reset(); };
  const failed = await requestStructuredCompletion(input);
  assert.equal(failed.ok, false); assert.equal(failed.kind, 'unreachable'); assert.equal(calls, 2);
  assert.match(failed.message, /UND_ERR_SOCKET: other side closed/); assert.match(failed.message, /retried once/);
});

test('timeouts and HTTP errors are never re-sent', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 502 }; };
  assert.equal((await requestStructuredCompletion(input)).kind, 'http'); assert.equal(calls, 1);
});
