/*
 * /status (public) and /app/status (the app's copy): whether Veylet is rendering, whether new
 * accounts are open, and how soon a render usually starts. One anonymous read,
 * rpc/get_public_service_status (the sibling repository's release-2 draft), answers
 *   { admissions_open bool, typical_start_minutes int|null, rendering_paused bool,
 *     updated_at timestamptz, message text|null }
 * as a bare object or a one-element array.
 *
 * - A backend without the function (404 PGRST202, or "Could not find the function") shows the
 *   unavailable sentence and the page stops asking.
 * - A malformed answer or a failed read before any good answer shows the same sentence and keeps
 *   trying; after a good answer it keeps the last good values.
 * - It reads again every 60 s while the page is visible, not while it is hidden, and at once on
 *   coming back when 60 s or more have passed.
 * - The server's message is written as text, never markup, and capped in length.
 * It sends the public key and an empty body, nothing else: no cookie, no referrer.
 */
(function () {
  'use strict';

  var FUNCTION_NAME = 'get_public_service_status';
  var POLL_MS = 60000;
  var TIMEOUT_MS = 15000;
  var MESSAGE_MAX = 280;
  var ZONE = 'Australia/Brisbane';

  var COPY = {
    renderingNormal: 'Rendering: normal',
    renderingPaused: 'Rendering: paused',
    admissionsOpen: 'New accounts: open',
    admissionsWeekly: 'New accounts: admitted in weekly groups',
    unavailable: 'Status isn’t available right now. Email support if something looks wrong.',
  };

  function startLine(minutes) {
    return 'Renders usually start within ' + minutes + (minutes === 1 ? ' minute' : ' minutes');
  }

  /** The operator's note: plain text, whitespace folded, at most MESSAGE_MAX characters. */
  function capMessage(value) {
    if (typeof value !== 'string') return '';
    var folded = value.replace(/\s+/g, ' ').trim();
    var chars = Array.from(folded);
    if (chars.length <= MESSAGE_MAX) return folded;
    return chars.slice(0, MESSAGE_MAX - 1).join('').replace(/\s+$/, '') + '…';
  }

  /** The answer as the page uses it, or null when it is not the documented shape. */
  function parse(answer) {
    var row = Array.isArray(answer) ? (answer.length === 1 ? answer[0] : null) : answer;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (typeof row.admissions_open !== 'boolean' || typeof row.rendering_paused !== 'boolean') return null;
    if (typeof row.updated_at !== 'string' || !row.updated_at) return null;
    var updated = new Date(row.updated_at).getTime();
    if (Number.isNaN(updated)) return null;
    var minutes = row.typical_start_minutes;
    return {
      admissionsOpen: row.admissions_open,
      renderingPaused: row.rendering_paused,
      startMinutes: typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0 ? minutes : null,
      updatedAt: updated,
      message: capMessage(row.message),
    };
  }

  /** "Last updated 11:40 am today (Brisbane time)" or "Last updated 9:30 am Mon, 28 Sept (Brisbane time)", as account.js writes moments. */
  function formatUpdated(updatedAt, now) {
    var when = new Date(updatedAt);
    if (Number.isNaN(when.getTime())) return '';
    try {
      var dayOf = function (moment) {
        return new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
      };
      var time = when.toLocaleTimeString('en-AU', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
      var date = when.toLocaleDateString('en-AU', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' });
      var day = dayOf(when) === dayOf(new Date(now)) ? 'today' : date;
      return 'Last updated ' + time + ' ' + day + ' (Brisbane time)';
    } catch (unsupported) {
      return '';
    }
  }

  function missingFunction(answer) {
    return Boolean(answer) && (String(answer.code || '') === 'PGRST202'
      || /could not find the function/i.test(String(answer.message || '')));
  }

  /** One read: { kind: 'ok', status } | { kind: 'missing' } | { kind: 'malformed' } | { kind: 'error' }. */
  async function ask(win, config) {
    var controller = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    var timer = controller ? win.setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    try {
      var init = {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: 'Bearer ' + config.anonKey,
          'Content-Type': 'application/json',
        },
        body: '{}',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      };
      if (controller) init.signal = controller.signal;
      var response = await win.fetch(config.url + '/rest/v1/rpc/' + FUNCTION_NAME, init);
      var answer = null;
      try { answer = await response.json(); } catch (unreadable) { answer = null; }
      if (!response.ok) return { kind: missingFunction(answer) ? 'missing' : 'error' };
      var status = parse(answer);
      return status ? { kind: 'ok', status: status } : { kind: 'malformed' };
    } catch (failure) {
      return { kind: 'error' };
    } finally {
      if (timer !== null) win.clearTimeout(timer);
    }
  }

  /** Writes text only when it changed, so the polite live region speaks only about a change. */
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setHidden(node, hidden) {
    if (node && node.hidden !== hidden) node.hidden = hidden;
  }
  function setTone(node, tone) {
    if (node && node.getAttribute('data-tone') !== tone) node.setAttribute('data-tone', tone);
  }

  /** view: { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'status', status }. Returns the page state. */
  function render(doc, view, now) {
    var get = function (id) { return doc.getElementById(id); };
    var status = view.kind === 'status' ? view.status : null;
    var state = status ? (status.renderingPaused ? 'paused' : 'normal') : view.kind;
    var board = get('status-board');
    if (board && board.getAttribute('data-state') !== state) board.setAttribute('data-state', state);
    setHidden(board, false);
    setHidden(get('status-loading'), view.kind !== 'loading');
    setHidden(get('status-unavailable'), view.kind !== 'unavailable');
    setHidden(get('status-current'), !status);
    var message = get('status-message');
    var updated = get('status-updated');
    var start = get('status-start');
    if (!status) {
      setHidden(message, true);
      setHidden(updated, true);
      return state;
    }
    var rendering = get('status-rendering');
    setText(rendering, status.renderingPaused ? COPY.renderingPaused : COPY.renderingNormal);
    setTone(rendering, status.renderingPaused ? 'held' : 'good');
    var admissions = get('status-admissions');
    setText(admissions, status.admissionsOpen ? COPY.admissionsOpen : COPY.admissionsWeekly);
    setTone(admissions, status.admissionsOpen ? 'good' : 'held');
    if (status.startMinutes === null) {
      setHidden(start, true);
    } else {
      setText(start, startLine(status.startMinutes));
      setHidden(start, false);
    }
    if (status.message) {
      setText(message, status.message);
      setHidden(message, false);
    } else {
      setHidden(message, true);
    }
    var when = formatUpdated(status.updatedAt, now);
    setText(updated, when);
    setHidden(updated, !when);
    return state;
  }

  /** Starts the page. options.now replaces the clock (tests). Returns a handle for inspection. */
  function start(win, options) {
    var doc = win.document;
    var now = (options && options.now) || function () { return Date.now(); };
    var state = { good: null, stopped: false, inFlight: false, lastAttempt: null, timer: null, shown: 'loading', reads: 0 };
    var config = win.VEYLET_SUPABASE;

    function show(view) { state.shown = render(doc, view, now()); }
    function clearTimer() {
      if (state.timer !== null) { win.clearTimeout(state.timer); state.timer = null; }
    }
    function visible() { return doc.visibilityState !== 'hidden'; }
    function schedule() {
      clearTimer();
      if (state.stopped || !visible()) return;
      var wait = Math.max(0, POLL_MS - (now() - state.lastAttempt));
      state.timer = win.setTimeout(function () { state.timer = null; refresh(); }, wait);
    }
    async function refresh() {
      if (state.stopped || state.inFlight) return state.shown;
      clearTimer();
      state.inFlight = true;
      state.lastAttempt = now();
      state.reads += 1;
      var result = await ask(win, config);
      state.inFlight = false;
      if (result.kind === 'missing') {
        state.stopped = true;
        state.good = null;
        show({ kind: 'unavailable' });
        return state.shown;
      }
      if (result.kind === 'ok') state.good = result.status;
      // A failed or malformed read after a good one keeps the last good values.
      show(state.good ? { kind: 'status', status: state.good } : { kind: 'unavailable' });
      schedule();
      return state.shown;
    }

    if (!config || !config.url || !config.anonKey || typeof win.fetch !== 'function') {
      state.stopped = true;
      show({ kind: 'unavailable' });
      return { state: state, refresh: refresh, ready: Promise.resolve(state.shown) };
    }
    show({ kind: 'loading' });
    doc.addEventListener('visibilitychange', function () {
      if (state.stopped) return;
      if (!visible()) { clearTimer(); return; }
      if (state.inFlight) return;
      if (state.lastAttempt === null || now() - state.lastAttempt >= POLL_MS) refresh();
      else schedule();
    });
    return { state: state, refresh: refresh, ready: refresh() };
  }

  var api = {
    FUNCTION_NAME: FUNCTION_NAME, POLL_MS: POLL_MS, MESSAGE_MAX: MESSAGE_MAX, COPY: COPY,
    parse: parse, capMessage: capMessage, startLine: startLine, formatUpdated: formatUpdated,
    missingFunction: missingFunction, ask: ask, render: render, start: start,
  };
  if (typeof window !== 'undefined') {
    window.VeyletStatus = api;
    if (!window.VEYLET_STATUS_MANUAL) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { start(window); });
      } else {
        start(window);
      }
    }
  }
})();
