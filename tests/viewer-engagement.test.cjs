'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../dist/viewer-engagement.js');
const TOUR = 'aaaaaaaa-1111-4111-8111-111111111111', VISIT = 'bbbbbbbb-1111-4111-8111-111111111111';
function fixture(extra = {}) {
  let now = 0, timerID = 0; const listeners = new Map(), timers = new Map(), sent = [];
  const target = () => ({ hidden: false, visibilityState: 'visible', addEventListener(name, fn) { listeners.set(this.tag + name, fn); }, removeEventListener(name) { listeners.delete(this.tag + name); } });
  const doc = Object.assign(target(), { tag: 'doc' }), stage = Object.assign(target(), { tag: 'stage', contains: value => value === stage });
  const win = Object.assign(target(), { tag: 'win', performance: { now: () => now }, crypto: { randomUUID: () => VISIT }, setInterval: () => 42, clearInterval() {}, setTimeout(fn, ms) { timers.set(++timerID, { fn, ms }); return timerID; }, clearTimeout(id) { timers.delete(id); } });
  const collector = api.create({ window: win, document: doc, stage, enabled: true, publicShare: true, token: 'synthetic-share-token', tourID: TOUR, visitID: VISIT,
    transport: async payload => { sent.push(JSON.parse(JSON.stringify(payload))); return { status: 'accepted', sequence: payload.sequence }; }, ...extra });
  return { collector, win, doc, stage, sent, timers, setTime: ms => { now = ms; }, fire(target, name, event = {}) { listeners.get(target.tag + name)?.(event); } };
}
const drain = () => new Promise(resolve => setImmediate(resolve));
test('off by default and owner/private previews do not collect', () => {
  const off = api.create({}); assert.equal(off.enabled, false); assert.equal(off.flush(), null);
  const owner = fixture({ publicShare: false }); owner.collector.stop('s0'); assert.equal(owner.collector.flush(), null); assert.deepEqual(owner.sent, []);
});
test('same-document stage events start measurement only for opaque stop IDs', async () => {
  const f = fixture();
  f.fire(f.stage, 'veylet:stop', { target: {}, detail: { source: 'veylet-v2', stop_id: 's0' } }); assert.equal(f.collector.flush(), null);
  f.fire(f.stage, 'veylet:stop', { target: f.stage, detail: { source: 'other', stop_id: 's0' } }); assert.equal(f.collector.flush(), null);
  assert.equal(f.collector.stop('Kitchen private address'), false);
  f.fire(f.stage, 'veylet:stop', { target: f.stage, detail: { source: 'veylet-v2', stop_id: 's0' } }); f.setTime(10000); f.collector.flush(); await drain();
  assert.equal(f.sent[0].stops[0].seconds, 10); assert.deepEqual(Object.keys(f.sent[0]), ['schema_version', 'tour_id', 'visit_id', 'sequence', 'complete', 'stops', 'final_stop_id']); f.collector.dispose();
});
test('visibility transitions keep visible time and exclude background dwell', async () => {
  const f = fixture(); f.collector.stop('s0'); f.setTime(10000); f.doc.hidden = true; f.doc.visibilityState = 'hidden'; f.fire(f.doc, 'visibilitychange'); await drain();
  assert.equal(f.sent[0].stops[0].seconds, 10);
  f.setTime(100000); f.doc.hidden = false; f.doc.visibilityState = 'visible'; f.fire(f.doc, 'visibilitychange'); f.setTime(105000); f.collector.flush(); await drain();
  assert.equal(f.sent.at(-1).stops[0].seconds, 15); f.collector.dispose();
});
test('between-stop transitions and idle periods are not active dwell', async () => {
  const f = fixture(); f.collector.stop('s0'); f.setTime(5000); f.collector.stop(null); f.setTime(15000); f.collector.stop('s1'); f.setTime(20000); f.collector.flush(); await drain();
  assert.deepEqual(f.sent[0].stops, [{ id: 's0', seconds: 5 }, { id: 's1', seconds: 5 }]);
  f.setTime(100000); f.collector.flush(); await drain(); assert.ok(f.sent.at(-1).stops[1].seconds <= 25); f.collector.dispose();
});
test('retry keeps identical visit/sequence/payload and final pagehide is dispatched during an older pending send', async () => {
  const seen = []; let fail = true;
  const f = fixture({ transport: async payload => { seen.push(payload); if (fail) throw new Error('offline'); return { status: 'accepted', sequence: payload.sequence }; } });
  f.collector.stop('s0'); f.setTime(5000); f.collector.flush(); await drain(); fail = false;
  const retry = [...f.timers.values()].find(t => t.ms === 1000); assert.ok(retry); retry.fn(); await drain(); assert.deepEqual(seen[0], seen[1]); f.collector.dispose();
  let resolve; const pending = new Promise(r => { resolve = r; }); const calls = [];
  const g = fixture({ transport: payload => { calls.push(payload); return calls.length === 1 ? pending : Promise.resolve({ status: 'accepted', sequence: payload.sequence }); } });
  g.collector.stop('s0'); g.setTime(2000); g.collector.flush(); g.setTime(3000); g.fire(g.win, 'pagehide');
  assert.equal(calls.length, 2); assert.equal(calls[1].complete, true); assert.equal(calls[1].final_stop_id, 's0'); assert.equal(calls[1].stops[0].seconds, 3);
  resolve({ status: 'accepted', sequence: calls[0].sequence }); await drain(); g.collector.dispose();
});
test('server gate and rate limit disable the collector without blocking the viewer', async () => {
  for (const status of ['disabled', 'unavailable', 'rate_limited']) {
    const f = fixture({ transport: async () => ({ status, sequence: 1 }) }); f.collector.stop('s0'); f.collector.flush(); await drain(); assert.equal(f.collector.enabled, false);
  }
});
test('a covering replay acknowledgement is accepted without retry', async () => {
  const f = fixture({ transport: async payload => ({ status: 'accepted', sequence: payload.sequence + 1, replay: true }) });
  f.collector.stop('s0'); f.collector.flush(); await drain(); assert.equal(f.timers.size, 0); f.collector.dispose();
});
test('BFCache return starts a fresh visit and fences an old delayed acknowledgement', async () => {
  let resolve; const pending = new Promise(r => { resolve = r; }); const seen = [];
  const f = fixture({ transport: payload => { seen.push(payload); return seen.length === 1 ? pending : Promise.resolve({ status: 'accepted', sequence: payload.sequence }); } });
  f.collector.stop('s0'); f.setTime(2000); f.collector.flush(); f.fire(f.win, 'pagehide');
  f.win.crypto.randomUUID = () => 'cccccccc-1111-4111-8111-111111111111';
  f.setTime(50000); f.fire(f.win, 'pageshow', { persisted: true }); f.setTime(55000); f.collector.flush(); await drain();
  assert.equal(seen.at(-1).visit_id, 'cccccccc-1111-4111-8111-111111111111'); assert.equal(seen.at(-1).sequence, 1); assert.equal(seen.at(-1).stops[0].seconds, 5);
  resolve({ status: 'accepted', sequence: 1 }); await drain(); assert.equal(f.collector.enabled, true); f.collector.dispose();
});
