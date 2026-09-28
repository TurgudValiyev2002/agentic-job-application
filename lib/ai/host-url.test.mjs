import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reachableUrl } from './host-url.ts';
import { decryptCredentials, encryptCredentials } from '../job-applications/credential-crypto.ts';

const saved = { ...process.env };
afterEach(() => { for (const key of ['ORCH_LOCALHOST_ALIAS', 'ACCOUNT_CREDENTIALS_KEY', 'ACCOUNT_CREDENTIALS_KEY_FILE']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

test('inside Docker, localhost model URLs reach the host; other hosts and non-Docker runs are unchanged', () => {
  delete process.env.ORCH_LOCALHOST_ALIAS;
  assert.equal(reachableUrl('http://localhost:11434/api/chat'), 'http://localhost:11434/api/chat');
  process.env.ORCH_LOCALHOST_ALIAS = 'host.docker.internal';
  assert.equal(reachableUrl('http://localhost:11434/api/chat'), 'http://host.docker.internal:11434/api/chat');
  assert.equal(reachableUrl('http://127.0.0.1:1234/v1/models'), 'http://host.docker.internal:1234/v1/models');
  assert.equal(reachableUrl('http://[::1]:1234/v1/chat/completions'), 'http://host.docker.internal:1234/v1/chat/completions');
  for (const url of ['https://example.ngrok-free.app/api/chat', 'http://192.168.1.20:11434/api/chat', 'https://openrouter.ai/api/v1/chat/completions', 'not a url'])
    assert.equal(reachableUrl(url), url);
});

test('without a configured key, Docker generates one key file once and every container reuses it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orch-key-'));
  try {
    delete process.env.ACCOUNT_CREDENTIALS_KEY;
    delete process.env.ACCOUNT_CREDENTIALS_KEY_FILE;
    assert.throws(() => encryptCredentials('secret', 'scope'), /not configured/, 'outside Docker nothing is generated');
    process.env.ACCOUNT_CREDENTIALS_KEY_FILE = path.join(directory, 'keys', 'account-credentials.key');
    const encrypted = encryptCredentials('secret', 'scope');
    const key = (await readFile(process.env.ACCOUNT_CREDENTIALS_KEY_FILE, 'utf8')).trim();
    assert.match(key, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(decryptCredentials(encrypted, 'scope'), 'secret');
    encryptCredentials('again', 'scope');
    assert.equal((await readFile(process.env.ACCOUNT_CREDENTIALS_KEY_FILE, 'utf8')).trim(), key, 'the key is generated only once');
    // A key from .env.local still takes precedence over the file.
    process.env.ACCOUNT_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
    assert.throws(() => decryptCredentials(encrypted, 'scope'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
