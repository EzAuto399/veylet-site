const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const playerSource = read('tour-player-v2.js');

// The package shape package_tour.mjs --format v2 writes (numbers from the owner's practice room).
function manifest(overrides = {}) {
  const stop = (id, x, z) => ({ id, room: 'r1', position: [x, 0, z], target: [x, -0.3, z - 2], floor: [x, -1.4, z], floor_measured: true });
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: false, captured_on: null,
    truth_label: 'Built only from photos and depth captured on site. Nothing generated or added. Colours balanced; areas the camera didn’t see may look blurred. Not to scale.',
    generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [524921, 262461, 131230, 52492], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable: null,
    rooms: [{ id: 'r1', name: 'Living area' }],
    stops: [stop('s1', 0, 0), stop('s2', 1, 0), stop('s3', 2, 0), stop('s4', 3, 0), stop('s5', 4, 0)],
    start_stop: 0,
    files: [],
    ...overrides,
  };
}

function fakeEngine(log, { deviceType = 'webgl2' } = {}) {
  class Emitter { constructor() { this.handlers = {}; } on(e, f) { (this.handlers[e] ||= []).push(f); } fire(e, ...a) { for (const f of this.handlers[e] || []) f(...a); } }
  class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  class Entity {
    constructor(name) { this.name = name; }
    addComponent(type, data) {
      // screenToWorld: a tap at (x, y) looks straight down at the floor point (x / 100, y / 100).
      if (type === 'camera') this.camera = { ...data, fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200, worldToScreen: (w, s) => s.set(100, 100, 1),
        screenToWorld: (x, y, depth, out) => out.set(x / 100, -depth, y / 100) };
      if (type === 'gsplat') {
        this.gsplat = new Proxy({ lodRangeMin: 0, lodRangeMax: 99 }, { set(t, k, v) { t[k] = v; log.push(`gsplat.${String(k)}=${v}`); return true; } });
        log.push('gsplat:' + data.asset.file.url);
      }
    }
    setPosition(...p) { this.position = p; } setEulerAngles(...a) { this.angles = a; } setLocalEulerAngles(...a) { this.local = a; }
    destroy() { log.push('destroy:' + this.name); }
  }
  class Asset extends Emitter { constructor(name, type, file) { super(); this.file = file; } unload() {} }
  const engine = { apps: [] };
  class Application extends Emitter {
    constructor(canvas, { graphicsDevice }) {
      super();
      this.graphicsDevice = graphicsDevice; this.scene = { gsplat: {} }; this.root = { addChild() {} };
      this.assets = { add: () => {}, load: () => log.push('asset.load'), remove: () => {} };
      this.systems = { gsplat: new Emitter() }; this.loader = { getHandler: () => ({ imgParser: {} }) };
      engine.apps.push(this);
    }
    setCanvasFillMode() {} setCanvasResolution() {} updateCanvasSize() {} start() { log.push('app.start'); } destroy() { log.push('app.destroy'); }
  }
  Object.assign(engine, {
    createGraphicsDevice: async () => (deviceType ? { deviceType, on() {}, maxPixelRatio: 1 } : null),
    Application, Entity, Asset, Vec3, Color: class { fromString() { return this; } }, FILLMODE_NONE: 0, RESOLUTION_AUTO: 0,
  });
  return engine;
}

function load({ files = {}, reduced = true, context: extra = {}, size = [390, 700] } = {}) {
  const log = [];
  const document = createDocument({
    onImage: node => { log.push('img:' + node.src); setImmediate(() => node.dispatch('load')); },
    onHeadAppend: node => { if (node.tagName === 'LINK') setImmediate(() => node.onload && node.onload()); },
  });
  const storage = new Map();
  const window = {
    matchMedia: () => ({ matches: reduced }), screen: { width: 390, height: 844 }, devicePixelRatio: 3,
  };
  const fetch = async url => {
    log.push('fetch:' + url);
    const name = url.replace('https://veylet.com/pkg/', '');
    if (!(name in files)) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[name]) };
  };
  const context = {
    window, document, fetch, performance, setTimeout, clearTimeout, setImmediate, URL, atob, AbortController, console,
    location: { href: 'https://veylet.com/handoff?t=abcdefghijklmnop', origin: 'https://veylet.com', reload() { log.push('reload'); } },
    navigator: {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    ResizeObserver: class { observe() {} disconnect() {} },
    ...extra,
  };
  vm.runInNewContext(playerSource, context);
  const stage = document.createElement('div');
  [stage.clientWidth, stage.clientHeight] = size; stage.hidden = true;
  document.body.append(stage);
  return { player: window.VeyletPlayerV2, window, document, stage, log };
}
const phoneWebgl2 = { screenWidth: 390, screenHeight: 844, dpr: 3, coarse: true, touchPoints: 5, webgl2: true, webgpu: false };
const tick = () => new Promise(resolve => setImmediate(resolve));
const byClass = (root, name) => root.querySelector('.' + name);

// ---------- pure rules ----------

test('packages load only from this origin or the tour host, as a folder without a query', () => {
  const { player } = load();
  const page = { href: 'https://veylet.com/handoff?t=x', origin: 'https://veylet.com' };
  assert.equal(player.resolveBase('/__qa/v2', page), 'https://veylet.com/__qa/v2/');
  assert.equal(player.resolveBase('https://tours.veylet.com/t/abc/r1/', page), 'https://tours.veylet.com/t/abc/r1/');
  for (const bad of ['https://evil.invalid/pkg/', 'http://tours.veylet.com/t/abc/', 'https://tours.veylet.com/t/abc/?token=1', 'javascript:alert(1)', '', null]) {
    assert.throws(() => player.resolveBase(bad, page), /package-location-invalid/, String(bad));
  }
});

test('only the v2 package shape is accepted; v1 exports and unsafe paths are refused', () => {
  const { player } = load();
  const ok = player.validateManifest(manifest());
  assert.equal(ok.stops.length, 5);
  assert.deepEqual(ok.scene.counts, [524921, 262461, 131230, 52492]);
  assert.equal(ok.posters.portrait.fov, 90);
  const v1 = { format: 'veylet.tour-export.v1', files: [{ path: 'tour.html' }] };
  assert.throws(() => player.validateManifest(v1), /manifest-invalid:format/);
  assert.throws(() => player.validateManifest(manifest({ package_format_version: 1 })), /version/);
  assert.throws(() => player.validateManifest(manifest({ scene: { ...manifest().scene, lod_meta: '../lod-meta.json' } })), /scene/);
  assert.throws(() => player.validateManifest(manifest({ poster: { ...manifest().poster, landscape: { path: '/etc/x.webp', width: 1600, height: 900 } } })), /poster/);
  assert.throws(() => player.validateManifest(manifest({ stops: [{ ...manifest().stops[0], room: 'r9' }] })), /stop/);
  assert.throws(() => player.validateManifest(manifest({ scene: { ...manifest().scene, lod_counts: [1, 2, 3, 4] } })), /lod_counts/);
});

test('splat budgets follow the device class, and one detail level is chosen to fit', () => {
  const { player } = load();
  const phone = player.deviceProfile(phoneWebgl2);
  assert.deepEqual([phone.kind, phone.api, phone.budget, phone.maxPixelRatio], ['phone', 'webgl2', 500_000, 1.5]);
  // A WebGPU phone stays one level down (the WebGL2 budget) unless it reports high-end hardware on Wi-Fi.
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgpu: true }).budget, 500_000);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgpu: true, memory: 8, cores: 8 }).budget, 500_000); // on mobile data
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgpu: true, memory: 8, cores: 8, connectionType: 'wifi' }).budget, 1_000_000);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgpu: true, memory: 6, cores: 8, connectionType: 'wifi' }).budget, 500_000);
  assert.equal(player.deviceProfile({ screenWidth: 1920, screenHeight: 1080, dpr: 2, webgl2: true, webgpu: true, memory: 4, cores: 4 }).budget, 3_000_000);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, saveData: true }).saveData, true);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, memory: 3 }).budget, 350_000);
  const desktop = player.deviceProfile({ screenWidth: 1920, screenHeight: 1080, dpr: 2, webgl2: true, webgpu: true });
  assert.deepEqual([desktop.kind, desktop.budget, desktop.maxPixelRatio], ['desktop', 3_000_000, 2]);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgl2: false }).api, null);
  const counts = [524921, 262461, 131230, 52492];
  assert.equal(player.detailLevel(counts, 3_000_000), 0);
  assert.equal(player.detailLevel(counts, 500_000), 1);
  assert.equal(player.detailLevel(counts, 150_000), 2);
  assert.equal(player.detailLevel(counts, 10_000), 3);
  assert.equal(player.detailLevel(counts, 3_000_000, true), 3); // Save-Data: the coarsest level only
});

test('a slow device gives back pixels first, then splats; a fast one earns detail back', () => {
  const { player } = load();
  const governor = player.createGovernor({ budget: 500_000, maxBudget: 500_000, minBudget: 150_000, maxPixelRatio: 1.5, minPixelRatio: 1 });
  let now = 10_000;
  const run = (ms, seconds) => { const changes = []; for (const end = now + seconds * 1000; now < end;) { now += ms; const change = governor.sample(ms, now); if (change) changes.push({ ...change, now }); } return changes; };
  const slow = run(50, 12); // 20 fps for 12 s
  assert.deepEqual(slow.slice(0, 3).map(change => change.pixelRatio ?? change.budget), [1.2, 1, 375_000]);
  assert.ok(slow.every((change, i) => i === 0 || change.now - slow[i - 1].now >= 2000), 'changes are at least 2 s apart');
  assert.equal(governor.state.budget >= 150_000, true);
  const fast = run(10, 30); // then 100 fps
  assert.ok(fast.some(change => change.budget > 0));
  assert.ok(fast.some(change => change.pixelRatio > 1));
  assert.equal(governor.state.budget, 500_000); // back to the device's ceiling, never above it
  // A very slow device is helped after 1.5 s of frames, not after 45 frames.
  const struggling = player.createGovernor({ budget: 500_000, maxBudget: 500_000, minBudget: 150_000, maxPixelRatio: 1.5, minPixelRatio: 1 });
  let change = null;
  for (let t = 1000; t <= 3000 && !change; t += 400) change = struggling.sample(400, t);
  assert.equal(change?.pixelRatio, 1.2); // 2.5 fps: helped after five frames, not forty-five
});

// ---------- the player in a stand-in page ----------

async function started(options = {}) {
  const harness = load({ files: { 'manifest.json': options.manifest || manifest(), ...options.files }, reduced: options.reduced ?? true, context: options.context, size: options.size });
  const engine = fakeEngine(harness.log, options.engine);
  let engineRequested = 0;
  const pending = harness.player.start(harness.stage, {
    base: 'https://veylet.com/pkg/', env: options.env || phoneWebgl2, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' },
    loadEngine: () => { engineRequested++; harness.log.push('engine:import'); return options.slowEngine ? new Promise(() => {}) : options.noEngine ? Promise.reject(new Error('offline')) : Promise.resolve(engine); },
    onVisible: () => harness.log.push('visible'), onRetry: () => harness.log.push('retry'),
    ...options.startOptions,
  });
  pending.catch(() => {}); // a test may expect the rejection; it must not be unhandled meanwhile
  for (let i = 0; i < 12; i++) await tick();
  return { ...harness, engine, pending, requested: () => engineRequested };
}

