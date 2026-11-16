'use strict';
(() => {
  const reduce = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

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

  // Translucent floating header once scrolled past 24px; keeps static HTML untouched.
  (() => {
    if (!document.body || typeof window.addEventListener !== 'function') return;
    let ticking = false;
    const syncScroll = () => {
      ticking = false;
      const scrolled = (window.scrollY || window.pageYOffset || 0) > 24;
      if (scrolled) document.body.dataset.scrolled = 'true';
      else delete document.body.dataset.scrolled;
    };
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(syncScroll);
      else syncScroll();
    }, { passive: true });
    syncScroll();
  })();

  // Interruptible WAAPI disclosure for FAQ <details> elements; instant under reduced motion.
  (() => {
    const accordions = document.querySelectorAll('.faq-block details, .guide-section details');
    const animations = new WeakMap();
    accordions.forEach(details => {
      const summary = details.querySelector('summary');
      if (!summary || typeof details.animate !== 'function') return;
      summary.addEventListener('click', event => {
        if (reduce.matches) return;
        event.preventDefault();
        const running = animations.get(details);
        if (running) running.cancel();
        const startHeight = details.offsetHeight;
        const closing = details.open;
        if (!closing) details.open = true;
        const endHeight = closing ? summary.offsetHeight : details.offsetHeight;
        details.style.overflow = 'hidden';
        const anim = details.animate(
          [{ height: `${startHeight}px`, opacity: closing ? 1 : 0.92 }, { height: `${endHeight}px`, opacity: 1 }],
          { duration: closing ? 170 : 210, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
        );
        animations.set(details, anim);
        const finish = cancelled => {
          if (animations.get(details) === anim) animations.delete(details);
          if (cancelled) return;
          if (closing) details.open = false;
          details.style.height = '';
          details.style.overflow = '';
        };
        anim.onfinish = () => finish(false);
        anim.oncancel = () => finish(true);
      });
    });
  })();

  // Record the served revision on the document rather than in the customer's view.
  fetch('/build-info.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(info => {
    if (!info || !info.shortCommit || info.shortCommit === 'unknown') return;
    document.documentElement.dataset.veyletBuild = info.shortCommit;
    const tag = document.getElementById('veylet-build');
    if (tag) tag.setAttribute('content', info.shortCommit + (info.builtAt ? ' ' + info.builtAt : ''));
  }).catch(() => { /* the marker is a convenience, never a blocker */ });
})();
