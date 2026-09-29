/*
 * Cookieless page counts (29 Sep 2026, owner): Vercel Web Analytics counts page views on veylet.com's
 * public pages. No cookie, no localStorage, no custom events. Only on veylet.com and www.veylet.com
 * (never previews or local builds), never in a tab opened with ?analytics=off (owner QA), and every
 * URL is sent without its query string or fragment. Google Analytics stays consent-gated (analytics.js).
 */
(function () {
  'use strict';
  var OFF = 'veylet.analyticsOff';
  var SRC = '/_vercel/insights/script.js';
  /** The page address without query string or fragment; null drops the event. */
  function strip(event) {
    try {
      var url = new URL(event.url);
      event.url = url.origin + url.pathname;
      return event;
    } catch (unreadable) { return null; }
  }
  /** Starts counting on this page; returns true when the counter script was added. */
  function start(win, doc) {
    var host = win.location.hostname;
    if (host !== 'veylet.com' && host !== 'www.veylet.com') return false;
    var off = /(?:^|[?&])analytics=off(?:&|$)/.test(win.location.search || '');
    try {
      // The QA switch holds for the rest of this tab, so later clean links stay uncounted too.
      if (off) win.sessionStorage.setItem(OFF, '1');
      else off = win.sessionStorage.getItem(OFF) === '1';
    } catch (unavailable) { /* blocked storage: only this page's own switch applies */ }
    if (off) return false;
    win.va = win.va || function () { (win.vaq = win.vaq || []).push(arguments); };
    win.va('beforeSend', strip);
    var script = doc.createElement('script');
    script.src = SRC;
    script.defer = true;
    doc.head.appendChild(script);
    return true;
  }
  if (typeof window !== 'undefined' && typeof document !== 'undefined') start(window, document);
})();
