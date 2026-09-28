import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cosineSimilarity, rankingSimilarity, TARGET_ROLE_WEIGHT } from './similarity.ts';

test('cosine similarity is 0 for empty or mismatched vectors', () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
});

test('ranking uses the CV alone without a target role', () => {
  assert.equal(rankingSimilarity([1, 0], [0.6, 0.8]), cosineSimilarity([1, 0], [0.6, 0.8]));
  assert.equal(rankingSimilarity([1, 0], [0.6, 0.8], null), cosineSimilarity([1, 0], [0.6, 0.8]));
  assert.equal(rankingSimilarity([1, 0], [0.6, 0.8], [1, 0, 0]), cosineSimilarity([1, 0], [0.6, 0.8]), 'a wrong-sized target is ignored');
});

test('a target role ranks role-family jobs above jobs that only resemble the CV history', () => {
  const cv = [1, 0];
  const target = [0, 1];
  const historyJob = [1, 0];
  const roleJob = [0.2, 0.98];
  assert.ok(cosineSimilarity(historyJob, cv) > cosineSimilarity(roleJob, cv));
  assert.ok(rankingSimilarity(roleJob, cv, target) > rankingSimilarity(historyJob, cv, target));
  assert.equal(rankingSimilarity(historyJob, cv, target), 1 - TARGET_ROLE_WEIGHT);
});
