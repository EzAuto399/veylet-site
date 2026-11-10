'use strict';
/*
 * One header and one footer on every public page (site audit 10 Nov 2026, findings 1, 2 and 16).
 * This fails when any public page's header or footer link set drifts from the one below, so help,
 * support and status stay reachable from every page. Static pages carry the markup directly; the
 * help centre takes it from tests/help-articles.cjs.
 *
 * Out of scope: the account desk, the in-app pages, the tour surfaces and the staff desk (their own
 * owners), and the one-line /help/fix/<flag> redirects, which have no header or footer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const OTHER_OWNERS = /^(?:samples|app|account|auth|embed|handoff|tour|play|studio)\//;

const HEADER = [['/#process', 'How it works'], ['/see', 'See a result'], ['/offer', 'Offer'], ['/help', 'Help'], ['/account', 'Sign in']];
const FOOTER = [['/offer', 'Offer'], ['/start', 'Get started'], ['/see', 'See a result'], ['/help', 'Help'], ['/guides', 'Guides'],
  ['/website-guide', 'Website guide'], ['/support', 'Support'], ['/status', 'Status'], ['/privacy', 'Privacy'], ['/terms', 'Terms']];
// /report is opened from a client's walkthrough by a visitor: brand only, and a short footer that still reaches Help.
const SHORT = { 'report/index.html': [['/help', 'Help'], ['/privacy', 'Privacy'], ['/terms', 'Terms']] };

function htmlFiles(folder, prefix = '') {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return htmlFiles(path.join(folder, entry.name), relative + '/');
    return entry.name.endsWith('.html') ? [relative] : [];
  });
}
const links = markup => [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(match => [match[1], match[2].trim()]);
const pages = htmlFiles(dist).filter(file => !OTHER_OWNERS.test(file)).sort()
  .map(file => ({ file, html: fs.readFileSync(path.join(dist, file), 'utf8') }))
  .filter(page => !/<meta http-equiv="refresh"/.test(page.html));

test('the sweep covers the public pages', () => {
  assert.ok(pages.length >= 45, `found ${pages.length} public pages`);
  for (const file of ['index.html', 'start/index.html', 'see/index.html', 'offer/index.html', 'waitlist/index.html', 'help/index.html',
    'help/walk-a-room/index.html', 'guides/index.html', 'support/index.html', 'status/index.html', 'privacy/index.html', 'terms/index.html', '404.html']) {
    assert.ok(pages.some(page => page.file === file), file);
  }
});

test('every public page has the same five header links, and marks only its own', () => {
  for (const { file, html } of pages) {
    const header = html.match(/<header class="wrap">([\s\S]*?)<\/header>/);
    assert.ok(header, `${file} has the site header`);
    assert.match(header[1], /<a class="brand" href="(?:\/|#top)" aria-label="Veylet Studio home"\s*>/, file);
    const nav = header[1].match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/);
    if (SHORT[file]) { assert.equal(nav, null, `${file} keeps a brand-only header`); continue; }
    assert.ok(nav, `${file} has the main navigation`);
    assert.deepEqual(links(nav[1]), HEADER, file);
    const current = [...nav[1].matchAll(/<a href="([^"]+)" aria-current="page"/g)].map(match => match[1]);
    const own = '/' + file.replace(/(?:\/?index)?\.html$/, '');
    const expected = HEADER.some(([href]) => href === own) ? [own] : file.startsWith('help/') ? ['/help'] : [];
    assert.deepEqual(current, expected, `${file} marks its own section only`);
  }
});

test('every public page has the same footer links in the same order', () => {
  for (const { file, html } of pages) {
    const footer = html.match(/<footer class="wrap">([\s\S]*?)<\/footer>/);
    assert.ok(footer, `${file} has the site footer`);
    const nav = footer[1].match(/<nav aria-label="(?:Footer|Legal)">([\s\S]*?)<\/nav>/);
    assert.ok(nav, `${file} has footer navigation`);
    assert.deepEqual(links(nav[1]), SHORT[file] || FOOTER, file);
  }
});

test('every header and footer target is a page that exists', () => {
  for (const [href] of [...HEADER, ...FOOTER]) {
    const route = href.replace(/#.*$/, '').replace(/^\//, '');
    const candidates = route ? [`${route}/index.html`, `${route}.html`] : ['index.html'];
    assert.ok(candidates.some(file => fs.existsSync(path.join(dist, file))), href);
  }
  assert.match(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), /id="process"/, '/#process is a real anchor');
});

test('every public page opts in to the shared patterns in style.css', () => {
  for (const { file, html } of pages) assert.match(html, /<body\b[^>]*class="site(?: [^"]*)?"/, file);
});
