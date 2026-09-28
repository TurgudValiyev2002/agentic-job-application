import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, after, test } from 'node:test';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { chromium } from 'playwright';
import { encryptCredentials, decryptCredentials } from '../../lib/job-applications/credential-crypto.ts';
config({ path: '.env.local', quiet: true });
process.env.ACCOUNT_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.INDEED_BASE_URL = 'https://de.indeed.com';
const databaseName = `orch_indeed_session_test_${process.pid}_${Date.now()}`;
let admin, created = false, tables, sessions, api, browserHelpers;
const cookie = (name, value, domain = '.indeed.com') => ({ name, value, domain, path: '/', expires: Math.floor(Date.now() / 1000) + 86_400, httpOnly: true, secure: true, sameSite: 'Lax' });
const state = { cookies: [cookie('CTK', 'fixture-ctk'), cookie('SHOE', 'fixture-shoe', 'de.indeed.com'), cookie('SID', 'google-only', '.google.com')], origins: [] };
before(async () => {
  admin = postgres(process.env.DATABASE_URL, { max: 1 });
  await admin`create database ${admin(databaseName)}`; created = true;
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${databaseName}`; process.env.DATABASE_URL = url.toString(); process.env.NODE_ENV = 'test';
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try { await migrate(drizzle(client), { migrationsFolder: './drizzle' }); } finally { await client.end(); }
  tables = await import('../../lib/db/index.ts');
  sessions = await import('../../lib/indeed/session.ts');
  api = await import('../../app/api/indeed-session/route.ts');
  browserHelpers = await import('../../lib/indeed/browser.ts');
});
after(async () => {
  await globalThis.orchPostgresClient?.end();
  if (created) await admin`drop database ${admin(databaseName)}`;
  await admin?.end();
});
const request = (method, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/indeed-session', { method, headers: { origin, 'Content-Type': 'application/json' } });

test('Indeed history survives a read failure and is cleared on account replacement or removal', async () => {
  const history = await import('../../lib/indeed/history.ts');
  const snapshot = { syncedAt: new Date().toISOString(), since: null, counts: { applied: 0, saved: 0, interviews: 0, archived: 0 }, applications: [] };
  await sessions.saveIndeedSession(state, 'al***@example.test');
  assert.equal((await history.syncIndeedHistory(async () => snapshot)).snapshot.syncedAt, snapshot.syncedAt);
  await assert.rejects(history.syncIndeedHistory(async () => { throw Error('Unavailable'); }), /Unavailable/);
  assert.deepEqual((await history.indeedHistoryView()).snapshot, snapshot);
  await assert.rejects(history.syncIndeedHistory(async () => {
    await sessions.saveIndeedSession(state, 'bo***@example.test');
    return snapshot;
  }), /session changed/);
  assert.deepEqual(await history.indeedHistoryView(), { saved: true, emailHint: 'bo***@example.test', snapshot: null });
  await assert.rejects(history.syncIndeedHistory(async () => { await sessions.removeIndeedSession(); return snapshot; }), /session changed/);
  assert.deepEqual(await history.indeedHistoryView(), { saved: false, emailHint: null, snapshot: null });
  const route = await import('../../app/api/indeed-history/route.ts');
  assert.equal((await route.GET(new Request('https://remote.test/api/indeed-history'))).status, 403);
  assert.equal((await route.POST(new Request('http://localhost:3000/api/indeed-history', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' } }))).status, 403);
});

test('authenticated encryption rejects tampering, wrong scope and wrong key', () => {
  const encrypted = encryptCredentials('secret', 'session-a');
  assert.notEqual(encrypted, encryptCredentials('secret', 'session-a'));
  assert.equal(decryptCredentials(encrypted, 'session-a'), 'secret');
  assert.throws(() => decryptCredentials(encrypted, 'session-b'));
  const parts = encrypted.split('.'); const bytes = Buffer.from(parts[3], 'base64'); bytes[0] ^= 1; parts[3] = bytes.toString('base64');
  assert.throws(() => decryptCredentials(parts.join('.'), 'session-a'));
  const original = process.env.ACCOUNT_CREDENTIALS_KEY;
  try { process.env.ACCOUNT_CREDENTIALS_KEY = randomBytes(32).toString('base64'); assert.throws(() => decryptCredentials(encrypted, 'session-a')); }
  finally { process.env.ACCOUNT_CREDENTIALS_KEY = original; }
});

test('only Indeed cookies are stored, encrypted, and never exposed through the API', async () => {
  await sessions.saveIndeedSession(state, sessions.maskEmail('daniel.varga@example.test'));
  const [row] = await tables.db.select().from(tables.indeedSessions).where(eq(tables.indeedSessions.id, tables.INDEED_SESSION_ID));
  assert.ok(!JSON.stringify(row).includes('fixture-ctk')); assert.ok(!JSON.stringify(row).includes('google-only'));
  assert.equal(row.emailHint, 'da***@example.test');
  const loaded = await sessions.loadIndeedSession();
  assert.deepEqual(loaded.state.cookies.map((item) => item.name).sort(), ['CTK', 'SHOE'], 'third-party cookies are dropped');
  assert.ok(loaded.verifiedAt);
  const status = await api.GET(request('GET')); assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store');
  const payload = await status.json();
  assert.deepEqual(Object.keys(payload).sort(), ['emailHint', 'saved', 'signIn', 'verifiedAt']);
  assert.ok(!JSON.stringify(payload).includes('fixture'));
  await assert.rejects(sessions.saveIndeedSession({ cookies: [cookie('SID', 'x', '.google.com')], origins: [] }, null), /no Indeed cookies/);
});

test('verification and cookie refresh apply only to the session version they checked', async () => {
  const before = await sessions.loadIndeedSession();
  await sessions.recordIndeedVerification(before.version, false);
  assert.equal((await sessions.indeedSessionStatus()).verifiedAt, null);
  await sessions.refreshIndeedSession(before.version, { ...state, cookies: [cookie('CTK', 'rotated')] });
  const rotated = await sessions.loadIndeedSession();
  assert.equal(rotated.state.cookies[0].value, 'rotated');
  await sessions.recordIndeedVerification(before.version, true);
  assert.equal((await sessions.indeedSessionStatus()).verifiedAt, null, 'a stale check must not verify the replacement');
  await sessions.refreshIndeedSession(before.version, { ...state, cookies: [cookie('CTK', 'stale')] });
  assert.equal((await sessions.loadIndeedSession()).state.cookies[0].value, 'rotated', 'a stale refresh is ignored');
  assert.equal((await tables.db.select().from(tables.indeedSessions)).length, 1, 'Only one shared session row exists');
  assert.equal((await api.DELETE(request('DELETE'))).status, 200);
  assert.equal(await sessions.loadIndeedSession(), null);
});

test('session routes reject cross-origin and remote requests', async () => {
  assert.equal((await api.DELETE(request('DELETE', 'https://evil.test'))).status, 403);
  assert.equal((await api.GET(new Request('https://app.example.test/api/indeed-session'))).status, 403);
});

test('a saved session authenticates a read-only browser context that never leaves Indeed', async () => {
  await sessions.saveIndeedSession(state, null);
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, session } = await browserHelpers.createSavedIndeedContext(browser, 'read');
    assert.ok(session);
    const requests = [], failed = [];
    context.on('requestfailed', (req) => failed.push(req.url()));
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (req.method() !== 'GET' || !req.url().includes('indeed.com')) return route.fallback();
      requests.push({ url: req.url(), cookie: req.headers().cookie ?? '' });
      return route.fulfill({ contentType: 'text/html', body: `<body><script>window.mosaic={providerData:{"mosaic-provider-jobcards":{metaData:{mosaicProviderJobCardsModel:{results:[],loggedIn:true}}}}}</script>Find jobs<img src="https://tracker.example.test/pixel.png"><script>fetch("https://de.indeed.com/rpc",{method:"POST",body:"x"}).catch(()=>{})</script></body>` });
    });
    const result = await browserHelpers.isIndeedSignedIn(context);
    assert.equal(result.signedIn, true, result.message);
    assert.ok(requests.some((item) => item.url.startsWith('https://de.indeed.com/jobs') && item.cookie.includes('CTK=fixture-ctk')), 'saved cookies are sent to Indeed');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(failed.includes('https://tracker.example.test/pixel.png'), 'third-party requests are aborted by the read context');
    assert.ok(!failed.includes('https://de.indeed.com/rpc'), 'requests to Indeed hosts pass through; blocking them fails Cloudflare\'s bot check');
  } finally { await browser.close(); }
});

test('removal cannot race an active sign-in and recreate the saved session', async () => {
  const runtime = globalThis.orchIndeedSignIn;
  const original = runtime.current;
  runtime.current = { startedAt: Date.now(), promise: Promise.resolve() };
  try { assert.equal((await api.DELETE(request('DELETE'))).status, 409); }
  finally { runtime.current = original; }
});

test('sign-in profiles are fresh and cleaned up instead of retaining another account', async () => {
  const { access } = await import('node:fs/promises');
  const engine = browserHelpers.indeedChromium().chromium;
  const launch = engine.launchPersistentContext;
  const paths = [];
  engine.launchPersistentContext = async directory => { paths.push(directory); return { close: async () => {} }; };
  let first, second;
  try {
    first = await browserHelpers.launchIndeedSignInProfile();
    second = await browserHelpers.launchIndeedSignInProfile();
    assert.notEqual(paths[0], paths[1]);
    await access(paths[0]); await access(paths[1]);
    await first.cleanup(); await second.cleanup();
    await assert.rejects(access(paths[0])); await assert.rejects(access(paths[1]));
  } finally { engine.launchPersistentContext = launch; await first?.cleanup(); await second?.cleanup(); }
});
