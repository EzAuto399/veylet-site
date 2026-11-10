// Client pages, 10 November 2026: what the audience walk on a third-party page found.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

test('the held place on /handoff says it is loading, once for the eye and not twice for a screen reader', () => {
  const css = read('client-page.css');
  const rule = css.match(/\.client-pending \.tour-frame-shell::after \{([\s\S]*?)\n\}/);
  assert.ok(rule, 'the held place');
  // The plain declaration first, for a browser without alternative text; then the same words with an empty alternative.
  assert.match(rule[1], /content: "Loading the walkthrough\\2026";\s*content: "Loading the walkthrough\\2026" \/ "";/);
  assert.match(rule[1], /position: absolute;\s*inset: 0;/, 'laid over the held place, so it adds no height');
  assert.match(css, /\.client-pending \.tour-frame-shell \{\s*position: relative;\s*\}/);
  assert.match(rule[1], /color: var\(--paper\);/);
  // The words are the ones the status line announces (tour-player.js).
  assert.ok(read('tour-player.js').includes("'Loading the walkthrough…'"));
});

test('a short /tour frame is one column no wider than the frame, and its one-line title can shrink', () => {
  const block = read('tour/index.html').match(/@media \(max-height: 500px\) \{([\s\S]*?)\n      \}/);
  assert.ok(block, 'a rule for a short frame');
  assert.match(block[1], /\.tour-page \{ grid-template: auto minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/);
  assert.match(block[1], /\.tour-head h1 \{ min-width: 0;[^}]*text-overflow: ellipsis;/);
});

test('the embed invitation wraps a long word instead of scrolling a narrow frame sideways', () => {
  const rule = read('embed/index.html').match(/\n      \.embed-fallback \{([\s\S]*?)\n      \}/);
  assert.ok(rule, 'the invitation');
  assert.match(rule[1], /overflow-wrap: anywhere;/);
});
