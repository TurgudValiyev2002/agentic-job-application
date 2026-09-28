import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { CAPTCHA_NOTICE, IndeedApplyBrowser, profileAnswer } from '../../lib/job-applications/indeed.ts';
import { applicationKind, canonicalApplicationUrl } from '../../lib/job-applications/adapter.ts';
import { missingRequired } from '../../lib/job-applications/types.ts';
import { posting, formOrigin, postingHtml, formHtml, profile, completeAnswers } from './indeed-fixture.mjs';
import { VERIFICATION_MESSAGE } from '../../lib/jobs/sources/indeed-data.ts';

process.env.INDEED_BASE_URL = 'https://de.indeed.com';

test('Indeed postings and Lever forms are both recognised as application targets', () => {
  assert.equal(applicationKind(posting + '&from=serp'), 'indeed');
  assert.equal(canonicalApplicationUrl(posting + '&from=serp'), posting);
  assert.equal(applicationKind('https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111'), 'lever');
  assert.equal(applicationKind('https://wellfound.com/jobs/123-x'), null);
});

test('contact answers come from the profile only; eligibility questions are never inferred', () => {
  assert.equal(profileAnswer('First name *', profile), 'Alex');
  assert.equal(profileAnswer('Nachname', profile), 'Example');
  assert.equal(profileAnswer('Phone number', profile), '+49 30 0000');
  assert.equal(profileAnswer('City', profile), 'Berlin');
  assert.equal(profileAnswer('Company name', profile), null, 'empty profile values are not filled');
  for (const label of ['Do you need visa sponsorship?', 'Expected salary', 'Postal code', 'Country']) assert.equal(profileAnswer(label, profile), null, label);
});

async function openFixture(options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(); let submissions = 0;
  // Every network request is intercepted. No real employer or Indeed endpoint receives any data.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === formOrigin && route.request().method() === 'POST') { submissions++; return route.fulfill({ status: options.submitStatus ?? 200, contentType: 'application/json', body: '{}' }); }
    if (url.origin === formOrigin) return route.fulfill({ contentType: 'text/html', body: options.formHtml ?? formHtml });
    if (url.origin === 'https://de.indeed.com') return route.fulfill({ contentType: 'text/html', body: options.postingHtml ?? postingHtml(options.loggedIn ?? true, options.withButton ?? true) });
    return route.abort();
  });
  const page = await context.newPage();
  // Tests fail a bot check at once unless they opt into the wait.
  return { browser, page, context, adapter: new IndeedApplyBrowser(page, posting, { verification: { waitMs: 0 }, ...(options.adapter ?? {}) }), submissions: () => submissions };
}

test('an unsigned browser or a company-site posting stops before any form is opened', async () => {
  for (const [options, pattern] of [[{ loggedIn: false }, /not signed in/], [{ withButton: false }, /company's own website/], [{ postingHtml: postingHtml(true, false, { legacy: true }) }, /company's own website/]]) {
    const { browser, adapter } = await openFixture(options);
    try { await assert.rejects(adapter.open(), pattern); } finally { await browser.close(); }
  }
});

