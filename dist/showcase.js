'use strict';
// Illustrations that explain the product: the hero capture loop and the
// walk-to-browser scene. Both are decorative (aria-hidden) beside real text, so
// the page reads the same if this file, GSAP or motion is unavailable.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const { gsap } = window;

  // Run a loop only while it can be seen, and never while the tab is hidden.
  const whileVisible = (element, start, stop) => {
    let onScreen = false;
    const sync = () => (onScreen && !document.hidden ? start() : stop());
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; sync(); }, { threshold: 0.2 }).observe(element);
    } else { onScreen = true; }
    document.addEventListener('visibilitychange', sync);
    sync();
  };

  /* ---------- Hero: turn at a spot until the ring closes, then the link ---------- */
  (() => {
    const stage = document.querySelector('[data-product-stage]');
    if (!stage) return;
    const ring = stage.querySelector('[data-cap-ring]');
    const count = stage.querySelector('[data-cap-count]');
    const camera = stage.querySelector('[data-cap-camera]');
    const link = stage.querySelector('[data-stage-link]');
    const walk = stage.querySelector('[data-stage-walk]');
    const pulse = stage.querySelector('[data-cap-saved]');
    if (!ring || !count || !camera || !link || !gsap) { stage.dataset.state = 'still'; return; }
    const length = 100; // the ring path uses pathLength="100"
    const state = { turn: 0 };
    const render = () => {
      ring.style.strokeDashoffset = String(length * (1 - state.turn));
      count.textContent = String(51 + Math.round(state.turn * 12));
    };
    let saved = 51;
    const timeline = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'none' } });
    timeline
      .set(link, { opacity: 0, y: 18 })
      .set(walk, { scale: 1 })
      .fromTo(camera, { xPercent: 0 }, { xPercent: -34, duration: 5.4, ease: 'sine.inOut' }, 0)
      .fromTo(state, { turn: 0 }, {
        turn: 1, duration: 5.4, ease: 'sine.inOut', onUpdate() {
          render();
          const now = Number(count.textContent);
          if (now !== saved && pulse) { saved = now; pulse.classList.remove('is-on'); void pulse.offsetWidth; pulse.classList.add('is-on'); }
        },
      }, 0)
      .to(link, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' }, 5.6)
      .to(walk, { scale: 1.16, duration: 3.2, ease: 'sine.inOut' }, 5.9)
      .to(link, { opacity: 0, y: 10, duration: 0.45, ease: 'power2.in' }, 9.4)
      .to(camera, { xPercent: 0, duration: 0.45, ease: 'power2.inOut' }, 9.4)
      .to(state, { turn: 0, duration: 0.45, onUpdate: render }, 9.4);

    const still = () => {
      timeline.pause(5.6 + 0.7);
      state.turn = 1; render();
      gsap.set(camera, { xPercent: -17 }); gsap.set(link, { opacity: 1, y: 0 });
    };
    const apply = () => {
      if (reduce.matches) { still(); stage.dataset.state = 'still'; return; }
      stage.dataset.state = 'live';
    };
    apply();
    reduce.addEventListener?.('change', apply);
    whileVisible(stage, () => { if (!reduce.matches) timeline.play(); }, () => { if (!reduce.matches) timeline.pause(); });
  })();

  /* ---------- Walk to browser: one space in four states ---------- */
  const demo = document.querySelector('[data-walk-demo]');
  if (!demo) return;
  const svg = demo.querySelector('[data-walk-scene]');
  const steps = Array.from(demo.querySelectorAll('[data-walk-step]'));
  const toggle = demo.querySelector('[data-walk-toggle]');
  const overlay = name => demo.querySelector(`[data-walk-overlay="${name}"]`);
  if (!svg || !steps.length || !gsap) return;

  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}, parent = null) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (parent) parent.appendChild(node);
    return node;
  };
  // Isometric projection in metres: x runs down-right, y down-left, z up.
  const K = { c: Math.cos(Math.PI / 6), s: 0.5, scale: 40, ox: 300, oy: 138 };
  const P = (x, y, z = 0) => [K.ox + (x - y) * K.c * K.scale, K.oy + (x + y) * K.s * K.scale - z * K.scale];
  const pts = list => list.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  const H = 2.5;

  const rooms = [
    [[0, 0], [5, 0], [5, 4.2], [0, 4.2]],
    [[5, 0], [8.5, 0], [8.5, 4.2], [5, 4.2]],
    [[0, 4.2], [4, 4.2], [4, 7.4], [0, 7.4]],
  ];
  // Walls facing the viewer are cut low, like a dolls' house, so rooms stay readable.
  const walls = [
    { a: [0, 0], b: [8.5, 0], cut: 1 },
    { a: [0, 0], b: [0, 7.4], cut: 1 },
    { a: [5, 0], b: [5, 1.4], cut: 1 },
    { a: [5, 2.6], b: [5, 4.2], cut: 1 },
    { a: [0, 4.2], b: [1.2, 4.2], cut: 1 },
    { a: [2.2, 4.2], b: [8.5, 4.2], cut: 0.26 },
    { a: [8.5, 0], b: [8.5, 4.2], cut: 0.26 },
    { a: [4, 4.2], b: [4, 7.4], cut: 0.26 },
    { a: [0, 7.4], b: [4, 7.4], cut: 0.26 },
  ].sort((m, n) => (m.a[0] + m.a[1] + m.b[0] + m.b[1]) - (n.a[0] + n.a[1] + n.b[0] + n.b[1]));
  const doors = [{ a: [5, 1.4], b: [5, 2.6] }, { a: [1.2, 4.2], b: [2.2, 4.2] }];
  const stops = [[1.7, 1.5], [3.5, 2.9], [6.9, 2.1], [2.0, 5.9]];
  const route = [[1.7, 1.5], [3.5, 2.9], [5, 2.0], [6.9, 2.1], [5, 2.0], [3.1, 3.4], [1.7, 4.2], [2.0, 5.9]];
  const stopAt = [0, 1, 3, 7]; // index of each stop in the route

  // Deterministic points for the reconstruction, so every visitor sees the same cloud.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const cloud = [];
  for (const wall of walls) {
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const top = H * wall.cut;
    for (let d = 0.15; d < len; d += 0.42) {
      for (let z = 0.2; z < top; z += 0.46) {
        const t = d / len;
        cloud.push([wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t, z + rand() * 0.12]);
      }
    }
  }
  for (const room of rooms) {
    const [x0, y0] = room[0]; const [x1, y1] = room[2];
    for (let i = 0; i < 16; i += 1) cloud.push([x0 + 0.3 + rand() * (x1 - x0 - 0.6), y0 + 0.3 + rand() * (y1 - y0 - 0.6), 0]);
  }

  svg.textContent = '';
  const defs = el('defs', {}, svg);
  const hatch = el('pattern', { id: 'walk-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 4, height: 4, fill: 'rgba(198,220,201,0.18)' }, hatch);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: 'rgba(198,220,201,0.8)', 'stroke-width': 1.4 }, hatch);

  const gFloors = el('g', { class: 'w-floors' }, svg);
  const floorNodes = rooms.map(room => el('polygon', { points: pts(room.map(([x, y]) => P(x, y))) }, gFloors));
  const gRoute = el('g', { class: 'w-route' }, svg);
  const routePath = el('path', { d: 'M' + route.map(([x, y]) => P(x, y).map(n => n.toFixed(1)).join(' ')).join(' L') }, gRoute);
  const rings = stops.map(([x, y]) => {
    const ring = [];
    for (let a = 0; a <= 36; a += 1) { const t = (a / 36) * Math.PI * 2 - Math.PI / 2; ring.push(P(x + Math.cos(t) * 0.46, y + Math.sin(t) * 0.46)); }
    const group = el('g', { class: 'w-stop' }, gRoute);
    const track = el('path', { class: 'w-ring-track', d: 'M' + ring.map(p => p.map(n => n.toFixed(1)).join(' ')).join(' L') }, group);
    const fill = el('path', { class: 'w-ring', pathLength: 100, d: track.getAttribute('d') }, group);
    const ticks = [];
    for (let i = 0; i < 12; i += 1) {
      const t = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const [ax, ay] = P(x + Math.cos(t) * 0.6, y + Math.sin(t) * 0.6);
      const [bx, by] = P(x + Math.cos(t) * 0.82, y + Math.sin(t) * 0.82);
      ticks.push(el('line', { class: 'w-tick', x1: ax.toFixed(1), y1: ay.toFixed(1), x2: bx.toFixed(1), y2: by.toFixed(1) }, group));
    }
    const [cx, cy] = P(x, y);
    el('circle', { class: 'w-spot', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 2.2 }, group);
    return { group, fill, ticks };
  });
  const phone = el('rect', { class: 'w-phone', width: 8, height: 13, rx: 2 }, gRoute);

  const gCloud = el('g', { class: 'w-cloud' }, svg);
  const cloudNodes = cloud.map(([x, y, z]) => {
    const [tx, ty] = P(x, y, z);
    const node = el('circle', { r: 1.25 }, gCloud);
    return { node, tx, ty, dx: (rand() - 0.5) * 220, dy: (rand() - 0.5) * 150 - 30 };
  });

  const gWalls = el('g', { class: 'w-walls' }, svg);
  const wallNodes = walls.map(wall => ({ wall, face: el('polygon', {}, gWalls) }));
  const doorNodes = doors.map(door => el('path', { class: 'w-door' }, gWalls));
  const frame = el('polygon', { class: 'w-frame', points: pts([P(1.6, 0, 1.15), P(2.7, 0, 1.15), P(2.7, 0, 1.9), P(1.6, 0, 1.9)]) }, gWalls);

  const gViewer = el('g', { class: 'w-viewer' }, svg);
  const cone = el('path', {}, gViewer);
  const eye = el('circle', { r: 3.4 }, gViewer);

  const routeLength = routePath.getTotalLength();
  // Route progress where each stop sits, measured along the drawn path.
  const segment = [];
  let run = 0;
  for (let i = 0; i < route.length; i += 1) {
    if (i > 0) { const [ax, ay] = P(...route[i - 1]); const [bx, by] = P(...route[i]); run += Math.hypot(bx - ax, by - ay); }
    segment.push(run);
  }
  const stopT = stopAt.map(i => segment[i] / run);

  const S = { route: 0, r0: 0, r1: 0, r2: 0, r3: 0, walls: 0, face: 0, cloud: 0, cloudOn: 0, doors: 0, privacy: 0, viewer: 0, viewerOn: 0, planOn: 1, routeOn: 1, sage: 0 };
  const render = () => {
    floorNodes.forEach(node => node.style.opacity = String(0.35 + 0.65 * S.planOn));
    routePath.style.strokeDasharray = `${routeLength}`;
    routePath.style.strokeDashoffset = `${routeLength * (1 - S.route)}`;
    gRoute.style.opacity = String(S.routeOn);
    gRoute.classList.toggle('is-sage', S.sage > 0.5);
    rings.forEach((ring, i) => {
      const t = S['r' + i];
      ring.group.style.opacity = S.route + 0.001 >= stopT[i] || t > 0 ? '1' : '0';
      ring.fill.style.strokeDashoffset = String(100 * (1 - t));
      ring.ticks.forEach((tick, n) => tick.style.opacity = t * 12 > n + 0.5 ? '1' : '0');
    });
    const here = routePath.getPointAtLength(routeLength * S.route);
    phone.setAttribute('x', (here.x - 4).toFixed(1));
    phone.setAttribute('y', (here.y - 15).toFixed(1));
    phone.style.opacity = S.route > 0 && S.route < 1 && S.walls === 0 ? '1' : [S.r0, S.r1, S.r2, S.r3].some(t => t > 0 && t < 1) ? '1' : '0';

    const settle = gsap.parseEase('expo.out')(S.cloud);
    gCloud.style.opacity = String(S.cloudOn);
    if (S.cloudOn > 0) {
      for (const p of cloudNodes) {
        p.node.setAttribute('cx', (p.tx + p.dx * (1 - settle)).toFixed(1));
        p.node.setAttribute('cy', (p.ty + p.dy * (1 - settle)).toFixed(1));
      }
    }
    for (const { wall, face } of wallNodes) {
      const h = H * wall.cut * S.walls;
      face.setAttribute('points', pts([P(...wall.a), P(...wall.b), P(...wall.b, h), P(...wall.a, h)]));
      face.style.opacity = S.walls > 0 ? String(0.25 + 0.75 * S.face) : '0';
    }
    doorNodes.forEach((node, i) => {
      const { a, b } = doors[i];
      const h = Math.min(2.1, H * S.walls);
      node.setAttribute('d', `M${P(...a, h)} L${P(...a)} L${P(...b)} L${P(...b, h)}`);
      node.style.opacity = String(S.doors);
    });
    frame.style.opacity = String(Math.min(S.face, 1) * (S.walls > 0.95 ? 1 : 0));
    frame.classList.toggle('is-private', S.privacy > 0.5);

    gViewer.style.opacity = String(S.viewerOn);
    if (S.viewerOn > 0) {
      const at = routePath.getPointAtLength(routeLength * S.viewer);
      const ahead = routePath.getPointAtLength(Math.min(routeLength, routeLength * S.viewer + 6));
      const angle = Math.atan2(ahead.y - at.y, ahead.x - at.x);
      const spread = 0.5; const reach = 46;
      const l = [at.x + Math.cos(angle - spread) * reach, at.y + Math.sin(angle - spread) * reach];
      const r = [at.x + Math.cos(angle + spread) * reach, at.y + Math.sin(angle + spread) * reach];
      cone.setAttribute('d', `M${at.x.toFixed(1)} ${at.y.toFixed(1)} L${l.map(n => n.toFixed(1)).join(' ')} Q${(at.x + Math.cos(angle) * reach * 1.15).toFixed(1)} ${(at.y + Math.sin(angle) * reach * 1.15).toFixed(1)} ${r.map(n => n.toFixed(1)).join(' ')} Z`);
      eye.setAttribute('cx', at.x.toFixed(1)); eye.setAttribute('cy', at.y.toFixed(1));
    }
  };

  const count = demo.querySelector('[data-walk-count]');
  const renderCount = () => { if (count) count.textContent = String(Math.round((S.r0 + S.r1 + S.r2 + S.r3) * 14 + S.route * 7)); };
  const checks = Array.from(demo.querySelectorAll('[data-walk-check]'));
  const sendBar = demo.querySelector('[data-walk-send]');
  const panels = ['capture', 'send', 'check', 'share'].map(overlay);

  const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.2, defaults: { ease: 'sine.inOut' }, onUpdate: () => { render(); renderCount(); sync(); } });
  const show = (name, at) => {
    panels.forEach((panel, i) => {
      if (!panel) return;
      const on = ['capture', 'send', 'check', 'share'][i] === name;
      tl.to(panel, { autoAlpha: on ? 1 : 0, y: on ? 0 : 8, duration: on ? 0.5 : 0.25, ease: on ? 'expo.out' : 'power2.in' }, at + (on ? 0.15 : 0));
    });
  };

  tl.addLabel('capture', 0);
  tl.set(S, { route: 0, r0: 0, r1: 0, r2: 0, r3: 0, walls: 0, face: 0, cloud: 0, cloudOn: 0, doors: 0, privacy: 0, viewer: 0, viewerOn: 0, planOn: 1, routeOn: 1, sage: 0 }, 0);
  checks.forEach(check => tl.set(check, { className: check.className.replace(/\s*is-done/g, '') }, 0));
  if (sendBar) tl.set(sendBar, { scaleX: 0 }, 0);
  show('capture', 0);
  let at = 0.3;
  stops.forEach((_, i) => {
    if (i > 0) { const d = (stopT[i] - stopT[i - 1]) * 3.2; tl.to(S, { route: stopT[i], duration: d, ease: 'none' }, at); at += d; }
    tl.to(S, { ['r' + i]: 1, duration: 1.05, ease: 'power1.inOut' }, at); at += 1.15;
  });
  tl.addLabel('send', at + 0.3);
  at += 0.3;
  show('send', at);
  tl.to(S, { sage: 1, planOn: 0.6, duration: 0.3 }, at);
  if (sendBar) tl.to(sendBar, { scaleX: 1, duration: 2, ease: 'power1.inOut' }, at + 0.6);
  at += 3.2;
  tl.addLabel('check', at);
  show('check', at);
  tl.to(S, { routeOn: 0.28, duration: 0.5 }, at);
  tl.fromTo(S, { cloud: 0, cloudOn: 0 }, { cloud: 1, cloudOn: 1, duration: 1.6, ease: 'none' }, at + 0.2);
  tl.to(S, { walls: 1, duration: 1.1, ease: 'expo.out' }, at + 1.5);
  tl.to(S, { face: 1, cloudOn: 0, planOn: 1, duration: 0.8 }, at + 1.9);
  tl.to(S, { doors: 1, duration: 0.4 }, at + 2.7);
  tl.to(S, { privacy: 1, duration: 0.01 }, at + 3.3);
  checks.forEach((check, i) => tl.set(check, { className: `${check.className.replace(/\s*is-done/g, '')} is-done` }, at + 2.5 + i * 0.55));
  at += 5;
  tl.addLabel('share', at);
  show('share', at);
  tl.to(S, { doors: 0, routeOn: 0.2, duration: 0.4 }, at);
  tl.fromTo(S, { viewer: 0, viewerOn: 0 }, { viewerOn: 1, duration: 0.4 }, at + 0.3);
  tl.to(S, { viewer: 1, duration: 4.6, ease: 'sine.inOut' }, at + 0.5);
  at += 5.8;
  tl.addLabel('end', at);
  tl.to(S, { viewerOn: 0, face: 0, walls: 0, duration: 0.6, ease: 'power2.in' }, at);
  show('none', at);
  tl.addLabel('loop', at + 0.7);

  const names = ['capture', 'send', 'check', 'share'];
  const bounds = names.map((name, i) => [tl.labels[name], i < 3 ? tl.labels[names[i + 1]] : tl.labels.end]);
  let current = -1;
  function sync() {
    const time = tl.time();
    const index = Math.max(0, bounds.findIndex(([a, b]) => time >= a && time < b));
    const active = time >= tl.labels.end ? 3 : index;
    steps.forEach((step, i) => {
      const [a, b] = bounds[i];
      const done = i < active ? 1 : i === active ? Math.min(1, (time - a) / (b - a)) : 0;
      step.style.setProperty('--walk-progress', done.toFixed(3));
      if (i === active && current !== i) step.setAttribute('aria-current', 'step');
      else if (i !== active) step.removeAttribute('aria-current');
    });
    current = active;
  }

  let paused = false;
  const setPaused = value => {
    paused = value;
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(value));
      toggle.querySelector('span').textContent = value ? 'Play' : 'Pause';
    }
    if (value) tl.pause(); else if (!reduce.matches && visible) tl.play();
  };
  let visible = false;
  // Reduced motion shows each state complete, and moves only when asked.
  const settle = name => tl.pause(Math.max(tl.labels[name], (name === 'share' ? tl.labels.end : tl.labels[names[names.indexOf(name) + 1]]) - 0.35));

  steps.forEach((step, i) => step.querySelector('button')?.addEventListener('click', () => {
    if (reduce.matches || paused) { settle(names[i]); render(); renderCount(); sync(); return; }
    tl.play(names[i]);
  }));
  toggle?.addEventListener('click', () => setPaused(!paused));

  const apply = () => {
    demo.dataset.state = reduce.matches ? 'still' : 'live';
    if (toggle) toggle.hidden = reduce.matches;
    if (reduce.matches) { settle('check'); render(); renderCount(); sync(); }
  };
  apply();
  reduce.addEventListener?.('change', apply);
  tl.progress(0); render(); sync();
  whileVisible(demo, () => { visible = true; if (!reduce.matches && !paused) tl.play(); }, () => { visible = false; tl.pause(); });
})();
