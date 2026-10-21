/*
 * The App Store launch switch (dist/launch-config.js + dist/launch.js): one line,
 * window.VEYLET_LAUNCH.appStoreLive, decides whether the public pages show the
 * "Download on the App Store" experience or the pre-approval waitlist/TestFlight copy.
 * App Store elements ship with the `hidden` attribute so the site reads as the
 * pre-approval site with the flag off and with JavaScript off.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const configSource = read('launch-config.js');
const source = read('launch.js');

// Pages that carry launch markers and must load both launch scripts.
const LAUNCH_PAGES = ['index.html', 'see/index.html', 'offer/index.html', 'start/index.html'];

function load(launchConfig) {
  const window = { VEYLET_LAUNCH_MANUAL: true };
  vm.runInNewContext(configSource, { window, Object });
  if (launchConfig !== undefined) window.VEYLET_LAUNCH = launchConfig;
  vm.runInNewContext(source, { window, document: undefined, Object });
  return window;
}

/** A page with one hidden App Store element and one shown pre-approval element. */
function fakePage() {
  const badge = new Element('a', true, { 'data-launch': 'app-store' });
  badge.textContent = 'Download on the App Store';
  const pre = new Element('div', false, { 'data-launch': 'pre-approval' });
  pre.textContent = 'Join the waitlist';
  const root = new Element('html');
  const lists = { '[data-launch="app-store"]': [badge], '[data-launch="pre-approval"]': [pre] };
  const doc = { documentElement: root, querySelectorAll: selector => lists[selector] || [] };
  return { doc, badge, pre, root };
}

/** The inner HTML of each top-level data-launch="value" region, matching nested same-tag correctly. */
function regions(html, value) {
  const open = new RegExp(`<(\\w+)\\b[^>]*\\bdata-launch="${value}"[^>]*>`, 'g');
  const out = [];
  let match;
  while ((match = open.exec(html))) {
    const tag = match[1];
    const scan = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'g');
    scan.lastIndex = match.index;
    let depth = 0, start = -1, token;
    while ((token = scan.exec(html))) {
      if (token[0][1] === '/') { depth -= 1; if (depth === 0) { out.push(html.slice(start, token.index)); break; } }
      else { if (depth === 0) start = scan.lastIndex; depth += 1; }
    }
  }
  return out;
}

test('the switch is one line and defaults off', () => {
  const lines = configSource.split('\n').filter(line => /appStoreLive/.test(line) && !line.trim().startsWith('*'));
  assert.deepEqual(lines, ['window.VEYLET_LAUNCH = Object.freeze({ appStoreLive: false });']);
  assert.equal(load().VEYLET_LAUNCH.appStoreLive, false);
  assert.equal(load().VeyletLaunch.appStoreLive, false);
});

test('flag off: App Store elements stay hidden, pre-approval copy stays shown', () => {
  const window = load();
  const { doc, badge, pre, root } = fakePage();
  assert.equal(window.VeyletLaunch.apply(doc), false);
  assert.equal(badge.hidden, true, 'App Store badge hidden');
  assert.equal(pre.hidden, false, 'pre-approval copy shown');
  assert.equal(root.getAttribute('data-app-store-live'), 'false');
});

test('flag on: App Store badge visible, waitlist/TestFlight CTAs hidden', () => {
  const window = load(Object.freeze({ appStoreLive: true }));
  const { doc, badge, pre, root } = fakePage();
  assert.equal(window.VeyletLaunch.apply(doc), true);
  assert.equal(badge.hidden, false, 'App Store badge revealed');
  assert.equal(pre.hidden, true, 'pre-approval/waitlist copy hidden');
  assert.equal(root.getAttribute('data-app-store-live'), 'true');
});

test('launch pages ship App Store elements hidden, pre-approval shown, and load both scripts', () => {
  for (const page of LAUNCH_PAGES) {
    const html = read(page);
    assert.match(html, /<script src="\/launch-config\.js(\?v=[a-f\d]{16})?" defer><\/script>/, page);
    assert.match(html, /<script src="\/launch\.js(\?v=[a-f\d]{16})?" defer><\/script>/, page);
    for (const tag of html.matchAll(/<\w+\b([^>]*\bdata-launch="app-store"[^>]*)>/g))
      assert.ok(/(^|\s)hidden($|\s|=)/.test(tag[1]), `${page}: App Store element must ship hidden — ${tag[0]}`);
    const pre = [...html.matchAll(/<\w+\b([^>]*\bdata-launch="pre-approval"[^>]*)>/g)];
    assert.ok(pre.length > 0, `${page}: a pre-approval region must exist`);
    for (const tag of pre)
      assert.ok(!/(^|\s)hidden($|\s|=)/.test(tag[1]), `${page}: pre-approval must not ship hidden — ${tag[0]}`);
  }
});

function distHtml(prefix = '') {
  return fs.readdirSync(path.join(dist, prefix), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const rel = prefix + entry.name;
    return entry.isDirectory() ? distHtml(rel + '/') : rel.endsWith('.html') ? [rel] : [];
  });
}

// The hidden attribute alone loses to an author display rule (.hero-actions flex, .sticky-cta a grid,
// .offer-actions/.see-actions flex), so a hidden App Store badge would still render. Every page that
// carries an App Store element must load a stylesheet whose [hidden] (or [data-launch][hidden]) rule is
// display:none !important (style.css has the global one today).
test('every App Store page loads a stylesheet that force-hides hidden launch elements', () => {
  const RULE = /(^|[},]\s*)(\[data-launch\])?\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/m;
  const pages = distHtml().filter(file => /data-launch="app-store"/.test(read(file)));
  assert.ok(pages.length >= 4, `expected the launch pages to carry App Store elements, found ${pages.length}`);
  for (const page of pages) {
    const html = read(page);
    const sheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="\/([^"?]+\.css)(?:\?[^"]*)?"/g)].map(match => match[1]);
    const guarded = sheets.some(sheet => { try { return RULE.test(read(sheet)); } catch { return false; } });
    assert.ok(guarded, `${page}: none of its stylesheets (${sheets.join(', ')}) force-hides [data-launch][hidden]`);
  }
});

test('home ties the waitlist CTA to pre-approval and the App Store badge+link to the flag', () => {
  const html = read('index.html');
  // Flag off, no JS: the App Store badge text sits only inside hidden App Store regions.
  const store = regions(html, 'app-store').join('\n');
  assert.match(store, /Download on the App Store/);
  assert.match(store, /apps\.apple\.com\/au\/app\/id6814273913\?ct=web_home_hero/);
  // The waitlist CTA is inside a pre-approval region, so the flag hides it on launch day.
  const pre = regions(html, 'pre-approval').join('\n');
  assert.match(pre, /href="\/waitlist"/);
  assert.doesNotMatch(store, /href="\/waitlist"/);
});