test('progressive load: poster first, then the coarsest level alone, then the level that fits', async () => {
  const x = await started();
  const order = x.log.filter(line => /^(fetch|img|visible|gsplat|asset|app|engine)/.test(line));
  const at = prefix => order.findIndex(line => line.startsWith(prefix));
  assert.ok(at('fetch:https://veylet.com/pkg/manifest.json') >= 0);
  assert.ok(at('img:https://veylet.com/pkg/preview.webp') < at('img:https://veylet.com/pkg/poster-portrait.webp'), 'preview before poster');
  assert.ok(at('visible') > at('img:https://veylet.com/pkg/preview.webp'));
  assert.ok(at('img:https://veylet.com/pkg/poster-portrait.webp') < at('gsplat:'), 'poster before any 3D');
  assert.ok(order.includes('gsplat.lodRangeMin=3') && order.includes('gsplat.lodRangeMax=3'), 'first pass is the coarsest level only');
  assert.ok(at('gsplat.lodRangeMin=3') < at('asset.load'));
  assert.equal(x.stage.hidden, false);
  const app = x.engine.apps[0];
  assert.equal(app.scene.gsplat.splatBudget, 500_000);
  const root = byClass(x.stage, 'v2');
  assert.equal(root.dataset.state, 'opening');
  // The coarse level loads, then settles.
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  assert.equal(root.dataset.state, 'opening');
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  const outcome = await x.pending;
  assert.equal(outcome.readiness, 'viewer-ready');
  assert.equal(root.dataset.state, 'ready');
  assert.ok(outcome.marks.poster <= outcome.marks['first-3d']);
  // Then detail streams: level 1 fits a 0.5M budget whole (262K splats).
  assert.equal(x.log.at(-1), 'gsplat.lodRangeMin=1');
  assert.equal(byClass(x.stage, 'v2-status').textContent, 'Sharpening detail…');
  app.systems.gsplat.fire('frame:ready', null, null, false, 2);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  assert.equal(x.window.VeyletPlayerV2.current.stats().phase, 'complete');
  assert.equal(byClass(x.stage, 'v2-status').textContent, '');
});

test('stops: next, previous, number keys and the room list, announced politely', async () => {
  const x = await started();
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  const stopLine = () => byClass(x.stage, 'v2-stop').textContent;
  assert.equal(stopLine(), 'Stop 1 of 5');
  assert.equal(byClass(x.stage, 'v2-room').textContent, 'Living area');
  byClass(x.stage, 'v2-next').click();
  assert.equal(stopLine(), 'Stop 2 of 5'); // reduced motion: a cut, not a flight
  assert.equal(byClass(x.stage, 'v2-sr').textContent, 'Living area, Stop 2 of 5');
  const canvas = byClass(x.stage, 'v2-canvas');
  canvas.dispatch('keydown', { key: 'p' });
  assert.equal(stopLine(), 'Stop 1 of 5');
  canvas.dispatch('keydown', { key: '4' });
  assert.equal(stopLine(), 'Stop 4 of 5');
  byClass(x.stage, 'v2-prev').click();
  assert.equal(stopLine(), 'Stop 3 of 5');
  byClass(x.stage, 'v2-next').click(); byClass(x.stage, 'v2-next').click(); byClass(x.stage, 'v2-next').click();
  assert.equal(stopLine(), 'Stop 1 of 5'); // wraps after the last stop
  const toggle = byClass(x.stage, 'v2-stops-toggle');
  toggle.click();
  const panel = byClass(x.stage, 'v2-stops');
  assert.equal(panel.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.querySelector('h3').textContent, 'Living area');
  assert.deepEqual(panel.querySelectorAll('.v2-stop-button').map(b => b.textContent), ['Stop 1', 'Stop 2', 'Stop 3', 'Stop 4', 'Stop 5']);
  assert.equal(x.document.activeElement.textContent, 'Stop 1'); // focus lands on the current stop
  panel.querySelectorAll('.v2-stop-button')[4].click();
  assert.equal(stopLine(), 'Stop 5 of 5');
  assert.equal(panel.hidden, true);
  // The map toggles and the About panel carries the full truth label.
  const map = byClass(x.stage, 'v2-map');
  const before = map.hidden;
  byClass(x.stage, 'v2-map-toggle').click();
  assert.equal(map.hidden, !before);
  byClass(x.stage, 'v2-about-toggle').click();
  assert.match(byClass(x.stage, 'v2-about').textContent, /Nothing generated or added\./);
  assert.match(byClass(x.stage, 'v2-truth').textContent, /Captured on site · not to scale/);
});

test('no WebGL2 or WebGPU: no engine download, the rendered poster stays, and the page says why', async () => {
  const x = await started({ env: { ...phoneWebgl2, webgl2: false, webgpu: false } });
  const outcome = await x.pending;
  assert.equal(x.requested(), 0);
  assert.deepEqual([outcome.readiness, outcome.reason], ['viewer-failed', 'no-graphics']);
  const root = byClass(x.stage, 'v2');
  assert.equal(root.dataset.state, 'fallback');
  assert.equal(byClass(x.stage, 'v2-fallback').hidden, false);
  assert.match(byClass(x.stage, 'v2-fallback').textContent, /3D can’t open in this browser\.This picture is from the walkthrough\. Try opening this link in Safari or Chrome\./);
  assert.equal(byClass(x.stage, 'v2-bar').hidden, true);
  assert.equal(byClass(x.stage, 'v2-poster').src, 'https://veylet.com/pkg/poster-portrait.webp');
  assert.equal(x.stage.hidden, false);
});

test('an engine that does not arrive offers Try again; a missing device is treated as no graphics', async () => {
  const offline = await started({ noEngine: true });
  const outcome = await offline.pending;
  assert.equal(outcome.reason, 'engine-unavailable');
  const retry = byClass(offline.stage, 'v2-fallback').querySelector('button');
  retry.click();
  assert.equal(offline.log.at(-1), 'retry');
  const nodevice = await started({ engine: { deviceType: null } });
  assert.equal((await nodevice.pending).reason, 'no-graphics');
});

test('a version 1 export, or a missing package, never starts the v2 player', async () => {
  const v1 = await started({ manifest: { format: 'veylet.tour-export.v1', files: [] } });
  await assert.rejects(v1.pending, /manifest-invalid/);
  assert.equal(v1.engine.apps.length, 0);
  const missing = load({ files: {} });
  await assert.rejects(missing.player.start(missing.stage, { base: 'https://veylet.com/pkg/', env: phoneWebgl2, page: { href: 'https://veylet.com/', origin: 'https://veylet.com' }, loadEngine: async () => null }), /package-unavailable/);
});

// ---------- the surfaces route by package version ----------

function surfaceHarness() {
  const calls = [];
  const window = {
    VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public-test-key' },
    supabase: { createClient: () => ({ storage: { from: () => ({ download: async () => { calls.push('storage.download'); return { data: { size: 1 } }; } }) } }) },
    addEventListener() {}, removeEventListener() {},
  };
  const document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: () => ({ set src(value) { calls.push('script:' + value); setImmediate(() => { window.VeyletPlayerV2 = { start: async (stage, options) => { calls.push('v2.start:' + options.base); options.onVisible(); return { readiness: 'viewer-ready' }; } }; this.onload(); }); } }),
    head: { append() {} } };
  vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} } });
  return { player: window.VeyletPlayer, calls, window };
}

test('v1 packages keep the ZIP path; v2 packages load the streamed player into the stage', async () => {
  const v2 = surfaceHarness();
  const stage = { hidden: true };
  const els = { title: {}, body: {}, status: {}, frame: { hidden: true }, stage };
  await v2.player.boot({ els, resolve: async () => ({ storagePath: 'x/manifest.json', packageFormatVersion: 2, packageBaseUrl: 'https://tours.veylet.com/t/abc/', title: 'Space', footer: 'Private link.' }) });
  assert.ok(v2.calls.some(call => /^script:\/tour-player-v2\.js\?v=[a-f0-9]{16}$/.test(call)), v2.calls.join());
  assert.ok(v2.calls.includes('v2.start:https://tours.veylet.com/t/abc/'));
  assert.equal(v2.calls.includes('storage.download'), false);
  assert.equal(els.status.textContent, 'Private link.');
  const v1 = surfaceHarness();
  v1.window.JSZip = { loadAsync: () => new Promise(() => {}) };
  const frame = { hidden: true };
  v1.player.boot({ els: { title: {}, body: {}, status: {}, frame, stage: { hidden: true } }, resolve: async () => ({ storagePath: 'x/package.zip', title: 'Space' }) });
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(v1.calls.includes('storage.download'));
  assert.equal(v1.calls.some(call => call.includes('tour-player-v2')), false);
});

