import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { defaultJobMaxAgeDays, indeedBaseUrl, indeedJobUrl, indeedPageProblem, indeedSearchUrls, normalizeIndeedPosting, planIndeedSearches } from './sources/indeed-data.ts';
import { localizedTitle, searchTitlesFor } from './title-localization.ts';
import { readIndeedJobPage, readIndeedSearchPage, selectIndeedCards } from './sources/indeed.ts';

process.env.INDEED_BASE_URL = 'https://de.indeed.com';
const url = 'https://de.indeed.com/viewjob?jk=6a19fac52b8fdc97';
const posting = { '@context': 'http://schema.org', '@type': 'JobPosting', title: 'Backend &amp; API Engineer', description: '<p>Build APIs.</p>\\n<p>Python required.</p>', hiringOrganization: { '@type': 'Organization', name: 'Example' }, jobLocation: { '@type': 'Place', address: { addressLocality: 'Berlin', addressCountry: 'DE' } }, jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'Germany' }, datePosted: '2026-09-01T10:00:00Z', validThrough: '2027-01-01T00:00:00Z', directApply: true };
const card = { jobkey: '6a19fac52b8fdc97', title: 'Backend & API Engineer', company: 'Example', formattedLocation: '10115 Berlin', remoteLocation: false, pubDate: 1756720000000, indeedApplyable: true, expired: false };
const profile = { titles: ['Backend Engineer', 'Platform Engineer', 'API Developer'], skills: ['Python'], seniority: 'junior', locations: [], remotePreference: 'any', keywords: [], maxAgeDays: 14 };
const cards = (results, loggedIn = false) => `<body><script>window.mosaic={providerData:{"mosaic-provider-jobcards":{metaData:{mosaicProviderJobCardsModel:{results:${JSON.stringify(results)},loggedIn:${loggedIn}}}}}}</script><div id="mosaic-provider-jobcards"></div></body>`;

test('Indeed is the only default source and refinement keeps paging it', async () => {
  const old = process.env.JOB_SOURCES; delete process.env.JOB_SOURCES;
  try {
    const { jobSources } = await import('./sources/index.ts');
    assert.deepEqual(jobSources().map((source) => source.name), ['indeed']);
    process.env.JOB_SOURCES = 'wellfound'; assert.deepEqual(jobSources(), []);
    const { refineJobSearch } = await import('../ai/search-refinement.ts');
    const result = await refineJobSearch({ providerName: 'ollama', model: 'test', requestStructuredCompletion: async () => ({ ok: true, content: '{"plan":{"strategy":"broader_category","reason":"Remove all filters"}}' }) }, { preferences: { titles: [], locations: [], remotePreference: 'any', seniority: 'any' }, round: 2, suitable: 0, previousPlans: ['next_pages'], missing: [], considered: 10 });
    assert.equal(result.strategy, 'next_pages'); assert.doesNotMatch(result.reason, /Remove/);
  } finally { if (old === undefined) delete process.env.JOB_SOURCES; else process.env.JOB_SOURCES = old; }
});

test('Indeed keeps exact source descriptions, remote hiring restrictions and the Indeed Apply flag', () => {
  const job = normalizeIndeedPosting(url, { scripts: [JSON.stringify(posting)], indeedApply: false }, card);
  assert.equal(job.title, 'Backend & API Engineer');
  assert.equal(job.description, 'Build APIs.\nPython required.');
  assert.equal(job.externalId, '6a19fac52b8fdc97'); assert.equal(job.source, 'indeed'); assert.equal(job.url, url);
  assert.equal(job.remote, true); assert.match(job.location, /Berlin, DE/); assert.match(job.location, /hires in Germany/);
  assert.equal(job.raw.indeedApply, false, 'directApply and stale card metadata do not prove the posting supports Indeed Apply');
  assert.equal(job.postedAt.toISOString(), '2026-09-01T10:00:00.000Z');
  const plain = normalizeIndeedPosting(url, { scripts: [JSON.stringify({ ...posting, directApply: false, jobLocation: undefined, jobLocationType: undefined, applicantLocationRequirements: undefined, datePosted: undefined })], indeedApply: false }, { ...card, indeedApplyable: false });
  assert.equal(plain.raw.indeedApply, false); assert.equal(plain.remote, false); assert.equal(plain.location, '10115 Berlin'); assert.equal(plain.postedAt.getTime(), card.pubDate);
  assert.equal(normalizeIndeedPosting(url, { scripts: [JSON.stringify({ ...posting, validThrough: '2020-01-01' })], indeedApply: true }), null);
  assert.equal(normalizeIndeedPosting(url, { scripts: ['bad', JSON.stringify({ ...posting, description: '' })], indeedApply: true }), null);
});

