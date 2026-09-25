/*
 * The service status page: /status (public, indexable) and /app/status (the app's copy: noindex,
 * price-free, links only inside /app), both driven by dist/status.js reading the anonymous
 * rpc/get_public_service_status (the sibling repository's release-2 draft; the hosted backend does
 * not have it yet, so a missing function must read as "unavailable" and stop asking).
 * The page is run on a stand-in DOM built from each page's own markup, with a fake clock, timers,
 * visibility and fetch. Nothing here reaches the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const help = require('./help-articles.cjs');

const DIST = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');
const script = read('status.js');
const PAGES = { public: read('status/index.html'), app: read('app/status/index.html') };
const checker = import(pathToFileURL(path.join(__dirname, '../scripts/check-app-pages.mjs')));

const CONFIG = { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' };
const RPC_URL = CONFIG.url + '/rest/v1/rpc/get_public_service_status';
const UNAVAILABLE = 'Status isn’t available right now. Email support if something looks wrong.';
const SUPPORT_MAILTO = 'mailto:yoda@yodalai.xyz?subject=Veylet%20status';
// 26 September 2026, 11:40 am in Brisbane (UTC+10, no daylight saving).
const NOW = Date.parse('2026-09-26T01:40:00Z');
const row = (fields = {}) => ({ admissions_open: false, typical_start_minutes: 12, rendering_paused: false,
  updated_at: '2026-09-26T01:38:00Z', message: null, ...fields });
const ok = body => ({ status: 200, body });
const MISSING = { status: 404, body: { code: 'PGRST202', details: null, hint: null,
  message: 'Could not find the function public.get_public_service_status without parameters in the schema cache' } };
const MISSING_BY_MESSAGE = { status: 404, body: { message: 'Could not find the function public.get_public_service_status without parameters in the schema cache' } };

class Element {
  constructor(tag, attributes) {
    this.tagName = tag.toUpperCase();
    this.hidden = /\shidden(?=[\s>])/.test(attributes);
    this.attributes = {};
    for (const match of attributes.matchAll(/\s([\w-]+)="([^"]*)"/g)) this.attributes[match[1]] = match[2];
    this._text = '';
    this.writes = 0;
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); this.writes += 1; }
  set innerHTML(value) { throw new Error('status.js must never write markup: ' + value); }
  get innerHTML() { throw new Error('status.js must never read markup'); }
  insertAdjacentHTML() { throw new Error('status.js must never write markup'); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
}

/** One page, run with its script. `answers` is a queue (the last one repeats); an Error throws as a lost connection does. */
function page({ edition = 'public', answers = [], config = CONFIG, visibility = 'visible', abort = false } = {}) {
  const ids = {};
  for (const match of PAGES[edition].matchAll(/<([\w-]+)(\s[^>]*\bid="([^"]+)"[^>]*)>/g)) ids[match[3]] = new Element(match[1], match[2]);
  let clock = NOW, nextTimer = 1;
  const timers = new Map(), requests = [], listeners = {};
  const queue = [...answers];
  const document = {
    readyState: 'complete', visibilityState: visibility,
    getElementById: id => ids[id] || null,
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
  };
  const window = {
    VEYLET_STATUS_MANUAL: true, VEYLET_SUPABASE: config, document,
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    fetch: async (url, init) => {
      requests.push({ url, init, at: clock });
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      if (!answer) throw new Error('unexpected request ' + url);
      if (answer instanceof Error) throw answer;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
    },
  };
  if (abort) window.AbortController = class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } };
  vm.runInNewContext(script, { window, document });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  const view = {
    api: window.VeyletStatus, window, ids, requests, timers, queue,
    now: () => clock,
    start() { view.handle = view.api.start(window, { now: () => clock }); return settle().then(() => view.handle); },
    /** Moves the clock, firing each timer that falls due, in order, and letting its read finish. */
    async advance(ms) {
      const end = clock + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        clock = Math.max(clock, due[1].at);
        due[1].fn();
        await settle();
      }
      clock = end;
    },
    async visibility(state) {
      document.visibilityState = state;
      for (const fn of listeners.visibilitychange || []) fn();
      await settle();
    },
    push: (...more) => { queue.splice(0, queue.length, ...more); },
    shown() {
      const text = id => (ids[id].hidden ? null : ids[id].textContent);
      return {
        state: ids['status-board'].getAttribute('data-state'),
        board: !ids['status-board'].hidden,
        loading: !ids['status-loading'].hidden,
        unavailable: !ids['status-unavailable'].hidden,
        lines: ids['status-current'].hidden ? null : ['status-rendering', 'status-admissions', 'status-start'].map(text).filter(line => line !== null),
        message: text('status-message'),
        updated: text('status-updated'),
      };
    },
  };
  return view;
}

