// Opt-in still quality and human movement. Synthetic masks and a manually advanced
// clock prove camera behaviour without loading PlayCanvas, images or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');
const source = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const phone = { screenWidth: 390, screenHeight: 844, dpr: 3, coarse: true, touchPoints: 5, webgl2: true, webgpu: false };
const desktop = { screenWidth: 1280, screenHeight: 800, dpr: 2, coarse: false, touchPoints: 0, webgl2: true, webgpu: false };
const stop = (id, x, z, yaw = 0, y = 0) => ({ id, room: 'r1', position: [x, y, z],
  target: [x - Math.sin(yaw * Math.PI / 180) * 2, y, z - Math.cos(yaw * Math.PI / 180) * 2],
  floor: [x, y - 1.4, z], floor_measured: true, floor_id: y > 1.5 ? 'f2' : 'f1' });

function manifest(stops = [stop('s1', 0, 0), stop('s2', 4, 0)], hasMask = true) {
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: true, captured_on: null,
    truth_label: 'Synthetic test scene. Not a captured property. Not to scale.', generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [480000, 240000, 120000, 48000],
      sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable: hasMask ? { path: 'walkable.json' } : null,
    rooms: [{ id: 'r1', name: 'Synthetic room' }], stops, start_stop: 0, files: [],
  };
}

function mask(open = () => true, { origin = [-5, -10], columns = 200, rows = 200, cell = 0.1 } = {}) {
  const bits = new Uint8Array(Math.ceil(columns * rows / 8));
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    if (open(origin[0] + (c + 0.5) * cell, origin[1] + (r + 0.5) * cell)) {
      const i = r * columns + c; bits[i >> 3] |= 1 << (i & 7);
    }
  }
  return { version: 1, cell_metres: cell, origin, columns, rows, floor_y: -1.4, eye_height: 1.4,
    mask: Buffer.from(bits).toString('base64') };
}

function clock() {
  let next = 1;
  const pending = new Map();
  const time = { t: 1000, now: () => time.t, mark() {},
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, at: time.t + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      time.t += ms;
      for (const [id, timer] of [...pending]) if (timer.at <= time.t) { pending.delete(id); timer.fn(); }
    },
  };
  return time;
}

function engine() {
  class Emitter {
    constructor() { this.handlers = new Map(); }
    on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); }
    fire(name, ...args) { for (const fn of this.handlers.get(name) || []) fn(...args); }
  }
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  }
  const pc = { apps: [], assets: [], entities: [], loads: [] };
  class Entity {
    constructor(name) { this.name = name; pc.entities.push(this); }
    addComponent(type, data) {
      if (type === 'camera') this.camera = { ...data, fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200,
        worldToScreen: (point, out) => out.set(100, 100, 1),
        screenToWorld: (x, y, depth, out) => out.set(x / 100, -depth, y / 100) };
      if (type === 'gsplat') this.gsplat = { ...data, lodRangeMin: 0, lodRangeMax: 99 };
    }
    setPosition(...position) { this.position = position; }
    setEulerAngles(...angles) { this.angles = angles; }
    setLocalEulerAngles() {}
    destroy() { this.destroyed = true; }
  }
  class Asset extends Emitter {
    constructor(name, type, file) { super(); Object.assign(this, { name, type, file }); pc.assets.push(this); }
    unload() { this.unloaded = true; }
  }
  class Application extends Emitter {
    constructor(canvas, { graphicsDevice }) {
      super(); this.graphicsDevice = graphicsDevice;
      this.scene = { gsplat: {} }; this.root = { addChild() {} };
      this.assets = { add() {}, load: asset => pc.loads.push(asset.file.url), remove() {} };
      this.systems = { gsplat: new Emitter() }; this.loader = { getHandler: () => ({ imgParser: {} }) };
      pc.apps.push(this);
    }
    setCanvasFillMode() {} setCanvasResolution() {} updateCanvasSize() {} start() {} destroy() {}
  }
  Object.assign(pc, { createGraphicsDevice: async () => Object.assign(new Emitter(), { deviceType: 'webgl2', maxPixelRatio: 1 }),
    Application, Entity, Asset, Vec3, Color: class { fromString() { return this; } }, FILLMODE_NONE: 0, RESOLUTION_AUTO: 0 });
  return pc;
}

async function ready({ options = {}, reduced = false, env = phone, size = [390, 700],
  stops, walkable = mask(), counts, record, storage = new Map(), settle = true } = {}) {
  const time = clock(), pc = engine(), fetches = [];
  const document = createDocument({ onImage: image => setImmediate(() => image.dispatch('load')),
    onHeadAppend: node => { if (node.tagName === 'LINK') setImmediate(() => node.onload?.()); } });
  const windowEvents = new Map();
  const media = { matches: reduced };
  const window = { matchMedia: () => media, screen: { width: env.screenWidth, height: env.screenHeight }, devicePixelRatio: env.dpr,
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    removeEventListener(type, fn) { windowEvents.set(type, (windowEvents.get(type) || []).filter(value => value !== fn)); } };
  const data = record || manifest(stops, Boolean(walkable));
  if (counts) data.scene.lod_counts = counts;
  const files = { 'manifest.json': data, 'walkable.json': walkable };
  const context = { window, document, performance: time, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    setImmediate, URL, atob, AbortController, console, navigator: {},
    location: { href: 'https://veylet.com/play/', origin: 'https://veylet.com' },
    localStorage: { getItem: () => '1', setItem() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    fetch: async url => { fetches.push(url); const key = url.replace('https://veylet.com/pkg/', '');
      return { ok: key in files, status: key in files ? 200 : 404, headers: { get: () => null }, text: async () => JSON.stringify(files[key]) }; },
  };
  vm.runInNewContext(source, context);
  const stage = document.createElement('div'); [stage.clientWidth, stage.clientHeight] = size; document.body.append(stage);
  const pending = window.VeyletPlayerV2.start(stage, { base: 'https://veylet.com/pkg/', env, framed: false,
    page: context.location, loadEngine: async () => pc, ...options });
  pending.catch(() => {});
  for (let i = 0; i < 12; i++) await tick();
  const app = pc.apps[0], canvas = stage.querySelector('.v2-canvas');
  [canvas.clientWidth, canvas.clientHeight] = size;
  const settleStep = () => { app.systems.gsplat.fire('frame:ready', null, null, false, 1); app.systems.gsplat.fire('frame:ready', null, null, true, 0); };
  settleStep(); await pending;
  if (settle) settleStep();
  const current = window.VeyletPlayerV2.current;
  const x = { player: window.VeyletPlayerV2, current, app, pc, time, document, window, stage, canvas, fetches,
    state: () => plain(current.inspect().state), stats: () => plain(current.stats()), setReduced: value => { media.matches = value; },
    status: () => stage.querySelector('.v2-status').textContent, settleStep,
    frame(ms = 20, render = true) { time.advance(ms); app.fire('update', ms / 1000); if (render) app.fire('postrender'); },
    documentEvent(type) { for (const fn of document.listeners.get(type) || []) fn({ type }); },
    windowEvent(type) { for (const fn of windowEvents.get(type) || []) fn({ type }); },
    windowListeners: type => (windowEvents.get(type) || []).length,
  };
  x.advance = (ms, step = 20) => { for (let passed = 0; passed < ms; passed += step) x.frame(Math.min(step, ms - passed)); };
  return x;
}

function drag(x, { dx = 100, dy = 0, release = true } = {}) {
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 });
  x.time.advance(40);
  x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 100 + dx, clientY: 200 + dy });
  if (release) x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 100 + dx, clientY: 200 + dy });
}
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const turn = (a, b) => Math.abs(((b - a) % 360 + 540) % 360 - 180);

