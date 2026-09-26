'use strict';

/*
 * Veylet player v2: streamed walkthroughs (package_format_version 2).
 *
 * Order of work on every device: a 256 px preview, then the poster (both are
 * renders of the packaged scene from the opening stop), then the coarsest
 * level of detail, then finer levels within a splat budget chosen for the
 * device. The PlayCanvas engine 2.22.2 is vendored (MIT,
 * /vendor/LICENSE.playcanvas.txt) and imported only when this browser can
 * draw it. Package files are data: JSON and WebP. Nothing from a package runs.
 */
(() => {
  const ENGINE_URL = '/vendor/playcanvas-2.22.2.min.js?v=5c9bf4a346ca2e3d';
  const STYLE_URL = '/tour-player-v2.css?v=020748308707ba0e';
  const FORMAT = 2;
  // Released tours are served from the tour host; previews and QA from this origin.
  const PACKAGE_ORIGINS = Object.freeze(['https://tours.veylet.com']);
  const MANIFEST_LIMIT = 512 * 1024;
  const WALKABLE_LIMIT = 2 * 1024 * 1024;
  const SAFE_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\/){0,3}[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
  const HINT_KEY = 'veylet-player-hint-seen';

  class PlayerError extends Error {
    constructor(code, options) {
      super(code);
      this.code = code;
      this.transient = Boolean(options && options.transient);
    }
  }

  // ---------- pure helpers (unit tested) ----------

  const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const safePath = value => typeof value === 'string' && SAFE_PATH.test(value) && !value.split('/').includes('..');
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  /** The package folder URL. Only this origin or the tour host; never a query. */
  function resolveBase(value, page) {
    if (typeof value !== 'string' || !value || value.length > 1024) throw new PlayerError('package-location-invalid');
    let url;
    try { url = new URL(value, page.href); } catch { throw new PlayerError('package-location-invalid'); }
    const sameOrigin = url.origin === page.origin;
    if (!sameOrigin && (url.protocol !== 'https:' || !PACKAGE_ORIGINS.includes(url.origin))) throw new PlayerError('package-location-invalid');
    if (url.search || url.hash || url.username || url.password) throw new PlayerError('package-location-invalid');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  }

  function image(value, name) {
    if (!value || !safePath(value.path) || !/\.webp$/.test(value.path) || !Number.isInteger(value.width) || !Number.isInteger(value.height)
        || value.width < 16 || value.height < 16 || value.width > 4096 || value.height > 4096) throw new PlayerError('manifest-invalid:' + name);
    const fov = value.fov_degrees ?? 70;
    if (!Number.isFinite(fov) || fov < 20 || fov > 120) throw new PlayerError('manifest-invalid:' + name);
    return { path: value.path, width: value.width, height: value.height, fov };
  }

  /** Accept only the v2 package shape this player was built for. */
  function validateManifest(json) {
    const bad = field => { throw new PlayerError('manifest-invalid:' + field); };
    if (!json || typeof json !== 'object' || json.format !== 'veylet.tour-package') bad('format');
    if (json.package_format_version !== FORMAT) bad('version');
    const scene = json.scene || {};
    if (!safePath(scene.lod_meta) || !scene.lod_meta.endsWith('lod-meta.json')) bad('scene');
    if (!Number.isInteger(scene.lod_levels) || scene.lod_levels < 1 || scene.lod_levels > 8) bad('lod_levels');
    if (!Array.isArray(scene.lod_counts) || scene.lod_counts.length !== scene.lod_levels
        || !scene.lod_counts.every((count, i) => Number.isSafeInteger(count) && count > 0 && (i === 0 || count <= scene.lod_counts[i - 1]))) bad('lod_counts');
    if (!finite3(scene.rotation_degrees)) bad('rotation');
    if (!/^#[0-9a-f]{6}$/i.test(scene.background || '')) bad('background');
    const poster = json.poster || {};
    const shared = poster.fov_degrees;
    const posters = {
      landscape: image({ fov_degrees: shared, ...poster.landscape }, 'poster'),
      portrait: image({ fov_degrees: shared, ...poster.portrait }, 'poster'),
      preview: image({ fov_degrees: shared, ...poster.preview }, 'preview'),
    };
    if (json.walkable !== null && (!json.walkable || !safePath(json.walkable.path) || !json.walkable.path.endsWith('.json'))) bad('walkable');
    if (!Array.isArray(json.rooms) || json.rooms.length < 1 || json.rooms.length > 40) bad('rooms');
    const rooms = json.rooms.map(room => {
      if (!room || typeof room.id !== 'string' || !/^r\d{1,3}$/.test(room.id)) bad('room');
      if (room.name !== null && (typeof room.name !== 'string' || !room.name.trim() || room.name.length > 40)) bad('room');
      return { id: room.id, name: room.name };
    });
    if (!Array.isArray(json.stops) || json.stops.length < 1 || json.stops.length > 60) bad('stops');
    const stops = json.stops.map(stop => {
      if (!stop || !/^s\d{1,3}$/.test(stop.id || '') || !rooms.some(room => room.id === stop.room)
          || !finite3(stop.position) || !finite3(stop.target) || !finite3(stop.floor)) bad('stop');
      if (Math.hypot(...stop.position.map((v, i) => v - stop.target[i])) < 1e-3) bad('stop');
      // floor_id (whole-home packages): which floor the stop stands on. Anything else is ignored, not refused.
      const floorId = typeof stop.floor_id === 'string' && /^f\d{1,3}$/.test(stop.floor_id) ? stop.floor_id : null;
      return { id: stop.id, room: stop.room, position: stop.position, target: stop.target, floor: stop.floor, floorId };
    });
    if (!Number.isInteger(json.start_stop) || json.start_stop < 0 || json.start_stop >= stops.length) bad('start_stop');
    if (typeof json.truth_label !== 'string' || !json.truth_label || json.truth_label.length > 400) bad('truth_label');
    const chunked = scene.layout === undefined && scene.chunks === undefined ? null : readChunks(json, scene, rooms, stops, bad);
    return {
      synthetic: json.synthetic === true,
      truthLabel: json.truth_label,
      scene: { lodMeta: scene.lod_meta, levels: scene.lod_levels, counts: scene.lod_counts, rotation: scene.rotation_degrees, background: scene.background,
        ...(chunked ? { chunked } : {}) },
      posters,
      walkable: json.walkable ? json.walkable.path : null,
      rooms, stops, start: json.start_stop,
    };
  }

  /**
   * A whole-home package in chunks (local-pipeline/tools/chunked-manifest.md): one streamed scene per group of rooms.
   * scene.lod_meta names the opening chunk, so an older player would show that chunk alone; this one holds the chunk
   * of the room you are in and the chunks beyond its doorways. Doorways come from chunks[].adjacent, rooms[].adjacent
   * and portals, made symmetric. Anything malformed refuses the package rather than showing one room.
   */
  function readChunks(json, scene, rooms, stops, bad) {
    if (scene.layout !== 'chunked' || !Array.isArray(scene.chunks) || scene.chunks.length < 2 || scene.chunks.length > 40) bad('chunks');
    const roomIds = new Set(rooms.map(room => room.id));
    const chunkOfRoom = {};
    const ids = new Set();
    const chunks = scene.chunks.map(chunk => {
      if (!chunk || typeof chunk.id !== 'string' || !/^chunk_\d{1,3}$/.test(chunk.id) || ids.has(chunk.id)) bad('chunk');
      ids.add(chunk.id);
      if (!safePath(chunk.lod_meta) || chunk.lod_meta !== 'lod/' + chunk.id + '/lod-meta.json') bad('chunk');
      if (!Array.isArray(chunk.lod_counts) || chunk.lod_counts.length !== scene.lod_levels
          || !chunk.lod_counts.every((count, i) => Number.isSafeInteger(count) && count > 0 && (i === 0 || count <= chunk.lod_counts[i - 1]))) bad('chunk');
      if (!Array.isArray(chunk.rooms) || !chunk.rooms.length || chunk.rooms.some(room => !roomIds.has(room) || chunkOfRoom[room])) bad('chunk');
      for (const room of chunk.rooms) chunkOfRoom[room] = chunk.id;
      const bounds = chunk.bounds || {};
      if (!finite3(bounds.min) || !finite3(bounds.max) || bounds.min.some((v, i) => v > bounds.max[i])) bad('chunk');
      return { id: chunk.id, rooms: [...chunk.rooms], lodMeta: chunk.lod_meta, counts: chunk.lod_counts, bounds: { min: bounds.min, max: bounds.max }, listed: chunk.adjacent };
    });
    if (Object.keys(chunkOfRoom).length !== roomIds.size) bad('chunk');
    const links = new Map(chunks.map(chunk => [chunk.id, new Set()]));
    const link = (a, b) => { if (a && b && a !== b) { links.get(a).add(b); links.get(b).add(a); } };
    for (const chunk of chunks) {
      if (!Array.isArray(chunk.listed) || chunk.listed.some(other => !ids.has(other))) bad('chunk');
      for (const other of chunk.listed) link(chunk.id, other);
    }
    for (const room of json.rooms) if (Array.isArray(room.adjacent)) for (const other of room.adjacent) link(chunkOfRoom[room.id], chunkOfRoom[other]);
    if (Array.isArray(json.portals)) for (const portal of json.portals) if (portal) link(chunkOfRoom[portal.from_room], chunkOfRoom[portal.to_room]);
    const opening = chunkOfRoom[stops[json.start_stop]?.room];
    if (scene.opening_chunk !== opening || scene.lod_meta !== chunks.find(chunk => chunk.id === opening).lodMeta) bad('opening_chunk');
    return {
      levels: scene.lod_levels, opening, chunkOfRoom,
      chunks: chunks.map(({ listed, ...chunk }) => ({ ...chunk, adjacent: [...links.get(chunk.id)].sort() })),
    };
  }

  /** Doorway hops from chunk `from` to every chunk; a chunk with no way through is Infinity. */
  function chunkHops(chunked, from) {
    const hops = Object.fromEntries(chunked.chunks.map(chunk => [chunk.id, Infinity]));
    hops[from] = 0;
    const queue = [from];
    while (queue.length) {
      const at = queue.shift();
      for (const next of chunked.chunks.find(chunk => chunk.id === at).adjacent) if (hops[next] === Infinity) { hops[next] = hops[at] + 1; queue.push(next); }
    }
    return hops;
  }

  /**
   * What to hold with the viewer in chunk `current`: that chunk and the chunks beyond its doorways, the neighbours at
   * the coarsest level, the current chunk at the finest level whose splats fit the budget beside theirs, and never
   * finer than `finest` (Save-Data: the coarsest). Anything two or more doorways away is let go.
   */
  function chunkPlan(chunked, current, { held = [], budget = Infinity, saveData = false, finest = 0 } = {}) {
    const hops = chunkHops(chunked, current);
    const coarsest = chunked.levels - 1;
    const near = chunked.chunks.filter(chunk => hops[chunk.id] <= 1);
    const others = near.reduce((sum, chunk) => sum + (chunk.id === current ? 0 : chunk.counts[coarsest]), 0);
    const levelOf = chunk => {
      if (chunk.id !== current || saveData) return coarsest;
      const index = chunk.counts.findIndex((count, level) => level >= finest && count + others <= budget);
      return index < 0 ? coarsest : index;
    };
    const hold = near.map(chunk => ({ id: chunk.id, level: levelOf(chunk) }));
    return { current, hold, unload: held.filter(id => !(hops[id] <= 1)) };
  }

  /**
   * The finest level a chunk may take on this device. A chunk is at most 750K splats, so a phone's budget often fits
   * one whole where a single-scene room (larger) did not; phones stay one level down as they do for single scenes,
   * unless the profile gave them the high-end WebGPU budget (8 GB, 8 cores, Wi-Fi).
   */
  const finestChunkLevel = profile => (profile.kind === 'phone' && profile.maxBudget < 1_000_000 ? 1 : 0);

  /**
   * The chunk a floor position (capture space) belongs to. The chunk you are in while you stay inside its box, so a
   * doorway where two boxes overlap does not flip between them; else the chunk of the nearest stop (on this storey)
   * among the chunks whose box holds the point; else the nearest stop's chunk.
   */
  function chunkAt(manifest, position, current = null, storey = Infinity) {
    const { chunked } = manifest.scene;
    const inside = chunk => [0, 1, 2].every(i => position[i] >= chunk.bounds.min[i] - (i === 1 ? 1 : 0) && position[i] <= chunk.bounds.max[i] + (i === 1 ? 1 : 0));
    const own = current && chunked.chunks.find(chunk => chunk.id === current);
    if (own && inside(own)) return current;
    const boxes = new Set(chunked.chunks.filter(inside).map(chunk => chunk.id));
    let best = null, distance = Infinity;
    for (const pass of boxes.size ? [true, false] : [false]) {
      for (const stop of manifest.stops) {
        const chunk = chunked.chunkOfRoom[stop.room];
        if (Math.abs(stop.position[1] - position[1]) > storey || (pass && !boxes.has(chunk))) continue;
        const d = Math.hypot(stop.position[0] - position[0], stop.position[2] - position[2]);
        if (d < distance) { best = chunk; distance = d; }
      }
      if (best) return best;
    }
    return current || chunked.opening;
  }

  /** Splat budget and pixel ratio for this device class; the governor adapts from here. */
  function deviceProfile(env) {
    const shortSide = Math.min(env.screenWidth || 0, env.screenHeight || 0) || 800;
    const touch = Boolean(env.coarse || env.touchPoints > 0);
    const kind = touch && shortSide <= 540 ? 'phone' : touch && shortSide <= 1100 ? 'tablet' : 'desktop';
    const api = env.webgpu ? 'webgpu' : env.webgl2 ? 'webgl2' : null;
    const budgets = { phone: { webgpu: 1_000_000, webgl2: 500_000 }, tablet: { webgpu: 1_500_000, webgl2: 750_000 }, desktop: { webgpu: 3_000_000, webgl2: 2_000_000 } };
    let budget = api ? budgets[kind][api] : 0;
    // A phone on mobile data pays for every level. WebGPU phones take the
    // WebGL2 budget (one level down: 4 to 5 MB less on the rooms tested) unless
    // the browser reports a high-end device on Wi-Fi. Safari reports neither,
    // so iPhones stay one level down.
    const highEnd = env.memory >= 8 && env.cores >= 8;
    const unmetered = env.connectionType === 'wifi' || env.connectionType === 'ethernet';
    if (kind === 'phone' && api === 'webgpu' && !(highEnd && unmetered)) budget = budgets.phone.webgl2;
    const modest = (env.memory && env.memory <= 4) || (env.cores && env.cores <= 4);
    if (modest && kind !== 'desktop') budget = Math.round(budget * 0.7);
    const dpr = env.dpr || 1;
    const maxPixelRatio = kind === 'desktop' ? Math.min(dpr, 2) : Math.min(dpr, 1.5);
    // Save-Data: the coarsest level only, and no automatic upgrade.
    const saveData = Boolean(env.saveData);
    return { kind, api, budget, maxBudget: budget, minBudget: 150_000, maxPixelRatio, minPixelRatio: Math.min(1, dpr), saveData };
  }

  /**
   * Keeps motion at 30 fps or better. Pixel ratio goes first (cheapest to give
   * back), then the splat budget. Budget returns slowly when there is room.
   */
  function createGovernor(profile) {
    let samples = [], elapsed = 0, lastChange = -Infinity;
    const state = { budget: profile.budget, pixelRatio: profile.maxPixelRatio };
    return {
      state,
      // Decide on 45 frames or 1.5 s of frames, whichever comes first, so a
      // struggling device is helped within seconds rather than after 45 slow frames.
      sample(frameMs, now) {
        if (!(frameMs > 0) || frameMs > 1000) return null;
        samples.push(frameMs);
        elapsed += frameMs;
        if ((samples.length < 45 && (elapsed < 1500 || samples.length < 5)) || now - lastChange < 2000) return null;
        elapsed = 0;
        const sorted = [...samples].sort((a, b) => a - b);
        const fps = 1000 / sorted[Math.floor(sorted.length / 2)];
        samples = [];
        if (fps < 28) {
          lastChange = now;
          if (state.pixelRatio > profile.minPixelRatio + 0.01) {
            state.pixelRatio = Math.max(profile.minPixelRatio, Math.round(state.pixelRatio * 0.8 * 100) / 100);
            return { pixelRatio: state.pixelRatio, fps };
          }
          if (state.budget > profile.minBudget) {
            state.budget = Math.max(profile.minBudget, Math.round(state.budget * 0.75));
            return { budget: state.budget, fps };
          }
          return null;
        }
        if (fps > 50 && state.budget < profile.maxBudget) {
          lastChange = now;
          state.budget = Math.min(profile.maxBudget, Math.round(state.budget * 1.2));
          return { budget: state.budget, fps };
        }
        return null;
      },
    };
  }

  /**
   * The finest level that fits the budget whole. A room is one scene, so a
   * single level everywhere looks even and downloads only that level's files;
   * letting levels mix inside a room fetched most levels on a 0.5M budget.
   */
  function detailLevel(counts, budget, saveData = false) {
    if (saveData) return counts.length - 1;
    const index = counts.findIndex(count => count <= budget);
    return index < 0 ? counts.length - 1 : index;
  }

  function stopLabel(manifest, index) {
    const stop = manifest.stops[index];
    const room = manifest.rooms.find(item => item.id === stop.room);
    return { room: room && room.name ? room.name : '', stop: 'Stop ' + (index + 1) + ' of ' + manifest.stops.length };
  }

  const stepStop = (index, delta, count) => ((index + delta) % count + count) % count;

  /** Yaw and pitch (degrees) for a PlayCanvas camera, which looks down -Z. */
  function lookAngles(position, target) {
    const d = target.map((v, i) => v - position[i]);
    const length = Math.hypot(...d) || 1;
    return { yaw: Math.atan2(-d[0], -d[2]) * 180 / Math.PI, pitch: Math.asin(clamp(d[1] / length, -1, 1)) * 180 / Math.PI };
  }

  function forwardOf(yaw, pitch) {
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
    return [-Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y)];
  }

  /** The camera field of view that shows exactly what the cover-fitted poster shows. */
  function fieldOfView(aspect, poster, zoom = 1) {
    const posterAspect = poster.width / poster.height;
    if (aspect <= posterAspect) return { horizontal: false, fov: clamp(poster.fov * zoom, 20, 120) };
    const horizontal = 2 * Math.atan(Math.tan(poster.fov * Math.PI / 360) * posterAspect) * 180 / Math.PI;
    return { horizontal: true, fov: clamp(horizontal * zoom, 20, 130) };
  }

  const posterFor = (manifest, aspect) => aspect < 1 ? manifest.posters.portrait : manifest.posters.landscape;

  function decodeWalkable(json) {
    if (!json || json.version !== 1 || !Number.isFinite(json.cell_metres) || json.cell_metres <= 0 || json.cell_metres > 1
        || !Array.isArray(json.origin) || json.origin.length !== 2 || !json.origin.every(Number.isFinite)
        || !Number.isInteger(json.columns) || !Number.isInteger(json.rows) || json.columns < 1 || json.rows < 1 || json.columns * json.rows > 4_000_000
        || !Number.isFinite(json.floor_y) || !Number.isFinite(json.eye_height) || typeof json.mask !== 'string') {
      throw new PlayerError('walkable-invalid');
    }
    const binary = atob(json.mask);
    if (binary.length !== Math.ceil(json.columns * json.rows / 8)) throw new PlayerError('walkable-invalid');
    const bits = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const { columns, rows } = json, cell = json.cell_metres, [x0, z0] = json.origin;
    const on = (c, r) => c >= 0 && r >= 0 && c < columns && r < rows && ((bits[(r * columns + c) >> 3] >> ((r * columns + c) & 7)) & 1) === 1;
    const walkable = (x, z) => on(Math.floor((x - x0) / cell), Math.floor((z - z0) / cell));
    // Every sample on the straight line must be floor: no walking through walls.
    // `skip` metres from the start are not checked, so a viewer standing a hair
    // off the mask (a stop at the edge of the floor) can still walk away from it.
    const clear = (from, to, skip = 0) => {
      const dx = to[0] - from[0], dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(length / (cell / 2)));
      for (let i = 0; i <= steps; i++) {
        if (length * i / steps < skip) continue;
        if (!walkable(from[0] + dx * i / steps, from[1] + dz * i / steps)) return false;
      }
      return true;
    };
    const runs = [];
    for (let r = 0; r < rows; r++) {
      let start = -1;
      for (let c = 0; c <= columns; c++) {
        const lit = c < columns && on(c, r);
        if (lit && start < 0) start = c;
        if (!lit && start >= 0) { runs.push([x0 + start * cell, z0 + r * cell, (c - start) * cell, cell]); start = -1; }
      }
    }
    return { cell, origin: [x0, z0], columns, rows, floorY: json.floor_y, eyeHeight: json.eye_height, walkable, clear, on, runs };
  }

  /**
   * Where a tap should take the viewer, on the walkable mask (x, z), or null.
   * The tap's floor point if it is open floor in a straight line from here;
   * else the nearest open cell within `snap` metres of it that is (a tap on a
   * bed or a bench beside the path goes to the floor next to it); else as far
   * as the floor runs from here towards it, stopping `margin` short of the
   * obstacle. Moves shorter than `minStep` do not count.
   */
  function walkTarget(walkable, from, hit, { snap = 1, minStep = 0.3, margin = 0.2, skip = 0.25 } = {}) {
    const far = (point) => Math.hypot(point[0] - from[0], point[1] - from[1]) >= minStep;
    if (walkable.walkable(hit[0], hit[1]) && walkable.clear(from, hit, skip) && far(hit)) return hit;
    const { cell, origin: [x0, z0] } = walkable;
    const c0 = Math.floor((hit[0] - x0) / cell), r0 = Math.floor((hit[1] - z0) / cell), n = Math.ceil(snap / cell);
    let best = null, bestDistance = Infinity;
    for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
      if (!walkable.on(c, r)) continue;
      const point = [x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell];
      const distance = Math.hypot(point[0] - hit[0], point[1] - hit[1]);
      if (distance > snap || distance >= bestDistance || !far(point) || !walkable.clear(from, point, skip)) continue;
      best = point; bestDistance = distance;
    }
    if (best) return best;
    const dx = hit[0] - from[0], dz = hit[1] - from[1], length = Math.hypot(dx, dz);
    if (!(length > 0)) return null;
    const step = cell / 2;
    let open = 0, blocked = false;
    for (let d = step; d <= length + 1e-9; d += step) {
      if (d >= skip && !walkable.walkable(from[0] + dx * d / length, from[1] + dz * d / length)) { blocked = true; break; }
      open = d;
    }
    const reach = blocked ? open - margin : length;
    return reach >= minStep ? [from[0] + dx * reach / length, from[1] + dz * reach / length] : null;
  }

  /** Where a view ray meets the floor plane, if in front and within reach. */
  function floorHit(origin, direction, floorY, reach = 12) {
    if (direction[1] >= -1e-4) return null;
    const t = (floorY - origin[1]) / direction[1];
    if (!(t > 0) || t > reach) return null;
    return [origin[0] + direction[0] * t, floorY, origin[2] + direction[2] * t];
  }

  /** The point on the floor a tap aims at: where the ray meets it, or (for a
   *  tap at a wall, the horizon or above) `reach` metres along its heading. */
  function tapAim(origin, direction, floorY, reach = 8) {
    if (direction[1] > 0.35) return null; // the ceiling is not somewhere to go
    const hit = floorHit(origin, direction, floorY, reach);
    if (hit) return [hit[0], hit[2]];
    const flat = Math.hypot(direction[0], direction[2]);
    if (!(flat > 1e-6)) return null;
    return [origin[0] + direction[0] / flat * reach, origin[2] + direction[2] / flat * reach];
  }

  /** The stop nearest `position` across the floor; with `storey`, only stops whose eye is within that height. */
  function nearestStop(manifest, position, within = 0.35, storey = Infinity) {
    let best = -1, distance = within;
    manifest.stops.forEach((stop, index) => {
      if (Math.abs(stop.position[1] - position[1]) > storey) return;
      const d = Math.hypot(stop.position[0] - position[0], stop.position[2] - position[2]);
      if (d <= distance) { best = index; distance = d; }
    });
    return best;
  }

  // Floors more than this apart are different storeys, as package_tour_v2.mjs decides (STOREY_METRES).
  const STOREY_METRES = 1.5;
  const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]; };

  /**
   * The levels of a whole-home package, lowest first: Ground, Level 1, Level 2 … Each floor (floor_id) sits at
   * the median height of its stops' floor points; floors within STOREY_METRES of the one below are the same
   * level (a sunken lounge or a split level is not a new storey). A stop without a floor id joins the level
   * nearest its floor point. Returns null for one level, or when the package names fewer than two floors,
   * so single-floor walkthroughs keep their map exactly as before.
   */
  function storeysOf(stops) {
    const ids = [...new Set(stops.map(stop => stop.floorId).filter(Boolean))];
    if (ids.length < 2) return null;
    const floors = ids.map(id => ({ id, y: median(stops.filter(stop => stop.floorId === id).map(stop => stop.floor[1])) }))
      .sort((a, b) => a.y - b.y);
    const levels = [];
    for (const floor of floors) {
      const below = levels[levels.length - 1];
      if (below && floor.y - below.top <= STOREY_METRES) { below.ids.push(floor.id); below.top = floor.y; }
      else levels.push({ ids: [floor.id], y: floor.y, top: floor.y });
    }
    if (levels.length < 2) return null;
    const levelOf = stops.map(stop => {
      const own = levels.findIndex(level => level.ids.includes(stop.floorId));
      if (own >= 0) return own;
      let best = 0;
      levels.forEach((level, index) => { if (Math.abs(stop.floor[1] - level.y) < Math.abs(stop.floor[1] - levels[best].y)) best = index; });
      return best;
    });
    return levels.map((level, index) => {
      const members = stops.map((_, stop) => stop).filter(stop => levelOf[stop] === index);
      return { name: index === 0 ? 'Ground' : 'Level ' + index, floorIds: level.ids, stops: members,
        eye: median(members.map(stop => stops[stop].position[1])) };
    });
  }

  /** Which level an eye position is on: the one whose stops' eye height is nearest. */
  function levelAt(levels, position) {
    let best = 0;
    levels.forEach((level, index) => { if (Math.abs(position[1] - level.eye) < Math.abs(position[1] - levels[best].eye)) best = index; });
    return best;
  }

  function browserEnv() {
    const canvas = document.createElement('canvas');
    let webgl2 = false;
    try { webgl2 = Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2')); } catch { webgl2 = false; }
    return {
      screenWidth: window.screen?.width, screenHeight: window.screen?.height, dpr: window.devicePixelRatio || 1,
      coarse: Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches), touchPoints: navigator.maxTouchPoints || 0,
      memory: navigator.deviceMemory, cores: navigator.hardwareConcurrency,
      webgpu: Boolean(navigator.gpu), webgl2,
      saveData: Boolean(navigator.connection && navigator.connection.saveData),
      connectionType: navigator.connection && navigator.connection.type,
    };
  }

  /** Calls expire after `ms` of visible time; a background tab keeps its allowance. */
  function visibleDeadline(expire, ms) {
    let remaining = ms, started = null, timer = null, active = true;
    const pause = () => { clearTimeout(timer); timer = null; if (started !== null) remaining = Math.max(0, remaining - (performance.now() - started)); started = null; };
    const schedule = () => {
      if (!active) return;
      pause();
      if (document.hidden) return;
      started = performance.now();
      timer = setTimeout(() => { if (!active) return; active = false; document.removeEventListener('visibilitychange', schedule); expire(); }, remaining);
    };
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => { active = false; pause(); document.removeEventListener('visibilitychange', schedule); };
  }

  // ---------- network ----------

  async function fetchJson(url, limit, signal, timeoutMs = 15000) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      let response;
      try { response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' }); } catch { throw new PlayerError('package-unreachable', { transient: true }); }
      if (response.status === 404 || response.status === 410 || response.status === 403) throw new PlayerError('package-unavailable');
      if (!response.ok) throw new PlayerError('package-unreachable', { transient: true });
      const declared = Number(response.headers.get('content-length'));
      if (declared > limit) throw new PlayerError('package-oversized');
      const text = await response.text();
      if (text.length > limit) throw new PlayerError('package-oversized');
      try { return JSON.parse(text); } catch { throw new PlayerError('manifest-invalid:json'); }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  function ensureStyle() {
    const existing = document.querySelector('link[data-veylet-player-v2]');
    if (existing) return Promise.resolve();
    return new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = STYLE_URL;
      link.dataset.veyletPlayerV2 = '';
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 4000);
      link.onload = done;
      link.onerror = done;
      document.head.append(link);
    });
  }

  // ---------- interface ----------

  function el(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'hidden') node.hidden = true;
      else node.setAttribute(key, value === true ? '' : value);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const ICONS = {
    prev: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    map: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z M9 4v14 M15 6v14',
    stops: 'M5 7h14 M5 12h14 M5 17h9',
    full: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
    exit: 'M9 4v5H4 M20 9h-5V4 M15 20v-5h5 M4 15h5v5',
    info: 'M12 11v6 M12 7.5v.5 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    close: 'M6 6l12 12 M18 6L6 18',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }
  function iconButton(name, label, className, visibleText) {
    const button = el('button', { type: 'button', class: className, 'aria-label': label, title: label });
    button.append(icon(name));
    if (visibleText) button.append(el('span', { class: 'v2-label', 'aria-hidden': 'true' }, visibleText));
    return button;
  }

  function buildInterface(stage) {
    stage.replaceChildren();
    stage.classList.add('v2-stage');
    const root = el('div', { class: 'v2', 'data-state': 'opening' });
    const preview = el('img', { class: 'v2-preview', alt: '', decoding: 'async' });
    const poster = el('img', { class: 'v2-poster', alt: '', decoding: 'async' });
    const canvas = el('canvas', { class: 'v2-canvas', tabindex: '0', role: 'application',
      'aria-roledescription': '3D walkthrough',
      'aria-label': '3D walkthrough. Arrow keys look and move, N and P go to the next and previous stop, M shows the map.' });
    const hotspots = el('div', { class: 'v2-hotspots', 'aria-hidden': 'true' });
    const where = el('div', { class: 'v2-where' });
    const room = el('p', { class: 'v2-room' });
    const stopLine = el('p', { class: 'v2-stop' });
    const truth = el('p', { class: 'v2-truth' });
    where.append(room, stopLine, truth);
    const about = iconButton('info', 'About this walkthrough', 'v2-icon v2-about-toggle');
    about.setAttribute('aria-expanded', 'false');
    const top = el('div', { class: 'v2-top' });
    top.append(where, about);
    const status = el('p', { class: 'v2-status', role: 'status', 'aria-live': 'polite' });
    const progress = el('div', { class: 'v2-progress', hidden: true });
    progress.append(el('span'));
    const announce = el('p', { class: 'v2-sr', 'aria-live': 'polite' });
    const hint = el('p', { class: 'v2-hint', hidden: true }, 'Drag to look around. Tap the floor or a circle to move.');
    const prev = iconButton('prev', 'Previous stop', 'v2-icon v2-prev');
    const next = iconButton('next', 'Next stop', 'v2-primary v2-next', 'Next stop');
    const stopsToggle = el('button', { type: 'button', class: 'v2-stops-toggle', 'aria-expanded': 'false', 'aria-haspopup': 'true' });
    stopsToggle.append(icon('stops'), el('span', { class: 'v2-stops-text' }, 'Stops'));
    const mapToggle = iconButton('map', 'Show map of stops', 'v2-icon v2-map-toggle');
    mapToggle.setAttribute('aria-pressed', 'false');
    // Not .v2-full: the stylesheet hides that class in frames of 330 px and
    // under, which is exactly where full screen is needed most.
    const full = iconButton('full', 'Full screen', 'v2-icon v2-fullscreen');
    const bar = el('div', { class: 'v2-bar', role: 'toolbar', 'aria-label': 'Walkthrough controls', hidden: true });
    const moves = el('div', { class: 'v2-moves' });
    moves.append(prev, stopsToggle, next);
    const tools = el('div', { class: 'v2-tools' });
    tools.append(mapToggle, full);
    bar.append(moves, tools);
    const stopsPanel = el('div', { class: 'v2-panel v2-stops', role: 'dialog', 'aria-label': 'Rooms and stops', hidden: true });
    const map = el('figure', { class: 'v2-map', hidden: true });
    const aboutPanel = el('div', { class: 'v2-panel v2-about', role: 'dialog', 'aria-label': 'About this walkthrough', hidden: true });
    const fallback = el('section', { class: 'v2-fallback', hidden: true, 'aria-labelledby': 'v2-fallback-title' });
    root.append(preview, poster, canvas, hotspots, top, map, status, progress, hint, stopsPanel, aboutPanel, bar, fallback, announce);
    stage.append(root);
    return { root, preview, poster, canvas, hotspots, top, room, stopLine, truth, about, status, progress, announce, hint,
      prev, next, stopsToggle, mapToggle, full, bar, stopsPanel, map, aboutPanel, fallback };
  }

  const FALLBACK_WORDS = {
    'no-graphics': ['3D can’t open in this browser.', 'This still is rendered from the walkthrough. Open the link in a current browser, such as Safari or Chrome with hardware acceleration on, to walk through it.'],
    'engine-unavailable': ['3D didn’t load.', 'The 3D player files didn’t arrive. Check the connection and try again. This still is rendered from the walkthrough.'],
    'context-lost': ['3D stopped on this device.', 'The graphics memory was reclaimed, which can happen on phones with many tabs open. Try again, or close other tabs first.'],
    'too-slow': ['3D is taking too long.', 'The walkthrough is still loading. Try again on a faster connection. This still is rendered from the walkthrough.'],
  };

  // ---------- the player ----------

  /**
   * Resolves with the first 3D frame's outcome, or, with `waitForTap`, as soon
   * as the poster and its "Explore in 3D" invitation are on screen: the 3D
   * engine and scene download only after that press.
   */
  function start(stage, options = {}) {
    return new Promise((resolve, reject) => { play(stage, options, resolve).then(resolve, reject); });
  }

  async function play(stage, options, waiting) {
    const signal = options.signal;
    const page = options.page || location;
    const base = resolveBase(options.base, page);
    const env = options.env || browserEnv();
    const profile = deviceProfile(env);
    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const marks = {};
    const mark = name => { marks[name] = performance.now(); try { performance.mark('veylet:' + name); } catch { /* optional */ } };
    mark('start');
    let framed = Boolean(options.framed);
    if (options.framed === undefined) { try { framed = window.top !== window.self; } catch { framed = true; } }
    const waitForTap = Boolean(options.waitForTap && profile.api);
    // The engine download starts now, in parallel with the manifest, unless
    // the visitor is first asked to press Explore.
    const loadEngine = options.loadEngine || (() => import(ENGINE_URL));
    let enginePromise = null;
    const requestEngine = () => (enginePromise ||= Promise.resolve().then(loadEngine).catch(() => null));
    if (profile.api && !waitForTap) requestEngine();
    const manifestPromise = fetchJson(base + 'manifest.json', MANIFEST_LIMIT, signal);
    manifestPromise.catch(() => {}); // handled below, after the styles
    await ensureStyle();
    if (signal?.aborted) throw new PlayerError('playback-cancelled');
    const ui = buildInterface(stage);
    const manifest = validateManifest(await manifestPromise);
    mark('manifest');
    const walkablePromise = manifest.walkable
      ? fetchJson(base + manifest.walkable, WALKABLE_LIMIT, signal).then(decodeWalkable).catch(() => null)
      : Promise.resolve(null);

    // Preview, then poster. Both are renders of this package from the opening stop.
    const aspect = () => (stage.clientWidth || 16) / (stage.clientHeight || 9);
    let posterSpec = posterFor(manifest, aspect());
    ui.truth.textContent = manifest.synthetic ? 'Synthetic test scene · not to scale' : 'Captured on site · not to scale';
    ui.poster.alt = 'Opening view, rendered from the walkthrough';
    let visible = false;
    const becomeVisible = () => {
      if (visible) return;
      visible = true;
      stage.hidden = false;
      try { options.onVisible?.(); } catch { /* a surface hint never breaks playback */ }
    };
    ui.preview.addEventListener('load', () => { mark('preview'); ui.root.dataset.preview = 'shown'; becomeVisible(); }, { once: true });
    ui.poster.addEventListener('load', () => { mark('poster'); ui.root.dataset.poster = 'shown'; becomeVisible(); }, { once: true });
    ui.poster.addEventListener('error', () => becomeVisible(), { once: true });
    ui.preview.src = base + manifest.posters.preview.path;
    ui.poster.src = base + posterSpec.path;
    const labels = index => {
      const label = stopLabel(manifest, index);
      ui.room.textContent = label.room;
      ui.room.hidden = !label.room;
      ui.stopLine.textContent = label.stop;
      return label;
    };
    labels(manifest.start);

    const state = { stop: manifest.start, position: [...manifest.stops[manifest.start].position], zoom: 1, ...lookAngles(manifest.stops[manifest.start].position, manifest.stops[manifest.start].target) };
    let viewer = null, torndown = false, settled = false;
    let ready = false, phase = 'coarse', maxLoading = 0, sawLoading = false, readyFrames = 0, lastRender = 0, benchmark = null;
    let resolveReady;
    const firstFrame = new Promise(resolve => { resolveReady = resolve; });
    const settle = outcome => { if (settled) return; settled = true; cancelDeadline(); resolveReady(outcome); };
    let cancelDeadline = () => {};

    function fail(kind, retryable = true) {
      const [heading, body] = FALLBACK_WORDS[kind] || FALLBACK_WORDS['engine-unavailable'];
      ui.fallback.replaceChildren();
      const title = el('h2', { id: 'v2-fallback-title' }, heading);
      ui.fallback.append(title, el('p', {}, body));
      if (retryable) {
        const retry = el('button', { type: 'button', class: 'v2-primary' }, 'Try again');
        retry.addEventListener('click', () => (options.onRetry ? options.onRetry() : location.reload()));
        ui.fallback.append(retry);
      }
      ui.root.dataset.state = 'fallback';
      ui.fallback.hidden = false;
      ui.bar.hidden = true;
      ui.progress.hidden = true;
      ui.status.textContent = '';
      ui.canvas.hidden = true;
      ui.hotspots.replaceChildren();
      becomeVisible();
      teardown();
      const outcome = { readiness: 'viewer-failed', reason: kind, marks };
      settle(outcome);
      return outcome;
    }
    function teardown() {
      if (torndown) return;
      torndown = true;
      try { viewer?.destroy(); } catch { /* already gone */ }
    }
    signal?.addEventListener('abort', () => { teardown(); ui.root.remove(); }, { once: true });

    if (!profile.api) {
      await Promise.race([new Promise(resolve => ui.poster.addEventListener('load', resolve, { once: true })), new Promise(resolve => setTimeout(resolve, 4000))]);
      return fail('no-graphics', false);
    }
    if (waitForTap) {
      // Poster first, and nothing heavy until the visitor asks (a portal's frame).
      const explore = el('button', { type: 'button', class: 'v2-primary' }, 'Explore in 3D');
      const pressed = new Promise(resolve => explore.addEventListener('click', resolve, { once: true }));
      ui.fallback.replaceChildren(el('h2', { id: 'v2-fallback-title' }, 'Explore this property in 3D.'),
        el('p', {}, 'The walkthrough downloads when you start, so give it a moment on mobile data.'), explore);
      ui.fallback.hidden = false;
      ui.top.hidden = true; // a short frame has room for the invitation or the labels, not both
      becomeVisible();
      waiting({ readiness: 'waiting-for-tap', marks });
      await pressed;
      if (signal?.aborted) throw new PlayerError('playback-cancelled');
      ui.top.hidden = false;
      ui.fallback.hidden = true;
      ui.fallback.replaceChildren();
      mark('explore');
    }
    ui.status.textContent = 'Loading 3D…';
    const pc = await requestEngine();
    if (signal?.aborted) throw new PlayerError('playback-cancelled');
    if (!pc || !pc.createGraphicsDevice) return fail('engine-unavailable');
    mark('engine');
    const walkable = await walkablePromise;
    becomeVisible();
    // The first 3D frame gets 45 s of visible time; a hidden tab keeps its allowance.
    cancelDeadline = visibleDeadline(() => fail('too-slow'), 45000);

    let device;
    try {
      device = await pc.createGraphicsDevice(ui.canvas, {
        deviceTypes: profile.api === 'webgpu' ? ['webgpu', 'webgl2'] : ['webgl2'],
        antialias: false, depth: true, stencil: false, alpha: false, powerPreference: 'high-performance',
      });
    } catch { device = null; }
    if (!device || device.deviceType === 'null') return fail('no-graphics', false);
    const api = device.deviceType === 'webgpu' ? 'webgpu' : 'webgl2';
    if (api !== profile.api) Object.assign(profile, deviceProfile({ ...env, webgpu: false }));
    const governor = createGovernor(profile);
    device.maxPixelRatio = governor.state.pixelRatio;
    let saveData = profile.saveData; // until the visitor asks for full detail

    const app = new pc.Application(ui.canvas, { graphicsDevice: device });
    viewer = app;
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    try { app.loader.getHandler('texture').imgParser.crossOrigin = 'anonymous'; } catch { /* same-origin packages need nothing */ }
    const levels = manifest.scene.levels;
    app.scene.gsplat.splatBudget = governor.state.budget;
    // After the first pass, each part of the room goes straight to the level
    // its distance and the budget call for; the coarse data stays on screen
    // until that level arrives, so no bytes go on levels in between.
    app.scene.gsplat.lodUnderfillLimit = 0;
    const camera = new pc.Entity('camera');
    camera.addComponent('camera', { clearColor: new pc.Color().fromString(manifest.scene.background), nearClip: 0.05, farClip: 200 });
    app.root.addChild(camera);
    // A chunked package holds chunks instead (see chunkPlan): the opening chunk alone until the first 3D frame.
    const chunked = manifest.scene.chunked || null;
    const held = new Map(); // chunk id -> { entity, asset, level, settled }
    let splat = null, asset = null;
    let currentChunk = chunked ? chunked.opening : null;
    function holdChunk(id) {
      const chunk = chunked.chunks.find(item => item.id === id);
      const entity = new pc.Entity(id);
      entity.setLocalEulerAngles(...manifest.scene.rotation);
      const chunkAsset = new pc.Asset(id, 'gsplat', { url: base + chunk.lodMeta });
      app.assets.add(chunkAsset);
      entity.addComponent('gsplat', { asset: chunkAsset, unified: true });
      entity.gsplat.lodRangeMin = levels - 1;
      entity.gsplat.lodRangeMax = levels - 1;
      app.root.addChild(entity);
      const item = { entity, asset: chunkAsset, level: levels - 1, settled: false };
      held.set(id, item);
      return item;
    }
    if (!chunked) {
      splat = new pc.Entity('walkthrough');
      splat.setLocalEulerAngles(...manifest.scene.rotation);
      asset = new pc.Asset('walkthrough', 'gsplat', { url: base + manifest.scene.lodMeta });
      app.assets.add(asset);
      splat.addComponent('gsplat', { asset, unified: true });
      // First pass: the coarsest level only, so the room appears as soon as it can.
      splat.gsplat.lodRangeMin = levels - 1;
      splat.gsplat.lodRangeMax = levels - 1;
      app.root.addChild(splat);
    } else holdChunk(currentChunk);

    const reduced = () => reduceQuery.matches;
    let continuous = 0; // frames that must render back to back (moves, drags, streaming)
    const requestRender = () => { app.renderNextFrame = true; };
    function applyCamera() {
      camera.setPosition(...state.position);
      camera.setEulerAngles(state.pitch, state.yaw, 0);
      const view = fieldOfView(aspect(), posterSpec, state.zoom);
      camera.camera.horizontalFov = view.horizontal;
      camera.camera.fov = view.fov;
      requestRender();
      placeHotspots();
    }

    // ----- stops, hotspots, map -----
    // A home on more than one level: one level at a time, on the map and on the floor discs.
    const storeys = storeysOf(manifest.stops);
    const levelOf = storeys ? manifest.stops.map((_, index) => storeys.findIndex(level => level.stops.includes(index))) : null;
    let viewerLevel = storeys ? levelOf[manifest.start] : 0;
    const hotspotButtons = manifest.stops.map((stop, index) => {
      const button = el('button', { type: 'button', class: 'v2-hotspot', tabindex: '-1' });
      button.append(el('span', {}, String(index + 1)));
      button.addEventListener('click', event => { event.stopPropagation(); goToStop(index); });
      ui.hotspots.append(button);
      return button;
    });
    const screen = new pc.Vec3(), world = new pc.Vec3();
    function placeHotspots() {
      if (!ready) return;
      const forward = forwardOf(state.yaw, state.pitch);
      const width = ui.canvas.clientWidth, height = ui.canvas.clientHeight;
      if (storeys) viewerLevel = levelAt(storeys, state.position);
      manifest.stops.forEach((stop, index) => {
        const button = hotspotButtons[index];
        // A stop on another level would draw through the ceiling or the floor.
        if (storeys && levelOf[index] !== viewerLevel) { button.hidden = true; return; }
        const d = stop.floor.map((v, i) => v - state.position[i]);
        const distance = Math.hypot(d[0], d[2]);
        const inFront = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2] > 0.2;
        const reachable = !walkable || walkable.clear([state.position[0], state.position[2]], [stop.floor[0], stop.floor[2]]);
        if (index === state.stop && distance < 0.4 || !inFront || !reachable || distance > 12) { button.hidden = true; return; }
        world.set(...stop.floor);
        camera.camera.worldToScreen(world, screen);
        // A disc half off the edge is still worth a tap.
        if (screen.x < -12 || screen.y < -12 || screen.x > width + 12 || screen.y > height + 12) { button.hidden = true; return; }
        button.hidden = false;
        const size = clamp(Math.round(260 / Math.max(distance, 0.8)), 28, 64);
        button.style.setProperty('--size', size + 'px');
        button.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px)`;
        button.title = [stopLabel(manifest, index).room, 'Stop ' + (index + 1)].filter(Boolean).join(' · ');
      });
      drawMapMarker();
    }

    function buildStopsPanel() {
      ui.stopsPanel.replaceChildren();
      const heading = el('div', { class: 'v2-panel-head' });
      heading.append(el('h2', {}, manifest.rooms.length > 1 ? 'Rooms and stops' : 'Stops'));
      const close = iconButton('close', 'Close', 'v2-icon');
      close.addEventListener('click', () => togglePanel(ui.stopsPanel, ui.stopsToggle, false));
      heading.append(close);
      ui.stopsPanel.append(heading);
      for (const room of manifest.rooms) {
        const group = el('section', { class: 'v2-room-group' });
        if (manifest.rooms.length > 1 || room.name) group.append(el('h3', {}, room.name || 'Other stops'));
        const list = el('ol');
        manifest.stops.forEach((stop, index) => {
          if (stop.room !== room.id) return;
          const item = el('li');
          const button = el('button', { type: 'button', class: 'v2-stop-button', 'data-stop': String(index) }, 'Stop ' + (index + 1));
          button.addEventListener('click', () => { togglePanel(ui.stopsPanel, ui.stopsToggle, false); goToStop(index); });
          item.append(button);
          list.append(item);
        });
        group.append(list);
        ui.stopsPanel.append(group);
      }
    }
    function markCurrent() {
      for (const button of ui.stopsPanel.querySelectorAll('[data-stop]')) {
        if (Number(button.dataset.stop) === state.stop) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      }
      ui.stopsToggle.querySelector('.v2-stops-text').textContent = (state.stop >= 0 ? (state.stop + 1) : '–') + ' of ' + manifest.stops.length;
      ui.stopsToggle.setAttribute('aria-label', 'Rooms and stops, stop ' + (state.stop >= 0 ? state.stop + 1 : 'none') + ' of ' + manifest.stops.length);
    }
    function aboutContents() {
      ui.aboutPanel.replaceChildren();
      const heading = el('div', { class: 'v2-panel-head' });
      heading.append(el('h2', {}, 'About this walkthrough'));
      const close = iconButton('close', 'Close', 'v2-icon');
      close.addEventListener('click', () => togglePanel(ui.aboutPanel, ui.about, false));
      heading.append(close);
      const controls = el('ul', { class: 'v2-controls' });
      for (const line of [
        'Drag to look around. Pinch, or use + and −, to zoom.',
        walkable ? 'Tap the floor or a numbered circle to move there.' : 'Tap a numbered circle, or Next stop, to move.',
        'Keys: arrows look and move, N and P change stop, 1 to 9 pick a stop, M shows the map.',
      ]) controls.append(el('li', {}, line));
      const credits = el('p', { class: 'v2-credits' }, 'Rendered with the PlayCanvas engine 2.22.2 (MIT licence). ');
      const licence = el('a', { href: '/vendor/LICENSE.playcanvas.txt', target: '_blank', rel: 'noopener' }, 'Licence');
      credits.append(licence);
      ui.aboutPanel.append(heading, el('p', { class: 'v2-truth-full' }, manifest.truthLabel), controls);
      if (saveData) {
        // Data Saver is on: low detail stays unless the visitor asks for more.
        const more = el('button', { type: 'button', class: 'v2-primary' }, 'Load full detail');
        more.addEventListener('click', () => {
          saveData = false;
          more.remove();
          note.textContent = 'Loading full detail.';
          if (!ready) return;
          if (chunked) {
            // Mid-room change: the promotion that follows reads saveData.
            if (phase === 'room') return;
            promoteCurrent();
          } else {
            stats.level = detailLevel(manifest.scene.counts, governor.state.budget);
            splat.gsplat.lodRangeMin = stats.level;
          }
          if (phase === 'complete') { phase = 'detail'; maxLoading = 0; sawLoading = false; readyFrames = 0; continuous++; }
          ui.status.textContent = 'Sharpening detail…';
          ui.progress.hidden = false;
          requestRender();
        });
        const note = el('p', { class: 'v2-credits' }, 'Data Saver is on, so this walkthrough shows at low detail.');
        ui.aboutPanel.append(note, more);
      }
      ui.aboutPanel.append(credits);
    }

    // Map of stops: floor from the walkable mask, turned so the opening view points up.
    const mapTurn = lookAngles(manifest.stops[manifest.start].position, manifest.stops[manifest.start].target).yaw;
    let mapMarker = null, mapHeading = null, mapGroup = null;
    // With storeys: the level the map shows (it follows the viewer; a floor button picks another), each
    // level's drawn parts, and the floor buttons.
    let mapLevel = viewerLevel, mapShownFor = viewerLevel;
    const mapParts = [], floorButtons = [];
    function showMapLevel(level) {
      mapLevel = level;
      for (const [node, on] of mapParts) { if (on === level) node.removeAttribute('display'); else node.setAttribute('display', 'none'); }
      floorButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === level)));
      if (mapMarker) { if (level === viewerLevel) mapMarker.removeAttribute('display'); else mapMarker.setAttribute('display', 'none'); }
    }
    function buildFloorButtons() {
      // Layout here until tour-player-v2.css carries .v2-floors (the buttons reuse .v2-icon and its pressed state).
      const group = el('div', { class: 'v2-floors', role: 'group', 'aria-label': 'Floors' });
      Object.assign(group.style, { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px', margin: '0 0 6px' });
      storeys.forEach((level, index) => {
        const button = el('button', { type: 'button', class: 'v2-icon v2-floor', 'aria-pressed': 'false' }, level.name);
        button.addEventListener('click', () => showMapLevel(index));
        floorButtons.push(button);
        group.append(button);
      });
      return group;
    }
    function buildMap() {
      const ns = 'http://www.w3.org/2000/svg';
      // Framed on the stops, with the floor around them for context.
      const xs = manifest.stops.map(stop => stop.floor[0]), zs = manifest.stops.map(stop => stop.floor[2]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const half = Math.max(2, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 1.2);
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `${-half} ${-half} ${half * 2} ${half * 2}`);
      svg.setAttribute('aria-hidden', 'true');
      mapGroup = document.createElementNS(ns, 'g');
      // Map x right, z down; turned so the opening view faces up.
      mapGroup.setAttribute('transform', `rotate(${mapTurn}) translate(${-cx} ${-cz})`);
      if (walkable) {
        const floor = document.createElementNS(ns, 'path');
        floor.setAttribute('class', 'v2-map-floor');
        floor.setAttribute('d', walkable.runs.map(([x, z, w, h]) => `M${x.toFixed(2)} ${z.toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}z`).join(''));
        mapGroup.append(floor);
        // The walkable floor is carved for the opening stop's level only.
        if (storeys) mapParts.push([floor, levelOf[manifest.start]]);
      }
      manifest.stops.forEach((stop, index) => {
        const dot = document.createElementNS(ns, 'g');
        dot.setAttribute('class', 'v2-map-stop');
        dot.setAttribute('transform', `translate(${stop.floor[0]} ${stop.floor[2]})`);
        const circle = document.createElementNS(ns, 'circle');
        // Sizes scale with the view, so dots and numbers keep one on-screen size.
        circle.setAttribute('r', String(half * 0.1));
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('transform', `rotate(${-mapTurn})`);
        label.setAttribute('font-size', String(half * 0.12));
        label.setAttribute('dy', String(half * 0.042));
        label.textContent = String(index + 1);
        dot.append(circle, label);
        dot.addEventListener('click', () => goToStop(index));
        mapGroup.append(dot);
        if (storeys) mapParts.push([dot, levelOf[index]]);
      });
      mapMarker = document.createElementNS(ns, 'g');
      mapMarker.setAttribute('class', 'v2-map-you');
      mapHeading = document.createElementNS(ns, 'path');
      const r = half * 0.3;
      mapHeading.setAttribute('d', `M0 0L${(-r * 0.45).toFixed(3)} ${(-r).toFixed(3)}A${r} ${r} 0 0 1 ${(r * 0.45).toFixed(3)} ${(-r).toFixed(3)}Z`);
      const you = document.createElementNS(ns, 'circle');
      you.setAttribute('r', String(half * 0.05));
      mapMarker.append(mapHeading, you);
      mapGroup.append(mapMarker);
      svg.append(mapGroup);
      const caption = el('figcaption', {}, 'Map of stops · not to scale');
      if (!storeys) { ui.map.replaceChildren(svg, caption); return; }
      ui.map.replaceChildren(buildFloorButtons(), svg, caption);
      showMapLevel(mapLevel);
    }
    function drawMapMarker() {
      if (!mapMarker) return;
      // Reaching another level brings the map with you; a level picked by hand stays until then.
      if (storeys && viewerLevel !== mapShownFor) { mapShownFor = viewerLevel; showMapLevel(viewerLevel); }
      // Heading in map space: yaw 0 looks toward -z, which is map-up before the turn.
      mapMarker.setAttribute('transform', `translate(${state.position[0].toFixed(3)} ${state.position[2].toFixed(3)}) rotate(${(-state.yaw).toFixed(1)})`);
    }

    function togglePanel(panel, toggle, open) {
      const show = open ?? panel.hidden;
      for (const [other, button] of [[ui.stopsPanel, ui.stopsToggle], [ui.aboutPanel, ui.about]]) {
        if (other !== panel && !other.hidden) { other.hidden = true; button.setAttribute('aria-expanded', 'false'); }
      }
      panel.hidden = !show;
      toggle.setAttribute('aria-expanded', String(show));
      // One overlay at a time: the map steps aside while a panel is open.
      if (show) ui.root.dataset.panel = 'open'; else delete ui.root.dataset.panel;
      if (show) {
        const target = panel.querySelector('[aria-current="true"]') || panel.querySelector('button');
        target?.focus();
      } else if (panel.contains(document.activeElement) || document.activeElement === document.body) toggle.focus();
    }

    // ----- movement -----
    let flight = null;
    const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function flyTo(position, yaw, pitch, onArrive) {
      flight = null;
      if (reduced()) {
        Object.assign(state, { position, yaw, pitch });
        applyCamera();
        onArrive?.();
        return;
      }
      let deltaYaw = ((yaw - state.yaw) % 360 + 540) % 360 - 180;
      const from = { position: [...state.position], yaw: state.yaw, pitch: state.pitch };
      const distance = Math.hypot(...position.map((v, i) => v - from.position[i]));
      const duration = clamp(450 + distance * 220, 450, 1100);
      flight = { from, position, deltaYaw, pitch, duration, started: performance.now(), onArrive };
      continuous++;
    }
    function stepFlight(now) {
      if (!flight) return;
      const t = clamp((now - flight.started) / flight.duration, 0, 1), k = easeInOut(t);
      state.position = flight.from.position.map((v, i) => v + (flight.position[i] - v) * k);
      state.yaw = flight.from.yaw + flight.deltaYaw * k;
      state.pitch = flight.from.pitch + (flight.pitch - flight.from.pitch) * k;
      applyCamera();
      if (t >= 1) { const done = flight.onArrive; flight = null; continuous = Math.max(0, continuous - 1); done?.(); }
    }
    // On a home with levels, a stop straight above or below is not where you are.
    const sameLevel = storeys ? STOREY_METRES : Infinity;
    function arrived(index) {
      state.stop = index;
      const label = labels(index >= 0 ? index : Math.max(0, nearestStop(manifest, state.position, 99, sameLevel)));
      if (index < 0) ui.stopLine.textContent = 'Between stops';
      markCurrent();
      placeHotspots();
      ui.announce.textContent = [label.room, index >= 0 ? label.stop : 'Between stops'].filter(Boolean).join(', ');
    }
    function goToStop(index) {
      if (!ready) return;
      dismissHint();
      const stop = manifest.stops[index];
      const look = lookAngles(stop.position, stop.target);
      // A chunked home starts streaming the room ahead as the move starts; far rooms go once there.
      if (chunked) enterChunk(chunked.chunkOfRoom[stop.room]);
      flyTo([...stop.position], look.yaw, look.pitch, () => { arrived(index); if (chunked) releaseFarChunks(); });
    }
    function walkTo(point) {
      const eye = walkable ? walkable.eyeHeight : 1.4;
      const target = [point[0], point[1] + eye, point[2]];
      if (chunked) enterChunk(chunkAt(manifest, target, currentChunk, sameLevel));
      flyTo(target, state.yaw, state.pitch, () => { arrived(nearestStop(manifest, target, 0.35, sameLevel)); if (chunked) releaseFarChunks(); });
    }
    let messageTimer = null;
    function say(message) {
      ui.status.textContent = message;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => { if (ui.status.textContent === message) ui.status.textContent = ''; }, 3500);
    }
    function stepForward(sign) {
      if (!walkable) { say('Use Next stop, or N and P, to move.'); return; }
      const forward = forwardOf(state.yaw, 0);
      const to = [state.position[0] + forward[0] * 0.35 * sign, state.position[2] + forward[2] * 0.35 * sign];
      if (!walkable.clear([state.position[0], state.position[2]], to)) { say('A wall or furniture is in the way.'); return; }
      walkTo([to[0], walkable.floorY, to[1]]);
    }
    function aimFor(clientX, clientY) {
      const rect = ui.canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const near = camera.camera.screenToWorld(x, y, camera.camera.nearClip, new pc.Vec3());
      const far = camera.camera.screenToWorld(x, y, camera.camera.farClip, new pc.Vec3());
      const direction = [far.x - near.x, far.y - near.y, far.z - near.z];
      const length = Math.hypot(...direction);
      return tapAim([near.x, near.y, near.z], direction.map(v => v / length), walkable.floorY);
    }
    function tapAt(clientX, clientY) {
      if (!walkable) { say('Tap a circle or Next stop to move.'); return; }
      const aim = aimFor(clientX, clientY);
      const to = aim && walkTarget(walkable, [state.position[0], state.position[2]], aim);
      // Short enough to fit a 280 px phone frame on one line.
      if (!to) { say('Can’t walk there. Try open floor.'); return; }
      walkTo([to[0], walkable.floorY, to[1]]);
    }

    // ----- input -----
    const pointers = new Map();
    let drag = null, pinch = null, engaged = false;
    ui.canvas.addEventListener('pointerdown', event => {
      if (!ready) return;
      engaged = true;
      dismissHint();
      ui.canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), moved: 0 };
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
        drag = null;
      }
      continuous++;
    });
    ui.canvas.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        state.zoom = clamp(pinch.zoom * pinch.distance / Math.max(distance, 1), 0.55, 1.3);
        applyCamera();
      } else if (drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX; drag.y = event.clientY;
        drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY));
        const perPixel = camera.camera.fov / Math.max(1, camera.camera.horizontalFov ? ui.canvas.clientWidth : ui.canvas.clientHeight);
        flight = null;
        state.yaw += dx * perPixel;
        state.pitch = clamp(state.pitch + dy * perPixel, -80, 80);
        applyCamera();
      }
    });
    const release = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      continuous = Math.max(0, continuous - 1);
      // A finger wobbles: a short press that moved a little is still a tap.
      const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
      if (drag && event.type === 'pointerup' && drag.moved < (touch ? 16 : 8) && performance.now() - drag.time < (touch ? 600 : 450)) tapAt(event.clientX, event.clientY);
      if (pointers.size < 2) pinch = null;
      drag = null;
    };
    ui.canvas.addEventListener('pointerup', release);
    ui.canvas.addEventListener('pointercancel', release);
    // A listing page scrolls with the wheel; zoom only on a trackpad pinch,
    // and inside someone else's page only once the visitor has used the player.
    ui.canvas.addEventListener('wheel', event => {
      if (!ready || !event.ctrlKey || (framed && !engaged)) return;
      event.preventDefault();
      state.zoom = clamp(state.zoom * Math.exp(event.deltaY * 0.01), 0.55, 1.3);
      applyCamera();
    }, { passive: false });
    ui.canvas.addEventListener('keydown', event => {
      if (!ready || event.altKey || event.metaKey || event.ctrlKey) return;
      engaged = true;
      const key = event.key;
      const handled = () => { event.preventDefault(); dismissHint(); };
      if (key === 'ArrowLeft' || key === 'ArrowRight') { handled(); flight = null; state.yaw += key === 'ArrowLeft' ? 10 : -10; applyCamera(); }
      else if (key === 'ArrowUp' || key === 'ArrowDown') { handled(); stepForward(key === 'ArrowUp' ? 1 : -1); }
      else if (key === 'PageUp' || key === 'PageDown') { handled(); state.pitch = clamp(state.pitch + (key === 'PageUp' ? 8 : -8), -80, 80); applyCamera(); }
      else if (key === 'n' || key === 'N' || key === ']') { handled(); goToStop(stepStop(Math.max(state.stop, 0), 1, manifest.stops.length)); }
      else if (key === 'p' || key === 'P' || key === '[') { handled(); goToStop(stepStop(state.stop < 0 ? 0 : state.stop, -1, manifest.stops.length)); }
      else if (/^[1-9]$/.test(key) && Number(key) <= manifest.stops.length) { handled(); goToStop(Number(key) - 1); }
      else if (key === 'Home') { handled(); goToStop(manifest.start); }
      else if (key === '+' || key === '=') { handled(); state.zoom = clamp(state.zoom * 0.9, 0.55, 1.3); applyCamera(); }
      else if (key === '-' || key === '_') { handled(); state.zoom = clamp(state.zoom / 0.9, 0.55, 1.3); applyCamera(); }
      else if (key === 'm' || key === 'M') { handled(); toggleMap(); }
    });
    // Any press anywhere in the player means the visitor has found the controls.
    ui.root.addEventListener('pointerdown', () => dismissHint(), true);
    ui.root.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!ui.stopsPanel.hidden) { event.preventDefault(); togglePanel(ui.stopsPanel, ui.stopsToggle, false); }
      else if (!ui.aboutPanel.hidden) { event.preventDefault(); togglePanel(ui.aboutPanel, ui.about, false); }
    });
    const escapeFull = event => { if (event.key === 'Escape' && pseudo) { event.preventDefault(); setPseudo(false); } };
    document.addEventListener('keydown', escapeFull);
    ui.prev.addEventListener('click', () => goToStop(stepStop(state.stop < 0 ? 0 : state.stop, -1, manifest.stops.length)));
    ui.next.addEventListener('click', () => goToStop(stepStop(Math.max(state.stop, 0), 1, manifest.stops.length)));
    ui.stopsToggle.addEventListener('click', () => togglePanel(ui.stopsPanel, ui.stopsToggle));
    ui.about.addEventListener('click', () => togglePanel(ui.aboutPanel, ui.about));
    function toggleMap(show) {
      const open = show ?? ui.map.hidden;
      ui.map.hidden = !open;
      ui.mapToggle.setAttribute('aria-pressed', String(open));
      ui.mapToggle.setAttribute('aria-label', open ? 'Hide map of stops' : 'Show map of stops');
      ui.mapToggle.title = ui.mapToggle.getAttribute('aria-label');
    }
    ui.mapToggle.addEventListener('click', () => toggleMap());
    // Full screen: the Fullscreen API where there is one (prefixed on iPad);
    // otherwise the stage fills the window (iPhone Safari has no element
    // full screen). In a frame without the API, filling the frame changes
    // nothing, so the button opens the walkthrough's own page when given one.
    const nativeFull = document.fullscreenEnabled && stage.requestFullscreen ? 'standard'
      : document.webkitFullscreenEnabled && stage.webkitRequestFullscreen ? 'webkit' : null;
    const openUrl = typeof options.fullscreenUrl === 'string' && /^https:\/\//.test(options.fullscreenUrl) ? options.fullscreenUrl : null;
    const fullMode = nativeFull || (!framed ? 'pseudo' : openUrl ? 'open' : null);
    const fullElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    let pseudo = null; // the stage's own inline style while it fills the window
    const isFull = () => pseudo !== null || (fullElement() !== null && fullElement() === stage);
    function setPseudo(on) {
      if (on === (pseudo !== null)) return;
      const root = document.documentElement;
      if (on) {
        pseudo = { style: stage.getAttribute('style'), overflow: root.style.overflow };
        Object.assign(stage.style, { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', width: '100vw', height: '100vh',
          maxWidth: 'none', minHeight: '0', margin: '0', borderRadius: '0', zIndex: '2147483000' });
        stage.style.height = '100dvh'; // kept at 100vh where dvh is unknown
        root.style.overflow = 'hidden';
      } else {
        if (pseudo.style === null) stage.removeAttribute('style'); else stage.setAttribute('style', pseudo.style);
        root.style.overflow = pseudo.overflow;
        pseudo = null;
      }
      fullscreenChanged();
    }
    ui.full.hidden = !fullMode;
    ui.full.addEventListener('click', () => {
      if (fullMode === 'open') { window.open(openUrl, '_blank', 'noopener'); return; }
      if (pseudo) { setPseudo(false); return; }
      if (fullMode === 'pseudo') { setPseudo(true); return; }
      const fallback = () => (framed ? say('Full screen isn’t available here.') : setPseudo(true));
      try {
        if (fullElement()) {
          const done = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
          done?.catch?.(() => {});
        } else {
          const done = nativeFull === 'standard' ? stage.requestFullscreen() : stage.webkitRequestFullscreen();
          done?.catch?.(fallback);
        }
      } catch { fallback(); }
    });
    function fullscreenChanged() {
      const on = isFull();
      ui.full.replaceChildren(icon(on ? 'exit' : 'full'));
      ui.full.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      ui.full.title = ui.full.getAttribute('aria-label');
      fitBar();
    }
    // Under 320 px the bar has room for five controls, not six: the map (which
    // would cover most of so small a view) gives way to Full screen.
    function fitBar() {
      const narrow = stage.clientWidth > 0 && stage.clientWidth < 320 && !isFull();
      if (narrow && !ui.map.hidden) toggleMap(false);
      ui.mapToggle.hidden = narrow;
    }
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('webkitfullscreenchange', fullscreenChanged);

    let hintTimer = null;
    function dismissHint() {
      if (ui.hint.hidden) return;
      ui.hint.hidden = true;
      clearTimeout(hintTimer);
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* per-viewer convenience only */ }
    }
    function offerHint() {
      let seen = false;
      try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { seen = false; }
      // A small embed has no room for a hint over the room itself.
      if (seen || stage.clientHeight < 420 || stage.clientWidth < 360) return;
      ui.hint.hidden = false;
      hintTimer = setTimeout(dismissHint, 9000);
    }

    // ----- rendering, loading phases and frame pacing -----
    const stats = { api, kind: profile.kind, budget: governor.state.budget, pixelRatio: governor.state.pixelRatio, saveData, frames: [], changes: [] };
    if (chunked) stats.rooms = []; // per room change: the chunk and how long "Loading this room…" showed

    // ----- chunked packages: the room you are in, the rooms beyond its doorways, nothing further -----
    // Phases after the first frame: 'room' while newly held chunks load at the coarsest level (the room you walked
    // into first, then its neighbours), then 'detail' while the current chunk streams its promoted level.
    const ROOM_LOADING = 'Loading this room…';
    let roomWait = null; // { chunk, since } while "Loading this room…" shows
    let progressBase = 0; // share of the bar the neighbours' coarse pass took on this run
    const coarsest = levels - 1;
    function setChunkLevel(item, level) {
      if (!item || item.level === level) return;
      item.level = level;
      item.entity.gsplat.lodRangeMin = level;
    }
    function addChunk(id) {
      const item = holdChunk(id);
      item.asset.on('error', () => fail('engine-unavailable'));
      app.assets.load(item.asset);
      return item;
    }
    function startRun() {
      if (phase === 'complete') continuous++;
      maxLoading = 0; sawLoading = false; readyFrames = 0;
    }
    function promoteCurrent() {
      const plan = chunkPlan(chunked, currentChunk, { held: [...held.keys()], budget: governor.state.budget, saveData, finest: finestChunkLevel(profile) });
      stats.level = plan.hold.find(item => item.id === currentChunk).level;
      setChunkLevel(held.get(currentChunk), stats.level);
    }
    // The next step of a run: neighbours not yet held load at the coarsest level, then the current chunk is promoted.
    function nextChunkStep() {
      const missing = chunkPlan(chunked, currentChunk, { held: [...held.keys()] }).hold.filter(item => !held.has(item.id));
      maxLoading = 0; sawLoading = false; readyFrames = 0;
      if (missing.length) { for (const item of missing) addChunk(item.id); phase = 'room'; return; }
      // The first run's bar: the neighbours' coarse pass fills the first 30 %, the room's detail the rest.
      progressBase = sharpening() ? 0.3 : 0;
      phase = 'detail';
      promoteCurrent();
    }
    const sharpening = () => ui.status.textContent === 'Sharpening detail…';
    // Everything held has arrived at its level.
    function chunksSettled() {
      for (const item of held.values()) item.settled = true;
      if (roomWait) {
        stats.rooms.push({ chunk: roomWait.chunk, ms: Math.round(performance.now() - roomWait.since) });
        roomWait = null;
        if (ui.status.textContent === ROOM_LOADING) ui.status.textContent = '';
        ui.progress.hidden = true;
      }
      nextChunkStep();
    }
    // The viewer is heading into chunk `id`: the chunk left behind drops to the coarsest level, the new one loads
    // first if it is not here yet (with a small note that does not block looking or moving), then its neighbours.
    function enterChunk(id) {
      if (!ready || !id || id === currentChunk) return;
      setChunkLevel(held.get(currentChunk), coarsest);
      currentChunk = id;
      startRun();
      progressBase = 0;
      if (roomWait) { roomWait = null; if (ui.status.textContent === ROOM_LOADING) ui.status.textContent = ''; ui.progress.hidden = true; }
      const item = held.get(id);
      if (item && item.settled) { nextChunkStep(); return; }
      if (!item) addChunk(id);
      phase = 'room';
      roomWait = { chunk: id, since: performance.now() };
      ui.status.textContent = ROOM_LOADING;
      ui.progress.hidden = false;
      ui.progress.firstChild.style.transform = 'scaleX(0)';
    }
    // On arrival: chunks two or more doorways from here are destroyed and their data unloaded.
    function releaseFarChunks() {
      for (const id of chunkPlan(chunked, currentChunk, { held: [...held.keys()] }).unload) {
        const item = held.get(id);
        held.delete(id);
        item.entity.destroy();
        app.assets.remove(item.asset);
        item.asset.unload();
      }
    }

    app.systems.gsplat.on('frame:request', requestRender);
    app.systems.gsplat.on('frame:ready', (cam, layer, frameReady, loadingCount) => {
      if (loadingCount > 0) sawLoading = true;
      if (phase === 'room') {
        maxLoading = Math.max(maxLoading, loadingCount);
        const done = maxLoading ? (maxLoading - loadingCount) / maxLoading : 1;
        if (roomWait) ui.progress.firstChild.style.transform = `scaleX(${done.toFixed(3)})`;
        else if (sharpening()) ui.progress.firstChild.style.transform = `scaleX(${(done * 0.3).toFixed(3)})`;
        if (frameReady && loadingCount === 0 && (sawLoading || ++readyFrames >= 30)) chunksSettled();
        return;
      }
      if (phase === 'coarse') {
        if (!frameReady || loadingCount > 0) return;
        // Data served from cache may never show as loading; a settled second of frames will do.
        if (!sawLoading && ++readyFrames < 30) return;
        phase = 'detail';
        mark('first-3d');
        ready = true;
        ui.root.dataset.state = 'ready';
        ui.canvas.hidden = false;
        ui.bar.hidden = false;
        ui.status.textContent = saveData ? '' : 'Sharpening detail…';
        ui.progress.hidden = saveData;
        ui.progress.firstChild.style.transform = 'scaleX(0)';
        // Finer levels now stream under the budget, over what is already on screen.
        if (chunked) {
          // The rooms beyond the doorways at the coarsest level, then this room's detail.
          stats.level = coarsest;
          nextChunkStep();
        } else {
          stats.level = detailLevel(manifest.scene.counts, governor.state.budget, saveData);
          splat.gsplat.lodRangeMin = stats.level;
        }
        sawLoading = false;
        readyFrames = 0;
        requestRender();
        placeHotspots();
        markCurrent();
        offerHint();
        settle({ readiness: 'viewer-ready', marks, stats });
        return;
      }
      if (phase === 'detail') {
        maxLoading = Math.max(maxLoading, loadingCount);
        const done = maxLoading ? (maxLoading - loadingCount) / maxLoading : 1;
        if (!chunked) ui.progress.firstChild.style.transform = `scaleX(${done.toFixed(3)})`;
        else if (sharpening()) ui.progress.firstChild.style.transform = `scaleX(${(progressBase + (1 - progressBase) * done).toFixed(3)})`;
        if (frameReady && loadingCount === 0 && (sawLoading || ++readyFrames >= 30)) {
          phase = 'complete';
          // A chunked home completes again after each room change; the mark is the opening room's detail.
          if (!chunked || !marks.detail) mark('detail');
          ui.progress.hidden = true;
          if (ui.status.textContent === 'Sharpening detail…') ui.status.textContent = '';
          continuous = Math.max(0, continuous - 1);
        }
      }
    });
    continuous++; // stream the first levels continuously; released when detail completes
    app.on('update', () => {
      const now = performance.now();
      stepFlight(now);
      if (continuous > 0 || benchmark) requestRender();
      if (benchmark) {
        state.yaw += benchmark.degreesPerFrame;
        applyCamera();
        if (now > benchmark.until) { const done = benchmark.done; benchmark = null; done(); }
      }
    });
    app.on('postrender', () => {
      const now = performance.now();
      if (lastRender && (continuous > 0 || benchmark)) {
        const frameMs = now - lastRender;
        stats.frames.push(frameMs);
        if (stats.frames.length > 600) stats.frames.shift();
        const change = governor.sample(frameMs, now);
        if (change) {
          stats.changes.push({ at: Math.round(now), ...change });
          if (change.pixelRatio) { device.maxPixelRatio = change.pixelRatio; stats.pixelRatio = change.pixelRatio; app.updateCanvasSize(); }
          if (change.budget) {
            app.scene.gsplat.splatBudget = change.budget;
            stats.budget = change.budget;
            if (chunked) { if (phase === 'detail' || phase === 'complete') promoteCurrent(); }
            else if (phase !== 'coarse') { stats.level = detailLevel(manifest.scene.counts, change.budget, saveData); splat.gsplat.lodRangeMin = stats.level; }
          }
        }
      }
      lastRender = now;
    });
    const observer = new ResizeObserver(() => {
      fitBar();
      posterSpec = ready ? posterFor(manifest, aspect()) : posterSpec;
      app.updateCanvasSize();
      applyCamera();
    });
    observer.observe(stage);
    const lost = () => fail('context-lost');
    device.on?.('devicelost', lost);
    ui.canvas.addEventListener('webglcontextlost', lost);
    const visibility = () => { if (!document.hidden) requestRender(); };
    document.addEventListener('visibilitychange', visibility);

    buildStopsPanel();
    aboutContents();
    buildMap();
    markCurrent();
    ui.canvas.hidden = false;
    app.autoRender = false;
    app.updateCanvasSize();
    applyCamera();
    if (chunked) for (const item of held.values()) app.assets.load(item.asset);
    else app.assets.load(asset);
    app.start();
    if (chunked) for (const item of held.values()) item.asset.on('error', () => fail('engine-unavailable'));
    else asset.on('error', () => fail('engine-unavailable'));
    // A wide screen has room for the map from the start; phones, and frames on
    // someone else's page, open it on request.
    toggleMap(stage.clientWidth >= 900 && !framed);
    fitBar();

    const originalDestroy = app.destroy.bind(app);
    viewer = {
      destroy() {
        observer.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        document.removeEventListener('fullscreenchange', fullscreenChanged);
        document.removeEventListener('webkitfullscreenchange', fullscreenChanged);
        document.removeEventListener('keydown', escapeFull);
        setPseudo(false);
        originalDestroy();
      },
    };
    const controller = {
      stats: () => ({ ...stats, marks: { ...marks }, phase, stop: state.stop, fps: medianFps(stats.frames),
        ...(chunked ? { chunk: currentChunk, chunks: [...held].map(([id, item]) => ({ id, level: item.level, settled: item.settled })) } : {}) }),
      goToStop, tapAt,
      // For QA: whether a tap here aims at open floor on the walkable mask.
      probe: (clientX, clientY) => {
        const aim = walkable && aimFor(clientX, clientY);
        return { aim, openFloor: Boolean(aim && walkable.walkable(aim[0], aim[1])) };
      },
      // For QA and measurement: the camera state and where each stop's floor disc projects.
      inspect: () => {
        const discs = manifest.stops.map(stop => { world.set(...stop.floor); camera.camera.worldToScreen(world, screen); return [screen.x, screen.y, screen.z]; });
        return { state: { ...state, position: [...state.position] }, discs, ready };
      },
      benchmark(seconds = 5, degreesPerSecond = 30) {
        stats.frames = [];
        return new Promise(resolve => {
          benchmark = { until: performance.now() + seconds * 1000, degreesPerFrame: degreesPerSecond / 60, done: () => resolve(controller.stats()) };
        });
      },
    };
    window.VeyletPlayerV2.current = controller;
    return firstFrame;
  }

  function medianFps(frames) {
    if (!frames.length) return null;
    const sorted = [...frames].sort((a, b) => a - b);
    return Math.round(10000 / sorted[Math.floor(sorted.length / 2)]) / 10;
  }

  window.VeyletPlayerV2 = {
    FORMAT, PlayerError, PACKAGE_ORIGINS,
    resolveBase, validateManifest, deviceProfile, createGovernor, stopLabel, stepStop, lookAngles, forwardOf,
    fieldOfView, posterFor, decodeWalkable, floorHit, tapAim, walkTarget, nearestStop, medianFps, detailLevel, storeysOf, levelAt,
    chunkHops, chunkPlan, chunkAt, finestChunkLevel,
    start, current: null,
  };
})();
