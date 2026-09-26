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

  function mailtoHref(email, title) {
    const address = clean(email, 254);
    if (!EMAIL.test(address)) return '';
    const at = address.lastIndexOf('@');
    const encoded = encodeURIComponent(address.slice(0, at)) + '@' + encodeURIComponent(address.slice(at + 1));
    return 'mailto:' + encoded + '?subject=' + encodeURIComponent('Walkthrough: ' + (title || 'Shared space'));
  }

  /** The one row the server answers, or null unless it names someone reachable. */
  function contactFrom(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') return null;
    const name = clean(row.display_name, 80);
    const phone = dialable(row.phone) ? clean(row.phone, 32) : '';
    const email = EMAIL.test(clean(row.email, 254)) ? clean(row.email, 254) : '';
    if (!name || (!phone && !email)) return null;
    return { name, agency: clean(row.agency, 80), phone, email };
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
   */
  const VIEW_FUNCTION = 'record_tour_view';
  const VIEW_KINDS = ['open', 'first_frame', 'room', 'call_tap', 'email_tap', 'share_tap', 'dwell'];
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
    let openedAt = null, openedMark = null;

    function send(kind, detail) {
      if (off || !VIEW_KINDS.includes(kind)) return false;
      if (VIEW_ONCE.includes(kind)) { if (said.has(kind)) return false; said.add(kind); }
      try {
        const pending = request(endpoint, {
          method: 'POST',
          keepalive: kind === 'dwell',
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
        }).catch(() => {});
      } catch { /* a view count is never in the way */ }
      return true;
    }

    function seconds(ms) { return Math.min(DWELL_CAP_SECONDS, Math.max(0, Math.round(ms / 1000))); }

    /** The first 3D frame, when the player marks one; nothing when it does not. */
    function watchFirstFrame(win) {
      const Observer = win && win.PerformanceObserver;
      if (typeof Observer !== 'function') return;
      try {
        const observer = new Observer(list => {
          const entry = list.getEntries().find(item => item && item.name === FIRST_FRAME_MARK);
          if (!entry) return;
          observer.disconnect();
          send('first_frame', seconds(openedMark === null ? entry.startTime : entry.startTime - openedMark));
        });
        observer.observe({ type: 'mark', buffered: true });
      } catch { /* optional */ }
    }

    return {
      get enabled() { return !off; },
      src,
      host,
      send,
      /** The walkthrough was found: count the open, then its first frame and, once, the time spent. */
      opened(win) {
        if (!send('open')) return false;
        openedAt = clock();
        try { openedMark = win && win.performance && typeof win.performance.now === 'function' ? win.performance.now() : null; } catch { openedMark = null; }
        watchFirstFrame(win);
        if (win && typeof win.addEventListener === 'function') {
          win.addEventListener('pagehide', () => { if (openedAt !== null) send('dwell', seconds(clock() - openedAt)); }, { once: true });
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
    const add = (href, text, verb, kind) => {
      if (!href) return;
      const link = element(doc, 'a', actions.children.length ? 'button button-ghost agent-action' : 'button agent-action', text);
      link.setAttribute('href', href);
      link.setAttribute('aria-label', verb + ' ' + contact.name);
      if (beacon && typeof link.addEventListener === 'function') link.addEventListener('click', () => beacon.send(kind));
      actions.append(link);
    };
    add(telHref(contact.phone), 'Call', 'Call', 'call_tap');
    add(mailtoHref(contact.email, title), 'Email', 'Email', 'email_tap');
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
    const nav = options.navigator;
    const doc = options.document;
    const native = Boolean(nav && typeof nav.share === 'function');
    button.textContent = native ? 'Share' : 'Copy link';
    button.hidden = false;
    let busy = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      if (options.beacon) options.beacon.send('share_tap');
      try {
        if (native) {
          try {
            await nav.share({ title: options.title, url: options.url });
            say(options.status, '');
            return;
          } catch (error) {
            if (error && error.name === 'AbortError') return;
          }
        }
        const copied = await copyText(options.url, nav, doc);
        say(options.status, copied ? 'Link copied.' : 'Copying didn’t work. Copy the address from your browser instead.');
      } finally {
        busy = false;
      }
    });
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
    mountShare(doc.getElementById('client-share'), {
      title: options.title,
      url: shareUrl(options.location, options.token),
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
      // The held place goes in the same step the card fills it, or not.
      release();
      return shown;
    });
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

  window.VeyletClientPage = {
    dialable, telHref, mailtoHref, contactFrom, lookupContact, restClient,
    channelFrom, referrerHost, viewBeacon,
    agentLine, privateNote, troubleLine, renderCard, renderBar, showContact,
    shareUrl, copyText, mountShare, showWalkthrough, placeExtras, mountColumns,
    reportHref, mountReport,
  };
})();
