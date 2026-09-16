import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { fail, playZipBlob } from '/tour-player.js';

const cfg = window.VEYLET_SUPABASE;
const titleEl = document.getElementById('handoff-title');
const bodyEl = document.getElementById('handoff-body');
const statusEl = document.getElementById('handoff-status');
const frame = document.getElementById('tour-frame');
const token = new URLSearchParams(location.search).get('t') || '';

if (!cfg?.url || !cfg?.anonKey) {
  fail(titleEl, bodyEl, statusEl, 'This walkthrough is not available.', 'Player is not configured.');
} else if (token.length < 16) {
  fail(
    titleEl,
    bodyEl,
    statusEl,
    'This handoff is not available.',
    'The link is missing, revoked, or the tour is not ready. Ask the operator for a new link.'
  );
  if (statusEl) statusEl.textContent = 'No handoff token on this address.';
} else {
  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('lookup_tour_share', { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.storage_path) {
    fail(
      titleEl,
      bodyEl,
      statusEl,
      'This handoff is not available.',
      'The link is missing, revoked, or the tour is not ready. Ask the operator for a new link.'
    );
  } else {
    if (titleEl) titleEl.textContent = row.space_title || 'Shared space';
    if (bodyEl) {
      bodyEl.textContent =
        'Unlisted walkthrough. Anyone with this link can view it until the operator revokes it.';
    }
    if (statusEl) statusEl.textContent = 'Loading the reconstructed tour…';
    const { data: file, error: dlErr } = await supabase.storage
      .from('tour-packages')
      .download(row.storage_path);
    if (dlErr || !file) {
      fail(
        titleEl,
        bodyEl,
        statusEl,
        titleEl?.textContent || 'Shared space',
        'The tour file could not be opened. Ask the operator to send again.'
      );
    } else {
      try {
        await playZipBlob(file, frame);
        if (statusEl) statusEl.textContent = 'Private link. Not indexed. Not payment.';
      } catch {
        fail(
          titleEl,
          bodyEl,
          statusEl,
          titleEl?.textContent || 'Shared space',
          'This package is not a playable reconstructed tour.'
        );
      }
    }
  }
}