test('still refinement waits for idle, raises resolution within its pixel cap and never loads an asset', async () => {
  const x = await ready({ options: { idleRefinement: true } });
  const moving = x.app.graphicsDevice.maxPixelRatio, requests = [...x.fetches], loads = [...x.pc.loads];
  x.advance(200);
  assert.equal(x.app.graphicsDevice.maxPixelRatio, moving, '200 ms is too soon');
  x.advance(100);
  const refined = x.app.graphicsDevice.maxPixelRatio;
  assert.ok(refined > moving, 'an idle phone receives sharper pixels');
  assert.ok(refined <= 3 && 390 * 700 * refined ** 2 <= 3_000_000, 'device ratio and safe pixel count bound refinement');
  assert.deepEqual(x.fetches, requests); assert.deepEqual(x.pc.loads, loads);
  const frames = x.stats().frames.length;
  x.advance(2000, 100);
  assert.equal(x.stats().frames.length, frames, 'idle refinement never enters motion FPS history');
});

test('refinement is opt-in and waits for streaming detail to finish', async () => {
  const disabled = await ready(); disabled.advance(1000);
  assert.equal(disabled.app.graphicsDevice.maxPixelRatio, 1.5);
  const x = await ready({ options: { idleRefinement: true }, settle: false });
  x.advance(1000);
  assert.equal(x.app.graphicsDevice.maxPixelRatio, 1.5, 'loading keeps the governed setting');
  x.settleStep(); x.advance(300);
  assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5);
});

test('pointer, pinch, wheel, keyboard and a new flight immediately cancel idle refinement', async () => {
  const actions = [
    x => x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }),
    x => { x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }); x.canvas.dispatch('pointerdown', { pointerId: 2, clientX: 60, clientY: 10 }); },
    x => x.canvas.dispatch('wheel', { ctrlKey: true, deltaY: -5 }),
    x => x.canvas.dispatch('keydown', { key: 'PageUp' }),
    x => x.current.goToStop(1),
  ];
  for (const action of actions) {
    const x = await ready({ options: { idleRefinement: true } }); x.advance(300);
    assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5);
    action(x);
    assert.equal(x.app.graphicsDevice.maxPixelRatio, 1.5, 'input restores governed resolution synchronously');
  }
});

test('graphics context loss disables refinement for the rest of the restored session', async () => {
  const storage = new Map();
  const x = await ready({ options: { idleRefinement: true }, storage }); x.advance(300);
  assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5);
  x.canvas.dispatch('webglcontextlost');
  assert.equal(x.app.graphicsDevice.maxPixelRatio, 1.5);
  x.canvas.dispatch('webglcontextrestored'); x.advance(2000);
  assert.equal(x.app.graphicsDevice.maxPixelRatio, 1.5);
  assert.equal(x.stage.querySelector('.v2').dataset.state, 'ready');
  const restarted = await ready({ options: { idleRefinement: true }, storage }); restarted.advance(2000);
  assert.equal(restarted.app.graphicsDevice.maxPixelRatio, 1.5, 'a replacement controller remembers context loss in this browser session');
  assert.equal(restarted.stats().refinement.reason, 'context-lost');
});

test('the motion governor excludes idle gaps and still frames, then responds to genuinely slow motion', async () => {
  const x = await ready({ options: { idleRefinement: true } }); x.advance(5000, 100);
  assert.equal(x.stats().frames.length, 0);
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
  x.frame(16);
  assert.equal(x.stats().frames.length, 0, 'first post-refinement motion frame is only a timing baseline');
  x.frame(16);
  assert.ok(x.stats().frames.every(ms => ms <= 17), 'first movement sample excludes the idle interval');
  x.advance(4000, 50);
  assert.ok(x.app.graphicsDevice.maxPixelRatio < 1.5, 'the governor still reacts to 20 fps movement');
});

test('look inertia keeps turning after release, decays exponentially, clamps pitch and eventually idles', async () => {
  const x = await ready({ options: { lookInertia: true } }); drag(x, { dx: 40, dy: 800 });
  const initial = x.state(); x.advance(100); const first = x.state(); x.advance(100); const second = x.state();
  const a = turn(initial.yaw, first.yaw), b = turn(first.yaw, second.yaw);
  assert.ok(a > 0 && b > 0 && b < a, 'equal time intervals turn less as inertia decays');
  assert.ok(Math.abs(b / a - Math.exp(-0.1 / 0.3)) < 0.12, 'approximately 0.3 s decay constant');
  assert.ok(Math.abs(first.pitch) <= 80 && Math.abs(second.pitch) <= 80);
  assert.ok(a <= 24, 'angular speed is capped');
  x.advance(4000); const ended = x.state(); x.advance(500);
  assert.deepEqual(x.state(), ended, 'finite settling lets on-demand rendering idle');
});