test('Indeed canonicalizes only posting URLs on Indeed country sites', () => {
  assert.equal(indeedJobUrl('https://de.indeed.com/viewjob?jk=6A19FAC52B8FDC97&from=serp&vjs=3'), url);
  assert.equal(indeedJobUrl('https://www.indeed.com/rc/clk?jk=6a19fac52b8fdc97&fccid=abc'), 'https://www.indeed.com/viewjob?jk=6a19fac52b8fdc97');
  for (const value of ['https://evil.test/viewjob?jk=6a19fac52b8fdc97', 'https://indeed.com.evil.test/viewjob?jk=6a19fac52b8fdc97', 'https://x:y@de.indeed.com/viewjob?jk=6a19fac52b8fdc97', 'https://de.indeed.com/viewjob?jk=short', 'https://secure.indeed.com/auth?jk=6a19fac52b8fdc97', 'https://de.indeed.com/jobs?q=engineer', 'javascript:alert(1)']) assert.equal(indeedJobUrl(value), null, value);
  assert.equal(indeedBaseUrl('https://uk.indeed.com'), 'https://uk.indeed.com');
  assert.throws(() => indeedBaseUrl('https://indeed.evil.test'));
});

test('blank location settings search internationally and are independent of CV history and configured country', async () => {
  const {applySearchPreferences,defaultSearchPreferences}=await import('./preferences.ts');
  const spec=applySearchPreferences({...profile,locations:['Vienna'],remotePreference:'onsite'},defaultSearchPreferences);
  const plan=planIndeedSearches(spec,0,'https://at.indeed.com');
  const urls=plan.urls.map(u=>new URL(u));
  // Twelve markets: three titles with local forms would exceed the cap, so all three English titles run, one page each.
  assert.equal(urls.length,36);assert.deepEqual(plan.titles,['Backend Engineer','Platform Engineer','API Developer']);assert.equal(plan.localized,false);assert.equal(plan.pagesPerQuery,1);assert.equal(plan.page,1);
  assert.equal(new Set(urls.map(u=>u.origin)).size,12);
  assert.ok(urls.every(u=>u.searchParams.get('l')),'no query delegates location to account/IP defaults');
  assert.ok(urls.some(u=>u.hostname==='de.indeed.com'&&u.searchParams.get('l')==='Deutschland'));
  assert.ok(urls.some(u=>u.hostname==='www.indeed.com'&&u.searchParams.get('l')==='United States'));
  assert.ok(urls.every(u=>u.searchParams.get('l')!=='Vienna'));
  assert.ok(urls.every(u=>!u.searchParams.has('sort')),'relevance order within the posting-age window');
  assert.deepEqual(indeedSearchUrls(spec,0,'https://www.indeed.com'),urls.map(u=>u.href));
  assert.deepEqual(indeedSearchUrls(applySearchPreferences({...profile,locations:['Tokyo']},defaultSearchPreferences),0),urls.map(u=>u.href));
});
test('a single market searches every title, its local-language form, and three pages per query; later rounds page on',()=>{
  const plan=planIndeedSearches({...profile,titles:['Backend Engineer','Software Engineer','Platform Engineer','Go Developer'],locations:['France']},0,'https://at.indeed.com');
  assert.deepEqual(plan.titles,['Backend Engineer','Software Engineer','Platform Engineer','Go Developer']);assert.equal(plan.localized,true);assert.equal(plan.queries,8);assert.equal(plan.pagesPerQuery,3);assert.equal(plan.urls.length,24);
  const urls=plan.urls.map(u=>new URL(u));
  assert.ok(urls.every(u=>u.hostname==='fr.indeed.com'&&u.searchParams.get('l')==='France'));
  assert.deepEqual([...new Set(urls.map(u=>u.searchParams.get('q')))],['Backend Engineer','ingénieur backend','Software Engineer','ingénieur logiciel','Platform Engineer','ingénieur plateforme','Go Developer','développeur go']);
  // Page by page across every query: the first eight URLs are page one of each query.
  assert.deepEqual(urls.slice(0,8).map(u=>u.searchParams.get('start')),Array(8).fill(null));
  assert.deepEqual(urls.slice(8,16).map(u=>u.searchParams.get('start')),Array(8).fill('10'));
  assert.deepEqual(urls.slice(16).map(u=>u.searchParams.get('start')),Array(8).fill('20'));
  const later=planIndeedSearches({...profile,titles:['Backend Engineer','Software Engineer','Platform Engineer','Go Developer'],locations:['France']},1,'https://at.indeed.com').urls.map(u=>new URL(u).searchParams.get('start'));
  assert.deepEqual([...new Set(later)],['30','40','50'],'round two continues with the next three pages');
});
test('explicit locations stay exclusive and choose their country sites; the page cap sheds local forms before titles',()=>{
  const plan=planIndeedSearches({...profile,titles:['Backend Engineer'],locations:['Berlin','United Kingdom','Canada','Austria','Singapore']},1,'https://at.indeed.com');
  const urls=plan.urls.map(u=>new URL(u));
  assert.equal(plan.queries,7,'German markets add a local form');assert.equal(plan.pagesPerQuery,3);
  assert.deepEqual([...new Set(urls.map(u=>u.hostname))],['de.indeed.com','uk.indeed.com','ca.indeed.com','at.indeed.com','sg.indeed.com']);
  assert.deepEqual([...new Set(urls.map(u=>u.searchParams.get('l')))],['Berlin','United Kingdom','Canada','Österreich','Singapore']);
  assert.ok(urls.some(u=>u.hostname==='de.indeed.com'&&u.searchParams.get('q')==='Backend Entwickler'));
  assert.ok(urls.every(u=>['30','40','50'].includes(u.searchParams.get('start'))),'round two starts after the three pages of round one');
  const [city]=indeedSearchUrls({...profile,titles:['Backend Engineer'],locations:['Toronto, Canada']},0);
  assert.equal(new URL(city).hostname,'ca.indeed.com');assert.equal(new URL(city).searchParams.get('l'),'Toronto, Canada');
  const capped=planIndeedSearches({...profile,titles:['Backend Engineer','Software Engineer','Platform Engineer'],locations:['France','Germany','Spain','Italy','Netherlands','Portugal']},0,'https://at.indeed.com',12);
  assert.deepEqual(capped.titles,['Backend Engineer','Software Engineer']);assert.equal(capped.localized,false);assert.equal(capped.queries,12);assert.equal(capped.pagesPerQuery,1);
});
test('when not every title fits a round, later rounds rotate through the titles before turning the page',()=>{
  const spec={...profile,titles:['AI researcher','Machine Learning Engineer','AI Engineer','Research Engineer','Backend Engineer'],locations:[]};
  const rounds=[0,1,2,3].map(round=>planIndeedSearches(spec,round,'https://at.indeed.com',48));
  assert.deepEqual(rounds.map(plan=>plan.titles),[
    ['AI researcher','Machine Learning Engineer','AI Engineer','Research Engineer'],
    ['Backend Engineer','AI researcher','Machine Learning Engineer','AI Engineer'],
    ['Research Engineer','Backend Engineer','AI researcher','Machine Learning Engineer'],
    ['AI Engineer','Research Engineer','Backend Engineer','AI researcher'],
  ]);
  assert.deepEqual(rounds.map(plan=>plan.page),[1,1,2,3],'the page turns only once the whole pool has been searched');
  assert.ok(rounds[0].urls.every(u=>!new URL(u).searchParams.has('start')));assert.ok(rounds[2].urls.every(u=>new URL(u).searchParams.get('start')==='10'));
});
test('local-language titles keep the role noun and modifiers of the English title and never replace the English query',()=>{
  assert.equal(localizedTitle('Backend Engineer','fr'),'ingénieur backend');
  assert.equal(localizedTitle('Software Engineer','fr'),'ingénieur logiciel');
  assert.equal(localizedTitle('Machine Learning Engineer','fr'),'ingénieur machine learning');
  assert.equal(localizedTitle('Software Engineer','de'),'Software Entwickler');
  assert.equal(localizedTitle('Senior Backend Developer','es'),'desarrollador backend');
  assert.equal(localizedTitle('Data Engineer','pt'),'engenheiro de dados');
  assert.equal(localizedTitle('Software Engineer','nl'),null,'an unchanged phrase yields no local form');
  assert.equal(localizedTitle('Product Owner','fr'),null,'no role noun to translate');
  assert.equal(localizedTitle('Backend Engineer','gb'),null,'English markets have no local form');
  assert.deepEqual(searchTitlesFor('Backend Engineer','fr'),['Backend Engineer','ingénieur backend']);
  assert.deepEqual(searchTitlesFor('Backend Engineer','us'),['Backend Engineer']);
});
test('international and explicit searches preserve remote and posting-age filters',()=>{
  for(const locations of [[],['Berlin']]){
    const urls=indeedSearchUrls({...profile,locations,remotePreference:'remote'},5).map(u=>new URL(u));
    assert.ok(urls.every(u=>u.searchParams.get('sc')==='0kf:attr(DSQF7);'&&u.searchParams.get('fromage')==='14'&&Number(u.searchParams.get('start'))>=10),'round six is past the first page');
    assert.ok(indeedSearchUrls({...profile,locations,maxAgeDays:7},0).every(u=>new URL(u).searchParams.get('fromage')==='7'));
    assert.ok(indeedSearchUrls({...profile,locations,maxAgeDays:0},0).every(u=>!new URL(u).searchParams.has('fromage')));
  }
  assert.equal(defaultJobMaxAgeDays(undefined),14);assert.equal(defaultJobMaxAgeDays('7'),7);assert.equal(defaultJobMaxAgeDays('0'),0);assert.equal(defaultJobMaxAgeDays('30'),14);assert.equal(defaultJobMaxAgeDays('nope'),14);
  assert.throws(()=>indeedSearchUrls({...profile,titles:[]},0));
});
test('country preferences recognize job country codes without treating the CV as a restriction',async()=>{
  const {jobMeetsPreferences,defaultSearchPreferences}=await import('./preferences.ts');
  const job={location:'Berlin, DE',remote:false,description:''};
  assert.equal(jobMeetsPreferences(job,defaultSearchPreferences),true);
  assert.equal(jobMeetsPreferences(job,{...defaultSearchPreferences,locations:['Germany']}),true);
  assert.equal(jobMeetsPreferences(job,{...defaultSearchPreferences,locations:['Austria']}),false);
  assert.equal(jobMeetsPreferences({...job,location:'Wien, W, AT'},{...defaultSearchPreferences,locations:['Austria']}),true);
  assert.equal(jobMeetsPreferences({...job,location:'Remote in Europe'},{...defaultSearchPreferences,locations:['India']}),false);
});

