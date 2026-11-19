'use strict';
// /embed, /handoff and /tour: the shared startup flow for a shared walkthrough link.
(() => {
  const lib = window.VeyletLib;

  // The anonymous-session options block every share page sends to boot.
  const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

  function surface(prefix) {
    return {
      title: document.getElementById(prefix + '-title'),
      body: document.getElementById(prefix + '-body'),
      status: document.getElementById(prefix + '-status'),
      frame: document.getElementById('tour-frame'),
      stage: document.getElementById('tour-stage'),
    };
  }

  // ?analytics=off (owner QA) holds for the whole tab, as the page counter keeps
  // it: no visit summary is ever sent from such a tab.
  const analyticsOff = () => /(?:^|[?&])analytics=off(?:&|$)/.test(location.search) || (() => { try { return sessionStorage.getItem('veylet.analyticsOff') === '1'; } catch { return false; } })();

  // The public engagement collector, created the moment the share is found.
  function engage(els, ownerPreview, token, row) {
    window.veyletPublicEngagement?.dispose?.();
    window.veyletPublicEngagement = window.VeyletEngagement?.create({ window, document, stage: els.stage, config: window.VEYLET_SUPABASE, enabled: window.VEYLET_VIEWER_ENGAGEMENT_ENABLED === true && !ownerPreview, publicShare: true, token, tourID: row.tour_id });
  }

  // The share lookup every variant does the same way: one RPC, the first row,
  // the player's two failure kinds and the source object for boot. A version 2
  // share is found by its package_base_url, a version 1 by its storage_path.
  async function resolveShare(client, token, fallbackTitle) {
    const { data, error } = await client.rpc('lookup_tour_share', { p_token: token });
    const row = lib.firstRow(data);
    if (error) {
      throw new window.VeyletPlayer.TourFailure('share-unavailable', { transient: true });
    }
    if (!row || !(row.package_format_version === 2 ? row.package_base_url : row.storage_path)) {
      throw new window.VeyletPlayer.TourFailure('share-not-found', { transient: false });
    }
    return {
      row,
      source: {
        storagePath: row.storage_path,
        packageFormatVersion: row.package_format_version === 2 ? 2 : 1,
        packageBaseUrl: row.package_base_url || null,
        title: row.space_title || fallbackTitle,
        intro: '',
      },
    };
  }

  // The boot options every share link page sends: an anonymous session, the
  // shared failure words and the one pause check.
  function bootShare(token, options) {
    return window.VeyletPlayer.boot({
      auth: AUTH,
      // The shared words for "not available" and "could not be reached", and Try again on both.
      client: true,
      // A link that answers nothing is asked once whether it is only paused (tour-player.js lookupPause).
      shareToken: token,
      ...options,
    });
  }

  function embed() {
    const els = surface('embed');
    const fallback = document.getElementById('embed-fallback');
    const start = document.getElementById('embed-start');
    const open = document.getElementById('embed-open');

    // A cut-off or broken link reads as incomplete (client-page.js linkToken).
    const params = new URLSearchParams(location.search);
    if (params.get('theme') === 'paper' && document.documentElement) {
      document.documentElement.setAttribute?.('data-theme', 'paper');
      if (document.documentElement.dataset) document.documentElement.dataset.theme = 'paper';
    }
    const raw = params.get('t') || '';
    const link = window.VeyletClientPage?.linkToken?.(location.search) || { token: raw, complete: raw.length >= 16 };
    const token = link.complete ? link.token : '';
    // Suppression only: this hint never changes share authorization or access.
    const ownerPreview = new URLSearchParams(location.search).get('preview') === 'owner';
    // Views for the agent's desk: an embed's channel is embed unless its link
    // says otherwise, and the site framing it is named by hostname only.
    const beacon = ownerPreview || token.length < 16 || !window.VeyletClientPage?.viewBeacon ? null : window.VeyletClientPage.viewBeacon({
      config: window.VEYLET_SUPABASE,
      token,
      src: window.VeyletClientPage.channelFrom(location.search, 'embed'),
      host: window.VeyletClientPage.referrerHost(document.referrer),
      // ?analytics=off (owner QA) holds for the whole tab, as the page counter keeps it: no visit summary is ever sent from such a tab.
      analyticsOff: analyticsOff(),
    });
    if (typeof window.VeyletPlayer === 'undefined') {
      els.title.textContent = 'This walkthrough is not available.';
      els.body.textContent =
        'The walkthrough couldn’t be loaded just now. Check your connection and reload the page.';
    } else if (!link.complete) {
      window.VeyletPlayer.showIncomplete({ ...els, actions: null, retry: null });
    } else {
      const baseOpenHref = 'https://veylet.com/handoff?t=' + encodeURIComponent(token);
      const safeHash = () => (typeof location.hash === 'string' && /^#[A-Za-z0-9_=&.-]{1,64}$/.test(location.hash) ? location.hash : '');
      const syncOpenHref = () => { open.href = baseOpenHref + safeHash(); };
      syncOpenHref();
      if (typeof window.addEventListener === 'function') window.addEventListener('hashchange', syncOpenHref);
      // Report shows for any complete-looking token, whatever the lookup says.
      window.VeyletClientPage?.mountReport?.(document.getElementById('embed-report'), token);
      // The share is looked up (lookup_tour_share, one REST call) BEFORE Explore is
      // offered: a dead or unknown link reads as the handoff page does, with nothing
      // to press and no download. An error or no answer offers Explore as before:
      // starting looks the share up again and explains its own failure.
      const offer = () => { open.hidden = false; start.hidden = false; els.status.textContent = ''; fallback.dataset.invite = 'shown'; };
      // The same words, and the same Try again, as /handoff and /tour (tour-player.js WORDS).
      const dead = () => {
        start.hidden = true; open.hidden = true; els.status.textContent = '';
        delete fallback.dataset.invite;
        // Only paused, and by whom? Asked once; without a name the missing words show as before.
        window.VeyletPlayer.showMissing(els, { client: shareClient, token });
      };
      const shareClient = window.VeyletClientPage?.restClient?.(window.VEYLET_SUPABASE) || null;
      if (shareClient) {
        els.status.textContent = 'Checking this walkthrough…';
        Promise.race([
          Promise.resolve(shareClient.rpc('lookup_tour_share', { p_token: token })),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]).then((answer) => {
          if (!answer || answer.error) { offer(); return; }
          const row = lib.firstRow(answer.data);
          if (row && (row.storage_path || row.package_base_url)) offer(); else { dead(); return; }
          // A streamed walkthrough's own poster behind the invitation: its manifest only, nothing 3D.
          if (row.package_format_version === 2 && row.package_base_url && window.VeyletClientPage?.invitationPoster) {
            const portrait = typeof window.innerWidth === 'number' && window.innerWidth < window.innerHeight;
            window.VeyletClientPage.invitationPoster({ base: row.package_base_url, portrait }).then((poster) => {
              if (!poster || !fallback.style) return;
              fallback.style.setProperty('--embed-poster', 'url("' + poster + '")');
              fallback.dataset.poster = 'shown';
            });
          }
        }, offer);
      } else offer();
      // The agent's name under the invitation, when the server returns their
      // opt-in contact for this live link. No account SDK before Explore: a
      // page that already has it reuses it, otherwise one REST call. Any
      // error, or a backend without the function yet, leaves the line out.
      const page = window.VeyletClientPage;
      const agent = document.getElementById('embed-agent');
      if (page && agent) {
        const contactClient = window.supabase && window.supabase.createClient && window.VeyletPlayer.clientFor
          ? window.VeyletPlayer.clientFor(AUTH)
          : page.restClient(window.VEYLET_SUPABASE);
        page.lookupContact(contactClient, token).then((contact) => {
          if (!contact) return;
          agent.textContent = page.agentLine(contact);
          agent.hidden = false;
        });
      }
      // Only say what starting costs once there is something to press.
      els.body.textContent =
        'Tap a numbered circle to move. Drag to look around. The walkthrough downloads when you start, so give it a moment on mobile data.';
      start.addEventListener('click', async () => {
        if (start.hidden) return;
        start.disabled = true;
        start.hidden = true;
        delete fallback.dataset.invite;
        // Keep the whole panel while the viewport is still empty; drop to
        // the compact notice the moment the viewer is on screen.
        fallback.dataset.mode = 'preparing';
        await bootShare(token, {
        els,
        // On an iPhone (no element fullscreen) the fullscreen button opens the full page.
        fullscreenUrl: open.href,
        // A streamed walkthrough carries its own status line; a version 1
        // frame shares the viewport with the compact notice.
        onVisible: () => {
          if (els.stage && !els.stage.hidden) fallback.hidden = true;
          else fallback.dataset.mode = 'loading';
        },
        resolve: async (client) => {
          const { row, source } = await resolveShare(client, token, 'Shared space');
          beacon?.opened(window);
          engage(els, ownerPreview, token, row);
          return source;
        },
      }).catch(() => window.VeyletPlayer.showFailure(
        { ...els, actions: document.getElementById('tour-actions'), retry: document.getElementById('tour-retry') },
        { body: 'The walkthrough could not start. Check the connection and try again.', retry: true }
      ));
        // A loading notice shares the viewport with the renderer; it must
        // never push the iframe below the visible agency embed. Restore the
        // full notice on a startup error. A visible frame owns its rendered
        // scene or photograph/error/retry UI; never cover it with a second notice.
        fallback.dataset.mode = 'notice';
        fallback.hidden = !(els.frame.hidden && (!els.stage || els.stage.hidden));
      }, { once: true });
    }
  }

  function handoff() {
    const els = surface('handoff');
    const meta = document.getElementById('handoff-meta');
    const wrap = document.getElementById('tour-frame-wrap');
    const trouble = document.getElementById('client-trouble');
    const page = window.VeyletClientPage;
    // A cut-off or broken link reads as incomplete (client-page.js linkToken); without that
    // script, the old rule: anything of 16 characters or more is looked up.
    const raw = new URLSearchParams(location.search).get('t') || '';
    const link = page?.linkToken?.(location.search) || { token: raw, complete: raw.length >= 16 };
    const token = link.complete ? link.token : '';
    // Suppression only: this hint never changes share authorization or access.
    const ownerPreview = new URLSearchParams(location.search).get('preview') === 'owner';
    // The held places (see the head script) go once the walkthrough is on
    // screen or has failed; the card's sooner when the contact answers, or
    // after a short wait (client-page.js, showWalkthrough).
    const root = document.documentElement;
    const releaseHeld = () => root?.classList.remove('client-pending', 'client-contact-pending');
    page?.mountColumns(document, window);
    page?.mountReport?.(document.getElementById('client-report'), token);
    // Views for the agent's desk: one first-party call per event, never in the way.
    const beacon = ownerPreview || !link.complete ? null : page?.viewBeacon?.({
      config: window.VEYLET_SUPABASE,
      token,
      src: page.channelFrom(location.search, 'unknown'),
      host: null,
      // ?analytics=off (owner QA) holds for the whole tab, as the page counter keeps it: no visit summary is ever sent from such a tab.
      analyticsOff: analyticsOff(),
    });

    // A link to a stop (#stop=N), Share and the agent inside the player (client-page.js visitLink).
    const visit = link.complete ? page?.visitLink?.({ window, document, location, navigator, token, beacon }) : undefined;

    function sharedLabel(value) {
      if (!value) return '';
      const when = new Date(value);
      if (Number.isNaN(when.getTime())) return '';
      return 'Shared ' + when.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }

    const searchParams = new URLSearchParams(location.search);
    const isSamplePitch = !link.complete && searchParams.get('sample') === '1';

    if (isSamplePitch) {
      releaseHeld();
      const sampleBanner = document.getElementById('handoff-sample-banner');
      if (sampleBanner) sampleBanner.hidden = false;
      const sampleTitle = 'Sample two-bedroom apartment';
      const sampleContact = page?.contactFrom?.([{
        display_name: searchParams.get('name') || 'Your name',
        agency: searchParams.get('agency') || '',
        phone: searchParams.get('phone') || '+61 400 000 000',
        email: searchParams.get('email') || '',
      }]) || null;
      window.VeyletPlayer.boot({
        els,
        auth: AUTH,
        resolve: async () => {
          if (wrap) wrap.hidden = false;
          if (els.body) els.body.textContent = '';
          const truth = document.getElementById('client-truth');
          if (truth) truth.hidden = false;
          const help = document.getElementById('client-help');
          if (help) help.hidden = false;
          page?.showContact?.(document, sampleContact, sampleTitle, null, false);
          return {
            storagePath: 'samples/eyeful-apartment/manifest.json',
            packageFormatVersion: 2,
            packageBaseUrl: '/samples/eyeful-apartment/',
            title: sampleTitle,
            intro: '',
            footer: '',
          };
        },
        client: true,
      });
    } else if (!link.complete) {
      releaseHeld();
      // The words for a dead or broken link are the player's, shared with /tour and /embed.
      window.VeyletPlayer.showIncomplete(els);
    } else {
      // A definitive miss: another browser will not help, so the trouble line goes.
      let unavailable = false;
      bootShare(token, {
        els,
        auth: AUTH,
        resolve: async (client) => {
          // Both lookups start together, so the card is usually settled in
          // the step the walkthrough is found. The contact function answers
          // no row for a dead or paused token, and its lookup never rejects.
          const sharePromise = resolveShare(client, token, 'Shared space');
          const contact = page?.lookupContact?.(client, token) ?? null;
          let row, source;
          try {
            ({ row, source } = await sharePromise);
          } catch (failure) {
            // A definitive miss: another browser will not help.
            if (failure && failure.message === 'share-not-found') unavailable = true;
            throw failure;
          }
          // The frame is the product, so it gets a shell rather than sitting bare.
          if (wrap) wrap.hidden = false;
          if (meta) {
            const label = sharedLabel(row.shared_at);
            meta.textContent = label;
            meta.hidden = !label;
            // No date: its held line goes now, while the stage is still unseen.
            if (!label) meta.classList.add('tour-meta-none');
          }
          const title = row.space_title || 'Shared space';
          if (els.body) els.body.textContent = '';
          beacon?.opened(window);
            engage(els, ownerPreview, token, row);
          // Truth line, Share, movement help and the agent card. The contact
          // lookup runs beside the walkthrough and never holds it up.
          // Optional Release 5 context enrichment (facts bar, agency brand, inline enquiry sheet) via REST.
          const rest = page?.restClient?.(window.VEYLET_SUPABASE);
          const enquiryOpts = rest ? { token, enquiryClient: rest, hooksUrl: window.VEYLET_HOOKS?.url || '' } : undefined;
          const contextLookup = rest && page?.lookupHandoffContext ? page.lookupHandoffContext(rest, token) : null;
          let handoffContextApplied = false;
          let appliedBrand = null;
          let visitContactSent = false;
          const sendVisitContact = resolved => {
            if (visitContactSent) return;
            visitContactSent = true;
            visit?.setContact?.(resolved);
          };
          page?.showWalkthrough({
            document,
            location,
            navigator,
            client,
            token,
            title,
            streamed: row.package_format_version === 2,
            beacon,
            contact,
            visit,
            enquiryOpts,
            deferVisitContact: Boolean(contextLookup),
            shouldApplyContact: () => !handoffContextApplied,
            onContactShown: () => { if (appliedBrand) page.applyBrand?.(document, appliedBrand); },
          });
          if (contextLookup) {
            contextLookup.then(ctx => {
              if (ctx) {
                if (ctx.facts) page.showCampaignFacts(document, ctx.facts, title, page.shareUrl(location, token));
                if (ctx.brand) appliedBrand = ctx.brand;
                if (ctx.contact) {
                  handoffContextApplied = true;
                  const card = document.getElementById('agent-card');
                  const alreadyShown = Boolean(card && !card.hidden && !card.classList?.contains?.('agent-card-late'));
                  const late = !alreadyShown && !document.documentElement?.classList?.contains?.('client-contact-pending');
                  page.showContact(document, ctx.contact, title, beacon, late, enquiryOpts);
                  sendVisitContact(ctx.contact);
                  document.documentElement?.classList?.remove?.('client-contact-pending');
                }
                if (ctx.brand) page.applyBrand(document, ctx.brand);
              }
              if (!ctx?.contact) {
                Promise.resolve(contact).then(basic => {
                  if (!handoffContextApplied) sendVisitContact(basic || null);
                });
              }
            }).catch(() => {
              Promise.resolve(contact).then(basic => {
                if (!handoffContextApplied) sendVisitContact(basic || null);
              }).catch(() => {});
            });
          }
          return { ...source, footer: '' };
        },
        visit,
        // Called in the same step that reveals the frame or the stage. A phone
        // on its side brings the walkthrough to the top of its short screen.
        onVisible: () => {
          releaseHeld();
          page?.settleStage?.(window, els.stage);
        },
      }).then((result) => {
        releaseHeld();
        const missing = unavailable || result?.outcome === 'missing';
        if (missing && trouble) trouble.hidden = true;
        // Nothing left on the stage (a failure the player explained above):
        // no empty shell, and nothing that says a walkthrough is here. The
        // truth line, the date, Share and the help for controls all go; the
        // agent's card and bar stay, because the agent is the next step.
        if (els.frame.hidden && els.stage.hidden) {
          if (wrap) wrap.hidden = true;
          for (const id of ['client-help', 'client-share', 'client-truth', 'handoff-meta']) {
            const node = document.getElementById(id);
            if (node) node.hidden = true;
          }
          const shared = document.getElementById('client-share-status');
          if (shared) shared.textContent = '';
        }
      });
    }
  }

  function tour() {
    const els = surface('tour');
    const notice = document.getElementById('tour-notice');
    const truth = document.getElementById('tour-truth');
    const help = document.getElementById('tour-help');
    const player = window.VeyletPlayer;
    const page = window.VeyletClientPage;
    // A cut-off or broken link reads as incomplete (client-page.js linkToken).
    const raw = new URLSearchParams(location.search).get('t') || '';
    const link = page?.linkToken?.(location.search) || { token: raw, complete: raw.length >= 16 };
    const token = link.complete ? link.token : '';

    // Unbranded: the player names the tab "… — Veylet"; this page keeps it plain.
    const titleEl = document.querySelector('title');
    const plainTitle = () => { if (/ — Veylet$/.test(document.title)) document.title = document.title.replace(/ — Veylet$/, ''); };
    if (titleEl && typeof MutationObserver === 'function') new MutationObserver(plainTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });

    // Views for the agent's desk: the channel is portal unless the link says
    // otherwise; framed on another site, that site's hostname and nothing more.
    let framed = false;
    try { framed = window.top !== window.self; } catch { framed = true; }
    const beacon = !link.complete || !page?.viewBeacon ? null : page.viewBeacon({
      config: window.VEYLET_SUPABASE,
      token,
      src: page.channelFrom(location.search, 'portal'),
      host: framed ? page.referrerHost(document.referrer) : null,
      // ?analytics=off (owner QA) holds for the whole tab, as the page counter keeps it: no visit summary is ever sent from such a tab.
      analyticsOff: analyticsOff(),
    });

    page?.mountReport?.(document.getElementById('tour-report'), token, document.getElementById('tour-foot'));
    if (!player) {
      els.title.textContent = 'This walkthrough isn’t available right now.';
      els.body.textContent = 'The walkthrough couldn’t be loaded just now. Check your connection and reload the page.';
      return;
    }
    if (!link.complete) {
      player.showIncomplete({ ...els, actions: null, retry: null });
      plainTitle();
      return;
    }
    let unavailable = false;
    // In a portal's frame on an iPhone (no element full screen), Full screen opens this page on its own.
    const safeHash = typeof location.hash === 'string' && /^#[A-Za-z0-9_=&.-]{1,64}$/.test(location.hash) ? location.hash : '';
    const own = typeof location.origin === 'string' && location.origin.startsWith('https://')
      ? location.origin + location.pathname + '?t=' + encodeURIComponent(token) + safeHash : undefined;
    bootShare(token, {
      els,
      fullscreenUrl: own,
      onVisible: () => {
        // A streamed walkthrough carries its own status; a version 1 frame
        // shares the stage with the compact notice.
        if (els.stage && !els.stage.hidden) notice.hidden = true;
        else notice.dataset.mode = 'loading';
      },
      resolve: async (client) => {
        let source;
        try {
          ({ source } = await resolveShare(client, token, 'Property walkthrough'));
        } catch (failure) {
          if (failure && failure.message === 'share-not-found') unavailable = true;
          throw failure;
        }
        if (truth) truth.hidden = false;
        beacon?.opened(window);
        return { ...source, footer: '' };
      },
    }).then(() => {
      // A definitive miss: another browser will not help.
      if (unavailable && help) help.hidden = true;
      delete notice.dataset.mode;
      // Nothing on the stage (a failure the player explained): the notice stays.
      notice.hidden = !(els.frame.hidden && els.stage.hidden);
      plainTitle();
    });
  }

  window.VeyletTourPage = Object.freeze({ embed, handoff, tour });
})();
