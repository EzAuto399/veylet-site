/*
 * "Report this walkthrough" (launch plan C2.3): the quiet link at the foot of /handoff, /tour and the
 * embed's invitation panel, and /report (dist/report/index.html + report.js), which sends one
 * rpc/report_walkthrough (the product repository's supabase/drafts/release-2/
 * 20260926103000_walkthrough_reports.sql). The page never says whether a token exists, keeps the token
 * out of the address bar, and without the function offers an email carrying the token's SHA-256 only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const { Element, elementsById, FakeFormData, recordingFetch } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const markup = read('report/index.html');
const script = read('report/report.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
const HASH = createHash('sha256').update(TOKEN).digest('hex');
const CONFIG = { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' };

function load() {
  const window = { VEYLET_REPORT_MANUAL: true };
  vm.runInNewContext(script, { window, document: undefined, JSON, Promise, Object, String, Array, Uint8Array, encodeURIComponent, decodeURIComponent });
  return window.VeyletReport;
}

function clientPage() {
  const window = {};
  vm.runInNewContext(read('client-page.js'), { window, setTimeout, clearTimeout });
  return window.VeyletClientPage;
}

function page({ search = `?t=${TOKEN}`, answers = [] } = {}) {
  const ids = elementsById(markup);
  const firstReason = new Element('input', false, { name: 'reason' });
  ids['report-form'].selectors = { '[name="reason"]': firstReason };
  const { fetch, requests } = recordingFetch(answers);
  const replaced = [];
  const doc = { getElementById: id => ids[id] || null, createElement: tag => new Element(tag) };
  const window = {
    VEYLET_SUPABASE: CONFIG, document: doc, fetch, crypto: webcrypto, TextEncoder,
    location: { search, pathname: '/report' }, history: { replaceState: (_, __, url) => replaced.push(url) },
    FormData: class { constructor(form) { return form.data; } },
  };
  return { ids, window, requests, replaced, firstReason };
}

async function submit(view, values) {
  view.ids['report-form'].data = new FakeFormData(values);
  return view.ids['report-form'].fire('submit');
}

test('the link sits quietly at the foot of /handoff, /tour and the embed invitation, and each page mounts it with its token', () => {
  const handoff = read('handoff/index.html'), embed = read('embed/index.html'), tour = read('tour/index.html');
  assert.match(handoff, /<nav aria-label="Legal">[\s\S]*<a class="client-report" id="client-report" hidden>Report this walkthrough<\/a>\s*<\/nav>/);
  assert.match(handoff, /page\?\.mountReport\?\.\(document\.getElementById\('client-report'\), token\);/);
  assert.match(embed, /<a id="embed-report" class="embed-report" target="_blank" rel="noopener noreferrer" hidden>Report this walkthrough<\/a>/);
  assert.match(embed, /mountReport\?\.\(document\.getElementById\('embed-report'\), token\)/);
  assert.match(embed, /\.embed-fallback a\.embed-report \{[^}]*font-size: 13px/, 'quiet: small and underlined, not a button');
  assert.match(tour, /<footer class="tour-foot" id="tour-foot" hidden>\s*<a id="tour-report" target="_blank" rel="noopener noreferrer">Report this walkthrough<\/a>/);
  assert.match(tour, /mountReport\?\.\(document\.getElementById\('tour-report'\), token, document\.getElementById\('tour-foot'\)\)/);
  assert.match(tour, /\.tour-foot a \{[^}]*min-height: 44px;/);
});

test('mountReport links to /report with the token only, and only for a complete token', () => {
  const pageApi = clientPage();
  const link = { hidden: true }, foot = { hidden: true };
  assert.equal(pageApi.mountReport(link, TOKEN, foot), true);
  assert.deepEqual([link.href, link.hidden, foot.hidden], [`/report?t=${TOKEN}`, false, false]);
  assert.equal(pageApi.reportHref('a b&c'), '/report?t=a%20b%26c');
  const short = { hidden: true };
  assert.equal(pageApi.mountReport(short, 'short'), false);
  assert.deepEqual([short.hidden, short.href], [true, undefined]);
  assert.equal(pageApi.mountReport(null, TOKEN), false);
});

test('/report reads the token, takes it out of the address bar and shows the form; no token means the email route', async () => {
  const api = load();
  assert.equal(api.readToken(`?t=${TOKEN}`), TOKEN);
  assert.equal(api.readToken('?t=short'), null);
  assert.equal(api.readToken('?t=%E0%A4%A'), null);
  assert.equal(api.readToken('?x=1'), null);
  const view = page();
  assert.equal(view.ids['report-form'].hidden, true, 'hidden until the script has a token');
  assert.equal(await api.run(view.window), 'ready');
  assert.deepEqual(view.replaced, ['/report']);
  assert.equal(view.ids['report-form'].hidden, false);
  assert.equal(view.ids['report-mail'].getAttribute('href').includes(TOKEN), false);

  const none = page({ search: '' });
  assert.equal(await api.run(none.window), 'incomplete');
  assert.equal(none.ids['report-form'].hidden, true);
  assert.equal(none.ids['report-fallback'].hidden, false);
  assert.match(none.ids['report-fallback-text'].textContent, /This report link is incomplete\. Email yoda@yodalai\.xyz/);
  assert.match(none.ids['report-mail'].getAttribute('href'), /^mailto:yoda@yodalai\.xyz\?subject=Report%20a%20walkthrough/);
  assert.equal(none.requests.length, 0);
});

test('the reasons are the four in the plan, a reason is required, details and email are optional', async () => {
  const api = load();
  assert.deepEqual([...markup.matchAll(/name="reason" value="([^"]+)"/g)].map(m => m[1]), Object.keys(api.REASONS));
  assert.match(markup, /A person, a document or an item that shouldn’t be shown\./);
  assert.match(markup, /<textarea name="details" maxlength="2000"/);
  assert.match(markup, /<input name="email" type="email"[^>]*maxlength="254" \/>/);
  assert.doesNotMatch(markup.split('<form')[1].split('</form>')[0], /\brequired\b/, 'the reason is checked by the script, beside its group');
  const view = page();
  await api.run(view.window);
  await submit(view, {});
  assert.equal(view.requests.length, 0);
  assert.equal(view.ids['report-reason-problem'].textContent, 'Choose what is wrong before sending.');
  assert.equal(view.firstReason.focused, 1);
});

test('a report is one POST to rpc/report_walkthrough; any token reads "received" and gets the same thanks', async () => {
  const api = load();
  const view = page({ answers: [{ status: 200, body: { state: 'received' } }] });
  await api.run(view.window);
  await submit(view, { reason: 'privacy', details: '  A framed photo of the family in the hall. ', email: '' });
  assert.equal(view.requests.length, 1);
  const [{ url, init, body }] = view.requests;
  assert.equal(url, 'https://project.supabase.invalid/rest/v1/rpc/report_walkthrough');
  assert.deepEqual([init.headers.apikey, init.headers.Authorization, init.credentials, init.referrerPolicy],
    ['public-anon-key', 'Bearer public-anon-key', 'omit', 'no-referrer']);
  assert.deepEqual(body, { p_token: TOKEN, p_reason: 'privacy', p_details: 'A framed photo of the family in the hall.', p_email: null });
  assert.equal(view.ids['report-form'].hidden, true);
  assert.equal(view.ids['report-done'].hidden, false);
  assert.match(markup, /<h2 id="report-done-title" tabindex="-1">Thanks\. We’ll review this within 24 hours for privacy reports\.<\/h2>/);
  assert.equal(api.COPY.received, 'Thanks. We’ll review this within 24 hours for privacy reports.');
  assert.equal(view.ids['report-done-title'].focused, 1);
});

test('without the function, at the limit or on a failure, the email route carries the token hash and never the token', async () => {
  const api = load();
  for (const [answer, state] of [[{ status: 404, body: { code: 'PGRST202' } }, 'missing'], [{ status: 200, body: { state: 'busy' } }, 'busy'],
    [{ status: 502, body: null }, 'error'], [new TypeError('Failed to fetch'), 'error']]) {
    const view = page({ answers: [answer] });
    await api.run(view.window);
    await submit(view, { reason: 'offensive', details: 'Graffiti in the garage.', email: 'viewer@example.invalid' });
    assert.equal(view.ids['report-fallback'].hidden, false, state);
    assert.equal(view.ids['report-fallback-text'].textContent, api.COPY[state]);
    const href = view.ids['report-mail'].getAttribute('href');
    const bodyText = decodeURIComponent(href.split('&body=')[1]);
    assert.match(bodyText, new RegExp(`Walkthrough reference \\(SHA-256\\): ${HASH}`), state);
    assert.match(bodyText, /What is wrong: Offensive or illegal/);
    assert.equal(href.includes(TOKEN) || bodyText.includes(TOKEN), false, `${state}: the token itself never goes in the email`);
    assert.equal(view.ids['report-form'].hidden, false, 'nothing typed is lost');
  }
});

test('a bad email is refused before sending; a filled honeypot sees the thanks and nothing is sent', async () => {
  const api = load();
  const typo = page();
  await api.run(typo.window);
  await submit(typo, { reason: 'other', email: 'not-an-email' });
  assert.equal(typo.requests.length, 0);
  assert.equal(typo.ids['report-status'].textContent, api.COPY.invalid);
  const bot = page();
  await api.run(bot.window);
  await submit(bot, { reason: 'other', _honey: 'x' });
  assert.equal(bot.requests.length, 0);
  assert.equal(bot.ids['report-done'].hidden, false);
});

test('/report is private and first party: noindex, no referrer, no outside script', () => {
  assert.match(markup, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(markup, /<meta name="referrer" content="no-referrer" \/>/);
  for (const src of [...markup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1])) assert.match(src, /^\/(?!\/)/);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.equal(load().SUPPORT, 'yoda@yodalai.xyz');
});

test('the app\'s support page tells an owner how to report someone else\'s walkthrough, by mail link inside the app', () => {
  const support = read('app/support/index.html');
  assert.match(support, /<div id="report"><dt>Reporting someone else’s walkthrough<\/dt>/);
  assert.match(support, /href="mailto:yoda@yodalai\.xyz\?subject=Report%20a%20walkthrough"/);
  assert.match(support, /Privacy reports are reviewed within 24 hours\./);
});
