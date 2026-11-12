/*
 * Viewer insights (data events, 11 Nov 2026): the player says one 'veylet:visit'
 * summary after every arrival, and the page's one dwell per visit may carry it,
 * only behind VIEWER_INSIGHTS (false until the privacy notice covers it) and
 * never in a tab opened with ?analytics=off. Stand-in fetch only: nothing here
 * reaches the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const clientSource = read('client-page.js');
const playerSource = read('tour-player-v2.js');
const TOKEN = 'synthetic-valid-token-1234';
const CONFIG = { url: 'https://fixture.invalid/', anonKey: 'non-network-fixture' };
const FLAG = 'const VIEWER_INSIGHTS = false;';
const plain = value => JSON.parse(JSON.stringify(value));

function loadModule(source = clientSource) {
  const window = {};
  vm.runInNewContext(source, { window, setTimeout, clearTimeout, URLSearchParams, URL });
  return window.VeyletClientPage;
}

/** One page load: a fake window and document, a recording fetch and a clock the test moves. */
function visitPage({ insights = false, analyticsOff } = {}) {
  assert.equal(clientSource.split(FLAG).length, 2, 'client-page.js declares the flag once, off');
  const page = loadModule(insights ? clientSource.replace(FLAG, 'const VIEWER_INSIGHTS = true;') : clientSource);
  const sent = [];
  const listeners = { doc: {}, win: {} };
  const fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 204, json: async () => null }; };
  const state = { now: 1000 };
  const document = { hidden: false, visibilityState: 'visible', addEventListener: (name, fn) => { (listeners.doc[name] ||= []).push(fn); } };
  const win = { document, addEventListener: (name, fn) => { (listeners.win[name] ||= []).push(fn); } };
  let bytes = 0;
  const crypto = { getRandomValues: array => { for (let i = 0; i < array.length; i++) array[i] = (bytes++ * 37) & 255; return array; } };
  const beacon = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', fetch, now: () => state.now, crypto,
    ...(analyticsOff === undefined ? {} : { analyticsOff }) });
  return {
    beacon, sent, listeners, state, win,
    emit: (name, detail) => { for (const fn of listeners.doc[name] || []) fn({ detail }); },
    leave: () => { for (const fn of listeners.win.pagehide || []) fn(); },
    dwell: () => sent.filter(body => body.p_kind === 'dwell'),
  };
}

const SUMMARY = { stops: 3, last_stop: 3, furthest_stop: 3, total_stops: 5, room: 'Kitchen', seconds: { Living: 40, Hall: 6 } };

test('with VIEWER_INSIGHTS false nothing of the visit is listened for or sent: the dwell stays {visit, seconds}', () => {
  assert.match(clientSource, /\n  const VIEWER_INSIGHTS = false;\n/, 'shipped off');
  const page = visitPage();
  page.beacon.opened(page.win);
  assert.equal(page.listeners.doc['veylet:visit'], undefined, 'the summary is not even listened for');
  page.emit('veylet:visit', SUMMARY);
  page.state.now += 30000;
  page.leave();
  const kinds = page.sent.map(body => body.p_kind);
  assert.deepEqual(kinds, ['open', 'dwell'], 'no extra row, no extra kind');
  assert.deepEqual(plain(page.dwell()[0].p_detail), { visit: page.beacon.visit, seconds: 30 });
  for (const body of page.sent) {
    const text = JSON.stringify(body);
    for (const word of ['stops', 'furthest_stop', 'total_stops', 'rooms', 'Living', 'Kitchen']) assert.ok(!text.includes(word), body.p_kind + ' carries no ' + word);
  }
});

test('with the flag on, the one dwell carries the visit summary, the time since the last arrival added to its room', () => {
  const page = visitPage({ insights: true });
  page.beacon.opened(page.win);
  page.state.now += 50000;
  page.emit('veylet:visit', SUMMARY);
  page.state.now += 12400;
  page.leave();
  page.leave();
  assert.deepEqual(page.sent.map(body => body.p_kind), ['open', 'dwell'], 'it rides on the dwell; it adds no row');
  assert.deepEqual(plain(page.dwell()[0].p_detail), {
    visit: page.beacon.visit, seconds: 62, stops: 3, last_stop: 3, furthest_stop: 3, total_stops: 5,
    rooms: { Living: 40, Kitchen: 12, Hall: 6 },
  });
  assert.ok(JSON.stringify(page.dwell()[0].p_detail).length < 1024, 'far under the 1 KB detail limit');
});

