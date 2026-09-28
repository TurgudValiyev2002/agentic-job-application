import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { rewriteCv } from './cv-rewrite.ts';
import { cvContentSchema } from '../cv/content.ts';

const source = 'Alex Example\nalex@example.test\nSKILLS\nPython\nEXPERIENCE\nDeveloper, Example Ltd\nBuilt Python services.\nEDUCATION\nExample University, Computer Science';
const content = {
  name: 'Alex Example', summary: 'Developer building Python services.',
  contactLine: [{ text: 'alex@example.test' }], skills: [{ category: 'Languages', items: 'Python' }],
  experience: [{ jobTitle: 'Developer', company: 'Example Ltd', location: '', dateRange: '', bullets: ['Built Python services.'] }],
  projects: [], education: [{ school: 'Example University', degree: 'Computer Science', date: '' }],
};
const job = { title: 'Python Developer', company: 'Another Ltd', location: 'Vienna', description: 'Build Python services. AWS preferred.', missing: ['AWS'] };
const success = (value) => ({ ok: true, content: JSON.stringify(value), model: 'test', rawResponse: {}, durationMs: 10 });
const audit = {
  sourceEntries: [
    { section: 'experience', sourceQuote: 'Developer, Example Ltd', outputIndex: 0 },
    { section: 'education', sourceQuote: 'Example University, Computer Science', outputIndex: 0 },
  ],
  claims: [
    { path: 'summary', sourceQuote: 'Built Python services.', verdict: 'supported' },
    { path: 'experience.0.bullets.0', sourceQuote: 'Built Python services.', verdict: 'supported' },
  ], issues: [],
};
const provider = (request) => ({ providerName: 'ollama', model: 'test', requestStructuredCompletion: input => input.schemaName === 'cv_rewrite_audit' ? Promise.resolve(success(audit)) : input.schemaName === 'cv_target_summary' ? Promise.resolve(success({summary:content.summary})) : request(input) });
const maxChars = process.env.CV_REWRITE_MAX_CHARS;
afterEach(() => { if (maxChars === undefined) delete process.env.CV_REWRITE_MAX_CHARS; else process.env.CV_REWRITE_MAX_CHARS = maxChars; });

test('a malformed audit re-checks the same draft instead of regenerating the CV', async () => {
  const numbered={sourceEntries:[{section:'experience',sourcePassageIds:[6],outputIndex:0},{section:'education',sourcePassageIds:[9],outputIndex:0}],
    claims:[{path:'summary',sourcePassageIds:[7],verdict:'supported',explanation:''},{path:'experience.0.bullets.0',sourcePassageIds:[7],verdict:'supported',explanation:''}],issues:[]};
  let generations=0,audits=0;
  const flaky={providerName:'ollama',model:'test',requestStructuredCompletion:input=>{
    if(input.schemaName==='cv_rewrite_audit'){audits++;return Promise.resolve(success(audits===1?{...numbered,sourceEntries:[{...numbered.sourceEntries[0],sourcePassageIds:[999]},numbered.sourceEntries[1]]}:numbered));}
    if(input.schemaName==='cv_target_summary')return Promise.resolve(success({summary:content.summary}));
    generations++;return Promise.resolve(success(content));
  }};
  const result=await rewriteCv(source,null,flaky,job);
  assert.equal(result.ok,true,result.message);
  assert.equal(generations,1,'the draft was fine; only the audit is repeated');assert.equal(audits,2);
  assert.equal(result.rawResponse.audit.sourceEntries[0].sourceQuote,'Developer, Example Ltd');
  const broken={...flaky,requestStructuredCompletion:input=>input.schemaName==='cv_rewrite_audit'?Promise.resolve(success({sourceEntries:[],claims:[],issues:['Invented employer.']})):flaky.requestStructuredCompletion(input)};
  const rejected=await rewriteCv(source,null,broken,job);
  assert.equal(rejected.ok,false);assert.match(rejected.message,/Invented employer/);assert.match(rejected.rawResponse.audit,/Invented employer/,'the failed audit is kept for inspection');
});

test('accepts missing dates and location without inventing placeholders', async () => {
  assert.equal(cvContentSchema.safeParse(content).success, true);
  const result = await rewriteCv(source, null, provider(async () => success(content)), job);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.rewrite.experience[0].location, '');
});

test('job-supported additions go directly to Skills without becoming prior experience or summary claims', async () => {
  const added={...content,skills:[{category:'Languages and tools',items:'Python, AWS'}],addedSkills:[{skill:'AWS',jobQuote:'AWS preferred.',reason:'Cloud tooling is adjacent to backend services.'}]};
  const result=await rewriteCv(source,null,provider(async()=>success(added)),job);
  assert.equal(result.ok,true,result.message);assert.equal(result.rewrite.addedSkills[0].skill,'AWS');assert.match(result.rewrite.skills[0].items,/AWS/);
  for(const invalid of [
    {...added,summary:'Developer with AWS experience.'},
    {...added,experience:[{...content.experience[0],bullets:['Built Python services using AWS.']}]},
    {...added,addedSkills:[{...added.addedSkills[0],jobQuote:'Invented job requirement'}]},
    {...added,addedSkills:[{...added.addedSkills[0],skill:'AWS, Kafka'}]},
  ]) assert.equal((await rewriteCv(source,null,provider(async()=>success(invalid)),job)).ok,false);
  assert.equal((await rewriteCv(source,null,provider(async()=>success(added)))).ok,false,'General rewrites cannot add job skills');
});

