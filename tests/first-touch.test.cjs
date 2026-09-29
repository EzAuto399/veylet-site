/*
 * /first-touch.js (29 Sep 2026, owner): a visit from a campaign link keeps that link's utm labels, the
 * click source (Meta or Google, never the fbclid/gclid value) and the landing path in session storage,
 * so a waitlist sign-up later in the visit says which link brought it. No cookie and no network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dist = path.join(__dirname, '../dist');
const script = fs.readFileSync(path.join(dist, 'first-touch.js'), 'utf8');
const KEY = 'veylet.firstTouch';

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

/** Loads the script as a page would: it captures on load. */
function visit(search, pathname = '/', store = storage()) {
  const window = { location: { search, pathname }, sessionStorage: store };
  vm.runInNewContext(script, { window, JSON, Object, String, decodeURIComponent });
  let stored = null;
  try { stored = JSON.parse(store.map.get(KEY)); } catch (unreadable) { stored = null; }
  return { window, store, stored: stored === undefined ? null : stored };
}

test('a campaign link keeps its labels, the click source and the landing path, never the click id', () => {
  const { window, store, stored } = visit('?utm_source=instagram&utm_medium=paid&utm_campaign=waitlist-sep&utm_content=reel_a&fbclid=IwAR0secret', '/see');
  assert.equal(window.VeyletFirstTouch.KEY, KEY);
  assert.deepEqual(stored, { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'waitlist-sep', utm_content: 'reel_a', click: 'meta', landing: '/see' });
  assert.doesNotMatch(store.map.get(KEY), /IwAR0secret|fbclid/);
  assert.deepEqual(JSON.parse(JSON.stringify(window.VeyletFirstTouch.read(window))), stored);
  const google = visit('?gclid=Cj0secret', '/offer').stored;
  assert.deepEqual(google, { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', click: 'google', landing: '/offer' });
  assert.equal(visit('?fbclid=a&gclid=b').stored.click, 'meta');
});

test('a link without campaign labels or click ids stores nothing', () => {
  for (const search of ['', '?', '?ref=newsletter', '?utm_source=', '?utm_term=roof']) assert.equal(visit(search).stored, null, search);
});

test('a link whose labels are all refused stores nothing, and a later clean link then stores', () => {
  const store = storage();
  assert.equal(visit('?utm_source=Instagram%20Post', '/see', store).stored, null);
  assert.equal(visit('?utm_medium=%3Cb%3E', '/', store).stored, null);
  assert.deepEqual(visit('?utm_source=instagram', '/offer', store).stored,
    { utm_source: 'instagram', utm_medium: '', utm_campaign: '', utm_content: '', click: '', landing: '/offer' });
});

test('the first campaign link of the visit wins; later links do not overwrite it', () => {
  const store = storage();
  visit('?utm_source=instagram', '/', store);
  const later = visit('?utm_source=google&gclid=x', '/offer', store);
  assert.equal(later.stored.utm_source, 'instagram');
  assert.equal(later.stored.click, '');
  assert.equal(later.window.VeyletFirstTouch.capture(later.window), null);
});

test('labels and landing paths outside the allowed shapes are kept as empty', () => {
  const long = 'a'.repeat(101);
  const { stored } = visit(`?utm_source=%3Cscript%3E&utm_medium=a+b&utm_campaign=${long}&utm_content=ok.1~2:3-4_5%2B6`, '/guides/a b');
  assert.deepEqual(stored, { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: 'ok.1~2:3-4_5+6', click: '', landing: '' });
  assert.equal(visit('?utm_source=x&utm_source=y').stored.utm_source, 'x', 'the first value of a repeated label');
  assert.equal(visit('?utm_source=x', '//other.example/x').stored.landing, '', 'a second leading slash is refused');
  assert.equal(visit('?utm_source=x', '/guides/what-is-a-3d-walkthrough').stored.landing, '/guides/what-is-a-3d-walkthrough');
  assert.equal(visit('?utm_source=%E0%A4%A&utm_medium=paid').stored.utm_medium, 'paid', 'a malformed pair is skipped');
  // Tampered storage is cleaned on read.
  const tampered = storage({ [KEY]: JSON.stringify({ utm_source: 'javascript:alert(1)<', click: 'tiktok', landing: 'https://evil.example/' }) });
  const { window } = visit('', '/', tampered);
  assert.deepEqual(JSON.parse(JSON.stringify(window.VeyletFirstTouch.read(window))),
    { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', click: '', landing: '' });
});

test('storage that is blocked or full is silently skipped', () => {
  const blocked = { location: { search: '?utm_source=instagram', pathname: '/' }, get sessionStorage() { throw new Error('SecurityError'); } };
  assert.doesNotThrow(() => vm.runInNewContext(script, { window: blocked, JSON, Object, String, decodeURIComponent }));
  assert.equal(blocked.VeyletFirstTouch.read(blocked), null);
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(visit('?utm_source=instagram', '/', full).window.VeyletFirstTouch.capture({ location: { search: '?utm_source=x', pathname: '/' }, sessionStorage: full }), null);
  const unreadable = storage({ [KEY]: '{not json' });
  const { window } = visit('', '/', unreadable);
  assert.equal(window.VeyletFirstTouch.read(window), null);
});

test('no network, no cookie, small, and loaded by every page that links to the waitlist', () => {
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /fetch|XMLHttpRequest|sendBeacon|cookie|localStorage|https?:|Image\(/);
  assert.ok(script.split('\n').length < 60 + 1, 'under 60 lines');
  const pages = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (entry.name === 'index.html') pages.push(full);
  } };
  walk(dist);
  // App pages (account, sign-in callback, studio, unsubscribe) are never campaign landings and load nothing extra.
  const APP = ['account', 'auth/callback', 'studio', 'unsubscribe'].map(dir => path.join(dist, dir, 'index.html'));
  for (const file of APP) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /first-touch\.js/, path.relative(dist, file));
  const linking = pages.filter(file => !APP.includes(file) && /href="\/waitlist"/.test(fs.readFileSync(file, 'utf8')));
  assert.ok(linking.length >= 5);
  for (const file of [...linking, path.join(dist, 'waitlist/index.html')]) {
    assert.match(fs.readFileSync(file, 'utf8'), /<script src="\/first-touch\.js(?:\?v=[a-f\d]{16})?" defer><\/script>/, path.relative(dist, file));
  }
  // On /waitlist it loads before the form script.
  const waitlist = fs.readFileSync(path.join(dist, 'waitlist/index.html'), 'utf8');
  assert.ok(waitlist.indexOf('/first-touch.js') < waitlist.indexOf('/waitlist/waitlist.js'));
});
