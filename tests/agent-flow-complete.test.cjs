'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const siteLib = require('./site-lib.cjs');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');

const APP_STORE_URL = 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913';
const TOKEN = 'abcdefghijklmnop';
const HANDOFF_QR = `https://veylet.com/handoff?t=${TOKEN}&src=qr`;

/* ---- Lightweight DOM harness for stage.js and account.js -------------------- */

function matchSimple(el, selector) {
  const s = selector.trim();
  if (s === '[data-app-qr-modal]') return 'appQrModal' in el.dataset || 'data-app-qr-modal' in el.attributes;
  if (s === '[data-launch-label]') return 'launchLabel' in el.dataset || 'data-launch-label' in el.attributes;
  if (s === '[data-launch-cta]') return 'launchCta' in el.dataset || 'data-launch-cta' in el.attributes;
  if (s === '[data-launch-account]') return 'launchAccount' in el.dataset || 'data-launch-account' in el.attributes;
  if (s === 'a[href*="apps.apple.com/au/app/veylet"]') {
    const href = el.getAttribute('href') ?? el.href ?? '';
    return el.tagName === 'A' && href.includes('apps.apple.com/au/app/veylet');
  }
  if (s.startsWith('.')) {
    const cls = s.slice(1);
    return (el.className || '').split(/\s+/).includes(cls);
  }
  if (s.startsWith('#')) return el.id === s.slice(1);
  if (/^[a-z]+$/i.test(s)) return el.tagName === s.toUpperCase();
  const attrMatch = /^\[data-control="([^"]+)"\]$/.exec(s);
  if (attrMatch) return el.dataset?.control === attrMatch[1];
  return false;
}

