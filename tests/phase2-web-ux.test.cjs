'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadDesk } = require('./desk-fake.cjs');
const { createDocument } = require('./fake-dom.cjs');
const siteLib = require('./site-lib.cjs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');

const qrContext = { window: {}, TextEncoder };
vm.runInNewContext(read('vendor/qrcode-1.5.4.min.js'), qrContext);
const VeyletQR = qrContext.window.VeyletQR || qrContext.VeyletQR;

const tick = () => new Promise(resolve => setImmediate(resolve));

test('AASA Universal Link maps /open/capture?space=* to the app and /open/capture fallback rewrites web link safely', () => {
  const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
  const components = aasa.applinks.details[0].components;
  const captureRule = components.find(c => c['/'] === '/open/capture');
  assert.ok(captureRule && !captureRule.exclude);
  assert.deepEqual(captureRule['?'], { space: '?*' });

  const lastExclude = components.map(c => Boolean(c.exclude)).lastIndexOf(true);
  const firstInclude = components.findIndex(c => !c.exclude);
  assert.ok(lastExclude < firstInclude, 'excludes remain before all includes');

  const html = read('open/capture/index.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(html, /id="capture-app-store"[\s\S]*apps\.apple\.com/);
  assert.match(html, /id="capture-web-link"[^>]*href="\/account"/);

  const runCapture = search => {
    const doc = createDocument();
    const link = doc.createElement('a'); link.id = 'capture-web-link'; link.setAttribute('href', '/account');
    const detail = doc.createElement('p'); detail.id = 'capture-open-detail';
    doc.body.append(link, detail);
    const ctx = { window: { location: { search } }, document: doc, URLSearchParams, encodeURIComponent };
    vm.runInNewContext(read('open/capture/capture.js'), ctx);
    return { href: link.getAttribute('href'), detail: detail.textContent };
  };

  const valid = runCapture('?space=c3c3c3c3-2222-4333-8444-555555555555');
  assert.equal(valid.href, '/account#space-c3c3c3c3-2222-4333-8444-555555555555');
  assert.match(valid.detail, /desk/);

  for (const unsafe of ['', '?space=abc', '?space=javascript:alert(1)', '?space=<script>']) {
    assert.equal(runCapture(unsafe).href, '/account', unsafe);
  }
});

test('desktop uncaptured space offers Capture on iPhone QR dialog, hides during render, and stays absent in app mode', async () => {
  const copied = [];
  const h = await loadDesk({
    tables: {
      properties: { data: [{ id: 'p-space-1', title: 'Harbour loft', workspace_id: 'w1' }] },
      tours: { data: [] },
    },
    window: { VeyletQR },
    navigator: {
      onLine: true,
      clipboard: { writeText: async text => { copied.push(text); } },
    },
  });

  const btn = h.control(h.ids['account-properties'], 'capture-on-iphone');
  assert.ok(btn, 'Capture on iPhone button renders on uncaptured web space');
  assert.equal(btn.textContent, 'Capture on iPhone');

  await btn.fire('click');
  await h.settle();

  const dialogs = h.ids['account-home'].all().filter(el => el.tagName === 'DIALOG' && el.className === 'capture-handoff-dialog');
  assert.equal(dialogs.length, 1);
  const dialog = dialogs[0];
  assert.equal(dialog.open, true);
  assert.match(dialog.text(), /Capture Harbour loft on iPhone/);

  const qrBox = dialog.all().find(el => el.className === 'tour-qr-code capture-handoff-qr');
  assert.ok(qrBox && /^<svg[\s>]/.test(qrBox.innerHTML), 'dialog renders inline QR SVG');
  assert.equal(qrBox.innerHTML, VeyletQR.svg('https://veylet.com/open/capture?space=p-space-1', { label: 'QR code that opens Harbour loft in the Veylet iPhone app' }));

  const copyBtn = dialog.all().find(el => el.dataset?.control === 'capture-dialog-copy');
  await copyBtn.fire('click');
  await h.settle();
  assert.deepEqual(copied, ['https://veylet.com/open/capture?space=p-space-1']);

  const closeBtn = dialog.all().find(el => el.dataset?.control === 'capture-dialog-close');
  await closeBtn.fire('click');
  assert.equal(h.ids['account-home'].all().some(el => el.tagName === 'DIALOG'), false);
  assert.equal(h.doc.activeElement, btn, 'closing handoff dialog restores focus to trigger');

  // Fallback without QR generator renders direct Open capture link.
  const noQr = await loadDesk({
    tables: {
      properties: { data: [{ id: 'p-space-2', title: 'Garden suite', workspace_id: 'w1' }] },
      tours: { data: [] },
    },
  });
  await noQr.control(noQr.ids['account-properties'], 'capture-on-iphone').fire('click');
  await noQr.settle();
  const fallbackDialog = noQr.ids['account-home'].all().find(el => el.tagName === 'DIALOG');
  const direct = fallbackDialog.all().find(el => el.dataset?.control === 'capture-dialog-link');
  assert.equal(direct.href, 'https://veylet.com/open/capture?space=p-space-2');

  // Active render job hides .space-handoff so render block owns the space card.
  const rendering = await loadDesk({
    tables: {
      properties: { data: [{ id: 'p-space-3', title: 'Bay villa', workspace_id: 'w1' }] },
      tours: { data: [] },
    },
    rpc: {
      list_workspace_render_status: async () => ({
        data: { active: true, spaces: [{ property_id: 'p-space-3', job: { job_id: 'j-1', state: 'rendering', step: 2, progress_pct: 40 } }] },
      }),
    },
    window: { VeyletQR },
  });
  const hiddenRow = rendering.ids['account-properties'].all().find(el => el.className === 'space-handoff');
  assert.equal(hiddenRow.hidden, true);

  // App mode remains untouched and free of desktop QR handoff UI.
  const app = await loadDesk({
    appMode: true,
    tables: {
      properties: { data: [{ id: 'p-app-1', title: 'App space', workspace_id: 'w1' }] },
      tours: { data: [] },
    },
    window: { VeyletQR },
  });
  assert.equal(app.control(app.ids['account-properties'], 'capture-on-iphone'), null);
});

test('Live Desk Sync subscribes safely to tours and render_jobs, refreshes live, ignores errors/missing WS, and tears down cleanly', async () => {
  const vmBase = require('node:vm');
  const dist = path.join(__dirname, '../dist');
  const siteLibHelper = require('./site-lib.cjs');
  const accountSrc = read('account.js');
  const sharingSrc = read('tour-sharing.js');
  const markup = read('account/index.html');

  // Custom harness extending loadDesk pattern with Realtime channel spy.
  async function loadRealtimeDesk(options = {}) {
    const { loadDesk: _ignored, ...deskOpts } = options;
    const doc = { hidden: false, activeElement: null };
    const ids = {};
    for (const m of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const { createElement } = { createElement: () => null };
      void createElement;
    }
    // Use vm harness identical to desk-fake.cjs by patching options.window/supabase? desk-fake does not expose channel() on supabase, so test both desk-fake's no-channel graceful path AND custom channel client!
    return deskOpts;
  }
  void loadRealtimeDesk;

  // 1. Safe no-op when supabase.channel is unavailable (default desk-fake supabase).
  const safeNoChannel = await loadDesk({ tables: { tours: { data: [] } } });
  assert.ok(safeNoChannel.ids['account-properties'].all().some(el => el.className === 'dash-space'));

  // 2. Real Realtime subscription, live updates, dirty-state protection, error degradation & sign-out teardown.
  const channels = [];
  const removed = [];
  const doc = { hidden: false, activeElement: null };
  const ids = {};
  const fakeElements = [];
  class MiniEl {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {};
      this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.className = '';
      this.open = false; this.parent = null; this.id = '';
      const self = this;
      this.classList = {
        add(...n) { self.className = [...new Set([...self.className.split(/\s+/), ...n].filter(Boolean))].join(' '); },
        remove(...n) { self.className = self.className.split(/\s+/).filter(x => x && !n.includes(x)).join(' '); },
        contains(x) { return self.className.split(/\s+/).includes(x); },
      };
      fakeElements.push(this);
    }
    append(...c) { for (const k of c) { if (!k) continue; if (typeof k === 'string') this.textContent += k; else { k.parent = this; this.children.push(k); } } }
    prepend(...c) { const rest = this.children; this.children = []; this.append(...c); this.children.push(...rest); }
    replaceChildren(...c) { this.children = []; this.append(...c); }
    remove() {}
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(n, h) { (this.listeners[n] ||= []).push(h); }
    removeEventListener() {}
    async fire(n) { for (const h of this.listeners[n] || []) await h({ preventDefault() {}, target: this }); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains(node) { for (let a = node; a; a = a.parent) if (a === this) return true; return false; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    focus() { doc.activeElement = this; }
    blur() {} select() {} reset() {} click() {} scrollIntoView() {}
  }
  for (const m of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new MiniEl(m[1]); el.id = m[2]; el.hidden = /\shidden\b/.test(m[0]); ids[m[2]] = el;
  }

  let tourRows = [];
  let renderState = 'waiting';
  let toursFetches = 0;
  let renderFetches = 0;
  let currentUser = { id: 'user-1', email: 'owner@example.invalid' };
  let throwingChannel = false;

  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user: currentUser, access_token: 'tok' } } }),
      onAuthStateChange: cb => { supabase.auth.callback = cb; },
      signOut: async () => ({}),
    },
    from(name) {
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        single() {
          if (name === 'properties') return Promise.resolve({ data: { id: 'p1', title: 'Harbour loft', workspace_id: 'w1' } });
          return Promise.resolve({ data: null });
        },
        then(resolve, reject) {
          if (name === 'properties') return Promise.resolve({ data: [{ id: 'p1', title: 'Harbour loft', workspace_id: 'w1' }] }).then(resolve, reject);
          if (name === 'tours') { toursFetches += 1; return Promise.resolve({ data: tourRows }).then(resolve, reject); }
          if (name === 'memberships') return Promise.resolve({ data: [{ workspace_id: 'w1', role: 'owner', status: 'active' }] }).then(resolve, reject);
          return Promise.resolve({ data: [] }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name) {
      if (name === 'list_workspace_render_status') {
        renderFetches += 1;
        return { data: { active: true, spaces: [{ property_id: 'p1', job: { job_id: 'job-1', state: renderState, step: renderState === 'rendering' ? 3 : 1, progress_pct: 50 } }] } };
      }
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      return { data: null, error: { code: 'PGRST202', message: 'missing ' + name } };
    },
    channel(topic) {
      if (throwingChannel) throw new Error('WebSocket unavailable');
      const handlers = {};
      const ch = {
        topic,
        handlers,
        unsubscribed: false,
        on(type, filter, cb) { handlers[filter.table] = cb; return ch; },
        subscribe(cb) { ch.statusCb = cb; cb?.('SUBSCRIBED'); return ch; },
        unsubscribe() { ch.unsubscribed = true; },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { removed.push(ch.topic); ch.unsubscribed = true; return Promise.resolve('ok'); },
  };

  let clock = 10000;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const ctx = {
    window: {
      VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'pub' },
      supabase: { createClient: () => supabase },
      VeyletPlace: { generalLocationProblem: () => '' },
      VEYLET_HOOKS: { url: 'https://hooks.example.invalid' },
      addEventListener() {},
    },
    document: Object.assign(doc, {
      getElementById: id => ids[id] || null,
      createElement: tag => new MiniEl(tag),
      addEventListener() {},
      head: { append() {} },
      documentElement: { dataset: {} },
    }),
    Date: Clock, URL, URLSearchParams, Intl, TypeError,
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    location: { pathname: '/account', search: '', hash: '', replace() {}, assign() {} },
    setTimeout: (fn, ms) => (ms === 0 ? global.setTimeout(fn, 0) : ({})), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    FormData: class { get() { return ''; } }, Blob: class {},
  };
  siteLib.load(ctx);
  vmBase.runInNewContext(sharingSrc, ctx);
  await vmBase.runInNewContext(accountSrc, ctx);
  for (let i = 0; i < 30; i++) await tick();

  assert.equal(channels.length, 1);
  assert.equal(channels[0].topic, 'desk-sync-user-1');
  assert.equal(typeof channels[0].handlers.tours, 'function');
  assert.equal(typeof channels[0].handlers.render_jobs, 'function');
  assert.equal(toursFetches, 1);
  assert.equal(renderFetches, 1);

  // Trigger render_jobs update -> updates render status live via renderRead.
  clock += 1000;
  renderState = 'rendering';
  channels[0].handlers.render_jobs({ eventType: 'UPDATE' });
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(renderFetches, 2);
  const renderBlock = ids['account-properties'].all().find(el => el.className === 'render-block');
  assert.equal(renderBlock.dataset.state, 'rendering');

  // Trigger tours update while clean -> reloads desk and renders tour.
  clock += 1000;
  tourRows = [{ id: 't-live-1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/pkg.zip', created_by: 'user-1', share_token: 'abcdef1234567890' }];
  channels[0].handlers.tours({ eventType: 'INSERT' });
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(toursFetches, 2);
  assert.ok(ids['account-properties'].all().some(el => el.dataset?.tour === 't-live-1'));

  // User starts editing in desk -> deskDirty blocks tours refresh.
  clock += 1000;
  await ids['account-properties'].fire('input');
  channels[0].handlers.tours({ eventType: 'UPDATE' });
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(toursFetches, 2, 'deskDirty prevents overwriting work in progress');

  // Account switch tears down old channel and creates one for new user.
  currentUser = { id: 'user-2', email: 'other@example.invalid' };
  await supabase.auth.callback('SIGNED_IN', { user: currentUser, access_token: 'tok-2' });
  for (let i = 0; i < 30; i++) await tick();
  await new Promise(r => setTimeout(r, 15));
  for (let i = 0; i < 30; i++) await tick();
  assert.ok(removed.includes('desk-sync-user-1'));
  assert.equal(channels.at(-1).topic, 'desk-sync-user-2');

  // Sign out removes channel cleanly.
  await ids['account-sign-out'].fire('click');
  for (let i = 0; i < 30; i++) await tick();
  assert.ok(removed.includes('desk-sync-user-2'));

  // Channel throwing during subscribe degrades safely without throwing.
  throwingChannel = true;
  currentUser = { id: 'user-3', email: 'third@example.invalid' };
  await supabase.auth.callback('SIGNED_IN', { user: currentUser, access_token: 'tok-3' });
  await new Promise(r => setTimeout(r, 15));
  for (let i = 0; i < 30; i++) await tick();
  assert.ok(ids['account-properties'].all().some(el => el.className === 'dash-space'));
});

