/*
 * Owner decision, 29 September 2026: the "Capture partners" programme is removed.
 * Customers capture their own spaces with their own iPhone; there is no partner
 * application, assessment page or partner enquiry route. /apply now redirects to /offer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.name === 'vendor' || entry.name.startsWith('.')) return [];
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const publicText = walk(dist).filter(file => /\.(?:html|js|css|txt|xml|json)$/.test(file) && path.basename(file) !== 'build-info.json');

// Wording and markup that only existed for the partner programme. "partner_only" (an export
// state) and "forward it to a partner" (the viewer's own partner) are unrelated and allowed.
const RETIRED = [
  [/href="\/apply(?:[/"?#])/, 'a link to /apply'],
  [/veylet\.com\/apply\b/, 'an absolute /apply URL'],
  [/capture partners?\b/i, 'the capture-partner name'],
  [/partner (?:application|assessment|enquiry|setup)/i, 'a partner application or assessment'],
  [/appl(?:y|ying) as a (?:capture )?partner/i, 'an invitation to apply as a partner'],
  [/capture-partners/, 'the capture-partners anchor'],
  [/partner-(?:band|path|panel|intro|title|note)\b/, 'partner section markup or styles'],
  [/apply-status/, 'the partner form status element'],
];

test('no public page, script, style or text links to /apply or offers the capture-partner programme', () => {
  assert.ok(publicText.length > 50, 'the walk found the public files');
  const found = [];
  for (const file of publicText) {
    const body = fs.readFileSync(file, 'utf8');
    for (const [pattern, what] of RETIRED) if (pattern.test(body)) found.push(`${path.relative(dist, file)}: ${what}`);
  }
  assert.deepEqual(found, []);
  assert.equal(fs.existsSync(path.join(dist, 'apply')), false, 'dist/apply is gone');
  assert.equal(fs.existsSync(path.join(dist, 'apply.html')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'scripts/health-check.sh'), 'utf8'), /\s\/apply\s/, 'the health check no longer expects /apply to answer 200');
});

test('every marketing header keeps the offer and ends with the sign-in or desk link, with no partner link', () => {
  let headers = 0;
  for (const file of publicText.filter(name => name.endsWith('.html'))) {
    const nav = fs.readFileSync(file, 'utf8').match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/);
    if (!nav || !nav[1].includes('href="/offer"')) continue;
    headers += 1;
    const hrefs = [...nav[1].matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.ok(!hrefs.some(href => href.startsWith('/apply')), path.relative(dist, file));
    assert.equal(hrefs[0], '/#process', path.relative(dist, file));
    assert.ok(['/account', '/studio'].includes(hrefs[hrefs.length - 1]), `${path.relative(dist, file)} ends with ${hrefs[hrefs.length - 1]}`);
  }
  assert.ok(headers >= 20, `found ${headers} marketing headers`);
});

test('/apply redirects permanently to /offer, with clean URLs unchanged', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.cleanUrls, true);
  assert.equal(config.trailingSlash, false);
  assert.equal(config.outputDirectory, 'dist');
  const rule = (config.redirects || []).find(entry => entry.source === '/apply');
  assert.deepEqual(rule, { source: '/apply', destination: '/offer', permanent: true });
  assert.ok(fs.existsSync(path.join(dist, 'offer/index.html')), 'the destination page exists');
  assert.equal((config.rewrites || []).some(entry => /\/apply\b/.test(entry.source || '')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8'), /\/apply</, 'the sitemap no longer lists /apply');
});
