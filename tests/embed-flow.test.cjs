const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = fs.readFileSync(path.join(__dirname, '../dist/embed/index.html'), 'utf8');
const source = markup.match(/<script>([\s\S]*?)<\/script>/)[1];

function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  }
  let finish, reject, bootCalls = 0, bootOptions = null;
  const player = {
    boot: (options) => { bootCalls++; bootOptions = options; return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
    showFailure: (els, options) => { els.frame.hidden = true; els.body.textContent = options.body; els.actions.hidden = !options.retry; els.retry.hidden = !options.retry; },
  };
  const calls = [];
  // `options.share`: what lookup_tour_share answers through the page's REST client (a promise).
  const page = options.share === undefined ? undefined : {
    restClient: () => ({ rpc: (name, args) => { calls.push([name, { ...args }]); return name === 'lookup_tour_share' ? options.share : Promise.resolve({ data: null }); } }),
    mountReport: (link) => { link.hidden = false; return true; },
    lookupContact: async () => options.contact || null,
    agentLine: contact => 'Shared by ' + contact.name,
  };
  const window = { VeyletPlayer: player, VeyletClientPage: page, VEYLET_SUPABASE: { url: 'https://fixture.invalid', anonKey: 'anon' } };
  vm.runInNewContext(source, { window, document: { getElementById: id => ids[id] }, location: { search: '?t=synthetic-valid-token' }, URLSearchParams, setTimeout, Promise });
  return {
    ids, calls,
    get bootCalls() { return bootCalls; },
    get bootOptions() { return bootOptions; },
    start: () => ids['embed-start'].events.click(),
    reveal: () => { ids['tour-frame'].hidden = false; bootOptions.onVisible(); },
    finish: () => finish(),
    reject: () => reject(new Error('unexpected startup error')),
  };
}

test('embed starts only on Explore and holds the full notice until the viewer is on screen', async () => {
  const h = load();
  assert.equal(h.bootCalls, 0);
  assert.equal(h.ids['embed-start'].hidden, false);
  const pending = h.start();
  assert.equal(h.bootCalls, 1);
  // Nothing is rendered yet, so the visitor keeps the whole panel instead of a
  // near-black rectangle with one dim line of text in its corner.
  assert.equal(h.ids['embed-fallback'].dataset.mode, 'preparing');
  assert.equal(h.ids['embed-fallback'].hidden, false);
  assert.equal(h.ids['embed-start'].disabled, true);
  // The player reveals its sized iframe before waiting for the first frame.
  // From that moment only the compact notice may share the viewport.
  h.reveal();
  assert.equal(h.ids['embed-fallback'].dataset.mode, 'loading');
  h.finish(); await pending;
  assert.equal(h.ids['embed-fallback'].hidden, true);
});

test('the invitation only promises a start once there is a control to press', () => {
  const h = load();
  assert.match(h.ids['embed-body'].textContent, /downloads when you start/);
  // The shipped markup must still read true when the script never runs.
  const staticBody = markup.match(/<p id="embed-body">([\s\S]*?)<\/p>/)[1].trim();
  assert.doesNotMatch(staticBody, /start/i);
  assert.match(markup, /<noscript><p>This walkthrough needs JavaScript\./);
  // A dead link is withdrawn by the player, so the markup must mark it.
  assert.match(markup, /id="embed-open" data-tour-dead-end/);
});

test('a transient startup failure restores the full notice and retry controls', async () => {
  const h = load(); const pending = h.start();
  h.ids['tour-actions'].hidden = false;
  h.finish(); await pending;
  assert.equal(h.ids['embed-fallback'].dataset.mode, 'notice');
  assert.equal(h.ids['embed-fallback'].hidden, false);
  assert.equal(h.ids['tour-actions'].hidden, false);
  assert.equal(h.ids['embed-open'].hidden, false);
});

test('renderer failure leaves the photograph and package-owned recovery unobstructed', async () => {
  const h = load(); const pending = h.start();
  h.reveal();
  h.ids['tour-actions'].hidden = false;
  h.finish(); await pending;
  assert.equal(h.ids['tour-frame'].hidden, false);
  assert.equal(h.ids['embed-fallback'].hidden, true);
  assert.equal(h.ids['embed-fallback'].dataset.mode, 'notice');
  assert.equal(h.ids['tour-actions'].hidden, false);
});

test('an unexpected startup rejection leaves loading mode and offers recovery', async () => {
  const h = load(); const pending = h.start();
  h.reject(); await pending;
  assert.equal(h.ids['embed-fallback'].dataset.mode, 'notice');
  assert.equal(h.ids['embed-fallback'].hidden, false);
  assert.equal(h.ids['tour-frame'].hidden, true);
  assert.equal(h.ids['tour-actions'].hidden, false);
  assert.match(h.ids['embed-body'].textContent, /try again/);
});

