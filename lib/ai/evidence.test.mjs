import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasEvidence } from './evidence.ts';
import { validateRewriteContacts, validateRewriteFacts, validateRewriteNumericClaims, validateTailoredRewriteSkills } from './cv-rewrite-validation.ts';
import { dropPhantomMissingEntries, validateRewriteAudit, auditCvRewrite, auditSourcePassages, resolveIndexedAudit, entryCitationProblem } from './cv-rewrite-audit.ts';
import { assessRequirements } from '../jobs/assessment.ts';
import { scoreJobMatch } from './job-match.ts';
import { acceptedArrangements, acceptedSeniorities, applySearchPreferences, defaultSearchPreferences, jobMeetsPreferences, searchPreferencesSchema } from '../jobs/preferences.ts';

const cv = { name: 'Alex Example', contactLine: [], skills: [], experience: [{ company: 'Example Ltd', jobTitle: 'Developer', location: '', dateRange: '2020–2024', bullets: ['Reduced latency by 40%.'] }], projects: [], education: [{ school: 'Example University', degree: 'Computer Science', date: '' }] };
const source = 'Alex Example\nDeveloper, Example Ltd, 2020-2024\nReduced latency by 40%.\nExample University, Computer Science';
const audit = { sourceEntries: [{section:'experience',sourceQuote:'Developer, Example Ltd, 2020-2024',outputIndex:0},{section:'education',sourceQuote:'Example University, Computer Science',outputIndex:0}], claims:[{path:'experience.0.bullets.0',sourceQuote:'Reduced latency by 40%.',verdict:'supported'}],issues:[] };

test('evidence respects token boundaries without losing Unicode and formatting variants', () => {
  assert.equal(hasEvidence('JavaScript with 140% increase', 'Java'), false);
  assert.equal(hasEvidence('140%', '40%'), false);
  assert.equal(hasEvidence('2020–2024 Universität\nInnsbruck', '2020-2024 Universität Innsbruck'), true);
  assert.equal(hasEvidence('can not', 'cannot'), false);
});

test('rejects invented immutable facts in each field and preserves blank dates', () => {
  assert.equal(validateRewriteFacts(cv, source).ok, true);
  for (const [section, field] of [['experience','company'],['experience','jobTitle'],['experience','location'],['experience','dateRange'],['education','school'],['education','degree'],['education','date']]) {
    const draft = structuredClone(cv); draft[section][0][field] = 'Invented 2099';
    assert.equal(validateRewriteFacts(draft, source).ok, false, field);
  }
});

test('JavaScript cannot satisfy Java, and metrics cannot match suffixes', () => {
  assert.equal(validateTailoredRewriteSkills({...cv,experience:[],skills:[{category:'Languages',items:'Java'}]},'JavaScript').ok,false);
  assert.equal(validateRewriteNumericClaims(cv,source.replace('40%','140%')).ok,false);
});

test('phone formatting is accepted without allowing a changed or assembled phone number', () => {
  const draft={...cv,contactLine:[{text:'+43 660 482 1177',url:'tel:+436604821177'}]};
  assert.equal(validateRewriteContacts(draft,'Alex Example | +43 660 482 1177 | Vienna').ok,true);
  assert.equal(validateRewriteContacts(draft,'Alex Example | +43 660 482 1178 | Vienna').ok,false);
  assert.equal(validateRewriteContacts(draft,'+43 660\nExperience: 482\nProject: 1177').ok,false);
});

test('audit requires every prose path and entry, and real source quotations', () => {
  assert.equal(validateRewriteAudit(source,cv,audit),null);
  for (const changed of [{...audit,claims:[]},{...audit,sourceEntries:[]},{...audit,claims:[{...audit.claims[0],sourceQuote:'Made up quote'}]},{...audit,claims:[audit.claims[0],audit.claims[0]]}]) {
    assert.equal(typeof validateRewriteAudit(source,cv,changed),'string');
  }
});

test('audit rejects transferred metrics, omitted individual entries and strengthened responsibilities', () => {
  const moved = {...audit,claims:[{...audit.claims[0],verdict:'misattributed'}]};
  assert.match(validateRewriteAudit(source,cv,moved),/misattributed/);
  const omitted = {...audit,sourceEntries:[...audit.sourceEntries,{section:'projects',sourceQuote:'Budget App',outputIndex:-1}]};
  assert.match(validateRewriteAudit(source+'\nBudget App',cv,omitted),/omitted/);
  assert.match(validateRewriteAudit(source,cv,{...audit,issues:['Led a team is unsupported; source only says contributed.']}),/unsupported/);
});

