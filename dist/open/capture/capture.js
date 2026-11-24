(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get('space') || '').trim();
  const safeId = /^[A-Za-z0-9_-]{4,80}$/.test(raw) ? raw : '';
  const webLink = document.getElementById('capture-web-link');
  const detail = document.getElementById('capture-open-detail');
  if (safeId && webLink) {
    webLink.setAttribute('href', '/account#space-' + encodeURIComponent(safeId));
  }
  if (safeId && detail) {
    detail.textContent = 'No Veylet app on this device yet? Install it from the App Store, sign in with the same account, and open this space from your desk.';
  }
})();
