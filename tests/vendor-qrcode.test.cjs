const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

// The vendored QR generator is a building block for the agent's share kit
// (built on the desk and in the app). Nothing on a visitor page uses it.
function load() {
  const window = {};
  const context = { window, URL, TextEncoder, navigator: {} };
  vm.runInNewContext(read('vendor/qrcode-1.5.4.min.js'), context);
  vm.runInNewContext(read('tour-sharing.js'), context);
  return { qr: window.VeyletQR, share: window.VeyletSharing };
}
const token = 'synthetic-fixture-token-live1';
const decode = segments => segments.map(segment => (typeof segment.data === 'string' ? segment.data : Buffer.from(segment.data).toString('utf8'))).join('');

test('a QR code of the walkthrough link carries exactly that link', () => {
  const { qr, share } = load();
  const link = share.handoffUrl(token);
  const matrix = qr.matrix(link, 'M');
  assert.equal(decode(matrix.segments), 'https://veylet.com/handoff?t=' + token);
  assert.equal(matrix.size, 17 + 4 * matrix.version);
  assert.equal(matrix.modules.length, matrix.size * matrix.size);
  const at = (row, col) => matrix.modules[row * matrix.size + col];
  for (const [row, col] of [[0, 0], [0, matrix.size - 7], [matrix.size - 7, 0]]) {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(i => at(row, col + i)), [1, 1, 1, 1, 1, 1, 1]); // finder pattern
    assert.deepEqual([at(row + 2, col + 2), at(row + 3, col + 3), at(row + 1, col + 1)], [1, 1, 0]);
  }
  assert.ok(qr.matrix(share.handoffUrl('a'.repeat(64)), 'M').version <= 7); // still phone-scannable
});

test('VeyletQR.svg draws every dark module once, on white, inside a four-module quiet zone', () => {
  const { qr, share } = load();
  const link = share.handoffUrl(token);
  const matrix = qr.matrix(link, 'M');
  const svg = qr.svg(link);
  const size = matrix.size + 2 * qr.quietZone;
  assert.equal(qr.quietZone, 4);
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"`));
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#ffffff"\/><path fill="#10231d"/);
  assert.match(svg, /aria-label="QR code for https:\/\/veylet\.com\/handoff\?t=synthetic-fixture-token-live1"/);
  const drawn = [...svg.matchAll(/M(\d+) (\d+)h(\d+)/g)];
  assert.equal(drawn.reduce((sum, m) => sum + Number(m[3]), 0), matrix.modules.reduce((sum, bit) => sum + bit, 0));
  assert.ok(drawn.every(m => Number(m[1]) >= 4 && Number(m[2]) >= 4));
  assert.match(qr.svg('x', { label: '"<a>"' }), /aria-label="&quot;&lt;a&gt;&quot;"/);
});

test('the QR generator and the engine are vendored with their licences and fetch nothing', () => {
  const qr = read('vendor/qrcode-1.5.4.min.js');
  assert.match(qr, /^\/\*! Veylet QR: node-qrcode 1\.5\.4 \(MIT/);
  assert.deepEqual([...qr.matchAll(/https?:\/\/[^"'\s]*/g)].map(m => m[0]), ['http://www.w3.org/2000/svg']); // the SVG namespace only
  assert.match(read('vendor/LICENSE.qrcode.txt'), /Copyright \(c\) 2012 Ryan Day/);
  assert.match(read('vendor/LICENSE.qrcode.txt'), /dijkstrajs/);
  assert.match(read('vendor/LICENSE.playcanvas.txt'), /Copyright \(c\) 2011-2026 PlayCanvas Ltd\./);
  assert.match(read('vendor/playcanvas-2.22.2.min.js').slice(0, 200), /PlayCanvas Engine v2\.22\.2/);
  assert.match(read('tour-player-v2.js'), /'\/vendor\/playcanvas-2\.22\.2\.min\.js\?v=[a-f0-9]{16}'/);
  // Visitor pages carry no share kit.
  for (const page of ['handoff/index.html', 'embed/index.html']) assert.doesNotMatch(read(page), /qrcode|handoff-kit|Domain listing/i, page);
});