test('sign-in, block and verification pages are reported, never treated as empty results', () => {
  assert.match(indeedPageProblem('https://secure.indeed.com/auth?continue=x', 'Anmelden', ''), /sign-in/);
  assert.match(indeedPageProblem('https://de.indeed.com/jobs', 'Blocked - Indeed.com', 'Request Blocked'), /blocked/);
  assert.match(indeedPageProblem('https://de.indeed.com/jobs', 'Just a moment', ''), /verification/);
  assert.match(indeedPageProblem('https://at.indeed.com/viewjob?jk=x', 'Bir dakika lütfen...', 'Performing additional browser verification... Your Ray ID for this request is a3cb26f6da042942'), /verification/, 'localized challenge pages are recognised by their Ray ID');
  assert.match(indeedPageProblem('https://smartapply.indeed.com/form', 'Application', 'Please complete the CAPTCHA to continue'), /verification/);
  assert.equal(indeedPageProblem('https://smartapply.indeed.com/form', 'Upload or create a resume for this application | Indeed', 'Add a resume\nDiese Website ist durch reCAPTCHA geschützt und unterliegt der Datenschutzerklärung und den Nutzungsbedingungen von Google.'), null);
  assert.equal(indeedPageProblem('https://de.indeed.com/jobs', 'Backend Engineer Jobs', 'Find jobs'), null);
});

