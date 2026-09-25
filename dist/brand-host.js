'use strict';

const nonCanonicalHosts = new Set(['veylet-site.vercel.app', 'www.veylet.com']);

if (nonCanonicalHosts.has(location.hostname)) {
  location.replace('https://veylet.com' + location.pathname + location.search + location.hash);
}

/*
 * A stored sign-in on this browser (unexpired, or renewable with its refresh
 * token) makes the header's "Sign in" read "Account". Presence only: no network call, nothing is refreshed or
 * verified, and any storage problem leaves the header as it was.
 */
(() => {
  function authKeys(storage) {
    try {
      const url = window.VEYLET_SUPABASE && window.VEYLET_SUPABASE.url;
      if (url) return ['sb-' + new URL(url).hostname.split('.')[0] + '-auth-token'];
    } catch { /* fall through to the pattern */ }
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (/^sb-[a-z0-9]+-auth-token$/.test(key || '')) keys.push(key);
    }
    return keys;
  }
  function signedIn() {
    try {
      const storage = window.localStorage;
      const now = Date.now() / 1000;
      return authKeys(storage).some(key => {
        try {
          const saved = JSON.parse(storage.getItem(key) || 'null');
          const current = saved && (saved.currentSession || saved);
          const expires = Number(current && current.expires_at);
          // An hour-old access token still renews on the account page, so a
          // stored refresh token counts as signed in too.
          const renewable = typeof (current && current.refresh_token) === 'string' && current.refresh_token.length > 0;
          return (Number.isFinite(expires) && expires > now) || renewable;
        } catch { return false; }
      });
    } catch { return false; }
  }
  function relabel() {
    if (!signedIn()) return;
    for (const link of document.querySelectorAll('header nav a')) {
      let path = '';
      try { path = new URL(link.getAttribute('href') || '', location.href).pathname; } catch { continue; }
      if (/^\/account\/?$/.test(path) && link.textContent.trim() === 'Sign in') link.textContent = 'Account';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relabel);
  else relabel();
})();
