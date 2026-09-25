'use strict';
(() => {
  const form = document.getElementById('share-guide');
  const output = document.getElementById('share-guide-output');
  const field = document.getElementById('share-code');
  const status = document.getElementById('share-guide-status');
  const open = document.getElementById('share-open');
  const preview = document.getElementById('share-preview');
  const link = form.elements.link;
  let handoff = '';

  function clear() {
    output.hidden = true;
    field.value = '';
    handoff = '';
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
    field.value = window.VeyletSharing.embedCode(token);
    handoff = window.VeyletSharing.handoffUrl(token);
    open.href = handoff;
    // The test embed is the handed-over code itself, running here, so this
    // page cannot show a lookalike that behaves better than the paste.
    preview.textContent = '';
    preview.append(window.VeyletSharing.embedFrame(token, document));
    output.hidden = false;
    status.textContent = 'Code prepared. Press “Explore in 3D” in the test embed below to check the link opens before you add it to your website.';
    field.focus();
  });

  document.getElementById('share-copy-code').addEventListener('click', () => {
    window.VeyletSharing.copy(field.value, field, status, 'Embed code copied. Paste it into a custom HTML block on your property page.');
  });
  document.getElementById('share-copy-link').addEventListener('click', () => {
    window.VeyletSharing.copy(handoff, null, status, 'Client link copied. Use it for a plain “Explore the property in 3D” button, or send it on its own.');
  });
})();