test('new input cancels inertia immediately and reduced motion never starts it', async () => {
  const x = await ready({ options: { lookInertia: true } }); drag(x); x.advance(100);
  const before = x.state(); x.canvas.dispatch('pointerdown', { pointerId: 2, clientX: 20, clientY: 20 }); x.advance(300);
  assert.deepEqual(x.state(), before);
  const reduced = await ready({ options: { lookInertia: true }, reduced: true }); drag(reduced);
  const released = reduced.state(); reduced.advance(500);
  assert.deepEqual(reduced.state(), released);
  assert.notEqual(x.state().yaw, released.yaw, 'the unrestricted drag had measurable inertia before interruption');
});

test('walking duration follows metres at a human pace and caps long routes at four seconds', async () => {
  const x = await ready({ options: { humanWalking: true }, stops: [stop('s1', 0, 0), stop('s2', 8, 0)] });
  assert.ok(x.player.walkingDuration(1.3) >= 1000 && x.player.walkingDuration(1.3) <= 1500);
  assert.ok(x.player.walkingDuration(2.6) > x.player.walkingDuration(1.3));
  assert.equal(x.player.walkingDuration(100), 4000);
  x.current.goToStop(1); x.advance(1100);
  assert.ok(x.state().position[0] > 0 && x.state().position[0] < 7, 'eight metres is not finished in the old 1.1 seconds');
  x.advance(2900);
  assert.deepEqual(x.state().position, [8, 0, 0]);
  assert.equal(x.stats().stop, 1);
  const arrived = x.state(); x.current.goToStop(1);
  for (let i = 0; i < 25; i++) { x.frame(20); assert.deepEqual(x.state(), arrived, 'selecting the current position never invents a travel heading'); }
});

test('routed taps and stops go around a wall, stay on floor and settle to the captured stop heading', async () => {
  const wall = mask((x, z) => Math.abs(x) >= 0.3 || Math.abs(z) >= 2);
  for (const tap of [false, true]) {
    const x = await ready({ options: { humanWalking: true }, walkable: wall,
      stops: [stop('s1', -2, 0, -90), stop('s2', 2, 0, -30)] });
    const floor = x.player.decodeWalkable(wall);
    assert.equal(floor.clear([-2, 0], [2, 0]), false);
    if (tap) x.current.tapAt(200, 0); else x.current.goToStop(1);
    const points = [x.state().position]; let oldYaw = x.state().yaw;
    for (let i = 0; i < 80; i++) {
      x.frame(50); const state = x.state(); points.push(state.position);
      assert.ok(floor.walkable(state.position[0], state.position[2]), 'camera never enters a wall cell');
      assert.ok(turn(oldYaw, state.yaw) <= 3.001, 'heading changes at no more than 60 degrees per second');
      oldYaw = state.yaw;
      assert.equal(state.position[1], 0, 'no head-bob');
    }
    assert.deepEqual(x.state().position, [2, 0, 0]);
    assert.ok(points.some(point => Math.abs(point[2]) >= 2.1), 'route actually goes around the wall');
    assert.ok(points.slice(1).every((point, i) => floor.clear([points[i][0], points[i][2]], [point[0], point[2]])), 'no segment cuts a corner');
    if (!tap) assert.ok(turn(x.state().yaw, -30) < 0.001, 'the captured destination heading is reached within four seconds');
  }
});

test('a stop the mask cannot reach still glides there, while a tap never crosses the wall', async () => {
  const wall = mask(x => Math.abs(x) >= 0.3);
  const x = await ready({ options: { humanWalking: true }, walkable: wall,
    stops: [stop('s1', -2, 0), stop('s2', 2, 0)] });
  const floor = x.player.decodeWalkable(wall);
  const route = x.player.routeWalk(floor, [-2, 0], [2, 0]);
  assert.equal(route.points, null); assert.equal(route.reason, 'unreachable');
  x.current.goToStop(1);
  assert.equal(x.stats().motion.reason, 'unreachable'); assert.equal(x.stats().motion.fallback, 'straight');
  x.advance(4500);
  assert.deepEqual(x.state().position, [2, 0, 0], 'Next and the stop list never dead-end'); assert.equal(x.stats().stop, 1);
  x.current.goToStop(0); x.advance(4500); assert.equal(x.stats().stop, 0);
  x.current.tapAt(200, 0); x.advance(4500);
  const at = x.state().position;
  assert.ok(at[0] > -2 && at[0] < -0.3, 'an unroutable tap walks up to the wall as it always has, never through it');
});

test('routing is deterministic and cannot slip diagonally between touching blocked cells', async () => {
  const x = await ready();
  const blocked = x.player.decodeWalkable(mask((x, z) => (x < 1 && z < 1) || (x >= 1 && z >= 1),
    { origin: [0, 0], columns: 4, rows: 4, cell: 0.5 }));
  assert.equal(x.player.routeWalk(blocked, [0.5, 0.5], [1.5, 1.5]).points, null);
  const open = x.player.decodeWalkable(mask((x, z) => Math.abs(x) >= 0.3 || Math.abs(z) >= 2));
  const a = plain(x.player.routeWalk(open, [-2, 0], [2, 0]));
  assert.ok(a.points.length > 2); assert.ok(a.distance > 4);
  assert.deepEqual(plain(x.player.routeWalk(open, [-2, 0], [2, 0])), a);
});

test('held W walks without key repeat; releasing eases to rest, while A turns and Shift D strafes', async () => {
  const x = await ready({ options: { continuousWalking: true }, env: desktop,
    stops: [stop('s1', 0, 0, 0, 0.4), stop('s2', 4, 0, 0, 0.4)] });
  x.canvas.focus(); const from = x.state();
  const press = x.canvas.dispatch('keydown', { key: 'w' }); x.advance(1000);
  assert.equal(press.defaultPrevented, true);
  assert.equal(x.state().position[1], 0.4, 'free walking keeps the captured eye height when the mask plane differs');
  assert.ok(distance(x.state().position, from.position) > 0.9 && distance(x.state().position, from.position) < 1.5);
  x.canvas.dispatch('keyup', { key: 'w' }); const released = x.state(); x.advance(200); const eased = x.state();
  assert.ok(distance(eased.position, released.position) > 0 && distance(eased.position, released.position) < 0.3);
  x.advance(800); const ended = x.state(); x.advance(500); assert.deepEqual(x.state(), ended);
  const angle = ended.yaw; x.canvas.dispatch('keydown', { key: 'a' }); x.advance(500); x.canvas.dispatch('keyup', { key: 'a' }); x.advance(500);
  assert.ok(turn(angle, x.state().yaw) > 15 && turn(angle, x.state().yaw) <= 60);
  const strafe = x.state(); x.canvas.dispatch('keydown', { key: 'D', shiftKey: true }); x.advance(500);
  x.canvas.dispatch('keyup', { key: 'D', shiftKey: true }); x.advance(500);
  assert.ok(distance(strafe.position, x.state().position) > 0.3);
  assert.ok(turn(strafe.yaw, x.state().yaw) < 0.001, 'Shift strafing keeps the view heading');
});

