// Chunked whole-home packages (property-3d-studio local-pipeline/tools/chunked-manifest.md) in player v2:
// which chunks are held, at which level, what is let go, and that single-scene packages play exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');
const playerSource = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value)); // across the vm realm

const COUNTS = [480000, 240000, 120000, 48000];
const poster = {
  landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
  portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
  preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
};
const stop = (id, room, x) => ({ id, room, position: [x, 0, 0], target: [x, -0.3, -2], floor: [x, -1.4, 0], floor_measured: true });

// Three rooms in a row, one chunk each: chunk_1 | chunk_2 | chunk_3. chunk_3 is two doorways from chunk_1.
function chunkedManifest(overrides = {}) {
  const chunk = (n, x0, x1) => ({ id: 'chunk_' + n, rooms: ['r' + n], adjacent: n === 2 ? ['chunk_1', 'chunk_3'] : ['chunk_2'],
    lod_meta: `lod/chunk_${n}/lod-meta.json`, lod_counts: COUNTS, bounds: { min: [x0, -1.5, -3], max: [x1, 1.5, 3] }, bytes: { total: 9e6, coarsest: 1e6 } });
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: true, captured_on: null,
    truth_label: 'Synthetic test scene. Not a captured property. Not to scale.', generative_model_used: false,
    scene: { lod_meta: 'lod/chunk_1/lod-meta.json', lod_levels: 4, lod_counts: COUNTS, sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d',
      layout: 'chunked', opening_chunk: 'chunk_1', chunks: [chunk(1, -2, 2.2), chunk(2, 1.8, 6.2), chunk(3, 5.8, 10)] },
    poster, walkable: null,
    rooms: [{ id: 'r1', name: 'Hall', adjacent: ['r2'], chunk: 'chunk_1' }, { id: 'r2', name: 'Kitchen', adjacent: ['r1', 'r3'], chunk: 'chunk_2' },
      { id: 'r3', name: 'Bedroom', adjacent: ['r2'], chunk: 'chunk_3' }],
    stops: [stop('s1', 'r1', 0), stop('s2', 'r2', 4), stop('s3', 'r3', 8)],
    start_stop: 0, files: [],
    ...overrides,
  };
}
function singleManifest() {
  const s = (id, x) => ({ id, room: 'r1', position: [x, 0, 0], target: [x, -0.3, -2], floor: [x, -1.4, 0], floor_measured: true });
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: false, captured_on: null,
    truth_label: 'Built only from photos and depth captured on site. Nothing generated or added. Not to scale.', generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [524921, 262461, 131230, 52492], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster, walkable: null, rooms: [{ id: 'r1', name: 'Living area' }],
    stops: [s('s1', 0), s('s2', 1), s('s3', 2), s('s4', 3), s('s5', 4)], start_stop: 0, files: [],
  };
}

// A stand-in engine that records what the player asks of it, including letting chunks go.
function fakeEngine(log) {
  class Emitter { constructor() { this.handlers = {}; } on(e, f) { (this.handlers[e] ||= []).push(f); } fire(e, ...a) { for (const f of this.handlers[e] || []) f(...a); } }
  class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  const tag = url => url.replace('https://veylet.com/pkg/', '').replace(/\/?lod-meta\.json$/, '').replace(/^lod\/?/, '') || 'scene';
  class Entity {
    constructor(name) { this.name = name; }
    addComponent(type, data) {
      if (type === 'camera') this.camera = { ...data, fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200, worldToScreen: (w, s) => s.set(100, 100, 1) };
      if (type === 'gsplat') {
        const name = tag(data.asset.file.url);
        this.gsplat = new Proxy({ lodRangeMin: 0, lodRangeMax: 99 }, { set(t, k, v) { t[k] = v; log.push(`${name}.${String(k)}=${v}`); return true; } });
        log.push('gsplat:' + data.asset.file.url + (data.unified ? ' unified' : ''));
      }
    }
    setPosition(...p) { this.position = p; } setEulerAngles(...a) { this.angles = a; } setLocalEulerAngles(...a) { this.local = a; }
    destroy() { log.push('destroy:' + this.name); }
  }
  class Asset extends Emitter { constructor(name, type, file) { super(); this.name = name; this.file = file; } unload() { log.push('unload:' + this.name); } }
  const engine = { apps: [] };
  class Application extends Emitter {
    constructor(canvas, { graphicsDevice }) {
      super();
      this.graphicsDevice = graphicsDevice; this.scene = { gsplat: {} }; this.root = { addChild() {} };
      this.assets = { add: () => {}, load: a => log.push('asset.load:' + tag(a.file.url)), remove: a => log.push('asset.remove:' + a.name) };
      this.systems = { gsplat: new Emitter() }; this.loader = { getHandler: () => ({ imgParser: {} }) };
      engine.apps.push(this);
    }
    setCanvasFillMode() {} setCanvasResolution() {} updateCanvasSize() {} start() { log.push('app.start'); } destroy() { log.push('app.destroy'); }
  }
  Object.assign(engine, {
    createGraphicsDevice: async () => ({ deviceType: 'webgl2', on() {}, maxPixelRatio: 1 }),
    Application, Entity, Asset, Vec3, Color: class { fromString() { return this; } }, FILLMODE_NONE: 0, RESOLUTION_AUTO: 0,
  });
  return engine;
}

