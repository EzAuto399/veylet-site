'use strict';
// Scroll-linked depth for the homepage illustrations. Everything is visible in
// its resting state, so the page is complete if GSAP never loads.
(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  media.add('(min-width: 801px) and (prefers-reduced-motion: no-preference)', () => {
    // The hero photograph drifts slower than the phone and the link, so the
    // three read as layers of one scene rather than a flat collage.
    const stage = document.querySelector('[data-product-stage]');
    if (stage) {
      const scrub = { trigger: stage, start: 'top 20%', end: 'bottom top', scrub: 0.5 };
      gsap.to(stage.querySelector('.stage-photo img'), { yPercent: 6, scale: 1.04, ease: 'none', scrollTrigger: scrub });
      gsap.to(stage.querySelector('.stage-phone'), { yPercent: -7, ease: 'none', scrollTrigger: scrub });
    }
    // The three app screens arrive staggered, the way a hand fans out cards.
    const phones = gsap.utils.toArray('.app-phones .device');
    if (phones.length) {
      gsap.fromTo(phones, { y: (i) => 40 + i * 30, opacity: 0.35 }, {
        y: 0, opacity: 1, ease: 'expo.out', duration: 1.1, stagger: 0.12,
        scrollTrigger: { trigger: '.app-phones', start: 'top 85%', once: true },
      });
    }
  });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
})();
