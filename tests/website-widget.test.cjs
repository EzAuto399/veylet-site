'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

function loadEmbedWidget({ readyState = 'complete', locationHref = 'https://agency.example/listing/14-river-st' } = {}) {
  const source = read('dist/embed.js');
  const document = createDocument();
  document.readyState = readyState;
  document.documentElement = document.createElement('html');
  let docListenerAdds = 0;
  const origAdd = document.addEventListener;
  document.addEventListener = (type, fn) => {
    if (type === 'click') docListenerAdds++;
    return origAdd(type, fn);
  };
  const window = { location: { href: locationHref } };
  const dispatchDoc = (type, event) => {
    const set = document.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(event);
  };
  const context = {
    window,
    document,
    location: window.location,
    URL,
    encodeURIComponent,
  };
  vm.runInNewContext(source, context);
  return { source, window, document, dispatchDoc, get docListenerAdds() { return docListenerAdds; } };
}

function makeModalAnchor(document, href, { modal = true, label = 'Explore in 3D', theme = '' } = {}) {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (modal) a.setAttribute('data-veylet-modal', '');
  if (theme) a.setAttribute('data-veylet-theme', theme);
  a.textContent = label;
  document.body.append(a);
  return a;
}

function fireDocClick(h, target, overrides = {}) {
  const event = {
    type: 'click',
    target,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
  h.dispatchDoc('click', event);
  return event;
}

/* ---- 1. dist/embed.js --------------------------------------------------- */

test('a modal construction failure leaves the handoff anchor navigation intact', () => {
  const h = loadEmbedWidget();
  const href = 'https://veylet.com/handoff?t=' + TOKEN;
  const a = makeModalAnchor(h.document, href);
  h.document.body.style.overflow = 'auto';
  h.document.createElement = () => { throw new Error('blocked'); };
  const event = fireDocClick(h, a);
  assert.equal(event.defaultPrevented, false);
  assert.equal(a.getAttribute('href'), href);
  assert.equal(h.document.body.style.overflow, 'auto');
});

test('dist/embed.js is vanilla JS under 3.6 KB and never uses innerHTML/insertAdjacentHTML/outerHTML', () => {
  const source = read('dist/embed.js');
  assert.ok(Buffer.byteLength(source, 'utf8') < 3600, `embed.js must be < 3600 bytes, got ${Buffer.byteLength(source, 'utf8')}`);
  assert.doesNotMatch(source, /\b(?:innerHTML|insertAdjacentHTML|outerHTML)\b/);
});

test('embed.js mounts idempotently via window.VeyletEmbed.mount()', () => {
  const h = loadEmbedWidget();
  assert.ok(h.window.VeyletEmbed && typeof h.window.VeyletEmbed.mount === 'function');
  const before = h.docListenerAdds;
  assert.equal(before, 1);
  h.window.VeyletEmbed.mount();
  h.window.VeyletEmbed.mount();
  assert.equal(h.docListenerAdds, 1, 'repeat mount() must not add duplicate click listeners');

  const a = makeModalAnchor(h.document, 'https://veylet.com/handoff?t=' + TOKEN);
  fireDocClick(h, a);
  assert.equal(h.document.body.querySelectorAll('iframe').length, 1);
});

test('embed.js intercepts plain left-clicks on /handoff?t=... and /embed?t=... with data-veylet-modal', () => {
  for (const href of [
    'https://veylet.com/handoff?t=' + TOKEN,
    'https://veylet.com/embed?t=' + TOKEN,
  ]) {
    const h = loadEmbedWidget();
    const a = makeModalAnchor(h.document, href);
    const span = h.document.createElement('span');
    span.textContent = 'Explore in 3D';
    a.replaceChildren(span);
    h.document.activeElement = a;

    const event = fireDocClick(h, span);
    assert.equal(event.defaultPrevented, true, href + ' prevents default navigation');
    assert.equal(h.document.body.style.overflow, 'hidden', 'locks body scroll');

    const dialog = h.document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'renders modal overlay dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(dialog.style.position, 'fixed');
    assert.equal(String(dialog.style.zIndex), '2147483000');
    assert.equal(dialog.style.background, 'rgba(16, 35, 29, 0.88)');
    assert.match(String(dialog.style.backdropFilter || dialog.style['backdrop-filter']), /blur\(8px\)/);

    const closeBtn = dialog.querySelector('button');
    assert.ok(closeBtn, 'renders Close button');
    assert.equal(closeBtn.textContent, 'Close');
    assert.equal(closeBtn.style.minHeight, '44px');
    assert.equal(h.document.activeElement, closeBtn, 'moves focus into modal Close button');

    const frame = dialog.querySelector('iframe');
    assert.ok(frame, 'renders iframe inside modal');
    assert.equal(frame.getAttribute('src'), 'https://veylet.com/embed?t=' + TOKEN);
    assert.equal(frame.getAttribute('allow'), 'fullscreen; xr-spatial-tracking');

    // Escape closes, unlocks scroll, and restores focus to trigger link
    h.dispatchDoc('keydown', { key: 'Escape', preventDefault() {} });
    assert.equal(h.document.querySelector('[role="dialog"]'), null, 'Escape removes overlay');
    assert.equal(h.document.body.style.overflow, '', 'restores body scroll');
    assert.equal(h.document.activeElement, a, 'restores focus to trigger anchor');
  }

  // Close button click restores prior body overflow and paper theme forwards &theme=paper
  const h2 = loadEmbedWidget();
  h2.document.body.style.overflow = 'auto';
  const themed = makeModalAnchor(h2.document, 'https://veylet.com/handoff?t=' + TOKEN, { theme: 'paper' });
  h2.document.activeElement = themed;
  fireDocClick(h2, themed);
  const dialog2 = h2.document.querySelector('[role="dialog"]');
  assert.equal(dialog2.querySelector('iframe').getAttribute('src'), 'https://veylet.com/embed?t=' + TOKEN + '&theme=paper');
  dialog2.querySelector('button').click();
  assert.equal(h2.document.querySelector('[role="dialog"]'), null);
  assert.equal(h2.document.body.style.overflow, 'auto');
  assert.equal(h2.document.activeElement, themed);
});

test('embed.js leaves modified clicks, non-modal links, non-Veylet origins, and short tokens alone', () => {
  const h = loadEmbedWidget();
  const valid = makeModalAnchor(h.document, 'https://veylet.com/handoff?t=' + TOKEN);
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
    const ev = fireDocClick(h, valid, mod);
    assert.equal(ev.defaultPrevented, false, 'ignores modified click ' + JSON.stringify(mod));
    assert.equal(h.document.querySelector('[role="dialog"]'), null);
  }

  const plainHandoff = makeModalAnchor(h.document, 'https://veylet.com/handoff?t=' + TOKEN, { modal: false });
  assert.equal(fireDocClick(h, plainHandoff).defaultPrevented, false);

  const foreign = makeModalAnchor(h.document, 'https://evil.invalid/handoff?t=' + TOKEN);
  assert.equal(fireDocClick(h, foreign).defaultPrevented, false);

  const shortTok = makeModalAnchor(h.document, 'https://veylet.com/handoff?t=tooshort');
  assert.equal(fireDocClick(h, shortTok).defaultPrevented, false);
  assert.equal(h.document.querySelector('[role="dialog"]'), null);
});