function createDom(options = {}) {
  const docListeners = {};
  class Node {
    constructor(tag = 'div', ns = null) {
      this.tagName = String(tag).toUpperCase();
      this.namespace = ns;
      this.children = [];
      this.parent = null;
      this.parentNode = null;
      this.dataset = {};
      this.attributes = {};
      this.style = {};
      this.events = {};
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
      this.checked = false;
      this.open = false;
      this.value = '';
      this._text = '';
      this.className = '';
      this.id = '';
      this.type = '';
      this.name = '';
      this.tabIndex = undefined;
      const el = this;
      this.classList = {
        add(...names) {
          const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
          names.forEach(n => set.add(n));
          el.className = [...set].join(' ');
        },
        remove(...names) {
          el.className = (el.className || '').split(/\s+/).filter(n => n && !names.includes(n)).join(' ');
        },
        contains(n) { return (el.className || '').split(/\s+/).includes(n); },
      };
    }
    get textContent() {
      return this._text + this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
    }
    set textContent(v) {
      this.children = [];
      this._text = String(v ?? '');
    }
    get href() { return this.attributes.href ?? this._href ?? ''; }
    set href(v) { this._href = String(v ?? ''); this.attributes.href = this._href; }
    append(...nodes) {
      for (const node of nodes) {
        if (node === null || node === undefined) continue;
        if (typeof node === 'string') { this._text += node; continue; }
        if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node);
        node.parent = this;
        node.parentNode = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      for (const c of this.children) { c.parent = null; c.parentNode = null; }
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
      this.parentNode = null;
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(v);
      }
    }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    removeAttribute(k) {
      delete this.attributes[k];
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[camel];
      }
    }
    hasAttribute(k) { return k in this.attributes; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    removeEventListener(name, fn) { if (this.events[name]) this.events[name] = this.events[name].filter(h => h !== fn); }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    shown() { return this.hidden ? [] : this.children.filter(c => !c.hidden).flatMap(c => [c, ...c.shown()]); }
    querySelectorAll(selector) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      return this.all().filter(el => parts.some(p => matchSimple(el, p)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
      const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
      for (let at = this; at; at = at.parent) {
        if (parts.some(p => matchSimple(at, p))) return at;
      }
      return null;
    }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    focus() { this.wasFocused = true; doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
    click() {
      this.clicked = (this.clicked || 0) + 1;
      return this.fire('click', { button: 0 });
    }
    select() {}
    scrollIntoView() {}
    reset() {}
    getContext() { return this.tagName === 'CANVAS' ? { fillStyle: '', fillRect() {}, fillText() {} } : null; }
    toBlob(done, type) { done({ type, size: 1 }); }
    async fire(name, event = {}) {
      const ev = {
        type: name,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        target: this,
        ...event,
      };
      for (const fn of this.events[name] || []) await fn(ev);
      if (name === 'click' || name === 'keydown') {
        for (const fn of docListeners[name] || []) await fn(ev);
      }
      return ev;
    }
  }

  const rootEl = new Node('html');
  const headEl = new Node('head');
  const bodyEl = new Node('body');
  rootEl.append(headEl, bodyEl);
  const doc = {
    readyState: 'complete',
    hidden: false,
    activeElement: null,
    documentElement: rootEl,
    head: headEl,
    body: bodyEl,
    createElement: tag => new Node(tag),
    createElementNS: (ns, tag) => new Node(tag, ns),
    getElementById: id => rootEl.all().find(el => el.id === id) || null,
    querySelectorAll: sel => rootEl.querySelectorAll(sel),
    querySelector: sel => rootEl.querySelector(sel),
    addEventListener: (name, fn) => { (docListeners[name] ||= []).push(fn); },
    removeEventListener: (name, fn) => { if (docListeners[name]) docListeners[name] = docListeners[name].filter(h => h !== fn); },
    async fireDoc(name, event = {}) {
      const ev = {
        type: name,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        target: bodyEl,
        ...event,
      };
      for (const fn of docListeners[name] || []) await fn(ev);
      return ev;
    },
  };
  if (options.appMode) rootEl.setAttribute('data-app-mode', 'true');
  return { doc, Node, docListeners };
}

function loadStageEnv(options = {}) {
  const { doc } = createDom(options);
  const cta = doc.createElement('a');
  cta.setAttribute('href', APP_STORE_URL);
  cta.setAttribute('class', 'button');
  cta.setAttribute('data-launch-cta', '');
  cta.textContent = 'Get the app';
  doc.body.append(cta);

  const secondCta = doc.createElement('a');
  secondCta.setAttribute('href', APP_STORE_URL);
  secondCta.setAttribute('class', 'button');
  secondCta.textContent = 'Get the app';
  doc.body.append(secondCta);

  const matchesDesktop = options.desktop !== false;
  const window = {
    location: { pathname: options.pathname || '/' },
    matchMedia: query => ({
      matches: query.includes('801px') && query.includes('hover: hover') && query.includes('pointer: fine') ? matchesDesktop : false,
      addEventListener() {},
    }),
  };
  const qrScript = read('vendor/qrcode-1.5.4.min.js');
  if (options.withQr) {
    vm.runInNewContext(qrScript, { window, URL, TextEncoder, navigator: {} });
  }
  vm.runInNewContext(read('stage.js'), { window, document: doc, Object, setTimeout, clearTimeout });
  return { doc, window, cta, secondCta };
}

/* ---- 1. Desktop App Store QR Modal (dist/stage.js + dist/conversion.css) ---- */

test('desktop fine-pointer plain click on App Store CTA opens [data-app-qr-modal] with QR, direct link, and focus restore', async () => {
  const { doc, cta } = loadStageEnv({ desktop: true });
  assert.equal(cta.getAttribute('href'), APP_STORE_URL, 'static href stays untouched');

  cta.focus();
  const ev = await cta.fire('click', { button: 0 });
  assert.equal(ev.defaultPrevented, true, 'plain desktop click intercepts navigation');

  const modal = doc.querySelector('[data-app-qr-modal]');
  assert.ok(modal, '[data-app-qr-modal] is mounted');
  assert.equal(modal.hidden, false);
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.match(modal.textContent, /Scan with your iPhone Pro/);

  const svg = modal.querySelector('svg');
  const canvas = modal.querySelector('canvas');
  assert.ok(svg || canvas, 'renders a scannable QR SVG or canvas');
  if (svg) {
    assert.ok(svg.querySelector('path'), 'QR SVG draws module paths');
    assert.match(svg.getAttribute('viewBox') || '', /^0 0 \d+ \d+$/);
  }

  const direct = modal.querySelectorAll('a').find(a => /Open App Store in this browser/.test(a.textContent));
  assert.ok(direct, 'direct App Store link exists inside modal');
  assert.equal(direct.getAttribute('href'), APP_STORE_URL);
  const directEv = await direct.fire('click', { button: 0 });
  assert.equal(directEv.defaultPrevented, false, 'direct link inside modal navigates normally');

  const close = modal.querySelectorAll('button').find(b => /Close/i.test(b.textContent));
  assert.ok(close, 'Close button exists');
  assert.equal(doc.activeElement, close, 'focus moves into modal on open');

  await close.fire('click', { button: 0 });
  assert.equal(modal.hidden, true, 'Close hides modal');
  assert.equal(doc.activeElement, cta, 'Close restores focus to trigger');

  // Reopen and close with Escape
  cta.focus();
  await cta.fire('click', { button: 0 });
  assert.equal(modal.hidden, false);
  await doc.fireDoc('keydown', { key: 'Escape' });
  assert.equal(modal.hidden, true, 'Escape closes modal');
  assert.equal(doc.activeElement, cta, 'Escape restores focus to trigger');

  // Backdrop click closes modal and idempotent mountAppQrModal leaves one modal
  if (typeof globalThis === 'object') {
    const modalsBefore = doc.querySelectorAll('[data-app-qr-modal]').length;
    assert.equal(modalsBefore, 1);
  }
  await cta.fire('click', { button: 0 });
  assert.equal(modal.hidden, false);
  await modal.fire('click', { button: 0, target: modal });
  assert.equal(modal.hidden, true, 'clicking backdrop closes modal');
  assert.equal(doc.activeElement, cta, 'backdrop close restores focus');
});

test('desktop modifier clicks and mobile/coarse-pointer clicks let the App Store link navigate directly', async () => {
  const desktop = loadStageEnv({ desktop: true });
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const ev = await desktop.cta.fire('click', { button: 0, ...mod });
    assert.equal(ev.defaultPrevented, false, 'modifier/non-primary click navigates directly: ' + JSON.stringify(mod));
    const modal = desktop.doc.querySelector('[data-app-qr-modal]');
    assert.ok(!modal || modal.hidden, 'modal stays closed for modified click');
  }

  const mobile = loadStageEnv({ desktop: false });
  const mobileEv = await mobile.cta.fire('click', { button: 0 });
  assert.equal(mobileEv.defaultPrevented, false, 'mobile/coarse pointer navigates directly');
  const mobileModal = mobile.doc.querySelector('[data-app-qr-modal]');
  assert.ok(!mobileModal || mobileModal.hidden, 'mobile does not open QR modal');
});

