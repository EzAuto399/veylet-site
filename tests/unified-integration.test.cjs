const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx012345';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function makeMiniDom() {
  const listeners = new Map();
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      attributes: {},
      style: { setProperty(k, v) { this[k] = v; } },
      children: [],
      dataset: {},
      className: '',
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      listeners: {},
      setAttribute(k, v) {
        this.attributes[k] = String(v);
        if (k === 'href' || k === 'src' || k === 'id' || k === 'type') this[k] = String(v);
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
      removeAttribute(k) { delete this.attributes[k]; },
      replaceChildren(...nodes) {
        this.children = [];
        this.textContent = '';
        this.append(...nodes);
      },
      append(...nodes) {
        for (const n of nodes) {
          if (typeof n === 'string') { this.textContent += n; continue; }
          if (n) { n.parentNode = this; this.children.push(n); }
        }
      },
      appendChild(n) { this.append(n); return n; },
      removeChild(n) {
        this.children = this.children.filter((x) => x !== n);
        if (n) n.parentNode = null;
      },
      remove() { this.parentNode?.removeChild(this); },
      contains(node) {
        if (node === this) return true;
        return this.children.some((c) => (c === node) || (c.contains && c.contains(node)));
      },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      closest(sel) {
        if (sel === 'a' && this.tagName === 'A') return this;
        return this.parentNode?.closest?.(sel) || null;
      },
      focus() { doc.activeElement = this; },
    };
    return el;
  };
  const body = makeEl('body');
  const doc = {
    readyState: 'complete',
    body,
    documentElement: makeEl('html'),
    activeElement: null,
    createElement: (tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (list) listeners.set(type, list.filter((x) => x !== fn));
    },
    dispatch(type, evt) {
      for (const fn of (listeners.get(type) || []).slice()) fn(evt);
    },
  };
  return { doc, body };
}

test('dist/embed.js stays compact, avoids unsafe HTML sinks, forwards safe hash, and traps Tab', () => {
  const src = read('dist/embed.js');
  const bytes = Buffer.byteLength(src, 'utf8');
  assert.ok(bytes < 3500, `embed.js should stay under 3500 bytes, got ${bytes}`);
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);

  const { doc, body } = makeMiniDom();
  const window = {};
  vm.runInNewContext(src, {
    window,
    document: doc,
    location: { href: 'https://agency.example/listing/12' },
    URL,
  });

  const anchor = doc.createElement('a');
  anchor.setAttribute('href', `https://veylet.com/embed?t=${TOKEN}&theme=paper#stop=3&yaw=135&pitch=-20`);
  doc.activeElement = anchor;

  let prevented = false;
  doc.dispatch('click', {
    target: anchor,
    button: 0,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);

  const dialog = body.children.find((c) => c.getAttribute('role') === 'dialog');
  assert.ok(dialog, 'modal dialog should open');
  const box = dialog.children[0];
  const closeBtn = box.children[0];
  const iframe = box.children[1];
  assert.equal(
    iframe.src,
    `https://veylet.com/embed?t=${TOKEN}&theme=paper#stop=3&yaw=135&pitch=-20`,
  );
  assert.equal(iframe.style.minHeight, '0');
  assert.equal(closeBtn.style.width, 'auto');
  assert.equal(closeBtn.style.flexShrink, '0');
  assert.equal(closeBtn.style.minHeight, '44px');
  assert.equal(doc.activeElement, closeBtn);

  // Shift+Tab from close button wraps focus to iframe; Tab from iframe wraps to close button
  let shiftPrevented = false;
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() { shiftPrevented = true; } });
  assert.equal(shiftPrevented, true);
  assert.equal(doc.activeElement, iframe);

  let tabPrevented = false;
  doc.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { tabPrevented = true; } });
  assert.equal(tabPrevented, true);
  assert.equal(doc.activeElement, closeBtn);

  // Unsafe hash fragments are dropped
  window.VeyletEmbed.open(TOKEN, { hash: '#<script>' });
  const unsafeDialog = body.children.find((c) => c.getAttribute('role') === 'dialog');
  assert.equal(unsafeDialog.children[0].children[1].src, `https://veylet.com/embed?t=${TOKEN}`);
  window.VeyletEmbed.close();
  assert.equal(body.children.length, 0);
});

