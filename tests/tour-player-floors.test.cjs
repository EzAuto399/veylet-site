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

function manifest(stops, rooms = [{ id: 'r1', name: 'Living room' }, { id: 'r2', name: 'Kitchen' }, { id: 'r3', name: 'Main bedroom' }], walkable = null, floorplan = null) {
  return {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: true, captured_on: null,
    truth_label: 'Synthetic test scene. Not a captured property. Not to scale.', generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [524921, 262461, 131230, 52492], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable, ...(floorplan ? { floorplan } : {}), rooms, stops, start_stop: 0, files: [],
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
async function ready(stops, { walkable = null, floorplan = null } = {}) {
  const run = load();
  const files = { 'manifest.json': manifest(stops, undefined, walkable ? { path: 'walkable.json' } : null, floorplan), 'walkable.json': walkable };
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
  assert.equal(x.map.hidden, true, 'starts with the map closed so the 3D scene leads');
  x.stage.querySelector('.v2-map-toggle').click();
  assert.equal(x.map.hidden, false);
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

// Point to point (owner decision, 11 November 2026). Was 'upstairs, a tap or an arrow-key walk is refused with a hint':
// the ground-floor 0.35 m step and the upstairs refusals are now moves to a stop on the viewer's own storey, or the hint.
// It still protects what VIEWER-01 was for: nothing a viewer does upstairs puts them on, or under, the ground storey.
test('a tap or an arrow key only ever goes to a stop on the viewer\'s storey: it never drops the viewer to the ground storey (VIEWER-01)', async () => {
  const x = await ready(TWO_FLOORS, { walkable: groundMask() });
  const eye = () => [...x.player.current.inspect().state.position];
  const HINT = 'No circle in view. Tap Next.'; // where the hint shows below, no circle is on screen
  // Ground floor, looking along -Z from stop 1: stop 2 (2 m ahead) and the bedroom's stop 4 (3 m ahead, one storey up)
  // are on the same line. The key goes to stop 2, the one on this storey, and to the stop itself, not a step along.
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.deepEqual(eye(), TWO_FLOORS[1].position, 'ground floor: the stop ahead on this storey');
  assert.deepEqual(x.where(), ['Living room', 'Stop 2 of 5']);
  assert.notEqual(x.status(), HINT);
  x.canvas.dispatch('keydown', { key: 'Home' });
  // Upstairs (stop 4), the mask is the floor below: a tap read against it would fall through.
  const next = x.stage.querySelector('.v2-next');
  next.click(); next.click(); next.click();
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  // Free walk removed (owner, 12 November 2026): a tap never moves, upstairs or down; Next goes to stop 5.
  x.player.current.tapAt(100, 100);
  assert.deepEqual(eye(), TWO_FLOORS[3].position, 'a tap never moves the viewer');
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  next.click();
  assert.deepEqual(eye(), TWO_FLOORS[4].position, 'Next goes to the stop on this storey, at its own height');
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 5 of 5']);
  // Ahead of stop 5 there is no stop on this storey: the hint, and no move.
  x.canvas.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(x.status(), HINT);
  assert.deepEqual(eye(), TWO_FLOORS[4].position, 'the arrow key does not move the viewer');
  // Behind it, the ground floor's stop 2 is the better aligned (9° against stop 4's 14°) but it is a storey down.
  x.canvas.dispatch('keydown', { key: 'ArrowDown' });
  assert.deepEqual(eye(), TWO_FLOORS[3].position, 'back goes to the stop on this storey, never down a storey');
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  assert.deepEqual(x.floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  // The next stop upstairs is still offered on the floor, although the ground mask has no say up here.
  assert.deepEqual(x.discs(), ['5']);
});

// Multi-storey walkable mask: open ground floor + upstairs floor split by a wall at z = -4.0 between s4 (z=-3) and s5 (z=-5).
function twoStoreyMask({ blockUpstairs = false } = {}) {
  const makeGrid = (floorY, wallRow) => {
    const columns = 50, rows = 90;
    const bits = new Uint8Array(Math.ceil(columns * rows / 8));
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      if (wallRow !== null && r >= wallRow && r < wallRow + 3) continue;
      bits[(r * columns + c) >> 3] |= 1 << ((r * columns + c) & 7);
    }
    return { cell_metres: 0.1, origin: [-2, -7], columns, rows, floor_y: floorY, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
  };
  const ground = makeGrid(-1.4, null);
  const level1 = makeGrid(1.4, blockUpstairs ? 29 : null); // z = -7 + 29*0.1 = -4.1..-3.8
  return {
    version: 1,
    ...ground,
    storey_levels: [
      { name: 'Ground', ...ground },
      { name: 'Level 1', ...level1 },
    ],
  };
}

test('decodeWalkable decodes storey_levels, buildMap renders per-storey floor/walls, and stopReachable uses the active storey mask', async () => {
  const { player } = load();
  const decoded = player.decodeWalkable(twoStoreyMask({ blockUpstairs: true }));
  assert.equal(decoded.floorY, -1.4);
  assert.equal(decoded.storeyLevels.length, 2);
  assert.equal(decoded.storeyLevels[0].floorY, -1.4);
  assert.equal(decoded.storeyLevels[1].floorY, 1.4);
  assert.ok(decoded.storeyLevels[1].walls.length > 0);
  // Single-entry storey_levels is ignored while preserving root mask properties.
  const singleEntry = player.decodeWalkable({ ...groundMask(), storey_levels: [groundMask()] });
  assert.equal(singleEntry.storeyLevels, undefined);

  const x = await ready(TWO_FLOORS, { walkable: twoStoreyMask({ blockUpstairs: true }) });
  x.stage.querySelector('.v2-map-toggle').click();
  const shown = node => node.getAttribute('display') !== 'none';
  const floors = x.map.querySelectorAll('.v2-map-floor');
  const walls = x.map.querySelectorAll('.v2-map-walls');
  assert.equal(floors.length, 2, 'renders one .v2-map-floor per storey');
  assert.equal(walls.length, 2, 'renders one .v2-map-walls per storey');
  assert.deepEqual(floors.map(shown), [true, false]);
  assert.deepEqual(walls.map(shown), [true, false]);

  // Switching map to Level 1 swaps floor and wall paths to Level 1.
  x.map.querySelectorAll('.v2-floor')[1].click();
  assert.deepEqual(floors.map(shown), [false, true]);
  assert.deepEqual(walls.map(shown), [false, true]);

  // Walking upstairs to stop 4: the Level 1 mask has a sealed wall between stop 4 and stop 5, so stop 5's disc is hidden.
  const next = x.stage.querySelector('.v2-next');
  next.click(); next.click(); next.click();
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  assert.deepEqual(x.discs(), [], 'upstairs wall in storeyLevels[1] hides stop 5 behind the wall');
});

test('multi-storey 2D floorplan tab & lightbox sync per-level images, viewBoxes, pins, heading cone, and minimalist level tags', async () => {
  const multiFp = {
    path: 'floorplan.webp',
    width: 1400,
    height: 1800,
    levels: [
      { name: 'Ground', path: 'floorplan-level-0.webp', width: 1400, height: 1000, bounds: [-2, -5, 4, 2] },
      { name: 'Level 1', path: 'floorplan-level-1.webp', width: 1200, height: 900, bounds: [-1, -6, 3, 0] },
    ],
  };
  const x = await ready(TWO_FLOORS, { floorplan: multiFp });
  const shown = node => node.getAttribute('display') !== 'none';
  x.stage.querySelector('.v2-map-toggle').click();

  const floorsGroup = x.map.querySelector('.v2-floors');
  assert.equal(x.map.children[0], floorsGroup, 'floor switcher stays first child of map');
  assert.equal(floorsGroup.style.display, undefined, 'no inline flex style on .v2-floors (styled in CSS)');

  // Room pills carry CSS-rendered data-level-tag while keeping plain room names as textContent.
  const pills = x.stage.querySelectorAll('.v2-room-pill');
  assert.deepEqual(pills.map(p => p.textContent), ['Living room', 'Kitchen', 'Main bedroom']);
  assert.deepEqual(pills.map(p => p.dataset.levelTag), ['G', 'G', 'L1']);

  // Lazy load: floorplan image is untouched before toggling Floorplan mode.
  const fpImg = x.map.querySelector('.v2-map-floorplan');
  assert.equal(fpImg.src, '');

  // Switch to Floorplan mode: floorsGroup stays visible because fpLevels matches storeys.
  x.map.querySelector('[data-map-mode="floorplan"]').click();
  assert.equal(floorsGroup.hidden, false, 'floors switcher stays visible in floorplan mode when per-level plans exist');
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  assert.deepEqual([fpImg.getAttribute('width'), fpImg.getAttribute('height')], ['1400', '1000']);
  const miniOverlay = x.map.querySelector('.v2-fp-overlay');
  assert.equal(miniOverlay.getAttribute('viewBox'), '0 0 1400 1000');
  assert.deepEqual(miniOverlay.querySelectorAll('.v2-fp-stop').filter(shown).map(n => n.textContent), ['1', '2', '3']);
  assert.equal(shown(miniOverlay.querySelector('.v2-fp-you')), true);

  // Switch floor to Level 1 via map switcher: swaps image, dims, viewBox, pins, and hides "you" while viewer stays on Ground.
  x.map.querySelectorAll('.v2-floor')[1].click();
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-1.webp');
  assert.deepEqual([fpImg.getAttribute('width'), fpImg.getAttribute('height')], ['1200', '900']);
  assert.equal(miniOverlay.getAttribute('viewBox'), '0 0 1200 900');
  assert.deepEqual(miniOverlay.querySelectorAll('.v2-fp-stop').filter(shown).map(n => n.textContent), ['4', '5']);
  assert.equal(shown(miniOverlay.querySelector('.v2-fp-you')), false);

  // Open Lightbox: renders .v2-fp-lightbox-floors in .v2-fp-lightbox-head synced bidirectionally with map switcher.
  x.map.querySelector('.v2-fp-expand').click();
  const lightbox = x.stage.querySelector('.v2-fp-lightbox');
  assert.equal(lightbox.hidden, false);
  const lbHead = lightbox.querySelector('.v2-fp-lightbox-head');
  const lbFloors = lbHead.querySelector('.v2-fp-lightbox-floors');
  assert.ok(lbFloors, 'lightbox head carries .v2-fp-lightbox-floors switcher');
  const lbBtns = lbFloors.querySelectorAll('.v2-floor');
  assert.deepEqual(lbBtns.map(b => [b.textContent, b.getAttribute('aria-pressed')]), [['Ground', 'false'], ['Level 1', 'true']]);
  const lbImg = lightbox.querySelector('.v2-fp-lightbox-img');
  assert.equal(lbImg.src, 'https://veylet.com/pkg/floorplan-level-1.webp');
  assert.deepEqual([lbImg.getAttribute('width'), lbImg.getAttribute('height')], ['1200', '900']);

  // Click Ground inside Lightbox: syncs both lightbox and mini-map back to Ground.
  lbBtns[0].click();
  assert.deepEqual(x.floors(), [['Ground', 'true'], ['Level 1', 'false']]);
  assert.deepEqual(lbBtns.map(b => b.getAttribute('aria-pressed')), ['true', 'false']);
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  assert.equal(lbImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  assert.equal(shown(lightbox.querySelector('.v2-fp-you')), true);

  // Click Level 1 in Lightbox, then click Stop 4's pin: teleports upstairs, closes lightbox, and shows "you" on Level 1.
  lbBtns[1].click();
  const lbOverlay = lightbox.querySelector('.v2-fp-overlay');
  assert.deepEqual(lbOverlay.querySelectorAll('.v2-fp-stop').filter(shown).map(n => n.textContent), ['4', '5']);
  lbOverlay.querySelectorAll('.v2-fp-stop')[3].click();
  assert.equal(lightbox.hidden, true);
  assert.deepEqual(x.where(), ['Main bedroom', 'Stop 4 of 5']);
  assert.equal(shown(miniOverlay.querySelector('.v2-fp-you')), true);
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-1.webp');

  // Stepping back downstairs via Previous auto-syncs floorplan image and switchers back to Ground.
  x.stage.querySelector('.v2-prev').click();
  assert.deepEqual(x.where(), ['Kitchen', 'Stop 3 of 5']);
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  assert.equal(lbImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  assert.deepEqual(x.floors(), [['Ground', 'true'], ['Level 1', 'false']]);
  assert.deepEqual(lbBtns.map(b => b.getAttribute('aria-pressed')), ['true', 'false']);
});

test('two-storey home with single-image floorplan (no levels) hides floorsGroup in floorplan mode and filters pins to start storey; single-storey room pills omit levelTag', async () => {
  const singleFp = { path: 'floorplan.webp', width: 1400, height: 1000, bounds: [-2, -5, 4, 2] };
  const x = await ready(TWO_FLOORS, { floorplan: singleFp });
  const shown = node => node.getAttribute('display') !== 'none';
  x.stage.querySelector('.v2-map-toggle').click();
  const floorsGroup = x.map.querySelector('.v2-floors');
  x.map.querySelector('[data-map-mode="floorplan"]').click();
  assert.equal(floorsGroup.hidden, true, 'floors switcher hides in floorplan mode when no per-level plans exist');
  const miniOverlay = x.map.querySelector('.v2-fp-overlay');
  assert.deepEqual(miniOverlay.querySelectorAll('.v2-fp-stop').filter(shown).map(n => n.textContent), ['1', '2', '3']);

  // Single-storey home omits data-level-tag on room pills.
  const one = await ready(ONE_FLOOR);
  assert.ok(one.stage.querySelectorAll('.v2-room-pill').every(p => p.dataset.levelTag === undefined));

  // CSS carries minimalist segmented floor switcher, floating corner expand button, bidirectional pill fade, and pure-CSS room level tag rules.
  const css = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.css'), 'utf8');
  assert.match(css, /\.v2-floors,\s*\n\.v2-fp-lightbox-floors\s*\{/);
  assert.match(css, /\.v2-room-pill\[data-level-tag\]::before\s*\{[^}]*content:\s*attr\(data-level-tag\)/);
  assert.match(css, /\.v2-room-pills\[data-more\]\[data-more-left\]/);
  assert.match(css, /\.v2-fp-expand\s*\{[^}]*position:\s*absolute;/);
});

test('stairs room pill uses connector tag, expand button sits inside fpWrap, and pillsMore sets bidirectional edge fades', async () => {
  const multiFp = {
    path: 'floorplan.webp',
    width: 1400,
    height: 1000,
    levels: [
      { name: 'Ground', path: 'floorplan-level-0.webp', width: 1400, height: 1000, bounds: [-2, -5, 4, 2] },
      { name: 'Level 1', path: 'floorplan-level-1.webp', width: 1400, height: 1000, bounds: [-2, -5, 4, 2] },
    ],
  };
  const stops = [
    stopAt('s1', 'r1', 0, 0, -1.4, 'f1'),
    stopAt('s2', 'r2', 1, -2, 0.0, undefined),
    stopAt('s3', 'r3', 0.5, -4, 1.4, 'f2'),
  ];
  const rooms = [
    { id: 'r1', name: 'Living room' },
    { id: 'r2', name: 'Stairs' },
    { id: 'r3', name: 'Main bedroom' },
  ];
  const run = load();
  const files = { 'manifest.json': manifest(stops, rooms, null, multiFp), 'walkable.json': null };
  run.context.fetch = async url => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[url.replace('https://veylet.com/pkg/', '')]) });
  const stage = run.document.createElement('div');
  stage.clientWidth = 1000; stage.clientHeight = 640;
  run.document.body.append(stage);
  const engine = fakeEngine();
  const pending = run.player.start(stage, { base: 'https://veylet.com/pkg/', env: desktop, framed: false,
    page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  const canvas = stage.querySelector('.v2-canvas');
  canvas.clientWidth = 1000; canvas.clientHeight = 640;
  for (let i = 0; i < 31; i++) engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;

  const pills = stage.querySelectorAll('.v2-room-pill');
  assert.deepEqual(pills.map(p => [p.textContent, p.dataset.levelTag]), [
    ['Living room', 'G'],
    ['Stairs', '↕'],
    ['Main bedroom', 'L1'],
  ]);
  assert.ok(pills[1].title.includes('Connects levels'));

  // Floating corner expand button sits inside .v2-fp-wrap, hidden until Floorplan mode, and opens lightbox.
  const map = stage.querySelector('.v2-map');
  const fpWrap = map.querySelector('.v2-fp-wrap');
  const expandBtn = fpWrap.querySelector('.v2-fp-expand');
  assert.ok(expandBtn, 'expand icon button lives inside .v2-fp-wrap');
  assert.equal(expandBtn.hidden, true);
  stage.querySelector('.v2-map-toggle').click();
  assert.equal(expandBtn.hidden, true, 'expand stays hidden in Stops mode');
  map.querySelector('[data-map-mode="floorplan"]').click();
  assert.equal(expandBtn.hidden, false);
  expandBtn.click();
  assert.equal(stage.querySelector('.v2-fp-lightbox').hidden, false);

  // Bidirectional overflow fade on horizontal scroll of .v2-room-pills.
  const roomsBar = stage.querySelector('.v2-room-pills');
  roomsBar.scrollWidth = 500;
  roomsBar.clientWidth = 260;
  roomsBar.scrollLeft = 0;
  roomsBar.dispatch('scroll');
  assert.equal(roomsBar.dataset.more, 'true');
  assert.equal(roomsBar.dataset.moreLeft, undefined);
  roomsBar.scrollLeft = 40;
  roomsBar.dispatch('scroll');
  assert.equal(roomsBar.dataset.more, 'true');
  assert.equal(roomsBar.dataset.moreLeft, 'true');
  roomsBar.scrollLeft = 240;
  roomsBar.dispatch('scroll');
  assert.equal(roomsBar.dataset.more, undefined);
  assert.equal(roomsBar.dataset.moreLeft, 'true');
});

test('jumping between two stops on Level 1 after manually inspecting Ground on the map syncs the map back to Level 1', async () => {
  const rooms = [
    { id: 'r1', name: 'Living room' },
    { id: 'r2', name: 'Kitchen' },
    { id: 'r3', name: 'Main bedroom' },
    { id: 'r4', name: 'Study' },
  ];
  const stops = [
    stopAt('s1', 'r1', 0, 0, -1.4, 'f1'),
    stopAt('s2', 'r1', 0, -2, -1.4, 'f1'),
    stopAt('s3', 'r2', 1, -3, -1.1, 'f2'),
    stopAt('s4', 'r3', 0, -3, 1.4, 'f3'),
    stopAt('s5', 'r4', 1.5, -5, 1.4, 'f3'),
  ];
  const multiFp = {
    path: 'floorplan.webp',
    width: 1400,
    height: 1800,
    levels: [
      { name: 'Ground', path: 'floorplan-level-0.webp', width: 1400, height: 1000, bounds: [-2, -6, 4, 2] },
      { name: 'Level 1', path: 'floorplan-level-1.webp', width: 1200, height: 900, bounds: [-2, -6, 4, 2] },
    ],
  };
  const run = load();
  const files = { 'manifest.json': manifest(stops, rooms, null, multiFp), 'walkable.json': null };
  run.context.fetch = async url => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[url.replace('https://veylet.com/pkg/', '')]) });
  const stage = run.document.createElement('div');
  stage.clientWidth = 1000; stage.clientHeight = 640;
  run.document.body.append(stage);
  const engine = fakeEngine();
  const pending = run.player.start(stage, { base: 'https://veylet.com/pkg/', env: desktop, framed: false,
    page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' }, loadEngine: async () => engine });
  for (let i = 0; i < 12; i++) await tick();
  const canvas = stage.querySelector('.v2-canvas');
  canvas.clientWidth = 1000; canvas.clientHeight = 640;
  for (let i = 0; i < 31; i++) engine.apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;

  const map = stage.querySelector('.v2-map');
  const shown = node => node.getAttribute('display') !== 'none';
  const floors = () => map.querySelectorAll('.v2-floor').map(b => [b.textContent, b.getAttribute('aria-pressed')]);
  const dots = () => map.querySelectorAll('.v2-map-stop').filter(shown).map(n => n.textContent);
  const youShown = () => shown(map.querySelector('.v2-map-you'));

  stage.querySelector('.v2-map-toggle').click();
  // Move to Main bedroom (stop 4, Level 1).
  const pills = stage.querySelectorAll('.v2-room-pill');
  pills[2].click();
  assert.equal(stage.querySelector('.v2-room').textContent, 'Main bedroom');
  assert.deepEqual(floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  assert.equal(youShown(), true);

  // Manually click Ground on the map while standing on Level 1.
  map.querySelectorAll('.v2-floor')[0].click();
  assert.deepEqual(floors(), [['Ground', 'true'], ['Level 1', 'false']]);
  assert.deepEqual(dots(), ['1', '2', '3']);
  assert.equal(youShown(), false);

  // Jump from Main bedroom (L1) to Study (L1): map must immediately sync back to Level 1.
  pills[3].click();
  assert.equal(stage.querySelector('.v2-room').textContent, 'Study');
  assert.deepEqual(floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  assert.deepEqual(dots(), ['4', '5']);
  assert.equal(youShown(), true);

  // Repeat in Floorplan mode: switch to Ground, jump back to Main bedroom (L1) -> image & switcher sync to Level 1.
  map.querySelector('[data-map-mode="floorplan"]').click();
  const fpImg = map.querySelector('.v2-map-floorplan');
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-1.webp');
  map.querySelectorAll('.v2-floor')[0].click();
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-0.webp');
  pills[2].click();
  assert.equal(stage.querySelector('.v2-room').textContent, 'Main bedroom');
  assert.deepEqual(floors(), [['Ground', 'false'], ['Level 1', 'true']]);
  assert.equal(fpImg.src, 'https://veylet.com/pkg/floorplan-level-1.webp');
});
