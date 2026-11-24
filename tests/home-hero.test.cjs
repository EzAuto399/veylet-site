'use strict';
// Home hero, design spec v2 6.1 and 7.5: the real sample walkthrough as the hero, every hero state,
// one honest line, and the sample named in one place.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const html = read('index.html');
const words = markup => markup.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const main = html.match(/<main\b[\s\S]*?<\/main>/)[0];
const hero = html.match(/<section class="vh"[\s\S]*?<\/section>/)[0];

test('the hero is the real sample, labelled, with one headline, one sentence and one call to action group', () => {
  assert.match(hero, /<h1 id="hero-title"[^>]*>Your listing, walked through\.<\/h1>/);
  assert.match(words(hero), /Walk the home once with your iPhone\. Buyers open the 3D walkthrough from a link or QR code\. No app for them\./);
  assert.match(hero, /class="vh-get" href="https:\/\/apps\.apple\.com\/au\/app\/veylet-3d-property-tours\/id6814273913" data-launch-cta/);
  assert.match(hero, /href="\/handoff\?sample=1"[^>]*>See what buyers get/);
  assert.match(words(hero), /Works with recent iPhone Pro and iPad Pro models\. Free first month\. Not on iPhone Pro\? Join the waitlist/);
  assert.match(words(hero), /Sample walkthrough/, 'the sample label sits on the poster');
  assert.match(hero, /<button class="vh-explore"[^>]*>[\s\S]*?Explore in 3D<\/button>/);
  assert.match(words(hero), /About 35 MB · Watch a 1 min video instead/, 'the low-data path shows before anything downloads');
  assert.doesNotMatch(hero, /illus-hero-room|Illustration:/, 'no illustration represents the product');
  assert.equal([...hero.matchAll(/<h1\b/g)].length, 1);
});