test('dist/conversion.css defines accessible [data-app-qr-modal] dialog styles and reduced-motion rule', () => {
  const css = read('conversion.css');
  assert.match(css, /\[data-app-qr-modal\]/);
  assert.match(css, /\.app-qr-dialog/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

/* ---- 2. /start v1.1 procedure alignment ------------------------------------ */

test('dist/start/index.html reflects v1.1 optional practice room flow', () => {
  const html = read('start/index.html');
  assert.doesNotMatch(html, /and the app unlocks real captures once your practice room passes/);
  assert.match(html, /you can try an optional practice room first or go straight to capturing a space room by room/);
});

/* ---- Desk harness for Release-5 controls & printable open-home sheet -------- */

async function loadDeskEnv(options = {}) {
  const { doc } = createDom({ appMode: options.appMode });
  const markup = read(options.appMode ? 'app/account/index.html' : 'account/index.html');
  for (const match of markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([\w-]+)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const el = doc.createElement(match[1]);
    el.id = match[3];
    el.hidden = /\shidden\b/.test(match[2] + ' ' + match[4]);
    doc.body.append(el);
  }
  const calls = [], copied = [], downloads = [], printed = [];
  const user = { id: 'user-1', email: 'agent@example.invalid' };
  const tours = (options.tours || [{ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: TOKEN }]).map(r => ({ ...r }));
  const properties = options.properties || [{ id: 'p1', title: '14 River St <img src=x onerror=1>', workspace_id: 'w1' }];
  const missing = name => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 'token-1' } } }),
      onAuthStateChange() {},
      signOut: async () => ({}),
    },
    from(name) {
      const table = {
        properties: { data: properties },
        tours: { data: tours },
        memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
      };
      const builder = {
        select() { return builder; }, order() { return builder; }, eq() { return builder; },
        single() { const r = table[name] || { data: [] }; return Promise.resolve({ data: r.data?.[0] || null, error: r.error }); },
        then(resolve, reject) { return Promise.resolve(table[name] || { data: [] }).then(resolve, reject); },
      };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args ? JSON.parse(JSON.stringify(args)) : undefined]);
      if (options.rpc?.[name]) return options.rpc[name](args);
      if (name === 'can_produce_tours') return { data: true };
      if (name === 'get_account_deletion') return { data: [] };
      if (name === 'get_tour_review') return { data: [{ approved: true }] };
      if (name === 'get_tour_hosting') return { data: [{ tour_id: 't1', released_at: '2026-10-01T00:00:00Z', plan_active: true }] };
      if (name === 'get_workspace_public_contact') {
        return { data: [options.contact || { show_on_shared: true, display_name: 'Sarah Chen', agency: 'Harbour Realty', phone: '0400 123 456', email: 'sarah@harbour.invalid', updated_at: null }] };
      }
      return missing(name);
    },
  };
  const window = {
    VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' },
    supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' },
    VEYLET_HOOKS: { url: 'https://hooks.example.invalid' },
    print: () => { printed.push(true); },
    addEventListener() {},
  };
  const FakeURL = Object.assign(function (...args) { return new URL(...args); }, {
    createObjectURL: blob => { downloads.push(blob); return 'blob:test'; },
    revokeObjectURL() {},
  });
  const context = {
    window, document: doc, Date, URL: FakeURL, URLSearchParams, Intl, TextEncoder, atob, TypeError,
    navigator: { onLine: true, clipboard: { writeText: async text => { copied.push(text); } } },
    location: { pathname: options.appMode ? '/app/account' : '/account', search: '', hash: '', replace() {}, assign() {} },
    setTimeout: (fn, ms) => { if (!ms) setImmediate(fn); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    FormData: class { get() { return ''; } },
    Blob: class { constructor(parts, init) { this.parts = parts; this.type = init?.type; } },
  };
  siteLib.load(context);
  vm.runInNewContext(read('vendor/qrcode-1.5.4.min.js'), context);
  vm.runInNewContext(read('tour-sharing.js'), context);
  await vm.runInNewContext(read('account.js'), context);
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return {
    doc, window, calls, copied, downloads, printed,
    card: (id = 't1') => doc.querySelectorAll('.dash-tour').find(el => el.dataset.tour === id) || null,
    count: name => calls.filter(([n]) => n === name).length,
    settle: async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); },
  };
}

