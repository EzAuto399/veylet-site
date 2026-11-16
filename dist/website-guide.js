'use strict';
(() => {
  const form = document.getElementById('share-guide');
  const output = document.getElementById('share-guide-output');
  const field = document.getElementById('share-code');
  const modalField = document.getElementById('share-modal-code');
  const themePaper = document.getElementById('share-theme-paper');
  const copyModal = document.getElementById('share-copy-modal');
  const copyDevBrief = document.getElementById('share-copy-dev-brief');
  const status = document.getElementById('share-guide-status');
  const open = document.getElementById('share-open');
  const preview = document.getElementById('share-preview');
  const link = form.elements.link;
  let handoff = '';
  let currentToken = '';

  function themeOpts() {
    return themePaper && themePaper.checked ? { theme: 'paper' } : undefined;
  }

  function renderOutputs(token) {
    const opts = themeOpts();
    field.value = window.VeyletSharing.embedCode(token, opts);
    if (modalField && typeof window.VeyletSharing.modalButtonCode === 'function') {
      modalField.value = window.VeyletSharing.modalButtonCode(token, 'Explore in 3D', opts);
    }
    handoff = window.VeyletSharing.handoffUrl(token);
    open.href = handoff;
    // The test embed is the handed-over code itself, running here, so this
    // page cannot show a lookalike that behaves better than the paste.
    preview.textContent = '';
    preview.append(window.VeyletSharing.embedFrame(token, document, opts));
  }

  function clear() {
    output.hidden = true;
    field.value = '';
    if (modalField) modalField.value = '';
    handoff = '';
    currentToken = '';
    open.removeAttribute('href');
    preview.textContent = '';
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const token = window.VeyletSharing.tokenFromLink(new FormData(form).get('link'));
    if (!token) {
      clear();
      link.setAttribute('aria-invalid', 'true');
      status.textContent = 'Use the full client handoff link from your desk, beginning https://veylet.com/handoff?t=. An owner preview or another website cannot be embedded here.';
      link.focus();
      return;
    }
    link.removeAttribute('aria-invalid');
    currentToken = token;
    renderOutputs(token);
    output.hidden = false;
    status.textContent = 'Code prepared. Press “Explore in 3D” in the test embed below to check the link opens before you add it to your website.';
    field.focus();
  });

  themePaper?.addEventListener('change', () => {
    if (!currentToken) return;
    renderOutputs(currentToken);
    status.textContent = themePaper.checked
      ? 'Updated code and test embed for light websites (?theme=paper).'
      : 'Updated code and test embed for dark background (default).';
  });

  document.getElementById('share-copy-code').addEventListener('click', () => {
    window.VeyletSharing.copy(field.value, field, status, 'Embed code copied. Paste it into a custom HTML block on your property page.');
  });
  document.getElementById('share-copy-link').addEventListener('click', () => {
    window.VeyletSharing.copy(handoff, null, status, 'Client link copied. Use it for a plain “Explore the property in 3D” button, or send it on its own.');
  });
  copyModal?.addEventListener('click', () => {
    window.VeyletSharing.copy(modalField ? modalField.value : '', modalField || null, status, 'Modal button code copied. Paste it anywhere on your property page.');
  });
  copyDevBrief?.addEventListener('click', () => {
    if (!currentToken || typeof window.VeyletSharing.developerBrief !== 'function') return;
    window.VeyletSharing.copy(window.VeyletSharing.developerBrief(currentToken), null, status, 'Developer brief copied. Send it to your website developer or agency platform team.');
  });
})();