test('Chromium reads and caches search cards and full postings; sign-in redirects and blocks cannot become empty results', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'indeed-pages-')); const previous = process.env.JOB_SOURCE_CACHE_DIR; process.env.JOB_SOURCE_CACHE_DIR = directory;
  const browser = await chromium.launch(); const context = await browser.newContext(); let requests = 0;
  await context.route('**/*', async (route) => {
    requests++; const address = new URL(route.request().url());
    if (address.hostname === 'secure.indeed.com') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Sign in</title><body>Create an account or sign in</body>' });
    if (address.searchParams.get('start') === '10') return route.fulfill({ status: 302, headers: { location: 'https://secure.indeed.com/auth?continue=x' } });
    if (address.searchParams.get('q') === 'blocked') return route.fulfill({ status: 403, contentType: 'text/html', body: '<title>Blocked - Indeed.com</title><body>Request Blocked</body>' });
    if (address.searchParams.get('q') === 'empty') return route.fulfill({ status: 200, contentType: 'text/html', body: cards([]).replace('<div', "<div class='x'>We didn't find any results</div><div") });
    // The signed-in layout: no global, the model is JSON text inside a bundled script, and result links carry only aria-labels.
    if (address.pathname === '/jobs' && address.searchParams.get('q') === 'bundled') return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>(()=>{"use strict";var m={"x":1,"mosaicProviderJobCardsModel":${JSON.stringify({ results: [card, { ...card, jobkey: 'bbbbbbbbbbbbbbbb', title: 'Quote "Engineer" {}' }], loggedIn: true })},"y":"}"};})()</script><ul><li><a data-jk="6a19fac52b8fdc97" aria-label="tous les détails sur « Backend »"></a></li></ul></body>` });
    if (address.pathname === '/jobs') return route.fulfill({ status: 200, contentType: 'text/html', body: cards([card, { jobkey: 'bad', title: 'x' }, { ...card, jobkey: 'aaaaaaaaaaaaaaaa', expired: true }], true) });
    if (address.searchParams.get('jk') === 'bbbbbbbbbbbbbbbb') return route.fulfill({ status: 200, contentType: 'text/html', body: '<body><h1>Gone</h1></body>' });
    // A current company-site posting: the view-job model says no Indeed Apply, and the header is rendered client-side.
    if (address.searchParams.get('jk') === 'dddddddddddddddd') return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>window._initialData={viewJobClientSideModel:{loggedIn:true,indeedApplyButtonContainer:null}}</script><h1>Backend Engineer</h1><div data-testid="primary-apply-action"></div><script>setTimeout(()=>{document.querySelector('[data-testid=primary-apply-action]').innerHTML='<button data-testid="viewjob-apply">Weiter zur Bewerbung</button>'},50)</script><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
    // The signed-in page variant: no global at all, the model is JSON text inside a bundled inline script, the header renders later.
    if (address.searchParams.get('jk') === 'ffffffffffffffff') return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>(()=>{"use strict";var m=${JSON.stringify({ viewJobClientSideModel: { loggedIn: true, indeedApplyButtonContainer: { indeedApplyBaseUrl: 'https://apply.indeed.com' } } })};})()</script><h1>Backend Engineer</h1><div data-testid="primary-apply-action"></div><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
    if (address.searchParams.get('jk') === 'abababababababab') return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>(()=>{"use strict";var m=${JSON.stringify({ viewJobClientSideModel: { loggedIn: true, indeedApplyButtonContainer: null } })};})()</script><h1>Backend Engineer</h1><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
    // A current Indeed Apply posting whose anchor only appears after hydration: the model flag must be enough.
    if (address.searchParams.get('jk') === 'eeeeeeeeeeeeeeee') return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>window._initialData={viewJobClientSideModel:{loggedIn:false,indeedApplyButtonContainer:{indeedApplyBaseUrl:"https://apply.indeed.com"}}}</script><h1>Backend Engineer</h1><div data-testid="primary-apply-action"></div><script>setTimeout(()=>{document.querySelector('[data-testid=primary-apply-action]').innerHTML='<a data-testid="viewjob-indeed-apply" href="https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=x">Jetzt bewerben</a>'},2000)</script><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>window._initialData={loggedIn:true}</script><h1>Backend Engineer</h1><a href="https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=fixture">Jetzt bewerben</a><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
  });
  try {
    const search = await readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=backend');
    assert.deepEqual(search.cards.map((item) => item.jobkey), ['6a19fac52b8fdc97', 'aaaaaaaaaaaaaaaa'], 'malformed cards are dropped');
    assert.equal(search.loggedIn, true); const afterFirst = requests;
    assert.deepEqual(await readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=backend'), search); assert.equal(requests, afterFirst, 'cached page makes no request');
    assert.equal((await readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=empty')).empty, true);
    const bundled = await readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=bundled');
    assert.deepEqual(bundled.cards.map((item) => [item.jobkey, item.indeedApplyable, item.title]), [['6a19fac52b8fdc97', true, card.title], ['bbbbbbbbbbbbbbbb', true, 'Quote "Engineer" {}']], 'the bundled model is read with apply flags, not the aria-label links');
    assert.equal(bundled.loggedIn, true);
    await assert.rejects(readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=backend&start=10'), /sign-in/);
    await assert.rejects(readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=blocked'), /blocked/);
    assert.equal((await readIndeedSearchPage(context, 'https://www.indeed.com/jobs?q=other&l=United+States')).cards.length, 2);
    await assert.rejects(readIndeedSearchPage(context, 'https://evil.test/jobs?q=other'), /Indeed/);
    const job = await readIndeedJobPage(context, url);
    assert.equal(job.indeedApply, true); assert.equal(job.loggedIn, true);
    assert.ok(normalizeIndeedPosting(url, job, card));
    const companySite = await readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=dddddddddddddddd');
    assert.equal(companySite.indeedApply, false, 'the view-job model rules out Indeed Apply'); assert.equal(companySite.loggedIn, true, 'the sign-in flag is read from the view-job model');
    const hydrated = await readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=eeeeeeeeeeeeeeee');
    assert.equal(hydrated.indeedApply, true, 'the model flag counts even before the apply anchor is rendered'); assert.equal(hydrated.loggedIn, false);
    assert.equal((await readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=ffffffffffffffff')).indeedApply, true, 'the signed-in variant keeps the model inside a bundled script');
    assert.equal((await readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=abababababababab')).indeedApply, false, 'the bundled model rules out Indeed Apply too');
    await assert.rejects(readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=bbbbbbbbbbbbbbbb'), /no readable job data/);
    await assert.rejects(readIndeedJobPage(context, 'https://evil.test/viewjob?jk=6a19fac52b8fdc97'), /Invalid Indeed posting URL/);
  } finally {
    await browser.close(); await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.JOB_SOURCE_CACHE_DIR; else process.env.JOB_SOURCE_CACHE_DIR = previous;
  }
});

test('a posting page behind a bot check waits for the person to clear it, then reads the posting; by default it fails at once', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'indeed-verify-')); const previous = process.env.JOB_SOURCE_CACHE_DIR; process.env.JOB_SOURCE_CACHE_DIR = directory;
  const browser = await chromium.launch(); const context = await browser.newContext();
  let cleared = false, postingRequests = 0;
  await context.route('**/*', async (route) => {
    postingRequests++;
    if (!cleared) return route.fulfill({ status: 403, contentType: 'text/html', body: '<title>Bir dakika lütfen...</title><body><div id="challenge-stage"></div><p>Lütfen bekleyin.</p></body>' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<body><script>window._initialData={loggedIn:true}</script><h1>Backend Engineer</h1><script type="application/ld+json">${JSON.stringify(posting)}</script></body>` });
  });
  try {
    await assert.rejects(readIndeedJobPage(context, url), /browser verification/);
    let announced = 0;
    setTimeout(() => { cleared = true; }, 150);
    const page = await readIndeedJobPage(context, url, 20_000, { waitMs: 5_000, pollMs: 20, reloadMs: 40, onWaiting: () => { announced++; } });
    assert.equal(page.indeedApply, false); assert.equal(announced, 1); assert.ok(normalizeIndeedPosting(url, page, card), 'the posting is read once the check is cleared');
    assert.ok(postingRequests >= 3, 'the tab reloads to pick up the clearance');
    cleared = false;
    await assert.rejects(readIndeedJobPage(context, 'https://de.indeed.com/viewjob?jk=cccccccccccccccc', 20_000, { waitMs: 120, pollMs: 20, reloadMs: 1_000 }), /not completed in time/);
  } finally {
    await browser.close(); await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.JOB_SOURCE_CACHE_DIR; else process.env.JOB_SOURCE_CACHE_DIR = previous;
  }
});

