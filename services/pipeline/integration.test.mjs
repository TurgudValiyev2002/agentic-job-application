import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';

config({ path: '.env.local', quiet: true });
const databaseName = `orch_pipeline_test_${process.pid}_${Date.now()}`;
let admin, temporaryDir, databaseCreated = false;
let store, service, tables, provider, uploadRoute, pipelineRoute;
let sourceOffline = false;
const originalFetch = globalThis.fetch;
const calls = { profiles: 0, scores: 0, rewrites: 0 };
const source = 'Alex Example\nalex@example.test\nSKILLS\nPython, SQL\nEXPERIENCE\nDeveloper, Example Ltd\nBuilt Python services and SQL reports.\nEDUCATION\nExample University, Computer Science';
const content = { name: 'Alex Example', summary: 'Developer building Python services.', contactLine: [{ text: 'alex@example.test' }], skills: [{ category: 'Languages', items: 'Python, SQL' }], experience: [{ jobTitle: 'Developer', company: 'Example Ltd', location: '', dateRange: '', bullets: ['Built Python services and SQL reports.'] }], projects: [], education: [{ school: 'Example University', degree: 'Computer Science', date: '' }] };
const scores = { Alpha: 85, Bravo: 95, Charlie: 75, Delta: 65, Echo: 45 };

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; this test creates a separate temporary database.');
  admin = postgres(process.env.DATABASE_URL, { max: 1 });
  await admin`create database ${admin(databaseName)}`;
  databaseCreated = true;
  const testUrl = new URL(process.env.DATABASE_URL);
  testUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = testUrl.toString();
  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 });
  try { await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle' }); }
  finally { await migrationClient.end(); }
  temporaryDir = await mkdtemp(path.join(tmpdir(), 'orch-pipeline-test-'));
  process.env.CV_UPLOAD_DIR = temporaryDir;
  process.env.AI_PROVIDER = 'ollama';
  process.env.OLLAMA_MODEL = 'pipeline-test';
  process.env.OLLAMA_BASE_URL = 'http://pipeline-model.test';
  process.env.JOB_MATCH_TOP_N = '20';
  process.env.AI_CACHE_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  tables = await import('../../lib/db/index.ts');
  store = await import('../../lib/pipeline/store.ts');
  service = await import('../../lib/pipeline/service.ts');
  provider = (await import('../../lib/ai/provider.ts')).activeAiProvider('ollama');
  uploadRoute = await import('../../app/api/cv/route.ts');
  pipelineRoute = await import('../../app/api/pipeline/route.ts');
  // A synthetic job source stands in for Indeed, which needs a real browser.
  (await import('../../lib/jobs/sources/index.ts')).setTestJobSources([{
    name: 'synthetic', available: () => true,
    async search() {
      if (sourceOffline) throw new Error('Synthetic source offline');
      return Object.keys(scores).map((name, i) => ({ source: 'synthetic', externalId: String(i + 1), company: `Example ${name}`, title: name, location: 'Remote', remote: true, url: `https://jobs.example.test/${name}`, description: 'Build Python services and SQL reports.', postedAt: null, raw: {} }));
    },
  }]);
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.endsWith('/embeddings') || address.endsWith('/api/embed')) throw new Error('Synthetic embedding outage');
    assert.equal(address, 'http://pipeline-model.test/api/chat', 'Only the expected existing agent endpoints may be called');
    const body = JSON.parse(options.body);
    let result;
    if (body.format.properties.decisions) {
      const data = JSON.parse(body.messages[1].content);
      result = { decisions: data.jobs.map(job => ({ id: job.id, careerFit: "aligned", seniorityFit: "compatible", reason: "Plausible software role." })) };
    } else if (body.format.properties.titles) {
      calls.profiles++;
      result = { titles: ['Software Developer', 'Backend Developer'], skills: ['Python', 'SQL'], seniority: 'junior', locations: [], remotePreference: 'remote', keywords: ['Python', 'SQL'] };
    } else if (body.format.properties.requirements) {
      calls.scores++;
      const [liveRun] = await tables.db.select().from(tables.pipelineRuns).where(eq(tables.pipelineRuns.status, 'running')).limit(1);
      const liveResponse = await store.getPipelineRun(liveRun.id);
      assert.equal(liveResponse.state.stage, 'ranking');
      assert.equal(liveResponse.state.live.phase, 'scoring');
      assert.equal(liveResponse.state.scoring.total, 5);
      assert.match(body.messages[1].content, /Alex Example/);
      const title = JSON.parse(body.messages[1].content).job.split('\n')[0];
      assert.ok(title in scores, 'Stale stored jobs must not be scored');
      const statuses = { Alpha: ['met','partial'], Bravo: ['met','met'], Charlie: ['partial','met'], Delta: ['partial','partial'], Echo: ['not_demonstrated','partial'] }[title];
      result = { roleFit: 'aligned', requirements: statuses.map((status, i) => ({ requirement: i ? 'SQL' : 'Python', jobQuote: i ? 'SQL reports' : 'Python services', importance: 'required', status, cvQuote: status === 'not_demonstrated' ? '' : 'Built Python services and SQL reports.', explanation: 'Synthetic evidence assessment.' })) };
    } else if (body.format.properties.summary && !body.format.properties.name) {
      result = { summary: content.summary };
    } else if (body.format.properties.sourceEntries) {
      result = { sourceEntries: [{ section: 'experience', sourceQuote: 'Developer, Example Ltd', outputIndex: 0 }, { section: 'education', sourceQuote: 'Example University, Computer Science', outputIndex: 0 }], claims: [{ path: 'summary', sourceQuote: 'Built Python services and SQL reports.', verdict: 'supported' }, { path: 'experience.0.bullets.0', sourceQuote: 'Built Python services and SQL reports.', verdict: 'supported' }], issues: [] };
    } else {
      calls.rewrites++;
      assert.match(body.messages[1].content, /Alex Example/);
      assert.doesNotMatch(body.messages[1].content, /Different Person/);
      result = content;
    }
    return Response.json({ message: { content: JSON.stringify(result) }, done: true });
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await globalThis.orchPostgresClient?.end();
  if (databaseCreated) await admin`drop database ${admin(databaseName)}`;
  await admin?.end();
  if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true });
});

