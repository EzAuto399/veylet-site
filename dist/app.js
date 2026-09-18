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
  // The film shows as a wide band on small screens, so its poster is framed for that
  // shape. `poster` on <source> is not standard, so the swap is done here too and
  // relies on no browser extension of the spec.
  (() => {
    const video = document.getElementById('opening-film');
    if (!video) return;
    const portrait = video.getAttribute('poster');
    const wide = 'media/launch-reel-poster-wide.png';
    const apply = () => {
      const want = window.matchMedia('(max-width: 800px)').matches ? wide : portrait;
      if (video.getAttribute('poster') !== want) video.setAttribute('poster', want);
    };
    apply();
    window.matchMedia('(max-width: 800px)').addEventListener?.('change', apply);
  })();

  // Record the served revision on the document rather than in the customer's view.
  // Anyone debugging can read it; nobody browsing has to look at it.
  fetch('build-info.json').then(r => r.ok ? r.json() : null).then(info => {
    if (!info || !info.shortCommit || info.shortCommit === 'unknown') return;
    document.documentElement.dataset.veyletBuild = info.shortCommit;
    const tag = document.getElementById('veylet-build');
    if (tag) tag.setAttribute('content', info.shortCommit + (info.builtAt ? ' ' + info.builtAt : ''));
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
