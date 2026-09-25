const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const markup = fs.readFileSync(path.join(__dirname, '../dist/embed/index.html'), 'utf8');
const source = markup.match(/<script>([\s\S]*?)<\/script>/)[1];

function load() {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  }
  let finish, reject, bootCalls = 0, bootOptions = null;
  const player = {
    boot: (options) => { bootCalls++; bootOptions = options; return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
    showFailure: (els, options) => { els.frame.hidden = true; els.body.textContent = options.body; els.actions.hidden = !options.retry; els.retry.hidden = !options.retry; },
  };
  vm.runInNewContext(source, { window: { VeyletPlayer: player }, document: { getElementById: id => ids[id] }, location: { search: '?t=synthetic-valid-token' }, URLSearchParams });
  return {
    ids,
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
