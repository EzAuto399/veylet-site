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
  assert.equal(visit.startAt, null);
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