test('search pages click a Cloudflare checkbox and read results after the original 403 clears', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'indeed-search-verify-'));
  const previous = process.env.JOB_SOURCE_CACHE_DIR; process.env.JOB_SOURCE_CACHE_DIR = directory;
  const browser = await chromium.launch(); const context = await browser.newContext();
  let clicks = 0, cleared = false;
  await context.exposeBinding('verified', () => { clicks++; cleared = true; });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname === 'challenges.cloudflare.com') {
      return route.fulfill({ contentType: 'text/html', body: `<label><input type="checkbox" onclick="verified().then(() => parent.postMessage('clear', '*'))">Verify you are human</label>` });
    }
    return route.fulfill({ status: cleared ? 200 : 403, contentType: 'text/html', body: cleared ? cards([card], true) : `<div id="challenge-stage"><iframe src="https://challenges.cloudflare.com/widget"></iframe></div><script>addEventListener('message', e => { if(e.data === 'clear') location.reload(); });</script>` });
  });
  try {
    const result = await readIndeedSearchPage(context, 'https://de.indeed.com/jobs?q=backend&l=Deutschland', 20_000, { waitMs: 5000, pollMs: 20, reloadMs: 10_000 });
    assert.equal(clicks, 1); assert.equal(result.cards[0].jobkey, card.jobkey); assert.equal(result.loggedIn, true);
  } finally {
    await browser.close(); await rm(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.JOB_SOURCE_CACHE_DIR; else process.env.JOB_SOURCE_CACHE_DIR = previous;
  }
});