function load({ source = playerSource, files = {} } = {}) {
  const log = [];
  const document = createDocument({
    onImage: node => { log.push('img:' + node.src); setImmediate(() => node.dispatch('load')); },
    onHeadAppend: node => { if (node.tagName === 'LINK') setImmediate(() => node.onload && node.onload()); },
  });
  const storage = new Map();
  const window = { matchMedia: () => ({ matches: true }), screen: { width: 390, height: 844 }, devicePixelRatio: 3 };
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
  vm.runInNewContext(source, context);
  const stage = document.createElement('div');
  stage.clientWidth = 390; stage.clientHeight = 700; stage.hidden = true;
  document.body.append(stage);
  return { player: window.VeyletPlayerV2, window, document, stage, log };
}
const phoneWebgl2 = { screenWidth: 390, screenHeight: 844, dpr: 3, coarse: true, touchPoints: 5, webgl2: true, webgpu: false };
const desktopWebgpu = { screenWidth: 1920, screenHeight: 1080, dpr: 2, webgl2: true, webgpu: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
const byClass = (root, name) => root.querySelector('.' + name);

async function started({ manifest, env = phoneWebgl2, source } = {}) {
  const harness = load({ source, files: { 'manifest.json': manifest } });
  const engine = fakeEngine(harness.log);
  const pending = harness.player.start(harness.stage, {
    base: 'https://veylet.com/pkg/', env, page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' },
    loadEngine: () => Promise.resolve(engine), onVisible: () => harness.log.push('visible'),
  });
  pending.catch(() => {});
  for (let i = 0; i < 12; i++) await tick();
  const app = engine.apps[0];
  const frame = (ready, loading) => app.systems.gsplat.fire('frame:ready', null, null, ready, loading);
  // One streaming step: something loads, then everything held has arrived.
  const settleStep = () => { frame(false, 2); frame(true, 0); };
  return { ...harness, engine, app, pending, frame, settleStep, stats: () => plain(harness.window.VeyletPlayerV2.current.stats()) };
}
const since = (log, mark) => log.slice(log.lastIndexOf(mark) + 1);

// ---------- the manifest ----------

test('a chunked package is read with its doorway graph; a single-scene package reads exactly as before', () => {
  const { player } = load();
  const read = plain(player.validateManifest(chunkedManifest()).scene.chunked);
  assert.equal(read.opening, 'chunk_1');
  assert.equal(read.levels, 4);
  assert.deepEqual(read.chunkOfRoom, { r1: 'chunk_1', r2: 'chunk_2', r3: 'chunk_3' });
  assert.deepEqual(read.chunks.map(chunk => [chunk.id, chunk.lodMeta, chunk.adjacent]),
    [['chunk_1', 'lod/chunk_1/lod-meta.json', ['chunk_2']], ['chunk_2', 'lod/chunk_2/lod-meta.json', ['chunk_1', 'chunk_3']], ['chunk_3', 'lod/chunk_3/lod-meta.json', ['chunk_2']]]);
  // Single scene: no chunk field at all, the same object the player built before chunks existed.
  const single = plain(player.validateManifest(singleManifest()));
  assert.equal('chunked' in single.scene, false);
  assert.deepEqual(single.scene, { lodMeta: 'lod/lod-meta.json', levels: 4, counts: [524921, 262461, 131230, 52492], rotation: [0, 0, 180], background: '#10231d' });
});

test('doorways come from rooms[].adjacent and portals too, made symmetric', () => {
  const { player } = load();
  const m = chunkedManifest();
  for (const chunk of m.scene.chunks) chunk.adjacent = [];
  m.rooms = m.rooms.map(({ adjacent, ...room }) => room);
  assert.deepEqual(plain(player.validateManifest(m).scene.chunked.chunks.map(chunk => chunk.adjacent)), [[], [], []]);
  m.rooms[0].adjacent = ['r2'];
  m.portals = [{ from_room: 'r3', to_room: 'r2', floor_point: [6, -1.4, 0], walkable: true }];
  assert.deepEqual(plain(player.validateManifest(m).scene.chunked.chunks.map(chunk => chunk.adjacent)), [['chunk_2'], ['chunk_1', 'chunk_3'], ['chunk_2']]);
});

test('a malformed chunked package is refused, never played as its opening room alone', () => {
  const { player } = load();
  const broken = change => { const m = chunkedManifest(); change(m); return () => player.validateManifest(m); };
  assert.throws(broken(m => { m.scene.layout = 'tiled'; }), /manifest-invalid:chunks/);
  assert.throws(broken(m => { m.scene.chunks = m.scene.chunks.slice(0, 1); }), /manifest-invalid:chunks/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_meta = '../chunk_2/lod-meta.json'; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_meta = 'lod/chunk_3/lod-meta.json'; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_counts = [1, 2, 3, 4]; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_counts = COUNTS.slice(0, 3); }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].rooms = ['r1']; }), /manifest-invalid:chunk/); // r1 in two chunks
  assert.throws(broken(m => { m.scene.chunks[2].rooms = ['r9']; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[2].id = 'chunk_1'; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[2].adjacent = ['chunk_9']; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { delete m.scene.chunks[2].bounds; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.opening_chunk = 'chunk_2'; }), /manifest-invalid:opening_chunk/);
  assert.throws(broken(m => { m.scene.lod_meta = 'lod/chunk_2/lod-meta.json'; }), /manifest-invalid:opening_chunk/);
  assert.throws(broken(m => { m.rooms.push({ id: 'r4', name: 'Loft' }); }), /manifest-invalid:chunk/); // a room in no chunk
});

