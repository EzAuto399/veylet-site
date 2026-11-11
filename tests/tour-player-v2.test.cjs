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

test('camera, stop and floor geometry', () => {
  const { player } = load();
  assert.deepEqual([0, 1, 2, 3, 4].map(i => player.stepStop(i, 1, 5)), [1, 2, 3, 4, 0]);
  assert.equal(player.stepStop(0, -1, 5), 4);
  const look = player.lookAngles([0, 0, 0], [1, -1, -1]);
  const forward = player.forwardOf(look.yaw, look.pitch);
  assert.ok(Math.abs(forward[0] - 1 / Math.sqrt(3)) < 1e-9 && Math.abs(forward[1] + 1 / Math.sqrt(3)) < 1e-9);
  // Cover-fitted poster: a tall frame keeps the poster's vertical view; a wide one its horizontal view.
  assert.deepEqual({ ...player.fieldOfView(0.5, { width: 900, height: 1600, fov: 90 }) }, { horizontal: false, fov: 90 });
  const wide = player.fieldOfView(2.4, { width: 1600, height: 900, fov: 70 });
  assert.equal(wide.horizontal, true);
  assert.ok(Math.abs(wide.fov - 2 * Math.atan(Math.tan(35 * Math.PI / 180) * 16 / 9) * 180 / Math.PI) < 1e-9); // 102.4°
  assert.deepEqual([...player.floorHit([0, 0, 0], [0, -1, 0], -1.4)], [0, -1.4, 0]);
  assert.equal(player.floorHit([0, 0, 0], [0, 0.1, -1], -1.4), null);
  // A 3 x 1 m floor split by a wall cell: you can stand on either side, not walk through.
  const bits = [1, 1, 1, 0, 1, 1];
  const mask = Buffer.from([bits.reduce((byte, bit, i) => byte | (bit << i), 0)]).toString('base64');
  const walkable = player.decodeWalkable({ version: 1, cell_metres: 0.5, origin: [0, 0], columns: 6, rows: 1, floor_y: -1.4, eye_height: 1.4, mask });
  assert.equal(walkable.walkable(0.2, 0.2), true);
  assert.equal(walkable.walkable(1.7, 0.2), false);
  assert.equal(walkable.clear([0.2, 0.2], [1.2, 0.2]), true);
  assert.equal(walkable.clear([0.2, 0.2], [2.7, 0.2]), false);
  assert.throws(() => player.decodeWalkable({ version: 1, cell_metres: 0.5, origin: [0, 0], columns: 64, rows: 1, floor_y: 0, eye_height: 1.4, mask }), /walkable-invalid/);
  assert.equal(player.nearestStop(player.validateManifest(manifest()), [1.1, 0, 0.1]), 1);
  assert.equal(player.nearestStop(player.validateManifest(manifest()), [1.5, 0, 0.1]), -1);
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

test('a tap walks to open floor, snaps to floor beside furniture, or walks as far as the floor runs', () => {
  const { player } = load();
  const walkable = player.decodeWalkable(room());
  const from = [0.5, 1.5];
  // Open floor in a straight line: straight there.
  assert.deepEqual([...player.walkTarget(walkable, from, [1.2, 0.5])], [1.2, 0.5]);
  // On the sofa's edge: the nearest open floor within 0.75 m that can be walked to.
  const beside = player.walkTarget(walkable, from, [1.6, 1.5]);
  assert.ok(beside && walkable.walkable(...beside) && Math.hypot(beside[0] - 1.6, beside[1] - 1.5) <= 0.75, String(beside));
  // Deep in the sofa and behind it: as far as the floor runs towards it, short of the sofa.
  const towards = player.walkTarget(walkable, [0.5, 1.5], [2.4, 1.5], { snap: 0.2 });
  assert.ok(towards && towards[0] > 0.8 && towards[0] < 1.5 && Math.abs(towards[1] - 1.5) < 1e-9, String(towards));
  // Past the wall of the room: to the wall, not through it.
  const wall = player.walkTarget(walkable, [0.5, 0.5], [0.5, -3], { snap: 0.2 });
  assert.equal(wall, null); // 0.5 m from the edge, less the margin, is too short a move to count
  const wallFar = player.walkTarget(walkable, [0.5, 2.9], [0.5, -3], { snap: 0.2 });
  assert.ok(wallFar && wallFar[1] >= 0 && wallFar[1] < 0.5, String(wallFar));
  // Facing straight into the sofa from its edge: nothing to walk to.
  assert.equal(player.walkTarget(walkable, [1.45, 1.5], [2.0, 1.5], { snap: 0.2 }), null);
  // Standing a hair off the mask (a stop at the edge of the sofa) still lets you walk away.
  assert.deepEqual([...player.walkTarget(walkable, [1.52, 1.5], [0.5, 1.5])], [0.5, 1.5]);
});

test('where a tap aims: the floor it meets, a clamped point towards a wall, never the ceiling', () => {
  const { player } = load();
  assert.deepEqual([...player.tapAim([0, 0, 0], [0, -1, 0], -1.4)], [0, 0]);
  const level = player.tapAim([0, 0, 0], [0, 0, -1], -1.4, 8);
  assert.deepEqual([...level].map(v => Math.round(v * 1000) / 1000), [0, -8]);
  assert.equal(player.tapAim([0, 0, 0], [0, 0.8, -0.6], -1.4), null);
});

test('a short wobbly touch still walks, and the refusal fits a phone frame on one line', async () => {
  const x = await started({ manifest: manifest({ walkable: { path: 'walkable.json' } }) });
  x.log.length = 0;
  const app = x.engine.apps[0];
  app.systems.gsplat.fire('frame:ready', null, null, false, 1);
  app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  await x.pending;
  const canvas = byClass(x.stage, 'v2-canvas');
  canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, pointerType: 'touch' });
  canvas.dispatch('pointermove', { pointerId: 1, clientX: 110, clientY: 106, pointerType: 'touch' });
  canvas.dispatch('pointerup', { pointerId: 1, clientX: 110, clientY: 106, pointerType: 'touch' });
  // No walkable floor in this package, so the tap is answered with the stops rule.
  const status = byClass(x.stage, 'v2-status').textContent;
  assert.equal(status, 'Tap a circle or Next stop to move.');
  assert.ok(status.length <= 36);
});

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