test('with the flag on, a tab with analytics switched off sends the plain dwell, and so does a visit with no arrival', () => {
  const off = visitPage({ insights: true, analyticsOff: true });
  off.beacon.opened(off.win);
  assert.equal(off.listeners.doc['veylet:visit'], undefined);
  off.emit('veylet:visit', SUMMARY);
  off.state.now += 9000;
  off.leave();
  assert.deepEqual(plain(off.dwell()[0].p_detail), { visit: off.beacon.visit, seconds: 9 });
  const early = visitPage({ insights: true });
  early.beacon.opened(early.win);
  early.state.now += 4000;
  early.leave();
  assert.deepEqual(plain(early.dwell()[0].p_detail), { visit: early.beacon.visit, seconds: 4 });
});

test('only room types from the fixed list, and whole stop counts, ever leave the page', () => {
  const page = visitPage({ insights: true });
  page.beacon.opened(page.win);
  page.emit('veylet:visit', { stops: 2, last_stop: 2, furthest_stop: 2, total_stops: 4, room: '12 Harbour St master suite',
    seconds: { Bedroom: 20.4, 'Jane’s study': 99, Other: 5, Garage: -3, Kitchen: 'ten', toString: 1 } });
  page.state.now += 2000;
  page.leave();
  assert.deepEqual(plain(page.dwell()[0].p_detail.rooms), { Bedroom: 20, Other: 5 });
  // A malformed summary is dropped whole; the dwell's own seconds still go.
  const odd = visitPage({ insights: true });
  odd.beacon.opened(odd.win);
  odd.emit('veylet:visit', { stops: 2.5, last_stop: 1, furthest_stop: 1, total_stops: 4, seconds: {} });
  odd.state.now += 3000;
  odd.leave();
  assert.deepEqual(plain(odd.dwell()[0].p_detail), { visit: odd.beacon.visit, seconds: 3 });
});

test('the viewer pages pass the ?analytics=off tab switch; client-page.js itself still touches no storage', () => {
  for (const file of ['tour/index.html', 'embed/index.html', 'handoff/index.html']) {
    assert.match(read(file), /analyticsOff: \/\(\?:\^\|\[\?&\]\)analytics=off\(\?:&\|\$\)\/\.test\(location\.search\) \|\| \(\(\) => \{ try \{ return sessionStorage\.getItem\('veylet\.analyticsOff'\) === '1'; \} catch \{ return false; \} \}\)\(\),/, file);
  }
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|\.cookie/);
});

test('the player says one veylet:visit after every arrival, by room type and never by name (studio data-events hunk)', () => {
  assert.match(playerSource, /function roomType\(name\) \{/);
  assert.match(playerSource, /function logVisit\(index, room\) \{/);
  assert.match(playerSource, /announceActivity\('veylet:stop', \{ stop: index, room: label\.room \|\| null \}\);\n\s*announceActivity\('veylet:visit', logVisit\(index, label\.room\)\);/);
  assert.match(playerSource, /return \{ stops: visitLog\.seen\.size, last_stop: visitLog\.last, furthest_stop: visitLog\.furthest,\n\s*total_stops: manifest\.stops\.length, room: visitLog\.room, seconds \};/);
  // The player still sends nothing itself.
  const hunk = playerSource.slice(playerSource.indexOf('function roomType(name)'), playerSource.indexOf('function arrived(index)'));
  assert.doesNotMatch(hunk, /fetch|sendBeacon|XMLHttpRequest/);
  // The same fourteen types on both sides, plus Other.
  const presets = hunk.match(/const presets = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(word => word.slice(1, -1));
  const pageTypes = clientSource.match(/const ROOM_TYPES = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(word => word.slice(1, -1));
  assert.deepEqual(pageTypes, [...presets, 'Other']);
});
