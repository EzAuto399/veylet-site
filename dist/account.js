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
  const spaceForm = document.getElementById('account-space');
  const home = document.getElementById('account-home');
  const who = document.getElementById('account-who');
  const idEl = document.getElementById('account-id');
  const copyId = document.getElementById('account-copy-id');
  const list = document.getElementById('account-properties');
  const signOut = document.getElementById('account-sign-out');

  const TOUR_LABEL = {
    draft: 'Private draft — not shared',
    processing: 'Processing — not shared',
    ready: 'Ready on this account — create a handoff to share',
    revoked: 'Revoked',
  };

  let lastEmail = '';

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

  function tourLine(tour) {
    const label = TOUR_LABEL[tour.status] || tour.status;
    const when = tour.created_at ? new Date(tour.created_at).toISOString().slice(0, 10) : '';
    const share = tour.share_token ? 'handoff on' : 'not handed off';
    return [label, share, when].filter(Boolean).join(' · ');
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
    if (propsResult.error) {
      const li = document.createElement('li');
      li.textContent = 'Spaces could not load. Sign in again and retry.';
      list.append(li);
      return;
    }
    if (!properties || !properties.length) {
      const li = document.createElement('li');
      li.textContent = 'No spaces yet. Save a name above — suburb or city only.';
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
          const line = document.createElement('p');
          line.textContent = tourLine(tour);
          item.append(line);
          if (tour.status === 'ready' || tour.status === 'draft') {
            const actions = document.createElement('p');
            const preview = document.createElement('a');
            preview.href = '/play/?id=' + encodeURIComponent(tour.id);
            preview.textContent = 'Preview';
            actions.append(preview);
            if (tour.share_token) {
              const link = document.createElement('a');
              link.href = handoffUrl(tour.share_token);
              link.textContent = 'Open handoff';
              const copy = document.createElement('button');
              copy.type = 'button';
              copy.className = 'button button-ghost';
              copy.textContent = 'Copy link';
              copy.addEventListener('click', async () => {
                try {
                  await navigator.clipboard.writeText(handoffUrl(tour.share_token));
                  setStatus('Handoff link copied. Send it to your client.');
                } catch {
                  setStatus(handoffUrl(tour.share_token));
                }
              });
              const revoke = document.createElement('button');
              revoke.type = 'button';
              revoke.className = 'button button-ghost';
              revoke.textContent = 'Revoke';
              revoke.addEventListener('click', async () => {
                setStatus('Revoking handoff…');
                const result = await settled(
                  supabase.rpc('revoke_tour_share', { p_tour_id: tour.id })
                );
                setStatus(
                  result.timedOut || result.error || (result.value && result.value.error)
                    ? 'Could not revoke. Try again while signed in.'
                    : 'Handoff revoked. That link no longer opens.'
                );
                if (!result.timedOut && !result.error) await loadDesk(supabase);
              });
              actions.append(link, copy, revoke);
            } else {
              const enable = document.createElement('button');
              enable.type = 'button';
              enable.className = 'button';
              enable.textContent = 'Create client handoff';
              enable.addEventListener('click', async () => {
                setStatus('Creating handoff…');
                const result = await settled(
                  supabase.rpc('enable_tour_share', { p_tour_id: tour.id })
                );
                const data = result.value && result.value.data;
                const error = (result.value && result.value.error) || result.error;
                if (result.timedOut || error || !data) {
                  setStatus('Could not create a handoff. Try again while signed in.');
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

  supabase.auth.onAuthStateChange((_event, session) => {
    showSession(session);
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(signInForm);
    const email = String(form.get('email') || '').trim();
    const role_intent = String(form.get('role_intent') || 'owner');
    setStatus('Sending sign-in email…');
    const result = await settled(
      supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: 'https://veylet.com/auth/callback',
          data: { role_intent },
        },
      })
    );
    if (result.timedOut) {
      setStatus('No answer from the sign-in service. Check the connection and try again.');
      return;
    }
    const error = result.error || (result.value && result.value.error);
    if (error) {
      setStatus('Could not send the link. Check the email address and try again.');
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
    setStatus(
      'Check your email. Open the link there, or paste the six-digit code below — some mail scanners open links before you do.'
    );
  });

  verifyRestart?.addEventListener('click', () => {
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
      setStatus('That code did not work. Check the newest email, or send a new link.');
      return;
    }
    if (signInForm) signInForm.dataset.awaitingCode = 'no';
    verifyForm.reset();
    setStatus('Signed in.');
  });

  spaceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(spaceForm);
    setStatus('Saving space…');
    const result = await settled(
      supabase.rpc('create_space', {
        p_title: String(form.get('title') || '').trim(),
        p_category: String(form.get('category') || '').trim() || null,
        p_location_general: String(form.get('location_general') || '').trim() || null,
      })
    );
    const error = result.error || (result.value && result.value.error);
    if (result.timedOut || error) {
      setStatus('Could not save the space. Stay signed in and try again.');
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
