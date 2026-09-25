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

test('hosting follows the plan: 14 days after it ends, and the shared words state no price', () => {
  const share = load();
  assert.equal(share.hostingGraceDays, 14);
  // The A$49 extension (offer 2026-09-26.2) is the desk's request button, never a line these words carry.
  assert.equal('hostingExtensionAud' in share, false);
});
test('hosting dates are the Brisbane day, a fixed three-letter month and the year', () => {
  const share = load();
  assert.equal(share.hostingDate('2027-09-23T04:00:00Z'), '23 Sep 2027');
  assert.equal(share.hostingDate('2027-06-05T23:30:00Z'), '6 Jun 2027', 'the Brisbane day, whatever the viewer’s zone');
  // 22 Sep 2026 15:30 UTC is 23 Sep in Brisbane.
  assert.equal(share.hostingDate('2026-09-22T15:30:00Z'), '23 Sep 2026');
  assert.equal(share.hostingDate('2026-10-10'), '10 Oct 2026', 'a date-only offline_on reads as that day');
  // Never "Sept", whatever the runtime's locale data says.
  for (let month = 0; month < 12; month += 1) assert.match(share.hostingDate(new Date(Date.UTC(2027, month, 15)).toISOString()), /^15 [A-Z][a-z]{2} 2027$/);
  assert.equal(share.hostingDate('not a date'), '');
  assert.equal(share.hostingDate(null), '');
});
const ENDED = '2027-01-01T00:00:00Z', GRACE_END = Date.parse(ENDED) + 14 * 86400000;
test('without the member hosting read, the plan state decides: live, 14 days, then offline', () => {
  const share = load();
  assert.equal(share.hostingLine(hostingRow(), true, BEFORE), 'Live while your plan is active.');
  assert.equal(share.hostingLine(hostingRow(), true, AFTER), 'Live while your plan is active.', 'no date ends it while the plan runs');
  const ended = hostingRow({ plan_active: false });
  assert.equal(share.hostingLine(ended, true, GRACE_END - 1, { planEndedAt: ENDED }),
    'Your plan has ended. This walkthrough goes offline on 15 Jan 2027. Restart your plan to keep it live.');
  assert.equal(share.hostingLine(ended, true, GRACE_END, { planEndedAt: ENDED }),
    'Offline since 15 Jan 2027. Restart your plan and this link works again — same link, embed and QR.', 'turns at the exact instant');
  assert.equal(share.hostingLine({ ...ended, plan_ended_at: ENDED }, true, GRACE_END - 1),
    'Your plan has ended. This walkthrough goes offline on 15 Jan 2027. Restart your plan to keep it live.', 'the row’s own plan_ended_at');
  assert.equal(share.hostingLine(ended, true, BEFORE), 'Your plan has ended. Restart your plan to keep it live.', 'no end day known: no date invented');
  assert.equal(share.hostingLine(hostingRow({ sharing_on: false }), false, BEFORE), 'Sharing is off. The link and embed show "not available".');
  assert.equal(share.hostingLine(hostingRow({ sharing_on: false, released_at: null }), false, BEFORE), '', 'never shared: no line');
});
test('the member hosting read wins when the row carries it', () => {
  const share = load();
  const read = extra => hostingRow({ plan_active: true, ...extra });
  assert.equal(share.hostingLine(read({ hosting_state: 'live_with_plan', offline_on: null }), true, AFTER), 'Live while your plan is active.');
  assert.equal(share.hostingLine(read({ hosting_state: 'offline_on', offline_on: '2027-10-10' }), true, AFTER),
    'Your plan has ended. This walkthrough goes offline on 10 Oct 2027. Restart your plan to keep it live.');
  assert.equal(share.hostingLine(read({ hosting_state: 'offline', offline_on: '2027-09-12' }), true, AFTER),
    'Offline since 12 Sep 2027. Restart your plan and this link works again — same link, embed and QR.');
  assert.equal(share.hostingLine(read({ hosting_state: 'offline', offline_on: null }), true, AFTER),
    'Offline. Restart your plan and this link works again — same link, embed and QR.');
  assert.equal(share.hostingLine(read({ hosting_state: 'paused' }), true, AFTER), 'Live while your plan is active.', 'an unknown state falls back to the plan');
  // get_tour_hosting_states' own names: live_not_enforced (the switch is off) reads as live, and offline_at dates it.
  assert.equal(share.hostingLine(read({ plan_active: false, hosting_state: 'live_not_enforced', offline_at: null }), true, AFTER), 'Live while your plan is active.');
  assert.equal(share.hostingLine(read({ hosting_state: 'offline_on', offline_at: '2027-10-10T00:00:00Z' }), true, AFTER),
    'Your plan has ended. This walkthrough goes offline on 10 Oct 2027. Restart your plan to keep it live.');
  // live_with_extension (offer 2026-09-26.2): its extension's end day, from extended_until first.
  const extended = read({ plan_active: false, hosting_state: 'live_with_extension', offline_on: '2027-11-02T00:00:00Z', extended_until: '2027-11-03T00:00:00Z' });
  assert.deepEqual({ ...share.hostingState(extended, AFTER) }, { state: 'live_with_extension', date: '2027-11-03T00:00:00.000Z' });
  assert.equal(share.hostingLine(extended, true, AFTER), 'Live until 3 Nov 2027 with a hosting extension.');
  assert.equal(share.hostingLine(read({ plan_active: false, hosting_state: 'live_with_extension', offline_on: '2027-11-02' }), true, AFTER),
    'Live until 2 Nov 2027 with a hosting extension.');
  assert.equal(share.hostingLine(read({ plan_active: false, hosting_state: 'live_with_extension' }), true, AFTER), share.hostingUnavailable, 'no day, no invented date');
  // The app's pages never name the extension.
  assert.equal(share.hostingLine(extended, true, AFTER, { app: true }), 'Online until 3 Nov 2027.');
});
test('the app’s pages name no purchase path: restart in the app', () => {
  const share = load();
  const app = { app: true, planEndedAt: ENDED };
  assert.equal(share.hostingLine(hostingRow({ plan_active: false }), true, GRACE_END - 1, app),
    'Your plan has ended. This walkthrough goes offline on 15 Jan 2027. Restart your plan in the app to keep it live.');
  assert.equal(share.hostingLine(hostingRow({ plan_active: false }), true, GRACE_END, app),
    'Offline since 15 Jan 2027. Restart your plan in the app and this link works again — same link, embed and QR.');
  for (const now of [BEFORE, GRACE_END - 1, GRACE_END]) {
    for (const row of [hostingRow(), hostingRow({ plan_active: false })]) assert.doesNotMatch(share.hostingLine(row, true, now, app), /\$|12 months|Guaranteed/);
  }
});
test('the plan-ended line counts the office’s live walkthroughs', () => {
  const share = load();
  assert.equal(share.planEndedLine(3, '2027-01-15T00:00:00Z'), 'Your plan has ended. 3 live walkthroughs go offline on 15 Jan 2027. Restart your plan to keep them live.');
  assert.equal(share.planEndedLine(1, '2027-01-15T00:00:00Z'), 'Your plan has ended. 1 live walkthrough goes offline on 15 Jan 2027. Restart your plan to keep it live.');
  assert.equal(share.planEndedLine(2, '2027-01-15T00:00:00Z', { app: true }), 'Your plan has ended. 2 live walkthroughs go offline on 15 Jan 2027. Restart your plan in the app to keep them live.');
  assert.equal(share.planEndedLine(0, null), 'Your plan has ended. Restart your plan to keep your walkthroughs live.');
});
test('missing or unreadable hosting state says so on a live card and never invents a date', () => {
  const share = load();
  const unavailable = 'Hosting dates could not load. Refresh to check.';
  for (const row of [null, undefined, 'receipt', hostingRow({ released_at: null }), hostingRow({ plan_active: 'true' }), hostingRow({ plan_active: null })]) {
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
