// Client pages, 10 November 2026, phase 3: plain words, small frames, contrast and reading order.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { realPlayer } = require('./client-words.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const PAGES = ['handoff/index.html', 'tour/index.html', 'embed/index.html'];
const CLIENT_FILES = [...PAGES, 'tour-player.js', 'tour-player-v2.js', 'client-page.js'];

test('no client file says "player files", "hardware acceleration", "Viewer document" or "Reconstructed walkthrough"', () => {
  for (const file of CLIENT_FILES) {
    const text = read(file);
    for (const words of ['player files', 'hardware acceleration', 'Viewer document', 'Reconstructed walkthrough', 'numbered circle to walk'])
      assert.equal(text.includes(words), false, file + ' says "' + words + '"');
  }
  for (const file of PAGES) assert.match(read(file), /title="3D walkthrough"/, file);
});

test('offline says so and names reconnecting; a file that did not load names the connection', async () => {
  const shown = [];
  const offline = realPlayer({ navigator: { onLine: false } });
  offline.showFailure = (els, options) => shown.push(options);
  await offline.boot({ els: {}, client: true, resolve: async () => ({}) });
  assert.equal(shown[0].body, 'You seem to be offline. Reconnect and try again.');
  assert.equal(shown[0].retry, true);
});

// Split on 11 November 2026 (tours are point to point): the page's half is unchanged and belongs to the session
// rewriting that sentence; the player's half names circles and Next, never the floor.
test('the help under the stage names the numbered circles and Next stop, never the floor', () => {
  const sentence = 'Drag to look around. Tap a numbered circle, or Next stop, to move.';
  assert.ok(read('handoff/index.html').includes('<p>' + sentence + '</p>'));
  assert.equal(read('handoff/index.html').includes('Tap the floor'), false);
});

test('the hint in the player names circles and Next, and no longer the floor', () => {
  const player = read('tour-player-v2.js');
  assert.ok(player.includes("'Drag to look around. Tap a circle or Next to move.'"));
  assert.equal(player.includes('Tap the floor'), false);
});

test('contrast: a stop circle is paper on 72 % ink, and the embed invitation starts at 78 % ink', () => {
  // Paper #f4f1e9 on ink #10231d at the given strength over white, by the WCAG formula.
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (alpha, fg = [16, 35, 29], bg = [255, 255, 255]) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const css = read('tour-player-v2.css');
  const spot = css.match(/\.v2-hotspot span \{[^}]*background: rgba\(16, 35, 29, ([\d.]+)\)/);
  assert.ok(spot, 'the stop circle has an ink background');
  assert.ok(ratio([244, 241, 233], over(Number(spot[1]))) >= 4.5, 'paper on the circle over a white floor');
  assert.doesNotMatch(css, /\.v2-hotspot\[data-next="true"\] span \{[^}]*background/, 'the next stop keeps the same ground');
  const start = read('embed/index.html').match(/linear-gradient\(rgba\(16, 35, 29, ([\d.]+)\)/);
  assert.ok(ratio([244, 241, 233], over(Number(start[1]))) >= 7, 'the invitation heading over a white poster');
});

test('a 240 px embed slot: the invitation drops its sentence and Report joins the button row', () => {
  const html = read('embed/index.html');
  const block = html.match(/@media \(max-height: 280px\) \{([\s\S]*?)\n      \}/);
  assert.ok(block, 'a rule for a short slot');
  assert.match(block[1], /\.embed-fallback\[data-invite\] #embed-body \{ display: none; \}/);
  assert.match(block[1], /flex-flow: row wrap/);
  // Only the invitation is shortened: a dead link and the loading state keep their sentence.
  assert.match(html, /const offer = \(\) => \{[^}]*fallback\.dataset\.invite = 'shown'/);
  assert.equal(html.split('delete fallback.dataset.invite').length - 1, 2);
});

test('a short tour frame: one title row, and the player panels scroll inside the stage', () => {
  const html = read('tour/index.html');
  const block = html.match(/@media \(max-height: 500px\) \{([\s\S]*?)\n      \}/);
  assert.ok(block, 'a rule for a short frame');
  assert.match(block[1], /\.tour-truth \{ display: none; \}/);
  assert.match(block[1], /\.tour-head \{[^}]*min-height: 44px/);
  const css = read('tour-player-v2.css');
  assert.match(css, /max-height: max\(calc\(100% - 136px\), min\(calc\(100% - 80px\), 220px\)\);/);
});

test('the agent bar comes before the walkthrough in reading order, and focus stops above it', () => {
  const html = read('handoff/index.html');
  assert.ok(html.indexOf('id="agent-bar"') < html.indexOf('<main id="main"'), 'Call and Email are reached before the footer');
  assert.equal(html.split('id="agent-bar"').length - 1, 1);
  assert.match(read('client-page.css'), /html\.client-has-bar \{\s*scroll-padding-bottom: calc\(80px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(read('client-page.js'), /documentElement\?\.classList\?\.add\('client-has-bar'\)/);
});

test('About on a touch screen: no keys line, and the engine credit sits behind Credits', () => {
  const css = read('tour-player-v2.css');
  assert.match(css, /@media \(pointer: coarse\) \{ \.v2-keys \{ display: none; \} \}/);
  const js = read('tour-player-v2.js');
  assert.match(js, /el\('li', \{ class: 'v2-keys' \}, 'Keys/);
  assert.match(js, /el\('details', \{ class: 'v2-credits' \}\)/);
  assert.match(js, /el\('summary', \{\}, 'Credits'\)/);
});
