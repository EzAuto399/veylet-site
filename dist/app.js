'use strict';
(() => {
  const dialog = document.querySelector('#study-dialog');
  let opener = null;
  const close = () => { dialog.close(); opener?.focus(); };
  dialog.querySelector('.close').addEventListener('click', close);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  });
  document.querySelector('#study-enquire').addEventListener('click', () => dialog.close());
  // Name the revision this page is serving, so a report of a problem can say which one.
  fetch('build-info.json').then(r => r.ok ? r.json() : null).then(info => {
    if (!info || !info.shortCommit || info.shortCommit === 'unknown') return;
    const tag = document.getElementById('build-tag');
    if (!tag) return;
    tag.textContent = '· ' + info.shortCommit + (info.dirty ? '+' : '');
    tag.title = 'Served revision ' + info.shortCommit + (info.builtAt ? ', built ' + info.builtAt : '');
  }).catch(() => { /* the marker is a convenience, never a blocker */ });

  fetch('collection.json').then(response => {
    if (!response.ok) throw new Error('Collection unavailable');
    return response.json();
  }).then(studies => {
    const byId = new Map(studies.map(study => [String(study.id), study]));
    document.querySelectorAll('[data-study]').forEach(link => link.addEventListener('click', event => {
      const study = byId.get(link.dataset.study);
      if (!study || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); opener = link;
      document.querySelector('#study-image').src = link.href;
      document.querySelector('#study-image').alt = study.description;
      document.querySelector('#study-title').textContent = study.title;
      document.querySelector('#study-description').textContent = study.description;
      dialog.showModal();
    }));
  }).catch(() => { /* The real image links remain usable without the enhanced gallery. */ });
})();