// ---------- which chunks, at which level ----------

test('held: the room’s chunk and its neighbours; two doorways away is let go', () => {
  const { player } = load();
  const chunked = player.validateManifest(chunkedManifest()).scene.chunked;
  assert.deepEqual(plain(player.chunkHops(chunked, 'chunk_1')), { chunk_1: 0, chunk_2: 1, chunk_3: 2 });
  const plan = plain(player.chunkPlan(chunked, 'chunk_1', { held: ['chunk_1', 'chunk_2', 'chunk_3'], budget: 3_000_000 }));
  assert.deepEqual(plan.hold, [{ id: 'chunk_1', level: 0 }, { id: 'chunk_2', level: 3 }]);
  assert.deepEqual(plan.unload, ['chunk_3']);
  const middle = plain(player.chunkPlan(chunked, 'chunk_2', { held: ['chunk_1', 'chunk_2', 'chunk_3'], budget: 3_000_000 }));
  assert.deepEqual(middle.hold.map(item => item.id), ['chunk_1', 'chunk_2', 'chunk_3']);
  assert.deepEqual(middle.unload, []);
  // A chunk with no doorway to here is never held.
  const m = chunkedManifest();
  m.scene.chunks[1].adjacent = ['chunk_1']; m.scene.chunks[2].adjacent = []; m.rooms[1].adjacent = ['r1']; m.rooms[2].adjacent = [];
  const island = player.validateManifest(m).scene.chunked;
  assert.equal(player.chunkHops(island, 'chunk_1').chunk_3, Infinity);
  assert.deepEqual(plain(player.chunkPlan(island, 'chunk_1', { held: ['chunk_3'] }).unload), ['chunk_3']);
});

