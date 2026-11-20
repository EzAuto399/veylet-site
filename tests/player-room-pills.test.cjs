'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const playerSource = read('tour-player-v2.js');
const stageCss = read('tour-stage.css');

function multiRoomManifest(overrides = {}) {
  const stop = (id, room, x, z = 0) => ({
    id,
    room,
    position: [x, 0, z],
    target: [x, -0.3, z - 2],
    floor: [x, -1.4, z],
    floor_measured: true,
  });
  return {
    format: 'veylet.tour-package',
    package_format_version: 2,
    synthetic: false,
    captured_on: null,
    truth_label: 'Built only from photos and depth captured on site. Nothing generated or added. Not to scale.',
    generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [524921, 262461, 131230, 52492], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable: null,
    // Deliberately ordered differently from stops, with an unnamed room and an unused room.
    rooms: [
      { id: 'r1', name: 'Living', bounds: [4.8, 3.6] },
      { id: 'r2', name: 'Kitchen' },
      { id: 'r3', name: 'Bedroom' },
      { id: 'r4', name: null },
      { id: 'r5', name: 'Unused Study' },
    ],
    stops: [
      stop('s1', 'r3', 0),
      stop('s2', 'r1', 2),
      stop('s3', 'r4', 4),
      stop('s4', 'r3', 6),
      stop('s5', 'r2', 8),
    ],
    start_stop: 0,
    files: [],
    ...overrides,
  };
}

function chunkedMultiRoomManifest() {
  const COUNTS = [480000, 240000, 120000, 48000];
  const chunk = (n, x0, x1) => ({
    id: 'chunk_' + n,
    rooms: ['r' + n],
    adjacent: n === 2 ? ['chunk_1', 'chunk_3'] : ['chunk_2'],
    lod_meta: `lod/chunk_${n}/lod-meta.json`,
    lod_counts: COUNTS,
    bounds: { min: [x0, -1.5, -3], max: [x1, 1.5, 3] },
  });
  const stop = (id, room, x) => ({
    id,
    room,
    position: [x, 0, 0],
    target: [x, -0.3, -2],
    floor: [x, -1.4, 0],
    floor_measured: true,
  });
  return multiRoomManifest({
    scene: {
      lod_meta: 'lod/chunk_1/lod-meta.json',
      lod_levels: 4,
      lod_counts: COUNTS,
      sh_bands: 2,
      rotation_degrees: [0, 0, 180],
      background: '#10231d',
      layout: 'chunked',
      opening_chunk: 'chunk_1',
      chunks: [chunk(1, -2, 2.2), chunk(2, 1.8, 6.2), chunk(3, 5.8, 10)],
    },
    rooms: [
      { id: 'r1', name: 'Hall', adjacent: ['r2'] },
      { id: 'r2', name: 'Kitchen', adjacent: ['r1', 'r3'] },
      { id: 'r3', name: 'Bedroom', adjacent: ['r2'] },
    ],
    stops: [stop('s1', 'r1', 0), stop('s2', 'r2', 4), stop('s3', 'r3', 8)],
  });
}

function fakeEngine(log = []) {
  class Emitter {
    constructor() { this.handlers = {}; }
    on(e, f) { (this.handlers[e] ||= []).push(f); }
    fire(e, ...a) { for (const f of this.handlers[e] || []) f(...a); }
  }
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  }
  class Entity {
    constructor(name) { this.name = name; this.angles = null; }
    addComponent(type, data) {
      if (type === 'camera') {
        this.camera = {
          ...data, fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200,
          worldToScreen: (w, s) => s.set(100, 100, 1),
          screenToWorld: (x, y, depth, out) => out.set(x / 100, -depth, y / 100),
        };
      }
      if (type === 'gsplat') this.gsplat = { lodRangeMin: 0, lodRangeMax: 99 };
    }
    setPosition(...p) { this.position = p; }
    setEulerAngles(...a) { this.angles = a; log.push(['euler', ...a]); }
    setLocalEulerAngles(...a) { this.local = a; }
    destroy() {}
  }
  const engine = { apps: [] };
  class Application extends Emitter {
    constructor(canvas, { graphicsDevice }) {
      super();
      this.graphicsDevice = graphicsDevice;
      this.scene = { gsplat: {} };
      this.root = { addChild() {} };
      this.assets = { add() {}, load() {}, remove() {} };
      this.systems = { gsplat: new Emitter() };
      this.loader = { getHandler: () => ({ imgParser: {} }) };
      engine.apps.push(this);
    }
    setCanvasFillMode() {}
    setCanvasResolution() {}
    updateCanvasSize() {}
    start() {}
    destroy() {}
  }
  Object.assign(engine, {
    createGraphicsDevice: async () => ({ deviceType: 'webgl2', on() {}, maxPixelRatio: 1 }),
    Application,
    Entity,
    Asset: class extends Emitter { unload() {} },
    Vec3,
    Color: class { fromString() { return this; } },
    FILLMODE_NONE: 0,
    RESOLUTION_AUTO: 0,
  });
  return engine;
}

