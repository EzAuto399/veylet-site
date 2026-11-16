const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

// Point to point only (owner decision, 12 November 2026: "Remove free-walk mode"). Exercise the bundled player's
// real movement and tap closures and its manifest reader without a GPU or a second DOM imitation; the site suite
// drives the full player UI. PLAYER_SOURCE (a path) runs these against another copy, e.g. the 24d346f player.
const playerUrl = process.env.PLAYER_SOURCE || path.join(__dirname, '../dist/tour-player-v2.js');
const source = readFileSync(playerUrl, 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `player section ${start}`);
  return source.slice(a, b);
};
// Helpers an older player needs to run the same closures (absent from this one).
const optional = (start, end) => (source.includes(start) ? section(start, end) : '');

function loadPlayer() {
  const context = { window: {}, atob, URL };
  runInNewContext(source, context);
  return context.window.VeyletPlayerV2;
}

const plain = value => JSON.parse(JSON.stringify(value));
const STOP_HINT = 'Tap a numbered circle to move.';

function harness({ mask = true, blocked = false, upper = false, stops: given = null, path = undefined } = {}) {
  const stop = x => ({ position: [x, 0, 0], target: [x, -0.3, -2], floor: [x, -1.4, 0], floorMeasured: true });
  const stops = given || [stop(0), stop(1), stop(2)];
  if (upper) { stops[2].position[1] += 3; stops[2].target[1] += 3; stops[2].floor[1] += 3; }
  const bits = new Uint8Array(4).fill(255);
  if (blocked) bits[1] &= ~(1 << 7); // x=1.5, between stop 2 and stop 3
  const json = { version: 1, cell_metres: 0.1, origin: [0, 0], columns: 30, rows: 1,
    floor_y: -1.4, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
  const said = [];
  // A camera at the stop whose every ray points at stop 2's floor point (x = 1): a tap "right on" that stop.
  const camera = { camera: { nearClip: 0.05, farClip: 200, screenToWorld: (x, y, depth, out) => Object.assign(out, { x: depth, y: -1.4 * depth, z: 0 }) } };
  const context = {
    atob, Uint8Array, Math, Number, Boolean, Object, String, Set, Map, Promise, PlayerError: Error,
    performance: { now: () => context.time }, time: 0, setTimeout: () => 0, clearTimeout() {},
    state: { position: [...stops[0].position], yaw: 0, pitch: 0, stop: 0 }, manifest: { stops, start: 0, ...(path ? { path } : {}) },
    clamp: (n, min, max) => Math.min(max, Math.max(min, n)), reduced: () => false,
    applyCamera() {}, ready: true, dismissHint() {}, chunked: null, storeys: upper ? [{}, {}] : null,
    levelOf: upper ? [0, 0, 1] : null, levelAt: (_, position) => position[1] > 1.5 ? 1 : 0,
    STOREY_METRES: 1.5, labels: () => ({}), markCurrent() {}, placeHotspots() {},
    stopReachable: () => true, hotspotButtons: [{ hidden: false }],
    ui: { announce: {}, stopLine: {}, end: { hidden: true }, status: { set textContent(value) { said.push(value); }, get textContent() { return said.at(-1) || ''; } },
      canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    camera, pc: { Vec3: class { } },
    stopLabel: () => ({}), opening: 0, lastStop: -1, visit: {}, visitNumber: () => 1, torndown: false,
    maskJson: json, said,
  };
  runInNewContext(`${section('  function lookAngles(', '  function forwardOf(')}
    ${section('  function decodeWalkable(', '  /**')}
    ${section('  function corridorRoute(', '\n  }\n') + '\n  }\n'}
    ${optional('  // Walking a captured path', '  /** The stop nearest')}
    const walkable = ${mask ? 'decodeWalkable(maskJson)' : 'null'}; let continuous = 0, benchmark = null, lastRender = 0, flightFovOffset = 0;
    ${section('    // ----- movement -----', '    // ----- input -----')}
    this.move = goToStop; this.tap = tapAt; this.holds = () => continuous; this.last = () => lastMove;
    this.step = typeof stepFlight === 'function' ? stepFlight : () => {};`, context);
  return context;
}

const landed = (x, index) => {
  assert.deepEqual([...x.state.position], x.manifest.stops[index].position, 'at the stop itself, at once');
  assert.equal(x.state.stop, index);
  const d = x.manifest.stops[index].target.map((v, i) => v - x.manifest.stops[index].position[i]);
  assert.ok(Math.abs(x.state.yaw - Math.atan2(-d[0], -d[2]) * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(x.state.pitch - Math.asin(d[1] / Math.hypot(...d)) * 180 / Math.PI) < 1e-9);
  assert.equal(x.holds(), 0, 'nothing in flight holds the render loop');
  assert.equal(plain(x.last()).route, 'direct');
};

for (const kind of ['clear measured floor', 'blocked', 'missing mask', 'other storey']) {
  test(`every move is a jump to the stop's own place and look: ${kind}`, () => {
    const x = harness({ blocked: kind === 'blocked', mask: kind !== 'missing mask', upper: kind === 'other storey' });
    x.move(1);
    landed(x, 1);
    x.move(2);
    landed(x, 2);
    x.time = 5000; x.step(x.time);
    landed(x, 2);
  });
}

test('a tap on the scene never moves, even right on a stop: it says to tap a numbered circle', () => {
  const x = harness();
  x.tap(200, 300);
  assert.deepEqual([...x.state.position], x.manifest.stops[0].position, 'still at the first stop');
  assert.equal(x.state.stop, 0);
  assert.equal(x.last(), null, 'no move was made');
  assert.equal(x.said.at(-1), STOP_HINT);
});

// A package written while free walk existed: a floor mask, floor_measured stops and a walked path between them.
function walkPathManifest() {
  const stop = (id, x) => ({ id, room: 'r1', position: [x, 0, 0], target: [x, -0.3, -2], floor: [x, -1.4, 0], floor_measured: true });
  return {
    format: 'veylet.tour-package', package_format_version: 2,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 1, lod_counts: [1000], rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: { fov_degrees: 70, landscape: { path: 'poster-landscape.webp', width: 1600, height: 900 },
      portrait: { path: 'poster-portrait.webp', width: 900, height: 1600 }, preview: { path: 'preview.webp', width: 256, height: 144 } },
    walkable: { path: 'walkable.json' },
    rooms: [{ id: 'r1', name: 'Living area' }],
    stops: [stop('s1', 0), stop('s2', 1), stop('s3', 2)],
    start_stop: 0, truth_label: 'Rendered from photos of this room.',
    path: { version: 1, source: 'capture_poses', legs: [
      { from: 's1', to: 's2', points: [[0, 0, 0], [0.5, 0, 0.6], [1, 0, 0]], length_m: 1.56, max_gap_m: 0.78 },
      { from: 's2', to: 's3', points: [[1, 0, 0], [1.5, 0, -0.6], [2, 0, 0]], length_m: 1.56, max_gap_m: 0.78 },
    ] },
  };
}

test('a package with walk-path data loads, and only stop navigation is offered', () => {
  const player = loadPlayer();
  const manifest = player.validateManifest(walkPathManifest());
  assert.equal(manifest.stops.length, 3);
  assert.equal(manifest.walkable, 'walkable.json', 'the floor mask still names its file (circles and map)');
  assert.ok(!('path' in manifest), 'the walked path is not read');
  for (const stop of manifest.stops) assert.ok(!('floorMeasured' in stop), 'floor_measured is not read');
  // The same move a walked leg and a clear floor would once have walked is a jump.
  const x = harness({ stops: manifest.stops.map(stop => ({ ...stop })), path: manifest.path });
  x.move(1);
  landed(x, 1);
  x.move(2);
  landed(x, 2);
  // Odd walk data refuses nothing either.
  for (const path of [null, 'walk', { version: 9 }, { version: 1, source: 'capture_poses', legs: [{ from: 's1', to: 's9' }] }]) {
    assert.equal(player.validateManifest({ ...walkPathManifest(), path }).stops.length, 3);
  }
});

test('nothing of free walk is left: no walking helpers, no floor taps, and every hint names circles and Next', () => {
  const player = loadPlayer();
  for (const name of ['walkTarget', 'tetherToStations', 'tapAim', 'floorHit', 'readPath', 'pathRoute', 'walkPath', 'walkLook', 'walkEase', 'walkDuration']) {
    assert.ok(!(name in player), name);
  }
  for (const gone of ['Tap the floor', 'the floor or', 'probe:', 'TAP_RADIUS', 'walkAlong', 'function flyTo']) assert.ok(!source.includes(gone), gone);
  for (const hint of ["'Drag to look around. Tap a circle or Next to move.'", "'Drag to look. Tap a circle to move.'",
    "'Tap a numbered circle, or Next stop, to move.'", "'Tap a numbered circle to move.'", "'No circle in view. Tap Next.'"]) {
    assert.ok(source.includes(hint), hint);
  }
});
