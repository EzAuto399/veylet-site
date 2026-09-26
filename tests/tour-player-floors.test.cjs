/*
 * Player v2 on a home with more than one level (launch review 26 September 2026, #15: the map flattened
 * every floor onto one plan). package_tour_v2.mjs gives each stop of a whole home a floor_id (f1, f2 …) and a
 * floor point; floors more than STOREY_METRES (1.5 m) apart are different storeys. The map shows one level at
 * a time with a Ground / Level 1 … switcher, follows the viewer between levels, and floor discs for another
 * level are not drawn through the ceiling. A home on one level keeps its map exactly as before.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const playerSource = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.js'), 'utf8');

// A stop standing on a floor at floorY, eye 1.4 m above it, looking along -z.
const stopAt = (id, room, x, z, floorY, floorId) => ({ id, room, position: [x, floorY + 1.4, z], target: [x, floorY + 1.1, z - 2],
  floor: [x, floorY, z], floor_measured: true, ...(floorId === undefined ? {} : { floor_id: floorId }) });

function manifest(stops, rooms = [{ id: 'r1', name: 'Living room' }, { id: 'r2', name: 'Kitchen' }, { id: 'r3', name: 'Main bedroom' }], walkable = null) {
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: true, captured_on: null,
    truth_label: 'Synthetic test scene. Not a captured property. Not to scale.', generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [524921, 262461, 131230, 52492], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable, rooms, stops, start_stop: 0, files: [],
  };
}

// The synthetic two-storey home: a ground floor with a 0.3 m step up to the kitchen (a split level, not a
// storey), and a bedroom level 2.8 m above.
const TWO_FLOORS = [
  stopAt('s1', 'r1', 0, 0, -1.4, 'f1'),
  stopAt('s2', 'r1', 0, -2, -1.4, 'f1'),
  stopAt('s3', 'r2', 1, -3, -1.1, 'f2'),
  stopAt('s4', 'r3', 0, -3, 1.4, 'f3'),
  stopAt('s5', 'r3', 0.5, -5, 1.4, 'f3'),
];
// The same home as package_tour_v2.mjs writes a single-room package: no floor ids.
const ONE_FLOOR = TWO_FLOORS.map((stop, index) => stopAt(stop.id, stop.room, stop.floor[0], stop.floor[2], -1.4 + (index % 2) * 0.05));

function fakeEngine() {
  class Emitter { constructor() { this.handlers = {}; } on(e, f) { (this.handlers[e] ||= []).push(f); } fire(e, ...a) { for (const f of this.handlers[e] || []) f(...a); } }
  class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  class Entity {
    addComponent(type) {
      // screenToWorld: every tap looks down and ahead (-z) from where the upstairs stop stands.
      if (type === 'camera') this.camera = { fov: 70, horizontalFov: false, nearClip: 0.05, farClip: 200, worldToScreen: (w, s) => s.set(100, 100, 1),
        screenToWorld: (x, y, depth, out) => out.set(0, 2.8 - depth * 0.6, -3 - depth * 0.8) };
      if (type === 'gsplat') this.gsplat = { lodRangeMin: 0, lodRangeMax: 99 };
    }
    setPosition() {} setEulerAngles() {} setLocalEulerAngles() {}
  }
  const apps = [];
  class Application extends Emitter {
    constructor() {
      super();
      this.scene = { gsplat: {} }; this.root = { addChild() {} }; this.assets = { add() {}, load() {} };
      this.systems = { gsplat: new Emitter() }; this.loader = { getHandler: () => ({ imgParser: {} }) };
      apps.push(this);
    }
    setCanvasFillMode() {} setCanvasResolution() {} updateCanvasSize() {} start() {} destroy() {}
  }
  return { apps, createGraphicsDevice: async () => ({ deviceType: 'webgl2', on() {}, maxPixelRatio: 1 }), Application, Entity,
    Asset: class extends Emitter {}, Vec3, Color: class { fromString() { return this; } }, FILLMODE_NONE: 0, RESOLUTION_AUTO: 0 };
}

function load() {
  const document = createDocument({
    onImage: node => setImmediate(() => node.dispatch('load')),
    onHeadAppend: node => { if (node.tagName === 'LINK') setImmediate(() => node.onload && node.onload()); },
  });
  const window = { matchMedia: () => ({ matches: true }), screen: { width: 1280, height: 800 }, devicePixelRatio: 1 };
  const context = {
    window, document, performance, setTimeout, clearTimeout, setImmediate, URL, atob, AbortController, console,
    location: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com', reload() {} },
    navigator: {}, localStorage: { getItem: () => '1', setItem() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async () => { throw new Error('set per run'); },
  };
  vm.runInNewContext(playerSource, context);
  return { player: window.VeyletPlayerV2, document, context };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
// Values made inside the player's context, compared as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const desktop = { screenWidth: 1280, screenHeight: 800, dpr: 1, coarse: false, touchPoints: 0, webgl2: true, webgpu: false };

/** The player on a 1000 px stage of its own page (the map opens), ready, with reduced motion (moves are cuts). */
async function ready(stops, { walkable = null } = {}) {
  const run = load();
  const files = { 'manifest.json': manifest(stops, undefined, walkable ? { path: 'walkable.json' } : null), 'walkable.json': walkable };
  run.context.fetch = async url => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[url.replace('https://veylet.com/pkg/', '')]) });
  const stage = run.document.createElement('div');
  stage.clientWidth = 1000; stage.clientHeight = 640;
  run.document.body.append(stage);
  const engine = fakeEngine();
  const pending = run.player.start(stage, { base: 'https://veylet.com/pkg/', env: desktop, framed: false,
    page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  const canvas = stage.querySelector('.v2-canvas');
  canvas.clientWidth = 1000; canvas.clientHeight = 640; // floor discs land on screen
  for (let i = 0; i < 31; i++) engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;
  const map = stage.querySelector('.v2-map');
  const shown = node => node.getAttribute('display') !== 'none';
  return {
    stage, map, player: run.player, canvas,
    status: () => stage.querySelector('.v2-status').textContent,
    dots: () => map.querySelectorAll('.v2-map-stop').filter(shown).map(dot => dot.textContent),
    floors: () => map.querySelectorAll('.v2-floor').map(button => [button.textContent, button.getAttribute('aria-pressed')]),
    youShown: () => shown(map.querySelector('.v2-map-you')),
    discs: () => stage.querySelectorAll('.v2-hotspot').filter(button => !button.hidden).map(button => button.textContent),
    where: () => [stage.querySelector('.v2-room').textContent, stage.querySelector('.v2-stop').textContent],
  };
}

// ---------- pure rules ----------

test('levels: floors more than 1.5 m apart are storeys, lowest first as Ground, Level 1, Level 2; a split level is one storey', () => {
  const { player } = load();
  const levels = stops => player.storeysOf(player.validateManifest(manifest(stops)).stops);
  const two = levels(TWO_FLOORS);
  assert.deepEqual(plain(two.map(({ name, floorIds, stops }) => ({ name, floorIds, stops }))),
    [{ name: 'Ground', floorIds: ['f1', 'f2'], stops: [0, 1, 2] }, { name: 'Level 1', floorIds: ['f3'], stops: [3, 4] }]);
  // One level, however it is described: no floor ids, one floor id, or a 0.3 m split level.
  assert.equal(levels(ONE_FLOOR), null);
  assert.equal(levels(TWO_FLOORS.map(stop => ({ ...stop, floor_id: 'f1' }))), null);
  assert.equal(levels(TWO_FLOORS.slice(0, 3)), null);
  // Three storeys listed top floor first, starting upstairs: still named from the bottom.
  const three = levels([stopAt('s1', 'r3', 0, 0, 4.2, 'f1'), stopAt('s2', 'r2', 0, -2, 1.4, 'f2'), stopAt('s3', 'r1', 0, -3, -1.4, 'f3')]);
  assert.deepEqual(plain(three.map(level => [level.name, level.stops])), [['Ground', [2]], ['Level 1', [1]], ['Level 2', [0]]]);
  // A stop the packager could not place on a floor (floor_id null) joins the level nearest its floor point;
  // an id that is not the packager's is ignored rather than refusing the walkthrough.
  const loose = levels([...TWO_FLOORS.slice(0, 4), stopAt('s5', 'r3', 0.5, -5, 1.3, null)]);
  assert.deepEqual(plain(loose[1].stops), [3, 4]);
  const manifestOdd = player.validateManifest(manifest([...TWO_FLOORS.slice(0, 4), stopAt('s5', 'r3', 0.5, -5, 1.4, '../f3')]));
  assert.equal(manifestOdd.stops[4].floorId, null);
  // Which level an eye is on, and the nearest stop on your own level only.
  assert.equal(player.levelAt(two, [0, 0, 0]), 0);
  assert.equal(player.levelAt(two, [0, 2.8, 0]), 1);
  const record = player.validateManifest(manifest(TWO_FLOORS));
  assert.equal(player.nearestStop(record, [0.1, 0, -3.1], 0.35), 3, 'across the floor alone, the stop upstairs is nearer');
  assert.equal(player.nearestStop(record, [0.1, 0, -3.1], 99, 1.5), 2, 'on the ground floor, the kitchen stop');
});

// ---------- the player ----------

test('a two-storey home: the map shows one level with a Ground / Level 1 switcher and follows the viewer upstairs', async () => {
  const x = await ready(TWO_FLOORS);
  assert.equal(x.map.hidden, false, 'a wide stage on its own page opens with the map');
  const group = x.map.querySelector('.v2-floors');
  assert.ok(group, 'the floor switcher is on the map');
  assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-label')], ['group', 'Floors']);
  assert.equal(x.map.children[0], group, 'the switcher sits above the plan');
  assert.equal(x.map.querySelector('figcaption').textContent, 'Map of stops · not to scale');
  assert.deepEqual(x.floors(), [['Ground', 'true'], ['Level 1', 'false']]);
  assert.ok(x.map.querySelectorAll('.v2-floor').every(button => button.tagName === 'BUTTON' && button.className.includes('v2-icon')), '44 px controls');
  assert.deepEqual(x.dots(), ['1', '2', '3'], 'the ground floor only, with its split-level kitchen');
  assert.equal(x.youShown(), true);
  // Floor discs: the next stops on this level, never the bedroom above the ceiling.
  assert.deepEqual(x.discs(), ['2', '3']);

  // Look upstairs without moving: the map changes level, the viewer stays put, and "you" is not drawn there.
  x.map.querySelectorAll('.v2-floor')[1].click();
  assert.deepEqual(x.floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  assert.deepEqual(x.dots(), ['4', '5']);
  assert.equal(x.youShown(), false);
  assert.deepEqual(x.where(), ['Living room', 'Stop 1 of 5']);
  x.map.querySelectorAll('.v2-floor')[0].click();
  assert.deepEqual(x.dots(), ['1', '2', '3']);

  // Walk on with Next: at stop 4 the viewer is upstairs, and the map and the discs follow.
  const next = x.stage.querySelector('.v2-next');
  next.click(); next.click(); next.click();
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  assert.deepEqual(x.floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  assert.deepEqual(x.dots(), ['4', '5']);
  assert.equal(x.youShown(), true);
  assert.deepEqual(x.discs(), ['5']);
  // And back down with Previous.
  x.stage.querySelector('.v2-prev').click();
  assert.deepEqual(x.where(), ['Kitchen', 'Stop 3 of 5']);
  assert.deepEqual(x.floors(), [['Ground', 'true'], ['Level 1', 'false']]);
});

test('a home on one level keeps its map as before: no switcher, every stop drawn', async () => {
  for (const stops of [ONE_FLOOR, TWO_FLOORS.map(stop => ({ ...stop, floor_id: 'f1', floor: [stop.floor[0], -1.4, stop.floor[2]], position: [stop.position[0], 0, stop.position[2]], target: [stop.target[0], -0.3, stop.target[2]] }))]) {
    const x = await ready(stops);
    assert.equal(x.map.querySelector('.v2-floors'), null);
    assert.deepEqual(x.map.children.map(node => node.tagName), ['SVG', 'FIGCAPTION']);
    assert.deepEqual(x.dots(), ['1', '2', '3', '4', '5']);
    assert.ok(x.map.querySelectorAll('.v2-map-stop, .v2-map-you, .v2-map-floor').every(node => node.getAttribute('display') === null));
    assert.deepEqual(x.discs(), ['2', '3', '4', '5']);
  }
});

// The ground floor's walkable mask (package_tour_v2.mjs carves it for the opening stop's storey only):
// 5 x 9 m of open floor under the whole home, 0.1 m cells, floor at -1.4 m.
function groundMask() {
  const columns = 50, rows = 90;
  const bits = new Uint8Array(Math.ceil(columns * rows / 8)).fill(255);
  return { version: 1, cell_metres: 0.1, origin: [-2, -7], columns, rows, floor_y: -1.4, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
}

test('upstairs, a tap or an arrow-key walk is refused with a hint: it never drops the viewer to the ground storey (VIEWER-01)', async () => {
  const x = await ready(TWO_FLOORS, { walkable: groundMask() });
  const eye = () => x.player.current.inspect().state.position;
  // On the ground floor the mask is the floor you stand on: the arrow keys walk.
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.ok(Math.abs(eye()[2] + 0.35) < 1e-6, 'ground floor: one step ahead');
  assert.notEqual(x.status(), 'Use Next stop or a numbered circle on this floor.');
  x.canvas.dispatch('keydown', { key: 'Home' });
  // Upstairs (stop 4), the mask is the floor below: a step or a tap would fall through it.
  const next = x.stage.querySelector('.v2-next');
  next.click(); next.click(); next.click();
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  const upstairs = [...eye()];
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(x.status(), 'Use Next stop or a numbered circle on this floor.');
  assert.deepEqual([...eye()], upstairs, 'the arrow key does not move the viewer');
  x.player.current.tapAt(100, 100);
  assert.equal(x.status(), 'Use Next stop or a numbered circle on this floor.');
  assert.deepEqual([...eye()], upstairs, 'a tap does not move the viewer');
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  assert.deepEqual(x.floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  // The next stop upstairs is still offered on the floor, although the ground mask has no say up here.
  assert.deepEqual(x.discs(), ['5']);
});
