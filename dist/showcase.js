'use strict';
// Illustrations that explain the product: the homepage room preview, the hero
// capture loop, and the walk-to-browser architectural dollhouse. Decorative
// scenes sit beside complete HTML text and honour prefers-reduced-motion.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
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

  /* ---------- Homepage: 4-room stop-to-stop interactive micro-preview ---------- */
  (() => {
    const preview = document.querySelector('[data-home-preview]');
    if (!preview) return;
    const viewport = preview.querySelector('[data-preview-viewport]');
    const imgA = preview.querySelector('[data-preview-img="a"]');
    const imgB = preview.querySelector('[data-preview-img="b"]');
    const place = preview.querySelector('[data-preview-place]');
    const status = preview.querySelector('[data-preview-status]');
    const nextBtn = preview.querySelector('[data-preview-next]');
    const nextDisc = preview.querySelector('[data-preview-disc]');
    const nextLabel = preview.querySelector('[data-preview-next-label]');
    const buttons = Array.from(preview.querySelectorAll('[data-preview-room]'));
    if (!viewport || !imgA || !buttons.length) return;

    viewport.dataset.interactive = 'true';
    let activeIndex = 0;
    let frontIsA = true;
    let swapTimer = null;

    const syncMeta = announce => {
      const total = buttons.length;
      const currentName = buttons[activeIndex].dataset.previewRoom || '';
      const nextIndex = (activeIndex + 1) % total;
      const nextName = buttons[nextIndex].dataset.previewRoom || '';
      const line = `${currentName} · Stop ${activeIndex + 1} of ${total}`;
      if (place) place.textContent = line;
      if (announce && status) status.textContent = line;
      if (nextDisc) nextDisc.textContent = String(nextIndex + 1);
      if (nextLabel) nextLabel.textContent = `Next: ${nextName}`;
      buttons.forEach((btn, idx) => btn.setAttribute('aria-pressed', idx === activeIndex ? 'true' : 'false'));
    };

    const goTo = (targetIndex, announce = true) => {
      const total = buttons.length;
      const next = ((targetIndex % total) + total) % total;
      if (next === activeIndex) { syncMeta(announce); return; }
      activeIndex = next;
      const src = buttons[activeIndex].dataset.previewSrc;
      const alt = `Sample apartment ${buttons[activeIndex].dataset.previewRoom?.toLowerCase() || 'room'} from the walkthrough video.`;
      if (src) {
        if (!imgB || reduce.matches) {
          imgA.setAttribute('src', src);
          imgA.setAttribute('alt', alt);
        } else {
          const incoming = frontIsA ? imgB : imgA;
          const outgoing = frontIsA ? imgA : imgB;
          frontIsA = !frontIsA;
          incoming.setAttribute('src', src);
          incoming.setAttribute('alt', alt);
          incoming.hidden = false;
          delete incoming.dataset.fading;
          outgoing.dataset.fading = 'true';
          if (swapTimer && typeof clearTimeout === 'function') clearTimeout(swapTimer);
          if (typeof setTimeout === 'function') {
            swapTimer = setTimeout(() => { outgoing.hidden = true; }, 230);
          }
        }
      }
      syncMeta(announce);
    };

    buttons.forEach((btn, idx) => {
      btn.addEventListener('click', () => goTo(idx, true));
    });
    if (nextBtn) {
      nextBtn.addEventListener('click', event => {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        goTo(activeIndex + 1, true);
      });
    }

    // Horizontal drag pans 1:1 and steps between rooms on release; vertical touch scrolls the page.
    const SLOP = 6;
    let drag = null;
    const setPan = px => {
      if (viewport.style && typeof viewport.style.setProperty === 'function') {
        viewport.style.setProperty('--pan-x', `${px.toFixed(1)}px`);
      }
    };
    const clearDrag = () => { drag = null; setPan(0); };
    viewport.addEventListener('pointerdown', event => {
      if (!event || event.isPrimary === false) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, touch: event.pointerType === 'touch', locked: false };
      if (!drag.touch && viewport.setPointerCapture) {
        try { viewport.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      }
    });
    viewport.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.locked) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP) return;
        if (drag.touch && Math.abs(dy) >= Math.abs(dx)) { clearDrag(); return; }
        drag.locked = true;
      }
      drag.dx = dx;
      if (!reduce.matches) setPan(Math.max(-22, Math.min(22, dx * 0.28)));
    });
    viewport.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = drag.dx;
      const moved = drag.locked && Math.abs(dx) > 28;
      clearDrag();
      if (moved) goTo(activeIndex + (dx < 0 ? 1 : -1), true);
    });
    viewport.addEventListener('pointercancel', clearDrag);
    syncMeta(false);
  })();

  /* ---------- Hero: turn at a spot until the ring closes, then the buyer handoff ---------- */
  (() => {
    const stage = document.querySelector('[data-product-stage]');
    if (!stage) return;
    const ring = stage.querySelector('[data-cap-ring]');
    const count = stage.querySelector('[data-cap-count]');
    const spotsWrap = stage.querySelector('[data-cap-spots]');
    const spotDashes = spotsWrap ? Array.from(spotsWrap.querySelectorAll('span')) : [];
    const camera = stage.querySelector('[data-cap-camera]');
    const phoneBox = stage.querySelector('.stage-phone');
    const link = stage.querySelector('[data-stage-link]');
    const walk = stage.querySelector('[data-stage-walk]');
    const pulse = stage.querySelector('[data-cap-saved]');
    if (!ring || !count || !camera || !link || !gsap) { stage.dataset.state = 'still'; return; }

    const length = 100;
    const state = { turn: 0 };
    let lastSpot = 0;
    const render = () => {
      ring.style.strokeDashoffset = String(length * (1 - state.turn));
      const spot = Math.min(3, 1 + Math.floor(state.turn * 2.99));
      count.textContent = `Spot ${spot}`;
      spotDashes.forEach((dash, idx) => {
        const done = state.turn >= (idx + 1) / 3 - 0.04;
        dash.classList.toggle('is-done', done);
      });
      if (spot !== lastSpot && pulse) {
        lastSpot = spot;
        pulse.classList.remove('is-on');
        void pulse.offsetWidth;
        pulse.classList.add('is-on');
      }
    };

    const timeline = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: 'none' } });
    timeline
      .set(link, { opacity: 0, y: 14 })
      .set(walk, { scale: 1 })
      .set(camera, { opacity: 1, xPercent: 0 })
      .call(() => { delete stage.dataset.dissolve; lastSpot = 0; }, null, 0)
      .to(camera, { xPercent: -32, duration: 5.2, ease: 'sine.inOut' }, 0)
      .fromTo(state, { turn: 0 }, { turn: 1, duration: 5.2, ease: 'sine.inOut', onUpdate: render }, 0)
      .to(link, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }, 5.35)
      .to(walk, { scale: 1.12, duration: 3.1, ease: 'sine.inOut' }, 5.55)
      // Seamless cross-dissolve back to start — never whip-pans or counts backwards.
      .call(() => { stage.dataset.dissolve = 'true'; }, null, 8.85)
      .to(link, { opacity: 0, y: 8, duration: 0.32, ease: 'power2.out' }, 8.85)
      .to(camera, { opacity: 0.18, duration: 0.26, ease: 'power2.out' }, 8.9)
      .set(camera, { xPercent: 0 }, 9.18)
      .call(() => { state.turn = 0; lastSpot = 0; render(); }, null, 9.18)
      .to(camera, { opacity: 1, duration: 0.34, ease: 'power2.out' }, 9.2)
      .call(() => { delete stage.dataset.dissolve; }, null, 9.42);

    const still = () => {
      timeline.pause(5.9);
      delete stage.dataset.dissolve;
      state.turn = 1; render();
      gsap.set(camera, { opacity: 1, xPercent: -16 });
      gsap.set(link, { opacity: 1, y: 0 });
    };
    const apply = () => {
      if (reduce.matches) { still(); stage.dataset.state = 'still'; return; }
      stage.dataset.state = 'live';
    };
    apply();
    reduce.addEventListener?.('change', apply);
    whileVisible(stage, () => { if (!reduce.matches) timeline.play(); }, () => { if (!reduce.matches) timeline.pause(); });

    // Subtle spring-smoothed pointer depth on desktop pointer devices; sleeps at 0 CPU when resting.
    if (phoneBox && finePointer.matches && typeof requestAnimationFrame === 'function') {
      let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
      const tick = () => {
        cx += (tx - cx) * 0.1;
        cy += (ty - cy) * 0.1;
        phoneBox.style.transform = `translate3d(${(cx * -5).toFixed(2)}px, ${(cy * -4).toFixed(2)}px, 0)`;
        link.style.marginRight = `${(cx * -3).toFixed(2)}px`;
        if (Math.abs(tx - cx) > 0.004 || Math.abs(ty - cy) > 0.004) {
          raf = requestAnimationFrame(tick);
        } else {
          raf = 0;
        }
      };
      stage.addEventListener('pointermove', event => {
        if (reduce.matches || !finePointer.matches) return;
        const rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        if (!raf) raf = requestAnimationFrame(tick);
      }, { passive: true });
      stage.addEventListener('pointerleave', () => {
        tx = 0; ty = 0;
        if (!raf && !reduce.matches) raf = requestAnimationFrame(tick);
      }, { passive: true });
    }
  })();

  /* ---------- /start: animated Three Moves cards, paused off-screen ---------- */
  (() => {
    const moveGrid = document.querySelector('[data-move-cards]');
    if (!moveGrid) return;
    let cardsVisible = false;
    const syncCards = () => {
      moveGrid.dataset.playing = !reduce.matches && cardsVisible && !document.hidden ? 'true' : 'false';
    };
    reduce.addEventListener?.('change', syncCards);
    whileVisible(moveGrid, () => { cardsVisible = true; syncCards(); }, () => { cardsVisible = false; syncCards(); });
  })();

  /* ---------- Walk to browser: one space in four states (GPU-layered architectural dollhouse) ---------- */
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
  const K = { c: Math.cos(Math.PI / 6), s: 0.5, scale: 40, ox: 300, oy: 138 };
  const P = (x, y, z = 0) => [K.ox + (x - y) * K.c * K.scale, K.oy + (x + y) * K.s * K.scale - z * K.scale];
  const pts = list => list.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  const H = 2.5;

  const rooms = [
    { name: 'Living', poly: [[0, 0], [5, 0], [5, 4.2], [0, 4.2]], labelAt: [2.4, 0.8] },
    { name: 'Kitchen', poly: [[5, 0], [8.5, 0], [8.5, 4.2], [5, 4.2]], labelAt: [6.8, 0.8] },
    { name: 'Bedroom', poly: [[0, 4.2], [4, 4.2], [4, 7.4], [0, 7.4]], labelAt: [1.9, 6.7] },
  ];
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
  const stopAt = [0, 1, 3, 7];

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
    const [x0, y0] = room.poly[0]; const [x1, y1] = room.poly[2];
    for (let i = 0; i < 16; i += 1) cloud.push([x0 + 0.3 + rand() * (x1 - x0 - 0.6), y0 + 0.3 + rand() * (y1 - y0 - 0.6), 0]);
  }

  svg.textContent = '';
  const defs = el('defs', {}, svg);
  const hatch = el('pattern', { id: 'walk-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 4, height: 4, fill: 'rgba(198,220,201,0.18)' }, hatch);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 4, stroke: 'rgba(198,220,201,0.8)', 'stroke-width': 1.4 }, hatch);

  const gFloors = el('g', { class: 'w-floors' }, svg);
  const floorNodes = rooms.map(room => el('polygon', { points: pts(room.poly.map(([x, y]) => P(x, y))) }, gFloors));
  const labelNodes = rooms.map(room => {
    const [lx, ly] = P(...room.labelAt);
    const label = el('text', { class: 'w-room-label', x: lx.toFixed(1), y: ly.toFixed(1), 'text-anchor': 'middle' }, gFloors);
    label.textContent = room.name;
    return label;
  });

  const gRoute = el('g', { class: 'w-route' }, svg);
  const routePath = el('path', { d: 'M' + route.map(([x, y]) => P(x, y).map(n => n.toFixed(1)).join(' ')).join(' L') }, gRoute);
  const rings = stops.map(([x, y], index) => {
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
    el('ellipse', { class: 'w-stop-disc', cx: cx.toFixed(1), cy: cy.toFixed(1), rx: '7.6', ry: '5.2' }, group);
    const num = el('text', { class: 'w-stop-num', x: cx.toFixed(1), y: cy.toFixed(1) }, group);
    num.textContent = String(index + 1);
    return { group, fill, ticks };
  });
  const phone = el('rect', { class: 'w-phone', width: 8, height: 13, rx: 2 }, gRoute);

  // Group cloud points into 4 composited <g class="w-cloud-layer"> vectors instead of mutating 150 circles per frame.
  const gCloud = el('g', { class: 'w-cloud' }, svg);
  const CLOUD_VECTORS = [[-46, -34], [48, -28], [-38, 30], [42, 26]];
  const cloudLayers = CLOUD_VECTORS.map(([dx, dy]) => ({
    layer: el('g', { class: 'w-cloud-layer' }, gCloud),
    dx,
    dy,
  }));
  cloud.forEach(([x, y, z], idx) => {
    const [tx, ty] = P(x, y, z);
    el('circle', { cx: tx.toFixed(1), cy: ty.toFixed(1), r: '1.3' }, cloudLayers[idx % cloudLayers.length].layer);
  });

  const gWalls = el('g', { class: 'w-walls' }, svg);
  const wallNodes = walls.map(wall => ({ wall, face: el('polygon', {}, gWalls) }));
  const doorNodes = doors.map(door => el('path', { class: 'w-door' }, gWalls));
  const frame = el('polygon', { class: 'w-frame', points: pts([P(1.6, 0, 1.15), P(2.7, 0, 1.15), P(2.7, 0, 1.9), P(1.6, 0, 1.9)]) }, gWalls);

  const gViewer = el('g', { class: 'w-viewer' }, svg);
  const cone = el('path', {}, gViewer);
  const eye = el('circle', { r: 3.4 }, gViewer);

  const routeLength = routePath.getTotalLength();
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
    labelNodes.forEach(node => node.style.opacity = String(0.4 + 0.6 * S.planOn));
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
      const remain = 1 - settle;
      const scale = (0.92 + 0.08 * settle).toFixed(3);
      for (const { layer, dx, dy } of cloudLayers) {
        layer.style.transform = `translate3d(${(dx * remain).toFixed(1)}px, ${(dy * remain).toFixed(1)}px, 0) scale(${scale})`;
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
  const renderCount = () => {
    if (!count) return;
    const spotNum = S.r3 > 0 ? 4 : S.r2 > 0 ? 3 : S.r1 > 0 ? 2 : 1;
    count.textContent = `Spot ${spotNum}`;
  };
  const checks = Array.from(demo.querySelectorAll('[data-walk-check]'));
  const sendBar = demo.querySelector('[data-walk-send]');
  const panels = ['capture', 'send', 'check', 'share'].map(overlay);

  const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.2, defaults: { ease: 'sine.inOut' }, onUpdate: () => { render(); renderCount(); sync(); } });
  const show = (name, at) => {
    panels.forEach((panel, i) => {
      if (!panel) return;
      const on = ['capture', 'send', 'check', 'share'][i] === name;
      tl.to(panel, { autoAlpha: on ? 1 : 0, y: on ? 0 : 8, duration: on ? 0.42 : 0.2, ease: on ? 'expo.out' : 'power2.out' }, at + (on ? 0.12 : 0));
    });
  };

  tl.addLabel('capture', 0);
  tl.set(S, { route: 0, r0: 0, r1: 0, r2: 0, r3: 0, walls: 0, face: 0, cloud: 0, cloudOn: 0, doors: 0, privacy: 0, viewer: 0, viewerOn: 0, planOn: 1, routeOn: 1, sage: 0 }, 0);
  checks.forEach(check => tl.set(check, { className: check.className.replace(/\s*is-done/g, '') }, 0));
  if (sendBar) tl.set(sendBar, { scaleX: 0 }, 0);
  show('capture', 0);
  let at = 0.3;
  stops.forEach((_, i) => {
    if (i > 0) { const d = (stopT[i] - stopT[i - 1]) * 3.0; tl.to(S, { route: stopT[i], duration: d, ease: 'none' }, at); at += d; }
    tl.to(S, { ['r' + i]: 1, duration: 0.95, ease: 'power1.inOut' }, at); at += 1.05;
  });
  tl.addLabel('send', at + 0.25);
  at += 0.25;
  show('send', at);
  tl.to(S, { sage: 1, planOn: 0.6, duration: 0.3 }, at);
  if (sendBar) tl.to(sendBar, { scaleX: 1, duration: 1.8, ease: 'power2.out' }, at + 0.5);
  at += 2.9;
  tl.addLabel('check', at);
  show('check', at);
  tl.to(S, { routeOn: 0.28, duration: 0.45 }, at);
  tl.fromTo(S, { cloud: 0, cloudOn: 0 }, { cloud: 1, cloudOn: 1, duration: 1.4, ease: 'none' }, at + 0.15);
  tl.to(S, { walls: 1, duration: 1.0, ease: 'expo.out' }, at + 1.35);
  tl.to(S, { face: 1, cloudOn: 0, planOn: 1, duration: 0.75 }, at + 1.75);
  tl.to(S, { doors: 1, duration: 0.38 }, at + 2.5);
  tl.to(S, { privacy: 1, duration: 0.01 }, at + 3.0);
  checks.forEach((check, i) => tl.set(check, { className: `${check.className.replace(/\s*is-done/g, '')} is-done` }, at + 2.3 + i * 0.48));
  at += 4.6;
  tl.addLabel('share', at);
  show('share', at);
  tl.to(S, { doors: 0, routeOn: 0.2, duration: 0.38 }, at);
  tl.fromTo(S, { viewer: 0, viewerOn: 0 }, { viewerOn: 1, duration: 0.38 }, at + 0.25);
  tl.to(S, { viewer: 1, duration: 4.2, ease: 'sine.inOut' }, at + 0.45);
  at += 5.3;
  tl.addLabel('end', at);
  tl.to(S, { viewerOn: 0, face: 0, walls: 0, duration: 0.5, ease: 'power2.out' }, at);
  show('none', at);
  tl.addLabel('loop', at + 0.6);

  const names = ['capture', 'send', 'check', 'share'];
  const bounds = names.map((name, i) => [tl.labels[name], i < 3 ? tl.labels[names[i + 1]] : tl.labels.end]);
  let current = -1;
  let scrubTween = null;
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
    if (scrubTween) { scrubTween.kill(); scrubTween = null; }
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(value));
      toggle.querySelector('span').textContent = value ? 'Play' : 'Pause';
    }
    if (value) tl.pause(); else if (!reduce.matches && visible) tl.play();
  };
  let visible = false;
  const settle = name => tl.pause(Math.max(tl.labels[name], (name === 'share' ? tl.labels.end : tl.labels[names[names.indexOf(name) + 1]]) - 0.35));

  // Interruptible step navigation: glides smoothly from the live frame to the chosen step.
  steps.forEach((step, i) => step.querySelector('button')?.addEventListener('click', () => {
    if (scrubTween) { scrubTween.kill(); scrubTween = null; }
    if (reduce.matches || paused) { settle(names[i]); render(); renderCount(); sync(); return; }
    scrubTween = tl.tweenTo(names[i], {
      duration: 0.55,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => { render(); renderCount(); sync(); },
      onComplete: () => {
        scrubTween = null;
        if (!paused && !reduce.matches && visible) tl.play(names[i]);
      },
    });
  }));
  toggle?.addEventListener('click', () => setPaused(!paused));

  const apply = () => {
    demo.dataset.state = reduce.matches ? 'still' : 'live';
    if (toggle) toggle.hidden = reduce.matches;
    if (reduce.matches) { settle('check'); render(); renderCount(); sync(); }
  };
  apply();
  reduce.addEventListener?.('change', apply);
  tl.progress(0); render(); renderCount(); sync();
  whileVisible(demo, () => { visible = true; if (!reduce.matches && !paused) tl.play(); }, () => { visible = false; tl.pause(); });
})();
