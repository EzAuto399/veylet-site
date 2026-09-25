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
      if (type === 'camera') this.camera = { ...data, fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200, worldToScreen: (w, s) => s.set(100, 100, 1) };
      if (type === 'gsplat') {
        this.gsplat = new Proxy({ lodRangeMin: 0, lodRangeMax: 99 }, { set(t, k, v) { t[k] = v; log.push(`gsplat.${String(k)}=${v}`); return true; } });
        log.push('gsplat:' + data.asset.file.url);
      }
    }
    setPosition(...p) { this.position = p; } setEulerAngles(...a) { this.angles = a; } setLocalEulerAngles(...a) { this.local = a; }
  }
  class Asset extends Emitter { constructor(name, type, file) { super(); this.file = file; } }
  const engine = { apps: [] };
  class Application extends Emitter {
    constructor(canvas, { graphicsDevice }) {
      super();
      this.graphicsDevice = graphicsDevice; this.scene = { gsplat: {} }; this.root = { addChild() {} };
      this.assets = { add: () => {}, load: () => log.push('asset.load') };
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

function load({ files = {}, reduced = true } = {}) {
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
  };
  vm.runInNewContext(playerSource, context);
  const stage = document.createElement('div');
  stage.clientWidth = 390; stage.clientHeight = 700; stage.hidden = true;
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
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgpu: true }).budget, 1_000_000);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, memory: 3 }).budget, 350_000);
  const desktop = player.deviceProfile({ screenWidth: 1920, screenHeight: 1080, dpr: 2, webgl2: true, webgpu: true });
  assert.deepEqual([desktop.kind, desktop.budget, desktop.maxPixelRatio], ['desktop', 3_000_000, 2]);
  assert.equal(player.deviceProfile({ ...phoneWebgl2, webgl2: false }).api, null);
  const counts = [524921, 262461, 131230, 52492];
  assert.equal(player.detailLevel(counts, 3_000_000), 0);
  assert.equal(player.detailLevel(counts, 500_000), 1);
  assert.equal(player.detailLevel(counts, 150_000), 2);
  assert.equal(player.detailLevel(counts, 10_000), 3);
});

test('a slow device gives back pixels first, then splats; a fast one earns splats back', () => {
  const { player } = load();
  const governor = player.createGovernor({ budget: 500_000, maxBudget: 500_000, minBudget: 150_000, maxPixelRatio: 1.5, minPixelRatio: 1 });
  let now = 10_000;
  const run = (ms, seconds) => { const changes = []; for (const end = now + seconds * 1000; now < end;) { now += ms; const change = governor.sample(ms, now); if (change) changes.push({ ...change, now }); } return changes; };
  const slow = run(50, 12); // 20 fps for 12 s
  assert.deepEqual(slow.slice(0, 3).map(change => change.pixelRatio ?? change.budget), [1.2, 1, 375_000]);
  assert.ok(slow.every((change, i) => i === 0 || change.now - slow[i - 1].now >= 2000), 'changes are at least 2 s apart');
  assert.equal(governor.state.budget >= 150_000, true);
  const fast = run(10, 30); // then 100 fps
  assert.ok(fast.length > 0 && fast.every(change => change.budget > 0));
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
  const harness = load({ files: { 'manifest.json': options.manifest || manifest() }, reduced: options.reduced ?? true });
  const engine = fakeEngine(harness.log, options.engine);
  let engineRequested = 0;
  const pending = harness.player.start(harness.stage, {
    base: 'https://veylet.com/pkg/', env: options.env || phoneWebgl2, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' },
    loadEngine: () => { engineRequested++; harness.log.push('engine:import'); return options.noEngine ? Promise.reject(new Error('offline')) : Promise.resolve(engine); },
    onVisible: () => harness.log.push('visible'), onRetry: () => harness.log.push('retry'),
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
  assert.match(byClass(x.stage, 'v2-fallback').textContent, /3D can’t open in this browser\.This still is rendered from the walkthrough/);
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