test('an unavailable verifier fails closed, without returning an approved CV', async () => {
  const result=await auditCvRewrite(source,cv,{providerName:'ollama',model:'test',requestStructuredCompletion:async()=>({ok:false,kind:'timeout',message:'offline',durationMs:1,model:'test'})});
  assert.equal(result.ok,false); assert.equal(result.kind,'timeout');
});

const requirement=(status='met',importance='required')=>({requirement:'Python',jobQuote:'Python',cvQuote:status==='not_demonstrated'?'':'Built Python services.',status,importance,explanation:'Explicit source evidence.'});
test('score is calculated from weighted evidence and absence is not contradiction', () => {
  const assessment={roleFit:'aligned',requirements:[requirement(),{...requirement('not_demonstrated','preferred'),requirement:'Kubernetes',jobQuote:'Kubernetes'}]};
  const match=assessRequirements(assessment,'Built Python services.','Python required. Kubernetes preferred.');
  assert.equal(match.score,75);assert.equal(match.suitable,true);assert.match(match.missing[0],/not demonstrated/);
});

test('aligned stretch roles remain eligible with gaps or entirely transferable evidence', () => {
  const mixed={roleFit:'aligned',requirements:[requirement(),{...requirement('not_demonstrated'),requirement:'Kafka',jobQuote:'Kafka'}]};
  const match=assessRequirements(mixed,'Built Python services.','Python and Kafka');
  assert.equal(match.score,50);assert.equal(match.suitable,true);
  assert.equal(assessRequirements({roleFit:'aligned',requirements:[requirement('partial')]},'Built Python services.','Python').suitable,true);
  assert.equal(assessRequirements({...mixed,roleFit:'different'},'Built Python services.','Python and Kafka').suitable,false);
});

test('a tailored summary can cite multiple source sections without allowing invented facts or cross-employer bullets', () => {
  const draft={...cv,summary:'Computer Science graduate who reduced latency by 40%.'};
  const combined={...audit,claims:[...audit.claims,{path:'summary',sourceQuote:'Example University, Computer Science',additionalSourceQuotes:['Reduced latency by 40%.'],verdict:'supported'}]};
  assert.equal(validateRewriteAudit(source,draft,combined),null);
  assert.match(validateRewriteAudit(source,draft,{...combined,claims:[audit.claims[0],{...combined.claims[1],additionalSourceQuotes:['Invented employer']}]}),/Unsupported/);
  assert.match(validateRewriteAudit(source,cv,{...audit,claims:[{...audit.claims[0],additionalSourceQuotes:['Example University, Computer Science']}]}),/Misattributed/);
});

test('indexed evidence is copied from the CV, and invented or duplicate passage IDs are rejected', () => {
  const passages=auditSourcePassages(source);
  const numbered={sourceEntries:[{section:'experience',sourcePassageIds:[2],outputIndex:0},{section:'education',sourcePassageIds:[4],outputIndex:0}],
    claims:[{path:'experience.0.bullets.0',sourcePassageIds:[3],verdict:'supported',explanation:''}],issues:[]};
  const resolved=resolveIndexedAudit(numbered,passages);
  assert.equal(resolved.claims[0].sourceQuote,'Reduced latency by 40%.');
  assert.deepEqual(resolved.sourceEntries.map(entry=>entry.sourceQuote),['Developer, Example Ltd, 2020-2024','Example University, Computer Science'],'entry headers are copied by code, never re-typed by the model');
  assert.equal(validateRewriteAudit(source,cv,resolved),null);
  for(const ids of [[999],[3,3]]) assert.throws(()=>resolveIndexedAudit({...numbered,claims:[{...numbered.claims[0],sourcePassageIds:ids}]},passages));
  assert.match(validateRewriteAudit(source,cv,resolveIndexedAudit({...numbered,claims:[{...numbered.claims[0],sourcePassageIds:[]}]},passages)),/Unsupported/);
  // Entries: unknown or non-consecutive lines are malformed; a bullet or the wrong block is still caught by the identity checks.
  for(const ids of [[999],[2,4]]) assert.throws(()=>resolveIndexedAudit({...numbered,sourceEntries:[{...numbered.sourceEntries[0],sourcePassageIds:ids},numbered.sourceEntries[1]]},passages));
  assert.match(validateRewriteAudit(source,cv,resolveIndexedAudit({...numbered,sourceEntries:[{...numbered.sourceEntries[0],sourcePassageIds:[3]},numbered.sourceEntries[1]]},passages)),/does not identify its employer/);
});