function load({ files = {}, size = [390, 700], href = 'https://veylet.com/handoff?t=abcdefghijklmnop', hash = '' } = {}) {
  const log = [];
  const document = createDocument({
    onImage: node => setImmediate(() => node.dispatch('load')),
    onHeadAppend: node => { if (node.tagName === 'LINK') setImmediate(() => node.onload && node.onload()); },
  });
  document.documentElement = document.createElement('html');
  const window = { matchMedia: () => ({ matches: true }), screen: { width: 390, height: 844 }, devicePixelRatio: 2 };
  const context = {
    window,
    document,
    performance,
    setTimeout,
    clearTimeout,
    setImmediate,
    URL,
    atob,
    AbortController,
    console,
    location: { href: href + hash, origin: 'https://veylet.com', hash, reload() {} },
    navigator: {},
    localStorage: { getItem: () => '1', setItem() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async url => {
      const name = url.replace('https://veylet.com/pkg/', '');
      if (!(name in files)) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[name]) };
    },
  };
  vm.runInNewContext(playerSource, context);
  const stage = document.createElement('div');
  [stage.clientWidth, stage.clientHeight] = size;
  stage.hidden = true;
  document.body.append(stage);
  return { player: window.VeyletPlayerV2, window, document, stage, log };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const desktop = { screenWidth: 1280, screenHeight: 800, dpr: 2, coarse: false, touchPoints: 0, webgl2: true, webgpu: false };
const plain = v => JSON.parse(JSON.stringify(v));

async function ready(manifest, { size = [390, 700], visit, hash = '', pageHref } = {}) {
  const harness = load({ files: { 'manifest.json': manifest }, size, hash });
  const engine = fakeEngine(harness.log);
  const pending = harness.player.start(harness.stage, {
    base: 'https://veylet.com/pkg/',
    env: desktop,
    framed: false,
    page: { href: pageHref || ('https://veylet.com/handoff' + hash), origin: 'https://veylet.com', hash },
    visit,
    loadEngine: async () => engine,
  });
  for (let i = 0; i < 12; i++) await tick();
  const app = engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;
  return { ...harness, app, controller: harness.window.VeyletPlayerV2.current };
}

test('roomsFromManifest extracts unique named rooms in stop order and drops unnamed/unused rooms', () => {
  const { player } = load();
  assert.equal(typeof player.roomsFromManifest, 'function');
  const rooms = plain(player.roomsFromManifest(player.validateManifest(multiRoomManifest())));
  assert.deepEqual(rooms, [
    { id: 'r3', name: 'Bedroom', firstStop: 0 },
    { id: 'r1', name: 'Living', firstStop: 1 },
    { id: 'r2', name: 'Kitchen', firstStop: 4 },
  ]);

  // Raw stops with stop.room / stop.label / stop.title also work in stop order.
  const rawRooms = plain(player.roomsFromManifest({
    stops: [
      { room: 'Entry' },
      { label: 'Living' },
      { room: 'entry' },
      { title: 'Kitchen' },
      { label: '  ' },
    ],
  }));
  assert.deepEqual(rawRooms, [
    { id: 'Entry', name: 'Entry', firstStop: 0 },
    { id: 'Living', name: 'Living', firstStop: 1 },
    { id: 'Kitchen', name: 'Kitchen', firstStop: 3 },
  ]);

  // Fewer than 2 distinct named rooms (one named + one null, or duplicate names).
  const oneNamed = player.roomsFromManifest(player.validateManifest(multiRoomManifest({
    rooms: [{ id: 'r1', name: 'Living' }, { id: 'r2', name: null }],
    stops: multiRoomManifest().stops.slice(0, 2).map((s, i) => ({ ...s, room: i === 0 ? 'r1' : 'r2' })),
  })));
  assert.equal(oneNamed.length, 1);
});

