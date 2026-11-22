/*
 * Today first: the web desk opens on Needs you, the added-up opens and contact taps,
 * and one row per space; Open shows that space alone (#space-<id>) with a way back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDesk } = require('./desk-fake.cjs');

const TOKEN = 'a'.repeat(43);
const tours = [
  { id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null, created_at: '2026-10-01T00:00:00Z' },
  { id: 't2', property_id: 'p2', status: 'ready', storage_path: 'w1/t2/package.zip', created_by: 'user-1', share_token: TOKEN, created_at: '2026-10-02T00:00:00Z' },
  { id: 't3', property_id: 'p2', status: 'ready', storage_path: 'w1/t3/package.zip', created_by: 'user-1', share_token: 'b'.repeat(43), created_at: '2026-10-03T00:00:00Z' },
];
const properties = [{ id: 'p1', title: 'Corner office', workspace_id: 'w1' }, { id: 'p2', title: 'Hall', workspace_id: 'w1' }, { id: 'p3', title: '', workspace_id: 'w1' }];
const stats = { t2: { opens: 14, call_taps: 3, email_taps: 1 }, t3: { opens: 1, call_taps: 0, email_taps: 0 } };
const desk = (options = {}) => loadDesk({ tables: { tours: { data: tours }, properties: { data: properties } }, approved: ['t2', 't3'],
  rpc: { get_tour_view_stats: async args => ({ data: [{ ...stats[args.p_tour_id], last_opened_at: '2026-10-05T00:00:00Z' }] }) }, ...options });
const rows = h => h.ids['account-space-list'].children.filter(el => el.className === 'space-row');

test('the index lists every space with its most pressing state and walkthrough count', async () => {
  const h = await desk(); await h.settle();
  assert.equal(h.ids['account-space-index'].hidden, false);
  assert.deepEqual(rows(h).map(row => [row.children[0].textContent, row.children[1].children.map(el => el.textContent)]), [
    ['Corner office', ['Ready for your review', '1 walkthrough']],
    ['Hall', ['Live', '2 walkthroughs']],
    ['Untitled space', ['No walkthrough yet']],
  ]);
  assert.equal(h.control(rows(h)[0], 'space-open').getAttribute('aria-label'), 'Open Corner office');
});

test('the totals add up opens and contact taps of the shared walkthroughs, one read each', async () => {
  const h = await desk(); await h.settle();
  const totals = h.ids['account-totals'];
  assert.equal(totals.hidden, false);
  assert.deepEqual(totals.children.slice(0, 3).map(el => el.children.map(part => part.textContent)), [['15', 'opens'], ['3', 'call taps'], ['1', 'email tap']]);
  assert.equal(totals.children[3].textContent, 'Since sharing began, across 2 shared walkthroughs.');
  assert.deepEqual(h.called('get_tour_view_stats').map(args => args.p_tour_id).sort(), ['t2', 't3']);
  const older = await desk({ rpc: { get_tour_view_stats: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await older.settle();
  assert.equal(older.ids['account-totals'].hidden, true);
});

test('a shared walkthrough without a tap count leaves that total unread, never zero', async () => {
  const partial = await desk({ rpc: { get_tour_view_stats: async args => ({ data: [args.p_tour_id === 't2'
    ? { opens: 14, call_taps: 3, last_opened_at: '2026-10-05T00:00:00Z' }
    : { opens: 1, call_taps: 0, email_taps: 0, last_opened_at: '2026-10-05T00:00:00Z' }] }) } });
  await partial.settle();
  const totals = partial.ids['account-totals'];
  assert.equal(totals.hidden, false);
  assert.deepEqual(totals.children.slice(0, 3).map(el => el.children.map(part => part.textContent)),
    [['15', 'opens'], ['3', 'call taps'], ['—', 'email taps']], 'a missing count shows a dash, not zero');
  assert.equal(totals.children[3].textContent, 'Since sharing began, across 2 shared walkthroughs. Some contact tap counts are incomplete.');
});

test('Open shows that space alone, All spaces returns, and a Needs you row opens its own space', async () => {
  const h = await desk(); await h.settle();
  const view = h.ids['view-walkthroughs'];
  const space = id => h.ids['account-properties'].children.find(el => el.dataset.space === id);
  await h.control(rows(h)[1], 'space-open').fire('click');
  assert.equal(view.getAttribute('data-space'), 'p2');
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => space(id).hidden), [true, false, true]);
  await h.control(space('p2'), 'space-back').fire('click');
  assert.equal(view.getAttribute('data-space'), null);
  assert.deepEqual(['p1', 'p2', 'p3'].map(id => space(id).hidden), [false, false, false]);
  const needs = h.ids['account-needs-list'].children.filter(el => el.className === 'needs-row');
  await needs[0].children[1].fire('click');
  assert.equal(view.getAttribute('data-space'), 'p1');
  assert.equal(h.card('t1').wasFocused, true);
});

test('#space-<id> on load opens that space; an unknown one falls back to every space', async () => {
  const h = await desk({ hash: '#space-p2' }); await h.settle();
  assert.equal(h.ids['view-walkthroughs'].getAttribute('data-space'), 'p2');
  const unknown = await desk({ hash: '#space-nope' }); await unknown.settle();
  assert.equal(unknown.ids['view-walkthroughs'].getAttribute('data-space'), null);
  assert.equal(unknown.ids['view-walkthroughs'].hidden, false);
});

test('the totals count every shared walkthrough, past forty', async () => {
  const many = Array.from({ length: 45 }, (_, index) => ({ id: 's' + index, property_id: 'p2', status: 'ready', storage_path: 'w1/s' + index + '/package.zip',
    created_by: 'user-1', share_token: String(index).padStart(43, 'c'), created_at: '2026-10-02T00:00:00Z' }));
  const h = await loadDesk({ tables: { tours: { data: many }, properties: { data: properties } }, approved: many.map(tour => tour.id),
    rpc: { get_tour_view_stats: async () => ({ data: [{ opens: 2, call_taps: 1, email_taps: 0, last_opened_at: '2026-10-05T00:00:00Z' }] }) } });
  await h.settle();
  assert.deepEqual(h.ids['account-totals'].children.slice(0, 3).map(el => el.children[0].textContent), ['90', '45', '0']);
});

test('the Spaces filter appears past three spaces and narrows rows live by title or location', async () => {
  const four = [
    ...properties,
    { id: 'p4', title: 'Riverfront unit', location_general: 'New Farm', workspace_id: 'w1' },
  ];
  const small = await desk(); await small.settle();
  assert.equal(small.ids['account-space-filter-wrap'].hidden, true, '3 spaces stay uncluttered');
  const h = await loadDesk({ tables: { tours: { data: tours }, properties: { data: four } }, approved: ['t2', 't3'],
    rpc: { get_tour_view_stats: async () => ({ data: [{ opens: 1, call_taps: 0, email_taps: 0 }] }) } });
  await h.settle();
  assert.equal(h.ids['account-space-filter-wrap'].hidden, false);
  const input = h.ids['account-space-filter'];
  input.value = 'new farm';
  await input.fire('input');
  assert.deepEqual(rows(h).map(r => r.hidden), [true, true, true, false]);
  assert.equal(h.ids['account-space-filter-status'].textContent, 'Showing 1 of 4 spaces.');
});

