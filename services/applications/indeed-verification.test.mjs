import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { awaitVerification, pageProblem, VERIFICATION_TIMEOUT_MESSAGE } from '../../lib/indeed/browser.ts';
import { VERIFICATION_MESSAGE } from '../../lib/jobs/sources/indeed-data.ts';

// All traffic is intercepted. These fixtures never visit Indeed or submit an application.
async function fixture(options, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let clicks = 0;
    await context.exposeBinding('recordClick', () => { clicks++; });
    await context.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().frame().parentFrame()) {
        return route.fulfill({ contentType: 'text/html', body: `<body><label><input type="checkbox" ${options.attributes ?? ''} onclick="recordClick(); ${options.clear ? "parent.postMessage('clear', '*')" : ''}">Verify you are human</label></body>` });
      }
      return route.fulfill({ contentType: 'text/html', body: `<body>
        <div id="challenge-stage"><input id="employer-consent" type="checkbox" onclick="recordClick()">
        <div id="widget"></div></div>
        <script>
          setTimeout(() => { document.getElementById('widget').innerHTML = '<iframe src="${options.src ?? 'https://challenges.cloudflare.com/widget'}"></iframe>'; }, ${options.delay ?? 0});
          addEventListener('message', e => { if (e.data === 'clear') document.body.innerHTML = '<h1>Job results</h1>'; });
        </script></body>` });
    });
    const page = await context.newPage();
    await page.goto('https://de.indeed.com/jobs');
    await run(page, () => clicks);
  } finally { await browser.close(); }
}

test('clicks a delayed Cloudflare checkbox and only succeeds after the challenge disappears', async () => {
  await fixture({ clear: true, delay: 100 }, async (page, clicks) => {
    let waiting = 0, attempts = 0;
    assert.equal(await awaitVerification(page, await pageProblem(page), {
      waitMs: 3000, pollMs: 20, reloadMs: 10_000,
      onWaiting: () => { waiting++; }, onCloudflareClick: () => { attempts++; },
    }), null);
    assert.equal(clicks(), 1);
    assert.equal(waiting, 1); assert.equal(attempts, 1);
    assert.equal(await page.locator('h1').innerText(), 'Job results');
  });
});

test('an uncleared Cloudflare challenge times out without repeated clicks, including after reload', async () => {
  await fixture({}, async (page, clicks) => {
    assert.equal(await awaitVerification(page, await pageProblem(page), { waitMs: 700, pollMs: 20, reloadMs: 150 }), VERIFICATION_TIMEOUT_MESSAGE);
    assert.equal(clicks(), 1);
  });
});

test('Cloudflare challenge subdomains are also supported', async () => {
  await fixture({ src: 'https://widget.challenges.cloudflare.com/widget', clear: true }, async (page, clicks) => {
    assert.equal(await awaitVerification(page, await pageProblem(page), { waitMs: 3000, pollMs: 20, reloadMs: 10_000 }), null);
    assert.equal(clicks(), 1);
  });
});

test('does not click reCAPTCHA, unrelated frames, deceptive hostnames or noninteractive checkboxes', async () => {
  for (const options of [
    { src: 'https://www.google.com/recaptcha/api2/anchor' },
    { src: 'https://employer.example/consent' },
    { src: 'https://challenges.cloudflare.com.evil.test/widget' },
    { attributes: 'checked' }, { attributes: 'disabled' }, { attributes: 'style="display:none"' },
  ]) {
    await fixture(options, async (page, clicks) => {
      assert.equal(await awaitVerification(page, await pageProblem(page), { waitMs: 200, pollMs: 20, reloadMs: 10_000 }), VERIFICATION_TIMEOUT_MESSAGE);
      assert.equal(clicks(), 0, JSON.stringify(options));
    });
  }
});

test('disabled verification waiting makes no click; non-verification errors pass through', async () => {
  await fixture({}, async (page, clicks) => {
    assert.equal(await awaitVerification(page, VERIFICATION_MESSAGE, { waitMs: 0 }), VERIFICATION_MESSAGE);
    assert.equal(await awaitVerification(page, 'Request blocked', { waitMs: 1000 }), 'Request blocked');
    assert.equal(clicks(), 0);
  });
});