async function upload(text = source) {
  const body = new FormData();
  body.set('file', new File([text], 'synthetic-cv.txt', { type: 'text/plain' }));
  const response = await uploadRoute.POST(new Request('http://localhost/api/cv', { method: 'POST', body }));
  assert.equal(response.status, 201);
  return response.json();
}

function startRequest(cvDocumentId, requestId = randomUUID()) {
  return new Request('http://localhost/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cvDocumentId, provider: 'ollama', requestId }) });
}

test('upload → existing search and matching agents → exactly three stored tailored CVs', async () => {
  const document = await upload();
  await upload(source.replaceAll('Alex Example', 'Different Person'));
  await tables.db.insert(tables.jobPostings).values({ source: 'old', externalId: 'old', fingerprint: 'old', title: 'Stale job', company: 'Old company', url: 'https://old.example.test', description: 'Python SQL', contentHash: 'old', raw: {} });
  const requestId = randomUUID();
  const queuedResponse = await pipelineRoute.POST(startRequest(document.id, requestId));
  assert.equal(queuedResponse.status, 202);
  const queued = await queuedResponse.json();
  assert.equal(queued.cvDocumentId, document.id);
  assert.equal(queued.status, 'queued');
  assert.equal(await service.processNextPipeline(), true);
  const finished = await store.getPipelineRun(queued.id);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.state.jobs[0].title, 'Bravo');
  assert.deepEqual(finished.state.jobs.map(j => j.title).sort(), ['Alpha', 'Bravo', 'Charlie']);
  assert.equal(finished.results.length, 3);
  assert.deepEqual(finished.state.scoring, { scored: 5, failed: 0, total: 5 });
  assert.ok(finished.state.activity.some(event => event.message.includes('Scored Bravo: 100/100')));
  assert.ok(finished.state.activity.some(event => event.message.includes('Draft received')));
  assert.ok(finished.state.activity.some(event => event.message.includes('Tailored CV ready: Bravo')));
  assert.deepEqual(calls, { profiles: 1, scores: 5, rewrites: 3 });
  assert.match(finished.state.warnings.join(' '), /Keyword ranking/);
  const rows = await tables.db.select().from(tables.cvRewrites);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.cvDocumentId === document.id && row.status === 'completed' && row.latex.includes('Alex Example')));
  const repeated = await pipelineRoute.POST(startRequest(document.id, requestId));
  assert.equal((await repeated.json()).id, queued.id, 'network retries return the same completed run');
});

test('API-selected count survives the worker and tailors more than three jobs',async()=>{
  const document=await upload();const id=randomUUID();
  const request=new Request('http://localhost/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cvDocumentId:document.id,provider:'ollama',requestId:id,maxMatches:5})});
  const response=await pipelineRoute.POST(request);assert.equal(response.status,202);
  assert.equal((await response.json()).state.maxMatches,5);
  assert.equal(await service.processNextPipeline(),true);
  const finished=await store.getPipelineRun(id);assert.equal(finished.status,'completed',finished.error);
  assert.equal(finished.state.maxMatches,5);assert.equal(finished.results.length,4,'only four candidates qualify; never pad the count');
  assert.match(finished.state.warnings.join(' '),/4 of 5 requested/);
});

test('duplicate starts share a run, and concurrent workers cannot claim it twice', async () => {
  const document = await upload();
  const starts = await Promise.all([store.enqueuePipeline(document.id, provider, randomUUID()), store.enqueuePipeline(document.id, provider, randomUUID())]);
  assert.equal(starts[0].id, starts[1].id);
  const claims = await Promise.all([store.claimPipelineRun(), store.claimPipelineRun()]);
  const owned = claims.filter(Boolean);
  assert.equal(owned.length, 1);
  const first = owned[0];
  await tables.db.update(tables.pipelineRuns).set({ leaseExpiresAt: sql`now() - interval '1 second'` }).where(eq(tables.pipelineRuns.id, first.id));
  const recovered = await store.claimPipelineRun();
  assert.equal(recovered.id, first.id);
  assert.notEqual(recovered.leaseOwner, first.leaseOwner);
  await assert.rejects(store.savePipelineState(first.id, first.leaseOwner, first.state), /another worker/);
  await store.savePipelineState(recovered.id, recovered.leaseOwner, recovered.state, { status: 'failed' });
});

test('queue API rejects bad input and unreadable CVs', async () => {
  assert.equal((await pipelineRoute.POST(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }))).status, 400);
  assert.equal((await pipelineRoute.POST(startRequest(randomUUID()))).status, 404);
  const document = await upload();
  await tables.db.update(tables.cvDocuments).set({ extractionStatus: 'failed', extractedText: null }).where(eq(tables.cvDocuments.id, document.id));
  assert.equal((await pipelineRoute.POST(startRequest(document.id))).status, 409);
});


