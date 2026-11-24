/*
 * The launch stage: what the public pages say about getting an account (launch readiness
 * plan §5 in the product repository). The site is at stage 5, app: the app is on the App Store
 * (from 15 November 2026) and rendering still admits new accounts weekly from the waitlist.
 * The earlier stages (test, invitation, waitlist, open) were retired in design spec v2 (P1-WEB-2).
 *
 * Sign-in is never removed: /account signs in existing and invited accounts.
 * The pages carry the stage's words in their markup (tests/launch-stage.test.cjs checks
 * they match), so without JavaScript, or before this runs, a page reads the same.
 */
window.VEYLET_STAGE = 'app';

(function () {
  'use strict';

  var DEFAULT = 'app';
  var WAITLIST = { text: 'Join the waitlist', href: '/waitlist' };
  var APP_STORE = { text: 'Get the app', href: 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913' };

  var STAGES = {
    app: {
      label: 'On the App Store, admitted weekly',
      cta: APP_STORE,
      account: 'Get the app to try the free practice room. Rendering opens to new accounts in weekly groups from the waitlist. Admitted? Sign in with the email you joined with.',
      accountLink: WAITLIST,
    },
  };

  function resolve(value) {
    return Object.prototype.hasOwnProperty.call(STAGES, value) ? value : DEFAULT;
  }

  function each(doc, selector, fn) {
    var found = doc.querySelectorAll(selector);
    for (var i = 0; i < found.length; i++) fn(found[i]);
  }

  /** Writes one stage's words into the page's marked elements; returns the stage used. */
  function apply(doc, value) {
    var stage = resolve(value);
    var words = STAGES[stage];
    if (doc.documentElement) doc.documentElement.setAttribute('data-launch-stage', stage);
    each(doc, '[data-launch-label]', function (el) { el.textContent = words.label; });
    each(doc, '[data-launch-cta]', function (el) {
      var icon = el.querySelector('.icon-arrow');
      el.textContent = words.cta.text;
      if (icon) el.append(' ', icon);
      el.setAttribute('href', words.cta.href);
      el.hidden = false;
    });
    each(doc, '[data-launch-account]', function (el) {
      el.textContent = words.account;
      var link = doc.createElement('a');
      link.setAttribute('href', words.accountLink.href);
      link.textContent = words.accountLink.text;
      el.append(' ', link, '.');
    });
    return stage;
  }

  var DESKTOP_QR_QUERY = '(min-width: 801px) and (hover: hover) and (pointer: fine)';
  var APP_STORE_QR_SIZE = 45;
  var APP_STORE_QR_PATH = 'M4 4h7v1h-7zM12 4h2v1h-2zM15 4h4v1h-4zM20 4h4v1h-4zM26 4h1v1h-1zM28 4h4v1h-4zM34 4h7v1h-7zM4 5h1v1h-1zM10 5h1v1h-1zM13 5h2v1h-2zM16 5h4v1h-4zM24 5h1v1h-1zM26 5h1v1h-1zM29 5h2v1h-2zM34 5h1v1h-1zM40 5h1v1h-1zM4 6h1v1h-1zM6 6h3v1h-3zM10 6h1v1h-1zM14 6h1v1h-1zM16 6h2v1h-2zM21 6h1v1h-1zM23 6h3v1h-3zM27 6h1v1h-1zM31 6h2v1h-2zM34 6h1v1h-1zM36 6h3v1h-3zM40 6h1v1h-1zM4 7h1v1h-1zM6 7h3v1h-3zM10 7h1v1h-1zM12 7h4v1h-4zM17 7h1v1h-1zM19 7h1v1h-1zM22 7h2v1h-2zM26 7h6v1h-6zM34 7h1v1h-1zM36 7h3v1h-3zM40 7h1v1h-1zM4 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM12 8h1v1h-1zM16 8h1v1h-1zM22 8h1v1h-1zM25 8h1v1h-1zM27 8h1v1h-1zM30 8h3v1h-3zM34 8h1v1h-1zM36 8h3v1h-3zM40 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM12 9h3v1h-3zM18 9h1v1h-1zM20 9h1v1h-1zM22 9h2v1h-2zM25 9h2v1h-2zM30 9h1v1h-1zM34 9h1v1h-1zM40 9h1v1h-1zM4 10h7v1h-7zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM28 10h1v1h-1zM30 10h1v1h-1zM32 10h1v1h-1zM34 10h7v1h-7zM12 11h7v1h-7zM20 11h3v1h-3zM26 11h2v1h-2zM29 11h1v1h-1zM31 11h2v1h-2zM4 12h1v1h-1zM8 12h1v1h-1zM10 12h3v1h-3zM14 12h1v1h-1zM19 12h1v1h-1zM22 12h1v1h-1zM26 12h1v1h-1zM28 12h1v1h-1zM30 12h1v1h-1zM32 12h6v1h-6zM40 12h1v1h-1zM4 13h3v1h-3zM8 13h1v1h-1zM11 13h5v1h-5zM18 13h1v1h-1zM20 13h1v1h-1zM23 13h3v1h-3zM30 13h1v1h-1zM33 13h1v1h-1zM36 13h2v1h-2zM39 13h1v1h-1zM4 14h1v1h-1zM7 14h1v1h-1zM10 14h1v1h-1zM12 14h4v1h-4zM17 14h1v1h-1zM20 14h3v1h-3zM24 14h1v1h-1zM30 14h4v1h-4zM35 14h2v1h-2zM38 14h1v1h-1zM8 15h2v1h-2zM11 15h2v1h-2zM14 15h1v1h-1zM18 15h1v1h-1zM21 15h2v1h-2zM25 15h1v1h-1zM28 15h1v1h-1zM31 15h1v1h-1zM35 15h2v1h-2zM38 15h2v1h-2zM8 16h1v1h-1zM10 16h1v1h-1zM12 16h4v1h-4zM17 16h5v1h-5zM23 16h1v1h-1zM25 16h4v1h-4zM32 16h4v1h-4zM37 16h4v1h-4zM5 17h1v1h-1zM8 17h2v1h-2zM11 17h2v1h-2zM16 17h1v1h-1zM19 17h3v1h-3zM27 17h1v1h-1zM30 17h4v1h-4zM36 17h2v1h-2zM5 18h1v1h-1zM8 18h3v1h-3zM14 18h2v1h-2zM17 18h4v1h-4zM22 18h1v1h-1zM24 18h5v1h-5zM31 18h1v1h-1zM35 18h4v1h-4zM4 19h1v1h-1zM6 19h4v1h-4zM11 19h1v1h-1zM13 19h5v1h-5zM19 19h2v1h-2zM24 19h2v1h-2zM28 19h1v1h-1zM30 19h3v1h-3zM35 19h2v1h-2zM38 19h2v1h-2zM4 20h1v1h-1zM6 20h1v1h-1zM9 20h2v1h-2zM15 20h2v1h-2zM18 20h1v1h-1zM20 20h1v1h-1zM23 20h2v1h-2zM27 20h1v1h-1zM33 20h3v1h-3zM37 20h2v1h-2zM40 20h1v1h-1zM5 21h2v1h-2zM9 21h1v1h-1zM14 21h1v1h-1zM16 21h2v1h-2zM22 21h2v1h-2zM26 21h1v1h-1zM28 21h6v1h-6zM36 21h1v1h-1zM39 21h1v1h-1zM6 22h3v1h-3zM10 22h1v1h-1zM14 22h2v1h-2zM18 22h2v1h-2zM21 22h3v1h-3zM25 22h4v1h-4zM30 22h2v1h-2zM33 22h1v1h-1zM37 22h1v1h-1zM5 23h1v1h-1zM7 23h2v1h-2zM11 23h2v1h-2zM16 23h1v1h-1zM18 23h4v1h-4zM23 23h3v1h-3zM27 23h1v1h-1zM30 23h4v1h-4zM35 23h1v1h-1zM38 23h2v1h-2zM4 24h2v1h-2zM7 24h2v1h-2zM10 24h3v1h-3zM14 24h3v1h-3zM18 24h1v1h-1zM20 24h3v1h-3zM24 24h3v1h-3zM28 24h1v1h-1zM30 24h2v1h-2zM33 24h3v1h-3zM37 24h2v1h-2zM7 25h1v1h-1zM9 25h1v1h-1zM12 25h1v1h-1zM14 25h1v1h-1zM16 25h1v1h-1zM18 25h3v1h-3zM22 25h1v1h-1zM25 25h4v1h-4zM30 25h4v1h-4zM35 25h2v1h-2zM39 25h1v1h-1zM5 26h2v1h-2zM8 26h3v1h-3zM12 26h2v1h-2zM15 26h1v1h-1zM18 26h2v1h-2zM21 26h1v1h-1zM27 26h3v1h-3zM31 26h3v1h-3zM35 26h4v1h-4zM5 27h5v1h-5zM11 27h3v1h-3zM16 27h2v1h-2zM19 27h1v1h-1zM21 27h4v1h-4zM26 27h4v1h-4zM33 27h4v1h-4zM38 27h1v1h-1zM40 27h1v1h-1zM8 28h7v1h-7zM16 28h2v1h-2zM19 28h1v1h-1zM22 28h2v1h-2zM26 28h4v1h-4zM31 28h1v1h-1zM33 28h2v1h-2zM37 28h3v1h-3zM4 29h4v1h-4zM9 29h1v1h-1zM12 29h1v1h-1zM14 29h2v1h-2zM17 29h1v1h-1zM20 29h2v1h-2zM23 29h2v1h-2zM31 29h3v1h-3zM36 29h2v1h-2zM9 30h3v1h-3zM14 30h2v1h-2zM18 30h1v1h-1zM20 30h3v1h-3zM24 30h3v1h-3zM29 30h3v1h-3zM33 30h1v1h-1zM35 30h1v1h-1zM37 30h2v1h-2zM6 31h1v1h-1zM9 31h1v1h-1zM11 31h5v1h-5zM17 31h1v1h-1zM21 31h2v1h-2zM25 31h2v1h-2zM28 31h1v1h-1zM33 31h1v1h-1zM35 31h2v1h-2zM38 31h1v1h-1zM4 32h4v1h-4zM9 32h3v1h-3zM13 32h1v1h-1zM16 32h4v1h-4zM21 32h3v1h-3zM25 32h4v1h-4zM31 32h8v1h-8zM12 33h1v1h-1zM14 33h1v1h-1zM19 33h1v1h-1zM21 33h1v1h-1zM26 33h2v1h-2zM30 33h1v1h-1zM32 33h1v1h-1zM36 33h1v1h-1zM4 34h7v1h-7zM12 34h1v1h-1zM16 34h1v1h-1zM18 34h3v1h-3zM22 34h1v1h-1zM24 34h5v1h-5zM32 34h1v1h-1zM34 34h1v1h-1zM36 34h1v1h-1zM4 35h1v1h-1zM10 35h1v1h-1zM14 35h3v1h-3zM18 35h2v1h-2zM23 35h3v1h-3zM28 35h1v1h-1zM31 35h2v1h-2zM36 35h5v1h-5zM4 36h1v1h-1zM6 36h3v1h-3zM10 36h1v1h-1zM12 36h1v1h-1zM15 36h3v1h-3zM20 36h1v1h-1zM24 36h1v1h-1zM27 36h2v1h-2zM32 36h7v1h-7zM40 36h1v1h-1zM4 37h1v1h-1zM6 37h3v1h-3zM10 37h1v1h-1zM14 37h2v1h-2zM22 37h2v1h-2zM26 37h1v1h-1zM28 37h2v1h-2zM31 37h5v1h-5zM38 37h2v1h-2zM4 38h1v1h-1zM6 38h3v1h-3zM10 38h1v1h-1zM16 38h1v1h-1zM19 38h1v1h-1zM23 38h1v1h-1zM25 38h5v1h-5zM31 38h2v1h-2zM34 38h1v1h-1zM38 38h2v1h-2zM4 39h1v1h-1zM10 39h1v1h-1zM13 39h1v1h-1zM15 39h1v1h-1zM18 39h9v1h-9zM30 39h2v1h-2zM33 39h1v1h-1zM36 39h4v1h-4zM4 40h7v1h-7zM12 40h2v1h-2zM15 40h1v1h-1zM17 40h1v1h-1zM21 40h1v1h-1zM24 40h2v1h-2zM28 40h1v1h-1zM33 40h1v1h-1zM35 40h1v1h-1zM38 40h3v1h-3z';
  var mountedDocs = typeof WeakSet === 'function' ? new WeakSet() : null;

  function isDesktopFinePointer() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && Boolean(window.matchMedia(DESKTOP_QR_QUERY).matches);
  }

  function svgEl(doc, tag, attrs) {
    var el = typeof doc.createElementNS === 'function'
      ? doc.createElementNS('http://www.w3.org/2000/svg', tag)
      : doc.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) el.setAttribute(keys[i], String(attrs[keys[i]]));
    }
    return el;
  }

  function buildQrSvg(doc, url) {
    var qr = typeof window !== 'undefined' ? window.VeyletQR : null;
    var size = APP_STORE_QR_SIZE;
    var pathData = APP_STORE_QR_PATH;
    if (qr && typeof qr.matrix === 'function') {
      try {
        var matrix = qr.matrix(url, 'M');
        var quiet = typeof qr.quietZone === 'number' ? qr.quietZone : 4;
        size = matrix.size + quiet * 2;
        var strips = [];
        for (var r = 0; r < matrix.size; r++) {
          var c = 0;
          while (c < matrix.size) {
            if (matrix.modules[r * matrix.size + c] !== 1) { c++; continue; }
            var run = 1;
            while (c + run < matrix.size && matrix.modules[r * matrix.size + c + run] === 1) run++;
            strips.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h' + run + 'v1h-' + run + 'z');
            c += run;
          }
        }
        pathData = strips.join('');
      } catch (e) {
        size = APP_STORE_QR_SIZE;
        pathData = APP_STORE_QR_PATH;
      }
    }
    var svg = svgEl(doc, 'svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 ' + size + ' ' + size,
      'shape-rendering': 'crispEdges',
      role: 'img',
      'aria-label': 'QR code for Veylet on the App Store',
    });
    svg.append(
      svgEl(doc, 'rect', { width: size, height: size, fill: '#ffffff' }),
      svgEl(doc, 'path', { fill: '#10231d', d: pathData })
    );
    return svg;
  }

  function insideQrModal(node) {
    for (var at = node; at; at = at.parentNode || at.parent) {
      if ((at.dataset && at.dataset.appQrModal !== undefined) || (typeof at.getAttribute === 'function' && at.getAttribute('data-app-qr-modal') !== null)) return true;
    }
    return false;
  }

  function findAppStoreLink(node) {
    if (insideQrModal(node)) return null;
    for (var at = node; at; at = at.parentNode || at.parent) {
      if (at.tagName === 'A') {
        var href = typeof at.getAttribute === 'function' ? at.getAttribute('href') : at.href;
        if (typeof href === 'string' && href.indexOf('apps.apple.com/au/app/veylet') !== -1) return at;
      }
    }
    return null;
  }

  function ensureQrVendorLoaded(cb) {
    if (typeof window === 'undefined' || window.VeyletQR || typeof document === 'undefined' || !document.head) return;
    if (document.querySelector && document.querySelector('script[data-veylet-qr-vendor]')) return;
    var s = document.createElement('script');
    s.src = '/vendor/qrcode-1.5.4.min.js?v=5084f09dc9b6baba';
    s.defer = true;
    s.setAttribute('data-veylet-qr-vendor', 'true');
    s.onload = cb;
    document.head.append(s);
  }

  function mountAppQrModal(doc) {
    if (!doc || typeof doc.addEventListener !== 'function') return;
    if (doc.documentElement && doc.documentElement.dataset && doc.documentElement.dataset.appMode === 'true') return;
    if (mountedDocs) {
      if (mountedDocs.has(doc)) return;
      mountedDocs.add(doc);
    }

    var modal = null;
    var codeBox = null;
    var directLink = null;
    var closeBtn = null;
    var lastFocus = null;
    var savedOverflow = '';

    function ensureModal() {
      var existing = typeof doc.querySelector === 'function' ? doc.querySelector('[data-app-qr-modal]') : null;
      if (existing) return existing;
      modal = doc.createElement('div');
      modal.className = 'app-qr-backdrop';
      modal.setAttribute('data-app-qr-modal', 'true');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'app-qr-title');
      modal.hidden = true;

      var dialog = doc.createElement('div');
      dialog.className = 'app-qr-dialog';

      var heading = doc.createElement('h2');
      heading.id = 'app-qr-title';
      heading.className = 'app-qr-title';
      heading.textContent = 'Scan with your iPhone Pro';

      var note = doc.createElement('p');
      note.className = 'app-qr-note';
      note.textContent = 'Point your iPhone camera at this code to open Veylet on the App Store.';

      codeBox = doc.createElement('div');
      codeBox.className = 'app-qr-code';

      var actions = doc.createElement('div');
      actions.className = 'app-qr-actions';

      directLink = doc.createElement('a');
      directLink.className = 'text-link app-qr-direct';
      directLink.setAttribute('href', APP_STORE.href);
      directLink.setAttribute('data-app-qr-direct', 'true');
      directLink.textContent = 'Open App Store in this browser';

      closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'button button-ghost app-qr-close';
      closeBtn.textContent = 'Close';

      actions.append(directLink, closeBtn);
      dialog.append(heading, note, codeBox, actions);
      modal.append(dialog);
      (doc.body || doc.documentElement).append(modal);

      closeBtn.addEventListener('click', closeModal);
      modal.addEventListener('click', function (ev) {
        if (ev && ev.target === modal) closeModal();
      });
      return modal;
    }

    function openModal(link) {
      var rawHref = (typeof link.getAttribute === 'function' ? link.getAttribute('href') : link.href) || APP_STORE.href;
      var href = /^https:\/\/apps\.apple\.com\/au\/app\/veylet/i.test(rawHref) ? rawHref : APP_STORE.href;
      ensureModal();
      lastFocus = doc.activeElement || link;
      directLink.setAttribute('href', href);
      codeBox.replaceChildren(buildQrSvg(doc, href));
      if (href !== APP_STORE.href && (!window.VeyletQR || !window.VeyletQR.matrix)) {
        ensureQrVendorLoaded(function () {
          if (modal && !modal.hidden) codeBox.replaceChildren(buildQrSvg(doc, href));
        });
      }
      modal.hidden = false;
      modal.removeAttribute('aria-hidden');
      if (doc.body && doc.body.style) {
        savedOverflow = doc.body.style.overflow || '';
        doc.body.style.overflow = 'hidden';
      }
      if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
    }

    function closeModal() {
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      if (doc.body && doc.body.style) doc.body.style.overflow = savedOverflow;
      var target = lastFocus;
      lastFocus = null;
      if (target && typeof target.focus === 'function') target.focus();
    }

    doc.addEventListener('click', function (event) {
      if (!event || event.defaultPrevented) return;
      if ((event.button !== undefined && event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!isDesktopFinePointer()) return;
      var link = findAppStoreLink(event.target);
      if (!link || link.hidden || link.getAttribute('aria-disabled') === 'true') return;
      event.preventDefault();
      openModal(link);
    });

    doc.addEventListener('keydown', function (event) {
      if (!modal || modal.hidden || !event) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab' && directLink && closeBtn) {
        if (!modal.contains(doc.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? closeBtn : directLink).focus();
        } else if (event.shiftKey && doc.activeElement === directLink) {
          event.preventDefault();
          closeBtn.focus();
        } else if (!event.shiftKey && doc.activeElement === closeBtn) {
          event.preventDefault();
          directLink.focus();
        }
      }
    });
  }

  var api = { STAGES: STAGES, DEFAULT: DEFAULT, resolve: resolve, apply: apply, mountAppQrModal: mountAppQrModal };
  window.VeyletStage = api;
  if (typeof document === 'undefined' || window.VEYLET_STAGE_MANUAL) return;
  var run = function () { apply(document, window.VEYLET_STAGE); mountAppQrModal(document); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
