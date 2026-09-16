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

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

async function loadProperties(supabase) {
  if (!list) return;
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id,title,category,location_general,created_at')
    .order('created_at', { ascending: false });
  list.replaceChildren();
  if (error) {
    const li = document.createElement('li');
    li.textContent = 'Properties could not load. Try again after the email link.';
    list.append(li);
    return;
  }
  if (!properties?.length) {
    const li = document.createElement('li');
    li.textContent = 'No spaces yet. Save a name above (suburb or city only).';
    list.append(li);
    return;
  }
  for (const row of properties) {
    const li = document.createElement('li');
    li.textContent = [row.title, row.category, row.location_general]
      .filter(Boolean)
      .join(' · ');
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
    setStatus('Signed in. This is not operator approval or payment.');
    if (location.pathname.startsWith('/auth/')) {
      location.replace('/account');
      return;
    }
    await loadProperties(supabase);
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
    await loadProperties(supabase);
  });

  signOut?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    setStatus('Signed out.');
  });
}
