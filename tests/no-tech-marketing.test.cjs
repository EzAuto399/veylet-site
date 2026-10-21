/*
 * Owner rule, 30 September 2026: "with marketing we should not include technology".
 * Marketing pages sell the outcome (a walkthrough people explore on their phone, checked
 * and approved before it is shared). They do not name sensors, phone model lists, or
 * rendering and 3D-format jargon. The device requirement stays only where a visitor needs
 * it to act: the "which phones work" answers, the requirement line near a call to action,
 * and form help. Help, app, account, legal and player pages are outside this set.
 *
 * Checked text: visible text, meta/og descriptions, alt/title/aria-label/placeholder
 * values, JSON-LD strings and llms.txt lines. Link targets, file names and the cited
 * source titles in a guide's "Sources" list are not copy and are not checked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');

// Marketing surfaces. /waitlist is its own session's page and carries the signup
// eligibility note, so it is not in this set.
const MARKETING = [
  'index.html', 'offer/index.html', 'see/index.html', 'start/index.html', 'request/index.html',
  'thanks/index.html', '404.html', 'website-guide/index.html', 'llms.txt',
  ...fs.readdirSync(path.join(dist, 'guides'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => `guides/${entry.name}/index.html`),
  'guides/index.html',
];

const BANNED = [
  [/lidar/i, 'LiDAR'],
  [/gaussian|splat/i, 'splat jargon'],
  [/point[\s-]?cloud/i, 'point cloud'],
  [/playcanvas|webgl|\bgpus?\b|neural|\bnerf\b|\bslam\b|\bmesh(?:es)?\b/i, 'engine or hardware jargon'],
  [/reconstruct/i, 'reconstruction'],
  [/photogrammetr/i, 'photogrammetry'],
  [/depth (?:sensor|data|reading|range)/i, 'depth jargon'],
  [/\bpipeline\b/i, 'pipeline'],
  [/\biphone \d|\bpro max\b|\bipad pro\b|\biphone (?:\d+ )?pro\b|\bios \d/i, 'a phone model list'],
];

// The App Store launch terms line (Yoda's final copy, 22 October 2026) is required verbatim beside every
// primary CTA and deliberately names the device requirement, including LiDAR. It is allow-listed per page.
const LAUNCH_TERMS = 'Needs an iPhone Pro with LiDAR.';

// Kept on purpose, each with its reason. A chunk containing the marker may name devices.
const ALLOW = {
  'index.html': [
    ['Works with recent iPhone Pro and iPad Pro models.', 'requirement line at the final call to action'],
    [LAUNCH_TERMS, 'App Store launch terms line beside each primary CTA'],
  ],
  'offer/index.html': [
    [LAUNCH_TERMS, 'App Store launch terms line beside the offer CTA'],
    ['Works with recent iPhone Pro and iPad Pro models.', 'requirement line where the steps start'],
    ['iPhone 12 Pro and later Pro or Pro Max models, and iPad Pro models from 2020 onwards', 'FAQ: which phones work'],
  ],
  'see/index.html': [
    ['You need a recent iPhone Pro or iPad Pro.', 'requirement line at the offer call to action'],
    [LAUNCH_TERMS, 'App Store launch terms line beside the see hero CTA'],
  ],
  'start/index.html': [
    ['Capture needs an iPhone 12 Pro or a later Pro model', 'the "Not sure your phone can capture?" answer'],
    [LAUNCH_TERMS, 'App Store launch terms line beside the start CTA'],
  ],
  'request/index.html': [
    ['Works with recent iPhone Pro and iPad Pro models.', 'form help for the self-capture choice'],
    ['For example, iPhone 15 Pro', 'device-model field placeholder'],
  ],
  'guides/iphone-lidar-vs-matterport/index.html': [
    ['Every iPhone Pro and Pro Max from the iPhone 12 Pro', 'section: which iPhones and iPads work'],
    ['iPhone: 12 Pro and 12 Pro Max', 'supported model list'],
    ['iPad Pro: 11-inch (2nd generation)', 'supported model list'],
    ['The Pro and Pro Max models from iPhone 12 Pro', 'FAQ: which iPhones work'],
    ['Veylet Capture works with recent iPhone Pro and iPad Pro models', 'FAQ: do I need a Matterport camera'],
    ['If you own a recent iPhone Pro or iPad Pro', 'requirement line at the final call to action'],
  ],
  'llms.txt': [
    ['Capture with a recent iPhone Pro or iPad Pro.', 'requirement line'],
    ['- [The capture has no depth readings]', 'help article title (help pages keep technical names)'],
  ],
};

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&nbsp;/g, ' ');

const jsonStrings = (value, out) => {
  if (typeof value === 'string') { if (!/^https?:\/\//.test(value)) out.push(value); }
  else if (Array.isArray(value)) value.forEach(item => jsonStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => jsonStrings(item, out));
  return out;
};

// Copy chunks: one per block of visible text, attribute value, JSON-LD string or text line.
function chunks(file) {
  const raw = fs.readFileSync(path.join(dist, file), 'utf8');
  // Markdown link targets and bare URLs are addresses, not copy.
  if (!file.endsWith('.html')) return raw.split('\n').map(line => line.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ''));
  const out = [];
  let html = raw.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (_, json) => {
    jsonStrings(JSON.parse(json), out);
    return '';
  });
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '')
    .replace(/<section class="article-sources"[\s\S]*?<\/section>/g, '');
  for (const m of html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/g)) if (!/^https?:\/\//.test(m[1])) out.push(m[1]);
  for (const m of html.matchAll(/\b(?:alt|title|aria-label|placeholder)="([^"]*)"/g)) out.push(m[1]);
  html = html.replace(/<\/?(?:a|strong|em|b|i|span|abbr|small|code|br)\b[^>]*>/g, ' ');
  html = html.replace(/<[^>]+>/g, '\n');
  out.push(...html.split('\n'));
  return out.map(chunk => decode(chunk).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

test('the marketing page set is complete', () => {
  for (const file of MARKETING) assert.ok(fs.existsSync(path.join(dist, file)), file);
  assert.ok(MARKETING.filter(file => file.startsWith('guides/')).length >= 7, 'every guide is checked');
});

test('marketing copy names no sensor, phone model list or rendering jargon outside the allow-list', () => {
  const found = [];
  for (const file of MARKETING) {
    const allowed = (ALLOW[file] || []).map(([marker]) => marker);
    for (const chunk of chunks(file)) {
      if (allowed.some(marker => chunk.includes(marker))) continue;
      for (const [pattern, what] of BANNED) {
        const m = chunk.match(pattern);
        if (m) found.push(`${file}: ${what} ("${m[0]}") in: ${chunk.slice(0, 140)}`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test('every allow-listed exception still exists, so the device requirement stays where visitors act', () => {
  for (const [file, entries] of Object.entries(ALLOW)) {
    const text = chunks(file);
    for (const [marker, why] of entries) assert.ok(text.some(chunk => chunk.includes(marker)), `${file}: ${why}`);
  }
});

test('allow-listed requirement lines never say LiDAR, except the required App Store launch terms line', () => {
  for (const [file, entries] of Object.entries(ALLOW)) {
    for (const chunk of chunks(file)) {
      // The launch terms line is the one deliberate, required exception that names LiDAR.
      if (chunk.includes(LAUNCH_TERMS)) continue;
      if (entries.some(([marker]) => chunk.includes(marker)) && /lidar/i.test(chunk)) {
        assert.fail(`${file}: ${chunk.slice(0, 140)}`);
      }
    }
  }
});