test('continuous movement slides along a mask wall instead of stopping dead or crossing it', async () => {
  const wall = mask(x => x < 0);
  const x = await ready({ options: { continuousWalking: true }, env: desktop, walkable: wall,
    stops: [stop('s1', -0.5, 0, -45), stop('s2', -2, -3)] });
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'w' });
  x.advance(1500); const first = x.state(); x.advance(700); const second = x.state();
  assert.ok(first.position[0] < 0 && second.position[0] < 0, 'wall boundary is never crossed');
  assert.ok(second.position[2] < first.position[2] - 0.4, 'motion along the wall continues after contact');
  assert.ok(Math.abs(second.position[0] - first.position[0]) < 0.15);
});

test('blur, hidden pages and opening a panel release held movement; existing shortcuts retain focus', async () => {
  for (const interrupt of [x => x.canvas.dispatch('blur'), x => { x.document.hidden = true; x.documentEvent('visibilitychange'); },
    x => x.stage.querySelector('.v2-stops-toggle').click()]) {
    const x = await ready({ options: { continuousWalking: true }, env: desktop });
    x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'w' }); x.advance(500);
    assert.ok(x.state().position[2] < -0.3);
    interrupt(x); x.advance(400); const stopped = x.state(); x.advance(1000);
    assert.deepEqual(x.state(), stopped, 'no stuck key continues after focus or visibility changes');
  }
  const x = await ready({ options: { continuousWalking: true, humanWalking: true }, env: desktop, reduced: true });
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'n' }); assert.equal(x.stats().stop, 1);
  x.canvas.dispatch('keydown', { key: 'Home' }); assert.equal(x.stats().stop, 0);
  x.canvas.dispatch('keydown', { key: '2' }); assert.equal(x.stats().stop, 1);
  x.canvas.dispatch('keydown', { key: 'p' }); assert.equal(x.stats().stop, 0);
  const pitch = x.state().pitch; x.canvas.dispatch('keydown', { key: 'PageUp' }); assert.ok(x.state().pitch > pitch);
  const map = x.stage.querySelector('.v2-map'), shown = map.hidden; x.canvas.dispatch('keydown', { key: 'm' }); assert.equal(map.hidden, !shown);
  assert.equal(x.document.activeElement, x.canvas, 'navigation shortcuts do not steal canvas focus');
  const external = x.document.createElement('input'); x.document.body.append(external); external.focus();
  external.dispatch('keydown', { key: 'w' }); const outside = x.state(); x.advance(500); assert.deepEqual(x.state(), outside);
});

test('reduced motion retains instant step walking, and free walking never uses another storey mask', async () => {
  const x = await ready({ options: { continuousWalking: true, humanWalking: true }, reduced: true, env: desktop,
    stops: [stop('s1', 0, 0), stop('s2', 2, 0), stop('s3', 0, 0, 0, 2.8)] });
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'w' });
  assert.equal(x.state().position[2], -0.35); x.advance(1000); assert.equal(x.state().position[2], -0.35);
  x.current.goToStop(2); assert.equal(x.state().position[1], 2.8);
  const upstairs = x.state(); x.canvas.dispatch('keydown', { key: 'w' }); x.advance(1000);
  assert.deepEqual(x.state(), upstairs); assert.equal(x.status(), 'Use Next stop or a numbered circle on this floor.');
  const animated = await ready({ options: { continuousWalking: true, humanWalking: true }, env: desktop,
    stops: [stop('s1', 0, 0), stop('s2', 0, 0, 0, 2.8)] });
  animated.current.goToStop(1); animated.advance(4000);
  assert.equal(animated.state().position[1], 2.8, 'cross-storey stop navigation is still available');
  const up = animated.state(); animated.canvas.dispatch('keydown', { key: 'w' }); animated.advance(1000);
  assert.deepEqual(animated.state(), up); assert.equal(animated.status(), 'Use Next stop or a numbered circle on this floor.');
});

test('cancelled or stale drags do not fling; a changed reduced-motion preference stops inertia', async () => {
  for (const cancel of [true, false]) {
    const x = await ready({ options: { lookInertia: true } }); drag(x, { release: false });
    if (!cancel) x.time.advance(300);
    x.canvas.dispatch(cancel ? 'pointercancel' : 'pointerup', { pointerId: 1, clientX: 200, clientY: 200 });
    const stopped = x.state(); x.advance(1000); assert.deepEqual(x.state(), stopped);
  }
  const x = await ready({ options: { lookInertia: true } }); drag(x); const released = x.state(); x.advance(100);
  assert.ok(turn(released.yaw, x.state().yaw) > 0);
  x.setReduced(true); x.frame(); const stopped = x.state(); x.advance(1000); assert.deepEqual(x.state(), stopped);
});

test('human walking slows inside a narrow doorway while remaining on measured open floor', async () => {
  const doorway = mask((x, z) => Math.abs(x) > 0.45 || Math.abs(z) < 0.25);
  const x = await ready({ options: { humanWalking: true }, walkable: doorway,
    stops: [stop('s1', -3, 0, -90), stop('s2', 3, 0, -90)] });
  const floor = x.player.decodeWalkable(doorway);
  x.current.goToStop(1);
  const openSpeeds = [], narrowSpeeds = [];
  for (let i = 0; i < 200; i++) {
    const before = x.state().position; x.frame(20); const after = x.state().position;
    const speed = distance(before, after) / 0.02;
    if (before[0] > -2 && after[0] < -1) openSpeeds.push(speed);
    if (before[0] > -0.25 && after[0] < 0.25) narrowSpeeds.push(speed);
    assert.ok(floor.walkable(after[0], after[2]));
  }
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(openSpeeds.length > 5 && narrowSpeeds.length > 5);
  assert.ok(average(narrowSpeeds) < average(openSpeeds) * 0.95, 'a restricted doorway has a slower cruise than its approach');
  assert.deepEqual(x.state().position, [3, 0, 0]);
});

