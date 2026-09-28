import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { config } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { chromium } from 'playwright';
import { target, html, profile, completeAnswers } from './fixture.mjs';
config({ path: '.env.local', quiet: true });
const databaseName = `orch_apply_test_${process.pid}_${Date.now()}`;
let admin, created = false, tables, store, Worker, version;
const workers = [];
const content = { name: 'Alex Example', contactLine: [{ text: 'alex@example.test' }], skills: [], experience: [], education: [], projects: [] };
before(async () => {
  admin = postgres(process.env.DATABASE_URL, { max: 1 });
  await admin`create database ${admin(databaseName)}`; created = true;
  const url = new URL(process.env.DATABASE_URL); url.pathname = `/${databaseName}`; process.env.DATABASE_URL = url.toString(); process.env.NODE_ENV = 'test';
  const migration = postgres(process.env.DATABASE_URL, { max: 1 });
  try { await migrate(drizzle(migration), { migrationsFolder: './drizzle' }); } finally { await migration.end(); }
  tables = await import('../../lib/db/index.ts'); store = await import('../../lib/job-applications/store.ts');
  Worker = (await import('../../lib/job-applications/worker.ts')).ApplicationWorker;
  version = (await import('../../lib/ai/cv-rewrite.ts')).CV_REWRITE_PROMPT_VERSION;
});
after(async () => {
  for (const worker of workers) await worker.stop();
  await globalThis.orchPostgresClient?.end();
  if (created) await admin`drop database ${admin(databaseName)}`;
  await admin?.end();
});
async function seed(promptVersion = version) {
  const { db, cvDocuments, jobPostings, cvRewrites } = tables;
  const [cv] = await db.insert(cvDocuments).values({ originalFilename: 'synthetic.txt', mimeType: 'text/plain', byteSize: 30, storagePath: '/unused', extractionStatus: 'ok', extractedText: 'Alex Example built Python services.' }).returning();
  const [job] = await db.insert(jobPostings).values({ source: 'test', externalId: randomUUID(), fingerprint: randomUUID(), company: 'Example', title: 'Developer', url: target, raw: {} }).returning();
  const [rewrite] = await db.insert(cvRewrites).values({ cvDocumentId: cv.id, jobPostingId: job.id, status: 'completed', provider: 'ollama', model: 'test', promptVersion, content, latex: 'synthetic latex' }).returning();
  return { cv, job, rewrite };
}
async function preparedRun() {
  const row = await seed(); let submissions = 0;
  const worker = new Worker(randomUUID(), { compile: async () => new Uint8Array(Buffer.from('%PDF-1.4 mock')), launch: async () => {
    const browser = await chromium.launch({ headless: true });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      await context.route('**/*', async route => {
        if (route.request().url() !== target) throw new Error('Test tried external network: ' + route.request().url());
        if (route.request().method() === 'POST') { submissions++; return route.fulfill({ contentType: 'text/html', body: '<h1>Thank you for applying!</h1>' }); }
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      return context;
    };
    return browser;
  } });
  workers.push(worker); await worker.heartbeat();
  const id = await store.enqueueApplication(row.rewrite.id, { ...profile, email: `${randomUUID()}@example.test` }, target);
  await worker.tick();
  return { row, id, worker, submissions: () => submissions };
}
test('old rewrites are rejected; duplicate preparation across CV versions shares one application', async () => {
  const old = await seed('old'); await assert.rejects(store.enqueueApplication(old.rewrite.id, profile, target), /Re-tailor/);
  const a = await seed(), b = await seed();
  const ids = await Promise.all([store.enqueueApplication(a.rewrite.id, profile, target), store.enqueueApplication(b.rewrite.id, profile, target)]);
  assert.equal(ids[0], ids[1]);
  const claimed = await Promise.all([store.claimApplication(randomUUID()), store.claimApplication(randomUUID())]);
  assert.equal(claimed.filter(Boolean).length, 1);
  await store.commandApplication(ids[0], 'cancel', 0);
});
test('an automatic run re-queues a previously failed application for the same posting instead of returning the dead row', async () => {
  const { db, jobApplications } = tables;
  const first = await seed();
  const id = await store.enqueueApplication(first.rewrite.id, profile, target, true);
  await db.update(jobApplications).set({ status: 'failed', message: 'Indeed requires a browser verification.', workerId: randomUUID() }).where(eq(jobApplications.id, id));
  const second = await seed();
  assert.equal(await store.enqueueApplication(second.rewrite.id, profile, target, true), id, 'one application per posting and applicant');
  let view = await store.applicationView(id);
  assert.equal(view.status, 'queued'); assert.equal(view.autoApply, true); assert.equal(view.message, null); assert.equal(view.rewriteId, second.rewrite.id, 'the retry uses the newly tailored CV');
  // A failed manual preparation retried automatically becomes automatic; a cancelled one stays cancelled for automatic runs.
  await db.update(jobApplications).set({ status: 'cancelled' }).where(eq(jobApplications.id, id));
  await store.enqueueApplication(second.rewrite.id, profile, target, true);
  assert.equal((await store.applicationView(id)).status, 'cancelled');
  await store.enqueueApplication(second.rewrite.id, profile, target, false);
  view = await store.applicationView(id);
  assert.equal(view.status, 'queued'); assert.equal(view.autoApply, false, 'a manual retry of a cancelled application is manual');
  await store.commandApplication(id, 'cancel', view.revision);
});
test('queue → prepare → answers → explicit review → submit → verified confirmation', async () => {
  const { id, worker, submissions } = await preparedRun();
  let view = await store.applicationView(id);
  assert.equal(view.status, 'needs_input', view.message); assert.equal(submissions(), 0);
  await assert.rejects(store.commandApplication(id, 'submit', view.revision), /required/);
  await assert.rejects(store.commandApplication(id, 'update', view.revision, { nonexistent: 'injected' }), /does not match/);
  const revision = view.revision;
  await store.commandApplication(id, 'update', revision, completeAnswers(view.snapshot)); await worker.tick();
  view = await store.applicationView(id); assert.equal(view.status, 'review', view.message);
  await assert.rejects(store.commandApplication(id, 'submit', revision), /changed/);
  await store.commandApplication(id, 'submit', view.revision);
  await assert.rejects(store.commandApplication(id, 'submit', view.revision), /changed/);
  await worker.tick(); view = await store.applicationView(id);
  assert.equal(view.status, 'submitted', view.message); assert.equal(submissions(), 1); assert.match(view.confirmation, /Thank you/);
  await worker.tick(); assert.equal(submissions(), 1);
});
test('worker death after submission request is uncertain and never requeued', async () => {
  const { id, row, worker } = await preparedRun();
  let view = await store.applicationView(id);
  await store.commandApplication(id, 'update', view.revision, completeAnswers(view.snapshot)); await worker.tick();
  view = await store.applicationView(id); await store.commandApplication(id, 'submit', view.revision);
  await tables.db.update(tables.jobApplications).set({ heartbeatAt: new Date(Date.now() - 90_000) }).where(eq(tables.jobApplications.id, id));
  view = await store.applicationView(id); assert.equal(view.status, 'uncertain');
  const duplicate = await store.enqueueApplication(row.rewrite.id, view.profile, target);
  assert.equal(duplicate, id); assert.equal((await store.applicationView(id)).status, 'uncertain');
});

test('Indeed preparation uses the tailored posting and deduplicates country links including legacy rows', async () => {
  const { createHash } = await import('node:crypto');
  const row = await seed();
  const german = 'https://de.indeed.com/viewjob?jk=6a19fac52b8fdc97';
  const american = german.replace('de.indeed.com', 'www.indeed.com');
  await tables.db.update(tables.jobPostings).set({ url: german, source: 'indeed' }).where(eq(tables.jobPostings.id, row.job.id));
  const applicant = { ...profile, email: `${randomUUID()}@example.test` };
  const first = await store.enqueueApplication(row.rewrite.id, applicant, german);
  assert.equal(await store.enqueueApplication(row.rewrite.id, applicant, american), first);
  // Simulate an existing successful record from the initial Indeed migration.
  const legacyKey = createHash('sha256').update(`${applicant.email}\n${german}`).digest('hex');
  await tables.db.update(tables.jobApplications).set({ status: 'submitted', dedupeKey: legacyKey }).where(eq(tables.jobApplications.id, first));
  assert.equal(await store.enqueueApplication(row.rewrite.id, applicant, american), first);
  await assert.rejects(store.enqueueApplication(row.rewrite.id, applicant, german.replace('6a19fac52b8fdc97', 'aaaaaaaaaaaaaaaa')), /must match/);
});

test('jobs with a submitted or in-progress application are skipped by discovery; failed ones are retried', async () => {
  const { loadAppliedJobs } = await import('../../lib/job-applications/applied.ts');
  const row = await seed();
  const posting = 'https://de.indeed.com/viewjob?jk=abcdef0123456789';
  await tables.db.update(tables.jobPostings).set({ url: posting, source: 'indeed', externalId: 'ABCDEF0123456789' }).where(eq(tables.jobPostings.id, row.job.id));
  const id = await store.enqueueApplication(row.rewrite.id, { ...profile, email: `${randomUUID()}@example.test` }, posting);
  for (const status of ['queued', 'review', 'submitted', 'uncertain']) {
    await tables.db.update(tables.jobApplications).set({ status }).where(eq(tables.jobApplications.id, id));
    const applied = await loadAppliedJobs();
    assert.ok(applied.jobPostingIds.has(row.job.id), status); assert.ok(applied.indeedKeys.has('abcdef0123456789'), status);
  }
  for (const status of ['failed', 'cancelled']) {
    await tables.db.update(tables.jobApplications).set({ status }).where(eq(tables.jobApplications.id, id));
    const applied = await loadAppliedJobs();
    assert.ok(!applied.jobPostingIds.has(row.job.id), status); assert.ok(!applied.indeedKeys.has('abcdef0123456789'), status);
  }
});

test('answer drafting uses the application profile and original CV without modifying the browser answers', async () => {
  const row = await seed();
  const applicant = { ...profile, email: `${randomUUID()}@example.test`, github: 'https://github.com/original-applicant' };
  const id = await store.enqueueApplication(row.rewrite.id, applicant, target);
  const snapshot = { fields: [{ id: 'answer', name: 'answer', label: 'Describe your development experience and share your GitHub', type: 'textarea', value: '', required: true, options: [] }], url: target, title: 'Test form', resume: 'tailored.pdf', notice: '' };
  await tables.db.update(tables.jobApplications).set({ status: 'needs_input', snapshot, heartbeatAt: new Date() }).where(eq(tables.jobApplications.id, id));
  const api = await import('../../app/api/job-applications/[id]/route.ts');
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.sourceCv, row.cv.extractedText);
      assert.equal(input.sourceProfile.github, applicant.github);
      assert.equal(input.sourceProfile.email, applicant.email);
      return Response.json({ done: true, message: { content: JSON.stringify(body.format.properties.supported ? { supported: true, reason: 'Original sources support all claims.' } : { answer: `I built Python services. GitHub: ${applicant.github}`, sourceQuotes: ['Alex Example built Python services.'], profileEvidence: [{ field: 'github', quote: applicant.github }] }) } });
    };
    const response = await api.POST(new Request(`http://localhost:3000/api/job-applications/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', revision: 0, fieldId: 'answer' }) }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.match((await response.json()).answer, /Python/);
    assert.equal(calls, 2);
    const [stored] = await tables.db.select().from(tables.jobApplications).where(eq(tables.jobApplications.id, id));
    assert.equal(stored.status, 'needs_input');
    assert.equal(stored.snapshot.fields[0].value, '');
    assert.equal(stored.answers, null);
  } finally { globalThis.fetch = originalFetch; }
});

async function automaticIndeed({ pause = false, cancelDuringDraft = false, pendingSubmit = false, saveDraft = false, confirmDraft = true, captcha = false, answerFailure = false, manual = false } = {}) {
  const { posting, formOrigin, postingHtml, formHtml, withDraftSaving, profile: indeedProfile } = await import('./indeed-fixture.mjs');
  const { saveIndeedSession } = await import('../../lib/indeed/session.ts');
  const { randomBytes } = await import('node:crypto');
  process.env.ACCOUNT_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  await saveIndeedSession({ cookies: [{ name:'CTK',value:'synthetic-only',domain:'.indeed.com',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:true,sameSite:'Lax' }],origins:[] },'da***@example.test');
  const row=await seed();
  const applicant={...indeedProfile,name:'Daniel Varga',email:`daniel-${randomUUID()}@example.test`};
  const original='Daniel Varga built production services in Go and Python.';
  await tables.db.update(tables.cvDocuments).set({ extractedText:original }).where(eq(tables.cvDocuments.id,row.cv.id));
  await tables.db.update(tables.cvRewrites).set({content:{...content,name:'Daniel Varga',contactLine:[{text:applicant.email}]}}).where(eq(tables.cvRewrites.id,row.rewrite.id));
  await tables.db.update(tables.jobPostings).set({url:posting,source:'indeed'}).where(eq(tables.jobPostings.id,row.job.id));
  // A linked intake supplies sponsorship explicitly; no use of real account details or user CVs.
  const [intake]=await tables.db.insert(tables.applications).values({firstName:'Daniel',lastName:'Varga',email:applicant.email,requiresVisaSponsorship:true,consentGiven:true}).returning();
  await tables.db.update(tables.cvDocuments).set({applicationId:intake.id}).where(eq(tables.cvDocuments.id,row.cv.id));
  let submissions=0,id,testContext,savedDraft,draftSaves=0;
  const worker=new Worker(randomUUID(),{
    compile:async()=>new Uint8Array(Buffer.from('%PDF-1.4 tailored Daniel fixture')),
    generateAnswers:async(fields,sources)=>{
      if (answerFailure) throw new Error('Synthetic answer service unavailable');
      assert.equal(sources.cv,original); assert.equal(sources.facts['profile.email'],applicant.email);
      assert.equal(sources.facts['details.requiresVisaSponsorship'],'true');
      assert.equal(sources.facts['details.willingToRelocate'],undefined,'default false is not treated as an explicit answer');
      if(cancelDuringDraft)await store.commandApplication(id,'cancel',0);
      const answers={};const evidence=[];
      for(const f of fields){
        if(f.value)continue;
        if(f.name==='experience'){answers[f.id]='I built production services in Go and Python.';evidence.push({question:f.label,answer:answers[f.id],sources:[`cv: ${original}`]});}
        if(f.name==='sponsor'&&!pause){answers[f.id]='yes';evidence.push({question:f.label,answer:'Yes',sources:['details.requiresVisaSponsorship: true']});}
      }
      return{answers,evidence};
    },
    launch:async()=>{
      const browser=await chromium.launch({headless:true});const create=browser.newContext.bind(browser);
      browser.newContext=async options=>{
        const context=await create(options);testContext=context;
        await context.route('**/*',route=>{
          const url=new URL(route.request().url());
          if(url.origin===formOrigin&&url.pathname==='/api/draft'){draftSaves++;savedDraft=route.request().postDataJSON();return route.fulfill({status:confirmDraft?200:500,contentType:'application/json',body:'{}'});}
          if(url.origin===formOrigin&&route.request().method()==='POST'){submissions++;return route.fulfill({contentType:'application/json',body:'{}'});}
          if(url.origin===formOrigin&&saveDraft)return route.fulfill({contentType:'text/html',body:withDraftSaving(captcha ? formHtml.replace('<button type="submit">Submit your application</button>', '<div class="g-recaptcha">Verification required</div><button type="submit" disabled>Submit your application</button>') : pendingSubmit ? formHtml.replace('<button type="submit">Submit your application</button>', '<button type="submit" disabled>Submit your application</button>') : formHtml,{confirm:confirmDraft}).replaceAll('alex@example.test',applicant.email)});
          if(url.origin===formOrigin)return route.fulfill({contentType:'text/html',body:(pendingSubmit ? formHtml.replace('<button type=\"submit\">Submit your application</button>', '<button type=\"submit\" disabled>Submit your application</button>') : formHtml).replaceAll('alex@example.test',applicant.email)});
          if(url.origin==='https://de.indeed.com')return route.fulfill({contentType:'text/html',body:postingHtml(true)});
          return route.abort();
        });return context;
      };return browser;
    }
  });
  workers.push(worker);await worker.heartbeat();
  id=await store.enqueueApplication(row.rewrite.id,applicant,posting,!manual);
  await worker.tick();
  return{row,id,worker,submissions:()=>submissions,applicant,posting,context:testContext,draft:()=>savedDraft,draftSaves:()=>draftSaves};
}
test('automatic Indeed run uploads the tailored CV, fills linked details and CV answers, then saves a draft and never submits',async()=>{
  const run=await automaticIndeed({saveDraft:true});let view=await store.applicationView(run.id);
  for(let i=0;i<3&&view.status!=='draft_saved';i++){await run.worker.tick();view=await store.applicationView(run.id);}
  assert.equal(view.status,'draft_saved',view.message);assert.equal(view.autoApply,true);
  assert.match(view.snapshot.resume,/daniel-varga/i);assert.equal(view.answerEvidence.length,2);
  assert.equal(run.draftSaves(),1);assert.equal(run.submissions(),0,'automatic runs leave submitting to the person');
  assert.equal(await store.enqueueApplication(run.row.rewrite.id,run.applicant,run.posting,true),run.id);
  await run.worker.tick();assert.equal(run.submissions(),0);assert.equal(run.draftSaves(),1,'a saved draft is not saved again');
});
test('automatic application stops with a clear failure when missing facts cannot be saved as a draft',async()=>{
  const run=await automaticIndeed({pause:true});let view=await store.applicationView(run.id);
  assert.equal(view.status,'failed',view.message);assert.equal(run.submissions(),0);
  assert.match(view.message,/does not offer Save and close/);
  await run.worker.tick();assert.equal(run.submissions(),0);
});

test('answer-generation errors automatically save a draft without asking for input',async()=>{
  const run=await automaticIndeed({answerFailure:true,saveDraft:true});
  const view=await store.applicationView(run.id);
  assert.equal(view.status,'draft_saved',view.message);assert.equal(run.draftSaves(),1);assert.equal(run.submissions(),0);
});
test('cancelling during AI work prevents filling or submitting; automatic replay cannot restart cancelled applications',async()=>{
  const run=await automaticIndeed({cancelDuringDraft:true});
  assert.equal((await store.applicationView(run.id)).status,'cancelled');assert.equal(run.submissions(),0);
  await store.enqueueApplication(run.row.rewrite.id,run.applicant,run.posting,true);
  assert.equal((await store.applicationView(run.id)).status,'cancelled');await run.worker.tick();assert.equal(run.submissions(),0);
});
test('unlinked CVs do not inherit another applicant’s saved Details',async()=>{
  const row=await seed();
  const {applicationAnswerSources}=await import('../../lib/job-applications/answer-sources.ts');
  const sources=await applicationAnswerSources(row.cv.id,profile);
  assert.equal(Object.keys(sources.facts).some(key=>key.startsWith('details.')),false);
});

test('automatic evidence follows saved improved CVs back to the original upload, excluding added skills',async()=>{
  const row=await seed();
  const [derived]=await tables.db.insert(tables.cvDocuments).values({originalFilename:'improved.md',mimeType:'text/plain',byteSize:50,storagePath:'/unused',extractionStatus:'ok',extractedText:'Alex Example. Kafka expert with 10 years experience.',sourceRewriteId:row.rewrite.id}).returning();
  const {applicationAnswerSources}=await import('../../lib/job-applications/answer-sources.ts');
  const sources=await applicationAnswerSources(derived.id,profile);
  assert.equal(sources.cv,row.cv.extractedText);assert.doesNotMatch(sources.cv,/Kafka|10 years/);
});

test('when the site enables a pending Submit button, the automatic run saves a draft instead of clicking it',async()=>{
  const run=await automaticIndeed({pendingSubmit:true,saveDraft:true});
  let view=await store.applicationView(run.id);assert.equal(view.status,'needs_input',view.message);assert.equal(view.snapshot.submissionBlock,'pending');assert.equal(run.submissions(),0);
  // Simulated site finishing its loading state; no CAPTCHA is clicked or solved.
  const page=run.context.pages().find(p=>p.url().includes('smartapply.indeed.com'));
  await page.getByRole('button',{name:'Submit your application'}).evaluate(button=>{button.disabled=false;});
  for(let i=0;i<3&&view.status!=='draft_saved';i++){await run.worker.tick();view=await store.applicationView(run.id);}
  assert.equal(view.status,'draft_saved',view.message);assert.equal(run.submissions(),0);assert.equal(run.draftSaves(),1);
});
test('generic no-request submission failures cannot trigger an automatic click loop',async()=>{
  const run=await automaticIndeed();
  await tables.db.update(tables.jobApplications).set({status:'review',message:'No submission was sent. Check browser validation.'}).where(eq(tables.jobApplications.id,run.id));
  await run.worker.tick();await run.worker.tick();
  assert.equal((await store.applicationView(run.id)).status,'review');assert.equal(run.submissions(),0);
  await store.commandApplication(run.id,'cancel',0);await run.worker.tick();
});

test('blocked automatic runs save on Indeed, preserve evidence, and deduplicate without counting as submitted',async()=>{
  const run=await automaticIndeed({pause:true,saveDraft:true});
  const view=await store.applicationView(run.id);
  assert.equal(view.status,'draft_saved',view.message);assert.equal(view.snapshot.readyToSubmit,false);
  assert.match(view.snapshot.indeedDraft.evidence,/application has been saved/);
  assert.match(run.draft().resume,/daniel-varga/i);assert.equal(run.draft().answers.experience,'I built production services in Go and Python.');
  assert.equal(view.answerEvidence.length,1);assert.equal(view.confirmation,null);assert.equal(run.submissions(),0);
  assert.equal(await store.enqueueApplication(run.row.rewrite.id,run.applicant,run.posting,true),run.id);
  await assert.rejects(store.commandApplication(run.id,'submit',view.revision),/changed/);
  await run.worker.tick();assert.equal(run.draftSaves(),1);assert.equal(run.submissions(),0);
});
test('unconfirmed remote saves are retained, never retried or submitted automatically',async()=>{
  const run=await automaticIndeed({pause:true,saveDraft:true,confirmDraft:false});
  let view=await store.applicationView(run.id);assert.equal(view.status,'draft_unconfirmed',view.message);
  assert.equal(view.snapshot.indeedDraft,undefined);assert.match(view.snapshot.resume,/daniel-varga/i);
  await run.worker.tick();await run.worker.tick();assert.equal(run.draftSaves(),1);assert.equal(run.submissions(),0);
  await store.enqueueApplication(run.row.rewrite.id,run.applicant,run.posting,true);
  view=await store.applicationView(run.id);assert.equal(view.status,'draft_unconfirmed');
  await assert.rejects(store.commandApplication(run.id,'save_draft',view.revision),/changed/);
});
test('a worker interrupted during a draft save records an unconfirmed save, not a retryable failure',async()=>{
  const run=await automaticIndeed({pendingSubmit:true});const view=await store.applicationView(run.id);
  await store.commandApplication(run.id,'save_draft',view.revision);
  await tables.db.update(tables.jobApplications).set({status:'saving_draft',heartbeatAt:new Date(Date.now()-120000)}).where(eq(tables.jobApplications.id,run.id));
  assert.equal((await store.applicationView(run.id)).status,'draft_unconfirmed');
  assert.equal(run.submissions(),0);
});
test('cancellation during answer generation prevents remote draft saving too',async()=>{
  const run=await automaticIndeed({pause:true,saveDraft:true,cancelDuringDraft:true});
  assert.equal((await store.applicationView(run.id)).status,'cancelled');assert.equal(run.draftSaves(),0);assert.equal(run.submissions(),0);
});

test('a visible CAPTCHA triggers draft saving rather than an application submission',async()=>{
  const run=await automaticIndeed({saveDraft:true,captcha:true});const view=await store.applicationView(run.id);
  assert.equal(view.status,'draft_saved',view.message);assert.equal(run.submissions(),0);assert.equal(run.draftSaves(),1);
});
test('manual save requests use the durable worker boundary and do not submit',async()=>{
  const run=await automaticIndeed({saveDraft:true,manual:true});
  await tables.db.update(tables.jobApplications).set({status:'review',autoApply:false}).where(eq(tables.jobApplications.id,run.id));
  let view=await store.applicationView(run.id);
  await assert.rejects(store.commandApplication(run.id,'save_draft',view.revision+1),/changed/);
  await store.commandApplication(run.id,'save_draft',view.revision);
  assert.equal((await store.applicationView(run.id)).status,'save_requested');assert.equal(run.draftSaves(),0);
  await run.worker.tick();view=await store.applicationView(run.id);
  assert.equal(view.status,'draft_saved',view.message);assert.equal(run.submissions(),0);
});

test('a saved Indeed draft warns when the tailored CV was not confirmed on it', async () => {
  const { draftSavedMessage, DRAFT_SAVED_MESSAGE } = await import('../../lib/job-applications/worker.ts');
  assert.equal(draftSavedMessage({ resume: 'alex-example.pdf' }), DRAFT_SAVED_MESSAGE);
  for (const snapshot of [{ resume: '' }, null, undefined]) assert.match(draftSavedMessage(snapshot), /tailored CV could not be confirmed/);
});
