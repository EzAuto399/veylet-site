const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../dist/tour-sharing.js'), 'utf8');
function load(clipboard = { writeText: async () => {} }) { const window = {}; vm.runInNewContext(source, { window, URL, navigator: { clipboard } }); return window.VeyletSharing; }
test('only complete Veylet client links can become embeds', () => {
  const share = load();
  assert.equal(share.tokenFromLink('https://veylet.com/handoff?t=abcdefghijklmnop'), 'abcdefghijklmnop');
  for (const link of ['https://evil.invalid/handoff?t=abcdefghijklmnop', 'https://veylet.com/play?id=abcdefghijklmnop', 'javascript:alert(1)', 'https://veylet.com/handoff?t=abc', 'https://veylet.com/handoff?t=abcdefghijklmnop%22%20onload%3Dalert(1)']) assert.equal(share.tokenFromLink(link), null);
});
test('embed includes a named lazy iframe and a direct fallback without fixed desktop width', () => {
  const code = load().embedCode('abcdefghijklmnop');
  assert.match(code, /loading="lazy"/); assert.match(code, /title="Explore this property in 3D"/);
  assert.match(code, /width:100%/); assert.doesNotMatch(code, /min-height:480px/);
  assert.match(code, /Open the property walkthrough in a new tab/); assert.match(code, /rel="noopener noreferrer"/);
});
test('the on-page test embed is parsed out of the code we hand over', () => {
  const share = load();
  const code = share.embedCode('abcdefghijklmnop');
  let made;
  const doc = { createElement: () => ({ set innerHTML(value) { made = value; }, querySelector: () => ({ tag: 'iframe' }) }) };
  const frame = share.embedFrame('abcdefghijklmnop', doc);
  // A separately built preview would drift from the paste and could reassure
  // someone about behaviour their published website will not actually give.
  assert.equal(made, code);
  assert.deepEqual(frame, { tag: 'iframe' });
  assert.equal(share.embedUrl('abcdefghijklmnop'), 'https://veylet.com/embed?t=abcdefghijklmnop');
  assert.ok(code.includes('src="' + share.embedUrl('abcdefghijklmnop') + '"'));
});
test('a copied link and its embed can only carry a sanitised token', () => {
  const share = load();
  const nasty = 'a'.repeat(16);
  assert.equal(share.embedUrl(nasty), 'https://veylet.com/embed?t=' + nasty);
  assert.equal(share.handoffUrl('a b"c<d'), 'https://veylet.com/handoff?t=a%20b%22c%3Cd');
});
test('blocked clipboard leaves a selectable local fallback', async () => {
  const share = load({ writeText: async () => { throw Error('blocked'); } });
  const field = { hidden: true, focus() { this.focused = true; }, select() { this.selected = true; } }, status = {};
  await share.copy('value', field, status, 'Copied');
  assert.equal(field.value, 'value'); assert.equal(field.hidden, false); assert.equal(field.selected, true);
  assert.match(status.textContent, /Select and copy/);
});

/* ---- Hosting line and website builders --------------------------------- */
const path = require('node:path');
const offer = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/offer/offer.json'), 'utf8'));
const guideText = fs.readFileSync(path.join(__dirname, '../dist/website-guide/index.html'), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&rarr;/g, '→').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hostingRow = overrides => ({ tour_id: 't1', sharing_on: true, released_at: '2026-09-23T04:00:00Z',
  guaranteed_until: '2027-09-23T04:00:00Z', extended_until: null, hosted_until: '2027-09-23T04:00:00Z', plan_active: true, ...overrides });
const BEFORE = Date.parse('2027-01-01T00:00:00Z'), AFTER = Date.parse('2027-10-01T00:00:00Z');