test('the legacy #indeedApplyButton posting still opens the form and prepares a CV without submitting', async () => {
  const { browser, adapter, submissions } = await openFixture({ postingHtml: postingHtml(true, true, { legacy: true }) });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    const snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /employer questions/);
    assert.equal(snapshot.resume, 'tailored.pdf');
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('an apply anchor rendered client-side after load is still found when the posting model promises Indeed Apply', async () => {
  const { browser, adapter, page } = await openFixture({ postingHtml: postingHtml(true, true, { renderDelayMs: 1_500 }) });
  try {
    await adapter.open();
    assert.equal(new URL(page.url()).origin, formOrigin);
  } finally { await browser.close(); }
});

test('a bot check in front of the posting waits for the person to clear it, then opens the form; without a wait it fails at once', async () => {
  const challenge = '<title>Bir dakika lütfen...</title><body><div id="challenge-stage"></div><p>Lütfen bekleyin.</p></body>';
  const { browser, context, page } = await openFixture();
  let cleared = false, postingRequests = 0;
  await context.route('https://de.indeed.com/**', (route) => { postingRequests++; return cleared ? route.fulfill({ contentType: 'text/html', body: postingHtml(true) }) : route.fulfill({ status: 403, contentType: 'text/html', body: challenge }); });
  try {
    await assert.rejects(new IndeedApplyBrowser(page, posting, { verification: { waitMs: 0 } }).open(), new RegExp(VERIFICATION_MESSAGE.slice(0, 30)));
    let announced = 0;
    setTimeout(() => { cleared = true; }, 200);
    const adapter = new IndeedApplyBrowser(page, posting, { verification: { waitMs: 5_000, pollMs: 20, reloadMs: 40, onWaiting: () => { announced++; } } });
    await adapter.open();
    assert.equal(announced, 1, 'the person is told once to look at the browser');
    assert.ok(postingRequests >= 3, 'the tab reloads to pick up the clearance');
    assert.equal(new URL(adapter.page.url()).origin, formOrigin);
    cleared = false;
    const timedOut = new IndeedApplyBrowser(await context.newPage(), posting, { verification: { waitMs: 150, pollMs: 20, reloadMs: 1_000 } });
    await assert.rejects(timedOut.open(), /not completed in time/);
  } finally { await browser.close(); }
});

test('mock Indeed Apply fills the profile and PDF across steps, stops at employer questions, and submits once after review', async () => {
  const { browser, page, adapter, submissions } = await openFixture();
  try {
    await adapter.open();
    assert.equal(new URL(page.url()).origin, formOrigin);
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fictional test')), 'alex-example.pdf');
    let snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /employer questions/, 'preparation stops where the person must answer');
    assert.equal(snapshot.resume, 'alex-example.pdf');
    assert.equal(snapshot.fields.find((f) => f.name === 'sponsor').value, '', 'sponsorship is never inferred');
    assert.equal(snapshot.fields.find((f) => f.name === 'sponsor').label, 'Do you need visa sponsorship? *', 'wrapped option text is not part of the label');
    assert.equal(missingRequired(snapshot.fields).length, 2);
    assert.equal((await adapter.validateForSubmission(snapshot)).ok, false, 'cannot submit before the review step');
    await adapter.fillAnswers(completeAnswers(snapshot));
    snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /Review your application/);
    assert.match(await page.locator('#reviewResume').innerText(), /alex-example\.pdf/, 'the uploaded tailored PDF is the resume on review');
    await page.getByRole('button', { name: 'Submit your application' }).click();
    assert.equal(submissions(), 0, 'native browser submission is blocked during review');
    assert.equal((await adapter.validateForSubmission(snapshot)).ok, true);
    const result = await adapter.submitOnce();
    assert.equal(result.dispatched, true);
    assert.match(result.confirmation, /application has been submitted/i);
    assert.equal(submissions(), 1);
    // A second native click cannot send another request after the approved one.
    await page.getByRole('button', { name: 'Submit your application' }).click().catch(() => {});
    assert.equal(submissions(), 1);
  } finally { await browser.close(); }
});

test('contact details typed on the first step are what the person entered, and the trap field stays empty', async () => {
  const { browser, adapter, page } = await openFixture();
  try {
    await adapter.open();
    const snapshot = await adapter.snapshot();
    await adapter.fillAnswers(Object.fromEntries(snapshot.fields.filter((f) => ['firstName', 'lastName'].includes(f.name)).map((f) => [f.id, f.name === 'firstName' ? 'Alex' : 'Example'])));
    assert.match(await page.locator('h1').innerText(), /Add a resume/, 'saving complete answers advances to the next step');
    await page.goBack(); await page.waitForTimeout(200);
    const contact = await adapter.snapshot();
    assert.equal(contact.fields.find((f) => f.name === 'trap').value, '');
    assert.equal(contact.fields.some((f) => f.name === 'email'), false, 'read-only fields are not editable answers');
  } finally { await browser.close(); }
});

