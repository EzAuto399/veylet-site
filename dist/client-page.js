'use strict';
/*
 * The client's page (/handoff) and the listing embed: the agent who shared the
 * walkthrough, Share, and the words a first-time viewer needs (journey D4,
 * docs/ux/capture-to-client-journey-20260925.md in the product repository).
 *
 * The agent's contact comes from lookup_tour_share_contact(p_token), which
 * answers only for a live link whose workspace chose to show it. Any error,
 * including a backend that does not have the function yet (PGRST202), means
 * "no agent card" and nothing else changes. Everything is built with
 * textContent and setAttribute; nothing from the server is parsed as markup.
 */
(() => {
  const CONTACT_FUNCTION = 'lookup_tour_share_contact';
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function clean(value, max) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length <= max ? text : '';
  }

  /** Digits only, keeping one leading +: "+61 400 000 000" dials "+61400000000". */
  function dialable(value) {
    const raw = clean(value, 32);
    const digits = raw.replace(/\D/g, '');
    return digits ? (raw.startsWith('+') ? '+' : '') + digits : '';
  }

  function telHref(phone) {
    const number = dialable(phone);
    return number ? 'tel:' + number : '';
  }

  /** `where` (optional): the stop the visitor is on, so the agent knows which room they mean. */
  function mailtoHref(email, title, where) {
    const address = clean(email, 254);
    if (!EMAIL.test(address)) return '';
    const at = address.lastIndexOf('@');
    const encoded = encodeURIComponent(address.slice(0, at)) + '@' + encodeURIComponent(address.slice(at + 1));
    const subject = '?subject=' + encodeURIComponent('Walkthrough: ' + (title || 'Shared space'));
    if (!where || !where.url) return 'mailto:' + encoded + subject;
    const body = 'I’m at stop ' + where.number + ' of ' + where.count + ' in the walkthrough.\n' + where.url + '\n\n';
    return 'mailto:' + encoded + subject + '&body=' + encodeURIComponent(body);
  }

  // Where the visitor is in the walkthrough, once the player has said so (visitLink): the page's
  // address, Share and the Email to the agent all point at that stop. One page, one visit.
  let place = null;
  function stopFromHash(hash) {
    const match = /^#stop=(\d{1,2})$/.exec(hash || '');
    const number = match ? Number(match[1]) : 0;
    return number >= 1 ? number : null;
  }

  /** A validated HTTPS booking or calendar URL (up to 240 chars), or empty string. */
  function bookingHref(url) {
    const raw = clean(url, 240);
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' && parsed.hostname ? parsed.href : '';
    } catch {
      return '';
    }
  }

  /** Pre-filled viewing slot request email when the agent has not configured a calendar URL. */
  function viewingRequestHref(email, title, agentName) {
    const address = clean(email, 254);
    if (!EMAIL.test(address)) return '';
    const at = address.lastIndexOf('@');
    const encoded = encodeURIComponent(address.slice(0, at)) + '@' + encodeURIComponent(address.slice(at + 1));
    const space = title || 'Shared space';
    const greeting = agentName ? 'Hi ' + agentName + ',' : 'Hello,';
    const subject = 'Book a viewing: ' + space;
    const body = greeting + '\n\nI just explored the 3D walkthrough of ' + space + ' and would like to arrange an inspection.\n\nPreferred day / time:\nMy phone number:\n';
    return 'mailto:' + encoded + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /** The one row the server answers, or null unless it names someone reachable. */
  function contactFrom(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    const name = clean(row.display_name, 80);
    const phone = dialable(row.phone) ? clean(row.phone, 32) : '';
    const email = EMAIL.test(clean(row.email, 254)) ? clean(row.email, 254) : '';
    if (!name || (!phone && !email)) return null;
    const bookingUrl = bookingHref(row.booking_url);
    const allowViewingRequest = row.allow_viewing_request === true;
    return {
      name,
      agency: clean(row.agency, 80),
      phone,
      email,
      ...(bookingUrl ? { bookingUrl } : {}),
      ...(allowViewingRequest ? { allowViewingRequest: true } : {}),
    };
  }

  function withTimeout(promise, ms) {
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /** Resolves to a contact or null; never rejects, never shows an error. */
  async function lookupContact(client, token, options = {}) {
    if (!client || typeof client.rpc !== 'function' || typeof token !== 'string' || token.length < 16) return null;
    try {
      const answer = await withTimeout(Promise.resolve(client.rpc(CONTACT_FUNCTION, { p_token: token })), options.timeoutMs || 8000);
      // PGRST202 ("Could not find the function"): the backend has not taken the
      // migration yet. Every other error reads the same: no card.
      if (!answer || answer.timedOut || answer.error) return null;
      return contactFrom(answer.data);
    } catch {
      return null;
    }
  }

  /*
   * The embed shows its invitation without loading the account SDK, so the
   * contact is read with one PostgREST call and answers as client.rpc does.
   */
  function restClient(config, fetchImpl) {
    const cfg = config || {};
    const request = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!cfg.url || !cfg.anonKey || !request) return null;
    const base = String(cfg.url).replace(/\/+$/, '');
    return {
      async rpc(name, args) {
        try {
          const response = await request(base + '/rest/v1/rpc/' + encodeURIComponent(name), {
            method: 'POST',
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(args || {}),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
          });
          let body = null;
          try { body = await response.json(); } catch { body = null; }
          if (!response.ok) {
            return { data: null, error: { code: (body && body.code) || String(response.status), message: (body && body.message) || 'HTTP ' + response.status } };
          }
          return { data: body, error: null };
        } catch (error) {
          return { data: null, error: { code: 'network', message: String((error && error.message) || error) } };
        }
      },
    };
  }

  /*
   * Views, for the agent's desk (record_tour_view, launch plan C5 and section 5
   * "Day-one analytics"). First-party only: one anonymous RPC to the account
   * service with the link's token, what happened (open, first_frame, call_tap,
   * email_tap, share_tap, dwell), the channel the link was handed out on
   * (?src=) and, for a framed walkthrough, the hostname of the site framing it.
   * Nothing else about the visitor, no cookie, no third party. Every call is
   * fire-and-forget and never holds the page up; the dwell sent on pagehide uses
   * keepalive, which survives the page as sendBeacon would and can carry the
   * service's key headers, which sendBeacon cannot. A backend without the
   * function (PGRST202, or a 404) turns the beacon off for the rest of the visit.
   *
   * Walkthrough insights (10 Nov 2026): which stops were stood on and, roughly,
   * which way people looked there. Each page load makes one random "visit"
   * token (crypto.getRandomValues, 32 hex), held in memory only: no cookie, no
   * local or session storage, gone with the page, so two loads by one person
   * are two visits and nothing ties a visit to anyone. Details:
   *   open         {visit}
   *   first_frame  <seconds>          a bare number, unchanged, with no visit
   *   room         {visit, room}
   *   dwell        {visit, seconds}
   *   stop         {visit, stop: 0..63, room: text up to 60 chars | null}   on arrival at a stop
   *   (stop and look are kept by the database only in exactly these keys, as whole numbers.)
   *   look         {visit, stop, ms: 1..600000, bins: {"<yaw>_<pitch>": ms}} once per stop visit,
   *                sent on arrival at a different stop, or on pagehide (keepalive)
   * Look bins. The player's view() gives degrees in the tour package's own frame
   * (right-handed, Y up): yaw 0 looks along -Z, and yaw grows turning LEFT
   * (anticlockwise seen from above), so 90 looks along -X, 180 along +Z, 270
   * along +X. Yaw bin k (0..11) is 30k <= yaw < 30k + 30. Pitch bin 0 is down
   * (below -15 degrees), 1 is level (-15..+15 inclusive), 2 is up (above +15).
   * At most 36 keys; a bin with no time is left out; the bins add up to ms.
   * The view is read about twice a second, only while the page is visible and
   * the player has drawn a 3D frame; a hidden page is not sampled at all.
   */
  const VIEW_FUNCTION = 'record_tour_view';
  const VIEW_KINDS = ['open', 'first_frame', 'room', 'call_tap', 'email_tap', 'share_tap', 'dwell', 'stop', 'look'];
  // The two kinds an older backend refuses: the first refusal stops them for the visit, and the rest carry on.
  const INSIGHT_KINDS = ['stop', 'look'];
  const LOOK_SAMPLE_MS = 500;
  const LOOK_CAP_MS = 600000;
  const STOP_LIMIT = 63;
  // Per visit: at most this many stop events and this many look events, however long someone wanders.
  const INSIGHT_EVENT_CAP = 32;
  const ROOM_NAME_MAX = 60;

  /** A random 32-hex visit token for this page load, or null where the browser has no CSPRNG (never Math.random). */
  function visitToken(source) {
    try {
      const random = source || (typeof crypto !== 'undefined' ? crypto : null);
      if (!random || typeof random.getRandomValues !== 'function') return null;
      const bytes = random.getRandomValues(new Uint8Array(16));
      let hex = '';
      for (let i = 0; i < 16; i++) hex += (bytes[i] & 255).toString(16).padStart(2, '0');
      return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
    } catch {
      return null;
    }
  }

  /** "<yaw 0..11>_<pitch 0..2>" for a look direction in degrees (see the note above), or null for anything unusable. */
  function lookBin(yaw, pitch) {
    if (typeof yaw !== 'number' || typeof pitch !== 'number' || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
    const turn = ((yaw % 360) + 360) % 360;
    const sector = Math.min(11, Math.floor(turn / 30));
    return sector + '_' + (pitch < -15 ? 0 : pitch > 15 ? 2 : 1);
  }
  /*
   * Viewer insights (data events, 11 Nov 2026): the one dwell a visit already sends may carry
   * the player's 'veylet:visit' summary, {seconds, stops, last_stop, furthest_stop, total_stops,
   * rooms: {<room type>: seconds}}. Off until the privacy notice covers it: while this is false
   * the summary is never listened for, so the dwell stays {visit, seconds}. A tab opened with
   * ?analytics=off (owner QA; the page passes analyticsOff) never carries it either. Room types
   * only, from the app's fixed list; a room's own name is never part of it.
   */
  const VIEWER_INSIGHTS = false;
  const ROOM_TYPES = ['Living', 'Kitchen', 'Bedroom', 'Bathroom', 'Hall', 'Stairs', 'Landing', 'Office', 'Reception',
    'Meeting room', 'Retail floor', 'Studio', 'Garage', 'Outdoor area', 'Other'];
  const VIEW_ONCE = ['open', 'first_frame', 'dwell'];
  const VIEW_SOURCES = ['link', 'qr', 'embed', 'video', 'portal', 'unknown'];
  const DWELL_CAP_SECONDS = 3600;
  // The player marks its first 3D frame with performance.mark('veylet:first-3d').
  const FIRST_FRAME_MARK = 'veylet:first-3d';

  /** The link's channel (?src=), or the page's own default for links made before tags. */
  function channelFrom(search, fallback) {
    let value = '';
    try { value = String(new URLSearchParams(search || '').get('src') || '').toLowerCase(); } catch { value = ''; }
    if (VIEW_SOURCES.includes(value)) return value;
    return VIEW_SOURCES.includes(fallback) ? fallback : 'unknown';
  }

  /** A referrer's hostname only; never its path or query. */
  function referrerHost(referrer) {
    try {
      const url = new URL(String(referrer || ''));
      return /^https?:$/.test(url.protocol) && url.hostname ? url.hostname.toLowerCase().slice(0, 253) : null;
    } catch {
      return null;
    }
  }

  function viewBeacon(options = {}) {
    const cfg = options.config || {};
    const request = options.fetch || (typeof fetch === 'function' ? fetch : null);
    const token = options.token;
    const clock = typeof options.now === 'function' ? options.now : () => Date.now();
    const src = VIEW_SOURCES.includes(options.src) ? options.src : 'unknown';
    const host = typeof options.host === 'string' && options.host ? options.host : null;
    let off = !cfg.url || !cfg.anonKey || !request || typeof token !== 'string' || token.length < 16;
    const endpoint = off ? '' : String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + VIEW_FUNCTION;
    const said = new Set();
    const roomsSeen = new Set();
    let openedAt = null, openedMark = null;
    const visit = visitToken(options.crypto);
    let insightsOff = !visit;
    let standing = null, lastSample = null, sampler = null, stopsSent = 0, looksSent = 0;
    /** The visit token beside whatever else the event says; without a token, just the rest (or nothing). */
    const withVisit = fields => (visit ? { visit, ...fields } : fields && Object.keys(fields).length ? fields : null);

    function send(kind, detail, keepalive) {
      if (off || !VIEW_KINDS.includes(kind)) return false;
      const insight = INSIGHT_KINDS.includes(kind);
      if (insight && insightsOff) return false;
      if (VIEW_ONCE.includes(kind)) { if (said.has(kind)) return false; said.add(kind); }
      try {
        const pending = request(endpoint, {
          method: 'POST',
          keepalive: kind === 'dwell' || keepalive === true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_token: token, p_kind: kind, p_src: src, p_host: host, p_detail: detail === undefined ? null : detail }),
        });
        Promise.resolve(pending).then(async response => {
          if (!response || response.ok) return;
          let body = null;
          try { body = await response.json(); } catch { body = null; }
          if (response.status === 404 || (body && body.code === 'PGRST202')) off = true;
          // A backend from before stops and looks refuses the kind: say no more of them this visit.
          else if (insight) insightsOff = true;
        }).catch(() => {});
      } catch { /* a view count is never in the way */ }
      return true;
    }

    function roomVisited(roomName) {
      const name = clean(roomName, 80);
      if (!name || roomsSeen.has(name) || roomsSeen.size >= 24) return false;
      roomsSeen.add(name);
      return send('room', withVisit({ room: name }));
    }

    const validStop = stop => Number.isInteger(stop) && stop >= 0 && stop <= STOP_LIMIT;

    /** The one look for the stop being left: where the time there went, by direction. */
    function flushLook(leaving) {
      const was = standing;
      if (!was || was.ms <= 0) return false;
      was.ms = 0;
      const bins = was.bins;
      was.bins = {};
      if (looksSent >= INSIGHT_EVENT_CAP) return false;
      const total = Object.values(bins).reduce((sum, ms) => sum + ms, 0);
      if (!send('look', { visit, stop: was.stop, ms: total, bins }, leaving === true)) return false;
      looksSent++;
      return true;
    }

    /** Arrival at a stop (0-based). Arriving again where you already stand is not a new arrival. */
    function stopArrived(stop, roomName) {
      if (insightsOff || off || !validStop(stop)) return false;
      if (standing && standing.stop === stop) return false;
      flushLook(false);
      standing = { stop, ms: 0, bins: {} };
      // Time counts from the arrival while the page is being read; otherwise from the next reading.
      lastSample = sampler !== null ? clock() : null;
      if (stopsSent >= INSIGHT_EVENT_CAP) return false;
      const room = typeof roomName === 'string' ? roomName.replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX) : '';
      if (!send('stop', { visit, stop, room: room || null })) return false;
      stopsSent++;
      return true;
    }

    /** One reading of where the viewer looks; the time since the last reading at this stop goes to that direction. */
    function sampleLook(view) {
      if (insightsOff || off) return false;
      const stop = view && view.stop;
      const bin = view ? lookBin(view.yaw, view.pitch) : null;
      // Moving, between stops, no 3D frame yet or no reading: that time belongs to no direction.
      if (!validStop(stop) || !bin) { lastSample = null; return false; }
      if (!standing || standing.stop !== stop) stopArrived(stop, null);
      if (!standing || standing.stop !== stop) return false;
      const at = clock();
      // A timer the browser held back (a busy or throttled tab) counts as two readings at most.
      const elapsed = lastSample === null ? 0 : Math.min(2 * LOOK_SAMPLE_MS, Math.max(0, Math.round(at - lastSample)));
      lastSample = at;
      const room = Math.min(elapsed, LOOK_CAP_MS - standing.ms);
      if (room <= 0) return false;
      standing.bins[bin] = (standing.bins[bin] || 0) + room;
      standing.ms += room;
      return true;
    }

    /** Read the player about twice a second while the page is visible; nothing runs while it is hidden. */
    function watchLook(win) {
      const doc = win && win.document;
      if (insightsOff || !doc || typeof win.setInterval !== 'function' || typeof win.clearInterval !== 'function') return;
      const hidden = () => doc.hidden === true || doc.visibilityState === 'hidden';
      const read = () => {
        if (insightsOff || off) { pause(); return; }
        if (hidden()) { lastSample = null; return; }
        let view = null;
        try {
          const current = win.VeyletPlayerV2 && win.VeyletPlayerV2.current;
          view = current && typeof current.view === 'function' ? current.view() : null;
        } catch { view = null; }
        sampleLook(view);
      };
      function pause() { if (sampler !== null) { win.clearInterval(sampler); sampler = null; } lastSample = null; }
      function resume() {
        if (sampler !== null || hidden() || insightsOff || off) return;
        sampler = win.setInterval(read, LOOK_SAMPLE_MS);
        // Seen again: time counts from now, and none of the time away.
        lastSample = standing ? clock() : null;
      }
      if (typeof doc.addEventListener === 'function') {
        doc.addEventListener('veylet:stop', event => {
          try {
            const detail = event && event.detail;
            if (detail) stopArrived(detail.stop, detail.room);
          } catch { /* never in the player's way */ }
        });
        doc.addEventListener('visibilitychange', () => { if (hidden()) pause(); else resume(); });
      }
      if (typeof win.addEventListener === 'function') {
        win.addEventListener('pagehide', () => { pause(); flushLook(true); insightsOff = true; }, { once: true });
      }
      resume();
    }

    function seconds(ms) { return Math.min(DWELL_CAP_SECONDS, Math.max(0, Math.round(ms / 1000))); }

    /** The latest 'veylet:visit' summary as the dwell's fields, with the time since it added to its room; null if unusable. */
    const stopCount = value => (Number.isInteger(value) && value >= 1 && value <= STOP_LIMIT + 1 ? value : null);
    function visitFields(detail, sinceMs) {
      if (!detail || typeof detail !== 'object') return null;
      const fields = { stops: stopCount(detail.stops), last_stop: stopCount(detail.last_stop),
        furthest_stop: stopCount(detail.furthest_stop), total_stops: stopCount(detail.total_stops) };
      if (Object.values(fields).some(value => value === null)) return null;
      const rooms = {};
      const given = detail.seconds && typeof detail.seconds === 'object' ? detail.seconds : {};
      for (const type of ROOM_TYPES) {
        const value = given[type];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) rooms[type] = Math.min(DWELL_CAP_SECONDS, Math.round(value));
      }
      if (ROOM_TYPES.includes(detail.room)) rooms[detail.room] = Math.min(DWELL_CAP_SECONDS, (rooms[detail.room] || 0) + seconds(sinceMs));
      for (const type of Object.keys(rooms)) if (!rooms[type]) delete rooms[type];
      return { ...fields, rooms };
    }

    /** The first 3D frame, when the player marks one; nothing when it does not. */
    function watchFirstFrame(win) {
      const Observer = win && win.PerformanceObserver;
      if (typeof Observer !== 'function') return;
      try {
        const observer = new Observer(list => {
          const entry = list.getEntries().find(item => item && item.name === FIRST_FRAME_MARK);
          if (!entry) return;
          observer.disconnect();
          // A bare number of seconds, as it always was (the database contract leaves first_frame alone: no visit).
          send('first_frame', seconds(openedMark === null ? entry.startTime : entry.startTime - openedMark));
        });
        observer.observe({ type: 'mark', buffered: true });
      } catch { /* optional */ }
    }

    return {
      get enabled() { return !off; },
      src,
      host,
      /** This page load's random token (32 hex), or null; in memory only. */
      visit,
      send,
      roomVisited,
      stopArrived,
      sampleLook,
      flushLook,
      /** The walkthrough was found: count the open, then its first frame and, once, the time spent. */
      opened(win) {
        if (!send('open', withVisit({}))) return false;
        openedAt = clock();
        try { openedMark = win && win.performance && typeof win.performance.now === 'function' ? win.performance.now() : null; } catch { openedMark = null; }
        watchFirstFrame(win);
        if (win && win.document && typeof win.document.addEventListener === 'function') {
          win.document.addEventListener('veylet:room', event => {
            const name = event && event.detail && event.detail.room;
            if (name) roomVisited(name);
          });
        }
        // The visit summary, only with viewer insights on and analytics not switched off for this tab.
        let summary = null, summaryAt = null;
        if (VIEWER_INSIGHTS && options.analyticsOff !== true && win && win.document && typeof win.document.addEventListener === 'function') {
          win.document.addEventListener('veylet:visit', event => {
            if (event && event.detail && typeof event.detail === 'object') { summary = event.detail; summaryAt = clock(); }
          });
        }
        // The look for the last stop goes first, then the dwell: both keepalive, both once.
        try { watchLook(win); } catch { /* insights are optional */ }
        if (win && typeof win.addEventListener === 'function') {
          win.addEventListener('pagehide', () => {
            if (openedAt === null) return;
            const now = clock();
            const visited = summary ? visitFields(summary, now - summaryAt) : null;
            send('dwell', withVisit({ seconds: seconds(now - openedAt), ...(visited || {}) }));
          }, { once: true });
        }
        return true;
      },
    };
  }

  function agentLine(contact) {
    return contact.agency ? contact.name + ', ' + contact.agency : contact.name;
  }
  function privateNote(contact) {
    return contact ? 'A private link from ' + contact.name + ', not listed publicly.' : 'A private link, not listed publicly.';
  }
  function troubleLine(contact) {
    return 'Trouble opening it? Try another browser, or ' + (contact ? 'contact ' + contact.name + '.' : 'ask the person who sent it.');
  }

  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.setAttribute('class', className);
    if (text) node.textContent = text;
    return node;
  }

  /** Call is the filled action when there is a phone; otherwise Email is. A tap is counted for the agent. */
  function contactActions(doc, contact, title, beacon) {
    const actions = element(doc, 'div', 'agent-actions');
    const add = (href, text, verb, kind, detail, external) => {
      if (!href) return;
      const link = element(doc, 'a', actions.children.length ? 'button button-ghost agent-action' : 'button agent-action', text);
      link.setAttribute('href', href);
      link.setAttribute('aria-label', verb + ' ' + contact.name);
      if (external) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
      if (kind === 'email_tap' && detail === undefined && typeof link.addEventListener === 'function') {
        // At the press: the stop the visitor is on goes into the message.
        link.addEventListener('click', () => { if (place) link.setAttribute('href', mailtoHref(contact.email, title, place)); });
      }
      if (beacon && typeof link.addEventListener === 'function') {
        link.addEventListener('click', () => (detail === undefined ? beacon.send(kind) : beacon.send(kind, detail)));
      }
      actions.append(link);
    };
    add(telHref(contact.phone), 'Call', 'Call', 'call_tap');
    add(mailtoHref(contact.email, title), 'Email', 'Email', 'email_tap');
    if (contact.bookingUrl) {
      add(bookingHref(contact.bookingUrl), 'Book inspection', 'Book inspection with', 'email_tap', { booking: true }, true);
    } else if (contact.allowViewingRequest && contact.email) {
      add(viewingRequestHref(contact.email, title, contact.name), 'Book viewing', 'Book viewing with', 'email_tap', { booking: true }, false);
    }
    return actions;
  }

  function renderCard(doc, host, contact, title, beacon, late) {
    if (!host) return;
    const name = element(doc, 'h2', 'agent-name', contact.name);
    name.setAttribute('id', 'agent-card-name');
    const who = element(doc, 'div', 'agent-who');
    who.append(name);
    if (contact.agency) who.append(element(doc, 'p', 'agent-agency', contact.agency));
    // A desk browser often has nothing that answers tel:, so the details are readable too.
    const details = [contact.phone, contact.email].filter(Boolean).join(' · ');
    if (details) who.append(element(doc, 'p', 'agent-details', details));
    host.replaceChildren(who, contactActions(doc, contact, title, beacon));
    host.setAttribute('aria-labelledby', 'agent-card-name');
    // Late (its held place already went): shown only where it cannot move the stage (client-page.css).
    if (late) host.classList?.add('agent-card-late');
    host.hidden = false;
  }

  function renderBar(doc, host, contact, title, beacon) {
    if (!host) return;
    host.replaceChildren(element(doc, 'p', 'agent-bar-name', contact.name), contactActions(doc, contact, title, beacon));
    host.setAttribute('aria-label', 'Contact ' + contact.name);
    host.hidden = false;
    doc.body?.classList.add('has-agent-bar');
    // Focus that scrolls into view stops above the bar, not under it (client-page.css).
    doc.documentElement?.classList?.add('client-has-bar');
  }

  /** The card, the phone bar and the two lines that name the agent. */
  function showContact(doc, contact, title, beacon, late) {
    if (!contact) return false;
    renderCard(doc, doc.getElementById('agent-card'), contact, title, beacon, late);
    renderBar(doc, doc.getElementById('agent-bar'), contact, title, beacon);
    const note = doc.getElementById('client-footnote');
    if (note) note.textContent = privateNote(contact);
    const trouble = doc.getElementById('client-trouble');
    if (trouble) trouble.textContent = troubleLine(contact);
    return true;
  }

  /** This page's address with nothing but its token. */
  function shareUrl(loc, token) {
    return loc.origin + loc.pathname + '?t=' + encodeURIComponent(token);
  }

  // A repeated identical message would not be read again; alternate a trailing
  // no-break space so every press is announced.
  function say(region, message) {
    if (!region) return;
    region.textContent = message && region.textContent === message ? message + ' ' : message;
  }

  async function copyText(text, nav, doc) {
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(text);
        return true;
      }
    } catch { /* try the selection route */ }
    try {
      const field = doc.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.setAttribute('style', 'position:fixed;top:0;left:0;opacity:0');
      doc.body.append(field);
      field.select();
      const copied = doc.execCommand('copy');
      field.remove();
      return Boolean(copied);
    } catch {
      return false;
    }
  }

  /**
   * Share with the system sheet where there is one, otherwise copy the link.
   * Cancelling the sheet says nothing; a failed sheet falls back to copying.
   */
  function mountShare(button, options) {
    if (!button) return;
    const native = Boolean(options.navigator && typeof options.navigator.share === 'function');
    button.textContent = native ? 'Share' : 'Copy link';
    button.hidden = false;
    let busy = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      try {
        const said = await shareNow(options);
        if (said !== null) say(options.status, said);
      } finally {
        busy = false;
      }
    });
  }

  /**
   * One share: the tap is counted, then the system sheet or a copy. Answers what to tell the
   * visitor ('' after the sheet), or null when they closed the sheet. `options.url` may be a
   * function, read at the press, so the link carries the stop the visitor is on.
   */
  async function shareNow(options) {
    const nav = options.navigator;
    const url = typeof options.url === 'function' ? options.url() : options.url;
    if (options.beacon) options.beacon.send('share_tap');
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: options.title, url });
        return '';
      } catch (error) {
        if (error && error.name === 'AbortError') return null;
      }
    }
    const copied = await copyText(url, nav, options.document);
    return copied ? 'Link copied.' : 'Copying didn’t work. Copy the address from your browser instead.';
  }

  /**
   * What the page asks of the player for this visit (tour-player-v2.js `visit`): open on the
   * stop the link names (#stop=N), keep the address on the stop the visitor is at, and offer
   * Share and the agent's Call and Email inside the player (its end card and About panel), where
   * the page's own are out of reach in full screen. The player sends nothing; presses are counted
   * here, as the page's own buttons count them.
   */
  function visitLink(options) {
    const win = options.window, loc = options.location;
    let title = '', giveContact = () => {};
    const contact = new Promise(resolve => { giveContact = resolve; });
    const url = () => (place ? place.url : shareUrl(loc, options.token));
    return {
      startAt: stopFromHash(loc.hash),
      onStop(number, count) {
        const hash = number > 1 ? '#stop=' + number : '';
        place = { number, count, url: shareUrl(loc, options.token) + hash };
        try {
          if ((loc.hash || '') !== hash) win.history.replaceState(win.history.state, '', loc.pathname + loc.search + hash);
        } catch { /* the address stays; Share still carries the stop */ }
      },
      share: () => shareNow({ navigator: options.navigator, document: options.document, beacon: options.beacon, title, url }),
      contact,
      url,
      setTitle(value) { title = value || ''; },
      setContact(found) {
        if (!found) { giveContact(null); return; }
        const beacon = options.beacon;
        const actions = [];
        const tel = telHref(found.phone);
        if (tel) actions.push({ label: 'Call', href: tel, press: () => { if (beacon) beacon.send('call_tap'); } });
        const mail = mailtoHref(found.email, title);
        if (mail) actions.push({ label: 'Email', href: mail, hrefNow: () => mailtoHref(found.email, title, place), press: () => { if (beacon) beacon.send('email_tap'); } });
        giveContact(actions.length ? { name: found.name, actions } : null);
      },
    };
  }

  // How long after the walkthrough is found the agent card's held place waits
  // for the contact before it goes (layout shift; client-page.css "Held places").
  const CONTACT_GRACE_MS = 300;

  /*
   * Called once the page's own lookup has found the walkthrough: the truth
   * line, Share, the movement help (streamed walkthroughs only, whose controls
   * it describes) and the contact, which never holds the walkthrough up. The
   * page starts the contact lookup beside its own (options.contact); an answer
   * already in settles the card in this same step. Otherwise the card's held
   * place waits CONTACT_GRACE_MS, or until the stage shows (the page clears it
   * then), and a contact that answers after that is late: the bar and the named
   * lines as usual, the card only where it cannot move the stage.
   */
  function showWalkthrough(options) {
    const doc = options.document;
    const truth = doc.getElementById('client-truth');
    if (truth) truth.hidden = false;
    const help = doc.getElementById('client-help');
    if (help) help.hidden = !options.streamed;
    const visit = options.visit || null;
    if (visit) visit.setTitle(options.title);
    mountShare(doc.getElementById('client-share'), {
      title: options.title,
      // With a visit: the stop the visitor is on, read at the press.
      url: visit ? visit.url : shareUrl(options.location, options.token),
      status: doc.getElementById('client-share-status'),
      navigator: options.navigator,
      document: doc,
      beacon: options.beacon,
    });
    const held = doc.documentElement?.classList;
    const release = () => held?.remove('client-contact-pending');
    const grace = held ? setTimeout(release, options.contactGraceMs ?? CONTACT_GRACE_MS) : null;
    const lookup = options.contact || lookupContact(options.client, options.token, options);
    return Promise.resolve(lookup).then(contact => {
      clearTimeout(grace);
      const late = Boolean(held) && !held.contains('client-contact-pending');
      const shown = showContact(doc, contact, options.title, options.beacon, late);
      if (visit) visit.setContact(contact);
      // The held place goes in the same step the card fills it, or not.
      release();
      return shown;
    });
  }

  /*
   * A phone on its side shows about 360px of page. Once the walkthrough is on
   * screen it is brought to the top, once, so the whole player and its controls
   * sit above the fixed Call/Email bar (tour-stage.css sizes it to fit). Never
   * after the visitor has moved the page themselves.
   */
  const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 500px)';
  const STAGE_GAP = 4; // px of page left above the stage
  function settleStage(win, stage) {
    try {
      if (!win || !stage || stage.hidden || typeof stage.getBoundingClientRect !== 'function' || typeof win.scrollTo !== 'function') return false;
      if (typeof win.matchMedia !== 'function' || !win.matchMedia(SHORT_LANDSCAPE).matches) return false;
      if ((win.scrollY || 0) > 4) return false;
      // Measured, not scrollIntoView: the site keeps 30px of scroll padding for its other pages.
      const top = Math.round((win.scrollY || 0) + stage.getBoundingClientRect().top - STAGE_GAP);
      if (top <= 0) return false;
      win.scrollTo({ top, behavior: 'auto' });
      return true;
    } catch {
      return false;
    }
  }

  /*
   * The link's token (§5.2 "Link incomplete"). A share token is 32 hex characters
   * (lookup_tour_share answers nothing else), so a hex token of any other length is
   * a link cut off or run on, and a token with characters no link carries (a space,
   * a quote) is broken: both read as incomplete, never as "turned off". Punctuation a
   * message glues on (a full stop, a bracket) and capitals are taken off first. Any
   * other token of 16 or more link characters is looked up as it is. The head script
   * of /handoff applies the same rule before first paint.
   */
  function linkToken(search) {
    let raw = '';
    try { raw = String(new URLSearchParams(search || '').get('t') || ''); } catch { raw = ''; }
    let token = raw.trim().replace(/[.,;:!?)\]}>'"_-]+$/, '');
    if (/^[0-9a-f]+$/i.test(token)) token = token.toLowerCase();
    const hex = /^[0-9a-f]+$/.test(token);
    const complete = hex ? token.length === 32 : token.length >= 16 && token.length <= 64 && /^[A-Za-z0-9_-]+$/.test(token);
    return { token, complete };
  }

  /*
   * The embed's invitation (§5.2 "Embed, small frame"): the walkthrough's own
   * poster behind it, from the package manifest (a few KB) on the tour host or this
   * origin. Nothing 3D loads before Explore. Anything unexpected is no poster.
   */
  const POSTER_HOSTS = ['https://tours.veylet.com'];
  const POSTER_PATH = /^(?:r\/[0-9a-f]{8,64}\/)?(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\/){0,3}[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.webp$/;
  async function invitationPoster(options = {}) {
    try {
      const request = options.fetch || (typeof fetch === 'function' ? fetch : null);
      const here = options.origin || (typeof location !== 'undefined' ? location.origin : '');
      const base = new URL(String(options.base || ''), here || undefined);
      if (!request || base.search || base.hash || !base.pathname.endsWith('/')) return null;
      if (!POSTER_HOSTS.includes(base.origin) && base.origin !== here) return null;
      const response = await request(base.href + 'manifest.json', { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response || !response.ok) return null;
      const text = await response.text();
      if (text.length > 512 * 1024) return null;
      const poster = (JSON.parse(text) || {}).poster || {};
      const choice = (options.portrait ? poster.portrait : poster.landscape) || poster.landscape || poster.portrait;
      const path = choice && choice.path;
      if (typeof path !== 'string' || !POSTER_PATH.test(path) || path.split('/').includes('..')) return null;
      return base.href + path;
    } catch {
      return null;
    }
  }

  /*
   * "Report this walkthrough" (launch plan C2.3): a quiet link to /report with this
   * link's token and nothing else. It shows whenever the token looks complete,
   * whatever the lookup says, so the link never tells anyone whether a token exists.
   */
  function reportHref(token) {
    return '/report?t=' + encodeURIComponent(token);
  }
  function mountReport(link, token, reveal) {
    if (!link || typeof token !== 'string' || token.length < 16) return false;
    link.href = reportHref(token);
    link.hidden = false;
    if (reveal && reveal !== link) reveal.hidden = false;
    return true;
  }

  /*
   * From 1080px the page has two columns and Help and Share sit under the
   * agent card; below that they sit under the walkthrough. They move in the
   * document, not just on screen, so reading and focus order follow the
   * layout. Focus inside them survives a move.
   */
  const WIDE = '(min-width: 1080px)';
  function placeExtras(doc, wide) {
    const extras = doc.getElementById('client-extras');
    const target = doc.getElementById(wide ? 'client-side' : 'client-extras-home');
    if (!extras || !target || extras.parentNode === target) return;
    const active = doc.activeElement;
    const keep = active && extras.contains(active) ? active : null;
    target.append(extras);
    if (keep && typeof keep.focus === 'function') keep.focus();
  }
  function mountColumns(doc, win) {
    const query = win && typeof win.matchMedia === 'function' ? win.matchMedia(WIDE) : null;
    if (!query) return;
    const apply = () => placeExtras(doc, query.matches);
    apply();
    if (typeof query.addEventListener === 'function') query.addEventListener('change', apply);
    else if (typeof query.addListener === 'function') query.addListener(apply);
  }

  /*
   * The buyer's page admits a failed start in buyer words (VIEWER-09). Once the
   * walkthrough is on screen it works, so a stray error elsewhere changes nothing;
   * a missing image is not a failure. No support address: the buyer's contact is
   * the agent. (The desk pages keep place-fields.js's reporter.)
   */
  const FAILED_START = 'This page didn’t finish loading. Reload it, or ask the agent who sent you the link.';
  function watchFailures(win, doc) {
    let reported = false;
    const shown = id => { const node = doc.getElementById(id); return Boolean(node && !node.hidden); };
    const report = () => {
      if (reported || shown('tour-stage') || shown('tour-frame')) return;
      const status = doc.getElementById('handoff-status');
      if (!status) return;
      reported = true;
      status.textContent = FAILED_START;
    };
    win.addEventListener('error', event => {
      if (event && event.target && event.target !== win && event.target.tagName) return;
      report();
    });
    win.addEventListener('unhandledrejection', () => report());
    return report;
  }

  window.VeyletClientPage = {
    dialable, telHref, mailtoHref, bookingHref, viewingRequestHref, contactFrom, lookupContact, restClient,
    channelFrom, referrerHost, viewBeacon, visitToken, lookBin,
    agentLine, privateNote, troubleLine, renderCard, renderBar, showContact,
    shareUrl, copyText, mountShare, shareNow, visitLink, stopFromHash, showWalkthrough, settleStage, placeExtras, mountColumns,
    reportHref, mountReport, linkToken, invitationPoster, watchFailures,
  };
})();