test('the read-only context lets Cloudflare\'s challenge through while still blocking unrelated hosts', async () => {
  const { indeedRequestAllowed, isChallengeRequest } = await import('../indeed/browser.ts');
  assert.equal(isChallengeRequest(new URL('https://challenges.cloudflare.com/turnstile/v0/api.js')), true);
  assert.equal(isChallengeRequest(new URL('https://at.indeed.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1')), true);
  assert.equal(isChallengeRequest(new URL('https://at.indeed.com/rpc')), false);
  assert.equal(isChallengeRequest(new URL('https://evil.test/cdn-cgi/challenge-platform/x')), false);
  assert.equal(isChallengeRequest(new URL('https://www.recaptcha.net/recaptcha/enterprise.js?render=key')), true);
  assert.equal(isChallengeRequest(new URL('https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js')), true);
  assert.equal(isChallengeRequest(new URL('https://www.google.com/recaptcha/enterprise/anchor')), true);
  assert.equal(isChallengeRequest(new URL('https://www.google.com/search?q=x')), false);
  assert.equal(isChallengeRequest(new URL('https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/i/x')), true);
  assert.equal(isChallengeRequest(new URL('https://indeed-static-pages.pages.dev/i18n/tr.min.js')), true);
  assert.equal(isChallengeRequest(new URL('https://evil.pages.dev/x')), false);
  const request = (url, method = 'GET', resourceType = 'fetch', navigation = false) => ({ url, method, resourceType, navigation });
  for (const mode of ['read', 'apply']) {
    assert.equal(indeedRequestAllowed(mode, request('https://challenges.cloudflare.com/turnstile/v0/api.js', 'GET', 'script')), true, `${mode}: challenge widget loads`);
    assert.equal(indeedRequestAllowed(mode, request('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/flow', 'POST')), true, `${mode}: challenge answer via cloudflare`);
    assert.equal(indeedRequestAllowed(mode, request('https://de.indeed.com/cdn-cgi/challenge-platform/h/g/flow', 'POST')), true, `${mode}: challenge answer via indeed host`);
    assert.equal(indeedRequestAllowed(mode, request('https://de.indeed.com/viewjob?jk=6a19fac52b8fdc97', 'GET', 'document', true)), true, `${mode}: posting page`);
    assert.equal(indeedRequestAllowed(mode, request('https://tracker.example.test/pixel.png', 'GET', 'image')), false, `${mode}: third-party images`);
  }
  assert.equal(indeedRequestAllowed('read', request('https://t.indeed.com/signals/v1/log', 'POST')), true, 'read: Indeed\'s own beacons must not be blocked or the browser gets challenged');
  assert.equal(indeedRequestAllowed('read', request('https://tracker.example.test/collect', 'GET')), false, 'read: other hosts stay blocked');
  assert.equal(indeedRequestAllowed('read', request('https://evil.test/', 'GET', 'document', true)), false, 'read: navigation never leaves Indeed');
  assert.equal(isChallengeRequest(new URL('http://de.indeed.com/cdn-cgi/challenge-platform/x')), false, 'challenge hosts only over https');
  assert.equal(indeedRequestAllowed('read', request('https://prod.statics.indeed.com/app.js', 'GET', 'script')), true, 'read: Indeed-owned static hosts are allowed');
  assert.equal(indeedRequestAllowed('apply', request('https://smartapply.indeed.com/beta/indeedapply/form/submit', 'POST')), true, 'apply: the Indeed Apply form still submits');
  assert.equal(indeedRequestAllowed('apply', request('https://evil.test/', 'GET', 'document', true)), false, 'apply: navigation stays on Indeed');
});

