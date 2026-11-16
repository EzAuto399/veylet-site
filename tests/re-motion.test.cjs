'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const dist = path.join(__dirname, '..', 'dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');

test('hero and walk-demo illustrations use v1.1 room-and-spot language, never "views saved"', () => {
  for (const page of ['index.html', 'offer/index.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /views saved/i, `${page} must not show retired "views saved" copy`);
    assert.match(html, /data-cap-spots/, `${page} hero phone shows spot progress dashes`);
    assert.match(html, /Room 2/, `${page} hero phone names the room number`);
    assert.match(html, /veylet\.com\/handoff\//, `${page} hero link card shows the real buyer handoff route`);
  }
});

test('CSS motion tokens: product-stage entrance, no scale(0), strong ease-out press, hover media gate, non-destructive reduced motion', () => {
  const style = read('style.css');
  const showcase = read('showcase.css');

  assert.match(style, /--ease-out-strong:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/, 'strong ease-out token');
  assert.match(showcase, /\.product-stage\s*\{[\s\S]*?animation:\s*veylet-rise/, 'product-stage has entrance choreography');
  assert.doesNotMatch(showcase, /scale\(0\)/, 'never animate from scale(0)');
  assert.match(style, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.button:hover/, 'button hover gated for pointer devices');
  assert.match(style, /\.button:active[\s\S]*?scale\(0\.97\)/, 'tactile 0.97 button press');
  assert.doesNotMatch(style, /transition(?:-duration)?:\s*(?:none|0s)\s*!important/, 'reduced motion preserves gentle opacity/colour transitions instead of nuking all feedback');
  assert.match(style, /body\[data-scrolled="true"\]\s*>\s*header\.wrap/, 'frosted header activates via data-scrolled without changing static header.wrap class');
});

test('architectural dollhouse uses GPU layer groups, numbered stops, room labels, and interruptible tweenTo on step click', () => {
  const js = read('showcase.js');
  assert.doesNotMatch(js, /p\.node\.setAttribute\('cx'/, 'never mutates 150 SVG circle cx attributes per frame');
  assert.match(js, /w-cloud-layer/, 'groups cloud points into composited layers');
  assert.match(js, /w-room-label/, 'draws architectural room labels');
  assert.match(js, /w-stop-num/, 'draws numbered floor stops matching player v2');
  assert.match(js, /tl\.tweenTo\(/, 'clicking a step smoothly scrubs from current position via tweenTo');
});

test('homepage see-band provides an interactive multi-room preview while keeping exactly one /see link', () => {
  const home = read('index.html');
  const seeBand = home.match(/<section class="see-band[\s\S]*?<\/section>/)[0];
  assert.equal((seeBand.match(/href="\/see"/g) || []).length, 1, 'keeps one /see link');
  assert.match(seeBand, /data-home-preview/, 'interactive preview container exists');
  for (const room of ['Living area', 'Kitchen', 'Workshop', 'Bedroom']) {
    assert.match(seeBand, new RegExp(`data-preview-room="${room}"`), `button for ${room}`);
  }
});

test('interactive homepage room preview switches rooms on button click and horizontal drag without blocking vertical scroll', () => {
  const document = createDocument();
  const make = (tag, attrs = {}, parent = null) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.append(node);
    return node;
  };
  const preview = make('div', { 'data-home-preview': '' }, document.body);
  const viewport = make('div', { 'data-preview-viewport': '' }, preview);
  const imgA = make('img', { 'data-preview-img': 'a', src: '/media/result-room-living-area.webp' }, viewport);
  const imgB = make('img', { 'data-preview-img': 'b', hidden: '' }, viewport);
  const badge = make('span', { 'data-preview-place': '' }, viewport);
  const status = make('span', { 'data-preview-status': '' }, preview);
  const nextBtn = make('button', { type: 'button', 'data-preview-next': '' }, viewport);
  const rooms = ['Living area', 'Kitchen', 'Workshop', 'Bedroom'].map((name, idx) => {
    const btn = make('button', {
      type: 'button',
      'data-preview-room': name,
      'data-preview-src': `/media/result-room-${name.toLowerCase().replace(/\s+/g, '-')}.webp`,
      'aria-pressed': idx === 0 ? 'true' : 'false',
    }, preview);
    btn.textContent = name;
    return btn;
  });

  const window = {
    document,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
  };
  window.window = window;
  vm.runInNewContext(read('showcase.js'), { window, document, console, Math, Number, String, Array, Object, Set, Map });

  // Clicking Kitchen switches active state and updates room place badge & status
  rooms[1].click();
  assert.equal(rooms[1].getAttribute('aria-pressed'), 'true');
  assert.equal(rooms[0].getAttribute('aria-pressed'), 'false');
  assert.match(badge.textContent, /Kitchen/);
  assert.match(status.textContent, /Stop 2 of 4/);

  // Clicking Next hotspot advances to Workshop (Stop 3 of 4)
  nextBtn.click();
  assert.equal(rooms[2].getAttribute('aria-pressed'), 'true');
  assert.match(badge.textContent, /Workshop/);
  assert.equal(imgA.getAttribute('src') === '/media/result-room-workshop.webp' || imgB.getAttribute('src') === '/media/result-room-workshop.webp', true);

  // Touch vertical scroll yields to page scrolling and does not change the room
  viewport.dispatch('pointerdown', { pointerId: 1, clientX: 200, clientY: 100, pointerType: 'touch', isPrimary: true });
  viewport.dispatch('pointermove', { pointerId: 1, clientX: 204, clientY: 160, pointerType: 'touch', isPrimary: true });
  viewport.dispatch('pointerup', { pointerId: 1, clientX: 204, clientY: 160, pointerType: 'touch', isPrimary: true });
  assert.equal(rooms[2].getAttribute('aria-pressed'), 'true', 'vertical scroll does not advance room');

  // Horizontal swipe left advances to Bedroom (Stop 4 of 4)
  viewport.dispatch('pointerdown', { pointerId: 2, clientX: 240, clientY: 100, pointerType: 'touch', isPrimary: true });
  viewport.dispatch('pointermove', { pointerId: 2, clientX: 160, clientY: 103, pointerType: 'touch', isPrimary: true });
  viewport.dispatch('pointerup', { pointerId: 2, clientX: 160, clientY: 103, pointerType: 'touch', isPrimary: true });
  assert.equal(rooms[3].getAttribute('aria-pressed'), 'true');
  assert.match(badge.textContent, /Bedroom/);
});

test('offer calculator marks data-morphing on user cadence/pack change, never on initial load', () => {
  const js = read('offer.js');
  assert.match(js, /dataset\.morphing/, 'offer.js triggers tactile morph state on user change');
});

test('FAQ details accordions animate smoothly via WAAPI and respect reduced motion', () => {
  const js = read('app.js');
  assert.match(js, /prefers-reduced-motion:\s*reduce/, 'checks reduced motion');
  assert.match(js, /\.animate\(/, 'uses hardware-accelerated WAAPI for interruptible details disclosure');
});

test('homepage and /see share unified scroll reveal choreography (y: 18, duration: 0.65, power3.out)', () => {
  const homeJs = read('home-refinement.js');
  const seeJs = read('see/see.js');
  for (const [name, js] of [['home-refinement.js', homeJs], ['see/see.js', seeJs]]) {
    assert.match(js, /y:\s*18/, `${name} uses 18px entrance travel`);
    assert.match(js, /duration:\s*0\.65/, `${name} uses 0.65s reveal duration`);
    assert.match(js, /ease:\s*'power3\.out'/, `${name} uses power3.out reveal ease`);
  }
});
