'use strict';

/*
 * Veylet player v2: streamed walkthroughs (package_format_version 2).
 *
 * Order of work on every device: a 256 px preview, then the poster (both are
 * renders of the packaged scene from the opening stop), then the coarsest
 * level of detail, then finer levels within a splat budget chosen for the
 * device. The PlayCanvas engine 2.23.2 is vendored (MIT,
 * /vendor/LICENSE.playcanvas.txt) and imported only when this browser can
 * draw it. Package files are data: JSON and WebP. Nothing from a package runs.
 */
(() => {
  const ENGINE_URL = '/vendor/playcanvas-2.23.2.min.js?v=dc5be7cc192c8e49';
  const STYLE_URL = '/tour-player-v2.css?v=0cf79ff07c662ea1';
  const FORMAT = 2;
  // Released tours are served from the tour host; previews and QA from this origin.
  const PACKAGE_ORIGINS = Object.freeze(['https://tours.veylet.com']);
  const MANIFEST_LIMIT = 512 * 1024;
  const WALKABLE_LIMIT = 2 * 1024 * 1024;
  const SAFE_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\/){0,3}[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
  const HINT_KEY = 'veylet-player-hint-seen';
  // After a lost graphics context: where the visitor was, for one retry at a lower budget (this tab only).
  const RESUME_KEY = 'veylet-player-resume';
  // The tours Worker serves a shared package's files under r/<rev>/ (rev: the stored manifest's hash) so they cache
  // immutably; one such folder is accepted in front of a package path, never two.
  const REVISION = /^r\/[0-9a-f]{8,64}\//;

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
  /** [the r/<rev>/ folder or '', the package path under it]. */
  const revisionOf = value => {
    const match = typeof value === 'string' ? value.match(REVISION) : null;
    return match ? [match[0], value.slice(match[0].length)] : ['', value];
  };

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
    const sceneMeta = revisionOf(scene.lod_meta)[1];
    if (!safePath(sceneMeta) || !sceneMeta.endsWith('lod-meta.json') || REVISION.test(sceneMeta)) bad('scene');
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
      const bounds = Array.isArray(room.bounds) && room.bounds.length === 2 && room.bounds.every(v => Number.isFinite(v) && v >= 0.8 && v <= 40)
        ? [Math.round(room.bounds[0] * 10) / 10, Math.round(room.bounds[1] * 10) / 10] : null;
      return { id: room.id, name: room.name, ...(bounds ? { bounds } : {}) };
    });
    if (!Array.isArray(json.stops) || json.stops.length < 1 || json.stops.length > 60) bad('stops');
    const sceneRevision = revisionOf(scene.lod_meta)[0];
    const stops = json.stops.map(stop => {
      if (!stop || !/^s\d{1,3}$/.test(stop.id || '') || !rooms.some(room => room.id === stop.room)
          || !finite3(stop.position) || !finite3(stop.target) || !finite3(stop.floor)) bad('stop');
      if (Math.hypot(...stop.position.map((v, i) => v - stop.target[i])) < 1e-3) bad('stop');
      // floor_id (whole-home packages): which floor the stop stands on. Anything else is ignored, not refused.
      const floorId = typeof stop.floor_id === 'string' && /^f\d{1,3}$/.test(stop.floor_id) ? stop.floor_id : null;
      let pano = null;
      if (stop.pano !== undefined && stop.pano !== null) {
        if (typeof stop.pano !== 'object' || Array.isArray(stop.pano)) bad('stop_pano');
        const panoPath = stop.pano.path;
        if (typeof panoPath !== 'string') bad('stop_pano');
        const [panoRev, panoRel] = revisionOf(panoPath);
        if (REVISION.test(panoRel) || /^r\//i.test(panoRel) || !safePath(panoRel) || !panoRel.endsWith('.webp')) bad('stop_pano');
        if (panoRev && (!safePath(panoPath) || panoRev !== sceneRevision)) bad('stop_pano');
        const { width, height } = stop.pano;
        if (!Number.isInteger(width) || width < 256 || width > 8192 || !Number.isInteger(height) || height < 128 || height > 4096) bad('stop_pano');
        const rawYaw = stop.pano.yaw_offset_degrees;
        const yawOffsetDegrees = rawYaw === undefined ? 0 : rawYaw;
        if (typeof yawOffsetDegrees !== 'number' || !Number.isFinite(yawOffsetDegrees)) bad('stop_pano');
        pano = { path: panoPath, width, height, yawOffsetDegrees };
      }
      return { id: stop.id, room: stop.room, position: stop.position, target: stop.target, floor: stop.floor, floorId, pano };
    });
    if (!Number.isInteger(json.start_stop) || json.start_stop < 0 || json.start_stop >= stops.length) bad('start_stop');
    if (typeof json.truth_label !== 'string' || !json.truth_label || json.truth_label.length > 400) bad('truth_label');
    let floorplan = null;
    if (json.floorplan !== undefined && json.floorplan !== null) {
      if (typeof json.floorplan !== 'object' || Array.isArray(json.floorplan)) bad('floorplan');
      const readFpPath = raw => {
        if (typeof raw !== 'string') bad('floorplan');
        const [rev, rel] = revisionOf(raw);
        if (REVISION.test(rel) || /^r\//i.test(rel) || !safePath(rel) || !rel.endsWith('.webp')) bad('floorplan');
        if (rev && (!safePath(raw) || rev !== sceneRevision)) bad('floorplan');
        return raw;
      };
      const readFpDims = obj => {
        const { width, height } = obj;
        if (!Number.isInteger(width) || width < 256 || width > 4096 || !Number.isInteger(height) || height < 256 || height > 4096) bad('floorplan');
        return { width, height };
      };
      const readFpBounds = b => {
        if (b === undefined || b === null) return null;
        if (!Array.isArray(b) || b.length !== 4 || !b.every(v => typeof v === 'number' && Number.isFinite(v)) || b[2] <= b[0] || b[3] <= b[1]) bad('floorplan');
        return [b[0], b[1], b[2], b[3]];
      };
      const fpPath = readFpPath(json.floorplan.path);
      const { width, height } = readFpDims(json.floorplan);
      const fpBounds = readFpBounds(json.floorplan.bounds);
      let fpLevels = null;
      if (json.floorplan.levels !== undefined && json.floorplan.levels !== null) {
        if (!Array.isArray(json.floorplan.levels) || json.floorplan.levels.length < 2 || json.floorplan.levels.length > 16) bad('floorplan');
        fpLevels = json.floorplan.levels.map(lvl => {
          if (!lvl || typeof lvl !== 'object' || Array.isArray(lvl)) bad('floorplan');
          if (typeof lvl.name !== 'string' || !lvl.name.trim() || lvl.name.length > 40) bad('floorplan');
          const lvlPath = readFpPath(lvl.path);
          const lvlDims = readFpDims(lvl);
          const lvlBounds = readFpBounds(lvl.bounds);
          return { name: lvl.name, path: lvlPath, width: lvlDims.width, height: lvlDims.height, ...(lvlBounds ? { bounds: lvlBounds } : {}) };
        });
      }
      floorplan = { path: fpPath, width, height, ...(fpBounds ? { bounds: fpBounds } : {}), ...(fpLevels ? { levels: fpLevels } : {}) };
    }
    const chunked = scene.layout === undefined && scene.chunks === undefined ? null : readChunks(json, scene, rooms, stops, bad);
    // Point to point (12 Nov 2026): a package's walked path (path) and floor_measured are older free-walk data. They
    // are not read, so a package that carries them opens exactly as one without; they never refuse a tour.
    return {
      synthetic: json.synthetic === true,
      researchSample: json.research_sample === true,
      truthLabel: json.truth_label,
      scene: { lodMeta: scene.lod_meta, levels: scene.lod_levels, counts: scene.lod_counts, rotation: scene.rotation_degrees, background: scene.background,
        ...(chunked ? { chunked } : {}) },
      posters,
      walkable: json.walkable ? json.walkable.path : null,
      floorplan,
      rooms, stops, start: json.start_stop,
      // What the package lists, for sizes shown to the visitor and the first files to fetch. A list that is
      // missing or odd is no list; the scene's own loader still decides what loads.
      files: (Array.isArray(json.files) ? json.files : [])
        .filter(file => file && typeof file.path === 'string' && SAFE_PATH.test(file.path) && Number.isFinite(file.bytes) && file.bytes >= 0)
        .map(file => ({ path: file.path, bytes: file.bytes })),
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
    // The Worker's r/<rev>/ folder, if the scene has one: every chunk is read under it (the Worker as written on
    // 26 September 2026 prefixes scene.lod_meta but not the chunks'). A chunk naming another revision is refused.
    const revision = revisionOf(scene.lod_meta)[0];
    const chunkOfRoom = {};
    const ids = new Set();
    const chunks = scene.chunks.map(chunk => {
      if (!chunk || typeof chunk.id !== 'string' || !/^chunk_\d{1,3}$/.test(chunk.id) || ids.has(chunk.id)) bad('chunk');
      ids.add(chunk.id);
      const [chunkRevision, chunkMeta] = revisionOf(chunk.lod_meta);
      if ((chunkRevision && chunkRevision !== revision) || !safePath(chunkMeta) || chunkMeta !== 'lod/' + chunk.id + '/lod-meta.json') bad('chunk');
      if (!Array.isArray(chunk.lod_counts) || chunk.lod_counts.length !== scene.lod_levels
          || !chunk.lod_counts.every((count, i) => Number.isSafeInteger(count) && count > 0 && (i === 0 || count <= chunk.lod_counts[i - 1]))) bad('chunk');
      if (!Array.isArray(chunk.rooms) || !chunk.rooms.length || chunk.rooms.some(room => !roomIds.has(room) || chunkOfRoom[room])) bad('chunk');
      for (const room of chunk.rooms) chunkOfRoom[room] = chunk.id;
      const bounds = chunk.bounds || {};
      if (!finite3(bounds.min) || !finite3(bounds.max) || bounds.min.some((v, i) => v > bounds.max[i])) bad('chunk');
      return { id: chunk.id, rooms: [...chunk.rooms], lodMeta: revision + chunkMeta, counts: chunk.lod_counts, bounds: { min: bounds.min, max: bounds.max }, listed: chunk.adjacent };
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
    const peakPixelRatio = saveData || modest ? maxPixelRatio : Math.min(dpr, 2);
    return { kind, api, budget, maxBudget: budget, minBudget: 150_000, maxPixelRatio, peakPixelRatio, minPixelRatio: Math.min(1, dpr), saveData };
  }

  /**
   * Keeps motion at 30 fps or better. Pixel ratio goes first (cheapest to give
   * back), then the splat budget. Budget returns first; pixels recover gradually
   * after five seconds of sustained headroom, up to the original device ceiling
   * (and up to peakPixelRatio when sustained >55 fps headroom proves capacity).
   */
  function createGovernor(profile) {
    let samples = [], elapsed = 0, headroomMs = 0, lastChange = -Infinity;
    const state = { budget: profile.budget, pixelRatio: profile.maxPixelRatio };
    const peakPixelRatio = profile.peakPixelRatio ?? profile.maxPixelRatio;
    return {
      state,
      // Decide on 45 frames or 1.5 s of frames, whichever comes first, so a
      // struggling device is helped within seconds rather than after 45 slow frames.
      sample(frameMs, now) {
        if (!(frameMs > 0) || frameMs > 1000) return null;
        samples.push(frameMs);
        elapsed += frameMs;
        if ((samples.length < 45 && (elapsed < 1500 || samples.length < 5)) || now - lastChange < 2000) return null;
        const windowMs = elapsed;
        elapsed = 0;
        const sorted = [...samples].sort((a, b) => a - b);
        const fps = 1000 / sorted[Math.floor(sorted.length / 2)];
        samples = [];
        headroomMs = fps > 50 ? headroomMs + windowMs : 0;
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
          headroomMs = 0;
          state.budget = Math.min(profile.maxBudget, Math.round(state.budget * 1.2));
          return { budget: state.budget, fps };
        }
        if (fps > 50 && state.pixelRatio < profile.maxPixelRatio && headroomMs >= 5000 && now - lastChange >= 5000) {
          lastChange = now;
          headroomMs = 0;
          state.pixelRatio = Math.min(profile.maxPixelRatio, Math.round(state.pixelRatio * 1.1 * 100) / 100);
          return { pixelRatio: state.pixelRatio, fps };
        }
        if (fps > 55 && state.budget >= profile.maxBudget && state.pixelRatio < peakPixelRatio && headroomMs >= 5000 && now - lastChange >= 5000) {
          lastChange = now;
          headroomMs = 0;
          state.pixelRatio = Math.min(peakPixelRatio, Math.round(state.pixelRatio * 1.1 * 100) / 100);
          return { pixelRatio: state.pixelRatio, fps };
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

  /**
   * Stops are numbered in the order of the visit, from the opening stop: the first view reads "Stop 1", and
   * Next counts up to the last one. (A package's own order may open on any stop.)
   */
  function visitNumber(manifest, index) {
    const count = manifest.stops.length, start = Number.isInteger(manifest.start) ? manifest.start : 0;
    return ((index - start) % count + count) % count + 1;
  }
  function stopAtNumber(manifest, number) {
    const count = manifest.stops.length, start = Number.isInteger(manifest.start) ? manifest.start : 0;
    return (start + number - 1) % count;
  }
  function stopLabel(manifest, index) {
    const stop = manifest.stops[index];
    const room = manifest.rooms.find(item => item.id === stop.room);
    return { room: room && room.name ? room.name : '', stop: 'Stop ' + visitNumber(manifest, index) + ' of ' + manifest.stops.length };
  }

  function parseFiniteNumber(raw) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }

  /** Parse #stop=N&yaw=D&pitch=P deep links, clamping yaw (-180..360) and pitch (-60..60). */
  function parseViewHash(hash) {
    if (typeof hash !== 'string') return null;
    const body = hash.trim().replace(/^#/, '');
    if (!body) return null;
    let stop = null, yaw = null, pitch = null;
    for (const part of body.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      let key, value;
      try {
        key = decodeURIComponent(part.slice(0, eq)).trim().toLowerCase();
        value = decodeURIComponent(part.slice(eq + 1)).trim();
      } catch {
        continue;
      }
      if (key === 'stop' && /^[1-9]\d?$/.test(value)) stop = Number(value);
      else if (key === 'yaw') {
        const parsed = parseFiniteNumber(value);
        if (parsed !== null) yaw = clamp(parsed, -180, 360);
      } else if (key === 'pitch') {
        const parsed = parseFiniteNumber(value);
        if (parsed !== null) pitch = clamp(parsed, -60, 60);
      }
    }
    if (stop === null && yaw === null && pitch === null) return null;
    return { stop, yaw, pitch };
  }

  function hashOf(source) {
    if (!source) return '';
    if (typeof source.hash === 'string' && source.hash) return source.hash;
    if (typeof source.href === 'string') {
      const idx = source.href.indexOf('#');
      if (idx >= 0) return source.href.slice(idx);
    }
    return '';
  }

  function clampOrientation(rawYaw, rawPitch) {
    const toNum = v => (typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' ? parseFiniteNumber(v) : null);
    const y = toNum(rawYaw), p = toNum(rawPitch);
    return { yaw: y !== null ? clamp(y, -180, 360) : null, pitch: p !== null ? clamp(p, -60, 60) : null };
  }

  function resolveStartView(manifest, visit, hash) {
    const count = manifest.stops.length;
    const validStop = n => (Number.isInteger(n) && n >= 1 && n <= count ? stopAtNumber(manifest, n) : null);
    const startAt = visit && visit.startAt;
    const hashView = parseViewHash(hash);
    if (startAt && typeof startAt === 'object') {
      const stop = validStop(startAt.stop);
      const orient = clampOrientation(startAt.yaw ?? visit.yaw, startAt.pitch ?? visit.pitch);
      return { stop: stop !== null ? stop : manifest.start, yaw: orient.yaw, pitch: orient.pitch };
    }
    if (Number.isInteger(startAt)) {
      const stop = validStop(startAt);
      if (stop === null) return { stop: manifest.start, yaw: null, pitch: null };
      const fromHash = hashView && (hashView.stop === null || hashView.stop === startAt) ? hashView : null;
      const orient = clampOrientation(visit?.yaw ?? fromHash?.yaw, visit?.pitch ?? fromHash?.pitch);
      return { stop, yaw: orient.yaw, pitch: orient.pitch };
    }
    if (startAt === undefined || startAt === null) {
      const stop = hashView ? validStop(hashView.stop) : null;
      const orient = clampOrientation(visit?.yaw ?? hashView?.yaw, visit?.pitch ?? hashView?.pitch);
      return { stop: stop !== null ? stop : manifest.start, yaw: orient.yaw, pitch: orient.pitch };
    }
    return { stop: manifest.start, yaw: null, pitch: null };
  }

  function roomNameForStop(manifest, stop) {
    if (!stop || typeof stop !== 'object') return '';
    const rooms = Array.isArray(manifest?.rooms) ? manifest.rooms : null;
    const room = rooms ? rooms.find(item => item && item.id === stop.room) : null;
    const raw = room ? room.name : (stop.label || stop.title || stop.room);
    return typeof raw === 'string' ? raw.trim() : '';
  }

  /** Unique named rooms extracted in stop order from manifest.stops, each with its first stop index. */
  function roomsFromManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.stops) || !manifest.stops.length) return [];
    const rooms = Array.isArray(manifest.rooms) ? manifest.rooms : [];
    const seen = new Set();
    const result = [];
    manifest.stops.forEach((stop, index) => {
      const name = roomNameForStop(manifest, stop);
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const matched = rooms.find(item => item && item.id === stop.room);
      const id = matched ? matched.id : (typeof stop.room === 'string' && stop.room.trim() ? stop.room.trim() : name);
      result.push({ id, name, firstStop: index });
    });
    return result;
  }


  /**
   * Indicative room dimensions (width × depth in metres) from room.bounds or
   * the span of stops in that room when 2+ stops exist on the room's floor.
   */
  function roomFootprint(manifest, roomId) {
    if (!manifest || !Array.isArray(manifest.rooms) || !roomId) return null;
    const room = manifest.rooms.find(item => item && item.id === roomId);
    if (!room) return null;
    if (Array.isArray(room.bounds) && room.bounds.length === 2 && room.bounds.every(v => Number.isFinite(v) && v >= 0.8)) {
      const w = Math.round(room.bounds[0] * 10) / 10;
      const d = Math.round(room.bounds[1] * 10) / 10;
      return { widthMeters: w, depthMeters: d, label: `approx. ${w.toFixed(1)} × ${d.toFixed(1)} m` };
    }
    const stops = (manifest.stops || []).filter(stop => stop && stop.room === roomId && Array.isArray(stop.floor));
    if (stops.length < 2) return null;
    const xs = stops.map(stop => stop.floor[0]);
    const zs = stops.map(stop => stop.floor[2]);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    if (spanX < 0.4 && spanZ < 0.4) return null;
    const w = Math.round(Math.max(1.8, spanX + 1.4) * 10) / 10;
    const d = Math.round(Math.max(1.8, spanZ + 1.4) * 10) / 10;
    return { widthMeters: w, depthMeters: d, label: `approx. ${w.toFixed(1)} × ${d.toFixed(1)} m` };
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

  const LOOK_INERTIA_DECAY = 8;
  const LOOK_INERTIA_EPSILON = 0.8;
  const LOOK_INERTIA_MAX_SPEED = 720;
  const LOOK_VELOCITY_WINDOW_MS = 80;

  /**
   * One frame of exponential-decay look inertia (degrees and deg/s).
   * Exact integral over dtSeconds keeps deceleration identical across 60/120 Hz displays,
   * clamps pitch safely, stops cleanly below epsilon, and produces zero motion under reducedMotion.
   */
  function stepLookInertia(current, dtSeconds, options = {}) {
    const yaw = Number.isFinite(current?.yaw) ? current.yaw : 0;
    const minPitch = Number.isFinite(options.minPitch) ? options.minPitch : -80;
    const maxPitch = Number.isFinite(options.maxPitch) ? options.maxPitch : 80;
    const pitch = clamp(Number.isFinite(current?.pitch) ? current.pitch : 0, minPitch, maxPitch);
    if (options.reducedMotion) return { yaw, pitch, vyaw: 0, vpitch: 0, active: false };
    const vyaw = Number.isFinite(current?.vyaw) ? current.vyaw : 0;
    const vpitch = Number.isFinite(current?.vpitch) ? current.vpitch : 0;
    const epsilon = Number.isFinite(options.epsilon) && options.epsilon > 0 ? options.epsilon : LOOK_INERTIA_EPSILON;
    if (Math.hypot(vyaw, vpitch) <= epsilon) return { yaw, pitch, vyaw: 0, vpitch: 0, active: false };
    const dt = Number.isFinite(dtSeconds) ? clamp(dtSeconds, 0, 0.1) : 0;
    if (dt === 0) return { yaw, pitch, vyaw, vpitch, active: true };
    const decay = Number.isFinite(options.decayRate) && options.decayRate > 0 ? options.decayRate : LOOK_INERTIA_DECAY;
    const factor = Math.exp(-decay * dt);
    const integral = (1 - factor) / decay;
    const nextYaw = yaw + vyaw * integral;
    const rawPitch = pitch + vpitch * integral;
    const nextPitch = clamp(rawPitch, minPitch, maxPitch);
    const nextVyaw = vyaw * factor;
    const nextVpitch = rawPitch !== nextPitch ? 0 : vpitch * factor;
    if (Math.hypot(nextVyaw, nextVpitch) <= epsilon) {
      return { yaw: nextYaw, pitch: nextPitch, vyaw: 0, vpitch: 0, active: false };
    }
    return { yaw: nextYaw, pitch: nextPitch, vyaw: nextVyaw, vpitch: nextVpitch, active: true };
  }

  /** The camera field of view that shows exactly what the cover-fitted poster shows. */
  function fieldOfView(aspect, poster, zoom = 1) {
    const posterAspect = poster.width / poster.height;
    if (aspect <= posterAspect) return { horizontal: false, fov: clamp(poster.fov * zoom, 20, 120) };
    const horizontal = 2 * Math.atan(Math.tan(poster.fov * Math.PI / 360) * posterAspect) * 180 / Math.PI;
    return { horizontal: true, fov: clamp(horizontal * zoom, 20, 130) };
  }

  const posterFor = (manifest, aspect) => aspect < 1 ? manifest.posters.portrait : manifest.posters.landscape;

  const PANO_FADE_MS = 250;
  /** Hybrid pano/splat blend state: stationary at a stop with a loaded pano renders crisp pano and pauses settled splats; moving or missing pano fades to 3DGS. */
  function panoBlendState({ atStop = false, moving = false, panoLoaded = false, reducedMotion = false, splatReady = false } = {}) {
    const showPano = Boolean(atStop) && !moving && Boolean(panoLoaded);
    const transitionMs = reducedMotion ? 0 : PANO_FADE_MS;
    const settled = Boolean(splatReady);
    return {
      mode: showPano ? 'pano' : (settled ? 'splat' : 'loading'),
      panoOpacity: showPano ? 1 : 0,
      splatOpacity: showPano ? 0 : (settled ? 1 : 0),
      transitionMs,
      pauseSplat: showPano && settled,
      renderPano: showPano,
    };
  }

  /**
   * The package's floor mask (walkable.json). Since tours became point to point it moves no one: it only hides the
   * circles of stops behind a wall (stopReachable) and draws the floor on the map.
   */
  function decodeWalkable(json) {
    if (!json || json.version !== 1) throw new PlayerError('walkable-invalid');
    function decodeMaskGrid(obj) {
      if (!obj || typeof obj !== 'object' || !Number.isFinite(obj.cell_metres) || obj.cell_metres <= 0 || obj.cell_metres > 1
          || !Array.isArray(obj.origin) || obj.origin.length !== 2 || !obj.origin.every(Number.isFinite)
          || !Number.isInteger(obj.columns) || !Number.isInteger(obj.rows) || obj.columns < 1 || obj.rows < 1 || obj.columns * obj.rows > 4_000_000
          || !Number.isFinite(obj.floor_y) || !Number.isFinite(obj.eye_height) || typeof obj.mask !== 'string') {
        throw new PlayerError('walkable-invalid');
      }
      const binary = atob(obj.mask);
      if (binary.length !== Math.ceil(obj.columns * obj.rows / 8)) throw new PlayerError('walkable-invalid');
      const bits = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const { columns, rows } = obj, cell = obj.cell_metres, [x0, z0] = obj.origin;
      const on = (c, r) => c >= 0 && r >= 0 && c < columns && r < rows && ((bits[(r * columns + c) >> 3] >> ((r * columns + c) & 7)) & 1) === 1;
      const walkable = (x, z) => on(Math.floor((x - x0) / cell), Math.floor((z - z0) / cell));
      // Every sample on the straight line must be floor: nothing seen through walls.
      // `skip` metres from the start are not checked, so a viewer standing a hair
      // off the mask (a stop at the edge of the floor) still sees the stops around it.
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
      const wallSegs = [];
      for (let r = 0; r < rows; r++) {
        for (const [dr, zOff] of [[-1, 0], [1, cell]]) {
          let start = -1;
          for (let c = 0; c <= columns; c++) {
            const edge = c < columns && on(c, r) && !on(c, r + dr);
            if (edge && start < 0) start = c;
            if (!edge && start >= 0) {
              wallSegs.push(`M${(x0 + start * cell).toFixed(2)} ${(z0 + r * cell + zOff).toFixed(2)}h${((c - start) * cell).toFixed(2)}`);
              start = -1;
            }
          }
        }
      }
      for (let c = 0; c < columns; c++) {
        for (const [dc, xOff] of [[-1, 0], [1, cell]]) {
          let start = -1;
          for (let r = 0; r <= rows; r++) {
            const edge = r < rows && on(c, r) && !on(c + dc, r);
            if (edge && start < 0) start = r;
            if (!edge && start >= 0) {
              wallSegs.push(`M${(x0 + c * cell + xOff).toFixed(2)} ${(z0 + start * cell).toFixed(2)}v${((r - start) * cell).toFixed(2)}`);
              start = -1;
            }
          }
        }
      }
      return { cell, origin: [x0, z0], columns, rows, floorY: obj.floor_y, eyeHeight: obj.eye_height, walkable, clear, on, runs, walls: wallSegs.join('') };
    }
    const root = decodeMaskGrid(json);
    let storeyLevels = null;
    if (Array.isArray(json.storey_levels) && json.storey_levels.length >= 2) {
      try {
        storeyLevels = json.storey_levels.map(lvl => {
          const grid = decodeMaskGrid(lvl);
          return typeof lvl.name === 'string' ? { ...grid, name: lvl.name } : grid;
        });
      } catch {
        storeyLevels = null;
      }
    }
    return storeyLevels ? { ...root, storeyLevels } : root;
  }

  /**
   * Finds a clear walkable floor route from `fromPosition` to `toPosition`:
   * `[toPosition]` when the straight line is open (allowing `skip` metres near
   * the endpoint for a stop standing at the edge of the floor mask), or a
   * 2-segment `[viaPosition, toPosition]` route through an intermediate stop
   * or corridor bend when a kitchen island or sofa corner sits between them.
   * Returns `null` when no clear walkable route exists on this floor.
   * Used only to decide whether a stop's circle is offered; the viewer jumps to the stop, never along the route.
   */
  function corridorRoute(walkable, fromPosition, toPosition, stops = [], { skip = 0.25 } = {}) {
    if (!walkable || !Array.isArray(fromPosition) || !Array.isArray(toPosition)) return null;
    const a = [fromPosition[0], fromPosition[2]], b = [toPosition[0], toPosition[2]];
    const clearSeg = (p, q) => walkable.walkable(q[0], q[1]) && (walkable.clear(p, q, skip) || (walkable.walkable(p[0], p[1]) && walkable.clear(q, p, skip)));
    if (clearSeg(a, b)) return [[...toPosition]];
    let best = null, bestDistance = Infinity;
    const consider = via3D => {
      const v = [via3D[0], via3D[2]];
      const d1 = Math.hypot(v[0] - a[0], v[1] - a[1]), d2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
      if (d1 < 0.05 || d2 < 0.05 || d1 + d2 >= bestDistance) return;
      if (clearSeg(a, v) && clearSeg(v, b)) {
        bestDistance = d1 + d2;
        best = [[...via3D], [...toPosition]];
      }
    };
    for (const stop of stops || []) {
      if (Array.isArray(stop?.position)) consider(stop.position);
    }
    if (best) return best;
    const midY = (fromPosition[1] + toPosition[1]) / 2;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    for (const [vx, vz] of [[a[0], b[1]], [b[0], a[1]], [mx + nx * 0.45, mz + nz * 0.45], [mx - nx * 0.45, mz - nz * 0.45], [mx + nx * 0.9, mz + nz * 0.9], [mx - nx * 0.9, mz - nz * 0.9]]) {
      consider([vx, midY, vz]);
    }
    return best;
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

  async function fetchJson(url, limit, signal, timeoutMs = 15000, cache = 'no-cache') {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      let response;
      try { response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache }); } catch { throw new PlayerError('package-unreachable', { transient: true }); }
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
    play: 'M8 5.5v13l11-6.5z',
    pause: 'M8 5h3v14H8z M13 5h3v14h-3z',
    view: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M12 9v6 M9 12h6',
    zoomIn: 'M12 6v12 M6 12h12',
    zoomOut: 'M6 12h12',
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
      'aria-label': '3D walkthrough. Left and right arrows look, up and down go to the stop ahead or behind, N and P go to the next and previous stop, M shows the map.' });
    const pano = el('canvas', { class: 'v2-pano', 'aria-hidden': 'true', hidden: true });
    Object.assign(pano.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', pointerEvents: 'none' });
    const hotspots = el('div', { class: 'v2-hotspots', 'aria-hidden': 'true' });
    // A move between stops is a jump; this dark veil over the scene fades out after it, so the eye reads a cut
    // as a step forward rather than a glitch (see goToStop). Styled here so the stylesheet and its pin stay as they are.
    const veil = el('div', { class: 'v2-veil', 'aria-hidden': 'true' });
    Object.assign(veil.style, { position: 'absolute', inset: '0', background: '#10231d', opacity: '0', pointerEvents: 'none' });
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
    const progress = el('div', {
      class: 'v2-progress',
      role: 'progressbar',
      'aria-label': 'Loading walkthrough',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
      hidden: true,
    });
    progress.append(el('span'));
    const announce = el('p', { class: 'v2-sr', 'aria-live': 'polite' });
    const hint = el('p', { class: 'v2-hint', hidden: true }, 'Drag to look around. Tap a circle or Next to move.');
    const prev = iconButton('prev', 'Previous stop', 'v2-icon v2-prev');
    // "Next stop" on screen; "Next" on a phone (the stylesheet drops " stop"); the arrow alone under 300 px.
    const next = iconButton('next', 'Next stop', 'v2-primary v2-next');
    const nextLabel = el('span', { class: 'v2-label', 'aria-hidden': 'true' }, 'Next');
    nextLabel.append(el('span', { class: 'v2-label-more' }, ' stop'));
    // On the last stop of the visit the same button reads "Start again".
    // ("Restart", without the arrow, where a phone's bar has no room for more.)
    const againLabel = el('span', { class: 'v2-label v2-label-again', 'aria-hidden': 'true', hidden: true }, 'Start again');
    const restartLabel = el('span', { class: 'v2-label v2-label-restart', 'aria-hidden': 'true', hidden: true }, 'Restart');
    next.append(nextLabel, againLabel, restartLabel);
    const stopsToggle = el('button', { type: 'button', class: 'v2-stops-toggle', 'aria-expanded': 'false', 'aria-haspopup': 'true' });
    stopsToggle.append(icon('stops'), el('span', { class: 'v2-stops-text' }, 'Stops'));
    const autoTour = iconButton('play', 'Play auto-tour', 'v2-icon v2-autotour');
    autoTour.setAttribute('aria-pressed', 'false');
    const viewToggle = iconButton('view', 'Look and zoom controls', 'v2-icon v2-view-toggle');
    viewToggle.setAttribute('aria-expanded', 'false');
    const lookLeft = iconButton('prev', 'Look left', 'v2-icon v2-look-left');
    const lookRight = iconButton('next', 'Look right', 'v2-icon v2-look-right');
    const zoomOut = iconButton('zoomOut', 'Zoom out', 'v2-icon v2-zoom-out');
    const zoomIn = iconButton('zoomIn', 'Zoom in', 'v2-icon v2-zoom-in');
    const viewBar = el('div', { class: 'v2-view-bar', role: 'group', 'aria-label': 'Look and zoom', hidden: true });
    viewBar.append(lookLeft, lookRight, zoomOut, zoomIn);
    const mapToggle = iconButton('map', 'Show map of stops', 'v2-icon v2-map-toggle');
    mapToggle.setAttribute('aria-pressed', 'false');
    // Not .v2-full: the stylesheet hides that class in frames of 330 px and
    // under, which is exactly where full screen is needed most.
    const full = iconButton('full', 'Full screen', 'v2-icon v2-fullscreen');
    const roomsBar = el('nav', { class: 'v2-rooms v2-room-pills', 'aria-label': 'Rooms', hidden: true });
    const bar = el('div', { class: 'v2-bar', role: 'toolbar', 'aria-label': 'Walkthrough controls', hidden: true });
    const moves = el('div', { class: 'v2-moves' });
    moves.append(prev, stopsToggle, next);
    const tools = el('div', { class: 'v2-tools' });
    tools.append(autoTour, viewToggle, mapToggle, full);
    bar.append(viewBar, roomsBar, moves, tools);
    const stopsPanel = el('div', { class: 'v2-panel v2-stops', role: 'dialog', 'aria-label': 'Rooms and stops', hidden: true });
    const map = el('figure', { class: 'v2-map', hidden: true });
    const aboutPanel = el('div', { class: 'v2-panel v2-about', role: 'dialog', 'aria-label': 'About this walkthrough', hidden: true });
    const fallback = el('section', { class: 'v2-fallback', hidden: true, 'aria-labelledby': 'v2-fallback-title' });
    // The end of the visit: a short card over the last stop (see showEnd).
    const end = el('section', { class: 'v2-end', hidden: true, 'aria-label': 'End of the walkthrough' });
    root.append(preview, poster, canvas, pano, veil, hotspots, top, map, status, progress, hint, stopsPanel, aboutPanel, end, bar, fallback, announce);
    stage.append(root);
    return { root, preview, poster, canvas, pano, veil, hotspots, top, room, stopLine, truth, about, status, progress, announce, hint,
      prev, next, nextLabel, againLabel, restartLabel, stopsToggle, autoTour, viewToggle, viewBar, lookLeft, lookRight, zoomOut, zoomIn,
      mapToggle, full, roomsBar, bar, stopsPanel, map, aboutPanel, end, fallback };
  }

  const FALLBACK_WORDS = {
    'no-graphics': ['3D can’t open in this browser.', 'This picture is from the walkthrough. Try opening this link in Safari or Chrome.'],
    'engine-unavailable': ['3D didn’t load.', 'Check your connection and try again. This picture is from the walkthrough.'],
    'context-lost': ['3D stopped on this device.', 'This can happen when many tabs are open. Try again, or close other tabs first.'],
    'too-slow': ['3D is taking a while.', 'The connection looks slow. The walkthrough is still downloading, and this picture is from it.'],
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
  function mount(stage, options = {}) {
    return start(stage, options);
  }

  async function play(stage, options, waiting) {
    const signal = options.signal;
    const page = options.page || location;
    const base = resolveBase(options.base ?? options.packageUrl, page);
    const env = options.env || browserEnv();
    const profile = deviceProfile(env);
    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const marks = {};
    const mark = name => { marks[name] = performance.now(); try { performance.mark('veylet:' + name); } catch { /* optional */ } };
    mark('start');
    let framed = Boolean(options.framed);
    if (options.framed === undefined) { try { framed = window.top !== window.self; } catch { framed = true; } }
    const waitForTap = Boolean(options.waitForTap && profile.api);
    // The engine download starts as soon as the package's manifest has answered and reads as a walkthrough
    // (a few KB), unless the visitor is first asked to press Explore. A link whose package is gone costs
    // nobody the engine.
    const loadEngine = options.loadEngine || (() => import(ENGINE_URL));
    let enginePromise = null;
    const requestEngine = () => (enginePromise ||= Promise.resolve().then(loadEngine).catch(() => null));
    const manifestPromise = fetchJson(base + 'manifest.json', MANIFEST_LIMIT, signal).then(validateManifest);
    manifestPromise.then(() => { if (profile.api && !waitForTap && !signal?.aborted) requestEngine(); }, () => {}); // a refusal is handled below, after the styles
    await ensureStyle();
    if (signal?.aborted) throw new PlayerError('playback-cancelled');
    const manifest = await manifestPromise;
    const ui = buildInterface(stage);
    mark('manifest');
    const walkablePromise = manifest.walkable
      ? fetchJson(base + manifest.walkable, WALKABLE_LIMIT, signal, 15000, 'default').then(decodeWalkable).catch(() => null)
      : Promise.resolve(null);

    // Preview, then poster. Both are renders of this package from the opening stop.
    const aspect = () => (stage.clientWidth || 16) / (stage.clientHeight || 9);
    let posterSpec = posterFor(manifest, aspect());
    ui.truth.textContent = manifest.researchSample ? 'Research sample · not a Veylet capture · not to scale'
      : manifest.synthetic ? 'Synthetic test scene · not to scale' : 'Captured on site · not to scale';
    ui.poster.alt = 'Opening view, rendered from the walkthrough';
    let visible = false;
    const becomeVisible = () => {
      if (visible) return;
      visible = true;
      stage.hidden = false;
      try { options.onVisible?.(); } catch { /* a surface hint never breaks playback */ }
    };
    // What the page asks of the visit (all optional): where to open (a link to a stop), a word when the stop
    // changes, Share, and who to contact. The player itself still sends nothing anywhere.
    const visit = options.visit && typeof options.visit === 'object' ? options.visit : {};
    const lastStop = stopAtNumber(manifest, manifest.stops.length);
    const startHash = typeof options.hash === 'string'
      ? options.hash
      : (hashOf(page) || hashOf(typeof location !== 'undefined' ? location : null));
    const askedView = resolveStartView(manifest, visit, startHash);
    const asked = askedView.stop;
    // A chunked home opens on the chunk its package names, and walks to the asked stop once it is drawn.
    const opening = manifest.scene.chunked ? manifest.start : asked;
    const labels = index => {
      const label = stopLabel(manifest, index);
      ui.room.textContent = label.room;
      ui.room.hidden = !label.room;
      // A named room makes the label three lines; a narrow stage drops the third (tour-player-v2.css).
      if (label.room) ui.root.classList.add('v2-has-room'); else ui.root.classList.remove('v2-has-room');
      ui.stopLine.textContent = label.stop;
      return label;
    };
    if (manifest.researchSample) ui.root.classList.add('v2-research');
    labels(opening);

    const openingLook = lookAngles(manifest.stops[opening].position, manifest.stops[opening].target);
    const state = {
      stop: opening,
      position: [...manifest.stops[opening].position],
      zoom: 1,
      yaw: asked === opening && askedView.yaw !== null ? askedView.yaw : openingLook.yaw,
      pitch: asked === opening && askedView.pitch !== null ? askedView.pitch : openingLook.pitch,
    };
    const reduced = () => reduceQuery.matches;
    const hasPanos = manifest.stops.some(stop => Boolean(stop.pano));
    const panoCache = new Map();
    let panoMoving = false, panoMoveTimer = null, splatPaused = false, currentPanoOpacity = 0, explorePressed = !waitForTap;
    let panoGl = null, panoProg = null, panoLocs = null, panoBuf = null;
    const panoLoadedFor = index => {
      const p = manifest.stops[index]?.pano;
      return Boolean(p && panoCache.get(p.path)?.status === 'loaded');
    };
    function initPanoGl() {
      if (panoGl) return panoGl;
      if (typeof ui.pano.getContext !== 'function') return null;
      let gl = null;
      try {
        const opts = { alpha: true, premultipliedAlpha: false, antialias: false, powerPreference: 'high-performance' };
        gl = ui.pano.getContext('webgl2', opts) || ui.pano.getContext('webgl', opts);
      } catch { gl = null; }
      if (!gl) return null;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, 'attribute vec2 aPos;varying vec2 vNdc;void main(){vNdc=aPos;gl_Position=vec4(aPos,0.0,1.0);}');
      const fs = compile(gl.FRAGMENT_SHADER,
        'precision highp float;varying vec2 vNdc;uniform sampler2D uTex;uniform vec3 uForward;uniform vec3 uRight;uniform vec3 uUp;uniform vec2 uTanHalf;uniform float uYawOffset;' +
        'const float PI=3.14159265358979323846;void main(){vec3 dir=normalize(uForward+uRight*(vNdc.x*uTanHalf.x)+uUp*(vNdc.y*uTanHalf.y));' +
        'float ry=atan(-dir.x,-dir.z);float rp=asin(clamp(dir.y,-1.0,1.0));float u=fract(0.5+(uYawOffset-ry)/(2.0*PI));float v=0.5-rp/PI;' +
        'vec4 c=texture2D(uTex,vec2(u,v));if(c.a<0.01)discard;gl_FragColor=c;}');
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return null; }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      panoGl = gl; panoProg = prog; panoBuf = buf;
      panoLocs = {
        aPos: gl.getAttribLocation(prog, 'aPos'),
        uTex: gl.getUniformLocation(prog, 'uTex'),
        uForward: gl.getUniformLocation(prog, 'uForward'),
        uRight: gl.getUniformLocation(prog, 'uRight'),
        uUp: gl.getUniformLocation(prog, 'uUp'),
        uTanHalf: gl.getUniformLocation(prog, 'uTanHalf'),
        uYawOffset: gl.getUniformLocation(prog, 'uYawOffset'),
      };
      return gl;
    }
    function renderPanoFrame() {
      if (!hasPanos || state.stop < 0) return;
      const p = manifest.stops[state.stop]?.pano;
      const entry = p && panoCache.get(p.path);
      if (!entry || entry.status !== 'loaded' || !entry.img) return;
      const gl = initPanoGl();
      if (!gl) return;
      try {
        if (!entry.texture) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
          entry.texture = tex;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = ui.canvas.clientWidth || stage.clientWidth || 1;
        const ch = ui.canvas.clientHeight || stage.clientHeight || 1;
        const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
        if (ui.pano.width !== w || ui.pano.height !== h) { ui.pano.width = w; ui.pano.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(panoProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, panoBuf);
        gl.enableVertexAttribArray(panoLocs.aPos);
        gl.vertexAttribPointer(panoLocs.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.uniform1i(panoLocs.uTex, 0);
        const fwd = forwardOf(state.yaw, state.pitch);
        const rx = -fwd[2], rz = fwd[0], rLen = Math.hypot(rx, rz) || 1;
        const right = [rx / rLen, 0, rz / rLen];
        const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
        const a = aspect(), view = fieldOfView(a, posterSpec, state.zoom);
        const fov = clamp(view.fov, 20, 130);
        const tanY = view.horizontal ? Math.tan(fov * Math.PI / 360) / a : Math.tan(fov * Math.PI / 360);
        gl.uniform3f(panoLocs.uForward, fwd[0], fwd[1], fwd[2]);
        gl.uniform3f(panoLocs.uRight, right[0], right[1], right[2]);
        gl.uniform3f(panoLocs.uUp, up[0], up[1], up[2]);
        gl.uniform2f(panoLocs.uTanHalf, tanY * a, tanY);
        gl.uniform1f(panoLocs.uYawOffset, (p.yawOffsetDegrees || 0) * Math.PI / 180);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } catch { /* fallback to pure 3DGS if WebGL upload fails */ }
    }
    let setSplatPaused = paused => { splatPaused = paused; };
    let ready = false, phase = 'coarse';
    function syncPano() {
      if (!hasPanos) return;
      const atStop = state.stop >= 0 && Boolean(manifest.stops[state.stop]?.pano);
      const panoLoaded = state.stop >= 0 && panoLoadedFor(state.stop) && explorePressed;
      const blend = panoBlendState({
        atStop, moving: panoMoving, panoLoaded, reducedMotion: reduced(), splatReady: ready && phase === 'complete',
      });
      currentPanoOpacity = blend.panoOpacity;
      ui.pano.style.transition = blend.transitionMs > 0 ? `opacity ${blend.transitionMs}ms ease-out` : 'none';
      if (blend.panoOpacity > 0) {
        ui.pano.hidden = false;
        renderPanoFrame();
      }
      ui.pano.style.opacity = String(blend.panoOpacity);
      ui.root.dataset.pano = blend.mode;
      setSplatPaused(blend.pauseSplat);
      if (stats?.pano) {
        stats.pano.mode = blend.mode;
        stats.pano.opacity = blend.panoOpacity;
        stats.pano.splatPaused = blend.pauseSplat;
        stats.pano.loaded = [...panoCache.values()].filter(e => e.status === 'loaded').length;
        stats.pano.failed = [...panoCache.values()].filter(e => e.status === 'failed').length;
      }
    }
    function ensurePano(index) {
      const p = manifest.stops[index]?.pano;
      if (!p) return null;
      const existing = panoCache.get(p.path);
      if (existing) return existing;
      const entry = { status: 'loading', img: null, pano: p, texture: null };
      panoCache.set(p.path, entry);
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      entry.img = img;
      const failLoad = () => {
        if (torndown) return;
        entry.status = 'failed';
        if (state.stop === index) syncPano();
      };
      const finish = () => {
        if (torndown) return;
        entry.status = 'loaded';
        if (state.stop === index && explorePressed) {
          if (!ready) becomeVisible();
          syncPano();
        }
      };
      img.addEventListener('load', () => {
        if (typeof img.decode === 'function') img.decode().then(finish, failLoad);
        else finish();
      }, { once: true });
      img.addEventListener('error', failLoad, { once: true });
      img.src = base + p.path;
      return entry;
    }

    ui.preview.addEventListener('load', () => { mark('preview'); ui.root.dataset.preview = 'shown'; becomeVisible(); }, { once: true });
    ui.poster.addEventListener('load', () => { mark('poster'); ui.root.dataset.poster = 'shown'; becomeVisible(); }, { once: true });
    ui.poster.addEventListener('error', () => becomeVisible(), { once: true });
    ui.preview.src = base + manifest.posters.preview.path;
    if (!waitForTap && manifest.stops[opening]?.pano) ensurePano(opening);
    ui.poster.src = base + posterSpec.path;

    let viewer = null, torndown = false, settled = false, stats = null;
    let maxLoading = 0, sawLoading = false, readyFrames = 0, lastRender = 0, benchmark = null;
    let resolveReady;
    const firstFrame = new Promise(resolve => { resolveReady = resolve; });
    const settle = outcome => { if (settled) return; settled = true; cancelDeadline(); clearTimeout(slowNote); resolveReady(outcome); };
    let cancelDeadline = () => {}, slowNote = null, slowShown = false;

    function fail(kind, retryable = true) {
      const [heading, body] = FALLBACK_WORDS[kind] || FALLBACK_WORDS['engine-unavailable'];
      // These controls are hidden or removed below. Keep unrelated, visible
      // focus where it is, including when the failure happens during loading.
      const recoverFocus = [ui.canvas, ui.bar, ui.hotspots, ui.fallback]
        .some(part => part.contains(document.activeElement));
      ui.fallback.replaceChildren();
      const title = el('h2', { id: 'v2-fallback-title', tabindex: '-1' }, heading);
      let recovery = title;
      ui.fallback.append(title, el('p', {}, body));
      if (retryable) {
        const retry = el('button', { type: 'button', class: 'v2-primary' }, 'Try again');
        retry.addEventListener('click', () => (options.onRetry ? options.onRetry() : location.reload()));
        ui.fallback.append(retry);
        recovery = retry;
      }
      if (kind === 'no-graphics') {
        // The next step is another browser, so the link goes with the visitor.
        const copy = el('button', { type: 'button', class: 'v2-primary' }, 'Copy link');
        const note = el('p', { class: 'v2-copy-note', role: 'status' });
        copy.addEventListener('click', async () => {
          let copied = false;
          try { await navigator.clipboard.writeText(String(location.href)); copied = true; } catch { copied = false; }
          note.textContent = copied ? 'Link copied.' : 'Copying didn’t work. Copy the address from your browser instead.';
        });
        ui.fallback.append(copy, note);
      }
      ui.root.dataset.state = 'fallback';
      ui.fallback.hidden = false;
      ui.bar.hidden = true;
      ui.root.append(ui.status);
      ui.progress.hidden = true;
      ui.status.textContent = '';
      ui.announce.textContent = `${heading} ${body}`;
      ui.canvas.hidden = true;
      ui.hotspots.replaceChildren();
      becomeVisible();
      teardown();
      if (recoverFocus) recovery.focus();
      const outcome = { readiness: 'viewer-failed', reason: kind, marks };
      settle(outcome);
      return outcome;
    }
    // The first 3D frame is slow to come: the poster stays, the download goes on, and the visitor chooses.
    function tooSlow() {
      if (settled || torndown) return;
      const [heading, body] = FALLBACK_WORDS['too-slow'];
      const keep = el('button', { type: 'button', class: 'v2-primary' }, 'Keep waiting');
      const retry = el('button', { type: 'button', class: 'v2-icon' }, 'Try again');
      keep.addEventListener('click', () => { hideSlow(); if (!settled) cancelDeadline = visibleDeadline(tooSlow, 45000); });
      retry.addEventListener('click', () => (options.onRetry ? options.onRetry() : location.reload()));
      const actions = el('div', { class: 'v2-actions' });
      actions.append(keep, retry);
      ui.fallback.replaceChildren(el('h2', { id: 'v2-fallback-title' }, heading), el('p', {}, body), actions);
      ui.fallback.hidden = false;
      slowShown = true;
      becomeVisible();
    }
    // A scene file did not arrive. The engine reports it from inside its own loader, which goes on using what
    // teardown destroys, so the panel and the teardown wait for the engine to finish that step.
    function sceneFailed() {
      setTimeout(() => { if (!torndown) fail('engine-unavailable'); }, 0);
    }
    function hideSlow() {
      if (!slowShown) return;
      slowShown = false;
      ui.fallback.hidden = true;
      ui.fallback.replaceChildren();
    }
    let autoTimer = null;
    let cancelLookInertia = () => {};
    function teardown() {
      if (torndown) return;
      torndown = true;
      delete ui.root.dataset.looking;
      cancelLookInertia();
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      if (panoMoveTimer) { clearTimeout(panoMoveTimer); panoMoveTimer = null; }
      ui.pano.hidden = true;
      ui.pano.style.opacity = '0';
      if (panoGl) {
        try {
          for (const entry of panoCache.values()) { if (entry.texture) { panoGl.deleteTexture(entry.texture); entry.texture = null; } }
          if (panoProg) { panoGl.deleteProgram(panoProg); panoProg = null; }
          if (panoBuf) { panoGl.deleteBuffer(panoBuf); panoBuf = null; }
          panoGl.getExtension?.('WEBGL_lose_context')?.loseContext();
        } catch { /* context already gone */ }
        panoGl = null;
      }
      try { viewer?.destroy(); } catch { /* already gone */ }
    }
    signal?.addEventListener('abort', () => { teardown(); ui.root.remove(); }, { once: true });

    // ----- the first files, fetched beside the engine, and one bar for the whole wait -----
    // The coarsest level is what the first 3D frame is made of. Fetching it while the engine downloads warms
    // the browser's cache, so the engine finds it there; its bytes also drive the bar from the first second.
    const first = { started: false, total: 0, loaded: 0, engine: false };
    let progressShown = 0;
    let progressSaid = -1;
    // The loading line reads "Loading the walkthrough · 42%". The status is a live region, so it is announced
    // once; the number beside it is hidden from it (the progress bar's value carries it), so a screen reader
    // can read the share without hearing every tick (design spec v2, 11.10).
    const LOADING_WORDS = 'Loading the walkthrough';
    const loadingPercent = el('span', { class: 'v2-status-percent', 'aria-hidden': 'true' });
    Object.assign(loadingPercent.style, { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' });
    function setProgress(value) {
      progressShown = Math.max(progressShown, Math.min(1, value));
      ui.progress.firstChild.style.transform = `scaleX(${progressShown.toFixed(3)})`;
      // The same share, said to the window as a whole percent (the in-app Review shows it beside its own label).
      // On window, beside the readiness signals, so the page's own document events (veylet:stop, veylet:room)
      // stay what they were.
      const percent = Math.round(progressShown * 100);
      ui.progress.setAttribute('aria-valuenow', String(percent));
      if (percent === progressSaid) return;
      progressSaid = percent;
      // No file list to count (the bar only creeps): no number, rather than one that stands still.
      loadingPercent.textContent = ui.progress.classList.contains('v2-progress-wait') ? '' : ' · ' + percent + '%';
      try {
        if (typeof CustomEvent === 'function') window.dispatchEvent?.(new CustomEvent('veylet-viewer-progress', { detail: { percent } }));
      } catch { /* optional: a page that is not listening changes nothing */ }
    }
    function loadProgress() {
      if (ready || torndown) return;
      setProgress(first.total ? 0.6 * Math.min(1, first.loaded / first.total) + (first.engine ? 0.25 : 0) : (first.engine ? 0.5 : 0));
    }
    async function fetchFirst(file, attempt) {
      let got = 0;
      const count = bytes => { const add = Math.min(bytes, file.bytes - got); got += add; first.loaded += add; loadProgress(); };
      try {
        const response = await fetch(base + file.path, { signal, credentials: 'omit' });
        if (!response.ok) throw new Error('status');
        const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
        if (reader) for (;;) { const part = await reader.read(); if (part.done) break; count(part.value ? part.value.byteLength : 0); }
        else if (typeof response.arrayBuffer === 'function') await response.arrayBuffer();
        count(file.bytes);
      } catch {
        first.loaded -= got;
        if (signal?.aborted || torndown || ready) return;
        // Once more after a moment; a file that is still missing means no 3D, and the visitor is told now
        // rather than after the long deadline.
        if (attempt < 1) setTimeout(() => { if (!torndown && !ready) fetchFirst(file, attempt + 1); }, 1500);
        else sceneFailed();
      }
    }
    function startFirstFiles() {
      if (first.started) return;
      first.started = true;
      const scene = manifest.scene;
      const folder = scene.lodMeta.slice(0, scene.lodMeta.lastIndexOf('/') + 1);
      const files = scene.chunked ? [] : manifest.files.filter(file => file.bytes > 0 && (file.path === scene.lodMeta || file.path.startsWith(folder + (scene.levels - 1) + '_')));
      first.total = files.reduce((sum, file) => sum + file.bytes, 0);
      ui.progress.hidden = false;
      // No list to count: the bar still moves, slowly, so the wait is seen to be alive.
      if (!first.total) ui.progress.classList.add('v2-progress-wait');
      loadProgress();
      for (const file of files) fetchFirst(file, 0);
    }
    if (profile.api && !waitForTap) startFirstFiles();

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
      explorePressed = true;
      if (manifest.stops[opening]?.pano) { ensurePano(opening); syncPano(); }
      mark('explore');
    }
    ui.status.textContent = LOADING_WORDS;
    ui.status.append(loadingPercent);
    startFirstFiles();
    // One deadline for the first 3D frame, from the start of the 3D download: 45 s of visible time (a hidden tab
    // keeps its allowance), then Keep waiting or Try again over the poster. The page adds none of its own.
    cancelDeadline = visibleDeadline(tooSlow, 45000);
    slowNote = setTimeout(() => { if (!ready && loadingPercent.parentNode === ui.status) ui.status.textContent = 'Still loading. A slow connection can take a minute.'; }, 10000);
    const pc = await requestEngine();
    if (signal?.aborted) throw new PlayerError('playback-cancelled');
    if (!pc || !pc.createGraphicsDevice) return fail('engine-unavailable');
    mark('engine');
    first.engine = true;
    loadProgress();
    const walkable = await walkablePromise;
    becomeVisible();

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
    let resume = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null');
      if (saved && saved.base === base) { resume = saved; sessionStorage.removeItem(RESUME_KEY); }
    } catch { resume = null; }
    if (resume) profile.budget = profile.maxBudget = Math.max(profile.minBudget, Math.round(profile.budget / 2));
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
    app.scene.gsplat.radialSorting = true;
    app.scene.gsplat.lodBehindPenalty = 1;
    app.scene.gsplat.colorUpdateAngle = 2;
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

    let continuous = 0; // frames that must render back to back (moves, drags, streaming)
    let flightFovOffset = 0;
    const requestRender = () => { if (!splatPaused) app.renderNextFrame = true; };
    setSplatPaused = paused => {
      if (splatPaused === paused) return;
      splatPaused = paused;
      if (!paused) requestRender();
    };
    function applyCamera() {
      camera.setPosition(...state.position);
      camera.setEulerAngles(state.pitch, state.yaw, 0);
      const view = fieldOfView(aspect(), posterSpec, state.zoom);
      camera.camera.horizontalFov = view.horizontal;
      camera.camera.fov = clamp(view.fov + flightFovOffset, 20, 130);
      requestRender();
      if (hasPanos && currentPanoOpacity > 0) renderPanoFrame();
      placeHotspots();
    }

    // ----- stops, hotspots, map -----
    // A home on more than one level: one level at a time, on the map and on the floor discs.
    const storeys = storeysOf(manifest.stops);
    const levelOf = storeys ? manifest.stops.map((_, index) => storeys.findIndex(level => level.stops.includes(index))) : null;
    let viewerLevel = storeys ? levelOf[opening] : 0;
    const hotspotButtons = manifest.stops.map((stop, index) => {
      // Hidden until placeHotspots puts it on its floor point (after the first frame), not in the corner.
      const button = el('button', { type: 'button', class: 'v2-hotspot', tabindex: '-1', hidden: true });
      button.append(el('span', {}, String(visitNumber(manifest, index))));
      button.addEventListener('click', event => { event.stopPropagation(); goToStop(index); });
      ui.hotspots.append(button);
      return button;
    });
    const screen = new pc.Vec3(), world = new pc.Vec3();
    /** Whether a stop on the viewer's level can be offered from here: the one rule for circles and keys. */
    function stopReachable(stop, level) {
      // Prefer the per-storey mask when present; otherwise the root mask only covers the opening storey.
      const mask = (storeys && walkable?.storeyLevels?.[level])
        || (!walkable || (storeys && level !== levelOf[manifest.start]) ? null : walkable);
      if (!mask) return true;
      const levelStops = storeys ? manifest.stops.filter((_, i) => levelOf[i] === level) : manifest.stops;
      return mask.clear([state.position[0], state.position[2]], [stop.floor[0], stop.floor[2]])
        || Boolean(corridorRoute(mask, [state.position[0], mask.floorY, state.position[2]], stop.floor, levelStops));
    }
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
        const reachable = stopReachable(stop, viewerLevel);
        if (index === state.stop && distance < 0.4 || !inFront || !reachable || distance > 12) { button.hidden = true; return; }
        const label = stopLabel(manifest, index);
        const activeStop = state.stop >= 0 ? state.stop : Math.max(0, nearestStop(manifest, state.position, 99, storeys ? STOREY_METRES : Infinity));
        const nextStopIndex = stepStop(activeStop, 1, manifest.stops.length);
        const currentRoomId = manifest.stops[activeStop]?.room;
        if (index === nextStopIndex) button.dataset.next = 'true';
        else delete button.dataset.next;
        if (stop.room !== currentRoomId && label.room) button.dataset.roomLabel = label.room;
        else if (index === nextStopIndex && manifest.stops.length > 1) button.dataset.roomLabel = 'Next';
        else delete button.dataset.roomLabel;
        button.title = [label.room, 'Stop ' + visitNumber(manifest, index)].filter(Boolean).join(' · ');
        world.set(...stop.floor);
        camera.camera.worldToScreen(world, screen);
        // A disc half off the edge is still worth a tap.
        if (screen.x < -12 || screen.y < -12 || screen.x > width + 12 || screen.y > height + 12) { button.hidden = true; return; }
        button.hidden = false;
        const size = clamp(Math.round(200 / Math.max(distance, 0.85)), 26, 44);
        button.style.setProperty('--size', size + 'px');
        button.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px)`;
      });
      drawMapMarker();
    }

    const roomEntries = roomsFromManifest(manifest);
    const roomPills = [];
    const roomKeyAt = index => roomNameForStop(manifest, manifest.stops[index]).toLowerCase();
    const visitedRooms = new Set();
    if (asked === opening) {
      const openingRoomKey = roomKeyAt(opening);
      if (openingRoomKey) visitedRooms.add(openingRoomKey);
    }

    function buildRoomPills() {
      ui.roomsBar.replaceChildren();
      roomPills.length = 0;
      if (roomEntries.length < 2) { ui.roomsBar.hidden = true; return; }
      for (const entry of roomEntries) {
        const footprint = roomFootprint(manifest, entry.id);
        const pill = el('button', { type: 'button', class: 'v2-room-pill', 'data-room': entry.id }, entry.name);
        if (storeys) {
          const lvl = levelOf[entry.firstStop];
          pill.dataset.levelTag = lvl === 0 ? 'G' : 'L' + lvl;
        }
        if (footprint) {
          pill.dataset.dimensions = footprint.label;
          pill.title = [entry.name, footprint.label].filter(Boolean).join(' · ');
        }
        pill.addEventListener('click', () => goToStop(entry.firstStop));
        roomPills.push({ pill, id: entry.id, key: entry.name.toLowerCase() });
        ui.roomsBar.append(pill);
      }
      ui.roomsBar.hidden = roomPills.length < 2;
      ui.roomsBar.addEventListener('scroll', pillsMore, { passive: true });
    }
    // More room names than fit: the row fades at its right edge until it is scrolled to the end.
    function pillsMore() {
      const row = ui.roomsBar;
      if (!row.hidden && row.scrollWidth - row.clientWidth - row.scrollLeft > 4) row.dataset.more = 'true';
      else delete row.dataset.more;
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
        // In the order of the visit, so the list counts up.
        manifest.stops.map((_, place) => stopAtNumber(manifest, place + 1)).forEach(index => {
          const stop = manifest.stops[index];
          if (stop.room !== room.id) return;
          const item = el('li');
          const button = el('button', { type: 'button', class: 'v2-stop-button', 'data-stop': String(index) }, 'Stop ' + visitNumber(manifest, index));
          button.addEventListener('click', () => { togglePanel(ui.stopsPanel, ui.stopsToggle, false); goToStop(index); });
          item.append(button);
          list.append(item);
        });
        group.append(list);
        ui.stopsPanel.append(group);
      }
    }
    function markCurrent(markVisited = false) {
      for (const button of ui.stopsPanel.querySelectorAll('[data-stop]')) {
        if (Number(button.dataset.stop) === state.stop) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      }
      const activeIndex = state.stop >= 0 ? state.stop : Math.max(0, nearestStop(manifest, state.position, 99, storeys ? STOREY_METRES : Infinity));
      const activeRoomId = manifest.stops[activeIndex]?.room;
      const activeRoomKey = roomKeyAt(activeIndex);
      if (markVisited && activeRoomKey) visitedRooms.add(activeRoomKey);
      for (const { pill, id, key } of roomPills) {
        const isCurrent = activeRoomKey ? key === activeRoomKey : id === activeRoomId;
        if (isCurrent) {
          pill.setAttribute('aria-current', 'true');
          const cw = ui.roomsBar.clientWidth || 0;
          if (!ui.roomsBar.hidden && cw > 0 && pill.offsetWidth) {
            const l = pill.offsetLeft;
            const r = l + pill.offsetWidth;
            if (l < ui.roomsBar.scrollLeft) ui.roomsBar.scrollLeft = l;
            else if (r > ui.roomsBar.scrollLeft + cw) ui.roomsBar.scrollLeft = r - cw;
          }
        } else {
          pill.removeAttribute('aria-current');
        }
        if (visitedRooms.has(key)) pill.setAttribute('data-visited', 'true');
        else delete pill.dataset.visited;
      }
      pillsMore();
      ui.stopsToggle.querySelector('.v2-stops-text').textContent = (state.stop >= 0 ? visitNumber(manifest, state.stop) : '–') + ' of ' + manifest.stops.length;
      ui.stopsToggle.setAttribute('aria-label', 'Rooms and stops, stop ' + (state.stop >= 0 ? visitNumber(manifest, state.stop) : 'none') + ' of ' + manifest.stops.length);
      // The last stop of the visit: Next offers the start again, and says so.
      const atEnd = manifest.stops.length > 1 && state.stop === lastStop;
      ui.nextLabel.hidden = atEnd;
      ui.againLabel.hidden = !atEnd;
      ui.restartLabel.hidden = !atEnd;
      if (atEnd) ui.next.dataset.end = 'true'; else delete ui.next.dataset.end;
      ui.next.setAttribute('aria-label', atEnd ? 'Start again from the first stop' : 'Next stop');
      ui.next.title = atEnd ? 'Start again' : 'Next stop';
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
        'Tap a numbered circle, or Next stop, to move.',
      ]) controls.append(el('li', {}, line));
      // For a keyboard; a touch screen does not show it (tour-player-v2.css).
      controls.append(el('li', { class: 'v2-keys' }, 'Keys: left and right look, up and down go to the stop ahead or behind, N and P change stop, 1 to 9 pick a stop, M shows the map.'));
      // The engine's credit and licence, one press away rather than in every visitor's way.
      const credits = el('details', { class: 'v2-credits' });
      const credit = el('p', {}, 'Rendered with the PlayCanvas engine 2.23.2 (MIT licence). ');
      credit.append(el('a', { href: '/vendor/LICENSE.playcanvas.txt', target: '_blank', rel: 'noopener' }, 'Licence'));
      credits.append(el('summary', {}, 'Credits'), credit);
      ui.aboutPanel.append(heading);
      if (contact) {
        // One tap away in full screen too, where the page's own Call and Email are out of reach. First in
        // the panel, so it shows without scrolling on a phone.
        const row = el('div', { class: 'v2-contact' });
        const links = el('div', { class: 'v2-actions' });
        links.append(...contactLinks('v2-quiet'));
        row.append(el('p', { class: 'v2-contact-name' }, 'Contact ' + contact.name), links);
        ui.aboutPanel.append(row);
      }
      ui.aboutPanel.append(el('p', { class: 'v2-truth-full' }, manifest.truthLabel), controls);
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
    const mapParts = [], floorButtons = [], lbFloorButtons = [];
    const fpOverlays = [];
    const fpLevels = storeys && manifest.floorplan?.levels?.length === storeys.length ? manifest.floorplan.levels : null;
    const activeFp = () => (fpLevels && fpLevels[mapLevel]) || manifest.floorplan;
    let fpLightbox = null, fpExpandBtn = null;
    let syncFloorplanUI = () => {};
    function fpProject(wx, wz, fp = activeFp()) {
      if (!fp?.bounds) return null;
      const [bx0, bz0, bx1, bz1] = fp.bounds;
      return [((wx - bx0) / (bx1 - bx0)) * fp.width, ((wz - bz0) / (bz1 - bz0)) * fp.height];
    }
    function syncFpOverlay(item) {
      const fp = activeFp();
      if (!fp?.bounds) {
        item.overlay.setAttribute('display', 'none');
        return;
      }
      item.overlay.removeAttribute('display');
      item.overlay.setAttribute('viewBox', `0 0 ${fp.width} ${fp.height}`);
      const rScale = Math.max(1, fp.width / 1000);
      const pinLevel = fpLevels ? mapLevel : (storeys ? levelOf[manifest.start] : null);
      const cur = hereStop();
      for (const { g, hit, dot, label, index } of item.stopNodes) {
        const stop = manifest.stops[index];
        const visible = pinLevel === null || levelOf[index] === pinLevel;
        if (!visible) {
          g.setAttribute('display', 'none');
        } else {
          g.removeAttribute('display');
          const pt = fpProject(stop.floor[0], stop.floor[2], fp);
          if (pt) g.setAttribute('transform', `translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)})`);
        }
        hit.setAttribute('r', String((34 * rScale).toFixed(1)));
        dot.setAttribute('r', String((16 * rScale).toFixed(1)));
        label.setAttribute('font-size', String((16 * rScale).toFixed(1)));
        label.setAttribute('dy', String((5.5 * rScale).toFixed(1)));
        if (index === cur) g.setAttribute('data-current', 'true');
        else delete g.dataset.current;
      }
      const cr = 54 * rScale;
      item.cone.setAttribute('d', `M0 0L${(-cr * 0.45).toFixed(1)} ${(-cr).toFixed(1)}A${cr.toFixed(1)} ${cr.toFixed(1)} 0 0 1 ${(cr * 0.45).toFixed(1)} ${(-cr).toFixed(1)}Z`);
      item.you.setAttribute('r', String((7 * rScale).toFixed(1)));
      const showYou = !storeys || (mapLevel === viewerLevel && (fpLevels || viewerLevel === levelOf[manifest.start]));
      const pt = showYou ? fpProject(state.position[0], state.position[2], fp) : null;
      if (pt) {
        item.marker.removeAttribute('display');
        item.marker.setAttribute('transform', `translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)}) rotate(${(-state.yaw).toFixed(1)})`);
      } else {
        item.marker.setAttribute('display', 'none');
      }
    }
    function buildFpOverlay(ns, fp, { interactive = true, onStopPicked = null } = {}) {
      const hasBounds = fpLevels ? fpLevels.some(lv => Boolean(lv.bounds)) : Boolean(fp?.bounds);
      if (!hasBounds) return null;
      const overlay = document.createElementNS(ns, 'svg');
      overlay.setAttribute('class', 'v2-fp-overlay');
      overlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const stopNodes = [];
      manifest.stops.forEach((stop, index) => {
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'v2-fp-stop');
        if (interactive) {
          g.setAttribute('role', 'button');
          g.setAttribute('tabindex', '0');
          g.setAttribute('data-fp-stop', String(index));
          const lbl = stopLabel(manifest, index);
          g.setAttribute('aria-label', 'Go to ' + (lbl.room ? `${lbl.room}, ${lbl.stop}` : lbl.stop));
          const pick = event => {
            event.stopPropagation();
            goToStop(index);
            onStopPicked?.(index);
          };
          g.addEventListener('click', pick);
          g.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(event); }
          });
        }
        const hit = document.createElementNS(ns, 'circle');
        hit.setAttribute('class', 'v2-fp-hit');
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('class', 'v2-fp-dot');
        const label = document.createElementNS(ns, 'text');
        label.textContent = String(visitNumber(manifest, index));
        g.append(hit, dot, label);
        overlay.append(g);
        stopNodes.push({ g, hit, dot, label, index });
      });
      const marker = document.createElementNS(ns, 'g');
      marker.setAttribute('class', 'v2-fp-you');
      const cone = document.createElementNS(ns, 'path');
      const you = document.createElementNS(ns, 'circle');
      marker.append(cone, you);
      overlay.append(marker);
      const item = { overlay, marker, cone, you, stopNodes };
      fpOverlays.push(item);
      syncFpOverlay(item);
      return overlay;
    }
    function closeFpLightbox() {
      if (!fpLightbox || fpLightbox.hidden) return;
      fpLightbox.hidden = true;
      if (usableFocus(fpExpandBtn)) fpExpandBtn.focus();
    }
    function showMapLevel(level) {
      mapLevel = level;
      for (const [node, on] of mapParts) { if (on === level) node.removeAttribute('display'); else node.setAttribute('display', 'none'); }
      floorButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === level)));
      lbFloorButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === level)));
      if (mapMarker) { if (level === viewerLevel) mapMarker.removeAttribute('display'); else mapMarker.setAttribute('display', 'none'); }
      syncFloorplanUI();
      drawMapMarker();
    }
    function buildFloorButtons() {
      const group = el('div', { class: 'v2-floors', role: 'group', 'aria-label': 'Floors' });
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
        const renderGrid = (grid, sIdx) => {
          const floor = document.createElementNS(ns, 'path');
          floor.setAttribute('class', 'v2-map-floor');
          floor.setAttribute('d', grid.runs.map(([x, z, w, h]) => `M${x.toFixed(2)} ${z.toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}z`).join(''));
          mapGroup.append(floor);
          if (sIdx !== null) mapParts.push([floor, sIdx]);
          if (grid.walls) {
            const walls = document.createElementNS(ns, 'path');
            walls.setAttribute('class', 'v2-map-walls');
            walls.setAttribute('d', grid.walls);
            mapGroup.append(walls);
            if (sIdx !== null) mapParts.push([walls, sIdx]);
          }
        };
        if (storeys && walkable.storeyLevels?.length === storeys.length) {
          walkable.storeyLevels.forEach((grid, sIdx) => renderGrid(grid, sIdx));
        } else {
          // The root walkable floor is carved for the opening stop's level only.
          renderGrid(walkable, storeys ? levelOf[manifest.start] : null);
        }
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
        label.textContent = String(visitNumber(manifest, index));
        // A finger needs more than the dot: an unseen ~44 px circle takes the press.
        const hit = document.createElementNS(ns, 'circle');
        hit.setAttribute('class', 'v2-map-hit');
        hit.setAttribute('r', String(half * 0.22));
        dot.append(hit, circle, label);
        dot.addEventListener('click', () => goToStop(index));
        mapGroup.append(dot);
        if (storeys) mapParts.push([dot, levelOf[index]]);
      });
      const roomCenters = new Map();
      manifest.stops.forEach((stop, index) => {
        const roomName = roomNameForStop(manifest, stop);
        if (!roomName) return;
        const level = storeys ? levelOf[index] : 0;
        const key = `${level}:${stop.room}`;
        let entry = roomCenters.get(key);
        if (!entry) { entry = { name: roomName, level, xs: [], zs: [] }; roomCenters.set(key, entry); }
        entry.xs.push(stop.floor[0]);
        entry.zs.push(stop.floor[2]);
      });
      for (const entry of roomCenters.values()) {
        const rx = entry.xs.reduce((a, b) => a + b, 0) / entry.xs.length;
        const rz = entry.zs.reduce((a, b) => a + b, 0) / entry.zs.length;
        const roomText = document.createElementNS(ns, 'text');
        roomText.setAttribute('class', 'v2-map-room-label');
        roomText.setAttribute('transform', `translate(${rx.toFixed(3)} ${rz.toFixed(3)}) rotate(${-mapTurn})`);
        roomText.setAttribute('y', String((half * 0.21).toFixed(3)));
        roomText.setAttribute('font-size', String((half * 0.095).toFixed(3)));
        roomText.textContent = entry.name;
        mapGroup.append(roomText);
        if (storeys) mapParts.push([roomText, entry.level]);
      }
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
      if (!manifest.floorplan) {
        if (!storeys) { ui.map.replaceChildren(svg, caption); return; }
        ui.map.replaceChildren(buildFloorButtons(), svg, caption);
        showMapLevel(mapLevel);
        return;
      }
      const floorsGroup = storeys ? buildFloorButtons() : null;
      const modes = el('div', { class: 'v2-map-modes', role: 'group', 'aria-label': 'Map view' });
      const stopsBtn = el('button', { type: 'button', class: 'v2-map-mode', 'data-map-mode': 'stops', 'aria-pressed': 'true' }, 'Stops');
      const floorplanBtn = el('button', { type: 'button', class: 'v2-map-mode', 'data-map-mode': 'floorplan', 'aria-pressed': 'false' }, 'Floorplan');
      modes.append(stopsBtn, floorplanBtn);
      const fpWrap = el('div', { class: 'v2-fp-wrap', hidden: true });
      const initFp = activeFp();
      const fpImg = el('img', {
        class: 'v2-map-floorplan',
        alt: '2D floor plan, not to scale',
        width: String(initFp.width),
        height: String(initFp.height),
        decoding: 'async',
        hidden: true,
      });
      fpWrap.append(fpImg);
      const miniOverlay = buildFpOverlay(ns, initFp, { interactive: true });
      if (miniOverlay) fpWrap.append(miniOverlay);
      const fpStatus = el('p', { class: 'v2-map-floorplan-error', hidden: true }, 'Floor plan couldn’t load.');
      fpExpandBtn = el('button', { type: 'button', class: 'v2-fp-expand', hidden: true, 'aria-label': 'Open larger floor plan' }, 'Larger floor plan');
      let fpLoaded = false;
      let lbImg = null;
      syncFloorplanUI = () => {
        const fp = activeFp();
        if (!fp) return;
        fpImg.setAttribute('width', String(fp.width));
        fpImg.setAttribute('height', String(fp.height));
        const nextSrc = base + fp.path;
        if (fpLoaded && fpImg.src !== nextSrc) {
          fpStatus.hidden = true;
          if (ui.map.dataset.mapMode === 'floorplan') {
            fpWrap.hidden = false;
            fpImg.hidden = false;
            fpExpandBtn.hidden = false;
          }
          fpImg.src = nextSrc;
        }
        if (lbImg) {
          lbImg.setAttribute('width', String(fp.width));
          lbImg.setAttribute('height', String(fp.height));
          if ((fpLoaded || (fpLightbox && !fpLightbox.hidden)) && lbImg.src !== nextSrc) {
            lbImg.src = nextSrc;
          }
        }
      };
      const openFpLightbox = () => {
        const fp = activeFp();
        const src = base + fp.path;
        if (!fpLoaded || fpImg.src !== src) {
          fpLoaded = true;
          fpImg.setAttribute('width', String(fp.width));
          fpImg.setAttribute('height', String(fp.height));
          fpImg.src = src;
        }
        if (!fpLightbox) {
          fpLightbox = el('div', { class: 'v2-fp-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': '2D floor plan', hidden: true });
          const card = el('div', { class: 'v2-fp-lightbox-card' });
          const head = el('div', { class: 'v2-fp-lightbox-head' });
          const closeBtn = el('button', { type: 'button', class: 'v2-fp-close', 'aria-label': 'Close floor plan' }, 'Close');
          closeBtn.addEventListener('click', closeFpLightbox);
          head.append(el('span', { class: 'v2-fp-lightbox-title' }, '2D floor plan · not to scale'));
          if (fpLevels) {
            const lbFloors = el('div', { class: 'v2-fp-lightbox-floors', role: 'group', 'aria-label': 'Floors' });
            storeys.forEach((level, index) => {
              const btn = el('button', { type: 'button', class: 'v2-floor', 'aria-pressed': String(index === mapLevel) }, fpLevels[index].name || level.name);
              btn.addEventListener('click', () => showMapLevel(index));
              lbFloorButtons.push(btn);
              lbFloors.append(btn);
            });
            head.append(lbFloors);
          }
          head.append(closeBtn);
          const canvasBox = el('div', { class: 'v2-fp-lightbox-canvas' });
          lbImg = el('img', {
            class: 'v2-fp-lightbox-img',
            alt: 'Larger 2D floor plan, not to scale',
            width: String(fp.width),
            height: String(fp.height),
            decoding: 'async',
          });
          canvasBox.append(lbImg);
          const lbOverlay = buildFpOverlay(ns, fp, { interactive: true, onStopPicked: closeFpLightbox });
          if (lbOverlay) canvasBox.append(lbOverlay);
          card.append(head, canvasBox);
          fpLightbox.append(card);
          fpLightbox.addEventListener('click', event => { if (event.target === fpLightbox) closeFpLightbox(); });
          ui.root.append(fpLightbox);
        }
        if (lbImg) {
          lbImg.setAttribute('width', String(fp.width));
          lbImg.setAttribute('height', String(fp.height));
          if (lbImg.src !== src) lbImg.src = src;
        }
        lbFloorButtons.forEach((btn, index) => btn.setAttribute('aria-pressed', String(index === mapLevel)));
        fpLightbox.hidden = false;
        drawMapMarker();
        fpLightbox.querySelector('.v2-fp-close')?.focus?.();
      };
      fpExpandBtn.addEventListener('click', openFpLightbox);
      fpImg.addEventListener('click', openFpLightbox);
      fpImg.addEventListener('error', () => {
        if (torndown) return;
        fpImg.hidden = true;
        fpWrap.hidden = true;
        fpExpandBtn.hidden = true;
        if (ui.map.dataset.mapMode === 'floorplan') fpStatus.hidden = false;
      });
      const setMapMode = mode => {
        const isFp = mode === 'floorplan';
        ui.map.dataset.mapMode = isFp ? 'floorplan' : 'stops';
        stopsBtn.setAttribute('aria-pressed', String(!isFp));
        floorplanBtn.setAttribute('aria-pressed', String(isFp));
        if (isFp) svg.setAttribute('hidden', ''); else svg.removeAttribute('hidden');
        if (floorsGroup) floorsGroup.hidden = isFp && !fpLevels;
        fpStatus.hidden = true;
        if (isFp) {
          const fp = activeFp();
          const src = base + fp.path;
          if (!fpLoaded || fpImg.src !== src) {
            fpLoaded = true;
            fpImg.setAttribute('width', String(fp.width));
            fpImg.setAttribute('height', String(fp.height));
            fpImg.src = src;
          }
          fpWrap.hidden = false;
          fpImg.hidden = false;
          fpExpandBtn.hidden = false;
          caption.textContent = '2D floor plan · not to scale';
          drawMapMarker();
        } else {
          fpWrap.hidden = true;
          fpImg.hidden = true;
          fpExpandBtn.hidden = true;
          caption.textContent = 'Map of stops · not to scale';
        }
      };
      stopsBtn.addEventListener('click', () => setMapMode('stops'));
      floorplanBtn.addEventListener('click', () => setMapMode('floorplan'));
      ui.map.dataset.mapMode = 'stops';
      const nodes = floorsGroup ? [floorsGroup, modes, svg, fpWrap, fpStatus, fpExpandBtn, caption] : [modes, svg, fpWrap, fpStatus, fpExpandBtn, caption];
      ui.map.replaceChildren(...nodes);
      if (storeys) showMapLevel(mapLevel);
    }
    function drawMapMarker() {
      if (mapMarker) {
        // Reaching another level brings the map with you; a level picked by hand stays until then.
        if (storeys && viewerLevel !== mapShownFor) { mapShownFor = viewerLevel; showMapLevel(viewerLevel); }
        // Heading in map space: yaw 0 looks toward -z, which is map-up before the turn.
        mapMarker.setAttribute('transform', `translate(${state.position[0].toFixed(3)} ${state.position[2].toFixed(3)}) rotate(${(-state.yaw).toFixed(1)})`);
      }
      if (fpOverlays.length) {
        for (const item of fpOverlays) syncFpOverlay(item);
      }
    }

    function togglePanel(panel, toggle, open) {
      const show = open ?? panel.hidden;
      for (const [other, button] of [[ui.stopsPanel, ui.stopsToggle], [ui.aboutPanel, ui.about]]) {
        if (other !== panel && !other.hidden) { other.hidden = true; button.setAttribute('aria-expanded', 'false'); }
      }
      if (show) hideEnd();
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
    // Point to point (owner decision, 12 November 2026): every move is a jump to a stop, from a circle, Next and
    // Previous, a room, the map or a key. Nothing walks: not over the floor mask, not along the path walked at capture.
    // The last move, for QA (inspect()).
    let lastMove = null;
    // On a home with levels, a stop straight above or below is not where you are.
    const sameLevel = storeys ? STOREY_METRES : Infinity;
    let lastRoomVisited = stopLabel(manifest, opening).room || '';
    // What the viewer did, said to the page as a DOM event and nothing more: the player itself sends nothing anywhere.
    function announceActivity(type, detail) {
      try {
        if (typeof CustomEvent === 'function') document.dispatchEvent?.(new CustomEvent(type, { detail }));
      } catch { /* optional: a page that is not listening changes nothing */ }
    }
    // The stop the viewer is on, by its id, for the optional first-party stop-engagement collector
    // (viewer-engagement.js, off unless the deployment turns it on). null means "on no stop".
    function engagementStop(id) {
      try { ui.root.dispatchEvent?.(new CustomEvent('veylet:stop', { bubbles: true, detail: { source: 'veylet-v2', stop_id: id } })); } catch { /* optional first-party measurement never blocks playback */ }
    }
    // Viewer insights (docs/data-events-20261111.md): the stops reached and the seconds spent per room TYPE,
    // said to the page as one 'veylet:visit' summary after every arrival. A room's own name is never in it,
    // only its preset type (CaptureRoomNames.presets; any other name is Other). The page decides whether
    // anything is counted; the player itself still sends nothing anywhere.
    function roomType(name) {
      const presets = ['Living', 'Kitchen', 'Bedroom', 'Bathroom', 'Hall', 'Stairs', 'Landing', 'Office', 'Reception',
        'Meeting room', 'Retail floor', 'Studio', 'Garage', 'Outdoor area'];
      const words = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      if (words.length > 1 && /^[0-9]+$/.test(words[words.length - 1])) words.pop();
      const base = words.join(' ').toLowerCase();
      return presets.find(type => type.toLowerCase() === base) || 'Other';
    }
    const visitLog = { seen: new Set([opening]), last: visitNumber(manifest, opening), furthest: visitNumber(manifest, opening),
      room: roomType(stopLabel(manifest, opening).room), since: performance.now(), ms: new Map() };
    function logVisit(index, room) {
      const now = performance.now();
      if (visitLog.room) visitLog.ms.set(visitLog.room, (visitLog.ms.get(visitLog.room) || 0) + Math.max(0, now - visitLog.since));
      visitLog.since = now;
      visitLog.room = roomType(room);
      visitLog.seen.add(index);
      visitLog.last = visitNumber(manifest, index);
      visitLog.furthest = Math.max(visitLog.furthest, visitLog.last);
      const seconds = {};
      for (const [type, ms] of visitLog.ms) seconds[type] = Math.round(ms / 1000);
      // `room` is where the visitor is now: the page adds the time from this event to the end of the visit.
      return { stops: visitLog.seen.size, last_stop: visitLog.last, furthest_stop: visitLog.furthest,
        total_stops: manifest.stops.length, room: visitLog.room, seconds };
    }
    function arrived(index) {
      // Point to point: every move ends at a stop, so index is always one.
      state.stop = index;
      const label = labels(index);
      markCurrent(true);
      placeHotspots();
      ui.announce.textContent = [label.room, label.stop].filter(Boolean).join(', ');
      if (label.room && label.room !== lastRoomVisited) {
        lastRoomVisited = label.room;
        announceActivity('veylet:room', { room: label.room });
      }
      announceActivity('veylet:stop', { stop: index, room: label.room || null });
      announceActivity('veylet:visit', logVisit(index, label.room));
      engagementStop(index >= 0 && (!chunked || held.get(currentChunk)?.settled) ? manifest.stops[index]?.id || null : null);
      tellStop(index);
      if (index === lastStop && manifest.stops.length > 1) showEnd(); else hideEnd();
    }
    /** The page hears which stop this is (its number in the visit) and its room name, for address, Share and enquiries. */
    function tellStop(index) {
      if (index < 0) return;
      const roomName = stopLabel(manifest, index).room || null;
      try { visit.onStop?.(visitNumber(manifest, index), manifest.stops.length, roomName); } catch { /* optional */ }
    }

    // ----- who to contact, Share, and the end of the visit -----
    let contact = null;
    const linkOk = href => typeof href === 'string' && /^(?:tel:|mailto:|https:\/\/)/.test(href);
    Promise.resolve(visit.contact).then(value => {
      if (torndown || !value || typeof value.name !== 'string' || !value.name || !Array.isArray(value.actions)) return;
      const actions = value.actions.filter(item => item && typeof item.label === 'string' && linkOk(item.href)).slice(0, 3);
      if (!actions.length) return;
      contact = { name: value.name.slice(0, 80), actions };
      aboutContents();
      if (!ui.end.hidden) showEnd(false);
    }, () => {});
    function contactLinks(className) {
      return contact.actions.map(action => {
        const link = el('a', { class: className, href: action.href, 'aria-label': action.label + ' ' + contact.name }, action.label);
        if (action.external) { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
        link.addEventListener('click', event => {
          // The address as it is now (the stop the visitor is on), then the page's own note of the press.
          try { const now = action.hrefNow?.(); if (linkOk(now)) link.setAttribute('href', now); } catch { /* the first address stands */ }
          try {
            if (typeof action.onPress === 'function') {
              event?.preventDefault?.();
              if (pseudo) setPseudo(false);
              else if (fullElement()) {
                const done = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.();
                done?.catch?.(() => {});
              }
              action.onPress();
            }
          } catch { /* optional */ }
          try { action.press?.(); } catch { /* optional */ }
        });
        return link;
      });
    }
    function shareButton(className) {
      if (typeof visit.share !== 'function') return null;
      const button = el('button', { type: 'button', class: className }, 'Share');
      button.addEventListener('click', async () => {
        let said = '';
        try { said = await visit.share(); } catch { said = ''; }
        if (typeof said === 'string' && said && !torndown) say(said);
      });
      return button;
    }
    function showEnd(announce = true) {
      if (!ready) return;
      // Only puts the card away: a quiet press. The bar's Restart is the player's one filled
      // action here, and the page's own Call stays the filled way on.
      const stay = el('button', { type: 'button', class: 'v2-quiet' }, 'Look around again');
      stay.addEventListener('click', () => { hideEnd(); ui.canvas.focus?.(); });
      const actions = el('div', { class: 'v2-actions' });
      actions.append(stay);
      const share = shareButton('v2-quiet');
      if (share) actions.append(share);
      if (contact) {
        // A page that already shows Call and Email beside the stage hides these until full screen (tour-stage.css).
        const reach = el('span', { class: 'v2-end-contact' });
        reach.append(...contactLinks('v2-quiet'));
        actions.append(reach);
      }
      const endNodes = [el('p', { class: 'v2-end-title' }, 'That’s the last stop.'), actions];
      if (visit?.madeWith?.href) {
        const made = el('p', { class: 'v2-end-made' });
        made.append(el('a', {
          class: 'v2-end-made-link',
          href: String(visit.madeWith.href),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, visit.madeWith.label || 'Made with Veylet'));
        endNodes.push(made);
      }
      ui.end.replaceChildren(...endNodes);
      // Above the controls, whatever their height (a row of room names makes them taller).
      const barHeight = ui.bar.offsetHeight || ui.bar.clientHeight || 0;
      if (barHeight) ui.end.style.setProperty('--v2-bar', barHeight + 'px');
      ui.end.hidden = false;
      ui.root.dataset.end = 'shown';
      if (announce) ui.announce.textContent = [ui.announce.textContent, 'That’s the last stop.'].filter(Boolean).join('. ');
      try { visit?.onEnd?.(true); } catch { /* optional */ }
    }
    function hideEnd() {
      if (ui.end.hidden) return;
      const held = ui.end.contains(document.activeElement);
      ui.end.hidden = true;
      delete ui.root.dataset.end;
      if (held) ui.next.focus?.();
      try { visit?.onEnd?.(false); } catch { /* optional */ }
    }
    function goToStop(index, byUser = true, orientation = null) {
      if (!ready) return;
      if (typeof cancelLookInertia === 'function') cancelLookInertia();
      engagementStop(null);
      dismissHint(byUser);
      hideEnd();
      const stop = manifest.stops[index];
      const look = lookAngles(stop.position, stop.target);
      // A chunked home holds the stop's room (and the rooms beyond its doorways) first; far rooms go on arrival.
      if (chunked) enterChunk(chunked.chunkOfRoom[stop.room]);
      lastMove = { route: 'direct', from: state.stop, to: index, points: 2, duration: 0, cut: true };
      const yaw = orientation && orientation.yaw !== null && orientation.yaw !== undefined ? orientation.yaw : look.yaw;
      const pitch = orientation && orientation.pitch !== null && orientation.pitch !== undefined ? orientation.pitch : look.pitch;
      Object.assign(state, { position: [...stop.position], yaw, pitch });
      if (typeof onStopTransition === 'function') onStopTransition(index, true);
      applyCamera();
      // The jump itself stays instant (the camera is already there); a moved-by-hand jump fades in from dark.
      // Reduce Motion keeps the plain cut.
      if (byUser && !reduced()) fadeInAfterJump();
      arrived(index);
      if (typeof onStopTransition === 'function') onStopTransition(index, false);
      if (chunked) releaseFarChunks();
    }
    // 280 ms from 55% dark to clear: long enough to read as a step, short enough that Next can be tapped again at once.
    const JUMP_FADE = { from: 0.55, ms: 280 };
    function fadeInAfterJump() {
      const veil = ui.veil;
      if (!veil || typeof veil.animate !== 'function') return;
      veil.getAnimations?.().forEach(animation => animation.cancel());
      veil.animate([{ opacity: JUMP_FADE.from }, { opacity: 0 }], { duration: JUMP_FADE.ms, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    }
    // Where Next and Previous count from: the stop the viewer is on.
    const hereStop = () => (state.stop >= 0 ? state.stop : Math.max(0, nearestStop(manifest, state.position, 99, sameLevel)));
    let messageTimer = null;
    function say(message) {
      ui.status.textContent = message;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => { if (ui.status.textContent === message) ui.status.textContent = ''; }, 3500);
    }
    // ----- point to point: only the circles, Next and Previous, rooms, the map and keys move -----
    // Short enough to fit a 280 px phone frame on one line.
    const STOP_HINT = 'Tap a numbered circle to move.';
    // Facing a wall there may be no circle on screen to tap: then the hint names what is, the Next button.
    const NO_CIRCLE_HINT = 'No circle in view. Tap Next.';
    const missHint = () => (hotspotButtons.some(button => !button.hidden) ? STOP_HINT : NO_CIRCLE_HINT);
    // Forward and back: stops within KEY_CONE degrees either side of the heading (four headings cover the room),
    // no further than the circles are drawn; stops within KEY_TIE degrees of the best aligned count as level, nearest wins.
    const KEY_CONE = 45, KEY_TIE = 10, KEY_REACH = 12;
    /** The other stops on the viewer's level that the circles' rule lets it move to. */
    function stopChoices() {
      const level = storeys ? levelAt(storeys, state.position) : 0;
      const here = hereStop();
      return manifest.stops.map((stop, index) => ({ stop, index }))
        .filter(({ stop, index }) => index !== here && (!storeys || levelOf[index] === level) && stopReachable(stop, level));
    }
    /** Forward (1) or back (-1): to the stop best aligned with the heading, or the hint. */
    function stepForward(sign) {
      const forward = forwardOf(state.yaw, 0);
      let best = null;
      const choices = stopChoices().map(({ stop, index }) => {
        const dx = stop.position[0] - state.position[0], dz = stop.position[2] - state.position[2], distance = Math.hypot(dx, dz);
        const angle = distance > 1e-6 ? Math.acos(clamp((dx * forward[0] + dz * forward[2]) * sign / distance, -1, 1)) * 180 / Math.PI : 180;
        return { index, distance, angle };
      }).filter(choice => choice.angle <= KEY_CONE && choice.distance <= KEY_REACH);
      const least = Math.min(...choices.map(choice => choice.angle));
      for (const choice of choices) if (choice.angle <= least + KEY_TIE && (!best || choice.distance < best.distance)) best = choice;
      if (best) goToStop(best.index); else say(missHint());
    }
    /** A tap on the scene never moves: it says how to (a numbered circle, or Next when none is in view). */
    function tapAt() {
      say(missHint());
    }

    // ----- input -----
    // Interruptible drag-to-look inertia: driven via rAF ONLY while velocity > epsilon after a drag.
    // Zero timers when idle; zero inertia under prefers-reduced-motion; instantly cancelled by any new input.
    const lookInertia = { vyaw: 0, vpitch: 0, active: false, rafId: null, lastTime: 0 };
    function stopLookInertia() {
      if (lookInertia.rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(lookInertia.rafId);
        lookInertia.rafId = null;
      }
      if (lookInertia.active) {
        lookInertia.active = false;
        continuous = Math.max(0, continuous - 1);
      }
      lookInertia.vyaw = 0;
      lookInertia.vpitch = 0;
      lookInertia.lastTime = 0;
    }
    cancelLookInertia = stopLookInertia;
    function tickLookInertia() {
      lookInertia.rafId = null;
      if (!lookInertia.active || torndown || !ready || reduced()) { stopLookInertia(); return; }
      const now = performance.now();
      const dt = Math.max(0, (now - lookInertia.lastTime) / 1000);
      lookInertia.lastTime = now;
      const next = stepLookInertia(
        { yaw: state.yaw, pitch: state.pitch, vyaw: lookInertia.vyaw, vpitch: lookInertia.vpitch },
        dt,
        { reducedMotion: reduced() },
      );
      state.yaw = next.yaw;
      state.pitch = next.pitch;
      lookInertia.vyaw = next.vyaw;
      lookInertia.vpitch = next.vpitch;
      applyCamera();
      if (!next.active) { stopLookInertia(); return; }
      if (typeof requestAnimationFrame === 'function') lookInertia.rafId = requestAnimationFrame(tickLookInertia);
      else stopLookInertia();
    }
    function startLookInertia(vyaw, vpitch) {
      stopLookInertia();
      if (reduced() || torndown || !ready || typeof requestAnimationFrame !== 'function') return;
      const speed = Math.hypot(vyaw, vpitch);
      if (!Number.isFinite(speed) || speed <= LOOK_INERTIA_EPSILON) return;
      const scale = speed > LOOK_INERTIA_MAX_SPEED ? LOOK_INERTIA_MAX_SPEED / speed : 1;
      lookInertia.vyaw = vyaw * scale;
      lookInertia.vpitch = vpitch * scale;
      lookInertia.active = true;
      lookInertia.lastTime = performance.now();
      if (continuous === 0 && !benchmark) lastRender = lookInertia.lastTime;
      continuous++;
      lookInertia.rafId = requestAnimationFrame(tickLookInertia);
    }
    const pointers = new Map();
    let drag = null, pinch = null, engaged = false;
    ui.canvas.addEventListener('pointerdown', event => {
      if (!ready) return;
      stopLookInertia();
      engaged = true;
      wheelHeld = true;
      dismissHint(true);
      hideEnd();
      ui.canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const now = performance.now();
      if (pointers.size === 1) {
        drag = {
          x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: now, moved: 0,
          samples: [{ t: now, yaw: state.yaw, pitch: state.pitch }],
        };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
        drag = null;
      }
      if (continuous === 0 && !benchmark) lastRender = now;
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
        if (drag.moved > 6) ui.root.dataset.looking = 'true';
        const perPixel = camera.camera.fov / Math.max(1, camera.camera.horizontalFov ? ui.canvas.clientWidth : ui.canvas.clientHeight);
        state.yaw += dx * perPixel;
        state.pitch = clamp(state.pitch + dy * perPixel, -80, 80);
        const now = performance.now();
        drag.samples.push({ t: now, yaw: state.yaw, pitch: state.pitch });
        while (drag.samples.length > 2 && now - drag.samples[0].t > LOOK_VELOCITY_WINDOW_MS) drag.samples.shift();
        applyCamera();
      }
    });
    const release = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      continuous = Math.max(0, continuous - 1);
      const now = performance.now();
      // A finger wobbles: a short press that moved a little is still a tap.
      const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
      const isTap = Boolean(drag && event.type === 'pointerup' && drag.moved < (touch ? 16 : 8) && now - drag.time < (touch ? 600 : 450));
      if (isTap) tapAt(event.clientX, event.clientY);
      else if (drag && event.type === 'pointerup' && !reduced() && drag.samples.length >= 2) {
        while (drag.samples.length > 2 && now - drag.samples[0].t > LOOK_VELOCITY_WINDOW_MS) drag.samples.shift();
        const first = drag.samples[0], last = drag.samples[drag.samples.length - 1];
        const staleMs = now - last.t;
        const spanMs = last.t - first.t;
        if (staleMs <= 60 && spanMs >= 1) {
          const dtSec = Math.max(0.012, spanMs / 1000);
          startLookInertia((last.yaw - first.yaw) / dtSec, (last.pitch - first.pitch) / dtSec);
        }
      } else if (event.type === 'pointercancel') {
        stopLookInertia();
      }
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) delete ui.root.dataset.looking;
      drag = null;
    };
    ui.canvas.addEventListener('pointerup', release);
    ui.canvas.addEventListener('pointercancel', release);
    // The wheel belongs to the page until the visitor is using the walkthrough. Inside someone else's page:
    // a trackpad pinch only, once engaged. On our own pages: a pinch, full screen, a page with nothing to
    // scroll, or after a press or key on the walkthrough, until the pointer leaves it or focus moves on.
    let wheelHeld = false;
    const releaseWheel = () => { wheelHeld = false; };
    stage.addEventListener('pointerleave', releaseWheel);
    ui.canvas.addEventListener('blur', releaseWheel);
    const pageScrolls = () => {
      const root = document.documentElement;
      return Boolean(root && root.scrollHeight > root.clientHeight + 1);
    };
    ui.canvas.addEventListener('wheel', event => {
      if (!ready) return;
      if (framed ? (!event.ctrlKey || !engaged) : (!event.ctrlKey && !wheelHeld && !isFull() && pageScrolls())) return;
      event.preventDefault();
      stopLookInertia();
      state.zoom = clamp(state.zoom * Math.exp(event.deltaY * 0.01), 0.55, 1.3);
      applyCamera();
    }, { passive: false });
    ui.canvas.addEventListener('keydown', event => {
      if (!ready || event.altKey || event.metaKey || event.ctrlKey) return;
      engaged = true;
      const key = event.key;
      const handled = () => { event.preventDefault(); stopLookInertia(); wheelHeld = true; dismissHint(true); };
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'a' || key === 'A' || key === 'd' || key === 'D') {
        handled();
        const left = key === 'ArrowLeft' || key === 'a' || key === 'A';
        state.yaw += left ? 10 : -10;
        applyCamera();
      }
      else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'w' || key === 'W' || key === 's' || key === 'S') {
        handled();
        const forward = key === 'ArrowUp' || key === 'w' || key === 'W';
        stepForward(forward ? 1 : -1);
      }
      else if (key === 'PageUp' || key === 'PageDown') { handled(); state.pitch = clamp(state.pitch + (key === 'PageUp' ? 8 : -8), -80, 80); applyCamera(); }
      else if (key === 'n' || key === 'N' || key === ']') { handled(); goToStop(stepStop(hereStop(), 1, manifest.stops.length)); }
      else if (key === 'p' || key === 'P' || key === '[') { handled(); goToStop(stepStop(hereStop(), -1, manifest.stops.length)); }
      else if (/^[1-9]$/.test(key) && Number(key) <= manifest.stops.length) { handled(); goToStop(stopAtNumber(manifest, Number(key))); }
      else if (key === 'Home' || key === '0') { handled(); state.zoom = 1; goToStop(manifest.start); }
      else if (key === '+' || key === '=') { handled(); state.zoom = clamp(state.zoom * 0.9, 0.55, 1.3); applyCamera(); }
      else if (key === '-' || key === '_') { handled(); state.zoom = clamp(state.zoom / 0.9, 0.55, 1.3); applyCamera(); }
      else if (key === 'm' || key === 'M') { handled(); toggleMap(); }
    });
    function stopAutoTour(announceStop = false) {
      if (!autoTimer) return;
      clearTimeout(autoTimer);
      autoTimer = null;
      ui.autoTour.replaceChildren(icon('play'));
      ui.autoTour.setAttribute('aria-pressed', 'false');
      ui.autoTour.setAttribute('aria-label', 'Play auto-tour');
      ui.autoTour.title = 'Play auto-tour';
      if (announceStop) ui.announce.textContent = 'Auto-tour paused';
    }
    function scheduleAutoStep() {
      autoTimer = setTimeout(() => {
        if (torndown || !ready || document.visibilityState === 'hidden') { stopAutoTour(false); return; }
        const cur = hereStop();
        if (cur === lastStop) { stopAutoTour(false); return; }
        goToStop(stepStop(cur, 1, manifest.stops.length), false);
        if (autoTimer) scheduleAutoStep();
      }, 4500);
    }
    function startAutoTour() {
      if (!ready || manifest.stops.length < 2) return;
      if (autoTimer) { stopAutoTour(true); return; }
      stopLookInertia();
      dismissHint(true);
      hideEnd();
      ui.autoTour.replaceChildren(icon('pause'));
      ui.autoTour.setAttribute('aria-pressed', 'true');
      ui.autoTour.setAttribute('aria-label', 'Pause auto-tour');
      ui.autoTour.title = 'Pause auto-tour';
      ui.announce.textContent = 'Auto-tour playing';
      scheduleAutoStep();
    }
    function toggleViewControls(show) {
      const open = show ?? ui.viewBar.hidden;
      ui.viewBar.hidden = !open;
      ui.viewToggle.setAttribute('aria-expanded', String(open));
      ui.viewToggle.setAttribute('aria-label', open ? 'Hide look and zoom controls' : 'Look and zoom controls');
      ui.viewToggle.title = ui.viewToggle.getAttribute('aria-label');
      syncBarHeight();
    }
    ui.autoTour.hidden = manifest.stops.length < 2;
    ui.autoTour.addEventListener('click', () => startAutoTour());
    ui.viewToggle.addEventListener('click', () => toggleViewControls());
    ui.lookLeft.addEventListener('click', () => { if (!ready) return; stopLookInertia(); stopAutoTour(false); engaged = true; dismissHint(true); state.yaw += 15; applyCamera(); });
    ui.lookRight.addEventListener('click', () => { if (!ready) return; stopLookInertia(); stopAutoTour(false); engaged = true; dismissHint(true); state.yaw -= 15; applyCamera(); });
    ui.zoomIn.addEventListener('click', () => { if (!ready) return; stopLookInertia(); stopAutoTour(false); engaged = true; dismissHint(true); state.zoom = clamp(state.zoom * 0.88, 0.55, 1.3); applyCamera(); });
    ui.zoomOut.addEventListener('click', () => { if (!ready) return; stopLookInertia(); stopAutoTour(false); engaged = true; dismissHint(true); state.zoom = clamp(state.zoom / 0.88, 0.55, 1.3); applyCamera(); });
    ui.root.addEventListener('pointerdown', event => {
      dismissHint(true);
      if (autoTimer && !ui.autoTour.contains(event.target)) stopAutoTour(false);
    }, true);
    ui.root.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (fpLightbox && !fpLightbox.hidden) { event.preventDefault(); closeFpLightbox(); }
      else if (autoTimer) { event.preventDefault(); stopAutoTour(true); }
      else if (!ui.viewBar.hidden) { event.preventDefault(); toggleViewControls(false); ui.viewToggle.focus?.(); }
      else if (!ui.end.hidden) { event.preventDefault(); hideEnd(); }
      else if (!ui.stopsPanel.hidden) { event.preventDefault(); togglePanel(ui.stopsPanel, ui.stopsToggle, false); }
      else if (!ui.aboutPanel.hidden) { event.preventDefault(); togglePanel(ui.aboutPanel, ui.about, false); }
      else if (!ui.map.hidden) { event.preventDefault(); toggleMap(false); ui.mapToggle.focus?.(); }
    });
    const escapeFull = event => {
      if (!pseudo) return;
      if (event.key === 'Escape') { event.preventDefault(); setPseudo(false); }
      else if (event.key === 'Tab') {
        const controls = pseudoControls();
        const first = controls[0] || ui.full, last = controls[controls.length - 1] || first;
        const active = document.activeElement;
        if (!controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', escapeFull);
    ui.prev.addEventListener('click', () => goToStop(stepStop(hereStop(), -1, manifest.stops.length)));
    ui.next.addEventListener('click', () => goToStop(stepStop(hereStop(), 1, manifest.stops.length)));
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
    function usableFocus(node) {
      if (!node || !document.body.contains(node) || node.disabled || typeof node.focus !== 'function') return false;
      for (let part = node; part; part = part.parentNode) {
        if (part.hidden || part.hasAttribute?.('inert') || part.getAttribute?.('aria-hidden') === 'true') return false;
      }
      return !node.getClientRects || node.getClientRects().length > 0;
    }
    function pseudoControls() {
      return [...stage.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter(node => usableFocus(node) && (node.getAttribute('tabindex') === null || Number(node.getAttribute('tabindex')) >= 0));
    }
    function containPseudoFocus(event) {
      if (!pseudo) return;
      if (stage.contains(event.target) && usableFocus(event.target)) { pseudo.focus = event.target; return; }
      const target = usableFocus(pseudo.focus) ? pseudo.focus : pseudoControls()[0] || ui.full;
      target.focus();
    }
    function setPseudo(on) {
      if (on === (pseudo !== null)) return;
      const root = document.documentElement;
      if (on) {
        pseudo = { style: stage.getAttribute('style'), overflow: root.style.overflow,
          previousFocus: document.activeElement, focus: null, background: [] };
        Object.assign(stage.style, { position: 'fixed', top: '0', right: '0', bottom: '0', left: '0', width: '100vw', height: '100vh',
          maxWidth: 'none', minHeight: '0', margin: '0', borderRadius: '0', zIndex: '2147483000' });
        stage.style.height = '100dvh'; // kept at 100vh where dvh is unknown
        stage.classList.add('v2-filled'); // the stylesheet keeps the controls inside the safe area
        root.style.overflow = 'hidden';
        document.addEventListener('focusin', containPseudoFocus);
        if (!stage.contains(document.activeElement) || !usableFocus(document.activeElement)) ui.full.focus();
        pseudo.focus = document.activeElement;
        // Isolate siblings at every ancestor level, keeping the stage's own
        // branch available. Attribute values are restored exactly on exit.
        for (let branch = stage; branch.parentNode; branch = branch.parentNode) {
          for (const node of branch.parentNode.children) {
            if (node === branch) continue;
            pseudo.background.push({ node, inert: node.getAttribute('inert'), hidden: node.getAttribute('aria-hidden') });
            node.setAttribute('inert', '');
            node.setAttribute('aria-hidden', 'true');
          }
          if (branch.parentNode === document.body) break;
        }
      } else {
        const previousFocus = pseudo.previousFocus;
        if (pseudo.style === null) stage.removeAttribute('style'); else stage.setAttribute('style', pseudo.style);
        stage.classList.remove('v2-filled');
        root.style.overflow = pseudo.overflow;
        for (const { node, inert, hidden } of pseudo.background) {
          if (inert === null) node.removeAttribute('inert'); else node.setAttribute('inert', inert);
          if (hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden);
        }
        pseudo = null;
        document.removeEventListener('focusin', containPseudoFocus);
        if (usableFocus(previousFocus)) previousFocus.focus();
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
    // Under 288 px (a frame narrower than a 320 px phone's own page) the bar has room for five controls,
    // not six: the map, which would cover most of so small a view, gives way to Full screen.
    function syncBarHeight() {
      if (!ui.bar || ui.bar.hidden) return;
      const h = ui.bar.offsetHeight || ui.bar.clientHeight || 0;
      if (h) {
        ui.root.style?.setProperty?.('--v2-bar', h + 'px');
        ui.end?.style?.setProperty?.('--v2-bar', h + 'px');
      }
    }
    function fitBar() {
      const narrow = stage.clientWidth > 0 && stage.clientWidth < 288 && !isFull();
      if (narrow && !ui.map.hidden) toggleMap(false);
      ui.mapToggle.hidden = narrow;
      ui.autoTour.hidden = narrow || manifest.stops.length < 2;
      if (narrow && !ui.viewBar.hidden) toggleViewControls(false);
      ui.viewToggle.hidden = narrow;
      const compactHeight = stage.clientHeight > 0 && stage.clientHeight <= 300 && !isFull();
      ui.roomsBar.hidden = roomPills.length < 2 || compactHeight;
      pillsMore();
      syncBarHeight();
    }
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('webkitfullscreenchange', fullscreenChanged);

    let hintTimer = null;
    // The hint goes after nine seconds or on the first move. Only a real press, drag or key marks it as
    // seen: someone who looked away while it timed out sees it again next time.
    function dismissHint(byUser = false) {
      if (ui.hint.hidden) return;
      ui.hint.hidden = true;
      clearTimeout(hintTimer);
      if (!byUser) return;
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* per-viewer convenience only */ }
    }
    function offerHint() {
      let seen = false;
      try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { seen = false; }
      if (seen) return;
      if (stage.clientHeight < 420 || stage.clientWidth < 360) {
        // A small frame on someone else's page has no room for a hint over the room (About has the controls);
        // a phone's own page gets the one-line version.
        if (framed) return;
        ui.hint.textContent = 'Drag to look. Tap a circle to move.';
        ui.hint.classList.add('v2-hint-short');
      }
      ui.hint.hidden = false;
      hintTimer = setTimeout(() => dismissHint(false), 9000);
    }

    // ----- rendering, loading phases and frame pacing -----
    stats = { api, kind: profile.kind, budget: governor.state.budget, pixelRatio: governor.state.pixelRatio, saveData, frames: [], changes: [] };
    if (chunked) stats.rooms = []; // per room change: the chunk and how long "Loading this room…" showed
    if (hasPanos) {
      stats.pano = { mode: 'loading', opacity: 0, splatPaused: false, loaded: 0, failed: 0 };
      syncPano();
    }
    function onStopTransition(index, starting) {
      if (!hasPanos) return;
      if (starting) {
        clearTimeout(panoMoveTimer);
        panoMoveTimer = null;
        if (manifest.stops[index]?.pano) ensurePano(index);
        currentPanoOpacity = 0;
        if (!reduced()) {
          panoMoving = true;
          syncPano();
        }
        return;
      }
      if (reduced()) {
        panoMoving = false;
        syncPano();
        return;
      }
      panoMoveTimer = setTimeout(() => {
        panoMoveTimer = null;
        if (torndown) return;
        panoMoving = false;
        syncPano();
      }, PANO_FADE_MS);
    }

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
      item.asset.on('error', sceneFailed);
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
      if (state.stop >= 0) engagementStop(manifest.stops[state.stop]?.id || null);
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
        // The first pass reports its files: a bar under the poster, so a slow connection is seen to be moving.
        if (loadingCount > 0) {
          maxLoading = Math.max(maxLoading, loadingCount);
          ui.progress.hidden = false;
          // The last part of the one bar: the engine reading what was fetched.
          ui.progress.classList.remove('v2-progress-wait');
          setProgress(0.85 + 0.15 * (maxLoading - loadingCount) / maxLoading);
        }
        if (!frameReady || loadingCount > 0) return;
        // Data served from cache may never show as loading; a settled second of frames will do.
        if (!sawLoading && ++readyFrames < 30) return;
        phase = 'detail';
        mark('first-3d');
        ready = true;
        const willJump = (resume && Number.isInteger(resume.stop) && resume.stop >= 0 && resume.stop < manifest.stops.length && resume.stop !== state.stop)
          || asked !== state.stop;
        // The opening stop is an arrival too, once there is something to look at (unless immediately jumping to the asked/resumed stop).
        if (!willJump) {
          engagementStop(manifest.stops[state.stop >= 0 ? state.stop : manifest.start]?.id || null);
          if (state.stop >= 0) announceActivity('veylet:stop', { stop: state.stop, room: stopLabel(manifest, state.stop).room || null });
          tellStop(state.stop);
        }
        hideSlow();
        maxLoading = 0;
        // The canvas shows from here (tour-player-v2.css): until now the poster stayed on top of it.
        ui.root.dataset.state = 'ready';
        ui.canvas.hidden = false;
        ui.bar.hidden = false;
        fitBar();
        // From here the status hangs from the top edge of the controls (tour-player-v2.css), so no row of room
        // names, wrapped or not, can cover it.
        ui.bar.append(ui.status);
        ui.status.textContent = saveData ? '' : 'Sharpening detail…';
        ui.progress.hidden = saveData;
        ui.progress.classList.remove('v2-progress-wait');
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
        syncPano();
        settle({ readiness: 'viewer-ready', marks, stats });
        // Back where the visitor was before the graphics context was lost.
        if (resume && Number.isInteger(resume.stop) && resume.stop >= 0 && resume.stop < manifest.stops.length && resume.stop !== state.stop) goToStop(resume.stop, false);
        else if (asked !== state.stop) goToStop(asked, false, { yaw: askedView.yaw, pitch: askedView.pitch });
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
          syncPano();
        }
      }
    });
    continuous++; // stream the first levels continuously; released when detail completes
    app.on('update', () => {
      const now = performance.now();
      if ((continuous > 0 && !splatPaused) || benchmark) requestRender();
      if (benchmark) {
        const through = Math.min(now, benchmark.until);
        state.yaw += benchmark.degreesPerSecond * Math.max(0, through - benchmark.last) / 1000;
        benchmark.last = through;
        applyCamera();
        if (now >= benchmark.until) { const done = benchmark.done; benchmark = null; done(); }
      }
    });
    app.on('postrender', () => {
      const now = performance.now();
      if (lastRender && (continuous > 0 || benchmark)) {
        const frameMs = now - lastRender;
        stats.frames.push(frameMs);
        if (stats.frames.length > 600) stats.frames.shift();
        const change = (phase === 'complete' || benchmark) ? governor.sample(frameMs, now) : null;
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
      lastRender = (continuous > 0 || benchmark) ? now : 0;
    });
    const observer = new ResizeObserver(() => {
      fitBar();
      posterSpec = ready ? posterFor(manifest, aspect()) : posterSpec;
      app.updateCanvasSize();
      applyCamera();
    });
    observer.observe(stage);
    // A lost graphics context (iOS reclaims it when another app opens) usually comes back: wait 5 s of visible
    // time for the restore before giving up. The engine itself restores its resources. A final loss keeps the
    // visitor's stop for Try again, which comes back one budget level lower (RESUME_KEY).
    let lostWait = null;
    const lost = event => {
      event?.preventDefault?.();
      if (lostWait || torndown) return;
      ui.status.textContent = 'Restoring 3D…';
      lostWait = visibleDeadline(() => {
        lostWait = null;
        if (torndown) return;
        try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ base, stop: state.stop })); } catch { /* the retry starts at the opening stop */ }
        fail('context-lost');
      }, 5000);
    };
    const restored = () => {
      if (!lostWait) return;
      lostWait();
      lostWait = null;
      if (ui.status.textContent === 'Restoring 3D…') ui.status.textContent = '';
      requestRender();
    };
    device.on?.('devicelost', lost);
    device.on?.('devicerestored', restored);
    ui.canvas.addEventListener('webglcontextlost', lost);
    ui.canvas.addEventListener('webglcontextrestored', restored);
    const visibility = () => { if (document.hidden) stopLookInertia(); else requestRender(); };
    document.addEventListener('visibilitychange', visibility);

    buildRoomPills();
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
    if (chunked) for (const item of held.values()) item.asset.on('error', sceneFailed);
    else asset.on('error', sceneFailed);
    // Keep the first frame unobstructed so the walkthrough owns the screen; visitors open the map on demand.
    toggleMap(false);
    fitBar();

    const originalDestroy = app.destroy.bind(app);
    viewer = {
      destroy() {
        engagementStop(null);
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
      // goToStop(index): jumps to that stop. tapAt(): what a tap on the scene does: shows the hint, never moves.
      goToStop, tapAt,
      /*
       * Where the viewer stands and looks, read by the page when it wants it (no timer and no network here).
       * null until the first 3D frame. stop: the stop stood on (0-based).
       * Angles are degrees in the tour package's own frame (right-handed, Y up), exactly as lookAngles() gives them:
       * yaw 0 looks along -Z (up on the floor map before its turn); yaw grows turning LEFT, anticlockwise seen
       * from above, so yaw 90 looks along -X, 180 along +Z and 270 along +X. Given here as 0 <= yaw < 360.
       * pitch 0 is level, positive looks up, negative down (-80..80).
       */
      view: () => (ready ? { stop: state.stop, yaw: ((state.yaw % 360) + 360) % 360, pitch: state.pitch } : null),
      currentView: () => (ready ? {
        stop: visitNumber(manifest, hereStop()),
        count: manifest.stops.length,
        yaw: ((state.yaw % 360) + 360) % 360 || 0,
        pitch: state.pitch || 0,
      } : null),
      // For QA and measurement: the camera state and where each stop's floor disc projects.
      inspect: () => {
        const discs = manifest.stops.map(stop => { world.set(...stop.floor); camera.camera.worldToScreen(world, screen); return [screen.x, screen.y, screen.z]; });
        return { state: { ...state, position: [...state.position] }, discs, ready, move: lastMove && { ...lastMove, moving: false } };
      },
      benchmark(seconds = 5, degreesPerSecond = 30) {
        stopLookInertia();
        if (hasPanos) setSplatPaused(false);
        stats.frames = [];
        return new Promise(resolve => {
          const now = performance.now();
          lastRender = now;
          benchmark = { until: now + seconds * 1000, last: now, degreesPerSecond, done: () => resolve(controller.stats()) };
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
    resolveBase, validateManifest, deviceProfile, createGovernor, stopLabel, visitNumber, stopAtNumber, roomFootprint, stepStop, lookAngles, forwardOf,
    stepLookInertia,
    fieldOfView, posterFor, decodeWalkable, corridorRoute, nearestStop, medianFps, detailLevel, storeysOf, levelAt,
    chunkHops, chunkPlan, chunkAt, finestChunkLevel,
    parseViewHash, roomsFromManifest, panoBlendState, PANO_FADE_MS,
    start, mount, current: null,
    currentView: () => (window.VeyletPlayerV2.current ? window.VeyletPlayerV2.current.currentView() : null),
  };
})();