test('pages pass the share row’s version and package location to the player', () => {
  for (const page of ['embed/index.html', 'handoff/index.html']) {
    const markup = read(page);
    assert.match(markup, /packageFormatVersion: row\.package_format_version === 2 \? 2 : 1/, page);
    assert.match(markup, /packageBaseUrl: row\.package_base_url \|\| null/, page);
    assert.match(markup, /<div id="tour-stage"[^>]*hidden><\/div>/, page);
  }
  const play = read('play/index.html');
  assert.match(play, /get_tour_package_base/);
  assert.match(play, /<div id="tour-stage"[^>]*hidden><\/div>/);
  // No player or engine code is loaded eagerly by the listing embed.
  assert.doesNotMatch(read('embed/index.html'), /<script src="\/(vendor\/playcanvas|tour-player-v2)/);
});

// ---------- tap to walk, full screen, frames and Save-Data (review round 2) ----------

// A 4 x 3 m room (0.1 m cells) with a 1 m sofa block in the middle: open floor round it.
function room() {
  const columns = 40, rows = 30, bits = new Uint8Array(Math.ceil(columns * rows / 8));
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const sofa = c >= 15 && c < 25 && r >= 10 && r < 20;
    if (!sofa) bits[(r * columns + c) >> 3] |= 1 << ((r * columns + c) & 7);
  }
  return { version: 1, cell_metres: 0.1, origin: [0, 0], columns, rows, floor_y: -1.4, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
}

test('without the Fullscreen API (iPhone Safari) Full screen fills the window, and Escape restores the page', async () => {
  const x = await started();
  x.document.documentElement = x.document.createElement('html');
  x.document.documentElement.style.overflow = '';
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  const full = byClass(x.stage, 'v2-fullscreen');
  assert.ok(full, 'a Full screen control');
  assert.equal(full.getAttribute('aria-label'), 'Full screen');
  assert.equal(full.hidden, false);
  assert.equal(byClass(x.stage, 'v2-full'), null, 'not the class the stylesheet hides at 330 px');
  full.click();
  assert.equal(x.stage.style.position, 'fixed');
  assert.equal(x.document.documentElement.style.overflow, 'hidden');
  assert.equal(full.getAttribute('aria-label'), 'Exit full screen');
  for (const listener of x.document.listeners.get('keydown') || []) listener({ key: 'Escape', preventDefault() {} });
  assert.equal(full.getAttribute('aria-label'), 'Full screen');
  assert.equal(x.document.documentElement.style.overflow, '');
});

test('a frame under 288 px keeps Full screen and drops the map toggle instead', async () => {
  const narrow = load({ files: { 'manifest.json': manifest() } });
  narrow.stage.clientWidth = 280;
  const engine = fakeEngine(narrow.log);
  const pending = narrow.player.start(narrow.stage, { base: 'https://veylet.com/pkg/', env: phoneWebgl2, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  for (let i = 0; i < 31; i++) engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;
  assert.equal(byClass(narrow.stage, 'v2-fullscreen').hidden, false);
  assert.equal(byClass(narrow.stage, 'v2-map-toggle').hidden, true);
  // A 320, 360 or 375 px phone (stage 288 to 343 px wide) keeps both.
  const phone = await readyPlayer({ size: [288, 300] });
  assert.equal(byClass(phone.stage, 'v2-fullscreen').hidden, false);
  assert.equal(byClass(phone.stage, 'v2-map-toggle').hidden, false);
});

test('in someone else’s page the map starts closed and a pinch zooms only after the visitor uses the player', async () => {
  const wide = { ...phoneWebgl2, screenWidth: 1920, screenHeight: 1080, coarse: false, touchPoints: 0 };
  const framedRun = load({ files: { 'manifest.json': manifest() } });
  framedRun.stage.clientWidth = 1000;
  const engine = fakeEngine(framedRun.log);
  const pending = framedRun.player.start(framedRun.stage, { base: 'https://veylet.com/pkg/', env: wide, framed: true, page: { href: 'https://veylet.com/tour', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  for (let i = 0; i < 30; i++) engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;
  assert.equal(byClass(framedRun.stage, 'v2-map').hidden, true);
  const canvas = byClass(framedRun.stage, 'v2-canvas');
  const before = canvas.dispatch('wheel', { ctrlKey: true, deltaY: -10 });
  assert.equal(Boolean(before.defaultPrevented), false, 'the page keeps the gesture');
  canvas.dispatch('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 });
  canvas.dispatch('pointercancel', { pointerId: 1 });
  const after = canvas.dispatch('wheel', { ctrlKey: true, deltaY: -10 });
  assert.equal(after.defaultPrevented, true);
  // Not framed, the same wide stage opens with the map.
  const ownRun = load({ files: { 'manifest.json': manifest() } });
  ownRun.stage.clientWidth = 1000;
  const engine2 = fakeEngine(ownRun.log);
  const pending2 = ownRun.player.start(ownRun.stage, { base: 'https://veylet.com/pkg/', env: wide, framed: false, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine2 });
  for (let i = 0; i < 12; i++) await tick();
  for (let i = 0; i < 31; i++) engine2.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending2;
  assert.equal(byClass(ownRun.stage, 'v2-map').hidden, false);
});

test('waitForTap: poster and Explore first; no engine or scene until the press', async () => {
  const x = await started({ startOptions: { waitForTap: true } });
  const outcome = await x.pending;
  assert.equal(outcome.readiness, 'waiting-for-tap');
  assert.equal(x.requested(), 0);
  assert.equal(x.log.includes('asset.load'), false);
  assert.ok(x.log.includes('img:https://veylet.com/pkg/poster-portrait.webp'));
  assert.equal(x.stage.hidden, false);
  const invite = byClass(x.stage, 'v2-fallback');
  assert.equal(invite.hidden, false);
  assert.match(invite.textContent, /Explore this property in 3D\./);
  invite.querySelector('button').click();
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(x.requested(), 1);
  assert.ok(x.log.includes('asset.load'));
  assert.equal(invite.hidden, true);
});

test('Save-Data: the coarsest level stays, with no automatic upgrade, until the visitor asks', async () => {
  const x = await started({ env: { ...phoneWebgl2, saveData: true } });
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  assert.equal(x.log.at(-1), 'gsplat.lodRangeMin=3');
  assert.equal(byClass(x.stage, 'v2-status').textContent, '');
  const more = byClass(x.stage, 'v2-about').querySelectorAll('button').find(b => b.textContent === 'Load full detail');
  assert.ok(more, 'About offers full detail');
  more.click();
  assert.ok(x.log.includes('gsplat.lodRangeMin=1'));
  assert.equal(byClass(x.stage, 'v2-status').textContent, 'Sharpening detail…');
});

test('the page glue asks for Explore first only when framed and not yet pressed', async () => {
  for (const [top, active, expected] of [['other', false, true], ['other', true, false], ['self', false, false]]) {
    const calls = [];
    const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'k' }, supabase: { createClient: () => ({}) }, addEventListener() {}, removeEventListener() {},
      VeyletPlayerV2: { start: async (stage, options) => { calls.push(options.waitForTap); return { readiness: 'viewer-ready' }; } } };
    window.self = window; window.top = top === 'self' ? window : {};
    const document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, head: { append() {} } };
    vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true, userActivation: { hasBeenActive: active } }, location: { reload() {} } });
    await window.VeyletPlayer.boot({ els: { title: {}, body: {}, status: {}, frame: { hidden: true }, stage: { hidden: true } }, resolve: async () => ({ packageFormatVersion: 2, packageBaseUrl: 'https://tours.veylet.com/t/a/', title: 'S' }) });
    assert.deepEqual(calls, [expected], `${top} ${active}`);
  }
});

test('a research sample says so: research_sample is read only when exactly true', () => {
  const { player } = load();
  assert.equal(player.validateManifest(manifest()).researchSample, false);
  assert.equal(player.validateManifest(manifest({ research_sample: true })).researchSample, true);
  assert.equal(player.validateManifest(manifest({ research_sample: 'yes' })).researchSample, false);
  assert.match(playerSource, /'Research sample · not a Veylet capture · not to scale'/);
});

// ---------- Astra round 2: simulated fullscreen (F08) ----------

function documentEvent(document, type, values = {}) {
  const event = { type, preventDefault() { this.defaultPrevented = true; }, ...values };
  for (const listener of document.listeners.get(type) || []) listener(event);
  return event;
}

function surroundingPage(x) {
  const document = x.document;
  document.documentElement = document.createElement('html');
  document.documentElement.append(document.body);
  document.documentElement.style.overflow = 'scroll';
  const header = document.createElement('header');
  const outside = document.createElement('button');
  header.append(outside);
  const main = document.createElement('main');
  const adjacent = document.createElement('button');
  const footer = document.createElement('footer');
  footer.setAttribute('inert', 'inert');
  footer.setAttribute('aria-hidden', 'false');
  main.append(x.stage, adjacent);
  document.body.append(header, main, footer);
  return { header, outside, main, adjacent, footer };
}

test('F08: simulated fullscreen isolates ancestor siblings, wraps Tab both ways and restores exact prior state', async () => {
  const x = await readyPlayer();
  const { header, outside, main, adjacent, footer } = surroundingPage(x);
  const full = byClass(x.stage, 'v2-fullscreen');
  x.stage.setAttribute('style', 'border: 1px solid red');
  outside.focus();
  full.click();
  assert.equal(x.document.activeElement, full, 'entry moves an outside focus into the player');
  for (const node of [header, adjacent, footer]) {
    assert.equal(node.hasAttribute('inert'), true);
    assert.equal(node.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(main.hasAttribute('inert'), false, 'the player ancestor stays usable');
  assert.equal(x.stage.hasAttribute('inert'), false);
  assert.equal(documentEvent(x.document, 'keydown', { key: 'Tab' }).defaultPrevented, true);
  assert.equal(x.document.activeElement, x.canvas, 'Tab wraps to the first visible control');
  assert.equal(documentEvent(x.document, 'keydown', { key: 'Tab', shiftKey: true }).defaultPrevented, true);
  assert.equal(x.document.activeElement, full, 'Shift+Tab wraps to the last visible control');
  byClass(x.stage, 'v2-next').focus();
  assert.equal(Boolean(documentEvent(x.document, 'keydown', { key: 'Tab' }).defaultPrevented), false, 'middle controls keep normal tab order');
  documentEvent(x.document, 'keydown', { key: 'Escape' });
  assert.equal(x.document.activeElement, outside);
  assert.equal(header.hasAttribute('inert'), false);
  assert.equal(header.hasAttribute('aria-hidden'), false);
  assert.equal(adjacent.hasAttribute('inert'), false);
  assert.equal(footer.getAttribute('inert'), 'inert');
  assert.equal(footer.getAttribute('aria-hidden'), 'false');
  assert.equal(x.document.documentElement.style.overflow, 'scroll');
  assert.equal(x.stage.getAttribute('style'), 'border: 1px solid red');
  assert.equal(Boolean(documentEvent(x.document, 'keydown', { key: 'Tab' }).defaultPrevented), false, 'normal page tabbing resumes');
  full.click();
  full.click();
  assert.equal(x.document.activeElement, outside, 'button exit also restores the entry focus');
  assert.equal(header.hasAttribute('inert'), false, 'a second entry leaves no inert residue');
});

test('F08: simulated fullscreen catches escaped focus and includes newly opened panel controls', async () => {
  const x = await readyPlayer();
  const { outside } = surroundingPage(x);
  const full = byClass(x.stage, 'v2-fullscreen');
  full.focus(); full.click();
  const about = byClass(x.stage, 'v2-about-toggle');
  about.click();
  const close = byClass(x.stage, 'v2-about').querySelector('button');
  close.focus();
  documentEvent(x.document, 'focusin', { target: close });
  outside.focus();
  documentEvent(x.document, 'focusin', { target: outside });
  assert.equal(x.document.activeElement, close, 'an outside focus request returns to the last usable player control');
  byClass(x.stage, 'v2-about').hidden = true;
  outside.focus();
  documentEvent(x.document, 'focusin', { target: outside });
  assert.equal(x.document.activeElement, x.canvas, 'a hidden former target is not reused');
  full.click();
  outside.focus();
  documentEvent(x.document, 'focusin', { target: outside });
  assert.equal(x.document.activeElement, outside, 'focus containment ends at exit');
});

test('F08: failure teardown releases the background and restores the page layout', async () => {
  const timers = manualTimers();
  const x = await readyPlayer({ context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
  const { header } = surroundingPage(x);
  const full = byClass(x.stage, 'v2-fullscreen');
  full.focus(); full.click();
  assert.equal(header.hasAttribute('inert'), true);
  x.canvas.dispatch('webglcontextlost');
  timers.fire(5000);
  assert.equal(header.hasAttribute('inert'), false);
  assert.equal(x.document.documentElement.style.overflow, 'scroll');
  assert.equal(x.stage.classList.contains('v2-filled'), false);
});

test('F08: native standard and prefixed fullscreen keep the browser focus and isolation behavior', async () => {
  for (const prefixed of [false, true]) {
    const x = load({ files: { 'manifest.json': manifest() } });
    const { header, outside } = surroundingPage(x);
    const requests = [];
    const element = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
    x.document[prefixed ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'] = true;
    x.stage[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = () => {
      requests.push('enter'); x.document[element] = x.stage;
      documentEvent(x.document, prefixed ? 'webkitfullscreenchange' : 'fullscreenchange');
      return Promise.resolve();
    };
    x.document[prefixed ? 'webkitExitFullscreen' : 'exitFullscreen'] = () => {
      requests.push('exit'); x.document[element] = null;
      documentEvent(x.document, prefixed ? 'webkitfullscreenchange' : 'fullscreenchange');
      return Promise.resolve();
    };
    const engine = fakeEngine(x.log);
    const pending = x.player.start(x.stage, { base: 'https://veylet.com/pkg/', env: phoneWebgl2,
      page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
    for (let i = 0; i < 12; i++) await tick();
    engine.apps[0].systems.gsplat.fire('frame:ready', null, null, false, 1);
    engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
    await pending;
    outside.focus();
    const full = byClass(x.stage, 'v2-fullscreen');
    full.click();
    assert.equal(full.getAttribute('aria-label'), 'Exit full screen');
    assert.equal(x.document.activeElement, outside);
    assert.equal(header.hasAttribute('inert'), false);
    assert.equal(x.document.documentElement.style.overflow, 'scroll');
    assert.equal(Boolean(documentEvent(x.document, 'keydown', { key: 'Tab' }).defaultPrevented), false);
    full.click();
    assert.deepEqual(requests, ['enter', 'exit']);
    assert.equal(full.getAttribute('aria-label'), 'Full screen');
  }
});

// ---------- launch audit 26 September 2026 (VIEWER-02, 07, 08, 10, 11, 12, 16) ----------

/** Timers the test fires by hand: { ms, fire } for every pending setTimeout. */
function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: id => { pending.delete(id); },
    waiting: ms => [...pending.values()].filter(timer => timer.ms === ms).length,
    fire(ms) { for (const [id, timer] of [...pending]) if (timer.ms === ms) { pending.delete(id); timer.fn(); } },
  };
}
const clock = () => { const c = { t: 1000, now: () => c.t, mark() {} }; return c; };
async function readyPlayer(options = {}) {
  const x = await started(options);
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  return { ...x, app, canvas: byClass(x.stage, 'v2-canvas'), stopLine: () => byClass(x.stage, 'v2-stop').textContent, status: () => byClass(x.stage, 'v2-status').textContent };
}

// Owner, 12 November 2026: "Remove free-walk mode". Point to point is the only mode: a tap on the
// floor never moves, even on a measured open floor; the numbered circles, Next, Previous and the keys do.
test('point to point is the only mode: a floor tap never moves, circles and Next still do', async () => {
  const columns = 60, rows = 20;
  const open = { version: 1, cell_metres: 0.1, origin: [-1, -1], columns, rows, floor_y: -1.4, eye_height: 1.4,
    mask: Buffer.from(new Uint8Array(Math.ceil(columns * rows / 8)).fill(255)).toString('base64') };
  const data = manifest({ walkable: { path: 'walkable.json' } });
  const x = await readyPlayer({ manifest: data, files: { 'walkable.json': open } });
  const controller = x.window.VeyletPlayerV2.current;
  const atStop = index => {
    assert.equal(x.stopLine(), `Stop ${index + 1} of 5`);
    assert.deepEqual([...controller.inspect().state.position], data.stops[index].position, 'at the stop itself');
    assert.equal(controller.view().stop, index);
  };
  atStop(0);
  for (const [px, py] of [[340, 0], [200, 150], [0, 0]]) {
    controller.tapAt(px, py);
    atStop(0);
  }
  assert.equal(typeof controller.probe, 'undefined', 'no free-walk QA probe');
  byClass(x.stage, 'v2-next').click();
  atStop(1);
  x.stage.querySelectorAll('.v2-hotspot')[3].click();
  atStop(3);
  controller.tapAt(100, 0);
  atStop(3);
  byClass(x.stage, 'v2-prev').click();
  atStop(2);
  x.canvas.dispatch('keydown', { key: 'n' });
  atStop(3);
  assert.doesNotMatch(x.stage.textContent, /Between stops|Tap the floor/);
});

test('forward and back keys go to the stop the view is aligned with; no stop within 45° gives the hint', async () => {
  // s1 looks along -Z. s3 and s4 are ahead (s4 4° off the line and further), s5 behind, s2 to the right (+X).
  const stop = (id, x, z) => ({ id, room: 'r1', position: [x, 0, z], target: [x, -0.3, z - 2], floor: [x, -1.4, z], floor_measured: true });
  const columns = 100, rows = 100;
  const open = { version: 1, cell_metres: 0.1, origin: [-5, -5], columns, rows, floor_y: -1.4, eye_height: 1.4,
    mask: Buffer.from(new Uint8Array(Math.ceil(columns * rows / 8)).fill(255)).toString('base64') };
  const data = manifest({ walkable: { path: 'walkable.json' }, stops: [stop('s1', 0, 0), stop('s2', 2, 0), stop('s3', 0, -2), stop('s4', 0.3, -4), stop('s5', 0, 2)] });
  const x = await readyPlayer({ manifest: data, files: { 'walkable.json': open } });
  const controller = x.window.VeyletPlayerV2.current;
  const atStop = index => {
    assert.equal(x.stopLine(), `Stop ${index + 1} of 5`);
    assert.deepEqual([...controller.inspect().state.position], data.stops[index].position, 'at the stop itself, not a step along');
  };
  x.canvas.dispatch('keydown', { key: 'w' });
  atStop(2); // s3: as well aligned as s4 (within 10°) and nearer
  x.canvas.dispatch('keydown', { key: 'ArrowDown' });
  atStop(0); // behind s3: s1, nearer than s5 on the same line
  // Turned 90° left the view runs along -X: nothing that way.
  for (let i = 0; i < 9; i++) x.canvas.dispatch('keydown', { key: 'ArrowLeft' });
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(x.status(), 'No circle in view. Tap Next.'); // facing away from every stop: no circle on screen
  atStop(0);
  // Back from there is +X: s2.
  x.canvas.dispatch('keydown', { key: 's' });
  atStop(1);
});

test('a miss names the circles only when one is on screen; facing away it points to Next, and both fit one line', async () => {
  const x = await readyPlayer();
  const controller = x.window.VeyletPlayerV2.current;
  const shown = () => x.stage.querySelectorAll('.v2-hotspot').filter(button => !button.hidden).length;
  x.canvas.clientWidth = 390; x.canvas.clientHeight = 700; // the stand-in canvas has a size, so a circle ahead lands on it
  // The opening view looks across the line of stops: no circle is on screen, so a tap 3 m from any stop, and the
  // forward key, point to Next instead of to circles the viewer cannot see.
  assert.equal(shown(), 0);
  controller.tapAt(200, 300);
  assert.equal(x.status(), 'No circle in view. Tap Next.');
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(x.status(), 'No circle in view. Tap Next.');
  // Turned to face along the stops, their circles show: the same miss now says to tap one.
  for (let i = 0; i < 9; i++) x.canvas.dispatch('keydown', { key: 'ArrowRight' });
  assert.ok(shown() > 0);
  controller.tapAt(200, 300);
  assert.equal(x.status(), 'Tap a numbered circle to move.');
  assert.equal(x.stopLine(), 'Stop 1 of 5');
  for (const message of ['Tap a numbered circle to move.', 'No circle in view. Tap Next.']) assert.ok(message.length <= 30, message);
});

test('the status hangs from the top of the controls once they show, so room names cannot cover it', async () => {
  // Before the first frame the controls are hidden and the status is the stage's own (Loading…).
  const loading = await started();
  assert.equal(byClass(loading.stage, 'v2-status').parentNode, byClass(loading.stage, 'v2'));
  const x = await readyPlayer();
  assert.equal(byClass(x.stage, 'v2-status').parentNode, byClass(x.stage, 'v2-bar'));
  assert.equal(x.stage.querySelectorAll('.v2-status').length, 1);
  const css = read('tour-player-v2.css');
  assert.match(css, /\.v2-bar > \.v2-status \{ bottom: calc\(100% \+ 8px\); max-width: 100%; \}/);
  // Full screen and the filled window keep it there (their own .v2-status offset would otherwise win).
  assert.match(css, /\.v2-stage:is\(\.v2-filled, :fullscreen\) \.v2-bar > \.v2-status \{ bottom: calc\(100% \+ 8px\); \}/);
  assert.match(css, /\.v2-bar \{\s*position: absolute;/, 'the bar is what the status is placed against');
});

test('a place kept by an older session that was between stops (stop -1) opens at a stop', async () => {
  const store = new Map([['veylet-player-resume', JSON.stringify({ base: 'https://veylet.com/pkg/', stop: -1 })]]);
  const sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const data = manifest();
  const x = await readyPlayer({ context: { sessionStorage }, manifest: data });
  assert.equal(x.stopLine(), 'Stop 1 of 5');
  assert.deepEqual([...x.window.VeyletPlayerV2.current.inspect().state.position], data.stops[0].position);
  assert.equal(x.window.VeyletPlayerV2.current.view().stop, 0);
});

test('a phone-sized stage (334 x 300) still gets a one-line movement hint, and Next keeps its name and a short label (VIEWER-02)', async () => {
  const x = await readyPlayer({ size: [334, 300] });
  const hint = byClass(x.stage, 'v2-hint');
  assert.equal(hint.hidden, false, 'the first view says how to move');
  assert.equal(hint.textContent, 'Drag to look. Tap a circle to move.');
  assert.ok(hint.className.includes('v2-hint-short'));
  // A roomy stage keeps the full sentence.
  const roomy = await readyPlayer();
  assert.equal(byClass(roomy.stage, 'v2-hint').textContent, 'Drag to look around. Tap a circle or Next to move.');
  // Next: named for assistive technology, and "Next" stays on screen down to 300 px.
  const next = byClass(x.stage, 'v2-next');
  assert.equal(next.getAttribute('aria-label'), 'Next stop');
  assert.equal(next.querySelector('.v2-label').textContent, 'Next stop');
  assert.equal(next.querySelector('.v2-label-more').textContent, ' stop');
  const css = read('tour-player-v2.css');
  const narrow = css.match(/@container \(max-width: 430px\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(narrow, /\.v2-next \.v2-label \{ display: none; \}/, 'the word Next stays at phone widths');
  assert.match(narrow, /\.v2-next \.v2-label-more \{ display: none; \}/);
  assert.match(css, /@container \(max-width: 299px\) \{[^@]*\.v2-next \.v2-label \{ display: none; \}/);
});

test('the canvas stays invisible until the first frame is drawn; the poster shows until then (VIEWER-12)', async () => {
  const css = read('tour-player-v2.css');
  assert.match(css, /\.v2:not\(\[data-state="ready"\]\) \.v2-canvas \{[^}]*opacity: 0;/);
  const x = await started();
  const root = byClass(x.stage, 'v2');
  // The engine is running and the canvas is laid out (for sizing), but no frame is finished yet.
  assert.equal(byClass(x.stage, 'v2-canvas').hidden, false);
  assert.equal(root.dataset.poster, 'shown');
  assert.notEqual(root.dataset.state, 'ready');
  x.engine.apps[0].systems.gsplat.fire('frame:ready', null, null, false, 1);
  assert.notEqual(root.dataset.state, 'ready', 'loading frames do not reveal the canvas');
  x.engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  assert.equal(root.dataset.state, 'ready');
});

test('a slow first load keeps the poster and offers Keep waiting or Try again; the page adds no second deadline (VIEWER-10)', async () => {
  const timers = manualTimers();
  const x = await started({ slowEngine: true, context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
  const root = byClass(x.stage, 'v2');
  const fallback = byClass(x.stage, 'v2-fallback');
  assert.equal(byClass(x.stage, 'v2-status').textContent, 'Loading 3D…');
  // A slow connection is said to be slow, without blame, while the download goes on.
  timers.fire(10000);
  assert.equal(byClass(x.stage, 'v2-status').textContent, 'Still loading. A slow connection can take a minute.');
  assert.equal(timers.waiting(45000), 1, 'one deadline, counted from the start of the 3D download');
  timers.fire(45000);
  assert.equal(fallback.hidden, false);
  assert.match(fallback.textContent, /^3D is taking a while\./);
  assert.doesNotMatch(fallback.textContent, /browser/i);
  const [keep, retry] = fallback.querySelectorAll('button');
  assert.deepEqual([keep.textContent, retry.textContent], ['Keep waiting', 'Try again']);
  assert.equal(root.dataset.poster, 'shown');
  assert.notEqual(root.dataset.state, 'fallback', 'the poster stays and the download is not thrown away');
  assert.equal(x.stage.querySelector('.v2'), root);
  keep.click();
  assert.equal(fallback.hidden, true);
  assert.equal(timers.waiting(45000), 1, 'Keep waiting gives the download another 45 s');
  timers.fire(45000);
  fallback.querySelectorAll('button')[1].click();
  assert.equal(x.log.at(-1), 'retry');

  // The page glue: a streamed walkthrough gets no outer deadline that would tear the poster down.
  const page = manualTimers();
  let startOptions = null;
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'k' }, supabase: { createClient: () => ({}) }, addEventListener() {}, removeEventListener() {},
    VeyletPlayerV2: { start: (stage, options) => { startOptions = options; return new Promise(() => {}); } } };
  window.self = window; window.top = window;
  const document = { hidden: false, addEventListener() {}, removeEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, head: { append() {} } };
  vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout: page.setTimeout, clearTimeout: page.clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} } });
  const status = {};
  window.VeyletPlayer.boot({ els: { title: {}, body: {}, status, frame: { hidden: true }, stage: { hidden: true } }, resolve: async () => ({ packageFormatVersion: 2, packageBaseUrl: 'https://tours.veylet.com/t/a/', title: 'S' }) });
  for (let i = 0; i < 12; i++) await tick();
  assert.ok(startOptions, 'the player started');
  for (const ms of [45000, 65000, 90000]) page.fire(ms);
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(startOptions.signal.aborted, false, 'nothing in the page aborts a slow download');
  assert.equal(status.textContent, 'Loading the walkthrough…');
});

test('a lost graphics context waits for its restore; a final loss retries one budget lower at the same stop (VIEWER-11)', async () => {
  const timers = manualTimers();
  const store = new Map();
  const sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const context = { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, sessionStorage };
  const x = await readyPlayer({ context });
  const root = byClass(x.stage, 'v2');
  byClass(x.stage, 'v2-next').click(); byClass(x.stage, 'v2-next').click();
  assert.equal(x.stopLine(), 'Stop 3 of 5');
  // iOS reclaims the context when Messages opens, and gives it back on return.
  const lost = x.canvas.dispatch('webglcontextlost', {});
  assert.equal(lost.defaultPrevented, true, 'the browser is told a restore is wanted');
  assert.equal(root.dataset.state, 'ready', 'not the end of the walkthrough');
  assert.equal(x.status(), 'Restoring 3D…');
  x.canvas.dispatch('webglcontextrestored', {});
  assert.equal(root.dataset.state, 'ready');
  assert.equal(x.status(), '');
  timers.fire(5000);
  assert.equal(root.dataset.state, 'ready', 'a restored context has no deadline left');
  // No restore within 5 s of visible time: the fallback, and Try again comes back lower, at stop 3.
  x.canvas.dispatch('webglcontextlost', {});
  timers.fire(5000);
  assert.equal(root.dataset.state, 'fallback');
  assert.match(byClass(x.stage, 'v2-fallback').textContent, /3D stopped on this device\./);
  assert.ok(store.size === 1, 'the place and a lower budget are kept for the retry');
  const again = await readyPlayer({ context: { sessionStorage } });
  assert.equal(again.app.scene.gsplat.splatBudget, 250_000, 'one budget level lower than the phone’s 500K');
  assert.equal(again.stopLine(), 'Stop 3 of 5', 'back where the visitor was');
  assert.equal(store.size, 0, 'used once');
  const fresh = await readyPlayer({ context: { sessionStorage } });
  assert.equal(fresh.app.scene.gsplat.splatBudget, 500_000);
  assert.equal(fresh.stopLine(), 'Stop 1 of 5');
});

test('full screen on an iPhone clears the notch and the home indicator (VIEWER-16)', async () => {
  const css = read('tour-player-v2.css');
  for (const [part, sides] of [['v2-top', ['top', 'left', 'right']], ['v2-bar', ['bottom', 'left', 'right']]]) {
    const rule = css.match(new RegExp(`\\.v2-stage:is\\(\\.v2-filled, :fullscreen\\) \\.${part} \\{([^}]*)\\}`));
    assert.ok(rule, part);
    for (const side of sides) assert.match(rule[1], new RegExp(`${side}: max\\(12px, env\\(safe-area-inset-${side}, 0px\\)\\);`), `${part} ${side}`);
  }
  const x = await readyPlayer();
  x.document.documentElement = x.document.createElement('html');
  const full = byClass(x.stage, 'v2-fullscreen');
  full.click();
  assert.equal(x.stage.classList.contains('v2-filled'), true);
  full.click();
  assert.equal(x.stage.classList.contains('v2-filled'), false);
});

// ---------- Astra round 2: failure recovery (F07) ----------

test('F07: a final graphics loss announces the failure and moves hidden or removed focus to Try again', async () => {
  for (const selector of ['.v2-canvas', '.v2-next', '.v2-hotspots button', '.v2-fullscreen']) {
    const timers = manualTimers();
    const x = await readyPlayer({ context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
    const focused = x.stage.querySelector(selector);
    assert.ok(focused, selector);
    focused.focus();
    if (selector === '.v2-fullscreen') {
      x.document.documentElement = x.document.createElement('html');
      focused.click();
      assert.equal(x.stage.classList.contains('v2-filled'), true);
    }
    x.canvas.dispatch('webglcontextlost');
    timers.fire(5000);
    const fallback = byClass(x.stage, 'v2-fallback');
    const retry = fallback.querySelector('button');
    assert.equal(fallback.hidden, false);
    assert.equal(x.document.activeElement, retry, selector);
    assert.equal(x.stage.classList.contains('v2-filled'), false, 'failure exits simulated fullscreen before recovery focus');
    assert.match(byClass(x.stage, 'v2-sr').textContent, /^3D stopped on this device\. .*Try again/);
    retry.click();
    assert.equal(x.log.at(-1), 'retry');
  }
});

test('F07: failure announces itself without taking focus from a visible player control or the surrounding page', async () => {
  for (const outside of [false, true]) {
    const timers = manualTimers();
    const x = await readyPlayer({ context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
    const focused = outside ? x.document.createElement('button') : byClass(x.stage, 'v2-about-toggle');
    if (outside) x.document.body.append(focused);
    focused.focus();
    x.canvas.dispatch('webglcontextlost');
    timers.fire(5000);
    assert.equal(x.document.activeElement, focused);
    assert.match(byClass(x.stage, 'v2-sr').textContent, /^3D stopped on this device\./);
  }
});

test('F07: a non-retryable failure replaces the focused loading action with a focusable explanation', async () => {
  const timers = manualTimers();
  const x = load({ files: { 'manifest.json': manifest() }, context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
  const engine = fakeEngine(x.log);
  let finishDevice;
  engine.createGraphicsDevice = () => new Promise(resolve => { finishDevice = resolve; });
  const pending = x.player.start(x.stage, { base: 'https://veylet.com/pkg/', env: phoneWebgl2,
    page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  timers.fire(45000);
  const fallback = byClass(x.stage, 'v2-fallback');
  fallback.querySelector('button').focus();
  finishDevice(null);
  assert.equal((await pending).reason, 'no-graphics');
  // No Try again: the one action left is the link to take to another browser.
  assert.deepEqual(fallback.querySelectorAll('button').map(button => button.textContent), ['Copy link']);
  const title = fallback.querySelector('h2');
  assert.equal(title.getAttribute('tabindex'), '-1');
  assert.equal(x.document.activeElement, title);
  assert.match(byClass(x.stage, 'v2-sr').textContent, /^3D can’t open in this browser\./);
});

test('sustained headroom restores pixels gradually after a transient slowdown without exceeding the device ceiling', () => {
  const { player } = load();
  const governor = player.createGovernor({ budget: 500_000, maxBudget: 500_000, minBudget: 150_000, maxPixelRatio: 1.5, minPixelRatio: 1 });
  let now = 10_000;
  const run = (ms, seconds) => {
    const changes = [];
    for (const end = now + seconds * 1000; now < end;) {
      now += ms;
      const change = governor.sample(ms, now);
      if (change) changes.push({ ...change, now });
    }
    return changes;
  };
  const slow = run(50, 1.5);
  assert.equal(governor.state.pixelRatio, 1.2);
  assert.equal(governor.state.budget, 500_000);
  assert.equal(run(10, 4).length, 0, 'brief headroom does not immediately raise resolution');
  const recovered = run(10, 30);
  assert.equal(governor.state.pixelRatio, 1.5, 'recover native sharpness when sustained performance allows it');
  assert.ok(recovered.length >= 3, 'resolution recovery is gradual');
  let previous = slow.at(-1);
  for (const change of recovered) {
    assert.ok(change.pixelRatio <= 1.5, 'device pixel ceiling remains authoritative');
    assert.ok(change.pixelRatio > previous.pixelRatio && change.pixelRatio - previous.pixelRatio <= 0.15);
    assert.ok(change.now - previous.now >= 5000, 'at least five seconds between resolution increases');
    previous = change;
  }
  assert.equal(run(10, 10).length, 0, 'no change once the device ceiling is reached');
  assert.ok(run(50, 3).some(change => change.pixelRatio < 1.5), 'slow rendering still lowers resolution promptly');
  const low = governor.state.pixelRatio;
  const modest = run(30, 15);
  assert.ok(modest.every(change => !change.pixelRatio || change.pixelRatio <= low), '30 fps without headroom does not raise resolution');
});

test('benchmark turns at the same timed speed at 30, 60 and 120 fps and clamps the last frame', async () => {
  const turns = [];
  for (const fps of [30, 60, 120]) {
    const time = clock();
    const x = await readyPlayer({ context: { performance: time } });
    const controller = x.window.VeyletPlayerV2.current;
    const initial = controller.inspect().state.yaw;
    const begin = time.t;
    const done = controller.benchmark(5, 30);
    for (let frame = 1; frame <= 5 * fps + 1; frame++) {
      time.t = begin + frame * 1000 / fps;
      x.app.fire('update');
      x.app.fire('postrender');
    }
    await done;
    const turn = controller.inspect().state.yaw - initial;
    turns.push(turn);
    assert.ok(Math.abs(turn - 150) < 1e-8, `${fps} fps turns 150 degrees, got ${turn}`);
  }
  assert.ok(Math.max(...turns) - Math.min(...turns) < 1e-8);
});


test('pseudo fullscreen isolates background controls and restores their attributes and focus on exit', async () => {
  const x = await readyPlayer();
  x.document.documentElement = x.document.createElement('html');
  const outside = x.document.createElement('button');
  outside.setAttribute('aria-hidden', 'false');
  outside.setAttribute('inert', 'retained-value');
  x.document.body.append(outside);
  outside.focus();
  const full = byClass(x.stage, 'v2-fullscreen');
  full.click();
  assert.equal(x.document.activeElement, full);
  assert.equal(outside.getAttribute('inert'), '');
  assert.equal(outside.getAttribute('aria-hidden'), 'true');
  const tab = { key: 'Tab', shiftKey: false, preventDefault() { this.defaultPrevented = true; } };
  outside.focus();
  for (const listener of x.document.listeners.get('keydown')) listener(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.ok(x.stage.contains(x.document.activeElement), 'Tab cannot escape to background controls');
  full.click();
  assert.equal(outside.getAttribute('inert'), 'retained-value');
  assert.equal(outside.getAttribute('aria-hidden'), 'false');
  // An originally inert control is not a usable return target.
  outside.removeAttribute('inert');
  outside.focus();
  full.click();
  full.click();
  assert.equal(x.document.activeElement, outside, 'return to the original visible control');
  assert.equal(outside.getAttribute('inert'), null);
});

test('graphics failure announces recovery and moves focus off the hidden canvas', async () => {
  const timers = manualTimers();
  const x = await readyPlayer({ context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
  x.canvas.focus();
  x.canvas.dispatch('webglcontextlost', {});
  timers.fire(5000);
  assert.equal(x.canvas.hidden, true);
  assert.equal(x.document.activeElement.textContent, 'Try again');
  assert.match(byClass(x.stage, 'v2-sr').textContent, /3D stopped on this device/);
});


function navigationFloor(blocked = false) {
  const columns = 60, rows = 20, bits = new Uint8Array(Math.ceil(columns * rows / 8)).fill(255);
  if (blocked) for (let row = 0; row < rows; row++) { const bit = row * columns + 25; bits[bit >> 3] &= ~(1 << (bit & 7)); }
  return { version: 1, cell_metres: 0.1, origin: [-1, -1], columns, rows, floor_y: -1.4, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
}

for (const scenario of ['blocked', 'missing', 'unmeasured', 'other-storey', 'height-without-floor-id']) {
  test(`stop transitions snap to exact captured pose when route is ${scenario}`, async () => {
    const time = clock(), data = manifest({ walkable: scenario === 'missing' ? null : { path: 'walkable.json' } });
    if (scenario === 'unmeasured') delete data.stops[2].floor_measured;
    if (scenario === 'other-storey' || scenario === 'height-without-floor-id') {
      for (const stop of data.stops) stop.floor_id = 'f1';
      const stop = data.stops[2]; stop.position[1] += 3; stop.target[1] += 3; stop.floor[1] += 3;
      if (scenario === 'other-storey') stop.floor_id = 'f2'; else for (const stop of data.stops) delete stop.floor_id;
    }
    const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data, files: { 'walkable.json': navigationFloor(scenario === 'blocked') } });
    const controller = x.window.VeyletPlayerV2.current;
    controller.goToStop(1); time.t += 100; x.app.fire('update'); // interrupt an existing clear flight where available
    controller.goToStop(2);
    const state = controller.inspect().state, look = x.player.lookAngles(data.stops[2].position, data.stops[2].target);
    assert.deepEqual([...state.position], data.stops[2].position);
    assert.equal(state.yaw, look.yaw); assert.equal(state.pitch, look.pitch); assert.equal(state.stop, 2);
    time.t += 5000; x.app.fire('update');
    assert.deepEqual([...controller.inspect().state.position], data.stops[2].position, 'cancelled flight cannot overwrite the endpoint');
    x.app.systems.gsplat.fire('frame:ready', null, null, false, 2);
    x.app.systems.gsplat.fire('frame:ready', null, null, true, 0);
    x.app.renderNextFrame = false; x.app.fire('update');
    assert.equal(x.app.renderNextFrame, false, 'no continuous render hold remains after the snap');
  });
}

test('roomFootprint computes indicative room dimensions and arrived dispatches veylet:room on room change', async () => {
  const { player } = load();
  const raw = manifest({
    rooms: [
      { id: 'r1', name: 'Living', bounds: [4.8, 3.6] },
      { id: 'r2', name: 'Kitchen' },
    ],
    stops: [
      { id: 's1', room: 'r1', position: [0, 0, 0], target: [0, 0, -2], floor: [0, -1.4, 0], floor_measured: true },
      { id: 's2', room: 'r2', position: [0, 0, -2], target: [0, 0, -4], floor: [0, -1.4, -2], floor_measured: true },
      { id: 's3', room: 'r2', position: [1.8, 0, -3.2], target: [1.8, 0, -5], floor: [1.8, -1.4, -3.2], floor_measured: true },
    ],
  });
  const data = player.validateManifest(raw);
  assert.deepEqual({ ...player.roomFootprint(data, 'r1') }, { widthMeters: 4.8, depthMeters: 3.6, label: 'approx. 4.8 × 3.6 m' });
  assert.deepEqual({ ...player.roomFootprint(data, 'r2') }, { widthMeters: 3.2, depthMeters: 2.6, label: 'approx. 3.2 × 2.6 m' });
  const visitedRooms = [];
  const x = await readyPlayer({
    manifest: raw,
    context: {
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    },
  });
  x.document.dispatchEvent = event => { if (event?.type === 'veylet:room') visitedRooms.push(event.detail?.room); };
  const pills = byClass(x.stage, 'v2-room-pills').querySelectorAll('.v2-room-pill');
  assert.equal(pills[0].dataset.dimensions, 'approx. 4.8 × 3.6 m');
  assert.equal(pills[0].title, 'Living · approx. 4.8 × 3.6 m');
  assert.equal(pills[1].dataset.dimensions, 'approx. 3.2 × 2.6 m');
  pills[1].click();
  assert.deepEqual(visitedRooms, ['Kitchen']);
  pills[1].click();
  assert.deepEqual(visitedRooms, ['Kitchen'], 'staying in the same room does not re-dispatch');
  pills[0].click();
  assert.deepEqual(visitedRooms, ['Kitchen', 'Living']);
});

test('corridorRoute routes smoothly around obstacles via intermediate stops or corridor bends while rejecting sealed walls', () => {
  const { player } = load();
  const sofaFloor = player.decodeWalkable(room());
  const stops = [
    { id: 's1', position: [0.8, 0, 1.5], floor: [0.8, -1.4, 1.5], floorMeasured: true },
    { id: 's2', position: [2.0, 0, 0.4], floor: [2.0, -1.4, 0.4], floorMeasured: true },
    { id: 's3', position: [3.2, 0, 1.5], floor: [3.2, -1.4, 1.5], floorMeasured: true },
  ];
  assert.equal(sofaFloor.clear([0.8, 1.5], [3.2, 1.5]), false, 'direct line crosses the sofa');
  const route = player.corridorRoute(sofaFloor, stops[0].position, stops[2].position, stops);
  assert.ok(route && route.length === 2, 'finds a 2-segment route around the sofa via s2');
  assert.deepEqual([...route[0]], stops[1].position);
  assert.deepEqual([...route[1]], stops[2].position);

  const sealed = player.decodeWalkable(navigationFloor(true));
  assert.equal(player.corridorRoute(sealed, [1.0, 0, 0], [2.0, 0, 0], []), null, 'sealed wall still blocks');
});

test('360 rotation and movement stability: radialSorting, lodBehindPenalty=1, colorUpdateAngle=2, idle-gap governor immunity, and a forward key that never steps off a stop', async () => {
  const time = clock();
  const x = await readyPlayer({ reduced: true, context: { performance: time }, manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': navigationFloor() } });
  x.app.systems.gsplat.fire('frame:ready', null, null, false, 2);
  x.app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  assert.equal(x.app.scene.gsplat.radialSorting, true, 'radial sorting keeps depth order invariant during 360 rotation');
  assert.equal(x.app.scene.gsplat.lodBehindPenalty, 1, 'octree nodes behind the camera keep full LOD for instant turns');
  assert.equal(x.app.scene.gsplat.colorUpdateAngle, 2, 'SH colors refresh smoothly every 2 degrees of camera motion');

  // Five short drags separated by 500 ms idle pauses must not be miscounted as 2 fps frames by the governor.
  for (let i = 0; i < 6; i++) {
    time.t += 500;
    x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    time.t += 16;
    x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 120, clientY: 100 });
    x.app.fire('update');
    x.app.fire('postrender');
    x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 120, clientY: 100 });
    x.app.fire('postrender');
  }
  assert.equal(x.window.VeyletPlayerV2.current.stats().pixelRatio, 1.5, 'idle gaps between drags do not trigger false pixelRatio downscaling');

  // Point to point (was: steps stay tethered within 0.85 m of the stop line). The view runs across the line of stops
  // (yaw = -90 looks along +X, so about yaw = 0 looks along -Z): no stop that way, so the forward key moves nothing.
  for (let i = 0; i < 5; i++) x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  const pos = x.window.VeyletPlayerV2.current.inspect().state.position;
  assert.deepEqual([...pos], [0, 0, 0], `the forward key leaves the viewer on the stop, got ${pos}`);
  assert.equal(x.status(), 'No circle in view. Tap Next.'); // facing away from every stop: no circle on screen
});



// ---------- walkthrough insights (10 Nov 2026): the player says where the viewer is, and sends nothing ----------

test('veylet:stop is announced at the first 3D frame and on each arrival; view() reads the stop and look direction', async () => {
  const raw = manifest({
    rooms: [{ id: 'r1', name: 'Living' }, { id: 'r2', name: 'Kitchen' }, { id: 'r3', name: null }],
    stops: [
      { id: 's1', room: 'r1', position: [0, 0, 0], target: [0, 0, -2], floor: [0, -1.4, 0], floor_measured: true },      // looks along -Z
      { id: 's2', room: 'r2', position: [0, 0, -2], target: [-3, 0, -2], floor: [0, -1.4, -2], floor_measured: true },    // looks along -X
      { id: 's3', room: 'r3', position: [2, 0, -2], target: [2, 0, 1], floor: [2, -1.4, -2], floor_measured: true },      // looks along +Z
      { id: 's4', room: 'r1', position: [2, 0, 0], target: [5, 3, 0], floor: [2, -1.4, 0], floor_measured: true },        // looks along +X, 45° up
    ],
  });
  const events = [], visits = [];
  const x = await started({ manifest: raw, context: { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } } });
  // The visit summary (data events, 11 Nov 2026) follows every veylet:stop; it is checked on its own below.
  x.document.dispatchEvent = event => { (event.type === 'veylet:visit' ? visits : events).push([event.type, { ...event.detail }]); };
  const controller = () => x.window.VeyletPlayerV2.current;
  // Until a 3D frame is drawn there is no view and no stop.
  assert.equal(controller() ? controller().view() : null, null);
  assert.deepEqual(events, []);
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  assert.equal(typeof controller().view, 'function');
  assert.deepEqual(events, [['veylet:stop', { stop: 0, room: 'Living' }]], 'the opening stop is an arrival, once there is a frame');
  // Tour frame: yaw 0 looks along -Z; it grows turning left, so -X is 90, +Z is 180 and +X is 270.
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  let view = controller().view();
  assert.deepEqual(Object.keys(view).sort(), ['pitch', 'stop', 'yaw']);
  assert.equal(view.stop, 0); near(view.yaw, 0); near(view.pitch, 0);
  byClass(x.stage, 'v2-next').click();
  view = controller().view();
  assert.equal(view.stop, 1); near(view.yaw, 90); near(view.pitch, 0);
  byClass(x.stage, 'v2-next').click();
  view = controller().view();
  assert.equal(view.stop, 2); near(view.yaw, 180);
  byClass(x.stage, 'v2-next').click();
  view = controller().view();
  assert.equal(view.stop, 3); near(view.yaw, 270); near(view.pitch, 45);
  assert.ok(view.yaw >= 0 && view.yaw < 360, 'never negative, whatever the player holds inside');
  assert.deepEqual(events, [
    ['veylet:stop', { stop: 0, room: 'Living' }],
    ['veylet:room', { room: 'Kitchen' }], ['veylet:stop', { stop: 1, room: 'Kitchen' }],
    ['veylet:stop', { stop: 2, room: null }],
    ['veylet:room', { room: 'Living' }], ['veylet:stop', { stop: 3, room: 'Living' }],
  ]);
  // One veylet:visit per arrival after the opening stop (which seeds the summary): stops reached, last and
  // furthest stop (visit numbers), and room TYPES only. The unnamed room (r3) has no type and adds no time.
  assert.equal(visits.length, 3);
  assert.deepEqual(visits.map(([, d]) => [d.stops, d.last_stop, d.furthest_stop, d.total_stops, d.room]),
    [[2, 2, 2, 4, 'Kitchen'], [3, 3, 3, 4, null], [4, 4, 4, 4, 'Living']]);
  for (const [, d] of visits) {
    assert.deepEqual(Object.keys(d).sort(), ['furthest_stop', 'last_stop', 'room', 'seconds', 'stops', 'total_stops']);
    for (const [type, value] of Object.entries(d.seconds)) { assert.ok(['Living', 'Kitchen'].includes(type), type); assert.ok(Number.isInteger(value) && value >= 0); }
  }
  // A drag to the right turns the yaw down through 0 into the 300s; view() keeps it in 0..360.
  const canvas = byClass(x.stage, 'v2-canvas');
  canvas.dispatch('keydown', { key: '1' });
  canvas.dispatch('keydown', { key: 'ArrowRight' });
  view = controller().view();
  assert.equal(view.stop, 0); near(view.yaw, 350);
  // Reading the view changes nothing and costs no event.
  const before = events.length;
  for (let i = 0; i < 50; i++) controller().view();
  assert.equal(events.length, before);
  // A page that does not listen, or a browser without CustomEvent, changes nothing.
  x.document.dispatchEvent = () => { throw new Error('a listener failed'); };
  assert.doesNotThrow(() => byClass(x.stage, 'v2-next').click());
  assert.equal(controller().view().stop, 1);
});

test('the player stays analytics-free: stop events and view() add no request, beacon, storage key or timer of their own', async () => {
  // Statically: nothing in the player can post anywhere, and it does not know the view function or a visit.
  const code = playerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /sendBeacon|XMLHttpRequest|WebSocket|EventSource|record_tour_view|rest\/v1|supabase|method:\s*['"]POST/);
  // Two fetch call sites, both plain GETs of package files: the manifest reader, and the first level fetched
  // beside the engine (10 November 2026). Neither carries a body, a method or credentials.
  assert.equal((code.match(/\bfetch\(/g) || []).length, 2, 'two fetch call sites: the package reader and the first files');
  for (const call of code.match(/\bfetch\([^\n]*/g)) assert.match(call, /credentials: 'omit'/, call);
  assert.doesNotMatch(code, /setInterval/);
  // At run time: walking every stop and reading the view asks the network for nothing but the package.
  const stored = [];
  const x = await readyPlayer({ context: {
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    navigator: { sendBeacon() { throw new Error('the player sent a beacon'); } },
  } });
  const original = x.document.dispatchEvent;
  x.document.dispatchEvent = event => { stored.push(event.type); return original?.call(x.document, event); };
  const requests = () => x.log.filter(line => line.startsWith('fetch:'));
  const before = requests().length;
  for (let i = 0; i < 6; i++) { byClass(x.stage, 'v2-next').click(); x.window.VeyletPlayerV2.current.view(); }
  assert.equal(requests().length, before, 'no request for a stop or a look');
  assert.ok(requests().every(line => line.startsWith('fetch:https://veylet.com/pkg/')), 'only package files, ever');
  assert.deepEqual([...new Set(stored)], ['veylet:stop', 'veylet:visit'], 'what it says goes to the page as a DOM event only');
});

// ---------- client build, 10 November 2026, phase 1 ----------

test('a package that is not there costs no engine download; a good one starts the engine as soon as its manifest is read', async () => {
  const gone = load({ files: {} });
  let asked = 0;
  const failure = await gone.player.start(gone.stage, { base: 'https://veylet.com/pkg/', env: phoneWebgl2, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' },
    loadEngine: () => { asked++; return new Promise(() => {}); } }).catch(error => error);
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(failure.message, 'package-unavailable');
  assert.equal(asked, 0, 'a paused, expired or mistyped link never downloads the 3D engine');
  const good = await started({ slowEngine: true });
  assert.equal(good.requested(), 1);
  assert.ok(good.log.indexOf('engine:import') > good.log.indexOf('fetch:https://veylet.com/pkg/manifest.json'), 'after the manifest answered');
});

test('on our own page the wheel scrolls the page until the visitor is using the walkthrough', async () => {
  const x = await readyPlayer();
  const root = x.document.documentElement || (x.document.documentElement = {});
  Object.assign(root, { scrollHeight: 2400, clientHeight: 700 });
  const wheel = values => Boolean(x.canvas.dispatch('wheel', { deltaY: 40, ...values }).defaultPrevented);
  assert.equal(wheel(), false, 'passing over the walkthrough, the page scrolls');
  assert.equal(wheel({ ctrlKey: true }), true, 'a trackpad pinch always zooms');
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 });
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 5, clientY: 5 });
  assert.equal(wheel(), true, 'after a press the wheel zooms');
  x.stage.dispatch('pointerleave');
  assert.equal(wheel(), false, 'until the pointer leaves');
  x.canvas.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(wheel(), true, 'a key on the walkthrough holds it too');
  x.canvas.dispatch('blur');
  assert.equal(wheel(), false);
  // A page with nothing to scroll (/tour, the embed opened on its own) has no other use for the wheel.
  Object.assign(root, { scrollHeight: 700, clientHeight: 700 });
  assert.equal(wheel(), true);
});

test('the movement hint counts as seen only when the visitor presses or moves, not when it times out', async () => {
  const run = async () => {
    const timers = manualTimers(), kept = new Map();
    const x = await readyPlayer({ context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
      localStorage: { getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, String(v)) } } });
    return { x, timers, kept, hint: byClass(x.stage, 'v2-hint') };
  };
  const away = await run();
  assert.equal(away.hint.hidden, false);
  away.timers.fire(9000);
  assert.equal(away.hint.hidden, true);
  assert.equal(away.kept.get('veylet-player-hint-seen'), undefined, 'someone who looked away sees it next time');
  const used = await run();
  used.x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 });
  assert.equal(used.hint.hidden, true);
  assert.equal(used.kept.get('veylet-player-hint-seen'), '1');
  assert.match(read('tour-player-v2.css'), /\.v2-hint \{[^}]*width: max-content;/, 'one line wherever it fits');
});

test('a scene file that does not arrive ends the player after the engine has finished reporting it', async () => {
  const log = [], assets = [];
  const engine = fakeEngine(log);
  const Base = engine.Asset;
  engine.Asset = class extends Base { constructor(...args) { super(...args); assets.push(this); } };
  const x = await started({ startOptions: { loadEngine: async () => engine } });
  assert.ok(assets.length > 0);
  // The engine calls every failure callback in one loop and goes on using the app afterwards.
  for (const asset of assets) asset.fire('error', 'synthetic');
  assert.equal(log.includes('app.destroy'), false, 'nothing is torn down inside the engine’s own loop');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(log.filter(line => line === 'app.destroy').length, 1);
  assert.equal(byClass(x.stage, 'v2-fallback').hidden, false, 'and the visitor is told, with Try again');
});

// ---------- client build, 10 November 2026, phase 2 ----------

test('stops are numbered in the order of the visit: a package that opens on its second stop reads "Stop 1"', async () => {
  const opened = manifest({ start_stop: 1 });
  const x = await readyPlayer({ manifest: opened });
  assert.equal(x.stopLine(), 'Stop 1 of 5');
  assert.equal(byClass(x.stage, 'v2-stops-text').textContent, '1 of 5');
  // The list counts up from the opening stop, and a number key means the number on screen.
  assert.deepEqual(x.stage.querySelectorAll('.v2-stop-button').map(button => [button.textContent, button.dataset.stop]),
    [['Stop 1', '1'], ['Stop 2', '2'], ['Stop 3', '3'], ['Stop 4', '4'], ['Stop 5', '0']]);
  x.canvas.dispatch('keydown', { key: '3' });
  assert.equal(x.stopLine(), 'Stop 3 of 5');
  assert.equal(x.player.visitNumber({ stops: [1, 2, 3], start: 1 }, 0), 3);
  assert.equal(x.player.stopAtNumber({ stops: [1, 2, 3], start: 1 }, 3), 0);
  // Events for the page still carry the package's own index (the agent's desk counts by it).
  assert.equal(x.player.stopLabel(x.player.validateManifest(opened), 0).stop, 'Stop 5 of 5');
});

test('the last stop is an end: Next reads Start again, and a short card offers Share and the agent', async () => {
  const pressed = [], told = [];
  const visit = {
    onStop: (number, count) => told.push(number + '/' + count),
    share: async () => { pressed.push('share'); return 'Link copied.'; },
    contact: Promise.resolve({ name: 'Alex Example', actions: [
      { label: 'Call', href: 'tel:+61400000000', press: () => pressed.push('call') },
      { label: 'Email', href: 'mailto:alex@example.invalid', hrefNow: () => 'mailto:alex@example.invalid?body=stop', press: () => pressed.push('email') },
      { label: 'Run', href: 'javascript:alert(1)' },
    ] }),
  };
  const x = await readyPlayer({ manifest: manifest({ stops: manifest().stops.slice(0, 3) }), startOptions: { visit } });
  const next = byClass(x.stage, 'v2-next'), end = byClass(x.stage, 'v2-end');
  assert.deepEqual(told, ['1/3'], 'the page hears the opening stop once there is something to look at');
  assert.equal(end.hidden, true);
  assert.equal(next.getAttribute('aria-label'), 'Next stop');
  next.click(); next.click();
  assert.equal(x.stopLine(), 'Stop 3 of 3');
  assert.deepEqual(told, ['1/3', '2/3', '3/3']);
  assert.equal(next.getAttribute('aria-label'), 'Start again from the first stop');
  assert.equal(byClass(x.stage, 'v2-label-again').hidden, false);
  assert.equal(next.querySelector('.v2-label').hidden, true, '“Next” steps aside');
  assert.equal(end.hidden, false);
  assert.equal(byClass(end, 'v2-end-title').textContent, 'That’s the last stop.');
  const labels = end.querySelectorAll('button, a').map(node => node.textContent);
  assert.deepEqual(labels, ['Look around again', 'Share', 'Call', 'Email'], 'only tel, mailto and https links are taken');
  const [stay, share, call, email] = end.querySelectorAll('button, a');
  // One filled action in the player at the end: the bar's Start again. Look around again only puts the card away.
  assert.deepEqual(end.querySelectorAll('button, a').map(node => node.className), ['v2-quiet', 'v2-quiet', 'v2-quiet', 'v2-quiet']);
  assert.match(next.className, /\bv2-primary\b/);
  assert.equal(call.getAttribute('aria-label'), 'Call Alex Example');
  email.dispatch('click');
  assert.equal(email.getAttribute('href'), 'mailto:alex@example.invalid?body=stop', 'the address is read at the press');
  share.click();
  await tick();
  assert.deepEqual(pressed, ['email', 'share']);
  assert.equal(x.status(), 'Link copied.');
  // About carries the agent too, for full screen.
  assert.equal(byClass(x.stage, 'v2-contact-name').textContent, 'Contact Alex Example');
  // Look around again puts the card away and stays on the stop; Start again goes to the first.
  stay.click();
  assert.equal(end.hidden, true);
  assert.equal(x.stopLine(), 'Stop 3 of 3');
  next.click();
  assert.equal(x.stopLine(), 'Stop 1 of 3');
  assert.equal(next.getAttribute('aria-label'), 'Next stop');
  assert.equal(end.hidden, true);
});

test('a link to a stop opens there, and says so once: no arrival is announced for a stop that was not seen', async () => {
  const events = [];
  const x = await readyPlayer({ startOptions: { visit: { startAt: 3 } },
    context: { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } } });
  x.document.dispatchEvent = event => { events.push(event.type + ':' + event.detail.stop); };
  assert.equal(x.stopLine(), 'Stop 3 of 5');
  assert.equal(byClass(x.stage, 'v2-end').hidden, true, 'opening on a stop is not arriving at the end');
  // Out of range or not a number: the opening stop.
  for (const startAt of [0, 9, '2', 1.5, null]) assert.equal((await readyPlayer({ startOptions: { visit: { startAt } } })).stopLine(), 'Stop 1 of 5');
});

test('one bar for the whole wait: the first level downloads beside the engine and moves the bar', async () => {
  const files = [{ path: 'lod/lod-meta.json', bytes: 100 }, { path: 'lod/3_0/means.webp', bytes: 600 }, { path: 'lod/3_0/sh0.webp', bytes: 300 },
    { path: 'lod/0_0/means.webp', bytes: 9000 }, { path: '../escape.webp', bytes: 5 }];
  const x = await started({ manifest: manifest({ files }), files: { 'lod/lod-meta.json': {}, 'lod/3_0/means.webp': {}, 'lod/3_0/sh0.webp': {} }, slowEngine: true });
  const fetched = x.log.filter(line => line.startsWith('fetch:')).map(line => line.replace('fetch:https://veylet.com/pkg/', ''));
  assert.deepEqual(fetched.sort(), ['lod/3_0/means.webp', 'lod/3_0/sh0.webp', 'lod/lod-meta.json', 'manifest.json'], 'the coarsest level and its index, nothing finer');
  const progress = byClass(x.stage, 'v2-progress');
  assert.equal(progress.hidden, false, 'the bar shows from the start');
  assert.equal(progress.firstChild.style.transform, 'scaleX(0.600)', 'the files are in; the engine is still to come');
  // With the engine: further along, and nothing was asked for before Explore in a portal's frame.
  const both = await started({ manifest: manifest({ files }), files: { 'lod/lod-meta.json': {}, 'lod/3_0/means.webp': {}, 'lod/3_0/sh0.webp': {} } });
  assert.equal(byClass(both.stage, 'v2-progress').firstChild.style.transform, 'scaleX(0.850)');
  const framed = await started({ manifest: manifest({ files }), startOptions: { waitForTap: true } });
  assert.deepEqual(framed.log.filter(line => line.startsWith('fetch:') && !line.endsWith('manifest.json')), []);
});

test('a first-level file that is missing is tried once more, then the visitor is told', async () => {
  const timers = manualTimers();
  const files = [{ path: 'lod/3_0/means.webp', bytes: 600 }];
  const x = await started({ manifest: manifest({ files }), slowEngine: true, context: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } });
  const tries = () => x.log.filter(line => line === 'fetch:https://veylet.com/pkg/lod/3_0/means.webp').length;
  assert.equal(tries(), 1);
  assert.equal(byClass(x.stage, 'v2-fallback').hidden, true);
  timers.fire(1500);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(tries(), 2);
  timers.fire(0);
  assert.equal(byClass(x.stage, 'v2-fallback').hidden, false);
  assert.match(byClass(x.stage, 'v2-fallback').textContent, /3D didn’t load\./);
});

// ---------- client pages, 10 November 2026, phase 3 ----------

test('no 3D in this browser: the panel names Safari or Chrome and offers the link to take there', async () => {
  const copied = [];
  const x = await started({ env: { ...phoneWebgl2, webgl2: false, webgpu: false },
    context: { navigator: { clipboard: { writeText: async text => { copied.push(text); } } } } });
  await x.pending;
  const fallback = byClass(x.stage, 'v2-fallback');
  assert.match(fallback.textContent, /Try opening this link in Safari or Chrome\./);
  assert.doesNotMatch(fallback.textContent, /hardware acceleration/);
  const copy = fallback.querySelectorAll('button').find(button => button.textContent === 'Copy link');
  assert.ok(copy, 'a Copy link button');
  copy.click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(copied.length, 1);
  assert.equal(byClass(x.stage, 'v2-copy-note').textContent, 'Link copied.');
});

test('About keeps the engine credit behind Credits, marks the keys line, and the map dots take a finger', async () => {
  const x = await readyPlayer();
  const about = byClass(x.stage, 'v2-about');
  const credits = byClass(about, 'v2-credits');
  assert.equal(credits.tagName.toLowerCase(), 'details');
  assert.equal(credits.querySelector('summary').textContent, 'Credits');
  assert.match(credits.textContent, /PlayCanvas engine/);
  assert.match(byClass(about, 'v2-keys').textContent, /^Keys/);
  const hits = byClass(x.stage, 'v2-map').querySelectorAll('.v2-map-hit');
  assert.equal(hits.length, byClass(x.stage, 'v2-map').querySelectorAll('.v2-map-stop').length);
  // A named room marks the stage so a narrow one can drop the third line of the label.
  assert.equal(byClass(x.stage, 'v2').classList.contains('v2-has-room'), true);
  assert.match(read('tour-player-v2.css'), /\.v2-has-room:not\(\.v2-research\) \.v2-truth \{ display: none; \}/);
});

// Replaces 'the hint names the floor only where the walkthrough has one to walk on': the floor is no longer somewhere to go.
test('the hint, About and the canvas name circles, stops and Next, never the floor or walking, with or without a floor mask', async () => {
  const floor = await readyPlayer({ manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': navigationFloor() } });
  const none = await readyPlayer();
  for (const x of [floor, none]) {
    assert.equal(byClass(x.stage, 'v2-hint').textContent, 'Drag to look around. Tap a circle or Next to move.');
    const controls = byClass(x.stage, 'v2-controls').textContent;
    assert.match(controls, /Tap a numbered circle, or Next stop, to move\./);
    assert.match(controls, /Keys: left and right look, up and down go to the stop ahead or behind, N and P change stop/);
    assert.doesNotMatch(controls + x.canvas.getAttribute('aria-label'), /floor|\bwalk\b|walk to|Between stops/i);
  }
  // No sentence in the player tells anyone to tap the floor or walk somewhere.
  assert.doesNotMatch(playerSource, /'[^'\n]*(?:[Tt]ap the floor|open floor|[Cc]an’t walk|Between stops)[^'\n]*'/);
});

function walkedPath(overrides = {}) {
  return {
    version: 1, source: 'capture_poses',
    legs: [
      { from: 's1', to: 's3', points: [[0, 0, 0], [0.5, 0, 0.6], [1.5, 0, 0.6], [2, 0, 0]], length_m: 2.56, max_gap_m: 0.42 },
      { from: 's3', to: 's4', points: [[2, 0, 0], [2.5, 0.02, 0], [3, 0, 0]], length_m: 1.0, max_gap_m: 0.5 },
    ],
    ...overrides,
  };
}
const plainJson = value => JSON.parse(JSON.stringify(value));

// ---------- walked path: bounds, agreement and moves under stress (review of the first slice) ----------

// Five rooms in a row, one chunk each, a stop in each and a walked leg between neighbours.
function chunkedWalk() {
  const COUNTS = [480000, 240000, 120000, 48000];
  const chunk = n => ({ id: 'chunk_' + n, rooms: ['r' + n], adjacent: [n - 1, n + 1].filter(m => m >= 1 && m <= 5).map(m => 'chunk_' + m),
    lod_meta: `lod/chunk_${n}/lod-meta.json`, lod_counts: COUNTS, bounds: { min: [(n - 1) * 4 - 2, -1.5, -3], max: [(n - 1) * 4 + 2.2, 1.5, 3] } });
  const stop = n => ({ id: 's' + n, room: 'r' + n, position: [(n - 1) * 4, 0, 0], target: [(n - 1) * 4, -0.3, -2], floor: [(n - 1) * 4, -1.4, 0], floor_measured: true });
  const leg = n => ({ from: 's' + n, to: 's' + (n + 1), points: [[(n - 1) * 4, 0, 0], [(n - 1) * 4 + 2, 0, 0.3], [n * 4, 0, 0]], length_m: 4.05, max_gap_m: 0.8 });
  const rooms = [1, 2, 3, 4, 5];
  return manifest({
    scene: { lod_meta: 'lod/chunk_1/lod-meta.json', lod_levels: 4, lod_counts: COUNTS, sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d',
      layout: 'chunked', opening_chunk: 'chunk_1', chunks: rooms.map(chunk) },
    rooms: rooms.map(n => ({ id: 'r' + n, name: ['Hall', 'Kitchen', 'Study', 'Bedroom', 'Bath'][n - 1] })),
    stops: rooms.map(stop),
    path: walkedPath({ legs: [1, 2, 3, 4].map(leg) }),
  });
}
// Which chunks the engine holds, from what the stand-in engine was asked to add and destroy.
function heldChunks(log) {
  const held = new Set();
  for (const line of log) {
    const added = line.match(/^gsplat:.*\/(chunk_\d)\//), dropped = line.match(/^destroy:(chunk_\d)$/);
    if (added) held.add(added[1]);
    if (dropped) held.delete(dropped[1]);
  }
  return held;
}