const flat = html => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hrefs = html => [...html.matchAll(/\bhref="([^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));

test('normal service: one anonymous read with the public key, then rendering normal, weekly groups, the usual start and when it was updated', async () => {
  const view = page({ answers: [ok(row())] });
  await view.start();
  assert.equal(view.requests.length, 1);
  const [{ url, init }] = view.requests;
  assert.equal(url, RPC_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.apikey, 'public-anon-key');
  assert.equal(init.headers.Authorization, 'Bearer public-anon-key');
  assert.equal(init.body, '{}');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(view.shown(), { state: 'normal', board: true, loading: false, unavailable: false,
    lines: ['Rendering: normal', 'New accounts: admitted in weekly groups', 'Renders usually start within 12 minutes'],
    message: null, updated: 'Last updated 11:38 am today (Brisbane time)' });
  assert.equal(view.ids['status-rendering'].getAttribute('data-tone'), 'good');
  assert.equal(view.ids['status-admissions'].getAttribute('data-tone'), 'held');
});

test('paused with a message, admissions open, as a one-element array: the message is written as text', async () => {
  const note = 'Rendering is paused while we <b>update</b> the renderers.\n\nCaptures keep their place.';
  const view = page({ answers: [ok([row({ rendering_paused: true, admissions_open: true, typical_start_minutes: null, message: note })])] });
  await view.start();
  assert.deepEqual(view.shown(), { state: 'paused', board: true, loading: false, unavailable: false,
    lines: ['Rendering: paused', 'New accounts: open'],
    message: 'Rendering is paused while we <b>update</b> the renderers. Captures keep their place.',
    updated: 'Last updated 11:38 am today (Brisbane time)' });
  assert.equal(view.ids['status-rendering'].getAttribute('data-tone'), 'held');
  assert.equal(view.ids['status-admissions'].getAttribute('data-tone'), 'good');
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'the script never writes markup');
});

test('the app page draws the same lines from the same answer', async () => {
  for (const answer of [row(), [row({ rendering_paused: true, admissions_open: true, message: 'Back soon.' })]]) {
    const site = page({ answers: [ok(answer)] }), app = page({ edition: 'app', answers: [ok(answer)] });
    await site.start();
    await app.start();
    assert.deepEqual(app.shown(), site.shown());
  }
  const missing = page({ edition: 'app', answers: [MISSING] });
  await missing.start();
  assert.equal(missing.shown().state, 'unavailable');
  assert.equal(missing.handle.state.stopped, true);
});

test('the usual start shows only for a finite, non-negative whole number of minutes ("1 minute" for 1)', async () => {
  const { api } = page();
  for (const [minutes, line] of [[0, 'Renders usually start within 0 minutes'], [1, 'Renders usually start within 1 minute'],
    [2, 'Renders usually start within 2 minutes'], [45, 'Renders usually start within 45 minutes']]) {
    const view = page({ answers: [ok(row({ typical_start_minutes: minutes }))] });
    await view.start();
    assert.equal(view.shown().lines[2], line, String(minutes));
  }
  const absent = row();
  delete absent.typical_start_minutes;
  for (const answer of [row({ typical_start_minutes: null }), absent, row({ typical_start_minutes: '12' }), row({ typical_start_minutes: -1 }),
    row({ typical_start_minutes: 1.5 }), row({ typical_start_minutes: Number.NaN }), row({ typical_start_minutes: Infinity }),
    row({ typical_start_minutes: true }), row({ typical_start_minutes: [12] })]) {
    assert.equal(api.parse(answer).startMinutes, null, JSON.stringify(answer.typical_start_minutes));
    const view = page({ answers: [ok(answer)] });
    await view.start();
    assert.deepEqual(view.shown().lines, ['Rendering: normal', 'New accounts: admitted in weekly groups'], String(answer.typical_start_minutes));
    assert.equal(view.ids['status-start'].hidden, true);
  }
});

test('the message shows only when it is a non-empty string, and is capped in length', async () => {
  for (const message of [null, '', '   \n ', 42, { text: 'hi' }, ['hi']]) {
    const view = page({ answers: [ok(row({ message }))] });
    await view.start();
    assert.equal(view.shown().message, null, JSON.stringify(message));
  }
  const view = page({ answers: [ok(row({ message: 'word '.repeat(200) }))] });
  await view.start();
  const shown = view.shown().message;
  assert.equal(Array.from(shown).length <= view.api.MESSAGE_MAX, true, shown.length + ' characters');
  assert.match(shown, /^word word .*…$/);
  // A cap never splits a character made of two code units.
  const emoji = view.api.capMessage('🙂'.repeat(400));
  assert.equal(Array.from(emoji).length, view.api.MESSAGE_MAX);
  assert.ok(emoji.endsWith('🙂…'));
});

test('a bare object and a one-element array read the same; anything else is malformed and reads as unavailable', async () => {
  const { api } = page();
  assert.deepEqual(api.parse(row()), api.parse([row()]));
  const malformed = [null, [], [row(), row()], 'ok', 42, {}, row({ admissions_open: 'false' }), row({ rendering_paused: null }),
    row({ updated_at: 'not a date' }), row({ updated_at: '' }), row({ updated_at: 1790000000 })];
  for (const answer of malformed) {
    assert.equal(api.parse(answer), null, JSON.stringify(answer));
    const view = page({ answers: [ok(answer)] });
    await view.start();
    assert.deepEqual(view.shown(), { state: 'unavailable', board: true, loading: false, unavailable: true, lines: null, message: null, updated: null },
      JSON.stringify(answer));
  }
});

test('a missing function (404 PGRST202, or the message alone) reads as unavailable and the page stops asking', async () => {
  for (const missing of [MISSING, MISSING_BY_MESSAGE]) {
    const view = page({ answers: [missing] });
    await view.start();
    assert.deepEqual(view.shown(), { state: 'unavailable', board: true, loading: false, unavailable: true, lines: null, message: null, updated: null });
    assert.equal(view.handle.state.stopped, true);
    assert.equal(view.timers.size, 0, 'nothing is scheduled');
    await view.advance(10 * 60000);
    await view.visibility('hidden');
    await view.advance(2 * 60000);
    await view.visibility('visible');
    assert.equal(view.requests.length, 1, 'asked once, then never again');
  }
  // It also stops when the function goes away after a good answer.
  const later = page({ answers: [ok(row())] });
  await later.start();
  later.push(MISSING);
  await later.advance(60000);
  assert.equal(later.shown().state, 'unavailable');
  await later.advance(5 * 60000);
  assert.equal(later.requests.length, 2);
  // Other refusals are not "missing": the page keeps trying.
  const refused = page({ answers: [{ status: 404, body: { code: 'PGRST116', message: 'Not found' } }] });
  await refused.start();
  assert.equal(refused.shown().state, 'unavailable');
  assert.equal(refused.handle.state.stopped, false);
  assert.equal(refused.timers.size, 1);
});

test('a failure before any good answer reads as unavailable; after a good answer the last good values stay', async () => {
  const view = page({ answers: [new TypeError('Failed to fetch')] });
  await view.start();
  assert.equal(view.shown().state, 'unavailable');
  assert.equal(view.ids['status-unavailable'].hidden, false);
  view.push(ok(row({ rendering_paused: true, message: 'Back soon.' })));
  await view.advance(60000);
  const good = view.shown();
  assert.equal(good.state, 'paused');
  assert.deepEqual(good.lines, ['Rendering: paused', 'New accounts: admitted in weekly groups', 'Renders usually start within 12 minutes']);
  const writes = view.ids['status-rendering'].writes;
  for (const failure of [new TypeError('Failed to fetch'), { status: 500, body: {} }, { status: 503, body: null }, ok([]), ok({ admissions_open: true })]) {
    view.push(failure);
    await view.advance(60000);
    assert.deepEqual(view.shown(), good, JSON.stringify(failure));
  }
  assert.equal(view.ids['status-rendering'].writes, writes, 'unchanged lines are not rewritten, so the live region stays quiet');
  assert.equal(view.requests.length, 7);
});

test('it reads again every 60 s while the page is visible, pauses while hidden, and reads at once on return after 60 s', async () => {
  const view = page({ answers: [ok(row())] });
  await view.start();
  const at = () => view.requests.map(request => (request.at - NOW) / 1000);
  await view.advance(59999);
  assert.deepEqual(at(), [0]);
  await view.advance(1);
  assert.deepEqual(at(), [0, 60]);
  await view.advance(60000);
  assert.deepEqual(at(), [0, 60, 120]);
  // Hidden at 150 s: nothing is read while hidden.
  await view.advance(30000);
  await view.visibility('hidden');
  assert.equal(view.timers.size, 0);
  await view.advance(5 * 60000);
  assert.deepEqual(at(), [0, 60, 120]);
  // Visible at 450 s, more than 60 s after the last read: read at once, then every 60 s.
  await view.visibility('visible');
  assert.deepEqual(at(), [0, 60, 120, 450]);
  await view.advance(60000);
  assert.deepEqual(at(), [0, 60, 120, 450, 510]);
  // Hidden and back within the minute: no extra read, the next one keeps its time.
  await view.advance(20000);
  await view.visibility('hidden');
  await view.advance(10000);
  await view.visibility('visible');
  assert.deepEqual(at(), [0, 60, 120, 450, 510]);
  await view.advance(30000);
  assert.deepEqual(at(), [0, 60, 120, 450, 510, 570]);
});

test('a page opened in a background tab reads once, then waits until it is shown', async () => {
  const view = page({ answers: [ok(row())], visibility: 'hidden' });
  await view.start();
  assert.equal(view.requests.length, 1);
  assert.equal(view.timers.size, 0);
  await view.advance(3 * 60000);
  await view.visibility('visible');
  assert.equal(view.requests.length, 2);
});

test('each read is bounded by a timeout that is cleared once it answers', async () => {
  const view = page({ answers: [ok(row())], abort: true });
  await view.start();
  assert.ok(view.requests[0].init.signal, 'the read carries an abort signal');
  assert.equal(view.timers.size, 1, 'only the next read is scheduled; the timeout was cleared');
  assert.equal([...view.timers.values()][0].at - NOW, 60000);
});

test('without the service configuration the page says it is unavailable and asks nothing', async () => {
  const view = page({ config: null });
  await view.start();
  assert.equal(view.shown().state, 'unavailable');
  assert.equal(view.requests.length, 0);
});

test('last updated reads in Brisbane time: today, or the day and date', () => {
  const { api } = page();
  assert.equal(api.formatUpdated(Date.parse('2026-09-26T01:40:00Z'), NOW), 'Last updated 11:40 am today (Brisbane time)');
  assert.equal(api.formatUpdated(Date.parse('2026-09-25T13:59:00Z'), NOW), 'Last updated 11:59 pm Fri, 25 Sept (Brisbane time)');
  assert.equal(api.formatUpdated(Date.parse('2026-09-25T14:05:00Z'), NOW), 'Last updated 12:05 am today (Brisbane time)');
  assert.equal(api.formatUpdated(Number.NaN, NOW), '');
});

test('both pages carry the exact words, the support address and a no-script fallback', () => {
  for (const [edition, html] of Object.entries(PAGES)) {
    const unavailable = html.match(/<p class="status-unavailable" id="status-unavailable" hidden>([\s\S]*?)<\/p>/);
    assert.ok(unavailable, edition);
    assert.equal(flat(unavailable[1]), UNAVAILABLE, edition);
    assert.match(unavailable[1], new RegExp('<a href="' + SUPPORT_MAILTO.replace(/[?]/g, '\\?') + '">Email support</a>'), edition);
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    assert.ok(noscript, edition + ' has a no-script fallback');
    assert.equal(flat(noscript[1]), UNAVAILABLE, edition);
    assert.match(html, /<a href="mailto:yoda@yodalai\.xyz\?subject=Veylet%20status">yoda@yodalai\.xyz<\/a>/, edition + ' shows the support address');
    assert.match(html, /<section class="status-board" id="status-board"[^>]*\bhidden>/, edition + ': the live board stays hidden without the script');
    assert.doesNotMatch(flat(html).replace(/Veylet Studio|VEYLET STUDIO/g, ''), /studio/i, edition + ': no "studio" outside the brand name');
    // The current bytes of the page's own assets (the site's ?v= convention).
    for (const file of ['status.css', 'status.js']) {
      const version = html.match(new RegExp('/' + file.replace('.', '\\.') + '\\?v=([a-f\\d]{16})'));
      assert.ok(version, edition + ' loads ' + file);
      assert.equal(version[1], help.assetHash(fs.readFileSync(path.join(DIST, file))), edition + ' → ' + file);
    }
    assert.match(html, /<script src="\/supabase-public\.js\?v=[a-f\d]{16}"><\/script>\s*<script defer src="\/status\.js\?v=[a-f\d]{16}"><\/script>/, edition);
  }
  assert.equal(page().api.COPY.unavailable, UNAVAILABLE);
});

test('/status is public and indexable: title, description, canonical, site header and footer, and in the sitemap', () => {
  const html = PAGES.public;
  assert.doesNotMatch(html, /<meta name="robots"/i);
  assert.match(html, /<title>Service status — Veylet<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{60,160}">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/veylet\.com\/status">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/veylet\.com\/status">/);
  assert.match(html, /<nav aria-label="Main">[\s\S]*?href="\/help"[\s\S]*?href="\/account"/);
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.deepEqual(hrefs(footer), ['/', '/help', '/website-guide', '/guides', '/offer', '/support', '/privacy', '/terms']);
  assert.match(read('sitemap.xml'), /<url><loc>https:\/\/veylet\.com\/status<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod><\/url>/);
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(locs.filter(loc => loc === 'https://veylet.com/status').length, 1);
  assert.equal(locs.includes('https://veylet.com/app/status'), false);
});

test('/app/status is the app copy: noindex, no marketing navigation, no link out of /app, and clean to the app checker', async () => {
  const { checkAppPages, outsideLinks } = await checker;
  const html = PAGES.app;
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<header class="wrap app-header"><span class="brand"><span class="portal" aria-hidden="true"><\/span>VEYLET<\/span><\/header>/);
  assert.doesNotMatch(html, /<nav aria-label="Main"|brand-host\.js|<link rel="canonical"|og:image/);
  assert.deepEqual(outsideLinks(html), []);
  for (const link of hrefs(html)) assert.match(link, /^(\/app\/|mailto:|#main$|\/[\w./-]+\.css\?v=|\/media\/)/, link);
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.deepEqual(hrefs(footer), ['/app/account', '/app/help', '/app/support', '/app/privacy', '/app/terms']);
  const result = await checkAppPages(DIST);
  assert.ok(result.pages.includes('app/status/index.html'));
  assert.ok(result.scripts.includes('status.js'), 'the checker reads the status script too');
  assert.deepEqual(result.problems.filter(problem => /status/.test(problem.where)), []);
});

test('the app checker reads the status script: a price or purchase word in it fails', async t => {
  const { checkAppPages } = await checker;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veylet-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(DIST, root, { recursive: true });
  const file = path.join(root, 'status.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("'Rendering: paused'", "'Rendering: paused. Skip the queue with a pack for A$29'"));
  const said = (await checkAppPages(root)).problems.map(problem => problem.where + ' ' + problem.word);
  for (const expected of ['status.js (script) A$', 'status.js (script) pack']) assert.ok(said.includes(expected), expected + ' in ' + said.join(', '));
});

test('only the two help indexes link to the status page, each to its own edition, from the footer', () => {
  const linking = help.pages().filter(entry => /href="\/(app\/)?status"/.test(entry.html)).map(entry => entry.file).sort();
  assert.deepEqual(linking, ['app/help/index.html', 'help/index.html']);
  for (const [file, target] of [['help/index.html', '/status'], ['app/help/index.html', '/app/status']]) {
    const html = read(file);
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
    assert.ok(hrefs(footer).includes(target), file + ' footer links to ' + target);
    assert.equal(hrefs(html).filter(link => /\/status$/.test(link)).length, 1, file + ' links once');
    assert.equal(hrefs(html.replace(footer, '')).some(link => /\/status$/.test(link)), false, file + ': only from the footer');
  }
});