test('automatic runs skip cards Indeed marks as company-site applications before any posting page is read', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  const fresh = (jobkey, extra = {}) => ({ ...card, jobkey, pubDate: now - 86_400_000, ...extra });
  const lists = [[fresh('aaaaaaaaaaaaaaaa', { indeedApplyable: false }), fresh('bbbbbbbbbbbbbbbb', { indeedApplyable: true })], [fresh('cccccccccccccccc', { indeedApplyable: undefined }), fresh('dddddddddddddddd', { pubDate: now - 30 * 86_400_000 }), fresh('BBBBBBBBBBBBBBBB')]];
  const automatic = selectIndeedCards(lists, { maxAgeDays: 14, appliedKeys: new Set(), indeedApplyOnly: true, now });
  assert.deepEqual(automatic.cards.map((item) => item.jobkey), ['cccccccccccccccc', 'bbbbbbbbbbbbbbbb'], 'lists are interleaved; company-site cards are dropped, unknown ones are kept for their page to decide');
  assert.deepEqual({ stale: automatic.stale, alreadyApplied: automatic.alreadyApplied, companySite: automatic.companySite }, { stale: 1, alreadyApplied: 0, companySite: 1 });
  const manual = selectIndeedCards(lists, { maxAgeDays: 14, appliedKeys: new Set(['cccccccccccccccc']), now });
  assert.deepEqual(manual.cards.map((item) => item.jobkey), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], 'manual runs keep company-site postings; applied ones are always skipped');
  assert.equal(manual.companySite, 0); assert.equal(manual.alreadyApplied, 1);
});