test('budgets: the current chunk is promoted to fit beside its neighbours; phones one level lower; Save-Data coarsest', () => {
  const { player } = load();
  const chunked = player.validateManifest(chunkedManifest()).scene.chunked;
  const level = (current, env, extra = {}, scene = chunked) => {
    const profile = player.deviceProfile(env);
    return plain(player.chunkPlan(scene, current, { budget: profile.budget, saveData: profile.saveData, finest: player.finestChunkLevel(profile), ...extra }))
      .hold.find(item => item.id === current).level;
  };
  assert.equal(level('chunk_1', desktopWebgpu), 0); // 3M: the finest level
  assert.equal(level('chunk_1', phoneWebgl2), 1); // 480K + the neighbour's 48K is over a phone's 500K: one level lower
  assert.equal(level('chunk_2', phoneWebgl2), 1); // two neighbours (96K) still leave room for 240K
  assert.equal(level('chunk_1', { ...phoneWebgpu(), memory: 8, cores: 8, connectionType: 'wifi' }), 0); // a high-end phone on Wi-Fi
  // A chunk small enough to fit a phone's budget whole still stays one level down on a phone, as single scenes do.
  const small = chunkedManifest();
  small.scene.chunks[0].lod_counts = small.scene.lod_counts = [300000, 150000, 75000, 30000];
  const smallScene = player.validateManifest(small).scene.chunked;
  assert.equal(level('chunk_1', phoneWebgl2, {}, smallScene), 1);
  assert.equal(level('chunk_1', { ...phoneWebgpu(), memory: 8, cores: 8, connectionType: 'wifi' }, {}, smallScene), 0);
  assert.equal(level('chunk_1', desktopWebgpu, {}, smallScene), 0);
  assert.equal(level('chunk_1', { screenWidth: 820, screenHeight: 1180, dpr: 2, coarse: true, touchPoints: 5, webgl2: true }, {}, smallScene), 0); // a tablet
  assert.equal(level('chunk_1', { ...phoneWebgl2, saveData: true }), 3);
  assert.equal(level('chunk_1', desktopWebgpu, { saveData: true }), 3);
  // The governor's floor (150K): only the coarsest fits beside a neighbour.
  assert.equal(level('chunk_2', desktopWebgpu, { budget: 150_000 }), 3);
  assert.equal(level('chunk_1', desktopWebgpu, { budget: 170_000 }), 2);
  // The splats held never pass the budget while any level fits.
  for (const budget of [150_000, 200_000, 350_000, 500_000, 750_000, 1_000_000]) {
    for (const current of ['chunk_1', 'chunk_2', 'chunk_3']) {
      const hold = plain(player.chunkPlan(chunked, current, { budget })).hold;
      const total = hold.reduce((sum, item) => sum + COUNTS[item.level], 0);
      assert.ok(total <= budget || hold.every(item => item.level === 3), `${current} at ${budget}: ${total}`);
    }
  }
});
function phoneWebgpu() { return { ...phoneWebgl2, webgpu: true }; }

test('which chunk a walk ends in: the one you are in while inside its box, else the nearest stop’s', () => {
  const { player } = load();
  const manifest = player.validateManifest(chunkedManifest());
  assert.equal(player.chunkAt(manifest, [1, 0, 0], 'chunk_1'), 'chunk_1');
  assert.equal(player.chunkAt(manifest, [2.0, 0, 0], 'chunk_1'), 'chunk_1'); // the doorway overlap keeps the room you came from
  assert.equal(player.chunkAt(manifest, [2.0, 0, 0], 'chunk_2'), 'chunk_2');
  assert.equal(player.chunkAt(manifest, [3, 0, 0], 'chunk_1'), 'chunk_2');
  assert.equal(player.chunkAt(manifest, [7, 0, 0], 'chunk_2'), 'chunk_3');
  assert.equal(player.chunkAt(manifest, [2.0, 0, 0], null), 'chunk_1'); // both boxes: the nearer stop (x 0 vs 4)
  assert.equal(player.chunkAt(manifest, [40, 0, 0], 'chunk_2'), 'chunk_3'); // outside every box: the nearest stop
});

// ---------- the player streaming a chunked home ----------

