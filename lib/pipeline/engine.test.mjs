import assert from 'node:assert/strict';
import test from 'node:test';
import { appendActivity, executePipeline, needsRetry, prepareRetry } from './engine.ts';
import { profileTargetRole, searchTitleFromTargetRole, searchTitlesFromTargetRole } from './target-role.ts';
import { initialPipelineState } from './types.ts';

const input = { id: 'run', cvDocumentId: 'original-cv', provider: 'ollama', model: 'gemma4:26b' };
const job = (id, score, similarity = 0) => ({ jobPostingId: id, suitable: true, score, similarity, title: id, company: 'Example', location: null, url: 'https://example.test', description: 'Python', missing: [], rationale: 'Relevant skills', status: 'pending' });
function dependencies(jobs, overrides = {}) {
  return {
    find: async (run) => { assert.equal(run.cvDocumentId, input.cvDocumentId); return { jobPostingIds: jobs.map(j => j.jobPostingId), fetched: jobs.length, warnings: [] }; },
    rank: async () => ({ summary: { considered: jobs.length, scored: jobs.length, failed: 0, ranking: 'embedding' }, jobs }),
    tailor: async (run, j) => { assert.deepEqual(run, input); return `rewrite-${j.jobPostingId}`; },
    checkpoint: async () => {},
    ...overrides,
  };
}

test('finds jobs, scores them, and tailors only the three highest scores with deterministic ties', async () => {
  const jobs = [job('low', 20), job('second', 80, .9), job('third', 80, .8), job('best', 95), job('fourth', 70)];
  const calls = [];
  const result = await executePipeline(input, initialPipelineState(), dependencies(jobs, {
    tailor: async (run, j) => { assert.equal(run.cvDocumentId, 'original-cv'); calls.push(j.jobPostingId); return j.jobPostingId; },
  }));
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['best', 'second', 'third']);
  assert.equal(result.state.stage, 'done');
});

test('does not use stale ranking results or tailor duplicate jobs', async () => {
  const jobs = [job('a', 90), job('b', 80)];
  const result = await executePipeline(input, initialPipelineState(), dependencies(jobs, {
    rank: async () => ({ summary: { considered: 2, scored: 2, failed: 0, ranking: 'embedding' }, jobs: [...jobs, job('a', 90), job('stale', 100)] }),
  }));
  assert.deepEqual(result.state.jobs.map(j => j.jobPostingId), ['a', 'b']);
  assert.match(result.state.warnings.join(' '), /Only 2/);
});

test('zero jobs completes honestly without scoring or tailoring', async () => {
  const result = await executePipeline(input, initialPipelineState(), dependencies([], {
    rank: async () => assert.fail('must not rank'), tailor: async () => assert.fail('must not tailor'),
  }));
  assert.equal(result.status, 'completed');
  assert.match(result.state.warnings[0], /No suitable jobs/);
});

test('scoring failure stops tailoring and does not fall back to earlier matches', async () => {
  await assert.rejects(executePipeline(input, initialPipelineState(), dependencies([job('a', 90)], {
    rank: async () => ({ summary: { considered: 1, scored: 0, failed: 1, ranking: 'keyword' }, jobs: [] }),
    tailor: async () => assert.fail('must not tailor'),
  })), /could be scored/);
});

test('a failed tailoring preserves successes and still attempts all top three', async () => {
  const attempted = [];
  const result = await executePipeline(input, initialPipelineState(), dependencies([job('a', 90), job('b', 80), job('c', 70)], {
    tailor: async (_run, j) => { attempted.push(j.jobPostingId); if (j.jobPostingId === 'b') throw new Error('Provider unavailable'); return j.jobPostingId; },
  }));
  assert.equal(result.status, 'partial');
  assert.deepEqual(attempted, ['a', 'b', 'c']);
  assert.equal(result.state.jobs[1].error, 'Provider unavailable');
  assert.equal(result.state.jobs[0].status, 'completed');
});

test('all tailoring failures are reported as failed', async () => {
  const result = await executePipeline(input, initialPipelineState(), dependencies([job('a', 90)], { tailor: async () => { throw new Error('failed'); } }));
  assert.equal(result.status, 'failed');
});

