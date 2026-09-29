/*
 * First touch: a visit from a campaign link keeps that link's utm labels, whether the click came from
 * Meta or Google, and the landing page in this tab's session storage, for a later waitlist sign-up
 * (/waitlist/waitlist.js). No cookie, no network; fbclid/gclid values are never kept. First link wins.
 */
(function () {
  'use strict';
  var KEY = 'veylet.firstTouch';
  var LABELS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  var LABEL = /^[A-Za-z0-9._~+:-]{1,100}$/;
  var LANDING = /^\/(?!\/)[A-Za-z0-9\/_.-]{0,199}$/;
  function keep(pattern, value) { return typeof value === 'string' && pattern.test(value) ? value : ''; }

  /** Only the allowed shapes survive, whatever was stored or typed into a link. */
  function clean(raw) {
    var touch = {};
    LABELS.forEach(function (name) { touch[name] = keep(LABEL, raw[name]); });
    touch.click = raw.click === 'meta' || raw.click === 'google' ? raw.click : '';
    touch.landing = keep(LANDING, raw.landing);
    return touch;
  }
  /** The clean campaign labels of a query string, or null when none survive. */
  function fromSearch(search, landing) {
    var query = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      try {
        var name = decodeURIComponent((at === -1 ? pair : pair.slice(0, at)).replace(/\+/g, ' '));
        var value = at === -1 ? '' : decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
        if (!Object.prototype.hasOwnProperty.call(query, name)) query[name] = value;
      } catch (malformed) { /* an undecodable pair is ignored */ }
    });
    var raw = { click: query.fbclid ? 'meta' : query.gclid ? 'google' : '', landing: landing };
    LABELS.forEach(function (name) { raw[name] = query[name]; });
    var touch = clean(raw);
    // Only a surviving label or click source makes a touch; a landing path alone never does.
    return touch.click || LABELS.some(function (name) { return touch[name]; }) ? touch : null;
  }
  /** The stored first touch of this visit, or null. */
  function read(win) {
    try {
      var stored = JSON.parse(win.sessionStorage.getItem(KEY) || 'null');
      return stored && typeof stored === 'object' ? clean(stored) : null;
    } catch (unavailable) { return null; }
  }
  /** Keeps this page's campaign labels unless the visit already has a first touch. */
  function capture(win) {
    try {
      var touch = fromSearch(win.location.search, win.location.pathname);
      if (!touch || win.sessionStorage.getItem(KEY) !== null) return null;
      win.sessionStorage.setItem(KEY, JSON.stringify(touch));
      return touch;
    } catch (unavailable) { return null; }
  }
  if (typeof window !== 'undefined') {
    window.VeyletFirstTouch = { KEY: KEY, read: read, capture: capture };
    capture(window);
  }
})();
