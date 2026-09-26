/* Anonymous RPC credential shape guard. Supabase validates actual key/signature authority. */
(function () {
  'use strict';
  // Publishable keys are not JWTs. The server validates real credentials; this
  // guard keeps privileged/malformed configuration from receiving a URL token.
  function headers(key) {
    if (typeof key !== 'string' || !key || key.length > 16384 || /[^\x21-\x7e]/.test(key)) return null;
    var headers = { apikey: key, 'Content-Type': 'application/json' };
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return headers;
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return null;
    try {
      var payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var claims = JSON.parse(atob(payload + '='.repeat((4 - payload.length % 4) % 4)));
      if (!claims || claims.role !== 'anon') return null;
    } catch (invalid) { return null; }
    headers.Authorization = 'Bearer ' + key;
    return headers;
  }

  window.VeyletPublicRPC = Object.freeze({ headers: headers });
})();