/* ---- 3. Printable Open-Home QR Sheet ---------------------------------------- */

test('print-open-home creates safe @media print sheet with space title, QR, copy, URL and contact (!APP_MODE)', async () => {
  const h = await loadDeskEnv();
  const card = h.card('t1');
  const qrToggle = card.querySelectorAll('button').find(b => b.dataset.disclosure === 'qr');
  await qrToggle.fire('click');
  const printBtn = card.querySelector('[data-control="print-open-home"]');
  assert.ok(printBtn, 'print-open-home button present on web desk');
  assert.equal(printBtn.disabled, false);

  await printBtn.fire('click');
  assert.equal(h.printed.length, 1, 'triggers window.print()');

  const sheet = h.doc.body.querySelector('.tour-print-sheet');
  assert.ok(sheet, 'printable .tour-print-sheet mounted in body');
  assert.equal(sheet.hidden, false);
  const text = sheet.textContent;
  assert.ok(text.includes('14 River St <img src=x onerror=1>'), 'space title rendered safely as text');
  assert.equal(sheet.querySelector('img'), null, 'no injected HTML img from XSS title');
  assert.ok(text.includes('Walk back through every room on your phone'));
  assert.ok(text.includes('veylet.com/handoff?t=' + TOKEN + '&src=qr'));
  assert.ok(text.includes('Sarah Chen'));
  assert.ok(text.includes('Harbour Realty'));
  assert.ok(text.includes('0400 123 456'));
  assert.doesNotMatch(text, /\$/);
  assert.ok(sheet.querySelector('svg'), 'scannable QR SVG rendered in print sheet');

  // Hidden contact details stay off the print sheet
  const hiddenContact = await loadDeskEnv({
    contact: { show_on_shared: false, display_name: 'Private Name', agency: 'Private Agency', phone: '0499 999 999', email: 'private@example.invalid', updated_at: null },
  });
  const hiddenCard = hiddenContact.card('t1');
  await hiddenCard.querySelectorAll('button').find(b => b.dataset.disclosure === 'qr').fire('click');
  await hiddenCard.querySelector('[data-control="print-open-home"]').fire('click');
  const hiddenSheet = hiddenContact.doc.body.querySelector('.tour-print-sheet');
  assert.doesNotMatch(hiddenSheet.textContent, /Private Name|Private Agency|0499 999 999/);

  // App mode hides print-open-home completely
  const app = await loadDeskEnv({ appMode: true });
  const appCard = app.card('t1');
  await appCard.querySelectorAll('button').find(b => b.dataset.disclosure === 'qr').fire('click');
  assert.equal(appCard.querySelector('[data-control="print-open-home"]'), null, 'no print-open-home in APP_MODE');

  const guideCss = read('account-guide.css');
  assert.match(guideCss, /@media print/);
  assert.match(guideCss, /\.tour-print-sheet/);
});

