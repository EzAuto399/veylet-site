/*
 * One story across the website (design spec v2: 5.2, 5.4, 6.1 "Other pages" and "Changes from today";
 * build map P1-WEB-2): the practice room is optional everywhere, nothing promises video exports that are
 * off, and the cut list stays cut (dead launch stages, the hidden pack row, launch-reel media, /thanks).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const walk = (dir = dist) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'vendor' ? [] : walk(full);
  return /\.(?:html|js|txt|json|xml|css)$/.test(entry.name) ? [path.relative(dist, full)] : [];
});
const words = html => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// Legal and offer records change only with the owner's sign-off: the terms (Last updated 11 November 2026),
// llms.txt's summary of them and offer.json still describe the practice gate (reported to Yo, P1-WEB-2).
const PRACTICE_RECORDS = ['terms/index.html', 'app/terms/index.html', 'llms.txt', 'offer/offer.json'];
// The home page belongs to P1-WEB-1, which removes its own "When video exports open" line.
const HOME = 'index.html';

test('no page says the practice room is required or unlocks real captures (spec v2 5.4)', () => {
  const required = /practice[^.]{0,80}\b(?:is )?required\b|\brequired\b[^.]{0,80}practice|unlocks? real captures|real captures? unlocks?|captures? (?:is |are )?(?:now )?unlocked|stays unlocked|practice (?:capture|room) (?:first|once) before|needs? (?:a )?(?:device and )?practice assessment|assessment of your device and a practice/i;
  const hits = walk().filter(file => !PRACTICE_RECORDS.includes(file)).filter(file => required.test(file.endsWith('.html') ? words(read(file)) : read(file)));
  assert.deepEqual(hits, []);
});

test('the canonical practice sentence is on /see, /start, help, the desk and the guides', () => {
  const canonical = 'Try the practice room first, or go straight to your first space.';
  assert.match(words(read('see/index.html')), /Practise one room\. About 5 minutes Optional: try the practice room first\./);
  for (const file of ['start/index.html', 'help/practice-room/index.html', 'app/help/practice-room/index.html', 'account/index.html', 'guides/what-is-a-3d-walkthrough/index.html', 'llms-full.txt']) {
    assert.ok(words(read(file)).replace(/\s+/g, ' ').includes(canonical.slice(0, -1)), file);
  }
  const desk = read('account.js');
  assert.match(desk, /'Try the practice room first, or go straight to your first space\. Client work needs production approval and agreed terms\.'/);
  assert.match(desk, /the practice room is optional\./);
  assert.doesNotMatch(read('start/index.html'), /one practice capture/);
});

test('nothing promises video exports while they are off (spec v2 5.2 rule 7)', () => {
  const hits = walk().filter(file => file !== HOME).filter(file => /when (?:video )?exports open/i.test(read(file)));
  assert.deepEqual(hits, []);
  for (const file of ['see/index.html', 'offer/index.html']) assert.doesNotMatch(read(file), /exports open/i, file);
});

test('the 404 offers the sample walkthrough among its ways forward', () => {
  const page = read('404.html');
  const note = page.match(/<p class="contact-note">([\s\S]*?)<\/p>/)[1];
  assert.match(note, /<a href="\/see">See a sample walkthrough<\/a>/);
  for (const href of ['/offer', '/waitlist', '/account']) assert.ok(note.includes('href="' + href + '"'), href);
  assert.match(page, /<meta name="robots" content="noindex" \/>/);
});

test('/thanks still answers for old emails: noindex, a refresh to /start and one visible link, out of the sitemap', () => {
  const page = read('thanks/index.html');
  assert.match(page, /<meta name="robots" content="noindex" \/>/);
  assert.match(page, /<meta http-equiv="refresh" content="0; url=\/start" \/>/);
  const main = page.match(/<main\b[\s\S]*?<\/main>/)[0];
  assert.match(main, /<a class="button" href="\/start">See your first-capture steps <span class="icon-arrow" aria-hidden="true"><\/span><\/a>/);
  assert.deepEqual([...main.matchAll(/<(h1|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => words(m[2]).trim()), [
    'Next steps.',
    'If you sent us an enquiry, we usually reply from support@veylet.com within one business day.',
    'See your first-capture steps',
  ], 'a heading, one honest sentence and the link');
  assert.doesNotMatch(page, /does not confirm delivery|enquiry\.js|<form/);
  assert.doesNotMatch(read('sitemap.xml'), /\/thanks/);
});

test('the launch-reel media is deleted and nothing refers to it', () => {
  assert.deepEqual(fs.readdirSync(path.join(dist, 'media')).filter(name => name.startsWith('launch-reel')), []);
  assert.deepEqual(walk().filter(file => read(file).includes('launch-reel')), []);
});

test('the offer has no pack row or pack select, and offer.js toggles nothing for one', () => {
  const page = read('offer/index.html');
  assert.doesNotMatch(page, /data-pack-line|data-pack-what|data-pack-amount|billing-pack|data-pack3-|data-pack10-|data-pack-valid/);
  assert.doesNotMatch(read('offer.js'), /data-pack-line|data-pack-what|billing-pack|PACKS/);
  assert.doesNotMatch(read('conversion.css'), /\.line-pack/);
  assert.match(page, /Top-up packs aren’t on sale yet\./, 'the honest line about packs stays');
});
