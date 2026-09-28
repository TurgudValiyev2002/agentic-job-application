import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenJobs, screenJobBatch, screeningSnippet } from './job-screening.ts';
const profile = { titles: ['Backend Engineer', 'Platform Engineer'], skills: ['Go', 'Python', 'Kubernetes'], keywords: ['distributed systems'], seniority: 'junior', locations: [], remotePreference: 'any' };
const preferences = { titles: [], locations: [], seniority: 'any', remotePreference: 'any' };
const jobs = Array.from({ length: 30 }, (_, i) => ({ id: `job-${i}`, title: i % 2 ? 'Account Executive' : 'Software Engineer', company: 'Example', location: null, description: 'Example responsibilities.' }));
function provider(answer) { return { requestStructuredCompletion: async input => ({ ok: true, content: JSON.stringify(await answer(JSON.parse(input.messages[1].content), input)), model: 'test' }) }; }
test('LLM screening uses batches of 25 and preserves every supplied job ID', async () => {
  const calls = [], progress = [];
  const result = await screenJobs(jobs, profile, preferences, provider((data, input) => {
    calls.push(data.jobs.length); assert.equal(input.schemaName, 'job_relevance_screen');
    assert.deepEqual(data.candidate, profile);
    return { decisions: data.jobs.map(job => ({ id: job.id, careerFit: job.title === 'Account Executive' ? 'different' : 'aligned', seniorityFit: 'compatible', reason: 'Model career relevance decision.' })).reverse() };
  }), async update => progress.push(update.screened));
  assert.deepEqual(calls, [25,5]); assert.deepEqual(progress, [0,25,30]);
  assert.equal(result.irrelevant, 15); assert.equal(result.relevant, 15);
  assert.deepEqual(result.decisions.map(item => item.jobPostingId), jobs.map(job => job.id));
});
test('missing, duplicated, unknown IDs and malformed classifications fail closed', async () => {
  const decision = { id: 1, careerFit: 'aligned', seniorityFit: 'compatible', reason: 'Fits.' };
  for (const decisions of [[decision], [decision, decision], [decision, { ...decision, id: 3 }], [decision, { ...decision, id: 2, seniorityFit: 'maybe' }]]) {
    await assert.rejects(screenJobBatch(jobs.slice(0,2), profile, preferences, provider(() => ({ decisions }))), /invalid batch/);
  }
  await assert.rejects(screenJobBatch(jobs.slice(0,1), profile, preferences, { requestStructuredCompletion: async () => ({ ok: false, message: 'offline' }) }), /screening failed: offline/);
});
test('empty input makes no model calls; excerpt boundaries and missing descriptions are explicit', async () => {
  assert.equal((await screenJobs([], profile, preferences, provider(() => { throw Error('Should not call'); }))).screened, 0);
  const snippet = screeningSnippet('INTRO ' + 'x'.repeat(5000) + ' QUALIFICATIONS');
  assert.equal(snippet.abbreviated, true); assert.match(snippet.text, /^INTRO/); assert.match(snippet.text, /QUALIFICATIONS$/); assert.ok(snippet.text.length < 1700);
  assert.deepEqual(screeningSnippet(null), { text: '', abbreviated: false });
});

test('LLM career overlap cannot override its incompatible seniority judgment', async () => {
  const result = await screenJobBatch(jobs.slice(0,3), profile, preferences, provider(data => {
    assert.equal(data.effectiveSeniority,'junior');
    return { decisions: [
      {id:1,careerFit:'aligned',seniorityFit:'incompatible',reason:'Senior leadership exceeds junior level.'},
      {id:2,careerFit:'different',seniorityFit:'compatible',reason:'Different profession.'},
      {id:3,careerFit:'aligned',seniorityFit:'unclear',reason:'Level unspecified.'},
    ]};
  }));
  assert.deepEqual(result.map(d=>d.classification),['irrelevant','irrelevant','uncertain']);
});

test('title triage reaches jobs beyond the old 100-job cutoff; only survivors get descriptions', async () => {
  const many=Array.from({length:130},(_,i)=>({id:`job-${i}`,title:`Role ${i}`,company:`Employer ${i}`,location:null,description:'Actual posting contents.'}));
  const calls=[];
  const result=await screenJobs(many,profile,preferences,provider(data=>{
    const descriptions=data.jobs.some(job=>job.description);
    calls.push({count:data.jobs.length,descriptions});
    return {decisions:data.jobs.map(job=>({id:job.id,careerFit:job.title==='Role 120'?'aligned':'different',seniorityFit:'compatible',reason:'Model judgment.'}))};
  }));
  assert.deepEqual(calls,[{count:75,descriptions:false},{count:55,descriptions:false},{count:1,descriptions:true}]);
  assert.equal(result.screened,130);assert.equal(result.irrelevant,129);
  assert.deepEqual(result.decisions.filter(d=>d.classification==='relevant').map(d=>d.jobPostingId),['job-120']);
});