test('new features require literal opt-in; the opening view and original keyboard steps remain unchanged', async () => {
  for (const options of [{}, { idleRefinement: 1, lookInertia: 1, humanWalking: 1, continuousWalking: 1 }]) {
    const x = await ready({ options, env: desktop }); const initial = x.state();
    assert.deepEqual(initial.position, [0, 0, 0]); assert.equal(initial.yaw, 0); assert.equal(initial.pitch, 0);
    x.advance(1000); assert.equal(x.app.graphicsDevice.maxPixelRatio, 2);
    drag(x); const released = x.state(); x.advance(1000); assert.deepEqual(x.state(), released);
    const keyboard = x.canvas.dispatch('keydown', { key: 'w' }); x.advance(500);
    assert.equal(Boolean(keyboard.defaultPrevented), false); assert.deepEqual(x.state(), released);
    x.current.goToStop(1); x.advance(1100); assert.deepEqual(x.state().position, [4, 0, 0]);
    const yaw = x.state().yaw; x.canvas.dispatch('keydown', { key: 'ArrowLeft' }); assert.equal(x.state().yaw, yaw + 10);
  }
});

function residentOctree() {
  const resident = new Set([0, 1, 2, 3, 4, 5, 6, 7]), refs = new Map(), releases = [];
  const octree = { cooldownTicks: 30,
    nodes: [0, 4].map(offset => ({ lods: [240000, 120000, 60000, 24000].map((count, level) => ({ count, fileIndex: offset + level })) })),
    getFileResource: index => resident.has(index) ? { index } : null,
    incRefCount(index) { refs.set(index, (refs.get(index) || 0) + 1); },
    decRefCount(index, cooldown) { refs.set(index, (refs.get(index) || 0) - 1); releases.push([index, cooldown]); },
    ensureFileResource() { assert.fail('idle refinement must never request an absent asset'); },
  };
  return { octree, resident, refs, releases };
}

async function governedResidentScene() {
  const x = await ready({ options: { idleRefinement: true } }), cache = residentOctree();
  x.pc.assets[0].resource = { octree: cache.octree };
  drag(x, { dx: 20, release: false }); x.advance(8000, 50);
  assert.equal(x.stats().level, 1, 'slow movement has dropped below the initially loaded 480K level');
  const component = x.pc.entities.find(entity => entity.gsplat).gsplat;
  const governed = { min: component.lodRangeMin, max: component.lodRangeMax,
    budget: x.app.scene.gsplat.splatBudget, ratio: x.app.graphicsDevice.maxPixelRatio };
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 120, clientY: 200 });
  return { ...x, ...cache, component, governed };
}

test('refinement borrows only the fully resident finer LOD, pins it and restores all governed settings on input', async () => {
  const x = await governedResidentScene(), loads = [...x.pc.loads], requests = [...x.fetches];
  x.advance(300);
  assert.equal(x.component.lodRangeMin, 0); assert.equal(x.component.lodRangeMax, 0, 'exact finer level avoids mixing or extra loads');
  assert.equal(x.app.scene.gsplat.splatBudget, 480000);
  assert.ok([...x.refs.values()].every(value => value === 1) && x.refs.size === 8, 'current and finer files remain resident');
  assert.deepEqual(x.pc.loads, loads); assert.deepEqual(x.fetches, requests);
  x.canvas.dispatch('pointerdown', { pointerId: 2, clientX: 30, clientY: 30 });
  assert.deepEqual({ min: x.component.lodRangeMin, max: x.component.lodRangeMax,
    budget: x.app.scene.gsplat.splatBudget, ratio: x.app.graphicsDevice.maxPixelRatio }, x.governed);
  assert.ok([...x.refs.values()].every(value => value === 0), 'pins are balanced on input');
});

test('one missing finer file or an over-budget level leaves LOD unchanged, without fetching', async () => {
  const x = await governedResidentScene(); x.resident.delete(4); const loads = [...x.pc.loads]; x.advance(300);
  assert.equal(x.component.lodRangeMin, x.governed.min); assert.equal(x.component.lodRangeMax, x.governed.max);
  assert.equal(x.refs.size, 0); assert.deepEqual(x.pc.loads, loads);
  assert.equal(x.stats().refinement.reason, 'finer-not-resident');
  const over = await ready({ options: { idleRefinement: true }, counts: [600000, 240000, 120000, 48000] });
  const cache = residentOctree(); over.pc.assets[0].resource = { octree: cache.octree }; over.advance(300);
  assert.equal(over.pc.entities.find(entity => entity.gsplat).gsplat.lodRangeMin, 1);
  assert.equal(cache.refs.size, 0); assert.equal(over.stats().refinement.reason, 'finer-over-budget');
  for (const count of [NaN, -1, '240000']) {
    const malformed = await governedResidentScene(); malformed.octree.nodes[0].lods[0].count = count; malformed.advance(300);
    assert.equal(malformed.component.lodRangeMin, malformed.governed.min);
    assert.equal(malformed.refs.size, 0);
    assert.equal(malformed.stats().refinement.reason, 'invalid-resident-metadata');
  }
});

test('a context loss releases finer LOD pins immediately and restored graphics never re-pin them', async () => {
  const x = await governedResidentScene(); x.advance(300); assert.equal(x.refs.size, 8);
  x.canvas.dispatch('webglcontextlost');
  assert.ok([...x.refs.values()].every(value => value === 0));
  assert.ok(x.releases.length === 8 && x.releases.every(([, cooldown]) => cooldown === 0));
  x.canvas.dispatch('webglcontextrestored'); x.advance(2000);
  assert.ok([...x.refs.values()].every(value => value === 0)); assert.equal(x.component.lodRangeMin, x.governed.min);
});

test('the still pixel budget caps large three-times-density stages and records when no increase fits', async () => {
  const x = await ready({ options: { idleRefinement: true }, size: [1000, 1000] }); x.advance(300);
  assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5 && x.app.graphicsDevice.maxPixelRatio < 3);
  assert.ok(1_000_000 * x.app.graphicsDevice.maxPixelRatio ** 2 <= 3_000_000 + 1e-6);
  const large = await ready({ options: { idleRefinement: true }, size: [2000, 1500] }); large.advance(300);
  assert.equal(large.app.graphicsDevice.maxPixelRatio, 1.5, 'refinement cannot increase an already oversized frame');
  assert.equal(large.stats().refinement.reason, 'pixel-budget');
});

