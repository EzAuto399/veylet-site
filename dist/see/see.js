'use strict';
// /see, the viewing room. Everything here enhances plain HTML: without this file the page shows
// the walkthrough's poster, both videos with their own controls, the ledgers and a plain list of
// steps. Motion runs only through gsap.matchMedia, never under reduced motion, and every loop
// stops off screen and while the tab is hidden.
(() => {
  const PLAYER_URL = '/tour-player-v2.js?v=7e7ee0e58508f8aa';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = window.matchMedia('(max-width: 800px)');
  const hero = document.querySelector('[data-see-hero]');
  const stage = document.querySelector('[data-see-stage]');
  const playerBox = document.querySelector('[data-see-player]');
  const phoneBox = document.querySelector('[data-see-phone]');
  let layoutThread = () => {};

  /* ---------- The mobile bar waits until the hero's own actions scroll away ---------- */
  (() => {
    const bar = document.querySelector('[data-sticky-cta]');
    const actions = document.querySelector('[data-hero-actions]');
    if (!bar || !actions || !('IntersectionObserver' in window)) return;
    bar.dataset.visible = 'false';
    // On phones the actions sit below the stage, so the bar stays out of the first screen
    // (where it would cover the Explore press) and appears once they have scrolled past.
    new IntersectionObserver(([entry]) => {
      bar.dataset.visible = !entry.isIntersecting && entry.boundingClientRect.top < 0 ? 'true' : 'false';
    }).observe(actions);
  })();

  /* ---------- The walkthrough video: plays muted while on screen, with Pause and two cuts ---------- */
  const video = (() => {
    const figure = document.querySelector('[data-see-video]');
    if (!figure || !phoneBox) return null;
    const cuts = {
      social: figure.querySelector('[data-cut-video="social"]'),
      listing: figure.querySelector('[data-cut-video="listing"]'),
    };
    const toggle = figure.querySelector('[data-video-toggle]');
    const switcher = figure.querySelector('[data-cut-switch]');
    const file = figure.querySelector('[data-cut-file]');
    if (!cuts.social || !cuts.listing || !toggle || !switcher) return null;
    // The page's own controls replace the browser's: Pause, and the choice of cut.
    for (const clip of Object.values(cuts)) clip.removeAttribute('controls');
    toggle.hidden = false;
    switcher.hidden = false;
    if (file) file.hidden = true;
    let cut = 'social';
    // Under reduced motion nothing starts by itself; the visitor presses Play.
    let held = reduce.matches;
    let onScreen = !('IntersectionObserver' in window);
    const current = () => cuts[cut];
    const chosen = () => !(narrow.matches && stage && stage.dataset.show === 'explore');
    const label = () => {
      const paused = current().paused;
      const words = paused ? 'Play the video' : 'Pause the video';
      toggle.dataset.state = paused ? 'paused' : 'playing';
      toggle.setAttribute('aria-label', words);
      toggle.title = words;
    };
    const sync = () => {
      const clip = current();
      if (onScreen && chosen() && !document.hidden && !held) {
        const playing = clip.play();
        if (playing && playing.catch) playing.catch(label);
      } else if (!clip.paused) {
        clip.pause();
      }
      label();
    };
    for (const clip of Object.values(cuts)) {
      clip.addEventListener('play', label);
      clip.addEventListener('pause', label);
    }
    toggle.addEventListener('click', () => {
      const clip = current();
      if (clip.paused) {
        held = false;
        const playing = clip.play();
        if (playing && playing.catch) playing.catch(label);
      } else {
        held = true;
        clip.pause();
      }
    });
    switcher.addEventListener('click', event => {
      const button = event.target.closest('[data-cut-choice]');
      if (!button || button.dataset.cutChoice === cut || !cuts[button.dataset.cutChoice]) return;
      current().pause();
      cut = button.dataset.cutChoice;
      for (const [name, clip] of Object.entries(cuts)) clip.hidden = name !== cut;
      for (const choice of switcher.querySelectorAll('[data-cut-choice]')) choice.setAttribute('aria-pressed', String(choice === button));
      figure.dataset.cut = cut;
      sync();
      layoutThread();
    });
    if (!onScreen) {
      new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); }, { threshold: 0.35 }).observe(phoneBox);
    }
    document.addEventListener('visibilitychange', sync);
    if (reduce.addEventListener) reduce.addEventListener('change', () => { if (reduce.matches) held = true; sync(); });
    label();
    return { sync };
  })();

  /* ---------- Phones: one frame at a time ---------- */
  (() => {
    const group = document.querySelector('[data-see-switch]');
    if (!group || !stage) return;
    group.hidden = false;
    const show = choice => {
      stage.dataset.show = choice;
      for (const button of group.querySelectorAll('[data-show]')) button.setAttribute('aria-pressed', String(button.dataset.show === choice));
      if (video) video.sync();
    };
    group.addEventListener('click', event => {
      const button = event.target.closest('[data-show]');
      if (button) show(button.dataset.show);
    });
    if (narrow.addEventListener) narrow.addEventListener('change', () => { if (video) video.sync(); });
    show('explore');
  })();

  /* ---------- The 3D walkthrough: nothing heavy until the visitor presses Explore ---------- */
  (() => {
    const start = playerBox && playerBox.querySelector('[data-player-start]');
    const press = start && start.querySelector('[data-explore]');
    const status = start && start.querySelector('[data-player-status]');
    const weight = document.querySelector('[data-player-weight]');
    // The package location is one attribute on the stage (same origin now, the tour host at release).
    const base = stage && stage.dataset.sampleBase;
    if (!start || !press || !status || !base) return;
    start.hidden = false;
    const load = () => (window.VeyletPlayerV2 ? Promise.resolve() : new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PLAYER_URL;
      script.async = true;
      script.onload = () => (window.VeyletPlayerV2 ? resolve() : reject(new Error('player-missing')));
      script.onerror = () => { script.remove(); reject(new Error('player-unavailable')); };
      document.head.append(script);
    }));
    const failed = () => {
      press.disabled = false;
      press.textContent = 'Try again';
      status.textContent = 'The 3D player didn’t load. Check the connection and try again.';
    };
    press.addEventListener('click', async () => {
      press.disabled = true;
      press.textContent = 'Loading the player…';
      status.textContent = '';
      if (weight) weight.hidden = true;
      try { await load(); } catch { failed(); return; }
      // Focus stays in the frame while the player replaces the poster with its own interface.
      playerBox.focus({ preventScroll: true });
      window.VeyletPlayerV2.start(playerBox, { base, waitForTap: false, onRetry: () => location.reload() })
        .then(() => {
          const canvas = playerBox.querySelector('.v2-canvas');
          if (canvas && !canvas.hidden && document.activeElement === playerBox) canvas.focus({ preventScroll: true });
        })
        .catch(() => {
          const note = document.createElement('p');
          note.className = 'see-player-note';
          note.setAttribute('role', 'status');
          note.textContent = 'The walkthrough didn’t load here. Reload the page to try again; the video beside it still plays.';
          playerBox.replaceChildren(note);
        });
    });
  })();

  /* ---------- The hairline: from "One capture." along, then down onto each frame ---------- */
  (() => {
    const svg = hero && hero.querySelector('[data-thread]');
    const node = hero && hero.querySelector('[data-thread-node]');
    const actions = hero && hero.querySelector('[data-hero-actions]');
    if (!svg || !node || !playerBox || !phoneBox) return;
    // Text the drops must pass beside, never through: the headline, and the intro and actions
    // when they sit above the frames (801-1100 px).
    const clear = [hero.querySelector('[data-thread-em]'), hero.querySelector('.see-intro'), ...(actions ? actions.children : [])].filter(Boolean);
    const part = name => svg.querySelector(`[data-thread-part="${name}"]`);
    const px = value => Math.round(value) + 0.5; // a 1 px line on a pixel, not across two
    layoutThread = () => {
      if (narrow.matches) { svg.setAttribute('hidden', ''); return; }
      const box = hero.getBoundingClientRect();
      const at = element => {
        const rect = element.getBoundingClientRect();
        return { l: rect.left - box.left, t: rect.top - box.top, r: rect.right - box.left, b: rect.bottom - box.top, w: rect.width, h: rect.height };
      };
      const n = at(node), p = at(playerBox), f = at(phoneBox);
      if (!p.w || !f.w || !n.h) { svg.setAttribute('hidden', ''); return; }
      const x0 = n.l + n.w * 0.75; // a clear gap after the full stop
      const y0 = n.t + n.h * 0.45;
      const inTheWay = clear.map(at).filter(rect => rect.w && rect.t < p.t - 4 && rect.b > y0).map(rect => rect.r);
      const past = Math.max(n.r, ...inTheWay) + 28;
      const intoPlayer = Math.min(Math.max(p.l + p.w / 2, past), p.r - 24);
      const intoPhone = Math.min(Math.max(f.l + f.w / 2, past), f.r - 18);
      svg.setAttribute('width', String(Math.round(box.width)));
      svg.setAttribute('height', String(Math.round(box.height)));
      svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
      // One run along, and each drop ends exactly on its frame's top edge. The run is two paths
      // so the line can rest on the first frame before it goes on to the second.
      part('run-explore').setAttribute('d', `M${px(x0)} ${px(y0)}H${px(intoPlayer)}`);
      part('run-watch').setAttribute('d', `M${px(intoPlayer)} ${px(y0)}H${px(intoPhone)}`);
      part('explore').setAttribute('d', `M${px(intoPlayer)} ${px(y0)}V${Math.round(p.t)}`);
      part('watch').setAttribute('d', `M${px(intoPhone)} ${px(y0)}V${Math.round(f.t)}`);
      const start = svg.querySelector('[data-thread-dot="start"]');
      start.setAttribute('cx', String(px(x0)));
      start.setAttribute('cy', String(px(y0)));
      svg.removeAttribute('hidden'); // an SVG element has no hidden property, only the attribute
    };
    layoutThread();
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => layoutThread());
      for (const element of [hero, playerBox, phoneBox]) observer.observe(element);
    } else {
      window.addEventListener('resize', layoutThread);
    }
    if (narrow.addEventListener) narrow.addEventListener('change', layoutThread);
  })();

  /* ---------- From your phone to their browser: the pinned sequence ---------- */
  const flow = document.querySelector('[data-see-flow]');
  const flowBody = flow && flow.querySelector('[data-flow-body]');
  const steps = flow ? [...flow.querySelectorAll('[data-step]')] : [];
  const screens = flow ? [...flow.querySelectorAll('[data-screen]')] : [];
  const renderUi = flow && flow.querySelector('[data-ui="render"]');
  const shareUi = flow && flow.querySelector('[data-ui="share"]');
  const RENDER_STEPS = ['Preparing photos', 'Lining up camera positions', 'Building your 3D walkthrough', 'Packing it for phones', 'Checking quality'];
  // Where each of the five steps starts along the pinned scroll. Step 4 holds two screens
  // (rendering, then ready) and step 5 three (approve, share, the walkthrough in a browser).
  const EDGES = [0, 0.15, 0.3, 0.45, 0.7, 1];
  const setRender = (state, now) => {
    if (!renderUi) return;
    renderUi.dataset.state = state;
    const ready = state === 'ready';
    renderUi.querySelector('[data-ui-title]').textContent = ready ? 'Ready for your review' : 'Rendering';
    renderUi.querySelector('[data-ui-turn]').textContent = ready ? 'Your turn' : 'Automatic';
    renderUi.querySelector('[data-ui-line]').textContent = ready
      ? 'It passed the automatic quality check.'
      : `Step ${now} of 5: ${RENDER_STEPS[now - 1]}.`;
    renderUi.querySelectorAll('[data-ui-step]').forEach((item, index) => {
      item.classList.toggle('is-done', ready || index < now - 1);
      item.classList.toggle('is-now', !ready && index === now - 1);
    });
  };
  const setShare = state => { if (shareUi) shareUi.dataset.state = state; };
  // The complete still state: what the plain list shows.
  const still = () => {
    steps.forEach(step => { step.style.removeProperty('--p'); step.removeAttribute('aria-current'); });
    screens.forEach(screen => screen.removeAttribute('data-shown'));
    setRender('ready', 5);
    setShare('shared');
  };
  const update = progress => {
    const at = Math.min(0.9999, Math.max(0, progress));
    let index = 0;
    while (index < 4 && at >= EDGES[index + 1]) index += 1;
    const local = (at - EDGES[index]) / (EDGES[index + 1] - EDGES[index]);
    steps.forEach((step, i) => {
      step.style.setProperty('--p', i < index ? '1' : i === index ? local.toFixed(3) : '0');
      if (i === index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    const number = index + 1;
    const shown = screens.filter(screen => Number(screen.dataset.screen) <= number).pop();
    screens.forEach(screen => screen.toggleAttribute('data-shown', screen === shown));
    if (number < 4) setRender('rendering', 3);
    else if (number === 4) setRender(local < 0.62 ? 'rendering' : 'ready', Math.min(5, 3 + Math.floor((local / 0.62) * 3)));
    else setRender('ready', 5);
    setShare(number < 5 ? 'review' : local < 0.3 ? 'review' : local < 0.66 ? 'shared' : 'browser');
  };

  /* ---------- Scroll motion (GSAP and ScrollTrigger, self-hosted) ---------- */
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  media.add('(min-width: 801px) and (prefers-reduced-motion: no-preference)', () => {
    // The hairline draws itself with the scroll. At rest it has already landed on the 3D frame
    // (never a loose end); the first 300 px of scroll carry it on and down onto the phone.
    const svg = hero && hero.querySelector('[data-thread]');
    const parts = svg ? ['run-explore', 'explore', 'run-watch', 'watch'].map(name => svg.querySelector(`[data-thread-part="${name}"]`)) : [];
    if (parts.length && parts.every(Boolean)) {
      const [toExplore, dropExplore, toWatch, dropWatch] = parts;
      gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { start: -300, end: 300, scrub: 0.5 } })
        .fromTo(toExplore, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.28 }, 0)
        .fromTo(dropExplore, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.2 }, 0.28)
        .fromTo(toWatch, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.24 }, 0.52)
        .fromTo(dropWatch, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.24 }, 0.76);
    }
    // The five steps: pinned, and scrubbed by the scroll.
    if (flow && flowBody && steps.length === 5) {
      flow.dataset.mode = 'pinned';
      const pin = ScrollTrigger.create({
        trigger: flowBody,
        start: 'center center',
        end: () => '+=' + Math.round(window.innerHeight * 3.2),
        pin: true,
        invalidateOnRefresh: true,
        onUpdate: self => update(self.progress),
        onRefresh: self => update(self.progress),
      });
      update(pin.progress);
    }
    return () => {
      if (flow) delete flow.dataset.mode;
      still();
      if (parts.length) gsap.set(parts, { clearProps: 'strokeDashoffset' });
    };
  });
  const refresh = () => { layoutThread(); ScrollTrigger.refresh(); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  window.addEventListener('load', refresh, { once: true });
})();
