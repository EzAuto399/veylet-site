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
  const gateTitle = document.getElementById('account-gate-title');
  const gateBody = document.getElementById('account-gate-body');
  const spaceForm = document.getElementById('account-space');
  const home = document.getElementById('account-home');
  const who = document.getElementById('account-who');
  const idEl = document.getElementById('account-id');
  const copyId = document.getElementById('account-copy-id');
  const list = document.getElementById('account-properties');
  const signOut = document.getElementById('account-sign-out');

  // A tour's state belongs in a pill, not in a sentence nobody reads twice.
  const TOUR_STATE = {
    draft: { label: 'Draft', tone: 'quiet' },
    processing: { label: 'Processing', tone: 'busy' },
    ready: { label: 'Ready', tone: 'good' },
    revoked: { label: 'Revoked', tone: 'quiet' },
  };

  let lastEmail = '';
  let resendTimer = null;

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
        verifyResend.disabled = false;
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

  async function requestLink(email) {
    const result = await settled(
      supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'https://veylet.com/auth/callback',
          data: { role_intent: 'operator' },
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

  function showSignedOut(message) {
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
    const state = TOUR_STATE[tour.status] || { label: tour.status, tone: 'quiet' };
    wrap.append(pill(state.label, state.tone));
    wrap.append(pill(tour.share_token ? 'Handoff on' : 'Not handed off', tour.share_token ? 'good' : 'quiet'));
    if (tour.created_at) {
      const when = document.createElement('span');
      when.className = 'tour-when';
      when.textContent = new Date(tour.created_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      wrap.append(when);
    }
    return wrap;
  }

  function handoffUrl(token) {
    return 'https://veylet.com/handoff?t=' + encodeURIComponent(token);
  }

  async function loadDesk(supabase) {
    if (!list) return;
    list.replaceChildren();
    const [props, tours] = await Promise.all([
      settled(
        supabase
          .from('properties')
          .select('id,title,category,location_general,created_at')
          .order('created_at', { ascending: false })
      ),
      settled(
        supabase
          .from('tours')
          .select('id,status,property_id,created_at,share_token,storage_path')
          .order('created_at', { ascending: false })
      ),
    ]);

    const propsResult = props.value || {};
    const toursResult = tours.value || {};
    const properties = propsResult.data;
    const tourRows = toursResult.error ? [] : toursResult.data || [];

    if (props.timedOut || tours.timedOut) {
      const li = document.createElement('li');
      li.textContent = 'The desk did not answer. Check the connection and reload.';
      list.append(li);
      return;
    }
    if (sessionGone(props) || sessionGone(tours)) {
      showSignedOut('Your sign-in has expired. Enter your email for a new link — nothing on this account was changed.');
      return;
    }
    if (propsResult.error) {
      const li = document.createElement('li');
      li.textContent = 'Spaces could not load. Reload the page and try again.';
      list.append(li);
      return;
    }
    if (!properties || !properties.length) {
      const li = document.createElement('li');
      li.className = 'dash-empty';
      li.textContent =
        'Nothing here yet. A space is just a name you will recognise — the property, venue or room you are about to capture. Save one above, then send it a tour from Veylet Capture on the iPhone.';
      list.append(li);
      return;
    }

    const byProperty = new Map();
    for (const tour of tourRows) {
      const bucket = byProperty.get(tour.property_id) || [];
      bucket.push(tour);
      byProperty.set(tour.property_id, bucket);
    }

    for (const row of properties) {
      const li = document.createElement('li');
      li.className = 'dash-space';
      const title = document.createElement('strong');
      title.textContent = [row.title, row.category, row.location_general]
        .filter(Boolean)
        .join(' · ');
      li.append(title);
      const spaceTours = byProperty.get(row.id) || [];
      if (!spaceTours.length) {
        const p = document.createElement('p');
        p.textContent =
          'No tour from Veylet Capture on this space yet. Send one from the app, then reload this page.';
        li.append(p);
      } else {
        const ul = document.createElement('ul');
        for (const tour of spaceTours) {
          const item = document.createElement('li');
          item.append(tourMeta(tour));
          if (tour.status === 'ready' || tour.status === 'draft') {
            const actions = document.createElement('p');
            actions.className = 'tour-actions-row';
            const preview = document.createElement('a');
            preview.href = '/play/?id=' + encodeURIComponent(tour.id);
            preview.textContent = 'Preview';
            preview.className = 'tour-action';
            actions.append(preview);
            if (tour.share_token) {
              const link = document.createElement('a');
              link.href = handoffUrl(tour.share_token);
              link.textContent = 'Open handoff';
              link.className = 'tour-action';
              const copy = document.createElement('button');
              copy.type = 'button';
              copy.className = 'tour-action';
              copy.textContent = 'Copy link';
              copy.addEventListener('click', async () => {
                const url = handoffUrl(tour.share_token);
                try {
                  await navigator.clipboard.writeText(url);
                  setStatus('Handoff link copied. Send it to your client.');
                } catch {
                  // Clipboard can be blocked; show the link so it can still be selected.
                  setStatus(url);
                }
              });
              const embed = document.createElement('button');
              embed.type = 'button';
              embed.className = 'tour-action';
              embed.textContent = 'Copy embed';
              embed.addEventListener('click', async () => {
                const code =
                  '<iframe src="https://veylet.com/embed?t=' +
                  encodeURIComponent(tour.share_token) +
                  '" title="Veylet walkthrough" style="width:100%;aspect-ratio:16 / 9;min-height:480px;border:0" allow="fullscreen" loading="lazy"></iframe>';
                try {
                  await navigator.clipboard.writeText(code);
                  setStatus(
                    'Embed code copied. It plays the same private tour and stops when you revoke.'
                  );
                } catch {
                  setStatus(code);
                }
              });
              const revoke = document.createElement('button');
              revoke.type = 'button';
              revoke.className = 'tour-action tour-action-quiet';
              revoke.textContent = 'Revoke';
              // Revoking kills a link a client may be holding, so it takes two taps and
              // the second one has to come quickly.
              let armed = false;
              let disarm = null;
              revoke.addEventListener('click', async () => {
                if (!armed) {
                  armed = true;
                  revoke.textContent = 'Tap again to revoke';
                  setStatus(
                    'Revoking stops the client link working straight away. Tap again to confirm.'
                  );
                  disarm = setTimeout(() => {
                    armed = false;
                    revoke.textContent = 'Revoke';
                  }, 6000);
                  return;
                }
                if (disarm) clearTimeout(disarm);
                setStatus('Revoking handoff…');
                const result = await settled(
                  supabase.rpc('revoke_tour_share', { p_tour_id: tour.id })
                );
                if (sessionGone(result)) {
                  showSignedOut('Your sign-in has expired, so nothing was revoked. Sign in again and retry.');
                  return;
                }
                setStatus(
                  result.timedOut || result.error || (result.value && result.value.error)
                    ? 'Could not revoke. Check the connection and try again.'
                    : 'Handoff revoked. That link no longer opens.'
                );
                if (!result.timedOut && !result.error) await loadDesk(supabase);
              });
              actions.append(link, copy, embed, revoke);
            } else {
              const enable = document.createElement('button');
              enable.type = 'button';
              enable.className = 'tour-action tour-action-primary';
              enable.textContent = 'Create client handoff';
              enable.addEventListener('click', async () => {
                setStatus('Creating handoff…');
                const result = await settled(
                  supabase.rpc('enable_tour_share', { p_tour_id: tour.id })
                );
                const data = result.value && result.value.data;
                const error = (result.value && result.value.error) || result.error;
                if (sessionGone(result)) {
                  showSignedOut('Your sign-in has expired, so no link was created. Sign in again and retry.');
                  return;
                }
                if (result.timedOut || error || !data) {
                  setStatus('Could not create a handoff. Check the connection and try again.');
                  return;
                }
                setStatus('Handoff link ready. Copy it from this space.');
                await loadDesk(supabase);
              });
              actions.append(enable);
            }
            item.append(actions);
          }
          ul.append(item);
        }
        li.append(ul);
      }
      list.append(li);
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
      if (signInForm) signInForm.hidden = signInForm.dataset.awaitingCode === 'yes';
      if (verifyForm) verifyForm.hidden = signInForm?.dataset.awaitingCode !== 'yes';
      if (home) home.hidden = true;
      setStatus(
        location.pathname.startsWith('/auth/')
          ? 'Sign-in did not complete. Request a new email link.'
          : 'Not signed in yet. Your email link signs in this website and the iPhone app.'
      );
      return;
    }
    if (signInForm) signInForm.hidden = true;
    if (verifyForm) verifyForm.hidden = true;
    if (home) home.hidden = false;
    if (who) who.textContent = session.user.email || 'signed in';
    if (gateTitle) gateTitle.textContent = 'This is an email account, not an operator licence.';
    if (gateBody) {
      gateBody.textContent =
        'Capturing spaces for clients needs assessment of your device and a practice capture first. Until that is approved you can save spaces and preview your own tours, but nothing reaches a client.';
    }
    if (idEl) idEl.textContent = 'Account id: ' + session.user.id;
    setStatus('Signed in. This is not operator approval, payment, or a shared client tour.');
    if (location.pathname.startsWith('/auth/')) {
      location.replace('/account');
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

  const { data } = await settled(supabase.auth.getSession());
  if (data?.timedOut) {
    setStatus('Sign-in could not be checked. Check the connection and reload.');
  } else {
    await showSession(data?.value?.data?.session || null);
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !session) {
      showSignedOut('Signed out. Enter your email for a new sign-in link.');
      return;
    }
    showSession(session);
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(signInForm);
    const email = String(form.get('email') || '').trim();
    const role_intent = String(form.get('role_intent') || 'owner');
    const shapeOk = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(email);
    if (!shapeOk || email.length > 200) {
      setStatus('That does not look like an email address. Check it for a typo and try again.');
      return;
    }
    setStatus('Sending sign-in email…');
    if (signInSubmit) signInSubmit.disabled = true;
    const error = await requestLink(email, role_intent);
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
    if (signInForm) signInForm.dataset.awaitingCode = 'yes';
    signInForm.hidden = true;
    if (verifyEmail) verifyEmail.textContent = email;
    if (verifyForm) {
      verifyForm.hidden = false;
      verifyForm.querySelector('input[name="token"]')?.focus();
    }
    startResendCooldown(45);
    setStatus(
      'Check your email. Open the link on this device, or type the six-digit code below — some mail scanners open links before you do. If this is your first time, that link creates the account.'
    );
  });

  verifyResend?.addEventListener('click', async () => {
    if (!lastEmail) {
      setStatus('Enter the email address you want the link sent to.');
      return;
    }
    setStatus('Sending another sign-in email…');
    verifyResend.disabled = true;
    const error = await requestLink(lastEmail);
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
    stopResendCooldown();
    if (signInForm) {
      signInForm.dataset.awaitingCode = 'no';
      signInForm.hidden = false;
    }
    if (verifyForm) verifyForm.hidden = true;
    setStatus('Enter the email address you want the link sent to.');
  });

  verifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(verifyForm);
    const token = String(form.get('token') || '').replace(/\D/g, '');
    if (token.length !== 6 || !lastEmail) {
      setStatus('Enter the six-digit code from the email.');
      return;
    }
    setStatus('Checking the code…');
    const result = await settled(
      supabase.auth.verifyOtp({ email: lastEmail, token, type: 'email' })
    );
    const error = result.error || (result.value && result.value.error);
    if (result.timedOut || error) {
      setStatus(
        result.timedOut
          ? 'No answer from the sign-in service. Check the connection and try again.'
          : signInProblem(error, 'code')
      );
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
    setStatus('Saving space…');
    const result = await settled(
      supabase.rpc('create_space', {
        p_title: title,
        p_category: String(form.get('category') || '').trim() || null,
        p_location_general: locationGeneral || null,
      })
    );
    const error = result.error || (result.value && result.value.error);
    if (sessionGone(result)) {
      showSignedOut('Your sign-in has expired, so the space was not saved. Sign in again and retry.');
      return;
    }
    if (result.timedOut || error) {
      setStatus('Could not save the space. Check the connection and try again.');
      return;
    }
    spaceForm.reset();
    setStatus('Space saved on this account.');
    await loadDesk(supabase);
  });

  signOut?.addEventListener('click', async () => {
    await settled(supabase.auth.signOut());
    setStatus('Signed out.');
  });
})().catch(() => {
  const el = document.getElementById('account-status');
  if (el) {
    el.textContent =
      'The account page could not start on this device. Check the connection and reload.';
  }
});
