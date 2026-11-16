'use strict';
/* Optional first-party stop engagement. Off unless explicitly enabled by deployment config.
 * A public share lookup supplies the immutable tour UUID; owner/private previews never mount it. */
(function (root) {
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const STOP = /^s\d{1,3}$/;
  function create(options = {}) {
    const win = options.window || root, doc = options.document || win.document;
    const cfg = options.config || {}, stage = options.stage;
    const enabled = options.enabled === true && options.publicShare === true && UUID.test(options.tourID || '') && typeof options.token === 'string' && options.token.length >= 16;
    const clock = options.clock || (() => win.performance.now());
    let uuid = options.visitID || (enabled ? win.crypto?.randomUUID?.() : null);
    const transport = options.transport || (payload => win.fetch(String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/record_walkthrough_visit', {
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true,
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_token: options.token, p_payload: payload }),
    }).then(async response => { if (!response.ok) throw new Error('request failed'); return response.json(); }));
    let stopped = !enabled || !UUID.test(uuid || '') || (!options.transport && (!cfg.url || !cfg.anonKey));
    let visible = !doc?.hidden && doc?.visibilityState !== 'hidden', candidate = null;
    let active = null, finalStop = null, stamp = clock(), lastInput = stamp, sequence = 0, inFlight = null, latest = null, retryTimer = null, periodic = null, dirty = false, total = 0, completed = false, generation = 0;
    const stops = new Map(), listeners = [];
    function tick() {
      const now = clock(), elapsed = Math.max(0, Math.min(20, (Math.min(now, lastInput + 60000) - stamp) / 1000)); stamp = now;
      if (!stopped && active && visible && elapsed > 0 && total < 3600) {
        const delta = Math.min(elapsed, 3600 - total); stops.set(active, (stops.get(active) || 0) + delta); total += delta; dirty = true;
      }
    }
    function stop(id) {
      if (stopped) return false;
      tick();
      if (id === null) { candidate = null; active = null; return true; }
      if (!STOP.test(id || '') || (!stops.has(id) && stops.size >= 128)) return false;
      candidate = id; if (!visible) { active = null; return true; }
      active = id; finalStop = id; if (!stops.has(id)) stops.set(id, 0); lastInput = clock(); dirty = true; return true;
    }
    function snapshot(complete) {
      return { schema_version: 1, tour_id: options.tourID.toLowerCase(), visit_id: uuid.toLowerCase(), sequence: ++sequence,
        complete, stops: [...stops].map(([id, seconds]) => ({ id, seconds: Math.floor(seconds * 1000) / 1000 })), final_stop_id: complete ? finalStop : null };
    }
    async function send(item) {
      if (stopped || inFlight) return;
      inFlight = item; const owner = generation;
      let timeout;
      try {
        const answer = await Promise.race([transport(item.payload), new Promise((_, reject) => { timeout = win.setTimeout(() => reject(new Error('timeout')), 10000); })]);
        if (owner !== generation) return;
        if (answer?.status === 'disabled' || answer?.status === 'unavailable' || answer?.status === 'rate_limited') { dispose(); return; }
        if (answer?.status !== 'accepted' || !Number.isInteger(answer.sequence) || answer.sequence < item.payload.sequence) throw new Error('unacknowledged');
        if (latest?.payload.sequence === item.payload.sequence) latest = null;
      } catch {
        if (owner === generation && !stopped && latest?.payload.sequence === item.payload.sequence && item.attempt < 2) {
          item.attempt++; retryTimer = win.setTimeout(() => { retryTimer = null; void send(item); }, item.attempt * 1000);
        }
      } finally {
        win.clearTimeout(timeout);
        if (owner !== generation) return;
        inFlight = null;
        if (!stopped && latest && latest.payload.sequence !== item.payload.sequence) { if (retryTimer) win.clearTimeout(retryTimer); retryTimer = null; void send(latest); }
      }
    }
    function flush(complete = false) {
      if (stopped || completed || sequence >= 512) return null;
      tick(); if (!stops.size || (!dirty && !complete)) return null;
      const payload = snapshot(complete); dirty = false; completed = complete; latest = { payload, attempt: 0 };
      // pagehide may be the final JS turn: dispatch its keepalive immediately even if an earlier cumulative read is pending.
      if (complete && inFlight) { latest = null; void Promise.resolve(transport(payload)).catch(() => {}); } else void send(latest);
      return payload;
    }
    function listen(target, name, fn) { if (target?.addEventListener) { target.addEventListener(name, fn); listeners.push([target, name, fn]); } }
    function dispose() {
      stopped = true; active = null; latest = null;
      if (periodic) win.clearInterval(periodic); if (retryTimer) win.clearTimeout(retryTimer);
      periodic = null; retryTimer = null;
      for (const [target, name, fn] of listeners) target.removeEventListener?.(name, fn); listeners.length = 0;
    }
    if (!stopped) {
      // Same-document player events only, scoped to this resolved public viewer's stage.
      // Never accept cross-frame postMessage data, arbitrary room names or coordinates.
      listen(stage, 'veylet:stop', event => { if (stage.contains(event.target) && event.detail?.source === 'veylet-v2') stop(event.detail.stop_id); });
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) listen(stage, name, () => { tick(); lastInput = clock(); });
      listen(doc, 'visibilitychange', () => { tick(); visible = !doc.hidden && doc.visibilityState !== 'hidden'; if (!visible) { flush(false); active = null; } else { stamp = clock(); lastInput = stamp; if (candidate) stop(candidate); } });
      listen(win, 'pagehide', () => { flush(true); active = null; });
      listen(win, 'pageshow', () => {
        if (completed) { const next = win.crypto?.randomUUID?.(); if (!UUID.test(next || '')) { dispose(); return; } generation++; uuid = next; completed = false; sequence = 0; stops.clear(); total = 0; dirty = false; latest = null; inFlight = null; if (retryTimer) win.clearTimeout(retryTimer); retryTimer = null; }
        visible = !doc.hidden && doc.visibilityState !== 'hidden'; stamp = clock(); lastInput = stamp; if (candidate) stop(candidate); });
      periodic = win.setInterval(() => flush(false), 15000);
    }
    return { stop, flush, dispose, get enabled() { return !stopped; } };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VeyletEngagement = api;
})(typeof window === 'undefined' ? globalThis : window);
