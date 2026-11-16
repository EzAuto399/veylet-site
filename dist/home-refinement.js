'use strict';
// Scroll-linked depth and crisp section arrivals for the homepage. Everything is
// visible in its resting state (opacity >= 0.35), so the page is complete if GSAP never loads.
(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true, autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load' });
  const media = gsap.matchMedia();

  media.add('(min-width: 801px) and (prefers-reduced-motion: no-preference)', () => {
    const stage = document.querySelector('[data-product-stage]');
    if (stage) {
      const scrub = { trigger: stage, start: 'top 20%', end: 'bottom top', scrub: 0.45 };
      gsap.to(stage.querySelector('.stage-photo img'), { yPercent: 5, scale: 1.04, ease: 'none', scrollTrigger: scrub });
      gsap.to(stage.querySelector('.stage-phone'), { yPercent: -6, ease: 'none', scrollTrigger: scrub });
    }
  });

  media.add('(prefers-reduced-motion: no-preference)', () => {
    const rise = (targets, trigger, stagger = 0.06) => {
      const list = gsap.utils.toArray(targets);
      if (!list.length) return;
      gsap.fromTo(list, { y: 18, opacity: 0.38 }, {
        y: 0,
        opacity: 1,
        ease: 'power3.out',
        duration: 0.65,
        stagger,
        scrollTrigger: { trigger: trigger || list[0], start: 'top 88%', once: true },
      });
    };
    rise('.conversion-heading, .conversion-benefits > div', '.conversion-summary', 0.06);
    rise('.see-band-media, .see-band-copy > *', '.see-band', 0.06);
    rise('.walk-head > *', '.walk-demo', 0.08);
    rise('.app-phones figure', '.app-phones', 0.08);
    rise('.faq-block h2, .faq-list details', '.faq-block', 0.05);
    rise('.closing-inner > *', '.closing-invitation', 0.08);
  });

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
})();
