import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { parseIndeedHistory } from '../../lib/indeed/history-data.ts';
import { historyRequestAllowed, readIndeedHistory } from '../../lib/indeed/history-reader.ts';

const jobs = appStatusJobs => ({ success: true, body: { appStatusJobs } });
const interviews = { success: true, body: { interviews: [] } };
const time = Date.UTC(2026, 8, 10);
const job = (key, status = 'APPLIED', bucket = 'POST_APPLY') => ({ jobKey: key, jobTitle: `Engineer ${key}`, company: { name: 'Example' }, location: 'Vienna', jobUrl: `https://at.indeed.com/viewjob?jk=${key}`, applyTime: time,
  statuses: { userJobStatus: { status: bucket, timestamp: time }, candidateStatus: { status, timestamp: time }, selfReportedStatus: null } });
const empty = () => ({ applied: jobs([]), saved: jobs([]), archived: jobs([]), interviews, since: time });
test('account history excludes incomplete applications and saved jobs from applied totals', () => {
  const data = empty();
  data.applied = jobs([job('a'), job('a'), job('b', 'APPLY_IN_PROGRESS'), job('c', 'MAYBE_APPLIED'), job('d', 'REJECTED'), job('s', 'APPLIED', 'SAVED')]);
  data.saved = jobs([job('s', 'APPLY_IN_PROGRESS', 'SAVED')]);
  data.archived = jobs([job('a', 'APPLIED', 'ARCHIVED'), job('z', 'OFFER', 'ARCHIVED')]);
  data.interviews = { success: true, body: { interviews: [{ status: 'EMP_INVITE' }, { status: 'JS_CONFIRM', timeSlots: [{}] }, { status: 'JS_CONFIRM', timeSlots: [] }] } };
  const snapshot = parseIndeedHistory(data);
  assert.deepEqual(snapshot.counts, { applied: 2, saved: 1, archived: 1, interviews: 2 });
  assert.equal(snapshot.applications.length, 3);
  assert.equal(snapshot.applications.find(x => x.id === 'd').status, 'REJECTED');
});
test('self-reported statuses are labelled and unsafe posting links are omitted', () => {
  const self = job('a', 'VIEWED');
  self.statuses.selfReportedStatus = { status: 'INTERVIEW', timestamp: time + 1000 };
  self.jobUrl = 'javascript:alert(1)';
  const snapshot = parseIndeedHistory({ ...empty(), applied: jobs([self]) });
  assert.equal(snapshot.applications[0].statusSource, 'self_reported');
  assert.equal(snapshot.applications[0].status, 'INTERVIEW');
  assert.equal(snapshot.applications[0].url, null);
});
test('unreadable account data cannot become a successful empty history', () => {
  assert.deepEqual(parseIndeedHistory(empty()).counts, { applied: 0, saved: 0, archived: 0, interviews: 0 });
  for (const bad of [{ success: false }, { success: true, body: {} }, jobs([{ jobKey: 'broken' }])]) assert.throws(() => parseIndeedHistory({ ...empty(), applied: bad }));
});
test('account reader permits only GET/HEAD and cannot navigate to an external site', () => {
  assert.equal(historyRequestAllowed('GET', 'https://myjobs.indeed.com/applied', true), true);
  assert.equal(historyRequestAllowed('POST', 'https://myjobs.indeed.com/api/v1/appStatusJobs', false), false);
  assert.equal(historyRequestAllowed('DELETE', 'https://myjobs.indeed.com/api/v1/appStatusJobs', false), false);
  assert.equal(historyRequestAllowed('GET', 'https://evil.test/', true), false);
  assert.equal(historyRequestAllowed('GET', 'https://d3fw5vlhllyvee.cloudfront.net/app.js', false), true);
  assert.equal(historyRequestAllowed('GET', 'https://d3fw5vlhllyvee.cloudfront.net/', true), false);
});
test('browser sync reads account responses and blocks a page mutation request', async () => {
  let mutations = 0;
  const html = `<body><button data-gnav-element-name="AccountMenu">Account</button><main><h1>My jobs</h1><button data-testid="APPLIED" onclick="fetch('/api/v1/appStatusJobs?type=POST_APPLY&applyUpdateStartTime=${time}')">Applied</button><button data-testid="ARCHIVED" onclick="fetch('/api/v1/appStatusJobs?type=ARCHIVED')">Archived</button></main><script>fetch('/api/v1/appStatusJobs?type=SAVED');fetch('/api/v1/interviews');fetch('/api/v1/delete',{method:'POST'}).catch(()=>{});</script></body>`;
  const launch = async () => {
    const browser = await chromium.launch({ headless: true });
    // The reader installs a context route. Browser-wide routing beneath it supplies fixtures only.
    const original = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await original(options);
      const route = context.route.bind(context);
      context.route = async (_pattern, policy) => route('**/*', async intercepted => {
        let allowed = false;
        await policy({ request: () => intercepted.request(), continue: async () => { allowed = true; }, abort: () => intercepted.abort() });
        if (!allowed) return;
        const request = intercepted.request(), u = new URL(request.url());
        if (request.method() !== 'GET') { mutations++; return intercepted.abort(); }
        if (u.pathname === '/api/v1/appStatusJobs') return intercepted.fulfill({ json: jobs(u.searchParams.get('type') === 'POST_APPLY' ? [job('a')] : []) });
        if (u.pathname === '/api/v1/interviews') return intercepted.fulfill({ json: interviews });
        return intercepted.fulfill({ contentType: 'text/html', body: html });
      });
      return context;
    };
    return browser;
  };
  const snapshot = await readIndeedHistory({ cookies: [], origins: [] }, launch);
  assert.equal(snapshot.counts.applied, 1);
  assert.equal(snapshot.applications[0].company, 'Example');
  assert.equal(mutations, 0);
});
