'use strict';
/*
 * Veylet desk: email sign-in plus the operator's own spaces and handoffs.
 * supabase-js loads from /vendor before this file, so there is no CDN module
 * import that can fail silently.
 */
(async () => {
  const cfg = window.VEYLET_SUPABASE;
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

  // A tour's state belongs in a pill, not in a sentence nobody reads twice.
  const TOUR_STATE = {
    draft: { label: 'Draft', tone: 'quiet' },
    processing: { label: 'Processing', tone: 'busy' },
    ready: { label: 'Processed', tone: 'good' },
    revoked: { label: 'Unavailable', tone: 'quiet' },
  };

  let lastEmail = '';
  let lastRoleIntent = 'owner';
  let currentUserId = null;
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
          emailRedirectTo: 'https://veylet.com/auth/callback' + tourQuery,
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
    if (intro) intro.textContent = signedIn ? 'Save a space, check its progress and share the reviewed tour.' : 'Use the same email on the website and capture app.';
    if (setup) setup.hidden = signedIn;
    if (access) access.hidden = signedIn;
  }
  function showSignedOut(message) {
    stopPolling(); lastDesk = null; rowNotice = null;
    if (updatedEl) updatedEl.textContent = '';
    resetSignInAttempt();
    sessionHeading(false);
    currentUserId = null;
    focusedTourForUser = null;
    deskVersion += 1;
    list?.replaceChildren();
    nextStep?.replaceChildren();
    planBody?.replaceChildren();
    planPanel?.setAttribute('aria-busy', 'false');
    deletionPanel?.replaceChildren();
    deletionPanel?.setAttribute('aria-busy', 'false');
    if (signInForm) {
      signInForm.dataset.awaitingCode = 'no';
      signInForm.hidden = false;
    }
    if (verifyForm) verifyForm.hidden = true;
    if (home) home.hidden = true;
    setStatus(message);
  }

  function pill(text, tone) {
    const span = document.createElement('span');
    span.className = 'pill' + (tone ? ' pill-' + tone : '');
    span.textContent = text;
    return span;
  }

  function tourMeta(tour) {
    const wrap = document.createElement('p');
    wrap.className = 'tour-meta-row';
    // A processed walkthrough whose link works is live; that one word is its state.
    if (tour.status === 'ready' && tour.share_token) wrap.append(pill('Live', 'good'));
    else {
      const state = TOUR_STATE[tour.status] || { label: tour.status, tone: 'quiet' };
      wrap.append(pill(state.label, state.tone));
      wrap.append(pill(tour.share_token ? 'Link created' : 'Private', tour.share_token ? 'good' : 'quiet'));
    }
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
    if (typeof action === 'string') {
      const link = document.createElement('a'); link.className = 'button button-ghost'; link.href = action; link.textContent = label; nextStep.append(link);
    } else nextStep.append(button(label, action));
  }

  // Guidance describes already-visible records. It never approves, uploads,
  // publishes or infers a payment from a tour's status or share token.
  function guideDesk(properties, rows, production, items, supabase) {
    if (!properties.length) {
      guide('Start with one space.', 'Save a name and general location. This prepares your desk; scope and a capture date are agreed with the studio separately.', 'Add your first space', () => {
        document.getElementById('account-add-space').open = true;
        spaceForm?.querySelector('input[name="title"]')?.focus();
      });
      return;
    }
    const visible = rows.filter(row => items.has(row.id));
    const selected = visible.find(row => row.id === requestedTour) ||
      ['ready', 'draft', 'processing', 'revoked'].flatMap(state => visible.filter(row => row.status === state))[0] || visible[0];
    if (selected) {
      // A shared walkthrough is finished work, not a job still waiting on you.
      if (selected.status === 'ready' && selected.share_token) {
        guide('Your walkthrough is live.',
          'Its link and website embed code are on this walkthrough below. Anyone with the link can open or forward it; Turn off sharing, under Manage sharing, stops it working. Removing it from a listing is a separate step.',
          'Open its sharing controls', () => {
            const item = items.get(selected.id); item.tabIndex = -1; item.focus({ preventScroll: true }); item.scrollIntoView({ block: 'start', behavior: 'auto' });
          });
        return;
      }
      const actions = {
        ready: ['Check your processed walkthrough.', 'Open the exact preview, then check and approve it below. Processing is not buyer acceptance or permission to share.', 'Check and approve'],
        draft: ['Check the draft with the studio.', 'Review the included areas and report corrections together. Keep the original capture while the studio prepares the next revision.', 'Open draft details'],
        processing: ['Your walkthrough is being processed.', 'You can leave this page and return later. Leaving does not cancel the work. The studio confirms the review date; refresh to check for an update.', 'Refresh progress'],
        revoked: ['Resolve the unavailable walkthrough.', 'New access is blocked. Remove old links or embeds and agree the next step with the studio before sharing again.', 'Open tour details'],
      };
      const [title, body, label] = actions[selected.status] || ['Check the status with the studio.', 'The current tour needs a studio update before you continue.', 'Open tour details'];
      guide(title, body, label, selected.status === 'processing' ? () => loadDesk(supabase) : () => {
        const item = items.get(selected.id); item.tabIndex = -1; item.focus({ preventScroll: true }); item.scrollIntoView({ block: 'start', behavior: 'auto' });
        // Where a review is actually available, open it and land on it.
        reviewOpeners.get(selected.id)?.();
      });
    } else if (failed(production)) {
      guide('Agree the capture route with the studio.', 'Your space is saved, but production approval could not be checked. Keep your existing capture and refresh before starting production work.', 'Refresh access', () => loadDesk(supabase));
    } else if (production.value?.data === true) {
      guide('Prepare one agreed capture.', 'Use your assessed device and the scope agreed with the studio. Inspect the saved photographs, keep the originals and confirm the transfer receipt before moving on.', 'See capture preparation', '/start#capture-partners');
    } else {
      guide('Prepare your first capture.', 'Your space is saved. Use Veylet Capture on a LiDAR iPhone or iPad and agree one practice route with the studio. Export the saved capture to Files or AirDrop, then use the private transfer route the studio confirms.', 'See your first-tour steps', '/start');
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
    if (rowNotice && rowNotice.tourId === tour.id) { line.textContent = rowNotice.text; line.hidden = false; rowNotice = null; }
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
    preview.href = '/play/?id=' + encodeURIComponent(tour.id) + (revision ? '&review_revision=' + encodeURIComponent(revision) : '');
    preview.textContent = revision ? 'Open review preview' : 'Preview';
    if (revision) { preview.target = '_blank'; preview.rel = 'noopener noreferrer'; }
    item.append(preview); return preview;
  }

  /*
   * Sharing, in the words the app uses too. Turning it on is the owner's own
   * press; turning it off is confirmed, then read back before it is announced.
   * Stopping sits under Manage sharing so it never shares a row with Copy link.
   */
  // `withPreview` puts the reviewer's Preview beside Turn on sharing, so the
  // walkthrough's two next moves read as one row rather than two.
  function turnOnSharing(tour, item, supabase, ticket, withPreview = false) {
    const actions = document.createElement('p'); actions.className = 'tour-actions-row'; item.append(actions);
    const enable = button('Turn on sharing', async () => {
      if (enable.disabled) return;
      enable.disabled = true;
      say('Turning on sharing…');
      const result = await settled(supabase.rpc('enable_tour_share', { p_tour_id: tour.id }));
      if (ticket !== deskVersion) return;
      if (sessionGone(result)) { showSignedOut('Your sign-in has expired. Sign in and check the walkthrough before retrying.'); return; }
      if (failed(result) || !result.value?.data) {
        say('Sharing was not confirmed. Refresh the desk to check its current state before retrying. Approval or permissions may have changed.');
        enable.disabled = false; return;
      }
      say('Sharing is on. Anyone with the link can open or forward it.', true);
      await loadDesk(supabase);
    });
    enable.classList.add('tour-action-primary'); actions.append(enable);
    if (withPreview) tourPreview(tour, actions);
    message(item, 'Anyone with the link can open or forward it. It is unlisted; check the listing and permissions are still current first.');
    const say = rowSay(tour, item);
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
  function liveSharing(tour, item) {
    const share = window.VeyletSharing;
    const url = share.handoffUrl(tour.share_token);
    const link = copyField('Link', 'input', url);
    const open = document.createElement('a'); open.className = 'tour-action'; open.href = url; open.textContent = 'Open as a visitor';
    const copyLink = button('Copy link', async () => {
      await share.copy(url, link.field, statusEl, 'Link copied. Anyone with it can open or forward the walkthrough.');
      if (statusEl?.textContent) say(statusEl.textContent);
    });
    copyLink.classList.add('tour-action-primary');
    const actions = document.createElement('p'); actions.className = 'tour-actions-row'; actions.append(copyLink, open);
    // The link and what you do with it share one row where there is room.
    const linkRow = document.createElement('div'); linkRow.className = 'tour-link-row';
    linkRow.append(link.label, actions); item.append(linkRow);
    const say = rowSay(tour, item);

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
    const code = share.embedCode(tour.share_token);
    const embed = copyField('Embed code', 'textarea', code);
    const copyCode = button('Copy embed code', async () => {
      await share.copy(code, embed.field, statusEl, 'Embed code copied. Paste it into your builder’s custom HTML block, then check the published page on a phone.');
      if (statusEl?.textContent) sayWeb(statusEl.textContent);
    });
    const guidePage = document.createElement('a'); guidePage.className = 'tour-action'; guidePage.href = '/website-guide'; guidePage.textContent = 'Full website guide';
    const codeActions = document.createElement('p'); codeActions.className = 'tour-actions-row'; codeActions.append(copyCode, guidePage);
    web.append(heading, chooser, steps, embed.label, codeActions);
    item.append(web);
    const sayWeb = rowSay(tour, web);
  }
  function manageSharing(item) {
    const details = document.createElement('details'); details.className = 'account-details tour-manage';
    const summary = document.createElement('summary'); summary.textContent = 'Manage sharing';
    details.append(summary); item.append(details); return details;
  }
  function stopSharing(tour, supabase, ticket, parent) {
    let armed = false;
    const revoke = button('Turn off sharing', async () => {
      if (revoke.disabled) return;
      if (!armed) {
        armed = true; revoke.textContent = 'Confirm: turn off sharing'; revoke.dataset.armed = 'true';
        say('Turning off sharing blocks new access to the link and embed. Downloaded copies cannot be recalled. Confirm to continue.');
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

  // `hosting` is this walkthrough's get_tour_hosting row: undefined when the
  // dates could not load. It only chooses words; it never gates a control.
  async function tourReview(tour, item, supabase, role, ticket, hosting) {
    const canReview = role === 'owner' || role === 'reviewer';
    const canShare = canReview || (role === 'operator' && tour.created_by === currentUserId);
    const say = rowSay(tour, item);
    const status = message(item, 'Checking approval…');
    const result = await settled(supabase.rpc('get_tour_review', { p_tour_id: tour.id }));
    if (ticket !== deskVersion) return;
    if (failed(result)) { status.textContent = 'Approval status is unavailable. Refresh to retry; this page cannot confirm that sharing is approved.'; if (canShare && tour.share_token) stopSharing(tour, supabase, ticket, item); return; }
    const review = firstRow(result.value?.data);
    if (review?.approved === true) {
      const live = Boolean(tour.share_token);
      if (live) {
        status.className = 'tour-state-help tour-hosting';
        status.textContent = window.VeyletSharing.hostingLine(hosting || null, true);
      } else {
        status.textContent = window.VeyletSharing.hostingLine(hosting || null, false) || (canShare
          ? 'Approved for sharing.' : 'Approved for sharing. The workspace owner or this walkthrough’s creator can turn sharing on.');
      }
      if (canShare) {
        if (live) liveSharing(tour, item); else turnOnSharing(tour, item, supabase, ticket, canReview);
      }
      const manage = (canShare && live) || canReview ? manageSharing(item) : null;
      if (manage && canShare && live) stopSharing(tour, supabase, ticket, manage);
      if (manage && canReview) withdrawApproval(tour, supabase, ticket, manage);
      return;
    }
    status.textContent = canReview ? 'Private preview only. Check this exact walkthrough before approving it for sharing.' : 'Awaiting the workspace owner’s approval. This walkthrough is not approved for sharing yet.';
    if (canShare && tour.share_token) stopSharing(tour, supabase, ticket, item);
    if (!canReview) return;
    const targetResult = await settled(supabase.rpc('get_tour_review_target', { p_tour_id: tour.id }));
    if (ticket !== deskVersion) return;
    if (sessionGone(targetResult)) { showSignedOut('Your sign-in expired. Sign in before starting a fresh review.'); return; }
    const target = firstRow(targetResult.value?.data);
    if (failed(targetResult) || target?.tour_id !== tour.id || target.storage_path !== tour.storage_path || !/^[a-f0-9]{64}$/.test(target.package_revision || '')) {
      status.textContent = 'The current package version could not be confirmed. Approval is unavailable; reload to start a fresh review.';
      item.append(button('Reload package review', () => loadDesk(supabase))); return;
    }
    // Capture before enabling preview or checks. Never replace this snapshot
    // during submission: the authoritative RPC rejects a changed object even
    // when its storage path is reused.
    const snapshot = Object.freeze({ path: target.storage_path, revision: target.package_revision });
    const preview = tourPreview(tour, item, snapshot.revision);
    const details = document.createElement('details'); details.className = 'tour-review';
    details.open = tour.id === requestedTour;
    const summary = document.createElement('summary'); summary.textContent = 'Check and approve this walkthrough'; details.append(summary);
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
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'button'; save.textContent = 'Approve for sharing'; form.append(save);
    // A failed check needs somewhere to go: one itemised request, not a thread
    // of separate emails. The message opens in the person's own mail app; nothing
    // is sent from this page and no approval is recorded.
    const corrections = document.createElement('a'); corrections.className = 'tour-action'; corrections.textContent = 'Request corrections by email';
    const correctionsHref = () => {
      const open = Object.keys(reviewChecks).filter(key => !fields[key].checked).map(key => '- ' + reviewChecks[key]);
      const body = ['Tour reference: ' + String(tour.id).slice(0, 8), 'Package: ' + snapshot.revision.slice(0, 12), '',
        'Checks that need correction:', ...(open.length ? open : ['- (tick the checks that pass, then use this link again)']), '',
        'Where it happens (captured view number, room or doorway):', '', 'Leave out street addresses and access details.'].join('\n');
      return 'mailto:yoda@yodalai.xyz?subject=' + encodeURIComponent('Veylet corrections · ' + String(tour.id).slice(0, 8)) + '&body=' + encodeURIComponent(body);
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
        const changed = reply.value?.error?.details === 'VEYLET_PACKAGE_REVISION_CHANGED';
        const capacityBlocked = ['VEYLET_PLAN_NOT_ACTIVE', 'VEYLET_WALKTHROUGH_CAPACITY_EXHAUSTED'].includes(reply.value?.error?.details);
        const sandboxBlocked = reply.value?.error?.details === 'VEYLET_SANDBOX_TEST_ONLY';
        const explanation = sandboxBlocked ? 'Test purchase · real walkthroughs require a live plan. This test subscription cannot accept production work or use a settled extra credit.' : changed ? 'The package changed. Your previous checks were cleared. Start a fresh review and open its preview before checking it again.' : capacityBlocked ? 'This walkthrough was not accepted. Refresh your plan allowance below and contact the studio to confirm available capacity or an agreed, settled extra. No charge was created. Start a fresh review after capacity is confirmed.' : 'Review was not confirmed. Your previous checks were cleared. Start a fresh review to check the current package and saved review state.';
        for (const field of Object.values(fields)) { field.checked = false; field.disabled = true; }
        preview.removeAttribute('href'); preview.setAttribute('aria-disabled', 'true'); preview.tabIndex = -1;
        status.textContent = explanation; say(explanation);
        item.append(button('Start a fresh review', () => loadDesk(supabase))); return;
      }
      say('Approved for sharing. Turning sharing on is a separate step.', true); await loadDesk(supabase);
    });
    details.append(form); item.append(details);
    reviewOpeners.set(tour.id, () => {
      details.open = true;
      summary.focus?.({ preventScroll: true });
      summary.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    });
  }

  /* ---- Your plan -------------------------------------------------------
   * Six free months with four walkthroughs included, started by activating the
   * plan, renewing afterwards unless cancelled. This panel only reports what
   * get_workspace_plan returns. An error means the state is unavailable — never
   * that it is empty, started or approved — and nothing here takes a card.
   */
  const planPanel = document.getElementById('account-plan');
  const planBody = document.getElementById('account-plan-body');
  const deletionPanel = document.getElementById('account-deletion');
  const PLAN_STATUSES = ['pending', 'trial', 'active', 'ended'];
  const PLAN_MONTH_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const PLAN_TERMS = ['State', 'Free walkthroughs', 'Renews', 'Hosting', 'Extra walkthroughs', 'Managed in'];
  // The State row says the state in the app's own short words; the date belongs
  // to the Renews row, and the full sentence to the body.
  const PLAN_STATE_WORDS = { pending: 'Not started', trial: 'Free months', active: 'Active', ended: 'Ended' };
  // Where the money is arranged decides which price is true for this account.
  const PLAN_SOURCES = ['studio', 'apple', 'web'];
  const PLAN_SOURCE_WORDS = { apple: 'App Store', web: 'Website', studio: 'Studio invoice' };
  // Plan code to the name customers see; plan code 'studio' is the Team plan.
  // The studio desk states the same names from the same table.
  const PLAN_NAMES = { solo: 'Solo', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  // App Store product to plan and cadence, as offer.json lists the product IDs.
  const APPLE_PRODUCTS = { 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] };
  const PLAN_DEFAULT_TRIAL_MONTHS = 6;
  const PLAN_DEFAULT_TRIAL_WALKTHROUGHS = 4;
  const PLAN_DASH = '—';
  const PLAN_TEST_ALLOWANCE = 'Production walkthroughs are not included in a sandbox subscription.';

  function planIsSandbox(row, capacity) {
    return (planSource(row) === 'apple' && row.apple_environment === 'Sandbox') || capacity?.reason_code === 'sandbox_test_only';
  }

  function planMonths(value) {
    const months = Number(value);
    return Number.isInteger(months) && months >= 1 && months <= 12 ? PLAN_MONTH_WORDS[months] : String(value ?? '');
  }
  function planCount(value) {
    if (value === null || value === undefined || value === '') return PLAN_DASH;
    const count = Number(value);
    return Number.isFinite(count) ? String(count) : PLAN_DASH;
  }
  /** Integer cents, written the way the invoice would: A$99, or A$99.50. */
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
  function planExtraPrice(row) {
    return planMoney(planSource(row) === 'apple' ? row.app_extra_walkthrough_aud_cents : row && row.extra_walkthrough_aud_cents);
  }
  function planDate(value) {
    if (!value) return '';
    const when = new Date(value);
    return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
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
      const renewal = row.auto_renews === false
        ? 'It ends on ' + until + ' and will not renew.'
        : row.auto_renews !== true ? 'Check your renewal setting with your billing provider.'
          : billing ? 'Renews on ' + until + ' at ' + billing + ' unless you cancel.'
            : 'Confirm the renewal amount and billing period with your billing provider before the free months end.';
      return { status, title: 'Free until ' + until,
        body: (sandbox ? PLAN_TEST_ALLOWANCE + ' ' : used + ' of ' + allowance + ' free walkthroughs used. ') + renewal };
    }
    if (status === 'active') {
      const billing = planBilling(row);
      const until = planDate(row.current_period_ends_at);
      if (!until) return unavailable;
      const renewal = row.auto_renews === false ? 'Ends ' + until + '; will not renew.'
        : row.auto_renews === true ? 'Next billing date: ' + until + '.'
          : 'Current period ends ' + until + '; check your renewal setting.';
      return { status, title: (sandbox ? 'Test subscription · ' : (PLAN_NAMES[planCode(row)] || 'Plan') + ' · ') + (billing || 'confirm billing details'),
        body: sandbox ? PLAN_TEST_ALLOWANCE + ' ' + renewal : (planInterval(row) === 'once' ? 'One walkthrough included in this paid service period. ' : accepted + ' walkthroughs this month. ') + renewal + ' Hosting included.' +
          (planInterval(row) === 'annual' ? ' Billed annually; the walkthrough allowance resets monthly.' : '') };
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
  // Waiting for a number is not a state. Show the rows that are coming.
  function planSkeleton() {
    if (!planPanel || !planBody) return;
    planPanel.setAttribute('aria-busy', 'true');
    const lead = document.createElement('p'); lead.className = 'plan-title';
    const leadBar = document.createElement('span'); leadBar.className = 'plan-skeleton plan-skeleton-lead';
    leadBar.setAttribute('aria-hidden', 'true');
    lead.append(leadBar);
    const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
    for (const term of PLAN_TERMS) {
      const bar = document.createElement('span'); bar.className = 'plan-skeleton';
      bar.setAttribute('aria-hidden', 'true');
      planHairline(dl, term, bar, false);
    }
    const note = document.createElement('p'); note.className = 'plan-body';
    note.textContent = 'Checking your free months and allowance…';
    planBody.replaceChildren(lead, dl, note);
  }
  function planWorkspaceName(id, props) {
    const properties = props && !failed(props) ? props.value?.data || [] : [];
    const match = properties.find(row => row.workspace_id === id);
    return match?.title || 'workspace ' + String(id || '').slice(0, 8);
  }
  async function renderPlan(supabase, ticket, props, members) {
    if (!planPanel || !planBody) return;
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
    if (memberships.length > 1) {
      const scope = document.createElement('p'); scope.className = 'plan-scope';
      scope.textContent = 'Showing ' + planWorkspaceName(workspaceID, props) + '. You are an active member of ' +
        memberships.length + ' workspaces; ask the studio to see another one here.';
      parts.push(scope);
    }
    const dl = document.createElement('dl'); dl.className = 'leaving-list plan-list';
    planHairline(dl, 'State', PLAN_STATE_WORDS[view.status] || PLAN_DASH, false);
    const source = planSource(row);
    const sandboxPlan = planIsSandbox(row);
    let usageCell = null;
    if (view.status === 'unavailable' || !row) {
      planHairline(dl, 'Free walkthroughs', PLAN_DASH, true);
      planHairline(dl, 'Renews', view.status === 'pending' ? 'Not started' : PLAN_DASH, true);
      planHairline(dl, 'Hosting', PLAN_DASH, false);
      planHairline(dl, 'Extra walkthroughs', PLAN_DASH, true);
      planHairline(dl, 'Managed in', PLAN_DASH, false);
    } else {
      // On the plan the month is the unit; before it, the four are the unit.
      if (sandboxPlan) {
        usageCell = planHairline(dl, 'Walkthroughs', 'Test subscription', false);
      } else if (view.status === 'active') {
        usageCell = planHairline(dl, planInterval(row) === 'once' ? 'Paid service period' : 'This month', planCount(row.accepted_this_period) + ' of ' + planCount(row.included_per_month) + ' accepted', true);
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
      const extra = planExtraPrice(row);
      planHairline(dl, 'Extra walkthroughs', source === 'apple' ? 'Not available in the current app' : extra ? extra + ' each, by agreement' : PLAN_DASH, true);
      planHairline(dl, 'Managed in', source ? PLAN_SOURCE_WORDS[source] : PLAN_DASH, false);
    }
    parts.push(dl);
    const body = document.createElement('p'); body.className = 'plan-body'; body.textContent = view.body;
    parts.push(body);
    if (row && !sandboxPlan && ['trial', 'active'].includes(view.status)) {
      const free = view.status === 'trial';
      const used = free ? row.accepted_in_free_months : row.accepted_this_period;
      const included = free ? row.trial_included_walkthroughs : row.included_per_month;
      if (Number.isInteger(used) && used >= 0 && Number.isInteger(included) && included >= 0) {
        const remaining = Math.max(0, included - used);
        const allowance = document.createElement('p');
        allowance.className = 'plan-allowance';
        allowance.textContent = remaining > 0
          ? remaining + ' included walkthrough' + (remaining === 1 ? '' : 's') + ' remaining ' + (free ? 'across your free months.' : planInterval(row) === 'once' ? 'in this paid service period.' : 'this month.')
          : 'Your included walkthroughs are used for ' + (free ? 'these free months.' : planInterval(row) === 'once' ? 'this paid service period.' : 'this month.');
        const scope = free ? ' Saving a space or a failed capture does not use one. Your free-months end date stays the same.'
          : planInterval(row) === 'once' ? ' This single walkthrough does not reset monthly.' : ' The allowance resets monthly; unused walkthroughs do not carry over.';
        allowance.textContent += scope;
        parts.push(allowance);
      }
      const extras = document.createElement('p'); extras.className = 'plan-scope';
      extras.textContent = source === 'apple'
        ? 'Extra walkthrough purchases are not available in the current app. Ask the studio about availability before sending another capture beyond your allowance.'
        : 'Need more walkthroughs? Ask the studio to agree the extra work and price in writing before processing. Saving another space does not authorize a charge. You can also compare monthly and annual billing for your next renewal.';
      parts.push(extras);
    }
    if (row?.apple_environment === 'Sandbox') {
      const sandbox = document.createElement('p'); sandbox.className = 'plan-scope';
      sandbox.textContent = 'Sandbox purchase: this is a test subscription, not a live payment.';
      parts.push(sandbox);
    }
    const actions = document.createElement('p'); actions.className = 'tour-actions-row plan-actions';
    if (view.status === 'unavailable') actions.append(button('Refresh plan status', () => loadDesk(supabase)));
    if (source === 'apple') {
      const manage = document.createElement('a'); manage.className = 'text-link';
      manage.href = 'https://apps.apple.com/account/subscriptions';
      manage.textContent = 'Manage or cancel in the App Store'; actions.append(manage);
      const note = document.createElement('p'); note.className = 'plan-scope';
      note.textContent = 'Manage in Settings › Subscriptions, or use the link below with the Apple Account that purchased the plan. Apple confirms any price, trial eligibility and effective date before a change.';
      parts.push(note);
    } else if (['pending', 'ended'].includes(view.status) && source !== 'studio' && source !== 'web') {
      const how = document.createElement('p'); how.className = 'plan-scope';
      how.textContent = 'Review the plan in the app; Apple checks introductory-offer eligibility. Install Veylet Capture and sign in with this email. ' +
        'The App Store confirms the price and billing period before you subscribe. This website cannot take a card yet.';
      parts.push(how);
    }
    if (view.status !== 'unavailable') {
      const offer = document.createElement('a'); offer.className = 'text-link';
      offer.href = '/offer'; offer.textContent = ['trial', 'active'].includes(view.status) ? 'Compare monthly and annual billing' : 'See the offer';
      actions.append(offer);
    }
    if (source === 'studio' || source === 'web') {
      const ask = document.createElement('a'); ask.className = 'text-link';
      ask.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan';
      ask.textContent = ['pending', 'ended'].includes(view.status) ? 'Ask the studio about a plan' : 'Request a plan change or cancellation';
      actions.append(ask);
      const note = document.createElement('p'); note.className = 'plan-scope';
      note.textContent = 'Invoiced plans are managed by the studio. This opens an email; it does not change your plan. The studio confirms the agreed amount, billing period and effective date in writing. Website card checkout is not available.';
      parts.push(note);
    }
    if (actions.children.length) parts.push(actions);
    const capacity = document.createElement('div'); capacity.className = 'plan-capacity';
    if (workspaceID && row) {
      const checking = document.createElement('p'); checking.className = 'plan-scope';
      checking.textContent = 'Checking acceptance capacity and settled extra credits…';
      capacity.append(checking); parts.push(capacity);
    }
    planBody.replaceChildren(...parts);
    if (workspaceID && row) {
      const reply = await settled(supabase.rpc('get_walkthrough_capacity', { p_workspace_id: workspaceID }));
      if (ticket !== deskVersion) return;
      const cap = !failed(reply) ? firstRow(reply.value?.data) : null;
      const numbers = ['included_limit', 'included_used', 'included_remaining', 'extra_credits_available'];
      const valid = cap && typeof cap === 'object' && numbers.every(key => Number.isInteger(cap[key]) && cap[key] >= 0) &&
        typeof cap.can_accept === 'boolean' && (cap.reason_code === null || typeof cap.reason_code === 'string') &&
        [...PLAN_STATUSES, 'unavailable'].includes(cap.plan_status) && cap.included_remaining === Math.max(0, cap.included_limit - cap.included_used);
      const note = document.createElement('p'); note.className = 'plan-scope';
      if (!valid) {
        note.textContent = sandboxPlan ? 'Test subscription capacity could not be verified. ' + PLAN_TEST_ALLOWANCE
          : 'Live acceptance capacity and extra-credit balance could not be verified. The plan counts above are the last reported totals; ask the studio before sending work beyond the included allowance.';
        capacity.replaceChildren(note); return;
      }
      // The acceptance ledger is authoritative. A plan count alone does not
      // distinguish an included unit from a previously settled extra.
      for (const part of parts) if (part.className === 'plan-allowance') part.hidden = true;
      if (planIsSandbox(row, cap)) {
        if (usageCell) usageCell.textContent = 'Test subscription';
        body.textContent = planVocabulary(row, true).body;
        note.textContent = 'Test purchase · real walkthroughs require a live plan. This sandbox subscription can test entitlement and renewal behavior, but it cannot accept production work or spend a settled extra credit.';
        capacity.replaceChildren(note); return;
      }
      if (usageCell && ['trial', 'active'].includes(cap.plan_status)) usageCell.textContent = cap.included_used + ' of ' + cap.included_limit + ' included accepted';
      if (cap.plan_status === 'trial') body.textContent = view.body.replace(/^.*?free walkthroughs used\./, cap.included_used + ' of ' + cap.included_limit + ' included free walkthroughs used.');
      const balance = document.createElement('p'); balance.className = 'plan-allowance';
      balance.textContent = cap.included_remaining + ' included walkthrough' + (cap.included_remaining === 1 ? '' : 's') +
        ' remaining · ' + cap.extra_credits_available + ' settled extra credit' + (cap.extra_credits_available === 1 ? '' : 's') + ' available.';
      if (cap.can_accept) {
        note.textContent = 'Capacity is available for acceptance after the quality and permission checks pass. ' +
          (cap.included_remaining === 0 ? 'The next new walkthrough uses one settled extra credit. ' : '') +
          'Saving a space and correcting the same accepted walkthrough do not use another unit. A new walkthrough, including another of the same property, uses one unit.';
      } else if (cap.reason_code === 'allowance_exhausted') {
        note.textContent = 'Your included allowance is used and no settled extra credit is available. Contact the studio to agree and settle an extra before another walkthrough can be accepted. No automatic charge or debt is created.' + (cap.plan_status === 'trial' ? ' Your trial end date stays the same.' : '');
      } else {
        note.textContent = 'New walkthrough acceptance is paused until your plan and paid service dates are confirmed. Contact the studio; existing reviewed work is unchanged. A settled extra credit does not activate an expired or unverified plan.';
      }
      const action = document.createElement('a'); action.className = 'text-link';
      action.href = 'mailto:yoda@yodalai.xyz?subject=Veylet%20walkthrough%20capacity';
      action.textContent = cap.can_accept ? 'Ask about another walkthrough' : 'Resolve walkthrough capacity with the studio';
      capacity.replaceChildren(balance, note, action);
    }
  }

  /* ---- Deleting your account -------------------------------------------
   * Asked for here or in the app, completed by the studio within 30 days. This
   * panel reports only what get_account_deletion returns: an unanswered check
   * is unavailable, never "nothing requested" and never "already going", so
   * nothing here can imply an account is safe or a deletion is under way. The
   * two writes are read back before their result is stated.
   */
  const DELETION_STATUSES = ['requested', 'processing', 'cancelled', 'completed'];
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
        setStatus('The deletion request was not confirmed. Check again before asking a second time.');
        deletionUnavailable(supabase, 'The deletion request was not confirmed. Check again before asking a second time.');
        return;
      }
      setStatus('Deletion requested. We complete it within 30 days.');
      await renderDeletion(supabase, deskVersion);
    });
    remove.classList.add('tour-action-danger');
    remove.dataset.armed = 'true';
    const keep = button('Keep my account', () => { setStatus('Your account is unchanged.'); deletionIdle(supabase); });
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
      deletionShow(deletionNote('Deletion is in progress. Account access is paused while the studio completes removal. Contact support if you need an update.'));
      return;
    }
    if (row.status !== 'requested') { deletionIdle(supabase); return; }
    const when = planDate(row.requested_at);
    if (!when) {
      deletionUnavailable(supabase, 'A deletion has been requested, but its date could not be read. Check again, or ask the studio before anything else.');
      return;
    }
    deletionRequested(supabase, when);
  }

  async function loadDesk(supabase) {
    if (!list || !currentUserId) return;
    const ticket = ++deskVersion;
    const loadingUser = currentUserId;
    stopPolling(); deskDirty = false; reviewOpeners.clear();
    planSkeleton();
    guide('Checking your next step…', 'Loading your spaces, tour progress and workspace access.');
    targetMessage(requestedTour ? 'Finding the requested walkthrough in this account…' : invalidTourTarget
      ? 'This review link is incomplete. Use Review again from the app, or choose an available tour below.' : '');
    list.replaceChildren(); list.setAttribute('aria-busy', 'true');
    const [props, tours, members, production, hosting] = await Promise.all([
      settled(supabase.from('properties').select('id,title,category,location_general,workspace_id,created_at').order('created_at', { ascending: false })),
      settled(supabase.from('tours').select('id,status,property_id,created_by,created_at,share_token,storage_path').order('created_at', { ascending: false })),
      settled(supabase.from('memberships').select('workspace_id,role,status').eq('user_id', currentUserId).eq('status', 'active')),
      settled(supabase.rpc('can_produce_tours')),
      // A throwing client still settles, so hosting can never stop the desk.
      settled(Promise.resolve().then(() => supabase.rpc('get_tour_hosting', {}))),
    ]);
    if (ticket !== deskVersion) return;
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
    if (gateTitle) gateTitle.textContent = production.value?.data === true ? 'Production access approved.' : failed(production) ? 'Production approval could not be checked.' : 'Your account is ready. Capture approval is separate.';
    if (gateBody) gateBody.textContent = production.value?.data === true ? 'Use your approved capture workflow. Every tour still needs quality review and publication permission before sharing.' : 'You can save a space and prepare a practice capture. Client work needs the studio’s device and practice assessment first.';
    if (failed(props)) { guide('Reload your spaces.', 'Your saved work could not be checked. Refresh before creating another space or repeating an upload.', 'Refresh spaces', () => loadDesk(supabase)); targetMessage(requestedTour ? 'The requested walkthrough could not be checked. Refresh spaces to try again.' : ''); message(list, 'Spaces could not load. Refresh the desk to try again.'); return; }
    if (failed(tours)) { message(list, 'Tour status could not load. Your spaces are shown below, but the tour list is unavailable. Refresh to retry.'); }
    const properties = props.value?.data || [];
    const addSpace = document.getElementById('account-add-space');
    if (addSpace) addSpace.open = properties.length === 0;
    const rows = failed(tours) ? [] : tours.value?.data || [];
    lastDesk = failed(tours) ? null : { properties, rows };
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
    // Hosting dates only choose the words on a live card. A failed or malformed
    // answer makes each live card say so; it never holds up or blocks sharing.
    const hostingRows = failed(hosting) || !Array.isArray(hosting.value?.data) ? null
      : new Map(hosting.value.data.filter(row => row && typeof row === 'object' && row.tour_id).map(row => [row.tour_id, row]));
    if (failed(members)) message(list, 'Workspace permissions could not load. Review and sharing actions are unavailable until you refresh.');
    const items = new Map();
    const updateGuide = () => {
      if (failed(tours) || failed(members)) guide('Refresh your walkthrough status.', 'Some progress or workspace permissions could not load. Refresh before repeating work or turning on sharing.', 'Refresh status', () => loadDesk(supabase));
      else guideDesk(properties, rows, production, items, supabase);
    };
    if (!properties.length) { updateGuide(); message(list, 'Start by saving a space above. Then arrange your capture and studio processing. Keep the same email on the website and app.'); return; }
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
      const spaceTours = rows.filter(tour => tour.property_id === row.id);
      if (!spaceTours.length && !failed(tours)) message(li, 'No tour package yet. The studio processes the saved capture before the finished package is sent to this space.');
      const ul = document.createElement('ul'); ul.className = 'dash-tours';
      for (const tour of spaceTours) {
        const item = document.createElement('li'); item.className = 'dash-tour'; item.append(tourMeta(tour));
        items.set(tour.id, item);
        if (tour.id === requestedTour) {
          requestedItem = item;
          item.id = 'requested-tour'; item.tabIndex = -1;
          item.setAttribute('aria-label', 'Walkthrough opened from your capture');
          message(item, 'Opened from your capture. Check this walkthrough before approving it for sharing.');
        }
        const reviewRole = ['owner', 'reviewer'].includes(roles.get(row.workspace_id));
        if (tour.storage_path && tour.status === 'ready' && !reviewRole) tourPreview(tour, item);
        if (tour.status === 'ready' && tour.storage_path && roles.has(row.workspace_id)) {
          reviewLoads.push(tourReview(tour, item, supabase, roles.get(row.workspace_id), ticket, hostingRows ? hostingRows.get(tour.id) || null : undefined).catch(() => { if (ticket === deskVersion) message(item, 'Review could not load. Refresh the desk.'); }));
        } else if (tour.status === 'draft') {
          // The state first, then the one thing to do about it.
          message(item, 'Draft: inspect the preview and report corrections. Sharing is unavailable until processing and approval are complete.');
          if (tour.storage_path) tourPreview(tour, item);
        }
        else if (tour.status === 'processing') message(item, 'Processing with the studio. You can leave this page and refresh later; leaving does not cancel the job.');
        else if (tour.status === 'revoked') message(item, 'This walkthrough is unavailable for new access. Remove any old links or embeds from your listing, and talk to the studio about the next step.');
        ul.append(item);
      }
      li.append(ul); list.append(li);
    }
    updateGuide();
    if (requestedItem) {
      targetMessage('The walkthrough from your capture is selected below.');
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
      focusedTourForUser = null;
      deskVersion += 1;
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
    currentUserId = session.user.id;
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
    if (document.hidden || !currentUserId || deskDirty || !lastDesk) return;
    if (!lastDesk.rows.some(row => row.status === 'processing' || row.status === 'draft')) return;
    const now = Date.now(); if (now - lastFocusLoad < 60000) return;
    lastFocusLoad = now; void loadDesk(supabase);
  });
  // Your own records, as a file. Metadata only: no link secrets, storage paths,
  // imagery or scene files. It is a convenience copy, not a backup of a tour.
  exportButton?.addEventListener('click', () => {
    if (!lastDesk || !currentUserId) { setStatus('Refresh your spaces first, then download your records.'); return; }
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) { setStatus('This browser cannot save the file. Try a current desktop browser.'); return; }
    const records = {
      exported_at: new Date().toISOString(), format: 'veylet-desk-records-1',
      note: 'Space and tour records visible to this account. No link secrets, storage paths, imagery or scene files are included.',
      spaces: lastDesk.properties.map(row => ({ id: row.id, title: row.title, category: row.category || null, general_location: row.location_general || null, created_at: row.created_at || null,
        tours: lastDesk.rows.filter(tour => tour.property_id === row.id).map(tour => ({ id: tour.id, status: tour.status, created_at: tour.created_at || null, has_active_link: Boolean(tour.share_token) })) })),
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