test('the render loop goes idle after an interrupted flight: a drag, a turn or a new move (VIEWER-08)', async () => {
  const time = clock();
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': navigationFloor() } });
  x.app.systems.gsplat.fire('frame:ready', null, null, false, 2);
  x.app.systems.gsplat.fire('frame:ready', null, null, true, 0);
  assert.equal(x.window.VeyletPlayerV2.current.stats().phase, 'complete');
  // One engine update: does it ask for another frame when nothing moves?
  const renders = () => { x.app.renderNextFrame = false; x.app.fire('update'); return x.app.renderNextFrame; };
  assert.equal(renders(), false, 'at rest nothing is drawn');
  const next = byClass(x.stage, 'v2-next');
  next.click();
  assert.equal(renders(), true, 'a flight draws every frame');
  // A drag takes the camera mid-flight.
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 160, clientY: 100 });
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 160, clientY: 100 });
  assert.equal(renders(), false, 'idle again after a drag cut the flight short');
  // An arrow key turns mid-flight.
  next.click();
  x.canvas.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(renders(), false, 'idle again after a turn cut the flight short');
  // A second move replaces the first before it lands, and then lands.
  next.click(); next.click();
  time.t += 5000;
  x.app.fire('update');
  assert.equal(renders(), false, 'idle again once the replacing flight lands');
});

