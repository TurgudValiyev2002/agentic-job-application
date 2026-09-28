import assert from 'node:assert/strict';
import test from 'node:test';
import { tailorWithEscalation } from './tailoring.ts';

const ok = (id) => async () => ({ ok: true, rewriteId: id });
const rejected = (message = 'Source verification failed.') => async () => ({ ok: false, rejected: true, message });
const never = async () => assert.fail('must not run');

test('a strict success needs nothing else', async () => {
  const job = {};
  assert.deepEqual(await tailorWithEscalation(job, { strict: ok('s'), lenient: never, profile: never }), { rewriteId: 's' });
  assert.equal(job.tailorRejections, undefined);
});

test('a rejected strict draft is retried leniently, then the profile CV is used', async () => {
  const events = [];
  const onEscalate = async (next) => { events.push(next); };
  const job = {};
  assert.deepEqual(await tailorWithEscalation(job, { strict: rejected(), lenient: async () => ({ ok: true, rewriteId: 'l', removed: 2 }), profile: never, onEscalate }), { rewriteId: 'l', tailoring: 'lenient' });
  assert.deepEqual(await tailorWithEscalation({}, { strict: rejected(), lenient: ok('clean'), profile: never }), { rewriteId: 'clean' }, 'a lenient draft that needed no removals is not labelled');
  assert.equal(job.tailorRejections, 1);
  const twice = {};
  assert.deepEqual(await tailorWithEscalation(twice, { strict: rejected(), lenient: rejected(), profile: async () => 'p', onEscalate }), { rewriteId: 'p', tailoring: 'profile' });
  assert.equal(twice.tailorRejections, 2);
  assert.deepEqual(events, ['lenient', 'lenient', 'profile']);
});

test('outages are not escalated, and a retried run resumes at the level it reached', async () => {
  const job = {};
  await assert.rejects(tailorWithEscalation(job, { strict: async () => ({ ok: false, rejected: false, message: 'Ollama is unreachable.' }), lenient: never, profile: never }), /unreachable/);
  assert.equal(job.tailorRejections, undefined);
  assert.deepEqual(await tailorWithEscalation({ tailorRejections: 2 }, { strict: never, lenient: never, profile: async () => 'p' }), { rewriteId: 'p', tailoring: 'profile' });
  await assert.rejects(tailorWithEscalation({ tailorRejections: 1 }, { strict: never, lenient: rejected('Bad.'), profile: async () => null }), /Bad\. This profile has no reviewed CV/);
});