test('an unconfirmed submission is uncertain and never retried', async () => {
  const { browser, adapter, page, submissions } = await openFixture({ submitStatus: 500 });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'cv.pdf');
    await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    const result = await adapter.submitOnce(500);
    assert.equal(result.confirmation, null); assert.equal(result.dispatched, true); assert.equal(submissions(), 1);
    await assert.rejects(adapter.submitOnce(500), /already attempted/);
    await page.getByRole('button', { name: 'Submit your application' }).click().catch(() => {});
    assert.equal(submissions(), 1);
  } finally { await browser.close(); }
});

test('autofill never guesses answers from contact keywords inside employer questions', () => {
  for (const label of ["Manager's name", 'Name of emergency contact', 'Email of reference', 'Preferred work location', 'Are you willing to relocate to this city?', 'Do you have a mobile phone?', 'Street address']) {
    assert.equal(profileAnswer(label, profile), null, label);
  }
});

test('unknown required contact questions pause and then resume the tailored CV upload', async () => {
  const earlyQuestion = formHtml.replace('<label>Do you need visa sponsorship?<input name="trap"></label>', '<label>Do you need visa sponsorship?<input name="trap"></label><label>Availability *<input name="availability" required></label>');
  const { browser, adapter } = await openFixture({ formHtml: earlyQuestion });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    let snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /contact information/);
    assert.equal(snapshot.readyToSubmit, false);
    const field = snapshot.fields.find(f => f.name === 'availability');
    await adapter.fillAnswers({ [field.id]: 'Answer supplied by applicant' });
    snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /employer questions/);
    assert.equal(snapshot.resume, 'tailored.pdf');
  } finally { await browser.close(); }
});