test('Next and Previous from “Between stops” go on from the nearest stop, not from the first or last (VIEWER-07)', async () => {
  // 6 x 2 m of open floor along the five stops (x 0 to 4 m).
  const columns = 60, rows = 20;
  const open = { version: 1, cell_metres: 0.1, origin: [-1, -1], columns, rows, floor_y: -1.4, eye_height: 1.4,
    mask: Buffer.from(new Uint8Array(Math.ceil(columns * rows / 8)).fill(255)).toString('base64') };
  const x = await readyPlayer({ manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': open } });
  const walkBetween = () => { x.window.VeyletPlayerV2.current.tapAt(340, 0); assert.equal(x.stopLine(), 'Between stops'); };
  // 3.4 m along: stop 4 (3 m) is nearest, stop 5 (4 m) is next, stop 3 (2 m) is behind.
  walkBetween();
  byClass(x.stage, 'v2-next').click();
  assert.equal(x.stopLine(), 'Stop 5 of 5');
  walkBetween();
  byClass(x.stage, 'v2-prev').click();
  assert.equal(x.stopLine(), 'Stop 3 of 5');
  walkBetween();
  x.canvas.dispatch('keydown', { key: 'n' });
  assert.equal(x.stopLine(), 'Stop 5 of 5');
  walkBetween();
  x.canvas.dispatch('keydown', { key: 'p' });
  assert.equal(x.stopLine(), 'Stop 3 of 5');
});

test('a phone-sized stage (334 x 300) still gets a one-line movement hint, and Next keeps its name and a short label (VIEWER-02)', async () => {
  const x = await readyPlayer({ size: [334, 300] });
  const hint = byClass(x.stage, 'v2-hint');
  assert.equal(hint.hidden, false, 'the first view says how to move');
  assert.equal(hint.textContent, 'Drag to look. Tap to move.');
  assert.ok(hint.className.includes('v2-hint-short'));
  // A roomy stage keeps the full sentence.
  const roomy = await readyPlayer();
  // This package has no floor to walk on, so the sentence names only what is there: dragging and Next.
  assert.equal(byClass(roomy.stage, 'v2-hint').textContent, 'Drag to look around. Use Next for the next stop.');
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

test('a clear measured-floor stop route still animates, while reduced motion lands immediately', async () => {
  for (const reduced of [false, true]) {
    const time = clock(), data = manifest({ walkable: { path: 'walkable.json' } });
    const x = await readyPlayer({ reduced, context: { performance: time }, manifest: data, files: { 'walkable.json': navigationFloor() } });
    const controller = x.window.VeyletPlayerV2.current;
    controller.goToStop(2); time.t += 400; x.app.fire('update');
    const state = controller.inspect().state;
    if (reduced) assert.deepEqual([...state.position], data.stops[2].position);
    else assert.ok(state.position[0] > 0 && state.position[0] < 2, 'a known clear route retains interpolation');
    time.t += 5000; x.app.fire('update');
    assert.deepEqual([...controller.inspect().state.position], data.stops[2].position);
  }
});

test('Walkthrough 2.0: room pill scrubber, destination hotspot labels, station tether, and adaptive DPR 2.0 step-up', async () => {
  const { player } = load();
  // 1. Adaptive DPR 2.0 step-up on capable phones with sustained >55 fps headroom.
  const phone = player.deviceProfile(phoneWebgl2);
  assert.equal(phone.maxPixelRatio, 1.5);
  assert.equal(phone.peakPixelRatio, 2);
  const gov = player.createGovernor(phone);
  let now = 1000;
  for (const end = now + 30_000; now < end;) {
    now += 14; // ~71 fps
    gov.sample(14, now);
  }
  assert.equal(gov.state.pixelRatio, 2, 'sustained >55 fps headroom steps DPR up to peakPixelRatio 2.0');

  // 2. Station tether keeps floor taps within the 0.85m corridor around stops and segments.
  const walkable = player.decodeWalkable(navigationFloor());
  const stops = manifest().stops;
  const corridorPt = player.tetherToStations(walkable, [0, 0], [3.4, 0], stops);
  assert.deepEqual([...corridorPt], [3.4, 0], 'point along stop corridor remains untouched');
  const nearStopPt = player.tetherToStations(walkable, [0, 0], [2.15, 0.1], stops);
  assert.deepEqual([...nearStopPt], [2, 0], 'tap within 0.3m of a stop snaps cleanly to the stop');
  const farSidePt = player.tetherToStations(walkable, [2, 0], [2, 0.98], stops);
  assert.ok(Math.abs(farSidePt[0] - 2) < 1e-6 && Math.abs(farSidePt[1] - 0.85) < 1e-6, 'far sideways tap is tethered to 0.85m radius');

  // 3. Multi-room walkthrough renders 1-tap room pills and labels destination hotspots.
  const multiRoom = manifest({
    rooms: [{ id: 'r1', name: 'Living' }, { id: 'r2', name: 'Kitchen' }, { id: 'r3', name: 'Bedroom' }],
    stops: [
      { id: 's1', room: 'r1', position: [0, 0, 0], target: [0, 0, -2], floor: [0, -1.4, 0], floor_measured: true },
      { id: 's2', room: 'r2', position: [0, 0, -2], target: [0, 0, -4], floor: [0, -1.4, -2], floor_measured: true },
      { id: 's3', room: 'r3', position: [0, 0, -4], target: [0, 0, -6], floor: [0, -1.4, -4], floor_measured: true },
    ],
  });
  const x = await readyPlayer({ manifest: multiRoom });
  const pillsBar = byClass(x.stage, 'v2-room-pills');
  assert.equal(pillsBar.hidden, false);
  const pills = pillsBar.querySelectorAll('.v2-room-pill');
  assert.deepEqual(pills.map(p => p.textContent), ['Living', 'Kitchen', 'Bedroom']);
  assert.equal(pills[0].getAttribute('aria-current'), 'true');
  const hotspots = x.stage.querySelectorAll('.v2-hotspot');
  assert.equal(hotspots[1].dataset.next, 'true');
  assert.equal(hotspots[1].dataset.roomLabel, 'Kitchen');
  pills[2].click();
  assert.equal(byClass(x.stage, 'v2-room').textContent, 'Bedroom');
  assert.equal(pills[2].getAttribute('aria-current'), 'true');
  assert.equal(pills[0].getAttribute('aria-current'), null);
});

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

test('360 rotation and movement stability: radialSorting, lodBehindPenalty=1, colorUpdateAngle=2, idle-gap governor immunity, and tethered stepForward', async () => {
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

  // Stepping perpendicular to the station line (yaw = -90 looks along +X, so yaw = 0 looks along -Z) is tethered within 0.85 m of the stop line (z = 0).
  for (let i = 0; i < 5; i++) x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  const pos = x.window.VeyletPlayerV2.current.inspect().state.position;
  assert.ok(Math.abs(pos[2]) <= 0.85 + 1e-6, `stepForward stays tethered within 0.85 m of the station corridor, got z=${pos[2]}`);
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
  const events = [];
  const x = await started({ manifest: raw, context: { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } } });
  x.document.dispatchEvent = event => { events.push([event.type, { ...event.detail }]); };
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

test('view() answers stop -1 while a move is under way, so no look is counted against a stop in passing', async () => {
  const time = clock();
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': navigationFloor() } });
  const controller = x.window.VeyletPlayerV2.current;
  assert.equal(controller.view().stop, 0);
  byClass(x.stage, 'v2-next').click();
  assert.equal(controller.view().stop, -1, 'in flight');
  time.t += 60000;
  x.app.fire('update');
  assert.equal(controller.view().stop, 1, 'arrived');
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
  assert.deepEqual([...new Set(stored)], ['veylet:stop'], 'what it says goes to the page as a DOM event only');
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

test('the hint names the floor only where the walkthrough has one to walk on', async () => {
  const floor = await readyPlayer({ manifest: manifest({ walkable: { path: 'walkable.json' } }), files: { 'walkable.json': navigationFloor() } });
  assert.equal(byClass(floor.stage, 'v2-hint').textContent, 'Drag to look around. Tap the floor to move. Use Next for the next stop.');
  const none = await readyPlayer();
  assert.equal(byClass(none.stage, 'v2-hint').textContent, 'Drag to look around. Use Next for the next stop.');
});

// ---------- the path walked at capture (manifest.path, optional) ----------

// Five stops on a line 1 m apart (manifest()); a leg s1→s3 that curves 0.6 m to the side, and a straight leg s3→s4.
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

test('a valid walked path is accepted and exposed; old packages have none', () => {
  const { player } = load();
  const data = player.validateManifest(manifest({ path: walkedPath() }));
  assert.deepEqual(plainJson(data.path.legs.map(leg => [leg.from, leg.to, leg.fromIndex, leg.toIndex, Math.round(leg.length * 1000) / 1000, leg.points.length])),
    [['s1', 's3', 0, 2, 2.562, 4], ['s3', 's4', 2, 3, 1.001, 3]], 'lengths are the points\' own');
  assert.equal('path' in player.validateManifest(manifest()), false, 'no path: the manifest reads exactly as before');
});

test('any invalid walked path is dropped whole, never refusing the tour', () => {
  const { player } = load();
  const leg = walkedPath().legs[0];
  const withLeg = change => walkedPath({ legs: [{ ...leg, ...change }] });
  const line = Array.from({ length: 12 }, (_, i) => ({ id: 's' + (i + 1), room: 'r1', position: [i / 2, 0, 0], target: [i / 2, -0.3, -2], floor: [i / 2, -1.4, 0], floor_measured: true }));
  const pairs = [];
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) pairs.push({ from: line[a].id, to: line[b].id, points: [line[a].position, [(a + b) / 4, 0, 0.1], line[b].position], length_m: (b - a) / 2, max_gap_m: 0.5 });
  // The limit itself: 59 distinct legs are a path, 60 are not.
  assert.equal(player.validateManifest(manifest({ stops: line, path: walkedPath({ legs: pairs.slice(0, 59) }) })).path.legs.length, 59);
  const cases = {
    'points not an array': withLeg({ points: 'not-points' }),
    'one point': withLeg({ points: [[0, 0, 0]] }),
    '65 points': withLeg({ points: [[0, 0, 0], ...Array.from({ length: 63 }, (_, i) => [i / 32, 0, 0.5]), [2, 0, 0]] }),
    'NaN coordinate': withLeg({ points: [[0, 0, 0], [1, NaN, 0.5], [2, 0, 0]] }),
    'unknown stop id': withLeg({ to: 's9' }),
    'unknown version': walkedPath({ version: 2 }),
    'start 0.06 m from its stop': withLeg({ points: [[0.06, 0, 0], [1, 0, 0.5], [2, 0, 0]] }),
    'end 0.06 m from its stop': withLeg({ points: [[0, 0, 0], [1, 0, 0.5], [2, 0, 0.06]] }),
    '60 legs': walkedPath({ legs: pairs.slice(0, 60) }),
    'not an object': 'path',
    'no legs': walkedPath({ legs: [] }),
  };
  for (const [name, path] of Object.entries(cases)) {
    let data;
    assert.doesNotThrow(() => { data = player.validateManifest(manifest({ stops: name === '60 legs' ? line : manifest().stops, path })); }, name);
    assert.equal(data.path, undefined, name);
    assert.equal(data.stops.length, name === '60 legs' ? 12 : 5, name);
  }
  // 0.04 m off is within the contract's 0.05 m.
  assert.equal(player.validateManifest(manifest({ path: withLeg({ points: [[0.04, 0, 0], [1, 0, 0.5], [2, 0, 0]] }) })).path.legs.length, 1);
});

test('a move picks the leg, the leg reversed, the shorter chain of legs, or nothing', () => {
  const { player } = load();
  const data = player.validateManifest(manifest({ path: walkedPath() }));
  const route = (from, to) => plainJson(player.pathRoute(data.path, data.stops, from, to));
  assert.deepEqual(route(0, 2), [[0, 0, 0], [0.5, 0, 0.6], [1.5, 0, 0.6], [2, 0, 0]]);
  assert.deepEqual(route(2, 0), [[2, 0, 0], [1.5, 0, 0.6], [0.5, 0, 0.6], [0, 0, 0]], 'legs are walked either way');
  assert.deepEqual(route(0, 3), [[0, 0, 0], [0.5, 0, 0.6], [1.5, 0, 0.6], [2, 0, 0], [2.5, 0.02, 0], [3, 0, 0]], 'a chain of two legs');
  assert.equal(player.pathRoute(data.path, data.stops, 0, 1), null, 'no leg reaches s2');
  assert.equal(player.pathRoute(data.path, data.stops, 0, 0), null);
  // Two chains from s1 to s4: s1→s2→s4 (1 + 3.61 m) and s1→s3→s4 (2.56 + 1 m); the shorter wins.
  const both = player.validateManifest(manifest({ path: walkedPath({ legs: [...walkedPath().legs,
    { from: 's1', to: 's2', points: [[0, 0, 0], [1, 0, 0]], length_m: 1, max_gap_m: 1 }, { from: 's2', to: 's4', points: [[1, 0, 0], [2, 0, -1.5], [3, 0, 0]], length_m: 3.6, max_gap_m: 1 }] }) }));
  assert.deepEqual(plainJson(player.pathRoute(both.path, both.stops, 0, 3)).map(p => p[2]), [0, 0.6, 0.6, 0, 0, 0]);
  const shortcut = player.validateManifest(manifest({ path: walkedPath({ legs: [...walkedPath().legs,
    { from: 's1', to: 's2', points: [[0, 0, 0], [1, 0, 0]], length_m: 1, max_gap_m: 1 }, { from: 's2', to: 's4', points: [[1, 0, 0], [2, 0, -0.2], [3, 0, 0]], length_m: 2.04, max_gap_m: 1 }] }) }));
  assert.deepEqual(plainJson(player.pathRoute(shortcut.path, shortcut.stops, 0, 3)).map(p => p[2]), [0, 0, -0.2, 0], 'then 1 + 2.04 m is shorter');
});

test('walking pace: about 1.4 m/s, never under 0.9 s or over 5 s, easing in and out', () => {
  const { player } = load();
  assert.ok(Math.abs(player.walkDuration(4.31) - 4.31 / 1.4 * 1000) < 1e-6, '4.31 m walks in about 3.1 s');
  assert.equal(player.walkDuration(0.5), 900);
  assert.equal(player.walkDuration(20), 5000, 'a long chain walks faster to fit 5 s');
  assert.equal(player.walkEase(0), 0);
  assert.equal(player.walkEase(1), 1);
  let previous = 0, steps = [];
  for (let i = 1; i <= 100; i++) { const k = player.walkEase(i / 100); steps.push(k - previous); previous = k; }
  assert.ok(steps[0] < steps[50] / 5 && steps[99] < steps[50] / 5, 'slow at both ends');
  assert.ok(Math.abs(steps[40] - steps[60]) < 1e-9, 'an even pace in the middle');
});

test('the walk stays on the polyline, reaches the stop exactly and turns smoothly through a corner', () => {
  const { player } = load();
  const points = [[0, 0, 0], [2, 0.1, 0], [2, 0, -2], [3.3, 0, -2.4]];
  const walk = player.walkPath(points);
  const offLine = p => Math.min(...points.slice(1).map((b, i) => {
    const a = points[i], ab = b.map((v, k) => v - a[k]), len2 = ab.reduce((s, v) => s + v * v, 0);
    const t = Math.max(0, Math.min(1, p.reduce((s, v, k) => s + (v - a[k]) * ab[k], 0) / len2));
    return Math.hypot(...p.map((v, k) => v - (a[k] + ab[k] * t)));
  }));
  for (let i = 0; i <= 400; i++) assert.ok(offLine(walk.at(i / 400).position) < 1e-9, `share ${i / 400} is on the path`);
  assert.deepEqual(plainJson(walk.at(1).position), points[3]);
  assert.deepEqual(plainJson(walk.at(0).position), points[0]);
  assert.ok(Math.abs(walk.at(0.5).position[1] - 0.025) < 0.05, 'eye height follows the points');
  // Heading: +X first (yaw -90), then -Z (yaw 0) once clear of the corner.
  // Continuous: halving the step halves the largest change (a snap at the vertex would not shrink).
  const largestStep = n => { let most = 0; for (let i = 1; i <= n; i++) most = Math.max(most, Math.abs(walk.at(i / n).yaw - walk.at((i - 1) / n).yaw)); return most; };
  assert.ok(largestStep(400) < 2 && largestStep(1600) < 0.6, `largest heading steps ${largestStep(400)}°, ${largestStep(1600)}°`);
  assert.ok(Math.abs(walk.at(0.05).yaw - -90) < 1e-6 && Math.abs(walk.at(0.56).yaw - 0) < 1e-6, 'straight runs look straight ahead');
  // The look over the whole move: from the stop's look to the travel heading to the next stop's opening look.
  const from = { yaw: 170, pitch: -10 }, to = { yaw: 200, pitch: -5 };
  let look = player.walkLook(walk, 0, from, to);
  assert.deepEqual([look.yaw, look.pitch], [170, -10]);
  let jump = 0;
  for (let i = 1; i <= 1000; i++) {
    const next = player.walkLook(walk, i / 1000, from, to);
    jump = Math.max(jump, Math.abs(next.yaw - look.yaw), Math.abs(next.pitch - look.pitch));
    look = next;
  }
  assert.ok(jump < 2, `largest look step ${jump}° per 0.1% of the move`);
  assert.ok(Math.abs(((look.yaw - 200) % 360 + 360) % 360) < 1e-6 && Math.abs(look.pitch + 5) < 1e-9, 'ends on the next stop\'s opening look');
  const mid = player.walkLook(walk, 0.5, from, to);
  assert.ok(Math.abs(((mid.yaw - walk.at(player.walkEase(0.5)).yaw) % 360 + 540) % 360 - 180) < 1e-6 && mid.pitch === 0, 'looks level along the way');
});

test('free walk is tethered to the walked leg, not the straight line, where a leg exists', () => {
  const { player } = load();
  const stops = [
    { id: 's1', position: [0, 0, 0] },
    { id: 's2', position: [4, 0, 0] },
  ];
  // The person walked round something: 1.5 m to the side of the straight line at its middle.
  const legs = [{ from: 's1', to: 's2', points: [[0, 0, 0], [0.5, 0, 1.2], [1, 0, 1.5], [3, 0, 1.5], [3.5, 0, 1.2], [4, 0, 0]] }];
  const offLeg = [2, 2.0]; // 0.5 m off the leg, 2 m off the straight line
  const offLine = [2, -0.5]; // 0.5 m off the straight line, 2 m off the leg
  assert.deepEqual(plainJson(player.tetherToStations(null, [0, 0], offLeg, stops, { legs })), offLeg, 'beside the walked leg: kept');
  const pulled = player.tetherToStations(null, [0, 0], offLine, stops, { legs });
  assert.ok(Math.abs(pulled[0] - 2) < 1e-9 && Math.abs(pulled[1] - 0.65) < 1e-9, 'beside the unwalked straight line: drawn back to 0.85 m of the leg');
  // Without a path, today's corridor: the straight line.
  assert.deepEqual(plainJson(player.tetherToStations(null, [0, 0], offLine, stops)), offLine);
  const old = player.tetherToStations(null, [0, 0], offLeg, stops);
  assert.ok(Math.abs(old[1] - 0.85) < 1e-9);
  // A pair with no leg keeps its straight line.
  const three = [...stops, { id: 's3', position: [4, 0, -4] }];
  assert.deepEqual(plainJson(player.tetherToStations(null, [0, 0], [4.5, -2], three, { legs })), [4.5, -2]);
});

test('stop to stop along the walked path, from Next, numbers and goToStop; no leg moves as before', async () => {
  const time = clock(), data = manifest({ path: walkedPath() });
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data });
  const controller = x.window.VeyletPlayerV2.current;
  controller.goToStop(2);
  let seen = controller.inspect();
  assert.equal(seen.move.route, 'path');
  assert.equal(seen.move.moving, true);
  assert.ok(Math.abs(seen.move.duration - 2.56 / 1.4 * 1000) < 50, `duration ${seen.move.duration}`);
  assert.equal(controller.view().stop, -1, 'moving');
  time.t += seen.move.duration / 2; x.app.fire('update');
  const middle = controller.inspect().state.position;
  assert.ok(Math.abs(middle[2] - 0.6) < 1e-9 && middle[0] > 0.5 && middle[0] < 1.5, `on the walked leg, not the straight line: ${middle}`);
  time.t += 6000; x.app.fire('update');
  seen = controller.inspect();
  assert.deepEqual(plainJson(seen.state.position), data.stops[2].position);
  const look = x.player.lookAngles(data.stops[2].position, data.stops[2].target);
  assert.ok(Math.abs(((seen.state.yaw - look.yaw) % 360 + 360) % 360) < 1e-6 && Math.abs(seen.state.pitch - look.pitch) < 1e-9);
  assert.equal(seen.state.stop, 2);
  assert.equal(seen.move.moving, false);
  assert.equal(x.stopLine(), 'Stop 3 of 5');
  // Next (s3 → s4) has a leg too.
  byClass(x.stage, 'v2-next').click();
  assert.equal(controller.inspect().move.route, 'path');
  time.t += 6000; x.app.fire('update');
  assert.equal(x.stopLine(), 'Stop 4 of 5');
  // A drag during a walk stops it where it is, as a drag stops any move.
  controller.goToStop(0);
  time.t += 500; x.app.fire('update');
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 140, clientY: 100 });
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 140, clientY: 100 });
  const held = [...controller.inspect().state.position];
  time.t += 6000; x.app.fire('update');
  assert.deepEqual([...controller.inspect().state.position], held, 'a cut-short walk does not resume');
  assert.equal(controller.inspect().move.moving, false);
  // s4 → s5: no leg, so today's move (no floor mask: a cut).
  controller.goToStop(3); time.t += 6000; x.app.fire('update');
  controller.goToStop(4);
  assert.equal(controller.inspect().move.route, 'direct');
  assert.deepEqual(plainJson(controller.inspect().state.position), data.stops[4].position);
});

