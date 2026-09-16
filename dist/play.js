import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { fail, playZipBlob } from '/tour-player.js';

const cfg = window.VEYLET_SUPABASE;
const titleEl = document.getElementById('play-title');
const bodyEl = document.getElementById('play-body');
const statusEl = document.getElementById('play-status');
const frame = document.getElementById('tour-frame');
const tourId = new URLSearchParams(location.search).get('id') || '';

if (!cfg?.url || !cfg?.anonKey) {
  fail(titleEl, bodyEl, statusEl, 'Preview is not available.', 'Player is not configured.');
} else if (!tourId) {
  fail(titleEl, bodyEl, statusEl, 'Preview is not available.', 'No tour id on this address.');
} else {
  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    fail(titleEl, bodyEl, statusEl, 'Sign in to preview.', 'Owner preview is only for the signed-in account.');
    if (statusEl) {
      const a = document.createElement('a');
      a.href = '/account';
      a.textContent = 'Sign in';
      statusEl.append(a);
    }
  } else {
    const { data: tours, error } = await supabase
      .from('tours')
      .select('id,storage_path,status,property_id')
      .eq('id', tourId)
      .limit(1);
    const tour = tours?.[0];
    if (error || !tour?.storage_path) {
      fail(titleEl, bodyEl, statusEl, 'Preview is not available.', 'This tour is not on this account.');
    } else {
      if (statusEl) statusEl.textContent = 'Loading…';
      const { data: file, error: dlErr } = await supabase.storage
        .from('tour-packages')
        .download(tour.storage_path);
      if (dlErr || !file) {
        fail(titleEl, bodyEl, statusEl, 'Preview is not available.', 'The package could not be downloaded.');
      } else {
        try {
          await playZipBlob(file, frame);
          if (statusEl) statusEl.textContent = 'Owner preview. Not a client handoff.';
        } catch {
          fail(titleEl, bodyEl, statusEl, 'Preview is not available.', 'This package is not a playable reconstructed tour.');
        }
      }
    }
  }
}
