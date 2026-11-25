(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get('space') || '').trim();
  const safeId = /^[A-Za-z0-9_-]{4,80}$/.test(raw) ? raw : '';
  const webLink = document.getElementById('capture-web-link');
  const detail = document.getElementById('capture-open-detail');
  const qrBox = document.getElementById('capture-open-qr');
  const copyBtn = document.getElementById('capture-copy-link');
  const copyStatus = document.getElementById('capture-copy-status');
  if (safeId && webLink) {
    webLink.setAttribute('href', '/account#space-' + encodeURIComponent(safeId));
  }
  if (safeId && detail) {
    detail.textContent = 'No Veylet app on this device yet? Scan the QR code with your iPhone, install Veylet from the App Store, or open this space from your desk.';
  }
  if (!safeId) return;

  const appUrl = 'https://veylet.com/open/capture?space=' + encodeURIComponent(safeId);
  if (qrBox && window.VeyletQR && typeof window.VeyletQR.svg === 'function') {
    const svg = window.VeyletQR.svg(appUrl, { label: 'QR code to open this space on iPhone' });
    if (/^<svg[\s>]/.test(svg)) {
      qrBox.innerHTML = svg;
      qrBox.hidden = false;
    }
  }
  if (copyBtn) {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(appUrl);
          if (copyStatus) {
            copyStatus.textContent = 'iPhone link copied.';
            copyStatus.hidden = false;
          }
          return;
        }
      } catch {
        // Fall through to manual copy hint when clipboard permission is unavailable.
      }
      if (copyStatus) {
        copyStatus.textContent = 'Copy this iPhone link: ' + appUrl;
        copyStatus.hidden = false;
      }
    });
  }
})();