test('reduced motion lands a walked-path move at once, and a path never changes moves on a floor mask without legs', async () => {
  const data = manifest({ path: walkedPath() });
  const x = await readyPlayer({ reduced: true, manifest: data });
  const controller = x.window.VeyletPlayerV2.current;
  controller.goToStop(2);
  assert.equal(controller.inspect().move.route, 'path');
  assert.deepEqual(plainJson(controller.inspect().state.position), data.stops[2].position);
  assert.equal(controller.view().stop, 2);
  const time = clock();
  const masked = await readyPlayer({ reduced: false, context: { performance: time }, manifest: manifest({ walkable: { path: 'walkable.json' }, path: walkedPath() }), files: { 'walkable.json': navigationFloor() } });
  const mc = masked.window.VeyletPlayerV2.current;
  mc.goToStop(1);
  assert.equal(mc.inspect().move.route, 'mask', 's1 → s2 has no leg: over the floor mask as before');
  assert.equal(mc.inspect().move.duration, 450 + 1 * 220);
});

// ---------- walked path: bounds, agreement and moves under stress (review of the first slice) ----------

test('a walked path with a point far outside the home, a huge step or a runaway length is dropped', () => {
  const { player } = load();
  const leg = walkedPath().legs[0];
  const withLeg = change => walkedPath({ legs: [{ ...leg, ...change }] });
  const stepsOut = [[0, 0, 0]];
  for (let i = 1; i <= 26; i++) stepsOut.push([0, 0, i * 2.5]); // 65 m out in 2.5 m steps
  for (let i = 25; i >= 1; i--) stepsOut.push([2, 0, i * 2.5]);
  stepsOut.push([2, 0, 0]);
  const outLength = stepsOut.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - stepsOut[i][k])), 0);
  const cases = {
    '1e308 coordinate': withLeg({ points: [[0, 0, 0], [1e308, 0, 0], [2, 0, 0]] }),
    'a 6 m step': withLeg({ points: [[0, 0, 0], [1, 0, 5.9], [2, 0, 0]], length_m: 11.9 }),
    'a point 65 m from every stop': withLeg({ points: stepsOut, length_m: outLength }),
  };
  for (const [name, path] of Object.entries(cases)) {
    let data;
    assert.doesNotThrow(() => { data = player.validateManifest(manifest({ path })); }, name);
    assert.equal(data.path, undefined, name);
  }
  // The same detour kept within 50 m of the stops (45 m out) is a path.
  const near = [[0, 0, 0], ...Array.from({ length: 18 }, (_, i) => [0, 0, (i + 1) * 2.5]), ...Array.from({ length: 18 }, (_, i) => [2, 0, (18 - i) * 2.5]), [2, 0, 0]];
  const nearLength = near.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - near[i][k])), 0);
  assert.equal(player.validateManifest(manifest({ path: withLeg({ points: near, length_m: nearLength }) })).path.legs.length, 1);
});

