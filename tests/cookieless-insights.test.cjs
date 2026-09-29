'use strict';
/*
 * /insights.js (29 Sep 2026, owner decision: cookieless Vercel counts added): Vercel Web Analytics counts
 * page views on the public pages listed in the sitemap, on veylet.com only, without cookies, stored
 * identifiers or custom events, and every URL leaves without its query string or fragment. Google
 * Analytics stays exactly as it was: consent-gated on four pages (tests/analytics-integration.test.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const script = read('insights.js');
const version = createHash('sha256').update(fs.readFileSync(path.join(dist, 'insights.js'))).digest('hex').slice(0, 16);
const OFF = 'veylet.analyticsOff';

// Sitemap pages without the counter, and why. /waitlist is an intake form: the privacy notice says
// measurement does not run on enquiry or application forms, so the form pages stay uncounted.
const EXCLUDED = { '/waitlist': 'intake form' };
const sitemap = [...read('sitemap.xml').matchAll(/<loc>https:\/\/veylet\.com(\/[^<]*)<\/loc>/g)].map(match => match[1]);
const fileOf = route => path.posix.join(route.replace(/\/$/, ''), 'index.html').replace(/^\//, '');
const counted = sitemap.filter(route => !EXCLUDED[route]).map(fileOf);

function htmlFiles(dir = dist, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const file = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? htmlFiles(path.join(dir, entry.name), file) : file.endsWith('.html') ? [file] : [];
  });
}

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

/** Loads the script as a page at `href` would, and returns what it added. */
function visit(href, store = storage()) {
  const appended = [];
  const location = new URL(href);
  const window = { location, sessionStorage: store };
  const document = { createElement: tag => ({ tag }), head: { appendChild: node => appended.push(node) } };
  vm.runInNewContext(script, { window, document, URL });
  return { window, appended, store };
}

test('every sitemap page but the intake form loads the counter once, in <head>, at its current version', () => {
  assert.equal(sitemap.length, 42, 'the sitemap this slice was reviewed against');
  const tag = `<script src="/insights.js?v=${version}" defer></script>`;
  for (const file of counted) {
    const html = read(file);
    assert.equal(html.split('/insights.js').length - 1, 1, `${file} references the counter once`);
    assert.ok(html.includes(tag), `${file} loads ${tag}`);
    assert.ok(html.indexOf(tag) < html.indexOf('</head>'), `${file} loads it in <head>`);
  }
  assert.equal(counted.length, 41);
});

test('no other page loads the counter: app, account, sign-in, embed, player, report, request, handoff, tour and form pages', () => {
  const others = htmlFiles().filter(file => !counted.includes(file));
  for (const file of others) assert.doesNotMatch(read(file), /insights\.js|_vercel\/insights/, file);
  // The areas the counter must never reach exist, so the check above covers them.
  for (const area of ['app/', 'account/', 'auth/', 'embed/', 'play/', 'report/', 'request/', 'handoff/', 'tour/', 'studio/', 'join/', 'thanks/', 'waitlist/']) {
    assert.ok(others.some(file => file.startsWith(area)), `${area} has pages checked`);
  }
  assert.ok(others.includes('app/privacy/index.html') && others.includes('app/help/index.html'));
});

test('on veylet.com it queues the query-stripping hook, then adds the first-party counter once', () => {
  for (const href of ['https://veylet.com/', 'https://www.veylet.com/guides']) {
    const { window, appended } = visit(href);
    assert.deepEqual(appended, [{ tag: 'script', src: '/_vercel/insights/script.js', defer: true }], href);
    assert.equal(typeof window.va, 'function');
    assert.equal(window.vaq.length, 1);
    assert.equal(window.vaq[0][0], 'beforeSend');
  }
});

test('beforeSend drops the query string and fragment, and an unreadable URL drops the event', () => {
  const { window } = visit('https://veylet.com/offer?utm_source=instagram');
  const beforeSend = window.vaq[0][1];
  const event = beforeSend({ type: 'pageview', url: 'https://veylet.com/offer?email=a%40b.example&fbclid=IwAR0#answers-title' });
  assert.deepEqual(JSON.parse(JSON.stringify(event)), { type: 'pageview', url: 'https://veylet.com/offer' });
  assert.equal(beforeSend({ type: 'pageview', url: 'https://www.veylet.com/?analytics=on' }).url, 'https://www.veylet.com/');
  assert.equal(beforeSend({ type: 'pageview', url: 'not a url' }), null);
});

test('other hosts, previews and local builds are never counted', () => {
  for (const href of ['http://127.0.0.1:8911/', 'http://localhost:8904/offer', 'https://veylet-site.vercel.app/',
    'https://veylet.com.evil.example/', 'https://preview.veylet.com/', 'https://yodalai.xyz/']) {
    const { window, appended } = visit(href);
    assert.equal(appended.length, 0, href);
    assert.equal(window.va, undefined, href);
  }
});

test('?analytics=off skips counting and keeps the tab uncounted; blocked storage still honours the page switch', () => {
  const store = storage();
  assert.equal(visit('https://veylet.com/?analytics=off', store).appended.length, 0);
  assert.equal(store.map.get(OFF), '1');
  assert.equal(visit('https://veylet.com/offer', store).appended.length, 0, 'later pages in the tab');
  assert.equal(visit('https://veylet.com/see?utm_source=x&analytics=off').appended.length, 0);
  assert.equal(visit('https://veylet.com/?analytics=offline').appended.length, 1, 'only the exact switch');
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(visit('https://veylet.com/?analytics=off', blocked).appended.length, 0);
  assert.equal(visit('https://veylet.com/', blocked).appended.length, 1);
});

test('no cookie, no localStorage, no network or custom events of its own', async () => {
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /cookie|localStorage|indexedDB|fetch|XMLHttpRequest|sendBeacon|https?:|Image\(|track|'event'|pageview/i);
  assert.ok(script.split('\n').length <= 45, 'small');
  // The counter's path is Vercel's own route, so the build never versions it as a dist file.
  const { mapAssetReferences } = await import(pathToFileURL(path.join(__dirname, '../scripts/asset-versions.mjs')));
  const visited = [];
  mapAssetReferences(script, 'insights.js', (file, url) => { visited.push(file); return url.pathname; });
  assert.deepEqual(visited, []);
});

test('both privacy notices name the cookieless counts next to the consent-gated Google Analytics', () => {
  const sentence = 'veylet.com counts page views with Vercel Web Analytics, which uses no cookies and stores no personal identifiers: it counts the page address (without query strings or fragments), the referrer, the country and the device type in aggregate, and Google Analytics still runs only after you allow it.';
  for (const file of ['privacy/index.html', 'app/privacy/index.html']) {
    const text = read(file).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(text.includes(sentence), file);
    assert.ok(text.indexOf(sentence) < text.indexOf('Optional website analytics.'), `${file}: beside the analytics disclosure`);
  }
});