test('chunked: the opening chunk alone first, then its neighbours at the coarsest level, then its detail', async () => {
  const x = await started({ manifest: chunkedManifest() });
  const gsplats = () => x.log.filter(line => line.startsWith('gsplat:'));
  assert.deepEqual(gsplats(), ['gsplat:https://veylet.com/pkg/lod/chunk_1/lod-meta.json unified']);
  assert.ok(x.log.includes('chunk_1.lodRangeMin=3') && x.log.includes('chunk_1.lodRangeMax=3'));
  assert.ok(x.log.indexOf('asset.load:chunk_1') < x.log.indexOf('app.start'));
  assert.equal(x.app.scene.gsplat.splatBudget, 500_000);
  x.settleStep();
  assert.equal((await x.pending).readiness, 'viewer-ready');
  // First 3D frame: the neighbour loads at the coarsest level; nothing is promoted yet; chunk_3 (two doorways) never.
  assert.deepEqual(gsplats().slice(1), ['gsplat:https://veylet.com/pkg/lod/chunk_2/lod-meta.json unified']);
  assert.ok(x.log.includes('chunk_2.lodRangeMin=3') && x.log.includes('asset.load:chunk_2'));
  assert.equal(x.log.some(line => line.startsWith('chunk_1.lodRangeMin=') && line !== 'chunk_1.lodRangeMin=3'), false);
  assert.equal(x.stats().phase, 'room');
  assert.equal(byClass(x.stage, 'v2-status').textContent, 'Sharpening detail…');
  x.settleStep();
  // Then this room's detail, one level down on a phone.
  assert.equal(x.log.at(-1), 'chunk_1.lodRangeMin=1');
  assert.equal(x.stats().phase, 'detail');
  x.settleStep();
  const done = x.stats();
  assert.equal(done.phase, 'complete');
  assert.deepEqual(done.chunks, [{ id: 'chunk_1', level: 1, settled: true }, { id: 'chunk_2', level: 3, settled: true }]);
  assert.equal(done.chunk, 'chunk_1');
  assert.equal(byClass(x.stage, 'v2-status').textContent, '');
  assert.equal(x.log.some(line => line.includes('chunk_3')), false);
});

test('chunked: a far stop shows “Loading this room…”, streams that room, then lets the far side go', async () => {
  const x = await started({ manifest: chunkedManifest() });
  x.settleStep(); await x.pending; x.settleStep(); x.settleStep(); // ready, neighbours, detail
  const status = () => byClass(x.stage, 'v2-status').textContent;
  const mark = x.log.length;
  // Stop 3 is in chunk_3, two doorways away: not held yet.
  byClass(x.stage, 'v2-canvas').dispatch('keydown', { key: '3' });
  const moved = x.log.slice(mark);
  assert.equal(byClass(x.stage, 'v2-stop').textContent, 'Stop 3 of 3'); // the move is not held up
  assert.equal(byClass(x.stage, 'v2-room').textContent, 'Bedroom');
  assert.equal(status(), 'Loading this room…');
  assert.equal(byClass(x.stage, 'v2-progress').hidden, false);
  assert.equal(byClass(x.stage, 'v2').dataset.state, 'ready'); // non-blocking: controls stay
  assert.equal(byClass(x.stage, 'v2-bar').hidden, false);
  assert.ok(moved.includes('chunk_1.lodRangeMin=3'), 'the room left behind drops to the coarsest level');
  assert.ok(moved.includes('gsplat:https://veylet.com/pkg/lod/chunk_3/lod-meta.json unified') && moved.includes('chunk_3.lodRangeMin=3'));
  // Arrival (reduced motion is a cut): chunk_1 is two doorways from chunk_3 and goes.
  assert.ok(moved.includes('destroy:chunk_1') && moved.includes('asset.remove:chunk_1') && moved.includes('unload:chunk_1'));
  assert.equal(moved.some(line => /destroy:chunk_[23]/.test(line)), false);
  x.settleStep();
  assert.equal(status(), '');
  assert.equal(byClass(x.stage, 'v2-progress').hidden, true);
  // chunk_2 is already here, so the room's detail follows at once.
  assert.equal(x.log.at(-1), 'chunk_3.lodRangeMin=1');
  x.settleStep();
  const s = x.stats();
  assert.deepEqual(s.chunks.map(item => [item.id, item.level]), [['chunk_2', 3], ['chunk_3', 1]]);
  assert.equal(s.rooms.length, 1);
  assert.equal(s.rooms[0].chunk, 'chunk_3');
  // Back one room: chunk_2 is held and settled, so no note; chunk_1 comes back at the coarsest level.
  const back = x.log.length;
  byClass(x.stage, 'v2-prev').click();
  assert.equal(byClass(x.stage, 'v2-stop').textContent, 'Stop 2 of 3');
  assert.equal(status(), '');
  const after = x.log.slice(back);
  assert.ok(after.includes('chunk_3.lodRangeMin=3') && after.includes('gsplat:https://veylet.com/pkg/lod/chunk_1/lod-meta.json unified'));
  assert.equal(after.some(line => line.startsWith('destroy:')), false); // nothing is two doorways from the middle
  x.settleStep();
  assert.equal(x.log.at(-1), 'chunk_2.lodRangeMin=1'); // two neighbours at 48K leave room for 240K on a phone
  x.settleStep();
  assert.equal(x.stats().phase, 'complete');
});