test('the further-year hosting price is the offer record, not a second number', () => {
  assert.equal(load().hostingExtensionAud, offer.services.hostingPerWalkthroughPerFurtherYearAud);
});
test('hosting dates are the Brisbane day, a fixed three-letter month and the year', () => {
  const share = load();
  assert.equal(share.hostingDate('2027-09-23T04:00:00Z'), '23 Sep 2027');
  assert.equal(share.hostingDate('2027-06-05T23:30:00Z'), '6 Jun 2027', 'the Brisbane day, whatever the viewer’s zone');
  // Released 22 Sep 2026 15:30 UTC is 23 Sep in Brisbane, and so is its term.
  assert.equal(share.hostingDate('2026-09-22T15:30:00Z'), '23 Sep 2026');
  assert.equal(share.hostingDate('2027-09-22T15:30:00Z'), '23 Sep 2027');
  assert.equal(share.hostingLine(hostingRow({ released_at: '2026-09-22T15:30:00Z', guaranteed_until: '2027-09-22T15:30:00Z', hosted_until: '2027-09-22T15:30:00Z' }), true, BEFORE),
    'Live while your plan is active. Guaranteed until 23 Sep 2027.');
  // Never "Sept", whatever the runtime's locale data says.
  for (let month = 0; month < 12; month += 1) assert.match(share.hostingDate(new Date(Date.UTC(2027, month, 15)).toISOString()), /^15 [A-Z][a-z]{2} 2027$/);
  assert.equal(share.hostingDate('not a date'), '');
  assert.equal(share.hostingDate(null), '');
});
test('the ended wording turns at the exact hosted_until instant', () => {
  const share = load();
  const row = hostingRow({ plan_active: false });
  const edge = Date.parse(row.hosted_until);
  assert.match(share.hostingLine(row, true, edge - 1), /^Live until 23 Sep 2027\./);
  assert.match(share.hostingLine(row, true, edge), /^Guaranteed hosting ended 23 Sep 2027\./);
});
test('each hosting situation has exactly the spec line', () => {
  const share = load();
  assert.equal(share.hostingLine(hostingRow(), true, BEFORE), 'Live while your plan is active. Guaranteed until 23 Sep 2027.');
  // Past its term with the plan active is still hosted while the plan is.
  assert.equal(share.hostingLine(hostingRow(), true, AFTER), 'Live while your plan is active. Guaranteed until 23 Sep 2027.');
  assert.equal(share.hostingLine(hostingRow({ plan_active: false }), true, BEFORE),
    'Live until 23 Sep 2027. To keep it longer, extend hosting for A$49 a year.');
  assert.equal(share.hostingLine(hostingRow({ plan_active: false }), true, AFTER),
    'Guaranteed hosting ended 23 Sep 2027. Contact Veylet support to extend it (A$49 a year).');
  // An agreed extension is the later date, and the line follows it.
  const extended = hostingRow({ plan_active: false, extended_until: '2028-09-23T00:00:00Z', hosted_until: '2028-09-23T00:00:00Z' });
  assert.equal(share.hostingLine(extended, true, AFTER), 'Live until 23 Sep 2028. To keep it longer, extend hosting for A$49 a year.');
  assert.equal(share.hostingLine(hostingRow({ sharing_on: false }), false, BEFORE), 'Sharing is off. The link and embed show "not available".');
  assert.equal(share.hostingLine(hostingRow({ sharing_on: false, released_at: null, guaranteed_until: null, hosted_until: null }), false, BEFORE), '', 'never shared: no line');
});
test('missing or unreadable dates say so on a live card and never invent a date', () => {
  const share = load();
  const unavailable = 'Hosting dates could not load. Refresh to check.';
  for (const row of [null, undefined, 'receipt', hostingRow({ released_at: null }), hostingRow({ hosted_until: 'soon' }),
    hostingRow({ plan_active: 'true' }), hostingRow({ plan_active: null })]) {
    assert.equal(share.hostingLine(row, true, BEFORE), unavailable);
  }
  assert.equal(share.hostingLine(null, false, BEFORE), '', 'a card that is not live has nothing to say without its dates');
});
test('every builder gives two or three steps, each a sentence from the website guide', () => {
  const share = load();
  assert.deepEqual(Array.from(share.builders, item => item.name), ['WordPress', 'Squarespace', 'Wix', 'Webflow', 'Other HTML']);
  for (const item of share.builders) {
    assert.ok(item.steps.length >= 2 && item.steps.length <= 3, item.name);
    for (const step of item.steps) assert.ok(guideText.includes(step), `${item.name}: "${step}" is on /website-guide`);
  }
  assert.equal(share.builder('unknown').id, 'wordpress');
  assert.equal(share.builder('wix').name, 'Wix');
});
test('the builder choice is remembered per browser, and storage failures change nothing', () => {
  const window = {}; vm.runInNewContext(source, { window, URL, navigator: {} });
  const share = window.VeyletSharing;
  assert.equal(share.savedBuilder(), 'wordpress', 'no storage at all');
  const saved = new Map();
  window.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  share.saveBuilder('webflow');
  assert.equal(share.savedBuilder(), 'webflow');
  saved.set([...saved.keys()][0], '<script>');
  assert.equal(share.savedBuilder(), 'wordpress', 'an unknown stored value is not trusted');
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  assert.doesNotThrow(() => share.saveBuilder('wix'));
  assert.equal(share.savedBuilder(), 'wordpress');
});
