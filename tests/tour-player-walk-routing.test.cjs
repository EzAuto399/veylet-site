// Human-walking routes as pure functions: the per-mask clearance grid, the time and size bounds, and what a route
// costs in a whole house. Loaded in a sandbox like the other player tests, with a clock that never moves on its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dist/tour-player-v2.js'), 'utf8');

function load() {
  const context = { window: {}, performance: { now: () => 0 }, atob };
  vm.runInNewContext(source, context);
  return context.window.VeyletPlayerV2;
}
function mask(open, { origin = [0, 0], columns, rows, cell }) {
  const bits = new Uint8Array(Math.ceil(columns * rows / 8));
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    if (open(origin[0] + (c + 0.5) * cell, origin[1] + (r + 0.5) * cell)) { const i = r * columns + c; bits[i >> 3] |= 1 << (i & 7); }
  }
  return { version: 1, cell_metres: cell, origin, columns, rows, floor_y: 0, eye_height: 1.4, mask: Buffer.from(bits).toString('base64') };
}
// An 18 x 9 m house: 10 cm outer and inner walls, rooms 6 m wide, doors at alternating ends, a corridor wall along the middle.
const house = (width, depth) => (x, z) => {
  if (x < 0.1 || z < 0.1 || x > width - 0.1 || z > depth - 0.1) return false;
  for (let i = 1; i * 6 < width; i++) {
    const door = i % 2 ? z > depth - 1.4 && z < depth - 0.5 : z > 0.5 && z < 1.4;
    if (Math.abs(x - i * 6) < 0.05 && !door) return false;
  }
  return !(Math.abs(z - depth / 2) < 0.05 && !(x % 6 > 2.5 && x % 6 < 3.4));
};
const onFloor = (floor, points) => points.slice(1).every((point, i) => floor.clear(points[i], point));

test('the clearance grid equals the exact clearance scan at every cell centre', () => {
  const player = load();
  let seed = 7; const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const cell of [0.1, 0.05, 0.23]) {
    const floor = player.decodeWalkable(mask(() => random() > 0.15, { origin: [-1, 2], columns: 37, rows: 23, cell }));
    const grid = player.clearanceGrid(floor);
    assert.equal(player.clearanceGrid(floor), grid, 'built once per mask');
    for (let r = 0; r < floor.rows; r++) for (let c = 0; c < floor.columns; c++) {
      const exact = player.floorClearance(floor, [-1 + (c + 0.5) * cell, 2 + (r + 0.5) * cell]);
      assert.ok(Math.abs(grid[r * floor.columns + c] - exact) < 1e-6, `cell ${c},${r} at ${cell} m`);
    }
  }
});

test('an 18 x 9 m house routes corner to corner at 0.1 m cells within 100 ms, grid included', () => {
  const player = load();
  const floor = player.decodeWalkable(mask(house(18, 9), { columns: 180, rows: 90, cell: 0.1 }));
  const started = process.hrtime.bigint();
  const route = player.routeWalk(floor, [0.5, 0.5], [17.5, 8.5]);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(route.reason, 'routed');
  assert.ok(route.distance > 25 && route.distance < 32, `${route.distance} m`);
  assert.ok(onFloor(floor, route.points), 'every leg stays on open floor');
  assert.ok(ms < 100, `first route took ${ms.toFixed(1)} ms`);
  const fine = player.decodeWalkable(mask(house(18, 9), { columns: 360, rows: 180, cell: 0.05 }));
  assert.equal(player.routeWalk(fine, [0.5, 0.5], [17.5, 8.5]).reason, 'routed', '5 cm cells route the same house');
});

test('out of time while searching there is no route; out of time while cutting corners the path is kept uncut', () => {
  const player = load();
  const floor = player.decodeWalkable(mask(house(18, 9), { columns: 180, rows: 90, cell: 0.1 }));
  let readings = 0;
  const counted = player.routeWalk(floor, [0.5, 0.5], [17.5, 8.5], { now: () => (readings++, 0) });
  assert.equal(counted.reason, 'routed');
  const expireAt = reading => { let n = 0; return () => (++n >= reading ? 1e9 : 0); };
  assert.deepEqual(JSON.parse(JSON.stringify(player.routeWalk(floor, [0.5, 0.5], [17.5, 8.5], { now: expireAt(2) }))),
    { points: null, distance: 0, reason: 'route-time-limit' });
  const uncut = player.routeWalk(floor, [0.5, 0.5], [17.5, 8.5], { now: expireAt(readings) });
  assert.equal(uncut.reason, 'routed-unsmoothed');
  assert.ok(uncut.points.length > counted.points.length && uncut.distance >= counted.distance);
  assert.ok(onFloor(floor, uncut.points), 'the uncut path is still a walk over open floor');
});

test('routes never step diagonally between two blocked corners and refuse oversized masks', () => {
  const player = load();
  // Open cells (0,0) and (1,1) touch only at a corner.
  const corner = player.decodeWalkable(mask((x, z) => (x < 0.5) === (z < 0.5), { columns: 2, rows: 2, cell: 0.5 }));
  assert.equal(player.routeWalk(corner, [0.25, 0.25], [0.75, 0.75]).reason, 'unreachable');
  const huge = { ...player.decodeWalkable(mask(() => true, { columns: 4, rows: 4, cell: 0.1 })), columns: 2048, rows: 1024 };
  assert.equal(player.routeWalk(huge, [0.05, 0.05], [0.35, 0.35]).reason, 'route-size-limit');
});
