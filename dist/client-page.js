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

  /** Call is the filled action when there is a phone; otherwise Email is. */
  function contactActions(doc, contact, title) {
    const actions = element(doc, 'div', 'agent-actions');
    const add = (href, text, verb) => {
      if (!href) return;
      const link = element(doc, 'a', actions.children.length ? 'button button-ghost agent-action' : 'button agent-action', text);
      link.setAttribute('href', href);
      link.setAttribute('aria-label', verb + ' ' + contact.name);
      actions.append(link);
    };
    add(telHref(contact.phone), 'Call', 'Call');
    add(mailtoHref(contact.email, title), 'Email', 'Email');
    return actions;
  }

  function renderCard(doc, host, contact, title) {
    if (!host) return;
    const name = element(doc, 'h2', 'agent-name', contact.name);
    name.setAttribute('id', 'agent-card-name');
    const who = element(doc, 'div', 'agent-who');
    who.append(name);
    if (contact.agency) who.append(element(doc, 'p', 'agent-agency', contact.agency));
    // A desk browser often has nothing that answers tel:, so the details are readable too.
    const details = [contact.phone, contact.email].filter(Boolean).join(' · ');
    if (details) who.append(element(doc, 'p', 'agent-details', details));
    host.replaceChildren(who, contactActions(doc, contact, title));
    host.setAttribute('aria-labelledby', 'agent-card-name');
    host.hidden = false;
  }

  function renderBar(doc, host, contact, title) {
    if (!host) return;
    host.replaceChildren(element(doc, 'p', 'agent-bar-name', contact.name), contactActions(doc, contact, title));
    host.setAttribute('aria-label', 'Contact ' + contact.name);
    host.hidden = false;
    doc.body?.classList.add('has-agent-bar');
  }

  /** The card, the phone bar and the two lines that name the agent. */
  function showContact(doc, contact, title) {
    if (!contact) return false;
    renderCard(doc, doc.getElementById('agent-card'), contact, title);
    renderBar(doc, doc.getElementById('agent-bar'), contact, title);
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

  /*
   * Called once the page's own lookup has found the walkthrough: the truth
   * line, Share, the movement help (streamed walkthroughs only, whose controls
   * it describes) and the contact lookup, which never holds the walkthrough up.
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
    });
    return lookupContact(options.client, options.token, options).then(contact => showContact(doc, contact, options.title));
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
    agentLine, privateNote, troubleLine, renderCard, renderBar, showContact,
    shareUrl, copyText, mountShare, showWalkthrough, placeExtras, mountColumns,
  };
})();