test('arrow keys share continuous walking, while browser-modified keys stay untouched', async () => {
  const x = await ready({ options: { continuousWalking: true }, env: desktop });
  const original = x.state();
  assert.equal(Boolean(x.canvas.dispatch('keydown', { key: 'w', ctrlKey: true }).defaultPrevented), false);
  assert.equal(Boolean(x.canvas.dispatch('keydown', { key: 'ArrowUp', metaKey: true }).defaultPrevented), false);
  x.advance(500); assert.deepEqual(x.state(), original);
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'ArrowUp' }); x.advance(1000);
  assert.ok(x.state().position[2] < -0.9, 'one press walks for the entire second');
  x.canvas.dispatch('keyup', { key: 'ArrowUp' }); x.advance(1000);
  const yaw = x.state().yaw; x.canvas.dispatch('keydown', { key: 'ArrowRight' }); x.advance(500);
  assert.ok(turn(yaw, x.state().yaw) >= 29 && turn(yaw, x.state().yaw) <= 31);
});

test('human pace is retained for a tap snapped beside furniture', async () => {
  const furniture = mask((x, z) => !(x > 3.5 && x < 4.5 && Math.abs(z) < 0.5));
  const x = await ready({ options: { humanWalking: true }, walkable: furniture });
  x.current.tapAt(400, 0); x.advance(1100);
  assert.ok(x.state().position[0] > 0 && x.state().position[0] < 3, 'a snapped tap follows human timing');
  x.advance(2900); const point = x.state().position;
  assert.ok(x.player.decodeWalkable(furniture).walkable(point[0], point[2]));
  assert.ok(distance(point, [4, 0, 0]) <= 1.1);
});

test('tiny-cell masks fail open with a routing diagnostic instead of unbounded clearance work', async () => {
  const x = await ready();
  const tiny = x.player.decodeWalkable(mask(() => true, { origin: [0, 0], columns: 2, rows: 2, cell: 1e-9 }));
  const route = x.player.routeWalk(tiny, [0.5e-9, 0.5e-9], [1.5e-9, 1.5e-9]);
  assert.equal(route.points, null);
  assert.match(route.reason, /clearance|resolution|limit|mask/);
  assert.deepEqual(plain(x.player.routeWalk(tiny, [0.5e-9, 0.5e-9], [1.5e-9, 1.5e-9])), plain(route));
  const micro = mask(() => true, { origin: [0, 0], columns: 4, rows: 4, cell: 1e-6 });
  const floor = x.player.decodeWalkable(micro), from = [0.5e-6, 0.5e-6];
  assert.deepEqual(plain(x.player.slideWalk(floor, from, [1e6, 1e6])), from, 'tiny-cell sweep is refused before subdividing');
  const ordinary = x.player.decodeWalkable(mask());
  for (const delta of [[1e9, 0], [Infinity, 0], [NaN, 1]]) {
    assert.deepEqual(plain(x.player.slideWalk(ordinary, [0, 0], delta)), [0, 0], 'invalid or excessive sweeps cannot start work');
  }
  const keys = await ready({ options: { continuousWalking: true }, env: desktop, walkable: micro,
    stops: [stop('s1', ...from), stop('s2', 1.5e-6, 1.5e-6)] });
  const before = keys.state(); keys.canvas.focus(); keys.canvas.dispatch('keydown', { key: 'w' }); keys.advance(500);
  assert.deepEqual(keys.state(), before);
  assert.equal(keys.stats().motion.reason, 'route-resolution-limit');
});

test('human routes preserve chunk streaming, room arrival and releasing distant rooms', async () => {
  const stops = [0, 4, 8].map((x, index) => ({ ...stop('s' + (index + 1), x, 0, -90), room: 'r' + (index + 1) }));
  const record = manifest(stops);
  record.rooms = [1, 2, 3].map(number => ({ id: 'r' + number, name: 'Room ' + number, chunk: 'chunk_' + number,
    adjacent: number === 2 ? ['r1', 'r3'] : ['r2'] }));
  record.scene.layout = 'chunked'; record.scene.opening_chunk = 'chunk_1'; record.scene.lod_meta = 'lod/chunk_1/lod-meta.json';
  record.scene.chunks = [1, 2, 3].map((number, index) => ({ id: 'chunk_' + number, rooms: ['r' + number],
    adjacent: number === 2 ? ['chunk_1', 'chunk_3'] : ['chunk_2'], lod_meta: 'lod/chunk_' + number + '/lod-meta.json',
    lod_counts: [480000, 240000, 120000, 48000], bounds: { min: [-2 + index * 4, -1.5, -3], max: [2.2 + index * 4, 1.5, 3] },
    bytes: { total: 9e6, coarsest: 1e6 } }));
  const x = await ready({ options: { humanWalking: true, idleRefinement: true }, record });
  for (let i = 0; i < 6; i++) x.settleStep();
  assert.equal(x.stats().phase, 'complete');
  x.current.goToStop(2); x.advance(1100);
  assert.ok(x.state().position[0] < 7, 'streamed room navigation uses human duration');
  for (let i = 0; i < 145; i++) { x.frame(20); x.settleStep(); }
  assert.deepEqual(x.state().position, [8, 0, 0]);
  assert.equal(x.stats().chunk, 'chunk_3'); assert.equal(x.stats().stop, 2);
  assert.equal(x.stats().chunks.some(chunk => chunk.id === 'chunk_1'), false);
  assert.equal(x.stage.querySelector('.v2-room').textContent, 'Room 3');
  assert.match(x.stage.querySelector('.v2-sr').textContent, /Room 3, Stop 3 of 3/);
  const current = x.pc.assets.find(asset => asset.file.url.endsWith('chunk_3/lod-meta.json'));
  const cache = residentOctree(); current.resource = { octree: cache.octree }; x.advance(300);
  assert.equal(x.stats().refinement.reason, 'finer-over-budget', 'the neighbouring room counts toward the still splat budget');
  assert.equal(cache.refs.size, 0);
});

// ----- review fixes (7 October 2026): each test below failed on the first staged version -----