test('room-jump pill bar renders <nav class="v2-rooms" aria-label="Rooms">, jumps to first stop, tracks active & visited rooms', async () => {
  const x = await ready(multiRoomManifest());
  const nav = x.stage.querySelector('nav.v2-rooms');
  assert.ok(nav, 'renders <nav class="v2-rooms">');
  assert.equal(nav.getAttribute('aria-label'), 'Rooms');
  assert.equal(nav.hidden, false);
  assert.equal(x.stage.querySelector('.v2-room-pills'), nav, 'keeps .v2-room-pills selector compatibility');

  const pills = nav.querySelectorAll('button.v2-room-pill');
  assert.deepEqual(pills.map(p => [p.getAttribute('type'), p.textContent]), [
    ['button', 'Bedroom'],
    ['button', 'Living'],
    ['button', 'Kitchen'],
  ]);

  // Initial room (Bedroom) is active and visited; others are neither.
  assert.deepEqual(pills.map(p => p.getAttribute('aria-current')), ['true', null, null]);
  assert.deepEqual(pills.map(p => p.dataset.visited ?? null), ['true', null, null]);

  // Jump to Kitchen (first stop is index 4 => Stop 5 of 5).
  pills[2].click();
  assert.equal(x.stage.querySelector('.v2-stop').textContent, 'Stop 5 of 5');
  assert.equal(x.stage.querySelector('.v2-room').textContent, 'Kitchen');
  assert.deepEqual(pills.map(p => p.getAttribute('aria-current')), [null, null, 'true']);
  assert.deepEqual(pills.map(p => p.dataset.visited ?? null), ['true', null, 'true']);

  // Jump to Living (first stop is index 1 => Stop 2 of 5).
  pills[1].click();
  assert.equal(x.stage.querySelector('.v2-stop').textContent, 'Stop 2 of 5');
  assert.deepEqual(pills.map(p => p.getAttribute('aria-current')), [null, 'true', null]);
  assert.deepEqual(pills.map(p => p.dataset.visited ?? null), ['true', 'true', 'true']);
});

test('room-jump pill bar hides when < 2 distinct named rooms exist or frame is compact (<= 300px height)', async () => {
  const singleNamed = multiRoomManifest({
    rooms: [{ id: 'r1', name: 'Living' }, { id: 'r2', name: null }],
    stops: multiRoomManifest().stops.slice(0, 2).map((s, i) => ({ ...s, room: i === 0 ? 'r1' : 'r2' })),
  });
  const x1 = await ready(singleNamed);
  const nav1 = x1.stage.querySelector('.v2-rooms');
  assert.equal(nav1.hidden, true);
  assert.equal(nav1.querySelectorAll('.v2-room-pill').length, 0);

  const compact = await ready(multiRoomManifest(), { size: [390, 280] });
  const navCompact = compact.stage.querySelector('.v2-rooms');
  assert.equal(navCompact.hidden, true, 'hidden in compact frame <= 300px');

  // Entering fullscreen reveals the room bar again on a compact stage.
  compact.stage.querySelector('.v2-fullscreen').click();
  assert.equal(navCompact.hidden, false);
});

