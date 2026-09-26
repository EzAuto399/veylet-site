/*
 * /unsubscribe (dist/unsubscribe/index.html + dist/unsubscribe.js): the link in a tips-and-offers email
 * (rpc/unsubscribe_email_tips, the sibling repository's draft 20260926114000_lifecycle_email.sql) and in
 * the dispatcher's trial reminder (rpc/unsubscribe_mail, 20260925110000_render_status.sql). It reads the
 * 64-hex token from ?t=, removes it from the address bar, asks both functions once with the public key and
 * says one of: unsubscribed (tips or reminder), "This link has already been used or is not valid.",
 * unavailable (no function deployed) or error (with Try again, which asks only the failed function).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');

const dist = path.join(__dirname, '../dist');
const script = fs.readFileSync(path.join(dist, 'unsubscribe.js'), 'utf8');
const markup = fs.readFileSync(path.join(dist, 'unsubscribe/index.html'), 'utf8');
const TOKEN = 'a1'.repeat(32);
const CONFIG = { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' };
const RPC = CONFIG.url + '/rest/v1/rpc/';
const MISSING = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.unsubscribe_email_tips(p_token) in the schema cache' } };
const ok = state => ({ status: 200, body: { state, unsubscribed: state !== 'invalid' } });

class Element {
  constructor(tag, hidden) { this.tagName = tag.toUpperCase(); this.hidden = hidden; this.disabled = false; this.textContent = ''; this.attributes = {}; this.events = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, handler) { this.events[name] = handler; }
  focus() { this.focused = (this.focused || 0) + 1; }
}

/** `answers` maps a function name to its queue of answers (an Error throws, as a lost connection does). */
function page({ search = `?t=${TOKEN}`, answers = {}, config = CONFIG } = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1], /\bhidden\b/.test(match[0]));
  }
  const requests = [], replaced = [];
  const window = {
    VEYLET_UNSUBSCRIBE_MANUAL: true,
    VEYLET_SUPABASE: config,
    location: { search, pathname: '/unsubscribe' },
    history: { replaceState: (_, __, url) => replaced.push(url) },
    document: { readyState: 'complete', getElementById: id => ids[id], addEventListener() {} },
    fetch: async (url, init) => {
      requests.push({ url, init });
      const queue = answers[url.slice(RPC.length)] || [];
      const answer = queue.length > 1 ? queue.shift() : queue[0];
      if (!answer) throw new Error('unexpected request ' + url);
      if (answer instanceof Error) throw answer;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
    },
  };
  vm.runInNewContext(script, { window, document: window.document, JSON, Promise });
  return { api: window.VeyletUnsubscribe, window, ids, requests, replaced };
}

const shown = ids => ({ state: ids.main.attributes['data-state'], title: ids['unsubscribe-title'].textContent,
  message: ids['unsubscribe-message'].textContent, retry: !ids['unsubscribe-retry'].hidden,
  next: ids['unsubscribe-scope'].hidden ? null : ids['unsubscribe-scope'].textContent });
const asked = view => view.requests.map(({ url }) => url.slice(RPC.length)).sort();

test('a tips link unsubscribes from tips and offers, asking both functions once with the public key and the token only', async () => {
  const view = page({ answers: { unsubscribe_email_tips: [ok('unsubscribed')], unsubscribe_mail: [ok('invalid')] } });
  assert.equal(await view.api.run(view.window), 'tips');
  assert.deepEqual(view.replaced, ['/unsubscribe'], 'the token leaves the address bar before anything is asked');
  assert.deepEqual(asked(view), ['unsubscribe_email_tips', 'unsubscribe_mail']);
  for (const { init } of view.requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.apikey, 'public-anon-key');
    assert.equal(init.headers.Authorization, 'Bearer public-anon-key');
    assert.deepEqual(JSON.parse(init.body), { p_token: TOKEN });
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
  }
  assert.deepEqual(shown(view.ids), { state: 'tips', title: 'You’re unsubscribed',
    message: 'You’re unsubscribed from tips and offers. Service messages about your account and walkthroughs still arrive.',
    retry: false, next: 'To change your email preferences, sign in to your account.' });
  assert.equal(view.ids['unsubscribe-title'].focused, 1);
});

test('a reminder link (the dispatcher’s trial reminder) still unsubscribes, in its own words', async () => {
  const view = page({ answers: { unsubscribe_email_tips: [ok('invalid')], unsubscribe_mail: [ok('unsubscribed')] } });
  assert.equal(await view.api.run(view.window), 'reminder');
  assert.equal(shown(view.ids).title, 'You’re unsubscribed');
  assert.match(shown(view.ids).message, /^You’re unsubscribed from reminder emails\./);
  assert.match(shown(view.ids).message, /Service messages about your account and walkthroughs still arrive\.$/);
  // Before the tips function is deployed the reminder link works exactly as before.
  const early = page({ answers: { unsubscribe_email_tips: [MISSING], unsubscribe_mail: [ok('unsubscribed')] } });
  assert.equal(await early.api.run(early.window), 'reminder');
});