test('with every option off the player adds no key or focus listeners and a keyless keyup is harmless (F1, L3)', async () => {
  const x = await ready({ env: desktop });
  assert.equal((x.canvas.listeners.get('keyup') || []).length, 0);
  assert.equal((x.canvas.listeners.get('blur') || []).length, 0);
  assert.equal(x.windowListeners('blur'), 0);
  assert.doesNotThrow(() => x.canvas.dispatch('keyup', {}));
  const walking = await ready({ options: { continuousWalking: true }, env: desktop });
  walking.canvas.focus(); walking.canvas.dispatch('keydown', { key: 'w' }); walking.advance(200);
  assert.doesNotThrow(() => { walking.canvas.dispatch('keyup', {}); walking.canvas.dispatch('keydown', {}); });
  const held = walking.state(); walking.advance(200);
  assert.ok(distance(walking.state().position, held.position) > 0.1, 'an event without a key leaves the held key alone');
});

test('with every option off, returning to a hidden page keeps the governor sample it always took (L3)', async () => {
  const x = await ready({ settle: false });
  x.advance(200);
  const samples = x.stats().frames.length;
  x.document.hidden = true; x.documentEvent('visibilitychange'); x.time.advance(500);
  x.document.hidden = false; x.documentEvent('visibilitychange'); x.frame(20);
  assert.equal(x.stats().frames.length, samples + 1, 'the first frame back is timed against the last frame, as before');
});

test('an opt-in step that throws is switched off and every later frame still runs (L4)', async () => {
  const cameraOf = x => x.pc.entities.find(entity => entity.camera);
  const inertia = await ready({ options: { lookInertia: true }, env: desktop });
  drag(inertia, { dx: 400 });
  const camera = cameraOf(inertia), angles = camera.setEulerAngles;
  camera.setEulerAngles = () => { throw new Error('inertia boom'); };
  assert.doesNotThrow(() => inertia.frame());
  camera.setEulerAngles = angles;
  assert.match(inertia.stats().disabled.inertia, /inertia boom/);
  const coasting = inertia.state(); inertia.advance(300); assert.deepEqual(inertia.state(), coasting, 'the coast stops at once');
  drag(inertia, { dx: 400 }); const released = inertia.state(); inertia.advance(500);
  assert.deepEqual(inertia.state(), released, 'a switched-off option stays off');

  const keyboard = await ready({ options: { continuousWalking: true }, env: desktop });
  keyboard.canvas.focus(); keyboard.canvas.dispatch('keydown', { key: 'w' }); keyboard.advance(200);
  const keyCamera = cameraOf(keyboard), place = keyCamera.setPosition;
  keyCamera.setPosition = () => { throw new Error('keyboard boom'); };
  assert.doesNotThrow(() => keyboard.frame());
  keyCamera.setPosition = place;
  assert.match(keyboard.stats().disabled.keyboard, /keyboard boom/);
  const stopped = keyboard.state(); keyboard.advance(500); assert.deepEqual(keyboard.state(), stopped);
  assert.equal(Boolean(keyboard.canvas.dispatch('keydown', { key: 'w' }).defaultPrevented), false, 'W is back to doing nothing');

  const still = await ready({ options: { idleRefinement: true } });
  const width = Object.getOwnPropertyDescriptor(still.stage, 'clientWidth');
  Object.defineProperty(still.stage, 'clientWidth', { configurable: true, get() { throw new Error('refinement boom'); } });
  assert.doesNotThrow(() => still.advance(300));
  Object.defineProperty(still.stage, 'clientWidth', width);
  assert.match(still.stats().disabled.refinement, /refinement boom/);
  still.advance(3000);
  assert.equal(still.app.graphicsDevice.maxPixelRatio, 1.5);
  assert.equal(still.stats().refinement.reason, 'failed');

  const walk = await ready({ options: { humanWalking: true }, stops: [stop('s1', 0, 0), stop('s2', 4, 0)] });
  walk.current.goToStop(1); walk.advance(200);
  const walkCamera = cameraOf(walk), walkPlace = walkCamera.setPosition;
  walkCamera.setPosition = () => { throw new Error('walking boom'); };
  assert.doesNotThrow(() => walk.frame());
  walkCamera.setPosition = walkPlace;
  assert.match(walk.stats().disabled.walking, /walking boom/);
  walk.current.goToStop(0); walk.advance(1100);
  assert.deepEqual(walk.state().position, [0, 0, 0], 'stop moves fall back to the original glide');
});

test('a fault while releasing input on a lost graphics context still arms the five-second fallback (L4)', async () => {
  const x = await ready({ options: { continuousWalking: true }, env: desktop, stops: [stop('s1', 0, 0), stop('s2', 0, -4)] });
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'w' }); x.advance(500);
  x.pc.entities.find(entity => entity.camera).camera.worldToScreen = () => { throw new Error('hotspots gone'); };
  try { x.canvas.dispatch('webglcontextlost'); } catch { /* the old code threw here and never armed the wait */ }
  assert.equal(x.status(), 'Restoring 3D…');
  x.time.advance(5000);
  assert.equal(x.stage.querySelector('.v2').dataset.state, 'fallback');
});

test('a stalled frame moves a held key no further than a tenth of a second would (L5)', async () => {
  const x = await ready({ options: { continuousWalking: true }, env: desktop });
  x.canvas.focus(); x.canvas.dispatch('keydown', { key: 'w' }); x.advance(500);
  const before = x.state(); x.frame(1000);
  assert.ok(distance(x.state().position, before.position) <= 1.3 * 0.1 + 1e-9);
});

test('stops beside a wall or off the mask still move, and a viewer pressed to a wall can tap along it (H1)', async () => {
  // Floor for x < 0; a pillar between the two stops forces a route.
  const tight = mask((x, z) => x < 0 && !(Math.abs(x + 1) < 0.3 && Math.abs(z + 1) < 0.3));
  const x = await ready({ options: { humanWalking: true }, walkable: tight,
    stops: [stop('s1', -2, 0, -90), stop('s2', -0.05, -2), stop('s3', 0.05, -3)] });
  const floor = x.player.decodeWalkable(tight);
  x.current.goToStop(1);
  assert.equal(x.stats().motion.reason, 'routed', 'a stop 5 cm from a wall routes, relieved near its ends');
  for (let i = 0; i < 90; i++) { x.frame(50); assert.ok(floor.walkable(x.state().position[0], x.state().position[2])); }
  assert.deepEqual(x.state().position, [-0.05, 0, -2]); assert.equal(x.stats().stop, 1);
  x.current.goToStop(2); assert.equal(x.stats().motion.reason, 'outside-walkable-mask');
  x.advance(4500); assert.deepEqual(x.state().position, [0.05, 0, -3], 'a stop off the mask glides');
  x.current.goToStop(0); x.advance(4500);
  assert.equal(x.stats().stop, 0, 'and so does leaving it, from off the mask');

  const slide = await ready({ options: { humanWalking: true, continuousWalking: true }, env: desktop, walkable: mask(x => x < 0),
    stops: [stop('s1', -0.5, 0, -45), stop('s2', -2, -3)] });
  slide.canvas.focus(); slide.canvas.dispatch('keydown', { key: 'w' }); slide.advance(1500);
  slide.canvas.dispatch('keyup', { key: 'w' }); slide.advance(500);
  assert.ok(slide.state().position[0] > -0.05, 'the viewer is pressed against the wall');
  slide.current.tapAt(-10, -400);
  assert.equal(slide.stats().motion.reason, 'routed');
  slide.advance(4500);
  assert.ok(distance(slide.state().position, [-0.1, 0, -4]) < 1e-9);
});

