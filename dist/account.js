import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.VEYLET_SUPABASE;
const statusEl = document.getElementById('account-status');
const signInForm = document.getElementById('account-sign-in');
const spaceForm = document.getElementById('account-space');
const home = document.getElementById('account-home');
const who = document.getElementById('account-who');
const idEl = document.getElementById('account-id');
const list = document.getElementById('account-properties');
const signOut = document.getElementById('account-sign-out');

const TOUR_LABEL = {
  draft: 'Private draft — not shared',
  processing: 'Processing — not shared',
  ready: 'Ready on this account — client share is not live',
  revoked: 'Revoked',
};

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function tourLine(tour) {
  const label = TOUR_LABEL[tour.status] || tour.status;
  const when = tour.created_at ? new Date(tour.created_at).toISOString().slice(0, 10) : '';
  const share = tour.share_token ? 'handoff on' : 'not handed off';
  return [label, share, when].filter(Boolean).join(' · ');
}

function handoffUrl(token) {
  return 'https://veylet.com/handoff/?t=' + encodeURIComponent(token);
}

async function loadDesk(supabase) {
  if (!list) return;
  list.replaceChildren();
  const [{ data: properties, error: propErr }, { data: tours, error: tourErr }] =
    await Promise.all([
      supabase
        .from('properties')
        .select('id,title,category,location_general,created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('tours')
        .select('id,status,property_id,created_at,share_token')
        .order('created_at', { ascending: false }),
    ]);
  if (propErr) {
    const li = document.createElement('li');
    li.textContent = 'Spaces could not load. Try again after the email link.';
    list.append(li);
    return;
  }
  if (!properties?.length) {
    const li = document.createElement('li');
    li.textContent = 'No spaces yet. Save a name above (suburb or city only).';
    list.append(li);
    return;
  }
  const byProperty = new Map();
  if (!tourErr && tours) {
    for (const tour of tours) {
      const bucket = byProperty.get(tour.property_id) || [];
      bucket.push(tour);
      byProperty.set(tour.property_id, bucket);
    }
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
      p.textContent = 'No reconstructed tour on this account yet.';
      li.append(p);
    } else {
      const ul = document.createElement('ul');
      for (const tour of spaceTours) {
        const item = document.createElement('li');
        const line = document.createElement('p');
        line.textContent = tourLine(tour);
        item.append(line);
        if (tour.status === 'ready') {
          const actions = document.createElement('p');
          if (tour.share_token) {
            const link = document.createElement('a');
            link.href = handoffUrl(tour.share_token);
            link.textContent = 'Open handoff link';
            const revoke = document.createElement('button');
            revoke.type = 'button';
            revoke.className = 'button button-ghost';
            revoke.textContent = 'Revoke';
            revoke.addEventListener('click', async () => {
              setStatus('Revoking handoff…');
              const { error } = await supabase.rpc('revoke_tour_share', {
                p_tour_id: tour.id,
              });
              setStatus(error ? 'Could not revoke.' : 'Handoff revoked.');
              if (!error) await loadDesk(supabase);
            });
            actions.append(link, revoke);
          } else {
            const enable = document.createElement('button');
            enable.type = 'button';
            enable.className = 'button';
            enable.textContent = 'Create client handoff';
            enable.addEventListener('click', async () => {
              setStatus('Creating handoff…');
              const { data, error } = await supabase.rpc('enable_tour_share', {
                p_tour_id: tour.id,
              });
              if (error || !data) {
                setStatus('Could not create a handoff. Tour must be ready.');
                return;
              }
              setStatus('Handoff link ready. Copy it from the space below.');
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

if (!cfg?.url || !cfg?.anonKey) {
  setStatus('Account service is not configured.');
} else {
  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  async function showSession(session) {
    if (!session?.user) {
      if (signInForm) signInForm.hidden = false;
      if (home) home.hidden = true;
      if (location.pathname.startsWith('/auth/')) {
        setStatus('Sign-in did not complete. Request a new email link.');
      }
      return;
    }
    if (signInForm) signInForm.hidden = true;
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

  const { data } = await supabase.auth.getSession();
  await showSession(data.session);

  supabase.auth.onAuthStateChange((_event, session) => {
    showSession(session);
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(signInForm);
    const email = String(form.get('email') || '').trim();
    const role_intent = String(form.get('role_intent') || 'owner');
    setStatus('Sending sign-in email…');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: 'https://veylet.com/account',
        data: { role_intent },
      },
    });
    setStatus(
      error
        ? 'Could not send the link. Check the email and try again.'
        : 'Check your email for a Veylet sign-in link.'
    );
  });

  spaceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(spaceForm);
    setStatus('Saving space…');
    const { error } = await supabase.rpc('create_space', {
      p_title: String(form.get('title') || '').trim(),
      p_category: String(form.get('category') || '').trim() || null,
      p_location_general: String(form.get('location_general') || '').trim() || null,
    });
    if (error) {
      setStatus('Could not save the space. Stay signed in and try again.');
      return;
    }
    spaceForm.reset();
    setStatus('Space saved on this account.');
    await loadDesk(supabase);
  });

  signOut?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    setStatus('Signed out.');
  });
}