test('dist/account.js exposes turnkey modal button & developer brief in live website sharing and guides on hidden contact card', () => {
  const accountSrc = read('dist/account.js');
  assert.match(accountSrc, /dataset\.control\s*=\s*'copy-modal-button'/);
  assert.match(accountSrc, /dataset\.control\s*=\s*'copy-dev-brief'/);
  assert.match(accountSrc, /share\.modalButtonCode\(tour\.share_token\)/);
  assert.match(accountSrc, /share\.developerBrief\(tour\.share_token\)/);
  assert.match(accountSrc, /Turn on “Show on shared walkthroughs” above so buyers see it\./);
});

test('tour-player-v2 integrates unified pill bar CSS and runtime bar-height syncing while preserving studio invariants', () => {
  const css = read('dist/tour-player-v2.css');
  assert.match(css, /var\(--v2-bar/);
  assert.match(css, /\.v2-room-pill\[aria-current="true"\]/);
  assert.match(css, /max-height:\s*max\(calc\(100% - 136px\), min\(calc\(100% - 80px\), 220px\)\)/);

  const js = read('dist/tour-player-v2.js');
  const omitMatches = js.match(/credentials:\s*'omit'/g) || [];
  assert.equal(omitMatches.length, 2, 'viewer_assets.py expects exactly 2 credentials: omit occurrences');
  assert.match(js, /function syncBarHeight\(\)/);
  assert.match(js, /ui\.bar\.hidden\s*=\s*false;\s*fitBar\(\);/);
});

test('conversion pages with App Store links consistently wire stage.js and conversion.css', () => {
  for (const rel of [
    'dist/index.html',
    'dist/offer/index.html',
    'dist/see/index.html',
    'dist/start/index.html',
    'dist/guides/3d-tours-realestate-com-au-domain/index.html',
  ]) {
    const html = read(rel);
    assert.match(html, /conversion\.css/, `${rel} should load conversion.css`);
    assert.match(html, /\/stage\.js/, `${rel} should load stage.js`);
  }
});

test('handoff context enrichment computes late showContact flag and applies agency brand afterwards', () => {
  const html = read('dist/handoff/index.html');
  assert.match(html, /client-contact-pending/);
  assert.match(html, /page\.showContact\([^)]*late/);
  const showIdx = html.indexOf('page.showContact(');
  const brandIdx = html.indexOf('page.applyBrand(', showIdx);
  assert.ok(showIdx > 0 && brandIdx > showIdx, 'applyBrand must run after showContact enrichment');

  const clientJs = read('dist/client-page.js');
  assert.match(clientJs, /const opener = doc\.activeElement \|\| null;/);
  assert.match(clientJs, /opener\?\.focus\?\.\(\);/);
  assert.match(clientJs, /sheet\.scrollIntoView\?\.\(/);
});

test('room-jump pills never wrap under global nav styles and panels use opaque dark backing', () => {
  const playerCss = read('dist/tour-player-v2.css');
  const stageCss = read('dist/tour-stage.css');
  assert.match(playerCss, /\.v2-rooms,\s*\n\.v2-room-pills\s*\{[^}]*flex-wrap:\s*nowrap;/);
  assert.match(stageCss, /\.v2-stage \.v2-rooms\s*\{[^}]*flex-wrap:\s*nowrap;/);
  assert.match(playerCss, /\.v2-panel\s*\{[^}]*background:\s*#10231d;/);
  assert.match(playerCss, /\.v2-panel-head\s*\{[^}]*background:\s*#10231d;/);
  assert.match(playerCss, /@media \(min-height: 360px\)/);
});

test('client-page visitLink preserves initial #stop=N&yaw=D&pitch=P deep link on arrival and updates on move', () => {
  const windowObj = {};
  const doc = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
  vm.runInNewContext(read('dist/client-page.js'), {
    window: windowObj,
    document: doc,
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    console,
    navigator: {},
    location: { search: '' },
  });
  const page = windowObj.VeyletClientPage;

  const states = [];
  const loc = { origin: 'https://veylet.com', pathname: '/handoff', search: '?t=' + TOKEN, hash: '#stop=2&yaw=135&pitch=-20' };
  const win = {
    history: {
      state: { s: 1 },
      replaceState(_st, _t, url) {
        states.push(url);
        loc.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
      },
    },
  };
  const visit = page.visitLink({ window: win, location: loc, navigator: {}, document: {}, token: TOKEN });
  assert.equal(visit.startAt, 2);
  assert.equal(page.stopFromHash('#stop=2&yaw=90'), 2);
  assert.equal(page.stopFromHash('#yaw=90&stop=12'), 12);
  assert.equal(page.stopFromHash('#stop=0&yaw=90'), null);
  assert.equal(page.stopFromHash('#stop=2&bad=<script>'), null);
  visit.onStop(2, 5);
  assert.deepEqual(states, [], 'initial camera deep link is not overwritten on arrival');
  assert.equal(visit.url(), `https://veylet.com/handoff?t=${TOKEN}#stop=2&yaw=135&pitch=-20`);

  visit.onStop(3, 5);
  assert.deepEqual(states, [`/handoff?t=${TOKEN}#stop=3`]);
  visit.onStop(2, 5);
  assert.deepEqual(states, [`/handoff?t=${TOKEN}#stop=3`, `/handoff?t=${TOKEN}#stop=2`]);

  // Also ensure stop-1 camera deep link works and tour-player-v2 skips premature opening tellStop on jump
  const states1 = [];
  const loc1 = { origin: 'https://veylet.com', pathname: '/handoff', search: '?t=' + TOKEN, hash: '#stop=1&yaw=90' };
  const visit1 = page.visitLink({
    window: { history: { state: null, replaceState(_s, _t, u) { states1.push(u); loc1.hash = ''; } } },
    location: loc1,
    navigator: {},
    document: {},
    token: TOKEN,
  });
  visit1.onStop(1, 5);
  assert.deepEqual(states1, []);
  assert.equal(visit1.url(), `https://veylet.com/handoff?t=${TOKEN}#stop=1&yaw=90`);
  visit1.onStop(2, 5);
  assert.deepEqual(states1, [`/handoff?t=${TOKEN}#stop=2`]);

  const playerJs = read('dist/tour-player-v2.js');
  assert.match(playerJs, /if \(!willJump\)\s*\{\s*[\s\S]*tellStop\(state\.stop\);/);
});

test('dist/stage.js QR modal traps outside Tab focus back in and dist/conversion.css carries Safari backdrop prefix', () => {
  const css = read('dist/conversion.css');
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(6px\);/);

  const { doc, body } = makeMiniDom();
  const win = {
    matchMedia: () => ({ matches: true }),
    VEYLET_STAGE: 'app',
  };
  vm.runInNewContext(read('dist/stage.js'), {
    window: win,
    document: doc,
    URL,
    console,
  });

  const cta = doc.createElement('a');
  cta.setAttribute('href', 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913');
  body.append(cta);
  doc.activeElement = cta;

  let prevented = false;
  doc.dispatch('click', {
    target: cta,
    button: 0,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);

  const modal = body.children.find((c) => c.getAttribute('data-app-qr-modal') === 'true');
  assert.ok(modal && !modal.hidden, 'App Store QR modal should open on fine-pointer desktop');
  const closeBtn = modal.children[0].children[3].children[1];
  const directLink = modal.children[0].children[3].children[0];
  assert.equal(doc.activeElement, closeBtn);

  // Move focus outside modal and verify Tab / Shift+Tab pull it back inside
  doc.activeElement = cta;
  let tabIn = false;
  doc.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { tabIn = true; } });
  assert.equal(tabIn, true);
  assert.equal(doc.activeElement, directLink);

  doc.activeElement = cta;
  let shiftTabIn = false;
  doc.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() { shiftTabIn = true; } });
  assert.equal(shiftTabIn, true);
  assert.equal(doc.activeElement, closeBtn);

  // Escape closes modal and restores opener focus
  let escPrevented = false;
  doc.dispatch('keydown', { key: 'Escape', preventDefault() { escPrevented = true; } });
  assert.equal(escPrevented, true);
  assert.equal(modal.hidden, true);
  assert.equal(doc.activeElement, cta);
});

test('visitLink.setContact includes Book inspection or Book viewing up to 3 actions and tracks booking taps', async () => {
  const windowObj = {};
  const doc = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
  vm.runInNewContext(read('dist/client-page.js'), {
    window: windowObj, document: doc, URLSearchParams, URL, setTimeout, clearTimeout, navigator: {}, location: { search: '' },
  });
  const sent = [];
  const beacon = { send: (...args) => sent.push(args) };
  const loc = { origin: 'https://veylet.com', pathname: '/handoff', search: '?t=' + TOKEN, hash: '' };
  const page = windowObj.VeyletClientPage;

  const v1 = page.visitLink({ window: { history: { replaceState() {} } }, location: loc, navigator: {}, document: doc, token: TOKEN, beacon });
  v1.setTitle('14 River St');
  v1.setContact({ name: 'Sarah Chen', phone: '+61 400 123 456', email: 'sarah@harbour.test', bookingUrl: 'https://cal.example/sarah', allowViewingRequest: true });
  const c1 = await v1.contact;
  assert.deepEqual(JSON.parse(JSON.stringify(c1.actions.map(a => [a.label, Boolean(a.external)]))), [
    ['Call', false],
    ['Email', false],
    ['Book inspection', true],
  ]);
  c1.actions[2].press();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['email_tap', { booking: true }]]);

  const v2 = page.visitLink({ window: { history: { replaceState() {} } }, location: loc, navigator: {}, document: doc, token: TOKEN, beacon });
  v2.setTitle('14 River St');
  v2.setContact({ name: 'Sarah Chen', phone: '+61 400 123 456', email: 'sarah@harbour.test', allowViewingRequest: true });
  const c2 = await v2.contact;
  assert.equal(c2.actions[2].label, 'Book viewing');
  assert.match(c2.actions[2].href, /^mailto:sarah@harbour\.test\?subject=Book%20a%20viewing/);
  c2.actions[2].press();
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['email_tap', { booking: true }], ['email_tap', { booking: true }]]);
});