test('normalizes grouped additions, duplicates and proficiency labels without claiming experience', async () => {
  const draft={...content,skills:[{category:'Tools',items:'Python, Advanced SQL, Redis, SQL'}],addedSkills:[
    {skill:'Advanced SQL, Redis',jobQuote:'Advanced SQL, Redis and Linux preferred.',reason:'Adjacent backend tools.'},
    {skill:'SQL',jobQuote:'Advanced SQL, Redis and Linux preferred.',reason:'Relational data.'},
  ]};
  let generations=0;
  const result=await rewriteCv(source,null,provider(async()=>{generations++;return success(draft);}),{...job,description:'Advanced SQL, Redis and Linux preferred.'});
  assert.equal(result.ok,true,result.message);
  assert.equal(generations,1,'Formatting should not require a complete LLM retry');
  assert.deepEqual(result.rewrite.addedSkills.map(item=>item.skill),['SQL','Redis']);
  assert.equal(result.rewrite.skills[0].items,'Python, SQL, Redis');
  assert.equal(result.rewrite.summary,content.summary);
  assert.deepEqual(result.rewrite.experience,content.experience);
});

test('normalization preserves the three-skill cap and rejects credentials or absent posting evidence', async () => {
  for (const [names,quote] of [
    ['SQL, Redis, Linux, AWS','SQL, Redis, Linux, AWS preferred.'],
    ['AWS certification','AWS certification preferred.'],
    ['SQL','Linux preferred.'],
  ]) {
    const draft={...content,skills:[{category:'Tools',items:`Python, ${names}`}],addedSkills:[{skill:names,jobQuote:quote,reason:'Relevant.'}]};
    const result=await rewriteCv(source,null,provider(async()=>success(draft)),{...job,description:quote});
    assert.equal(result.ok,false,names);
  }
});

test('source audit sees original skills while job-supported additions remain in the saved CV', async () => {
  const draft={...content,skills:[{category:'Tools',items:'Python, AWS'}],addedSkills:[{skill:'AWS',jobQuote:'AWS preferred.',reason:'Relevant cloud tooling.'}]};
  let audited=false;
  const model={providerName:'ollama',model:'test',requestStructuredCompletion:async input=>{
    if(input.schemaName==='cv_rewrite')return success(draft);
    if(input.schemaName==='cv_target_summary')return success({summary:content.summary});
    audited=true;const data=JSON.parse(input.messages[1].content);
    assert.equal(data.draft.skills[0].items,'Python');assert.ok(data.sourcePassages.length);
    assert.equal(data.draft.summary,content.summary);assert.deepEqual(data.draft.experience,content.experience);
    return success(audit);
  }};
  const result=await rewriteCv(source,null,model,job);
  assert.equal(audited,true);assert.equal(result.ok,true,result.message);assert.equal(result.rewrite.skills[0].items,'Python, AWS');
});

test('repairs unsupported qualifications once using validation feedback', async () => {
  let calls = 0;
  const result = await rewriteCv(source, null, provider(async (input) => {
    calls++;
    if (calls === 1) return success({ ...content, skills: [{ category: 'Languages', items: 'Python, AWS' }] });
    assert.match(input.messages[1].content, /previous attempt failed validation/);
    assert.match(input.messages[1].content, /AWS/);
    return success(content);
  }), job);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls, 2);
  assert.equal(result.durationMs, 40);
});

test('rejects output still invalid after the bounded retry', async () => {
  let calls = 0;
  const result = await rewriteCv(source, null, provider(async () => { calls++; return success({ ...content, name: 'Invented Person' }); }), job);
  assert.equal(result.ok, false);
  assert.equal(calls, 2);
});

test('does not retry provider failures', async () => {
  let calls = 0;
  const result = await rewriteCv(source, null, provider(async () => { calls++; return { ok: false, kind: 'timeout', message: 'timed out', model: 'test', durationMs: 10 }; }), job);
  assert.equal(result.kind, 'timeout');
  assert.equal(calls, 1);
});

test('refuses to silently truncate source sections', async () => {
  process.env.CV_REWRITE_MAX_CHARS = '20';
  const result = await rewriteCv(source, null, provider(async () => { assert.fail('must not call model with truncated CV'); }), job);
  assert.equal(result.ok, false);
  assert.equal(result.truncated, true);
  assert.match(result.message, /CV_REWRITE_MAX_CHARS/);
});


test('reports validation and repair milestones during a rewrite', async () => {
  let calls = 0;
  const phases = [];
  const result = await rewriteCv(source, null, provider(async () => {
    calls++;
    return success(calls === 1 ? { ...content, name: 'Invented Person' } : content);
  }), job, async progress => { phases.push(progress.phase); });
  assert.equal(result.ok, true);
  assert.deepEqual(phases, ['validating', 'repairing', 'validating', 'rewriting']);
});