test('length_m must agree with the points, and max_gap_m must be 0 to 1 m', () => {
  const { player } = load();
  const leg = walkedPath().legs[0]; // the points measure 2.562 m
  const short = walkedPath().legs[1]; // the points measure 1.001 m
  const kept = change => player.validateManifest(manifest({ path: walkedPath({ legs: [{ ...leg, ...change }, short] }) })).path !== undefined;
  const keptShort = change => player.validateManifest(manifest({ path: walkedPath({ legs: [leg, { ...short, ...change }] }) })).path !== undefined;
  assert.equal(kept({ length_m: 3.18 }), true, 'within 25 %');
  assert.equal(kept({ length_m: 3.3 }), false, 'more than 25 % long');
  assert.equal(kept({ length_m: 1.9 }), false, 'more than 25 % short');
  assert.equal(keptShort({ length_m: 1.24 }), true, 'a short leg may be 0.25 m out');
  assert.equal(keptShort({ length_m: 1.3 }), false);
  assert.equal(kept({ length_m: '2.56' }), false);
  assert.equal(kept({ max_gap_m: 1 }), true);
  assert.equal(kept({ max_gap_m: 0 }), true);
  for (const gap of [undefined, 1.2, -0.1, NaN, '0.4']) assert.equal(kept({ max_gap_m: gap }), false, String(gap));
  // Route choice uses the points' length: a leg claiming 2 m while measuring 2.56 m still counts as 2.56 m.
  const data = player.validateManifest(manifest({ path: walkedPath({ legs: [{ ...leg, length_m: 2 }, short] }) }));
  assert.ok(Math.abs(data.path.legs[0].length - 2.562) < 0.001);
});