test('/embed and /tour preserve safe #stop=N&yaw=D&pitch=P hashes on fullscreen links and update /embed open.href on hashchange', () => {
  const clientSrc = read('dist/client-page.js');
  const embedHtml = read('dist/embed/index.html');
  const tourHtml = read('dist/tour/index.html');
  const { withClientHelpers } = require('./client-words.cjs');

  // /embed preserves initial safe hash and updates on hashchange
  const ids = {};
  for (const match of embedHtml.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, events: {}, style: { setProperty() {} }, addEventListener(n, f) { this.events[n] = f; } };
  }
  const winListeners = {};
  let embedBoot = null;
  const embedWin = {
    VeyletPlayer: withClientHelpers({ boot: o => { embedBoot = o; return new Promise(() => {}); }, showFailure() {} }),
    VeyletClientPage: (() => { const w = {}; vm.runInNewContext(clientSrc, { window: w, setTimeout, clearTimeout, URLSearchParams, URL }); return w.VeyletClientPage; })(),
    addEventListener(n, f) { winListeners[n] = f; },
  };
  const embedLoc = { search: '?t=' + TOKEN, hash: '#stop=2&yaw=135&pitch=-20' };
  vm.runInNewContext(embedHtml.match(/<script>([\s\S]*?)<\/script>/)[1], {
    window: embedWin, document: { getElementById: id => ids[id] }, location: embedLoc, URLSearchParams, setTimeout, Promise,
  });
  assert.equal(ids['embed-open'].href, `https://veylet.com/handoff?t=${TOKEN}#stop=2&yaw=135&pitch=-20`);
  embedLoc.hash = '#stop=3&yaw=45';
  winListeners.hashchange();
  assert.equal(ids['embed-open'].href, `https://veylet.com/handoff?t=${TOKEN}#stop=3&yaw=45`);
  embedLoc.hash = '#<script>';
  winListeners.hashchange();
  assert.equal(ids['embed-open'].href, `https://veylet.com/handoff?t=${TOKEN}`);
  ids['embed-start'].events.click();
  assert.equal(embedBoot.fullscreenUrl, `https://veylet.com/handoff?t=${TOKEN}`);

  // /tour preserves safe hash in fullscreenUrl and drops unsafe hashes
  const runTour = hash => {
    const tIds = {};
    for (const match of tourHtml.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
      tIds[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, textContent: '' };
    }
    let tourBoot = null;
    const w = {
      VeyletPlayer: withClientHelpers({ TourFailure: Error, boot: o => { tourBoot = o; return new Promise(() => {}); }, showFailure() {} }),
      VeyletClientPage: (() => { const c = {}; vm.runInNewContext(clientSrc, { window: c, setTimeout, clearTimeout, URLSearchParams, URL }); return c.VeyletClientPage; })(),
    };
    w.self = w; w.top = w;
    vm.runInNewContext(tourHtml.match(/<script>([\s\S]*?)<\/script>/)[1], {
      window: w,
      document: { getElementById: id => tIds[id], querySelector: () => null, title: 'Property walkthrough', referrer: '' },
      location: { origin: 'https://veylet.com', pathname: '/tour', search: '?t=' + TOKEN, hash },
      URLSearchParams, URL, setTimeout, clearTimeout,
    });
    return tourBoot.fullscreenUrl;
  };
  assert.equal(runTour('#stop=2&yaw=90&pitch=10'), `https://veylet.com/tour?t=${TOKEN}#stop=2&yaw=90&pitch=10`);
  assert.equal(runTour('#<script>'), `https://veylet.com/tour?t=${TOKEN}`);
});