/* ---- 2. dist/embed/index.html ------------------------------------------- */

test('dist/embed/index.html supports ?theme=paper with #f4f1e9/#10231d contrast and touch-action: pan-y', () => {
  const markup = read('dist/embed/index.html');
  assert.match(markup, /\.embed-fallback\s*\{[^}]*touch-action:\s*pan-y/);
  assert.match(markup, /html\[data-theme="paper"\]/);
  assert.match(markup, /#f4f1e9/);
  assert.match(markup, /#10231d/);
  assert.doesNotMatch(markup, /\b(?:innerHTML|insertAdjacentHTML|outerHTML)\b/);

  const source = markup.match(/<script>([\s\S]*?)<\/script>/)[1];
  const run = search => {
    const ids = {};
    for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
      ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, style: { setProperty() {} }, addEventListener() {} };
    }
    const htmlAttrs = {};
    const document = {
      getElementById: id => ids[id],
      documentElement: {
        dataset: {},
        setAttribute(k, v) { htmlAttrs[k] = v; },
        getAttribute(k) { return htmlAttrs[k] ?? null; },
      },
    };
    vm.runInNewContext(source, {
      window: { VeyletPlayer: undefined },
      document,
      location: { search },
      URLSearchParams,
      setTimeout,
      Promise,
    });
    return { htmlAttrs, dataset: document.documentElement.dataset };
  };

  const paper = run('?t=' + TOKEN + '&theme=paper');
  assert.equal(paper.htmlAttrs['data-theme'], 'paper');
  assert.equal(paper.dataset.theme, 'paper');

  const dark = run('?t=' + TOKEN);
  assert.equal(dark.htmlAttrs['data-theme'], undefined);
  assert.equal(dark.dataset.theme, undefined);
});

/* ---- 3. dist/tour-sharing.js -------------------------------------------- */

