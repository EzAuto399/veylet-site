'use strict';
// Home hero (design spec v2, 6.1 and 7.5): the sample walkthrough's poster, then the real 3D in place.
// Without this file the poster shows with a plain link to /see. Nothing heavy loads before the visitor
// shows intent: hover or keyboard focus on Explore preloads the player and engine, a press starts them.
// The sample itself (package, posters, video, size) is named once, on [data-hero-stage] in index.html.
(() => {
  const PLAYER_URL = '/tour-player-v2.js?v=b9bb034082f5f19c';
  const ENGINE_URL = '/vendor/playcanvas-2.23.2.min.js?v=dc5be7cc192c8e49';
  const SLOW_MS = 10000;
  const GIVE_UP_MS = 45000;
  const LIKE_MS = 20000;
  const hero = document.querySelector('[data-hero]');
  const stage = hero && hero.querySelector('[data-hero-stage]');
  if (!stage) return;
  const part = name => hero.querySelector('[data-hero-' + name + ']');
  const ui = {
    poster: part('poster'), player: part('player'), video: part('video'), explore: part('explore'), progress: part('progress'),
    pct: part('pct'), low: part('low'), slow: part('slow'), failed: part('failed'), saveData: part('save-data'), retry: part('retry'),
    nojs: part('nojs'), exit: part('exit'), like: part('like'),
  };
  const sample = {
    base: stage.dataset.sampleBase,
    video: stage.dataset.sampleVideo,
    videoPoster: stage.dataset.sampleVideoPoster || '',
  };
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const phone = window.matchMedia ? window.matchMedia('(max-width: 639px)') : { matches: false };
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  // Each phase shows exactly these parts; everything else in the dock is hidden.
  const SHOWN = {
    ready: ['explore', 'low'],
    loading: ['progress', 'low'],
    slow: ['progress', 'slow'],
    failed: ['failed'],
    'save-data': ['saveData'],
    live: ['exit'],
    video: ['exit'],
  };
  const TOGGLED = ['explore', 'progress', 'low', 'slow', 'failed', 'saveData', 'exit'];
  let phase = '';
  let run = null;
  let likeTimer = null;
  let scrollAt = 0;

  const set = next => {
    phase = next;
    hero.dataset.phase = next;
    for (const name of TOGGLED) if (ui[name]) ui[name].hidden = !SHOWN[next].includes(name);
    if (ui.low) ui.low.dataset.size = next === 'ready' ? 'shown' : 'hidden';
    const immersive = phone.matches && (next === 'live' || next === 'video');
    if (immersive && !hero.hasAttribute('data-immersive')) scrollAt = window.scrollY || 0;
    hero.toggleAttribute('data-immersive', immersive);
    document.documentElement.toggleAttribute('data-vh-immersive', immersive);
    if (next !== 'live' && ui.like) { ui.like.hidden = true; clearTimeout(likeTimer); }
  };

  const percent = value => {
    const n = Math.max(0, Math.min(100, Math.round(value)));
    if (ui.pct) ui.pct.textContent = n + '%';
    if (ui.progress) {
      ui.progress.setAttribute('aria-valuenow', String(n));
      ui.progress.style.setProperty('--vh-p', (n / 100).toFixed(3));
    }
  };

  let preloaded = false;
  const preload = () => {
    if (preloaded || window.VeyletPlayerV2) return;
    preloaded = true;
    for (const [rel, href, as] of [['preload', PLAYER_URL, 'script'], ['modulepreload', ENGINE_URL, '']]) {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = href;
      if (as) link.as = as;
      document.head.append(link);
    }
  };
  const loadPlayer = () => (window.VeyletPlayerV2 ? Promise.resolve() : new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLAYER_URL;
    script.async = true;
    script.onload = () => (window.VeyletPlayerV2 ? resolve() : reject(new Error('player-missing')));
    script.onerror = () => { script.remove(); reject(new Error('player-unavailable')); };
    document.head.append(script);
  }));

  const stop = () => {
    if (!run) return;
    clearTimeout(run.slow);
    clearTimeout(run.giveUp);
    run.controller.abort();
    run = null;
    if (ui.player) ui.player.replaceChildren();
  };

  const fail = () => {
    stop();
    set('failed');
    if (ui.retry) ui.retry.focus({ preventScroll: true });
  };

  const live = () => {
    if (!run) return;
    clearTimeout(run.slow);
    clearTimeout(run.giveUp);
    set('live');
    const canvas = ui.player && ui.player.querySelector('.v2-canvas');
    if (canvas && !canvas.hidden) canvas.focus({ preventScroll: true });
    clearTimeout(likeTimer);
    likeTimer = setTimeout(() => { if (phase === 'live' && ui.like) ui.like.hidden = false; }, LIKE_MS);
  };

  const explore = () => {
    if (run || !sample.base) return;
    preload();
    const controller = new AbortController();
    run = { controller, slow: 0, giveUp: 0 };
    percent(0);
    set('loading');
    run.slow = setTimeout(() => { if (phase === 'loading') set('slow'); }, SLOW_MS);
    run.giveUp = setTimeout(fail, GIVE_UP_MS);
    const mine = run;
    loadPlayer()
      .then(() => window.VeyletPlayerV2.start(ui.player, { base: sample.base, waitForTap: false, framed: false, hash: '', signal: controller.signal, onRetry: retry }))
      .then(outcome => {
        if (run !== mine) return;
        if (outcome && outcome.readiness === 'viewer-ready') live(); else fail();
      })
      .catch(() => { if (run === mine) fail(); });
  };

  const retry = () => { stop(); explore(); };

  const watch = () => {
    stop();
    if (!ui.video || !sample.video) return;
    const clip = document.createElement('video');
    clip.src = sample.video;
    if (sample.videoPoster) clip.poster = sample.videoPoster;
    clip.controls = true;
    clip.playsInline = true;
    clip.preload = 'metadata';
    clip.setAttribute('aria-label', 'Sample walkthrough video');
    ui.video.replaceChildren(clip);
    ui.video.hidden = false;
    set('video');
    if (!reduce.matches) { const playing = clip.play(); if (playing && playing.catch) playing.catch(() => {}); }
    clip.focus({ preventScroll: true });
  };

  const exit = () => {
    const wasImmersive = hero.hasAttribute('data-immersive');
    stop();
    if (ui.video) { ui.video.replaceChildren(); ui.video.hidden = true; }
    set(saveData ? 'save-data' : 'ready');
    if (wasImmersive) window.scrollTo(0, scrollAt);
    if (ui.explore) ui.explore.focus({ preventScroll: true });
  };

  window.addEventListener('veylet-viewer-progress', event => {
    if (run && (phase === 'loading' || phase === 'slow') && event.detail) percent(event.detail.percent);
  });
  if (ui.explore) {
    ui.explore.addEventListener('click', explore);
    ui.explore.addEventListener('pointerenter', preload);
    ui.explore.addEventListener('focus', preload);
  }
  if (ui.retry) ui.retry.addEventListener('click', retry);
  for (const button of hero.querySelectorAll('[data-hero-watch]')) button.addEventListener('click', watch);
  for (const button of hero.querySelectorAll('[data-hero-load]')) button.addEventListener('click', explore);
  if (ui.exit) ui.exit.addEventListener('click', exit);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (phase === 'live' || phase === 'video') && !event.defaultPrevented) exit();
  });

  // The poster fades in over its blurred placeholder; it breathes once (T11) unless motion is reduced.
  stage.dataset.motion = reduce.matches ? 'reduced' : 'full';
  const shown = () => { stage.dataset.poster = 'shown'; };
  const img = ui.poster && ui.poster.querySelector('img');
  if (!img || (img.complete && img.naturalWidth)) shown();
  else { img.addEventListener('load', shown, { once: true }); img.addEventListener('error', shown, { once: true }); }
  if (!reduce.matches) hero.dataset.intro = '';
  if (ui.nojs) ui.nojs.hidden = true;
  set(saveData ? 'save-data' : 'ready');
})();