test('tour-sharing embedCode and embedFrame reject invalid tokens cleanly', () => {
  const window = {};
  vm.runInNewContext(read('dist/tour-sharing.js'), { window, URL, navigator: {} });
  const share = window.VeyletSharing;
  for (const bad of ['', null, undefined, 'short', 'a" onclick="alert(1)', 'a'.repeat(257)]) {
    assert.equal(share.embedCode(bad), '');
    let created = false;
    assert.equal(share.embedFrame(bad, { createElement() { created = true; return {}; } }), null);
    assert.equal(created, false);
  }
});

test('dist/account.js mounts tourCampaignSync on paused/unshared approved ready tours with p_limit 200 and exposes avatar/logo URL inputs', async () => {
  const { createDocument } = require('./fake-dom.cjs');
  const runDesk = async (role = 'owner') => {
    const doc = createDocument();
    doc.FakeNode.prototype.reset = function () {};
    doc.FakeNode.prototype.select = function () {};
    doc.FakeNode.prototype.scrollIntoView = function () {};
    doc.FakeNode.prototype.getContext = function () { return this.tagName === 'CANVAS' ? { fillStyle: '', fillRect() {}, fillText() {} } : null; };
    doc.FakeNode.prototype.toBlob = function (done, type) { done({ type, size: 1 }); };
    doc.documentElement = doc.createElement('html');
    const markup = read('dist/account/index.html');
    for (const match of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
      const el = doc.createElement(match[1]);
      el.id = match[3];
      el.hidden = /\shidden\b/.test(match[2] + ' ' + match[4]);
      doc.body.append(el);
    }
    const calls = [];
    const tours = [
      { id: 't-paused', property_id: 'p1', status: 'ready', storage_path: 'w1/t-paused/package.zip', created_by: 'u1', share_token: TOKEN, share_paused_at: '2026-11-16T00:00:00Z' },
      { id: 't-unshared', property_id: 'p1', status: 'ready', storage_path: 'w1/t-unshared/package.zip', created_by: 'u1', share_token: null, share_paused_at: null },
    ];
    const supabase = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'a@b.invalid' }, access_token: 'tok' } } }), onAuthStateChange() {} },
      from(name) {
        const table = {
          properties: { data: [{ id: 'p1', title: '14 River St', workspace_id: 'w1' }] },
          tours: { data: tours },
          memberships: { data: [{ workspace_id: 'w1', role, status: 'active' }] },
        };
        const b = {
          select() { return b; }, order() { return b; }, eq() { return b; },
          single() { const r = table[name] || { data: [] }; return Promise.resolve({ data: r.data?.[0] || null }); },
          then(res, rej) { return Promise.resolve(table[name] || { data: [] }).then(res, rej); },
        };
        return b;
      },
      async rpc(name, args) {
        calls.push([name, args ? JSON.parse(JSON.stringify(args)) : undefined]);
        if (name === 'can_produce_tours') return { data: true };
        if (name === 'get_account_deletion') return { data: [] };
        if (name === 'get_tour_review') return { data: [{ approved: true }] };
        if (name === 'get_tour_hosting') return { data: [] };
        if (name === 'get_property_campaign_details') return { data: [{ show_on_handoff: true, campaign_mode: 'sale' }] };
        if (name === 'list_workspace_tour_enquiries') return { data: [] };
        if (name === 'get_workspace_public_contact') return { data: [{ show_on_shared: true, display_name: 'Sarah', agency: 'Harbour', phone: '0400 000 000', email: 's@h.invalid' }] };
        if (name === 'get_workspace_handoff_brand') return { data: [{ allow_viewing_request: true, booking_url: null, agency_brand_hex: '#10231d', avatar_url: null, agency_logo_url: null }] };
        if (name === 'set_workspace_handoff_brand') return { data: [{ allow_viewing_request: args.p_allow_viewing_request, booking_url: args.p_booking_url, agency_brand_hex: args.p_agency_brand_hex, avatar_url: args.p_avatar_url, agency_logo_url: args.p_agency_logo_url }] };
        return { data: null, error: { code: 'PGRST202' } };
      },
    };
    const window = {
      VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' },
      supabase: { createClient: () => supabase },
      VeyletPlace: { generalLocationProblem: () => '' },
      VEYLET_HOOKS: { url: 'https://hooks.example.invalid' },
      addEventListener() {},
    };
    const ctx = {
      window, document: doc, Date, URL, URLSearchParams, Intl, TextEncoder, atob, TypeError, console,
      Blob: class { constructor(parts, init) { this.parts = parts; this.type = init?.type; } },
      navigator: { onLine: true, clipboard: { writeText: async () => {} } },
      location: { pathname: '/account', search: '', hash: '', replace() {}, assign() {} },
      setTimeout: (fn, ms) => { if (!ms) setImmediate(fn); return 0; },
      clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      FormData: class { get() { return ''; } },
    };
    vm.runInNewContext(read('dist/vendor/qrcode-1.5.4.min.js'), ctx);
    vm.runInNewContext(read('dist/tour-sharing.js'), ctx);
    await vm.runInNewContext(read('dist/account.js'), ctx);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    return { doc, calls };
  };

  const { doc, calls } = await runDesk('owner');
  for (const id of ['t-paused', 't-unshared']) {
    const card = doc.querySelectorAll('.dash-tour').find(el => el.dataset.tour === id);
    const sync = card.querySelector('.tour-campaign-sync');
    assert.ok(sync, `${id} mounts tourCampaignSync`);
    sync.open = true;
    sync.dispatch('toggle');
  }
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  const enqCalls = calls.filter(([n]) => n === 'list_workspace_tour_enquiries');
  assert.equal(enqCalls.length, 2);
  assert.equal(enqCalls[0][1].p_limit, 200);

  const brandMore = doc.getElementById('account-contact-body').querySelector('.clients-brand-more');
  brandMore.open = true;
  brandMore.dispatch('toggle');
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  const avatarInput = brandMore.querySelectorAll('input').find(i => i.name === 'avatar_url');
  const logoInput = brandMore.querySelectorAll('input').find(i => i.name === 'agency_logo_url');
  assert.equal(avatarInput.type, 'url');
  assert.equal(avatarInput.maxLength, 500);
  assert.equal(avatarInput.readOnly, false);
  assert.equal(logoInput.type, 'url');
  assert.equal(logoInput.maxLength, 500);
  assert.equal(logoInput.readOnly, false);

  // Invalid avatar/logo URLs are rejected client-side
  for (const bad of ['http://insecure.example/a.png', 'javascript:alert(1)', 'https://cdn.example/' + 'a'.repeat(490)]) {
    avatarInput.value = bad;
    brandMore.querySelector('form').dispatch('submit');
    for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
    assert.equal(calls.filter(([n]) => n === 'set_workspace_handoff_brand').length, 0, `rejects ${bad}`);
  }

  avatarInput.value = 'https://cdn.veylet.com/headshot.webp';
  logoInput.value = 'https://cdn.veylet.com/logo.webp';
  brandMore.querySelector('form').dispatch('submit');
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  const saved = calls.find(([n]) => n === 'set_workspace_handoff_brand');
  assert.ok(saved);
  assert.equal(saved[1].p_avatar_url, 'https://cdn.veylet.com/headshot.webp');
  assert.equal(saved[1].p_agency_logo_url, 'https://cdn.veylet.com/logo.webp');

  // Read-only role renders avatar_url and agency_logo_url as readOnly
  const ro = await runDesk('operator');
  const roMore = ro.doc.getElementById('account-contact-body').querySelector('.clients-brand-more');
  roMore.open = true;
  roMore.dispatch('toggle');
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(roMore.querySelectorAll('input').find(i => i.name === 'avatar_url').readOnly, true);
  assert.equal(roMore.querySelectorAll('input').find(i => i.name === 'agency_logo_url').readOnly, true);
});