test('a used link and an unknown link read the same: already used or not valid, naming nobody', async () => {
  const cases = [
    { unsubscribe_email_tips: [ok('already')], unsubscribe_mail: [ok('invalid')] },
    { unsubscribe_email_tips: [ok('invalid')], unsubscribe_mail: [ok('already')] },
    { unsubscribe_email_tips: [ok('invalid')], unsubscribe_mail: [ok('invalid')] },
    { unsubscribe_email_tips: [MISSING], unsubscribe_mail: [ok('invalid')] },
    { unsubscribe_email_tips: [ok('invalid')], unsubscribe_mail: [MISSING] },
    // A function that knows the token decides, even when the other one failed.
    { unsubscribe_email_tips: [ok('already')], unsubscribe_mail: [{ status: 500, body: {} }] },
  ];
  const seen = new Set();
  for (const answers of cases) {
    const view = page({ answers });
    assert.equal(await view.api.run(view.window), 'used', JSON.stringify(answers));
    seen.add(JSON.stringify(shown(view.ids)));
  }
  assert.equal(seen.size, 1, 'every one of them shows exactly the same page');
  const [only] = [...seen].map(JSON.parse);
  assert.deepEqual(only, { state: 'used', title: 'Nothing changed', message: 'This link has already been used or is not valid.',
    retry: false, next: 'If you used this link before, you’re already unsubscribed. To check or change your email preferences, sign in to your account.' });
});

test('a malformed or missing token reads as not valid without asking the server', async () => {
  for (const search of ['', '?t=short', `?t=${TOKEN.toUpperCase()}`, `?t=${TOKEN}0`, `?x=${TOKEN}`]) {
    const view = page({ search });
    assert.equal(await view.api.run(view.window), 'used', search);
    assert.equal(view.requests.length, 0, search);
    assert.deepEqual(view.replaced, ['/unsubscribe'], search);
    assert.equal(shown(view.ids).message, 'This link has already been used or is not valid.');
  }
  assert.equal(page().api.readToken(`?utm=1&t=${TOKEN}&x=2`), TOKEN);
});

test('a failure is an error with Try again, which asks only the function that failed', async () => {
  for (const failure of [{ status: 500, body: { message: 'x' } }, { status: 200, body: { state: 'maybe' } },
    { status: 200, body: null }, new Error('offline')]) {
    const view = page({ answers: { unsubscribe_email_tips: [failure, ok('unsubscribed')], unsubscribe_mail: [ok('invalid')] } });
    assert.equal(await view.api.run(view.window), 'error');
    assert.deepEqual(shown(view.ids), { state: 'error', title: 'We couldn’t record that',
      message: view.api.COPY.error.message, retry: true, next: null });
    assert.equal(view.ids['unsubscribe-retry'].disabled, false);
    assert.equal(await view.ids['unsubscribe-retry'].events.click(), 'tips');
    assert.deepEqual(asked(view), ['unsubscribe_email_tips', 'unsubscribe_email_tips', 'unsubscribe_mail']);
    assert.equal(shown(view.ids).retry, false);
  }
  const unconfigured = page({ config: null });
  assert.equal(await unconfigured.api.run(unconfigured.window), 'error');
  assert.equal(unconfigured.requests.length, 0);
});

test('a backend with neither function says so and gives the support route, with nothing to retry', async () => {
  const view = page({ answers: { unsubscribe_email_tips: [MISSING], unsubscribe_mail: [{ status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }] } });
  assert.equal(await view.api.run(view.window), 'unavailable');
  assert.equal(shown(view.ids).retry, false);
  assert.match(shown(view.ids).message, /yoda@yodalai\.xyz/);
  assert.equal(view.api.outcome({ a: 'missing', b: 'error' }), 'error', 'a failure next to a missing function can be retried');
});

test('the page matches the site shell: noindex, no referrer, versioned assets, live status, the sign-in route', () => {
  assert.match(markup, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(markup, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(markup, /<header class="wrap">[\s\S]*VEYLET STUDIO[\s\S]*<\/header>/);
  assert.match(markup, /<footer class="wrap">/);
  assert.match(markup, /<main id="main" class="form-page wrap unsubscribe-page" data-state="loading">/);
  assert.match(markup, /id="unsubscribe-message" role="status" aria-live="polite"/);
  assert.match(markup, /<button type="button" class="button" id="unsubscribe-retry" hidden>Try again<\/button>/);
  assert.match(markup, /<a class="button button-ghost" href="\/account">Sign in to change email preferences<\/a>/);
  assert.match(markup, /min-height: 44px/);
  const hash = file => createHash('sha256').update(fs.readFileSync(path.join(dist, file))).digest('hex').slice(0, 16);
  for (const file of ['style.css', 'brand-host.js', 'supabase-public.js', 'unsubscribe.js']) {
    assert.ok(markup.includes(`/${file}?v=${hash(file)}`), `${file} is versioned by its bytes`);
  }
  // Every state's words are plain and name no amount, and no address but the site's one support
  // address (the owner's, 26 September 2026: yoda@yodalai.xyz everywhere on the site).
  const { COPY, NEXT } = page().api;
  for (const words of [...Object.values(COPY).map(copy => copy.title + ' ' + copy.message), ...Object.values(NEXT)]) {
    assert.doesNotMatch(words.replace(/yoda@yodalai\.xyz/g, 'SUPPORT'), /A\$|\d{3,}|@/);
  }
  // Only the two unsubscribe functions are ever named.
  assert.deepEqual([...page().api.FUNCTIONS], ['unsubscribe_email_tips', 'unsubscribe_mail']);
});