test('target-role focus reaches both rewrite attempts without weakening source validation', async () => {
  let attempts = 0;
  const result = await rewriteCv(source, null, provider(async input => {
    attempts++;
    assert.match(input.messages[1].content, /Target role: AI researcher/);
    assert.match(input.messages[1].content, /never add technologies, employers, credentials or results the source does not state/);
    return success(attempts === 1 ? { ...content, contactLine: [{ text: 'invented@example.test' }] } : content);
  }), undefined, undefined, 'AI researcher');
  assert.equal(attempts, 2); assert.equal(result.ok, true, result.message);
});

// Passage ids for `source`: 1 name, 2 email, 3 SKILLS, 4 Python, 5 EXPERIENCE, 6 header, 7 bullet, 8 EDUCATION, 9 school.
const numberedAudit = (extra = {}) => ({ sourceEntries: [{ section: 'experience', sourcePassageIds: [6], outputIndex: 0 }, { section: 'education', sourcePassageIds: [9], outputIndex: 0 }],
  claims: [{ path: 'summary', sourcePassageIds: [7], verdict: 'supported', explanation: '' }, { path: 'experience.0.bullets.0', sourcePassageIds: [7], verdict: 'supported', explanation: '' }], issues: [], ...extra });
const auditing = (draft, auditValue) => ({ providerName: 'ollama', model: 'test', requestStructuredCompletion: input =>
  Promise.resolve(success(input.schemaName === 'cv_rewrite_audit' ? auditValue : input.schemaName === 'cv_target_summary' ? { summary: draft.summary } : draft)) });

test('a "missing" entry that cites the name line is ignored, but a drafted entry citing it still fails with the reason', async () => {
  const phantom = numberedAudit();
  phantom.sourceEntries.push({ section: 'projects', sourcePassageIds: [1], outputIndex: -1 });
  const accepted = await rewriteCv(source, null, auditing(content, phantom), job);
  assert.equal(accepted.ok, true, accepted.message);
  const misattributed = numberedAudit({ sourceEntries: [{ section: 'experience', sourcePassageIds: [1], outputIndex: 0 }, { section: 'education', sourcePassageIds: [9], outputIndex: 0 }] });
  const rejected = await rewriteCv(source, null, auditing(content, misattributed), job);
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /invalid audit \(A experience entry cites the candidate's name line/, 'the specific reason is kept');
});

test('a declared addition missing from Skills is added there instead of failing the CV', async () => {
  const forgot = { ...content, addedSkills: [{ skill: 'AWS', jobQuote: 'AWS preferred.', reason: 'Cloud tooling for the services.' }] };
  const result = await rewriteCv(source, null, provider(async () => success(forgot)), job);
  assert.equal(result.ok, true, result.message);
  assert.match(result.rewrite.skills[0].items, /AWS/);
  const unquoted = { ...forgot, addedSkills: [{ skill: 'Kubernetes', jobQuote: 'Kubernetes required.', reason: 'x' }] };
  const stillRejected = await rewriteCv(source, null, provider(async () => success(unquoted)), job);
  assert.equal(stillRejected.ok, false, 'an addition the posting does not name is still rejected');
});

test('lenient mode removes lines the audit cannot verify and invalid additions, and keeps only verified content', async () => {
  const draft = { ...content, experience: [{ ...content.experience[0], bullets: ['Built Python services.', 'Mentored junior engineers.'] }],
    skills: [{ category: 'Languages', items: 'Python, Kubernetes' }], addedSkills: [{ skill: 'Kubernetes', jobQuote: 'Kubernetes required.', reason: 'x' }] };
  const unsupported = numberedAudit();
  unsupported.claims.push({ path: 'experience.0.bullets.1', sourcePassageIds: [7], verdict: 'unsupported', explanation: 'No mentoring in the source.' });
  const strict = await rewriteCv(source, null, auditing(draft, unsupported), job);
  assert.equal(strict.ok, false, 'strict mode still rejects');
  const lenient = await rewriteCv(source, null, auditing(draft, unsupported), job, undefined, undefined, { lenient: true });
  assert.equal(lenient.ok, true, lenient.message);
  assert.deepEqual(lenient.rewrite.experience[0].bullets, ['Built Python services.']);
  assert.doesNotMatch(lenient.rewrite.skills.map((group) => group.items).join(','), /Kubernetes/);
  assert.deepEqual(lenient.rewrite.addedSkills, []);
  assert.deepEqual(lenient.rawResponse.removed, ['experience.0.bullets.1']);
  // Entry-level problems are never loosened: an omitted job still fails.
  const omitted = numberedAudit({ sourceEntries: [{ section: 'experience', sourcePassageIds: [6], outputIndex: -1 }, { section: 'education', sourcePassageIds: [9], outputIndex: 0 }] });
  assert.equal((await rewriteCv(source, null, auditing(content, omitted), job, undefined, undefined, { lenient: true })).ok, false);
});