test('the sample is named in one place, so a listing-grade room can replace it', () => {
  const stage = hero.match(/<div class="vh-stage"[^>]*>/)[0];
  assert.match(stage, /data-sample-base="\/samples\/eyeful-apartment\/"/);
  assert.match(stage, /data-sample-video="\/media\/result-listing-16x9\.mp4"/);
  assert.match(stage, /--vh-lqip: url\(data:image\/webp;base64,/);
  const samplePaths = [...html.matchAll(/samples\/eyeful-apartment\/[\w.-]*/g)].map(m => m[0]);
  assert.deepEqual([...new Set(samplePaths)].sort(), ['samples/eyeful-apartment/', 'samples/eyeful-apartment/poster-portrait.webp', 'samples/eyeful-apartment/poster.webp']);
  const heroStage = hero.slice(hero.indexOf('<div class="vh-stage"'), hero.indexOf('<div class="vh-player"'));
  for (const file of samplePaths) assert.ok(heroStage.includes(file), file + ' is inside the sample block');
  const js = read('hero.js');
  assert.doesNotMatch(js, /eyeful|result-listing|poster\.webp/, 'hero.js reads the sample from the page, never its own copy');
  for (const file of ['samples/eyeful-apartment/poster.webp', 'samples/eyeful-apartment/poster-portrait.webp', 'samples/eyeful-apartment/manifest.json', 'media/result-listing-16x9.mp4']) {
    assert.ok(fs.existsSync(path.join(dist, file)), file);
  }
  assert.ok(fs.statSync(path.join(dist, 'samples/eyeful-apartment/poster.webp')).size <= 120 * 1024, 'poster within the 120 KB budget');
  assert.match(hero, /<img src="\/samples\/eyeful-apartment\/poster\.webp"[^>]*width="1600" height="900" fetchpriority="high"/);
});

test('one honest line replaces the three disclaimers, and the stills band is gone', () => {
  const page = words(main);
  assert.equal((page.match(/a research capture processed by Veylet, not captured with an iPhone\./g) || []).length, 1);
  assert.doesNotMatch(page, /We do not yet have a client-accepted tour|no client-accepted walkthrough to show yet|Our own captures are still under quality review/);
  assert.doesNotMatch(main, /data-home-preview|drag across to preview/, 'the stills band that looked like 3D is cut');
  assert.match(main, /<summary>Can I see a real customer example\?<\/summary>\s*<p>Not yet\.[^<]*<a href="\/see">Explore it full screen<\/a>\.<\/p>/, 'the FAQ answer links to the sample');
  assert.doesNotMatch(html, /When video exports open|when video exports open/);
});

test('Get the app appears in the hero, the closing band and the phone bar only', () => {
  const ctas = [...html.matchAll(/<a\b[^>]*href="https:\/\/apps\.apple\.com[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(m => words(m[0]).trim());
  assert.deepEqual(ctas, ['Get the app', 'Get the app', 'Get the app', 'Get the app'], 'hero, live chip, closing band, sticky bar');
  const sticky = html.match(/<nav class="sticky-cta"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(sticky, /See a result/);
  assert.match(main, /data-hero-actions/, 'the phone bar waits until the hero button has scrolled away (app.js)');
});

test('without JavaScript the poster carries a plain link to /see; the script and stylesheet are deferred', () => {
  assert.match(hero, /<a class="vh-nojs" href="\/see" data-hero-nojs>Open the sample walkthrough<\/a>/);
  assert.match(html, /<script src="\/hero\.js\?v=[a-f\d]{16}" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/hero\.css\?v=[a-f\d]{16}" \/>/);
  assert.doesNotMatch(html, /<script src="\/(?:tour-player-v2|vendor\/playcanvas)/, 'no engine bytes before intent');
});

test('reduced motion drops the Ken Burns, the entrance and the dissolve', () => {
  const css = read('hero.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.vh \*, \.vh \*::before, \.vh \*::after \{ animation: none !important; \}/);
  assert.match(css, /@keyframes vh-kenburns \{ from \{ transform: scale\(1\); \} to \{ transform: scale\(1\.04\); \} \}/);
  assert.match(css, /animation: vh-kenburns 8s linear 1 both/, 'Ken Burns runs once');
  assert.doesNotMatch(css, /transition:[^;]*\b(?:width|height|top|left)\b/, 'only transform and opacity animate');
});

// ---------- behaviour: hero.js in a stand-in DOM ----------
function boot({ saveData = false, reduce = false, phone = false } = {}) {
  let window = null;
  const document = createDocument({ onHeadAppend: node => { if (node.tagName === 'SCRIPT') { window.VeyletPlayerV2 = player; node.onload(); } } });
  const N = document.FakeNode.prototype;
  const dataKey = name => name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  N.hasAttribute = function (name) { return name.startsWith('data-') ? dataKey(name) in this.dataset : this.getAttribute(name) !== null; };
  N.play = () => Promise.resolve();
  N.toggleAttribute = function (name, on) { if (on) this.setAttribute(name, ''); else if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())]; else this.removeAttribute(name); };
  const make = (tag, data, parent, attrs = {}) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(data)) node.setAttribute('data-' + key, value);
    for (const [key, value] of Object.entries(attrs)) node[key] = value;
    parent.append(node);
    return node;
  };
  document.documentElement = document.createElement('html');
  const section = make('section', { hero: '', phase: 'ready' }, document.body);
  const stage = make('div', { 'hero-stage': '', 'sample-base': '/samples/x/', 'sample-video': '/media/x.mp4' }, section);
  const poster = make('picture', { 'hero-poster': '' }, stage);
  make('img', {}, poster, { complete: true, naturalWidth: 1600 });
  const el = {};
  for (const name of ['player', 'video', 'explore', 'progress', 'pct', 'low', 'slow', 'failed', 'save-data', 'retry', 'nojs', 'exit', 'like']) el[name] = make(name === 'pct' ? 'span' : 'div', { ['hero-' + name]: '' }, stage);
  el.watch = make('button', { 'hero-watch': '' }, el.low);
  el.load = make('button', { 'hero-load': '' }, el['save-data']);
  const timers = [];
  const winListeners = new Map();
  let resolveStart, starts = [];
  const player = { start: (target, options) => { starts.push({ target, options }); return new Promise(resolve => { resolveStart = resolve; }); } };
  window = {
    document, navigator: { connection: saveData ? { saveData: true } : undefined },
    matchMedia: query => ({ matches: query.includes('reduce') ? reduce : query.includes('639') ? phone : false }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms, done: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].done = true; },
    addEventListener: (type, fn) => { if (!winListeners.has(type)) winListeners.set(type, []); winListeners.get(type).push(fn); },
    scrollTo() {}, scrollY: 0, AbortController,
    Promise,
  };
  window.window = window;
  vm.runInNewContext(read('hero.js'), window);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const advance = ms => { for (const t of timers) if (!t.done && t.ms <= ms) { t.done = true; t.fn(); } };
  const progress = percent => (winListeners.get('veylet-viewer-progress') || []).forEach(fn => fn({ detail: { percent } }));
  const key = k => (document.listeners.get('keydown') || new Set()).forEach(fn => fn({ key: k, defaultPrevented: false }));
  return { document, section, stage, el, flush, advance, progress, key, starts: () => starts, finish: outcome => resolveStart(outcome) };
}
const shown = (h, names) => {
  const parts = ['explore', 'progress', 'low', 'slow', 'failed', 'save-data', 'exit'];
  assert.deepEqual(parts.filter(name => !h.el[name].hidden), names);
};

test('ready: the poster shows Explore, the low-data line and no engine; the no-JS link hides', () => {
  const h = boot();
  assert.equal(h.section.dataset.phase, 'ready');
  shown(h, ['explore', 'low']);
  assert.equal(h.el.nojs.hidden, true);
  assert.equal(h.stage.dataset.poster, 'shown');
  assert.equal(h.document.head.children.length, 0, 'nothing preloads before intent');
  h.el.explore.dispatch('pointerenter');
  assert.deepEqual(h.document.head.children.map(n => n.rel), ['preload', 'modulepreload'], 'hover preloads the player and engine');
});

test('Explore: loading shows the real percentage, the slow line at 10 s, then the live walkthrough', async () => {
  const h = boot();
  h.el.explore.click();
  await h.flush();
  assert.equal(h.section.dataset.phase, 'loading');
  shown(h, ['progress', 'low']);
  assert.equal(h.starts()[0].options.base, '/samples/x/');
  assert.equal(h.starts()[0].options.waitForTap, false);
  h.progress(42);
  assert.equal(h.el.pct.textContent, '42%');
  assert.equal(h.el.progress.getAttribute('aria-valuenow'), '42');
  h.advance(10000);
  assert.equal(h.section.dataset.phase, 'slow');
  shown(h, ['progress', 'slow']);
  h.finish({ readiness: 'viewer-ready' });
  await h.flush();
  assert.equal(h.section.dataset.phase, 'live');
  shown(h, ['exit']);
  h.advance(20000);
  assert.equal(h.el.like.hidden, false, 'after 20 s the quiet bar offers the one call to action');
});

test('failure at 45 s or from the player returns the poster with Try again focused', async () => {
  const h = boot();
  h.el.explore.click();
  await h.flush();
  h.advance(45000);
  assert.equal(h.section.dataset.phase, 'failed');
  shown(h, ['failed']);
  assert.equal(h.document.activeElement, h.el.retry);
  h.el.retry.click();
  await h.flush();
  assert.equal(h.section.dataset.phase, 'loading');
  h.finish({ readiness: 'viewer-failed', reason: 'engine-unavailable' });
  await h.flush();
  assert.equal(h.section.dataset.phase, 'failed');
});

test('Exit 3D and Escape return to the poster with focus on Explore; phones go full screen while live', async () => {
  const h = boot({ phone: true });
  h.el.explore.click();
  await h.flush();
  h.finish({ readiness: 'viewer-ready' });
  await h.flush();
  assert.equal(h.section.dataset.phase, 'live');
  assert.equal(h.section.hasAttribute('data-immersive'), true);
  h.key('Escape');
  assert.equal(h.section.dataset.phase, 'ready');
  assert.equal(h.section.hasAttribute('data-immersive'), false);
  assert.equal(h.document.activeElement, h.el.explore);
  assert.equal(h.el.player.children.length, 0, 'the player is torn down');
});

test('Data Saver offers the video first; the video is a real control with Exit', () => {
  const h = boot({ saveData: true });
  assert.equal(h.section.dataset.phase, 'save-data');
  shown(h, ['save-data']);
  h.el.watch.click();
  assert.equal(h.section.dataset.phase, 'video');
  const clip = h.el.video.children[0];
  assert.equal(clip.tagName, 'VIDEO');
  assert.equal(clip.src, '/media/x.mp4');
  assert.equal(clip.controls, true);
  h.el.exit.click();
  assert.equal(h.section.dataset.phase, 'save-data');
});

test('reduced motion skips the entrance and the Ken Burns', () => {
  assert.equal(boot({ reduce: true }).section.dataset.intro, undefined);
  assert.equal(boot({ reduce: true }).stage.dataset.motion, 'reduced');
  assert.equal(boot().section.dataset.intro, '');
});
