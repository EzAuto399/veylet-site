/*
 * Render status on /account (the sibling repository's
 * docs/render-status-contract-20260925.md). Each space says where its capture is,
 * in the contract's words, from list_workspace_render_status as migration
 * 20260925110000_render_status.sql answers it ({ active, spaces: [{ property_id, job }] },
 * not yet released); the filled action is the reader's only when it is their turn; a
 * change of state or step is said once in a live region; the desk reads again every
 * 10 s only while the answer says a capture is active; and nothing is shown that the
 * server did not send.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const account = fs.readFileSync(path.join(__dirname, '../dist/account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(__dirname, '../dist/tour-sharing.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.className = ''; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelector() { return null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  // What a person sees: nothing inside a hidden element.
  shown() { return this.children.filter(child => !child.hidden).flatMap(child => [child, ...child.shown()]); }
  click() {} focus() { this.wasFocused = true; } scrollIntoView() { this.wasScrolled = true; } select() {} reset() {}
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

async function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  const renderTimers = new Set(), deskTimers = new Set(), skeletonTimers = new Set(), documentEvents = {};
  const scheduleTimeout = (fn, ms) => {
    // The render poll, the desk's own 45 s recheck and the 400 ms skeleton delay are
    // fired by hand; request timeouts never fire in these tests.
    const timer = { fire: fn, ms };
    if (ms === 10000) renderTimers.add(timer); else if (ms === 45000) deskTimers.add(timer); else if (ms === 400) skeletonTimers.add(timer);
    return timer;
  };
  const cancelTimeout = timer => { renderTimers.delete(timer); deskTimers.delete(timer); skeletonTimers.delete(timer); };
  const calls = [], queries = [];
  const user = { id: 'user-1', email: 'person@example.invalid' };
  const table = {
    properties: { data: options.properties || [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }] },
    tours: { data: options.tours || [] },
    memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 'token-1' } } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signOut: async () => ({}),
    },
    from(name) {
      queries.push(name);
      const answer = () => (typeof table[name] === 'function' ? table[name]() : table[name]);
      const builder = { select() { return builder; }, order() { return builder; }, eq() { return builder; },
        single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
        then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc?.[name]) return options.rpc[name](args);
      // An array is the jobs, answered as the server does; any other object is the whole reply.
      if (name === 'list_workspace_render_status') {
        const reply = typeof options.status === 'function' ? options.status(args) : options.status;
        return Array.isArray(reply) || reply === undefined ? { data: answer(reply || [], table.properties.data) } : reply;
      }
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      if (['get_pack_offer', 'get_trial_offer', 'get_express_offer', 'get_members_annual_offer', 'get_referral_code'].includes(name)) return { error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (name === 'get_tour_review') return { data: [{ approved: Boolean(options.approved) }] };
      if (name === 'get_tour_review_target') { const tour = table.tours.data.find(row => row.id === args.p_tour_id); return { data: [{ tour_id: tour?.id, storage_path: tour?.storage_path, package_revision: 'a'.repeat(64) }] }; }
      return { data: null };
    },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, VEYLET_HOOKS: { url: 'https://hooks.example.invalid' }, addEventListener() {} };
  const documentStub = { hidden: false, activeElement: null, getElementById: id => ids[id], createElement: tag => new Element(tag),
    addEventListener: (name, handler) => { documentEvents[name] = handler; }, head: { append() {} } };
  const context = { window, document: documentStub, Date, URL, URLSearchParams, navigator: {},
    location: { pathname: '/account', search: '', replace() {}, assign() {} },
    setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { get() { return ''; } }, Blob: class {} };
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(account, context);
  await settle();
  const h = {
    ids, calls, queries, table, supabase, documentStub, documentEvents,
    reads: () => calls.filter(([name]) => name === 'list_workspace_render_status').length,
    renderTimers: () => renderTimers.size,
    async slow() { const timers = [...skeletonTimers]; skeletonTimers.clear(); for (const timer of timers) timer.fire(); await settle(); },
    async poll() { const timers = [...renderTimers]; renderTimers.clear(); for (const timer of timers) timer.fire(); await settle(); },
    spaces: () => ids['account-properties'].children.filter(el => el.className === 'dash-space'),
    slot: (index = 0) => h.spaces()[index].children.find(el => el.className === 'dash-render'),
    block: (index = 0) => h.slot(index).children[0],
    lines: (index = 0) => h.slot(index).shown().filter(el => ['render-line', 'render-note', 'render-express', 'render-how'].includes(el.className)).map(el => el.textContent),
    title: (index = 0) => h.slot(index).all().find(el => el.className === 'render-title')?.textContent,
    pills: (index = 0) => h.slot(index).all().filter(el => /^pill\b/.test(el.className)).map(el => el.textContent),
    controls: (index = 0) => h.slot(index).shown().filter(el => el.tagName === 'BUTTON' || el.tagName === 'A'),
    filled: (index = 0) => h.slot(index).shown().filter(el => /\btour-action-primary\b/.test(el.className)).map(el => el.textContent),
    progress: (index = 0) => h.slot(index).all().find(el => el.tagName === 'PROGRESS') || null,
    text: (index = 0) => h.slot(index).shown().map(el => el.textContent).join('\n'),
    live: () => ids['account-render-live'].textContent,
    async hide(hidden) { documentStub.hidden = hidden; documentEvents.visibilitychange(); await settle(); },
  };
  return h;
}

// One capture as the server answers it (capture_render_status_json), and the whole
// answer: every space with its latest capture or none, and whether anything is active.
const JOB = 'a1b2c3d4-0000-4000-8000-000000000001';
const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
const job = (fields = {}) => ({ job_id: JOB, property_id: 'p1', state: 'waiting', status: 'queued', queue_position: null,
  typical_start_minutes: null, step: null, steps_total: 5, step_label: null, stage: null, progress_pct: null, eta_seconds: null,
  eta_at: null, heartbeat_at: null, stale: false, attempt: null, attempts_allowed: 2, recapture: null, tour_id: null,
  express: false, express_due_at: null, created_at: ago(3600), updated_at: ago(5), ...fields });
function answer(jobs, properties = [{ id: 'p1' }], active) {
  return { workspace_id: 'w1', generated_at: new Date().toISOString(),
    active: active ?? jobs.some(entry => ['uploading', 'queued', 'processing'].includes(entry.status)), poll_seconds: 10,
    spaces: properties.map(row => ({ property_id: row.id, job: jobs.find(entry => entry.property_id === row.id) || null })) };
}
const JOBS = {
  uploading: job({ state: 'uploading', status: 'uploading' }),
  waiting: job({ state: 'waiting', status: 'queued', queue_position: 2, typical_start_minutes: 40 }),
  rendering: job({ state: 'rendering', status: 'processing', step: 3, step_label: 'Building your 3D walkthrough', stage: 'train',
    progress_pct: 64, eta_seconds: 720, heartbeat_at: ago(10), attempt: 1 }),
  studio_check: job({ state: 'studio_check', status: 'awaiting_review' }),
  ready: job({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1' }),
  live: job({ state: 'live', status: 'awaiting_review', tour_id: 't1' }),
  recapture: job({ state: 'needs_recapture', status: 'awaiting_review', recapture: { room: 'Kitchen', reason: 'too dark to line up the photos.' } }),
  retrying: job({ state: 'retrying', status: 'queued', attempt: 2, queue_position: 1, typical_start_minutes: 20 }),
  failed: job({ state: 'failed', status: 'failed' }),
  stale: job({ state: 'rendering', status: 'processing', step: 3, stage: 'train', progress_pct: 64, eta_seconds: 420, heartbeat_at: ago(300), stale: true, attempt: 1 }),
};
const RECAPTURE_ALLOWANCE = 'This failed attempt uses no walkthrough. A later accepted new capture uses one. Only a correction or reprocessing of the same walkthrough, or a permitted whole recapture containing every original room, keeps the same link and uses no extra walkthrough. A partial named-room recapture is not a waiver.';
const readyTour = (fields = {}) => ({ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null, ...fields });
const toursFor = state => state === 'ready' ? [readyTour()] : state === 'live' ? [readyTour({ share_token: 'abcdefghijklmnop' })] : [];
const withState = (state, options = {}) => load({ status: [JOBS[state]], tours: toursFor(state), approved: state === 'live', ...options });

const WORDS = {
  uploading: ['Uploading', 'Sending from your phone', ['Sending from Veylet Capture. Keep Veylet open or plugged in; it continues in the background.']],
  waiting: ['Waiting to render', 'Automatic', ['You’re 2nd in line. Usually starts within 40 minutes.']],
  rendering: ['Rendering', 'Automatic', ['Step 3 of 5: Building your 3D walkthrough. About 12 minutes left.']],
  ready: ['Ready for your review', 'Your turn', ['Open it, walk through, then approve to share.']],
  live: ['Live', null, ['Anyone with the link can open it.']],
  recapture: ['Needs recapture', 'Your turn', ['Kitchen: too dark to line up the photos.', RECAPTURE_ALLOWANCE]],
  retrying: ['Retrying', 'Automatic', ['Rendering hit a snag; we’re retrying automatically (attempt 2 of 2).']],
  failed: ['Failed', 'Veylet support', ['Something went wrong on our side. Veylet support has been told; nothing was used.']],
  stale: ['Still working — checking in', 'Automatic', ['The render hasn’t checked in for a few minutes. Veylet support has been alerted. Nothing for you to do.',
    'Last reported: step 3 of 5, Building your 3D walkthrough.']],
};

test('render status: every state reads in the contract’s words, with whose turn it is', async () => {
  for (const [state, [title, turn, lines]] of Object.entries(WORDS)) {
    const h = await withState(state);
    assert.deepEqual({ ...h.calls.find(([name]) => name === 'list_workspace_render_status')[1] }, { p_workspace_id: 'w1' });
    assert.equal(h.slot().hidden, false, state);
    assert.equal(h.block().dataset.state, state, state);
    assert.equal(h.title(), title, state);
    assert.deepEqual(h.pills(), turn ? [turn] : [], state);
    assert.deepEqual(h.lines(), lines, state);
  }
  // The five steps, in order: done, the current one, then the rest.
  const h = await withState('rendering');
  const steps = h.slot().all().filter(el => el.tagName === 'LI' && el.dataset.step);
  assert.deepEqual(steps.map(el => [el.dataset.step, el.all().find(child => child.className === 'render-step-label').textContent]), [
    ['done', 'Preparing photos'], ['done', 'Lining up camera positions'], ['current', 'Building your 3D walkthrough'],
    ['next', 'Packing it for phones'], ['next', 'Checking quality']]);
  assert.equal(steps[2].attributes['aria-current'], 'step');
  assert.deepEqual(steps.map(el => el.all().some(child => child.className === 'render-sr' && child.textContent === ' (done)')), [true, true, false, false, false]);
  assert.equal(h.progress().value, 64);
  assert.equal(h.progress().attributes['aria-label'], 'Render progress');
  assert.equal(h.slot().all().find(el => el.className === 'render-pct').textContent, '64%');
  // The migration sends no upload percentage; if a later answer does, it reads "{n}% sent."
  const upload = await load({ status: [job({ state: 'uploading', status: 'uploading', progress_pct: 42 })] });
  assert.deepEqual(upload.lines(), ['42% sent. Keep Veylet open or plugged in; it continues in the background.']);
  assert.equal(upload.progress().value, 42);
  assert.equal(upload.progress().attributes['aria-label'], 'Upload progress');
});

test('render status: the filled action belongs to whoever acts next', async () => {
  const filled = { ready: ['Review walkthrough'], recapture: ['Recapture Kitchen'] };
  for (const state of Object.keys(WORDS)) {
    const h = await withState(state);
    assert.deepEqual(h.filled(), filled[state] || [], state);
  }
  // Failed: Veylet support acts next, so contacting it is quiet, never filled.
  const broken = await withState('failed');
  const contact = broken.controls()[0];
  assert.equal(contact.textContent, 'Contact Veylet support');
  assert.equal(contact.className, 'tour-action');
  assert.match(contact.href, /^mailto:yoda@yodalai\.xyz\?subject=Veylet%20render%20%C2%B7%20capture%20a1b2c3d4&body=/);
  // An operator cannot approve: the owner's turn, and nothing for the operator to press.
  const operator = await withState('ready', { role: 'operator' });
  assert.equal(operator.title(), 'Ready for review', '“your review” is said to whoever reviews');
  assert.deepEqual(operator.pills(), ['With the workspace owner']);
  assert.deepEqual(operator.lines(), ['The workspace owner opens it, walks through, then approves it to share.']);
  assert.deepEqual(operator.filled(), []);
  assert.equal(operator.controls().length, 0);
  // Waiting, rendering (the quality check included), retrying, stale and live offer nothing to press.
  for (const state of ['uploading', 'waiting', 'rendering', 'studio_check', 'retrying', 'stale', 'live']) {
    assert.equal((await withState(state)).controls().length, 0, state);
  }
});

test('render status: Review walkthrough opens that walkthrough’s check below it', async () => {
  const h = await withState('ready');
  const review = h.controls().find(el => el.textContent === 'Review walkthrough');
  await review.fire('click');
  const card = h.spaces()[0].all().find(el => el.dataset.tour === 't1');
  const details = card.all().find(el => el.tagName === 'DETAILS' && el.className === 'tour-review');
  assert.equal(details.open, true);
  assert.equal(details.children[0].wasFocused, true, 'focus lands on the check');
  assert.equal(h.calls.some(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)), false, 'opening approves nothing');
  // The next step names the same press in the same words.
  assert.equal(h.ids['account-next-step'].children.find(el => el.tagName === 'BUTTON').textContent, 'Review walkthrough');
  // Approved but not yet shared (the server still says ready_for_review): the card below owns the next step.
  const approved = await load({ status: [JOBS.ready], tours: [readyTour()], approved: true });
  assert.equal(approved.slot().hidden, true);
});

test('render status: a change of state or step is said once in a polite live region; the percentage is not', async () => {
  const live = markup.match(/<p id="account-render-live"[^>]*>/)[0];
  assert.match(live, /role="status"/);
  assert.match(live, /aria-live="polite"/);
  assert.match(live, /aria-atomic="true"/);
  const rendering = fields => job({ state: 'rendering', status: 'processing', heartbeat_at: ago(5), attempt: 1, ...fields });
  const answers = [
    [rendering({ step: 3, progress_pct: 50, eta_seconds: 600 })],
    [rendering({ step: 3, progress_pct: 60, eta_seconds: 480 })],
    [rendering({ step: 4, progress_pct: 88, eta_seconds: 120 })],
    [job({ state: 'studio_check', status: 'awaiting_review' })],
  ];
  let reads = 0;
  const h = await load({ status: () => answers[Math.min(reads++, answers.length - 1)] });
  assert.equal(h.live(), '', 'the first read is the page itself, not news');
  await h.poll();
  assert.equal(h.lines()[0], 'Step 3 of 5: Building your 3D walkthrough. About 8 minutes left.');
  assert.equal(h.live(), '', 'a new percentage or time left is not announced');
  await h.poll();
  assert.equal(h.live(), 'Sample space: Rendering, step 4 of 5: Packing it for phones.');
  await h.poll();
  // An older backend's studio_check is the automatic quality gate: step 5, never a person.
  assert.equal(h.live(), 'Sample space: Rendering, step 5 of 5: Checking quality.');
  // Every announcement also reads on the space itself.
  assert.equal(h.title(), 'Rendering');
});

test('render status: an older backend’s studio_check reads as Rendering, step 5 of 5: Checking quality, with nothing it did not send', async () => {
  const h = await withState('studio_check');
  assert.equal(h.block().dataset.state, 'rendering');
  assert.equal(h.title(), 'Rendering');
  assert.deepEqual(h.pills(), ['Automatic']);
  assert.deepEqual(h.lines(), ['Step 5 of 5: Checking quality.']);
  assert.equal(h.progress(), null, 'no percentage the server did not send');
  const steps = h.slot().all().filter(el => el.tagName === 'LI' && el.dataset.step);
  assert.deepEqual(steps.map(el => el.dataset.step), ['done', 'done', 'done', 'done', 'current']);
  assert.equal(steps[4].attributes['aria-current'], 'step');
  assert.doesNotMatch(h.slot().all().map(el => el.textContent).join(' '), /studio|a person|business day|left\./i);
  assert.equal(h.controls().length, 0);
});

test('render status: reads every 10 s while the answer says a capture is active, and stops when none is, the tab hides or the account signs out', async () => {
  let current = [JOBS.uploading];
  const h = await load({ status: () => current });
  assert.equal(h.reads(), 1);
  assert.equal(h.renderTimers(), 1, 'uploading keeps the desk reading');
  const tourReads = h.queries.filter(name => name === 'tours').length;
  await h.poll();
  assert.equal(h.reads(), 2);
  assert.equal(h.queries.filter(name => name === 'tours').length, tourReads, 'a poll reads status only, never the whole desk');
  assert.equal(h.renderTimers(), 1);
  // Hidden: the next read is cancelled; back: it reads at once and carries on.
  await h.hide(true);
  assert.equal(h.renderTimers(), 0);
  assert.equal(h.reads(), 2);
  await h.hide(false);
  assert.equal(h.reads(), 3, 'coming back reads now rather than waiting');
  assert.equal(h.renderTimers(), 1);
  // A read that finishes while the tab is hidden schedules nothing.
  h.documentStub.hidden = true;
  await h.poll();
  assert.equal(h.renderTimers(), 0);
  h.documentStub.hidden = false;
  // Nothing active (an older backend's quality check, the reader's turn, or finished): no more reads.
  for (const state of ['studio_check', 'failed', 'recapture', 'live']) {
    current = [JOBS[state]];
    await h.hide(false);
    assert.equal(h.renderTimers(), 0, state);
  }
  for (const state of ['waiting', 'rendering', 'retrying', 'stale']) {
    current = [JOBS[state]];
    await h.hide(false);
    assert.equal(h.renderTimers(), 1, state);
  }
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.renderTimers(), 0, 'signing out stops the reads');
  assert.equal(h.live(), '');
  // The server's active flag decides: another capture of the workspace still uploading
  // keeps the desk reading while this space waits on its check, and a server that says
  // nothing is active is believed.
  const other = await load({ status: () => ({ data: answer([JOBS.studio_check], [{ id: 'p1' }], true) }) });
  assert.equal(other.renderTimers(), 1);
  const quiet = await load({ status: () => ({ data: answer([JOBS.rendering], [{ id: 'p1' }], false) }) });
  assert.equal(quiet.renderTimers(), 0);
  // An answer without the flag falls back to the states on the desk.
  const unflagged = await load({ status: () => ({ data: { spaces: [{ property_id: 'p1', job: JOBS.rendering }] } }) });
  assert.equal(unflagged.renderTimers(), 1);
});

test('render status: a failed refresh keeps the last update, says so, and stops after three', async () => {
  let reads = 0;
  const h = await load({ status: () => (reads++ === 0 ? [JOBS.rendering] : { error: { message: 'offline' } }) });
  const said = h.ids['account-render-status'];
  assert.equal(said.hidden, true);
  await h.poll();
  assert.equal(h.title(), 'Rendering', 'the last update stays');
  assert.equal(said.hidden, false);
  assert.match(said.textContent, /^Render progress couldn’t be refreshed\. Showing the update from .+; trying again\.$/);
  assert.equal(h.renderTimers(), 1);
  await h.poll();
  await h.poll();
  assert.match(said.textContent, /^Render progress couldn’t be refreshed\. Showing the update from .+\. Refresh spaces to try again\.$/);
  assert.equal(h.renderTimers(), 0, 'three failures in a row stop the reads');
  // An answer that is not the server's shape is unreadable, never an empty space.
  for (const data of [[JOBS.rendering], { spaces: 'none' }, { spaces: [{ property_id: 'p1', job: 'rendering' }] }, null]) {
    const odd = await load({ status: { data } });
    assert.equal(odd.slot().hidden, true);
    assert.match(odd.ids['account-render-status'].textContent, /^Render progress couldn’t be checked\./);
  }
});

test('render status: nothing is shown that the server did not send', async () => {
  const rendering = fields => job({ state: 'rendering', status: 'processing', heartbeat_at: ago(5), attempt: 1, ...fields });
  // No step, percentage or time left: no step list, no bar, no "About".
  const bare = await load({ status: [rendering()] });
  assert.deepEqual(bare.lines(), ['Your walkthrough is being built.']);
  assert.equal(bare.progress(), null);
  assert.doesNotMatch(bare.text(), /Step|%|About|\d/);
  // A stage the server could not place has no step; the page never maps one itself.
  const staged = await load({ status: [rendering({ stage: 'train' })] });
  assert.doesNotMatch(staged.text(), /Step/);
  // Malformed values are left out rather than rounded, clamped or guessed.
  for (const value of [140, -1, 12.5, '50', null]) {
    const h = await load({ status: [rendering({ step: 9, progress_pct: value, eta_seconds: '600' })] });
    assert.equal(h.progress(), null, String(value));
    assert.deepEqual(h.lines(), ['Your walkthrough is being built.'], String(value));
    assert.equal(h.slot().all().some(el => el.tagName === 'OL'), false, 'a step outside 1 to 5 has no step list');
  }
  // A percentage alone is shown alone.
  const pctOnly = await load({ status: [rendering({ progress_pct: 30 })] });
  assert.equal(pctOnly.progress().value, 30);
  assert.doesNotMatch(pctOnly.text(), /Step|About/);
  // Waiting and uploading without their numbers.
  assert.deepEqual((await load({ status: [job()] })).lines(), ['Your capture is in line.']);
  assert.deepEqual((await load({ status: [job({ typical_start_minutes: 1 })] })).lines(), ['Usually starts within 1 minute.']);
  const sending = await load({ status: [JOBS.uploading] });
  assert.equal(sending.progress(), null);
  assert.doesNotMatch(sending.text(), /%/);
  // A retry without an attempt the page can stand behind keeps its words and drops the number.
  for (const attempt of [null, 3, 0]) {
    assert.deepEqual((await load({ status: [job({ state: 'retrying', attempt })] })).lines(), ['Rendering hit a snag; we’re retrying automatically.'], String(attempt));
  }
  // An unchanged answer is not redrawn, so nothing moves between reads.
  const h = await withState('rendering');
  const before = h.block();
  await h.poll();
  assert.equal(h.block(), before);
  // Time left is the server's, rounded up to the minute; hours read as hours.
  assert.equal((await load({ status: [rendering({ step: 5, eta_seconds: 20 })] })).lines()[0], 'Step 5 of 5: Checking quality. About 1 minute left.');
  assert.equal((await load({ status: [rendering({ step: 2, eta_seconds: 3900 })] })).lines()[0], 'Step 2 of 5: Lining up camera positions. About 1 hour 5 minutes left.');
  // Ordinals read as a place in line.
  for (const [position, words] of [[1, '1st'], [3, '3rd'], [11, '11th'], [22, '22nd']]) {
    assert.equal((await load({ status: [job({ queue_position: position })] })).lines()[0], 'You’re ' + words + ' in line.');
  }
});

test('render status: a render the server marks stale reads Still working — checking in', async () => {
  // The server decides stale (3 minutes without a report), so this page's clock never does.
  const quiet = await load({ status: [job({ ...JOBS.rendering, heartbeat_at: ago(600), stale: false })] });
  assert.equal(quiet.title(), 'Rendering');
  const stale = await withState('stale');
  assert.equal(stale.title(), 'Still working — checking in');
  assert.equal(stale.progress(), null, 'a stalled render shows no live progress');
  assert.equal(stale.renderTimers(), 1, 'and keeps being checked');
  const unplaced = await load({ status: [job({ ...JOBS.stale, step: null })] });
  assert.deepEqual(unplaced.lines(), ['The render hasn’t checked in for a few minutes. Veylet support has been alerted. Nothing for you to do.']);
});

test('render status: a super fast capture shows its due time as the super fast block says it, until it passes', async () => {
  const due = new Date(Date.now() + 95 * 60000).toISOString();
  const when = new Date(due).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' });
  const sameDay = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane' }).format(new Date(due)) === new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane' }).format(new Date());
  const moment = when + (sameDay ? ' today' : ' ' + new Date(due).toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short' }));
  const order = { state: 'open', due_at: due, completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null };
  const express = { express: true, express_due_at: due };
  const h = await load({ status: [{ ...JOBS.rendering, ...express }], rpc: {
    get_express_offer: async () => ({ data: { price_cents: 2900, daily_cap: 5, taken_today: 3, full_today: false, credits_available: 0, can_order: true,
      captures: [{ job_id: JOB, property_id: 'p1', status: 'processing', ready_by: due, express: order }] } }) } });
  assert.equal(h.lines().at(-1), 'Super fast: ready by ' + moment + ', or refunded');
  const expressTitle = h.spaces()[0].all().find(el => el.className === 'express-title').textContent;
  assert.equal(expressTitle, 'Super fast · ready by ' + moment, 'the same due time, in the same words, in both places');
  for (const state of ['waiting', 'retrying', 'stale', 'studio_check']) {
    assert.equal((await load({ status: [{ ...JOBS[state], ...express }] })).lines().at(-1), 'Super fast: ready by ' + moment + ', or refunded', state);
  }
  // Past due, the super fast block says what happened; the status adds no promise.
  const late = await load({ status: [{ ...JOBS.rendering, express: true, express_due_at: new Date(Date.now() - 60000).toISOString() }] });
  assert.equal(late.lines().some(line => line.startsWith('Super fast')), false);
  // Not express, not express yet (uploading), or past its promise (a finished walkthrough): no line.
  assert.equal((await load({ status: [{ ...JOBS.rendering, express: false, express_due_at: due }] })).lines().some(line => line.startsWith('Super fast')), false);
  for (const state of ['uploading', 'ready', 'failed']) {
    assert.equal((await load({ status: [{ ...JOBS[state], ...express }], tours: toursFor(state) })).lines().some(line => line.startsWith('Super fast')), false, state);
  }
});

test('render status: loading, empty, error and a backend without the function each read as themselves', async () => {
  // Loading: a read slower than 400 ms shows the shape of what is coming, busy, in
  // place of the older line; a quick one never flashes it.
  const loading = await load({ status: () => new Promise(() => {}) });
  assert.equal(loading.slot().hidden, true, 'nothing flashes before 400 ms');
  await loading.slow();
  assert.equal(loading.slot().hidden, false);
  assert.equal(loading.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent)).hidden, true);
  assert.equal(loading.slot().attributes['aria-busy'], 'true');
  assert.equal(loading.block().className, 'render-block render-loading');
  assert.ok(loading.slot().all().some(el => el.textContent === 'Checking render progress…'));
  // A slow read that then fails gives the space its older line back.
  let reply;
  const slowFail = await load({ status: () => new Promise(resolve => { reply = resolve; }) });
  await slowFail.slow();
  reply({ error: { message: 'offline' } }); await settle();
  assert.equal(slowFail.slot().hidden, true);
  assert.equal(slowFail.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent)).hidden, false);
  // Empty: a space with no capture and no walkthrough says how one arrives, instead of the older line.
  const empty = await load({ status: [] });
  assert.deepEqual(empty.lines(), ['No capture sent yet. When you send one from Veylet Capture, its progress shows here.']);
  const older = empty.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent));
  assert.equal(older.hidden, true);
  assert.equal(empty.renderTimers(), 0);
  // A space whose walkthrough is already on the desk and has no capture says nothing extra.
  const toured = await load({ status: [], tours: [readyTour({ share_token: 'abcdefghijklmnop' })], approved: true });
  assert.equal(toured.slot().hidden, true);
  // Error: said once above the list; the spaces read as they did, never as empty.
  const broken = await load({ status: { error: { message: 'offline' } } });
  assert.equal(broken.slot().hidden, true);
  assert.equal(broken.ids['account-render-status'].hidden, false);
  assert.equal(broken.ids['account-render-status'].textContent, 'Render progress couldn’t be checked. Your spaces are below; refresh spaces to try again.');
  assert.equal(broken.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent)).hidden, false);
  assert.equal(broken.renderTimers(), 0);
  // Before the backend has the function, the desk reads exactly as it did, and a
  // skeleton timer that fires afterwards draws nothing.
  const missing = await load({ status: { error: { code: 'PGRST202', message: 'Could not find the function' } } });
  await missing.slow();
  assert.equal(missing.slot().hidden, true);
  assert.equal(missing.slot().children.length, 0);
  assert.equal(missing.ids['account-render-status'].hidden, true);
  assert.equal(missing.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent)).hidden, false);
  assert.equal(missing.renderTimers(), 0);
  // A failed tour read never lets a space read as having sent nothing.
  const h = await load({ status: [] });
  h.table.tours = { error: { message: 'offline' } };
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.equal(h.slot().hidden, true);
});

test('render status: a capture released into a walkthrough brings that walkthrough onto the desk, once', async () => {
  let current = [JOBS.rendering];
  const h = await load({ status: () => current });
  const tourReads = h.queries.filter(name => name === 'tours').length;
  current = [JOBS.ready];
  h.table.tours = { data: [readyTour()] };
  await h.poll();
  assert.equal(h.queries.filter(name => name === 'tours').length, tourReads + 1, 'the desk read its walkthroughs again');
  assert.equal(h.title(), 'Ready for your review');
  assert.deepEqual(h.filled(), ['Review walkthrough']);
  assert.equal(h.live(), 'Sample space: Ready for your review.');
  assert.ok(h.spaces()[0].all().some(el => el.dataset.tour === 't1'), 'its card is on the space');
  // A tour the account still cannot read is not asked for again and again.
  const hidden = await load({ status: [JOBS.ready] });
  const reads = hidden.queries.filter(name => name === 'tours').length;
  await hidden.hide(false); await hidden.hide(false);
  assert.ok(hidden.queries.filter(name => name === 'tours').length <= reads + 1);
});

test('render status: Recapture {room} opens that room’s steps in the app, in place', async () => {
  const h = await withState('recapture');
  const kitchen = h.controls().find(el => el.textContent === 'Recapture Kitchen');
  assert.equal(kitchen.attributes['aria-expanded'], 'false');
  const panel = h.slot().all().find(el => el.id === kitchen.attributes['aria-controls']);
  assert.equal(panel.hidden, true);
  await kitchen.fire('click');
  assert.equal(kitchen.attributes['aria-expanded'], 'true');
  assert.equal(panel.hidden, false);
  assert.equal(panel.textContent, 'On your iPhone, open Veylet Capture and choose Sample space. It shows Needs recapture there too: choose Recapture Kitchen, capture the room again and send it.');
  await kitchen.fire('click');
  assert.equal(kitchen.attributes['aria-expanded'], 'false');
  // No room named: the reason stands alone, and the space is what is captured again.
  const whole = await load({ status: [job({ ...JOBS.recapture, recapture: { room: null, reason: 'Most of the photos were blurred' } })] });
  assert.deepEqual(whole.lines(), ['Most of the photos were blurred.', RECAPTURE_ALLOWANCE]);
  assert.deepEqual(whole.filled(), ['Recapture Sample space']);
  // No reason at all: Veylet support is who can say what, so that is the reader's next move.
  const unnamed = await load({ status: [job({ ...JOBS.recapture, recapture: null })] });
  assert.deepEqual(unnamed.lines(), ['Some of it needs capturing again. Ask Veylet support what to capture.', RECAPTURE_ALLOWANCE]);
  assert.deepEqual(unnamed.filled(), ['Contact Veylet support']);
});

test('render status: the member read’s recapture ARRAY (capture_recapture_reasons) gives each room its line, its Recapture button and its fix link', async () => {
  // 20260926110000: an array of {room, reason, rule?}, one per room the gate blocked; the single object is only an older row.
  const recapture = [
    { room: 'Kitchen', reason: 'Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.', rule: 'few_views' },
    { room: 'Hallway', reason: 'We could not find a clear floor to walk on here.', rule: 'no_floor' },
    { room: null, reason: 'Something else the gate saw', rule: 'not-a-rule' },
    { room: 'Kitchen', reason: 'Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.', rule: 'few_views' },
    { room: 'Garage', reason: '' }, 'junk',
  ];
  const h = await load({ status: [job({ ...JOBS.recapture, recapture })] });
  assert.deepEqual(h.lines(), [
    'Kitchen: Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.',
    'Hallway: We could not find a clear floor to walk on here.',
    'Something else the gate saw.', RECAPTURE_ALLOWANCE]);
  assert.deepEqual(h.filled(), ['Recapture Kitchen'], 'the first room’s button is the filled one');
  const buttons = h.slot().shown().filter(el => el.tagName === 'BUTTON').map(el => el.textContent);
  assert.deepEqual(buttons, ['Recapture Kitchen', 'Recapture Hallway', 'Recapture Sample space']);
  const help = h.slot().shown().filter(el => el.tagName === 'A' && /render-fix/.test(el.className)).map(el => [el.textContent, el.href]);
  assert.deepEqual(help, [['How to fix this', '/help/fix/few_views'], ['How to fix this', '/help/fix/no_floor']], 'only a rule this page knows links out');
  assert.doesNotMatch(h.slot().shown().map(el => el.textContent).join(' '), /Ask Veylet support what to capture/);
  assert.doesNotMatch(h.text(), /Recapture this room; it won’t use a walkthrough|Recapture it; it won’t use a walkthrough|Recapturing it won’t use a walkthrough/i);
  // The server sends up to 20 rooms: all 20 show; anything past that is dropped.
  const many = Array.from({ length: 21 }, (_, index) => ({ room: 'Room ' + (index + 1), reason: 'Too dark here', rule: 'photo_match' }));
  const twenty = await load({ status: [job({ ...JOBS.recapture, recapture: many })] });
  const shown = twenty.slot().shown().filter(el => el.tagName === 'BUTTON').map(el => el.textContent);
  assert.equal(shown.length, 20);
  assert.equal(shown[19], 'Recapture Room 20');
  // An empty array reads as no reason at all.
  const empty = await load({ status: [job({ ...JOBS.recapture, recapture: [] })] });
  assert.deepEqual(empty.filled(), ['Contact Veylet support']);
});

test('render status: a space reads only what the answer said about it', async () => {
  // A state this page does not know says nothing rather than a guess.
  const unknown = await load({ status: [job({ state: 'teleporting' })] });
  assert.equal(unknown.slot().hidden, true);
  assert.equal(unknown.spaces()[0].children.find(el => /^No tour package yet/.test(el.textContent)).hidden, false);
  // A space the answer did not list reads as it did; another space's capture never lands here.
  const elsewhere = await load({ status: () => ({ data: { active: true, spaces: [{ property_id: 'p-other', job: JOBS.uploading }] } }) });
  assert.equal(elsewhere.slot().hidden, true);
  // Two spaces, each with its own capture.
  const two = await load({ properties: [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }, { id: 'p2', title: 'Second space', workspace_id: 'w1' }],
    status: [JOBS.waiting, job({ ...JOBS.failed, job_id: 'b2', property_id: 'p2' })] });
  assert.deepEqual([two.title(0), two.title(1)], ['Waiting to render', 'Failed']);
});

test('render status: the next step says whose turn it is while no walkthrough is on the desk', async () => {
  const moving = await withState('rendering');
  const panel = moving.ids['account-next-step'];
  assert.equal(panel.children[0].textContent, 'Your walkthrough is being made automatically.');
  assert.equal(panel.children[1].textContent, 'Its progress shows on Sample space below and updates by itself. You can leave this page; the render carries on.');
  assert.equal(panel.children.some(el => el.tagName === 'BUTTON' || el.tagName === 'A'), false, 'automatic: nothing to press');
  const sending = await withState('uploading');
  assert.equal(sending.ids['account-next-step'].children[0].textContent, 'Your capture is on its way.');
  const rooms = await withState('recapture');
  const next = rooms.ids['account-next-step'];
  assert.equal(next.children[0].textContent, 'Recapture what the quality check found.');
  assert.equal(next.children[1].textContent, 'What and why is on Sample space below. This failed attempt uses no walkthrough; the complete allowance rule is shown there.');
  assert.equal(next.children[2].textContent, 'Show what to recapture');
  const broken = await withState('failed');
  assert.equal(broken.ids['account-next-step'].children[0].textContent, 'Something went wrong on our side.');
  assert.equal(broken.ids['account-next-step'].children.length, 2, 'nothing to press on Veylet support’s turn');
  // A poll that changes nothing does not rewrite the next step (a live region).
  const before = moving.ids['account-next-step'].children[0];
  await moving.poll();
  assert.equal(moving.ids['account-next-step'].children[0], before);
});

test('render status: a walkthrough under a space that already says its state shows no second chip', async () => {
  const chip = h => h.spaces()[0].all().find(el => el.dataset.tour === 't1').all().find(el => el.dataset.chip === 'state');
  // Ready for your review: the space says it, so the walkthrough row does not repeat it.
  const ready = await withState('ready');
  assert.equal(ready.title(), 'Ready for your review');
  assert.equal(chip(ready).textContent, 'Ready for your review');
  assert.equal(chip(ready).hidden, true);
  // Live, the same.
  const live = await withState('live');
  assert.equal(live.title(), 'Live');
  assert.equal(chip(live).textContent, 'Live');
  assert.equal(chip(live).hidden, true);
  // An operator reads "Ready for review" in both places, so once.
  const operator = await withState('ready', { role: 'operator' });
  assert.equal(chip(operator).textContent, 'Ready for review');
  assert.equal(chip(operator).hidden, true);
  // Without render status (a backend without the function) the row says its own state.
  const missing = await load({ status: { error: { code: 'PGRST202', message: 'Could not find the function' } }, tours: [readyTour()] });
  assert.equal(chip(missing).textContent, 'Ready for your review');
  assert.equal(chip(missing).hidden, false);
  // A state the space does not say is kept: sharing turned off after release.
  const off = await load({ status: [JOBS.live], tours: [readyTour()], approved: true, rpc: {
    get_tour_hosting: async () => ({ data: [{ tour_id: 't1', released_at: '2026-09-01T00:00:00Z', hosted_until: '2027-09-01T00:00:00Z', plan_active: true }] }) } });
  assert.equal(chip(off).textContent, 'Sharing off');
  assert.equal(chip(off).hidden, false);
  // A space whose status changes away from Live gives the row its chip back.
  let current = [JOBS.live];
  const moving = await load({ status: () => current, tours: [readyTour({ share_token: 'abcdefghijklmnop' })], approved: true });
  assert.equal(chip(moving).hidden, true);
  current = [job({ ...JOBS.rendering, job_id: 'b2' })];
  await moving.hide(false);
  assert.equal(chip(moving).hidden, false);
});
