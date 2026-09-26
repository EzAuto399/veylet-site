'use strict';
(() => {
  // The mobile bar repeats the hero's two actions, so it waits until they have
  // scrolled away. Without IntersectionObserver it simply stays visible.
  (() => {
    const bar = document.querySelector('[data-sticky-cta]');
    const actions = document.querySelector('[data-hero-actions]');
    if (!bar || !actions || !('IntersectionObserver' in window)) return;
    bar.dataset.visible = 'false';
    new IntersectionObserver(([entry]) => {
      bar.dataset.visible = entry.isIntersecting ? 'false' : 'true';
    }).observe(actions);
  })();

  // Record the served revision on the document rather than in the customer's view.
  // Anyone debugging can read it; nobody browsing has to look at it.
  fetch('build-info.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(info => {
    if (!info || !info.shortCommit || info.shortCommit === 'unknown') return;
    document.documentElement.dataset.veyletBuild = info.shortCommit;
    const tag = document.getElementById('veylet-build');
    if (tag) tag.setAttribute('content', info.shortCommit + (info.builtAt ? ' ' + info.builtAt : ''));
  }).catch(() => { /* the marker is a convenience, never a blocker */ });
})();