test('chunked: the stops list, next, the map and the room names work across chunks', async () => {
  const x = await started({ manifest: chunkedManifest() });
  x.settleStep(); await x.pending; x.settleStep(); x.settleStep();
  const toggle = byClass(x.stage, 'v2-stops-toggle');
  toggle.click();
  const panel = byClass(x.stage, 'v2-stops');
  assert.deepEqual(panel.querySelectorAll('h3').map(h => h.textContent), ['Hall', 'Kitchen', 'Bedroom']);
  panel.querySelectorAll('.v2-stop-button')[1].click();
  assert.equal(byClass(x.stage, 'v2-room').textContent, 'Kitchen');
  assert.equal(x.stats().chunk, 'chunk_2');
  byClass(x.stage, 'v2-next').click();
  assert.equal(byClass(x.stage, 'v2-room').textContent, 'Bedroom');
  assert.equal(x.stats().chunk, 'chunk_3');
  byClass(x.stage, 'v2-next').click(); // wraps to the first stop, two doorways back
  assert.equal(byClass(x.stage, 'v2-stop').textContent, 'Stop 1 of 3');
  assert.equal(x.stats().chunk, 'chunk_1');
  assert.ok(x.log.includes('destroy:chunk_3'));
  assert.equal(byClass(x.stage, 'v2-map').querySelectorAll('.v2-map-stop').length, 3);
});

test('chunked with Save-Data: the neighbours still load for walking, but nothing is promoted', async () => {
  const x = await started({ manifest: chunkedManifest(), env: { ...phoneWebgl2, saveData: true } });
  x.settleStep(); await x.pending;
  assert.equal(byClass(x.stage, 'v2-status').textContent, '');
  x.settleStep(); x.settleStep();
  assert.equal(x.stats().phase, 'complete');
  assert.equal(x.log.some(line => /^chunk_\d\.lodRangeMin=[012]$/.test(line)), false);
  assert.deepEqual(x.stats().chunks.map(item => item.level), [3, 3]);
});

// ---------- single-scene packages: the same session as before chunks existed ----------

// The engine calls, requests and on-screen text of one session, recorded from the player before chunk support
// (tour-player-v2.js at ff1ffb2) into tour-player-single-scene-session.json. Any difference changes single-scene playback.
const SESSION_FILE = path.join(__dirname, 'tour-player-single-scene-session.json');
async function singleSceneSession(source) {
  const x = await started({ manifest: singleManifest(), source });
  const screens = [];
  const note = label => screens.push(`${label} | ${byClass(x.stage, 'v2').dataset.state} | ${byClass(x.stage, 'v2-status').textContent} | `
    + `${byClass(x.stage, 'v2-stop').textContent} | progress ${byClass(x.stage, 'v2-progress').hidden ? 'hidden' : byClass(x.stage, 'v2-progress').firstChild.style.transform}`);
  note('opening');
  x.frame(false, 1); x.frame(true, 0);
  await x.pending;
  note('first-3d');
  x.frame(false, 3); note('streaming');
  x.frame(false, 1); x.frame(true, 0); note('detail');
  const canvas = byClass(x.stage, 'v2-canvas');
  byClass(x.stage, 'v2-next').click(); note('next');
  canvas.dispatch('keydown', { key: '4' }); note('key 4');
  byClass(x.stage, 'v2-prev').click(); note('prev');
  canvas.dispatch('keydown', { key: 'Home' }); note('home');
  const s = x.stats();
  return { screens, stats: { keys: Object.keys(s).sort(), level: s.level, phase: s.phase, budget: s.budget, stop: s.stop }, log: x.log };
}