test('VeyletSharing supports embedUrl(token, opts), modalButtonCode, and developerBrief', () => {
  const source = read('dist/tour-sharing.js');
  const window = {};
  vm.runInNewContext(source, { window, URL, navigator: {} });
  const share = window.VeyletSharing;

  assert.equal(share.embedUrl(TOKEN), 'https://veylet.com/embed?t=' + TOKEN);
  assert.equal(share.embedUrl(TOKEN, {}), 'https://veylet.com/embed?t=' + TOKEN);
  assert.equal(share.embedUrl(TOKEN, { theme: 'paper' }), 'https://veylet.com/embed?t=' + TOKEN + '&theme=paper');

  const defaultModal = share.modalButtonCode(TOKEN);
  assert.equal(
    defaultModal,
    `<a href="https://veylet.com/handoff?t=${TOKEN}" data-veylet-modal>Explore in 3D</a>\n<script src="https://veylet.com/embed.js" async></script>`
  );
  const customModal = share.modalButtonCode(TOKEN, 'View <3D> Tour & Rooms');
  assert.match(customModal, />View &lt;3D&gt; Tour &amp; Rooms<\/a>/);

  const brief = share.developerBrief(TOKEN);
  for (const expected of [
    'Stepps',
    'Agentpoint',
    'WebIT',
    'Propps',
    'REA XML',
    'https://veylet.com/tour?t=' + TOKEN,
    'data-veylet-modal',
    'https://veylet.com/embed.js',
    '?theme=paper',
    'frame-src https://veylet.com; script-src https://veylet.com',
  ]) {
    assert.ok(brief.includes(expected), 'developerBrief includes ' + expected);
  }
  assert.doesNotMatch(brief, /lidar|splat|gaussian|webgl|\bmesh\b|\bpipeline\b|photogrammetr/i);
});

/* ---- 4. dist/website-guide/index.html & dist/website-guide.js ----------- */

test('website-guide fixes portal answer, adds AU agency details, and wires modal/theme/brief controls', async () => {
  const markup = read('dist/website-guide/index.html');
  const guide = read('dist/website-guide.js');
  const sharing = read('dist/tour-sharing.js');

  assert.doesNotMatch(guide, /\b(?:innerHTML|insertAdjacentHTML|outerHTML)\b/);

  const portalAnswer = markup.match(/<summary>Will it work on a property portal\?<\/summary><p>([\s\S]*?)<\/p>/)[1];
  assert.match(portalAnswer, /https:\/\/veylet\.com\/tour\?t=/);
  assert.match(portalAnswer, /Copy link for portals/);
  assert.doesNotMatch(portalAnswer, /the client handoff link can go in it/);

  assert.match(markup, /<details><summary>[^<]*(?:Stepps|Agentpoint|REA XML)[^<]*<\/summary>/);
  for (const id of ['share-modal-code', 'share-copy-modal', 'share-theme-paper', 'share-copy-dev-brief']) {
    assert.match(markup, new RegExp(`id="${id}"`), 'markup defines #' + id);
  }

  // Interactive flow test with all IDs
  const copied = [];
  const ids = {};
  for (const name of [
    'share-guide', 'share-guide-output', 'share-code', 'share-guide-status',
    'share-open', 'share-preview', 'share-copy-code', 'share-copy-link',
    'share-modal-code', 'share-copy-modal', 'share-theme-paper', 'share-copy-dev-brief',
  ]) {
    const el = {
      id: name, hidden: name === 'share-guide-output', checked: false,
      _text: '', value: '', attributes: {}, children: [], events: {},
      get textContent() { return this._text; },
      set textContent(v) { this.children = []; this._text = String(v); },
      addEventListener(ev, fn) { this.events[ev] = fn; },
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      focus() {}, select() {},
      append(child) { this.children.push(child); },
    };
    ids[name] = el;
  }
  const link = {
    value: 'https://veylet.com/handoff?t=' + TOKEN,
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    focus() {},
  };
  ids['share-guide'].elements = { link };
  const doc = {
    getElementById: id => ids[id],
    createElement: () => {
      const node = { children: [], querySelector: () => node.frame };
      Object.defineProperty(node, 'innerHTML', {
        set(value) { node.html = value; node.frame = { tag: 'iframe', html: value }; },
      });
      return node;
    },
  };
  const window = {};
  const ctx = {
    window,
    document: doc,
    URL,
    navigator: { clipboard: { writeText: async v => copied.push(v) } },
    FormData: class {
      constructor(f) { this.form = f; }
      get(k) { return this.form.elements[k].value; }
    },
  };
  vm.runInNewContext(sharing, ctx);
  vm.runInNewContext(guide, ctx);

  ids['share-guide'].events.submit({ preventDefault() {} });
  assert.equal(ids['share-modal-code'].value, window.VeyletSharing.modalButtonCode(TOKEN));

  ids['share-theme-paper'].checked = true;
  ids['share-theme-paper'].events.change();
  assert.match(ids['share-code'].value, /&theme=paper/);
  assert.match(ids['share-preview'].children[0].html, /&theme=paper/);

  ids['share-theme-paper'].checked = false;
  ids['share-theme-paper'].events.change();
  assert.doesNotMatch(ids['share-code'].value, /theme=paper/);

  ids['share-copy-modal'].events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied[copied.length - 1], ids['share-modal-code'].value);

  ids['share-copy-dev-brief'].events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied[copied.length - 1], window.VeyletSharing.developerBrief(TOKEN));
});