test('source outages are retried with backoff, never tailor old stored jobs, and fail once retries run out', async () => {
  const document = await upload();
  const queued = await store.enqueuePipeline(document.id, provider, randomUUID());
  const beforeRewrites = calls.rewrites;
  sourceOffline = true;
  try {
    await service.processNextPipeline();
    const waiting = await store.getPipelineRun(queued.id);
    assert.equal(waiting.status, 'queued', 'a failed attempt goes back to the queue');
    assert.equal(waiting.retries, 1);
    assert.match(waiting.error, /Job search failed/);
    assert.ok(Date.parse(waiting.retryAt) > Date.now(), 'the retry waits for its backoff');
    assert.match(waiting.state.activity.at(-1).message, /Retry 1 of 5 in 1 min/);
    assert.equal(await store.claimPipelineRun(), null, 'not claimable before retryAt');
    // Due again, with every retry used: this attempt is the last.
    await tables.db.update(tables.pipelineRuns).set({ retryAt: sql`now() - interval '1 second'`, retries: 5 }).where(eq(tables.pipelineRuns.id, queued.id));
    await service.processNextPipeline();
    const failed = await store.getPipelineRun(queued.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /Job search failed.*Gave up after 5 retries/);
    assert.equal(failed.retryAt, null);
    assert.equal(failed.state.jobs.length, 0);
    assert.equal(calls.rewrites, beforeRewrites);
  } finally { sourceOffline = false; }
});

test('a run whose worker died three times is retried like any other failure, and can be stopped', async () => {
  const document = await upload();
  const queued = await store.enqueuePipeline(document.id, provider, randomUUID());
  await tables.db.update(tables.pipelineRuns).set({ attempts: 3 }).where(eq(tables.pipelineRuns.id, queued.id));
  assert.equal(await store.claimPipelineRun(), null);
  const waiting = await store.getPipelineRun(queued.id);
  assert.equal(waiting.status, 'queued');
  assert.equal(waiting.retries, 1);
  assert.match(waiting.error, /interrupted repeatedly/);
  assert.equal(await store.stopRetrying(queued.id), true);
  const stopped = await store.getPipelineRun(queued.id);
  assert.equal(stopped.status, 'failed');
  assert.match(stopped.error, /Retrying stopped by you/);
  assert.equal(await store.stopRetrying(queued.id), false, 'only a waiting retry can be stopped');
});

test('a queued run fails clearly if its configured model changes', async () => {
  const document = await upload();
  const queued = await store.enqueuePipeline(document.id, provider, randomUUID());
  const beforeProfiles = calls.profiles;
  process.env.OLLAMA_MODEL = 'changed-model';
  process.env.PIPELINE_MAX_RETRIES = '0';
  try {
    await service.processNextPipeline();
    const failed = await store.getPipelineRun(queued.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /configured model changed/);
    assert.equal(calls.profiles, beforeProfiles);
  } finally { process.env.OLLAMA_MODEL = provider.model; delete process.env.PIPELINE_MAX_RETRIES; }
});

test('queue preferences survive JSONB persistence and mismatched retries cannot change them',async()=>{
  const document=await upload();
  const preferences={titles:['Backend Developer'],locations:['Vienna'],remotePreference:'remote',seniority:'junior',maxAgeDays:0};
  const id=randomUUID();
  const queued=await store.enqueuePipeline(document.id,provider,id,preferences);
  assert.deepEqual((await store.getPipelineRun(queued.id)).state.preferences,{...preferences,workArrangements:[],seniorities:[]},'stored with the multi-select defaults');
  assert.equal((await store.enqueuePipeline(document.id,provider,id,preferences)).id,id);
  await assert.rejects(store.enqueuePipeline(document.id,provider,id,{...preferences,locations:['Berlin']}),/different/);
  await assert.rejects(store.enqueuePipeline(document.id,provider,randomUUID(),{...preferences,locations:['Berlin']}),/different preferences/);
  await tables.db.update(tables.pipelineRuns).set({status:'failed'}).where(eq(tables.pipelineRuns.id,id));
});