test('resumes from persisted progress without re-searching or redoing completed CVs', async () => {
  const state = { stage: 'tailoring', search: { jobPostingIds: ['a', 'b'], fetched: 2, warnings: [] }, matching: { considered: 2, scored: 2, failed: 0, ranking: 'embedding' }, warnings: [], jobs: [{ ...job('a', 90), status: 'completed', rewriteId: 'saved' }, { ...job('b', 80), status: 'running' }] };
  const result = await executePipeline(input, state, dependencies([], {
    find: async () => assert.fail('must not find again'), rank: async () => assert.fail('must not rank again'),
    tailor: async (_run, j) => { assert.equal(j.jobPostingId, 'b'); return 'new'; },
  }));
  assert.equal(result.status, 'completed');
  assert.equal(result.state.jobs[0].rewriteId, 'saved');
  assert.equal(state.jobs[1].status, 'running', 'must not mutate the persisted input');
});

test('lost checkpoint ownership stops subsequent work', async () => {
  await assert.rejects(executePipeline(input, initialPipelineState(), dependencies([], {
    checkpoint: async () => { throw new Error('Lease lost'); }, find: async () => assert.fail('must not run after lost lease'),
  })), /Lease lost/);
});

test('serializes concurrent live progress writes and preserves every score event', async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const snapshots = [];
  const jobs = [job('a', 90), job('b', 80)];
  const result = await executePipeline(input, initialPipelineState(), dependencies(jobs, {
    rank: async (_input, _ids, report) => {
      await Promise.all([
        report({ phase: 'scoring', message: 'Scored a', scored: 1, failed: 0, total: 2 }),
        report({ phase: 'scoring', message: 'Scored b', scored: 2, failed: 0, total: 2 }),
      ]);
      return { summary: { considered: 2, scored: 2, failed: 0, ranking: 'embedding' }, jobs };
    },
    checkpoint: async (state) => {
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      snapshots.push(structuredClone(state));
      inFlight--;
    },
  }));
  assert.equal(maximumInFlight, 1);
  const liveScores = snapshots.filter(s => ['Scored a', 'Scored b'].includes(s.live?.message));
  assert.deepEqual(liveScores.map(s => s.scoring.scored), [1, 2]);
  assert.ok(result.state.activity.some(event => event.message === 'Scored a'));
  assert.ok(result.state.activity.some(event => event.message === 'Scored b'));
  assert.equal(result.state.jobs[0].status, 'completed');
});

test('bounds activity history and saves progress before a slow agent completes', async () => {
  let persisted;
  const result = await executePipeline(input, initialPipelineState(), dependencies([], {
    find: async (_input, report) => {
      for (let index = 0; index < 125; index++) {
        const message = `Page ${String.fromCharCode(65 + (index % 26))}${'x'.repeat(Math.floor(index / 26))}`;
        await report({ phase: 'searching', message, fetched: index });
        assert.equal(persisted.live.message, message);
      }
      return { jobPostingIds: [], fetched: 125, warnings: [] };
    },
    checkpoint: async state => { persisted = structuredClone(state); },
  }));
  assert.equal(result.state.activity.length, 120);
  assert.equal(result.state.stage, 'done');
});

test('zero scores and explicitly unsuitable matches never reach tailoring', async () => {
  const jobs=[job('zero',0),{...job('wrong-role',95),suitable:false},job('low',49)];
  const result=await executePipeline(input,initialPipelineState(),dependencies(jobs,{tailor:async()=>assert.fail('unsuitable jobs must not generate CVs')}));
  assert.equal(result.status,'completed');assert.equal(result.state.jobs.length,0);
});

test('refines a weak search, keeps preferences fixed, and stops after enough suitable jobs',async()=>{
  const preferences={titles:['Backend Developer'],locations:['Vienna'],remotePreference:'remote',seniority:'junior'};
  const run={...input,preferences};let finds=0,refines=0;
  const result=await executePipeline(run,initialPipelineState(),{
    find:async(actual,_report,plan)=>{assert.deepEqual(actual.preferences,preferences);finds++;if(finds===2)assert.equal(plan.strategy,'next_pages');return {jobPostingIds:finds===1?['weak']:['a','b','c'],fetched:3,warnings:[]};},
    rank:async(_run,ids,_report,budget)=>{if(finds===2)assert.ok(budget.excludeIds.includes('weak'));return {summary:{considered:ids.length,scored:ids.length,failed:0,ranking:'embedding'},jobs:ids.map(id=>job(id,id==='weak'?20:80)),assessedIds:ids};},
    refine:async()=>{refines++;return {strategy:'next_pages',reason:'Try later results.',round:1};},
    tailor:async(_run,j)=>j.jobPostingId,checkpoint:async()=>{},
  });
  assert.equal(finds,2);assert.equal(refines,1);assert.equal(result.state.jobs.length,3);assert.equal(result.state.consideredTotal,4);
});

