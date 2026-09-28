import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { draftAnswer } from '../../lib/job-applications/draft.ts';
import { canDraft } from '../../lib/job-applications/types.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const field = { id: 'technical', type: 'textarea', label: 'Describe your production experience with Java/Kotlin and PostgreSQL.' };
const cv = 'Built production services in Go and Python. Skills: PostgreSQL. Languages: German (native), English (fluent).';
const profile = { name: 'Alex Example', email: 'alex@example.test', github: 'https://github.com/alex-example' };
function mock(draft, verdict = { supported: true, reason: 'All claims are supported.' }) {
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const response = request.format.properties.supported ? verdict : draft;
    return Response.json({ done: true, message: { content: JSON.stringify(response) } });
  };
  return requests;
}
test('drafts combine original CV experience with a saved profile link and check the complete answer', async () => {
  const requests = mock({ answer: 'My production work uses Go and Python. My CV does not document Java/Kotlin experience. GitHub: https://github.com/alex-example', sourceQuotes: ['Built production services in Go and Python.'], profileEvidence: [{ field: 'github', quote: profile.github }] });
  const result = await draftAnswer(field, cv, profile);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].messages[1].content).sourceProfile.github, profile.github);
  assert.equal(JSON.parse(requests[1].messages[1].content).answer, result.answer);
  assert.deepEqual(result.sourceQuotes, ['CV: Built production services in Go and Python.', `Profile (github): ${profile.github}`]);
});
test('profile-only evidence is accepted without manufacturing CV citations', async () => {
  mock({ answer: profile.github, sourceQuotes: [], profileEvidence: [{ field: 'github', quote: profile.github }] });
  assert.equal((await draftAnswer({ ...field, label: 'Share your GitHub profile' }, cv, profile)).answer, profile.github);
});
test('quotes must exist in the named source and profile field', async () => {
  for (const evidence of [
    { sourceQuotes: ['Built production Java services.'], profileEvidence: [] },
    { sourceQuotes: [profile.github], profileEvidence: [] },
    { sourceQuotes: [], profileEvidence: [{ field: 'portfolio', quote: profile.github }] },
    { sourceQuotes: [], profileEvidence: [{ field: 'github', quote: 'https://github.com/invented' }] },
  ]) {
    const requests = mock({ answer: 'Unsupported answer.', ...evidence });
    await assert.rejects(draftAnswer(field, cv, profile), /enough evidence/);
    assert.equal(requests.length, 1, 'invalid citations never reach the auditor');
  }
});
test('a genuine quote cannot justify invented professional experience', async () => {
  mock({ answer: 'I have five years of professional PostgreSQL administration experience.', sourceQuotes: ['PostgreSQL'], profileEvidence: [] }, { supported: false, reason: 'A listed skill does not establish years or professional duties.' });
  await assert.rejects(draftAnswer(field, cv, profile), /could not be verified/);
});
test('missing evidence and invalid audit output fail closed', async () => {
  mock({ answer: '', sourceQuotes: [], profileEvidence: [] });
  await assert.rejects(draftAnswer(field, cv, profile), /enough evidence/);
  mock({ answer: 'I built production services.', sourceQuotes: ['Built production services in Go and Python.'], profileEvidence: [] }, { supported: 'yes', reason: 'Trust me' });
  await assert.rejects(draftAnswer(field, cv, profile));
});
test('technical and language questions are draftable; personal decisions and eligibility stay manual', async () => {
  for (const label of ['How comfortable are you managing cloud infrastructure?', 'Describe your language proficiency', 'Explain a stage of your career']) assert.equal(canDraft({ type: 'textarea', label }), true, label);
  for (const label of ['What is your age?', 'Do you have the right to work in Austria?', 'Describe your salary expectations', 'What is your notice period?', 'Describe your visa needs']) {
    assert.equal(canDraft({ type: 'textarea', label }), false, label);
    globalThis.fetch = () => { throw Error('Must not call the model'); };
    await assert.rejects(draftAnswer({ ...field, label }, cv, profile), /own answer/);
  }
  assert.equal(canDraft({ type: 'radio', label: 'English proficiency' }), false);
});
