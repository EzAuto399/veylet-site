/*
 * The web desk's zero states (design spec v2, 6.16, 6.14 "Changes", 11.9; build map P1-WEB-4):
 * the empty desk opens on the sample walkthrough, a space without a capture offers the app by
 * QR code, "No matching spaces." has Clear filter, and a live link's zeroes (no opens, no
 * enquiries) offer Copy link and QR code by pressing the card's own controls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadDesk } = require('./desk-fake.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const markup = read('dist/account/index.html');
const guideCss = read('dist/account-guide.css');
const APP_STORE = 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913';
const qrContext = { window: {}, TextEncoder };
vm.runInNewContext(read('dist/vendor/qrcode-1.5.4.min.js'), qrContext);
const VeyletQR = qrContext.window.VeyletQR || qrContext.VeyletQR;

const live = (extra = {}) => ({ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: 'abcdefghijklmnop', ...extra });
const ZERO = { opens: 0, days_with_opens: 0, call_taps: 0, email_taps: 0, share_taps: 0, by_src: {}, by_host: {}, last_opened_at: null };
const zeroStats = { get_tour_view_stats: async () => ({ data: [ZERO] }) };

test('empty desk: the sample walkthrough card comes first, labelled, with the poster and the person’s own card', async () => {
  const h = await loadDesk({ tables: { properties: { data: [] }, tours: { data: [] } } });
  const card = h.ids['account-sample'];
  assert.equal(card.hidden, false);
  const label = card.all().find(el => el.className === 'sample-label');
  assert.equal(label.text(), 'Sample walkthrough');
  assert.equal(label.children[0].className, 'portal', 'the doorway glyph leads the label');
  assert.equal(label.children[0].getAttribute('aria-hidden'), 'true');
  const poster = card.all().find(el => el.tagName === 'IMG');
  assert.equal(poster.src, '/samples/eyeful-apartment/poster.webp');
  assert.equal(poster.alt, '', 'the link beside it carries the words');
  const link = h.control(card, 'sample-walkthrough');
  assert.equal(link.tagName, 'A');
  assert.equal(link.textContent, 'See what your buyers get');
  const url = new URL(link.href);
  assert.equal(url.pathname, '/handoff');
  assert.equal(url.searchParams.get('sample'), '1');
  assert.equal(url.searchParams.get('email'), 'owner@example.invalid', 'the sample carries the person’s own contact');
  assert.match(card.text(), /A research apartment, not a client listing\./);
  // It sits above "Add your first space", which stays the screen's one filled button.
  assert.ok(markup.indexOf('id="account-sample"') < markup.indexOf('id="account-next-step"'));
  const next = h.ids['account-next-step'];
  assert.deepEqual(next.children.filter(el => el.tagName === 'BUTTON').map(el => el.textContent), ['Add your first space']);
  // The form and the head's Add a space wait quiet until it is pressed, so neither adds a second filled button.
  assert.equal(h.ids['account-add-space'].open, false);
  assert.equal(h.ids['account-add-open'].className, 'tour-action');
  await h.button(next, 'Add your first space').fire('click');
  assert.equal(h.ids['account-add-space'].open, true);
  assert.equal(card.all().some(el => el.tagName === 'BUTTON' || /\b(tour-action|button)\b/.test(el.className)), false, 'the sample is a quiet link');
  // Product radii and tokens: radius 16 on the poster, the tint fill on the label.
  assert.match(guideCss, /\.sample-poster \{[^}]*border-radius: var\(--radius-media\)/);
  assert.match(guideCss, /\.sample-label \{[^}]*background: var\(--tint\)/);
  // A desk with a space has no sample card.
  const busy = await loadDesk();
  assert.equal(busy.ids['account-sample'].hidden, true);
  assert.equal(busy.ids['account-sample'].children.length, 0);
});

test('empty desk in the app: no sample card, because the app’s pages link only to one another', async () => {
  const h = await loadDesk({ appMode: true, tables: { properties: { data: [] }, tours: { data: [] } } });
  const card = h.ids['account-sample'];
  assert.ok(!card || card.hidden);
});

test('a space without a capture: a QR code that opens the app and "Capture it with the Veylet app"', async () => {
  const h = await loadDesk({ tables: { tours: { data: [] } }, window: { VeyletQR } });
  const space = h.ids['account-properties'].all().find(el => el.className === 'dash-space');
  assert.doesNotMatch(space.text(), /It is made automatically from your capture/, 'the dead end is gone');
  const kit = space.children.find(el => el.className === 'capture-app space-capture');
  assert.ok(kit);
  const store = h.control(kit, 'capture-app');
  assert.equal(store.tagName, 'A');
  assert.equal(store.href, APP_STORE);
  assert.match(store.innerHTML, /^<svg[\s>]/, 'drawn here by the vendored generator');
  assert.equal(store.getAttribute('aria-label'), 'Get the Veylet app on the App Store');
  assert.deepEqual(kit.all().filter(el => el.tagName === 'P').map(el => el.textContent), ['Capture it with the Veylet app.',
    'No walkthrough yet. Scan the code with your iPhone camera to get the app. Send the capture from it and this space shows its progress.']);
  assert.equal(kit.all().some(el => el.tagName === 'BUTTON'), false, 'no filled button is added');
  // Without the generator it is a plain link to the App Store, never a broken picture.
  const bare = await loadDesk({ tables: { tours: { data: [] } } });
  const plain = bare.control(bare.ids['account-properties'], 'capture-app');
  assert.deepEqual([plain.href, plain.textContent, plain.innerHTML], [APP_STORE, 'Get the Veylet app', undefined]);
  // The app's own page keeps its line: it is already the app.
  const app = await loadDesk({ appMode: true, tables: { tours: { data: [] } }, window: { VeyletQR } });
  assert.equal(app.control(app.ids['account-properties'], 'capture-app'), null);
  assert.match(app.ids['account-properties'].text(), /No walkthrough yet\. It is made automatically from your capture/);
});

test('no matching spaces: Clear filter empties the words and the status pill and returns focus to the filter', async () => {
  const properties = ['Harbour loft', 'Corner office', 'Hall', 'Garden flat'].map((title, index) => ({ id: 'p' + index, title, workspace_id: 'w1' }));
  const h = await loadDesk({ tables: { properties: { data: properties }, tours: { data: [] } } });
  const input = h.ids['account-space-filter'], status = h.ids['account-space-filter-status'], clear = h.ids['account-space-filter-clear'];
  assert.match(markup, /<button class="tour-action space-filter-clear" id="account-space-filter-clear" type="button" data-control="space-filter-clear" hidden>Clear filter<\/button>/);
  assert.equal(clear.hidden, true, 'nothing to clear yet');
  const pills = h.ids['account-space-states'].children;
  await pills.find(el => el.dataset.stateFilter === 'live').fire('click');
  input.value = 'loft'; await input.fire('input');
  assert.equal(status.textContent, 'No matching spaces.');
  assert.equal(clear.hidden, false);
  // Some matches: the count, and no Clear filter beside it.
  await pills.find(el => el.dataset.stateFilter === 'all').fire('click');
  assert.equal(status.textContent, 'Showing 1 of 4 spaces.');
  assert.equal(clear.hidden, true);
  await pills.find(el => el.dataset.stateFilter === 'needs').fire('click');
  assert.equal(clear.hidden, false);
  await clear.fire('click');
  assert.equal(input.value, '');
  assert.deepEqual(pills.map(el => [el.dataset.stateFilter, el.getAttribute('aria-pressed')]), [['all', 'true'], ['needs', 'false'], ['live', 'false'], ['other', 'false']]);
  assert.equal(h.ids['account-space-list'].children.filter(el => el.className === 'space-row' && !el.hidden).length, 4);
  assert.deepEqual([status.hidden, clear.hidden], [true, true]);
  assert.equal(h.doc.activeElement, input, 'focus goes back to the filter field');
  assert.ok(markup.indexOf('id="account-space-filter-status"') < markup.indexOf('id="account-space-filter-clear"'), 'it sits right after the line it answers');
});

test('no opens yet: the views line and Insights offer Copy link and QR code, pressing the card’s own controls', async () => {
  const h = await loadDesk({ tables: { tours: { data: [live()] } }, rpc: zeroStats });
  const card = h.card();
  const views = card.all().find(el => el.className === 'tour-views');
  assert.equal(views.textContent, 'No opens yet.');
  const copy = h.control(views, 'views-copy-link'), qr = h.control(views, 'views-qr');
  assert.deepEqual([copy.textContent, qr.textContent], ['Copy link', 'QR code']);
  const cardCopy = h.control(card, 'copy-link');
  const qrToggle = card.all().find(el => el.dataset.disclosure === 'qr');
  await copy.fire('click');
  assert.equal(cardCopy.clicked, 1, 'the card’s own Copy link, not a second way to copy');
  await qr.fire('click');
  assert.equal(qrToggle.clicked, 1, 'the card’s own QR code panel opens');
  assert.equal(h.doc.activeElement, qrToggle);
  // Insights: the line, the sentence with the space's name, and the same two controls.
  const insights = card.all().find(el => el.className === 'tour-panel tour-insights');
  const body = insights.children[0];
  assert.deepEqual(body.children.slice(0, 2).map(el => el.textContent), ['No opens yet.', 'Share Harbour loft and opens show up here.']);
  assert.deepEqual(body.children[2].children.map(el => [el.dataset.control, el.textContent]), [['insights-share', 'Copy link'], ['insights-qr', 'QR code']]);
  // With a share sheet the lead is Share, and Copy link joins it.
  const sheet = await loadDesk({ tables: { tours: { data: [live()] } }, rpc: zeroStats, navigator: { onLine: true, share: async () => {}, clipboard: { writeText: async () => {} } } });
  const row = sheet.card().all().find(el => el.dataset.control === 'insights-share').parent;
  assert.deepEqual(row.children.map(el => el.textContent), ['Share', 'Copy link', 'QR code']);
  // Paused: nobody can open the link, so the line stands alone.
  const paused = await loadDesk({ tables: { tours: { data: [live({ share_paused_at: '2026-11-20T00:00:00Z' })] } }, rpc: zeroStats });
  const pausedViews = paused.card().all().find(el => el.className === 'tour-views');
  assert.equal(pausedViews.textContent, 'No opens yet.');
  assert.equal(pausedViews.children.length, 0);
  assert.equal(paused.control(paused.card(), 'insights-qr'), null);
  // Opened: no zero controls.
  const opened = await loadDesk({ tables: { tours: { data: [live()] } }, rpc: { get_tour_view_stats: async () => ({ data: [{ ...ZERO, opens: 3, last_opened_at: '2026-11-20T00:00:00Z' }] }) } });
  assert.equal(opened.control(opened.card(), 'views-qr'), null);
});

test('no buyer or rental enquiries yet: Copy link and QR code beside the line, only while the link is live', async () => {
  const enquiriesDesk = async (tour, mode = 'sale') => {
    const h = await loadDesk({ tables: { tours: { data: [tour] } }, rpc: { ...zeroStats,
      get_property_campaign_details: async () => ({ data: [{ campaign_mode: mode, show_on_handoff: true }] }),
      list_workspace_tour_enquiries: async () => ({ data: [] }) } });
    const details = h.card().all().find(el => el.className === 'account-details tour-campaign-sync');
    details.open = true; await details.fire('toggle'); await h.settle();
    return { h, box: h.card().all().find(el => el.className === 'tour-enquiries') };
  };
  const { h, box } = await enquiriesDesk(live());
  assert.ok(box.children.some(el => el.textContent === 'No buyer enquiries yet.'));
  const row = box.children.find(el => /\btour-zero-actions\b/.test(el.className));
  assert.deepEqual(row.children.map(el => [el.dataset.control, el.textContent]), [['enquiries-copy-link', 'Copy link'], ['enquiries-qr', 'QR code']]);
  await h.control(row, 'enquiries-copy-link').fire('click');
  assert.equal(h.control(h.card(), 'copy-link').clicked, 1);
  const lease = await enquiriesDesk(live(), 'lease');
  assert.ok(lease.box.children.some(el => el.textContent === 'No rental enquiries yet.'));
  assert.ok(lease.box.children.some(el => /\btour-zero-actions\b/.test(el.className)));
  // Paused: the line alone.
  const paused = await enquiriesDesk(live({ share_paused_at: '2026-11-20T00:00:00Z' }));
  assert.ok(paused.box.children.some(el => el.textContent === 'No buyer enquiries yet.'));
  assert.equal(paused.box.children.some(el => /\btour-zero-actions\b/.test(el.className)), false);
});