test('tour-stage.css styles .v2-rooms with docked bar layout, 300px compact hide, 0.78 ink, hidden scrollbars, 44px targets, and mint active state', () => {
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s*\{[^}]*flex:\s*1 1 100%/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s*\{[^}]*min-height:\s*44px/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s*\{[^}]*scrollbar-width:\s*none/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms::-webkit-scrollbar\s*\{\s*display:\s*none;/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s+\.v2-room-pill\s*\{[^}]*min-height:\s*44px/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s+\.v2-room-pill\s*\{[^}]*background:\s*rgba\(16,\s*35,\s*29,\s*0\.78\)/);
  assert.match(stageCss, /\.v2-stage\s+\.v2-rooms\s+\.v2-room-pill\[aria-current="true"\]\s*\{[^}]*background:\s*#c6dcc9/);
  assert.match(stageCss, /@media\s*\(max-height:\s*300px\)\s*\{[^}]*\.v2-rooms\s*\{\s*display:\s*none;/);
});

test('parseViewHash parses #stop=N&yaw=D&pitch=P, clamps yaw (-180..360) and pitch (-60..60), and preserves bare #stop=N', () => {
  const { player } = load();
  assert.equal(typeof player.parseViewHash, 'function');
  assert.deepEqual(plain(player.parseViewHash('#stop=3')), { stop: 3, yaw: null, pitch: null });
  assert.deepEqual(plain(player.parseViewHash('#stop=2&yaw=135&pitch=-20')), { stop: 2, yaw: 135, pitch: -20 });
  assert.deepEqual(plain(player.parseViewHash('#stop=2&yaw=-45.5&pitch=12.5')), { stop: 2, yaw: -45.5, pitch: 12.5 });
  assert.deepEqual(plain(player.parseViewHash('#stop=2&yaw=450&pitch=85')), { stop: 2, yaw: 360, pitch: 60 });
  assert.deepEqual(plain(player.parseViewHash('#stop=2&yaw=-270&pitch=-85')), { stop: 2, yaw: -180, pitch: -60 });
  assert.deepEqual(plain(player.parseViewHash('#yaw=90')), { stop: null, yaw: 90, pitch: null });

  for (const invalid of ['', '#', '#stop=0', '#stop=-1', '#stop=abc', '#stop=123', '#room=2']) {
    assert.equal(player.parseViewHash(invalid), null, invalid);
  }
  assert.deepEqual(plain(player.parseViewHash('#stop=2&yaw=NaN&pitch=')), { stop: 2, yaw: null, pitch: null });
});

test('deep link #stop=N&yaw=D&pitch=P and visit.startAt objects wire initial camera orientation and expose currentView()', async () => {
  // Hash deep link even when visit.startAt is null (as client-page.js passes for extended hashes).
  const byHash = await ready(multiRoomManifest(), {
    hash: '#stop=5&yaw=135&pitch=-20',
    visit: { startAt: null },
  });
  assert.equal(byHash.stage.querySelector('.v2-stop').textContent, 'Stop 5 of 5');
  assert.equal(byHash.stage.querySelector('.v2-room').textContent, 'Kitchen');
  assert.deepEqual(plain(byHash.controller.currentView()), { stop: 5, count: 5, yaw: 135, pitch: -20 });
  assert.deepEqual(plain(byHash.player.currentView()), { stop: 5, count: 5, yaw: 135, pitch: -20 });
  const pills = byHash.stage.querySelectorAll('.v2-room-pill');
  assert.deepEqual(pills.map(p => p.getAttribute('aria-current')), [null, null, 'true']);
  assert.deepEqual(pills.map(p => p.dataset.visited ?? null), [null, null, 'true']);

  // Turning camera updates currentView(); jumping to another stop resets to stop target lookAngles.
  byHash.stage.querySelector('.v2-canvas').dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(byHash.controller.currentView().yaw, 145);
  byHash.stage.querySelector('.v2-prev').click();
  assert.equal(byHash.controller.currentView().stop, 4);
  assert.equal(byHash.controller.currentView().yaw, 0);

  // Object visit.startAt clamps out-of-range yaw/pitch and normalizes negative yaw cleanly.
  const byObj = await ready(multiRoomManifest(), {
    visit: { startAt: { stop: 2, yaw: -45, pitch: 80 } },
  });
  assert.equal(byObj.stage.querySelector('.v2-stop').textContent, 'Stop 2 of 5');
  assert.deepEqual(plain(byObj.controller.currentView()), { stop: 2, count: 5, yaw: 315, pitch: 60 });

  // Chunked tour also preserves deep-link stop and orientation on initial arrival.
  const chunked = await ready(chunkedMultiRoomManifest(), {
    hash: '#stop=3&yaw=225&pitch=-30',
    visit: { startAt: null },
  });
  assert.equal(chunked.stage.querySelector('.v2-stop').textContent, 'Stop 3 of 3');
  assert.equal(chunked.stage.querySelector('.v2-room').textContent, 'Bedroom');
  assert.deepEqual(plain(chunked.controller.currentView()), { stop: 3, count: 3, yaw: 225, pitch: -30 });
  const chunkPills = chunked.stage.querySelectorAll('.v2-room-pill');
  assert.deepEqual(chunkPills.map(p => p.dataset.visited ?? null), [null, null, 'true']);
});
