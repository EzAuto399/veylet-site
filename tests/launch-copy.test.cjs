/*
 * Launch copy, prepared for the day the first real iPhone capture passes the quality gate (G1).
 * The pilot lines ("no client-accepted tour yet", "still under quality review", "still being
 * proven") give way to one checkable fact: a home we filmed on an iPhone, shown on /see.
 * Nothing here may invent a customer count, a testimonial or a date, and the weekly
 * admission wording stays as it is.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'vendor') return [];
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const PILOT = /no client-accepted|client has accepted|still under (?:internal )?(?:quality )?review|quality is still (?:under review|being proven)|still being proven|Pilot status|Not yet proven|what has been tested so far|onboard accounts in cohorts/i;
const FILMED = /[Ss]ee a home we filmed on an iPhone|see <a href="\/see">a home we filmed on an iPhone<\/a>|A home we filmed on an iPhone is at https:\/\/veylet\.com\/see|a home we filmed on an iPhone is at https:\/\/veylet\.com\/see/;

test('no public page, text or script still carries the pilot status lines', () => {
  const found = walk(dist).filter(file => /\.(?:html|txt|js|json)$/.test(file))
    .filter(file => PILOT.test(fs.readFileSync(file, 'utf8'))).map(file => path.relative(dist, file));
  assert.deepEqual(found, []);
});

test('each replaced surface points at the home we filmed on /see', () => {
  for (const page of ['index.html', 'offer/index.html', 'start/index.html', 'request/index.html', 'llms.txt',
    'guides/3d-tour-cost-australia/index.html', 'guides/do-3d-tours-help-sell-faster/index.html', 'guides/what-is-a-3d-walkthrough/index.html',
    'guides/privacy-3d-home-tour/index.html', 'guides/iphone-lidar-vs-matterport/index.html']) {
    const body = read(page);
    assert.match(body, FILMED, `${page} names the home we filmed`);
    assert.match(body, page === 'llms.txt' ? /https:\/\/veylet\.com\/see/ : /href="\/see"/, `${page} links /see`);
  }
  // The customer-example answers say plainly that it is our own capture.
  assert.match(read('index.html'), /it is our own capture, not a client’s\. The room images and animations here are labelled illustrations\.<\/p>/);
  assert.match(read('offer/index.html'), /it is our own capture, not a client’s\. We will not show concept artwork as proof\.<\/p>/);
});

test('the launch copy invents no count, testimonial or date, and keeps weekly admission', () => {
  const lines = walk(dist).filter(file => /\.(?:html|txt)$/.test(file))
    .flatMap(file => fs.readFileSync(file, 'utf8').split('\n').filter(line => /home we filmed/.test(line)).map(line => [path.relative(dist, file), line]));
  assert.ok(lines.length >= 10, `found ${lines.length} launch lines`);
  for (const [file, line] of lines) {
    const sentence = line.slice(Math.max(0, line.indexOf('home we filmed') - 160), line.indexOf('home we filmed') + 160);
    assert.doesNotMatch(sentence, /\b\d+ (?:customers|clients|agencies|accounts|homes)\b|testimonial|“[^”]*” —|\b20\d\d\b/i, `${file}: ${sentence}`);
    assert.doesNotMatch(sentence, /\b(?:January|February|March|April|June|July|August|September|October|November|December)\b/, `${file}: ${sentence}`);
  }
  assert.match(read('index.html'), /Open to anyone, admitted weekly/);
  assert.match(read('offer/index.html'), /<strong>Open to anyone, admitted weekly\.<\/strong> We admit new accounts from the waitlist each week/);
  assert.match(read('start/index.html'), /New accounts are admitted in weekly groups, so ask about availability before promising a client a date\./);
});