test('the actual pipeline persists native Ollama vectors and evidence-backed scores',async()=>{
  const mock=globalThis.fetch;let embedCalls=0;
  globalThis.fetch=async(url,options)=>{
    if(String(url).endsWith('/api/embed')){embedCalls++;const body=JSON.parse(options.body);assert.equal(body.truncate,false);return Response.json({embeddings:body.input.map(()=>[1,0,0])});}
    return mock(url,options);
  };
  const oldProvider=process.env.EMBEDDING_PROVIDER;process.env.EMBEDDING_PROVIDER='ollama';
  try {
    const document=await upload();const queued=await store.enqueuePipeline(document.id,provider,randomUUID());
    await service.processNextPipeline();
    const finished=await store.getPipelineRun(queued.id);
    assert.equal(finished.status,'completed',finished.error);
    assert.equal(finished.state.matching.ranking,'embedding');assert.ok(embedCalls>0);
    assert.equal(finished.state.jobs.length,3);assert.ok(finished.state.jobs.every(j=>j.suitable&&j.assessment.requirements.length));
    const matches=await tables.db.select().from(tables.jobMatches).where(eq(tables.jobMatches.cvDocumentId,document.id));
    assert.ok(matches.every(match=>match.assessment));
  } finally {globalThis.fetch=mock;if(oldProvider===undefined)delete process.env.EMBEDDING_PROVIDER;else process.env.EMBEDDING_PROVIDER=oldProvider;}
});

test('LLM-rejected careers never reach embeddings or detailed scoring; uncertainty is a fallback', async () => {
  const {matchJobs}=await import('../../lib/jobs/match.ts');
  const document=await upload();
  const names=['Backend Developer','Platform Engineer','Software Engineer','Technical Analyst','Accounts Payable Coordinator','Marketing Associate','Account Executive'];
  const inserted=await tables.db.insert(tables.jobPostings).values(names.map((title,index)=>({source:'synthetic',externalId:randomUUID(),fingerprint:randomUUID(),title,company:`Example ${index}`,url:'https://example.test/job',description:'Build Python services and SQL reports.',raw:{}}))).returning();
  const mock=globalThis.fetch;const oldProvider=process.env.EMBEDDING_PROVIDER;process.env.EMBEDDING_PROVIDER='ollama';
  let mode='mixed';const scored=[],embedded=[];let screeningCalls=0;
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(String(url).endsWith('/api/embed')){embedded.push(...body.input);return Response.json({embeddings:body.input.map(()=>[1,0,0])});}
    if(body.format?.properties.decisions){
      screeningCalls++;const jobs=JSON.parse(body.messages[1].content).jobs;
      const decisions=jobs.map(job=>({id:job.id,careerFit:mode==='reject'?'different':names.slice(0,3).includes(job.title)?'aligned':job.title==='Technical Analyst'?'adjacent':'different',seniorityFit:'compatible',reason:'Model relevance decision.'}));
      return Response.json({message:{content:JSON.stringify({decisions:mode==='invalid'?[]:decisions})}});
    }
    if(body.format?.properties.requirements){
      const title=JSON.parse(body.messages[1].content).job.split('\n')[0];scored.push(title);
      return Response.json({message:{content:JSON.stringify({roleFit:'aligned',requirements:[{requirement:'Python services',jobQuote:'Build Python services',importance:'required',status:'met',cvQuote:'Built Python services',explanation:'Direct experience.'}]})}});
    }
    return mock(url,options);
  };
  try{
    const options={provider:'ollama',jobPostingIds:inserted.map(job=>job.id)};
    const result=await matchJobs(document.id,options);
    assert.equal(screeningCalls,1);assert.equal(result.screening.irrelevant,3);assert.equal(result.screening.uncertain,1);
    assert.deepEqual([...scored].sort(),names.slice(0,3).sort(),'uncertain job is not scored when relevant jobs suffice');
    assert.ok(embedded.every(text=>!names.slice(4).some(name=>text.includes(name))),'rejected jobs are never embedded');
    assert.equal(result.considered,3);assert.equal(result.processedIds.length,6);
    scored.length=0;
    await matchJobs(document.id,{...options,excludeIds:[inserted[2].id]});
    assert.equal(scored.at(-1),'Technical Analyst','uncertainty is considered after relevant jobs are insufficient');
    assert.equal(scored.length,3);
    mode='reject';scored.length=0;embedded.length=0;
    const none=await matchJobs(document.id,options);
    assert.equal(none.considered,0);assert.equal(none.screening.irrelevant,7);assert.equal(scored.length,0);assert.equal(embedded.length,0);
    mode='invalid';await assert.rejects(matchJobs(document.id,options),/invalid batch/);assert.equal(scored.length,0);
  }finally{globalThis.fetch=mock;if(oldProvider===undefined)delete process.env.EMBEDDING_PROVIDER;else process.env.EMBEDDING_PROVIDER=oldProvider;}
});

