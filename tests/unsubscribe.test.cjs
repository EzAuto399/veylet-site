/*
 * /unsubscribe (dist/unsubscribe/index.html + dist/unsubscribe.js): the reminder email's unsubscribe link.
 * It reads the 64-hex token from ?t=, removes it from the address bar, calls rpc/unsubscribe_mail once with
 * the public key and says one of: unsubscribed, already unsubscribed, invalid link, or error (with Try again).
 * The answer comes from the sibling repository's 20260925110000_render_status.sql (state: unsubscribed,
 * already or invalid).
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

class Element {
  constructor(tag, hidden) { this.tagName = tag.toUpperCase(); this.hidden = hidden; this.disabled = false; this.textContent = ''; this.attributes = {}; this.events = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, handler) { this.events[name] = handler; }
  focus() { this.focused = (this.focused || 0) + 1; }
}

function page({ search = `?t=${TOKEN}`, answers = [], config = CONFIG } = {}) {
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
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return { ok: answer.status === 200, json: async () => answer.body };
    },
  };
  vm.runInNewContext(script, { window, document: window.document, JSON, Promise });
  return { api: window.VeyletUnsubscribe, window, ids, requests, replaced };
}

const shown = ids => ({ state: ids.main.attributes['data-state'], title: ids['unsubscribe-title'].textContent,
  message: ids['unsubscribe-message'].textContent, retry: !ids['unsubscribe-retry'].hidden,
  scope: !ids['unsubscribe-scope'].hidden });

test('a valid link unsubscribes once, with the public key and the token only, and takes the token out of the address bar', async () => {
  const view = page({ answers: [{ status: 200, body: { state: 'unsubscribed', unsubscribed: true } }] });
  assert.equal(await view.api.run(view.window), 'unsubscribed');
  assert.deepEqual(view.replaced, ['/unsubscribe']);
  assert.equal(view.requests.length, 1);
  const [{ url, init }] = view.requests;
  assert.equal(url, 'https://project.supabase.invalid/rest/v1/rpc/unsubscribe_mail');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.apikey, 'public-anon-key');
  assert.equal(init.headers.Authorization, 'Bearer public-anon-key');
  assert.deepEqual(JSON.parse(init.body), { p_token: TOKEN });
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(shown(view.ids), { state: 'unsubscribed', title: 'You’re unsubscribed',
    message: view.api.COPY.unsubscribed.message, retry: false, scope: true });
  assert.equal(view.ids['unsubscribe-title'].focused, 1);
});

test('a second visit says already unsubscribed', async () => {
  const view = page({ answers: [{ status: 200, body: { state: 'already', unsubscribed: true } }] });
  assert.equal(await view.api.run(view.window), 'already');
  assert.equal(shown(view.ids).title, 'You’re already unsubscribed');
  assert.equal(shown(view.ids).scope, true);
});

test('an unknown token, a malformed token or no token reads as an invalid link; only the unknown one asks the server', async () => {
  const unknown = page({ answers: [{ status: 200, body: { state: 'invalid', unsubscribed: false } }] });
  assert.equal(await unknown.api.run(unknown.window), 'invalid');
  assert.equal(unknown.requests.length, 1);
  for (const search of ['', '?t=short', `?t=${TOKEN.toUpperCase()}`, `?t=${TOKEN}0`, `?x=${TOKEN}`]) {
    const view = page({ search });
    assert.equal(await view.api.run(view.window), 'invalid', search);
    assert.equal(view.requests.length, 0, search);
    assert.deepEqual(shown(view.ids), { state: 'invalid', title: 'This link doesn’t work',
      message: view.api.COPY.invalid.message, retry: false, scope: false });
  }
  assert.equal(page().api.readToken(`?utm=1&t=${TOKEN}&x=2`), TOKEN);
});

test('a failed request or an unexpected answer is an error with Try again, which asks again', async () => {
  for (const answer of [{ status: 500, body: { message: 'x' } }, { status: 200, body: { state: 'maybe' } },
    { status: 200, body: null }, new Error('offline')]) {
    const view = page({ answers: [answer, { status: 200, body: { state: 'unsubscribed' } }] });
    assert.equal(await view.api.run(view.window), 'error');
    assert.deepEqual(shown(view.ids), { state: 'error', title: 'We couldn’t record that',
      message: view.api.COPY.error.message, retry: true, scope: false });
    assert.equal(view.ids['unsubscribe-retry'].disabled, false);
    assert.equal(await view.ids['unsubscribe-retry'].events.click(), 'unsubscribed');
    assert.equal(view.requests.length, 2);
    assert.equal(shown(view.ids).retry, false);
  }
  const unconfigured = page({ config: null });
  assert.equal(await unconfigured.api.run(unconfigured.window), 'error');
  assert.equal(unconfigured.requests.length, 0);
});

test('the page matches the site shell: noindex, no referrer, versioned assets, live status, the 44px actions', () => {
  assert.match(markup, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(markup, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(markup, /<header class="wrap">[\s\S]*VEYLET STUDIO[\s\S]*<\/header>/);
  assert.match(markup, /<footer class="wrap">/);
  assert.match(markup, /<main id="main" class="form-page wrap unsubscribe-page" data-state="loading">/);
  assert.match(markup, /id="unsubscribe-message" role="status" aria-live="polite"/);
  assert.match(markup, /<button type="button" class="button" id="unsubscribe-retry" hidden>Try again<\/button>/);
  assert.match(markup, /min-height: 44px/);
  const hash = file => createHash('sha256').update(fs.readFileSync(path.join(dist, file))).digest('hex').slice(0, 16);
  for (const file of ['style.css', 'brand-host.js', 'supabase-public.js', 'unsubscribe.js']) {
    assert.ok(markup.includes(`/${file}?v=${hash(file)}`), `${file} is versioned by its bytes`);
  }
  // Every state's words are plain and name no person, address or amount.
  for (const copy of Object.values(page().api.COPY)) {
    assert.doesNotMatch(copy.title + copy.message, /A\$|\d{3,}|@(?!veylet\.com)/);
  }
});