test('enforces three search attempts and terminates without lowering the suitability threshold',async()=>{
  let finds=0;
  const result=await executePipeline(input,initialPipelineState(),{
    find:async()=>{finds++;return {jobPostingIds:[String(finds)],fetched:1,warnings:[]};},
    rank:async(_run,ids)=>({summary:{considered:1,scored:1,failed:0,ranking:'embedding'},jobs:[job(ids[0],20)]}),
    refine:async()=>({strategy:'next_pages',reason:'Explore another page.',round:finds}),
    tailor:async()=>assert.fail('must not tailor'),checkpoint:async()=>{},
  });
  assert.equal(finds,3);assert.equal(result.status,'completed');assert.equal(result.state.jobs.length,0);
});

test('enforces the total scoring budget across refinement rounds',async()=>{
  let finds=0;
  const result=await executePipeline(input,initialPipelineState(),{
    find:async()=>{finds++;return {jobPostingIds:[String(finds)],fetched:20,warnings:[]};},
    rank:async(_run,ids,_report,budget)=>{assert.equal(budget.remaining,finds===1?40:20);return {summary:{considered:20,scored:20,failed:0,ranking:'embedding'},jobs:[job(ids[0],10)]};},
    refine:async()=>({strategy:'next_pages',reason:'Explore later results.',round:1}),
    tailor:async()=>assert.fail('must not tailor'),checkpoint:async()=>{},
  });
  assert.equal(finds,2);assert.equal(result.state.consideredTotal,40);
});

test('a refinement outage preserves earlier suitable matches',async()=>{
  let finds=0;
  const result=await executePipeline(input,initialPipelineState(),dependencies([job('a',90)],{
    find:async()=>{if(++finds===2)throw new Error('Source offline');return {jobPostingIds:['a'],fetched:1,warnings:[]};},
    refine:async()=>({strategy:'next_pages',reason:'More results.',round:1}),
  }));
  assert.equal(result.state.jobs[0].status,'completed');assert.match(result.state.warnings.join(' '),/Source offline/);
});

test('empty retry does not reuse an earlier rounds screening evidence', async () => {
  let finds=0, refines=0;
  await executePipeline(input,initialPipelineState(),dependencies([],{
    find:async()=>({jobPostingIds:++finds===1?['weak']:[],fetched:finds===1?1:0,warnings:[]}),
    rank:async(_input,_ids,report)=>{
      await report({phase:'screening',message:'Screened',screening:{total:1,screened:1,relevant:1,uncertain:0,irrelevant:0,decisions:[]}});
      return {summary:{considered:1,scored:1,failed:0,ranking:'embedding'},jobs:[job('weak',20)]};
    },
    refine:async(_input,state)=>{
      if(++refines===1){assert.equal(state.screening.relevant,1);return {strategy:'next_pages',reason:'More results.',round:1};}
      assert.equal(state.search.fetched,0);assert.equal(state.screening,undefined);return null;
    },
  }));
  assert.equal(refines,2);
});

test('publishes suitable matches before ranking finishes and never publishes stale or unsuitable results',async()=>{
 let snapshot;const jobs=[job('a',70),job('b',90),{...job('c',95),suitable:false}];
 const result=await executePipeline(input,initialPipelineState(),dependencies(jobs,{
  checkpoint:async state=>{snapshot=structuredClone(state);},
  rank:async(_input,_ids,report)=>{
   await report({phase:'scoring',message:'First result',jobResult:jobs[0]});
   assert.equal(snapshot.stage,'ranking');assert.equal(snapshot.matching,undefined);assert.deepEqual(snapshot.jobs.map(j=>j.jobPostingId),['a']);
   await report({phase:'scoring',message:'Ignore stale',jobResult:job('stale',100)});
   await report({phase:'scoring',message:'Not suitable',jobResult:jobs[2]});
   assert.deepEqual(snapshot.jobs.map(j=>j.jobPostingId),['a']);
   await report({phase:'scoring',message:'Better result',jobResult:jobs[1]});
   assert.deepEqual(snapshot.jobs.map(j=>j.jobPostingId),['b','a']);
   return {summary:{considered:3,scored:3,failed:0,ranking:'embedding'},jobs};
  },
 }));
 assert.equal(result.state.rankedJobs.length,3);assert.deepEqual(result.state.jobs.map(j=>j.jobPostingId),['b','a']);
});