test('application mode is persisted and cannot be upgraded by replaying an existing run', async () => {
  const document = await upload();
  const id = randomUUID();
  const queued = await store.enqueuePipeline(document.id, provider, id, undefined, false);
  assert.equal(queued.state.autoApply, false);
  await assert.rejects(store.enqueuePipeline(document.id, provider, id, undefined, true), /different/);
  await assert.rejects(store.enqueuePipeline(document.id, provider, randomUUID(), undefined, true), /different/);
});
test('pipeline rejects cross-origin automatic submissions and requires a saved Indeed account', async () => {
  const document = await upload();
  const request = (origin) => new Request('http://localhost/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ cvDocumentId: document.id, provider: 'ollama', requestId: randomUUID(), autoApply: true }) });
  assert.equal((await pipelineRoute.POST(request('https://untrusted.test'))).status, 403);
  const response = await pipelineRoute.POST(request('http://localhost'));
  assert.equal(response.status, 409); assert.match((await response.json()).error, /Sign in to Indeed/);
});

test('match limits are persisted, validated and protected against changed retries',async()=>{
  const document=await upload();const id=randomUUID();
  const queued=await store.enqueuePipeline(document.id,provider,id,undefined,false,10);
  assert.equal((await store.getPipelineRun(queued.id)).state.maxMatches,10);
  assert.equal((await store.enqueuePipeline(document.id,provider,id,undefined,false,10)).id,id);
  await assert.rejects(store.enqueuePipeline(document.id,provider,id,undefined,false,20),/different/);
  await assert.rejects(store.enqueuePipeline(document.id,provider,randomUUID(),undefined,false,5),/different preferences/);
  for(const maxMatches of [0,-1,21,2.5,'5',null]){
    const response=await pipelineRoute.POST(new Request('http://localhost/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cvDocumentId:document.id,provider:'ollama',requestId:randomUUID(),maxMatches})}));
    assert.equal(response.status,400,JSON.stringify(maxMatches));
  }
  const legacyDocument=await upload();const legacy=await store.enqueuePipeline(legacyDocument.id,provider,randomUUID());
  assert.equal(legacy.state.maxMatches,3);
  const legacyState={...legacy.state};delete legacyState.maxMatches;
  await tables.db.update(tables.pipelineRuns).set({state:legacyState}).where(eq(tables.pipelineRuns.id,legacy.id));
  assert.equal((await store.enqueuePipeline(legacyDocument.id,provider,legacy.id,undefined,false,3)).id,legacy.id);
  await assert.rejects(store.enqueuePipeline(legacyDocument.id,provider,legacy.id,undefined,false,5),/different/);
});

test('named profiles share identity, become reviewed picker choices, and own authoritative applicant details', async () => {
  const { applicationSchema } = await import('../../lib/validation/application.ts');
  const { persistApplication } = await import('../../lib/db/application-write.ts');
  const { getApplication, getSelectedApplication, listProfiles } = await import('../../lib/db/queries.ts');
  const { processNextProfileJob, claimProfileJob } = await import('../../lib/cv/profile-jobs.ts');
  const { changeProfile } = await import('../../lib/db/profile-write.ts');
  const { bootstrap } = await import('../../lib/job-applications/store.ts');
  const { renderCvToLatex } = await import('../../lib/latex/render-cv.ts');
  const { CV_REWRITE_PROMPT_VERSION } = await import('../../lib/ai/cv-rewrite.ts');
  const payload = (name, email, extra = {}) => applicationSchema.parse({ name, firstName: 'Alex', lastName: 'Example', email, phone: '123456', city: 'Vienna', country: 'Austria', currentEmployer: name, consentGiven: true,
    summary: content.summary, education: [{ institution: 'Example University', degree: 'Computer Science' }],
    experience: [{ company: 'Example Ltd', jobTitle: 'Developer', description: 'Built Python services and SQL reports.' }], skills: [{ name: 'Python' }, { name: 'SQL' }], ...extra });
  const first = await persistApplication(payload('Backend', 'old@example.test', { targetRole: 'Backend developer' }));
  const second = await persistApplication(payload('AI researcher', 'alex@example.test', { phone: '' }));
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  const a = await getApplication(first.applicationId), b = await getApplication(second.applicationId);
  assert.equal(a.email, 'alex@example.test'); assert.equal(a.phone, null); assert.equal(b.phone, null);
  assert.equal(a.currentEmployer, 'Backend'); assert.equal(b.currentEmployer, 'AI researcher');
  assert.equal((await getSelectedApplication()).id, a.id);
  assert.notEqual(a.experience[0].id, b.experience[0].id);
  const selectRoute = await import('../../app/api/profiles/[id]/select/route.ts');
  const selectRequest = () => new Request('http://localhost/api/profiles/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await selectRoute.POST(selectRequest(), { params: Promise.resolve({ id: b.id }) })).status, 409, 'generating profiles cannot be selected');

  let rewriteCalls = 0, reviewCalls = 0;
  const fake = { providerName: 'ollama', model: 'profile-test', requestStructuredCompletion: async input => {
    let result;
    if (input.schemaName === 'cv_review') {
      reviewCalls++;
      result = { overallScore: 88, summary: 'Clear evidence.', strengths: ['Concrete experience'], weaknesses: [], suggestions: [] };
    } else if (input.schemaName === 'cv_rewrite_audit') {
      result = { sourceEntries: [{ section: 'experience', sourceQuote: 'Developer — Example Ltd', outputIndex: 0 }, { section: 'education', sourceQuote: 'Computer Science, Example University', outputIndex: 0 }], claims: [{ path: 'summary', sourceQuote: 'Built Python services and SQL reports.', verdict: 'supported' }, { path: 'experience.0.bullets.0', sourceQuote: 'Built Python services and SQL reports.', verdict: 'supported' }], issues: [] };
    } else {
      rewriteCalls++; assert.match(input.messages[1].content, /Target role: Backend developer/); result = content;
    }
    return { ok: true, content: JSON.stringify(result), model: 'profile-test', rawResponse: {}, durationMs: 1 };
  } };
  while (await processNextProfileJob({ provider: () => fake })) { /* Drain only this isolated database. */ }
  const profiles = await listProfiles();
  assert.equal(profiles.length, 2); assert.ok(profiles.every(p => p.cvStatus === 'ready' && p.overallScore === 88 && p.cvReviewId && p.cvDocumentId));
  assert.equal(profiles.find(p => p.id === a.id).cvError, null, 'the real rewrite validation and audit passed');
  assert.equal(reviewCalls, 2); assert.equal(rewriteCalls, 1);
  assert.equal((await selectRoute.POST(selectRequest(), { params: Promise.resolve({ id: b.id }) })).status, 200);
  assert.equal((await getSelectedApplication()).id, b.id);
  const selected = (await listProfiles())[0]; assert.equal(selected.id, b.id);
  const queuedResponse = await pipelineRoute.POST(new Request('http://localhost/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cvDocumentId: selected.cvDocumentId, profileId: b.id, provider: 'ollama', requestId: randomUUID() }) }));
  assert.equal(queuedResponse.status, 202); const queued = await queuedResponse.json();
  assert.equal(queued.state.profileId, b.id); assert.equal(queued.state.profileName, 'AI researcher');
  const [job] = await tables.db.insert(tables.jobPostings).values({ source: 'profile-test', externalId: randomUUID(), fingerprint: randomUUID(), title: 'Researcher', company: 'Example', url: 'https://jobs.lever.co/example/123', raw: {} }).returning();
  const [tailored] = await tables.db.insert(tables.cvRewrites).values({ cvDocumentId: selected.cvDocumentId, jobPostingId: job.id, status: 'completed', provider: 'none', model: 'test', promptVersion: CV_REWRITE_PROMPT_VERSION, content, latex: renderCvToLatex(content) }).returning();
  await tables.db.insert(tables.applicantProfiles).values({ cvDocumentId: selected.cvDocumentId, profile: { name: 'Stale Person', email: 'stale@example.test', phone: '999', location: 'Elsewhere', currentCompany: 'Stale employer', linkedin: 'https://stale.test', github: '', portfolio: '' } });
  const boot = await bootstrap(tailored.id);
  assert.equal(boot.profile.name, 'Alex Example'); assert.equal(boot.profile.email, 'alex@example.test');
  assert.equal(boot.profile.phone, ''); assert.equal(boot.profile.location, 'Vienna, Austria');
  assert.equal(boot.profile.currentCompany, 'AI researcher'); assert.equal(boot.profile.linkedin, '');
  await assert.rejects(changeProfile(b.id, 'archive'), /Select another/);

  // Real database claims exclude fresh work and atomically reclaim stale work.
  await tables.db.update(tables.applications).set({ cvStatus: 'improving', jobStartedAt: new Date() }).where(eq(tables.applications.id, a.id));
  assert.equal(await claimProfileJob(), null);
  await tables.db.update(tables.applications).set({ jobStartedAt: sql`now() - interval '31 minutes'` }).where(eq(tables.applications.id, a.id));
  const claims = await Promise.all([claimProfileJob(), claimProfileJob()]);
  assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean).id, a.id);
  await tables.db.update(tables.applications).set({ jobStartedAt: sql`now() - interval '31 minutes'` }).where(eq(tables.applications.id, a.id));
  assert.equal(await processNextProfileJob({ provider: () => fake }), true);
  assert.equal((await getApplication(a.id)).cvStatus, 'ready');

  // Multipart replacement enters review only and retains its uploaded document.
  const uploadProfile = await import('../../app/api/profiles/[id]/cv/route.ts');
  const body = new FormData(); body.set('file', new File([source], 'replacement.txt', { type: 'text/plain' }));
  const forbidden = await uploadProfile.POST(new Request('http://localhost/api/profiles/cv', { method: 'POST', body, headers: { origin: 'https://elsewhere.test' } }), { params: Promise.resolve({ id: b.id }) });
  assert.equal(forbidden.status, 403);
  const uploaded = await uploadProfile.POST(new Request('http://localhost/api/profiles/cv', { method: 'POST', body }), { params: Promise.resolve({ id: b.id }) });
  assert.equal(uploaded.status, 201); const replacement = await uploaded.json();
  assert.equal((await getApplication(b.id)).cvStatus, 'reviewing');
  const beforeRewrites = rewriteCalls;
  await processNextProfileJob({ provider: () => fake });
  assert.equal((await getApplication(b.id)).cvDocumentId, replacement.id); assert.equal(rewriteCalls, beforeRewrites);
  assert.equal((await getApplication(b.id)).cvStatus, 'ready');
  // A model rejection keeps the generated document and still stores its successful review.
  await changeProfile(a.id, 'retry');
  const rejection = { ...fake, requestStructuredCompletion: input => input.schemaName === 'cv_review' ? fake.requestStructuredCompletion(input) : Promise.resolve({ ok: false, kind: 'timeout', message: 'Synthetic rewrite timeout', model: 'profile-test', durationMs: 1 }) };
  await processNextProfileJob({ provider: () => rejection });
  const warned = await getApplication(a.id);
  assert.equal(warned.cvStatus, 'ready'); assert.match(warned.cvError, /^Improvement skipped: Synthetic rewrite timeout/);
  const [plain] = await tables.db.select().from(tables.cvDocuments).where(eq(tables.cvDocuments.id, warned.cvDocumentId));
  const [plainRewrite] = await tables.db.select().from(tables.cvRewrites).where(eq(tables.cvRewrites.id, plain.sourceRewriteId));
  assert.equal(plainRewrite.model, 'details');
  await changeProfile(b.id, 'retry');
  await processNextProfileJob({ provider: () => ({ ...fake, requestStructuredCompletion: async () => ({ ok: false, kind: 'timeout', message: 'Synthetic review timeout', model: 'profile-test', durationMs: 1 }) }) });
  assert.equal((await getApplication(b.id)).cvStatus, 'failed'); assert.equal((await getApplication(b.id)).cvError, 'Synthetic review timeout');
  await changeProfile(b.id, 'retry'); await processNextProfileJob({ provider: () => fake });
  await changeProfile(a.id, 'archive');
  assert.equal((await listProfiles()).length, 1); assert.equal((await listProfiles(true)).length, 2);
});

test('the saved daily run starts once per 24 hours, waits for active runs, and explains when it cannot start', async () => {
  const schedule = await import('../../lib/pipeline/schedule.ts');
  const scheduleRoute = await import('../../app/api/pipeline/schedule/route.ts');
  // Nothing else may be active in this database, or the daily run (correctly) waits for it.
  await tables.db.update(tables.pipelineRuns).set({ status: 'failed', retryAt: null }).where(sql`${tables.pipelineRuns.status} in ('queued', 'running')`);
  const document = await upload();
  const [profile] = await tables.db.insert(tables.applications).values({ name: 'Daily profile', firstName: 'Alex', lastName: 'Example', email: 'alex@example.test', consentGiven: true, cvStatus: 'generating' }).returning();
  const put = (body) => scheduleRoute.PUT(new Request('http://localhost/api/pipeline/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const settings = { profileId: profile.id, provider: 'ollama', autoApply: false, maxMatches: 5, preferences: { titles: ['Backend Developer'], locations: [], remotePreference: 'any', seniority: 'any', maxAgeDays: 1 } };
  assert.equal((await put({ ...settings, profileId: randomUUID() })).status, 404);
  assert.equal((await put(settings)).status, 200);

  // Not ready yet: nothing starts, and the reason is recorded for the card.
  assert.equal(await schedule.startDueScheduledRun(), null);
  assert.match((await schedule.getSchedule()).lastMessage, /Daily profile is not ready/);

  await tables.db.update(tables.applications).set({ cvStatus: 'ready', cvDocumentId: document.id }).where(eq(tables.applications.id, profile.id));
  const [first, second] = await Promise.all([schedule.startDueScheduledRun(), schedule.startDueScheduledRun()]);
  const runId = first ?? second;
  assert.ok(runId); assert.ok(!(first && second), 'two workers cannot both start it');
  const run = await store.getPipelineRun(runId);
  assert.equal(run.status, 'queued'); assert.equal(run.state.scheduled, true);
  assert.equal(run.state.profileId, profile.id); assert.equal(run.state.maxMatches, 5); assert.equal(run.state.autoApply, false);
  assert.deepEqual(run.state.preferences.titles, ['Backend Developer']); assert.equal(run.state.preferences.maxAgeDays, 1);
  let view = await schedule.getSchedule();
  assert.equal(view.lastRunId, runId); assert.equal(view.lastMessage, null);
  assert.ok(Date.parse(view.nextRunAt) - Date.parse(view.lastRunAt) === 24 * 60 * 60 * 1000);

  // Within 24 hours nothing more starts, even once the run has finished.
  await tables.db.update(tables.pipelineRuns).set({ status: 'completed' }).where(eq(tables.pipelineRuns.id, runId));
  assert.equal(await schedule.startDueScheduledRun(), null);

  // Due again, but another run is active: the daily run waits for it.
  await tables.db.update(tables.pipelineSchedules).set({ lastRunAt: sql`now() - interval '25 hours'` });
  const manual = await store.enqueuePipeline(document.id, provider, randomUUID());
  assert.equal(await schedule.startDueScheduledRun(), null);
  await tables.db.update(tables.pipelineRuns).set({ status: 'completed' }).where(eq(tables.pipelineRuns.id, manual.id));

  // Turned off: never starts. Turned back on: starts, and an edit keeps the schedule's rhythm.
  const patch = (enabled) => scheduleRoute.PATCH(new Request('http://localhost/api/pipeline/schedule', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }));
  assert.equal((await patch(false)).status, 200);
  assert.equal(await schedule.startDueScheduledRun(), null);
  assert.equal((await schedule.getSchedule()).nextRunAt, null);
  assert.equal((await patch(true)).status, 200);
  const next = await schedule.startDueScheduledRun();
  assert.ok(next && next !== runId);
  await tables.db.update(tables.pipelineRuns).set({ status: 'completed' }).where(eq(tables.pipelineRuns.id, next));
  assert.equal((await put({ ...settings, maxMatches: 3 })).status, 200);
  view = await schedule.getSchedule();
  assert.equal(view.maxMatches, 3); assert.equal(view.lastRunId, next, 'saving an edit does not start another run');
  assert.equal(await schedule.startDueScheduledRun(), null);
});

test('saved model connections: keys stay encrypted and private, the first is the default, and requests and embeddings follow them', async () => {
  const { randomBytes } = await import('node:crypto');
  process.env.ACCOUNT_CREDENTIALS_KEY ||= randomBytes(32).toString('base64');
  const providers = await import('../../lib/ai/provider.ts');
  const { resolveEmbeddingConfig } = await import('../../lib/ai/embeddings.ts');
  const route = await import('../../app/api/model-connections/route.ts');
  const byId = await import('../../app/api/model-connections/[id]/route.ts');
  const key = 'sk-test-' + randomBytes(12).toString('hex');
  const post = (body) => route.POST(new Request('http://localhost/api/model-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

  assert.equal((await post({ name: 'Gateway', kind: 'openai', baseUrl: 'https://gateway.test/v1', model: 'gpt-test', timeoutSeconds: 30 })).status, 400, 'a platform needs a key');
  const created = await post({ name: 'Gateway', kind: 'custom', baseUrl: 'https://gateway.test/v1/', apiKey: key, model: 'gpt-test', timeoutSeconds: 30 });
  assert.equal(created.status, 201);
  const { connection } = await created.json();
  assert.equal(connection.isDefault, true, 'the first saved connection becomes the default');
  assert.equal(connection.keyHint, key.slice(-4));
  assert.equal(connection.baseUrl, 'https://gateway.test/v1');

  // The key never leaves the server and is not stored in plain text.
  const listed = await (await route.GET(new Request('http://localhost/api/model-connections'))).text();
  assert.ok(!listed.includes(key));
  const [row] = await tables.db.select().from(tables.modelConnections).where(eq(tables.modelConnections.id, connection.id));
  assert.ok(row.encryptedApiKey && !row.encryptedApiKey.includes(key));

  // Pickers switch to saved connections; the default drives background work; legacy .env ids still resolve.
  assert.deepEqual((await providers.selectableAiProviders()).map((p) => p.name), [connection.id]);
  assert.equal(await providers.defaultProviderId(), connection.id);
  assert.equal((await providers.resolveAiProvider('ollama')).providerName, 'ollama');

  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://gateway.test/v1/chat/completions') {
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      assert.equal(JSON.parse(options.body).model, 'gpt-test');
      return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] });
    }
    return priorFetch(url, options);
  };
  try {
    const provider = await providers.resolveAiProvider();
    assert.equal(provider.label, 'Gateway');
    const result = await provider.requestStructuredCompletion({ schemaName: 't', jsonSchema: { type: 'object' }, messages: [{ role: 'user', content: 'x' }] });
    assert.equal(result.ok, true, result.message);
  } finally { globalThis.fetch = priorFetch; }

  // An edit with an empty key keeps it; marking embeddings routes them to this connection.
  const put = await byId.PUT(new Request(`http://localhost/api/model-connections/${connection.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Gateway', kind: 'custom', baseUrl: 'https://gateway.test/v1', apiKey: '', model: 'gpt-test-2', timeoutSeconds: 30, isDefault: true, embeddingModel: 'embed-test' }) }), { params: Promise.resolve({ id: connection.id }) });
  assert.equal(put.status, 200);
  const embedding = await resolveEmbeddingConfig();
  assert.deepEqual([embedding.baseUrl, embedding.model, embedding.native, embedding.apiKey], ['https://gateway.test/v1', 'embed-test', false, key]);

  // Deleting it falls back to the .env providers; runs that named it get a clear error.
  const removed = await byId.DELETE(new Request(`http://localhost/api/model-connections/${connection.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }), { params: Promise.resolve({ id: connection.id }) });
  assert.equal(removed.status, 204);
  assert.ok((await providers.selectableAiProviders()).some((p) => p.name === 'ollama'));
  await assert.rejects(providers.resolveAiProvider(connection.id), /no longer exists/);
});