test('two different stop pairs never share a key, whatever the ids contain', () => {
  const { player } = load();
  const stops = ['a b', 'c', 'a', 'b c'].map((id, i) => ({ id, position: [i, 0, 0] }));
  const legs = [
    { from: 'a b', to: 'c', points: [[0, 0, 0], [1, 0, 0]], length_m: 1, max_gap_m: 1 },
    { from: 'a', to: 'b c', points: [[2, 0, 0], [3, 0, 0]], length_m: 1, max_gap_m: 1 },
  ];
  assert.equal(player.readPath({ version: 1, source: 'capture_poses', legs }, stops).legs.length, 2);
  assert.equal(player.readPath({ version: 1, source: 'capture_poses', legs: [legs[0], { ...legs[0], from: 'c', to: 'a b' }] }, stops), null, 'the same pair twice');
});

test('reduced motion: a walked-path move is reported as a cut, an animated one is not', async () => {
  const data = manifest({ path: walkedPath() });
  const still = await readyPlayer({ reduced: true, manifest: data });
  still.window.VeyletPlayerV2.current.goToStop(2);
  const cut = plainJson(still.window.VeyletPlayerV2.current.inspect().move);
  assert.deepEqual([cut.route, cut.cut, cut.moving, cut.duration], ['path', true, false, 0]);
  const time = clock();
  const moving = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data });
  moving.window.VeyletPlayerV2.current.goToStop(2);
  const walk = plainJson(moving.window.VeyletPlayerV2.current.inspect().move);
  assert.deepEqual([walk.route, walk.cut, walk.moving], ['path', false, true]);
  moving.window.VeyletPlayerV2.current.goToStop(4); // no leg, no floor mask: today's cut
  assert.deepEqual(plainJson(moving.window.VeyletPlayerV2.current.inspect().move).cut, true);
});