test('buyer /handoff renders end-of-tour #handoff-end-cta, Made with Veylet in v2-end, onPress booking, and sample pitch end CTA', async () => {
  const handoffHtml = read('handoff/index.html');
  assert.doesNotMatch(handoffHtml, /\ballowfullscreen\b/);
  assert.match(handoffHtml, /id="handoff-end-cta"[^>]*hidden/);

  // 1. Player end card: madeWith opt-in + onEnd + onPress exit-fullscreen behavior.
  const doc = createDocument();
  doc.documentElement = doc.createElement('html');
  const stage = doc.createElement('div');
  stage.clientWidth = 390; stage.clientHeight = 700; stage.hidden = true;
  doc.body.append(stage);

  class Emitter { constructor() { this.h = {}; } on(e, f) { (this.h[e] ||= []).push(f); } fire(e, ...a) { for (const f of this.h[e] || []) f(...a); } }
  class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); return this; } }
  const apps = [];
  const fakeEngine = {
    Application: class extends Emitter {
      constructor(c, { graphicsDevice }) {
        super(); this.graphicsDevice = graphicsDevice; this.scene = { gsplat: {} }; this.root = { addChild() {} };
        this.assets = { add() {}, load() {}, remove() {} }; this.systems = { gsplat: new Emitter() };
        this.loader = { getHandler: () => ({ imgParser: {} }) }; apps.push(this);
      }
      setCanvasFillMode() {} setCanvasResolution() {} updateCanvasSize() {} start() {} destroy() {}
    },
    Entity: class {
      addComponent(type, d) {
        if (type === 'camera') this.camera = { ...d, fov: 70, worldToScreen: (w, s) => s.set(100, 100, 1), screenToWorld: (x, y, dp, out) => out.set(x / 100, -dp, y / 100) };
        if (type === 'gsplat') this.gsplat = { lodRangeMin: 0, lodRangeMax: 99 };
      }
      setPosition() {} setEulerAngles() {} setLocalEulerAngles() {} destroy() {}
    },
    Asset: class extends Emitter { constructor(n, t, f) { super(); this.file = f; } unload() {} },
    Vec3, Color: class { fromString() { return this; } },
    createGraphicsDevice: async () => ({ deviceType: 'webgl2', on() {}, maxPixelRatio: 1 }),
  };

  const mf = {
    format: 'veylet.tour-package', package_format_version: 2, synthetic: false, captured_on: null,
    truth_label: 'Built only from photos and depth captured on site.', generative_model_used: false,
    scene: { lod_meta: 'lod/lod-meta.json', lod_levels: 4, lod_counts: [500000, 250000, 100000, 50000], sh_bands: 2, rotation_degrees: [0, 0, 180], background: '#10231d' },
    poster: {
      landscape: { path: 'poster.webp', width: 1600, height: 900, fov_degrees: 70 },
      portrait: { path: 'poster.webp', width: 900, height: 1600, fov_degrees: 90 },
      preview: { path: 'preview.webp', width: 256, height: 144, fov_degrees: 70 },
    },
    walkable: null,
    rooms: [{ id: 'r1', name: 'Kitchen' }],
    stops: [
      { id: 's1', room: 'r1', position: [0, 0, 0], target: [0, 0, -2], floor: [0, -1.4, 0], floor_measured: true },
      { id: 's2', room: 'r1', position: [1, 0, 0], target: [1, 0, -2], floor: [1, -1.4, 0], floor_measured: true },
    ],
    start_stop: 0, files: [],
  };
  const files = { 'manifest.json': mf, 'lod/lod-meta.json': { lods: [{ count: 500000 }, { count: 250000 }, { count: 100000 }, { count: 50000 }] } };
  const playerCtx = {
    window: { matchMedia: () => ({ matches: true }), screen: { width: 390, height: 844 }, devicePixelRatio: 2 },
    document: doc,
    fetch: async url => {
      const k = url.replace('https://veylet.com/pkg/', '');
      return k in files ? { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(files[k]) } : { ok: false, status: 404 };
    },
    performance, setTimeout, clearTimeout, setImmediate, URL, atob, AbortController, console,
    location: { href: 'https://veylet.com/handoff?t=abcdefghijklmnop', origin: 'https://veylet.com' },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  const origAppend = doc.head.append.bind(doc.head);
  doc.head.append = node => { origAppend(node); if (node.tagName === 'LINK') setImmediate(() => node.onload?.()); };
  vm.runInNewContext(read('tour-player-v2.js'), playerCtx);

  const endCalls = [];
  const presses = [];
  const pending = playerCtx.window.VeyletPlayerV2.start(stage, {
    base: 'https://veylet.com/pkg/',
    env: { screenWidth: 390, screenHeight: 844, dpr: 2, coarse: true, touchPoints: 5, webgl2: true, webgpu: false },
    page: { href: 'https://veylet.com/handoff', origin: 'https://veylet.com' },
    loadEngine: async () => fakeEngine,
    visit: {
      madeWith: { label: 'Made with Veylet', href: 'https://veylet.com' },
      onEnd: shown => endCalls.push(shown),
      contact: Promise.resolve({
        name: 'Alex Agent',
        actions: [
          { label: 'Call', href: 'tel:+61400000000' },
          { label: 'Book viewing', href: 'mailto:alex@example.invalid', onPress: () => presses.push('inline-book'), press: () => presses.push('beacon-book') },
        ],
      }),
    },
  });
  for (let i = 0; i < 12; i++) await tick();
  apps[0].systems.gsplat.fire('frame:ready', null, null, false, 1);
  apps[0].systems.gsplat.fire('frame:ready', null, null, true, 0);
  await pending;

  stage.querySelector('.v2-next').click();
  assert.deepEqual(endCalls, [true]);
  const end = stage.querySelector('.v2-end');
  assert.equal(end.hidden, false);
  const madeLink = end.querySelector('.v2-end-made-link');
  assert.ok(madeLink);
  assert.equal(madeLink.textContent, 'Made with Veylet');
  assert.equal(madeLink.getAttribute('href'), 'https://veylet.com');

  // Enter pseudo fullscreen then press Book viewing -> exits fullscreen, prevents default navigation, invokes onPress + press.
  stage.querySelector('.v2-fullscreen').click();
  assert.equal(stage.classList.contains('v2-filled'), true);
  let prevented = false;
  const bookLink = end.querySelectorAll('a').find(a => a.textContent === 'Book viewing');
  bookLink.dispatch('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(stage.classList.contains('v2-filled'), false);
  assert.deepEqual(presses, ['inline-book', 'beacon-book']);

  end.querySelector('.v2-quiet').click();
  assert.deepEqual(endCalls, [true, false]);

  // 2. Live handoff + ?sample=1 wiring via tour-page.js + client-page.js.
  function runTourPageHandoff(search) {
    const hDoc = createDocument();
    for (const m of handoffHtml.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
      const node = hDoc.createElement(m[1]);
      node.id = m[3];
      if (/\shidden\b/.test(m[2] + m[4])) node.hidden = true;
      hDoc.body.append(node);
    }
    hDoc.documentElement = hDoc.createElement('html');
    let booted = null;
    const clientCtx = {
      window: {
        VEYLET_SUPABASE: { url: 'https://fixture.invalid', anonKey: 'anon' },
        VEYLET_HOOKS: { url: 'https://hooks.veylet.com' },
        VeyletPlayer: {
          TourFailure: Error,
          showFailure() {},
          showIncomplete() {},
          boot(opts) { booted = opts; return new Promise(() => {}); },
        },
      },
      document: hDoc,
      location: { origin: 'https://veylet.com', pathname: '/handoff', search, hash: '' },
      navigator: {},
      URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout,
      fetch: async () => ({ ok: true, status: 200, json: async () => ([{ display_name: 'Maya Patel', agency: 'Coast Co', phone: '+61 411 222 333', email: 'maya@coast.test', allow_viewing_request: true }]) }),
    };
    siteLib.load(clientCtx);
    siteLib.loadTourPage(clientCtx);
    vm.runInNewContext(read('client-page.js'), clientCtx);
    vm.runInNewContext(handoffHtml.match(/<script type="module">\s*(window\.VeyletTourPage\.handoff\(\);[\s\S]*?)<\/script>/)[1], clientCtx);
    return { hDoc, booted, window: clientCtx.window };
  }

  const sample = runTourPageHandoff('?sample=1&name=Sam&phone=%2B61412345678');
  assert.ok(sample.booted.visit, 'sample pitch passes visit to VeyletPlayer.boot');
  assert.equal(sample.booted.visit.madeWith.label, 'Made with Veylet');
  await sample.booted.resolve({ rpc: async () => ({ data: [] }) });
  sample.booted.visit.onEnd(true);
  const sampleEnd = sample.hDoc.getElementById('handoff-end-cta');
  assert.equal(sampleEnd.hidden, false);
  assert.match(sampleEnd.textContent, /Want to share walkthroughs like this\?/);
  assert.ok(sampleEnd.querySelectorAll('a').some(el => el.textContent === 'Capture your own space'));

  const live = runTourPageHandoff('?t=0123456789abcdef0123456789abcdef');
  assert.equal(live.booted.visit.madeWith.href, 'https://veylet.com');
  await live.booted.resolve({
    rpc: async name => name === 'lookup_tour_share'
      ? { data: [{ storage_path: 'p/m.json', space_title: '22 Ocean Rd', package_format_version: 2, package_base_url: 'https://tours.veylet.com/t/x/' }] }
      : { data: [] },
  });
  for (let i = 0; i < 15; i++) await tick();
  live.booted.visit.onEnd(true);
  const liveEnd = live.hDoc.getElementById('handoff-end-cta');
  assert.equal(liveEnd.hidden, false);
  assert.ok(liveEnd.querySelectorAll('button, a').some(el => el.textContent === 'Book viewing'));
  assert.ok(liveEnd.querySelectorAll('a').some(el => el.textContent === 'Made with Veylet' && el.getAttribute('href') === 'https://veylet.com'));
  const resolvedVisitContact = await live.booted.visit.contact;
  const inlineAction = resolvedVisitContact.actions.find(a => a.label === 'Book viewing');
  assert.equal(typeof inlineAction.onPress, 'function');
  inlineAction.onPress();
  assert.equal(live.hDoc.getElementById('agent-enquiry-sheet').hidden, false);
});

test('UI audit fixes: analytics.css static placement, rounded Apple button on product surface, collapsed role_intent on /app/account, and deferred QA server regex', () => {
  const analyticsCss = read('analytics.css');
  const consentRule = analyticsCss.match(/\.analytics-consent \{([^}]*)\}/)[1];
  assert.match(consentRule, /position:\s*static;/);
  assert.doesNotMatch(consentRule, /position:\s*sticky;/);

  const styleCss = read('style.css');
  assert.match(styleCss, /\[data-surface="product"\]\s*:is\([^)]*\.apple-button[^)]*\)\s*\{\s*border-radius:\s*var\(--radius-button\);/);

  const appAccount = read('app/account/index.html');
  assert.match(appAccount, /<details class="role-intent" id="account-role-intent">\s*<summary>I capture spaces for clients<\/summary>/);

  const qaServer = fs.readFileSync(path.join(ROOT, 'scripts', 'serve-player-check.py'), 'utf8');
  const supabasePattern = new RegExp(qaServer.match(/re\.subn\(r'([^']+)'/)[1].replace(/\\\\/g, '\\'));
  const accountDeferred = read('account/index.html');
  assert.match(accountDeferred, supabasePattern);
});
