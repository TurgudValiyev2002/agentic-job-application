import assert from 'node:assert/strict';
import { test } from 'node:test';

// These tests inject persistence as well as model calls and never connect to a database.
process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost/unused';
const { processNextProfileJob } = await import('./profile-jobs.ts');

function fixture(options = {}) {
  const row = { id: 'profile', cvStatus: options.status ?? 'generating', targetRole: options.targetRole ?? 'Backend developer', jobStartedAt: new Date(), cvDocumentId: options.upload ? 'upload' : null, reviewOnly: Boolean(options.upload) };
  const transitions = [], calls = [];
  let pending = true;
  const dependencies = {
    claim: async () => pending ? (pending = false, { ...row }) : null,
    load: async () => ({ ...row }),
    update: async (_claim, patch) => { if (options.lostClaim) return false; Object.assign(row, patch); if (patch.cvStatus) transitions.push(patch.cvStatus); return true; },
    provider: () => ({ providerName: 'ollama', model: 'fake' }),
    document: async id => ({ id, extractedText: 'Uploaded CV' }),
    generate: async () => { calls.push('generate'); return { id: 'plain', extractedText: 'Plain CV' }; },
    improve: async (document, role) => { calls.push('improve'); assert.equal(document.id, 'plain'); assert.equal(role, row.targetRole); if (options.improveFails) throw new Error('Unsupported claims'); return { id: 'improved', extractedText: 'Improved CV' }; },
    review: async document => { calls.push(`review:${document.id}`); if (options.reviewFails) throw new Error('Model unavailable'); return 'review'; },
  };
  return { row, transitions, calls, dependencies };
}

test('generating → improving → reviewing → ready with the improved document and review', async () => {
  const f = fixture(); assert.equal(await processNextProfileJob(f.dependencies), true);
  assert.deepEqual(f.transitions, ['generating', 'improving', 'reviewing', 'ready']);
  assert.deepEqual(f.calls, ['generate', 'improve', 'review:improved']);
  assert.equal(f.row.cvDocumentId, 'improved'); assert.equal(f.row.cvReviewId, 'review'); assert.equal(f.row.jobStartedAt, null);
  assert.equal(await processNextProfileJob(f.dependencies), false);
});
test('improvement rejection keeps the plain CV and reaches ready with a warning', async () => {
  const f = fixture({ improveFails: true }); await processNextProfileJob(f.dependencies);
  assert.equal(f.row.cvStatus, 'ready'); assert.equal(f.row.cvDocumentId, 'plain');
  assert.equal(f.row.cvError, 'Improvement skipped: Unsupported claims'); assert.ok(f.calls.includes('review:plain'));
});
test('review failure marks the profile failed and releases its claim', async () => {
  const f = fixture({ reviewFails: true }); await processNextProfileJob(f.dependencies);
  assert.equal(f.row.cvStatus, 'failed'); assert.equal(f.row.cvError, 'Model unavailable'); assert.equal(f.row.jobStartedAt, null);
});
for (const status of ['improving', 'reviewing']) test(`stale ${status} claim restarts at generation`, async () => {
  const f = fixture({ status }); await processNextProfileJob(f.dependencies);
  assert.equal(f.calls[0], 'generate'); assert.equal(f.row.cvStatus, 'ready');
});
test('blank target role skips improving', async () => {
  const f = fixture({ targetRole: '  ' }); await processNextProfileJob(f.dependencies);
  assert.ok(!f.calls.includes('improve')); assert.ok(!f.transitions.includes('improving')); assert.equal(f.row.cvDocumentId, 'plain'); assert.equal(f.row.cvStatus, 'ready');
});
test('uploaded CV only runs the reviewer, including a reclaimed upload', async () => {
  const f = fixture({ status: 'reviewing', upload: true }); await processNextProfileJob(f.dependencies);
  assert.deepEqual(f.calls, ['review:upload']); assert.equal(f.row.cvStatus, 'ready');
});
test('a save that invalidates the claim prevents stale work from publishing', async () => {
  const f = fixture({ lostClaim: true }); await processNextProfileJob(f.dependencies);
  assert.deepEqual(f.calls, []); assert.equal(f.row.cvStatus, 'generating');
});