/* ---- 4. Lazy <details class="tour-campaign-sync"> --------------------------- */

test('tour-campaign-sync loads lazily on first open, saves edits, preserves 5 builder radios, and hides on PGRST202', async () => {
  const h = await loadDeskEnv({
    rpc: {
      get_property_campaign_details: async () => ({
        data: [{
          show_on_handoff: true,
          campaign_mode: 'sale',
          headline: 'North-facing riverfront',
          bedrooms: 3,
          bathrooms: 2,
          car_spaces: 1,
          next_open_start: '2026-11-21T00:00:00Z',
          next_open_end: '2026-11-21T00:30:00Z',
        }],
      }),
      list_workspace_tour_enquiries: async () => ({
        data: [{
          enquiry_id: 'e1',
          tour_id: 't1',
          space_title: '14 River St',
          visitor_name: 'Liam <script>',
          visitor_email: 'liam@buyer.invalid',
          visitor_phone: '0412 345 678',
          stop_number: 2,
          message: 'Can we inspect Saturday?',
          created_at: '2026-11-16T02:00:00Z',
        }, {
          // Sent before an approved correction replaced the version the buyer saw: same walkthrough, earlier tour.
          enquiry_id: 'e2', tour_id: 't1-earlier', walkthrough_id: 't1', space_title: '14 River St',
          visitor_name: 'Earlier Buyer', visitor_email: 'earlier@buyer.invalid', visitor_phone: null,
          stop_number: null, message: 'Wrote before the correction', created_at: '2026-11-15T02:00:00Z',
        }, {
          enquiry_id: 'e3', tour_id: 't9', walkthrough_id: 't9', space_title: '2 Other St',
          visitor_name: 'Other Buyer', visitor_email: 'other@buyer.invalid', visitor_phone: null,
          stop_number: null, message: 'About another walkthrough', created_at: '2026-11-15T03:00:00Z',
        }],
      }),
      set_property_campaign_details: async args => ({
        data: [{
          show_on_handoff: args.p_show_on_handoff,
          campaign_mode: args.p_campaign_mode,
          headline: args.p_headline,
          bedrooms: args.p_bedrooms,
          bathrooms: args.p_bathrooms,
          car_spaces: args.p_car_spaces,
          next_open_start: args.p_next_open_start,
          next_open_end: args.p_next_open_end,
          updated_at: '2026-11-16T03:00:00Z',
        }],
      }),
    },
  });

  // Zero lazy RPCs fired on initial desk load
  assert.equal(h.count('get_property_campaign_details'), 0);
  assert.equal(h.count('list_workspace_tour_enquiries'), 0);

  const card = h.card('t1');
  assert.equal(card.querySelectorAll('input').filter(i => i.type === 'radio').length, 5, 'exact 5 builder radios kept');

  const syncDetails = card.querySelector('.tour-campaign-sync');
  assert.ok(syncDetails, '<details class="tour-campaign-sync"> exists on live card');
  assert.equal(syncDetails.open, false);

  syncDetails.open = true;
  await syncDetails.fire('toggle');
  await h.settle();

  assert.equal(h.count('get_property_campaign_details'), 1);
  assert.equal(h.count('list_workspace_tour_enquiries'), 1);
  assert.equal(card.querySelectorAll('input').filter(i => i.type === 'radio').length, 5, 'still exact 5 builder radios after opening');
  assert.deepEqual(
    card.querySelectorAll('button').filter(b => /\btour-action-primary\b/.test(b.className || '')).map(b => b.textContent),
    ['Copy link'],
    'only one primary action button on live card'
  );

  // Form populated and enquiry rendered safely
  const modeSelect = syncDetails.querySelectorAll('select').find(s => s.name === 'campaign_mode');
  const headlineInput = syncDetails.querySelectorAll('input').find(i => i.name === 'headline');
  const bedsInput = syncDetails.querySelectorAll('input').find(i => i.name === 'bedrooms');
  assert.equal(modeSelect.value, 'sale');
  assert.equal(headlineInput.value, 'North-facing riverfront');
  assert.equal(String(bedsInput.value), '3');
  assert.ok(syncDetails.textContent.includes('Liam <script>'));
  assert.ok(syncDetails.textContent.includes('Can we inspect Saturday?'));
  assert.ok(syncDetails.textContent.includes('Wrote before the correction'), 'an enquiry follows its walkthrough across versions');
  assert.ok(!syncDetails.textContent.includes('About another walkthrough'), 'another walkthrough’s enquiry is not listed here');

  // Edit & save
  modeSelect.value = 'lease';
  headlineInput.value = 'Updated riverfront lease';
  bedsInput.value = '4';
  const form = syncDetails.querySelector('form');
  await form.fire('submit');
  await h.settle();

  const saveCall = h.calls.find(([n]) => n === 'set_property_campaign_details');
  assert.ok(saveCall, 'calls set_property_campaign_details');
  assert.equal(saveCall[1].p_property_id, 'p1');
  assert.equal(saveCall[1].p_campaign_mode, 'lease');
  assert.equal(saveCall[1].p_headline, 'Updated riverfront lease');
  assert.equal(saveCall[1].p_bedrooms, 4);

  // Invalid open-home window is rejected client-side without firing set_property_campaign_details
  const startInput = syncDetails.querySelectorAll('input').find(i => i.name === 'next_open_start');
  const endInput = syncDetails.querySelectorAll('input').find(i => i.name === 'next_open_end');
  startInput.value = '2026-11-22T10:00';
  endInput.value = '2026-11-22T09:00';
  await form.fire('submit');
  assert.equal(h.count('set_property_campaign_details'), 1, 'invalid window blocked client-side');

  // enquiries PGRST202 does not hide campaign form when get_property_campaign_details succeeds
  const noEnq = await loadDeskEnv({
    rpc: {
      get_property_campaign_details: async () => ({
        data: [{ show_on_handoff: true, campaign_mode: 'sale', headline: 'Garden villa', bedrooms: 2, bathrooms: 1, car_spaces: 1, next_open_start: null, next_open_end: null }],
      }),
    },
  });
  const noEnqSync = noEnq.card('t1').querySelector('.tour-campaign-sync');
  noEnqSync.open = true;
  await noEnqSync.fire('toggle');
  await noEnq.settle();
  assert.equal(noEnqSync.hidden, false);
  assert.equal(noEnqSync.querySelectorAll('input').find(i => i.name === 'headline').value, 'Garden villa');

  // PGRST202 hides silently
  const missing = await loadDeskEnv();
  const missingSync = missing.card('t1').querySelector('.tour-campaign-sync');
  missingSync.open = true;
  await missingSync.fire('toggle');
  await missing.settle();
  assert.equal(missingSync.hidden, true, 'hides silently when campaign/enquiries RPCs return PGRST202');

  // Draft cards do not expose campaign sync
  const draft = await loadDeskEnv({
    tours: [{ id: 't2', property_id: 'p1', status: 'draft', storage_path: 'w1/t2/package.zip', created_by: 'user-1', share_token: null }],
  });
  assert.equal(draft.card('t2').querySelector('.tour-campaign-sync'), null);
});

