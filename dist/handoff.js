import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.VEYLET_SUPABASE;
const titleEl = document.getElementById('handoff-title');
const bodyEl = document.getElementById('handoff-body');
const statusEl = document.getElementById('handoff-status');
const token = new URLSearchParams(location.search).get('t') || '';

function fail(message) {
  if (titleEl) titleEl.textContent = 'This handoff is not available.';
  if (bodyEl) {
    bodyEl.textContent =
      'The link is missing, revoked, or the tour is not ready. Ask the operator for a new link.';
  }
  if (statusEl) statusEl.textContent = message;
}

if (!cfg?.url || !cfg?.anonKey) {
  fail('Handoff service is not configured.');
} else if (token.length < 16) {
  fail('No handoff token on this address.');
} else {
  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc('lookup_tour_share', {
    p_token: token,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.tour_id) {
    fail('This handoff could not be opened.');
  } else if (titleEl && bodyEl) {
    titleEl.textContent = row.space_title || 'Shared space';
    bodyEl.textContent =
      'This space is reserved for you as a private handoff. The reconstructed walkthrough still plays in Veylet Capture or a reviewed browser package — not as a public page on this site yet.';
    if (statusEl) {
      statusEl.textContent = 'Status: ' + (row.status || 'ready') + '. Not indexed. Not payment.';
    }
  }
}
