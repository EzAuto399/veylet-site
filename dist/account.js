'use strict';
/*
 * Veylet desk: email sign-in plus the operator's own spaces and handoffs.
 * supabase-js loads from /vendor before this file, so there is no CDN module
 * import that can fail silently.
 */
(async () => {
  const cfg = window.VEYLET_SUPABASE;
  // The page the iPhone app opens (/app/account) carries data-app-mode="true" on
  // <html>: the same desk with every money block left out (plan purchase, card
  // forms, bundles, fast renders, referral bonuses and links to the public
  // offer), and the plan said in state words only. tests/app-pages.test.cjs
  // renders it and fails on any amount or purchase word.
  const APP_MODE = document.documentElement?.dataset?.appMode === 'true';
  const statusEl = document.getElementById('account-status');
  const signInForm = document.getElementById('account-sign-in');
  const verifyForm = document.getElementById('account-verify');
  const verifyEmail = document.getElementById('account-verify-email');
  const verifyRestart = document.getElementById('account-verify-restart');
  const verifyResend = document.getElementById('account-verify-resend');
  const signInSubmit = document.getElementById('account-sign-in-submit');
  const verifySubmit = verifyForm?.querySelector('button[type="submit"]');
  const gateTitle = document.getElementById('account-gate-title');
  const gateBody = document.getElementById('account-gate-body');
  const spaceForm = document.getElementById('account-space');
  const home = document.getElementById('account-home');
  const who = document.getElementById('account-who');
  const idEl = document.getElementById('account-id');
  const copyId = document.getElementById('account-copy-id');
  const list = document.getElementById('account-properties');
  const signOut = document.getElementById('account-sign-out');
  const targetStatus = document.getElementById('account-target-status');
  const nextStep = document.getElementById('account-next-step');
  // The URL selects an already-authorized row; it never grants access or
  // supplies a storage path, review revision, or publication permission.
  const tourTargets = new URLSearchParams(location.search || '').getAll('tour');
  const requestedTour = tourTargets.length === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(tourTargets[0])
    ? tourTargets[0] : null;
  const invalidTourTarget = tourTargets.length > 0 && !requestedTour;
  const tourQuery = requestedTour ? '?tour=' + encodeURIComponent(requestedTour) : '';
  let focusedTourForUser = null;
  // The walkthrough the link asked for, or, once a later version replaced it, that
  // walkthrough's current version. Worked out again on every desk load.
  let deskTarget = requestedTour;
  // Another office's referral link (/account?ref=<code>). The code only names that
  // office; it is kept for this browser session so it survives signing in, and it is
  // recorded only when the new office's owner presses Record (claim_workspace_referral).
  const REFERRAL_CODE = /^[0-9a-f]{12}$/;
  const REFERRAL_KEY = 'veylet-referred-by';
  const referralTargets = new URLSearchParams(location.search || '').getAll('ref');
  const referralFromLink = !APP_MODE && referralTargets.length === 1 && REFERRAL_CODE.test(referralTargets[0].toLowerCase())
    ? referralTargets[0].toLowerCase() : null;
  function referredKept() {
    try { const kept = window.sessionStorage?.getItem(REFERRAL_KEY); return kept && REFERRAL_CODE.test(kept) ? kept : null; } catch { return null; }
  }
  let referredBy = APP_MODE ? null : referralFromLink || referredKept();
  if (referralFromLink) { try { window.sessionStorage?.setItem(REFERRAL_KEY, referralFromLink); } catch { /* this page load still has it */ } }
  // Signing in to accept a team invite (/join sends the person here as /account?join=1):
  // the email link comes back through /auth/callback?join=1, and either way a signed-in
  // session goes straight back to /join, which keeps the invite itself out of every address.
  const joinReturn = !APP_MODE && new URLSearchParams(location.search || '').get('join') === '1';
  function referredForget() {
    referredBy = null;
    try { window.sessionStorage?.removeItem(REFERRAL_KEY); } catch { /* nothing kept to clear */ }
  }

  // A tour's state belongs in a pill, not in a sentence nobody reads twice. The
  // words are the render-status contract's, the same in the app (property-3d-studio
  // docs/render-status-contract-20260925.md, "After review, and one vocabulary"):
  // a draft is at its automatic quality check (Rendering, step 5), a processing job is
  // rendering; no person checks a walkthrough. A ready walkthrough's
  // chip waits for its review answer (Ready for your review, Sharing off) or its
  // link (Live, Hosting ended).
  const TOUR_STATE = {
    draft: { label: 'Rendering', tone: 'busy' },
    processing: { label: 'Rendering', tone: 'busy' },
    revoked: { label: 'Unavailable', tone: 'quiet' },
  };
  // The contract's words after review, said once each.
  const LIVE_SAID = 'Live. Anyone with the link can open it.';
  const LIVE_LINE = 'Anyone with the link can open it.';
  const READY_TITLE = 'Ready for your review';
  const SHARE_UNCONFIRMED = 'Approved. Sharing didn’t turn on. Try again.';
  // Paused sharing keeps the link (pause_tour_share / resume_tour_share). The tours
  // Worker caches a link's lookup for up to 50 s, so a pause or a resume reaches
  // viewers within a minute, and the words say so.
  const PAUSED_LINE = 'Paused. Within a minute, the link, embed and QR show "not available" until you resume; the link stays the same.';
  const PAUSED_SAID = 'Sharing paused. Resume sharing opens the same link again.';
  const RESUMED_SAID = 'Sharing resumed. Within a minute, the same link, embed and QR open the walkthrough again.';
  const PAUSE_HINT = 'Stops the link, embed and QR for now and keeps the same link, so printed QR codes work again when you resume.';
  // Where each link is handed out, so the walkthrough's views can say which one was
  // opened (record_tour_view's src). The token stays the only secret in the link.
  const LISTING_BASE = 'https://veylet.com/tour?t=';
  function tagged(url, src) { return url + '&src=' + src; }
  // enable_tour_share's refusals (20260920120000, 20260923150000), by the words it
  // raises: "Approved. Sharing waits for {reason}." and the one fix for it.
  // The listing gate's two (release-2 drafts, not released) also refuse resume_tour_share
  // and request_listing_exports; their fix is the listing's question or consent form.
  const SHARE_REFUSALS = [
    ['review this tour before sharing', 'review'],
    ['tour uploader membership is no longer active', 'uploader'],
    ['sharing permission required', 'permission'],
    ['occupancy not declared', 'occupancy'],
    ['tenant consent required', 'consent'],
  ];
  const SHARE_WAITS = {
    review: 'a fresh review of this version',
    uploader: 'the person who captured it to be back in your workspace',
    permission: 'someone with sharing permission',
    occupancy: 'you to say whether anyone lives here',
    consent: 'the tenant’s signed consent',
  };
  // Approvals whose sharing did not turn on, until their card is drawn again.
  const sharePending = new Map();
  // Each walkthrough's state chip, so a space's render status can stand in for it.
  const tourChips = new Map();
  // Each drawn walkthrough's review answer (get_tour_review), for the next step.
  const tourApproval = new Map();
  let renderCovered = new Map();

  let lastEmail = '';
  let lastRoleIntent = 'owner';
  let currentUserId = null;
  // The signed-in email and when the account was first confirmed: the email
  // preferences use them to find a tick given on the sign-in form.
  let currentUserEmail = '';
  let currentUserConfirmedAt = null;
  let deskVersion = 0;
  let authVersion = 0;
  let signInVersion = 0;
  let verifyingCode = false;
  let savingSpace = false;
  let resendTimer = null;
  // Feedback belongs beside the control that caused it. The page-level status
  // stays the single live region; a row repeats the text where the person is looking.
  let rowNotice = null;
  let lastDesk = null;
  let deskDirty = false;
  // When this account's spaces were last drawn from a successful read: offline, the
  // desk stays as it was and says how old it is.
  let deskShownAt = 0;
  // A desk read in flight. A reload of a drawn desk reads first and redraws only
  // when the read works, so a lost connection never empties the page.
  let deskReadVersion = 0;
  // The release review is the desk's real job, so the guidance opens it rather
  // than dropping the reader beside a closed disclosure. Rebuilt every load.
  const reviewOpeners = new Map();
  let pollTimer = null;
  const updatedEl = document.getElementById('account-updated');
  const exportButton = document.getElementById('account-export');

  const generalLocationProblem = (value) => window.VeyletPlace.generalLocationProblem(value);

  /** Turn a provider error into something a person can act on. */
  function signInProblem(error, phase) {
    const message = String((error && (error.message || error.error_description)) || '').toLowerCase();
    const status = (error && (error.status || error.code)) || '';
    if (message.includes('rate') || message.includes('too many') || status === 429) {
      return 'Too many sign-in emails have been requested for that address. Wait about an hour and try again — the six-digit code in the email you already have still works.';
    }
    // Address problems are about the request, not about a code the person never received.
    if (message.includes('validate email') || message.includes('invalid format') || message.includes('unable to validate')) {
      return 'That email address was rejected. Check it for a typo and try again.';
    }
    if (phase === 'code') {
      return 'That code is wrong or has expired. Send a new link, or use the six-digit code from the newest email.';
    }
    return 'Could not send the link. Check the email address and try again.';
  }

  function startResendCooldown(seconds) {
    if (!verifyResend) return;
    let remaining = seconds;
    verifyResend.disabled = true;
    verifyResend.textContent = `Send a new link (${remaining}s)`;
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimer);
        resendTimer = null;
        verifyResend.disabled = verifyingCode;
        verifyResend.textContent = 'Send a new link';
        return;
      }
      verifyResend.textContent = `Send a new link (${remaining}s)`;
    }, 1000);
  }

  function stopResendCooldown() {
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = null;
    if (verifyResend) {
      verifyResend.disabled = false;
      verifyResend.textContent = 'Send a new link';
    }
  }

  // Email requests can finish after another tab signs in or the person changes
  // their email. Retire that intent before allowing any response to update UI.
  function resetSignInAttempt() {
    signInVersion += 1;
    verifyingCode = false;
    lastEmail = '';
    lastRoleIntent = 'owner';
    stopResendCooldown();
    if (signInSubmit) signInSubmit.disabled = false;
    if (verifySubmit) verifySubmit.disabled = false;
    if (verifyRestart) verifyRestart.disabled = false;
    verifyForm?.reset();
  }

  async function requestLink(email, roleIntent = lastRoleIntent) {
    const result = await settled(
      supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'https://veylet.com/auth/callback' + (joinReturn ? '?join=1' : tourQuery),
          data: { role_intent: roleIntent === 'operator' ? 'operator' : 'owner' },
        },
      })
    );
    return result.error || (result.value && result.value.error) || (result.timedOut ? new Error('timeout') : null);
  }

  function setStatus(value) {
    if (statusEl) statusEl.textContent = value;
  }

  /** Never leave the desk waiting on one unanswered request. */
  async function settled(promise, ms) {
    let timer = null;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), ms || 20000);
    });
    const result = await Promise.race([
      promise.then((value) => ({ value })).catch((error) => ({ error })),
      expired,
    ]);
    if (timer) clearTimeout(timer);
    return result;
  }

  /**
   * A request can fail because the session died rather than because the call was
   * wrong. Those need sign-in, not a retry, so they are classified separately.
   */
  function sessionGone(result) {
    const candidates = [result && result.error, result && result.value && result.value.error];
    return candidates.some((error) => {
      if (!error) return false;
      const text = String(error.message || error.error_description || '').toLowerCase();
      const code = String(error.code || error.status || '');
      return (
        code === '401' ||
        code === 'PGRST301' ||
        text.includes('jwt expired') ||
        text.includes('invalid jwt') ||
        text.includes('token is expired') ||
        text.includes('not signed in') ||
        text.includes('refresh token')
      );
    });
  }

  /*
   * Offline is not an outage. The browser saying so (navigator.onLine false), or a
   * read that never reached the server (fetch's network TypeError, which supabase-js
   * reports as "TypeError: Failed to fetch" and similar), keeps the last status on
   * the page with its time. A server's own error keeps its own words.
   */
  const NETWORK_WORDS = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network connection was lost|internet connection appears to be offline/i;
  function offlineNow() {
    try { return typeof navigator !== 'undefined' && navigator?.onLine === false; } catch { return false; }
  }
  function networkFailed(result) {
    return [result?.error, result?.value?.error].some(error => {
      if (!error) return false;
      const text = String(error.message || '');
      return (error.name === 'TypeError' || /TypeError|FetchError/.test(text)) && NETWORK_WORDS.test(text);
    });
  }
  function offlineWords(at) {
    return at ? 'You’re offline. Showing the status from ' + new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '.'
      : 'You’re offline. Your spaces load when you’re back online.';
  }

  function sessionHeading(signedIn) {
    const title = document.getElementById('account-title');
    const intro = document.getElementById('account-intro');
    const setup = document.getElementById('account-setup-note');
    const access = document.getElementById('account-access-note');
    // "Sign in" is where a signed-in person already is. Say where they are.
    const navLink = document.querySelector?.('header nav a[aria-current="page"]');
    if (navLink) navLink.textContent = signedIn ? 'Account' : 'Sign in';
    // Signed in, the page is the account; "Your walkthroughs" heads its work
    // section, so the page heading does not repeat it.
    if (title) title.textContent = signedIn ? 'Your account.' : 'Sign in to your account.';
    if (intro) intro.textContent = signedIn ? (APP_MODE ? 'Check your walkthroughs, review them and share them.' : 'Save a space, check its progress and share the reviewed tour.')
      : joinReturn ? 'Sign in to accept your team invite. Use the email address the invite was sent to.' : 'Use the same email on the website and capture app.';
    if (setup) setup.hidden = signedIn;
    if (access) access.hidden = signedIn;
    // Arrived through another office's link: one line at the sign-in gate; the desk records it after sign-in.
    const referred = document.getElementById('account-referred');
    if (referred) {
      referred.textContent = referredBy ? 'An office referred you to Veylet. When your office first pays, you and that office each get ' +
        REFERRAL_WALKTHROUGHS + ' bonus walkthrough.' : '';
      referred.hidden = signedIn || !referredBy;
    }
  }
  function showSignedOut(message) {
    stopPolling(); lastDesk = null; rowNotice = null; deskShownAt = 0;
    sharePending.clear(); tourChips.clear(); tourApproval.clear(); renderCovered = new Map();
    listingGates.clear(); gateNotices.clear(); gateFocus = null;
    clientsHide();
    teamHide();
    emailHide();
    if (updatedEl) updatedEl.textContent = '';
    resetSignInAttempt();
    sessionHeading(false);
    currentUserId = null;
    currentUserEmail = ''; currentUserConfirmedAt = null;
    focusedTourForUser = null;
    deskVersion += 1;
    list?.replaceChildren();
    nextStep?.replaceChildren();
    planBody?.replaceChildren();
    planPanel?.setAttribute('aria-busy', 'false');
    planCapacityRefresh = null;
    planNotice = null;
    trialHide();
    expressHide();
    renderForget();
    packsHide();
    annualHide();
    referralHide();
    deletionPanel?.replaceChildren();
    deletionPanel?.setAttribute('aria-busy', 'false');
    if (signInForm) {
      signInForm.dataset.awaitingCode = 'no';
      signInForm.hidden = false;
    }
    if (verifyForm) verifyForm.hidden = true;
    if (home) home.hidden = true;
    signupTipsOffer(supabase);
    setStatus(message);
  }

  function pill(text, tone) {
    const span = document.createElement('span');
    span.className = 'pill' + (tone ? ' pill-' + tone : '');
    span.textContent = text;
    return span;
  }

  /* A walkthrough is one job for the account, whatever number of packages it
   * takes. A correction the studio recorded is a later version of the same
   * walkthrough (walkthrough_id, revision); a version a later approved one
   * replaced (superseded_at) is not shown. Before the lineage columns exist,
   * every tour is version 1 of its own walkthrough. */
  function walkthroughOf(tour) { return typeof tour?.walkthrough_id === 'string' && tour.walkthrough_id ? tour.walkthrough_id : tour?.id; }
  function revisionOf(tour) { return Number.isInteger(tour?.revision) && tour.revision >= 1 ? tour.revision : 1; }
  // The short reference the studio, the corrections email and this desk all use.
  function walkthroughRef(tour) { return 'walkthrough ' + String(walkthroughOf(tour) || '').slice(0, 8); }

  // Its guaranteed hosting has passed and no plan carries it: get_tour_hosting's
  // dates only. A date passing switches nothing off, so the card keeps its controls.
  function hostingEnded(row, now = Date.now()) {
    if (!row || typeof row !== 'object' || !row.released_at || row.plan_active !== false) return false;
    const until = Date.parse(row.hosted_until || '');
    return !Number.isNaN(until) && now >= until;
  }
  // One state chip per walkthrough, first in its row. A later answer (its review)
  // replaces it; a space's render status that already says the same words hides it.
  function tourChip(tour, text, tone) {
    const entry = tourChips.get(tour.id);
    if (!entry) return;
    const chip = text ? pill(text, tone) : null;
    if (chip) chip.dataset.chip = 'state';
    const rest = [...entry.row.children].filter(child => child.dataset?.chip !== 'state');
    entry.row.replaceChildren(...(chip ? [chip] : []), ...rest);
    entry.chip = chip;
    chipsSync();
  }
  function chipsSync() {
    for (const [id, entry] of tourChips) {
      if (entry.chip) entry.chip.hidden = renderCovered.get(id) === entry.chip.textContent;
    }
  }
  // A link kept but paused (tours.share_paused_at, set by pause_tour_share).
  function sharePaused(tour) { return Boolean(tour?.share_token) && Boolean(tour?.share_paused_at); }
  // The hosting line in the words the app uses. The pages the app opens state no
  // amount: a sentence that names one is left out there.
  function hostingWords(row, live) {
    const line = window.VeyletSharing.hostingLine(row, live);
    if (!APP_MODE || !/\$/.test(line)) return line;
    return (line.replace(/\s*\([^)]*\$[^)]*\)/g, '').match(/[^.]+\./g) || []).filter(sentence => !/\$/.test(sentence)).join('').trim();
  }
  function tourMeta(tour, hosting) {
    const wrap = document.createElement('p');
    wrap.className = 'tour-meta-row';
    tourChips.set(tour.id, { row: wrap, chip: null });
    // A walkthrough whose link works is live; that one word is its state. A ready
    // one without a link waits for its review answer before it says anything.
    let state = null;
    if (tour.status === 'ready' && sharePaused(tour)) state = { label: 'Paused', tone: 'quiet' };
    else if (tour.status === 'ready' && tour.share_token) state = hostingEnded(hosting) ? { label: 'Hosting ended', tone: 'quiet' } : { label: 'Live', tone: 'good' };
    else if (tour.status !== 'ready') state = TOUR_STATE[tour.status] || null;
    if (state) { const chip = pill(state.label, state.tone); chip.dataset.chip = 'state'; wrap.append(chip); tourChips.get(tour.id).chip = chip; }
    if (revisionOf(tour) > 1) wrap.append(pill('Correction', 'quiet'));
    if (tour.created_at) {
      const when = document.createElement('span');
      when.className = 'tour-when';
      // Same day format as the hosting line on this card, so two dates never disagree in style.
      const added = window.VeyletSharing?.hostingDate?.(tour.created_at);
      if (added) { when.textContent = 'Added ' + added; wrap.append(when); }
    }
    return wrap;
  }

  const reviewChecks = {
    coverage: 'Every included room and required surface is present.',
    alignment: 'Walls, furniture and edges stay aligned while turning.',
    navigation: 'Viewpoints and movement do not cross walls or expose broken areas.',
    privacy: 'People, documents, screens and excluded areas have been checked.',
    mobile: 'This exact tour has been checked on a physical phone.',
  };
  function failed(result) { return result.timedOut || result.error || result.value?.error; }
  function firstRow(data) { return Array.isArray(data) ? data[0] : data; }
  function guide(title, body, label, action) {
    if (!nextStep) return;
    // The heading carries the panel; a tracked-caps kicker above it says nothing.
    const heading = document.createElement('h2'); heading.textContent = title;
    const detail = document.createElement('p'); detail.textContent = body;
    nextStep.replaceChildren(heading, detail);
    if (!label) return;
    // The app's pages link only to one another: a page on the public site is left out.
    if (typeof action === 'string' && APP_MODE && !action.startsWith('/app/')) return;
    if (typeof action === 'string') {
      const link = document.createElement('a'); link.className = 'button button-ghost'; link.href = action; link.textContent = label; nextStep.append(link);
    } else nextStep.append(button(label, action));
  }

  // Guidance describes already-visible records. It never approves, uploads,
  // publishes or infers a payment from a tour's status or share token.
  // `desk` carries the roles, hosting rows and whether review answers are still on
  // their way; a ready walkthrough's next step waits for its review answer rather
  // than guessing whether it is approved.
  function guideDesk(properties, rows, production, items, supabase, desk = {}) {
    if (!properties.length) {
      if (APP_MODE) { guide('Start with one space.', 'Create a space in Veylet Capture and capture it room by room. Its walkthrough appears here, ready for your review.'); return; }
      guide('Start with one space.', 'Save a name and general location. This prepares your desk for its first capture.', 'Add your first space', () => {
        document.getElementById('account-add-space').open = true;
        spaceForm?.querySelector('input[name="title"]')?.focus();
      });
      return;
    }
    const visible = rows.filter(row => items.has(row.id));
    const waiting = row => row.status === 'ready' && !row.share_token;
    // The reader's turn first (a walkthrough to review, then one to share), then as before:
    // live work, the automatic work, the unavailable.
    const order = [row => waiting(row) && tourApproval.get(row.id) !== true, row => waiting(row) && tourApproval.get(row.id) === true,
      row => row.status === 'ready', row => row.status === 'draft', row => row.status === 'processing', row => row.status === 'revoked'];
    const selected = visible.find(row => row.id === deskTarget) || order.flatMap(test => visible.filter(test))[0] || visible[0];
    if (selected) {
      const open = () => { const item = items.get(selected.id); item.tabIndex = -1; item.focus({ preventScroll: true }); item.scrollIntoView({ block: 'start', behavior: 'auto' }); };
      const hosting = desk.hosting ? desk.hosting.get(selected.id) || null : undefined;
      // A shared walkthrough is finished work, not a job still waiting on you.
      if (selected.status === 'ready' && sharePaused(selected)) {
        guide('Sharing is paused.', 'Its link, embed and QR show "not available" until you resume it from its card below. The link stays the same.', 'Open its sharing controls', open);
        return;
      }
      if (selected.status === 'ready' && selected.share_token) {
        if (hostingEnded(hosting)) guide('Guaranteed hosting has ended.', hostingWords(hosting, true), 'Open its sharing controls', open);
        else guide('Your walkthrough is live.',
          'Share it from its card below: the link, a QR code or your website’s embed code. Anyone with the link can open it; Turn off sharing, under Manage sharing, stops it working.',
          'Open its sharing controls', open);
        return;
      }
      if (waiting(selected)) {
        // Its review has not answered yet: keep "Checking your next step…" until it does.
        if (!tourApproval.has(selected.id) && desk.reviewsPending) return;
        const space = properties.find(row => row.id === selected.property_id);
        const listing = typeof space?.title === 'string' && space.title.trim() ? space.title.trim() : '';
        if (tourApproval.get(selected.id) === true) {
          // Sharing waits for the listing's answer or the tenant's consent: that is the next step.
          const gate = gateBlock(selected.property_id);
          if (gate && gateCanOpen(selected.property_id)) {
            guide(shareWords(gate), gate === 'consent' ? GATE_WORDS.guideConsent : GATE_WORDS.guideOccupancy, gateFixLabel(gate),
              () => gateOpen(selected.property_id, gate));
            return;
          }
          if (hosting?.released_at) guide('Sharing is off.', 'The link and embed show "not available" until you turn sharing back on from its card below.', 'Open its sharing controls', open);
          else guide('Approved. Sharing isn’t on yet.', 'Turn sharing on from its card below. Nobody else can see it until you do.', 'Open its sharing controls', open);
          return;
        }
        const reviews = ['owner', 'reviewer'].includes(desk.roles?.get(space?.workspace_id));
        // The same words as the space's render status, for the same press.
        if (reviews) guide((listing || 'Your walkthrough') + ' is ready for your review.', 'Open it, walk through, then approve and share. Nobody else can see it until you do.', 'Review walkthrough', () => {
          open();
          // Where a review is actually available, open it and land on it.
          reviewOpeners.get(selected.id)?.();
        });
        else guide((listing || 'Your walkthrough') + ' is ready for review.', 'The workspace owner opens it, walks through, then approves and shares it.', 'Open walkthrough details', open);
        return;
      }
      const actions = {
        draft: ['Your walkthrough is at its quality check.', 'Rendering, step 5 of 5: Checking quality. The check is automatic; the walkthrough opens for your review once it passes. You can open its preview below.', 'Open walkthrough details'],
        processing: ['Your walkthrough is being built.', 'You can leave this page and return later. Leaving does not cancel the work. It is usually ready for your review within 1–2 hours of the upload finishing; refresh to check for an update.', 'Refresh progress'],
        revoked: ['Resolve the unavailable walkthrough.', 'New access is blocked. Remove old links or embeds and contact Veylet support about the next step before sharing again.', 'Open tour details'],
      };
      const [title, body, label] = actions[selected.status] || ['Check the status with Veylet support.', 'The current tour needs an update from Veylet support before you continue.', 'Open tour details'];
      guide(title, body, label, selected.status === 'processing' ? () => loadDesk(supabase) : open);
    } else if (failed(production)) {
      guide('Check your capture access.', 'Your space is saved, but production approval could not be checked. Keep your existing capture and refresh before starting production work.', 'Refresh access', () => loadDesk(supabase));
    } else if (production.value?.data === true) {
      guide('Prepare one agreed capture.', 'Use your assessed device and the agreed scope. Inspect the saved photographs, keep the originals and confirm the transfer receipt before moving on.', 'See capture preparation', '/start#capture-partners');
    } else {
      guide('Prepare your first capture.', 'Your space is saved. Use Veylet Capture on a LiDAR iPhone or iPad for one practice capture. Export the saved capture to Files or AirDrop, then use the private transfer route Veylet support confirms.', 'See your first-tour steps', '/start');
    }
  }
  function button(label, fn) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'tour-action'; el.textContent = label;
    el.addEventListener('click', fn); return el;
  }
  function message(parent, value, className = 'tour-state-help') {
    const p = document.createElement(parent.tagName === 'UL' ? 'li' : 'p'); p.className = className; p.textContent = value; parent.append(p); return p;
  }
  /** Say it once for assistive technology, and once where the action happened. */
  function rowSay(tour, item) {
    const line = document.createElement('p'); line.className = 'tour-row-status'; line.hidden = true;
    item.append(line);
    // A notice about a version that is no longer shown lands on its walkthrough's current version.
    if (rowNotice && (rowNotice.tourId === tour.id || (rowNotice.walkthroughId && rowNotice.walkthroughId === walkthroughOf(tour)))) {
      line.textContent = rowNotice.text; line.hidden = false; rowNotice = null;
    }
    return (value, keepAfterReload = false) => {
      setStatus(value);
      line.textContent = value; line.hidden = !value;
      rowNotice = keepAfterReload && value ? { tourId: tour.id, text: value } : null;
    };
  }
  function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }
  function targetMessage(value) {
    if (!targetStatus) return;
    targetStatus.textContent = value;
    targetStatus.hidden = !value;
  }
  function tourPreview(tour, item, revision) {
    const preview = document.createElement('a'); preview.className = 'tour-action';
    preview.href = '/play/?id=' + encodeURIComponent(tour.id) + (revision ? '&review_revision=' + encodeURIComponent(revision) : '') + (APP_MODE ? '&from=app' : '');
    preview.textContent = revision ? 'Open review preview' : 'Preview';
    if (revision) { preview.target = '_blank'; preview.rel = 'noopener noreferrer'; }
    item.append(preview); return preview;
  }

  /*
   * Sharing, in the words the app uses too. Approving a first release turns
   * sharing on in the same press (Approve and share); turning it on again after
   * it was stopped is the owner's own press; turning it off is confirmed, then
   * read back before it is announced. Stopping sits under Manage sharing so it
   * never shares a row with the share kit.
   */
  // Which of enable_tour_share's refusals this is, by the words the server raises.
  function shareRefusal(result) {
    const error = result?.value?.error || result?.error || null;
    const words = String(error?.message || '').toLowerCase();
    const match = SHARE_REFUSALS.find(([phrase]) => words.includes(phrase));
    return match ? match[1] : 'unknown';
  }
  function shareWords(reason) { return SHARE_WAITS[reason] ? 'Approved. Sharing waits for ' + SHARE_WAITS[reason] + '.' : SHARE_UNCONFIRMED; }
  function studioMail(tour, subject, lines) {
    const reference = String(walkthroughOf(tour) || '').slice(0, 8);
    return 'mailto:yoda@yodalai.xyz?subject=' + encodeURIComponent(subject + ' · walkthrough ' + reference)
      + '&body=' + encodeURIComponent(['Walkthrough reference: ' + reference, '', ...lines, '', 'Leave out street addresses and access details.'].join('\n'));
  }
  // `options.label` is "Turn sharing on" (approved, never shared) or "Turn sharing
  // back on" (sharing was stopped); `options.problem` is a refusal already met, whose
  // one fix is drawn at once; `withPreview` puts the reviewer's Preview beside the
  // button, so the walkthrough's next moves read as one row rather than two.
  function turnOnSharing(tour, item, supabase, ticket, options = {}) {
    const actions = document.createElement('p'); actions.className = 'tour-actions-row'; item.append(actions);
    let fix = null, preview = null;
    // The one fix for a refusal is the filled control and comes first; a retry stays
    // beside it unless it cannot help.
    const showFix = reason => {
      fix = null;
      enable.hidden = false; enable.className = 'tour-action tour-action-primary';
      if (reason === 'review') {
        fix = button('Start a fresh review', () => loadDesk(supabase)); fix.className = 'tour-action tour-action-primary';
      } else if (reason === 'uploader') {
        fix = document.createElement('a'); fix.className = 'tour-action tour-action-primary'; fix.textContent = 'Contact Veylet support';
        fix.href = studioMail(tour, 'Veylet sharing', ['Sharing waits for the person who captured this walkthrough to be back in our workspace.']);
      } else if (reason === 'permission') {
        enable.hidden = true;
        fix = document.createElement('span'); fix.className = 'tour-share-ask'; fix.textContent = 'Ask the workspace owner to turn sharing on.';
      } else if ((reason === 'occupancy' || reason === 'consent') && gateCanOpen(tour.property_id)) {
        // The listing's question, or its consent form, opened where the person is.
        fix = button(gateFixLabel(reason), () => gateOpen(tour.property_id, reason));
        fix.className = 'tour-action tour-action-primary'; fix.dataset.control = 'share-fix-' + reason;
      }
      if (fix && reason !== 'permission') enable.className = 'tour-action';
      actions.replaceChildren(...[fix, enable, preview].filter(Boolean));
      if (note) note.hidden = Boolean(reason);
    };
    const enable = button(options.label || 'Turn sharing on', async () => {
      if (enable.disabled) return;
      enable.disabled = true;
      say('Turning sharing on…');
      const result = await settled(Promise.resolve().then(() => supabase.rpc('enable_tour_share', { p_tour_id: tour.id })));
      if (ticket !== deskVersion) return;
      if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in and check the walkthrough before retrying.'); return; }
      if (failed(result) || !result.value?.data) {
        const reason = shareRefusal(result);
        enable.disabled = false; showFix(reason); say(shareWords(reason));
        return;
      }
      say(LIVE_SAID, true);
      await loadDesk(supabase);
    });
    enable.className = 'tour-action tour-action-primary'; enable.dataset.control = 'share-on'; actions.append(enable);
    if (options.withPreview) preview = tourPreview(tour, actions);
    // What sharing does, said until a refusal says why it waits instead.
    const note = options.note ? message(item, options.note) : null;
    const say = rowSay(tour, item);
    if (options.problem) showFix(options.problem);
  }
  function copyField(name, tag, value) {
    const label = document.createElement('label'); label.className = 'tour-field';
    const text = document.createElement('span'); text.textContent = name;
    const field = document.createElement(tag); field.className = 'copy-field'; field.readOnly = true; field.spellcheck = false;
    if (tag === 'input') field.type = 'text'; else field.rows = 5;
    field.value = value;
    field.addEventListener('focus', () => field.select());
    label.append(text, field); return { label, field };
  }
  // A file name from the listing's title: "12 Harbour Loft" becomes "12-harbour-loft".
  function slugOf(text) {
    return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '');
  }
  // The QR code as a PNG: the vendored generator's modules drawn on a canvas, quiet zone included.
  function qrPng(qr, url, pixels = 1024) {
    const matrix = qr.matrix(url, 'M');
    const quiet = Number.isInteger(qr.quietZone) ? qr.quietZone : 4;
    const size = matrix.size + quiet * 2, scale = Math.max(1, Math.floor(pixels / size));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#10231d';
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        if (matrix.modules[row * matrix.size + col] === 1) context.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('png-failed'))), 'image/png'));
  }
  // Show QR code: drawn in this browser by the vendored generator (window.VeyletQR,
  // /vendor/qrcode-1.5.4.min.js) when the disclosure opens. No QR service is called.
  function qrKit(tour, url, name) {
    const details = document.createElement('details'); details.className = 'account-details tour-qr';
    const summary = document.createElement('summary'); summary.textContent = 'Show QR code';
    const body = document.createElement('div'); body.className = 'tour-qr-body';
    const code = document.createElement('div'); code.className = 'tour-qr-code';
    code.textContent = 'Preparing the QR code…';
    const caption = document.createElement('p'); caption.className = 'tour-qr-caption';
    caption.textContent = 'Scan to open the walkthrough on a phone. Print it on a window card or brochure.';
    const file = (slugOf(name) || 'veylet-walkthrough') + '-qr.png';
    const download = button('Download QR code (PNG)', async () => {
      const qr = window.VeyletQR;
      if (download.disabled || !qr?.matrix) return;
      try {
        const href = URL.createObjectURL(await qrPng(qr, url));
        const anchor = document.createElement('a'); anchor.href = href; anchor.download = file;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
        sayQr('QR code saved as ' + file + '.');
      } catch { sayQr('The QR code couldn’t be saved here. Take a screenshot of it instead.'); }
    });
    download.disabled = true; download.dataset.control = 'qr-download';
    const row = document.createElement('p'); row.className = 'tour-actions-row'; row.append(download);
    body.append(code, caption, row); details.append(summary, body);
    let drawn = false;
    const draw = () => {
      if (drawn) return;
      const qr = window.VeyletQR;
      let svg = '';
      try { svg = qr?.svg ? qr.svg(url, { label: 'QR code that opens ' + name }) : ''; } catch { svg = ''; }
      if (!/^<svg[\s>]/.test(svg)) { code.textContent = 'The QR code couldn’t be made here. Copy the link instead.'; return; }
      drawn = true; code.innerHTML = svg; download.disabled = false;
    };
    details.addEventListener('toggle', () => { if (details.open) draw(); });
    const sayQr = rowSay(tour, details);
    return details;
  }
  // The embed code the builder steps describe, with its frame and its direct link
  // tagged as the embed channel. Everything else is VeyletSharing's own code.
  function embedCodeTagged(share, token) {
    const frame = share.embedUrl(token), page = share.handoffUrl(token);
    return share.embedCode(token).split('"' + frame + '"').join('"' + tagged(frame, 'embed') + '"')
      .split('"' + page + '"').join('"' + tagged(page, 'embed') + '"');
  }
  // The share kit on a live walkthrough: Share (the device's share sheet) where the
  // browser has one, otherwise Copy link, filled; then Copy listing URL, Open as your
  // client, Show QR code and the website steps with the embed code. Each handed-out
  // address carries its channel (link, portal, qr, embed).
  function liveSharing(tour, item, title) {
    const share = window.VeyletSharing;
    const page = share.handoffUrl(tour.share_token);
    // What the agent hands out carries its channel; Open as your client is the page itself.
    const url = tagged(page, 'link');
    const name = typeof title === 'string' && title.trim() ? title.trim() : 'Your walkthrough';
    const link = copyField('Link', 'input', url);
    const copy = async () => {
      await share.copy(url, link.field, statusEl, 'Link copied. Anyone with it can open or forward the walkthrough.');
      if (statusEl?.textContent) say(statusEl.textContent);
    };
    const copyLink = button('Copy link', copy); copyLink.dataset.control = 'copy-link';
    // One direct, frameable address for a portal's or CRM's virtual tour field: the
    // walkthrough alone, with no agent card, links or QR code (/tour).
    const listingUrl = tagged(LISTING_BASE + encodeURIComponent(tour.share_token), 'portal');
    const listing = copyField('Listing URL (portals, CRM)', 'input', listingUrl);
    listing.label.hidden = true;
    const copyListing = button('Copy listing URL (portals, CRM)', async () => {
      listing.label.hidden = false;
      await share.copy(listingUrl, listing.field, statusEl, 'Listing URL copied. Paste it into the virtual tour field. It shows the walkthrough only: no agent card, links or QR code.');
      if (statusEl?.textContent) say(statusEl.textContent);
    });
    copyListing.dataset.control = 'copy-listing';
    const actions = document.createElement('p'); actions.className = 'tour-actions-row';
    const device = typeof navigator !== 'undefined' ? navigator : null;
    let sheet = false;
    try { sheet = typeof device?.share === 'function' && (typeof device.canShare !== 'function' || device.canShare({ title: name, url }) !== false); } catch { sheet = false; }
    if (sheet) {
      const send = button('Share', async () => {
        try { await device.share({ title: name, url }); }
        catch (error) { if (error?.name !== 'AbortError') await copy(); }
      });
      send.className = 'tour-action tour-action-primary'; send.dataset.control = 'share';
      actions.append(send, copyLink);
    } else { copyLink.className = 'tour-action tour-action-primary'; actions.append(copyLink); }
    actions.append(copyListing);
    const open = document.createElement('a'); open.className = 'tour-action'; open.href = page; open.textContent = 'Open as your client';
    actions.append(open);
    // The link and what you do with it share one row where there is room.
    const linkRow = document.createElement('div'); linkRow.className = 'tour-link-row';
    linkRow.append(link.label, actions); item.append(linkRow, listing.label);
    const say = rowSay(tour, item);
    item.append(qrKit(tour, tagged(page, 'qr'), name));

    // Add to your website: the builder's own steps, then the one code. It is
    // a disclosure, so a desk of live walkthroughs stays a list of links.
    const web = document.createElement('details'); web.className = 'account-details tour-website';
    const heading = document.createElement('summary'); heading.textContent = 'Add to your website';
    const chooser = document.createElement('fieldset'); chooser.className = 'tour-builder';
    const legend = document.createElement('legend'); legend.textContent = 'Your website builder'; chooser.append(legend);
    const steps = document.createElement('ol'); steps.className = 'tour-builder-steps';
    const paint = id => steps.replaceChildren(...share.builder(id).steps.map(text => {
      const step = document.createElement('li'); step.textContent = text; return step;
    }));
    const chosen = share.savedBuilder();
    for (const choice of share.builders) {
      const label = document.createElement('label'); label.className = 'tour-builder-choice';
      const input = document.createElement('input'); input.type = 'radio';
      input.name = 'builder-' + tour.id; input.value = choice.id; input.checked = choice.id === chosen;
      input.addEventListener('change', () => { if (!input.checked) return; share.saveBuilder(choice.id); paint(choice.id); });
      const text = document.createElement('span'); text.textContent = choice.name;
      label.append(input, text); chooser.append(label);
    }
    paint(chosen);
    const code = embedCodeTagged(share, tour.share_token);
    const embed = copyField('Embed code', 'textarea', code);
    const copyCode = button('Copy embed code', async () => {
      await share.copy(code, embed.field, statusEl, 'Embed code copied. Paste it into your builder’s custom HTML block, then check the published page on a phone.');
      if (statusEl?.textContent) sayWeb(statusEl.textContent);
    });
    const codeActions = document.createElement('p'); codeActions.className = 'tour-actions-row'; codeActions.append(copyCode);
    if (!APP_MODE) {
      const guidePage = document.createElement('a'); guidePage.className = 'tour-action'; guidePage.href = '/website-guide'; guidePage.textContent = 'Full website guide';
      codeActions.append(guidePage);
    }
    web.append(heading, chooser, steps, embed.label, codeActions);
    item.append(web);
    const sayWeb = rowSay(tour, web);
  }
  function manageSharing(item) {
    const details = document.createElement('details'); details.className = 'account-details tour-manage';
    const summary = document.createElement('summary'); summary.textContent = 'Manage sharing';
    details.append(summary); item.append(details); return details;
  }
  // A backend without the function answers PGRST202 ("Could not find the function").
  function missingFunction(result) {
    const error = result?.value?.error || result?.error || null;
    return Boolean(error) && (String(error.code || '') === 'PGRST202' || /could not find the function/i.test(String(error.message || '')));
  }
  /*
   * Pause keeps the link: the link, embed and QR show "not available" until Resume,
   * and then open the same walkthrough again. It needs no confirmation because it is
   * undone in one press; Turn off sharing below it stays the destructive one. Only a
   * database with tours.share_paused_at offers it (readTours), and a press answered
   * PGRST202 takes it away again without a word.
   */
  function pauseSharing(tour, supabase, ticket, parent) {
    if (!pauseAvailable) return;
    const row = document.createElement('div'); row.className = 'tour-pause';
    const hint = document.createElement('p'); hint.className = 'tour-state-help tour-pause-hint'; hint.textContent = PAUSE_HINT;
    const pause = button('Pause sharing', async () => {
      if (pause.disabled) return;
      pause.disabled = true;
      say('Pausing sharing…');
      const result = await settled(Promise.resolve().then(() => supabase.rpc('pause_tour_share', { p_tour_id: tour.id })));
      if (ticket !== deskVersion) return;
      if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in and check whether sharing was paused.'); return; }
      if (missingFunction(result)) { pauseAvailable = false; row.hidden = true; say(''); return; }
      if (failed(result)) { say('Pausing was not confirmed. Refresh the desk to check before retrying.'); pause.disabled = false; return; }
      const readback = await settled(Promise.resolve().then(() => supabase.from('tours').select('id,share_token,share_paused_at').eq('id', tour.id).single()));
      if (ticket !== deskVersion) return;
      const current = firstRow(readback.value?.data);
      say(!failed(readback) && sharePaused(current) ? PAUSED_SAID : 'The request completed, but the paused state could not be confirmed. Refresh the desk.', true);
      await loadDesk(supabase);
    });
    pause.dataset.control = 'pause-share';
    const actions = document.createElement('p'); actions.className = 'tour-actions-row'; actions.append(pause);
    row.append(actions, hint); parent.append(row);
    const say = rowSay(tour, row);
  }
  // A paused walkthrough's one filled action. `gate` is what the listing's sharing waits
  // for (its question or the tenant's consent): that fix comes first, Resume beside it.
  function resumeSharing(tour, item, supabase, ticket, gate = null) {
    const blocked = reason => {
      say(shareWords(reason));
      if (fixed || !gateCanOpen(tour.property_id)) return;
      const fix = button(gateFixLabel(reason), () => gateOpen(tour.property_id, reason));
      fix.className = 'tour-action tour-action-primary'; fix.dataset.control = 'share-fix-' + reason;
      resume.className = 'tour-action'; actions.replaceChildren(fix, resume); fixed = true;
    };
    let fixed = false;
    const resume = button('Resume sharing', async () => {
      if (resume.disabled) return;
      resume.disabled = true;
      say('Resuming sharing…');
      const result = await settled(Promise.resolve().then(() => supabase.rpc('resume_tour_share', { p_tour_id: tour.id })));
      if (ticket !== deskVersion) return;
      if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in and check whether sharing resumed.'); return; }
      const refused = failed(result) && !missingFunction(result) ? shareRefusal(result) : null;
      if (refused === 'occupancy' || refused === 'consent') { resume.disabled = false; blocked(refused); return; }
      if (failed(result) || missingFunction(result)) { say('Resuming was not confirmed. Refresh the desk to check before retrying.'); resume.disabled = false; return; }
      const readback = await settled(Promise.resolve().then(() => supabase.from('tours').select('id,share_token,share_paused_at').eq('id', tour.id).single()));
      if (ticket !== deskVersion) return;
      const current = firstRow(readback.value?.data);
      say(!failed(readback) && current?.share_token && !current.share_paused_at ? RESUMED_SAID : 'The request completed, but the sharing state could not be confirmed. Refresh the desk.', true);
      await loadDesk(supabase);
    });
    resume.className = 'tour-action tour-action-primary'; resume.dataset.control = 'resume-share';
    const actions = document.createElement('p'); actions.className = 'tour-actions-row'; actions.append(resume);
    if (gate) message(item, shareWords(gate), 'tour-state-help tour-share-problem');
    item.append(actions);
    const say = rowSay(tour, item);
    if (gate && gateCanOpen(tour.property_id)) {
      const fix = button(gateFixLabel(gate), () => gateOpen(tour.property_id, gate));
      fix.className = 'tour-action tour-action-primary'; fix.dataset.control = 'share-fix-' + gate;
      resume.className = 'tour-action'; actions.replaceChildren(fix, resume); fixed = true;
    }
  }
  /*
   * How often the link was opened and the agent contacted, from get_tour_view_stats
   * (the viewer beacon's counts). Hidden while the backend has no such function, and
   * on any error or odd answer: a missing count is never shown as zero.
   */
  function viewCount(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
  function tourViews(tour, host, supabase, ticket) {
    host.className = 'tour-views'; host.hidden = true;
    if (!viewsAvailable) return;
    void settled(Promise.resolve().then(() => supabase.rpc('get_tour_view_stats', { p_tour_id: tour.id }))).then(reply => {
      if (ticket !== deskVersion) return;
      if (missingFunction(reply)) { viewsAvailable = false; return; }
      if (failed(reply)) return;
      const row = firstRow(reply.value?.data);
      const opens = viewCount(row?.opens), calls = viewCount(row?.call_taps), emails = viewCount(row?.email_taps);
      if (opens === null) return;
      const last = opens > 0 ? window.VeyletSharing?.hostingDate?.(row.last_opened_at) || '' : '';
      const opened = document.createElement('p'); opened.className = 'tour-views-opens';
      opened.textContent = opens === 0 ? 'Not opened yet.' : 'Opened ' + opens + (opens === 1 ? ' time' : ' times') + (last ? ' · last ' + last : '');
      const parts = [opened];
      if (calls !== null && emails !== null && opens > 0) {
        const taps = document.createElement('p'); taps.className = 'tour-views-taps';
        taps.textContent = 'Call taps ' + calls + ' · Email taps ' + emails;
        parts.push(taps);
      }
      host.replaceChildren(...parts); host.hidden = false;
    });
  }
  function stopSharing(tour, supabase, ticket, parent) {
    let armed = false;
    const revoke = button('Turn off sharing', async () => {
      if (revoke.disabled) return;
      if (!armed) {
        armed = true; revoke.textContent = 'Confirm: turn off sharing'; revoke.dataset.armed = 'true';
        say('Turning off sharing stops this link, its embed and any printed QR code for good. Turning it back on makes a new link. Downloaded copies cannot be recalled.' +
          (pauseAvailable && !sharePaused(tour) ? ' To stop it for now and keep the link, use Pause sharing instead.' : '') + ' Confirm to continue.');
        cancelRevoke.hidden = false; return;
      }
      revoke.disabled = true; cancelRevoke.hidden = true; revoke.dataset.armed = 'false';
      const result = await settled(supabase.rpc('revoke_tour_share', { p_tour_id: tour.id }));
      if (ticket !== deskVersion) return;
      if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in and check whether sharing was turned off.'); return; }
      if (failed(result)) { say('Turning off sharing was not confirmed. Refresh the desk to check before retrying.'); revoke.disabled = false; armed = false; revoke.textContent = 'Turn off sharing'; return; }
      const readback = await settled(supabase.from('tours').select('id,share_token').eq('id', tour.id).single());
      if (ticket !== deskVersion) return;
      const current = firstRow(readback.value?.data);
      if (failed(readback) || !current || current.share_token !== null) {
        say('The request completed, but the current sharing state could not be confirmed. Refresh the desk.', true);
      } else say('Sharing turned off. Remove the link and embed from your listing too.', true);
      await loadDesk(supabase);
    });
    const cancelRevoke = button('Keep link', () => { armed = false; revoke.textContent = 'Turn off sharing'; revoke.dataset.armed = 'false'; cancelRevoke.hidden = true; say('Link left unchanged.'); });
    revoke.classList.add('tour-action-danger');
    cancelRevoke.hidden = true;
    const stopping = document.createElement('p'); stopping.className = 'tour-actions-row tour-actions-stop';
    stopping.append(revoke, cancelRevoke); parent.append(stopping);
    const say = rowSay(tour, parent);
  }
  function withdrawApproval(tour, supabase, ticket, parent) {
    let armed = false;
    const withdraw = button('Withdraw approval', async () => {
      if (withdraw.disabled) return;
      if (!armed) {
        armed = true; withdraw.textContent = 'Confirm: withdraw approval'; withdraw.dataset.armed = 'true';
        say('Withdrawing approval also turns off sharing. Use this when quality or permission changes. The review history stays recorded. Confirm to continue.');
        cancelWithdraw.hidden = false; return;
      }
      withdraw.disabled = true; cancelWithdraw.hidden = true; withdraw.dataset.armed = 'false';
      const reply = await settled(supabase.rpc('withdraw_tour_review', { p_tour_id: tour.id }));
      if (ticket !== deskVersion) return;
      if (sessionGone(reply)) { showSignedOut('Your sign-in expired. Sign in and check the approval state.'); return; }
      if (failed(reply) || firstRow(reply.value?.data)?.approved !== false) { say('Withdrawal was not confirmed. Refresh to check the approval state before retrying.'); withdraw.disabled = false; armed = false; withdraw.textContent = 'Withdraw approval'; return; }
      say('Approval withdrawn. A new check is required before sharing.', true); await loadDesk(supabase);
    });
    const cancelWithdraw = button('Keep approval', () => { armed = false; withdraw.textContent = 'Withdraw approval'; withdraw.dataset.armed = 'false'; cancelWithdraw.hidden = true; say('Approval left unchanged.'); });
    withdraw.classList.add('tour-action-danger');
    cancelWithdraw.hidden = true;
    const stopping = document.createElement('p'); stopping.className = 'tour-actions-row tour-actions-stop';
    stopping.append(withdraw, cancelWithdraw); parent.append(stopping);
    const say = rowSay(tour, parent);
  }

  // What approving a later version means, from get_walkthrough_revision. Only the
  // server's answer may say that the allowance is untouched or that the link moves.
  function correctionWords(tour, lineage) {
    const lead = 'This is a correction of ' + walkthroughRef(tour) + '.';
    if (!lineage) return lead + ' Whether approving it uses your allowance couldn’t be checked. Refresh to check before you approve it.';
    const moves = lineage.link_moves_on_approval;
    if (!lineage.approval_uses_allowance) {
      return lead + (moves ? ' Approving it uses no walkthrough from your allowance, and your existing link and embed will show this version.'
        : ' Approving it uses no walkthrough from your allowance. It has no live link now, so approving it also turns sharing on.');
    }
    return lead + ' That walkthrough hasn’t been accepted yet, so approving this version uses one walkthrough from your allowance' +
      (moves ? '. Your existing link and embed will show this version.' : '; later corrections of it use none.');
  }

  /* ---- Videos and stills for your listing ---------------------------------
   * Listing exports, in the words the app uses too (the sibling repository's
   * docs/render-status-contract-20260925.md, "Listing exports (C3)", and its draft
   * supabase/drafts/release-2/20260926113000_listing_exports.sql, not released):
   * an approved walkthrough's MP4 listing cut (16:9, 60–180 s), social cut (9:16,
   * 20–45 s) and a ZIP of stills. get_listing_exports reads its one export;
   * request_listing_exports records the request with the active consent statement
   * version and the "cannot be recalled" acknowledgement, which is sent only once
   * the box beside the statement is ticked. The server names the version, never the
   * words, so the words live here by version. The draft seeds its statement
   * inactive, so until the owner approves it the version is null and the block
   * says "Exports open soon." with nothing to press. A backend without the
   * functions (PGRST202) shows no block at all.
   * Downloads never call authorize_listing_export_download from the browser (the
   * contract: it answers a storage key, not a link). They go to veylet-hooks'
   * POST /listing-exports/download (the sibling repository's
   * deploy/hooks-vercel/listing_exports/download.py; built, not deployed), which
   * calls it with this session and answers a presigned link of at most 600 s, or
   * {error} with a status the words below follow, the same in the app. Nothing
   * here states an amount: the app's page shows the same block.
   */
  const EXPORT_STATEMENTS = Object.freeze({
    // SHA-256 914257b7e13e9c960f90296bc8887a78ffd4a5b31540901ba09b34b1c27a68ee, as the draft seeds it (inactive).
    'export-consent-v0-draft': 'I confirm that the property owner, and any tenant living there, have given written consent for these videos and photos of the property to be published. I understand that Veylet cannot recall, delete or change any copy once it has been downloaded.',
  });
  const EXPORT_KINDS = Object.freeze(['video_16x9', 'video_9x16', 'stills']);
  const EXPORT_STATES = Object.freeze(['requested', 'rendering', 'needs_attention', 'ready', 'partner_only', 'failed']);
  const EXPORT_FILES = Object.freeze({ video_16x9: 'Download listing video (16:9)', video_9x16: 'Download social video (9:16)', stills: 'Download stills (ZIP)' });
  const EXPORT_WORDS = Object.freeze({
    heading: 'Videos and stills for your listing',
    what: 'From this walkthrough: a 16:9 listing video (60–180 seconds), a 9:16 social video (20–45 seconds) and still photos of each room.',
    // realestate.com.au's residential rules (launch plan §4): no web address, QR code
    // or call to action in the frame, and an AI or rendering disclosure. It shows the
    // video; the walkthrough itself is never said to be on realestate.com.au.
    where: 'For the video field of a realestate.com.au or Domain listing, YouTube and social media. Each video carries a short line saying it’s a 3D reconstruction, and no web address, QR code or call to action.',
    soon: 'Exports open soon.',
    refresh: 'Refresh this page to make listing videos.',
    legend: 'Downloaded files can’t be recalled',
    make: 'Make listing videos',
    again: 'Try again',
    tick: 'Tick the box to confirm first.',
    asking: 'Asking for your videos…',
    preparing: 'Preparing your video and photos.',
    checking: 'We’re checking your video before it’s ready. We’ll tell you when it is.',
    ready: 'Ready to download.',
    recall: 'Downloaded files can’t be recalled.',
    locked: 'These files can be downloaded only while this version is approved. Check again.',
    partner: 'Video isn’t available for this walkthrough yet.',
    failed: 'We couldn’t make the video. Nothing was used.',
    checkAgain: 'Check again',
    readFailed: 'Listing videos couldn’t be checked. Try again.',
    approveFirst: 'Approve this walkthrough first, then make its videos.',
    notYours: 'Ask the workspace owner or a reviewer to make these videos.',
    unconfirmed: 'Your request wasn’t confirmed. Try again.',
    getting: 'Getting your download…',
    notOpen: 'Downloads aren’t open yet. Try again later.',
    notAllowed: 'Your role in this office can’t download videos. Ask an office admin.',
    gone: 'This file isn’t available any more.',
    tooMany: 'You’ve downloaded a lot in the last hour. Try again later.',
    downloadFailed: 'The download didn’t start. Try again.',
  });
  // veylet-hooks' download endpoint: POST {export_id, kind} with the member's bearer →
  // {url, filename, bytes, content_type, expires_in ≤ 600}, or {error} with 400, 401,
  // 403 (not_allowed, origin_not_allowed), 404 (unknown_export), 409 (not_ready,
  // needs_attention, partner_only), 429 (rate_limited), 502 (download_failed) or 503
  // (not_configured). Its CORS answers https://veylet.com and the local QA origin only.
  const EXPORT_DOWNLOAD_PATH = '/listing-exports/download';
  // Sizes as the app says them: decimal units, one decimal from a megabyte.
  function exportSize(bytes) {
    if (!Number.isInteger(bytes) || bytes <= 0) return '';
    if (bytes < 1e6) return Math.max(1, Math.round(bytes / 1000)) + ' KB';
    if (bytes < 1e9) return (bytes / 1e6).toFixed(1) + ' MB';
    return (bytes / 1e9).toFixed(1) + ' GB';
  }
  // The export JSON for this walkthrough, or null for any answer the contract does not describe.
  function exportAnswer(tour, data) {
    const row = firstRow(data);
    if (!row || typeof row !== 'object' || String(row.tour_id || '').toLowerCase() !== String(tour.id).toLowerCase()) return null;
    if (typeof row.requested !== 'boolean') return null;
    const state = row.state ?? null;
    if (state !== null && !EXPORT_STATES.includes(state)) return null;
    if (state !== null && typeof row.export_id !== 'string') return null;
    return { ...row, state };
  }
  function exportRefusal(result) {
    const words = String((result?.value?.error || result?.error || {}).message || '').toLowerCase();
    if (words.includes('consent statement version is not active')) return 'inactive';
    if (words.includes('approve this walkthrough')) return 'approve';
    if (words.includes('tour unavailable')) return 'unavailable';
    if (words.includes('occupancy not declared')) return 'occupancy';
    if (words.includes('tenant consent required')) return 'consent';
    return 'unknown';
  }
  /*
   * One disclosure under an approved walkthrough's sharing, for whoever may share it
   * (the request's own roles). Hidden until get_listing_exports answers; a ready
   * export puts its state on the summary so it is seen without opening it.
   */
  function listingExports(tour, item, supabase, ticket) {
    if (!exportsAvailable) return;
    const box = document.createElement('details'); box.className = 'account-details tour-exports'; box.hidden = true;
    const summary = document.createElement('summary');
    const summaryText = document.createElement('span'); summaryText.className = 'tour-exports-title'; summaryText.textContent = EXPORT_WORDS.heading;
    summary.append(summaryText);
    const body = document.createElement('div'); body.className = 'tour-exports-body';
    message(body, EXPORT_WORDS.what, 'tour-state-help tour-exports-what');
    message(body, EXPORT_WORDS.where, 'tour-state-help tour-exports-where');
    // Where the export stands: focused after a press, so the result is where the reader is.
    const state = document.createElement('p'); state.className = 'tour-exports-state'; state.tabIndex = -1; state.hidden = true;
    const slot = document.createElement('div'); slot.className = 'tour-exports-slot';
    body.append(state, slot); box.append(summary, body); item.append(box);
    const say = rowSay(tour, body);
    const gone = () => { exportsAvailable = false; box.hidden = true; say(''); };
    const actions = (...controls) => { const row = document.createElement('p'); row.className = 'tour-actions-row'; row.append(...controls); slot.append(row); return row; };
    const show = (words, focus) => {
      state.textContent = words; state.hidden = !words;
      if (focus && words) { setStatus(words); state.focus?.({ preventScroll: true }); state.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); }
    };
    const chip = text => {
      summary.replaceChildren(summaryText);
      if (text) { const mark = pill(text, 'good'); mark.className += ' tour-exports-chip'; summary.append(mark); }
    };
    let reading = false;
    async function read(focus) {
      if (reading) return;
      reading = true;
      const reply = await settled(Promise.resolve().then(() => supabase.rpc('get_listing_exports', { p_tour_id: tour.id })));
      reading = false;
      if (ticket !== deskVersion) return;
      if (missingFunction(reply)) { gone(); return; }
      if (sessionGone(reply)) {
        if (focus) showSignedOut('Your sign-in has expired. Sign in to check your listing videos.');
        else box.hidden = true;
        return;
      }
      if (failed(reply)) {
        box.hidden = false; chip(''); slot.replaceChildren(); say('');
        show(EXPORT_WORDS.readFailed, focus);
        const retry = button(EXPORT_WORDS.again, () => read(true)); retry.dataset.control = 'exports-retry';
        actions(retry);
        return;
      }
      const row = exportAnswer(tour, reply.value?.data);
      if (!row) { box.hidden = true; return; }
      box.hidden = false;
      say('');
      draw(row, focus);
    }
    // The listing's sharing waits for its question or the tenant's consent: the same
    // words as its walkthrough card, and the same one fix.
    function gateLine(reason, focus) {
      const words = shareWords(reason);
      if (state.textContent) message(slot, words, 'tour-state-help tour-exports-soon');
      else show(words, focus);
      if (!gateCanOpen(tour.property_id)) return;
      const fix = button(gateFixLabel(reason), () => gateOpen(tour.property_id, reason));
      fix.className = 'tour-action tour-action-primary'; fix.dataset.control = 'exports-fix-' + reason;
      actions(fix);
    }
    // The consent box and the one filled press: "Make listing videos", or "Try again" after a failure.
    function requestForm(row, label, focus) {
      const gate = gateBlock(tour.property_id);
      if (gate) { gateLine(gate, focus); return; }
      const version = typeof row.consent_version === 'string' && row.consent_version ? row.consent_version : null;
      const words = version ? EXPORT_STATEMENTS[version] : null;
      if (!words) {
        // No active statement (the owner has not approved one yet), or one this page
        // was built before: nothing to press. After a failure it follows the failure.
        const closed = version ? EXPORT_WORDS.refresh : EXPORT_WORDS.soon;
        if (state.textContent) message(slot, closed, 'tour-state-help tour-exports-soon');
        else show(closed, focus);
        return;
      }
      const form = document.createElement('form'); form.className = 'tour-exports-form'; form.noValidate = true;
      const fieldset = document.createElement('fieldset'); fieldset.className = 'tour-exports-consent';
      const legend = document.createElement('legend'); legend.textContent = EXPORT_WORDS.legend;
      const choice = document.createElement('label'); choice.className = 'tour-exports-choice';
      const tick = document.createElement('input'); tick.type = 'checkbox'; tick.name = 'exports-consent-' + tour.id; tick.required = true;
      tick.dataset.control = 'exports-consent';
      const text = document.createElement('span'); text.textContent = words;
      choice.append(tick, text); fieldset.append(legend, choice);
      const make = document.createElement('button'); make.type = 'submit'; make.className = 'tour-action tour-action-primary';
      make.textContent = label; make.dataset.control = 'exports-make';
      form.append(fieldset);
      const row2 = document.createElement('p'); row2.className = 'tour-actions-row'; row2.append(make); form.append(row2);
      form.addEventListener('submit', async event => {
        event?.preventDefault?.();
        if (make.disabled) return;
        if (!tick.checked) { say(EXPORT_WORDS.tick); tick.focus?.(); return; }
        make.disabled = true; say(EXPORT_WORDS.asking);
        const reply = await settled(Promise.resolve().then(() => supabase.rpc('request_listing_exports', {
          p_tour_id: tour.id, p_kinds: [...EXPORT_KINDS], p_consent_version: version, p_acknowledge_cannot_recall: true })));
        if (ticket !== deskVersion) return;
        if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in and check whether your listing videos were asked for.'); return; }
        if (missingFunction(reply)) { gone(); return; }
        if (failed(reply)) {
          const reason = exportRefusal(reply);
          // The statement was withdrawn since this was drawn: exports are closed again.
          if (reason === 'inactive') { say(''); draw({ ...row, consent_version: null }, true); return; }
          if (reason === 'occupancy' || reason === 'consent') { say(''); slot.replaceChildren(); gateLine(reason, true); return; }
          make.disabled = false;
          say(reason === 'approve' ? EXPORT_WORDS.approveFirst : reason === 'unavailable' ? EXPORT_WORDS.notYours : EXPORT_WORDS.unconfirmed);
          return;
        }
        const next = exportAnswer(tour, reply.value?.data);
        if (!next) { make.disabled = false; say(EXPORT_WORDS.unconfirmed); return; }
        say('');
        draw(next, true);
      });
      slot.append(form);
    }
    function checkAgain() {
      const again = button(EXPORT_WORDS.checkAgain, () => { again.disabled = true; void read(true); });
      again.dataset.control = 'exports-check';
      actions(again);
    }
    async function download(row, kind, control) {
      if (control.disabled) return;
      // A page without the hooks service configured has nowhere to ask: not open.
      if (!/^https:\/\/[^/]+$/.test(String(window.VEYLET_HOOKS?.url || '').replace(/\/+$/, ''))) { say(EXPORT_WORDS.notOpen); return; }
      control.disabled = true; say(EXPORT_WORDS.getting);
      const token = await annualToken(supabase);
      if (ticket !== deskVersion) return;
      if (!token) { showSignedOut('Your sign-in has expired. Sign in to download your listing videos.'); return; }
      const reply = await settled(annualHooks(EXPORT_DOWNLOAD_PATH, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ export_id: row.export_id, kind }) }));
      if (ticket !== deskVersion) return;
      control.disabled = false;
      const status = reply.value?.status, answer = reply.value?.body;
      if (status === 401) { showSignedOut('Your sign-in has expired. Sign in to download your listing videos.'); return; }
      const url = String(answer?.url || '');
      if (reply.value?.ok && /^https:\/\/[^\s"'<>]+$/.test(url)) {
        const name = /^[A-Za-z0-9_.-]{1,80}$/.test(String(answer.filename || '')) ? answer.filename : '';
        // The link answers with the file as an attachment, so the page stays where it is.
        const anchor = document.createElement('a'); anchor.href = url; anchor.rel = 'noopener';
        if (name) anchor.download = name;
        anchor.click();
        say(name ? 'Downloading ' + name + '.' : 'Downloading.');
        return;
      }
      // Not ready after all (not_ready, needs_attention, partner_only): read the export
      // again and say its state in that state's words, focused where the reader is.
      if (status === 409) { say(''); void read(true); return; }
      say(status === 403 ? EXPORT_WORDS.notAllowed : status === 404 ? EXPORT_WORDS.gone : status === 429 ? EXPORT_WORDS.tooMany
        : status === 503 ? EXPORT_WORDS.notOpen : EXPORT_WORDS.downloadFailed);
    }
    function files(row) {
      const list = document.createElement('ul'); list.className = 'tour-exports-files';
      const kinds = Array.isArray(row.kinds) ? row.kinds : [];
      for (const kind of EXPORT_KINDS) {
        const file = row.files && typeof row.files === 'object' ? row.files[kind] : null;
        if (!file || !kinds.includes(kind)) continue;
        const size = exportSize(file.bytes);
        const control = button(EXPORT_FILES[kind] + (size ? ' · ' + size : ''), () => download(row, kind, control));
        // The agent's turn: the listing video is the one filled press.
        if (!list.children.length) control.className = 'tour-action tour-action-primary';
        control.dataset.control = 'exports-download-' + kind;
        const entry = document.createElement('li'); entry.append(control); list.append(entry);
      }
      if (list.children.length) slot.append(list);
    }
    function draw(row, focus) {
      box.dataset.exports = row.requested ? row.state || 'requested' : 'none';
      slot.replaceChildren(); state.textContent = ''; state.hidden = true;
      chip(row.requested && row.state === 'ready' && row.downloadable === true ? EXPORT_WORDS.ready.replace(/\.$/, '') : '');
      if (!row.requested) { requestForm(row, EXPORT_WORDS.make, focus); return; }
      if (row.state === 'ready' && row.downloadable === true) {
        show(EXPORT_WORDS.ready, focus);
        message(slot, EXPORT_WORDS.recall, 'tour-state-help tour-exports-recall');
        files(row);
      } else if (row.state === 'ready') { show(EXPORT_WORDS.locked, focus); checkAgain(); }
      else if (row.state === 'needs_attention') { show(EXPORT_WORDS.checking, focus); checkAgain(); }
      else if (row.state === 'partner_only') show(EXPORT_WORDS.partner, focus);
      else if (row.state === 'failed') { show(EXPORT_WORDS.failed, focus); requestForm(row, EXPORT_WORDS.again, false); }
      else { show(EXPORT_WORDS.preparing, focus); checkAgain(); }
    }
    void read(false);
  }

  /* ---- Is anyone living here? --------------------------------------------
   * Tenant consent before sharing (the sibling repository's
   * docs/launch-readiness-plan-20260925.md C2: in Queensland it is an offence to use
   * advertising images showing a tenant's belongings without written consent). The
   * backend lane's release-2 drafts (not released) add
   * get_listing_sharing_readiness(p_property_id) → { occupancy, consent_recorded_at,
   * consent_reference, blocked_reason, grandfathered }, set_listing_occupancy and
   * record_tenant_consent; enable_tour_share, resume_tour_share and
   * request_listing_exports refuse with "occupancy not declared" or "tenant consent
   * required". A listing with a walkthrough asks once, before its first share. A live
   * share from before the gate is grandfathered (not revoked): no warning, one quiet
   * line. A backend without the functions (PGRST202, today's hosted project) shows
   * nothing and every card reads as before. The app says the same words, and nothing
   * here goes beyond the one sentence about Queensland.
   */
  const GATE_WORDS = Object.freeze({
    question: 'Is anyone living here?',
    why: 'Veylet asks once for each listing, before its walkthrough is shared.',
    save: 'Save answer',
    change: 'Change answer',
    keep: 'Keep my answer',
    tenants: 'You said tenants live here.',
    consentTitle: 'Record the tenant’s written consent',
    consentNote: 'In Queensland you need the tenant’s written consent before advertising images show their belongings. Keep the signed form; record its reference here.',
    reference: 'Consent reference',
    referenceHint: 'For example, the consent form’s name or number.',
    signed: 'Date signed',
    record: 'Record consent',
    help: 'Privacy and permission',
    quiet: 'Answer this before sharing again.',
    choose: 'Choose one answer.',
    noReference: 'Enter the consent form’s name or number.',
    longReference: 'Use 120 characters or fewer.',
    noDate: 'Enter the date the tenant signed.',
    future: 'The date signed can’t be in the future.',
    saving: 'Saving…',
    saved: 'Saved.',
    savedTenants: 'Saved. Now record the tenant’s written consent.',
    recorded: 'Consent recorded.',
    notSaved: 'Your answer wasn’t saved. Try again.',
    notRecorded: 'The consent wasn’t recorded. Try again.',
    offline: 'You’re offline. Nothing was saved.',
    role: 'Your role can’t change this. Ask your workspace owner.',
    askFirst: 'Say whether anyone lives here first. Nothing was recorded.',
    fixOccupancy: 'Answer the question',
    fixConsent: 'Add consent',
    guideOccupancy: 'Answer the question on its listing below: is anyone living here? Then turn sharing on.',
    guideConsent: 'Record the tenant’s written consent on its listing below, then turn sharing on.',
  });
  const GATE_OPTIONS = Object.freeze([['tenanted', 'Yes — tenants'], ['owner_occupied', 'Yes — the owner'], ['vacant', 'No — it’s empty']]);
  const GATE_SUMMARY = Object.freeze({ owner_occupied: 'The owner lives here.', vacant: 'Nobody lives here.' });
  const GATE_OCCUPANCY = Object.freeze(['owner_occupied', 'vacant', 'tenanted', 'unknown']);
  // blocked_reason → the refusal it stands for (SHARE_REFUSALS).
  const GATE_REASONS = Object.freeze({ occupancy_not_declared: 'occupancy', tenant_consent_required: 'consent' });
  const GATE_HELP = APP_MODE ? '/app/help/privacy-and-consent' : '/help/privacy-and-consent';
  // get_listing_sharing_readiness, until an answer says the backend does not have it.
  let gateAvailable = true;
  // Each drawn listing's gate: its answer, its slot, and `ready`, which settles once it was read.
  const listingGates = new Map();
  // Said once on a listing's next gate draw (a save reads the desk again), and whose gate takes focus then.
  const gateNotices = new Map();
  let gateFocus = null;

  // The readiness answer, or null for anything the draft does not describe.
  function gateAnswer(data) {
    const row = firstRow(data);
    if (!row || typeof row !== 'object') return null;
    const occupancy = row.occupancy ?? 'unknown';
    const reason = row.blocked_reason ?? null;
    if (!GATE_OCCUPANCY.includes(occupancy) || (reason !== null && !GATE_REASONS[reason])) return null;
    return { occupancy, reason: reason ? GATE_REASONS[reason] : null, grandfathered: row.grandfathered === true,
      reference: typeof row.consent_reference === 'string' ? row.consent_reference.trim() : '',
      recordedAt: typeof row.consent_recorded_at === 'string' ? row.consent_recorded_at : null };
  }
  // What sharing on this listing waits for ('occupancy' or 'consent'), or null. A
  // grandfathered live share keeps working, but anything shared anew still waits.
  function gateBlock(propertyId) { return gateAvailable ? listingGates.get(propertyId)?.answer?.reason || null : null; }
  function gateReady(propertyId) { return listingGates.get(propertyId)?.ready || Promise.resolve(); }
  function gateCanOpen(propertyId) { return gateAvailable && listingGates.has(propertyId); }
  function gateFixLabel(reason) { return reason === 'consent' ? GATE_WORDS.fixConsent : GATE_WORDS.fixOccupancy; }
  function gateSay(entry, text, announce = false) {
    if (entry.said) { entry.said.textContent = text; entry.said.hidden = !text; }
    if (announce && text) setStatus(text);
  }
  function gateGone() {
    gateAvailable = false;
    for (const entry of listingGates.values()) { entry.slot.hidden = true; entry.slot.replaceChildren(); }
  }
  // Starts reading one listing's gate into its slot; hidden until the answer says what to ask.
  function listingGate(space, slot, supabase, ticket) {
    const entry = { space, slot, supabase, ticket, answer: undefined, changing: false, open: false, busy: false, said: null };
    listingGates.set(space.id, entry);
    slot.hidden = true;
    entry.ready = !gateAvailable ? Promise.resolve() : settled(Promise.resolve().then(() => supabase.rpc('get_listing_sharing_readiness', { p_property_id: space.id }))).then(reply => {
      if (ticket !== deskVersion || listingGates.get(space.id) !== entry) return;
      if (missingFunction(reply)) { gateGone(); return; }
      // Unreadable is not "nothing to ask": a refusal still names the fix and opens it.
      if (failed(reply)) { entry.answer = null; return; }
      entry.answer = gateAnswer(reply.value?.data);
      gateDraw(entry);
    });
    return entry.ready;
  }
  function gateDraw(entry, focus = false) {
    const { slot, answer } = entry;
    const mode = !answer || !gateAvailable ? null : entry.changing || answer.reason === 'occupancy' ? 'question'
      : answer.reason === 'consent' ? 'consent' : answer.occupancy !== 'unknown' ? 'summary' : null;
    slot.dataset.occupancy = mode || 'none';
    if (!mode) { slot.hidden = true; slot.replaceChildren(); return; }
    slot.hidden = false;
    const said = annualNode('p', 'occupancy-said'); said.hidden = true; said.tabIndex = -1; entry.said = said;
    // Behind the quiet disclosure its summary names the question, so the title inside is said, not drawn twice.
    const wrapped = Boolean(answer.grandfathered && answer.reason);
    const refs = { titleClass: wrapped ? 'occupancy-title render-sr' : 'occupancy-title' };
    const body = mode === 'summary' ? gateSummary(entry, refs) : mode === 'question' ? gateQuestion(entry, refs) : gateConsent(entry, refs);
    if (wrapped) {
      // A live share from before the gate: no warning, one quiet line, the question behind it.
      const box = annualNode('details', 'account-details occupancy-later');
      box.open = entry.open || entry.changing || focus;
      const summary = annualNode('summary');
      summary.append(annualNode('span', 'occupancy-later-title', mode === 'consent' ? GATE_WORDS.consentTitle : GATE_WORDS.question),
        annualNode('span', 'occupancy-quiet', GATE_WORDS.quiet));
      box.addEventListener('toggle', () => { entry.open = box.open; });
      box.append(summary, body, said);
      slot.replaceChildren(box);
    } else slot.replaceChildren(body, said);
    const notice = gateNotices.get(entry.space.id); gateNotices.delete(entry.space.id);
    if (notice) gateSay(entry, notice);
    if (focus || gateFocus === entry.space.id) {
      gateFocus = null;
      (refs.first || (notice ? said : null) || refs.change)?.focus?.({ preventScroll: true });
      slot.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
  }
  function gateQuestion(entry, refs) {
    const { space, answer } = entry;
    const form = annualNode('form', 'veylet-form occupancy-form'); form.noValidate = true;
    const group = annualNode('fieldset', 'choice-group occupancy-choices');
    const why = annualNode('p', 'occupancy-why', GATE_WORDS.why); why.id = 'occupancy-why-' + space.id;
    group.setAttribute('aria-describedby', why.id);
    group.append(annualNode('legend', refs.titleClass, GATE_WORDS.question), why);
    const inputs = [];
    for (const [value, label] of GATE_OPTIONS) {
      const choice = annualNode('label', 'choice occupancy-choice');
      const input = annualNode('input'); input.type = 'radio'; input.name = 'occupancy-' + space.id; input.value = value;
      input.checked = entry.changing && answer.occupancy === value;
      input.dataset.control = 'occupancy-' + value;
      choice.append(input, annualNode('span', 'occupancy-choice-text', label));
      group.append(choice); inputs.push(input);
    }
    const problem = annualNode('small', 'field-problem'); problem.id = 'occupancy-problem-' + space.id; problem.hidden = true;
    group.append(problem);
    const save = annualNode('button', 'tour-action tour-action-primary', GATE_WORDS.save); save.type = 'submit'; save.dataset.control = 'occupancy-save';
    const row = annualRow(save);
    if (entry.changing) {
      const keep = button(GATE_WORDS.keep, () => { entry.changing = false; gateDraw(entry, true); });
      keep.dataset.control = 'occupancy-keep'; row.append(keep);
    }
    form.append(group, row);
    refs.first = inputs.find(input => input.checked) || inputs[0];
    form.addEventListener('change', () => { problem.hidden = true; group.setAttribute('aria-describedby', why.id); });
    form.addEventListener('submit', event => {
      event?.preventDefault?.();
      const chosen = inputs.find(input => input.checked);
      if (!chosen) {
        problem.textContent = GATE_WORDS.choose; problem.hidden = false;
        group.setAttribute('aria-describedby', why.id + ' ' + problem.id); inputs[0].focus?.();
        return;
      }
      void gateSave(entry, 'set_listing_occupancy', { p_property_id: space.id, p_occupancy: chosen.value }, save,
        chosen.value === 'tenanted' ? GATE_WORDS.savedTenants : GATE_WORDS.saved);
    });
    return form;
  }
  function gateConsentProblems(reference, signed) {
    const problems = {};
    const text = reference.trim();
    if (!text) problems.reference = GATE_WORDS.noReference;
    else if (text.length > 120) problems.reference = GATE_WORDS.longReference;
    if (!annualDay(signed)) problems.signed = GATE_WORDS.noDate;
    else if (signed > annualToday()) problems.signed = GATE_WORDS.future;
    return problems;
  }
  function gateConsent(entry, refs) {
    const { space } = entry;
    const form = annualNode('form', 'veylet-form occupancy-form occupancy-consent'); form.noValidate = true;
    const heading = annualNode('h4', refs.titleClass, GATE_WORDS.consentTitle);
    const note = annualNode('p', 'occupancy-note', GATE_WORDS.consentNote + ' ');
    const help = annualNode('a', 'occupancy-help', GATE_WORDS.help); help.href = GATE_HELP;
    note.append(help);
    const field = (key, label, input, hint) => {
      const wrap = annualNode('label', 'occupancy-field');
      input.id = 'occupancy-' + key + '-' + space.id; input.name = 'consent-' + key;
      const error = annualNode('small', 'field-problem'); error.id = input.id + '-error'; error.hidden = true;
      wrap.append(annualNode('span', 'clients-field-label', label), input);
      if (hint) { const small = annualNode('small', 'occupancy-hint', hint); small.id = input.id + '-hint'; wrap.append(small); input.setAttribute('aria-describedby', small.id); }
      wrap.append(error);
      return { wrap, input, error, hint: hint ? input.id + '-hint' : '' };
    };
    const referenceInput = annualNode('input'); referenceInput.type = 'text'; referenceInput.maxLength = 120;
    referenceInput.autocomplete = 'off'; referenceInput.setAttribute('autocomplete', 'off'); referenceInput.spellcheck = false;
    referenceInput.dataset.control = 'consent-reference';
    const signedInput = annualNode('input'); signedInput.type = 'date'; signedInput.max = annualToday(); signedInput.setAttribute('max', annualToday());
    signedInput.dataset.control = 'consent-signed';
    const reference = field('reference', GATE_WORDS.reference, referenceInput, GATE_WORDS.referenceHint);
    const signed = field('signed', GATE_WORDS.signed, signedInput, '');
    const record = annualNode('button', 'tour-action tour-action-primary', GATE_WORDS.record); record.type = 'submit'; record.dataset.control = 'consent-record';
    const change = button(GATE_WORDS.change, () => { entry.changing = true; gateDraw(entry, true); });
    change.dataset.control = 'occupancy-change';
    form.append(annualNode('p', 'occupancy-answer', GATE_WORDS.tenants), heading, note, reference.wrap, signed.wrap, annualRow(record, change));
    refs.first = referenceInput; refs.change = change;
    let attempted = false;
    const paint = problems => {
      for (const [key, part] of [['reference', reference], ['signed', signed]]) {
        const text = problems[key] || '';
        part.error.textContent = text; part.error.hidden = !text;
        if (text) part.input.setAttribute('aria-invalid', 'true'); else part.input.removeAttribute('aria-invalid');
        const described = [part.hint, text ? part.error.id : ''].filter(Boolean).join(' ');
        if (described) part.input.setAttribute('aria-describedby', described); else part.input.removeAttribute('aria-describedby');
      }
    };
    form.addEventListener('input', () => { if (attempted) paint(gateConsentProblems(referenceInput.value, signedInput.value)); });
    form.addEventListener('submit', event => {
      event?.preventDefault?.();
      attempted = true;
      const problems = gateConsentProblems(referenceInput.value, signedInput.value);
      paint(problems);
      if (problems.reference) { referenceInput.focus?.(); return; }
      if (problems.signed) { signedInput.focus?.(); return; }
      void gateSave(entry, 'record_tenant_consent', { p_property_id: space.id, p_consent_reference: referenceInput.value.trim(), p_consented_on: signedInput.value },
        record, GATE_WORDS.recorded);
    });
    return form;
  }
  function gateSummary(entry, refs) {
    const { answer } = entry;
    const wrap = annualNode('div', 'occupancy-summary');
    let words = GATE_SUMMARY[answer.occupancy];
    if (answer.occupancy === 'tenanted') {
      const date = window.VeyletSharing?.hostingDate?.(answer.recordedAt) || '';
      words = 'Tenants live here. Written consent recorded' + (date ? ' on ' + date : '') + (answer.reference ? ' (reference: ' + answer.reference + ').' : '.');
    }
    const change = button(GATE_WORDS.change, () => { entry.changing = true; gateDraw(entry, true); });
    change.dataset.control = 'occupancy-change';
    wrap.append(annualNode('p', 'occupancy-summary-text', words), change);
    refs.change = change;
    return wrap;
  }
  // Saves one answer, then reads the desk again so every card on the listing says what sharing waits for now.
  async function gateSave(entry, name, args, control, notice) {
    if (entry.busy) return;
    entry.busy = true; control.disabled = true;
    gateSay(entry, GATE_WORDS.saving);
    const reply = await settled(Promise.resolve().then(() => entry.supabase.rpc(name, args)));
    entry.busy = false;
    if (entry.ticket !== deskVersion || listingGates.get(entry.space.id) !== entry) return;
    control.disabled = false;
    const consent = name === 'record_tenant_consent';
    if (sessionGone(reply)) {
      showSignedOut(consent ? 'Your sign-in has expired, so the consent wasn’t recorded. Sign in again to record it.'
        : 'Your sign-in has expired, so your answer wasn’t saved. Sign in again to answer it.');
      return;
    }
    if (missingFunction(reply)) { gateGone(); return; }
    if (failed(reply)) {
      const words = String((reply.value?.error || reply.error || {}).message || '').toLowerCase();
      // The home was not declared tenanted after all (another person changed it): ask that first.
      if (consent && words.includes('declare the home tenanted')) {
        entry.answer = { ...entry.answer, occupancy: 'unknown', reason: 'occupancy' }; entry.changing = false;
        gateDraw(entry, true); gateSay(entry, GATE_WORDS.askFirst, true);
        return;
      }
      gateSay(entry, /permission|not allowed/.test(words) ? GATE_WORDS.role : networkFailed(reply) || offlineNow() ? GATE_WORDS.offline
        : consent ? GATE_WORDS.notRecorded : GATE_WORDS.notSaved, true);
      return;
    }
    entry.changing = false;
    gateNotices.set(entry.space.id, notice);
    gateFocus = entry.space.id;
    setStatus(notice);
    await loadDesk(entry.supabase);
  }
  // A refusal's one fix: open this listing's question or consent form where the person is.
  function gateOpen(propertyId, reason) {
    const entry = listingGates.get(propertyId);
    if (!entry || !gateAvailable) return;
    const wanted = reason === 'consent' ? 'consent' : 'occupancy';
    // The refusal is newer than what this page read: ask for what it says is missing.
    if (!entry.answer || entry.answer.reason !== wanted) {
      entry.answer = { reference: '', recordedAt: null, grandfathered: false, ...(entry.answer || {}),
        occupancy: wanted === 'consent' ? 'tenanted' : 'unknown', reason: wanted };
    }
    entry.changing = false; entry.open = true;
    gateDraw(entry, true);
  }

  // `hosting` is this walkthrough's get_tour_hosting row: undefined when the
  // dates could not load. It only chooses words; it never gates a control.
  // `title` is its space's name, the listing title a share and a QR file carry.
  async function tourReview(tour, item, supabase, role, ticket, hosting, title) {
    const canReview = role === 'owner' || role === 'reviewer';
    const canShare = canReview || (role === 'operator' && tour.created_by === currentUserId);
    const say = rowSay(tour, item);
    const status = message(item, 'Checking approval…');
    const result = await settled(supabase.rpc('get_tour_review', { p_tour_id: tour.id }));
    if (ticket !== deskVersion) return;
    if (failed(result)) { status.textContent = 'Approval status is unavailable. Refresh to retry; this page cannot confirm that sharing is approved.'; if (canShare && tour.share_token) stopSharing(tour, supabase, ticket, item); return; }
    const review = firstRow(result.value?.data);
    // An approved walkthrough is past its review: its render status gives way to this card.
    if (review?.approved === true) renderApproved.add(tour.id); else renderApproved.delete(tour.id);
    tourApproval.set(tour.id, review?.approved === true);
    // An approval whose sharing did not turn on is said on the card it lands on, once.
    const pending = sharePending.get(tour.id); sharePending.delete(tour.id);
    if (review?.approved === true) {
      const live = Boolean(tour.share_token);
      const paused = sharePaused(tour);
      // Whether sharing anew waits for the listing's answer or the tenant's consent.
      if (canShare && (!live || paused)) {
        await gateReady(tour.property_id);
        if (ticket !== deskVersion) { if (pending) sharePending.set(tour.id, pending); return; }
      }
      const gate = canShare && (!live || paused) ? gateBlock(tour.property_id) : null;
      if (paused) {
        status.className = 'tour-state-help tour-hosting';
        status.textContent = PAUSED_LINE;
      } else if (live) {
        status.className = 'tour-state-help tour-hosting';
        status.textContent = hostingWords(hosting || null, true);
        // Approved and shared in one press, whatever the first answer said: it is live.
        if (pending) say(LIVE_SAID);
      } else {
        const off = hostingWords(hosting || null, false);
        tourChip(tour, off ? 'Sharing off' : '', 'quiet');
        const problem = pending && canShare ? pending.reason || 'unknown' : gate;
        status.textContent = problem ? shareWords(problem) : off || (canShare
          ? 'Approved. Sharing isn’t on yet.' : 'Approved. The workspace owner or this walkthrough’s creator can turn sharing on.');
        if (problem) status.className = 'tour-state-help tour-share-problem';
        if (pending && problem) setStatus(shareWords(problem));
      }
      if (render?.answers) renderDraw();
      // Its views sit under the state line, on a live or paused link.
      if (live) { const views = document.createElement('div'); item.append(views); tourViews(tour, views, supabase, ticket); }
      if (canShare) {
        if (paused) resumeSharing(tour, item, supabase, ticket, gate);
        else if (live) liveSharing(tour, item, title);
        else turnOnSharing(tour, item, supabase, ticket, { label: hostingWords(hosting || null, false) ? 'Turn sharing back on' : 'Turn sharing on',
          withPreview: canReview, note: hostingWords(hosting || null, false) ? '' : LIVE_LINE,
          problem: pending ? pending.reason || 'unknown' : gate });
      }
      // Videos and stills: an approved version, for whoever may share it (the request's roles).
      if (canShare) listingExports(tour, item, supabase, ticket);
      const manage = (canShare && live) || canReview ? manageSharing(item) : null;
      if (manage && canShare && live && !paused) pauseSharing(tour, supabase, ticket, manage);
      if (manage && canShare && live) stopSharing(tour, supabase, ticket, manage);
      if (manage && canReview) withdrawApproval(tour, supabase, ticket, manage);
      return;
    }
    // Not approved: "Ready for your review" to whoever reviews; anyone else reads whose it is.
    // An old link without a current review already shows "not available" (lookup_tour_share).
    tourChip(tour, canReview ? READY_TITLE : 'Ready for review', canReview ? 'good' : 'busy');
    if (render?.answers) renderDraw();
    status.textContent = !canReview ? 'Awaiting the workspace owner’s approval. This walkthrough is not approved for sharing yet.'
      : tour.share_token ? 'Its link shows "not available" until you approve and share this version again.' : 'Nobody else can see it until you approve and share it.';
    if (canShare && tour.share_token) stopSharing(tour, supabase, ticket, item);
    if (!canReview) return;
    // A later version of a walkthrough asks the server how approving it counts:
    // whether it uses the allowance, and whether the existing link moves to it.
    const correction = revisionOf(tour) > 1;
    const [targetResult, lineageResult] = await Promise.all([
      settled(supabase.rpc('get_tour_review_target', { p_tour_id: tour.id })),
      correction ? settled(Promise.resolve().then(() => supabase.rpc('get_walkthrough_revision', { p_tour_id: tour.id }))) : null,
    ]);
    if (ticket !== deskVersion) return;
    if (sessionGone(targetResult) || (lineageResult && sessionGone(lineageResult))) { showSignedOut('Your sign-in expired. Sign in before starting a fresh review.'); return; }
    const target = firstRow(targetResult.value?.data);
    if (failed(targetResult) || target?.tour_id !== tour.id || target.storage_path !== tour.storage_path || !/^[a-f0-9]{64}$/.test(target.package_revision || '')) {
      status.textContent = 'The current package version could not be confirmed. Approval is unavailable; reload to start a fresh review.';
      item.append(button('Reload package review', () => loadDesk(supabase))); return;
    }
    const lineageRow = lineageResult && !failed(lineageResult) ? firstRow(lineageResult.value?.data) : null;
    const lineage = lineageRow && lineageRow.tour_id === tour.id && typeof lineageRow.approval_uses_allowance === 'boolean'
      && typeof lineageRow.link_moves_on_approval === 'boolean' ? lineageRow : null;
    if (lineage?.superseded_at) {
      // Replaced since this page loaded: nothing here can be approved any more.
      status.textContent = 'A newer version of this walkthrough was approved and replaced this one. Reload to see the current version.';
      item.append(button('Reload walkthroughs', () => loadDesk(supabase))); return;
    }
    if (correction) message(item, correctionWords(tour, lineage), 'tour-state-help tour-correction');
    // Capture before enabling preview or checks. Never replace this snapshot
    // during submission: the authoritative RPC rejects a changed object even
    // when its storage path is reused.
    const snapshot = Object.freeze({ path: target.storage_path, revision: target.package_revision });
    const preview = tourPreview(tour, item, snapshot.revision);
    const details = document.createElement('details'); details.className = 'tour-review';
    details.open = tour.id === deskTarget;
    const summary = document.createElement('summary'); summary.textContent = 'Review this walkthrough'; details.append(summary);
    const form = document.createElement('form');
    const fields = {};
    const labels = { ...reviewChecks, capture_permission: 'I have the property’s permission for this capture.', publication_permission: 'I have permission to publish and share this exact tour.' };
    for (const [key, label] of Object.entries(labels)) {
      const row = document.createElement('label'); const input = document.createElement('input');
      input.type = 'checkbox'; input.required = true; input.name = key; fields[key] = input;
      const text = document.createElement('span'); text.textContent = label;
      row.append(input, text); form.append(row);
    }
    message(form, 'Open the review preview in a new tab, then check this exact package. This records a human review, not an automatic quality score. Leave a check clear if it needs correction.');
    // What the one press does, before it is pressed. A correction says its own (the
    // link moves, or not), and the 12 months run from a first release only.
    const moves = lineage?.link_moves_on_approval === true;
    if (!correction && hosting !== undefined && !hosting?.released_at) message(form, 'Anyone with the link can open it and forward it. It stays online while your plan runs and at least 12 months after today.', 'tour-state-help tour-share-terms');
    // The quality check's advice for this walkthrough, if any: read, never a block.
    const flagSlot = document.createElement('div'); flagSlot.hidden = true; form.append(flagSlot);
    reviewFlagSlots.set(tour.id, flagSlot); paintReviewFlags(flagSlot, reviewFlags.get(tour.id));
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'button'; save.textContent = 'Approve and share'; form.append(save);
    // A failed check needs somewhere to go: one itemised request, not a thread
    // of separate emails. The message opens in the person's own mail app; nothing
    // is sent from this page and no approval is recorded.
    const corrections = document.createElement('a'); corrections.className = 'tour-action'; corrections.textContent = 'Request corrections by email';
    const correctionsHref = () => {
      const open = Object.keys(reviewChecks).filter(key => !fields[key].checked).map(key => '- ' + reviewChecks[key]);
      // The walkthrough reference lets the studio record the new package against this
      // walkthrough, so the correction uses no second walkthrough from the allowance.
      const reference = String(walkthroughOf(tour)).slice(0, 8);
      const body = ['Walkthrough reference: ' + reference, 'Version: ' + revisionOf(tour), 'Tour reference: ' + String(tour.id).slice(0, 8),
        'Package: ' + snapshot.revision.slice(0, 12), '',
        'Checks that need correction:', ...(open.length ? open : ['- (tick the checks that pass, then use this link again)']), '',
        'Where it happens (captured view number, room or doorway):', '', 'Leave out street addresses and access details.'].join('\n');
      return 'mailto:yoda@yodalai.xyz?subject=' + encodeURIComponent('Veylet corrections · walkthrough ' + reference) + '&body=' + encodeURIComponent(body);
    };
    corrections.href = correctionsHref();
    corrections.addEventListener('click', () => { corrections.href = correctionsHref(); say('Your mail app opens with the unchecked items listed. One consolidated request keeps corrections to a single round.'); });
    form.append(corrections);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (save.disabled || Object.values(fields).some(field => !field.checked)) return;
      save.disabled = true;
      const checks = Object.fromEntries(Object.keys(reviewChecks).map(key => [key, fields[key].checked]));
      const reply = await settled(supabase.rpc('review_tour_versioned', { p_tour_id: tour.id, p_expected_storage_path: snapshot.path, p_expected_package_revision: snapshot.revision, p_checks: checks, p_capture_permission: fields.capture_permission.checked, p_publication_permission: fields.publication_permission.checked }));
      if (ticket !== deskVersion) return;
      if (sessionGone(reply)) { showSignedOut('Your sign-in expired. Sign in and check the saved review before continuing.'); return; }
      if (failed(reply) || firstRow(reply.value?.data)?.approved !== true) {
        if (reply.value?.error?.details === 'VEYLET_REVISION_SUPERSEDED') {
          // Another approval of a later version won. Show the walkthrough as it is now,
          // and put the reason on its current version, since this one is no longer listed.
          const replaced = 'A newer version of this walkthrough was approved, so this version was not. Your walkthroughs have been reloaded to show the current one.';
          setStatus(replaced);
          rowNotice = { walkthroughId: walkthroughOf(tour), text: replaced };
          await loadDesk(supabase); return;
        }
        const changed = reply.value?.error?.details === 'VEYLET_PACKAGE_REVISION_CHANGED';
        const capacityBlocked = ['VEYLET_PLAN_NOT_ACTIVE', 'VEYLET_WALKTHROUGH_CAPACITY_EXHAUSTED'].includes(reply.value?.error?.details);
        const sandboxBlocked = reply.value?.error?.details === 'VEYLET_SANDBOX_TEST_ONLY';
        const explanation = sandboxBlocked ? 'Test purchase · real walkthroughs require a live plan. This test subscription cannot accept production work or use an extra walkthrough.' : changed ? 'The package changed. Your previous checks were cleared. Start a fresh review and open its preview before checking it again.' : capacityBlocked ? (APP_MODE ? 'This walkthrough was not accepted. Your plan’s walkthroughs are used; see your plan in the app, or Veylet support can confirm available capacity. No charge was created. Start a fresh review after capacity is confirmed.'
          : 'This walkthrough was not accepted. Refresh your plan allowance below; a walkthrough pack adds more, or Veylet support can confirm available capacity. No charge was created. Start a fresh review after capacity is confirmed.') : 'Review was not confirmed. Your previous checks were cleared. Start a fresh review to check the current package and saved review state.';
        for (const field of Object.values(fields)) { field.checked = false; field.disabled = true; }
        preview.removeAttribute('href'); preview.setAttribute('aria-disabled', 'true'); preview.tabIndex = -1;
        status.textContent = explanation; say(explanation);
        item.append(button('Start a fresh review', () => loadDesk(supabase))); return;
      }
      // A correction's first approval moves the walkthrough's link here and retires the
      // earlier version, so the desk is read again rather than patched.
      if (moves) { say('Approved. Your existing link and embed now show this version.', true); await loadDesk(supabase); return; }
      // A first release: the same press turns sharing on. The approval stands whatever
      // sharing answers; the desk is read again and the card says which it is.
      setStatus('Approved. Turning sharing on…');
      const shared = await settled(Promise.resolve().then(() => supabase.rpc('enable_tour_share', { p_tour_id: tour.id })));
      if (sessionGone(shared)) { if (ticket === deskVersion) showSignedOut('Your sign-in expired. The walkthrough is approved; sign in and turn sharing on from its card.'); return; }
      // The desk was read again meanwhile: read it once more, so it shows what sharing did.
      if (ticket !== deskVersion) { if (currentUserId) void loadDesk(supabase); return; }
      if (failed(shared) || !shared.value?.data) {
        sharePending.set(tour.id, { reason: shareRefusal(shared) });
        setStatus(shareWords(shareRefusal(shared)));
      } else { sharePending.delete(tour.id); say(LIVE_SAID, true); }
      await loadDesk(supabase);
    });
    details.append(form); item.append(details);
    reviewOpeners.set(tour.id, () => {
      details.open = true;
      summary.focus?.({ preventScroll: true });
      summary.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    });
  }

  /* ---- Your plan -------------------------------------------------------
   * Three free months with six walkthroughs in total, started by activating the
   * plan with a payment method on file, then the Veylet plan unless cancelled
   * before the first charge on the day they end (offer 2026-09-25.2): monthly,
   * two walkthroughs a month where unused ones roll over (at most four banked),
   * or annual, a yearly pool of 24 walkthroughs. This panel only reports what get_workspace_plan
   * and get_walkthrough_capacity return; the rollover and the yearly pool are
   * stated only when the capacity answer carries them. An error means the state
   * is unavailable — never that it is empty, started or approved — and nothing
   * here takes a card.
   */
  const planPanel = document.getElementById('account-plan');
  const planBody = document.getElementById('account-plan-body');
  const deletionPanel = document.getElementById('account-deletion');
  const PLAN_STATUSES = ['pending', 'trial', 'active', 'ended'];
  const PLAN_TERMS = ['State', 'Free walkthroughs', 'Renews', 'Hosting', 'Extra walkthroughs', 'Managed in'];
  // The State row says the state in the app's own short words; the date belongs
  // to the Renews row, and the full sentence to the body.
  const PLAN_STATE_WORDS = { pending: 'Not started', trial: 'Free months', active: 'Active', ended: 'Ended' };
  // Where the money is arranged decides which price is true for this account.
  const PLAN_SOURCES = ['studio', 'apple', 'web'];
  const PLAN_SOURCE_WORDS = { apple: 'App Store', web: 'Website', studio: 'Studio invoice' };
  // Plan code to the name customers see. Offer 2026-09-25.2 sells one plan, the
  // Veylet plan (code solo), monthly or annual; Team (studio), Office, One
  // walkthrough and the founding rate are retired for new buyers, and an existing
  // row on one of them still reads by its own name. The studio desk states the
  // same names from the same table.
  const PLAN_NAMES = { solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  // App Store product to plan and cadence, as offer.json lists the product IDs.
  // The App Store sells the Veylet plan monthly and annual (appStore.sold); the
  // two Team IDs stay mapped so an existing verified row still reads correctly.
  const APPLE_PRODUCTS = { 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] };
  // offer.json freeMonths: 3 months, 6 walkthroughs in total.
  const PLAN_DEFAULT_TRIAL_MONTHS = 3;
  const PLAN_DEFAULT_TRIAL_WALKTHROUGHS = 6;
  const PLAN_DASH = '—';
  const PLAN_TEST_ALLOWANCE = 'Production walkthroughs are not included in a sandbox subscription.';
  // Sandbox reads the same way on the plan and on both cards: "Test ·", then what is not live.
  const PLAN_TEST_LINE = 'Test · App Store Sandbox: a test subscription, not a live payment.';

  function planIsSandbox(row, capacity) {
    return (planSource(row) === 'apple' && row.apple_environment === 'Sandbox') || capacity?.reason_code === 'sandbox_test_only';
  }

  // An offer count, in digits as the offer writes it; anything else states nothing.
  function planMonths(value) {
    const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return value !== '' && Number.isInteger(count) && count >= 1 && count <= 24 ? String(count) : '';
  }
  function planCount(value) {
    if (value === null || value === undefined || value === '') return PLAN_DASH;
    const count = Number(value);
    return Number.isFinite(count) ? String(count) : PLAN_DASH;
  }
  /** Integer cents, written the way the invoice would: A$99, or A$119.99. */
  function planMoney(cents) {
    const amount = Number(cents);
    if (cents === null || cents === undefined || cents === '' || !Number.isInteger(amount) || amount < 0) return '';
    const dollars = amount / 100;
    return 'A$' + dollars.toLocaleString('en-AU', {
      minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  /* An App Store account pays Apple's price, so that is the only price it may
   * be shown. Anything else is the website price. */
  function planSource(row) {
    const source = row && typeof row === 'object' ? row.source : null;
    return PLAN_SOURCES.includes(source) ? source : null;
  }
  // The monthly list price is not an annual renewal total. Older Apple rows
  // may supply only a product ID; an unknown invoice cadence stays unknown.
  function planInterval(row) {
    const value = row && row.billing_interval;
    const explicit = ['monthly', 'annual', 'once'].includes(value) ? value : null;
    if (planSource(row) !== 'apple') return explicit;
    const product = Object.prototype.hasOwnProperty.call(APPLE_PRODUCTS, row.apple_product_id) ? APPLE_PRODUCTS[row.apple_product_id][1] : null;
    if (explicit && product && explicit !== product) return null;
    return product || explicit;
  }
  // The plan an account is on. An App Store product names its own plan; a row
  // whose code disagrees with its product is not given either name.
  function planCode(row) {
    const code = row && Object.prototype.hasOwnProperty.call(PLAN_NAMES, row.plan_code) ? row.plan_code : null;
    if (planSource(row) !== 'apple' || !Object.prototype.hasOwnProperty.call(APPLE_PRODUCTS, row.apple_product_id)) return code;
    const product = APPLE_PRODUCTS[row.apple_product_id][0];
    return code && code !== product ? null : product;
  }
  function planPrice(row) {
    if (!row || !planSource(row) || !planInterval(row)) return '';
    if (row.renewal_price_aud_cents !== null && row.renewal_price_aud_cents !== undefined) {
      return planMoney(row.renewal_price_aud_cents);
    }
    if (planInterval(row) !== 'monthly') return '';
    return planMoney(planSource(row) === 'apple' ? row.app_price_aud_cents : row.price_aud_cents);
  }
  function planBilling(row) {
    const price = planPrice(row);
    return price ? price + (planInterval(row) === 'annual' ? ' a year' : planInterval(row) === 'once' ? ' once' : ' a month') : '';
  }
  function planDate(value) {
    if (!value) return '';
    const when = new Date(value);
    return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  // offer.json plans[0].rollover.maxBanked: unused monthly walkthroughs bank up to 4.
  const PLAN_MAX_BANKED = 4;
  /*
   * How the running plan's allowance counts, from what get_walkthrough_capacity
   * appends (offers 2026-09-25.1 and .2): allowance_kind, banked_units (already inside a
   * monthly plan's included_limit) and bonus_credits_available (already inside
   * extra_credits_available). An annual pool's included_* numbers are the plan
   * year's, and allowance_ends_at the day it resets. Each needs the row's own
   * cadence to agree; a missing or odd field states nothing rather than a guess.
   */
  function planAllowance(row, cap) {
    const bonus = cap && Number.isInteger(cap.bonus_credits_available) && cap.bonus_credits_available > 0
      && cap.bonus_credits_available <= cap.extra_credits_available ? cap.bonus_credits_available : null;
    const none = { banked: null, rollover: false, pool: false, poolEnds: '', bonus };
    if (!cap || cap.plan_status !== 'active' || planIsSandbox(row, cap)) return none;
    if (cap.allowance_kind === 'annual_pool' && planInterval(row) === 'annual') {
      return { ...none, pool: true, poolEnds: planDate(cap.allowance_ends_at) };
    }
    if (cap.allowance_kind === 'monthly' && planInterval(row) === 'monthly' && Number.isInteger(cap.banked_units)
      && cap.banked_units >= 0 && cap.banked_units <= PLAN_MAX_BANKED && cap.banked_units < cap.included_limit) {
      // Only the Veylet plan rolls over; a retired plan's row keeps its own terms.
      return { ...none, banked: cap.banked_units, rollover: planCode(row) === 'solo' };
    }
    return none;
  }
  /*
   * The same words the app and the studio desk use, from the same fields. A row
   * that cannot state its own date, price or length is unavailable rather than a
   * sentence with a hole in it.
   */
  function planVocabulary(row, sandbox = planIsSandbox(row)) {
    const unavailable = { status: 'unavailable', title: 'Plan status unavailable', body: 'Refresh to check your free months and allowance.' };
    const status = row && typeof row === 'object' && PLAN_STATUSES.includes(row.status) ? row.status : null;
    const accepted = planCount(row && row.accepted_this_period) + ' of ' + planCount(row && row.included_per_month);
    if (status === 'pending') {
      const months = planMonths(row.trial_months);
      const included = planMonths(row.trial_included_walkthroughs);
      return months && included ? { status, title: 'Plan not started',
        body: 'Review the available plan. Eligible subscribers can start with ' + months + ' free months and ' + included + ' walkthroughs in total.' } : unavailable;
    }
    if (status === 'trial') {
      const until = planDate(row.trial_ends_at);
      const billing = planBilling(row);
      const used = planCount(row.accepted_in_free_months);
      const allowance = planCount(row.trial_included_walkthroughs);
      if (!until || (!sandbox && (used === PLAN_DASH || allowance === PLAN_DASH))) return unavailable;
      // The heading is the state; the sentence is the reminder, with the price that follows.
      // No reminder email is running yet, so none is promised here.
      const free = 'Free until ' + until;
      const renewal = row.auto_renews === false
        ? 'It ends on ' + until + ' and will not renew.'
        : row.auto_renews !== true ? 'Check your renewal setting with your billing provider.'
          : billing ? free + ', then ' + billing + ' unless you cancel.'
            : 'Confirm the renewal amount and billing period with your billing provider before the free months end.';
      return { status, title: free,
        body: (sandbox ? PLAN_TEST_ALLOWANCE + ' ' : used + ' of ' + allowance + ' free walkthroughs used. ') + renewal };
    }
    if (status === 'active') {
      const billing = planBilling(row);
      const until = planDate(row.current_period_ends_at);
      if (!until) return unavailable;
      const renewal = row.auto_renews === false ? 'Ends ' + until + '; will not renew.'
        : row.auto_renews === true ? 'Next billing date: ' + until + '.'
          : 'Current period ends ' + until + '; check your renewal setting.';
      return { status, title: (sandbox ? 'Test · ' : '') + (PLAN_NAMES[planCode(row)] || 'Plan') + ' · ' + (billing || 'confirm billing details'),
        // How an annual allowance counts (a yearly pool) is the capacity answer's to say, below.
        body: sandbox ? PLAN_TEST_ALLOWANCE + ' ' + renewal : (planInterval(row) === 'once' ? 'One walkthrough included in this paid service period. ' : accepted + ' walkthroughs this month. ') + renewal + ' Hosting included.' +
          (planInterval(row) === 'annual' ? ' Billed annually.' : '') };
    }
    if (status === 'ended') {
      const afterPlan = row.current_period_ends_at !== null && row.current_period_ends_at !== undefined;
      const ended = planDate(afterPlan ? row.current_period_ends_at : row.trial_ends_at);
      return ended ? { status, title: (afterPlan ? 'Plan ended ' : 'Free months ended ') + ended,
        body: 'Your released walkthroughs stay hosted for twelve months after their release. Ask about restarting the plan; a second free trial is not guaranteed.' } : unavailable;
    }
    return unavailable;
  }
  function planHairline(parent, term, value, figure) {
    const group = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd');
    if (figure) dd.className = 'plan-figure';
    if (typeof value === 'string') dd.textContent = value; else dd.append(value);
    group.append(dt, dd); parent.append(group); return dd;
  }
  // Waiting for a number is not a state. Show the rows that are coming, each bar
  // as long as its words usually are and wrapped like them, in the line box of the
  // text it stands in for, so nothing moves when the answer arrives.
  function skeletonWords(length) {
    const sizes = [6, 4, 7, 3, 5, 8];
    let text = '';
    for (let i = 0; text.length < length; i += 1) text += (text ? ' ' : '') + 'n'.repeat(sizes[i % sizes.length]);
    return text.slice(0, Math.max(1, length));
  }
  function skeletonBar(length, className = 'plan-skeleton') {
    const bar = document.createElement('span'); bar.className = className;
    bar.setAttribute('aria-hidden', 'true'); bar.textContent = skeletonWords(length);
    return bar;
  }
  function skeletonLine(tag, className, length) {
    const line = document.createElement(tag); line.className = className;
    line.append(skeletonBar(length, 'plan-skeleton plan-skeleton-line'));
    return line;
  }
  // The ledger's answers at their usual lengths: state, count, date, hosting, extras, source.
  const PLAN_SKELETON_LENGTHS = [11, 24, 14, 90, 11, 14];
  function planSkeleton() {
    if (!planPanel || !planBody) return;
    planPanel.setAttribute('aria-busy', 'true');
    if (APP_MODE) {
      // The app's page shows the state alone, so only that row is coming.
      const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
      planHairline(dl, 'State', skeletonBar(PLAN_SKELETON_LENGTHS[0]), false);
      planBody.replaceChildren(dl);
      return;
    }
    const lead = document.createElement('p'); lead.className = 'plan-title';
    lead.append(skeletonBar(24, 'plan-skeleton plan-skeleton-lead'));
    const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
    PLAN_TERMS.forEach((term, i) => planHairline(dl, term, skeletonBar(PLAN_SKELETON_LENGTHS[i]), false));
    const note = document.createElement('p'); note.className = 'plan-body';
    note.textContent = 'Checking your free months, what is left and when the plan renews…';
    const capacity = document.createElement('div'); capacity.className = 'plan-capacity';
    capacity.append(skeletonLine('p', 'plan-allowance', 44), skeletonLine('p', 'plan-scope', 150));
    const actions = document.createElement('p'); actions.className = 'tour-actions-row plan-actions';
    actions.append(skeletonBar(12, 'plan-skeleton plan-skeleton-link'), skeletonBar(36, 'plan-skeleton plan-skeleton-link'));
    planBody.replaceChildren(lead, dl, note, capacity, skeletonLine('p', 'plan-scope', 120), actions);
    // Whether the free months can start here depends on the plan row, so that card waits for it.
    trialHide();
    packsSkeleton();
    annualSkeleton();
    referralSkeleton();
  }
  function planWorkspaceName(id, props) {
    const properties = props && !failed(props) ? props.value?.data || [] : [];
    const match = properties.find(row => row.workspace_id === id);
    return match?.title || 'workspace ' + String(id || '').slice(0, 8);
  }
  // The current desk's capacity read, so a bought pack can re-read the ledger.
  let planCapacityRefresh = null;
  /*
   * The app's page (/app/account): the plan's state in words and where to manage it,
   * nothing else. No amount, allowance for sale, renewal price, card form, bundle,
   * annual offer or referral is read or drawn here; the app is where a plan is bought.
   */
  async function renderPlanApp(supabase, ticket, members) {
    const memberships = (failed(members) ? [] : members.value?.data || []).filter(row => row && row.workspace_id);
    const workspaceID = memberships.length ? memberships[0].workspace_id : null;
    let row = null;
    if (workspaceID) {
      const reply = await settled(Promise.resolve().then(() => supabase.rpc('get_workspace_plan', { p_workspace_id: workspaceID })));
      if (ticket !== deskVersion) return;
      row = !failed(reply) ? firstRow(reply.value?.data) : null;
    }
    planPanel.setAttribute('aria-busy', 'false');
    const status = row && typeof row === 'object' && PLAN_STATUSES.includes(row.status) ? row.status : !workspaceID && !failed(members) ? 'pending' : null;
    const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
    planHairline(dl, 'State', status ? PLAN_STATE_WORDS[status] : 'Status unavailable', false);
    const body = document.createElement('p'); body.className = 'plan-body';
    body.textContent = status ? 'See your plan in the app.' : 'Your plan’s state could not be checked. Refresh to try again.';
    const parts = [dl, body];
    if (!status) { const actions = document.createElement('p'); actions.className = 'tour-actions-row plan-actions'; actions.append(button('Refresh plan status', () => loadDesk(supabase))); parts.push(actions); }
    planBody.replaceChildren(...parts);
  }
  async function renderPlan(supabase, ticket, props, members) {
    if (!planPanel || !planBody) return;
    planCapacityRefresh = null;
    if (APP_MODE) { await renderPlanApp(supabase, ticket, members); return; }
    const memberships = (failed(members) ? [] : members.value?.data || []).filter(row => row && row.workspace_id);
    const workspaceID = memberships.length ? memberships[0].workspace_id : null;
    let row = null;
    let view;
    if (!workspaceID && !failed(members)) {
      // No workspace yet is not a failed lookup. There is nothing to refresh;
      // the free months start when the plan is activated either way.
      const start = planVocabulary({ status: 'pending', trial_months: PLAN_DEFAULT_TRIAL_MONTHS,
        trial_included_walkthroughs: PLAN_DEFAULT_TRIAL_WALKTHROUGHS });
      view = { ...start, body: start.body + ' Add a space to prepare your account. Saving a space does not activate the plan.' };
    } else {
      const reply = workspaceID
        ? await settled(supabase.rpc('get_workspace_plan', { p_workspace_id: workspaceID }))
        : null;
      if (ticket !== deskVersion) return;
      row = reply && !failed(reply) ? firstRow(reply.value?.data) : null;
      view = planVocabulary(row);
    }
    planPanel.setAttribute('aria-busy', 'false');
    // The app leads with the vocabulary title, then the rows, then the sentence.
    // This is where an active account's price is stated.
    const lead = document.createElement('p'); lead.className = 'plan-title'; lead.textContent = view.title;
    const parts = [lead];
    // Said once, after the free months started on this page: what the answer said.
    let notice = null;
    if (planNotice) {
      notice = document.createElement('p'); notice.className = 'annual-notice plan-notice'; notice.textContent = planNotice; notice.tabIndex = -1;
      parts.push(notice); planNotice = null;
    }
    // A Sandbox purchase says so first, in the same "Test ·" words as the two cards below.
    if (row?.apple_environment === 'Sandbox') {
      const sandbox = document.createElement('p'); sandbox.className = 'plan-scope plan-test';
      sandbox.textContent = PLAN_TEST_LINE;
      parts.push(sandbox);
    }
    if (memberships.length > 1) {
      const scope = document.createElement('p'); scope.className = 'plan-scope';
      scope.textContent = 'Showing ' + planWorkspaceName(workspaceID, props) + '. You are an active member of ' +
        memberships.length + ' workspaces; ask Veylet support to see another one here.';
      parts.push(scope);
    }
    const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
    planHairline(dl, 'State', PLAN_STATE_WORDS[view.status] || PLAN_DASH, false);
    const source = planSource(row);
    const sandboxPlan = planIsSandbox(row);
    let usageCell = null;
    let usageTerm = null;
    let extraCell = null;
    if (view.status === 'unavailable' || !row) {
      planHairline(dl, 'Free walkthroughs', PLAN_DASH, true);
      planHairline(dl, 'Renews', view.status === 'pending' ? 'Not started' : PLAN_DASH, true);
      planHairline(dl, 'Hosting', PLAN_DASH, false);
      planHairline(dl, 'Extra walkthroughs', PLAN_DASH, true);
      planHairline(dl, 'Managed in', PLAN_DASH, false);
    } else {
      // On the plan the month is the unit; before it, the free months' total is.
      if (sandboxPlan) {
        usageCell = planHairline(dl, 'Walkthroughs', 'Test subscription', false);
      } else if (view.status === 'active') {
        usageCell = planHairline(dl, planInterval(row) === 'once' ? 'Paid service period' : 'This month', planCount(row.accepted_this_period) + ' of ' + planCount(row.included_per_month) + ' accepted', true);
        // An annual pool renames this row in place once the capacity answer says so.
        usageTerm = dl.children[dl.children.length - 1].children[0];
      } else {
        usageCell = planHairline(dl, 'Free walkthroughs',
          planCount(row.accepted_in_free_months) + ' of ' + planCount(row.trial_included_walkthroughs), true);
      }
      const renewsOn = planDate(view.status === 'active' ? row.current_period_ends_at : row.trial_ends_at);
      planHairline(dl, 'Renews', view.status === 'pending' ? 'Not started'
        : view.status === 'ended' ? PLAN_DASH
          : row.auto_renews === false ? 'Does not renew' : row.auto_renews === true ? renewsOn || PLAN_DASH : 'Check billing provider', true);
      planHairline(dl, 'Hosting', row.hosting_included === true ? 'Included while your plan is active; each shared walkthrough at least 12 months from release'
        : row.hosting_included === false ? 'Not included' : PLAN_DASH, false);
      // Packs and any settled extras, counted by the acceptance ledger below; the
      // single A$ extra price is retired (offer 2026-09-24.2), so no price is stated.
      extraCell = planHairline(dl, 'Extra walkthroughs', PLAN_DASH, true);
      planHairline(dl, 'Managed in', source ? PLAN_SOURCE_WORDS[source] : PLAN_DASH, false);
    }
    parts.push(dl);
    const body = document.createElement('p'); body.className = 'plan-body'; body.textContent = view.body;
    parts.push(body);
    // What is left follows the sentence: one count line, rewritten in place when
    // the acceptance ledger answers, and one short note under it.
    const capacity = document.createElement('div'); capacity.className = 'plan-capacity';
    const capacityNote = document.createElement('p'); capacityNote.className = 'plan-scope';
    let allowance = null;
    let baseNote = '';
    let cadence = '';
    if (row && !sandboxPlan && ['trial', 'active'].includes(view.status)) {
      const free = view.status === 'trial';
      const once = planInterval(row) === 'once';
      const used = free ? row.accepted_in_free_months : row.accepted_this_period;
      const included = free ? row.trial_included_walkthroughs : row.included_per_month;
      if (Number.isInteger(used) && used >= 0 && Number.isInteger(included) && included >= 0) {
        const remaining = Math.max(0, included - used);
        allowance = document.createElement('p'); allowance.className = 'plan-allowance';
        allowance.textContent = remaining > 0
          ? remaining + ' included walkthrough' + (remaining === 1 ? '' : 's') + ' remaining ' + (free ? 'across your free months.' : once ? 'in this paid service period.' : 'this month.')
          : 'Your included walkthroughs are used for ' + (free ? 'these free months.' : once ? 'this paid service period.' : 'this month.');
        // Whether unused walkthroughs roll over (monthly) or form a yearly pool (annual)
        // is said only from the capacity answer below; an annual row claims no monthly reset.
        cadence = free ? '' : once ? ' This single walkthrough does not reset monthly.'
          : planInterval(row) === 'annual' ? '' : ' The allowance resets monthly.';
        // A pack is named here only when it is the next step; otherwise its card follows.
        baseNote = (free ? 'Saving a space or a failed capture does not use one.' : cadence.trim()) + (remaining > 0 ? ''
          : ' Need more walkthroughs? A walkthrough pack adds them; they are used after your included ones. Saving another space does not authorize a charge.' +
            (free ? ' Your free-months end date stays the same.' : ''));
        capacity.append(allowance);
      }
    }
    if (workspaceID && row) {
      capacityNote.textContent = 'Checking acceptance capacity and extra walkthroughs…';
      capacity.append(capacityNote);
    }
    if (capacity.children.length) parts.push(capacity);
    const actions = document.createElement('p'); actions.className = 'tour-actions-row plan-actions';
    const manageNote = text => { const note = document.createElement('p'); note.className = 'plan-scope'; note.textContent = text; parts.push(note); };
    if (view.status === 'unavailable') actions.append(button('Refresh plan status', () => loadDesk(supabase)));
    if (source === 'apple') {
      const manage = document.createElement('a'); manage.className = 'text-link';
      manage.href = 'https://apps.apple.com/account/subscriptions';
      manage.textContent = 'Manage or cancel in the App Store'; actions.append(manage);
      manageNote('Manage in Settings › Subscriptions, or with the link below from the Apple Account that bought the plan; Apple confirms any change first. Packs are not sold in the app.');
    } else if (['pending', 'ended'].includes(view.status) && source !== 'studio' && source !== 'web') {
      manageNote('Start in the app through the App Store, where Apple checks introductory-offer eligibility: install Veylet Capture and sign in with this email. ' +
        'The App Store confirms the price and billing period before you subscribe, and the first charge is on the day the free months end.');
    }
    if (view.status !== 'unavailable') {
      const offer = document.createElement('a'); offer.className = 'text-link';
      offer.href = '/offer'; offer.textContent = 'See the offer';
      actions.append(offer);
    }
    if (source === 'studio' || source === 'web') {
      const ask = document.createElement('a'); ask.className = 'text-link';
      ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan';
      ask.textContent = ['pending', 'ended'].includes(view.status) ? 'Ask Veylet support about a plan' : 'Request a plan change or cancellation';
      actions.append(ask);
      // A plan paid by card is a website plan, not an invoice. During the free months
      // the card on file is not charged until they end, and cancelling first charges nothing.
      const firstCharge = view.status === 'trial' && row.auto_renews === true ? planDate(row.trial_ends_at) : '';
      manageNote(source === 'web'
        ? (firstCharge ? 'Your card is charged first on ' + firstCharge + ', the day your free months end. Cancel before then and nothing is charged. ' : '') +
          'Your card plan is managed by Veylet support: email to change or cancel it; nothing changes until Veylet confirms it in writing.'
        : 'Invoiced plans are managed by Veylet support; nothing changes until Veylet confirms it in writing.');
    }
    if (actions.children.length) parts.push(actions);
    planBody.replaceChildren(...parts);
    notice?.focus?.();
    // Starting the free months, walkthrough packs, the annual plan and the share
    // link read their own answers; none of them ever holds up the plan.
    void renderTrial(supabase, ticket, workspaceID, row);
    void renderPacks(supabase, ticket, workspaceID);
    void renderAnnual(supabase, ticket, workspaceID, row);
    // Recording who referred this office is for its owner, before the plan is paid for.
    const owner = memberships.length > 0 && memberships[0].role === 'owner';
    void renderReferral(supabase, ticket, workspaceID, owner && ['pending', 'trial'].includes(row?.status));
    if (!workspaceID || !row) return;
    // Read again after a pack is bought, so this panel and the packs card state
    // the same balance from the same ledger.
    const readCapacity = async () => {
      const reply = await settled(supabase.rpc('get_walkthrough_capacity', { p_workspace_id: workspaceID }));
      if (ticket !== deskVersion) return;
      const cap = !failed(reply) ? firstRow(reply.value?.data) : null;
      const numbers = ['included_limit', 'included_used', 'included_remaining', 'extra_credits_available'];
      const valid = cap && typeof cap === 'object' && numbers.every(key => Number.isInteger(cap[key]) && cap[key] >= 0) &&
        typeof cap.can_accept === 'boolean' && (cap.reason_code === null || typeof cap.reason_code === 'string') &&
        [...PLAN_STATUSES, 'unavailable'].includes(cap.plan_status) && cap.included_remaining === Math.max(0, cap.included_limit - cap.included_used);
      if (!valid) {
        if (extraCell) extraCell.textContent = PLAN_DASH;
        capacityNote.textContent = sandboxPlan ? 'Test · this test subscription’s capacity could not be verified. ' + PLAN_TEST_ALLOWANCE
          : (baseNote ? baseNote + ' ' : '') + 'Live capacity and the extra-walkthrough balance could not be verified; the counts above are the last reported. Ask Veylet support before sending work beyond the included allowance.';
        capacity.replaceChildren(...[allowance, capacityNote].filter(Boolean)); return;
      }
      // The acceptance ledger is authoritative. A plan count alone does not
      // distinguish an included unit from a previously settled extra.
      if (planIsSandbox(row, cap)) {
        if (usageCell) usageCell.textContent = 'Test subscription';
        body.textContent = planVocabulary(row, true).body;
        capacityNote.textContent = 'Test · real walkthroughs need a live plan. This test subscription cannot accept production work or spend an extra walkthrough.';
        capacity.replaceChildren(capacityNote); return;
      }
      // Offer 2026-09-25.1, only where the answer carries it (older servers do not):
      // a monthly plan's banked rollover, and an annual plan's yearly pool.
      const { banked, rollover, pool, poolEnds, bonus } = planAllowance(row, cap);
      if (usageCell && ['trial', 'active'].includes(cap.plan_status)) usageCell.textContent = cap.included_used + ' of ' + cap.included_limit + ' included accepted';
      if (pool && usageTerm) usageTerm.textContent = 'Plan year';
      if (extraCell) extraCell.textContent = cap.extra_credits_available + ' available';
      if (cap.plan_status === 'trial') body.textContent = view.body.replace(/^.*?free walkthroughs used\./, cap.included_used + ' of ' + cap.included_limit + ' included free walkthroughs used.');
      if (pool) body.textContent = view.body.replace(/^.*? walkthroughs this month\./, cap.included_used + ' of ' + cap.included_limit + ' walkthroughs used this plan year.');
      // Bonus walkthroughs (early annual, referral) are extra walkthroughs too; the line says how many.
      const extras = cap.extra_credits_available + ' extra walkthrough' + (cap.extra_credits_available === 1 ? '' : 's') + ' available' +
        (bonus ? ', including ' + bonus + ' bonus' : '') + '.';
      const balance = allowance || document.createElement('p'); balance.className = 'plan-allowance';
      balance.textContent = pool ? cap.included_remaining + ' of ' + cap.included_limit + ' walkthroughs left this plan year · ' + extras
        : cap.included_remaining + ' included walkthrough' + (cap.included_remaining === 1 ? '' : 's') + ' remaining · ' + extras;
      const counting = pool ? ' Your ' + cap.included_limit + ' walkthroughs are a yearly pool to use any time, with no monthly limit' +
          (poolEnds ? '; it resets on ' + poolEnds : '') + '. Unused ones do not carry into the next plan year.'
        : banked !== null && (banked > 0 || rollover)
          ? (banked > 0 ? ' This month’s ' + cap.included_limit + ' include ' + banked + ' banked from earlier months.' : '') +
            (rollover ? ' Unused monthly walkthroughs roll over, up to ' + PLAN_MAX_BANKED + ' banked.' : '')
          : cadence;
      const resolve = document.createElement('a'); resolve.className = 'text-link';
      resolve.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20walkthrough%20capacity';
      resolve.textContent = 'Resolve walkthrough capacity with Veylet support';
      if (cap.can_accept) {
        // The packs card follows, so an open allowance needs no link of its own.
        capacityNote.textContent = (cap.included_remaining === 0 ? 'The next new walkthrough uses one extra walkthrough, the one that expires first. ' : '') +
          'Each new walkthrough you approve uses one, even another of the same property; saving a space, a failed capture or a correction uses none.' + counting;
        capacity.replaceChildren(balance, capacityNote);
        return;
      }
      capacityNote.textContent = cap.reason_code === 'allowance_exhausted'
        ? 'Your included walkthroughs are used and no extra walkthrough is available, so another can be accepted once a walkthrough pack adds more. Nothing is charged automatically and no debt is created.' + (cap.plan_status === 'trial' ? ' Your free-months end date stays the same.' : '')
        : 'New walkthrough acceptance is paused until your plan and paid service dates are confirmed. Contact Veylet support; existing reviewed work is unchanged. A pack or an extra walkthrough does not activate an expired or unverified plan.';
      capacity.replaceChildren(balance, capacityNote, resolve);
    };
    planCapacityRefresh = readCapacity;
    await readCapacity();
  }

  /* ---- Start the free months ---------------------------------------------
   * Offer 2026-09-25.2: the free months start with a payment method on file. On
   * this website that is a card in Square's own field, loaded by the same loader
   * as the annual plan and packs; POST /square/trial/start saves it and schedules
   * the first charge for the day the free months end, so nothing is charged today
   * and cancelling before then charges nothing. What is offered (the months, the
   * walkthroughs, both plans' prices and the first charge day) is the server's
   * answer (get_trial_offer); whether card payment is open, and whether it is
   * Square Sandbox, is the hooks lane's. The card shows only while the plan has
   * not started and is not an App Store plan, and it has one filled action.
   */
  const trialEl = document.getElementById('account-trial');
  const TRIAL_MISSING = ['not_owner', 'trial_used', 'already_started'];
  const TRIAL_INTERVALS = ['monthly', 'annual'];
  const TRIAL_CARD_FIELD = 'account-trial-card-field';
  const TRIAL_TEST_LINE = 'Test · Square Sandbox: a test card, not a live payment.';
  // Each of these is refused before a card is saved or a trial is started.
  const TRIAL_REFUSALS = {
    payment_declined: 'Your card was declined, so nothing was set up and nothing was charged. Check the details or use another card, then try again.',
    trial_used: 'This agency or workspace has already had its free months, so nothing was set up. Ask Veylet support about starting the plan.',
    abn_invalid: 'That ABN wasn’t accepted, so nothing was set up. Check the 11 digits, then try again.',
    not_eligible: 'Free months aren’t available for this workspace right now, so nothing was set up.',
    lane_closed: 'Card sign-up is closed right now, so nothing was set up.',
    invalid_request: 'The start wasn’t accepted, so nothing was set up. Try again.',
  };
  // No answer, or checkout_failed: nothing is charged today either way, and the same
  // attempt id makes a retry finish the same start rather than begin a second one.
  const TRIAL_UNCONFIRMED = 'Your free months weren’t confirmed. Nothing is charged today. Try again: a retry never starts a second trial or charges twice.';
  const TRIAL_ABN_ERROR = 'That isn’t a valid ABN. Enter your agency’s 11-digit ABN, as shown on ABN Lookup.';
  let trial = null;
  let trialVersion = 0;
  // One line the plan panel says once, after the free months start here.
  let planNotice = null;

  // An Australian Business Number: 11 digits whose weighted sum, after taking 1
  // from the first digit, divides by 89 (the ATO's published check).
  function trialAbn(value) {
    const digits = String(value || '').replace(/\s+/g, '');
    if (!/^\d{11}$/.test(digits)) return '';
    const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const sum = digits.split('').reduce((total, digit, index) => total + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index], 0);
    return sum % 89 === 0 ? digits : '';
  }
  function trialPlanValid(plan) {
    return Boolean(plan) && typeof plan === 'object' && TRIAL_INTERVALS.includes(plan.interval)
      && Number.isInteger(plan.cents) && plan.cents > 0 && Number.isInteger(plan.included) && plan.included > 0;
  }
  function trialValid(offer) {
    if (!offer || typeof offer !== 'object' || typeof offer.eligible !== 'boolean' || !Array.isArray(offer.missing)
      || !Array.isArray(offer.plans) || offer.missing.some(code => !TRIAL_MISSING.includes(code))) return false;
    // Closed, it says why and names no price; open, it names both plans once, the
    // months, the walkthroughs and a first charge day that is still to come.
    if (!offer.eligible) return offer.missing.length > 0 && offer.plans.length === 0;
    return !offer.missing.length && Number.isInteger(offer.months) && offer.months >= 1 && offer.months <= 12
      && Number.isInteger(offer.walkthroughs) && offer.walkthroughs > 0 && annualFuture(offer.first_charge_on)
      && offer.plans.every(trialPlanValid) && TRIAL_INTERVALS.every(interval => offer.plans.filter(plan => plan.interval === interval).length === 1);
  }
  function trialKind(offer, lane) {
    if (!trialValid(offer)) return 'error';
    // Started meanwhile (another tab, or the app): the plan above says so.
    if (offer.missing.includes('already_started')) return 'hidden';
    if (offer.missing.includes('not_owner')) return 'not-owner';
    if (offer.missing.includes('trial_used')) return 'used';
    if (!lane) return 'lane-error';
    return lane.open ? 'choose' : 'lane-closed';
  }
  // Square Sandbox labels every price and payment action, as on the other two card forms.
  function trialTest(state) { return state.lane?.sandbox === true || state.sandbox === true ? 'Test · ' : ''; }
  function trialPlans(state) { return TRIAL_INTERVALS.map(interval => state.offer.plans.find(plan => plan.interval === interval)); }
  function trialChosen(state) { return trialPlans(state).find(plan => plan.interval === state.interval) || trialPlans(state)[0]; }
  function trialBilling(cents, interval) { return planMoney(cents) + (interval === 'annual' ? ' a year' : ' a month'); }
  function trialCharge(state) {
    const plan = trialChosen(state);
    return trialTest(state) + 'Nothing is charged today. First charge ' + planMoney(plan.cents) + ' on ' + annualDay(state.offer.first_charge_on) +
      ', the day your free months end. Cancel before then and nothing is charged.';
  }
  function trialPrimaryLabel(state) {
    return trialTest(state) + (state.problem ? 'Try again' : state.card ? 'Start free months' : 'Add a card and start free months');
  }
  function trialBonusWords(offer) {
    const bonus = offer && offer.early_annual_bonus;
    if (!bonus || typeof bonus !== 'object' || !Number.isInteger(bonus.walkthroughs) || bonus.walkthroughs <= 0) return '';
    const express = annualBonusExpress(bonus);
    return '+' + bonus.walkthroughs + ' walkthroughs' + (express ? ' and ' + express + ' super fast renders' : '') + ' in your first plan year for choosing it now';
  }
  // Money is a statement: the plan, the price, what it includes, then the early bonus.
  function trialOption(state, plan) {
    const body = annualNode('span', 'annual-option-body');
    body.append(annualNode('span', 'annual-option-name', plan.interval === 'annual' ? 'Annual' : 'Monthly'),
      annualNode('span', 'annual-amount', trialTest(state) + trialBilling(plan.cents, plan.interval)),
      annualNode('span', 'annual-qualifier', plan.interval === 'annual'
        ? plan.included + ' walkthroughs to use any time in the plan year'
        : plan.included + ' walkthroughs a month; unused ones roll over, up to ' + PLAN_MAX_BANKED + ' banked'));
    const bonus = plan.interval === 'annual' ? trialBonusWords(state.offer) : '';
    if (bonus) body.append(annualNode('span', 'annual-qualifier trial-bonus', bonus));
    return body;
  }
  function trialPlanList(state) {
    const list = annualNode('ul', 'annual-plans');
    for (const plan of trialPlans(state)) { const item = annualNode('li'); item.append(trialOption(state, plan)); list.append(item); }
    return list;
  }
  function trialHead(refs) {
    const head = annualNode('div', 'annual-head');
    const title = annualNode('h3', 'annual-title', 'Start your free months');
    title.id = 'account-trial-title'; title.tabIndex = -1;
    if (refs) refs.title = title;
    head.append(title);
    return head;
  }
  // The ABN is said beside its field, on blur and again before the card opens,
  // and what was typed is kept across every redraw.
  function trialAbnCheck(state, refs) {
    const digits = trialAbn(refs.abn ? refs.abn.value : state.abn);
    // An ABN the server refused stays refused until something else is typed.
    const refused = Boolean(digits) && digits === state.abnRefused;
    const ok = Boolean(digits) && !refused;
    state.abnError = !ok;
    if (refs.abnError) { refs.abnError.textContent = ok ? '' : refused ? TRIAL_REFUSALS.abn_invalid : TRIAL_ABN_ERROR; refs.abnError.hidden = ok; }
    if (refs.abn) {
      if (ok) refs.abn.removeAttribute('aria-invalid'); else refs.abn.setAttribute('aria-invalid', 'true');
      refs.abn.setAttribute('aria-describedby', ok ? 'account-trial-abn-hint' : 'account-trial-abn-hint account-trial-abn-error');
    }
    return ok;
  }
  function trialAbnField(state, refs) {
    const wrap = annualNode('div', 'trial-abn');
    const label = annualNode('label', 'trial-abn-label', 'Your agency’s ABN'); label.htmlFor = 'account-trial-abn';
    const input = annualNode('input', 'trial-abn-input');
    input.id = 'account-trial-abn'; input.name = 'abn'; input.type = 'text'; input.inputMode = 'numeric';
    input.autocomplete = 'off'; input.maxLength = 14; input.required = true; input.spellcheck = false; input.value = state.abn || '';
    input.setAttribute('aria-describedby', 'account-trial-abn-hint');
    const hint = annualNode('p', 'trial-abn-hint', 'One trial per agency (ABN) and workspace. 11 digits, spaces are fine.'); hint.id = 'account-trial-abn-hint';
    const error = annualNode('p', 'trial-abn-error', ''); error.id = 'account-trial-abn-error'; error.hidden = true;
    input.addEventListener('input', () => { state.abn = input.value; if (state.abnError) trialAbnCheck(state, refs); });
    input.addEventListener('blur', () => { state.abn = input.value; if (String(input.value || '').trim()) trialAbnCheck(state, refs); });
    refs.abn = input; refs.abnError = error;
    wrap.append(label, input, hint, error);
    if (state.abnError) trialAbnCheck(state, refs);
    return wrap;
  }
  // Choosing changes only the words beside the button, so focus stays on the choice.
  function trialSync(state, refs) {
    if (refs.charge) refs.charge.textContent = trialCharge(state);
    if (refs.pay) refs.pay.textContent = trialPrimaryLabel(state);
    if (refs.problem) refs.problem.hidden = true;
  }
  function trialProblem(state, text) {
    state.problem = text || null;
    const refs = state.refs || {};
    if (refs.problemText) refs.problemText.textContent = text || '';
    if (refs.problem) refs.problem.hidden = !text;
    if (refs.pay) { refs.pay.textContent = trialPrimaryLabel(state); refs.pay.disabled = false; }
    if (text) setStatus(text);
  }
  function trialDropCard(state) {
    const card = state?.card;
    if (!card) return;
    state.card = null;
    Promise.resolve().then(() => card.destroy?.()).catch(() => {});
  }
  function trialCloseOther() {
    const state = trial;
    if (!state || state.busy || !state.card) return;
    trialDropCard(state); state.problem = null; trialDraw();
  }
  function trialParts(state, refs) {
    const { kind, offer } = state;
    if (kind === 'hidden') return null;
    const parts = [trialHead(refs)];
    const say = (className, text) => { const node = annualNode('p', className, text); parts.push(node); return node; };
    // Sandbox is said once, under the heading, before any "Test ·" price or button.
    if (trialTest(state) && kind === 'choose') say('plan-scope plan-test', TRIAL_TEST_LINE);
    if (state.notice) say('annual-notice', state.notice);
    if (kind === 'error') {
      say('annual-lead', 'Couldn’t check how to start your free months here.');
      say('annual-note', 'Nothing has changed. You can also start them in the app through the App Store.');
      const retry = button('Try again', () => { void renderTrial(state.supabase, deskVersion, state.workspaceID, state.planRow, { focus: 'title' }); });
      refs.retry = retry; parts.push(annualRow(retry));
      return parts;
    }
    if (kind === 'not-owner') { say('annual-lead', 'Only the workspace owner can start the free months here.'); return parts; }
    if (kind === 'used') {
      say('annual-lead', 'This agency or workspace has already had its free months.');
      say('annual-note', 'A second free trial is not available. Veylet support can start the plan with you.');
      const ask = annualNode('a', 'text-link', 'Ask Veylet support about the plan'); ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan';
      refs.primary = ask; parts.push(annualRow(ask));
      return parts;
    }
    say('annual-lead', offer.months + ' free months with ' + offer.walkthroughs + ' walkthroughs. A card on file starts them, and nothing is charged today.');
    if (kind === 'lane-error' || kind === 'lane-closed') {
      parts.push(trialPlanList(state));
      say('annual-lead annual-soon', kind === 'lane-closed' ? 'Card sign-up on this website opens soon.' : 'Card payment couldn’t be reached, so a card can’t be added right now.');
      say('annual-note', 'Until then, start in the app through the App Store, or ask Veylet support for invoice terms.');
      const ask = annualNode('a', 'text-link', 'Ask Veylet support about invoice terms'); ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20free%20months';
      refs.primary = ask;
      if (kind === 'lane-error') {
        const retry = button('Check again', () => { void renderTrial(state.supabase, deskVersion, state.workspaceID, state.planRow, { focus: 'title', freshLane: true }); });
        refs.retry = retry; parts.push(annualRow(retry, ask));
      } else parts.push(annualRow(ask));
      return parts;
    }
    parts.push(annualChoice(state, refs, 'After the free months', 'account-trial-plan', trialPlans(state).map(plan => [plan.interval, trialOption(state, plan)]),
      trialChosen(state).interval, value => { state.interval = value; }, trialSync));
    parts.push(trialAbnField(state, refs));
    const charge = say('annual-charge', trialCharge(state)); charge.id = 'account-trial-charge';
    if (state.card) {
      const label = annualNode('p', 'annual-card-label', 'Card details'); label.id = TRIAL_CARD_FIELD + '-label';
      const field = annualNode('div', 'annual-card-field'); field.id = TRIAL_CARD_FIELD;
      field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', label.id); field.tabIndex = -1;
      refs.field = field;
      const block = annualNode('div', 'annual-card'); block.append(label, field); parts.push(block);
    }
    const primary = button(trialPrimaryLabel(state), () => { void (state.card ? trialConfirmCard(primary) : trialOpenCard(primary)); });
    primary.className = 'tour-action tour-action-primary';
    primary.setAttribute('aria-describedby', 'account-trial-charge');
    refs.charge = charge; refs.primary = primary; refs.pay = primary;
    parts.push(state.card ? annualRow(primary, button('Not now', () => trialCloseCard())) : annualRow(primary));
    const problem = annualAlert(state.problem || '', 'annual-alert annual-problem', refs);
    problem.hidden = !state.problem; refs.problem = problem; parts.push(problem);
    say('annual-note', 'Your card goes into Square’s secure form on this page; Veylet never sees it.');
    return parts;
  }
  function trialDraw(focus) {
    const state = trial;
    if (!state || !trialEl) return;
    const refs = {};
    const parts = trialParts(state, refs);
    if (!parts) { trialEl.hidden = true; trialEl.replaceChildren(); return; }
    state.refs = refs;
    trialEl.hidden = false;
    trialEl.replaceChildren(...parts);
    if (focus && refs[focus]) refs[focus].focus();
  }
  function trialHide() {
    trialDropCard(trial);
    trialVersion += 1; trial = null;
    if (!trialEl) return;
    trialEl.hidden = true; trialEl.setAttribute('aria-busy', 'false'); trialEl.replaceChildren();
  }
  // Waiting keeps the card's own shape: the lead, the two plan rows, the charge line and the action.
  function trialSkeleton() {
    if (!trialEl) return;
    trialDropCard(trial);
    trialVersion += 1; trial = null;
    trialEl.hidden = false; trialEl.setAttribute('aria-busy', 'true');
    const choice = annualNode('div', 'annual-choice');
    choice.append(skeletonLine('p', 'annual-skeleton-legend', 21));
    for (const name of [7, 6]) {
      const row = annualNode('div', 'annual-option annual-skeleton-row');
      const body = annualNode('span', 'annual-option-body');
      body.append(skeletonLine('span', 'annual-option-name', name), skeletonLine('span', 'annual-amount', 12), skeletonLine('span', 'annual-qualifier', 48));
      row.append(annualNode('span', 'annual-skeleton-radio'), body);
      choice.append(row);
    }
    const action = annualNode('span', 'plan-skeleton annual-skeleton-action'); action.setAttribute('aria-hidden', 'true');
    trialEl.replaceChildren(trialHead(), annualNode('p', 'annual-lead', 'Checking how to start your free months…'), choice,
      skeletonLine('p', 'annual-charge', 120), annualRow(action));
  }
  async function renderTrial(supabase, ticket, workspaceID, planRow, options = {}) {
    if (!trialEl) return;
    // Only a plan that has not started, and is not Apple's, starts here.
    if (!workspaceID || !planRow || planRow.status !== 'pending' || planSource(planRow) === 'apple') { trialHide(); return; }
    const previous = trial && trial.workspaceID === workspaceID ? trial : null;
    trialSkeleton();
    const version = ++trialVersion;
    const [reply, lane] = await Promise.all([
      settled(Promise.resolve().then(() => supabase.rpc('get_trial_offer', { p_workspace_id: workspaceID }))),
      squareLane(options.freshLane === true),
    ]);
    if (ticket !== deskVersion || version !== trialVersion) return;
    trialEl.setAttribute('aria-busy', 'false');
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to start your free months.'); return; }
    // Before the backend has the function there is nothing to start here; that is not an outage.
    if (reply.value?.error?.code === 'PGRST202') { trialHide(); return; }
    const offer = failed(reply) ? null : firstRow(reply.value?.data);
    trial = { supabase, workspaceID, planRow, offer, lane, kind: trialKind(offer, lane), interval: previous?.interval || 'monthly',
      abn: previous?.abn || '', abnError: false, abnRefused: previous?.abnRefused || null, busy: false, card: null, problem: null, sandbox: false, notice: options.notice || null,
      attemptID: previous?.attemptID || null };
    trialDraw(options.focus);
  }
  // "Add a card and start free months": the ABN first, then Square's card field in the card, with focus in it.
  async function trialOpenCard(control) {
    const state = trial;
    if (!state || state.busy || state.card || state.kind !== 'choose') return;
    if (!trialAbnCheck(state, state.refs || {})) { state.refs?.abn?.focus(); setStatus(TRIAL_ABN_ERROR); return; }
    state.abn = state.refs?.abn?.value ?? state.abn;
    // One card form on the desk at a time.
    closeCardForms('trial');
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Loading card form…';
    setStatus('Loading Square’s card form…');
    let form = annualCardForm(state.lane);
    if (!form) {
      const lane = await squareLane(true);
      if (trial !== state) return;
      if (lane) state.lane = lane;
      form = annualCardForm(lane);
    }
    const made = form ? await settled(annualSdk(form.sdk_url).then(Square => Square.payments(form.application_id, form.location_id).card({ style: SQUARE_CARD_STYLE })))
      : { error: new Error('No card form') };
    if (made.timedOut) annualSdkLoad = null;
    const card = made.timedOut || made.error ? null : made.value;
    if (trial !== state) { Promise.resolve().then(() => card?.destroy?.()).catch(() => {}); return; }
    if (!card || typeof card.attach !== 'function' || typeof card.tokenize !== 'function') {
      state.busy = false; trialProblem(state, ANNUAL_SDK_FAILED); control.focus?.(); return;
    }
    state.card = card;
    trialDraw();
    const attached = await settled(Promise.resolve().then(() => card.attach('#' + TRIAL_CARD_FIELD)));
    if (trial !== state) return;
    state.busy = false;
    if (attached.timedOut || attached.error) {
      trialDropCard(state); state.problem = ANNUAL_SDK_FAILED; trialDraw('pay'); setStatus(ANNUAL_SDK_FAILED); return;
    }
    setStatus('Enter your card in Square’s card form, then start your free months. Nothing is charged today.');
    if (typeof card.focus === 'function') { try { await card.focus('cardNumber'); return; } catch { /* the field itself, below */ } }
    state.refs?.field?.focus();
  }
  function trialCloseCard() {
    const state = trial;
    if (!state || state.busy) return;
    trialDropCard(state); state.problem = null;
    trialDraw('pay');
    setStatus('Card form closed. Nothing was set up.');
  }
  // "Start free months": Square tokenizes the card in its iframe; only that single-use
  // token, the chosen plan and the ABN are sent. The server saves the card and dates
  // the first charge; the page states the dates the answer carries.
  async function trialConfirmCard(control) {
    const state = trial;
    if (!state || state.busy || !state.card) return;
    const plan = trialChosen(state);
    const abn = trialAbn(state.abn);
    if (!abn) { state.abnError = true; trialDraw(); state.refs?.abn?.focus(); setStatus(TRIAL_ABN_ERROR); return; }
    const expected = { interval: plan.interval, cents: plan.cents, first_charge_on: state.offer.first_charge_on };
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Starting…';
    setStatus('Starting your free months…');
    const tokenized = await settled(Promise.resolve().then(() => state.card.tokenize()));
    if (trial !== state) return;
    const result = tokenized.timedOut || tokenized.error ? null : tokenized.value;
    const sourceID = result?.status === 'OK' ? result.token : null;
    if (typeof sourceID !== 'string' || !/^[A-Za-z0-9:_-]{8,512}$/.test(sourceID)) {
      state.busy = false;
      trialProblem(state, 'Square couldn’t use those card details. Check them and try again. Nothing was set up.');
      control.focus?.();
      return;
    }
    const token = await annualToken(state.supabase);
    if (trial !== state) return;
    if (!token) { showSignedOut('Your sign-in has expired. Sign in again to start your free months. Nothing was set up.'); return; }
    // One start intent keeps one attempt id across every Try again, even with a fresh card token.
    const attemptID = state.attemptID || (state.attemptID = packAttemptID());
    const reply = await settled(annualHooks('/square/trial/start', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ workspace_id: state.workspaceID, plan_interval: plan.interval, abn, source_id: sourceID, attempt_id: attemptID }) }), 30000);
    if (trial !== state) return;
    state.busy = false;
    const answer = reply.timedOut || reply.error ? null : reply.value;
    const done = answer?.ok ? answer.body : null;
    const started = done && typeof done === 'object' ? done.trial : null;
    if (started && typeof started === 'object' && TRIAL_INTERVALS.includes(started.plan_interval) && Number.isInteger(started.amount_cents)
      && started.amount_cents > 0 && annualDay(started.first_charge_on) && done.charged_today === false) {
      trialStarted(state, done, expected);
      return;
    }
    const code = answer?.body?.error || (answer?.status === 401 ? 'unauthorized' : null);
    if (code === 'unauthorized') { showSignedOut('Your sign-in has expired. Sign in again to start your free months. Nothing was set up.'); return; }
    if (code === 'already_started' || (answer?.ok && done)) {
      // Started already, or an answer this page cannot read: the server's record is shown.
      trialDropCard(state);
      planNotice = code === 'already_started' ? 'Your free months have already started. This is your plan as it stands now.'
        : 'The answer could not be read. This is your plan as it stands now.';
      setStatus(planNotice);
      void loadDesk(state.supabase);
      return;
    }
    // A refusal is final for this attempt, so the next try is a new intent.
    if (TRIAL_REFUSALS[code]) state.attemptID = null;
    if (code === 'abn_invalid') { state.abnRefused = abn; trialProblem(state, TRIAL_REFUSALS.abn_invalid); trialAbnCheck(state, state.refs || {}); state.refs?.abn?.focus(); return; }
    trialProblem(state, TRIAL_REFUSALS[code] || TRIAL_UNCONFIRMED);
    control.focus?.();
  }
  // Started: the plan panel reads its row again and says, once, what the answer said:
  // the plan, its price and the first charge day. Nothing was charged.
  function trialStarted(state, done, expected) {
    trialDropCard(state);
    const started = done.trial;
    const sandbox = done.sandbox === true || state.lane?.sandbox === true ? 'Test · ' : '';
    const differs = started.plan_interval !== expected.interval || started.amount_cents !== expected.cents || started.first_charge_on !== expected.first_charge_on;
    planNotice = sandbox + 'Free months started. Nothing was charged today. First charge ' + planMoney(started.amount_cents) +
      ' on ' + annualDay(started.first_charge_on) + ' and ' + trialBilling(started.amount_cents, started.plan_interval) + ' after that until you cancel; cancel before then and nothing is charged.' +
      (differs ? ' These are the terms your free months started with; they differ from what was shown before you confirmed.' : '');
    state.attemptID = null;
    setStatus(planNotice);
    void loadDesk(state.supabase);
  }

  /* ---- Annual plan --------------------------------------------------------
   * The Veylet plan paid yearly by card on this website, at the one public
   * annual price (offer 2026-09-25.2: A$990 for a yearly pool of 24; before it,
   * docs/design/members-annual-offer-20260924.md). The workspace owner can choose
   * it once the free months have started. Eligibility, the price, the start date,
   * any early-annual bonus (4 walkthroughs and 4 express renders while the free
   * months run) and any scheduled plan are the server's answer (get_members_annual_offer);
   * whether card checkout is open, and whether it is Square Sandbox, is the hooks
   * lane's answer. There is no plan to choose: the card states the one price,
   * takes the card in Square's own field, sends only its single-use token with
   * the start the owner chose, and reads the result back. An App Store member
   * turns off App Store renewal first, so nobody pays twice. It never infers a
   * state from a click, never compares with the App Store, and shows at most one
   * filled action in any state.
   */
  const annualEl = document.getElementById('account-annual');
  // 'no_accepted_walkthrough' only comes from a server older than offer 2026-09-25.1,
  // which still asked for an accepted walkthrough; its locked state is kept for it.
  const ANNUAL_MISSING = ['not_owner', 'free_months_not_started', 'no_accepted_walkthrough'];
  // The Veylet plan (solo) is the only annual plan sold; a year already
  // scheduled or running on the retired Team plan (studio) still reads by its name.
  const ANNUAL_CODES = ['solo', 'studio'];
  const ANNUAL_PLAN = 'solo';
  // offer.json plans[0].annualIncluded: the Veylet plan's yearly pool.
  const ANNUAL_INCLUDED = 24;
  const ANNUAL_APPLE = 'https://apps.apple.com/account/subscriptions';
  // Card entry is Square's own Web Payments iframe. Its script comes only from
  // Square's CDN, loads only after "Pay yearly by card", and only once.
  const ANNUAL_SDK_URLS = ['https://sandbox.web.squarecdn.com/v1/square.js', 'https://web.squarecdn.com/v1/square.js'];
  const ANNUAL_CARD_FIELD = 'account-annual-card-field';
  const ANNUAL_SDK_FAILED = 'Card form couldn’t load. Try again.';
  const ANNUAL_TEST_LINE = 'Test · Square Sandbox: a test checkout, not a live payment.';
  // What each refusal means. Whether anything was charged is said only where it is certain.
  const ANNUAL_REFUSALS = {
    checkout_failed: 'The yearly plan wasn’t confirmed.',
    not_eligible: 'The annual plan isn’t available for this workspace right now, so nothing was set up.',
    apple_still_renews: 'App Store renewal is still on, so nothing was set up. Turn it off in the App Store, then try again.',
    start_now_unavailable: 'Starting today is no longer available, so nothing was set up. Choose the later start, then try again.',
    already_scheduled: 'A yearly plan is already scheduled for this workspace, so nothing more was set up.',
    lane_closed: 'Card payment for the annual price is closed right now, so nothing was set up.',
  };
  // Square declined the card before the yearly plan started (HTTP 402). Certain, so said whole.
  const ANNUAL_DECLINED = 'Your card was declined, so nothing was charged and the yearly plan hasn’t started. Check the details or use another card, then try again.';
  // A retry after a failed first charge waits until Square confirms the failed start stopped.
  const ANNUAL_RETRY_WAIT = ' Square may still be stopping the start that failed. Try again in a few minutes: a retry never charges twice.';
  let annualSdkLoad = null;
  let annualVersion = 0;
  let annual = null;
  let annualCheckedAt = 0;

  function annualNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  /** A calendar day as the server sends it (Brisbane), written without a timezone shift. */
  function annualDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return '';
    const when = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(when.getTime()) || when.getUTCDate() !== Number(match[3])) return '';
    return when.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function annualToday() {
    const parts = {};
    try {
      for (const part of new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date())) parts[part.type] = part.value;
    } catch { return new Date().toISOString().slice(0, 10); }
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function annualFuture(day) { return Boolean(annualDay(day)) && day > annualToday(); }
  function annualPlanValid(plan) {
    return Boolean(plan) && typeof plan === 'object' && ANNUAL_CODES.includes(plan.code)
      && ['year_cents', 'monthly_cents', 'months_free', 'saving_cents'].every(key => Number.isInteger(plan[key]) && plan[key] > 0)
      && plan.months_free < 12
      // "N months free" and the saving are stated, so they must be exactly what the numbers say.
      && plan.year_cents === plan.monthly_cents * (12 - plan.months_free)
      && plan.saving_cents === plan.monthly_cents * 12 - plan.year_cents;
  }
  function annualValid(offer) {
    if (!offer || typeof offer !== 'object' || typeof offer.eligible !== 'boolean'
      || !Array.isArray(offer.missing) || !Array.isArray(offer.plans)) return false;
    if (offer.missing.some(code => !ANNUAL_MISSING.includes(code))) return false;
    // A locked answer never carries prices; an unlocked one always carries its start.
    if (!offer.eligible && offer.plans.length) return false;
    if (offer.eligible && (offer.missing.length || !offer.plans.length || !annualDay(offer.starts_on))) return false;
    if (!offer.plans.every(annualPlanValid) || new Set(offer.plans.map(plan => plan.code)).size !== offer.plans.length) return false;
    // An unlocked answer must carry the Veylet plan's price; any other plan in it is not offered.
    if (offer.eligible && !offer.plans.some(plan => plan.code === ANNUAL_PLAN)) return false;
    const scheduled = offer.scheduled;
    if (scheduled !== null && scheduled !== undefined && !(typeof scheduled === 'object' && ANNUAL_CODES.includes(scheduled.plan_code)
      && Number.isInteger(scheduled.year_cents) && scheduled.year_cents > 0 && annualDay(scheduled.starts_on))) return false;
    const pending = offer.checkout_pending;
    if (!(pending === null || pending === undefined || (typeof pending === 'object' && ANNUAL_CODES.includes(pending.plan_code)))) return false;
    // A first yearly charge that failed carries the price it was bought at, the day it was
    // due and whether a retry is already waiting on Square; a retry starts from starts_on.
    const failedStart = offer.start_failed;
    return failedStart === null || failedStart === undefined || (typeof failedStart === 'object'
      && ANNUAL_CODES.includes(failedStart.plan_code) && Number.isInteger(failedStart.year_cents) && failedStart.year_cents > 0
      && Boolean(annualDay(failedStart.starts_on)) && typeof failedStart.retrying === 'boolean' && Boolean(annualDay(offer.starts_on)));
  }
  /* One state from the two answers. A bought plan outranks the tier; the lane
   * only matters where a price or a payment action is shown. */
  function annualKind(offer, lane) {
    if (!annualValid(offer)) return 'error';
    if (offer.active_annual === true) return 'active';
    if (offer.missing.includes('not_owner')) return 'not-owner';
    // Named whatever the lane says: the failure is a fact about money, and hiding it
    // behind "couldn't check" would leave the owner thinking the year had started.
    if (offer.start_failed) return 'start-failed';
    if (offer.conflict === true) return lane ? 'conflict' : 'error';
    if (offer.scheduled) return lane ? 'scheduled' : 'error';
    if (offer.tier === 'closed') return 'closed';
    if (offer.missing.includes('free_months_not_started')) return 'locked-start';
    if (offer.missing.includes('no_accepted_walkthrough')) return 'locked-accept';
    if (!offer.eligible || !lane) return 'error';
    return lane.open ? 'unlocked' : 'lane-closed';
  }
  function annualAppleRunning(offer) { return offer.source === 'apple' && ['trial', 'active'].includes(offer.plan_status); }
  // Who acts next: Apple (renewal still on), Square (checkout left open) or the owner (a paused start).
  function annualWaiting(state) {
    if (!state) return null;
    if (state.kind === 'conflict') return 'conflict';
    if (state.kind !== 'unlocked') return null;
    return annualAppleRunning(state.offer) && state.offer.apple_auto_renews !== false ? 'renewal' : null;
  }
  // Square Sandbox labels every price and payment action, as the plan panel labels a sandbox plan.
  function annualTest(state) { return state.lane?.sandbox === true || state.sandbox === true ? 'Test · ' : ''; }
  function annualName(code) { return PLAN_NAMES[code] || 'Plan'; }
  function annualSaving(plan) {
    return plan.months_free + (plan.months_free === 1 ? ' month' : ' months') + ' free: ' + planMoney(plan.saving_cents) +
      ' less than 12 monthly payments of ' + planMoney(plan.monthly_cents);
  }
  function annualPool() { return ANNUAL_INCLUDED + ' walkthroughs to use any time in the plan year'; }
  // Choosing the annual plan before the free months end adds bonus walkthroughs, and
  // (offer 2026-09-25.2) express renders, to the first plan year. The answer's
  // early_annual_bonus says whether it is available now; while the free months run its
  // starts_on is the day they end, which dates the line. Express renders are stated
  // only when the answer carries a count (an older server does not).
  function annualBonus(offer) {
    const bonus = offer && offer.early_annual_bonus;
    return bonus && typeof bonus === 'object' && bonus.available === true && Number.isInteger(bonus.walkthroughs)
      && bonus.walkthroughs > 0 && bonus.walkthroughs <= ANNUAL_INCLUDED && offer.plan_status === 'trial'
      && annualFuture(offer.starts_on) ? bonus : null;
  }
  function annualBonusExpress(bonus) {
    const count = bonus && bonus.express_renders;
    return Number.isInteger(count) && count > 0 && count <= ANNUAL_INCLUDED ? count : 0;
  }
  function annualBonusLine(bonus, offer) {
    const express = annualBonusExpress(bonus);
    return 'Choose it before ' + annualDay(offer.starts_on) + ' and get ' + bonus.walkthroughs + ' bonus walkthrough' + (bonus.walkthroughs === 1 ? '' : 's') +
      (express ? ' and ' + express + ' super fast render' + (express === 1 ? '' : 's') : '') +
      ' in your first plan year (' + (ANNUAL_INCLUDED + bonus.walkthroughs) + ' walkthroughs in total' + (express ? '; super fast renders are used on this website' : '') + ').';
  }
  // One plan: the Veylet plan's price, whatever the account is on today. After a
  // failed first charge it is the price that start was bought at, which a retry keeps.
  function annualPlan(state) {
    const failedStart = state.kind === 'start-failed' ? state.offer.start_failed : null;
    if (failedStart) return { code: failedStart.plan_code, year_cents: failedStart.year_cents };
    return state.offer.plans.find(plan => plan.code === ANNUAL_PLAN);
  }
  // Starting today is offered only when the server allows it and the start is otherwise later.
  function annualCanStartNow(state) { return state.offer.can_start_now === true && annualFuture(state.offer.starts_on); }
  function annualStartsToday(state) {
    return annualCanStartNow(state) ? state.start !== 'scheduled' : !annualFuture(state.offer.starts_on);
  }
  function annualCharge(state) {
    const today = annualStartsToday(state);
    return annualTest(state) + (today ? '' : 'Nothing is charged today. ') + 'First charge ' + planMoney(annualPlan(state).year_cents) +
      (today ? ' today' : ' on ' + annualDay(state.offer.starts_on)) + ', then it renews each year until you cancel.';
  }
  function annualPrimaryLabel(state) {
    return annualTest(state) + (state.problem ? 'Try again' : state.card ? 'Confirm yearly plan'
      : state.kind === 'start-failed' ? 'Try another card'
        : annualCanStartNow(state) && state.start !== 'scheduled' ? 'Start yearly plan today' : 'Pay yearly by card');
  }
  function annualProblemText(state, code) {
    if (code === 'payment_declined') return ANNUAL_DECLINED;
    const today = annualStartsToday(state);
    if (!ANNUAL_REFUSALS[code] || code === 'checkout_failed') {
      if (state.kind === 'start-failed') return ANNUAL_REFUSALS.checkout_failed + ANNUAL_RETRY_WAIT;
      return ANNUAL_REFUSALS.checkout_failed + (today ? ' Try again: a retry finishes the same plan and never charges twice.' : ' Nothing was charged. Try again.');
    }
    return ANNUAL_REFUSALS[code] + (today ? '' : ' Nothing was charged.');
  }
  // The lane's public Web Payments identifiers, accepted only in Square's own shapes.
  function annualCardForm(lane) {
    const form = lane?.card_form;
    return form && typeof form === 'object' && ANNUAL_SDK_URLS.includes(form.sdk_url)
      && /^(?:sandbox-sq0idb|sq0idp)-[A-Za-z0-9_-]{8,128}$/.test(String(form.application_id || ''))
      && /^[A-Za-z0-9_-]{1,64}$/.test(String(form.location_id || '')) ? form : null;
  }
  function annualSdk(url) {
    if (window.Square && typeof window.Square.payments === 'function') return Promise.resolve(window.Square);
    if (annualSdkLoad) return annualSdkLoad;
    const script = document.createElement('script');
    annualSdkLoad = new Promise((resolve, reject) => {
      script.onload = () => (window.Square && typeof window.Square.payments === 'function' ? resolve(window.Square) : reject(new Error('Square did not start')));
      script.onerror = () => reject(new Error('Square did not load'));
    });
    // A failed load is forgotten, so Try again loads it afresh.
    annualSdkLoad.catch(() => { annualSdkLoad = null; script.remove?.(); });
    script.src = url; script.async = true;
    (document.head || document.body).append(script);
    return annualSdkLoad;
  }
  // Square's field in the desk's own edge and ink; everything else is Square's.
  const SQUARE_CARD_STYLE = { '.input-container': { borderColor: '#7a877c', borderRadius: '2px' }, '.input-container.is-focus': { borderColor: '#10231d' },
    input: { color: '#10231d', fontSize: '16px' } };
  /** veylet-hooks, configured beside the Supabase endpoint. No cookies are sent. */
  function annualHooks(path, init) {
    const base = String(window.VEYLET_HOOKS?.url || '').replace(/\/+$/, '');
    if (!/^https:\/\/[^/]+$/.test(base) || typeof window.fetch !== 'function') return Promise.reject(new Error('The payment service is not configured.'));
    return Promise.resolve()
      .then(() => window.fetch(base + path, { credentials: 'omit', cache: 'no-store', ...init }))
      .then(response => response.json().catch(() => null).then(body => ({ status: response.status, ok: response.ok, body })));
  }
  // The card lane, read once per desk load for both cards that take a card; an
  // unreadable lane is not kept, and a card form with no usable identifiers asks afresh.
  let laneCache = null;
  function squareLane(fresh) {
    if (!fresh && laneCache && laneCache.ticket === deskVersion) return laneCache.read;
    const read = settled(annualHooks('/square/lane', { method: 'GET' })).then(reply => {
      const body = !reply.timedOut && !reply.error && reply.value?.ok ? reply.value.body : null;
      return body && typeof body.open === 'boolean' && typeof body.sandbox === 'boolean'
        ? { open: body.open, sandbox: body.sandbox, card_form: body.card_form || null } : null;
    });
    const entry = { ticket: deskVersion, read };
    laneCache = entry;
    read.then(lane => { if (!lane && laneCache === entry) laneCache = null; });
    return read;
  }
  async function annualToken(supabase) {
    const reply = await settled(Promise.resolve().then(() => supabase.auth.getSession()));
    return failed(reply) ? null : reply.value?.data?.session?.access_token || null;
  }

  function annualHead(label, tone, refs) {
    const head = annualNode('div', 'annual-head');
    const title = annualNode('h3', 'annual-title', 'Annual plan');
    title.id = 'account-annual-title'; title.tabIndex = -1;
    if (refs) refs.title = title;
    head.append(title);
    if (label) head.append(pill(label, tone));
    return head;
  }
  function annualRow(...controls) {
    const row = annualNode('p', 'annual-actions'); row.append(...controls); return row;
  }
  // A warning or a failed action: an icon and words, never colour alone.
  function annualAlert(text, className = 'annual-alert', refs) {
    const box = annualNode('div', className);
    const icon = annualNode('span', 'annual-alert-icon', '!'); icon.setAttribute('aria-hidden', 'true');
    const words = annualNode('p', 'annual-alert-text', text);
    if (refs) refs.problemText = words;
    box.append(icon, words);
    return box;
  }
  function annualAppleLink(refs) {
    const link = annualNode('a', 'tour-action tour-action-primary', 'Turn off App Store renewal');
    link.href = ANNUAL_APPLE; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.append(annualNode('span', 'annual-vh', ' (opens in a new tab)'));
    refs.primary = link;
    return link;
  }
  function annualCheckButton(refs) {
    const check = button('Check again', () => { void annualCheckAgain(check); });
    refs.check = check;
    return check;
  }
  function annualChecklist(items) {
    const list = annualNode('ol', 'annual-checklist');
    let next = true;
    for (const [done, text] of items) {
      const item = annualNode('li', 'annual-check');
      item.dataset.state = done ? 'done' : next ? 'next' : 'open';
      const mark = annualNode('span', 'annual-mark'); mark.setAttribute('aria-hidden', 'true');
      const words = annualNode('span', 'annual-check-text');
      words.append(annualNode('span', 'annual-vh', done ? 'Done: ' : next ? 'Next: ' : 'Then: '), annualNode('span', '', text));
      if (!done) next = false;
      item.append(mark, words); list.append(item);
    }
    return list;
  }
  function annualStep(number, status, title) {
    const step = annualNode('li', 'annual-step'); step.dataset.state = status;
    if (status === 'active') step.setAttribute('aria-current', 'step');
    const label = annualNode('p', 'annual-step-label');
    const mark = annualNode('span', 'annual-mark'); mark.setAttribute('aria-hidden', 'true');
    label.append(mark, annualNode('span', '', 'Step ' + number + ' of 2' + (status === 'done' ? ' · done' : '')));
    step.append(label, annualNode('p', 'annual-step-title', title));
    return step;
  }
  // Money is a statement: the yearly total, then what the year includes, then the months free and the saving.
  function annualPrice(state, plan, full) {
    const body = annualNode('span', 'annual-option-body');
    body.append(annualNode('span', 'annual-option-name', annualName(plan.code)),
      annualNode('span', 'annual-amount', annualTest(state) + planMoney(plan.year_cents) + ' a year'));
    if (full) {
      if (plan.code === ANNUAL_PLAN) body.append(annualNode('span', 'annual-qualifier', annualPool()));
      body.append(annualNode('span', 'annual-qualifier', annualSaving(plan)));
    }
    return body;
  }
  function annualPlanList(state, plans, full) {
    const list = annualNode('ul', 'annual-plans');
    for (const plan of plans) { const item = annualNode('li'); item.append(annualPrice(state, plan, full)); list.append(item); }
    return list;
  }
  // Choosing changes only the words beside the button, so focus stays on the choice.
  function annualSync(state, refs) {
    if (refs.charge) refs.charge.textContent = annualCharge(state);
    if (refs.pay) refs.pay.textContent = annualPrimaryLabel(state);
    if (refs.problem) refs.problem.hidden = true;
  }
  // A failure (or its clearing) is written into the drawn card, so Square's card field is never redrawn.
  function annualProblem(state, text) {
    state.problem = text || null;
    const refs = state.refs || {};
    if (refs.problemText) refs.problemText.textContent = text || '';
    if (refs.problem) refs.problem.hidden = !text;
    if (refs.pay) { refs.pay.textContent = annualPrimaryLabel(state); refs.pay.disabled = false; }
    if (text) setStatus(text);
  }
  function annualDropCard(state) {
    const card = state?.card;
    if (!card) return;
    state.card = null;
    Promise.resolve().then(() => card.destroy?.()).catch(() => {});
  }
  function annualChoice(state, refs, legend, name, options, current, choose, sync = annualSync) {
    const set = annualNode('fieldset', 'annual-choice');
    set.append(annualNode('legend', '', legend));
    for (const [value, body] of options) {
      const label = annualNode('label', 'annual-option');
      const input = annualNode('input'); input.type = 'radio'; input.name = name; input.value = value; input.checked = value === current;
      input.addEventListener('change', () => { if (!input.checked) return; choose(value); state.problem = null; sync(state, refs); });
      label.append(input, body); set.append(label);
    }
    return set;
  }
  // `retry` is the start after a failed first charge: no start choice (it starts as
  // soon as the server allows), a plain lead, and Cancel beside the one filled button.
  function annualPay(state, refs, retry = null) {
    const { offer } = state;
    const nodes = [];
    const day = annualDay(offer.starts_on);
    if (retry) nodes.push(annualNode('p', 'annual-step-text', retry.lead));
    else if (annualCanStartNow(state)) {
      const today = annualNode('span', 'annual-option-body');
      today.append(annualNode('span', 'annual-option-name', 'Today'), annualNode('span', 'annual-qualifier', 'First charge today'));
      const later = annualNode('span', 'annual-option-body');
      later.append(annualNode('span', 'annual-option-name', day), annualNode('span', 'annual-qualifier', 'Nothing is charged today'));
      nodes.push(annualNode('p', 'annual-step-text', 'Your free walkthroughs are used up, so you can start today.'),
        annualChoice(state, refs, 'When it starts', 'annual-start', [['now', today], ['scheduled', later]],
          state.start === 'scheduled' ? 'scheduled' : 'now', value => { state.start = value; }));
    } else if (annualFuture(offer.starts_on) && !annualAppleRunning(offer)) {
      const running = offer.plan_status === 'trial' ? 'Your free months run until ' : offer.plan_status === 'active' ? 'Your current plan runs until ' : '';
      if (running) nodes.push(annualNode('p', 'annual-step-text', running + day + '. The yearly plan starts then.'));
    }
    const charge = annualNode('p', 'annual-charge', annualCharge(state)); charge.id = 'account-annual-charge';
    nodes.push(charge);
    if (state.card) {
      const label = annualNode('p', 'annual-card-label', 'Card details'); label.id = ANNUAL_CARD_FIELD + '-label';
      const field = annualNode('div', 'annual-card-field'); field.id = ANNUAL_CARD_FIELD;
      field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', label.id); field.tabIndex = -1;
      refs.field = field;
      const block = annualNode('div', 'annual-card'); block.append(label, field); nodes.push(block);
    }
    const primary = button(annualPrimaryLabel(state), () => { void (state.card ? annualConfirmCard(primary) : annualOpenCard(primary)); });
    primary.className = 'tour-action tour-action-primary';
    primary.setAttribute('aria-describedby', 'account-annual-charge');
    refs.charge = charge; refs.primary = primary; refs.pay = primary;
    nodes.push(state.card ? annualRow(primary, button('Not now', () => annualCloseCard())) : annualRow(primary, ...(retry?.extras || [])));
    const problem = annualAlert(state.problem || '', 'annual-alert annual-problem', refs);
    problem.hidden = !state.problem; refs.problem = problem; nodes.push(problem);
    nodes.push(annualNode('p', 'annual-note', 'Your card goes into Square’s secure form on this page; Veylet never sees it.'));
    return nodes;
  }
  function annualConfirm(state, refs, day) {
    const { offer } = state;
    const after = !annualAppleRunning(offer) ? 'Your current plan is unchanged.'
      : offer.apple_auto_renews === false ? 'Your App Store plan still ends on ' + day + ' unless you turn its renewal back on.'
        : 'Your App Store plan keeps renewing.';
    const text = annualNode('p', 'annual-confirm', state.kind === 'start-failed'
      ? 'Cancel the yearly plan? Its first charge didn’t go through, so nothing has been charged, and nothing will be. A later yearly plan uses the annual price at that time.'
      : (day ? 'Cancel the yearly plan that starts ' + day + '?' : 'Cancel the paused yearly plan?') +
        ' Nothing has been charged. ' + after + ' A later yearly plan uses the annual price at that time.');
    text.tabIndex = -1; refs.confirm = text;
    const yes = button(annualTest(state) + 'Cancel yearly plan', () => { void annualCancel(yes); });
    yes.className = 'tour-action tour-action-danger'; yes.dataset.armed = 'true';
    const keep = button('Keep yearly plan', () => { state.confirming = false; setStatus('Your yearly plan is unchanged.'); annualDraw('cancel'); });
    return [text, annualRow(yes, keep)];
  }

  function annualParts(state, refs) {
    const { kind, offer } = state;
    if (kind === 'active') return null;
    const parts = [];
    const begin = (label, tone) => {
      parts.push(annualHead(label, tone, refs));
      if (state.notice) parts.push(annualNode('p', 'annual-notice', state.notice));
    };
    const say = (className, text) => parts.push(annualNode('p', className, text));
    // Sandbox is said once, under the heading, before any "Test ·" price or button.
    const testLine = () => { if (annualTest(state)) say('plan-scope plan-test', ANNUAL_TEST_LINE); };
    if (kind === 'error') {
      begin();
      say('annual-lead', 'Couldn’t check the annual plan.');
      say('annual-note', 'Nothing has changed, and your plan above is not affected.');
      const retry = button('Try again', () => { void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { focus: 'title' }); });
      refs.retry = retry; parts.push(annualRow(retry));
      return parts;
    }
    if (kind === 'not-owner') { begin('Locked', 'quiet'); say('annual-lead', 'Only the workspace owner can choose the annual plan here.'); return parts; }
    if (kind === 'closed') { begin(); say('annual-lead', 'Choosing the annual plan here is paused for now.'); say('annual-note', 'Your plan above is unchanged.'); return parts; }
    if (kind === 'locked-start') {
      begin();
      say('annual-lead', 'You can choose the annual plan here once your free months have started.');
      say('annual-note', 'They start when the plan is activated with a payment method on file: in the app through the App Store, with a card on this page, or by Veylet for an invoiced account.');
      return parts;
    }
    if (kind === 'locked-accept') {
      // A server older than offer 2026-09-25.1 still asks for an accepted walkthrough first.
      begin('Locked', 'quiet');
      say('annual-lead', 'The annual plan opens here after one more step.');
      parts.push(annualChecklist([[true, 'Free months started'], [false, 'Get your first walkthrough accepted']]));
      say('annual-note', 'A walkthrough counts once its automatic quality check has passed and you have approved it for release. Saving a space or sending a capture does not.');
      const link = annualNode('a', 'text-link', 'See your first-capture steps'); link.href = '/start';
      refs.primary = link; parts.push(annualRow(link));
      return parts;
    }
    if (kind === 'start-failed') {
      // The first yearly charge failed: say so with its price and day, then the
      // one way forward (another card, at the same price) and the way out.
      const failedStart = offer.start_failed;
      begin('Charge failed', 'busy');
      testLine();
      parts.push(annualAlert(annualTest(state) + 'Your first yearly charge of ' + planMoney(failedStart.year_cents) + ', due ' +
        annualDay(failedStart.starts_on) + ', didn’t go through. Nothing was charged, and your yearly plan hasn’t started.'));
      parts.push(annualPlanList(state, [annualPlan(state)], false));
      if (state.confirming) { parts.push(...annualConfirm(state, refs, '')); return parts; }
      const cancel = button(annualTest(state) + 'Cancel yearly plan', () => { state.confirming = true; annualDraw('confirm'); });
      refs.cancel = cancel;
      const ask = () => {
        const link = annualNode('a', 'text-link', 'Email Veylet support about this plan');
        link.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20yearly%20plan'; return link;
      };
      if (!state.lane) {
        // Both a new card and a cancellation go through the card lane, so neither is offered unread.
        say('annual-lead', 'Card payment couldn’t be reached, so a new card can’t be added right now.');
        const retry = button('Check again', () => { void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { focus: 'title' }); });
        refs.retry = retry; parts.push(annualRow(retry, ask()));
        return parts;
      }
      if (!state.lane.open) {
        say('annual-lead', 'Card payment for the annual price is closed right now, so a new card can’t be added here.');
        parts.push(annualRow(ask()));
        return parts;
      }
      if (failedStart.plan_code !== ANNUAL_PLAN) {
        // A year bought on a retired plan is not sold again: it can only be cancelled.
        say('annual-lead', 'This yearly plan was for ' + annualName(failedStart.plan_code) + ', which is no longer sold, so it can’t be restarted with a new card. Cancel it; nothing is charged.');
        parts.push(annualRow(cancel));
        return parts;
      }
      if (failedStart.retrying) say('annual-note', 'The start that failed is still being stopped at Square. A new card is used only once it has stopped, so nobody pays twice.');
      const block = annualNode('div', 'annual-pay');
      block.append(...annualPay(state, refs, { lead: 'Use another card to start your yearly plan at the same price, or cancel it.', extras: [cancel] }));
      parts.push(block);
      return parts;
    }
    if (kind === 'scheduled' || kind === 'conflict') {
      const scheduled = offer.scheduled || null;
      const day = scheduled ? annualDay(scheduled.starts_on) : '';
      const future = scheduled ? state.chargeToday !== true && annualFuture(scheduled.starts_on) : true;
      if (kind === 'conflict') {
        begin('Paused', 'quiet');
        testLine();
        parts.push(annualAlert('App Store renewal is on again, so both would charge. We paused ' +
          (scheduled ? 'your yearly plan, due to start ' + day : 'your yearly start') + '. Nothing has been charged.'));
        say('annual-note', 'Turn off App Store renewal to keep the yearly plan, or cancel it.');
      } else {
        begin('Scheduled', 'good');
        testLine();
        const running = annualAppleRunning(offer) ? ' Your App Store plan runs until then.' : ['trial', 'active'].includes(offer.plan_status) ? ' Your current plan runs until then.' : '';
        say('annual-lead', annualTest(state) + (future ? 'Yearly plan starts ' + day + '.' + running : 'Yearly plan starts today.'));
      }
      if (scheduled) {
        parts.push(annualPlanList(state, [{ code: scheduled.plan_code, year_cents: scheduled.year_cents }], false));
        say('annual-charge', annualTest(state) + (future ? 'Nothing has been charged. First charge ' + planMoney(scheduled.year_cents) + ' on ' + day
          : 'First charge ' + planMoney(scheduled.year_cents) + ' today') + ', then it renews each year until you cancel.');
      }
      if (state.confirming) parts.push(...annualConfirm(state, refs, day));
      else if (kind === 'scheduled' && !future) {
        // Started today: it is no longer a start that can be withdrawn here.
        const ask = annualNode('a', 'text-link', 'Email Veylet support about this plan');
        ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20yearly%20plan'; refs.cancel = ask;
        parts.push(annualRow(ask));
      } else {
        const cancel = button(annualTest(state) + 'Cancel yearly plan', () => { state.confirming = true; annualDraw('confirm'); });
        refs.cancel = cancel;
        parts.push(kind === 'conflict' ? annualRow(annualAppleLink(refs), cancel, annualCheckButton(refs)) : annualRow(cancel));
        if (kind === 'conflict' && state.checkNote) say('annual-note', state.checkNote);
      }
      return parts;
    }
    // Open to choose: the one price; with the card lane closed, only it and when card payment opens.
    begin();
    testLine();
    say('annual-lead', 'Pay once a year instead of monthly.');
    // The one price, as a statement: the yearly total, what the year includes, the months free and the saving.
    parts.push(annualPlanList(state, [annualPlan(state)], true));
    const bonus = annualBonus(offer);
    if (bonus) say('annual-bonus', annualBonusLine(bonus, offer));
    if (kind === 'lane-closed') {
      say('annual-lead annual-soon', 'Card payment for the annual price opens soon.');
      return parts;
    }
    if (annualAppleRunning(offer)) {
      const renewing = offer.apple_auto_renews !== false;
      const until = annualDay(offer.starts_on);
      const steps = annualNode('ol', 'annual-steps');
      const one = annualStep(1, renewing ? 'active' : 'done', renewing ? 'App Store renewal is on' : 'App Store renewal is off');
      one.append(annualNode('p', 'annual-step-text', renewing
        ? 'Your App Store plan keeps running until ' + until + '. Turning off renewal does not end it early.'
        : 'Your App Store plan runs until ' + until + '.'));
      if (renewing) {
        one.append(annualRow(annualAppleLink(refs), annualCheckButton(refs)));
        if (state.checkNote) one.append(annualNode('p', 'annual-note', state.checkNote));
      }
      const two = annualStep(2, renewing ? 'upcoming' : 'active', 'Pay by card');
      if (renewing) two.append(annualNode('p', 'annual-step-text', 'Opens once App Store renewal is off.'));
      else two.append(...annualPay(state, refs));
      steps.append(one, two); parts.push(steps);
    } else {
      const block = annualNode('div', 'annual-pay'); block.append(...annualPay(state, refs)); parts.push(block);
    }
    return parts;
  }
  function annualDraw(focus) {
    const state = annual;
    if (!state || !annualEl) return;
    const refs = {};
    const parts = annualParts(state, refs);
    if (!parts) { annualEl.hidden = true; annualEl.replaceChildren(); return; }
    state.refs = refs;
    annualEl.hidden = false;
    annualEl.replaceChildren(...parts);
    if (focus && refs[focus]) refs[focus].focus();
  }
  function annualHide() {
    annualDropCard(annual);
    annualVersion += 1; annual = null;
    if (!annualEl) return;
    annualEl.hidden = true; annualEl.setAttribute('aria-busy', 'false'); annualEl.replaceChildren();
  }
  // Waiting keeps the card's own shape: the lead, the one price, the start, the
  // charge line, the action and the note, each at the length it usually is.
  function annualSkeleton() {
    if (!annualEl) return;
    annualDropCard(annual);
    annualVersion += 1; annual = null;
    annualEl.hidden = false; annualEl.setAttribute('aria-busy', 'true');
    const price = annualNode('li', 'annual-skeleton-row');
    const body = annualNode('span', 'annual-option-body');
    body.append(skeletonLine('span', 'annual-option-name', 11), skeletonLine('span', 'annual-amount', 12),
      skeletonLine('span', 'annual-qualifier', 47), skeletonLine('span', 'annual-qualifier', 58));
    price.append(body);
    const plans = annualNode('ul', 'annual-plans'); plans.append(price);
    const action = annualNode('span', 'plan-skeleton annual-skeleton-action'); action.setAttribute('aria-hidden', 'true');
    const pay = annualNode('div', 'annual-pay');
    pay.append(skeletonLine('p', 'annual-step-text', 71), skeletonLine('p', 'annual-charge', 106), annualRow(action), skeletonLine('p', 'annual-note', 77));
    annualEl.replaceChildren(annualHead(), annualNode('p', 'annual-lead', 'Checking the annual plan…'), plans, pay);
  }
  async function renderAnnual(supabase, ticket, workspaceID, planRow, options = {}) {
    if (!annualEl) return;
    if (!workspaceID) { annualHide(); return; }
    if (options.quiet && annual) annualEl.setAttribute('aria-busy', 'true');
    else annualSkeleton();
    const version = ++annualVersion;
    annualCheckedAt = Date.now();
    const [reply, lane] = await Promise.all([
      settled(Promise.resolve().then(() => supabase.rpc('get_members_annual_offer', { p_workspace_id: workspaceID }))),
      squareLane(),
    ]);
    if (ticket !== deskVersion || version !== annualVersion) return;
    annualEl.setAttribute('aria-busy', 'false');
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to check the annual plan.'); return; }
    // Before the backend has the function there is no offer to show; that is not an outage.
    if (reply.value?.error?.code === 'PGRST202') { annualHide(); return; }
    const previous = annual && annual.workspaceID === workspaceID ? annual : null;
    annualDropCard(annual);
    const offer = failed(reply) ? null : firstRow(reply.value?.data);
    annual = { supabase, workspaceID, planRow, offer, lane, kind: annualKind(offer, lane),
      start: previous?.start || null, busy: false, confirming: false,
      problem: null, notice: options.notice || null, checkNote: null };
    annualDraw(options.focus);
    options.after?.(previous, annual);
  }
  // Check again, and coming back to the page, re-read the server; the page never assumes Apple or Square acted.
  function annualAfterCheck(explicit) {
    return (previous, next) => {
      const was = annualWaiting(previous);
      const now = annualWaiting(next);
      if (was && was === now) {
        if (!explicit) return;
        if (now !== 'checkout') {
          next.checkNote = 'Checked at ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) +
            '. App Store renewal is still on. Apple can take a few minutes to tell us.';
          setStatus(next.checkNote);
        }
        annualDraw('check');
        return;
      }
      if (was === 'renewal' && next.kind === 'unlocked' && !now) {
        setStatus('App Store renewal is off. Step 2 is ready.');
        if (explicit) annualDraw('primary');
        return;
      }
      if (explicit) annualDraw('title');
    };
  }
  async function annualCheckAgain(control) {
    const state = annual;
    if (!state || state.busy) return;
    state.busy = true; control.disabled = true; control.textContent = 'Checking…';
    await renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { quiet: true, after: annualAfterCheck(true) });
  }
  function annualRecheck(force) {
    const state = annual;
    if (!state || !currentUserId) return;
    // A page restored from the back-forward cache may still say "Opening checkout…".
    if (state.card || (!force && (state.busy || state.confirming || !annualWaiting(state) || Date.now() - annualCheckedAt < 5000))) return;
    void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { quiet: true, after: annualAfterCheck(false) });
  }
  function annualRefused(state, answer) {
    const code = answer?.body?.error || (answer?.status === 401 ? 'unauthorized' : null);
    if (code === 'unauthorized') { showSignedOut('Your sign-in has expired. Sign in again and check whether the yearly plan was cancelled.'); return; }
    const notice = 'The cancellation was not confirmed. Check the plan below before trying again.';
    setStatus(notice);
    void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { quiet: true, notice, focus: 'title' });
  }
  // "Pay yearly by card": load Square's SDK once, open its card field in the card, and move focus into it.
  async function annualOpenCard(control) {
    const state = annual;
    if (!state || state.busy || state.card || !['unlocked', 'start-failed'].includes(state.kind)) return;
    // One card form on the desk at a time: any other open card form is closed first.
    closeCardForms('annual');
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Loading card form…';
    setStatus('Loading Square’s card form…');
    let form = annualCardForm(state.lane);
    if (!form) {
      const lane = await squareLane(true);
      if (annual !== state) return;
      if (lane) state.lane = lane;
      form = annualCardForm(lane);
    }
    const made = form ? await settled(annualSdk(form.sdk_url).then(Square => Square.payments(form.application_id, form.location_id).card({ style: SQUARE_CARD_STYLE })))
      : { error: new Error('No card form') };
    if (made.timedOut) annualSdkLoad = null;
    const card = made.timedOut || made.error ? null : made.value;
    if (annual !== state) { Promise.resolve().then(() => card?.destroy?.()).catch(() => {}); return; }
    if (!card || typeof card.attach !== 'function' || typeof card.tokenize !== 'function') {
      state.busy = false; annualProblem(state, ANNUAL_SDK_FAILED); control.focus?.(); return;
    }
    state.card = card;
    annualDraw();
    const attached = await settled(Promise.resolve().then(() => card.attach('#' + ANNUAL_CARD_FIELD)));
    if (annual !== state) return;
    state.busy = false;
    if (attached.timedOut || attached.error) {
      annualDropCard(state); state.problem = ANNUAL_SDK_FAILED; annualDraw('pay'); setStatus(ANNUAL_SDK_FAILED); return;
    }
    setStatus('Enter your card in Square’s card form, then confirm the yearly plan.');
    if (typeof card.focus === 'function') { try { await card.focus('cardNumber'); return; } catch { /* the field itself, below */ } }
    state.refs?.field?.focus();
  }
  function annualCloseCard() {
    const state = annual;
    if (!state || state.busy) return;
    annualDropCard(state); state.problem = null;
    annualDraw('pay');
    setStatus('Card form closed. Nothing was set up.');
  }
  // "Confirm yearly plan": Square tokenizes the card in its iframe; only that single-use token is sent.
  async function annualConfirmCard(control) {
    const state = annual;
    if (!state || state.busy || !state.card) return;
    const plan = annualPlan(state);
    const start = annualCanStartNow(state) && state.start !== 'scheduled' ? 'now' : 'scheduled';
    const expected = { plan_code: plan.code, year_cents: plan.year_cents, starts_on: annualStartsToday(state) ? annualToday() : state.offer.starts_on };
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Confirming…';
    setStatus('Confirming your yearly plan…');
    const tokenized = await settled(Promise.resolve().then(() => state.card.tokenize()));
    if (annual !== state) return;
    const result = tokenized.timedOut || tokenized.error ? null : tokenized.value;
    const sourceID = result?.status === 'OK' ? result.token : null;
    if (typeof sourceID !== 'string' || !/^[A-Za-z0-9:_-]{8,512}$/.test(sourceID)) {
      state.busy = false;
      annualProblem(state, 'Square couldn’t use those card details. Check them and try again. Nothing was charged.');
      control.focus?.();
      return;
    }
    const token = await annualToken(state.supabase);
    if (annual !== state) return;
    if (!token) { showSignedOut('Your sign-in has expired. Sign in again to pay yearly. Nothing was set up.'); return; }
    const reply = await settled(annualHooks('/square/members-annual/checkout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ workspace_id: state.workspaceID, plan_code: plan.code, start, source_id: sourceID }) }), 30000);
    if (annual !== state) return;
    state.busy = false;
    const answer = reply.timedOut || reply.error ? null : reply.value;
    const done = answer?.ok ? answer.body : null;
    const scheduled = done?.scheduled;
    if (scheduled && typeof scheduled === 'object' && ANNUAL_CODES.includes(scheduled.plan_code) && Number.isInteger(scheduled.year_cents)
      && scheduled.year_cents > 0 && annualDay(scheduled.starts_on) && typeof done.charge_today === 'boolean') {
      annualConfirmed(state, done, expected);
      return;
    }
    const code = answer?.body?.error || (answer?.status === 401 ? 'unauthorized' : null);
    if (code === 'unauthorized') { showSignedOut('Your sign-in has expired. Sign in again to pay yearly. Nothing was set up.'); return; }
    if (answer?.ok || code === 'already_scheduled') {
      // A plan is already there, or an answer this page cannot read: the server's record is shown.
      const notice = code === 'already_scheduled' ? ANNUAL_REFUSALS.already_scheduled : 'The answer could not be read. This is your plan as it stands now.';
      setStatus(notice);
      void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { quiet: true, notice, focus: 'title' });
      return;
    }
    annualProblem(state, annualProblemText(state, code));
    control.focus?.();
  }
  // The scheduled state is drawn from the server's answer: the same plan, price and date the button stated.
  function annualConfirmed(state, done, expected) {
    annualDropCard(state);
    const scheduled = { plan_code: done.scheduled.plan_code, year_cents: done.scheduled.year_cents, starts_on: done.scheduled.starts_on };
    const differs = ['plan_code', 'year_cents', 'starts_on'].some(key => scheduled[key] !== expected[key]);
    state.offer = { ...state.offer, scheduled, checkout_pending: null, start_failed: null };
    Object.assign(state, { kind: 'scheduled', chargeToday: done.charge_today, sandbox: done.sandbox === true, problem: null, start: null,
      notice: differs ? 'These are the terms your yearly plan was set up with; they differ from what was shown before you confirmed.' : null });
    annualDraw('title');
    setStatus(done.charge_today ? 'Yearly plan confirmed. The first charge is today.' : 'Yearly plan confirmed. Nothing is charged today.');
  }
  async function annualCancel(control) {
    const state = annual;
    if (!state || state.busy) return;
    state.busy = true; control.disabled = true; control.textContent = 'Cancelling…';
    setStatus('Cancelling the yearly plan…');
    const token = await annualToken(state.supabase);
    if (annual !== state) return;
    if (!token) { showSignedOut('Your sign-in has expired. Sign in again to cancel the yearly plan. Nothing was changed.'); return; }
    const reply = await settled(annualHooks('/square/members-annual/cancel', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ workspace_id: state.workspaceID }) }));
    if (annual !== state) return;
    state.busy = false; state.confirming = false;
    const answer = reply.timedOut || reply.error ? null : reply.value;
    if (answer?.ok && answer.body?.cancelled === true) {
      const done = 'Yearly plan cancelled. Nothing was charged.';
      setStatus(done);
      void renderAnnual(state.supabase, deskVersion, state.workspaceID, state.planRow, { quiet: true, notice: done, focus: 'title' });
      return;
    }
    annualRefused(state, answer);
  }

  // Opening a card form elsewhere on the desk closes this one, quietly.
  function annualCloseOther() {
    const state = annual;
    if (!state || state.busy || !state.card) return;
    annualDropCard(state); state.problem = null; annualDraw();
  }

  /* ---- Walkthrough packs ---------------------------------------------------
   * More accepted walkthroughs for a busy month (offer 2026-09-24.2; docs/design/
   * one-plan-and-packs-20260924.md). A pack's walkthroughs are used after the
   * free-months or monthly included ones and expire 12 months after purchase.
   * Who may buy, the packs, their prices and the balance are the server's answer
   * (get_pack_offer); whether card payment is open, and whether it is Square
   * Sandbox, is the hooks lane's answer. Paying charges the card at once, so this
   * card never says that nothing is charged before it knows. Card entry is
   * Square's own field; only its single-use token is sent, the purchase is shown
   * from the server's answer, and every state has at most one filled action.
   */
  const packsEl = document.getElementById('account-packs');
  const PACK_CODES = ['pack3', 'pack10'];
  const PACK_MISSING = ['not_owner', 'not_activated'];
  // offer.json packs[].validMonths.
  const PACK_VALID_MONTHS = 12;
  const PACK_CARD_FIELD = 'account-packs-card-field';
  const PACK_TEST_LINE = 'Test · Square Sandbox: a test payment, not a live charge.';
  // What each refusal means. Each of these is refused before Square takes a payment.
  const PACK_REFUSALS = {
    payment_declined: 'Your card was declined, so nothing was charged. Check the details or use another card, then try again.',
    not_eligible: 'Packs aren’t available for this workspace right now, so nothing was charged.',
    lane_closed: 'Card payment for packs is closed right now, so nothing was charged.',
    invalid_request: 'The purchase wasn’t accepted, so nothing was charged. Try again.',
  };
  // No answer, or checkout_failed: the card may have been charged, and the server
  // adds the walkthroughs once Square confirms it. The balance above is re-read.
  const PACK_UNCONFIRMED = 'We couldn’t confirm the purchase. If your card was charged, the walkthroughs are added when the payment clears. Check the count above in a few minutes before you try again.';
  let packs = null;
  let packsVersion = 0;

  function packValid(pack) {
    return Boolean(pack) && typeof pack === 'object' && PACK_CODES.includes(pack.code)
      && Number.isInteger(pack.walkthroughs) && pack.walkthroughs > 0 && Number.isInteger(pack.price_cents) && pack.price_cents > 0
      // The count is in the code, so the two must agree before either is shown.
      && pack.code === 'pack' + pack.walkthroughs;
  }
  function packsValid(offer) {
    if (!offer || typeof offer !== 'object' || typeof offer.available !== 'boolean' || !Array.isArray(offer.missing)
      || !Array.isArray(offer.packs) || !Number.isInteger(offer.credits_available) || offer.credits_available < 0) return false;
    if (offer.missing.some(code => !PACK_MISSING.includes(code))) return false;
    if (offer.next_expiry !== null && offer.next_expiry !== undefined && !annualDay(offer.next_expiry)) return false;
    if (!offer.packs.every(packValid) || new Set(offer.packs.map(pack => pack.code)).size !== offer.packs.length) return false;
    // Open, it names its packs and misses nothing; closed, it says why.
    return offer.available ? !offer.missing.length && offer.packs.length > 0 : offer.missing.length > 0;
  }
  function packsKind(offer, lane) {
    if (!packsValid(offer)) return 'error';
    if (offer.missing.includes('not_owner')) return 'not-owner';
    if (offer.missing.includes('not_activated')) return 'not-activated';
    if (!lane) return 'error';
    return lane.open ? 'choose' : 'lane-closed';
  }
  function packWords(count) { return count + (count === 1 ? ' walkthrough' : ' walkthroughs'); }
  // Square Sandbox labels every price and payment action, as the annual card does.
  function packTest(state) { return state.lane?.sandbox === true || state.sandbox === true ? 'Test · ' : ''; }
  function packChosen(state) {
    return state.offer.packs.find(pack => pack.code === state.selected) || state.offer.packs[0];
  }
  function packCharge(state) {
    const pack = packChosen(state);
    return packTest(state) + 'Charged today: ' + planMoney(pack.price_cents) + ' for ' + packWords(pack.walkthroughs) +
      ', to use within ' + PACK_VALID_MONTHS + ' months.';
  }
  function packPrimaryLabel(state) {
    const pack = packChosen(state);
    return packTest(state) + (state.problem ? 'Try again' : state.card ? 'Pay ' + planMoney(pack.price_cents) : 'Buy ' + packWords(pack.walkthroughs));
  }
  function packBalance(offer) {
    const count = offer.credits_available;
    if (!count) return 'No extra walkthroughs available.';
    const next = annualDay(offer.next_expiry);
    return (count === 1 ? '1 extra walkthrough' : count + ' extra walkthroughs') + ' available' + (next ? '; the next expiry is ' + next + '.' : '.');
  }
  /** Brisbane's today plus the pack's validity, clamped to the month's last day. */
  function packExpiry() {
    const [year, month, day] = annualToday().split('-').map(Number);
    const total = month - 1 + PACK_VALID_MONTHS;
    const y = year + Math.floor(total / 12), m = total % 12 + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(day, last)).padStart(2, '0');
  }
  // Money is a statement: the walkthroughs, then the price, then how long they last.
  function packOption(state, pack) {
    const body = annualNode('span', 'annual-option-body');
    body.append(annualNode('span', 'annual-option-name', packWords(pack.walkthroughs)),
      annualNode('span', 'annual-amount', packTest(state) + planMoney(pack.price_cents)),
      annualNode('span', 'annual-qualifier', 'Use within ' + PACK_VALID_MONTHS + ' months of purchase'));
    return body;
  }
  function packList(state) {
    const list = annualNode('ul', 'annual-plans');
    for (const pack of state.offer.packs) { const item = annualNode('li'); item.append(packOption(state, pack)); list.append(item); }
    return list;
  }
  function packsHead(refs) {
    const head = annualNode('div', 'annual-head');
    const title = annualNode('h3', 'annual-title', 'Walkthrough packs');
    title.id = 'account-packs-title'; title.tabIndex = -1;
    if (refs) refs.title = title;
    head.append(title);
    return head;
  }
  // Choosing changes only the words beside the button, so focus stays on the choice.
  function packsSync(state, refs) {
    if (refs.charge) refs.charge.textContent = packCharge(state);
    if (refs.pay) refs.pay.textContent = packPrimaryLabel(state);
    if (refs.problem) refs.problem.hidden = true;
  }
  // A failure (or its clearing) is written into the drawn card, so Square's field is never redrawn.
  function packsProblem(state, text) {
    state.problem = text || null;
    const refs = state.refs || {};
    if (refs.problemText) refs.problemText.textContent = text || '';
    if (refs.problem) refs.problem.hidden = !text;
    if (refs.pay) { refs.pay.textContent = packPrimaryLabel(state); refs.pay.disabled = false; }
    if (text) setStatus(text);
  }
  function packsDropCard(state) {
    const card = state?.card;
    if (!card) return;
    state.card = null;
    Promise.resolve().then(() => card.destroy?.()).catch(() => {});
  }
  function packsCloseOther() {
    const state = packs;
    if (!state || state.busy || !state.card) return;
    packsDropCard(state); state.problem = null; packsDraw();
  }

  function packsParts(state, refs) {
    const { kind, offer } = state;
    const parts = [packsHead(refs)];
    // Sandbox is said once, under the heading, before any "Test ·" price or button.
    if (packTest(state) && ['choose', 'bought', 'lane-closed'].includes(kind)) parts.push(annualNode('p', 'plan-scope plan-test', PACK_TEST_LINE));
    if (state.notice) parts.push(annualNode('p', 'annual-notice', state.notice));
    const say = (className, text) => { const node = annualNode('p', className, text); parts.push(node); return node; };
    if (kind === 'error') {
      say('annual-lead', 'Couldn’t check walkthrough packs.');
      say('annual-note', 'Nothing has changed, and your plan above is not affected.');
      const retry = button('Try again', () => { void renderPacks(state.supabase, deskVersion, state.workspaceID, { focus: 'title' }); });
      refs.retry = retry; parts.push(annualRow(retry));
      return parts;
    }
    if (kind === 'not-owner') { say('annual-lead', 'Only the workspace owner can buy walkthrough packs.'); return parts; }
    if (kind === 'not-activated') {
      say('annual-lead', 'Packs can be bought once your free months or plan have started.');
      say('annual-note', 'A pack’s walkthroughs are used after your included ones and expire ' + PACK_VALID_MONTHS + ' months after purchase.');
      return parts;
    }
    if (kind === 'bought') {
      // The answer's own terms: what was added, the balance now and the date to use them by.
      const done = state.done;
      say('annual-lead', packTest(state) + packWords(done.credited) + ' added; ' + done.credits_available + ' available; use by ' + done.useBy + '.');
      say('annual-charge', packTest(state) + planMoney(done.amount_cents) + ' charged today.');
      say('annual-note', 'They are used after your included walkthroughs, oldest pack first.');
      const again = button('Buy another pack', () => { Object.assign(state, { kind: 'choose', done: null, notice: null, problem: null }); packsDraw('primary'); });
      refs.again = again; parts.push(annualRow(again));
      return parts;
    }
    say('annual-lead', 'More walkthroughs for a busy month, used after your included ones.');
    refs.balance = say('packs-balance', packBalance(offer));
    if (kind === 'lane-closed') {
      parts.push(packList(state));
      say('annual-lead annual-soon', 'Card payment for packs opens soon.');
      const ask = annualNode('a', 'text-link', 'Ask Veylet support to invoice a pack');
      ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20walkthrough%20pack'; refs.primary = ask;
      parts.push(annualRow(ask));
      return parts;
    }
    parts.push(annualChoice(state, refs, 'Choose a pack', 'account-pack', offer.packs.map(pack => [pack.code, packOption(state, pack)]),
      packChosen(state).code, value => { state.selected = value; }, packsSync));
    const charge = say('annual-charge', packCharge(state)); charge.id = 'account-packs-charge';
    if (state.card) {
      const label = annualNode('p', 'annual-card-label', 'Card details'); label.id = PACK_CARD_FIELD + '-label';
      const field = annualNode('div', 'annual-card-field'); field.id = PACK_CARD_FIELD;
      field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', label.id); field.tabIndex = -1;
      refs.field = field;
      const block = annualNode('div', 'annual-card'); block.append(label, field); parts.push(block);
    }
    const primary = button(packPrimaryLabel(state), () => { void (state.card ? packsConfirmCard(primary) : packsOpenCard(primary)); });
    primary.className = 'tour-action tour-action-primary';
    primary.setAttribute('aria-describedby', 'account-packs-charge');
    refs.charge = charge; refs.primary = primary; refs.pay = primary;
    parts.push(state.card ? annualRow(primary, button('Not now', () => packsCloseCard())) : annualRow(primary));
    const problem = annualAlert(state.problem || '', 'annual-alert annual-problem', refs);
    problem.hidden = !state.problem; refs.problem = problem; parts.push(problem);
    say('annual-note', 'Your card goes into Square’s secure form on this page; Veylet never sees it.');
    return parts;
  }
  function packsDraw(focus) {
    const state = packs;
    if (!state || !packsEl) return;
    const refs = {};
    const parts = packsParts(state, refs);
    state.refs = refs;
    packsEl.hidden = false;
    packsEl.replaceChildren(...parts);
    if (focus && refs[focus]) refs[focus].focus();
  }
  function packsHide() {
    packsDropCard(packs);
    packsVersion += 1; packs = null;
    if (!packsEl) return;
    packsEl.hidden = true; packsEl.setAttribute('aria-busy', 'false'); packsEl.replaceChildren();
  }
  // Waiting keeps the card's own shape: the lead, the balance, the two pack rows,
  // the charge line, the action and the note, each at the length it usually is.
  function packsSkeleton() {
    if (!packsEl) return;
    packsDropCard(packs);
    packsVersion += 1; packs = null;
    packsEl.hidden = false; packsEl.setAttribute('aria-busy', 'true');
    const choice = annualNode('div', 'annual-choice');
    choice.append(skeletonLine('p', 'annual-skeleton-legend', 13));
    for (const name of [14, 15]) {
      const row = annualNode('div', 'annual-option annual-skeleton-row');
      const body = annualNode('span', 'annual-option-body');
      body.append(skeletonLine('span', 'annual-option-name', name), skeletonLine('span', 'annual-amount', 5), skeletonLine('span', 'annual-qualifier', 32));
      row.append(annualNode('span', 'annual-skeleton-radio'), body);
      choice.append(row);
    }
    const action = annualNode('span', 'plan-skeleton annual-skeleton-action'); action.setAttribute('aria-hidden', 'true');
    packsEl.replaceChildren(packsHead(), annualNode('p', 'annual-lead', 'Checking walkthrough packs and how many extra walkthroughs you have…'),
      skeletonLine('p', 'packs-balance', 32), choice, skeletonLine('p', 'annual-charge', 66), annualRow(action), skeletonLine('p', 'annual-note', 77));
  }
  async function renderPacks(supabase, ticket, workspaceID, options = {}) {
    if (!packsEl) return;
    if (!workspaceID) { packsHide(); return; }
    if (options.quiet && packs) packsEl.setAttribute('aria-busy', 'true');
    else packsSkeleton();
    const version = ++packsVersion;
    const [reply, lane] = await Promise.all([
      settled(Promise.resolve().then(() => supabase.rpc('get_pack_offer', { p_workspace_id: workspaceID }))),
      squareLane(),
    ]);
    if (ticket !== deskVersion || version !== packsVersion) return;
    packsEl.setAttribute('aria-busy', 'false');
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to check walkthrough packs.'); return; }
    // Before the backend has the function there are no packs to show; that is not an outage.
    if (reply.value?.error?.code === 'PGRST202') { packsHide(); return; }
    const previous = packs && packs.workspaceID === workspaceID ? packs : null;
    packsDropCard(packs);
    const offer = failed(reply) ? null : firstRow(reply.value?.data);
    packs = { supabase, workspaceID, offer, lane, kind: packsKind(offer, lane), selected: previous?.selected || null,
      busy: false, card: null, problem: null, done: null, sandbox: false, notice: options.notice || null };
    packsDraw(options.focus);
  }
  // After an unconfirmed purchase, the balance line is read again in place, so the
  // card field and the sentence under the button stay where they are.
  async function packsRecount(state) {
    const reply = await settled(Promise.resolve().then(() => state.supabase.rpc('get_pack_offer', { p_workspace_id: state.workspaceID })));
    if (packs !== state) return;
    const offer = failed(reply) ? null : firstRow(reply.value?.data);
    if (!packsValid(offer)) return;
    state.offer = { ...state.offer, credits_available: offer.credits_available, next_expiry: offer.next_expiry ?? null };
    if (state.refs?.balance) state.refs.balance.textContent = packBalance(state.offer);
    void planCapacityRefresh?.();
  }
  // "Buy" (the chosen pack's walkthroughs): load Square's SDK once, open its card field in the card, and move focus into it.
  async function packsOpenCard(control) {
    const state = packs;
    if (!state || state.busy || state.card || state.kind !== 'choose') return;
    // One card form on the desk at a time: any other open card form is closed first.
    closeCardForms('packs');
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Loading card form…';
    setStatus('Loading Square’s card form…');
    let form = annualCardForm(state.lane);
    if (!form) {
      const lane = await squareLane(true);
      if (packs !== state) return;
      if (lane) state.lane = lane;
      form = annualCardForm(lane);
    }
    const made = form ? await settled(annualSdk(form.sdk_url).then(Square => Square.payments(form.application_id, form.location_id).card({ style: SQUARE_CARD_STYLE })))
      : { error: new Error('No card form') };
    if (made.timedOut) annualSdkLoad = null;
    const card = made.timedOut || made.error ? null : made.value;
    if (packs !== state) { Promise.resolve().then(() => card?.destroy?.()).catch(() => {}); return; }
    if (!card || typeof card.attach !== 'function' || typeof card.tokenize !== 'function') {
      state.busy = false; packsProblem(state, ANNUAL_SDK_FAILED); control.focus?.(); return;
    }
    state.card = card;
    packsDraw();
    const attached = await settled(Promise.resolve().then(() => card.attach('#' + PACK_CARD_FIELD)));
    if (packs !== state) return;
    state.busy = false;
    if (attached.timedOut || attached.error) {
      packsDropCard(state); state.problem = ANNUAL_SDK_FAILED; packsDraw('pay'); setStatus(ANNUAL_SDK_FAILED); return;
    }
    setStatus('Enter your card in Square’s card form, then pay.');
    if (typeof card.focus === 'function') { try { await card.focus('cardNumber'); return; } catch { /* the field itself, below */ } }
    state.refs?.field?.focus();
  }
  function packsCloseCard() {
    const state = packs;
    if (!state || state.busy) return;
    packsDropCard(state); state.problem = null;
    packsDraw('pay');
    setStatus('Card form closed. Nothing was charged.');
  }
  // A version 4 UUID naming one purchase intent; it is an idempotency key, not a secret.
  function packAttemptID() {
    const cryptoAPI = window.crypto || globalThis.crypto;
    if (cryptoAPI && typeof cryptoAPI.randomUUID === 'function') return cryptoAPI.randomUUID();
    const bytes = new Uint8Array(16);
    if (cryptoAPI && typeof cryptoAPI.getRandomValues === 'function') cryptoAPI.getRandomValues(bytes);
    else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  // "Pay" (the chosen pack's price): Square tokenizes the card in its iframe; only that single-use token is sent.
  async function packsConfirmCard(control) {
    const state = packs;
    if (!state || state.busy || !state.card) return;
    const pack = packChosen(state);
    const expected = { credited: pack.walkthroughs, amount_cents: pack.price_cents };
    state.busy = true; state.problem = null;
    if (state.refs?.problem) state.refs.problem.hidden = true;
    control.disabled = true; control.textContent = 'Paying…';
    setStatus('Paying ' + planMoney(pack.price_cents) + ' for ' + packWords(pack.walkthroughs) + '…');
    const tokenized = await settled(Promise.resolve().then(() => state.card.tokenize()));
    if (packs !== state) return;
    const result = tokenized.timedOut || tokenized.error ? null : tokenized.value;
    const sourceID = result?.status === 'OK' ? result.token : null;
    if (typeof sourceID !== 'string' || !/^[A-Za-z0-9:_-]{8,512}$/.test(sourceID)) {
      state.busy = false;
      packsProblem(state, 'Square couldn’t use those card details. Check them and try again. Nothing was charged.');
      control.focus?.();
      return;
    }
    const token = await annualToken(state.supabase);
    if (packs !== state) return;
    if (!token) { showSignedOut('Your sign-in has expired. Sign in again to buy a pack. Nothing was charged.'); return; }
    // One purchase intent keeps one attempt id across every Try again, even with a fresh card
    // token, so the server returns an attempt Square already completed instead of charging twice.
    const attempts = state.attempts || (state.attempts = {});
    const attemptID = attempts[pack.code] || (attempts[pack.code] = packAttemptID());
    const reply = await settled(annualHooks('/square/packs/checkout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ workspace_id: state.workspaceID, pack_code: pack.code, source_id: sourceID, attempt_id: attemptID }) }), 30000);
    if (packs !== state) return;
    state.busy = false;
    const answer = reply.timedOut || reply.error ? null : reply.value;
    const done = answer?.ok ? answer.body : null;
    if (done && typeof done === 'object' && Number.isInteger(done.credited) && done.credited > 0 && Number.isInteger(done.credits_available)
      && done.credits_available >= done.credited && Number.isInteger(done.amount_cents) && done.amount_cents > 0) {
      delete attempts[pack.code];
      packsBought(state, done, expected);
      return;
    }
    const code = answer?.body?.error || (answer?.status === 401 ? 'unauthorized' : null);
    if (code === 'unauthorized') { showSignedOut('Your sign-in has expired. Sign in again to buy a pack. Nothing was charged.'); return; }
    packsProblem(state, PACK_REFUSALS[code] || PACK_UNCONFIRMED);
    control.focus?.();
    if (!PACK_REFUSALS[code]) void packsRecount(state);
  }
  // The bought state is drawn from the server's answer: the walkthroughs, price and balance it states.
  function packsBought(state, done, expected) {
    packsDropCard(state);
    const useBy = annualDay(done.expires_on) ? done.expires_on : packExpiry();
    const differs = done.credited !== expected.credited || done.amount_cents !== expected.amount_cents;
    state.done = { credited: done.credited, credits_available: done.credits_available, amount_cents: done.amount_cents, useBy: annualDay(useBy) };
    state.offer = { ...state.offer, credits_available: done.credits_available, next_expiry: state.offer.next_expiry || useBy };
    Object.assign(state, { kind: 'bought', sandbox: done.sandbox === true, problem: null,
      notice: differs ? 'These are the terms your purchase went through with; they differ from what was shown before you paid.' : null });
    packsDraw('title');
    setStatus(packTest(state) + packWords(done.credited) + ' added. ' + planMoney(done.amount_cents) + ' charged today.');
    // The plan panel above counts the same ledger.
    void planCapacityRefresh?.();
  }

  /* ---- Super fast render (code: express) ----------------------------------
   * Offer 2026-09-25.2, owner decision 25 September: a capture that has been sent
   * (queued or processing) can go first in the queue on the fastest GPU available,
   * ready in about 30 minutes any day, any time, instead of the usual 1–2 hours, for
   * A$29 by card on this website or with a render from the early-annual bonus. If it
   * is late the A$29 is refunded automatically, or the bonus render is returned.
   * There is no daily cap and no business hours. Which captures are open, when a
   * super fast one would be ready, the price and the credits are the server's answer
   * (get_express_offer, one per workspace); a card pays through POST
   * /square/express/checkout with Square's single-use token, and a credit through
   * use_express_credit. The offer sits on the space it belongs to, never in the
   * app. An ordered render says it is automatic and when it is due. An older answer
   * may still carry daily_cap and full_today: a full answer offers nothing to press,
   * and the words never state a cap.
   */
  const expressStatusEl = document.getElementById('account-express-status');
  const EXPRESS_OFFERED = ['queued', 'processing'];
  const EXPRESS_LISTED = ['queued', 'processing', 'awaiting_review'];
  const EXPRESS_STATES = ['open', 'met', 'missed'];
  const EXPRESS_REFUNDS = ['pending', 'refunded', 'returned'];
  const EXPRESS_CARD_FIELD = 'account-express-card-field';
  const EXPRESS_TEST_LINE = 'Test · Square Sandbox: a test payment, not a live charge.';
  // Each of these is refused before Square takes a payment or a credit is used.
  const EXPRESS_REFUSALS = {
    full_today: 'Super fast isn’t available right now, so nothing was charged. Your capture keeps its place in the queue.',
    express_full_today: 'Super fast isn’t available right now, so nothing was charged. Your capture keeps its place in the queue.',
    already_express: 'This capture is already super fast, so nothing more was charged.',
    payment_declined: 'Your card was declined, so nothing was charged. Check the details or use another card, then try again.',
    not_eligible: 'This capture can’t be made super fast now, so nothing was charged.',
    no_credit: 'No super fast render is left from your bonus, so nothing was used.',
    lane_closed: 'Card payment for super fast renders is closed right now, so nothing was charged.',
    invalid_request: 'The order wasn’t accepted, so nothing was charged. Try again.',
  };
  const EXPRESS_UNCONFIRMED = 'We couldn’t confirm the super fast order. If your card was charged, this capture shows as super fast once the payment clears. Check this space again in a minute before you try again: a retry never charges twice.';
  // Per property: the element in its space that the offer is drawn into.
  const expressSlots = new Map();
  let express = null;
  let expressVersion = 0;

  /** A moment the server sent, as Brisbane reads it: "11:40 am today" or "9:30 am Mon 28 Sept". */
  function expressMoment(value) {
    const when = new Date(value || '');
    if (!value || Number.isNaN(when.getTime())) return '';
    let day, today, time, date;
    try {
      const dayOf = moment => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
      day = dayOf(when); today = dayOf(new Date());
      time = when.toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' });
      date = when.toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short' });
    } catch { return ''; }
    return day === today ? time + ' today' : time + ' ' + date;
  }
  function expressOrderValid(order) {
    return Boolean(order) && typeof order === 'object' && EXPRESS_STATES.includes(order.state) && ['card', 'credit'].includes(order.paid_with)
      && Boolean(expressMoment(order.due_at)) && (order.paid_with === 'credit' || (Number.isInteger(order.amount_cents) && order.amount_cents > 0))
      && (order.refund === null || order.refund === undefined || EXPRESS_REFUNDS.includes(order.refund))
      && (order.state !== 'met' || Boolean(expressMoment(order.completed_at)));
  }
  function expressCaptureValid(capture) {
    if (!capture || typeof capture !== 'object' || typeof capture.job_id !== 'string' || !capture.job_id
      || typeof capture.property_id !== 'string' || !EXPRESS_LISTED.includes(capture.status)) return false;
    const order = capture.express;
    if (order === null || order === undefined) return EXPRESS_OFFERED.includes(capture.status) && Boolean(expressMoment(capture.ready_by));
    return expressOrderValid(order);
  }
  // An older answer still counts against a daily cap; the current one has none.
  function expressCapped(offer) { return Number.isInteger(offer.daily_cap) && offer.daily_cap > 0; }
  function expressValid(offer) {
    return Boolean(offer) && typeof offer === 'object' && Number.isInteger(offer.price_cents) && offer.price_cents > 0
      // A full answer offers nothing, so "full" must be exactly what the count says; with no cap it is never full.
      && (expressCapped(offer)
        ? Number.isInteger(offer.taken_today) && offer.taken_today >= 0 && typeof offer.full_today === 'boolean' && offer.full_today === (offer.taken_today >= offer.daily_cap)
        : (offer.daily_cap === null || offer.daily_cap === undefined) && offer.full_today !== true)
      && Number.isInteger(offer.credits_available) && offer.credits_available >= 0 && typeof offer.can_order === 'boolean'
      && Array.isArray(offer.captures) && offer.captures.every(expressCaptureValid)
      && new Set(offer.captures.map(capture => capture.job_id)).size === offer.captures.length;
  }
  function expressTest() { return express && (express.lane?.sandbox === true || express.sandbox === true) ? 'Test · ' : ''; }
  function expressPromise(offer) {
    return 'First in the queue: ready in about 30 minutes, any day, any time, instead of the usual 1–2 hours. If it isn’t, the ' +
      planMoney(offer.price_cents) + ' is refunded automatically.';
  }
  function expressCharge(offer, capture) {
    return expressTest() + 'Charged today: ' + planMoney(offer.price_cents) + '. Ready by ' + expressMoment(capture.ready_by) +
      ', or the ' + planMoney(offer.price_cents) + ' is refunded automatically.';
  }
  function expressPrimaryLabel(offer, capture) {
    const open = express.card && express.cardJob === capture.job_id;
    return expressTest() + (express.problems.get(capture.job_id) && open ? 'Try again' : open ? 'Pay ' + planMoney(offer.price_cents) : 'Super fast for ' + planMoney(offer.price_cents));
  }
  function expressCreditLabel(offer) {
    return 'Use a super fast render (' + offer.credits_available + ' left)';
  }
  // What an ordered render says: when it is due and what happens if it is late,
  // or when it was ready, or what came back when it was missed.
  function expressOrderParts(offer, order) {
    const parts = [];
    const head = annualNode('div', 'express-head');
    const refundWords = order.paid_with === 'credit' ? 'your super fast render is returned' : 'the ' + planMoney(order.amount_cents) + ' is refunded automatically';
    if (order.state === 'open') {
      head.append(annualNode('p', 'express-title', 'Super fast · ready by ' + expressMoment(order.due_at)), pill('Automatic', 'busy'));
      parts.push(head, annualNode('p', 'express-note', 'First in the queue; nothing for you to do. If it isn’t ready by then, ' + refundWords + '.'));
    } else if (order.state === 'met') {
      head.append(annualNode('p', 'express-title', 'Super fast · ready ' + expressMoment(order.completed_at)), pill('On time', 'good'));
      parts.push(head, annualNode('p', 'express-note', 'Check it below and approve it when you are ready.'));
    } else {
      const back = order.paid_with === 'credit' ? (order.refund === 'returned' ? 'Your super fast render was returned.' : 'Your super fast render is being returned.')
        : order.refund === 'refunded' ? planMoney(order.amount_cents) + ' refunded.' : 'Your ' + planMoney(order.amount_cents) + ' refund is on its way.';
      head.append(annualNode('p', 'express-title', 'Super fast was late'));
      parts.push(head, annualNode('p', 'express-note', back + ' The walkthrough still comes, as soon as it is ready.'));
    }
    return parts;
  }
  function expressCaptureParts(workspaceID, offer, capture) {
    if (capture.express) return expressOrderParts(offer, capture.express);
    const parts = [];
    const head = annualNode('div', 'express-head');
    const say = (className, text) => { const node = annualNode('p', className, text); parts.push(node); return node; };
    const problemText = express.problems.get(capture.job_id) || '';
    if (offer.full_today) {
      head.append(annualNode('p', 'express-title', 'Super fast render'), pill('Not available right now', 'quiet'));
      parts.push(head);
      say('express-note', 'Super fast isn’t available right now. Your capture keeps its place and is usually ready within 1–2 hours.');
      // Refused as full after pressing: the reason stays beside it until the next read.
      if (problemText) parts.push(annualAlert(problemText, 'annual-alert annual-problem'));
      return parts;
    }
    head.append(annualNode('p', 'express-title', 'Need it sooner? Super fast render'));
    parts.push(head);
    const price = annualNode('p', 'express-price');
    price.append(annualNode('span', 'express-amount', expressTest() + planMoney(offer.price_cents)),
      annualNode('span', 'express-by', 'ready by ' + expressMoment(capture.ready_by)));
    parts.push(price);
    say('express-note', expressPromise(offer));
    if (!offer.can_order) { say('express-note', 'Only the workspace owner can order it.'); return parts; }
    const open = express.card && express.cardJob === capture.job_id;
    if (open) {
      const charge = say('annual-charge', expressCharge(offer, capture)); charge.id = 'account-express-charge';
      const label = annualNode('p', 'annual-card-label', 'Card details'); label.id = EXPRESS_CARD_FIELD + '-label';
      const field = annualNode('div', 'annual-card-field'); field.id = EXPRESS_CARD_FIELD;
      field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', label.id); field.tabIndex = -1;
      express.refs.field = field;
      const block = annualNode('div', 'annual-card'); block.append(label, field); parts.push(block);
      const pay = button(expressPrimaryLabel(offer, capture), () => { void expressConfirmCard(workspaceID, capture.job_id, pay); });
      pay.className = 'tour-action tour-action-primary'; pay.setAttribute('aria-describedby', 'account-express-charge');
      express.refs.pay = pay; express.refs.controls.set(capture.job_id, pay);
      parts.push(annualRow(pay, button('Not now', () => expressCloseCard())));
    } else {
      const controls = [];
      if (offer.credits_available > 0) {
        const use = button(expressCreditLabel(offer), () => { void expressUseCredit(workspaceID, capture.job_id, use); });
        controls.push(use); express.refs.controls.set(capture.job_id, use);
      } else if (express.lane?.open) {
        const buy = button(expressPrimaryLabel(offer, capture), () => { void expressOpenCard(workspaceID, capture.job_id, buy); });
        controls.push(buy); express.refs.controls.set(capture.job_id, buy);
      }
      if (controls.length) parts.push(annualRow(...controls));
      else say('express-note express-soon', express.lane ? 'Card payment for super fast renders opens soon.' : 'Card payment couldn’t be reached. Refresh spaces to try again.');
    }
    const problem = annualAlert(problemText, 'annual-alert annual-problem');
    problem.hidden = !problemText; parts.push(problem);
    if (open) say('annual-note', 'Your card goes into Square’s secure form on this page; Veylet never sees it.');
    return parts;
  }
  // Draw every space's express block from the answers held; a space without an
  // open or express capture shows none.
  function expressDraw(focusJob) {
    if (!express) return;
    express.refs = { controls: new Map() };
    let focusNode = null;
    for (const [propertyID, slot] of expressSlots) {
      const parts = [];
      for (const [workspaceID, offer] of express.offers) {
        if (!offer) continue;
        for (const capture of offer.captures.filter(item => item.property_id === propertyID)) {
          const block = annualNode('div', 'express-block'); block.dataset.job = capture.job_id; block.tabIndex = -1;
          if (expressTest() && !capture.express) block.append(annualNode('p', 'plan-scope plan-test', EXPRESS_TEST_LINE));
          block.append(...expressCaptureParts(workspaceID, offer, capture));
          if (capture.job_id === focusJob) focusNode = block;
          parts.push(block);
        }
      }
      slot.hidden = !parts.length;
      slot.replaceChildren(...parts);
    }
    // After an order, a refusal or a closed card, focus stays with that capture.
    if (focusNode) (express.refs.controls.get(focusJob) || focusNode).focus?.();
  }
  function expressDropCard() {
    const card = express?.card;
    if (!card) return;
    express.card = null; express.cardJob = null;
    Promise.resolve().then(() => card.destroy?.()).catch(() => {});
  }
  function expressCloseOther() {
    if (!express || express.busy || !express.card) return;
    const job = express.cardJob;
    expressDropCard(); express.problems.delete(job); expressDraw();
  }
  function expressHide() {
    expressDropCard();
    expressVersion += 1; express = null;
    expressSlots.clear();
    if (expressStatusEl) { expressStatusEl.hidden = true; expressStatusEl.textContent = ''; }
  }
  // One answer per workspace that has a space on this desk. A failed read says so
  // above the list; it never hides an order that was already paid for.
  async function renderExpress(supabase, ticket, workspaceIDs) {
    expressDropCard();
    const version = ++expressVersion;
    if (expressStatusEl) { expressStatusEl.hidden = true; expressStatusEl.textContent = ''; }
    if (!workspaceIDs.length) { express = null; return; }
    const [lane, ...replies] = await Promise.all([squareLane(),
      ...workspaceIDs.map(id => settled(Promise.resolve().then(() => supabase.rpc('get_express_offer', { p_workspace_id: id }))))]);
    if (ticket !== deskVersion || version !== expressVersion) return;
    if (replies.some(sessionGone)) { showSignedOut('Your sign-in has expired. Sign in again to check super fast renders.'); return; }
    const offers = new Map();
    let unreadable = false;
    workspaceIDs.forEach((id, index) => {
      const reply = replies[index];
      // Before the backend has the function there is no express offer; that is not an outage.
      if (reply.value?.error?.code === 'PGRST202') return;
      const offer = failed(reply) ? null : firstRow(reply.value?.data);
      if (expressValid(offer)) offers.set(id, offer); else unreadable = true;
    });
    express = { supabase, lane, offers, card: null, cardJob: null, busy: false, problems: new Map(), attempts: new Map(), sandbox: false, refs: { controls: new Map() } };
    if (unreadable && expressStatusEl) {
      expressStatusEl.textContent = 'Super fast renders couldn’t be checked. Your captures keep their place in the queue; refresh spaces to try again.';
      expressStatusEl.hidden = false;
    }
    expressDraw();
  }
  function expressFind(workspaceID, jobID) {
    const offer = express?.offers.get(workspaceID);
    return offer ? { offer, capture: offer.captures.find(item => item.job_id === jobID) } : {};
  }
  // "Express for A$29": load Square's SDK once, open its card field in this space, and move focus into it.
  async function expressOpenCard(workspaceID, jobID, control) {
    const state = express;
    if (!state || state.busy || state.card) return;
    const { offer, capture } = expressFind(workspaceID, jobID);
    if (!offer || !capture || capture.express || offer.full_today || !offer.can_order) return;
    closeCardForms('express');
    state.busy = true; state.problems.delete(jobID);
    control.disabled = true; control.textContent = 'Loading card form…';
    setStatus('Loading Square’s card form…');
    let form = annualCardForm(state.lane);
    if (!form) {
      const lane = await squareLane(true);
      if (express !== state) return;
      if (lane) state.lane = lane;
      form = annualCardForm(lane);
    }
    const made = form ? await settled(annualSdk(form.sdk_url).then(Square => Square.payments(form.application_id, form.location_id).card({ style: SQUARE_CARD_STYLE })))
      : { error: new Error('No card form') };
    if (made.timedOut) annualSdkLoad = null;
    const card = made.timedOut || made.error ? null : made.value;
    if (express !== state) { Promise.resolve().then(() => card?.destroy?.()).catch(() => {}); return; }
    if (!card || typeof card.attach !== 'function' || typeof card.tokenize !== 'function') {
      state.busy = false; state.problems.set(jobID, ANNUAL_SDK_FAILED); expressDraw(jobID); setStatus(ANNUAL_SDK_FAILED); return;
    }
    state.card = card; state.cardJob = jobID;
    expressDraw();
    const attached = await settled(Promise.resolve().then(() => card.attach('#' + EXPRESS_CARD_FIELD)));
    if (express !== state) return;
    state.busy = false;
    if (attached.timedOut || attached.error) {
      expressDropCard(); state.problems.set(jobID, ANNUAL_SDK_FAILED); expressDraw(jobID); setStatus(ANNUAL_SDK_FAILED); return;
    }
    setStatus('Enter your card in Square’s card form, then pay ' + planMoney(offer.price_cents) + ' for a super fast render.');
    if (typeof card.focus === 'function') { try { await card.focus('cardNumber'); return; } catch { /* the field itself, below */ } }
    state.refs?.field?.focus();
  }
  function expressCloseCard() {
    const state = express;
    if (!state || state.busy) return;
    const job = state.cardJob;
    expressDropCard(); state.problems.delete(job);
    expressDraw(job);
    setStatus('Card form closed. Nothing was charged.');
  }
  // An order the server confirmed: the capture's express state, today's count and the
  // credits it answered with. The space says the due time the answer carries.
  function expressOrdered(workspaceID, jobID, done) {
    const { offer, capture } = expressFind(workspaceID, jobID);
    if (!offer || !capture) return;
    capture.express = done.express;
    if (Number.isInteger(done.taken_today) && done.taken_today >= 0) offer.taken_today = done.taken_today;
    offer.full_today = expressCapped(offer) && offer.taken_today >= offer.daily_cap;
    if (Number.isInteger(done.credits_available) && done.credits_available >= 0) offer.credits_available = done.credits_available;
    express.problems.delete(jobID); express.attempts.delete(jobID);
    if (done.sandbox === true) express.sandbox = true;
    expressDraw(jobID);
    const order = done.express;
    setStatus(expressTest() + 'Super fast ordered. Ready by ' + expressMoment(order.due_at) + (order.paid_with === 'credit'
      ? '; one super fast render used.' : '; ' + planMoney(order.amount_cents) + ' charged today, refunded automatically if it is late.'));
  }
  function expressAnswer(reply, jobID) {
    const answer = reply.timedOut || reply.error ? null : reply.value;
    const done = answer?.ok ? answer.body : null;
    return done && typeof done === 'object' && expressOrderValid(done.express) && done.express.state === 'open' && done.job_id === jobID
      ? { done } : { code: answer?.body?.error || (answer?.status === 401 ? 'unauthorized' : null), answered: Boolean(answer?.ok) };
  }
  // "Pay A$29": Square tokenizes the card in its iframe; only that single-use token is sent.
  async function expressConfirmCard(workspaceID, jobID, control) {
    const state = express;
    if (!state || state.busy || !state.card || state.cardJob !== jobID) return;
    const { offer, capture } = expressFind(workspaceID, jobID);
    if (!offer || !capture) return;
    state.busy = true; state.problems.delete(jobID);
    control.disabled = true; control.textContent = 'Paying…';
    setStatus('Paying ' + planMoney(offer.price_cents) + ' for a super fast render…');
    const tokenized = await settled(Promise.resolve().then(() => state.card.tokenize()));
    if (express !== state) return;
    const result = tokenized.timedOut || tokenized.error ? null : tokenized.value;
    const sourceID = result?.status === 'OK' ? result.token : null;
    if (typeof sourceID !== 'string' || !/^[A-Za-z0-9:_-]{8,512}$/.test(sourceID)) {
      state.busy = false;
      state.problems.set(jobID, 'Square couldn’t use those card details. Check them and try again. Nothing was charged.');
      expressDraw(jobID); setStatus(state.problems.get(jobID));
      return;
    }
    const token = await annualToken(state.supabase);
    if (express !== state) return;
    if (!token) { showSignedOut('Your sign-in has expired. Sign in again to order a super fast render. Nothing was charged.'); return; }
    // One order intent keeps one attempt id across every Try again, even with a fresh card token.
    const attemptID = state.attempts.get(jobID) || packAttemptID();
    state.attempts.set(jobID, attemptID);
    const reply = await settled(annualHooks('/square/express/checkout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ workspace_id: workspaceID, job_id: jobID, source_id: sourceID, attempt_id: attemptID }) }), 30000);
    if (express !== state) return;
    state.busy = false;
    const { done, code } = expressAnswer(reply, jobID);
    if (done) { expressDropCard(); expressOrdered(workspaceID, jobID, done); return; }
    if (code === 'unauthorized') { showSignedOut('Your sign-in has expired. Sign in again to order a super fast render. Nothing was charged.'); return; }
    if ((code === 'express_full_today' || code === 'full_today')) { if (expressCapped(offer)) offer.taken_today = Math.max(offer.taken_today, offer.daily_cap); offer.full_today = true; expressDropCard(); }
    if (EXPRESS_REFUSALS[code]) state.attempts.delete(jobID);
    state.problems.set(jobID, EXPRESS_REFUSALS[code] || EXPRESS_UNCONFIRMED);
    expressDraw(jobID); setStatus(state.problems.get(jobID));
  }
  // "Use an express render": one of the early-annual bonus's express renders, no card.
  async function expressUseCredit(workspaceID, jobID, control) {
    const state = express;
    if (!state || state.busy) return;
    const { offer, capture } = expressFind(workspaceID, jobID);
    if (!offer || !capture || capture.express || offer.credits_available < 1) return;
    closeCardForms('express');
    state.busy = true; state.problems.delete(jobID);
    control.disabled = true; control.textContent = 'Using a super fast render…';
    setStatus('Using a super fast render…');
    const reply = await settled(Promise.resolve().then(() => state.supabase.rpc('use_express_credit', { p_job_id: jobID })));
    if (express !== state) return;
    state.busy = false;
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to order a super fast render. Nothing was used.'); return; }
    const answer = failed(reply) ? null : firstRow(reply.value?.data);
    if (answer && typeof answer === 'object' && expressOrderValid(answer.express) && answer.express.paid_with === 'credit' && answer.express.state === 'open') {
      expressOrdered(workspaceID, jobID, answer);
      return;
    }
    // The database's refusal, by the words it raises; a lost answer is unknown.
    const said = String(reply.value?.error?.message || '');
    const code = /full today/i.test(said) ? 'full_today' : /no express render left|no express credit/i.test(said) ? 'no_credit'
      : /already express/i.test(said) ? 'already_express' : said ? 'not_eligible' : null;
    if ((code === 'express_full_today' || code === 'full_today')) { if (expressCapped(offer)) offer.taken_today = Math.max(offer.taken_today, offer.daily_cap); offer.full_today = true; }
    if (code === 'no_credit') offer.credits_available = 0;
    state.problems.set(jobID, code ? EXPRESS_REFUSALS[code].replace('nothing was charged', 'nothing was used') : 'We couldn’t confirm the super fast render. Check this space again in a minute before you try again.');
    expressDraw(jobID); setStatus(state.problems.get(jobID));
  }

  // One card form on the desk at a time: opening one closes the others, quietly.
  function closeCardForms(except) {
    if (except !== 'trial') trialCloseOther();
    if (except !== 'packs') packsCloseOther();
    if (except !== 'annual') annualCloseOther();
    if (except !== 'express') expressCloseOther();
  }

  /* ---- Refer an office -----------------------------------------------------
   * When an office the account refers first pays, both offices get one bonus
   * walkthrough (offer 2026-09-25.1). The workspace's own code is the server's
   * answer (get_referral_code), and the share link is built from it only when it is
   * the 12-character code the server issues. Before that function exists, when it
   * refuses (a test workspace) or fails, the block says so in words and shows no
   * link. An office that arrived through someone else's link (?ref=, kept for this
   * browser session) records it here before it first pays (claim_workspace_referral).
   * Nothing on this page grants a bonus.
   */
  const referralEl = document.getElementById('account-referral');
  // offer.json referral.referrerWalkthroughs and referredWalkthroughs.
  const REFERRAL_WALKTHROUGHS = 1;
  const REFERRAL_RULE = 'When an office you refer becomes a paying account, you each get ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough.';
  const REFERRAL_WAITING = 'Your share link appears here once referral links open.';
  const REFERRAL_EACH = 'you and the office that referred you each get ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough';
  // The server's refusals, by the words it raises. Each is final for this code, so the kept code is let go.
  const REFERRAL_REFUSALS = [
    ['unknown referral link', 'That referral link isn’t recognised, so nothing was recorded. Ask the office that referred you to send its link again.'],
    ['cannot refer itself', 'An office can’t refer itself, so nothing was recorded.'],
    ['cannot refer each other', 'Two offices can’t refer each other, so nothing was recorded.'],
    ['already records who referred it', 'Your office already records the office that referred it, so nothing changed.'],
    ['before the office first pays', 'A referral is recorded before your office first pays, so nothing was recorded here. Ask Veylet support about it.'],
    ['only the owner of the new office', 'Only your office’s owner can record who referred it, so nothing was recorded.'],
    ['test workspaces cannot take part', 'Test workspaces can’t take part in referrals, so nothing was recorded.'],
  ];
  let referralVersion = 0;

  function referralLink(answer) {
    const code = answer && typeof answer === 'object' && typeof answer.code === 'string' ? answer.code : '';
    return REFERRAL_CODE.test(code) ? 'https://veylet.com/account?ref=' + code : null;
  }
  // How many offices this one referred, and the bonus walkthroughs it received: a quiet line, only when there are some.
  function referralTally(answer) {
    const count = (value, one, many) => (Number.isInteger(value) && value > 0 ? value + (value === 1 ? one : many) : '');
    return [count(answer?.referred_offices, ' office referred so far', ' offices referred so far'),
      count(answer?.bonus_walkthroughs, ' bonus walkthrough received', ' bonus walkthroughs received')].filter(Boolean).join(' · ');
  }
  function referralHead() {
    const title = annualNode('h3', 'annual-title', 'Refer an office');
    title.id = 'account-referral-title';
    const head = annualNode('div', 'annual-head'); head.append(title);
    return head;
  }
  function referralHide() {
    referralVersion += 1;
    if (!referralEl) return;
    referralEl.hidden = true; referralEl.setAttribute('aria-busy', 'false'); referralEl.replaceChildren();
  }
  // Waiting keeps the block's own shape: the rule, then the link field and its button.
  function referralSkeleton() {
    if (!referralEl) return;
    referralVersion += 1;
    referralEl.hidden = false; referralEl.setAttribute('aria-busy', 'true');
    const field = annualNode('div', 'tour-field');
    field.append(skeletonLine('span', 'referral-skeleton-label', 16), skeletonLine('span', 'referral-skeleton-field', 36));
    const action = annualNode('span', 'plan-skeleton annual-skeleton-action'); action.setAttribute('aria-hidden', 'true');
    const row = annualNode('div', 'tour-link-row'); row.append(field, annualRow(action));
    referralEl.replaceChildren(referralHead(), annualNode('p', 'annual-lead', REFERRAL_RULE), row);
  }
  // Arrived through another office's link: its owner records it while the plan is not yet paid for.
  function referralClaim(supabase, ticket, workspaceID) {
    const box = annualNode('div', 'referral-claim');
    const line = annualNode('p', 'annual-note', 'An office referred you to Veylet. Record it before your office first pays, and ' + REFERRAL_EACH + ' when it does.');
    const said = annualNode('p', 'referral-said'); said.setAttribute('role', 'status'); said.tabIndex = -1;
    const done = text => {
      referredForget();
      said.textContent = text; line.hidden = true; record.hidden = true;
      said.focus?.();
    };
    const record = button('Record the office that referred us', async () => {
      const code = referredBy;
      if (record.disabled || !code) return;
      record.disabled = true; said.textContent = 'Recording the office that referred you…';
      const reply = await settled(Promise.resolve().then(() => supabase.rpc('claim_workspace_referral', { p_workspace_id: workspaceID, p_code: code })));
      if (ticket !== deskVersion) return;
      if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to record the office that referred you.'); return; }
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (answer && typeof answer === 'object' && typeof answer.recorded === 'boolean') {
        done((answer.recorded ? 'Recorded.' : 'Already recorded.') + ' When your office first pays, ' + REFERRAL_EACH + '.');
        return;
      }
      const error = reply.value?.error || reply.error || null;
      const words = String(error?.message || '').toLowerCase();
      const refusal = REFERRAL_REFUSALS.find(([phrase]) => words.includes(phrase));
      if (refusal) { done(refusal[1]); return; }
      record.disabled = false;
      said.textContent = error?.code === 'PGRST202' ? 'Recording a referral isn’t available yet, so nothing was recorded. Try again later.'
        : 'The referral wasn’t confirmed, so nothing changed. Try again.';
    });
    box.append(line, annualRow(record), said);
    return box;
  }
  // `claim` is true when this signed-in person owns a workspace whose plan is not yet paid for.
  async function renderReferral(supabase, ticket, workspaceID, claim = false) {
    if (!referralEl) return;
    if (!workspaceID) { referralHide(); return; }
    referralSkeleton();
    const version = referralVersion;
    const reply = await settled(Promise.resolve().then(() => supabase.rpc('get_referral_code', { p_workspace_id: workspaceID })));
    if (ticket !== deskVersion || version !== referralVersion) return;
    referralEl.setAttribute('aria-busy', 'false');
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to see your share link.'); return; }
    // A missing function (PGRST202), a refusal or failure, or an answer without a proper code: words, no link.
    const answer = failed(reply) ? null : firstRow(reply.value?.data);
    const url = referralLink(answer);
    const parts = [referralHead(), annualNode('p', 'annual-lead', REFERRAL_RULE)];
    if (!url) parts.push(annualNode('p', 'annual-note', REFERRAL_WAITING));
    else {
      // The desk's copy field; the page status announces the result and the line under it repeats it.
      const link = copyField('Your share link', 'input', url);
      const said = annualNode('p', 'referral-said'); said.hidden = true;
      const copy = button('Copy link', async () => {
        const share = window.VeyletSharing;
        if (share?.copy) await share.copy(url, link.field, statusEl, 'Share link copied. Send it to the office you are referring.');
        else { link.field.focus(); link.field.select(); setStatus('Select and copy the link above.'); }
        said.textContent = statusEl?.textContent || ''; said.hidden = !said.textContent;
      });
      const row = annualNode('div', 'tour-link-row'); row.append(link.label, annualRow(copy));
      parts.push(row, said);
      const tally = referralTally(answer);
      if (tally) parts.push(annualNode('p', 'annual-note referral-tally', tally + '.'));
    }
    if (claim && referredBy) parts.push(referralClaim(supabase, ticket, workspaceID));
    referralEl.replaceChildren(...parts);
  }

  /* ---- What your clients see ---------------------------------------------
   * The agent's own business contact, shown on every walkthrough they share (design
   * decision D8, property-3d-studio docs/ux/capture-to-client-journey-20260925.md):
   * opt-in, typed here, never taken from sign-in. Migration
   * 20260925130000_agent_public_contact.sql (not yet released) reads it with
   * get_workspace_public_contact (any member: one row, show_on_shared and four fields)
   * and writes it with set_workspace_public_contact (an owner or reviewer; showing
   * needs a name and a phone or email). Before the backend has the function
   * (PGRST202) the section stays away. What was typed survives every error.
   */
  const clientsEl = document.getElementById('account-contact');
  const clientsBody = document.getElementById('account-contact-body');
  const CLIENTS_FIELDS = [
    { key: 'display_name', label: 'Name', type: 'text', autocomplete: 'name', max: 80 },
    { key: 'agency', label: 'Agency', type: 'text', autocomplete: 'organization', max: 80 },
    { key: 'phone', label: 'Phone', type: 'tel', autocomplete: 'tel', max: 32, inputMode: 'tel' },
    { key: 'email', label: 'Email', type: 'email', autocomplete: 'email', max: 254, inputMode: 'email' },
  ];
  const CLIENTS_EMPTY = Object.freeze({ show: false, display_name: '', agency: '', phone: '', email: '' });
  const CLIENTS_SAVED_SHOWN = 'Saved. Clients see this on every live walkthrough.';
  const CLIENTS_SAVED_HIDDEN = 'Saved. Clients won’t see your details.';
  const CLIENTS_ASK = 'Ask the account owner to change this.';
  // The same rules as the table's checks, said beside the field.
  const CLIENTS_WORDS = {
    long: 'Use 80 characters or fewer.',
    name: 'Add the name clients should see.',
    reach: 'Add a phone number or an email address, so clients can reach you.',
    phone: 'Use digits, spaces and + ( ) - only, up to 32 characters.',
    email: 'Check the email address. It should look like name@example.com.',
  };
  // The server's refusals, by the words it raises, to the field they belong to.
  const CLIENTS_REFUSALS = [
    ['display name must be', { display_name: 'long' }], ['agency must be', { agency: 'long' }],
    ['phone must be', { phone: 'phone' }], ['email must look like', { email: 'email' }],
    ['showing the contact needs', null],
  ];
  let clients = null, clientsVersion = 0, clientsKept = null;

  function clientsRow(row) {
    if (row === null || row === undefined) return { ...CLIENTS_EMPTY };
    if (typeof row !== 'object' || typeof row.show_on_shared !== 'boolean') return null;
    const text = key => (typeof row[key] === 'string' ? row[key] : row[key] === null || row[key] === undefined ? '' : null);
    const values = Object.fromEntries(CLIENTS_FIELDS.map(({ key }) => [key, text(key)]));
    if (Object.values(values).some(value => value === null)) return null;
    return { show: row.show_on_shared, ...values };
  }
  function clientsProblems(draft) {
    const problems = {};
    const value = key => String(draft[key] || '').trim();
    if (value('display_name').length > 80) problems.display_name = CLIENTS_WORDS.long;
    if (value('agency').length > 80) problems.agency = CLIENTS_WORDS.long;
    const phone = value('phone'), email = value('email');
    if (phone && (phone.length > 32 || !/^[0-9 +()-]+$/.test(phone) || !/[0-9]/.test(phone))) problems.phone = CLIENTS_WORDS.phone;
    if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) problems.email = CLIENTS_WORDS.email;
    if (draft.show) {
      if (!value('display_name')) problems.display_name = CLIENTS_WORDS.name;
      if (!phone && !email) problems.phone = CLIENTS_WORDS.reach;
    }
    return problems;
  }
  function clientsHide() {
    clientsVersion += 1; clients = null;
    if (!clientsEl) return;
    clientsEl.hidden = true; clientsEl.setAttribute('aria-busy', 'false');
    clientsBody?.replaceChildren();
  }
  // Waiting keeps the section's own shape: the switch, four fields, the card, Save.
  function clientsSkeleton() {
    if (!clientsEl || !clientsBody) return;
    clientsEl.hidden = false; clientsEl.setAttribute('aria-busy', 'true');
    const parts = [skeletonLine('p', 'annual-lead clients-lead', 70), skeletonLine('p', 'clients-skeleton-switch', 26)];
    for (const field of CLIENTS_FIELDS) {
      const row = annualNode('div', 'tour-field');
      row.append(skeletonLine('span', 'referral-skeleton-label', field.label.length + 2), skeletonLine('span', 'referral-skeleton-field', 30));
      parts.push(row);
    }
    const card = annualNode('div', 'clients-preview clients-preview-loading'); card.append(skeletonLine('p', 'clients-preview-name', 18), skeletonLine('p', 'clients-preview-agency', 24));
    const action = annualNode('span', 'plan-skeleton annual-skeleton-action'); action.setAttribute('aria-hidden', 'true');
    parts.push(card, annualRow(action), annualNode('span', 'render-sr', 'Checking what clients see…'));
    clientsBody.replaceChildren(...parts);
  }
  // A read that failed: words and one way to try again, never an empty form.
  function clientsProblem(supabase, workspaceID, role, offline) {
    clients = null;
    clientsEl.hidden = false; clientsEl.setAttribute('aria-busy', 'false');
    const again = button('Try again', () => { void clientsRender(supabase, deskVersion, workspaceID, role, true); });
    clientsBody.replaceChildren(annualNode('p', 'annual-note', offline ? 'You’re offline. Your contact details load when you’re back online.'
      : 'Your contact details couldn’t be checked. Try again.'), annualRow(again));
  }
  // The buyer's agent card as it will look, drawn from what is typed; nothing in it can be pressed.
  function clientsPreview(state) {
    const card = state.refs.preview;
    if (!card) return;
    const draft = state.draft, value = key => String(draft[key] || '').trim();
    const parts = [annualNode('figcaption', 'clients-preview-label', 'Preview')];
    if (!draft.show) parts.push(annualNode('p', 'clients-preview-off', 'Clients won’t see your details.'));
    else {
      const name = annualNode('p', 'clients-preview-name' + (value('display_name') ? '' : ' clients-preview-empty'), value('display_name') || 'Your name');
      parts.push(name);
      if (value('agency')) parts.push(annualNode('p', 'clients-preview-agency', value('agency')));
      const buttons = annualNode('p', 'clients-preview-actions');
      if (value('phone')) buttons.append(annualNode('span', 'clients-preview-button clients-preview-primary', 'Call'));
      if (value('email')) buttons.append(annualNode('span', 'clients-preview-button', 'Email'));
      if (buttons.children.length) parts.push(buttons);
    }
    card.dataset.shown = draft.show ? 'true' : 'false';
    card.replaceChildren(...parts);
  }
  // Each field's problem beside it, in words, with aria-invalid and aria-describedby.
  function clientsPaint(state, problems) {
    state.problems = problems;
    for (const { key } of CLIENTS_FIELDS) {
      const input = state.refs.inputs[key], error = state.refs.errors[key];
      if (!input || !error) continue;
      // "Add a phone number or an email address" belongs to both, said once under Phone.
      const shared = key === 'email' && !problems.email && problems.phone === CLIENTS_WORDS.reach;
      const text = problems[key] || '';
      error.textContent = text; error.hidden = !text;
      if (text || shared) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      const described = [state.refs.hints[key]?.id, text ? error.id : shared ? state.refs.errors.phone.id : ''].filter(Boolean).join(' ');
      if (described) input.setAttribute('aria-describedby', described); else input.removeAttribute('aria-describedby');
    }
  }
  function clientsSaid(state, text, announce = false) {
    if (state.refs.said) { state.refs.said.textContent = text; state.refs.said.hidden = !text; }
    if (announce && text) setStatus(text);
  }
  function clientsFirstProblem(state) {
    const key = CLIENTS_FIELDS.map(field => field.key).find(name => state.problems?.[name]);
    if (key) state.refs.inputs[key]?.focus?.();
  }
  function clientsDraw(state, notice = '') {
    clientsEl.hidden = false; clientsEl.setAttribute('aria-busy', 'false');
    const refs = { inputs: {}, errors: {}, hints: {} };
    state.refs = refs;
    const lead = annualNode('p', 'annual-lead clients-lead', 'Your name and how to reach you, on every walkthrough you share. Only what you enter here is shown.');
    const form = annualNode('form', 'veylet-form clients-form'); form.noValidate = true; form.setAttribute('novalidate', '');
    const toggle = annualNode('label', 'clients-show');
    const show = annualNode('input'); show.type = 'checkbox'; show.name = 'show_on_shared'; show.id = 'account-contact-show'; show.checked = state.draft.show;
    show.disabled = state.readOnly;
    toggle.append(show, annualNode('span', 'clients-show-text', 'Show on shared walkthroughs'));
    form.append(toggle);
    for (const field of CLIENTS_FIELDS) {
      const label = annualNode('label', 'clients-field');
      const input = annualNode('input');
      input.id = 'account-contact-' + field.key.replace('_', '-'); input.name = field.key; input.type = field.type;
      input.autocomplete = field.autocomplete; input.setAttribute('autocomplete', field.autocomplete); input.maxLength = field.max;
      if (field.inputMode) input.inputMode = field.inputMode;
      if (field.type === 'email') { input.autocapitalize = 'off'; input.spellcheck = false; }
      input.value = state.draft[field.key] || ''; input.readOnly = state.readOnly;
      const error = annualNode('small', 'field-problem'); error.id = input.id + '-error'; error.hidden = true;
      label.append(annualNode('span', 'clients-field-label', field.label), input, error);
      refs.inputs[field.key] = input; refs.errors[field.key] = error;
      form.append(label);
    }
    const preview = annualNode('figure', 'clients-preview'); preview.setAttribute('aria-label', 'Preview of the card clients see');
    refs.preview = preview;
    form.append(preview);
    const said = annualNode('p', 'clients-said'); said.hidden = true; refs.said = said;
    const parts = [lead, form];
    if (state.readOnly) {
      form.append(said);
      parts.push(annualNode('p', 'annual-note clients-ask', CLIENTS_ASK));
    } else {
      const save = annualNode('button', 'tour-action tour-action-primary', 'Save'); save.type = 'submit'; save.dataset.control = 'contact-save';
      refs.save = save;
      form.append(annualRow(save), said);
    }
    // Typing redraws the card at once; after a first problem, every change is checked again.
    const sync = () => {
      state.draft.show = show.checked;
      for (const { key } of CLIENTS_FIELDS) state.draft[key] = refs.inputs[key].value;
      state.dirty = true;
      if (refs.said && !state.busy) clientsSaid(state, '');
      clientsPreview(state);
      if (state.attempted) clientsPaint(state, clientsProblems(state.draft));
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.addEventListener('submit', event => { event?.preventDefault?.(); void clientsSave(state); });
    clientsBody.replaceChildren(...parts);
    clientsPreview(state);
    if (state.attempted || state.problems) clientsPaint(state, state.problems || clientsProblems(state.draft));
    clientsSaid(state, notice);
  }
  async function clientsSave(state) {
    if (state !== clients || state.busy || state.readOnly) return;
    state.attempted = true;
    const problems = clientsProblems(state.draft);
    clientsPaint(state, problems);
    if (Object.keys(problems).length) { clientsSaid(state, ''); clientsFirstProblem(state); return; }
    state.busy = true;
    if (state.refs.save) state.refs.save.disabled = true;
    clientsSaid(state, 'Saving…');
    const value = key => String(state.draft[key] || '').trim() || null;
    const sent = { show: state.draft.show === true, display_name: value('display_name'), agency: value('agency'), phone: value('phone'), email: value('email') };
    const reply = await settled(Promise.resolve().then(() => state.supabase.rpc('set_workspace_public_contact', { p_workspace_id: state.workspaceID,
      p_show: sent.show, p_display_name: sent.display_name, p_agency: sent.agency, p_phone: sent.phone, p_email: sent.email })));
    if (state !== clients) return;
    state.busy = false;
    if (state.refs.save) state.refs.save.disabled = false;
    if (sessionGone(reply)) {
      // Signing in again on this page brings back what was typed.
      clientsKept = { userId: currentUserId, workspaceID: state.workspaceID, draft: { ...state.draft } };
      showSignedOut('Your sign-in has expired, so your contact details weren’t saved. Sign in again to save them.');
      return;
    }
    const error = reply.value?.error || reply.error || null;
    const words = String(error?.message || '').toLowerCase();
    if (words.includes('contact permission required')) {
      state.readOnly = true;
      clientsDraw(state, 'Your details weren’t saved.');
      setStatus('Your details weren’t saved. ' + CLIENTS_ASK);
      return;
    }
    const refusal = CLIENTS_REFUSALS.find(([phrase]) => words.includes(phrase));
    if (refusal) {
      const named = refusal[1] ? Object.fromEntries(Object.entries(refusal[1]).map(([key, word]) => [key, CLIENTS_WORDS[word]])) : clientsProblems({ ...state.draft, show: true });
      clientsPaint(state, named); clientsSaid(state, 'Your details weren’t saved.', true); clientsFirstProblem(state);
      return;
    }
    const row = failed(reply) ? undefined : firstRow(reply.value?.data);
    const saved = row === undefined ? null : clientsRow(row);
    if (failed(reply) || !saved) {
      clientsSaid(state, networkFailed(reply) || offlineNow() ? 'You’re offline, so your details weren’t saved. Save again when you’re back online.'
        : 'Your details weren’t saved. Try again.', true);
      return;
    }
    state.saved = saved; state.draft = { ...saved }; state.dirty = false; state.attempted = false;
    // The server's trimmed values go back into the fields; focus stays on Save.
    for (const { key } of CLIENTS_FIELDS) if (state.refs.inputs[key]) state.refs.inputs[key].value = saved[key];
    clientsPaint(state, {}); clientsPreview(state);
    clientsSaid(state, saved.show ? CLIENTS_SAVED_SHOWN : CLIENTS_SAVED_HIDDEN, true);
  }
  // `force` re-reads even while the section is in use (Try again).
  async function clientsRender(supabase, ticket, workspaceID, role, force = false) {
    if (!clientsEl || !clientsBody) return;
    const same = clients && clients.workspaceID === workspaceID;
    // Unsaved typing, or a person inside the form, is never read over.
    if (!force && same && (clients.dirty || clients.busy || clientsEl.contains?.(document.activeElement))) { clients.supabase = supabase; clients.role = role; return; }
    const version = ++clientsVersion;
    if (!same) clientsSkeleton();
    const reply = await settled(Promise.resolve().then(() => supabase.rpc('get_workspace_public_contact', { p_workspace_id: workspaceID })));
    if (version !== clientsVersion || ticket !== deskVersion || !currentUserId) return;
    clientsEl.setAttribute('aria-busy', 'false');
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to see what your clients see.'); return; }
    const error = reply.value?.error || reply.error || null;
    // Before the backend has the function there is nothing to set; that is not an outage.
    if (error && (String(error.code || '') === 'PGRST202' || /could not find the function/i.test(String(error.message || '')))) { clientsHide(); return; }
    const row = failed(reply) ? null : firstRow(reply.value?.data);
    const saved = failed(reply) ? null : clientsRow(row);
    if (!saved) { clientsProblem(supabase, workspaceID, role, networkFailed(reply) || offlineNow()); return; }
    // Owners and reviewers change it (set_workspace_public_contact); anyone else reads it.
    const kept = clientsKept && clientsKept.userId === currentUserId && clientsKept.workspaceID === workspaceID ? clientsKept.draft : null;
    clientsKept = null;
    const state = { supabase, workspaceID, role, saved, draft: { ...(kept || saved) }, dirty: Boolean(kept), attempted: false, busy: false,
      readOnly: !['owner', 'reviewer'].includes(role), problems: null, refs: null };
    clients = state;
    clientsDraw(state, kept ? 'Your details weren’t saved. Check them and press Save.' : '');
  }

  /* ---- Team: invite a teammate ---------------------------------------------
   * The sibling repository's docs/launch-readiness-plan-20260925.md §3, onboarding
   * item 3 (one trial per office, every agent invited). The release-2 drafts (not
   * released) add invite_to_workspace(p_workspace_id, p_email, p_role) → { invite_id,
   * invite_url, expires_at } for the owner only (reviewer or operator),
   * list_workspace_invites, revoke_workspace_invite and accept_workspace_invite (the
   * /join page). No email is sent: the owner copies or shares the link. Anyone else
   * reads the team and may leave it. list_workspace_members (the same draft) lists the
   * office's members, owners first, by the name each chose ("Teammate" without one; nobody's
   * email): the owner removes (remove_workspace_member) or hands over to
   * (transfer_workspace_ownership) another active member who is not an owner, and a teammate
   * leaves (leave_workspace) from their own row. Invites stay a list of their own, for the owner.
   * The section shows while either list function exists; a backend without one (PGRST202)
   * leaves its part out, and a press answered PGRST202 takes its control away. Only the desk
   * has the section; the app has its own.
   */
  const teamEl = document.getElementById('account-team');
  const teamBody = document.getElementById('account-team-body');
  const TEAM_ROLES = Object.freeze([['reviewer', 'Reviewer', 'Can review and share.'], ['operator', 'Operator', 'Can capture and send.']]);
  const TEAM_ROLE_NAMES = Object.freeze({ reviewer: 'Reviewer', operator: 'Operator' });
  const TEAM_STATUS = Object.freeze({ pending: 'Pending', accepted: 'Accepted', revoked: 'Revoked', expired: 'Expired' });
  const TEAM_WORDS = Object.freeze({
    invite: 'Invite a teammate',
    email: 'Email',
    role: 'What they can do',
    noEmail: 'No email is sent. Copy the link and send it to them yourself.',
    create: 'Create invite link',
    creating: 'Creating the invite link…',
    badEmail: 'Enter an email address like name@agency.com.au.',
    noRole: 'Choose what they can do.',
    ownerOnly: 'Only the workspace owner can invite teammates.',
    notCreated: 'The invite wasn’t created. Try again.',
    unconfirmed: 'The invite wasn’t confirmed. Check the invites below before trying again.',
    offline: 'You’re offline. Nothing was created.',
    invites: 'Invites',
    none: 'No invites yet.',
    teammates: 'Teammates',
    teammate: 'Teammate',
    invitedStatus: 'Invited',
    peopleFailed: 'Teammates couldn’t be loaded. Try again.',
    peopleOffline: 'You’re offline. Your teammates load when you’re back online.',
    revoke: 'Revoke',
    confirmRevoke: 'Confirm: revoke invite',
    keep: 'Keep it',
    revokeWarn: 'The link stops working. You can invite them again later. Confirm to continue.',
    revoked: 'Invite revoked. The link no longer works.',
    notRevoked: 'The invite wasn’t revoked. Try again.',
    revokeOffline: 'You’re offline. The invite wasn’t revoked.',
    kept: 'Invite left unchanged.',
    readFailed: 'Invites couldn’t be loaded. Try again.',
    readOffline: 'You’re offline. Your invites load when you’re back online.',
    copied: 'Invite link copied. Send it to them yourself.',
    tooManyPending: 'You have 20 invites waiting. Revoke one first.',
    tooManyToday: 'You’ve made 50 invites today. Try again tomorrow.',
    remove: 'Remove',
    confirmRemove: 'Confirm: remove',
    removeWarn: 'They lose access to this office’s walkthroughs. Shared walkthroughs they captured stop working for clients. Confirm to continue.',
    keepThem: 'Keep them',
    keptThem: 'They stay in this office.',
    notRemoved: 'They weren’t removed. Try again.',
    removeOffline: 'You’re offline. They weren’t removed.',
    more: 'More',
    makeOwner: 'Make owner',
    confirmOwner: 'Confirm: make owner',
    ownerWarn: 'You become a reviewer. Only the owner can invite or remove teammates. Confirm to continue.',
    keepOwnership: 'Keep ownership',
    keptOwnership: 'You’re still the owner.',
    notTransferred: 'Ownership didn’t change. Try again.',
    ownerOffline: 'You’re offline. Ownership didn’t change.',
    leave: 'Leave this office',
    confirmLeave: 'Confirm: leave this office',
    leaveWarn: 'You lose access to its walkthroughs. Shared walkthroughs you captured stop working for clients. The owner can invite you again. Confirm to continue.',
    ownerCantLeave: 'Owners can’t leave. Make someone else the owner first.',
    planFirst: 'Cancel or move the plan first, then transfer ownership.',
    stay: 'Stay',
    stayed: 'You’re still in this office.',
    left: 'You left this office.',
    notLeft: 'You’re still in this office. Try again.',
    leaveOffline: 'You’re offline. You’re still in this office.',
  });
  let team = null, teamVersion = 0;
  const TEAM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // remove_workspace_member, transfer_workspace_ownership and leave_workspace, until a press says the backend lacks one.
  let teamRemoveAvailable = true, teamTransferAvailable = true, teamLeaveAvailable = true;

  function teamHide() {
    teamVersion += 1; team = null;
    if (!teamEl) return;
    teamEl.hidden = true; teamEl.setAttribute('aria-busy', 'false');
    teamBody?.replaceChildren();
  }
  // The invites, keeping only rows the draft describes; anything but a list is no answer.
  function teamRows(data) {
    if (!Array.isArray(data)) return null;
    return data.filter(row => row && typeof row === 'object' && typeof row.invite_id === 'string' && typeof row.email === 'string'
      && TEAM_ROLE_NAMES[row.role] && TEAM_STATUS[row.status]);
  }
  function teamRoleWords(role) {
    return role === 'operator' ? 'an operator, who can capture and send' : 'a reviewer, who can review and share';
  }
  // `force` reads again even while the section is in use (after a press here).
  // The members, keeping only rows the draft describes (list_workspace_members: active and
  // invited memberships, owners first); anything but a list is no answer.
  const TEAM_MEMBER_ROLES = Object.freeze({ owner: 'Owner', reviewer: 'Reviewer', operator: 'Operator' });
  function teamMembers(data) {
    if (!Array.isArray(data)) return null;
    return data.filter(row => row && typeof row === 'object' && typeof row.user_id === 'string' && TEAM_UUID.test(row.user_id)
      && TEAM_MEMBER_ROLES[row.role] && ['active', 'invited'].includes(row.status));
  }
  // The name a member chose (profiles.display_name), or "Teammate": nobody's email is shown.
  function teamName(member) {
    const name = typeof member?.display_name === 'string' ? member.display_name.trim() : '';
    return name || TEAM_WORDS.teammate;
  }
  // `force` reads again even while the section is in use (after a press here).
  async function teamRender(supabase, ticket, workspaceID, role, force = false) {
    if (!teamEl || !teamBody) return;
    const same = team && team.workspaceID === workspaceID;
    // Typing, a press on its way, or a person inside the section, is never read over.
    if (!force && same && (team.busy || team.dirty || teamEl.contains?.(document.activeElement))) { team.supabase = supabase; team.role = role; return; }
    const version = ++teamVersion;
    const ask = name => settled(Promise.resolve().then(() => supabase.rpc(name, { p_workspace_id: workspaceID })));
    const [invites, members] = await Promise.all([ask('list_workspace_invites'), ask('list_workspace_members')]);
    if (version !== teamVersion || ticket !== deskVersion || !currentUserId) return;
    if (sessionGone(invites) || sessionGone(members)) { showSignedOut('Your sign-in has expired. Sign in again to see your team.'); return; }
    const rows = failed(invites) ? null : teamRows(invites.value?.data);
    const people = failed(members) ? null : teamMembers(members.value?.data);
    // A missing function, or an answer the draft does not describe, is not a list to show.
    const invitesOn = !missingFunction(invites) && (failed(invites) || Boolean(rows));
    const membersOn = !missingFunction(members) && (failed(members) || Boolean(people));
    if (!invitesOn && !membersOn) { teamHide(); return; }
    const state = same ? team : { workspaceID, result: null, dirty: false, busy: false, draft: { email: '', role: '' }, notice: '' };
    Object.assign(state, { supabase, role, owner: role === 'owner', invitesOn, membersOn, rows, people,
      offline: networkFailed(invites) || networkFailed(members) || offlineNow() });
    team = state;
    teamDraw(state);
  }
  function teamRetry(state) {
    const again = button('Try again', () => { void teamRender(state.supabase, deskVersion, state.workspaceID, state.role, true); });
    again.dataset.control = 'team-retry';
    return annualRow(again);
  }
  function teamDraw(state) {
    teamEl.hidden = false; teamEl.setAttribute('aria-busy', 'false');
    const parts = [];
    const refs = {};
    if (!state.owner) {
      // A teammate reads their own role, who is in the office, and may leave it from their own row.
      const word = state.role === 'operator' ? 'an operator' : state.role === 'reviewer' ? 'a reviewer' : 'a member';
      parts.push(annualNode('p', 'annual-lead team-lead', 'You’re ' + word + ' in this workspace. Only the owner can invite teammates.'));
    } else if (state.invitesOn) {
      parts.push(teamForm(state, refs));
      if (state.result) parts.push(teamResult(state, refs));
    }
    if (state.notice) { parts.push(annualNode('p', 'team-said', state.notice)); state.notice = ''; }
    if (state.membersOn) {
      parts.push(annualNode('h3', 'team-subhead', TEAM_WORDS.teammates));
      if (!state.people) parts.push(annualNode('p', 'annual-note', state.offline ? TEAM_WORDS.peopleOffline : TEAM_WORDS.peopleFailed), teamRetry(state));
      else parts.push(teamMemberList(state, state.people));
    }
    if (!state.owner) {
      // Without the members list: who joined by invite, and leaving on its own.
      if (!state.membersOn) {
        const joined = (state.rows || []).filter(row => row.status === 'accepted');
        if (joined.length) parts.push(annualNode('h3', 'team-subhead', TEAM_WORDS.teammates), teamList(state, joined, false));
      }
      if (!state.people?.some(member => member.is_self === true)) {
        const leaving = annualNode('div', 'team-leave');
        teamLeave(state, leaving);
        if (leaving.children.length) parts.push(leaving);
      }
      teamBody.replaceChildren(...parts);
      return;
    }
    if (state.invitesOn) {
      parts.push(annualNode('h3', 'team-subhead', TEAM_WORDS.invites));
      if (!state.rows) parts.push(annualNode('p', 'annual-note', state.offline ? TEAM_WORDS.readOffline : TEAM_WORDS.readFailed), teamRetry(state));
      else if (!state.rows.length) parts.push(annualNode('p', 'annual-note team-none', TEAM_WORDS.none));
      else parts.push(teamList(state, state.rows, true));
    }
    teamBody.replaceChildren(...parts);
    if (state.focusResult && refs.result) { state.focusResult = false; refs.result.focus?.({ preventScroll: true }); refs.result.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); }
  }
  // Everyone in the office: the owner may remove or hand over to another active member who is
  // not an owner; a teammate may leave from their own row.
  function teamMemberList(state, people) {
    const list = annualNode('ul', 'team-invites team-people');
    for (const member of people) {
      const item = annualNode('li', 'team-invite team-person'); item.dataset.member = member.user_id;
      const name = teamName(member);
      const title = annualNode('p', 'team-invite-email', name);
      if (member.is_self === true) title.append(annualNode('span', 'team-you', ' (you)'));
      const meta = annualNode('p', 'team-invite-meta');
      meta.append(annualNode('span', 'team-invite-role', TEAM_MEMBER_ROLES[member.role]));
      if (member.status === 'invited') meta.append(pill(TEAM_WORDS.invitedStatus, 'busy'));
      const joined = member.status === 'active' ? window.VeyletSharing?.hostingDate?.(member.joined_at) || '' : '';
      if (joined) meta.append(annualNode('span', 'team-invite-when', 'Joined ' + joined));
      item.append(title, meta);
      const other = member.is_self !== true;
      if (state.owner && other && member.role !== 'owner' && member.status === 'active') teamManageMember(state, member, name, item);
      if (!state.owner && !other) teamLeave(state, item);
      list.append(item);
    }
    return list;
  }
  function teamForm(state, refs) {
    const form = annualNode('form', 'veylet-form team-form'); form.noValidate = true; form.setAttribute('novalidate', '');
    const emailLabel = annualNode('label', 'clients-field team-field');
    const email = annualNode('input'); email.type = 'email'; email.id = 'account-team-email'; email.name = 'email';
    // Somebody else's address: never the browser's saved one.
    email.autocomplete = 'off'; email.setAttribute('autocomplete', 'off'); email.inputMode = 'email';
    email.autocapitalize = 'off'; email.spellcheck = false; email.maxLength = 254; email.value = state.draft.email;
    email.dataset.control = 'team-email';
    const emailError = annualNode('small', 'field-problem'); emailError.id = 'account-team-email-error'; emailError.hidden = true;
    emailLabel.append(annualNode('span', 'clients-field-label', TEAM_WORDS.email), email, emailError);
    const group = annualNode('fieldset', 'choice-group team-roles');
    group.append(annualNode('legend', 'team-legend', TEAM_WORDS.role));
    const roles = [];
    for (const [value, name, explanation] of TEAM_ROLES) {
      const choice = annualNode('label', 'choice team-role');
      const input = annualNode('input'); input.type = 'radio'; input.name = 'team-role'; input.value = value;
      input.checked = state.draft.role === value; input.dataset.control = 'team-role-' + value;
      const text = annualNode('span');
      text.append(annualNode('strong', '', name), annualNode('small', '', explanation));
      choice.append(input, text); group.append(choice); roles.push(input);
    }
    const roleError = annualNode('small', 'field-problem'); roleError.id = 'account-team-role-error'; roleError.hidden = true;
    group.append(roleError);
    const create = annualNode('button', 'tour-action tour-action-primary', TEAM_WORDS.create); create.type = 'submit'; create.dataset.control = 'team-create';
    const said = annualNode('p', 'team-said'); said.hidden = true;
    form.append(annualNode('h3', 'team-subhead team-invite-title', TEAM_WORDS.invite), emailLabel, group,
      annualNode('p', 'annual-note team-note', TEAM_WORDS.noEmail), annualRow(create), said);
    Object.assign(refs, { email, emailError, roles, roleError, create, said });
    const sync = () => {
      state.draft = { email: email.value, role: roles.find(input => input.checked)?.value || '' };
      state.dirty = Boolean(state.draft.email.trim() || state.draft.role);
      if (state.attempted) teamPaint(refs, teamProblems(state.draft));
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);
    form.addEventListener('submit', event => { event?.preventDefault?.(); sync(); void teamInvite(state, refs); });
    return form;
  }
  function teamProblems(draft) {
    const problems = {};
    const email = String(draft.email || '').trim();
    if (!email || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.email = TEAM_WORDS.badEmail;
    if (!TEAM_ROLE_NAMES[draft.role]) problems.role = TEAM_WORDS.noRole;
    return problems;
  }
  function teamPaint(refs, problems) {
    refs.emailError.textContent = problems.email || ''; refs.emailError.hidden = !problems.email;
    if (problems.email) { refs.email.setAttribute('aria-invalid', 'true'); refs.email.setAttribute('aria-describedby', refs.emailError.id); }
    else { refs.email.removeAttribute('aria-invalid'); refs.email.removeAttribute('aria-describedby'); }
    refs.roleError.textContent = problems.role || ''; refs.roleError.hidden = !problems.role;
  }
  function teamSay(refs, text, announce = true) {
    refs.said.textContent = text; refs.said.hidden = !text;
    if (announce && text) setStatus(text);
  }
  async function teamInvite(state, refs) {
    if (state.busy || state !== team) return;
    state.attempted = true;
    const problems = teamProblems(state.draft);
    teamPaint(refs, problems);
    if (problems.email) { refs.email.focus?.(); return; }
    if (problems.role) { refs.roles[0]?.focus?.(); return; }
    const email = state.draft.email.trim(), role = state.draft.role;
    state.busy = true; refs.create.disabled = true;
    teamSay(refs, TEAM_WORDS.creating, false);
    const reply = await settled(Promise.resolve().then(() => state.supabase.rpc('invite_to_workspace', { p_workspace_id: state.workspaceID, p_email: email, p_role: role })));
    state.busy = false; refs.create.disabled = false;
    if (state !== team) return;
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired, so no invite was created. Sign in again to invite them.'); return; }
    if (missingFunction(reply)) { teamHide(); return; }
    if (failed(reply)) {
      // The draft's refusals: a field's own problem goes beside the field.
      const words = String((reply.value?.error || reply.error || {}).message || '').toLowerCase();
      if (words.includes('valid email address')) { teamPaint(refs, { email: TEAM_WORDS.badEmail }); teamSay(refs, ''); refs.email.focus?.(); return; }
      if (words.includes('role is reviewer or operator')) { teamPaint(refs, { role: TEAM_WORDS.noRole }); teamSay(refs, ''); refs.roles[0]?.focus?.(); return; }
      teamSay(refs, /owner|permission/.test(words) ? TEAM_WORDS.ownerOnly : words.includes('too many pending invites') ? TEAM_WORDS.tooManyPending
        : words.includes('too many invites today') ? TEAM_WORDS.tooManyToday : networkFailed(reply) || offlineNow() ? TEAM_WORDS.offline : TEAM_WORDS.notCreated);
      return;
    }
    const row = firstRow(reply.value?.data);
    const url = typeof row?.invite_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(row.invite_url) ? row.invite_url : '';
    if (!url) { state.notice = TEAM_WORDS.unconfirmed; setStatus(TEAM_WORDS.unconfirmed); await teamRender(state.supabase, deskVersion, state.workspaceID, state.role, true); return; }
    state.result = { email, role, url, expires: typeof row.expires_at === 'string' ? row.expires_at : null, inviteId: row.invite_id || null };
    state.draft = { email: '', role: '' }; state.dirty = false; state.attempted = false; state.focusResult = true;
    setStatus('Invite link created for ' + email + '. Copy it and send it to them.');
    await teamRender(state.supabase, deskVersion, state.workspaceID, state.role, true);
  }
  // The link just made: the one thing to copy or share, with when it stops working.
  function teamResult(state, refs) {
    const { email, role, url, expires } = state.result;
    const box = annualNode('div', 'team-result'); box.tabIndex = -1; box.setAttribute('aria-label', 'Invite link for ' + email);
    refs.result = box;
    const link = copyField('Invite link', 'input', url);
    link.field.dataset.control = 'team-link';
    const said = annualNode('p', 'team-said'); said.hidden = true;
    const say = text => { said.textContent = text; said.hidden = !text; if (text) setStatus(text); };
    const copy = async () => {
      const share = window.VeyletSharing;
      if (share?.copy) { await share.copy(url, link.field, statusEl, TEAM_WORDS.copied); say(statusEl?.textContent || TEAM_WORDS.copied); }
      else { link.field.focus?.(); link.field.select?.(); say('Select and copy the link above.'); }
    };
    const copyLink = button('Copy link', copy); copyLink.dataset.control = 'team-copy';
    const row = annualRow();
    const device = typeof navigator !== 'undefined' ? navigator : null;
    let sheet = false;
    try { sheet = typeof device?.share === 'function' && (typeof device.canShare !== 'function' || device.canShare({ url }) !== false); } catch { sheet = false; }
    if (sheet) {
      const send = button('Share', async () => {
        try { await device.share({ title: 'Your Veylet invite', url }); }
        catch (error) { if (error?.name !== 'AbortError') await copy(); }
      });
      send.className = 'tour-action tour-action-primary'; send.dataset.control = 'team-share';
      row.append(send, copyLink);
    } else { copyLink.className = 'tour-action tour-action-primary'; row.append(copyLink); }
    const date = window.VeyletSharing?.hostingDate?.(expires) || '';
    box.append(link.label, row, said,
      annualNode('p', 'annual-note team-expiry', (date ? 'It expires on ' + date + '. ' : '') + 'Send it only to ' + email + '.'),
      annualNode('p', 'annual-note', 'They join as ' + teamRoleWords(role) + '.'));
    return box;
  }
  function teamList(state, rows, manage) {
    const list = annualNode('ul', 'team-invites');
    for (const row of rows) {
      const item = annualNode('li', 'team-invite'); item.dataset.invite = row.invite_id;
      const meta = annualNode('p', 'team-invite-meta');
      meta.append(pill(TEAM_STATUS[row.status], row.status === 'accepted' ? 'good' : row.status === 'pending' ? 'busy' : ''),
        annualNode('span', 'team-invite-role', TEAM_ROLE_NAMES[row.role]));
      const until = row.status === 'pending' ? window.VeyletSharing?.hostingDate?.(row.expires_at) || '' : '';
      if (until) meta.append(annualNode('span', 'team-invite-when', 'Expires ' + until));
      item.append(annualNode('p', 'team-invite-email', row.email), meta);
      if (manage && row.status === 'pending') teamRevoke(state, row, item);
      list.append(item);
    }
    return list;
  }
  /*
   * One press confirmed in place, as turning off sharing is: the first press arms it and
   * says what happens, a second press does it, the other button undoes the first press.
   * `run(say, reset)` sends the one call; a missing function (PGRST202) takes the
   * control away without a word.
   */
  function teamConfirmed(parent, { label, confirm, warn, keep: keepLabel, kept, control, onMissing, run }) {
    let armed = false;
    const said = annualNode('p', 'team-said'); said.hidden = true;
    const say = text => { said.textContent = text; said.hidden = !text; if (text) setStatus(text); };
    const reset = () => { armed = false; press.textContent = label; press.dataset.armed = 'false'; keep.hidden = true; press.disabled = false; };
    const press = button(label, async () => {
      if (press.disabled) return;
      if (!armed) { armed = true; press.textContent = confirm; press.dataset.armed = 'true'; keep.hidden = false; say(warn); return; }
      press.disabled = true; keep.hidden = true;
      const outcome = await run(say, reset);
      if (outcome === 'missing') { row.hidden = true; said.hidden = true; onMissing?.(); }
    });
    press.classList.add('tour-action-danger'); press.dataset.control = control;
    const keep = button(keepLabel, () => { reset(); say(kept); });
    keep.hidden = true; keep.dataset.control = control + '-keep';
    const row = annualRow(press, keep);
    parent.append(row, said);
    return { press, row, said };
  }
  // Sends one team call for a confirmed press; answers 'done', 'missing' or 'failed' (already
  // said). `words.refusals` maps the draft's own refusal words to what to say instead; `words.answer`
  // receives a successful call's answer.
  async function teamCall(state, name, args, say, reset, words) {
    state.busy = true;
    const reply = await settled(Promise.resolve().then(() => state.supabase.rpc(name, args)));
    state.busy = false;
    if (state !== team) return 'failed';
    if (sessionGone(reply)) { showSignedOut(words.expired); return 'failed'; }
    if (missingFunction(reply)) return 'missing';
    if (failed(reply)) {
      const text = String((reply.value?.error || reply.error || {}).message || '').toLowerCase();
      const refusal = (words.refusals || []).find(([phrase]) => text.includes(phrase));
      reset(); say(refusal ? refusal[1] : networkFailed(reply) || offlineNow() ? words.offline : words.failed);
      return 'failed';
    }
    words.answer?.(firstRow(reply.value?.data));
    return 'done';
  }
  // remove_workspace_member and leave_workspace answer how many live links stopped (the
  // uploader is no longer a member): said after the fact, since nothing can count them before.
  function teamLinksStopped(answer, who) {
    const count = Number.isInteger(answer?.shared_links_stopped) && answer.shared_links_stopped > 0 ? answer.shared_links_stopped : 0;
    return count ? ' ' + count + ' shared walkthrough' + (count === 1 ? '' : 's') + ' ' + who + ' captured stopped working for clients.' : '';
  }
  // Revoking an invite: read back from the list.
  function teamRevoke(state, row, item) {
    teamConfirmed(item, { label: TEAM_WORDS.revoke, confirm: TEAM_WORDS.confirmRevoke, warn: 'Revoke the invite for ' + row.email + '? ' + TEAM_WORDS.revokeWarn,
      keep: TEAM_WORDS.keep, kept: TEAM_WORDS.kept, control: 'team-revoke',
      run: async (say, reset) => {
        const outcome = await teamCall(state, 'revoke_workspace_invite', { p_invite_id: row.invite_id }, say, reset,
          { expired: 'Your sign-in has expired. Sign in and check whether the invite was revoked.', offline: TEAM_WORDS.revokeOffline, failed: TEAM_WORDS.notRevoked });
        if (outcome !== 'done') return outcome;
        if (state.result?.inviteId === row.invite_id) state.result = null;
        state.notice = TEAM_WORDS.revoked; setStatus(TEAM_WORDS.revoked);
        await teamRender(state.supabase, deskVersion, state.workspaceID, state.role, true);
        return outcome;
      } });
  }
  // Another member: Remove, and Make owner behind More (remove_workspace_member and
  // transfer_workspace_ownership, the owner only; the old owner becomes a reviewer).
  function teamManageMember(state, person, name, item) {
    const member = person.user_id;
    if (teamRemoveAvailable) {
      teamConfirmed(item, { label: TEAM_WORDS.remove, confirm: TEAM_WORDS.confirmRemove, warn: 'Remove ' + name + '? ' + TEAM_WORDS.removeWarn,
        keep: TEAM_WORDS.keepThem, kept: TEAM_WORDS.keptThem, control: 'team-remove', onMissing: () => { teamRemoveAvailable = false; },
        run: async (say, reset) => {
          let answer = null;
          const outcome = await teamCall(state, 'remove_workspace_member', { p_workspace_id: state.workspaceID, p_user_id: member }, say, reset,
            { expired: 'Your sign-in has expired. Sign in and check whether they were removed.', offline: TEAM_WORDS.removeOffline, failed: TEAM_WORDS.notRemoved,
              answer: value => { answer = value; } });
          if (outcome !== 'done') return outcome;
          state.notice = 'Removed ' + name + '.' + teamLinksStopped(answer, 'they'); setStatus(state.notice);
          await teamRender(state.supabase, deskVersion, state.workspaceID, state.role, true);
          return outcome;
        } });
    }
    if (!teamTransferAvailable) return;
    const more = annualNode('details', 'account-details team-more');
    const summary = annualNode('summary', '', TEAM_WORDS.more); summary.setAttribute('aria-label', 'More for ' + name);
    more.append(summary); item.append(more);
    teamConfirmed(more, { label: TEAM_WORDS.makeOwner, confirm: TEAM_WORDS.confirmOwner, warn: 'Make ' + name + ' the owner? ' + TEAM_WORDS.ownerWarn,
      keep: TEAM_WORDS.keepOwnership, kept: TEAM_WORDS.keptOwnership, control: 'team-owner',
      onMissing: () => { teamTransferAvailable = false; more.hidden = true; },
      run: async (say, reset) => {
        const outcome = await teamCall(state, 'transfer_workspace_ownership', { p_workspace_id: state.workspaceID, p_new_owner: member }, say, reset,
          { expired: 'Your sign-in has expired. Sign in and check who owns this office.', offline: TEAM_WORDS.ownerOffline, failed: TEAM_WORDS.notTransferred,
            refusals: [['card or app store subscription', TEAM_WORDS.planFirst]] });
        if (outcome !== 'done') return outcome;
        // This account is a reviewer now: the whole desk reads its new role.
        state.notice = name + ' is now the owner.'; setStatus(state.notice);
        await loadDesk(state.supabase);
        return outcome;
      } });
  }
  // A teammate leaving the office (leave_workspace, anyone but the owner).
  function teamLeave(state, parent) {
    if (!teamLeaveAvailable) return;
    teamConfirmed(parent, { label: TEAM_WORDS.leave, confirm: TEAM_WORDS.confirmLeave, warn: TEAM_WORDS.leaveWarn,
      keep: TEAM_WORDS.stay, kept: TEAM_WORDS.stayed, control: 'team-leave', onMissing: () => { teamLeaveAvailable = false; },
      run: async (say, reset) => {
        let answer = null;
        const outcome = await teamCall(state, 'leave_workspace', { p_workspace_id: state.workspaceID }, say, reset,
          { expired: 'Your sign-in has expired. Sign in and check whether you left this office.', offline: TEAM_WORDS.leaveOffline, failed: TEAM_WORDS.notLeft,
            refusals: [['an owner stays', TEAM_WORDS.ownerCantLeave]], answer: value => { answer = value; } });
        if (outcome !== 'done') return outcome;
        setStatus(TEAM_WORDS.left + teamLinksStopped(answer, 'you'));
        await loadDesk(state.supabase);
        return outcome;
      } });
  }

  /* ---- Email preferences: tips and offers --------------------------------
   * The Spam Act consent of the sibling repository's docs/lifecycle-email.md and its
   * draft 20260926114000_lifecycle_email.sql (not yet released). get_email_preferences()
   * answers the recorded choice (tips_opt_in, false until the person ticks it) and the
   * exact current wording with its version; set_email_tips_preference(opt_in, source,
   * wording_version) records each change. This page never ticks the box: it shows the
   * recorded choice, and the label is the wording whose version is recorded. A backend
   * without the functions (PGRST202) shows no box and says nothing. Service emails are
   * not affected by the choice, and the note under the box says so.
   *
   * At sign-up the box sits on the sign-in form, unticked. Signed out, the current
   * wording can't be read, so it shows the first wording (tips-v1, which is never
   * edited) and that version is recorded. The tick is kept for the email it was given
   * with (memory, and this browser's storage as the address's SHA-256 so the email
   * link may open in another tab) for an hour, and recorded once sign-in completes:
   * source signup when the sign-in created or first confirmed the account, account
   * otherwise (the same page). One sign-in uses it up, whoever signs in.
   */
  const TIPS_FIRST = Object.freeze({ version: 'tips-v1', wording: 'Email me tips and offers from Veylet Studio. I can unsubscribe at any time.' });
  const TIPS_VERSION = /^tips-v[0-9]{1,3}$/;
  const TIPS_INTENT_KEY = 'veylet-tips-intent';
  const TIPS_INTENT_MS = 60 * 60 * 1000;
  const emailPanel = document.getElementById('account-email');
  const emailBox = document.getElementById('account-email-tips');
  const emailLabel = document.getElementById('account-email-tips-label');
  const emailStatus = document.getElementById('account-email-status');
  const signupTipsRow = document.getElementById('account-signup-tips-row');
  const signupTipsBox = document.getElementById('account-signup-tips');
  const signupTipsLabel = document.getElementById('account-signup-tips-label');
  let emailPrefs = null;
  let emailVersion = 0;
  let signupTipsProbe = null;
  let tipsIntent = null;

  /** The wording shown and its version, together; without both, the first wording. */
  function tipsWording(answer) {
    const version = String(answer?.current_wording_version || '');
    const wording = answer?.current_wording;
    return TIPS_VERSION.test(version) && typeof wording === 'string' && wording.trim() ? { version, wording } : TIPS_FIRST;
  }
  function emailSay(text) { if (emailStatus) emailStatus.textContent = text; }
  function emailHide() {
    emailVersion += 1; emailPrefs = null;
    if (emailPanel) emailPanel.hidden = true;
    if (emailBox) { emailBox.checked = false; emailBox.disabled = false; }
    emailSay('');
  }
  function emailPaint(state) {
    if (emailLabel) emailLabel.textContent = state.wording;
    if (emailBox) { emailBox.checked = state.optIn; emailBox.disabled = state.busy; }
    if (emailPanel) emailPanel.hidden = false;
  }
  async function emailDigest(address) {
    try {
      if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') return null;
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address)));
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }
  function tipsIntentForget() {
    tipsIntent = null;
    try { window.localStorage?.removeItem(TIPS_INTENT_KEY); } catch { /* nothing kept to clear */ }
  }
  /** After a sign-in email was sent: keep a tick for that email, or forget an earlier one. */
  async function tipsIntentKeep(email, at) {
    tipsIntentForget();
    if (!signupTipsBox?.checked || signupTipsRow?.hidden) return;
    const address = String(email || '').trim().toLowerCase();
    const intent = { email: address, version: TIPS_FIRST.version, at };
    tipsIntent = intent;
    const hash = await emailDigest(address);
    if (!hash || tipsIntent !== intent) return;
    try { window.localStorage?.setItem(TIPS_INTENT_KEY, JSON.stringify({ v: intent.version, at, h: hash })); } catch { /* this tab still has it */ }
  }
  /** The tick given for this email within the hour, if any. Taking it forgets it. */
  async function tipsIntentTake(email) {
    const address = String(email || '').trim().toLowerCase();
    const now = Date.now();
    let found = null;
    if (tipsIntent && tipsIntent.email === address && now - tipsIntent.at < TIPS_INTENT_MS) found = { version: tipsIntent.version, at: tipsIntent.at };
    if (!found) {
      let kept = null;
      try { kept = JSON.parse(window.localStorage?.getItem(TIPS_INTENT_KEY) || 'null'); } catch { kept = null; }
      if (kept && TIPS_VERSION.test(String(kept.v)) && Number.isFinite(kept.at) && now - kept.at < TIPS_INTENT_MS && kept.at <= now
        && typeof kept.h === 'string' && kept.h === await emailDigest(address)) found = { version: kept.v, at: kept.at };
    }
    tipsIntentForget();
    return found;
  }
  /*
   * Signed out, the box is offered only when the backend can record it. The function
   * refuses a signed-out caller ("sign in required", or no grant), which proves it
   * exists; PGRST202, a lost connection or no answer means no box.
   */
  function signupTipsOffer(client) {
    if (!signupTipsRow || APP_MODE) return;
    if (signupTipsLabel) signupTipsLabel.textContent = TIPS_FIRST.wording;
    signupTipsProbe = signupTipsProbe || settled(Promise.resolve().then(() => client.rpc('get_email_preferences')), 8000)
      .then(reply => !(reply.timedOut || missingFunction(reply) || networkFailed(reply)));
    void signupTipsProbe.then(present => { if (!currentUserId) signupTipsRow.hidden = !present; });
  }
  async function emailSave(state, optIn, source, version = state.version) {
    state.busy = true; emailPaint({ ...state, optIn });
    emailSay('Saving your choice…');
    const reply = await settled(Promise.resolve().then(() => state.client.rpc('set_email_tips_preference',
      { p_opt_in: optIn, p_source: source, p_wording_version: version })));
    state.busy = false;
    if (emailPrefs !== state || state.userId !== currentUserId) return;
    if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in again to check your email preferences.'); return; }
    if (missingFunction(reply)) { emailHide(); return; }
    const answer = failed(reply) ? null : firstRow(reply.value?.data);
    if (!answer || typeof answer.tips_opt_in !== 'boolean') {
      emailPaint(state);
      emailSay(reply.timedOut ? 'Your choice wasn’t confirmed. Reload the page to see what’s saved before trying again.'
        : networkFailed(reply) || offlineNow() ? 'You’re offline, so nothing changed. Try again when you’re back online.'
          : 'Your choice wasn’t saved, so nothing changed. Try again.');
      return;
    }
    state.optIn = answer.tips_opt_in;
    emailPaint(state);
    emailSay(state.optIn ? 'Saved. We’ll email you tips and offers.' : 'Saved. We won’t email you tips or offers.');
  }
  /** Read once per signed-in account; a failed or odd answer shows nothing and the next desk load asks again. */
  async function emailRender(client) {
    if (!emailPanel || !emailBox || APP_MODE || !currentUserId) return;
    if (emailPrefs && emailPrefs.userId === currentUserId) return;
    const userId = currentUserId, email = currentUserEmail, confirmed = currentUserConfirmedAt, version = ++emailVersion;
    const reply = await settled(Promise.resolve().then(() => client.rpc('get_email_preferences')));
    if (version !== emailVersion || userId !== currentUserId) return;
    if (missingFunction(reply)) { emailHide(); tipsIntentForget(); return; }
    const answer = failed(reply) ? null : firstRow(reply.value?.data);
    if (!answer || typeof answer.tips_opt_in !== 'boolean') { emailHide(); return; }
    const state = { userId, client, optIn: answer.tips_opt_in, busy: false, ...tipsWording(answer) };
    emailPrefs = state;
    emailPaint(state);
    const intent = await tipsIntentTake(email);
    if (!intent || state.optIn || emailPrefs !== state || state.busy) return;
    // Recorded with the version of the wording the sign-in form showed. A new account is one
    // this sign-in created or first confirmed (an invited account is created before it).
    const since = Date.parse(confirmed || '');
    await emailSave(state, true, Number.isFinite(since) && since >= intent.at - 5 * 60 * 1000 ? 'signup' : 'account', intent.version);
  }
  emailBox?.addEventListener('change', () => {
    const state = emailPrefs;
    if (!state || state.userId !== currentUserId || state.busy) { if (state) emailPaint(state); return; }
    const optIn = Boolean(emailBox.checked);
    if (optIn === state.optIn) return;
    void emailSave(state, optIn, 'account');
  });

  /* ---- Deleting your account -------------------------------------------
   * Asked for here or in the app, completed by the studio within 30 days. This
   * panel reports only what get_account_deletion returns: an unanswered check
   * is unavailable, never "nothing requested" and never "already going", so
   * nothing here can imply an account is safe or a deletion is under way. The
   * two writes are read back before their result is stated.
   */
  const DELETION_STATUSES = ['requested', 'processing', 'cancelled', 'completed'];
  // begin_account_deletion's refusal while an active or invited teammate remains (the backend
  // lane's draft 20260926131000_account_deletion_followups), word for word.
  const DELETION_TEAM_FIRST = 'Transfer ownership or remove your teammates first.';
  const DELETION_KEEP = 'Keep my account';
  const DELETION_CONFIRM = 'Your account, spaces and walkthroughs will be deleted within 30 days. Access and handoff links pause when removal starts. This cannot be undone.';
  let deletionBusy = false;

  function deletionShow(...parts) {
    if (!deletionPanel) return;
    deletionPanel.replaceChildren(...parts);
  }
  function deletionNote(text, className = 'contact-note') {
    const p = document.createElement('p'); p.className = className; p.textContent = text; return p;
  }
  function deletionRow(...controls) {
    const row = document.createElement('p'); row.className = 'tour-actions-row';
    row.append(...controls); return row;
  }
  /* A state this page could not read is not a state the account is in. */
  function deletionUnavailable(supabase, text) {
    deletionShow(deletionNote(text),
      deletionRow(button('Check again', () => { void renderDeletion(supabase, deskVersion); })));
  }
  // Deletion refused because this owner's office still has teammates: the way forward is Your team.
  function deletionTeamFirst(supabase) {
    setStatus(DELETION_TEAM_FIRST);
    const parts = [deletionNote(DELETION_TEAM_FIRST)];
    const controls = [];
    if (teamEl && !teamEl.hidden) {
      const open = document.createElement('a'); open.className = 'tour-action'; open.href = '#account-team'; open.textContent = 'Open Your team';
      open.dataset.control = 'deletion-team';
      open.addEventListener('click', () => { teamEl.tabIndex = -1; teamEl.focus?.({ preventScroll: true }); });
      controls.push(open);
    }
    controls.push(button(DELETION_KEEP, () => { setStatus('Your account is unchanged.'); deletionIdle(supabase); }));
    deletionShow(...parts, deletionRow(...controls));
  }
  function deletionIdle(supabase) {
    const start = button('Delete my account', () => deletionConfirm(supabase));
    start.classList.add('tour-action-danger');
    deletionShow(deletionRow(start));
  }
  function deletionConfirm(supabase) {
    const ticket = deskVersion;
    const field = document.createElement('div'); field.className = 'veylet-form deletion-reason';
    // The reason is a field under a consequence, not a continuation of it.
    // Spacing is set here because style.css is not this pass's to change.
    field.setAttribute('style', 'margin: 16px 0 18px');
    const label = document.createElement('label');
    const text = document.createElement('span'); text.textContent = 'Reason (optional)';
    const reason = document.createElement('textarea');
    reason.rows = 2; reason.maxLength = 400; reason.name = 'reason';
    label.append(text, reason); field.append(label);
    const remove = button('Delete my account', async () => {
      if (remove.disabled || deletionBusy) return;
      deletionBusy = true; remove.disabled = true; keep.disabled = true;
      setStatus('Requesting account deletion…');
      const given = String(reason.value || '').trim();
      const reply = await settled(supabase.rpc('request_account_deletion', given ? { p_reason: given } : {}));
      deletionBusy = false;
      if (ticket !== deskVersion) return;
      if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in and check whether the deletion was requested.'); return; }
      if (failed(reply)) {
        // An owner whose office still has teammates hands it over or removes them first. Only the
        // refusal that names that case says so ('shared ownership requires reviewed transfer' is one
        // message for many conditions and keeps the words below); files left under this account
        // after handing an office over are the server's own sentence, said as it is.
        const said = String((reply.value?.error || reply.error || {}).message || '').trim();
        const words = said.toLowerCase();
        if (words.includes(DELETION_TEAM_FIRST.toLowerCase().replace(/\.$/, ''))) { deletionTeamFirst(supabase); return; }
        if (words.includes('workspace you handed over')) {
          const sentence = said.charAt(0).toUpperCase() + said.slice(1) + (/[.!?]$/.test(said) ? '' : '.');
          setStatus(sentence); deletionUnavailable(supabase, sentence); return;
        }
        setStatus('The deletion request was not confirmed. Check again before asking a second time.');
        deletionUnavailable(supabase, 'The deletion request was not confirmed. Check again before asking a second time.');
        return;
      }
      setStatus('Deletion requested. We complete it within 30 days.');
      await renderDeletion(supabase, deskVersion);
    });
    remove.classList.add('tour-action-danger');
    remove.dataset.armed = 'true';
    const keep = button(DELETION_KEEP, () => { setStatus('Your account is unchanged.'); deletionIdle(supabase); });
    deletionShow(deletionNote(DELETION_CONFIRM), field, deletionRow(remove, keep));
  }
  function deletionRequested(supabase, when) {
    const ticket = deskVersion;
    const stop = button('Cancel deletion', async () => {
      if (stop.disabled || deletionBusy) return;
      deletionBusy = true; stop.disabled = true;
      setStatus('Cancelling the deletion request…');
      const reply = await settled(supabase.rpc('cancel_account_deletion'));
      deletionBusy = false;
      if (ticket !== deskVersion) return;
      if (sessionGone(reply)) { showSignedOut('Your sign-in has expired. Sign in and check whether the deletion was cancelled.'); return; }
      if (failed(reply)) {
        setStatus('The cancellation was not confirmed. Check again before retrying.');
        deletionUnavailable(supabase, 'The cancellation was not confirmed. Check again before retrying.');
        return;
      }
      setStatus('Deletion request cancelled.');
      await renderDeletion(supabase, deskVersion);
    });
    deletionShow(deletionNote('Deletion requested ' + when + '. Cancel before removal starts.'),
      deletionRow(stop));
  }
  async function renderDeletion(supabase, ticket) {
    if (!deletionPanel) return;
    deletionPanel.setAttribute('aria-busy', 'true');
    deletionShow(deletionNote('Checking whether a deletion has been requested…'));
    const result = await settled(supabase.rpc('get_account_deletion'));
    if (ticket !== deskVersion) return;
    deletionPanel.setAttribute('aria-busy', 'false');
    if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in again to check your deletion request.'); return; }
    if (failed(result)) {
      deletionUnavailable(supabase, 'Deletion status is unavailable, so this page cannot say whether one has been asked for. Nothing was requested or cancelled by checking.');
      return;
    }
    const row = firstRow(result.value?.data);
    // No row is an account with nothing requested. A row this page cannot read
    // is not one, so it may not become the offer to delete.
    if (row === null || row === undefined) { deletionIdle(supabase); return; }
    if (typeof row !== 'object' || !DELETION_STATUSES.includes(row.status)) {
      deletionUnavailable(supabase, 'Deletion status could not be read. Check again before asking for a deletion.');
      return;
    }
    if (row.status === 'processing') {
      deletionShow(deletionNote('Deletion is in progress. Account access is paused while Veylet completes removal. Contact Veylet support if you need an update.'));
      return;
    }
    if (row.status !== 'requested') { deletionIdle(supabase); return; }
    const when = planDate(row.requested_at);
    if (!when) {
      deletionUnavailable(supabase, 'A deletion has been requested, but its date could not be read. Check again, or ask Veylet support before anything else.');
      return;
    }
    deletionRequested(supabase, when);
  }

  /* ---- Render status on a space ------------------------------------------
   * Where a space's capture is between the phone and a walkthrough, in the words
   * of the render-status contract (property-3d-studio
   * docs/render-status-contract-20260925.md), which the app shows too. One answer per
   * workspace with a space on this desk: list_workspace_render_status (migration
   * 20260925110000_render_status.sql, not yet released): { active, spaces: [{
   * property_id, job }] }, each job with the customer's state as the server decides it
   * (uploading, waiting, rendering, ready_for_review, live, needs_recapture, retrying,
   * failed; an older backend's studio_check is the automatic quality gate, drawn as
   * Rendering, step 5 of 5, with no percentage or time it did not send), its queue
   * position and typical start, its
   * step of five, percentage and time left, whether its render has gone quiet for 3
   * minutes (stale), its attempt, the room and reason to recapture, its walkthrough
   * and its super fast due time. Every one of those is the server's: nothing here counts
   * down, fills in or guesses, and a value that did not arrive is left out. The
   * filled action belongs to whoever acts next, so it appears only when that is the
   * reader.
   * Live updates: capture_jobs is closed to members (no select grant, no policy and no
   * Realtime publication), so a Realtime subscription would hear nothing. While the
   * answer says a capture is active (uploading, queued or rendering) the desk reads it
   * again every 10 s, and stops when none is, the tab is hidden, or the read keeps
   * failing. A change of state or step is said once, in its own polite live region.
   * Before the backend has the function (PGRST202) the desk reads exactly as it did.
   */
  const renderStatusEl = document.getElementById('account-render-status');
  const renderLiveEl = document.getElementById('account-render-live');
  const RENDER_POLL_MS = 10000;
  const RENDER_POLL_TRIES = 3;
  const RENDER_ATTEMPTS = 2;
  const RENDER_STEPS = ['Preparing photos', 'Lining up camera positions', 'Building your 3D walkthrough', 'Packing it for phones', 'Checking quality'];
  // The server's state (capture_render_state) to what this page draws.
  // No person checks a walkthrough: an older answer's studio_check is step 5, Checking quality.
  const RENDER_SERVER_STATES = { uploading: 'uploading', waiting: 'waiting', rendering: 'rendering', studio_check: 'checking',
    ready_for_review: 'ready', live: 'live', needs_recapture: 'recapture', retrying: 'retrying', failed: 'failed' };
  const RENDER_TITLES = { uploading: 'Uploading', waiting: 'Waiting to render', rendering: 'Rendering',
    ready: 'Ready for your review', live: 'Live', recapture: 'Needs recapture', retrying: 'Retrying', failed: 'Failed',
    stale: 'Still working — checking in' };
  // Whose turn it is, beside the state: rendering is automatic; a failure is Veylet support's.
  const RENDER_TURNS = { uploading: 'Sending from your phone', waiting: 'Automatic', rendering: 'Automatic',
    ready: 'Your turn', recapture: 'Your turn', retrying: 'Automatic', failed: 'Veylet support', stale: 'Automatic' };
  // Active, when an answer does not say: the desk keeps reading while one of these is on it.
  const RENDER_ACTIVE = ['uploading', 'waiting', 'rendering', 'retrying', 'stale'];
  const RENDER_EXPRESS = ['waiting', 'rendering', 'retrying', 'stale'];
  const RENDER_SUPPORT_CONTACT = 'mailto:yoda@yodalai.xyz';
  // Per property: the element in its space the status is drawn into, and the older
  // "no package yet" sentence the status replaces once it can be read.
  const renderSlots = new Map(), renderEmpty = new Map();
  // Per job: the state and step last shown, so a change is said once. Kept across
  // desk reloads; cleared on sign-out.
  const renderSaid = new Map();
  // Recapture steps a person opened, kept open across redraws.
  const renderOpen = new Set();
  // Tours a capture finished into that this desk reloaded once to look for.
  const renderAsked = new Set();
  // Reviews answered approved (get_tour_review): the tour card then owns sharing.
  const renderApproved = new Set();
  let render = null, renderVersion = 0, renderTimer = null, renderPrimed = false, renderGuideSaid = '', renderPendingReview = null;

  function renderInt(value, min, max) { return Number.isInteger(value) && value >= min && value <= max ? value : null; }
  function renderTime(value) { const at = Date.parse(value || ''); return Number.isNaN(at) ? null : at; }
  function renderOrdinal(value) {
    const tens = value % 100, ones = value % 10;
    return value + (tens >= 11 && tens <= 13 ? 'th' : ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th');
  }
  function renderMinutes(count) { return count + (count === 1 ? ' minute' : ' minutes'); }
  // "About 12 minutes left": the server's eta_seconds, rounded up to the minute.
  function renderDuration(seconds) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    if (minutes < 60) return renderMinutes(minutes);
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return hours + (hours === 1 ? ' hour' : ' hours') + (rest ? ' ' + renderMinutes(rest) : '');
  }
  // The server's one room and plain reason (recapture_room may be empty; the reason is its customer_hint).
  function renderRooms(value) {
    if (!value || typeof value !== 'object' || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 240) return [];
    const room = typeof value.room === 'string' && value.room.trim() && value.room.length <= 80 ? value.room.trim() : null;
    return [{ room, reason: value.reason.trim().replace(/[.\s]+$/, '') }];
  }
  /*
   * Why a queued capture waits (migration 20260926110000, hold): admission (the account
   * waits for a rendering place), paused (new renders are paused for everyone) or
   * weekly_limit (this week's renders are used; the next starts at until). The job stays
   * Waiting to render, with no failure and nothing to press. The contract's words.
   */
  const RENDER_HOLDS = ['admission', 'paused', 'weekly_limit'];
  function renderHold(value) {
    if (!value || typeof value !== 'object' || !RENDER_HOLDS.includes(value.reason)) return null;
    return { reason: value.reason, until: value.reason === 'weekly_limit' && renderTime(value.until) !== null ? value.until : null };
  }
  function renderHoldWords(hold) {
    if (hold.reason === 'admission') return 'We’ll start your render as soon as a rendering place opens for your account.';
    if (hold.reason === 'paused') return 'Rendering is paused for a moment. Yours keeps its place in line.';
    const day = hold.until ? window.VeyletSharing?.hostingDate?.(hold.until) || '' : '';
    return 'You’ve used this week’s renders. ' + (day ? 'This one starts on ' + day + '.' : 'This one starts as soon as the week allows another.');
  }
  /*
   * The quality check's advice (review_flags: [{room, reason}], 20260926110000): areas
   * worth a look before sharing, shown in the review above Approve and share. Advice
   * only: approving is never blocked by it. The member read names the gate's reason
   * sentence (written for a recapture), so each is mapped to a short plain line by its
   * rule when one is sent, else by the gate's own words; anything else reads "worth a
   * closer look".
   */
  const REVIEW_FLAG_WORDS = {
    photo_match: 'some areas may look blurry',
    coverage: 'some corners may be missing',
    few_views: 'few photos were taken here, so detail may be thin',
    floaters: 'there may be stray smudges in the air',
    no_floor: 'the floor may be hard to walk on',
    not_connected: 'walking on to the next room may not work',
    ai_visual: 'an automatic check noticed something to look at',
  };
  const REVIEW_FLAG_REASONS = [['few_views', /too few photos/i], ['coverage', /not photographed/i], ['photo_match', /does not match the photos/i],
    ['floaters', /stray smudges/i], ['no_floor', /clear floor to walk on/i], ['not_connected', /clear path on the floor/i], ['ai_visual', /automatic visual check/i]];
  function reviewFlagLines(flags) {
    if (!Array.isArray(flags)) return [];
    const lines = [];
    for (const flag of flags.slice(0, 20)) {
      if (!flag || typeof flag !== 'object') continue;
      const rule = Object.prototype.hasOwnProperty.call(REVIEW_FLAG_WORDS, flag.rule) ? flag.rule
        : (REVIEW_FLAG_REASONS.find(([, words]) => words.test(String(flag.reason || ''))) || [])[0];
      const words = REVIEW_FLAG_WORDS[rule] || 'worth a closer look';
      const room = typeof flag.room === 'string' ? flag.room.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      const line = room ? room + ': ' + words : words.charAt(0).toUpperCase() + words.slice(1);
      if (!lines.includes(line)) lines.push(line);
    }
    return lines;
  }
  // Per walkthrough: the latest advice from the render answer, and the review form's slot for it.
  const reviewFlags = new Map(), reviewFlagSlots = new Map();
  function paintReviewFlags(slot, flags) {
    const lines = reviewFlagLines(flags);
    // Each render read repaints nothing that has not changed, so a reader keeps their place.
    const signature = lines.join('\n');
    if (slot.dataset.flags === signature) return;
    slot.dataset.flags = signature;
    if (!lines.length) { slot.hidden = true; slot.replaceChildren(); return; }
    slot.className = 'tour-flags';
    const title = document.createElement('p'); title.className = 'tour-flags-title'; title.textContent = 'Worth a look before you share';
    const list = document.createElement('ul'); list.className = 'tour-flags-list';
    for (const text of lines) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
    const note = document.createElement('p'); note.className = 'tour-flags-note'; note.textContent = 'Open the preview to check these areas. They never stop you approving.';
    slot.replaceChildren(title, list, note); slot.hidden = false;
  }
  function reviewFlagsFor(tourID, flags) {
    reviewFlags.set(tourID, flags);
    const slot = reviewFlagSlots.get(tourID);
    if (slot) paintReviewFlags(slot, flags);
  }
  function renderJobValid(job) {
    return Boolean(job) && typeof job === 'object' && typeof job.job_id === 'string' && Boolean(job.job_id) && typeof job.state === 'string';
  }
  // One answer: which spaces the server spoke for, each with its latest capture or none.
  function renderAnswer(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.spaces)) return null;
    if (!data.spaces.every(entry => entry && typeof entry === 'object' && typeof entry.property_id === 'string'
      && (entry.job === null || (entry.job && typeof entry.job === 'object')))) return null;
    return { active: typeof data.active === 'boolean' ? data.active : null, spaces: new Map(data.spaces.map(entry => [entry.property_id, entry.job])) };
  }
  // The customer's state for one capture, as the server decided it. A state this page
  // does not know says nothing rather than something it guessed.
  function renderView(job, desk) {
    const key = RENDER_SERVER_STATES[job.state];
    if (!key) return null;
    const step = renderInt(job.step, 1, RENDER_STEPS.length);
    const allowed = renderInt(job.attempts_allowed, 1, 10) || RENDER_ATTEMPTS;
    const due = renderTime(job.express_due_at);
    const express = job.express === true && due !== null && due > Date.now() ? job.express_due_at : null;
    const tourID = typeof job.tour_id === 'string' && job.tour_id ? job.tour_id : null;
    let view;
    if (key === 'uploading') view = { key, pct: renderInt(job.progress_pct, 0, 100) };
    // A held job stays Waiting to render; the hold replaces its place in line and minutes.
    else if (key === 'waiting') {
      const hold = renderHold(job.hold);
      view = hold ? { key, position: null, wait: null, hold } : { key, position: renderInt(job.queue_position, 1, 100000), wait: renderInt(job.typical_start_minutes, 1, 100000) };
    }
    // A render that has not checked in for 3 minutes (the server's stale) shows no live progress.
    else if (key === 'rendering') view = job.stale === true ? { key: 'stale', step }
      : { key, step, pct: renderInt(job.progress_pct, 0, 100), eta: renderInt(job.eta_seconds, 0, 7 * 86400) };
    // The automatic quality gate: step 5, and nothing the server did not send.
    else if (key === 'checking') view = { key: 'rendering', step: RENDER_STEPS.length, pct: null, eta: null };
    else if (key === 'retrying') view = { key, attempt: renderInt(job.attempt, 1, allowed), allowed };
    // Approved and not yet shared: the walkthrough's card below owns the next step.
    else if (key === 'ready') view = tourID && renderApproved.has(tourID) ? null : { key, tour: tourID };
    // A paused link is not live: the walkthrough's card says Paused and owns Resume.
    else if (key === 'live') view = tourID && sharePaused(desk?.tours?.get(tourID)) ? null : { key, tour: tourID };
    else if (key === 'recapture') view = { key, rooms: renderRooms(job.recapture) };
    else view = { key };
    if (view && express && !APP_MODE && RENDER_EXPRESS.includes(view.key)) view.express = express;
    return view;
  }
  function renderStepWords(step) { return 'Step ' + step + ' of ' + RENDER_STEPS.length + ': ' + RENDER_STEPS[step - 1] + '.'; }
  // What the live region says when a capture changes state or step.
  function renderSpoken(view) {
    switch (view.key) {
      case 'waiting': return 'Waiting to render.' + (view.hold ? ' ' + renderHoldWords(view.hold) : view.position ? ' You’re ' + renderOrdinal(view.position) + ' in line.' : '');
      case 'rendering': return view.step ? 'Rendering, step ' + view.step + ' of ' + RENDER_STEPS.length + ': ' + RENDER_STEPS[view.step - 1] + '.' : 'Rendering.';
      case 'retrying': return 'Retrying' + (view.attempt ? ' (attempt ' + view.attempt + ' of ' + view.allowed + ').' : '.');
      case 'failed': return 'Failed. Veylet support has been told; nothing was used.';
      default: return RENDER_TITLES[view.key] + '.';
    }
  }
  function renderSignature(view) { return view ? [view.key, view.step || '', view.attempt || '', view.hold?.reason || ''].join('|') : ''; }
  function renderMeter(pct, label) {
    const meter = annualNode('div', 'render-meter');
    const bar = document.createElement('progress'); bar.className = 'render-progress';
    bar.max = 100; bar.value = pct; bar.setAttribute('aria-label', label);
    meter.append(bar, annualNode('span', 'render-pct', pct + '%'));
    return meter;
  }
  function renderStepList(current) {
    const list = annualNode('ol', 'render-steps'); list.setAttribute('aria-label', 'Render steps');
    RENDER_STEPS.forEach((label, index) => {
      const number = index + 1, state = number < current ? 'done' : number === current ? 'current' : 'next';
      const item = annualNode('li'); item.dataset.step = state;
      const mark = annualNode('span', 'render-mark'); mark.setAttribute('aria-hidden', 'true');
      const words = annualNode('span', 'render-step-label', label);
      if (state === 'current') item.setAttribute('aria-current', 'step');
      if (state === 'done') words.append(annualNode('span', 'render-sr', ' (done)'));
      item.append(mark, words); list.append(item);
    });
    return list;
  }
  function renderContact(row, filled) {
    const link = annualNode('a', 'tour-action' + (filled ? ' tour-action-primary' : ''), 'Contact Veylet support');
    const reference = String(row.job_id).slice(0, 8);
    link.href = RENDER_SUPPORT_CONTACT + '?subject=' + encodeURIComponent('Veylet render · capture ' + reference)
      + '&body=' + encodeURIComponent('Capture reference: ' + reference + '\n\nLeave out street addresses and access details.');
    link.dataset.control = 'contact';
    return link;
  }
  // One room to capture again: why, then the action. The capture happens in the app,
  // so the button opens the steps there; the first room's is the filled one.
  function renderRoom(row, room, index, spaceTitle) {
    const item = annualNode('li', 'render-room');
    // Without a room named, the reason stands alone and the space is what is captured again.
    item.append(annualNode('p', 'render-line', room.room ? room.room + ': ' + room.reason + '. Recapture this room; it won’t use a walkthrough.'
      : room.reason + '. Recapture it; it won’t use a walkthrough.'));
    const key = row.job_id + '|' + index;
    const how = annualNode('p', 'render-how', 'On your iPhone, open Veylet Capture and choose ' + spaceTitle + '. It shows Needs recapture there too: ' +
      (room.room ? 'choose Recapture ' + room.room + ', capture the room again' : 'capture it again') + ' and send it. It won’t use a walkthrough.');
    how.id = 'render-how-' + String(row.job_id).slice(0, 8) + '-' + index; how.hidden = !renderOpen.has(key);
    const open = button('Recapture ' + (room.room || spaceTitle), () => {
      const shown = how.hidden;
      how.hidden = !shown; open.setAttribute('aria-expanded', String(shown));
      if (shown) renderOpen.add(key); else renderOpen.delete(key);
    });
    if (index === 0) open.className = 'tour-action tour-action-primary';
    open.setAttribute('aria-expanded', String(!how.hidden)); open.setAttribute('aria-controls', how.id);
    open.dataset.control = 'recapture-' + index;
    const actions = annualNode('p', 'render-actions'); actions.append(open);
    item.append(actions, how);
    return item;
  }
  function renderBlock(view, row, spaceTitle, canReview) {
    const block = annualNode('div', 'render-block'); block.dataset.state = view.key; block.dataset.job = row.job_id;
    const head = annualNode('div', 'render-head');
    // "Ready for your review" is said to whoever reviews; anyone else reads whose it is.
    const others = view.key === 'ready' && !canReview;
    head.append(annualNode('p', 'render-title', others ? 'Ready for review' : RENDER_TITLES[view.key]));
    const turn = others ? 'With the workspace owner' : RENDER_TURNS[view.key];
    if (turn) head.append(pill(turn, turn === 'Your turn' ? 'good' : 'busy'));
    block.append(head);
    const line = text => { const node = annualNode('p', 'render-line', text); block.append(node); return node; };
    const note = text => { const node = annualNode('p', 'render-note', text); block.append(node); return node; };
    const hasEta = view.eta !== null && view.eta !== undefined;
    // "Step 3 of 5: Building your 3D walkthrough. About 12 minutes left.", then the
    // server's percentage and the five steps; each part only when it was sent.
    const progress = label => {
      const words = [view.step ? renderStepWords(view.step) : '', hasEta ? 'About ' + renderDuration(view.eta) + ' left.' : ''].filter(Boolean);
      if (words.length) line(words.join(' '));
      if (view.pct !== null && view.pct !== undefined) block.append(renderMeter(view.pct, label));
      if (view.step) block.append(renderStepList(view.step));
    };
    switch (view.key) {
      case 'uploading':
        line((view.pct !== null ? view.pct + '% sent.' : 'Sending from Veylet Capture.') + ' Keep Veylet open or plugged in; it continues in the background.');
        if (view.pct !== null) block.append(renderMeter(view.pct, 'Upload progress'));
        break;
      case 'waiting': {
        if (view.hold) { line(renderHoldWords(view.hold)).classList.add('render-hold'); break; }
        const words = [view.position ? 'You’re ' + renderOrdinal(view.position) + ' in line.' : '',
          view.wait ? 'Usually starts within ' + renderMinutes(view.wait) + '.' : ''].filter(Boolean);
        line(words.length ? words.join(' ') : 'Your capture is in line.');
        break;
      }
      case 'rendering':
        if (!view.step && !hasEta) line('Your walkthrough is being built.');
        progress('Render progress');
        break;
      case 'retrying':
        line('Rendering hit a snag; we’re retrying automatically' + (view.attempt ? ' (attempt ' + view.attempt + ' of ' + view.allowed + ').' : '.'));
        break;
      case 'stale':
        line('The render hasn’t checked in for a few minutes. Veylet support has been alerted. Nothing for you to do.');
        if (view.step) note('Last reported: step ' + view.step + ' of ' + RENDER_STEPS.length + ', ' + RENDER_STEPS[view.step - 1] + '.');
        break;
      case 'ready':
        if (canReview) {
          line('Open it, walk through, then approve to share.');
          if (view.tour) {
            const review = button('Review walkthrough', () => renderReview(view.tour));
            review.className = 'tour-action tour-action-primary'; review.dataset.control = 'review';
            const actions = annualNode('p', 'render-actions'); actions.append(review); block.append(actions);
          }
        } else line('The workspace owner opens it, walks through, then approves it to share.');
        break;
      case 'live':
        line(LIVE_LINE);
        break;
      case 'recapture':
        if (view.rooms.length) {
          const rooms = annualNode('ul', 'render-rooms');
          view.rooms.forEach((room, index) => rooms.append(renderRoom(row, room, index, spaceTitle)));
          block.append(rooms);
        } else {
          line('Some of it needs capturing again; it won’t use a walkthrough. Ask Veylet support what to capture.');
          const actions = annualNode('p', 'render-actions'); actions.append(renderContact(row, true)); block.append(actions);
        }
        break;
      case 'failed': {
        line('Something went wrong on our side. Veylet support has been told; nothing was used.');
        const actions = annualNode('p', 'render-actions'); actions.append(renderContact(row, false)); block.append(actions);
        break;
      }
      default: break;
    }
    // Same due time, in the same words, as the space's super fast block.
    if (view.express) block.append(annualNode('p', 'render-express', 'Super fast: ready by ' + expressMoment(view.express) + ', or refunded'));
    return block;
  }
  // Only a read slower than 400 ms shows the shape of what is coming; a quick answer
  // (or a backend without the function) never flashes one.
  const RENDER_SKELETON_MS = 400;
  function renderSkeleton() {
    for (const legacy of renderEmpty.values()) legacy.hidden = true;
    for (const slot of renderSlots.values()) {
      const block = annualNode('div', 'render-block render-loading');
      const head = annualNode('div', 'render-head'); head.append(skeletonBar(18, 'plan-skeleton render-skeleton'));
      const words = annualNode('p', 'render-line'); words.append(skeletonBar(58, 'plan-skeleton render-skeleton'));
      block.append(head, words, annualNode('span', 'render-sr', 'Checking render progress…'));
      slot.replaceChildren(block); slot.hidden = false; slot.setAttribute('aria-busy', 'true');
      delete slot.dataset.signature;
    }
  }
  function renderSay(text) {
    if (!renderStatusEl) return;
    renderStatusEl.textContent = text; renderStatusEl.hidden = !text;
  }
  function renderStop() { if (renderTimer) clearTimeout(renderTimer); renderTimer = null; }
  // Signed out: nothing about this account's captures stays on the page or in memory.
  function renderForget() {
    renderHide();
    renderSaid.clear(); renderOpen.clear(); renderAsked.clear(); renderApproved.clear(); reviewFlags.clear();
    renderPrimed = false; renderGuideSaid = ''; renderPendingReview = null;
    if (renderLiveEl) renderLiveEl.textContent = '';
  }
  function renderHide() {
    renderStop(); renderVersion += 1; render = null;
    renderCovered = new Map(); chipsSync();
    for (const slot of renderSlots.values()) { slot.hidden = true; slot.replaceChildren(); slot.setAttribute('aria-busy', 'false'); delete slot.dataset.signature; }
    for (const legacy of renderEmpty.values()) legacy.hidden = false;
    renderSlots.clear(); renderEmpty.clear();
    renderSay('');
  }
  // The next step says whose turn it is when no walkthrough on the desk speaks for it yet.
  function renderGuide(views) {
    if (!render?.desk.guideFree) return;
    const found = key => views.find(entry => entry.view.key === key);
    const recapture = found('recapture'), broken = found('failed');
    const moving = views.find(entry => RENDER_ACTIVE.includes(entry.view.key));
    const said = recapture ? 'recapture' : broken ? 'failed' : moving ? (moving.view.key === 'uploading' ? 'uploading' : moving.view.hold ? 'held-' + moving.view.hold.reason : 'moving') : '';
    if (!said || said === renderGuideSaid) return;
    renderGuideSaid = said;
    if (said.startsWith('held-')) { guide('Your capture is waiting to start.', renderHoldWords(moving.view.hold) + ' It shows on ' + moving.title + ' below.'); return; }
    if (said === 'recapture') {
      guide('Recapture what the quality check found.', 'What and why is on ' + recapture.title + ' below. Recapturing it won’t use a walkthrough.', 'Show what to recapture', () => {
        const slot = renderSlots.get(recapture.propertyID);
        (slot?.querySelector?.('[data-control="recapture-0"]') || slot)?.focus?.();
        slot?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      });
    } else if (said === 'failed') guide('Something went wrong on our side.', 'Veylet support has been told; nothing was used. Contact Veylet support from ' + broken.title + ' below if you want to talk it through.');
    else if (said === 'uploading') guide('Your capture is on its way.', 'Keep Veylet open or plugged in on your phone. How much has arrived shows on ' + moving.title + ' below.');
    else guide('Your walkthrough is being made automatically.', 'Its progress shows on ' + moving.title + ' below and updates by itself. You can leave this page; the render carries on.');
  }
  function renderDraw() {
    if (!render) return;
    const { desk } = render;
    const views = [], spoken = [];
    // A walkthrough whose space already says "Ready for your review" or "Live" shows no second chip.
    const covered = new Map();
    for (const [propertyID, slot] of renderSlots) {
      const space = desk.properties.get(propertyID);
      const answer = render.answers.get(space?.workspace_id);
      slot.setAttribute('aria-busy', 'false');
      // Unreadable, not yet in the backend, or a space the answer did not speak for: the
      // space reads as it did, never as empty.
      if (!answer?.spaces?.has(propertyID)) {
        slot.hidden = true; slot.replaceChildren(); delete slot.dataset.signature;
        if (renderEmpty.get(propertyID)) renderEmpty.get(propertyID).hidden = false;
        continue;
      }
      const row = answer.spaces.get(propertyID);
      // The quality check's advice travels with the capture; its walkthrough's review shows it.
      if (row && typeof row === 'object' && typeof row.tour_id === 'string' && row.tour_id) reviewFlagsFor(row.tour_id, row.review_flags);
      const view = row && renderJobValid(row) ? renderView(row, desk) : null;
      const title = space?.title || 'Untitled space';
      let signature, draw;
      if (view) {
        views.push({ view, propertyID, title });
        const canReview = ['owner', 'reviewer'].includes(desk.roles.get(space.workspace_id));
        if (view.tour && ['ready', 'live'].includes(view.key)) covered.set(view.tour, view.key === 'ready' && !canReview ? 'Ready for review' : RENDER_TITLES[view.key]);
        signature = JSON.stringify([view, row.job_id, canReview, view.express ? expressMoment(view.express) : '']);
        draw = () => renderBlock(view, row, title, canReview);
        const said = renderSignature(view);
        if (renderPrimed && renderSaid.get(row.job_id) !== said) spoken.push(title + ': ' + renderSpoken(view));
        renderSaid.set(row.job_id, said);
      } else if (!row && desk.toursKnown && !desk.spacesWithTours.has(propertyID)) {
        signature = 'empty';
        draw = () => { const block = annualNode('div', 'render-block render-empty'); block.dataset.state = 'empty';
          block.append(annualNode('p', 'render-line', 'No capture sent yet. When you send one from Veylet Capture, its progress shows here.')); return block; };
      }
      const legacy = renderEmpty.get(propertyID);
      if (legacy) legacy.hidden = Boolean(signature);
      if (!signature) { slot.hidden = true; slot.replaceChildren(); delete slot.dataset.signature; continue; }
      slot.hidden = false;
      if (slot.dataset.signature === signature) continue;
      // Redraw only what changed, and keep focus on the control a person was using.
      const active = document.activeElement;
      const control = active && slot.contains?.(active) ? active.dataset?.control : null;
      slot.replaceChildren(draw()); slot.dataset.signature = signature;
      if (control) slot.querySelector?.('[data-control="' + control + '"]')?.focus?.();
    }
    renderPrimed = true;
    renderCovered = covered; chipsSync();
    if (spoken.length && renderLiveEl) renderLiveEl.textContent = spoken.join(' ');
    renderGuide(views);
    return views;
  }
  function renderSchedule(views) {
    renderStop();
    if (!render || render.failures >= RENDER_POLL_TRIES) return;
    if (typeof document.hidden === 'boolean' && document.hidden) return;
    // The server says whether anything is active; an answer that does not, the states drawn.
    const said = [...render.answers.values()].filter(answer => typeof answer?.active === 'boolean');
    const active = said.length ? said.some(answer => answer.active) : views.some(entry => RENDER_ACTIVE.includes(entry.view.key));
    if (!active) return;
    const state = render;
    renderTimer = setTimeout(() => { renderTimer = null; if (render === state) void renderRead(); }, RENDER_POLL_MS);
  }
  async function renderRead() {
    const state = render;
    if (!state) return;
    const version = ++renderVersion;
    const replies = await Promise.all(state.workspaceIDs.map(id =>
      settled(Promise.resolve().then(() => state.supabase.rpc('list_workspace_render_status', { p_workspace_id: id })))));
    if (render !== state || version !== renderVersion || state.ticket !== deskVersion) return;
    if (replies.some(sessionGone)) { showSignedOut('Your sign-in has expired. Sign in again to check your captures.'); return; }
    const answers = new Map();
    let missing = 0, unreadable = false;
    state.workspaceIDs.forEach((id, index) => {
      const reply = replies[index];
      // Before the backend has the function there is no render status; that is not an outage.
      if (reply.value?.error?.code === 'PGRST202') { answers.set(id, null); missing += 1; return; }
      const answer = failed(reply) ? null : renderAnswer(reply.value?.data);
      if (answer) answers.set(id, answer);
      else { answers.set(id, state.answers?.get(id) ?? null); unreadable = true; }
    });
    if (missing === state.workspaceIDs.length) { renderHide(); return; }
    const first = !state.answers;
    state.answers = answers;
    // Offline is not an outage: the last status stays, says how old it is, and the
    // reads start again when the connection returns (the window's online event).
    if (unreadable && (offlineNow() || replies.some(networkFailed))) {
      renderSay(offlineWords(state.readAt || deskShownAt));
      if (offlineNow()) { renderDraw(); renderStop(); return; }
    }
    if (unreadable) {
      state.failures += 1;
      const when = state.readAt ? new Date(state.readAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      if (!replies.some(networkFailed)) renderSay(first || !when ? 'Render progress couldn’t be checked. Your spaces are below; refresh spaces to try again.'
        : 'Render progress couldn’t be refreshed. Showing the update from ' + when + (state.failures >= RENDER_POLL_TRIES ? '. Refresh spaces to try again.' : '; trying again.'));
    } else { state.failures = 0; state.readAt = Date.now(); renderSay(''); }
    // A capture that finished into a tour this desk has not listed: read the desk
    // again, once, so the walkthrough to review is on it. Never over work in progress.
    const unseen = [...answers.values()].flatMap(answer => (answer?.spaces ? [...answer.spaces.values()] : []))
      .filter(job => renderJobValid(job) && ['ready_for_review', 'live'].includes(job.state)
        && typeof job.tour_id === 'string' && job.tour_id && !state.desk.tours.has(job.tour_id) && !renderAsked.has(job.tour_id));
    if (unseen.length && !deskDirty) {
      unseen.forEach(row => renderAsked.add(row.tour_id));
      void loadDesk(state.supabase); return;
    }
    renderSchedule(renderDraw());
  }
  // Read after the list is drawn; it never holds the list up.
  function renderStart(supabase, ticket, workspaceIDs, desk) {
    renderStop();
    render = null;
    if (!workspaceIDs.length) return;
    const state = { supabase, ticket, workspaceIDs, desk, answers: null, failures: 0, readAt: 0 };
    render = state;
    renderGuideSaid = '';
    setTimeout(() => { if (render === state && !state.answers) renderSkeleton(); }, RENDER_SKELETON_MS);
    void renderRead();
  }
  // Back to the tab, or a review answered: read again now rather than wait.
  function renderResume() {
    if (!render || renderTimer || (typeof document.hidden === 'boolean' && document.hidden)) return;
    render.failures = 0;
    void renderRead();
  }
  // "Review walkthrough": open its check on the tour below, or put the tour on the desk first.
  function renderReview(tourID, reload = true) {
    const open = reviewOpeners.get(tourID);
    if (open) { open(); return; }
    const item = render?.desk.items.get(tourID);
    if (item) { item.tabIndex = -1; item.focus?.({ preventScroll: true }); item.scrollIntoView?.({ block: 'start', behavior: 'auto' }); return; }
    if (render && reload) { renderPendingReview = tourID; void loadDesk(render.supabase); }
  }

  // The tour list, with each tour's place in its walkthrough. A database without
  // the lineage columns yet answers "column does not exist" (42703); the desk then
  // reads the columns it always had, and every tour is version 1 of its own walkthrough.
  const TOUR_COLUMNS = 'id,status,property_id,created_by,created_at,share_token,storage_path';
  const LINEAGE_COLUMNS = 'walkthrough_id,revision,revision_of,superseded_at';
  // Paused sharing (the integrator lane's 2026092610xxxx migration): tours.share_paused_at
  // is set while a kept link is paused. A database without the column has no
  // pause_tour_share either, so the desk then offers no Pause and reads as before.
  const PAUSE_COLUMNS = 'share_paused_at';
  let pauseAvailable = false;
  // get_tour_view_stats, until an answer says the backend does not have it.
  let viewsAvailable = true;
  // get_listing_exports, until an answer says the backend does not have it (PGRST202).
  let exportsAvailable = true;
  // A read that named a column this database does not have: which group it was.
  function columnMissing(result) {
    const error = result?.value?.error;
    const words = String(error?.message || '');
    if (!error || !(String(error.code || '') === '42703' || /does not exist|could not find/i.test(words))) return null;
    return { pause: /share_paused_at/.test(words), lineage: /walkthrough_id|revision|superseded_at/.test(words) };
  }
  async function readTours(supabase) {
    const query = columns => settled(Promise.resolve().then(() => supabase.from('tours').select(columns).order('created_at', { ascending: false })));
    let lineage = true, pause = true, read;
    // At most one retry per optional group; an unnamed missing column drops the newest group first.
    for (let tries = 0; tries < 3; tries += 1) {
      read = await query([TOUR_COLUMNS, lineage && LINEAGE_COLUMNS, pause && PAUSE_COLUMNS].filter(Boolean).join(','));
      const missing = columnMissing(read);
      if (!missing || (!lineage && !pause)) break;
      if (pause && (missing.pause || !missing.lineage)) pause = false;
      else lineage = false;
    }
    pauseAvailable = pause && !failed(read);
    return read;
  }

  // Clear the desk for a fresh draw: the plan's rows that are coming, the next step
  // while it is worked out, and an empty list. Returns the new desk's ticket.
  function deskReset() {
    const ticket = ++deskVersion;
    deskDirty = false; reviewOpeners.clear(); tourChips.clear(); tourApproval.clear(); reviewFlagSlots.clear(); listingGates.clear();
    planSkeleton();
    guide('Checking your next step…', 'Loading your spaces, tour progress and workspace access.');
    targetMessage(requestedTour ? 'Finding the requested walkthrough in this account…' : invalidTourTarget
      ? 'This review link is incomplete. Use Review again from the app, or choose an available tour below.' : '');
    list.replaceChildren(); list.setAttribute('aria-busy', 'true');
    expressHide();
    renderHide();
    return ticket;
  }
  // Offline with a desk on the page: it stays as it was, says how old it is, and
  // reads again when the window hears it is back online.
  function deskOffline() {
    stopPolling(); renderStop();
    renderSay(offlineWords(Math.max(render?.readAt || 0, deskShownAt)));
  }
  async function loadDesk(supabase) {
    if (!list || !currentUserId) return;
    // A drawn desk is read before it is cleared, so a lost connection never empties it.
    const shown = deskShownAt > 0;
    if (shown && offlineNow()) { deskOffline(); return; }
    const read = ++deskReadVersion;
    const loadingUser = currentUserId;
    stopPolling();
    let ticket = shown ? deskVersion : deskReset();
    if (shown) list.setAttribute('aria-busy', 'true');
    const [props, tours, members, production, hosting] = await Promise.all([
      settled(supabase.from('properties').select('id,title,category,location_general,workspace_id,created_at').order('created_at', { ascending: false })),
      readTours(supabase),
      settled(supabase.from('memberships').select('workspace_id,role,status').eq('user_id', currentUserId).eq('status', 'active')),
      settled(supabase.rpc('can_produce_tours')),
      // A throwing client still settles, so hosting can never stop the desk.
      settled(Promise.resolve().then(() => supabase.rpc('get_tour_hosting', {}))),
    ]);
    if (read !== deskReadVersion || currentUserId !== loadingUser || ticket !== deskVersion) return;
    list.setAttribute('aria-busy', 'false');
    const reads = [props, tours, members];
    if (reads.some(failed) && !reads.some(sessionGone) && (offlineNow() || reads.some(networkFailed))) {
      if (shown) { deskOffline(); return; }
      // Nothing was on the page yet: say when it will come, and claim no state.
      if (statusEl?.textContent === 'Signed in. Loading your spaces…') setStatus('');
      nextStep?.replaceChildren(); targetMessage('');
      planBody?.replaceChildren(); planPanel?.setAttribute('aria-busy', 'false');
      trialHide(); packsHide(); annualHide(); referralHide(); clientsHide(); teamHide();
      renderSay(offlineWords(0));
      return;
    }
    if (shown) ticket = deskReset();
    list.setAttribute('aria-busy', 'false');
    if (statusEl?.textContent === 'Signed in. Loading your spaces…') setStatus('');
    if ([props, tours, members].some(sessionGone)) { showSignedOut('Your sign-in has expired. Sign in again to refresh your spaces.'); return; }
    // The plan reads its own row. A slow or failed plan lookup must not hold up
    // the spaces list, and it never changes what the list is allowed to show.
    void renderPlan(supabase, ticket, props, members);
    // Leaving is the account's own decision and reads its own record. A slow
    // deletion check must not hold up the spaces list, and it never changes
    // what the list is allowed to show.
    void renderDeletion(supabase, ticket);
    // The email preferences read their own record, once per account.
    void emailRender(supabase);
    if (gateTitle) gateTitle.textContent = production.value?.data === true ? 'Production access approved.' : failed(production) ? 'Production approval could not be checked.' : 'Your account is ready. Capture approval is separate.';
    if (gateBody) gateBody.textContent = production.value?.data === true ? 'Use your approved capture workflow. Every tour still passes its automatic quality check and needs publication permission before sharing.' : 'You can save a space and prepare a practice capture. Client work needs a device and practice assessment first.';
    deskShownAt = failed(props) ? 0 : Date.now();
    if (failed(props)) { guide('Reload your spaces.', 'Your saved work could not be checked. Refresh before creating another space or repeating an upload.', 'Refresh spaces', () => loadDesk(supabase)); targetMessage(requestedTour ? 'The requested walkthrough could not be checked. Refresh spaces to try again.' : ''); message(list, 'Spaces could not load. Refresh the desk to try again.'); return; }
    if (failed(tours)) { message(list, 'Tour status could not load. Your spaces are shown below, but the tour list is unavailable. Refresh to retry.'); }
    const properties = props.value?.data || [];
    const addSpace = document.getElementById('account-add-space');
    if (addSpace) addSpace.open = properties.length === 0;
    const allRows = failed(tours) ? [] : tours.value?.data || [];
    // A version that a later approved version replaced is not a walkthrough of its
    // own any more: its link, embed and approval moved on. The records file keeps it.
    const rows = allRows.filter(row => !row.superseded_at);
    lastDesk = failed(tours) ? null : { properties, rows: allRows };
    // A link to a replaced version opens its walkthrough's current version instead.
    const asked = requestedTour ? allRows.find(row => row.id === requestedTour) : null;
    const current = asked?.superseded_at ? rows.filter(row => walkthroughOf(row) === walkthroughOf(asked))
      .sort((left, right) => revisionOf(right) - revisionOf(left))[0] : null;
    deskTarget = current ? current.id : requestedTour;
    if (exportButton) exportButton.disabled = !lastDesk;
    if (updatedEl) updatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // Waiting should not mean pressing Refresh. While a tour is processing the
    // desk checks again quietly, but never while someone is part-way through a
    // review, a confirmation or a form, because a reload would clear their work.
    if (rows.some(row => row.status === 'processing')) {
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (ticket !== deskVersion || currentUserId !== loadingUser || deskDirty) return;
        if (typeof document.hidden === 'boolean' && document.hidden) return;
        void loadDesk(supabase);
      }, 45000);
    }
    if (requestedTour) targetMessage(failed(tours)
      ? 'The requested walkthrough could not be checked. Refresh spaces to try again.'
      : 'This walkthrough is not available in this account. Refresh spaces, sign in with the capture account, or ask the workspace owner. Available tours are shown below.');
    const roles = new Map((failed(members) ? [] : members.value?.data || []).map(row => [row.workspace_id, row.role]));
    // The team: the same workspace the plan panel shows, with or without a space yet.
    const teamWorkspace = failed(members) ? null : (members.value?.data || []).find(row => row && row.workspace_id)?.workspace_id || null;
    if (teamWorkspace) void teamRender(supabase, ticket, teamWorkspace, roles.get(teamWorkspace)); else teamHide();
    // Hosting dates only choose the words on a live card. A failed or malformed
    // answer makes each live card say so; it never holds up or blocks sharing.
    const hostingRows = failed(hosting) || !Array.isArray(hosting.value?.data) ? null
      : new Map(hosting.value.data.filter(row => row && typeof row === 'object' && row.tour_id).map(row => [row.tour_id, row]));
    if (failed(members)) message(list, 'Workspace permissions could not load. Review and sharing actions are unavailable until you refresh.');
    const items = new Map();
    const updateGuide = (reviewsPending = false) => {
      if (failed(tours) || failed(members)) guide('Refresh your walkthrough status.', 'Some progress or workspace permissions could not load. Refresh before repeating work or sharing.', 'Refresh status', () => loadDesk(supabase));
      else guideDesk(properties, rows, production, items, supabase, { roles, hosting: hostingRows, reviewsPending });
    };
    if (!properties.length) { clientsHide(); updateGuide(); message(list, APP_MODE ? 'No spaces yet. Create one in Veylet Capture; its walkthrough appears here.' : 'Start by saving a space above. Then capture it with Veylet Capture. Keep the same email on the website and app.'); return; }
    let requestedItem = null;
    const reviewLoads = [];
    for (const row of properties) {
      const li = document.createElement('li'); li.className = 'dash-space';
      // A space is a section of this page, so it is a heading: jumping between
      // spaces by heading is how a screen reader reads a list like this one.
      // The name is the heading; what kind of space and where are its details.
      const title = document.createElement('h3'); title.className = 'dash-space-title';
      title.textContent = row.title || 'Untitled space'; li.append(title);
      const where = [row.category, row.location_general].filter(Boolean).join(' · ');
      if (where) { const meta = document.createElement('p'); meta.className = 'dash-space-meta'; meta.textContent = where; li.append(meta); }
      // Where this space's capture is now, drawn when the render status answer arrives.
      const renderSlot = document.createElement('div'); renderSlot.className = 'dash-render'; renderSlot.hidden = true;
      li.append(renderSlot); renderSlots.set(row.id, renderSlot);
      // An express render for a capture of this space, drawn when its answer arrives.
      const expressSlot = document.createElement('div'); expressSlot.className = 'dash-express'; expressSlot.hidden = true;
      li.append(expressSlot); expressSlots.set(row.id, expressSlot);
      // One walkthrough's versions sit together, newest first: a correction waiting
      // for its check comes before the version it will replace.
      const spaceTours = rows.filter(tour => tour.property_id === row.id);
      const order = [...new Set(spaceTours.map(walkthroughOf))];
      spaceTours.sort((left, right) => (order.indexOf(walkthroughOf(left)) - order.indexOf(walkthroughOf(right)))
        || (revisionOf(right) - revisionOf(left)));
      if (!spaceTours.length && !failed(tours)) renderEmpty.set(row.id, message(li, 'No tour package yet. Your walkthrough is made automatically from your capture and appears in this space.'));
      // Is anyone living here? Asked once a listing has a walkthrough, before its first share.
      if (spaceTours.length && roles.has(row.workspace_id)) {
        const gateSlot = document.createElement('div'); gateSlot.className = 'dash-occupancy'; gateSlot.hidden = true;
        li.append(gateSlot);
        void listingGate(row, gateSlot, supabase, ticket);
      }
      const ul = document.createElement('ul'); ul.className = 'dash-tours';
      for (const tour of spaceTours) {
        const item = document.createElement('li'); item.className = 'dash-tour'; item.dataset.tour = tour.id;
        item.append(tourMeta(tour, hostingRows ? hostingRows.get(tour.id) || null : undefined));
        items.set(tour.id, item);
        // Where a walkthrough has more than one version here, each says which it is.
        const versions = spaceTours.filter(other => walkthroughOf(other) === walkthroughOf(tour));
        if (revisionOf(tour) > 1 || versions.length > 1) {
          const newer = versions.filter(other => revisionOf(other) > revisionOf(tour)).map(revisionOf).sort((a, b) => a - b)[0];
          message(item, 'Version ' + revisionOf(tour) + ' of ' + walkthroughRef(tour) + '.' +
            (newer ? ' Version ' + newer + ' replaces it once you approve that version.' : ''), 'tour-lineage');
          if (newer) item.className += ' dash-tour-earlier';
        }
        if (tour.id === deskTarget) {
          requestedItem = item;
          item.id = 'requested-tour'; item.tabIndex = -1;
          item.setAttribute('aria-label', 'Walkthrough opened from your capture');
          message(item, current ? 'A newer version of this walkthrough replaced the one in your link. This is the current version.'
            : 'Opened from your capture. Review this walkthrough, then approve and share it.');
        }
        const reviewRole = ['owner', 'reviewer'].includes(roles.get(row.workspace_id));
        if (tour.storage_path && tour.status === 'ready' && !reviewRole) tourPreview(tour, item);
        if (tour.status === 'ready' && tour.storage_path && roles.has(row.workspace_id)) {
          reviewLoads.push(tourReview(tour, item, supabase, roles.get(row.workspace_id), ticket, hostingRows ? hostingRows.get(tour.id) || null : undefined, row.title).catch(() => { if (ticket === deskVersion) message(item, 'Review could not load. Refresh the desk.'); }));
        } else if (tour.status === 'draft') {
          // The state first, then the one thing to do about it.
          message(item, 'Rendering, step 5 of 5: Checking quality. The check is automatic; sharing opens once it is ready for your review. You can open its preview meanwhile.');
          if (tour.storage_path) tourPreview(tour, item);
        }
        else if (tour.status === 'processing') message(item, 'This walkthrough is being made automatically. You can leave this page and refresh later; leaving does not cancel it.');
        else if (tour.status === 'revoked') message(item, 'This walkthrough is unavailable for new access. Remove any old links or embeds from your listing, and contact Veylet support about the next step.');
        ul.append(item);
      }
      li.append(ul); list.append(li);
    }
    // A ready walkthrough's next step waits for its review answer, then says it once.
    updateGuide(reviewLoads.length > 0);
    if (reviewLoads.length) void Promise.all(reviewLoads).then(() => { if (ticket === deskVersion) updateGuide(); });
    // What clients see on a shared walkthrough: the workspace the plan panel shows.
    const contactWorkspace = failed(members) ? null : (members.value?.data || []).find(row => row && row.workspace_id)?.workspace_id || null;
    if (contactWorkspace) void clientsRender(supabase, ticket, contactWorkspace, roles.get(contactWorkspace)); else clientsHide();
    // Express renders and render status read their own answers, one per workspace
    // with a space here; they never hold up the list.
    const deskWorkspaces = [...new Set(properties.map(row => row.workspace_id).filter(id => id && roles.has(id)))];
    if (!APP_MODE) void renderExpress(supabase, ticket, deskWorkspaces);
    renderStart(supabase, ticket, deskWorkspaces, {
      properties: new Map(properties.map(row => [row.id, row])),
      tours: new Map(rows.map(row => [row.id, row])),
      roles, items,
      // A failed tour read never lets a space read as having sent nothing.
      toursKnown: !failed(tours),
      spacesWithTours: new Set(rows.map(row => row.property_id)),
      // Nothing on the desk to review or share yet: the next step speaks for the capture.
      guideFree: !failed(tours) && !failed(members) && !rows.some(row => items.has(row.id)),
    });
    if (renderPendingReview) {
      const pending = renderPendingReview; renderPendingReview = null;
      void Promise.all(reviewLoads).then(() => { if (ticket === deskVersion) renderReview(pending, false); });
    }
    if (requestedItem) {
      targetMessage(current ? 'A newer version of the walkthrough from your capture replaced it. The current version is selected below.'
        : 'The walkthrough from your capture is selected below.');
      // Earlier cards and the selected review can change height asynchronously.
      // Keep auth handling available while they settle, then focus this arrival
      // once. A refresh or account change retires the old positioning intent.
      void Promise.all(reviewLoads).then(() => {
        if (ticket !== deskVersion || currentUserId !== loadingUser || focusedTourForUser === currentUserId) return;
        focusedTourForUser = currentUserId;
        requestedItem.focus({ preventScroll: true });
        requestedItem.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    }
  }

  if (!window.supabase || !window.supabase.createClient) {
    setStatus(
      'The account service did not load on this device. Check the connection and reload this page.'
    );
    return;
  }
  if (!cfg || !cfg.url || !cfg.anonKey) {
    setStatus('Account service is not configured.');
    return;
  }

  const supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  async function showSession(session) {
    if (!session || !session.user) {
      sessionHeading(false);
      currentUserId = null;
      currentUserEmail = ''; currentUserConfirmedAt = null;
      emailHide();
      signupTipsOffer(supabase);
      focusedTourForUser = null;
      deskVersion += 1; deskShownAt = 0;
      if (signInForm) signInForm.hidden = signInForm.dataset.awaitingCode === 'yes';
      if (verifyForm) verifyForm.hidden = signInForm?.dataset.awaitingCode !== 'yes';
      if (home) home.hidden = true;
      setStatus(
        location.pathname.startsWith('/auth/')
          ? 'Sign-in did not complete. Request a new email link.'
          : requestedTour ? 'Sign in with the capture account to open the requested walkthrough.'
            : 'Not signed in yet. Your email link signs in this website and the iPhone app.'
      );
      return;
    }
    sessionHeading(true);
    // Another account's desk is never kept on the page while this one's is read.
    if (currentUserId !== session.user.id) { deskShownAt = 0; clientsHide(); teamHide(); emailHide(); }
    currentUserId = session.user.id;
    currentUserEmail = session.user.email || '';
    currentUserConfirmedAt = session.user.email_confirmed_at || session.user.confirmed_at || session.user.created_at || null;
    if (signupTipsRow) signupTipsRow.hidden = true;
    resetSignInAttempt();
    if (signInForm) {
      signInForm.dataset.awaitingCode = 'no';
      signInForm.hidden = true;
    }
    if (verifyForm) verifyForm.hidden = true;
    if (home) home.hidden = false;
    if (who) who.textContent = session.user.email ? 'Signed in as ' + session.user.email : 'Signed in';
    if (gateTitle) gateTitle.textContent = 'Checking capture approval…';
    if (gateBody) {
      gateBody.textContent =
        'Save a space and arrange a practice capture. Client work needs device and practice assessment.';
    }
    if (idEl) idEl.textContent = 'Account id: ' + session.user.id;
    setStatus('Signed in. Loading your spaces…');
    // Back to the invite that sent this person to sign in; /join accepts it.
    if (joinReturn) { location.replace('/join'); return; }
    if (location.pathname.startsWith('/auth/')) {
      location.replace('/account' + tourQuery);
      return;
    }
    await loadDesk(supabase);
  }

  copyId?.addEventListener('click', async () => {
    const current = (idEl?.textContent || '').replace(/^Account id:\s*/, '');
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current);
      setStatus('Account id copied. Use this same email on the iPhone.');
    } catch {
      setStatus(current);
    }
  });

  const initialSession = await settled(supabase.auth.getSession());
  if (initialSession.timedOut || initialSession.error || initialSession.value?.error) {
    setStatus('Sign-in could not be checked. Check the connection and reload.');
  } else {
    await showSession(initialSession.value?.data?.session || null);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    const version = ++authVersion;
    // Invalidate immediately, before the queued session render can run.
    if (session?.user || event === 'SIGNED_OUT') resetSignInAttempt();
    if (event === 'SIGNED_OUT' && !session) {
      showSignedOut('Signed out. Enter your email for a new sign-in link.');
      return;
    }
    // Do not await Supabase requests inside its auth callback lock.
    setTimeout(() => { if (version === authVersion) void showSession(session); }, 0);
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentUserId || signInForm.hidden) return;
    const form = new FormData(signInForm);
    const email = String(form.get('email') || '').trim();
    const role_intent = String(form.get('role_intent') || 'owner');
    const shapeOk = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(email);
    if (!shapeOk || email.length > 200) {
      setStatus('That does not look like an email address. Check it for a typo and try again.');
      return;
    }
    if (signInSubmit?.disabled) return;
    const requestVersion = ++signInVersion;
    setStatus('Sending sign-in email…');
    if (signInSubmit) signInSubmit.disabled = true;
    const askedAt = Date.now();
    const error = await requestLink(email, role_intent);
    if (requestVersion !== signInVersion || currentUserId) return;
    if (signInSubmit) signInSubmit.disabled = false;
    if (error) {
      setStatus(
        error.message === 'timeout'
          ? 'No answer from the sign-in service. Check the connection and try again.'
          : signInProblem(error, 'send')
      );
      return;
    }
    lastEmail = email;
    lastRoleIntent = role_intent;
    void tipsIntentKeep(email, askedAt);
    if (signInForm) signInForm.dataset.awaitingCode = 'yes';
    signInForm.hidden = true;
    if (verifyEmail) verifyEmail.textContent = email;
    if (verifyForm) {
      verifyForm.hidden = false;
      verifyForm.querySelector('input[name="token"]')?.focus();
    }
    startResendCooldown(45);
    setStatus(
      'Check your email. Open the link on this device, or type the six-digit code below — some mail scanners open links before you do.'
    );
  });

  signInForm?.addEventListener('input', () => {
    if (signInForm.hidden || !signInSubmit?.disabled) return;
    resetSignInAttempt();
    setStatus('Your sign-in details changed. Send a new link for these details.');
  });

  verifyResend?.addEventListener('click', async () => {
    if (currentUserId || verifyForm?.hidden || verifyResend.disabled || verifyingCode) return;
    if (!lastEmail) {
      setStatus('Enter the email address you want the link sent to.');
      return;
    }
    setStatus('Sending another sign-in email…');
    const requestVersion = ++signInVersion;
    verifyResend.disabled = true;
    if (verifySubmit) verifySubmit.disabled = true;
    const error = await requestLink(lastEmail);
    if (requestVersion !== signInVersion || currentUserId) return;
    if (verifySubmit) verifySubmit.disabled = false;
    if (error) {
      setStatus(
        error.message === 'timeout'
          ? 'No answer from the sign-in service. Check the connection and try again.'
          : signInProblem(error, 'send')
      );
      stopResendCooldown();
      return;
    }
    startResendCooldown(45);
    setStatus('Another link is on its way. Only the newest email works.');
  });

  verifyRestart?.addEventListener('click', () => {
    if (verifyRestart.disabled || currentUserId) return;
    resetSignInAttempt();
    if (signInForm) {
      signInForm.dataset.awaitingCode = 'no';
      signInForm.hidden = false;
    }
    if (verifyForm) { verifyForm.hidden = true; verifyForm.reset(); }
    setStatus('Enter the email address you want the link sent to.');
  });

  verifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentUserId || verifyForm.hidden || verifySubmit?.disabled) return;
    const form = new FormData(verifyForm);
    const token = String(form.get('token') || '').replace(/\D/g, '');
    if (token.length !== 6 || !lastEmail) {
      setStatus('Enter the six-digit code from the email.');
      return;
    }
    const requestVersion = ++signInVersion;
    verifyingCode = true;
    if (verifySubmit) verifySubmit.disabled = true;
    if (verifyRestart) verifyRestart.disabled = true;
    if (verifyResend) verifyResend.disabled = true;
    setStatus('Checking the code…');
    const result = await settled(
      supabase.auth.verifyOtp({ email: lastEmail, token, type: 'email' })
    );
    if (requestVersion !== signInVersion || currentUserId) return;
    if (result.timedOut) {
      // The SDK may still establish this session later. Do not start a
      // conflicting identity request while its outcome is unknown.
      setStatus('Sign-in has not been confirmed. Reload this page before trying a different email or code.');
      return;
    }
    const error = result.error || (result.value && result.value.error);
    verifyingCode = false;
    if (verifySubmit) verifySubmit.disabled = false;
    if (verifyRestart) verifyRestart.disabled = false;
    if (verifyResend) verifyResend.disabled = Boolean(resendTimer);
    if (error) {
      setStatus(signInProblem(error, 'code'));
      return;
    }
    if (signInForm) signInForm.dataset.awaitingCode = 'no';
    verifyForm.reset();
    setStatus('Signed in.');
  });

  spaceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(spaceForm);
    const title = String(form.get('title') || '').trim();
    const locationGeneral = String(form.get('location_general') || '').trim();
    if (!title) {
      setStatus('Give the space a name so you can recognise it later.');
      return;
    }
    const locationProblem = generalLocationProblem(locationGeneral);
    if (locationProblem) {
      setStatus(locationProblem);
      spaceForm.querySelector('input[name="location_general"]')?.focus();
      return;
    }
    if (savingSpace) return;
    savingSpace = true;
    const savingUser = currentUserId;
    const submit = spaceForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('Saving space…');
    const result = await settled(
      supabase.rpc('create_space', {
        p_title: title,
        p_category: String(form.get('category') || '').trim() || null,
        p_location_general: locationGeneral || null,
      })
    );
    savingSpace = false;
    if (submit) submit.disabled = false;
    if (currentUserId !== savingUser) return;
    const error = result.error || (result.value && result.value.error);
    if (sessionGone(result)) {
      showSignedOut('Your sign-in has expired, so the space was not saved. Sign in again and retry.');
      return;
    }
    if (result.timedOut || error) {
      setStatus(result.timedOut ? 'The save was not confirmed. Refresh your spaces before trying again, so you do not create a duplicate.' : 'Could not save the space. Check the connection and try again.');
      return;
    }
    spaceForm.reset();
    setStatus('Space saved on this account.');
    await loadDesk(supabase);
  });

  // Every form on this desk says what is wrong beside the field it is wrong
  // in, on blur and again at submit, and keeps what was typed.
  for (const form of [signInForm, verifyForm, spaceForm]) {
    if (form) window.VeyletPlace?.inlineValidation?.(form, statusEl);
  }

  document.getElementById('account-refresh')?.addEventListener('click', () => { void loadDesk(supabase); });
  // Anything typed, ticked or armed in the list marks the desk as in use.
  list?.addEventListener('input', () => { deskDirty = true; });
  list?.addEventListener('click', () => { deskDirty = true; });
  spaceForm?.addEventListener('input', () => { deskDirty = true; });
  // Coming back to the tab is the moment people expect fresh status.
  let lastFocusLoad = 0;
  document.addEventListener?.('visibilitychange', () => {
    // A hidden tab stops reading render status; coming back reads it at once.
    if (document.hidden) { renderStop(); return; }
    if (!currentUserId) return;
    const now = Date.now();
    // When the desk does not reload, an annual plan that is waiting on Apple
    // or Square is read again on its own, and so is render status.
    if (deskDirty || !lastDesk || !lastDesk.rows.some(row => row.status === 'processing' || row.status === 'draft')
      || now - lastFocusLoad < 60000) { annualRecheck(); renderResume(); return; }
    lastFocusLoad = now; void loadDesk(supabase);
  });
  // Offline: stop reading and say how old the page is. Back online: read again, and
  // carry on polling; a person part-way through a form keeps it, and only the
  // capture status is read.
  window.addEventListener?.('offline', () => {
    if (!currentUserId || !deskShownAt) return;
    deskOffline();
  });
  window.addEventListener?.('online', () => {
    if (!currentUserId) return;
    if (!deskDirty) { void loadDesk(supabase); return; }
    if (render && render.ticket === deskVersion) { renderStop(); render.failures = 0; void renderRead(); } else renderSay('');
  });
  // Back from Apple's subscriptions page in another tab, or from Square checkout.
  window.addEventListener?.('focus', () => annualRecheck());
  window.addEventListener?.('pageshow', event => { if (event?.persisted) annualRecheck(true); });
  // Your own records, as a file. Metadata only: no link secrets, storage paths,
  // imagery or scene files. It is a convenience copy, not a backup of a tour.
  exportButton?.addEventListener('click', () => {
    if (!lastDesk || !currentUserId) { setStatus('Refresh your spaces first, then download your records.'); return; }
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) { setStatus('This browser cannot save the file. Try a current desktop browser.'); return; }
    const records = {
      exported_at: new Date().toISOString(), format: 'veylet-desk-records-1',
      note: 'Space and tour records visible to this account. No link secrets, storage paths, imagery or scene files are included.',
      spaces: lastDesk.properties.map(row => ({ id: row.id, title: row.title, category: row.category || null, general_location: row.location_general || null, created_at: row.created_at || null,
        tours: lastDesk.rows.filter(tour => tour.property_id === row.id).map(tour => ({ id: tour.id, status: tour.status, created_at: tour.created_at || null, has_active_link: Boolean(tour.share_token) && !tour.share_paused_at,
          walkthrough_id: walkthroughOf(tour), version: revisionOf(tour), replaced_at: tour.superseded_at || null })) })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'veylet-records-' + records.exported_at.slice(0, 10) + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Records saved as a file. It lists your spaces and tours; it does not contain the tours themselves.');
  });
  signOut?.addEventListener('click', async () => {
    signOut.disabled = true;
    const result = await settled(supabase.auth.signOut());
    signOut.disabled = false;
    if (failed(result)) { setStatus('Sign-out was not confirmed. Check the connection and try again before leaving this shared device.'); return; }
    showSignedOut('Signed out.');
  });
})().catch(() => {
  const el = document.getElementById('account-status');
  if (el) {
    el.textContent =
      'The account page could not start on this device. Check the connection and reload.';
  }
});
