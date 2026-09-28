import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diversifyEmployers, screeningPool } from './diversity.ts';

test('screening budget includes both sources and spreads each source across employers', () => {
  const job = (id, source, company, time) => ({ id, source, company, postedAt: new Date(time) });
  const pool = screeningPool([
    ...Array.from({length: 50}, (_,i) => job(`a${i}`, 'first', 'Dominant', 1000-i)),
    job('b', 'first', 'Alternative', 1), job('c', 'second', 'Independent', 0),
  ], 4);
  assert.deepEqual(pool.map(j=>j.id), ['a0','c','b','a1']);
});
test('detailed shortlist caps duplicate employers without losing other ranked candidates', () => {
  const items = [...Array.from({length:10}, (_,id)=>({id,company:'SpaceX'})), {id:10,company:'Other'}, {id:11,company:' SPACEX '}];
  assert.deepEqual(diversifyEmployers(items, j=>j.company, 3).map(j=>j.id), [0,10,1,2]);
});
