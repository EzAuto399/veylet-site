const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../dist/brand-host.js'), 'utf8');
const REF = 'ntupgokxauegrnnvacqt';
const KEY = `sb-${REF}-auth-token`;
const inSeconds = seconds => Math.floor(Date.now() / 1000) + seconds;

/*
 * Runs brand-host.js against a header with the shared nav. `storage` is a
 * key/value object, 'throw' for a browser that refuses storage, or
 * 'throw-read' for one that lists keys but refuses to read them.
 */
function run({ storage = {}, config = true, hostname = 'veylet.com', readyState = 'loading', links } = {}) {
  const nav = (links || [['/#process', 'How it works'], ['/offer', 'Offer'], ['/account', 'Sign in']])
    .map(([href, text]) => ({ textContent: text, getAttribute: name => (name === 'href' ? href : null) }));
  const events = {}, replaced = [], reads = [];
  const keys = storage === 'throw' || storage === 'throw-read' ? [KEY] : Object.keys(storage);
  const localStorage = {
    get length() { return keys.length; },
    key: index => keys[index] ?? null,
    getItem: key => { reads.push(key); if (storage === 'throw-read') throw new Error('SecurityError'); return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
  };
  const window = { VEYLET_SUPABASE: config ? { url: `https://${REF}.supabase.co`, anonKey: 'public' } : undefined };
  Object.defineProperty(window, 'localStorage', { get() { if (storage === 'throw') throw new Error('SecurityError'); return localStorage; } });
  const document = {
    readyState,
    addEventListener: (name, fn) => { events[name] = fn; },
    querySelectorAll: selector => (selector === 'header nav a' ? nav : []),
  };
  const location = { hostname, pathname: '/offer', search: '?a=1', hash: '#b', href: `https://${hostname}/offer`, replace: url => replaced.push(url) };
  const network = [];
  const context = { window, document, location, URL, Date, JSON, Number, fetch: (...args) => network.push(args), XMLHttpRequest: function () { network.push('xhr'); } };
  vm.runInNewContext(source, context);
  events.DOMContentLoaded?.();
  return { label: nav.length ? nav[nav.length - 1].textContent : null, nav, replaced, network, reads };
}
const session = expiresAt => JSON.stringify({ access_token: 'x', token_type: 'bearer', expires_at: expiresAt, refresh_token: 'y', user: { id: 'u' } });

test('a stored, unexpired session makes the header say Account after the page loads', () => {
  const h = run({ storage: { [KEY]: session(inSeconds(3600)) } });
  assert.equal(h.label, 'Account');
  assert.deepEqual(h.nav.slice(0, 2).map(link => link.textContent), ['How it works', 'Offer']);
  assert.deepEqual(h.network, [], 'presence only: no request is made');
  // Already loaded (a late script) behaves the same.
  assert.equal(run({ storage: { [KEY]: session(inSeconds(3600)) }, readyState: 'complete' }).label, 'Account');
});

test('an expired session that can still renew counts as signed in', () => {
  assert.equal(run({ storage: { [KEY]: session(inSeconds(-86400)) } }).label, 'Account');
});

test('an expired unrenewable, absent, malformed or unrelated session leaves Sign in', () => {
  const unrenewable = JSON.stringify({ access_token: 'x', expires_at: inSeconds(-60), refresh_token: '' });
  for (const storage of [{}, { [KEY]: unrenewable }, { [KEY]: '{not json' }, { [KEY]: 'null' },
    { [KEY]: JSON.stringify({ access_token: 'x' }) }, { 'sb-otherproject-auth-token': session(inSeconds(3600)) },
    { [KEY + '-code-verifier']: session(inSeconds(3600)) }]) {
    assert.equal(run({ storage }).label, 'Sign in', JSON.stringify(storage));
  }
});

test('without the page config the project key is found by its pattern only', () => {
  assert.equal(run({ config: false, storage: { [KEY]: session(inSeconds(3600)) } }).label, 'Account');
  assert.equal(run({ config: false, storage: { 'sb-Upper-auth-token': session(inSeconds(3600)), 'other-auth-token': session(inSeconds(3600)) } }).label, 'Sign in');
  // With the config, another project's key is not this sign-in.
  const configured = run({ storage: { 'sb-anotherref-auth-token': session(inSeconds(3600)) } });
  assert.equal(configured.label, 'Sign in');
  assert.deepEqual(configured.reads, [KEY]);
});

test('storage that throws changes nothing and never breaks the page', () => {
  for (const storage of ['throw', 'throw-read']) {
    let h;
    assert.doesNotThrow(() => { h = run({ storage }); });
    assert.equal(h.label, 'Sign in');
  }
});

test('only the account link that says Sign in is relabelled, and pages without it are untouched', () => {
  const h = run({ storage: { [KEY]: session(inSeconds(3600)) },
    links: [['/offer', 'Sign in'], ['/account', 'Your account'], ['https://veylet.com/account/', 'Sign in'], ['/accounts', 'Sign in']] });
  assert.deepEqual(h.nav.map(link => link.textContent), ['Sign in', 'Your account', 'Account', 'Sign in']);
  assert.doesNotThrow(() => run({ storage: { [KEY]: session(inSeconds(3600)) }, links: [] }));
});

test('the canonical-host redirect still runs first and unchanged', () => {
  const h = run({ hostname: 'www.veylet.com', storage: {} });
  assert.deepEqual(h.replaced, ['https://veylet.com/offer?a=1#b']);
  assert.deepEqual(run({ hostname: 'veylet-site.vercel.app' }).replaced, ['https://veylet.com/offer?a=1#b']);
  assert.deepEqual(run({ hostname: 'veylet.com' }).replaced, []);
  const redirect = "if (nonCanonicalHosts.has(location.hostname)) {\n  location.replace('https://veylet.com' + location.pathname + location.search + location.hash);\n}";
  assert.ok(source.includes(redirect));
  assert.ok(source.indexOf(redirect) < source.indexOf('localStorage'), 'the redirect precedes the session check');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon/);
});