test('a "missing" entry citing the name line or a heading is dropped; one placed in the draft is a malformed audit', async () => {
  const good={...audit,sourceEntries:[...audit.sourceEntries]};
  assert.equal(entryCitationProblem(cv,good),null);
  for(const bogus of [{section:'projects',sourceQuote:'# Alex Example',outputIndex:-1},{section:'projects',sourceQuote:'Alex Example',outputIndex:-1},{section:'projects',sourceQuote:'## Projects',outputIndex:-1},{section:'experience',sourceQuote:'EXPERIENCE:',outputIndex:0}]) {
    assert.match(entryCitationProblem(cv,{sourceEntries:[...audit.sourceEntries,bogus]}),/name line|section heading/,bogus.sourceQuote);
  }
  assert.equal(entryCitationProblem(cv,{sourceEntries:[{section:'projects',sourceQuote:'Budget App',outputIndex:-1}]}),null,'a real project header is a genuine omission');
  const passages=auditSourcePassages(source);
  const provider={providerName:'ollama',model:'test',requestStructuredCompletion:()=>Promise.resolve({ok:true,content:JSON.stringify({sourceEntries:[{section:'experience',sourcePassageIds:[2],outputIndex:0},{section:'projects',sourcePassageIds:[1],outputIndex:-1},{section:'education',sourcePassageIds:[4],outputIndex:0}],claims:[{path:'experience.0.bullets.0',sourcePassageIds:[3],verdict:'supported',explanation:''}],issues:[]}),model:'test',rawResponse:{},durationMs:1})};
  // A phantom "missing" entry that cites the name line cannot hide a real omission, so it no longer sinks the audit.
  const result=await auditCvRewrite(source,cv,provider);
  assert.equal(result.ok,true,result.message);assert.equal(passages[0].text,'Alex Example');
  assert.deepEqual(dropPhantomMissingEntries(cv,{sourceEntries:[{section:'projects',sourceQuote:'## Projects',outputIndex:-1},{section:'experience',sourceQuote:'EXPERIENCE:',outputIndex:0},{section:'projects',sourceQuote:'Budget App',outputIndex:-1}]}).sourceEntries.map(e=>e.sourceQuote),['EXPERIENCE:','Budget App']);
  // An entry the audit places in the draft but anchors on the name line is still malformed and re-checked.
  const placed={...provider,requestStructuredCompletion:()=>Promise.resolve({ok:true,content:JSON.stringify({sourceEntries:[{section:'experience',sourcePassageIds:[1],outputIndex:0},{section:'education',sourcePassageIds:[4],outputIndex:0}],claims:[{path:'experience.0.bullets.0',sourcePassageIds:[3],verdict:'supported',explanation:''}],issues:[]}),model:'test',rawResponse:{},durationMs:1})};
  const malformed=await auditCvRewrite(source,cv,placed);
  assert.equal(malformed.ok,false);assert.equal(malformed.retryAudit,true);assert.match(malformed.message,/name line/);
});

test('a header that wraps onto the next line is cited as consecutive IDs and still anchors its own block', () => {
  const wrapped='Alex Example\nDeveloper\nExample Ltd, 2020-2024\nReduced latency by 40%.\nExample University, Computer Science';
  const passages=auditSourcePassages(wrapped);
  const resolved=resolveIndexedAudit({sourceEntries:[{section:'experience',sourcePassageIds:[2,3],outputIndex:0},{section:'education',sourcePassageIds:[5],outputIndex:0}],
    claims:[{path:'experience.0.bullets.0',sourcePassageIds:[4],verdict:'supported',explanation:''}],issues:[]},passages);
  assert.equal(resolved.sourceEntries[0].sourceQuote,'Developer Example Ltd, 2020-2024');
  assert.equal(validateRewriteAudit(wrapped,cv,resolved),null);
});

test('contradicted required qualifications and role mismatch prevent tailoring', () => {
  for(const assessment of [
    {roleFit:'different',requirements:[requirement()]},
    {roleFit:'aligned',requirements:[requirement('contradicted')]},
    {roleFit:'aligned',requirements:[requirement('not_demonstrated')]},
  ]) assert.equal(assessRequirements(assessment,'Built Python services.','Python').suitable,false);
});

test('fabricated citations and duplicate requirements cannot contribute to a score', () => {
  for (const requirements of [[{...requirement(),cvQuote:'Invented'}],[{...requirement(),jobQuote:'Invented'}],[requirement(),requirement()]]) {
    assert.throws(()=>assessRequirements({roleFit:'aligned',requirements},'Built Python services.','Python'));
  }
});