test('automatic runs dispatch only successfully tailored top three; legacy/manual runs never apply', async () => {
  const jobs = [job('best',95),job('second',90),job('third',85),job('fourth',80)];
  const calls=[];
  const agents=dependencies(jobs,{tailor:async(_run,j)=>{if(j.jobPostingId==='second')throw Error('Tailoring failed');return `cv-${j.jobPostingId}`;},apply:async(_run,j)=>{calls.push([j.jobPostingId,j.rewriteId]);return `app-${j.jobPostingId}`;}});
  await executePipeline(input,initialPipelineState(),agents);assert.equal(calls.length,0);
  const result=await executePipeline(input,{...initialPipelineState(),autoApply:true},agents);
  assert.deepEqual(calls,[['best','cv-best'],['third','cv-third']]);assert.equal(result.status,'partial');
  await executePipeline(input,result.state,{...agents,find:async()=>assert.fail(),rank:async()=>assert.fail()});
  assert.equal(calls.length,2,'checkpoint resume does not enqueue again');
});
test('an application dispatch failure does not prevent the other top jobs from applying',async()=>{
  const calls=[];
  const result=await executePipeline(input,{...initialPipelineState(),autoApply:true},dependencies([job('a',95),job('b',90),job('c',80)],{apply:async(_run,j)=>{calls.push(j.jobPostingId);if(j.jobPostingId==='b')throw Error('Unsupported');return j.jobPostingId;}}));
  assert.deepEqual(calls,['a','b','c']);assert.equal(result.status,'partial');assert.equal(result.state.jobs[1].applicationError,'Unsupported');
});
test('automatic runs never dispatch a posting that sends applicants to the company site',async()=>{
  const calls=[];
  const jobs=[{...job('a',95),indeedApply:true},{...job('b',90),indeedApply:false},job('c',80)];
  const agents=dependencies(jobs,{apply:async(_run,j)=>{calls.push(j.jobPostingId);return j.jobPostingId;}});
  const result=await executePipeline(input,{...initialPipelineState(),autoApply:true},agents);
  assert.deepEqual(calls,['a','c'],'unknown apply support (older runs, other sources) is still attempted');assert.equal(result.status,'completed');
  // A run planned before the filter existed can resume with a tailored company-site job: it is reported, never dispatched.
  const resumed=await executePipeline(input,{...result.state,jobs:[...result.state.jobs,{...job('b',90),indeedApply:false,status:'completed',rewriteId:'cv-b'}]},{...agents,find:async()=>assert.fail(),rank:async()=>assert.fail()});
  assert.deepEqual(calls,['a','c']);assert.match(resumed.state.jobs[2].applicationError,/company's own website/);assert.equal(resumed.status,'partial');
});
test('automatic runs select the top three among Indeed Apply postings, so company-site jobs never take a slot',async()=>{
  const jobs=[{...job('site',99),indeedApply:false},{...job('a',95),indeedApply:true},{...job('b',90),indeedApply:true},job('unknown',85),{...job('d',80),indeedApply:true}];
  const calls=[];
  const result=await executePipeline(input,{...initialPipelineState(),autoApply:true},dependencies(jobs,{apply:async(_run,j)=>{calls.push(j.jobPostingId);return j.jobPostingId;}}));
  assert.deepEqual(result.state.jobs.map(j=>j.jobPostingId),['a','b','unknown']);assert.deepEqual(calls,['a','b','unknown']);
  const manual=await executePipeline(input,initialPipelineState(),dependencies(jobs));
  assert.deepEqual(manual.state.jobs.map(j=>j.jobPostingId),['site','a','b'],'manual runs still tailor for the best matches regardless of apply support');
});

test('selected limits control live selection, scoring targets, tailoring and automatic dispatch',async()=>{
  for(const maxMatches of [1,5,10,20]){
    const jobs=Array.from({length:22},(_,i)=>({...job(`job-${i}`,100-i),indeedApply:true}));
    const tailored=[],applied=[];let requested;
    const agents=dependencies(jobs,{
      rank:async(_input,_ids,report,budget)=>{requested=budget.suitableNeeded;for(const j of jobs)await report({phase:'scoring',message:'Scored',jobResult:j});return{summary:{considered:22,scored:22,failed:0,ranking:'embedding'},jobs};},
      tailor:async(_run,j)=>{tailored.push(j.jobPostingId);return `cv-${j.jobPostingId}`;},
      apply:async(_run,j)=>{applied.push(j.jobPostingId);return `application-${j.jobPostingId}`;},
      checkpoint:async(state)=>assert.ok(state.jobs.length<=maxMatches),
    });
    const result=await executePipeline({...input,maxMatches},{...initialPipelineState(),maxMatches,autoApply:true},agents);
    assert.equal(requested,maxMatches);assert.equal(result.state.maxMatches,maxMatches);
    assert.equal(tailored.length,maxMatches);assert.deepEqual(applied,tailored);assert.equal(result.state.jobs.length,maxMatches);
    const resumed=await executePipeline({...input,maxMatches:3},result.state,agents);
    assert.equal(resumed.state.maxMatches,maxMatches,'persisted limit wins on resume');assert.equal(applied.length,maxMatches,'no duplicate dispatch');
  }
});
test('larger targets continue paging beyond three matches and still respect the search budget',async()=>{
  let finds=0;const needed=[];
  const result=await executePipeline(input,{...initialPipelineState(),maxMatches:10},{
    find:async()=>({jobPostingIds:[`${++finds}-a`,`${finds}-b`,`${finds}-c`],fetched:3,warnings:[]}),
    rank:async(_run,ids,_report,budget)=>{needed.push(budget.suitableNeeded);return{summary:{considered:3,scored:3,failed:0,ranking:'embedding'},jobs:ids.map(id=>job(id,90))};},
    refine:async()=>({strategy:'next_pages',reason:'More matches requested.',round:finds}),
    tailor:async(_run,j)=>`cv-${j.jobPostingId}`,checkpoint:async()=>{},
  });
  assert.equal(finds,3);assert.deepEqual(needed,[10,7,4]);assert.equal(result.state.jobs.length,9);
  assert.match(result.state.warnings.join(' '),/9 of 10 requested/);
});
test('invalid result limits fail before starting search or dispatch',async()=>{
  for(const maxMatches of [0,-1,21,2.5,NaN,'5'])await assert.rejects(executePipeline(input,{...initialPipelineState(),maxMatches},dependencies([],{find:()=>assert.fail('must not search')})));
});
test('a profile target role becomes a clean lead search title; the model derives the rest of the family',()=>{
  assert.equal(searchTitleFromTargetRole('AI researcher (LLM evaluation, ML systems, PyTorch)'),'AI researcher');
  assert.equal(searchTitleFromTargetRole('  Machine   Learning Engineer '),'Machine Learning Engineer');
  assert.equal(searchTitleFromTargetRole(''),null);assert.equal(searchTitleFromTargetRole(null),null);assert.equal(searchTitleFromTargetRole('AI'),null,'too short to be a query');
  assert.deepEqual(searchTitlesFromTargetRole('AI researcher (LLM evaluation)'),['AI researcher']);
  assert.deepEqual(searchTitlesFromTargetRole('Backend / Platform Engineer'),['Platform Engineer'],'a bare modifier never leads; the named half does');
  assert.deepEqual(searchTitlesFromTargetRole('Data Engineer, Analytics Engineer'),['Data Engineer','Analytics Engineer']);
  assert.deepEqual(searchTitlesFromTargetRole(null),[]);
  assert.equal(profileTargetRole({ targetRole: '  AI researcher ', desiredPosition: 'Backend Engineer' }),'AI researcher');
  assert.equal(profileTargetRole({ targetRole: null, desiredPosition: 'Backend / Platform Engineer' }),'Backend / Platform Engineer','a profile without a target role aims at its desired position');
  assert.equal(profileTargetRole({ targetRole: '', desiredPosition: '' }),null);
});

test('a retry after failed tailoring keeps the shortlist and completed CVs and redoes only the failed ones', async () => {
  let fail = true;
  const first = await executePipeline(input, initialPipelineState(), dependencies([job('a', 90), job('b', 80), job('c', 70)], {
    tailor: async (_run, j) => { if (j.jobPostingId === 'b' && fail) throw new Error('Model timed out'); return `rewrite-${j.jobPostingId}`; },
  }));
  assert.equal(needsRetry(first), true);
  const retried = prepareRetry(first.state);
  assert.equal(retried.stage, 'tailoring');
  assert.deepEqual(retried.jobs.map(j => j.status), ['completed', 'pending', 'completed']);
  assert.equal(retried.jobs[1].error, undefined);
  fail = false;
  const tailored = [];
  const second = await executePipeline(input, retried, dependencies([], {
    find: async () => assert.fail('must not search again'), rank: async () => assert.fail('must not rank again'),
    refine: async () => assert.fail('must not refine again'),
    tailor: async (_run, j) => { tailored.push(j.jobPostingId); return `rewrite-${j.jobPostingId}`; },
  }));
  assert.deepEqual(tailored, ['b']);
  assert.equal(second.status, 'completed');
  assert.equal(needsRetry(second), false);
});

test('a retry after a failed search or ranking reruns that stage', () => {
  // Ranking threw: the search results are kept and ranking runs again.
  const ranked = prepareRetry({ ...initialPipelineState(), stage: 'ranking', search: { jobPostingIds: ['a'], fetched: 1, warnings: [] }, live: { phase: 'scoring', message: 'x', at: 'now' } });
  assert.deepEqual(ranked.search.jobPostingIds, ['a']);
  assert.equal(ranked.live, undefined);
  // A round that ranked but scored nothing searches again from scratch, with no stale exclusions.
  const empty = prepareRetry({ ...initialPipelineState(), stage: 'ranking', search: { jobPostingIds: ['a'], fetched: 1, warnings: [] }, matching: { considered: 1, scored: 0, failed: 1, ranking: 'keyword' }, assessedIds: ['a'], consideredTotal: 1, searchRound: 1, warnings: ['1 job scores failed'] });
  assert.equal(empty.stage, 'finding');
  for (const key of ['search', 'matching', 'assessedIds', 'consideredTotal', 'searchRound']) assert.equal(empty[key], undefined, key);
  assert.deepEqual(empty.warnings, []);
});

test('runs with only application issues or no matches are not retried', () => {
  assert.equal(needsRetry({ status: 'partial', state: { ...initialPipelineState(), jobs: [{ ...job('a', 90), status: 'completed', applicationError: 'Company site' }] } }), false);
  assert.equal(needsRetry({ status: 'completed', state: initialPipelineState() }), false);
});

test('records how a CV was produced when tailoring falls back', async () => {
  const result = await executePipeline(input, initialPipelineState(), dependencies([job('a', 90)], { tailor: async () => ({ rewriteId: 'profile-cv', tailoring: 'profile' }) }));
  assert.equal(result.status, 'completed');
  assert.equal(result.state.jobs[0].rewriteId, 'profile-cv');
  assert.equal(result.state.jobs[0].tailoring, 'profile');
});

test('counter updates replace their previous activity line so early milestones survive the cap', () => {
  const entry = (message, stage = 'finding') => ({ at: 't', stage, message });
  let activity = [entry('Search attempt 1 of 3. Reading your CV and preferences.')];
  for (let read = 1; read <= 200; read += 1) activity = appendActivity(activity, entry(`Read ${read} full job postings from Indeed.`));
  assert.deepEqual(activity.map(item => item.message), ['Search attempt 1 of 3. Reading your CV and preferences.', 'Read 200 full job postings from Indeed.']);
  activity = appendActivity(activity, entry('Tailoring CV 1 of 3: Engineer.', 'tailoring'));
  activity = appendActivity(activity, entry('Tailoring CV 2 of 3: Analyst.', 'tailoring'));
  assert.equal(activity.length, 4, 'different jobs are separate lines');
  for (let index = 0; index < 150; index += 1) activity = appendActivity(activity, entry(`Line ${index % 2 ? 'a' : 'b'}`));
  assert.equal(activity.length, 120);
});
