/*
 * Customer-facing processing region agreement: every surface names the same US Modal
 * region, and none puts rendering or its GPU back in Australia.
 *
 * Deliberately excluded (true facts or historical records):
 *   - photographer price survey ("published prices in Sydney, Brisbane, Perth and Adelaide");
 *   - /offer/offer.json history[] entries;
 *   - AUD prices and Australian Consumer Law paragraphs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const US_REGION = /United States/i;
const asShown = text => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\s+/g, ' ');
const root = path.join(__dirname, '..');

function offerLiveFields() {
  const offer = JSON.parse(fs.readFileSync(path.join(root, 'dist/offer/offer.json'), 'utf8'));
  const live = { ...offer };
  delete live.history;
  return JSON.stringify(live, null, 2);
}

const privacySurfaces = [
  ['/privacy', () => fs.readFileSync(path.join(root, 'dist/privacy/index.html'), 'utf8')],
  ['/app/privacy', () => fs.readFileSync(path.join(root, 'dist/app/privacy/index.html'), 'utf8')],
  ['/guides/privacy-3d-home-tour', () => fs.readFileSync(path.join(root, 'dist/guides/privacy-3d-home-tour/index.html'), 'utf8')],
  ['/llms-full.txt', () => fs.readFileSync(path.join(root, 'dist/llms-full.txt'), 'utf8')],
];
const surfaces = [
  ...privacySurfaces,
  ['/account job status', () => fs.readFileSync(path.join(root, 'dist/account.js'), 'utf8')],
  ['/terms (Super fast)', () => fs.readFileSync(path.join(root, 'dist/terms/index.html'), 'utf8')],
  ['/offer (page, JSON-LD, answer)', () => fs.readFileSync(path.join(root, 'dist/offer/index.html'), 'utf8')],
  ['/offer/offer.json (live fields)', offerLiveFields],
  ['/llms.txt', () => fs.readFileSync(path.join(root, 'dist/llms.txt'), 'utf8')],
];
const appWords = path.join(root, '../property-3d-studio/local-pipeline/ios/Sources/Core/RenderStatusWords.swift');
const staleWords = [
  'cloud GPUs in Australia',
  'computers in Australia',
  'fastest processing in Australia',
  'fastest GPU available in Australia',
  'Sydney GPU-start probe',
  'Sydney check',
];

test('every privacy surface names the United States as the render region', () => {
  for (const [name, read] of privacySurfaces) {
    const text = asShown(read());
    assert.match(text, US_REGION, `${name} must name the United States`);
  }
});

test('no customer-facing surface puts processing or its GPU in Australia', () => {
  for (const [name, read] of surfaces) {
    const text = asShown(read());
    for (const phrase of staleWords) assert.ok(!text.includes(phrase), `${name} still says "${phrase}"`);
  }
});

test('the app and the pages agree on the United States Modal render region', t => {
  if (!fs.existsSync(appWords)) return t.diagnostic(`app source not readable at ${appWords}; skipped`);
  const swift = fs.readFileSync(appWords, 'utf8');
  const note = swift.match(/static let regionNote = "([^"]+)"/)?.[1];
  assert.ok(note, 'RenderStatusWords declares regionNote');
  assert.match(note, US_REGION, `the app says "${note}"`);
  assert.ok(note.includes('Modal'), `the app says "${note}"`);
});