/* ---- 5. Lazy <details class="clients-brand-more"> --------------------------- */

test('clients-brand-more loads lazily on open, saves brand settings, preserves #account-contact-body invariants, and hides on PGRST202', async () => {
  const h = await loadDeskEnv({
    rpc: {
      get_workspace_handoff_brand: async () => ({
        data: [{
          show_on_shared: true,
          display_name: 'Sarah Chen',
          agency: 'Harbour Realty',
          phone: '0400 123 456',
          email: 'sarah@harbour.invalid',
          booking_url: 'https://cal.example/sarah',
          allow_viewing_request: true,
          agency_brand_hex: '#18382e',
          avatar_url: 'https://cdn.example/avatar.webp',
          agency_logo_url: null,
        }],
      }),
      set_workspace_handoff_brand: async args => ({
        data: [{
          show_on_shared: true,
          display_name: 'Sarah Chen',
          agency: 'Harbour Realty',
          phone: '0400 123 456',
          email: 'sarah@harbour.invalid',
          booking_url: args.p_booking_url,
          allow_viewing_request: args.p_allow_viewing_request,
          agency_brand_hex: args.p_agency_brand_hex,
          avatar_url: args.p_avatar_url,
          agency_logo_url: args.p_agency_logo_url,
        }],
      }),
    },
  });

  assert.equal(h.count('get_workspace_handoff_brand'), 0, 'not called during initial load');
  const body = h.doc.getElementById('account-contact-body');
  const figure = body.querySelector('figure');
  assert.equal(figure.querySelectorAll('button, a, input').length, 0, 'nothing interactive inside clients-preview');

  const primaryButtons = () => body.querySelectorAll('button').filter(b => /\btour-action-primary\b/.test(b.className || '')).map(b => b.textContent);
  assert.deepEqual(primaryButtons(), ['Save']);

  const brandMore = body.querySelector('.clients-brand-more');
  assert.ok(brandMore, '<details class="clients-brand-more"> present in #account-contact-body');
  assert.equal(brandMore.open, false);

  brandMore.open = true;
  await brandMore.fire('toggle');
  await h.settle();

  assert.equal(h.count('get_workspace_handoff_brand'), 1);
  assert.deepEqual(primaryButtons(), ['Save'], 'filled primary action in #account-contact-body stays ["Save"] after opening');
  assert.deepEqual(
    body.querySelectorAll('.clients-field').map(l => l.children[0].textContent),
    ['Name', 'Agency', 'Phone', 'Email'],
    'CLIENTS_FIELDS labels remain unchanged'
  );

  const bookingInput = brandMore.querySelectorAll('input').find(i => i.name === 'booking_url');
  const viewingInput = brandMore.querySelectorAll('input').find(i => i.name === 'allow_viewing_request');
  const hexInput = brandMore.querySelectorAll('input').find(i => i.name === 'agency_brand_hex');
  assert.equal(bookingInput.value, 'https://cal.example/sarah');
  assert.equal(viewingInput.checked, true);
  assert.equal(hexInput.value, '#18382e');

  // Invalid URL & invalid hex are rejected client-side
  bookingInput.value = 'http://insecure.example';
  hexInput.value = 'green';
  await brandMore.querySelector('form').fire('submit');
  assert.equal(h.count('set_workspace_handoff_brand'), 0, 'invalid booking_url/hex blocked client-side');

  // Valid update
  bookingInput.value = 'https://cal.example/sarah-open';
  viewingInput.checked = false;
  hexInput.value = '#23453B';
  await brandMore.querySelector('form').fire('submit');
  await h.settle();

  const saveCall = h.calls.find(([n]) => n === 'set_workspace_handoff_brand');
  assert.ok(saveCall, 'calls set_workspace_handoff_brand');
  assert.deepEqual(saveCall[1], {
    p_workspace_id: 'w1',
    p_booking_url: 'https://cal.example/sarah-open',
    p_allow_viewing_request: false,
    p_agency_brand_hex: '#23453b',
    p_avatar_url: 'https://cdn.example/avatar.webp',
    p_agency_logo_url: null,
  });

  // PGRST202 hides silently (clients-brand-more)
  const missing = await loadDeskEnv();
  const missingMore = missing.doc.getElementById('account-contact-body').querySelector('.clients-brand-more');
  missingMore.open = true;
  await missingMore.fire('toggle');
  await missing.settle();
  assert.equal(missingMore.hidden, true, 'clients-brand-more hides silently on PGRST202');
});
