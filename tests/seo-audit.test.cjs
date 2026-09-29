// SEO audit, 29 September 2026: search snippets and discovery for the public pages.
// The sitemap lists only pages meant for search, each with a snippet-length description
// and share tags; the home page's cost answer leads to the cost guide.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const read = (file) => fs.readFileSync(path.join(dist, file), 'utf8');
const pageFile = (loc) => {
  const route = new URL(loc).pathname.replace(/^\/|\/$/g, '');
  return route ? path.join(route, 'index.html') : 'index.html';
};
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
const meta = (html, attr, name) => {
  const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0])
    .find((t) => new RegExp(`${attr}="${name}"`).test(t));
  return tag ? decode(tag.match(/content="([^"]*)"/)[1]) : null;
};
const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test('every sitemap page has a search description of 50 to 160 characters', () => {
  for (const loc of locs) {
    const description = meta(read(pageFile(loc)), 'name', 'description');
    assert.ok(description, `${loc}: meta description`);
    assert.ok(description.length >= 50 && description.length <= 160, `${loc}: ${description.length} characters`);
  }
});

test('every sitemap page carries share tags', () => {
  for (const loc of locs) {
    const html = read(pageFile(loc));
    for (const name of ['og:title', 'og:description', 'og:url']) assert.ok(meta(html, 'property', name), `${loc}: ${name}`);
    assert.equal(meta(html, 'property', 'og:url'), loc, `${loc}: og:url is the listed URL`);
  }
});

test('/request serves existing agreements only: out of the sitemap and not indexed', () => {
  assert.equal(locs.includes('https://veylet.com/request'), false);
  assert.match(read('request/index.html'), /<meta name="robots" content="noindex,follow"/);
});

test('the home cost answer links the cost guide, in the visible answer and its structured data alike', () => {
  const html = read('index.html');
  const docs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = docs.flatMap((doc) => doc['@graph'] || [doc]).find((node) => node['@type'] === 'FAQPage');
  const question = 'What does a walkthrough cost?';
  const structured = faq.mainEntity.find((q) => q.name === question).acceptedAnswer.text;
  const visibleHtml = html.slice(html.indexOf(`<summary>${question}</summary>`)).match(/<\/summary>\s*<p>([\s\S]*?)<\/p>/)[1];
  assert.match(visibleHtml, /<a href="\/guides\/3d-tour-cost-australia">/);
  assert.equal(text(visibleHtml), structured);
  assert.ok(locs.includes('https://veylet.com/guides/3d-tour-cost-australia'));
});
