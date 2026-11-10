// Client pages, 10 November 2026, phase 1: one set of words for a link that cannot open, on /handoff,
// /tour and /embed; the stage placed where a phone on its side can see it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { WORDS, realPlayer } = require('./client-words.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

const surface = () => ({ title: {}, body: {}, status: {}, frame: { hidden: false }, stage: { hidden: false }, actions: { hidden: true },
  retry: { hidden: true, events: {}, addEventListener(name, fn) { this.events[name] = fn; } } });

test('one set of words for a link that cannot open, each with one next step', () => {
  assert.deepEqual(WORDS, {
    missingHeading: 'This walkthrough isn’t available right now.',
    missingBody: 'It may have been paused or turned off. Ask the person who sent it for a new link.',
    incompleteHeading: 'This link looks incomplete.',
    incompleteBody: 'Check you copied all of it, or ask the person who sent it.',
    transientBody: 'The walkthrough couldn’t be reached just now. Check your connection and try again.',
  });
  for (const words of Object.values(WORDS)) assert.doesNotMatch(words, /[—–:;]|agent/, words);
  // The three pages carry none of these sentences themselves.
  for (const page of ['handoff/index.html', 'tour/index.html', 'embed/index.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /missingHeading|missingBody|transientBody/, page);
    assert.doesNotMatch(html, /may have turned it off|It may have been paused|Check you copied/, page);
    assert.match(html, /client: true/, page);
    assert.match(html, /showIncomplete\(/, page);
  }
});

test('a paused or missing link says what to do and offers Try again; a cut-off link offers no retry', () => {
  let reloads = 0;
  const player = realPlayer({ location: { reload() { reloads++; } } });
  const els = surface();
  player.showMissing(els);
  assert.deepEqual([els.title.textContent, els.body.textContent], [WORDS.missingHeading, WORDS.missingBody]);
  assert.deepEqual([els.actions.hidden, els.retry.hidden, els.frame.hidden, els.stage.hidden], [false, false, true, true]);
  els.retry.events.click({ preventDefault() {} });
  assert.equal(reloads, 1, 'Try again reloads the page once');
  const cut = surface();
  player.showIncomplete(cut);
  assert.deepEqual([cut.title.textContent, cut.body.textContent], [WORDS.incompleteHeading, WORDS.incompleteBody]);
  assert.deepEqual([cut.actions.hidden, cut.retry.hidden], [true, true]);
});

test('boot on a client page uses the shared words, offers Try again on a miss and says how it ended', async () => {
  const dead = [{ hidden: false }];
  const boot = async (failure) => {
    const window = { addEventListener() {}, removeEventListener() {}, VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'k' }, supabase: { createClient: () => ({}) } };
    const els = surface();
    const document = { hidden: false, title: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null,
      getElementById: id => (id === 'tour-actions' ? els.actions : id === 'tour-retry' ? els.retry : null),
      querySelectorAll: selector => (selector === '[data-tour-dead-end]' ? dead : []) };
    vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} } });
    const player = window.VeyletPlayer;
    const result = await player.boot({ els, client: true, resolve: async () => { throw new player.TourFailure(failure.code, { transient: failure.transient }); } });
    return { els, result };
  };
  const down = await boot({ code: 'share-unavailable', transient: true });
  assert.equal(down.result.outcome, 'unreachable');
  assert.equal(down.els.body.textContent, WORDS.transientBody);
  assert.equal(down.els.retry.hidden, false);
  assert.equal(dead[0].hidden, false, 'a passing failure keeps the other ways in');
  const gone = await boot({ code: 'share-not-found', transient: false });
  assert.equal(gone.result.outcome, 'missing');
  assert.deepEqual([gone.els.title.textContent, gone.els.body.textContent], [WORDS.missingHeading, WORDS.missingBody]);
  assert.equal(gone.els.retry.hidden, false, 'a paused link can be switched back on, so Try again is offered');
  assert.equal(dead[0].hidden, true, 'and links to the same dead token still go');
});

test('a phone on its side brings the walkthrough to the top once, and never after the visitor has scrolled', () => {
  const window = {};
  const document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
  vm.runInNewContext(read('client-page.js'), { window, document, URLSearchParams, URL, setTimeout, clearTimeout, console, navigator: {}, location: { search: '' } });
  const { settleStage } = window.VeyletClientPage;
  const stage = { hidden: false, getBoundingClientRect: () => ({ top: 326 }) };
  const page = (matches, scrollY = 0) => { const moves = []; return { moves, scrollY, matchMedia: query => ({ matches, query }), scrollTo: to => moves.push(to) }; };
  const side = page(true);
  assert.equal(settleStage(side, stage), true);
  assert.deepEqual(JSON.parse(JSON.stringify(side.moves)), [{ top: 322, behavior: 'auto' }], '4px of page left above the stage');
  const upright = page(false);
  assert.equal(settleStage(upright, stage), false);
  assert.equal(upright.moves.length, 0);
  const moved = page(true, 120);
  assert.equal(settleStage(moved, stage), false, 'the visitor’s own scroll wins');
  assert.equal(settleStage(page(true), { ...stage, hidden: true }), false);
});

test('the stage fits a short or sideways screen, and the page gets out of its way', () => {
  const stageCss = read('tour-stage.css'), css = read('client-page.css');
  // A phone on its side: the stage takes the screen, less the Call/Email bar.
  assert.match(stageCss, /@media \(orientation: landscape\) and \(max-height: 500px\) \{\s*\.client-page \{\s*--tour-stage-height: max\(200px, calc\(var\(--tour-vh\) - var\(--tour-stage-below\) - 8px\)\);/);
  // Wide but short (a 1366 x 768 laptop): the stage leaves room for the title above it.
  assert.match(stageCss, /--tour-stage-height: max\(340px, min\(74vh, 680px, calc\(var\(--tour-vh\) - var\(--tour-stage-above\)\)\)\);/);
  // On a phone the walkthrough runs the width of the column: no padded, rounded shell around it.
  const narrow = css.match(/@media \(max-width: 800px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(narrow, /\.client-page \.tour-frame-shell \{[^}]*padding: 0;[^}]*border: 0;[^}]*border-radius: 0;/);
  const handoff = read('handoff/index.html');
  assert.match(handoff, /onVisible: \(\) => \{\s*releaseHeld\(\);\s*page\?\.settleStage\?\.\(window, els\.stage\);/);
  // A package that is gone reads as missing: no trouble line, no Share, no truth line over an empty page.
  assert.match(handoff, /const missing = unavailable \|\| result\?\.outcome === 'missing';/);
  assert.match(handoff, /for \(const id of \['client-help', 'client-share', 'client-truth', 'handoff-meta'\]\)/);
});