test('unused negative quotations are cleared without credit; positive citations still must verify', async () => {
  const run = async (status, quote) => scoreJobMatch('Built Python services.', {title:'Developer',company:'Example',description:'Python and Kubernetes'}, {
    providerName:'ollama',model:'test',requestStructuredCompletion:async()=>({ok:true,model:'test',durationMs:1,content:JSON.stringify({roleFit:'aligned',requirements:[requirement(),{...requirement(status),requirement:'Kubernetes',jobQuote:'Kubernetes',cvQuote:quote}]})}),
  });
  const negative = await run('not_demonstrated','An unused explanation, not evidence');
  assert.equal(negative.ok,true); assert.equal(negative.match.score,50); assert.equal(negative.match.suitable,true);
  assert.equal(negative.match.assessment.requirements[1].cvQuote,'');
  assert.equal((await run('met','Invented quote')).ok,false);
});

test('explicit preferences replace inferred history and remain conservative for remote locations', () => {
  const profile={titles:['Developer'],skills:['Python'],keywords:[],seniority:'junior',locations:['Old City'],remotePreference:'onsite'};
  const prefs={...defaultSearchPreferences,locations:['Vienna'],remotePreference:'remote',titles:['Backend Engineer']};
  assert.deepEqual(applySearchPreferences(profile,prefs).locations,['Vienna']);
  assert.deepEqual(applySearchPreferences(profile,defaultSearchPreferences).locations,[]);
  assert.equal(jobMeetsPreferences({location:'Remote',remote:true,description:''},prefs),false);
  assert.equal(jobMeetsPreferences({location:'Vienna, Austria',remote:true,description:''},prefs),true);
  assert.equal(jobMeetsPreferences({location:'Vienna',remote:false,description:''},prefs),false);
});

test('even a verifier approval cannot move another employers evidence into a bullet',()=>{
  const original='Developer, Example Ltd, 2020-2024\nReduced latency by 40%.\nDeveloper, Other Ltd\nIncreased sales by 20%.\nExample University, Computer Science';
  const draft=structuredClone(cv);
  draft.experience.push({company:'Other Ltd',jobTitle:'Developer',location:'',dateRange:'',bullets:['Reduced latency by 40%.']});
  const evidence=structuredClone(audit);
  evidence.sourceEntries.push({section:'experience',sourceQuote:'Developer, Other Ltd',outputIndex:1});
  evidence.claims.push({path:'experience.1.bullets.0',sourceQuote:'Reduced latency by 40%.',verdict:'supported'});
  assert.match(validateRewriteAudit(original,draft,evidence),/Misattributed/);
});

test('a rejected citation gets exactly one corrective round that names the quote; the verifier never relaxes', async () => {
  const calls=[];
  const respond=(quote)=>JSON.stringify({roleFit:'aligned',requirements:[{...requirement(),cvQuote:quote}]});
  const provider=(answers)=>({providerName:'ollama',model:'test',requestStructuredCompletion:async({messages})=>{calls.push(messages);return {ok:true,model:'test',durationMs:1,content:answers[calls.length-1]};}});
  const fixed=await scoreJobMatch('Built Python services.',{title:'Developer',company:'Example',description:'Python'},provider([respond('Built Python service'),respond('Built Python services.')]));
  assert.equal(fixed.ok,true); assert.equal(fixed.retried,true); assert.equal(calls.length,2);
  assert.equal(calls[1][2].role,'assistant'); assert.match(calls[1][3].content,/Built Python service/); assert.match(calls[1][3].content,/rejected/);
  calls.length=0;
  const still=await scoreJobMatch('Built Python services.',{title:'Developer',company:'Example',description:'Python'},provider([respond('Invented'),respond('Still invented')]));
  assert.equal(still.ok,false); assert.equal(calls.length,2); assert.match(still.message,/CV citation/);
  calls.length=0;
  const malformed=await scoreJobMatch('Built Python services.',{title:'Developer',company:'Example',description:'Python'},provider(['not json']));
  assert.equal(malformed.ok,false); assert.equal(calls.length,1);
});