test('international card selection preserves discovery origins through interleaving and deduplication',async()=>{
  const {indeedCardUrl}=await import('./sources/indeed-data.ts');
  const lists=[[{...card,searchOrigin:'https://uk.indeed.com'}],[{...card,jobkey:'aaaaaaaaaaaaaaaa',searchOrigin:'https://ca.indeed.com'},{...card,searchOrigin:'https://de.indeed.com'}]];
  const selected=selectIndeedCards(lists,{appliedKeys:new Set()}).cards;
  assert.deepEqual(selected.map(indeedCardUrl),['https://uk.indeed.com/viewjob?jk=6a19fac52b8fdc97','https://ca.indeed.com/viewjob?jk=aaaaaaaaaaaaaaaa']);
  assert.throws(()=>indeedCardUrl({...card,searchOrigin:'https://evil.test'}));
});
test('search reader rejects country or location redirects instead of caching localized results',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'indeed-location-'));const previous=process.env.JOB_SOURCE_CACHE_DIR;process.env.JOB_SOURCE_CACHE_DIR=directory;
  const browser=await chromium.launch();const context=await browser.newContext();
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.searchParams.get('q')==='redirect-country')return route.fulfill({contentType:'text/html',body:'<script>location.replace("https://at.indeed.com/jobs?q=backend&l=Deutschland")</script>'});
    if(u.searchParams.get('q')==='redirect-city')return route.fulfill({contentType:'text/html',body:'<script>location.replace("https://de.indeed.com/jobs?q=backend&l=Berlin")</script>'});
    return route.fulfill({contentType:'text/html',body:cards([card],true)});
  });
  try{
    await assert.rejects(readIndeedSearchPage(context,'https://de.indeed.com/jobs?q=redirect-country&l=Deutschland'),/redirected.*location/);
    await assert.rejects(readIndeedSearchPage(context,'https://de.indeed.com/jobs?q=redirect-city&l=Deutschland'),/redirected.*location/);
  }finally{await browser.close();if(previous===undefined)delete process.env.JOB_SOURCE_CACHE_DIR;else process.env.JOB_SOURCE_CACHE_DIR=previous;await rm(directory,{recursive:true,force:true});}
});
test('explicit city plus country matches source country codes while retaining the city restriction',async()=>{
  const {matchesJobLocation}=await import('./locations.ts');
  assert.equal(matchesJobLocation('Toronto, ON, CA','Toronto, Canada'),true);
  assert.equal(matchesJobLocation('Vancouver, BC, CA','Toronto, Canada'),false);
  assert.equal(matchesJobLocation('Wien, W, AT','Vienna'),true);
});
