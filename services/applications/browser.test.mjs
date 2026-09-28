import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { LeverBrowser } from '../../lib/job-applications/lever.ts';
import { leverApplicationUrl, resolveApplicationUrl } from '../../lib/job-applications/urls.ts';
import { canDraft, missingRequired } from '../../lib/job-applications/types.ts';
import { localRequestError } from '../../lib/job-applications/http.ts';
import { target, html, profile, completeAnswers } from './fixture.mjs';

test('only canonical Lever job forms are accepted', () => {
  assert.equal(leverApplicationUrl(target.replace('/apply', '') + '?utm_source=orch'), target);
  for (const url of ['http://jobs.lever.co/example/11111111-1111-4111-8111-111111111111', target.replace('jobs.lever.co', 'jobs.lever.co.evil.test'), target.replace('jobs.lever.co', 'x@jobs.lever.co'), target.replace('jobs.lever.co', '127.0.0.1'), target + '/extra', target.replace('jobs.lever.co', 'jobs.lever.co:444')]) assert.equal(leverApplicationUrl(url), null, url);
});
test('custom eligibility and personal preferences cannot be drafted', () => {
  for (const label of ['What is your salary expectation?', 'Describe your visa sponsorship needs', 'Why are you willing to relocate?', 'Describe your disability', 'When is your start date?']) assert.equal(canDraft({ type: 'textarea', label }), false);
  assert.equal(canDraft({ type: 'textarea', label: 'Describe your relevant experience' }), true);
});
test('local automation rejects remote and cross-origin actions', () => {
  assert.equal(localRequestError(new Request('https://orch.example.test/api/job-applications'))?.status, 403);
  assert.equal(localRequestError(new Request('http://localhost:3000/api/job-applications', { method: 'POST', headers: { origin: 'https://evil.test', 'Content-Type': 'application/json' } }))?.status, 403);
  assert.equal(localRequestError(new Request('http://localhost:3000/api/job-applications', { method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json' } })), null);
  // `next start` in Docker reports the bind address in request.url; the browser's Host header decides.
  assert.equal(localRequestError(new Request('http://0.0.0.0:3000/api/job-applications', { method: 'POST', headers: { host: 'localhost:3100', origin: 'http://localhost:3100', 'Content-Type': 'application/json' } })), null);
  assert.equal(localRequestError(new Request('http://localhost:3000/api/job-applications', { headers: { host: 'rebind.evil.test:3000' } }))?.status, 403);
});
test('application link resolution accepts only Lever and Indeed links and never fetches another host', async () => {
  const saved = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }); };
  try {
    assert.equal(resolveApplicationUrl('https://www.themuse.com/jobs/example'), null);
    assert.equal(resolveApplicationUrl('https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111'), 'https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111/apply');
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = saved; }
});
test('mock browser fills exact profile and PDF, requires custom answers, and submits only once after review', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(); let submissions = 0;
    // Every network request is intercepted. No real employer receives any data.
    await context.route('**/*', async route => {
      assert.equal(route.request().url(), target);
      if (route.request().method() === 'POST') { submissions++; return route.fulfill({ contentType: 'text/html', body: '<h1>Thank you for applying!</h1><p>Your application has been received.</p>' }); }
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    const page = await context.newPage(); const adapter = new LeverBrowser(page, target);
    await adapter.open(); await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fictional test')), 'alex-example.pdf');
    let snapshot = await adapter.snapshot();
    assert.equal(snapshot.fields.find(f => f.name === 'name').value, profile.name);
    assert.equal(snapshot.resume, 'alex-example.pdf');
    assert.equal(snapshot.fields.find(f => f.name === 'cards[sponsor]').value, '', 'sponsorship is never inferred');
    assert.ok(missingRequired(snapshot.fields).length >= 3);
    await adapter.fillAnswers(completeAnswers(snapshot)); snapshot = await adapter.snapshot();
    assert.equal(missingRequired(snapshot.fields).length, 0);
    await page.getByRole('button', { name: 'Submit application' }).click();
    assert.equal(submissions, 0, 'native browser submission is blocked during review');
    assert.equal((await adapter.validateForSubmission(snapshot)).ok, true);
    await page.locator('[name="phone"]').fill('changed');
    assert.equal((await adapter.validateForSubmission(snapshot)).ok, false, 'stale review cannot submit changed browser data');
    snapshot = await adapter.snapshot();
    assert.equal((await adapter.validateForSubmission(snapshot)).ok, true);
    const result = await adapter.submitOnce();
    assert.equal(result.dispatched, true);
    assert.match(result.confirmation, /Thank you for applying/);
    assert.equal(submissions, 1);
  } finally { await browser.close(); }
});

test('a CAPTCHA or validation that prevents sending remains resumable; an unconfirmed POST is uncertain', async () => {
  for (const send of [false, true]) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(); let submissions = 0;
      await context.route('**/*', route => {
        if (route.request().method() === 'POST') { submissions++; return route.fulfill({ contentType: 'text/html', body: html }); }
        return route.fulfill({ contentType: 'text/html', body: send ? html : html.replace('onclick="this.form.requestSubmit()"', 'onclick="return false"') });
      });
      const adapter = new LeverBrowser(await context.newPage(), target);
      await adapter.open(); await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'cv.pdf');
      await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
      const result = await adapter.submitOnce(150);
      assert.equal(result.confirmation, null); assert.equal(result.dispatched, send); assert.equal(submissions, send ? 1 : 0);
      // A second, unapproved native click cannot send another request.
      await adapter.page.getByRole('button', { name: 'Submit application' }).click();
      assert.equal(submissions, send ? 1 : 0);
    } finally { await browser.close(); }
  }
});

test('AI drafts require source quotes and leave eligibility questions to the applicant', async () => {
  const { draftAnswer } = await import('../../lib/job-applications/draft.ts');
  const saved = globalThis.fetch;
  const field = { id: 'field-1', label: 'Describe your experience', type: 'textarea' };
  try {
    globalThis.fetch = async (_url, init) => Response.json({ done: true, message: { content: JSON.stringify(JSON.parse(init.body).format.properties.supported ? { supported: true, reason: 'Supported experience.' } : { answer: 'I built Python services.', sourceQuotes: ['Built Python services.'], profileEvidence: [] }) } });
    assert.equal((await draftAnswer(field, 'Built Python services.')).answer, 'I built Python services.');
    await assert.rejects(draftAnswer(field, 'Worked in sales.'), /enough evidence/);
    await assert.rejects(draftAnswer({ ...field, label: 'Describe your salary expectations' }, 'Built Python services.'), /own answer/);
  } finally { globalThis.fetch = saved; }
});