test('citation repair cannot drop, weaken, replace, reorder or upgrade requirements', async () => {
  const initial={roleFit:'uncertain',requirements:[requirement(),{...requirement('not_demonstrated'),requirement:'Kubernetes',jobQuote:'Kubernetes required!'}]};
  const fixed={...initial,requirements:[initial.requirements[0],{...initial.requirements[1],jobQuote:'Kubernetes required'}]};
  const run=async repair=>{
    let calls=0;
    return scoreJobMatch('Built Python services.',{title:'Developer',company:'Example',description:'Python required. Kubernetes required.'},{providerName:'ollama',model:'test',requestStructuredCompletion:async()=>({ok:true,model:'test',durationMs:1,content:JSON.stringify(++calls===1?initial:repair)})});
  };
  const valid=await run(fixed);assert.equal(valid.ok,true);assert.equal(valid.match.score,50);assert.equal(valid.match.suitable,false);
  for(const repair of [
    {...fixed,requirements:[fixed.requirements[0]]},
    {...fixed,roleFit:'aligned'},
    {...fixed,requirements:[fixed.requirements[0],{...fixed.requirements[1],importance:'preferred'}]},
    {...fixed,requirements:[fixed.requirements[0],{...fixed.requirements[1],requirement:'Optional tooling'}]},
    {...fixed,requirements:[...fixed.requirements].reverse()},
    {...fixed,requirements:[fixed.requirements[0],{...fixed.requirements[1],status:'met',cvQuote:'Built Python services.'}]},
  ])assert.equal((await run(repair)).ok,false);
});

test('unsupported CV evidence may be downgraded but never upgraded by citation repair', async () => {
  const run=async status=>{
    let calls=0;
    return scoreJobMatch('Built Python services.',{title:'Developer',company:'Example',description:'Python'}, {providerName:'ollama',model:'test',requestStructuredCompletion:async()=>({ok:true,model:'test',durationMs:1,content:JSON.stringify({roleFit:'aligned',requirements:[{...requirement(++calls===1?'partial':status),cvQuote:calls===1?'Invented':status==='not_demonstrated'?'':'Built Python services.'}]})})});
  };
  const negative=await run('not_demonstrated');assert.equal(negative.ok,true);assert.equal(negative.match.score,0);
  assert.equal((await run('partial')).ok,true);
  assert.equal((await run('met')).ok,false);
});

test('several work arrangements and seniority levels are accepted together; legacy single values still apply', () => {
  const base = { ...defaultSearchPreferences, locations: [] };
  const remoteOrHybrid = { ...base, workArrangements: ['remote', 'hybrid'] };
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: true, description: '' }, remoteOrHybrid), true);
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: false, description: 'Hybrid, 2 days on site' }, remoteOrHybrid), true);
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: false, description: 'On site only' }, remoteOrHybrid), false);
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: false, description: 'On site only' }, { ...base, workArrangements: ['onsite'] }), true);
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: false, description: 'hybrid' }, { ...base, workArrangements: ['onsite'] }), false, 'hybrid is not on-site');
  assert.equal(jobMeetsPreferences({ location: 'Berlin', remote: false, description: '' }, base), true, 'nothing ticked accepts any arrangement');
  assert.deepEqual(acceptedArrangements({ ...base, remotePreference: 'remote' }), ['remote'], 'a run saved with the single value keeps its meaning');
  assert.deepEqual(acceptedArrangements({ ...base, remotePreference: 'remote', workArrangements: ['hybrid'] }), ['hybrid'], 'the multi-select wins when set');
  const profile = { titles: ['Backend Engineer'], skills: [], seniority: 'junior', locations: [], remotePreference: 'any', keywords: [] };
  const twoLevels = applySearchPreferences(profile, { ...base, seniorities: ['junior', 'mid'], workArrangements: ['remote', 'onsite'] });
  assert.deepEqual(twoLevels.seniorities, ['junior', 'mid']); assert.equal(twoLevels.seniority, 'junior'); assert.equal(twoLevels.remotePreference, 'any', 'two arrangements mean no source-side remote filter');
  assert.equal(applySearchPreferences(profile, { ...base, workArrangements: ['remote'] }).remotePreference, 'remote');
  assert.deepEqual(acceptedSeniorities({ ...base, seniority: 'senior' }), ['senior']);
  assert.deepEqual(acceptedSeniorities(base), [], 'nothing ticked means the CV level');
  const parsed = searchPreferencesSchema.parse({ titles: [], locations: [], remotePreference: 'hybrid', seniority: 'mid' });
  assert.deepEqual([parsed.workArrangements, parsed.seniorities], [[], []], 'older saved runs parse with empty multi-selects');
});

test('a run-time target role is accepted in preferences and left out of the defaults', () => {
  const parsed = searchPreferencesSchema.parse({ titles: [], locations: [], targetRole: '  AI researcher  ' });
  assert.equal(parsed.targetRole, 'AI researcher');
  assert.equal(searchPreferencesSchema.parse({ titles: [], locations: [] }).targetRole, undefined);
  assert.equal('targetRole' in defaultSearchPreferences, false);
});
