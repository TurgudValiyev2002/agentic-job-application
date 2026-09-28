import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { generateAutoAnswers, canAutoAnswer } from '../../lib/job-applications/auto-answers.ts';
import { fillAutomaticApplication } from '../../lib/job-applications/automatic.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const field = (id, type = 'textarea', options = []) => ({ id, name: id, type, label: id, value: '', required: true, options });
const sources = { cv: 'Daniel Varga built Python services. English (fluent).', facts: { 'profile.email': 'daniel@example.test', 'details.noticePeriod': 'One month' } };
// Three model calls: cited answers (evidence quotes), the audit (approvedIds), and the best-effort pass (basis).
function mock(answers, approvedIds, bestEffort = []) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const props = body.format.properties;
    const content = props.approvedIds ? { approvedIds } : props.answers.items.properties.basis ? { answers: bestEffort } : { answers };
    return Response.json({ done: true, message: { content: JSON.stringify(content) } });
  };
  return calls;
}
const isBestEffort = (call) => Boolean(call.format.properties.answers?.items?.properties?.basis);
const cited = (id, value, source='cv', quote='built Python services') => ({ id, value, evidence: [{ source, quote }] });
test('automatic answers support prose, exact options and explicit saved facts with an independent audit', async () => {
  const fields = [field('experience'), field('English', 'select', [{ label:'Fluent',value:'c1' }]), field('notice', 'text')];
  const calls = mock([cited('experience', 'I built Python services.'), cited('English', 'c1', 'cv', 'English (fluent)'), cited('notice','One month','details.noticePeriod','One month')], fields.map(f=>f.id));
  const result = await generateAutoAnswers(fields, sources);
  assert.deepEqual(result.answers, { experience:'I built Python services.', English:'c1', notice:'One month' });
  assert.equal(result.evidence[1].answer, 'Fluent'); assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls[0].messages[1].content).cv, sources.cv);
});
test('missing quotes, made-up options, wrong source attribution, malformed numbers and invalid dates are rejected', async () => {
  const fields=[field('bad'),field('option','radio',[{label:'Yes',value:'yes'}]),field('source'),field('years','number'),field('date','date')];
  const calls=mock([cited('bad','Invented','cv','Kafka expert'),cited('option','No'),cited('source','One month','cv','One month'),cited('years','lots'),cited('date','2026-02-30')],fields.map(f=>f.id));
  assert.deepEqual((await generateAutoAnswers(fields,sources)).answers,{});
  assert.equal(calls.length,2,'rejected cited answers skip the audit; the best-effort pass still runs for the blanks');
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).fields.map(f=>f.id),fields.map(f=>f.id));
});
test('the best-effort pass fills every question the cited pass left blank, records its basis, and still rejects impossible values', async () => {
  const fields=[field('experience'),field('years','number'),field('remote','radio',[{label:'Yes',value:'y'},{label:'No',value:'n'}]),field('start','date'),field('level','select',[{label:'Junior',value:'j'},{label:'Senior',value:'s'}])];
  const calls=mock([cited('experience','I built Python services.')],['experience'],[
    {id:'years',value:'2',basis:'Two years of dated roles on the CV.'},{id:'remote',value:'y',basis:'No fact says otherwise.'},
    {id:'start',value:'2026-13-01',basis:'invalid date'},{id:'level',value:'principal',basis:'not an option'},{id:'experience',value:'overwrite',basis:'already answered'},
  ]);
  const result=await generateAutoAnswers(fields,sources);
  assert.deepEqual(result.answers,{experience:'I built Python services.',years:'2',remote:'y'});
  assert.deepEqual(result.evidence.map(e=>e.question),['experience','years','remote']);
  assert.match(result.evidence[1].sources[0],/^best effort \(no direct quote\): Two years/);
  assert.equal(result.evidence[2].answer,'Yes');
  const bestEffortCall=calls.find(isBestEffort);
  assert.deepEqual(JSON.parse(bestEffortCall.messages[1].content).fields.map(f=>f.id),['years','remote','start','level'],'only the blanks reach the best-effort pass');
});
test('a real quote cannot bypass the audit; unknown IDs cannot fill or overwrite other controls', async () => {
  mock([cited('experience','I have 10 years of production Kafka experience.'),cited('other','injected')],['other']);
  assert.deepEqual((await generateAutoAnswers([field('experience')],sources)).answers,{});
  assert.equal(canAutoAnswer({...field('experience'),value:'User answer'}),false);
  for (const f of [field('Resume','file'),field('I agree to the terms','checkbox'),field('Gender','radio'),field('Signature','text')]) assert.equal(canAutoAnswer(f),false);
});
test('automatic runs answer eligibility and consent questions by rule with the right polarity, and the model never sees them', async () => {
  const yesNo = (id, yes = 'Yes', no = 'No') => field(id, 'radio', [{ label: yes, value: `${id}-y` }, { label: no, value: `${id}-n` }]);
  const fields = [
    yesNo('Are you authorized to work in Austria? *'), yesNo('Will you now or in the future require visa sponsorship?'),
    yesNo('Are you legally authorized to work in the US without sponsorship?'), yesNo('Sind Sie in Österreich arbeitsberechtigt?', 'Ja', 'Nein'),
    yesNo('Are you at least 18 years old?'), yesNo('Do you consent to a background check?'), yesNo('I certify that the information provided is accurate'),
    field('Are you eligible to work in the EU?', 'text'), { ...field('I agree to the privacy policy', 'checkbox'), options: [] },
    field('Signature', 'text'), field('experience'),
  ];
  const calls = mock([cited('experience', 'I built Python services.')], ['experience']);
  const result = await generateAutoAnswers(fields, sources);
  const byQuestion = Object.fromEntries(result.evidence.map(item => [item.question, item.answer]));
  assert.equal(byQuestion['Are you authorized to work in Austria? *'], 'Yes');
  assert.equal(byQuestion['Will you now or in the future require visa sponsorship?'], 'No');
  assert.equal(byQuestion['Are you legally authorized to work in the US without sponsorship?'], 'Yes');
  assert.equal(byQuestion['Sind Sie in Österreich arbeitsberechtigt?'], 'Ja');
  assert.equal(byQuestion['Are you at least 18 years old?'], 'Yes');
  assert.equal(byQuestion['Do you consent to a background check?'], 'Yes');
  assert.equal(byQuestion['I certify that the information provided is accurate'], 'Yes');
  assert.equal(result.answers['Are you eligible to work in the EU?'], 'Yes');
  assert.equal(result.answers['I agree to the privacy policy'], 'true');
  assert.equal('Signature' in result.answers, false, 'signatures are never typed');
  assert.equal(result.answers.experience, 'I built Python services.');
  assert.ok(result.evidence.find(item => item.question.startsWith('Are you authorized')).sources[0].startsWith('automatic-apply policy'));
  const modelFields = JSON.parse(calls[0].messages[1].content).fields.map(item => item.id);
  assert.deepEqual(modelFields, ['experience'], 'the model only receives the remaining question');
  // A saved fact that sponsorship is required flips that answer.
  mock([], []);
  const sponsored = await generateAutoAnswers([yesNo('Do you require visa sponsorship?')], { ...sources, facts: { ...sources.facts, 'details.requiresVisaSponsorship': 'true' } });
  assert.equal(sponsored.evidence[0].answer, 'Yes');
  // Controls without a clear yes/no are left alone rather than guessed.
  mock([], []);
  assert.deepEqual((await generateAutoAnswers([field('Work authorization status', 'select', [{ label: 'Citizen', value: 'c' }, { label: 'Permanent resident', value: 'p' }, { label: 'Visa holder', value: 'v' }])], sources)).answers, {});
});
test('a work-permission question with only ambiguous options stays blank instead of a guessed favorable answer', async () => {
  mock([],[]);
  assert.deepEqual((await generateAutoAnswers([field('Do you have permission to work here?','select',[{label:'Select an option',value:'x'},{label:'Not yet',value:'later'}])],sources)).answers,{});
});
function fakeAdapter() {
  let current={ fields:[field('experience')],url:'https://smartapply.indeed.com/questions',title:'Questions',resume:'daniel-tailored.pdf',notice:'',readyToSubmit:false };
  return { snapshot:async()=>structuredClone(current), fillAnswers:async answers=>{ assert.equal(answers.experience,'Supported'); current={...current,fields:[],url:'https://smartapply.indeed.com/review',readyToSubmit:true}; }, submitOnce:async()=>assert.fail('filling never submits'), change:()=>{current.title='Changed';} };
}
test('automatic multi-step preparation advances to review but never calls submit itself', async()=>{
  const adapter=fakeAdapter();let calls=0;
  const result=await fillAutomaticApplication(adapter,async fields=>{if(!fields.length)return{answers:{},evidence:[]};calls++;return{answers:{experience:'Supported'},evidence:[]};},async()=>true);
  assert.equal(result.ready,true);assert.equal(calls,1);assert.equal(result.snapshot.resume,'daniel-tailored.pdf');
});
test('missing facts, cancellation and stale browser forms stop automatic progress',async()=>{
  assert.equal((await fillAutomaticApplication(fakeAdapter(),async()=>({answers:{},evidence:[]}),async()=>true)).ready,false);
  await assert.rejects(fillAutomaticApplication(fakeAdapter(),async()=>assert.fail(),async()=>false),/cancelled/);
  const adapter=fakeAdapter();
  const result=await fillAutomaticApplication(adapter,async()=>{adapter.change();return{answers:{experience:'Supported'},evidence:[]};},async()=>true);
  assert.equal(result.ready,false);assert.match(result.message,/changed/);
});