test('a single-scene package plays exactly as it did before chunk support', async () => {
  assert.deepEqual(await singleSceneSession(), JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')));
});

// ---------- chunked packages as the tours Worker serves them (VIEWER-03) ----------

// deploy/tours-worker/src/index.js revisedManifest (property-3d-studio, 26 September 2026): every file path the
// player reads gains r/<rev>/ (rev = first 16 hex of the stored manifest's SHA-256), so files cache immutably.
// As written that day it prefixes scene.lod_meta, the posters and walkable, but not chunks[].lod_meta; the fix
// recorded for the Worker prefixes those too. The player must accept both, and nothing else.
const REV = '0123456789abcdef';
function workerRevised(manifest, { chunks = true } = {}) {
  const copy = JSON.parse(JSON.stringify(manifest));
  const prefix = holder => { if (holder && typeof holder.path === 'string') holder.path = `r/${REV}/${holder.path}`; };
  copy.scene.lod_meta = `r/${REV}/${copy.scene.lod_meta}`;
  for (const key of ['landscape', 'portrait', 'preview']) prefix(copy.poster[key]);
  prefix(copy.walkable);
  if (chunks && Array.isArray(copy.scene.chunks)) for (const chunk of copy.scene.chunks) chunk.lod_meta = `r/${REV}/${chunk.lod_meta}`;
  return copy;
}

test('a chunked package from the tours Worker (r/<rev>/ paths) validates and streams its chunks under that revision (VIEWER-03)', async () => {
  const { player } = load();
  for (const chunks of [true, false]) {
    const read = plain(player.validateManifest(workerRevised(chunkedManifest(), { chunks })));
    assert.equal(read.scene.lodMeta, `r/${REV}/lod/chunk_1/lod-meta.json`, `chunks prefixed: ${chunks}`);
    assert.deepEqual(read.scene.chunked.chunks.map(chunk => chunk.lodMeta), [1, 2, 3].map(n => `r/${REV}/lod/chunk_${n}/lod-meta.json`),
      'every chunk is read under the revision the manifest names');
    assert.equal(read.scene.chunked.opening, 'chunk_1');
    assert.equal(read.posters.portrait.path, `r/${REV}/poster-portrait.webp`);
  }
  // A single scene from the Worker is unchanged by this.
  assert.equal(player.validateManifest(workerRevised(singleManifest())).scene.lodMeta, `r/${REV}/lod/lod-meta.json`);
  // One verified prefix only: not a second one, not a different revision per chunk, not a bad revision.
  const broken = change => { const m = workerRevised(chunkedManifest()); change(m); return () => player.validateManifest(m); };
  assert.throws(broken(m => { m.scene.chunks[1].lod_meta = `r/${REV}/r/${REV}/lod/chunk_2/lod-meta.json`; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_meta = `r/fedcba9876543210/lod/chunk_2/lod-meta.json`; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.chunks[1].lod_meta = `r/../lod/chunk_2/lod-meta.json`; }), /manifest-invalid:chunk/);
  assert.throws(broken(m => { m.scene.lod_meta = `r/NOTHEX/lod/chunk_1/lod-meta.json`; }), /manifest-invalid:scene/);
  assert.throws(broken(m => { m.scene.lod_meta = `r/${REV}/r/${REV}/lod/chunk_1/lod-meta.json`; }), /manifest-invalid:scene/);

  // The player streams the Worker's manifest: every chunk under the revision.
  const x = await started({ manifest: workerRevised(chunkedManifest(), { chunks: false }) });
  x.settleStep();
  assert.equal((await x.pending).readiness, 'viewer-ready');
  assert.deepEqual(x.log.filter(line => line.startsWith('gsplat:')),
    [`gsplat:https://veylet.com/pkg/r/${REV}/lod/chunk_1/lod-meta.json unified`, `gsplat:https://veylet.com/pkg/r/${REV}/lod/chunk_2/lod-meta.json unified`]);
});

module.exports = { singleSceneSession };