test('a streamed (v2) walkthrough owns its own status, so the embed notice steps aside', async () => {
  const h = load(); const pending = h.start();
  h.ids['tour-stage'].hidden = false; // the v2 player shows its poster in the stage
  h.bootOptions.onVisible();
  assert.equal(h.ids['embed-fallback'].hidden, true);
  h.finish(); await pending;
  assert.equal(h.ids['embed-fallback'].hidden, true);
  assert.equal(h.ids['tour-frame'].hidden, true);
});

test('the share row decides the package version; a v1 row stays on the ZIP path', async () => {
  const h = load(); h.start();
  const rpc = row => ({ rpc: async () => ({ data: [row] }) });
  const v2 = await h.bootOptions.resolve(rpc({ storage_path: 'p/manifest.json', space_title: 'Space', package_format_version: 2, package_base_url: 'https://tours.veylet.com/t/abc/' }));
  assert.deepEqual([v2.packageFormatVersion, v2.packageBaseUrl, v2.storagePath], [2, 'https://tours.veylet.com/t/abc/', 'p/manifest.json']);
  const v1 = await h.bootOptions.resolve(rpc({ storage_path: 'p/package.zip', space_title: 'Space' }));
  assert.deepEqual([v1.packageFormatVersion, v1.packageBaseUrl, v1.storagePath], [1, null, 'p/package.zip']);
});

test('the share is looked up before Explore: a dead or unknown link reads as the handoff page, with nothing to press', async () => {
  for (const share of [{ data: [] }, { data: [{ storage_path: null, package_base_url: null }] }, { data: null }]) {
    const h = load({ share: Promise.resolve(share) });
    assert.equal(h.ids['embed-start'].hidden, true, 'nothing to press before the answer');
    assert.equal(h.ids['embed-status'].textContent, 'Checking this walkthrough…');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.calls.filter(([name]) => name === 'lookup_tour_share'), [['lookup_tour_share', { p_token: 'synthetic-valid-token' }]]);
    assert.equal(h.ids['embed-title'].textContent, 'This walkthrough isn’t available right now.');
    assert.equal(h.ids['embed-body'].textContent, 'The agent may have turned it off or not shared it yet.');
    assert.equal(h.ids['embed-start'].hidden, true);
    assert.equal(h.ids['embed-open'].hidden, true);
    assert.equal(h.ids['embed-status'].textContent, '');
    assert.equal(h.ids['embed-report'].hidden, false, 'the report link stays');
    assert.equal(h.bootCalls, 0, 'no download');
  }
  // A live share offers Explore; an error offers it too (starting explains its own failure).
  for (const share of [{ data: [{ storage_path: 'p/package.zip' }] }, { data: [{ package_base_url: 'https://tours.veylet.com/t/a/', storage_path: 'p/manifest.json' }] }, { error: { message: 'offline' } }]) {
    const h = load({ share: Promise.resolve(share), contact: { name: 'Sam' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.ids['embed-start'].hidden, false, JSON.stringify(share));
    assert.equal(h.ids['embed-open'].hidden, false);
    assert.equal(h.ids['embed-title'].textContent === 'This walkthrough isn’t available right now.', false);
    assert.equal(h.ids['embed-agent'].textContent, 'Shared by Sam', 'the agent line stays');
  }
});

test('Explore passes the full page as the fullscreen fallback and names a dead link in the handoff words', async () => {
  const h = load({ share: Promise.resolve({ data: [{ storage_path: 'p/package.zip' }] }) });
  await new Promise(resolve => setImmediate(resolve));
  h.start();
  assert.equal(h.bootOptions.fullscreenUrl, 'https://veylet.com/handoff?t=synthetic-valid-token');
  assert.equal(h.bootOptions.missingHeading, 'This walkthrough isn’t available right now.');
  assert.equal(h.bootOptions.missingBody, 'The agent may have turned it off or not shared it yet.');
});

test('framed pages fit their frame: /tour never scrolls, and the v2 status wraps to 3 lines without an ellipsis', () => {
  const tour = fs.readFileSync(path.join(__dirname, '../dist/tour/index.html'), 'utf8');
  assert.match(tour, /html,\s*body \{[^}]*height: 100%;[^}]*overflow: hidden;/);
  assert.match(tour, /\.tour-page \{[^}]*grid-template-rows: auto minmax\(0, 1fr\) auto;[^}]*height: 100%;/);
  assert.doesNotMatch(tour.match(/\.tour-page \{[^}]*\}/)[0], /min-height/, 'no floor taller than a small portal frame');
  const css = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.css'), 'utf8');
  const status = css.match(/\.v2-status \{[^}]*\}/)[0];
  assert.doesNotMatch(status, /nowrap|text-overflow|line-clamp/);
  assert.match(status, /max-height: calc\(3 \* 1\.35em \+ 16px\);/);
  assert.doesNotMatch(css, /\.v2-full\s*\{/, 'the fullscreen button is v2-fullscreen; the dead rule is gone');
});