test('reduced motion keeps the heading on a routed tap (L1)', async () => {
  const x = await ready({ options: { humanWalking: true }, reduced: true });
  const yaw = x.state().yaw;
  x.current.tapAt(200, 0);
  assert.deepEqual(x.state().position, [2, 0, 0]);
  assert.equal(x.state().yaw, yaw);
});

test('reduced motion keeps one step or turn per keydown, held keys repeating, exactly as with the option off (L2)', async () => {
  const run = async options => {
    const x = await ready({ options, reduced: true, env: desktop }); x.canvas.focus();
    for (const key of ['ArrowUp', 'ArrowLeft']) for (let i = 0; i < 6; i++) x.canvas.dispatch('keydown', { key, repeat: i > 0 });
    return x.state();
  };
  const continuous = await run({ continuousWalking: true });
  assert.ok(Math.abs(continuous.position[2] + 2.1) < 1e-9, 'six keydowns step 2.10 m');
  assert.equal(continuous.yaw, 60);
  assert.deepEqual(continuous, await run({}));
});

test('after the governor cuts detail, stillness adds no pixels; a slow refined frame ends refinement for the tab (M2)', async () => {
  const x = await ready({ options: { idleRefinement: true } });
  x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }); x.advance(4000, 50);
  const governed = x.app.graphicsDevice.maxPixelRatio;
  assert.ok(governed < 1.5);
  x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 30, clientY: 10 }); x.advance(3000);
  assert.equal(x.app.graphicsDevice.maxPixelRatio, governed);
  assert.equal(x.stats().refinement.reason, 'governor-cut');

  const storage = new Map();
  const slow = await ready({ options: { idleRefinement: true }, storage }); slow.advance(300);
  assert.ok(slow.app.graphicsDevice.maxPixelRatio > 1.5);
  slow.frame(200);
  assert.equal(slow.app.graphicsDevice.maxPixelRatio, 1.5);
  assert.equal(slow.stats().refinement.reason, 'slow-frame');
  slow.advance(5000); assert.equal(slow.app.graphicsDevice.maxPixelRatio, 1.5);
  const again = await ready({ options: { idleRefinement: true }, storage }); again.advance(5000);
  assert.equal(again.app.graphicsDevice.maxPixelRatio, 1.5);
  assert.equal(again.stats().refinement.reason, 'slow-frame');
});

test('short bursts of dragging do not resize the canvas every time (M3)', async () => {
  const x = await ready({ options: { idleRefinement: true } }); x.advance(300);
  assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5);
  let resizes = 0; const resize = x.app.updateCanvasSize; x.app.updateCanvasSize = () => { resizes++; resize.call(x.app); };
  for (let burst = 0; burst < 8; burst++) {
    x.canvas.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 200 });
    for (let i = 1; i <= 5; i++) { x.canvas.dispatch('pointermove', { pointerId: 1, clientX: 100 + i * 5, clientY: 200 }); x.frame(20); }
    x.canvas.dispatch('pointerup', { pointerId: 1, clientX: 125, clientY: 200 });
    x.advance(400);
  }
  // At most one refine and one cancel every two seconds; it was a refine and a cancel every burst (16).
  assert.ok(resizes <= 4, `${resizes} canvas resizes over eight bursts in four seconds`);
  x.advance(2500);
  assert.ok(x.app.graphicsDevice.maxPixelRatio > 1.5, 'two seconds of stillness refine again');
});

test('a node with no splats at the finer level keeps the governed level instead of vanishing (M4)', async () => {
  const x = await governedResidentScene();
  x.octree.nodes[1].lods[0] = { count: 0, fileIndex: -1 };
  x.advance(300);
  assert.equal(x.component.lodRangeMin, x.governed.min); assert.equal(x.component.lodRangeMax, x.governed.max);
  assert.equal(x.refs.size, 0);
  assert.equal(x.stats().refinement.reason, 'finer-not-resident');
});

test('a fast flick coasts at no more than 120 degrees a second, about 36 degrees in all', async () => {
  const x = await ready({ options: { lookInertia: true }, env: desktop }); drag(x, { dx: 800 });
  const released = x.state(); x.advance(100);
  const first = turn(released.yaw, x.state().yaw);
  assert.ok(first > 9 && first <= 120 * 0.3 * (1 - Math.exp(-0.1 / 0.3)) + 0.01, `${first} degrees in the first 100 ms`);
  x.advance(4000);
  const coast = turn(released.yaw, x.state().yaw);
  assert.ok(coast > 34 && coast <= 36.01, `${coast} degrees of coasting`);
});

test('a route out of time glides straight to a stop instead of refusing it (M1)', async () => {
  const wall = mask((x, z) => Math.abs(x) >= 0.3 || Math.abs(z) >= 2);
  const x = await ready({ options: { humanWalking: true }, walkable: wall, stops: [stop('s1', -2, 0), stop('s2', 2, 0)] });
  const clock = x.time.now;
  x.time.now = () => (x.time.t += 50); // every reading of the clock is 50 ms later
  x.current.goToStop(1);
  x.time.now = clock;
  assert.equal(x.stats().motion.reason, 'route-time-limit'); assert.equal(x.stats().motion.fallback, 'straight');
  x.advance(4500);
  assert.deepEqual(x.state().position, [2, 0, 0]); assert.equal(x.stats().stop, 1);
});