test('the resume step is read only after its loading spinner is gone, so the tailored CV is still uploaded', async () => {
  // Indeed's resume module first shows a spinner while it loads the saved resumes; the upload controls render afterwards.
  const slow = formHtml.replace("function render() {\n  const path = location.pathname;", `function render() {
  const path = location.pathname;
  if (path.endsWith('/resume') && !window.__resumeLoaded) {
    window.__resumeLoaded = true;
    document.getElementById('app').innerHTML = '<h1>Add a resume</h1><svg role="img" aria-labelledby="ifl-Spinner-title-x" width="40" height="40"><title id="ifl-Spinner-title-x">Loading</title><circle cx="20" cy="20" r="15"></circle></svg>';
    setTimeout(render, 4000); return;
  }`);
  assert.notEqual(slow, formHtml, 'the fixture must show the spinner');
  const { browser, adapter, submissions } = await openFixture({ formHtml: slow });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'slow-tailored.pdf');
    const snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /employer questions/);
    assert.equal(snapshot.resume, 'slow-tailored.pdf');
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('the current saved-resume card selects and replaces its hidden unnamed file input', async () => {
  const modern = formHtml
    .replace('<label><input type="radio" name="resumeChoice" value="upload">', '<label data-testid="resume-selection-file-resume-radio-card-label"><input type="radio" name="resumeChoice" value="upload" style="position:absolute;opacity:0;width:0;height:0" data-testid="resume-selection-file-resume-radio-card-input">')
    .replace('<label>Resume file<input type="file" name="resume" required></label>', '<input type="file" data-testid="resume-selection-file-resume-radio-card-file-input" style="display:none" required>');
  const { browser, adapter, submissions } = await openFixture({ formHtml: modern });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'new-tailored.pdf');
    const snapshot = await adapter.snapshot();
    assert.match(snapshot.title, /employer questions/);
    assert.equal(snapshot.resume, 'new-tailored.pdf');
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('an account email mismatch stops before uploading the applicant CV', async () => {
  const { browser, adapter, page, submissions } = await openFixture({ formHtml: formHtml.replace('value="alex@example.test"', 'value="different@example.test"') });
  try {
    await adapter.open();
    await assert.rejects(adapter.fillProfile(profile, new Uint8Array(Buffer.from('fixture')), 'tailored.pdf'), /contact email differs/);
    assert.match(await page.locator('h1').innerText(), /contact information/);
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('final review must confirm the tailored resume and match the review the user approved', async () => {
  const { browser, adapter, page, submissions } = await openFixture();
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    const reviewed = await adapter.snapshot();
    assert.equal(reviewed.readyToSubmit, true); assert.match(reviewed.reviewText, /tailored.pdf/);
    await page.locator('#reviewResume').evaluate(element => { element.textContent = 'old-resume.pdf'; });
    const changed = await adapter.snapshot();
    assert.equal(changed.resume, ''); assert.equal(changed.readyToSubmit, false);
    assert.equal((await adapter.validateForSubmission(reviewed)).ok, false);
    assert.equal((await adapter.validateForSubmission(changed)).ok, false);
    await page.locator('#reviewResume').evaluate(element => { element.textContent = 'tailored.pdf'; element.parentElement.append(' Changed contact details'); });
    assert.equal((await adapter.validateForSubmission(reviewed)).ok, false, 'Changing read-only review content requires a fresh review');
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('a different file-upload purpose is never filled with the CV', async () => {
  const otherUpload = formHtml.replace('Resume file<input type="file" name="resume" required>', 'Profile photo<input type="file" name="photo" required>');
  const { browser, adapter, page, submissions } = await openFixture({ formHtml: otherUpload });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    assert.equal(await page.locator('input[type=file]').evaluate(el => el.files.length), 0);
    assert.equal((await adapter.snapshot()).resume, '');
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
});

test('a review page that lists no resume at all is confirmed by the upload step; one naming a different resume is not', async () => {
  const silentReview = formHtml.replace("'<h1>Review your application</h1><form id=\"f\"><p>Resume: <span id=\"reviewResume\"></span></p>", "'<h1>Review your application</h1><form id=\"f\"><p>You won’t be able to edit your application after you submit. <a href=\"#\">Preview what the employer sees</a></p><span id=\"reviewResume\" hidden></span>");
  assert.notEqual(silentReview, formHtml);
  const { browser, adapter, submissions } = await openFixture({ formHtml: silentReview });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    const reviewed = await adapter.snapshot();
    assert.match(reviewed.title, /Review your application/);
    assert.equal(reviewed.resume, 'tailored.pdf'); assert.equal(reviewed.readyToSubmit, true); assert.equal(reviewed.notice, '');
    assert.equal((await adapter.validateForSubmission(reviewed)).ok, true);
    assert.equal(submissions(), 0);
  } finally { await browser.close(); }
  const indeedResume = formHtml.replace("document.getElementById('reviewResume').textContent = state.file || 'Indeed Resume'", "document.getElementById('reviewResume').textContent = 'Indeed Resume'");
  assert.notEqual(indeedResume, formHtml);
  const other = await openFixture({ formHtml: indeedResume });
  try {
    await other.adapter.open();
    await other.adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    await other.adapter.fillAnswers(completeAnswers(await other.adapter.snapshot()));
    const reviewed = await other.adapter.snapshot();
    assert.equal(reviewed.resume, ''); assert.equal(reviewed.readyToSubmit, false); assert.match(reviewed.notice, /does not confirm/);
    assert.equal(other.submissions(), 0);
  } finally { await other.browser.close(); }
});

test("a reCAPTCHA checkbox that disables Indeed's submit button pauses with an instruction and clears once it is ticked", async () => {
  const gated = formHtml.replace("'<h1>Review your application</h1><form id=\"f\"><p>Resume: <span id=\"reviewResume\"></span></p><button type=\"submit\">Submit your application</button></form>'",
    "'<h1>Review your application</h1><form id=\"f\"><p>Resume: <span id=\"reviewResume\"></span></p><div class=\"g-recaptcha\" style=\"width:300px;height:76px\"><iframe title=\"reCAPTCHA\" src=\"https://www.google.com/recaptcha/api2/anchor?k=test\" style=\"width:300px;height:76px\"></iframe></div><p>I\\'m not a robot</p><textarea name=\"g-recaptcha-response\" style=\"display:none\"></textarea><button type=\"submit\" id=\"submitBtn\">Submit your application</button></form>'");
  assert.notEqual(gated, formHtml);
  const { browser, adapter, page, submissions } = await openFixture({ formHtml: gated });
  try {
    await adapter.open();
    await adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'tailored.pdf');
    await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    const blocked = await adapter.snapshot();
    assert.equal(blocked.notice, CAPTCHA_NOTICE); assert.equal(blocked.readyToSubmit, false); assert.equal(blocked.resume, 'tailored.pdf');
    assert.equal((await adapter.validateForSubmission(blocked)).ok, false);
    // The person ticks the box: reCAPTCHA writes its token into the page.
    await page.locator('textarea[name="g-recaptcha-response"]').evaluate((field) => { field.value = 'token-from-recaptcha'; });
    const cleared = await adapter.snapshot();
    assert.equal(cleared.notice, ''); assert.equal(cleared.readyToSubmit, true);
    assert.equal((await adapter.validateForSubmission(cleared)).ok, true);
    const result = await adapter.submitOnce();
    assert.equal(result.dispatched, true); assert.match(result.confirmation, /submitted/i); assert.equal(submissions(), 1);
  } finally { await browser.close(); }
});

test('a temporarily disabled Submit button is pending, not falsely reported as reCAPTCHA', async () => {
  const {browser,adapter,page,submissions}=await openFixture();
  try {
    await adapter.open();await adapter.fillProfile(profile,new Uint8Array(Buffer.from('%PDF fixture')),'tailored.pdf');await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    await page.getByRole('button',{name:'Submit your application'}).evaluate(button=>{button.disabled=true;});
    const pending=await adapter.snapshot();assert.equal(pending.submissionBlock,'pending');assert.equal(pending.readyToSubmit,false);assert.doesNotMatch(pending.notice,/robot|CAPTCHA/);
    await page.getByRole('button',{name:'Submit your application'}).evaluate(button=>{button.disabled=false;});
    const ready=await adapter.snapshot();assert.equal(ready.readyToSubmit,true);assert.equal(ready.submissionBlock,undefined);assert.equal(submissions(),0);
  } finally {await browser.close();}
});
test('invisible reCAPTCHA badges and hidden widgets do not block a ready application',async()=>{
  const {browser,adapter,page}=await openFixture();
  try {
    await adapter.open();await adapter.fillProfile(profile,new Uint8Array(Buffer.from('%PDF fixture')),'tailored.pdf');await adapter.fillAnswers(completeAnswers(await adapter.snapshot()));
    await page.evaluate(()=>{const widget=document.createElement('div');widget.innerHTML='<div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe></div><div style="visibility:hidden"><div class="g-recaptcha" style="width:300px;height:76px"></div><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe></div>';document.body.append(widget);});
    assert.equal((await adapter.snapshot()).readyToSubmit,true);
    // An actually visible challenge remains a blocker, even when an earlier response token exists.
    await page.evaluate(()=>{const w=document.createElement('div');w.innerHTML='<iframe src="https://www.google.com/recaptcha/api2/bframe" style="width:300px;height:300px"></iframe><textarea name="g-recaptcha-response" hidden>expired-test-token</textarea>';document.body.append(w);});
    const blocked=await adapter.snapshot();assert.equal(blocked.submissionBlock,'captcha');assert.equal(blocked.readyToSubmit,false);
  } finally {await browser.close();}
});

test('Save and close saves the tailored CV and filled answers without sending a submission', async () => {
  const { withDraftSaving } = await import('./indeed-fixture.mjs');
  const fixture = await openFixture({ formHtml: withDraftSaving() });
  let saved;
  await fixture.context.route(`${formOrigin}/api/draft`, route => { saved = route.request().postDataJSON(); return route.fulfill({contentType:'application/json',body:'{}'}); });
  try {
    await fixture.adapter.open();
    await fixture.adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), 'daniel-tailored.pdf');
    await fixture.adapter.fillAnswers(completeAnswers(await fixture.adapter.snapshot()));
    const result = await fixture.adapter.saveDraft();
    assert.equal(result.saved,true,JSON.stringify(result));
    assert.match(result.draft.evidence,/application has been saved/);
    assert.equal(result.draft.continueUrl,posting,'the draft continues from the posting, which offers Continue application');
    assert.equal(saved.resume,'daniel-tailored.pdf');
    assert.equal(saved.answers.experience,'I built Python services.');
    assert.equal(fixture.submissions(),0);
  } finally { await fixture.browser.close(); }
});

test('a save click without acknowledgement is unconfirmed and cannot be repeated automatically', async () => {
  const { withDraftSaving } = await import('./indeed-fixture.mjs');
  const fixture = await openFixture({ formHtml: withDraftSaving(formHtml,{confirm:false}) });
  let saves=0;
  await fixture.context.route(`${formOrigin}/api/draft`, route => { saves++; return route.fulfill({status:500,body:'{}'}); });
  try {
    await fixture.adapter.open();
    const result=await fixture.adapter.saveDraft();
    assert.equal(result.saved,false);assert.equal(result.attempted,true);
    assert.match(result.message,/does not show Continue application/);
    await fixture.adapter.saveDraft();assert.equal(saves,1);assert.equal(fixture.submissions(),0);
  } finally { await fixture.browser.close(); }
});

test('missing Save and close does not pretend a local draft is saved on Indeed',async()=>{
  const fixture=await openFixture();
  try { await fixture.adapter.open();const result=await fixture.adapter.saveDraft();assert.equal(result.saved,false);assert.equal(result.attempted,false);assert.equal(fixture.submissions(),0); }
  finally {await fixture.browser.close();}
});

test('draft saving is forbidden after a dispatched submission with no confirmation',async()=>{
  const {withDraftSaving}=await import('./indeed-fixture.mjs');
  const fixture=await openFixture({formHtml:withDraftSaving(),submitStatus:500});
  try {
    await fixture.adapter.open();await fixture.adapter.fillProfile(profile,new Uint8Array(Buffer.from('%PDF-1.4')),'tailored.pdf');
    await fixture.adapter.fillAnswers(completeAnswers(await fixture.adapter.snapshot()));
    assert.equal((await fixture.adapter.submitOnce(50)).dispatched,true);
    await assert.rejects(fixture.adapter.saveDraft(),/submission outcome/);assert.equal(fixture.submissions(),1);
  } finally {await fixture.browser.close();}
});

test('a save without a receipt is confirmed by the posting showing Continue application; a posting still offering Apply is not',async()=>{
  const {withDraftSaving}=await import('./indeed-fixture.mjs');
  for(const started of [true,false]){
    const fixture=await openFixture({formHtml:withDraftSaving(formHtml,{confirm:false})});
    await fixture.context.route(`${formOrigin}/api/draft`,route=>route.fulfill({contentType:'application/json',body:'{}'}));
    // My jobs must not be consulted: it lists drafts only for the account's own country.
    await fixture.context.route('https://myjobs.indeed.com/**',()=>assert.fail('My jobs must not be used to confirm a draft'));
    // Reproduce the worker's navigation policy: the posting check opens a tab in the same context.
    await fixture.context.route('**/*', route => {
      const request = route.request();
      return request.isNavigationRequest() && !request.frame().parentFrame() && !fixture.adapter.allowsNavigation(request.url()) ? route.abort() : route.fallback();
    });
    try {
      await fixture.adapter.open();
      // After the save, the posting reflects Indeed's stored state.
      await fixture.context.route('https://de.indeed.com/**',route=>route.fulfill({contentType:'text/html',body:postingHtml(true,true,{started})}));
      const result=await fixture.adapter.saveDraft();
      assert.equal(result.saved,started,JSON.stringify(result));
      if(started){assert.match(result.draft.evidence,/Continue application/);assert.equal(result.draft.continueUrl,posting);}
      else{assert.equal(result.attempted,true);assert.match(result.message,/does not show Continue application/);assert.equal(await fixture.adapter.verifyDraft(),null);}
      assert.equal(fixture.submissions(),0);
    }
    finally {await fixture.browser.close();}
  }
});

test('resume upload confirmation ignores hidden duplicate filenames', async () => {
  const filename = 'Daniel-Varga-tailored.pdf';
  const fixture = await openFixture({ formHtml: formHtml.replace('<p id="fileName"></p>', `<span hidden>${filename}</span><p id="fileName"></p>`) });
  try {
    await fixture.adapter.open();
    await fixture.adapter.fillProfile(profile, new Uint8Array(Buffer.from('%PDF-1.4 fixture')), filename);
    assert.equal((await fixture.adapter.snapshot()).resume, filename);
    assert.equal(fixture.submissions(), 0);
  } finally { await fixture.browser.close(); }
});