test('where a leg doubles back the look swings at no more than 180°/s instead of snapping', async () => {
  const time = clock();
  // s1 → s2 walked past s2 to 2.5 m and back: the direction of travel reverses.
  const data = manifest({ path: walkedPath({ legs: [{ from: 's1', to: 's2', points: [[0, 0, 0], [2.5, 0, 0], [1, 0, 0]], length_m: 4, max_gap_m: 0.5 }] }) });
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data });
  const controller = x.window.VeyletPlayerV2.current;
  controller.goToStop(1);
  let previous = controller.inspect().state.yaw, largest = 0, frames = 0;
  while (controller.inspect().move.moving) {
    time.t += 16; x.app.fire('update'); frames++;
    const state = controller.inspect().state;
    if (controller.inspect().move.moving) largest = Math.max(largest, Math.abs(state.yaw - previous));
    previous = state.yaw;
  }
  assert.ok(frames > 100, `${frames} frames`);
  assert.ok(largest <= 180 * 0.016 + 1e-9, `largest turn in a 16 ms frame: ${largest}°`);
  const look = x.player.lookAngles(data.stops[1].position, data.stops[1].target);
  assert.deepEqual(plainJson(controller.inspect().state.position), data.stops[1].position);
  assert.ok(Math.abs(((controller.inspect().state.yaw - look.yaw) % 360 + 360) % 360) < 1e-6, 'still ends on the stop\'s look');
});

