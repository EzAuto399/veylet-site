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
    'The tour file could not be opened. Ask the agent who sent it to send the link again.';
  const PACKAGE_BODY = 'This package is not a playable reconstructed tour.';
  const dependencies = new Map();

  // A listing can show the lightweight embed invitation without parsing the
  // account SDK or ZIP engine. Load each only when someone opens the tour.
  player.loadScript = (path) => {
    if (dependencies.has(path)) return dependencies.get(path);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.async = true;
      const timer = setTimeout(() => { script.remove(); reject(new TourFailure('player-file-timeout', { transient: true })); }, 15000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new TourFailure('player-file-unavailable', { transient: true })); };
      document.head.append(script);
    });
    dependencies.set(path, pending);
    return pending;
  };

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

  // Browsers can suspend animation frames in background tabs while allowing
  // timers to run. Only time the page can present the viewer consumes its
  // startup allowance. Network/auth deadlines remain elapsed-time limits.
  function visibleDeadline(expire, ms) {
    let remaining = ms, started = null, timer = null, generation = 0, active = true;
    const pause = () => {
      generation++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (started !== null) remaining = Math.max(0, remaining - (performance.now() - started));
      started = null;
    };
    const cancel = () => {
      if (!active) return;
      active = false;
      pause();
      document.removeEventListener('visibilitychange', schedule);
    };
    const schedule = () => {
      if (!active) return;
      pause();
      if (document.hidden) return;
      started = performance.now();
      const current = generation;
      timer = setTimeout(() => {
        if (!active || current !== generation) return;
        if (document.hidden) { pause(); return; }
        cancel();
        expire();
      }, remaining);
    };
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return cancel;
  }

  async function settleWithDeadline(promise, ms, visibleTimeOnly = false) {
    let cancel = () => {};
    const expired = new Promise((resolve) => {
      const expire = () => resolve({ timedOut: true });
      if (visibleTimeOnly) cancel = visibleDeadline(expire, ms);
      else {
        const timer = setTimeout(expire, ms);
        cancel = () => clearTimeout(timer);
      }
    });
    const settled = promise
      .then((value) => ({ value }))
      .catch((error) => ({ error }));
    const result = await Promise.race([settled, expired]);
    cancel();
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
    // A definitive miss means the same token is dead everywhere. Withdraw the
    // escape hatches that resolve it, rather than sending someone to a second
    // page that will fail in the same way.
    if (!options.retry) {
      for (const link of document.querySelectorAll('[data-tour-dead-end]')) link.hidden = true;
    }
    if (els.frame) els.frame.hidden = true;
    if (els.stage) els.stage.hidden = true;
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
    player.client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: options || {} });
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

  player.playPackage = async (blob, frame, options = {}) => {
    const signal = options.signal;
    // A surface may want a full notice while nothing is on screen yet, then a
    // compact one the moment the viewer owns the viewport. Fires exactly once,
    // when the frame is revealed, so no notice ever covers a rendering canvas.
    let announced = false;
    const reveal = () => {
      frame.hidden = false;
      if (announced) return;
      announced = true;
      try { options.onVisible?.(); } catch { /* a surface hint never breaks playback */ }
    };
    const checkActive = () => { if (signal?.aborted) throw new TourFailure('playback-cancelled'); };
    checkActive();
    if (!blob || blob.size > 50_000_000) throw new TourFailure('package-too-large');
    if (typeof window.JSZip === 'undefined') await player.loadScript('/vendor/jszip-3.10.2.min.js?v=7f839b2d4688b845');
    checkActive();
    if (typeof window.JSZip === 'undefined') throw new TourFailure('zip-unavailable');
    const zip = await window.JSZip.loadAsync(blob);
    checkActive();
    const entry = zip.file('tour.html');
    if (!entry) throw new TourFailure('missing-tour');
    // The ZIP itself can be small while its executable HTML expands far beyond
    // phone memory. JSZip 3.10.2 exposes the declared size before inflation.
    const maxMarkup = 80 * 1024 * 1024;
    if (entry._data?.uncompressedSize > maxMarkup) throw new TourFailure('expanded-package-too-large');
    const markup = await entry.async('string');
    checkActive();
    if (markup.length > maxMarkup) throw new TourFailure('expanded-package-too-large');
    const hasViewerContract = /<meta\b(?=[^>]*\bname=["']veylet-viewer-contract["'])(?=[^>]*\bcontent=["']1["'])[^>]*>/i.test(markup);
    // Packages contain executable viewer code. Keep it off the account origin:
    // no parent DOM, localStorage, top navigation or network calls from a tour.
    const policy = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
    // SuperSplat stores viewer preferences. An opaque sandbox has no browser
    // storage, so provide an ephemeral, frame-local Storage-compatible object.
    // This never reads or writes the signed-in site's account/session storage.
    const preferences = `<script>(function(){for(const name of ['localStorage','sessionStorage']){const values=new Map();Object.defineProperty(window,name,{value:{get length(){return values.size},key(i){return Array.from(values.keys())[i]??null},getItem(k){return values.get(String(k))??null},setItem(k,v){values.set(String(k),String(v))},removeItem(k){values.delete(String(k))},clear(){values.clear()}}});}})();<\/script>`;
    const guard = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' + preferences;
    // Parse the policy first even if the package contains a comment, script or
    // malformed head before its document. A later doctype/head is harmless.
    const guardedMarkup = '<!doctype html>' + guard + markup;
    frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    // The srcdoc sandbox has an opaque origin. The default 'src' allowlist
    // does not grant fullscreen to that origin in Safari.
    frame.setAttribute('allow', 'fullscreen *');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancelDeadline = () => {};
      const detach = () => {
        cancelDeadline();
        frame.removeEventListener('load', loaded);
        signal?.removeEventListener('abort', cancelled);
        if (hasViewerContract) window.removeEventListener('message', viewerStatus);
      };
      const finish = (readiness) => {
        if (settled) return;
        settled = true; detach(); reveal(); resolve({ readiness });
      };
      const viewerStatus = (event) => {
        if (event.source !== frame.contentWindow || !event.data || event.data.type !== 'veylet-viewer-status' || event.data.version !== 1) return;
        if (event.data.status === 'ready') finish('viewer-ready');
        else if (event.data.status === 'failed') finish('viewer-failed');
      };
      const cancelled = () => {
        if (settled) return;
        settled = true;
        detach();
        frame.removeAttribute('srcdoc');
        frame.hidden = true;
        reject(new TourFailure('playback-cancelled'));
      };
      const loaded = () => {
        if (settled) return;
        if (!hasViewerContract) finish('document-loaded');
        else reveal(); // The renderer needs a visible, sized canvas to produce its first frame.
      };
      frame.addEventListener('load', loaded, { once: true });
      signal?.addEventListener('abort', cancelled, { once: true });
      if (hasViewerContract) window.addEventListener('message', viewerStatus);
      frame.removeAttribute('src');
      frame.srcdoc = guardedMarkup;
      cancelDeadline = visibleDeadline(() => {
        if (settled) return;
        settled = true;
        detach();
        frame.removeAttribute('srcdoc');
        reject(new TourFailure(hasViewerContract ? 'viewer-not-ready' : 'frame-not-loaded', { transient: true }));
      }, hasViewerContract ? 45000 : 6000);
    });
  };

  /**
   * Wire one unlisted tour surface.
   *
   * `resolve(client)` runs first and must return
   * `{ storagePath, title?, intro?, footer? }` for a version 1 ZIP, or
   * `{ packageFormatVersion: 2, packageBaseUrl, ... }` for a streamed package.
   * Throw `TourFailure` to choose whether the visitor is offered "Try again".
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
      stage: els.stage,
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

    player.showProgress(surface, 'Opening the walkthrough service…');
    try {
      if (!window.supabase?.createClient) await player.loadScript('/vendor/supabase-js-2.116.0.min.js?v=84ee9bf45695c1dd');
    } catch {
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
      if (session.timedOut || session.error || session.value?.error) {
        player.showFailure(surface, {
          heading: 'Sign-in could not be checked.',
          body: 'The account service did not answer. Retry without signing out, or return to your desk.',
          retry: true,
        });
        return;
      }
      if (!current) {
        player.showFailure(surface, {
          heading: options.signedOutHeading || 'Sign in to continue.',
          body: options.signedOutBody || 'This page is only for the signed-in account.',
          retry: false,
          showSignIn: Boolean(options.signedOutLink),
        });
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
        body: 'The walkthrough did not respond. Try again, or ask the agent who sent it to resend the link.',
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
    const streamed = resolved?.packageFormatVersion === 2;
    if (!resolved || !(streamed ? resolved.packageBaseUrl : resolved.storagePath)) {
      player.showFailure(surface, {
        heading: options.missingHeading || OFFLINE_HEADING,
        body: options.missingBody || 'The link is missing, revoked, or the tour is not ready.',
      });
      return;
    }

    if (resolved.title) text(els.title, resolved.title);
    if (resolved.intro) text(els.body, resolved.intro);
    document.title = (resolved.title || 'Walkthrough') + ' — Veylet';
    if (streamed) return player.bootV2(surface, resolved, options);
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

    if (file.data.size > 50_000_000) {
      player.showFailure(surface, { heading: resolved.title || OFFLINE_HEADING, body: 'This tour is too large to open on the web. Ask the agent who sent it for a new link.', retry: false });
      return;
    }
    try {
      player.showProgress(surface, 'Preparing the 3D view…');
      const controller = new AbortController();
      const playback = await settleWithDeadline(player.playPackage(file.data, els.frame, { signal: controller.signal, onVisible: options.onVisible }), 65000, true);
      if (playback.timedOut || playback.error) controller.abort();
      if (playback.error) throw playback.error;
      if (playback.timedOut || els.frame.hidden) throw new TourFailure('viewer-not-ready');
      if (playback.value?.readiness === 'viewer-failed') {
        player.showProgress(surface, 'The 3D view could not start on this device. The package’s capture photograph is available below. Retry in a current browser or ask the person who sent this tour for help.');
        if (surface.actions) surface.actions.hidden = false;
        if (surface.retry) surface.retry.hidden = false;
      } else {
        player.showProgress(surface, playback.value?.readiness === 'document-loaded' ? 'Viewer document opened. If the scene stays blank, try a current browser or ask the agent who sent it for a compatible tour.' : resolved.footer || '');
      }
    } catch (error) {
      player.showFailure(surface, {
        heading: resolved.title || OFFLINE_HEADING,
        body: ['viewer-not-ready', 'frame-not-loaded'].includes(error?.message) ? 'The 3D view did not start in time. Try a current browser with graphics enabled, or ask the person who sent this tour for photographs and help.' : PACKAGE_BODY,
        retry: true,
      });
    }
  };

  /*
   * Version 2 packages stream data files (JSON and WebP) into a first-party
   * player; no package code runs, so no sandboxed document is needed. The
   * player shows the package's poster at once and replaces it with 3D.
   */
  player.bootV2 = async (surface, resolved, options) => {
    const stage = surface.stage;
    const failed = (body, retry) => player.showFailure(surface, { heading: resolved.title || OFFLINE_HEADING, body, retry });
    if (!stage) { failed(PACKAGE_BODY, false); return; }
    player.showProgress(surface, 'Loading the walkthrough…');
    try {
      if (!window.VeyletPlayerV2) await player.loadScript('/tour-player-v2.js?v=bd562fe9dec8be84');
    } catch {
      failed(OFFLINE_BODY, true);
      return;
    }
    const controller = new AbortController();
    const playback = await settleWithDeadline(window.VeyletPlayerV2.start(stage, {
      base: resolved.packageBaseUrl,
      signal: controller.signal,
      onVisible: () => {
        if (surface.frame) surface.frame.hidden = true;
        try { options.onVisible?.(); } catch { /* a surface hint never breaks playback */ }
      },
      onRetry: () => location.reload(),
    }), 65000, true);
    if (playback.timedOut || playback.error) controller.abort();
    if (playback.error) {
      const code = playback.error.code || '';
      if (code === 'package-unavailable') failed(options.missingBody || 'The link is missing, revoked, or the tour is not ready.', false);
      else if (code.startsWith('manifest-invalid') || code === 'package-location-invalid' || code === 'package-oversized') failed(PACKAGE_BODY, false);
      else failed(options.transientBody || OFFLINE_BODY, true);
      return;
    }
    if (playback.timedOut) {
      failed('The 3D view did not start in time. Try a current browser with graphics enabled, or ask the person who sent this tour for photographs and help.', true);
      return;
    }
    if (playback.value?.readiness === 'viewer-failed') {
      // The player keeps the rendered poster and explains itself inside the frame.
      player.showProgress(surface, 'The 3D view could not start here. A still from the walkthrough is shown instead.');
      return;
    }
    player.showProgress(surface, resolved.footer || '');
  };

  window.VeyletPlayer = player;
})();
