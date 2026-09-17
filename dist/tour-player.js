'use strict';

/*
 * Unlisted tour surfaces (owner preview + client handoff).
 *
 * Local scripts only — no module imports — so a blocked CDN, an offline
 * client, or a revoked link degrades to a visible message instead of a page
 * stuck on "Checking…". The static HTML already reads as unavailable, so the
 * surface also fails closed when JavaScript never runs.
 */
(() => {
  const player = {
    client: null,
    zips: null,
  };

  const OFFLINE_HEADING = 'This walkthrough is not available.';
  const OFFLINE_BODY =
    'The player files did not load on this device. Check the connection and try again.';
  const STORAGE_BODY =
    'The tour file could not be opened. Ask the operator to send the link again.';
  const PACKAGE_BODY = 'This package is not a playable reconstructed tour.';

  /** A typed failure so we only offer "Try again" for transient causes. */
  class TourFailure extends Error {
    constructor(message, options) {
      super(message);
      this.transient = Boolean(options && options.transient);
    }
  }
  player.TourFailure = TourFailure;

  function text(el, value) {
    if (el) el.textContent = value;
  }

  async function settleWithDeadline(promise, ms) {
    let timer = null;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), ms);
    });
    const settled = promise
      .then((value) => ({ value }))
      .catch((error) => ({ error }));
    const result = await Promise.race([settled, expired]);
    if (timer) clearTimeout(timer);
    return result;
  }

  player.showFailure = (els, options) => {
    const heading = options.heading || OFFLINE_HEADING;
    text(els.title, heading);
    text(els.body, options.body || '');
    text(els.status, options.status || '');
    if (els.actions) els.actions.hidden = !options.retry && !options.showSignIn;
    if (els.retry) els.retry.hidden = !options.retry;
    const signIn = document.getElementById('play-signin');
    if (signIn) signIn.hidden = !options.showSignIn;
    if (els.frame) els.frame.hidden = true;
    document.title = heading.replace(/\.$/, '') + ' — Veylet';
  };

  player.showProgress = (els, status) => {
    text(els.status, status);
    const help = document.querySelector('[data-tour-help]');
    if (help && status) help.hidden = false;
  };

  player.clientFor = (options) => {
    if (player.client) return player.client;
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      return null;
    }
    const cfg = window.VEYLET_SUPABASE || {};
    if (!cfg.url || !cfg.anonKey) return null;
    player.client = window.supabase.createClient(cfg.url, cfg.anonKey, options || {});
    return player.client;
  };

  /** Drop any cached client so a later page cannot inherit this page's session. */
  player.releaseClient = async () => {
    if (!player.client) return;
    try {
      await player.client.auth.signOut({ scope: 'local' });
    } catch {
      /* the client is discarded either way */
    }
    player.client = null;
  };

  player.playPackage = async (blob, frame) => {
    if (typeof window.JSZip === 'undefined') throw new TourFailure('zip-unavailable');
    const zip = await window.JSZip.loadAsync(blob);
    const entry = zip.file('tour.html') || zip.file('index.html');
    if (!entry) throw new TourFailure('missing-tour');
    const markup = await entry.async('string');
    // The blob must be typed as HTML or the browser renders the source text.
    const html = new Blob([markup], { type: 'text/html' });
    return new Promise((resolve, reject) => {
      let settled = false;
      const loaded = () => {
        if (settled) return;
        settled = true;
        frame.hidden = false;
        resolve();
      };
      frame.addEventListener('load', loaded, { once: true });
      frame.src = URL.createObjectURL(html);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new TourFailure('frame-not-loaded', { transient: true }));
      }, 6000);
    });
  };

  /**
   * Wire one unlisted tour surface.
   *
   * `resolve(client)` runs first and must return
   * `{ storagePath, title?, intro?, footer? }`. Throw `TourFailure` to choose
   * whether the visitor is offered "Try again".
   */
  player.boot = async (options) => {
    const els = options.els;
    const actions = document.getElementById('tour-actions');
    const retry = document.getElementById('tour-retry');
    const surface = {
      title: els.title,
      body: els.body,
      status: els.status,
      frame: els.frame,
      actions,
      retry,
    };
    retry?.addEventListener('click', (event) => {
      event.preventDefault();
      location.reload();
    });

    if (!navigator.onLine) {
      player.showFailure(surface, { body: OFFLINE_BODY, retry: true });
      return;
    }

    const client = player.clientFor(options.auth || {});
    if (!client) {
      player.showFailure(surface, { body: OFFLINE_BODY, retry: true });
      return;
    }

    if (options.needsSession) {
      const session = await settleWithDeadline(client.auth.getSession(), 8000);
      const current = session.value && session.value.data && session.value.data.session;
      if (session.timedOut || !current) {
        player.showFailure(surface, {
          heading: options.signedOutHeading || 'Sign in to continue.',
          body: options.signedOutBody || 'This page is only for the signed-in account.',
          retry: false,
          showSignIn: Boolean(options.signedOutLink),
        });
        player.releaseClient();
        return;
      }
    }

    let looked;
    try {
      looked = await settleWithDeadline(options.resolve(client), options.timeoutMs || 20000);
    } catch (error) {
      looked = { error };
    }
    if (looked.timedOut) {
      player.showFailure(surface, {
        heading: 'This is taking too long.',
        body: 'The walkthrough did not respond. Try again, or ask the operator to resend the link.',
        retry: true,
      });
      return;
    }
    if (looked.error) {
      const transient = looked.error.transient !== false;
      player.showFailure(surface, {
        heading: options.missingHeading || OFFLINE_HEADING,
        body: transient ? options.transientBody || OFFLINE_BODY : options.missingBody || STORAGE_BODY,
        retry: transient,
      });
      return;
    }

    const resolved = looked.value;
    if (!resolved || !resolved.storagePath) {
      player.showFailure(surface, {
        heading: options.missingHeading || OFFLINE_HEADING,
        body: options.missingBody || 'The link is missing, revoked, or the tour is not ready.',
      });
      return;
    }

    if (resolved.title) text(els.title, resolved.title);
    if (resolved.intro) text(els.body, resolved.intro);
    document.title = (resolved.title || 'Walkthrough') + ' — Veylet';
    player.showProgress(surface, 'Loading the reconstructed tour…');

    const download = await settleWithDeadline(
      client.storage.from(options.bucket || 'tour-packages').download(resolved.storagePath),
      options.timeoutMs || 30000
    );
    const file = download.value;
    if (download.timedOut || download.error || !file || file.error || !file.data) {
      player.showFailure(surface, {
        heading: resolved.title || OFFLINE_HEADING,
        body: STORAGE_BODY,
        retry: true,
      });
      return;
    }

    try {
      await settleWithDeadline(player.playPackage(file.data, els.frame), 20000);
      if (els.frame.hidden) throw new TourFailure('frame-hidden');
      player.showProgress(surface, resolved.footer || '');
    } catch {
      player.showFailure(surface, {
        heading: resolved.title || OFFLINE_HEADING,
        body: PACKAGE_BODY,
        retry: true,
      });
    }
  };

  window.VeyletPlayer = player;
})();