test('a walk cut short by a drag or a second move leaves a usable viewer; a start off the stop falls back', async () => {
  const time = clock(), data = manifest({ path: walkedPath() });
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data });
  const controller = x.window.VeyletPlayerV2.current;
  // A second move mid-walk: the camera is now over a metre from s1, so s1 → s4 (a chain) is not walked from here.
  controller.goToStop(2);
  time.t += 900; x.app.fire('update');
  assert.ok(Math.hypot(...controller.inspect().state.position) > 0.35);
  controller.goToStop(3);
  assert.equal(controller.inspect().move.route, 'direct');
  assert.deepEqual(plainJson(controller.inspect().state.position), data.stops[3].position);
  assert.equal(x.stopLine(), 'Stop 4 of 5');
  byClass(x.stage, 'v2-prev').click(); // s4 → s3 has a leg
  assert.equal(controller.inspect().move.route, 'path');
  time.t += 300; x.app.fire('update');
  // A drag mid-walk stops it; Next still works from there.
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 160, clientY: 100 });
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 160, clientY: 100 });
  assert.equal(controller.inspect().move.moving, false);
  assert.ok(controller.inspect().state.position.every(Number.isFinite));
  byClass(x.stage, 'v2-next').click();
  time.t += 6000; x.app.fire('update');
  assert.equal(x.stopLine(), 'Stop 5 of 5');
  assert.deepEqual(plainJson(controller.inspect().state.position), data.stops[4].position);
  assert.equal(controller.view().stop, 4);
});

test('a floor tap beside the walked leg is kept, through the tap handler; without a path it is drawn to the straight line', async () => {
  const columns = 60, rows = 40, bits = new Uint8Array(Math.ceil(columns * rows / 8)).fill(255);
  const floor = { version: 1, cell_metres: 0.1, origin: [-1, -1], columns, rows, floor_y: -1.4, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
  for (const withPath of [true, false]) {
    const x = await readyPlayer({ reduced: true, manifest: manifest({ walkable: { path: 'walkable.json' }, ...(withPath ? { path: walkedPath() } : {}) }), files: { 'walkable.json': floor } });
    // The stand-in camera aims a tap at (x, y) straight down at floor point (x / 100, y / 100): (1, 1.3) here,
    // 0.7 m from the s1 → s3 leg (which bulges to z 0.6) and 1.3 m from the straight line of stops.
    x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 130, pointerType: 'mouse' });
    x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 100, clientY: 130, pointerType: 'mouse' });
    const at = x.window.VeyletPlayerV2.current.inspect().state.position;
    assert.ok(Math.abs(at[0] - 1) < 1e-9 && Math.abs(at[2] - (withPath ? 1.3 : 0.75)) < 1e-9, `${withPath ? 'with' : 'without'} a path: ${at}`);
  }
});

test('chunked home: a walk through another room loads that room as it starts; far rooms go on arrival', async () => {
  const COUNTS = [480000, 240000, 120000, 48000];
  const chunk = n => ({ id: 'chunk_' + n, rooms: ['r' + n], adjacent: [n - 1, n + 1].filter(m => m >= 1 && m <= 4).map(m => 'chunk_' + m),
    lod_meta: `lod/chunk_${n}/lod-meta.json`, lod_counts: COUNTS, bounds: { min: [(n - 1) * 4 - 2, -1.5, -3], max: [(n - 1) * 4 + 2.2, 1.5, 3] } });
  const stop = n => ({ id: 's' + n, room: 'r' + n, position: [(n - 1) * 4, 0, 0], target: [(n - 1) * 4, -0.3, -2], floor: [(n - 1) * 4, -1.4, 0], floor_measured: true });
  const leg = n => ({ from: 's' + n, to: 's' + (n + 1), points: [[(n - 1) * 4, 0, 0], [(n - 1) * 4 + 2, 0, 0.3], [n * 4, 0, 0]], length_m: 4.05, max_gap_m: 0.8 });
  const data = manifest({
    scene: { lod_meta: 'lod/chunk_1/lod-meta.json', lod_levels: 4, lod_counts: COUNTS, sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d',
      layout: 'chunked', opening_chunk: 'chunk_1', chunks: [1, 2, 3, 4].map(chunk) },
    rooms: [1, 2, 3, 4].map(n => ({ id: 'r' + n, name: ['Hall', 'Kitchen', 'Study', 'Bedroom'][n - 1] })),
    stops: [1, 2, 3, 4].map(stop),
    path: walkedPath({ legs: [1, 2, 3].map(leg) }),
  });
  const time = clock();
  const x = await readyPlayer({ reduced: false, context: { performance: time }, manifest: data });
  const settle = () => { x.app.systems.gsplat.fire('frame:ready', null, null, false, 2); x.app.systems.gsplat.fire('frame:ready', null, null, true, 0); };
  settle(); settle(); // neighbours, then detail
  const chunkLoads = lines => lines.filter(line => /^gsplat:.*chunk_\d/.test(line)).map(line => line.match(/chunk_\d/)[0]);
  assert.deepEqual(chunkLoads(x.log), ['chunk_1', 'chunk_2']);
  const mark = x.log.length;
  x.window.VeyletPlayerV2.current.goToStop(3); // Hall → Kitchen → Study → Bedroom
  assert.equal(x.window.VeyletPlayerV2.current.inspect().move.route, 'path');
  assert.deepEqual(chunkLoads(x.log.slice(mark)).sort(), ['chunk_3', 'chunk_4'], 'the Study, walked through, loads as the walk starts');
  time.t += 6000; x.app.fire('update');
  assert.equal(x.stopLine(), 'Stop 4 of 4');
  const gone = x.log.slice(mark).filter(line => line.startsWith('destroy:chunk_'));
  assert.deepEqual(gone.sort(), ['destroy:chunk_1', 'destroy:chunk_2'], 'on arrival, rooms two doorways back are let go as before');
});
