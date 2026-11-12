'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../dist/account-journey.js');
const A = 'aaaaaaaa-1111-4111-8111-111111111111', B = 'bbbbbbbb-1111-4111-8111-111111111111';
const EVENT = 'cccccccc-1111-4111-8111-111111111111', TOUR = 'dddddddd-1111-4111-8111-111111111111';
const item = (extra = {}) => ({ id: EVENT, kind: 'ready_for_review', needs_attention: true, read_at: null, action: 'review', tour_id: TOUR, ...extra });
const page = (items = [item()]) => ({ data: { items, unread_count: items.filter(x => !x.read_at).length, next_cursor: null, snapshot_token: A, as_of: '2026-11-13T01:00:00Z' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('reading an event changes its unread state but never resolves its task', async () => {
  const calls = [];
  const store = api.activityStore({ rpc: async (name, args) => { calls.push([name, args]); return name === 'list_activity' ? page() : { data: { read_ids: [EVENT], unread_count: 0 } }; } });
  store.setUser(A); await store.load(); await store.mark([EVENT]);
  assert.equal(store.state.unread, 0); assert.ok(store.state.items[0].read_at); assert.equal(store.state.items[0].needs_attention, true);
  assert.deepEqual(calls[1], ['mark_activity_read', { p_event_ids: [EVENT], p_snapshot_token: null }]);
});
test('mark-all submits the server snapshot, not timestamps or a guessed cursor', async () => {
  let seen;
  const store = api.activityStore({ rpc: async (name, args) => { if (name === 'list_activity') return page(); seen = args; return { data: { read_ids: [EVENT], unread_count: 0 } }; } });
  store.setUser(A); await store.load(); await store.mark([], true);
  assert.deepEqual(seen, { p_event_ids: [], p_snapshot_token: A });
});
test('failed read saves roll back, preserve the issue and provide retry feedback', async () => {
  const store = api.activityStore({ rpc: async name => name === 'list_activity' ? page() : { error: { code: 'network' } } });
  store.setUser(A); await store.load(); assert.equal(await store.mark([EVENT]), false);
  assert.equal(store.state.items[0].read_at, null); assert.equal(store.state.items[0].needs_attention, true); assert.match(store.state.error, /could not save/);
});
test('A→B→A rejects old load and mark replies by generation, not just account ID', async () => {
  const oldRead = deferred(), oldMark = deferred(); let count = 0;
  const store = api.activityStore({ rpc: name => name === 'mark_activity_read' ? oldMark.promise : ++count === 1 ? oldRead.promise : Promise.resolve(page([item({ read_at: null })])) });
  store.setUser(A); const loading = store.load(); await Promise.resolve();
  store.setUser(B); store.setUser(A); await store.load(); const marking = store.mark([EVENT]); await Promise.resolve();
  store.setUser(B); store.setUser(A); await store.load();
  oldRead.resolve(page([item({ read_at: 'old' })])); oldMark.resolve({ data: { read_ids: [EVENT], unread_count: 0 } });
  await Promise.all([loading, marking]); assert.equal(store.state.unread, 1); assert.equal(store.state.items[0].read_at, null);
});
test('stale replies never replace a newer refresh; missing and empty are distinct', async () => {
  const old = deferred(); let n = 0;
  const store = api.activityStore({ rpc: () => ++n === 1 ? old.promise : Promise.resolve(page([])) });
  store.setUser(A); const loading = store.load(); await Promise.resolve(); await store.load(); old.resolve(page()); await loading;
  assert.equal(store.state.phase, 'ready'); assert.deepEqual(store.state.items, []);
  const missing = api.activityStore({ rpc: async () => ({ error: { code: 'PGRST202' } }) }); missing.setUser(A); await missing.load();
  assert.equal(missing.state.phase, 'unavailable'); assert.equal(missing.state.unread, null);
});
test('pagination deduplicates items and retains account-scoped data on transient failure', async () => {
  let n = 0;
  const store = api.activityStore({ rpc: async () => { n++; if (n === 1) return { data: { ...page().data, next_cursor: { id: EVENT } } }; if (n === 2) return page(); throw new Error('offline'); } });
  store.setUser(A); await store.load(); await store.load(true); assert.equal(store.state.items.length, 1); await store.load();
  assert.equal(store.state.phase, 'stale'); assert.equal(store.state.items.length, 1); store.setUser(B); assert.equal(store.state.items.length, 0);
});
test('rich Insights validates exact revision identity, count shape and stop values', () => {
  const good = { schema_version: 1, tour_id: TOUR, revision: 2, availability: 'disabled', totals: { opens: 0 }, coverage: {}, stops: [] };
  assert.equal(api.decodeInsights(good, TOUR).totals.opens, 0);
  assert.throws(() => api.decodeInsights({ ...good, tour_id: B }, TOUR));
  assert.throws(() => api.decodeInsights({ ...good, totals: { opens: -1 } }, TOUR));
  assert.throws(() => api.decodeInsights({ ...good, stops: [{ id: 'private room name', visits: 1, active_seconds: 5, exits: 0 }] }, TOUR));
});
test('only a missing new RPC falls back to explicitly scoped retained history', async () => {
  const calls = [];
  const result = await api.readInsights(async (name, args) => { calls.push([name, args]); return name === 'get_walkthrough_insights' ? { error: { code: 'PGRST202' } } : { data: { opens: 0, call_taps: 0, email_taps: 0 } }; }, TOUR, 7);
  assert.equal(result.legacy, true); assert.equal(result.availability, 'no_observations'); assert.equal(result.totals.scope, 'recorded_history_all_revisions');
  assert.deepEqual(calls[0][1], { p_tour_id: TOUR, p_days: 7 });
  await assert.rejects(api.readInsights(async () => ({ error: { code: '42501' } }), TOUR));
});
test('report distinguishes missing from zero and taps from completed enquiries', () => {
  const text = api.reportText('Example', { legacy: true, totals: { opens: 0, call_taps: 0, email_taps: null }, stops: [] });
  assert.match(text, /Recorded opens: 0/); assert.match(text, /Contact taps: Not available/); assert.match(text, /all revisions/); assert.match(text, /not confirmed enquiries/);
});
test('an in-flight refresh cannot restore unread after mark acknowledgement', async () => {
  const stale = deferred(); let n = 0;
  const store = api.activityStore({ rpc: name => name === 'mark_activity_read' ? Promise.resolve({ data: { read_ids: [EVENT], unread_count: 0 } }) : ++n === 1 ? Promise.resolve(page()) : stale.promise });
  store.setUser(A); await store.load(); const refresh = store.load(); await Promise.resolve(); await store.mark([EVENT]); stale.resolve(page()); await refresh;
  assert.equal(store.state.unread, 0); assert.ok(store.state.items[0].read_at); assert.equal(store.state.busy, false);
});
test('UTC report periods are formatted as UTC regardless of the process timezone', () => {
  const text = api.reportText('Example', { revision: 1, period_start: '2026-11-01T08:00:00+10:00', period_end: '2026-11-02T08:00:00+10:00', totals: {}, stops: [] });
  const expected = new Date('2026-11-01T08:00:00+10:00').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  assert.ok(text.includes(expected)); assert.match(text, /UTC/);
});

test('Activity keyboard focus survives mark-all and disappearing per-update read actions', async () => {
  const { createDocument } = require('./fake-dom.cjs');
  const doc = createDocument(), host = doc.createElement('section'), launch = doc.createElement('button');
  host.id = 'account-activity'; host.hidden = true; launch.id = 'account-activity-open'; doc.body.append(launch, host);
  const mount = api.mountActivity({ document: doc, open() {}, rpc: async name => name === 'list_activity' ? page() : { data: { read_ids: [EVENT], unread_count: 0 } } });
  mount.setUser(A); await mount.load(); mount.open();
  const byText = text => host.querySelectorAll('button').find(b => b.textContent === text);
  byText('Mark all read').focus(); byText('Mark all read').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.activeElement.textContent, 'Needs attention'); assert.ok(host.contains(doc.activeElement)); assert.equal(doc.activeElement.disabled, false);
  await mount.load(); byText('Mark read').focus(); byText('Mark read').click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.activeElement.textContent, 'Review walkthrough'); assert.ok(host.contains(doc.activeElement));
  launch.focus(); await mount.load(); assert.equal(doc.activeElement, launch, 'background refresh must not steal external focus');
});

test('unshared Insights renders only its explanation and refresh even if a response contains stale live coverage', async () => {
  const { createDocument } = require('./fake-dom.cjs');
  const doc = createDocument(), host = doc.createElement('details'); doc.body.append(host);
  api.mountInsights({ document: doc, host, tourID: TOUR, title: 'Synthetic space', autoOpen: true,
    rpc: async () => ({ data: { schema_version: 1, tour_id: TOUR, revision: 3, availability: 'not_shared', totals: { opens: 148, by_src: { link: 148 } }, coverage: { observed_visits: 92, complete_visits: 80 }, stops: [] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(host.textContent, /Insights appear after this walkthrough is shared/);
  assert.match(host.textContent, /Refresh Insights/);
  assert.doesNotMatch(host.textContent, /Recorded opens|observed visits|final summaries|Where opens|Copy Insights summary|148|92/);
});

test('Insights stop-metric changes retain keyboard focus and normalized server geometry', async () => {
  const { createDocument } = require('./fake-dom.cjs');
  const doc = createDocument(), host = doc.createElement('details'); doc.body.append(host);
  doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
  api.mountInsights({ document: doc, host, tourID: TOUR, title: 'Synthetic space', autoOpen: true,
    rpc: async () => ({ data: { schema_version: 1, tour_id: TOUR, revision: 1, availability: 'available', totals: { opens: 1, by_src: { link: 1 } }, coverage: { observed_visits: 21, complete_visits: 21, minimum_visits: 20, layout_available: true }, stops: [{ id: 's1', label: 'Stop 1', visits: 21, active_seconds: 220, exits: 21, x: 0, y: .5 }, { id: 's2', label: 'Stop 2', visits: 1, active_seconds: 5, exits: 0, x: 1, y: .5 }] } }) });
  await new Promise(resolve => setImmediate(resolve));
  const active = host.querySelectorAll('button').find(b => b.textContent === 'Active time'); active.focus(); active.click();
  assert.equal(doc.activeElement.textContent, 'Active time'); assert.ok(host.contains(doc.activeElement)); assert.equal(doc.activeElement.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(host.querySelectorAll('circle').map(n => [n.getAttribute('cx'), n.getAttribute('cy')]), [['30', '115'], ['330', '115']]);
  assert.match(host.textContent, /Active foreground seconds/);
});

test('synthetic full-schema PostgreSQL wire responses decode without client shape translation', async () => {
  // Captured from the local PostgreSQL migration test, never a live account.
  const wire = require('./activity-insights-wire.json');
  const store = api.activityStore({ rpc: async () => ({ data: wire.activity }) });
  store.setUser(A); await store.load();
  assert.equal(store.state.phase, 'ready'); assert.equal(store.state.unread, 2); assert.equal(store.state.attention, 0);
  assert.deepEqual(store.state.items.map(item => item.kind), ['sharing_on', 'ready_for_review']);
  const insights = await api.readInsights(async () => ({ data: wire.insights }), wire.insights.tour_id, 30);
  assert.equal(insights.totals.scope, 'revision_period'); assert.equal(insights.totals.by_src.link, 1);
  assert.equal(insights.coverage.historical_event_coverage, 'unknown'); assert.equal(insights.coverage.observed_visits, 21);
  assert.deepEqual(insights.stops.map(s => [s.id, s.x, s.y]), [['s1', 0, .5], ['s2', 1, .5]]);
});

test('Insights refresh keeps a focusable busy action until the response arrives', async () => {
  const { createDocument } = require('./fake-dom.cjs');
  const doc = createDocument(), host = doc.createElement('details'); doc.body.append(host);
  const pending = deferred(), response = { data: { schema_version: 1, tour_id: TOUR, revision: 1, availability: 'disabled', totals: { opens: 0 }, coverage: {}, stops: [] } }; let requests = 0;
  api.mountInsights({ document: doc, host, tourID: TOUR, title: 'Synthetic space', autoOpen: true, rpc: () => ++requests === 1 ? Promise.resolve(response) : pending.promise });
  await new Promise(resolve => setImmediate(resolve));
  const refresh = host.querySelectorAll('button').find(b => b.textContent === 'Refresh Insights'); refresh.focus(); refresh.click();
  assert.ok(host.contains(doc.activeElement)); assert.equal(doc.activeElement.textContent, 'Loading…'); assert.equal(doc.activeElement.disabled, false); assert.equal(doc.activeElement.getAttribute('aria-disabled'), 'true');
  pending.resolve(response); await new Promise(resolve => setImmediate(resolve));
  assert.equal(doc.activeElement.textContent, 'Refresh Insights'); assert.ok(host.contains(doc.activeElement));
});
