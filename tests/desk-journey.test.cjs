/*
 * The agent's account desk, slice S1 of the sibling repository's
 * docs/ux/capture-to-client-journey-20260925.md: Approve and share in one press
 * (D2), one vocabulary (D1, render-status contract "After review, and one
 * vocabulary"), the share kit on the Live card with a QR code drawn in this browser
 * (D3), the offline line (finding 8) and "What your clients see" (D8, migration
 * 20260925130000_agent_public_contact.sql). Every answer here is a stand-in; nothing
 * reaches Supabase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const account = read('dist/account.js');
const sharing = read('dist/tour-sharing.js');
const qrcode = read('dist/vendor/qrcode-1.5.4.min.js');
const markup = read('dist/account/index.html');
const guideCss = read('dist/account-guide.css');
// The stylesheet's block for the insights panel, the plan and its tables.
const insightsCss = guideCss.slice(guideCss.indexOf('/* ---- Walkthrough insights, vendor report'), guideCss.indexOf('.space-prep { margin: 12px 0 0; }'));

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const TOKEN = 'abcdefghijklmnop';
const HANDOFF = 'https://veylet.com/handoff?t=' + TOKEN;
// What the desk hands out carries its channel (?src=); Open as your client is the page itself.
const LINK = HANDOFF + '&src=link';
const QR = HANDOFF + '&src=qr';

function harness(options = {}) {
  const created = [];
  const documentStub = { hidden: false, activeElement: null, listeners: {} };
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
      this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.className = ''; this.parent = null;
      const el = this;
      this.classList = {
        add(...names) { const set = new Set(el.className.split(/\s+/).filter(Boolean)); names.forEach(name => set.add(name)); el.className = [...set].join(' '); },
        remove(...names) { el.className = el.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
        contains(name) { return el.className.split(/\s+/).includes(name); },
      };
      created.push(this);
    }
    append(...children) { for (const child of children) { if (typeof child === 'string') { this.textContent += child; continue; } child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
    async fire(name, event = {}) { let result; for (const handler of this.events[name] || []) result = await handler({ preventDefault() {}, target: this, ...event }); return result; }
    querySelector() { return null; }
    contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    // What a person sees: nothing inside a hidden element.
    shown() { return this.children.filter(child => !child.hidden).flatMap(child => [child, ...child.shown()]); }
    focus() { documentStub.activeElement = this; } click() { this.clicked = (this.clicked || 0) + 1; } scrollIntoView() {} select() {} reset() {}
    getContext() { return this.tagName === 'CANVAS' ? { fillStyle: '', fillRect: () => { this.painted = (this.painted || 0) + 1; } } : null; }
    toBlob(done, type) { done({ type, size: this.width * this.height }); }
  }
  const ids = {};
  // `options.markup` draws another page on the same script (the app's /app/account).
  const page = options.markup || markup;
  for (const match of page.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  documentStub.documentElement = { dataset: /<html\b[^>]*\bdata-app-mode="true"/.test(page) ? { appMode: 'true' } : {} };
  // `heat` holds the 300 ms wait before the stops' placeholder is drawn.
  const timers = { render: new Set(), desk: new Set(), skeleton: new Set(), heat: new Set() };
  const scheduleTimeout = (fn, ms) => {
    const timer = { fire: fn, ms };
    if (ms === 10000) timers.render.add(timer); else if (ms === 45000) timers.desk.add(timer); else if (ms === 400) timers.skeleton.add(timer); else if (ms === 300) timers.heat.add(timer);
    else if (ms === 0) setImmediate(fn);
    return timer;
  };
  const cancelTimeout = timer => { for (const set of Object.values(timers)) set.delete(timer); };
  const calls = [], queries = [], copied = [], shared = [], downloads = [];
  const user = options.user || { id: 'user-1', email: 'person@example.invalid' };
  const tours = (options.tours || []).map(row => ({ ...row }));
  const table = {
    properties: { data: options.properties || [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }] },
    tours: { data: tours },
    memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
  };
  const approved = new Set(options.approved === true ? tours.map(row => row.id) : options.approved || []);
  const missing = { error: { code: 'PGRST202', message: 'Could not find the function' } };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 'token-1' } } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signOut: async () => ({}),
    },
    from(name) {
      queries.push(name);
      let columns = '';
      // `options.pauseColumn === false`: a database without tours.share_paused_at (and so without pause_tour_share).
      const answer = () => (name === 'tours' && options.pauseColumn === false && /share_paused_at/.test(columns)
        ? { error: { code: '42703', message: 'column tours.share_paused_at does not exist' } }
        : typeof table[name] === 'function' ? table[name]() : table[name]);
      const builder = { select(value) { columns = String(value || ''); return builder; }, order() { return builder; }, eq() { return builder; },
        single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
        then(resolve, reject) { return Promise.resolve().then(answer).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc?.[name]) return options.rpc[name](args, { tours, approved, table });
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      if (['get_pack_offer', 'get_trial_offer', 'get_express_offer', 'get_referral_code', 'list_workspace_render_status', 'get_workspace_public_contact'].includes(name)) return missing;
      if (name === 'get_tour_hosting') return { data: options.hosting || [] };
      if (name === 'get_tour_review') return { data: [{ approved: approved.has(args.p_tour_id) }] };
      if (name === 'get_tour_review_target') { const row = tours.find(item => item.id === args.p_tour_id); return { data: [{ tour_id: row?.id, storage_path: row?.storage_path, package_revision: 'a'.repeat(64) }] }; }
      if (name === 'review_tour_versioned') { approved.add(args.p_tour_id); return { data: [{ approved: true }] }; }
      if (name === 'enable_tour_share') { const row = tours.find(item => item.id === args.p_tour_id); row.share_token = TOKEN; return { data: TOKEN }; }
      if (name === 'revoke_tour_share') { const row = tours.find(item => item.id === args.p_tour_id); row.share_token = null; return { data: null }; }
      if (name === 'withdraw_tour_review') { approved.delete(args.p_tour_id); return { data: [{ approved: false }] }; }
      return { data: null };
    },
  };
  const windowEvents = {};
  const navigator = { onLine: options.onLine ?? true, clipboard: { writeText: async text => { copied.push(text); } } };
  if (options.share) navigator.share = async data => { shared.push({ ...data }); return options.share(data); };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, VEYLET_HOOKS: { url: 'https://hooks.example.invalid' },
    addEventListener: (name, handler) => { windowEvents[name] = handler; } };
  // `options.fetch` answers the package files the floor plan reads.
  if (options.fetch) window.fetch = options.fetch;
  Object.assign(documentStub, {
    getElementById: id => ids[id], createElement: tag => new Element(tag),
    createElementNS: (namespace, tag) => Object.assign(new Element(tag), { namespace }),
    addEventListener: (name, handler) => { documentStub.listeners[name] = handler; }, head: { append() {} },
  });
  const FakeURL = function (...args) { return new URL(...args); };
  FakeURL.createObjectURL = blob => { downloads.push(blob); return 'blob:veylet-' + downloads.length; };
  FakeURL.revokeObjectURL = () => {};
  const context = { window, document: documentStub, navigator, Date, URL: FakeURL, URLSearchParams, TextEncoder, atob, Blob: class {},
    location: { pathname: '/account', search: '', replace() {}, assign() {} },
    setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { get() { return ''; } } };
  vm.runInNewContext(sharing, context);
  if (options.qr !== false) vm.runInNewContext(qrcode, context);
  return { ids, calls, queries, copied, shared, downloads, created, table, tours, approved, supabase, window, windowEvents, navigator, documentStub, timers, context, Element };
}

async function load(options = {}) {
  const h = harness(options);
  await vm.runInNewContext(account, h.context);
  await settle();
  Object.assign(h, {
    all: () => Object.values(h.ids).flatMap(el => [el, ...el.all()]),
    // Everything a person can see on the desk, as text.
    visible: () => Object.values(h.ids).filter(el => !el.hidden && !hiddenAncestor(h, el)).flatMap(el => [el, ...el.shown()]).map(el => el.textContent).filter(Boolean).join('\n'),
    status: () => h.ids['account-status'].textContent,
    card: id => h.all().find(el => el.dataset.tour === id),
    count: name => h.calls.filter(([called]) => called === name).length,
    tourReads: () => h.queries.filter(name => name === 'tours').length,
    async poll() { const list = [...h.timers.render]; h.timers.render.clear(); for (const timer of list) timer.fire(); await settle(); },
  });
  return h;
}
// The static markup nests these; the page script never hides a parent it does not own.
function hiddenAncestor(h, el) {
  const parents = { 'account-contact-body': 'account-contact' };
  return Object.entries(parents).some(([child, parent]) => el === h.ids[child] && h.ids[parent].hidden);
}
const byText = (root, text) => (Array.isArray(root) ? root : root.all()).find(el => el.textContent === text);
const shownIn = el => [el, ...el.shown()];
const filled = el => shownIn(el).filter(node => /\btour-action-primary\b/.test(node.className) || (node.tagName === 'BUTTON' && node.type === 'submit' && /\bbutton\b/.test(node.className))).map(node => node.textContent);
const chipOf = card => card.all().find(el => el.dataset.chip === 'state') || null;
const rowLine = card => card.all().filter(el => el.className === 'tour-row-status' && !el.hidden).map(el => el.textContent).join('\n');
// A card's quiet disclosures (Link, QR code, Website, Insights, Manage) and the panel each opens under its row.
const toggleOf = (card, key) => card.all().find(el => el.dataset.disclosure === key) || null;
const panelOf = (card, key) => card.all().find(el => el.className === 'tour-panel tour-' + key) || null;
const openPanel = async (card, key) => { const toggle = toggleOf(card, key); if (toggle.attributes['aria-expanded'] !== 'true') await toggle.fire('click'); return panelOf(card, key); };
const stateLine = card => card.children.find(el => /^tour-state-help/.test(el.className))?.textContent;
const readyTour = (fields = {}) => ({ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null, ...fields });
const reviewForm = card => card.all().find(el => el.tagName === 'FORM');
async function approve(h, id = 't1') {
  const form = reviewForm(h.card(id));
  form.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  await form.fire('submit');
  await settle();
}
// The desk's day format: the Brisbane day (UTC+10 all year), a three-letter month and the year.
const day = value => { const at = new Date(Date.parse(value) + 10 * 3600000);
  return at.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][at.getUTCMonth()] + ' ' + at.getUTCFullYear(); };
const released = (fields = {}) => ({ tour_id: 't1', released_at: '2026-09-01T00:00:00Z', hosted_until: '2027-09-01T00:00:00Z', plan_active: true, ...fields });

/* ---- Approve and share ---------------------------------------------------- */

test('Approve and share: one press records the approval, turns sharing on and reloads onto the Live card', async () => {
  const h = await load({ tours: [readyTour()] });
  const card = h.card('t1');
  assert.equal(chipOf(card).textContent, 'Ready for your review');
  assert.equal(stateLine(card), 'Nobody else can see it until you approve and share it.');
  const review = card.all().find(el => el.tagName === 'DETAILS' && el.className === 'tour-review');
  assert.equal(review.children[0].textContent, 'Review this walkthrough');
  const form = reviewForm(card);
  assert.deepEqual(filled(form), ['Approve and share']);
  assert.ok(byText(form, 'Anyone with the link can open it and forward it while your plan is active.'));
  const before = h.tourReads();
  await approve(h);
  assert.deepEqual(h.calls.filter(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)).map(([name, args]) => [name, args.p_tour_id]),
    [['review_tour_versioned', 't1'], ['enable_tour_share', 't1']], 'approve, then share, once each and in that order');
  assert.equal(h.tourReads(), before + 1, 'the desk reloads');
  const live = h.card('t1');
  assert.equal(chipOf(live).textContent, 'Live');
  assert.equal(rowLine(live), 'Live. Anyone with the link can open it.');
  assert.equal(h.status(), 'Live. Anyone with the link can open it.');
  assert.ok(byText(live, 'Open as your client'));
  assert.equal(reviewForm(live), undefined, 'no review form once it is live');
});

test('Approve and share: a refusal keeps the approval and says what sharing waits for, with its one fix', async () => {
  const cases = [
    ['review this tour before sharing', 'Approved. Sharing waits for a fresh review of this version.', 'Start a fresh review'],
    ['sharing permission required', 'Approved. Sharing waits for someone with sharing permission.', null],
    // Hosting enforcement (draft 20260926132000): the office's plan ended more than 14 days ago.
    ['Restart your plan to share this walkthrough.', 'Restart your plan to share this walkthrough.', 'Restart your plan'],
  ];
  for (const [message, words, fix] of cases) {
    const h = await load({ tours: [readyTour()], rpc: { enable_tour_share: async () => ({ error: { code: 'P0001', message } }) } });
    await approve(h);
    const card = h.card('t1');
    assert.equal(stateLine(card), words, message);
    assert.equal(h.status(), words, message);
    assert.equal(reviewForm(card), undefined, 'the approval stands: no second review');
    assert.ok(byText(card, 'Withdraw approval'), 'and it can still be withdrawn');
    assert.equal(chipOf(card).textContent, 'Approved, not shared', 'never shared: its chip says so, like every other walkthrough’s');
    assert.equal(chipOf(card).className, 'pill pill-quiet');
    assert.equal(shownIn(card).some(el => /^(Anyone with the link can open it|Turning sharing on makes)/.test(el.textContent)), false, 'the reason replaces the usual line');
    if (fix) {
      assert.deepEqual(filled(card), [fix], message);
      const row = card.all().find(el => el.className === 'tour-actions-row' && el.children.some(child => child.textContent === 'Turn sharing on'));
      assert.deepEqual(row.children.map(child => child.textContent), [fix, 'Turn sharing on', 'Preview'], 'the fix first, the retry beside it');
    } else {
      assert.deepEqual(filled(card), [], 'without sharing permission there is nothing filled to press');
      assert.equal(shownIn(card).some(el => el.textContent === 'Turn sharing on'), false);
      assert.ok(shownIn(card).some(el => el.textContent === 'Ask the workspace owner to turn sharing on.'));
    }
  }
  // Walkthroughs belong to the office (draft 20260926126000): the retired uploader refusal, from an
  // old backend, reads as the generic one, with no fix pointing anywhere.
  const uploader = await load({ tours: [readyTour({ walkthrough_id: '1a2b3c4d-0000-4000-8000-000000000001' })],
    rpc: { enable_tour_share: async () => ({ error: { message: 'tour uploader membership is no longer active' } }) } });
  await approve(uploader);
  assert.equal(stateLine(uploader.card('t1')), 'Approved. Sharing didn’t turn on. Try again.');
  assert.equal(byText(uploader.card('t1'), 'Contact Veylet support'), undefined);
  // The fix for a stale review reads the desk again.
  const stale = await load({ tours: [readyTour()], rpc: { enable_tour_share: async () => ({ error: { message: 'review this tour before sharing' } }) } });
  await approve(stale);
  const reads = stale.tourReads();
  await byText(stale.card('t1'), 'Start a fresh review').fire('click'); await settle();
  assert.equal(stale.tourReads(), reads + 1);
});

test('Approve and share: an unknown failure says so, Turn sharing on tries again, and an answer lost on the way is read back', async () => {
  let attempts = 0;
  const h = await load({ tours: [readyTour()], rpc: { enable_tour_share: async (args, { tours }) => {
    attempts += 1;
    if (attempts === 1) return { error: { message: 'upstream request timeout' } };
    tours[0].share_token = TOKEN; return { data: TOKEN };
  } } });
  await approve(h);
  const card = h.card('t1');
  assert.equal(stateLine(card), 'Approved. Sharing didn’t turn on. Try again.');
  assert.deepEqual(filled(card), ['Turn sharing on']);
  await byText(card, 'Turn sharing on').fire('click'); await settle();
  assert.equal(h.count('enable_tour_share'), 2);
  assert.equal(chipOf(h.card('t1')).textContent, 'Live');
  assert.equal(rowLine(h.card('t1')), 'Live. Anyone with the link can open it.');
  // Sharing turned on but its answer never arrived: the reloaded card is the truth.
  const lost = await load({ tours: [readyTour()], rpc: { enable_tour_share: async (args, { tours }) => { tours[0].share_token = TOKEN; return { error: { message: 'timeout' } }; } } });
  await approve(lost);
  assert.equal(chipOf(lost.card('t1')).textContent, 'Live');
  assert.equal(rowLine(lost.card('t1')), 'Live. Anyone with the link can open it.');
  assert.doesNotMatch(lost.visible(), /didn’t turn on/);
});

test('a correction whose link moves is approved in today’s words, without a second call; one without a live link shares', async () => {
  const W1 = '1a2b3c4d-0000-4000-8000-000000000001', W2 = '1a2b3c4d-0000-4000-8000-000000000002';
  const version = (id, revision, fields = {}) => readyTour({ id, walkthrough_id: W1, revision, revision_of: revision > 1 ? W1 : null, superseded_at: null, storage_path: 'w1/' + id + '.zip', ...fields });
  const lineage = moves => async args => ({ data: [{ tour_id: args.p_tour_id, walkthrough_id: W1, revision: 2, revision_of: W1, superseded_at: null,
    correction_reason: 'requested_change', walkthrough_accepted: true, approval_uses_allowance: false, link_moves_on_approval: moves }] });
  const moving = await load({ tours: [version(W2, 2), version(W1, 1, { share_token: TOKEN })], approved: [W1], rpc: { get_walkthrough_revision: lineage(true) } });
  assert.equal(moving.card(W2).all().find(el => /tour-correction/.test(el.className)).textContent,
    'This is a correction of walkthrough 1a2b3c4d. Approving it uses no walkthrough from your allowance, and your existing link and embed will show this version.');
  await approve(moving, W2);
  assert.equal(moving.count('enable_tour_share'), 0, 'the link moves by the approval itself');
  assert.match(rowLine(moving.card(W2)), /^Approved\. Your existing link and embed now show this version\.$/);
  const fresh = await load({ tours: [version(W2, 2), version(W1, 1)], rpc: { get_walkthrough_revision: lineage(false) } });
  assert.equal(fresh.card(W2).all().find(el => /tour-correction/.test(el.className)).textContent,
    'This is a correction of walkthrough 1a2b3c4d. Approving it uses no walkthrough from your allowance. It has no live link now, so approving it also turns sharing on.');
  assert.equal(byText(reviewForm(fresh.card(W2)), 'Anyone with the link can open it and forward it while your plan is active.'), undefined,
    'the consequence line is for a first release only');
  await approve(fresh, W2);
  assert.deepEqual(fresh.calls.filter(([name]) => name === 'enable_tour_share').map(([, args]) => args.p_tour_id), [W2]);
});

test('every guard of the review still stops before sharing is turned on', async () => {
  const refusals = [
    [{ error: { details: 'VEYLET_WALKTHROUGH_CAPACITY_EXHAUSTED', message: 'Your included walkthroughs are used.' } }, /This walkthrough was not accepted/],
    [{ error: { details: 'VEYLET_PLAN_NOT_ACTIVE', message: 'Confirm your plan.' } }, /This walkthrough was not accepted/],
    [{ error: { details: 'VEYLET_SANDBOX_TEST_ONLY', message: 'Test purchase.' } }, /^Test purchase · real walkthroughs require a live plan/],
    [{ error: { details: 'VEYLET_PACKAGE_REVISION_CHANGED', message: 'tour package changed' } }, /The package changed/],
    [{ data: [{ approved: false }] }, /Review was not confirmed/],
  ];
  for (const [reply, words] of refusals) {
    const h = await load({ tours: [readyTour()], rpc: { review_tour_versioned: async () => reply } });
    await approve(h);
    assert.equal(h.count('enable_tour_share'), 0, String(words));
    assert.match(h.status(), words);
  }
  // Replaced meanwhile: the desk reloads and nothing is shared.
  const superseded = await load({ tours: [readyTour()], rpc: { review_tour_versioned: async () => ({ error: { details: 'VEYLET_REVISION_SUPERSEDED' } }) } });
  await approve(superseded);
  assert.equal(superseded.count('enable_tour_share'), 0);
  assert.match(superseded.status(), /A newer version of this walkthrough was approved/);
  // A sign-in that expired during the approval, or during the share.
  const expired = await load({ tours: [readyTour()], rpc: { review_tour_versioned: async () => ({ error: { code: '401', message: 'JWT expired' } }) } });
  await approve(expired);
  assert.equal(expired.count('enable_tour_share'), 0);
  assert.equal(expired.ids['account-home'].hidden, true);
  const lapsed = await load({ tours: [readyTour()], rpc: { enable_tour_share: async () => ({ error: { code: 'PGRST301', message: 'JWT expired' } }) } });
  await approve(lapsed);
  assert.equal(lapsed.ids['account-home'].hidden, true);
  assert.match(lapsed.status(), /The walkthrough is approved; sign in and turn sharing on from its card\./);
  // Unchecked boxes still record nothing.
  const partial = await load({ tours: [readyTour()] });
  await reviewForm(partial.card('t1')).fire('submit');
  assert.equal(partial.count('review_tour_versioned'), 0);
});

test('sharing turned off after release reads Sharing off, and Turn sharing back on makes it Live again', async () => {
  const h = await load({ tours: [readyTour()], approved: true, hosting: [released()] });
  const card = h.card('t1');
  assert.equal(chipOf(card).textContent, 'Sharing off');
  assert.equal(stateLine(card), 'Sharing is off. The link and embed show "not available".');
  assert.deepEqual(filled(card), ['Turn sharing back on']);
  await byText(card, 'Turn sharing back on').fire('click'); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === 'enable_tour_share').map(([, args]) => args.p_tour_id), ['t1']);
  assert.equal(chipOf(h.card('t1')).textContent, 'Live');
  assert.equal(rowLine(h.card('t1')), 'Live. Anyone with the link can open it.');
  // Approved before this desk shared on approval, and never shared: one line, one press.
  const never = await load({ tours: [readyTour()], approved: true });
  assert.equal(chipOf(never.card('t1')).textContent, 'Approved, not shared', 'the chip says it once');
  assert.equal(shownIn(never.card('t1')).some(el => /Sharing isn’t on yet/.test(el.textContent)), false, 'and no sentence repeats it');
  assert.deepEqual(filled(never.card('t1')), ['Turn sharing on']);
  // What the press does, not a claim that a link already works (it read "Anyone with the link can open it." before).
  assert.ok(byText(never.card('t1'), 'Turning sharing on makes a link, QR code and embed code that anyone can open.'));
  assert.equal(byText(never.card('t1'), 'Anyone with the link can open it.'), undefined);
  // A refusal on the press itself is said in place, with its fix, and nothing reloads.
  const refused = await load({ tours: [readyTour()], approved: true, hosting: [released()], rpc: { enable_tour_share: async () => ({ error: { message: 'sharing permission required' } }) } });
  const reads = refused.tourReads();
  await byText(refused.card('t1'), 'Turn sharing back on').fire('click'); await settle();
  assert.equal(refused.tourReads(), reads);
  assert.equal(rowLine(refused.card('t1')), 'Approved. Sharing waits for someone with sharing permission.');
  assert.ok(shownIn(refused.card('t1')).some(el => el.textContent === 'Ask the workspace owner to turn sharing on.'));
  // Someone who may not share reads whose press it is, never a disabled button.
  const reviewerOnly = await load({ tours: [readyTour({ created_by: 'someone-else' })], approved: true, role: 'operator' });
  assert.equal(chipOf(reviewerOnly.card('t1')).textContent, 'Approved, not shared');
  assert.equal(stateLine(reviewerOnly.card('t1')), 'The workspace owner or this walkthrough’s creator can turn sharing on.');
  assert.equal(shownIn(reviewerOnly.card('t1')).some(el => el.tagName === 'BUTTON'), false);
});

/* ---- One vocabulary --------------------------------------------------------- */

test('each walkthrough row carries one state chip in the contract’s words', async () => {
  const past = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = [
    [readyTour(), [], [], 'Ready for your review'],
    [readyTour(), ['t1'], [released()], 'Sharing off'],
    [readyTour({ share_token: TOKEN }), ['t1'], [released()], 'Live'],
    [readyTour({ share_token: TOKEN }), ['t1'], [released({ plan_active: false, hosting_state: 'offline', offline_on: past })], 'Offline'],
    [readyTour({ status: 'draft' }), [], [], 'Rendering'],
    [readyTour({ status: 'processing', storage_path: null }), [], [], 'Rendering'],
    [readyTour({ status: 'revoked' }), [], [], 'Unavailable'],
  ];
  for (const [tour, approved, hosting, word] of rows) {
    const h = await load({ tours: [tour], approved, hosting });
    const card = h.card('t1');
    const chips = card.all().filter(el => /^pill\b/.test(el.className));
    assert.deepEqual(chips.filter(el => el.dataset.chip === 'state').map(el => el.textContent), [word], word);
    assert.equal(chips.some(el => ['Private', 'Link created', 'Draft', 'Processing', 'Processed'].includes(el.textContent)), false, word);
  }
  // Offline keeps the kit (the same link comes back when the plan restarts); the next step is the plan.
  const ended = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released({ plan_active: false, hosting_state: 'offline', offline_on: past })] });
  assert.ok(byText(ended.card('t1'), 'Copy link'));
  assert.deepEqual(ended.ids['account-next-step'].children.map(el => el.textContent), ['Your walkthrough is offline.',
    'Offline since ' + day(past) + '. Restart your plan and this link works again — same link, embed and QR.', 'Restart your plan',
    'Keep this walkthrough online (A$49 a year)']);
  // Offer 2026-09-26.2: the secondary is the studio request by email with the walkthrough's id; the restart stays the button.
  const ask = ended.ids['account-next-step'].children[3];
  assert.equal(ask.tagName, 'A');
  assert.equal(ask.dataset.control, 'hosting-extension');
  assert.match(decodeURIComponent(ask.href), /^mailto:support@veylet\.com\?subject=Veylet hosting extension · walkthrough t1[\s\S]*Tour ID: t1\n/);
  // Someone who cannot review reads whose turn it is.
  const operator = await load({ tours: [readyTour()], role: 'operator' });
  assert.equal(chipOf(operator.card('t1')).textContent, 'Ready for review');
});

test('the next step names the listing, then the one press', async () => {
  const h = await load({ tours: [readyTour()] });
  const panel = h.ids['account-next-step'];
  assert.deepEqual(panel.children.map(el => el.textContent), ['Sample space is ready for your review.',
    'Open it, walk through, then approve and share. Nobody else can see it until you do.', 'Review walkthrough']);
  await panel.children[2].fire('click');
  const review = h.card('t1').all().find(el => el.tagName === 'DETAILS' && el.className === 'tour-review');
  assert.equal(review.open, true);
  assert.equal(h.count('review_tour_versioned') + h.count('enable_tour_share'), 0, 'opening approves and shares nothing');
  const untitled = await load({ tours: [readyTour()], properties: [{ id: 'p1', title: '', workspace_id: 'w1' }] });
  assert.equal(untitled.ids['account-next-step'].children[0].textContent, 'Your walkthrough is ready for your review.');
  // While its review answer is on its way, the next step does not guess.
  let answer;
  const waiting = await load({ tours: [readyTour()], rpc: { get_tour_review: () => new Promise(resolve => { answer = resolve; }) } });
  assert.equal(waiting.ids['account-next-step'].children[0].textContent, 'Checking your next step…');
  answer({ data: [{ approved: true }] }); await settle();
  assert.equal(waiting.ids['account-next-step'].children[0].textContent, 'Approved. Sharing isn’t on yet.');
  const off = await load({ tours: [readyTour()], approved: true, hosting: [released()] });
  assert.equal(off.ids['account-next-step'].children[0].textContent, 'Sharing is off.');
  const live = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released()] });
  assert.equal(live.ids['account-next-step'].children[0].textContent, 'Your walkthrough is live.');
  // A walkthrough to review comes before finished work.
  const both = await load({ tours: [readyTour({ id: 't0', share_token: TOKEN }), readyTour({ storage_path: 'w1/t1/other.zip' })], approved: ['t0'] });
  assert.equal(both.ids['account-next-step'].children[0].textContent, 'Sample space is ready for your review.');
});

const RETIRED = [/\bProcessing\b/i, /\bProcessed\b/i, /\bDraft\b/i, /\bCheck and approve\b/i, /Approved\s*[–-]\s*sharing off/i, /\bTurn on sharing\b/i];
function assertNoRetired(text, where) {
  for (const word of RETIRED) assert.doesNotMatch(text, word, where + ' says a retired word');
}
test('no retired word reaches the desk, in any state', async () => {
  const past = new Date(Date.now() - 30 * 86400000).toISOString();
  const status = jobs => ({ data: { active: false, spaces: jobs } });
  const job = (state, fields = {}) => ({ job_id: 'a1b2c3d4-0000-4000-8000-000000000001', property_id: 'p1', state, attempts_allowed: 2, ...fields });
  const desks = [
    { tours: [readyTour()] },
    { tours: [readyTour()], role: 'operator' },
    { tours: [readyTour()], approved: true },
    { tours: [readyTour()], approved: true, hosting: [released()] },
    { tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released()], share: async () => {} },
    { tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released({ plan_active: false, hosted_until: past })] },
    { tours: [readyTour({ share_token: TOKEN })] },
    { tours: [readyTour({ status: 'draft' })] },
    { tours: [readyTour({ status: 'processing', storage_path: null })] },
    { tours: [readyTour({ status: 'revoked' })] },
    { tours: [] },
    { tours: [], properties: [] },
    ...['uploading', 'waiting', 'rendering', 'studio_check', 'needs_recapture', 'retrying', 'failed'].map(state => ({ tours: [], rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job(state) }]) } })),
    { tours: [readyTour()], rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job('ready_for_review', { tour_id: 't1' }) }]) } },
    { tours: [readyTour({ share_token: TOKEN })], approved: true, rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job('live', { tour_id: 't1' }) }]) } },
    { tours: [readyTour()], rpc: { get_workspace_public_contact: async () => ({ data: [{ show_on_shared: true, display_name: 'Ari Lee', agency: 'Harbour Realty', phone: '0400 000 000', email: null }] }) } },
  ];
  for (const [index, options] of desks.entries()) {
    const h = await load(options);
    const qr = h.all().find(el => el.dataset.disclosure === 'qr');
    if (qr) await qr.fire('click');
    assertNoRetired(h.visible(), 'desk ' + index);
  }
  // Every refusal and failure line after Approve and share.
  for (const message of ['review this tour before sharing', 'tour uploader membership is no longer active', 'sharing permission required', 'boom']) {
    const h = await load({ tours: [readyTour()], rpc: { enable_tour_share: async () => ({ error: { message } }) } });
    await approve(h);
    assertNoRetired(h.visible(), message);
  }
  // Offline, on a first load and on a drawn desk.
  const offline = await load({ tours: [readyTour()] });
  offline.navigator.onLine = false;
  await offline.ids['account-refresh'].fire('click');
  assertNoRetired(offline.visible(), 'offline');
  // The static page: every word outside tags, scripts and comments.
  const words = markup.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
  assertNoRetired(words, 'account/index.html');
  // And every quoted string in the script a customer could read.
  const strings = [...account.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1])
    .filter(text => /\s/.test(text) || /^[A-Z]/.test(text));
  assertNoRetired(strings.join('\n'), 'account.js strings');
});

/* Owner decision, 25 September 2026: no studio and no person checks a walkthrough;
 * processing is automatic, and Super fast has no daily cap and no business hours. */
const NO_STUDIO = [/studio check/i, /a person checks/i, /with the studio/i, /contact the studio/i, /business hours/i, /5 a day/i];
function assertNoStudio(text, where) {
  for (const phrase of NO_STUDIO) assert.doesNotMatch(text, phrase, where + ' implies a person or a cap: ' + phrase);
}
test('no studio check, person check, studio contact, business hours or daily cap reaches the desk, in any state', async () => {
  const status = jobs => ({ data: { active: false, spaces: jobs } });
  const job = (state, fields = {}) => ({ job_id: 'a1b2c3d4-0000-4000-8000-000000000001', property_id: 'p1', state, attempts_allowed: 2, ...fields });
  const soon = new Date(Date.now() + 30 * 60000).toISOString(), gone = new Date(Date.now() - 20 * 60000).toISOString();
  const capture = (fields = {}) => ({ job_id: 'e1f2a3b4-0000-4000-8000-0000000000e1', property_id: 'p1', status: 'queued', ready_by: soon, express: null, ...fields });
  const offer = (fields = {}) => ({ data: { price_cents: 2900, daily_cap: null, full_today: false, credits_available: 0, can_order: true, captures: [capture()], ...fields } });
  const order = (fields = {}) => ({ state: 'open', due_at: soon, completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null, ...fields });
  const offers = [
    offer(), offer({ credits_available: 2 }), offer({ can_order: false }),
    // An older answer that still counts against a cap: full offers nothing and names no cap.
    offer({ daily_cap: 5, taken_today: 2 }), offer({ daily_cap: 5, taken_today: 5, full_today: true }),
    offer({ captures: [capture({ express: order() })] }),
    offer({ captures: [capture({ status: 'awaiting_review', express: order({ state: 'met', due_at: gone, completed_at: gone }) })] }),
    offer({ captures: [capture({ express: order({ state: 'missed', due_at: gone, refund: 'refunded' }) })] }),
    offer({ captures: [capture({ express: order({ state: 'missed', due_at: gone, paid_with: 'credit', amount_cents: null, refund: 'returned' }) })] }),
  ];
  const desks = [
    { tours: [readyTour({ status: 'draft' })] },
    { tours: [readyTour({ status: 'processing', storage_path: null })] },
    { tours: [readyTour({ status: 'revoked' })] },
    { tours: [] },
    { tours: [], properties: [] },
    ...['uploading', 'waiting', 'rendering', 'studio_check', 'needs_recapture', 'retrying', 'failed'].map(state => ({ tours: [],
      rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job(state, { express: true, express_due_at: soon }) }]) } })),
    { tours: [], rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job('needs_recapture', { recapture: null }) }]) } },
    { tours: [], rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job('rendering', { step: 3, stale: true }) }]) } },
    ...offers.map(answer => ({ tours: [], rpc: { get_express_offer: async () => answer } })),
  ];
  for (const [index, options] of desks.entries()) assertNoStudio((await load(options)).visible(), 'desk ' + index);
  // The legacy state and the old express words are really gone, not merely unreached.
  const checking = await load({ tours: [], rpc: { list_workspace_render_status: async () => status([{ property_id: 'p1', job: job('studio_check') }]) } });
  assert.match(checking.visible(), /Step 5 of 5: Checking quality\./);
  const selling = await load({ tours: [], rpc: { get_express_offer: async () => offers[3] } });
  assert.match(selling.visible(), /Need it sooner\? Super fast render/);
  assert.match(selling.visible(), /ready in about 30 minutes, any day, any time\. If it isn’t, the A\$29 is refunded automatically\./);
  assert.doesNotMatch(selling.visible(), /taken today|full today/i);
  // Every refusal line after Approve and share.
  for (const message of ['tour uploader membership is no longer active', 'boom']) {
    const h = await load({ tours: [readyTour()], rpc: { enable_tour_share: async () => ({ error: { message } }) } });
    await approve(h);
    assertNoStudio(h.visible(), message);
  }
  // The static page and every quoted string in the script a customer could read.
  assertNoStudio(markup.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '), 'account/index.html');
  const strings = [...account.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1]);
  assertNoStudio(strings.join('\n'), 'account.js strings');
  assert.doesNotMatch(strings.join('\n'), /next business day|1 business day|Mon–Fri/i, 'account.js states no business-day turnaround');
});

/* ---- The share kit ------------------------------------------------------------ */

test('the Live card: Share opens the device’s share sheet with the listing title, beside Copy link and Open as your client', async () => {
  const h = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released()], share: async () => {} });
  const card = h.card('t1');
  assert.deepEqual(filled(card), ['Share']);
  assert.equal(byText(card, 'Open as your client').href, HANDOFF);
  // The row is the one filled button and Open as your client; Copy link sits beside the address, under Link.
  const row = card.all().find(el => el.className === 'tour-actions-row' && el.children.some(child => child.textContent === 'Share'));
  assert.deepEqual(row.children.map(child => child.textContent), ['Share', 'Open as your client']);
  assert.ok(byText(panelOf(card, 'link'), 'Copy link'));
  assert.equal(byText(card, 'Open as a visitor'), undefined);
  await byText(card, 'Share').fire('click');
  assert.deepEqual(h.shared, [{ title: 'Sample space', url: LINK }]);
  assert.deepEqual(h.copied, []);
  // Cancelling the sheet is not a failure; a sheet that cannot open copies instead.
  const cancel = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); } });
  await byText(cancel.card('t1'), 'Share').fire('click');
  assert.deepEqual(cancel.copied, []);
  const broken = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, share: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } });
  await byText(broken.card('t1'), 'Share').fire('click');
  assert.deepEqual(broken.copied, [LINK]);
  assert.equal(rowLine(broken.card('t1')), 'Link copied. Anyone with it can open or forward the walkthrough.');
  // Without a share sheet the filled button is Copy link.
  const desk = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true });
  assert.deepEqual(filled(desk.card('t1')), ['Copy link']);
  assert.equal(byText(desk.card('t1'), 'Share'), undefined);
  await byText(desk.card('t1'), 'Copy link').fire('click');
  assert.deepEqual(desk.copied, [LINK]);
  // The website steps and the one embed code are still there, behind Website.
  assert.equal(toggleOf(desk.card('t1'), 'website').textContent, 'Website');
  assert.ok(byText(panelOf(desk.card('t1'), 'website'), 'Copy embed code'));
});

test('Show QR code draws the code in this browser and saves a PNG named after the listing', async () => {
  const h = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released()],
    properties: [{ id: 'p1', title: '12 Rue Café & Co.', workspace_id: 'w1' }] });
  const card = h.card('t1');
  const qr = panelOf(card, 'qr');
  assert.equal(toggleOf(card, 'qr').textContent, 'QR code');
  assert.equal(qr.hidden, true, 'closed until asked for');
  const code = qr.all().find(el => el.className === 'tour-qr-code');
  const download = byText(qr, 'Download QR code (PNG)');
  assert.equal(code.innerHTML, undefined, 'nothing is drawn until it is opened');
  assert.equal(download.disabled, true);
  await openPanel(card, 'qr');
  assert.equal(qr.hidden, false);
  assert.match(code.innerHTML, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.match(code.innerHTML, /role="img" aria-label="QR code that opens 12 Rue Café &amp; Co\."/);
  assert.match(code.innerHTML, /<path fill="#10231d" d="M[^"]+"/);
  assert.equal(code.innerHTML, h.window.VeyletQR.svg(QR, { label: 'QR code that opens 12 Rue Café & Co.' }), 'the vendored generator draws it, for the live link tagged as the QR channel');
  assert.equal(download.disabled, false);
  await download.fire('click'); await settle();
  const anchor = h.created.find(el => el.tagName === 'A' && el.download);
  assert.equal(anchor.download, '12-rue-cafe-co-qr.png');
  assert.equal(anchor.clicked, 1);
  assert.equal(h.downloads[0].type, 'image/png');
  const canvas = h.created.find(el => el.tagName === 'CANVAS');
  const modules = h.window.VeyletQR.matrix(QR, 'M').size + 2 * h.window.VeyletQR.quietZone;
  assert.equal(canvas.width, canvas.height);
  assert.equal(canvas.width, modules * Math.floor(1024 / modules), 'whole pixels per module, up to 1024 square');
  assert.ok(canvas.painted > 100);
  assert.equal(rowLine(qr), 'QR code saved as 12-rue-cafe-co-qr.png.');
  // No image is fetched for it, from anywhere.
  assert.equal(h.created.some(el => el.tagName === 'IMG'), false);
  // Without the vendored generator: words, never a network service.
  const none = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, qr: false });
  const closed = await openPanel(none.card('t1'), 'qr');
  assert.equal(closed.all().find(el => el.className === 'tour-qr-code').textContent, 'The QR code couldn’t be made here. Copy the link instead.');
  assert.equal(byText(closed, 'Download QR code (PNG)').disabled, true);
});

test('the QR generator is the vendored file, loaded by a plain script tag, and no QR service is named', () => {
  const tags = [...markup.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(match => match[1]);
  const qr = tags.find(src => src.startsWith('/vendor/qrcode-1.5.4.min.js'));
  const version = crypto.createHash('sha256').update(qrcode).digest('hex').slice(0, 16);
  assert.equal(qr, '/vendor/qrcode-1.5.4.min.js?v=' + version);
  assert.ok(tags.indexOf(qr) < tags.findIndex(src => src.startsWith('/account.js')), 'before the desk script');
  for (const source of [account, markup]) assert.doesNotMatch(source, /qrserver|chart\.googleapis|quickchart|goqr|qr-code-generator/i);
});

/* ---- Offline -------------------------------------------------------------------- */

test('offline, the desk keeps its last status and says how old it is; back online it reads again', async () => {
  const rendering = { data: { active: true, spaces: [{ property_id: 'p1', job: { job_id: 'j1', property_id: 'p1', state: 'rendering', step: 2, attempts_allowed: 2 } }] } };
  let statusReply = rendering;
  const h = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, rpc: { list_workspace_render_status: async () => statusReply } });
  const said = h.ids['account-render-status'];
  assert.equal(h.timers.render.size, 1, 'rendering: the desk reads again in 10 s');
  const reads = h.tourReads();
  h.navigator.onLine = false;
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.equal(h.tourReads(), reads, 'nothing is read while the browser says it is offline');
  assert.match(said.textContent, /^You’re offline\. Showing the status from .+\.$/);
  assert.equal(said.hidden, false);
  assert.ok(h.card('t1'), 'the walkthrough is still on the page');
  assert.equal(h.ids['account-properties'].children.length, 1);
  assert.equal(h.timers.render.size, 0, 'and it stops reading');
  // The window's offline event says the same at once.
  const early = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: async () => rendering } });
  early.navigator.onLine = false; early.windowEvents.offline();
  assert.match(early.ids['account-render-status'].textContent, /^You’re offline\. Showing the status from /);
  assert.equal(early.timers.render.size, 0);
  // Back online: the desk reads again and the capture status carries on.
  h.navigator.onLine = true;
  h.windowEvents.online(); await settle();
  assert.equal(h.tourReads(), reads + 1);
  assert.equal(said.hidden, true);
  assert.equal(h.timers.render.size, 1, 'polling resumes');
  // A status read that never reached the server reads as offline, not as a failure.
  statusReply = { error: { message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch', hint: '', code: '' } };
  await h.poll();
  assert.match(said.textContent, /^You’re offline\. Showing the status from .+\.$/);
  // A server error keeps its own words.
  statusReply = { error: { message: 'upstream error', code: '500' } };
  await h.poll();
  assert.match(said.textContent, /^Render progress couldn’t be refreshed\./);
  // Part-way through a review, coming back online keeps the form and reads only the capture status.
  statusReply = rendering;
  const busy = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: async () => statusReply } });
  busy.navigator.onLine = false; busy.windowEvents.offline();
  const box = reviewForm(busy.card('t1')).all().find(el => el.type === 'checkbox'); box.checked = true;
  await busy.ids['account-properties'].fire('input');
  const before = [busy.tourReads(), busy.count('list_workspace_render_status')];
  busy.navigator.onLine = true; busy.windowEvents.online(); await settle();
  assert.equal(busy.tourReads(), before[0], 'the desk is not read over the form');
  assert.equal(busy.count('list_workspace_render_status'), before[1] + 1);
  assert.equal(box.checked, true);
  assert.equal(busy.ids['account-render-status'].hidden, true);
});

test('a desk read that never reached the server keeps the page; a server error still says so', async () => {
  const h = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true });
  h.table.properties = { error: { message: 'TypeError: Load failed', code: '' } };
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.match(h.ids['account-render-status'].textContent, /^You’re offline\. Showing the status from .+\.$/);
  assert.ok(h.card('t1'), 'the drawn walkthrough stays');
  assert.ok(byText(h.card('t1'), 'Copy link'), 'and its link can still be copied');
  await byText(h.card('t1'), 'Copy link').fire('click');
  assert.deepEqual(h.copied, [LINK], 'its controls still work');
  assert.doesNotMatch(h.visible(), /Spaces could not load/);
  // A thrown fetch error is the same.
  h.table.properties = () => { throw new TypeError('Failed to fetch'); };
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.ok(h.card('t1'));
  // A server error is not offline.
  h.table.properties = { error: { message: 'relation unavailable', code: '500' } };
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.match(h.visible(), /Spaces could not load\. Refresh the desk to try again\./);
  // The browser saying offline never stops a first read that works.
  const first = await load({ tours: [], onLine: false });
  assert.ok(first.ids['account-properties'].children.length > 0);
  // Offline before anything was drawn: say when the spaces come, and claim nothing.
  const cold = harness({ tours: [] });
  cold.table.properties = { error: { message: 'TypeError: Failed to fetch' } };
  await vm.runInNewContext(account, cold.context); await settle();
  assert.equal(cold.ids['account-render-status'].textContent, 'You’re offline. Your spaces load when you’re back online.');
  assert.equal(cold.ids['account-properties'].children.length, 0);
  assert.equal(cold.ids['account-next-step'].children.length, 0, 'no next step is guessed');
});

/* ---- What your clients see --------------------------------------------------- */

const CONTACT = { show_on_shared: false, display_name: null, agency: null, phone: null, email: null, updated_at: null };
const contactDesk = (row = CONTACT, options = {}) => load({ tours: [readyTour()], ...options,
  rpc: { get_workspace_public_contact: async () => ({ data: [row] }), ...options.rpc } });
const section = h => h.ids['account-contact'];
const field = (h, name) => h.ids['account-contact-body'].all().find(el => el.tagName === 'INPUT' && el.name === name);
const contactForm = h => h.ids['account-contact-body'].all().find(el => el.tagName === 'FORM');
const errorOf = (h, name) => { const input = field(h, name); const error = h.ids['account-contact-body'].all().find(el => el.id === input.id + '-error'); return error.hidden ? '' : error.textContent; };
const previewText = h => shownIn(h.ids['account-contact-body'].all().find(el => el.tagName === 'FIGURE')).map(el => el.textContent).filter(Boolean);
const contactSaid = h => { const line = h.ids['account-contact-body'].all().find(el => el.className === 'clients-said'); return line.hidden ? '' : line.textContent; };
async function type(h, name, value) { const input = field(h, name); input.value = value; if (input.type === 'checkbox') input.checked = value; await contactForm(h).fire('input', { target: input }); }
async function tick(h, value) { const box = field(h, 'show_on_shared'); box.checked = value; await contactForm(h).fire('change', { target: box }); }

test('What your clients see stays away until the backend has it, and waits in its own shape', async () => {
  const missing = await load({ tours: [readyTour()] });
  assert.equal(section(missing).hidden, true);
  assert.equal(missing.count('get_workspace_public_contact'), 1);
  const words = await load({ tours: [readyTour()], rpc: { get_workspace_public_contact: async () => ({ error: { message: 'Could not find the function public.get_workspace_public_contact(p_workspace_id) in the schema cache' } }) } });
  assert.equal(section(words).hidden, true);
  // A new account with no space yet has nothing to share, so nothing is asked.
  const empty = await load({ properties: [] });
  assert.equal(empty.count('get_workspace_public_contact'), 0);
  assert.equal(section(empty).hidden, true);
  const pending = await load({ tours: [], rpc: { get_workspace_public_contact: () => new Promise(() => {}) } });
  assert.equal(section(pending).hidden, false);
  assert.equal(section(pending).attributes['aria-busy'], 'true');
  assert.ok(pending.ids['account-contact-body'].all().some(el => el.textContent === 'Checking what clients see…'));
  assert.ok(pending.ids['account-contact-body'].all().some(el => /\bplan-skeleton\b/.test(el.className)));
  // A read that failed says so, with one way to try again.
  let fail = true;
  const broken = await load({ tours: [], rpc: { get_workspace_public_contact: async () => (fail ? { error: { message: 'boom', code: '500' } } : { data: [CONTACT] }) } });
  assert.ok(byText(broken.ids['account-contact-body'], 'Your contact details couldn’t be checked. Try again.'));
  fail = false;
  await byText(broken.ids['account-contact-body'], 'Try again').fire('click'); await settle();
  assert.ok(contactForm(broken));
  // The section sits after Your plan, before Capture, in source order.
  const home = markup.slice(markup.indexOf('id="account-home"'));
  assert.ok(home.indexOf('id="account-plan"') < home.indexOf('id="account-contact"') && home.indexOf('id="account-contact"') < home.indexOf('>First capture? See the steps<'));
  assert.match(markup, /<h2 class="dash-heading" id="account-contact-title">What your clients see<\/h2>/);
});

test('What your clients see: the switch, four labelled fields, and a card that follows what is typed', async () => {
  const h = await contactDesk();
  assert.equal(section(h).hidden, false);
  assert.deepEqual({ ...h.calls.find(([name]) => name === 'get_workspace_public_contact')[1] }, { p_workspace_id: 'w1' });
  const body = h.ids['account-contact-body'];
  const toggle = body.all().find(el => el.className === 'clients-show');
  assert.equal(toggle.tagName, 'LABEL', 'the whole label is the switch’s hit area');
  assert.equal(toggle.all().find(el => el.tagName === 'SPAN').textContent, 'Show on shared walkthroughs');
  assert.equal(field(h, 'show_on_shared').type, 'checkbox');
  const labels = body.all().filter(el => el.className === 'clients-field');
  assert.deepEqual(labels.map(label => [label.children[0].textContent, label.children[1].name, label.children[1].type, label.children[1].attributes.autocomplete]), [
    ['Name', 'display_name', 'text', 'name'], ['Agency', 'agency', 'text', 'organization'], ['Phone', 'phone', 'tel', 'tel'], ['Email', 'email', 'email', 'email']]);
  assert.equal(labels[0].children[0].tagName, 'SPAN', 'the label sits above its field');
  assert.deepEqual(filled(body), ['Save']);
  assert.deepEqual(previewText(h), ['Preview', 'Clients won’t see your details.']);
  await tick(h, true);
  assert.deepEqual(previewText(h), ['Preview', 'Your name']);
  await type(h, 'display_name', 'Ari Lee');
  await type(h, 'agency', 'Harbour Realty');
  await type(h, 'phone', '0400 000 000');
  assert.deepEqual(previewText(h), ['Preview', 'Ari Lee', 'Harbour Realty', 'Call']);
  await type(h, 'email', 'ari@example.com');
  assert.deepEqual(previewText(h), ['Preview', 'Ari Lee', 'Harbour Realty', 'Call', 'Email']);
  const card = body.all().find(el => el.tagName === 'FIGURE');
  assert.equal(card.all().some(el => ['BUTTON', 'A', 'INPUT'].includes(el.tagName)), false, 'nothing on the card can be pressed here');
  assert.equal(h.count('set_workspace_public_contact'), 0, 'typing saves nothing');
});

test('What your clients see: showing needs a name and a phone or email, said beside the fields and checked again as you type', async () => {
  const h = await contactDesk();
  await tick(h, true);
  assert.equal(errorOf(h, 'display_name'), '', 'nothing is said before the first save');
  await contactForm(h).fire('submit'); await settle();
  assert.equal(h.count('set_workspace_public_contact'), 0);
  assert.equal(errorOf(h, 'display_name'), 'Add the name clients should see.');
  assert.equal(errorOf(h, 'phone'), 'Add a phone number or an email address, so clients can reach you.');
  assert.equal(field(h, 'display_name').attributes['aria-invalid'], 'true');
  assert.equal(field(h, 'email').attributes['aria-invalid'], 'true');
  assert.equal(field(h, 'email').attributes['aria-describedby'], field(h, 'phone').id + '-error', 'one message, read from both fields');
  assert.equal(h.documentStub.activeElement, field(h, 'display_name'), 'focus goes to the first problem');
  await type(h, 'display_name', 'Ari Lee');
  assert.equal(errorOf(h, 'display_name'), '', 'fixed as it is typed');
  assert.equal(field(h, 'display_name').attributes['aria-invalid'], undefined);
  await type(h, 'phone', 'call me');
  assert.equal(errorOf(h, 'phone'), 'Use digits, spaces and + ( ) - only, up to 32 characters.');
  await type(h, 'phone', '+61 (7) 3000-0000');
  assert.equal(errorOf(h, 'phone'), '');
  assert.equal(field(h, 'email').attributes['aria-invalid'], undefined);
  await type(h, 'email', 'ari@example');
  assert.equal(errorOf(h, 'email'), 'Check the email address. It should look like name@example.com.');
  await type(h, 'email', '');
  // Hidden, nothing is required, but what is typed must still be well formed.
  await tick(h, false);
  await type(h, 'display_name', '');
  assert.equal(errorOf(h, 'display_name'), '');
  await type(h, 'phone', '12345678901234567890123456789012345');
  assert.equal(errorOf(h, 'phone'), 'Use digits, spaces and + ( ) - only, up to 32 characters.');
});

test('What your clients see: Save sends the whole contact and says what clients now see', async () => {
  const h = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async args => ({ data: [{ show_on_shared: args.p_show, display_name: args.p_display_name,
    agency: args.p_agency, phone: args.p_phone, email: args.p_email, updated_at: new Date().toISOString() }] }) } });
  await tick(h, true);
  await type(h, 'display_name', '  Ari Lee ');
  await type(h, 'phone', '0400 000 000');
  await contactForm(h).fire('submit'); await settle();
  assert.deepEqual({ ...h.calls.find(([name]) => name === 'set_workspace_public_contact')[1] },
    { p_workspace_id: 'w1', p_show: true, p_display_name: 'Ari Lee', p_agency: null, p_phone: '0400 000 000', p_email: null });
  assert.equal(contactSaid(h), 'Saved. Clients see this on every live walkthrough.');
  assert.equal(h.status(), 'Saved. Clients see this on every live walkthrough.');
  assert.equal(field(h, 'display_name').value, 'Ari Lee', 'the saved value, trimmed');
  await tick(h, false);
  assert.equal(contactSaid(h), '', 'a change after saving is not called saved');
  await contactForm(h).fire('submit'); await settle();
  assert.equal(contactSaid(h), 'Saved. Clients won’t see your details.');
  // A desk reload while typing never reads over what was typed.
  await type(h, 'agency', 'Harbour Realty');
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.equal(field(h, 'agency').value, 'Harbour Realty');
});

test('What your clients see: every error keeps what was typed; without permission it reads only', async () => {
  const failing = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => ({ error: { message: 'boom', code: '500' } }) } });
  await type(failing, 'display_name', 'Ari Lee');
  await contactForm(failing).fire('submit'); await settle();
  assert.equal(contactSaid(failing), 'Your details weren’t saved. Try again.');
  assert.equal(field(failing, 'display_name').value, 'Ari Lee');
  assert.equal(byText(failing.ids['account-contact-body'], 'Save').disabled, false);
  const offline = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => ({ error: { message: 'TypeError: Failed to fetch' } }) } });
  await type(offline, 'agency', 'Harbour Realty');
  await contactForm(offline).fire('submit'); await settle();
  assert.equal(contactSaid(offline), 'You’re offline, so your details weren’t saved. Save again when you’re back online.');
  assert.equal(field(offline, 'agency').value, 'Harbour Realty');
  // The server's own check lands on its field.
  const phone = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => ({ error: { message: 'phone must be up to 32 digits, spaces and + ( ) -' } }) } });
  await type(phone, 'phone', '0400 000 000');
  await contactForm(phone).fire('submit'); await settle();
  assert.equal(errorOf(phone, 'phone'), 'Use digits, spaces and + ( ) - only, up to 32 characters.');
  assert.equal(field(phone, 'phone').value, '0400 000 000');
  // Refused for permission: read-only, with who can change it, and nothing typed is lost.
  const refused = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => ({ error: { code: 'P0001', message: 'contact permission required' } }) } });
  await type(refused, 'display_name', 'Ari Lee');
  await contactForm(refused).fire('submit'); await settle();
  assert.equal(field(refused, 'display_name').value, 'Ari Lee');
  assert.equal(field(refused, 'display_name').readOnly, true);
  assert.equal(field(refused, 'show_on_shared').disabled, true);
  assert.equal(byText(refused.ids['account-contact-body'], 'Save'), undefined);
  assert.ok(byText(refused.ids['account-contact-body'], 'Ask the account owner to change this.'));
  assert.equal(refused.status(), 'Your details weren’t saved. Ask the account owner to change this.');
  // Someone who is not an owner or reviewer reads it from the start.
  const operator = await contactDesk({ ...CONTACT, show_on_shared: true, display_name: 'Ari Lee', phone: '0400 000 000' }, { role: 'operator' });
  assert.equal(field(operator, 'display_name').readOnly, true);
  assert.equal(byText(operator.ids['account-contact-body'], 'Save'), undefined);
  assert.ok(byText(operator.ids['account-contact-body'], 'Ask the account owner to change this.'));
  assert.deepEqual(previewText(operator), ['Preview', 'Ari Lee', 'Call']);
});

test('What your clients see: an expired sign-in signs out, and signing in again brings back what was typed', async () => {
  let expire = true;
  const h = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => (expire ? { error: { code: '401', message: 'JWT expired' } } : { data: [CONTACT] }) } });
  await type(h, 'display_name', 'Ari Lee');
  await type(h, 'email', 'ari@example.com');
  await contactForm(h).fire('submit'); await settle();
  assert.equal(h.ids['account-home'].hidden, true);
  assert.equal(h.status(), 'Your sign-in has expired, so your contact details weren’t saved. Sign in again to save them.');
  assert.equal(section(h).hidden, true, 'nothing of the account stays on the page');
  expire = false;
  h.supabase.auth.callback('SIGNED_IN', { user: { id: 'user-1', email: 'person@example.invalid' } }); await settle();
  assert.equal(field(h, 'display_name').value, 'Ari Lee');
  assert.equal(field(h, 'email').value, 'ari@example.com');
  assert.equal(contactSaid(h), 'Your details weren’t saved. Check them and press Save.');
  // Another account signing in on this page never sees them.
  const other = await contactDesk(CONTACT, { rpc: { set_workspace_public_contact: async () => ({ error: { code: '401', message: 'JWT expired' } }) } });
  await type(other, 'display_name', 'Ari Lee');
  await contactForm(other).fire('submit'); await settle();
  other.supabase.auth.callback('SIGNED_IN', { user: { id: 'user-9', email: 'other@example.invalid' } }); await settle();
  assert.equal(field(other, 'display_name').value, '');
});

test('the desk’s new controls and card reflow on a phone and keep 44px targets', () => {
  const css = read('dist/account-guide.css');
  assert.match(css, /\.veylet-form \.clients-show \{[^}]*min-height: 44px/);
  assert.match(css, /\.clients-preview-button \{[^}]*min-height: 44px/);
  assert.match(css, /\.tour-qr-code \{[^}]*width: min\(240px, 100%\)/);
  assert.match(css, /\.clients-preview-name \{[^}]*overflow-wrap: anywhere/);
  // New rules add no motion, so reduced motion has nothing more to stop.
  const added = css.slice(css.indexOf('/* Approved but not shared'), css.indexOf('/* Your plan: the same five facts'))
    + css.slice(css.indexOf('/* What your clients see'), css.indexOf('/* The side column'));
  assert.doesNotMatch(added, /transition|animation/);
});

/* ---- Pause and resume (the same link), listing URL, channel tags, views --------
 * pause_tour_share / resume_tour_share / get_tour_view_stats are the integrator
 * lane's 2026092610xxxx migration (not yet written): tours.share_paused_at is set
 * while a kept link is paused. Every answer here is a stand-in. */

const PAUSED = 'Paused. Within a minute, the link, embed and QR show "not available" until you resume; the link stays the same.';
const RESUMED = 'Sharing resumed. Within a minute, the same link, embed and QR open the walkthrough again.';
const liveTour = (fields = {}) => readyTour({ share_token: TOKEN, ...fields });
const manageOf = card => panelOf(card, 'manage');
const pausing = () => ({
  pause_tour_share: async (args, { tours }) => { tours.find(row => row.id === args.p_tour_id).share_paused_at = '2026-09-25T01:00:00Z'; return { data: null }; },
  resume_tour_share: async (args, { tours }) => { const row = tours.find(item => item.id === args.p_tour_id); row.share_paused_at = null; return { data: row.share_token }; },
});

test('Pause sharing sits first under Manage, unconfirmed and secondary; the paused card offers Resume, and the link never changes', async () => {
  const h = await load({ tours: [liveTour()], approved: true, hosting: [released()], rpc: pausing() });
  const manage = manageOf(h.card('t1'));
  const controls = manage.all().filter(el => el.tagName === 'BUTTON').map(el => el.textContent);
  assert.deepEqual(controls.slice(0, 2), ['Pause sharing', 'Turn off sharing'], 'pause first, the destructive one below it');
  const pause = byText(manage, 'Pause sharing');
  assert.doesNotMatch(pause.className, /primary|danger/, 'secondary');
  assert.ok(byText(manage, 'Stops the link, embed and QR for now and keeps the same link, so printed QR codes work again when you resume.'));
  await pause.fire('click'); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === 'pause_tour_share').map(([, args]) => args.p_tour_id), ['t1'], 'one press, no confirmation');
  const paused = h.card('t1');
  assert.equal(chipOf(paused).textContent, 'Paused');
  assert.equal(stateLine(paused), PAUSED);
  assert.equal(rowLine(paused), 'Sharing paused. Resume sharing opens the same link again.', 'said where it happened, without repeating the card’s line');
  assert.deepEqual(filled(paused), ['Resume sharing']);
  assert.equal(byText(paused, 'Copy link'), undefined, 'no share kit while paused');
  assert.equal(toggleOf(paused, 'qr'), null);
  assert.equal(toggleOf(paused, 'link'), null);
  assert.equal(byText(manageOf(paused), 'Pause sharing'), undefined);
  assert.ok(byText(manageOf(paused), 'Turn off sharing'), 'turning off stays available');
  assert.equal(h.ids['account-next-step'].children[0].textContent, 'Sharing is paused.');
  assert.equal(h.tours[0].share_token, TOKEN, 'the same link');
  await byText(paused, 'Resume sharing').fire('click'); await settle();
  assert.deepEqual(h.calls.filter(([name]) => name === 'resume_tour_share').map(([, args]) => args.p_tour_id), ['t1']);
  assert.equal(chipOf(h.card('t1')).textContent, 'Live');
  assert.equal(rowLine(h.card('t1')), RESUMED);
  assert.equal(h.count('enable_tour_share'), 0, 'resuming is not a new link');
  assert.deepEqual(filled(h.card('t1')), ['Copy link']);
});

test('Turn off sharing still warns of the new link, and points to Pause while it exists', async () => {
  const h = await load({ tours: [liveTour()], approved: true });
  await byText(manageOf(h.card('t1')), 'Turn off sharing').fire('click');
  assert.match(h.status(), /^Turning off sharing stops this link, its embed and any printed QR code for good\. Turning it back on makes a new link\. .*To stop it for now and keep the link, use Pause sharing instead\. Confirm to continue\.$/);
  const without = await load({ tours: [liveTour()], approved: true, pauseColumn: false });
  await byText(manageOf(without.card('t1')), 'Turn off sharing').fire('click');
  assert.doesNotMatch(without.status(), /Pause/);
  assert.match(without.status(), /Turning it back on makes a new link\./);
});

test('without the pause migration the desk reads as before: no Pause, and a press answered PGRST202 takes it away silently', async () => {
  const h = await load({ tours: [liveTour()], approved: true, pauseColumn: false });
  assert.equal(byText(h.card('t1'), 'Pause sharing'), undefined);
  assert.equal(chipOf(h.card('t1')).textContent, 'Live');
  assert.ok(byText(h.card('t1'), 'Copy link'));
  const gone = await load({ tours: [liveTour()], approved: true, rpc: { pause_tour_share: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.pause_tour_share(p_tour_id)' } }) } });
  const pause = byText(gone.card('t1'), 'Pause sharing');
  const reads = gone.tourReads();
  await pause.fire('click'); await settle();
  assert.equal(pause.parent.parent.hidden, true, 'the Pause row goes');
  assert.equal(gone.status(), '', 'nothing is said');
  assert.equal(gone.tourReads(), reads, 'and nothing is reloaded');
  // Any other failure says so and keeps the button.
  const failing = await load({ tours: [liveTour()], approved: true, rpc: { pause_tour_share: async () => ({ error: { message: 'boom' } }) } });
  await byText(failing.card('t1'), 'Pause sharing').fire('click'); await settle();
  assert.equal(failing.status(), 'Pausing was not confirmed. Refresh the desk to check before retrying.');
  assert.equal(byText(failing.card('t1'), 'Pause sharing').disabled, false);
});

test('a paused link reads Paused after a reload, and a render status that says Live gives way to the card', async () => {
  const h = await load({ tours: [liveTour({ share_paused_at: '2026-09-24T00:00:00Z' })], approved: true,
    rpc: { list_workspace_render_status: async () => ({ data: { active: false, spaces: [{ property_id: 'p1', job: { job_id: 'j1', property_id: 'p1', state: 'live', tour_id: 't1' } }] } }) } });
  assert.equal(chipOf(h.card('t1')).textContent, 'Paused');
  assert.equal(stateLine(h.card('t1')), PAUSED);
  assert.doesNotMatch(h.visible(), /Anyone with the link can open it\./, 'no Live line from the render status');
  const failing = await load({ tours: [liveTour({ share_paused_at: '2026-09-24T00:00:00Z' })], approved: true, rpc: { resume_tour_share: async () => ({ error: { message: 'boom' } }) } });
  await byText(failing.card('t1'), 'Resume sharing').fire('click'); await settle();
  assert.equal(failing.status(), 'Resuming was not confirmed. Refresh the desk to check before retrying.');
  assert.equal(chipOf(failing.card('t1')).textContent, 'Paused');
});

test('Copy link for portals and CRM gives portals and CRMs the unbranded /tour address, tagged as the portal channel', async () => {
  const h = await load({ tours: [liveTour()], approved: true });
  const card = h.card('t1');
  const row = card.all().find(el => el.className === 'tour-actions-row' && el.children.some(child => child.textContent === 'Copy link'));
  assert.deepEqual(row.children.map(child => child.textContent), ['Copy link', 'Open as your client'], 'the row: one filled button and the client view');
  // The portal and CRM link sits with the address, behind Link.
  const linkPanel = panelOf(card, 'link');
  assert.equal(toggleOf(card, 'link').textContent, 'Link');
  assert.equal(linkPanel.hidden, true);
  assert.ok(byText(linkPanel, 'Copy link for portals and CRM'));
  assert.ok(linkPanel.all().some(el => el.tagName === 'INPUT' && el.className === 'copy-field' && el.value === LINK), 'the address itself');
  const field = card.all().find(el => el.tagName === 'LABEL' && el.children[0]?.textContent === 'Link for portals and CRM');
  assert.equal(field.hidden, true, 'the address shows once asked for');
  await byText(card, 'Copy link for portals and CRM').fire('click');
  assert.deepEqual(h.copied, ['https://veylet.com/tour?t=' + TOKEN + '&src=portal']);
  assert.equal(field.hidden, false);
  assert.equal(rowLine(card), 'Link for portals and CRM copied. Paste it into the portal’s virtual tour field or your CRM. It shows the walkthrough only: no agent card, links or QR code.');
  // The embed code's frame and its direct link carry the embed channel; the rest is VeyletSharing's code.
  const code = card.all().find(el => el.tagName === 'TEXTAREA').value;
  assert.match(code, new RegExp('<iframe src="https://veylet\\.com/embed\\?t=' + TOKEN + '&src=embed" '));
  assert.match(code, new RegExp('<a href="https://veylet\\.com/handoff\\?t=' + TOKEN + '&src=embed" '));
  assert.equal(code.replace(/&src=embed/g, ''), h.window.VeyletSharing.embedCode(TOKEN));
  // The link field and Open as your client.
  assert.equal(card.all().find(el => el.tagName === 'INPUT' && el.className === 'copy-field').value, LINK);
  assert.equal(byText(card, 'Open as your client').href, HANDOFF, 'the agent’s own look is untagged');
});

test('views: opens with the last day and the Call and Email taps, under the state line; hidden while the backend has none', async () => {
  const stats = { opens: 14, days_with_opens: 5, call_taps: 3, email_taps: 1, share_taps: 2, by_src: { link: 8, qr: 4 }, by_host: {}, last_opened_at: '2026-09-24T02:00:00Z' };
  const h = await load({ tours: [liveTour()], approved: true, hosting: [released()], rpc: { get_tour_view_stats: async () => ({ data: [stats] }) } });
  await settle();
  const card = h.card('t1');
  const views = card.all().find(el => el.className === 'tour-views');
  assert.equal(views.hidden, false);
  assert.equal(views.textContent, '14 opens · 3 calls · 1 email · last 24 Sep 2026');
  assert.equal(views.parent.className, 'tour-meta-row', 'one line, ending the card’s first row');
  assert.equal(views.parent.children.at(-1), views);
  assert.deepEqual(h.calls.filter(([name]) => name === 'get_tour_view_stats').map(([, args]) => args.p_tour_id), ['t1']);
  const once = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => ({ data: [{ ...stats, opens: 1 }] }) } });
  await settle();
  assert.equal(once.card('t1').all().find(el => el.className === 'tour-views').textContent, '1 open · 3 calls · 1 email · last 24 Sep 2026');
  const none = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => ({ data: [{ ...stats, opens: 0, call_taps: 0, email_taps: 0, last_opened_at: null }] }) } });
  await settle();
  assert.equal(none.card('t1').all().find(el => el.className === 'tour-views').textContent, 'Not opened yet.');
  // PGRST202: hidden, and not asked again on the next read. An error or an odd answer: hidden.
  const missing = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await settle();
  assert.equal(missing.card('t1').all().find(el => el.className === 'tour-views').hidden, true);
  await missing.ids['account-refresh'].fire('click'); await settle();
  assert.equal(missing.count('get_tour_view_stats'), 1);
  for (const reply of [{ error: { message: 'boom' } }, { data: [{ opens: -1 }] }, { data: [] }]) {
    const odd = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => reply } });
    await settle();
    assert.equal(odd.card('t1').all().find(el => el.className === 'tour-views').hidden, true, JSON.stringify(reply));
    assert.doesNotMatch(odd.visible(), /\d opens?\b|Not opened/);
  }
  // Only a card with a link asks.
  const draft = await load({ tours: [readyTour()], approved: true });
  await settle();
  assert.equal(draft.count('get_tour_view_stats'), 0);
});

/* ---- The page the app opens (/app/account): the same desk in app mode ------------ */

const appMarkup = read('dist/app/account/index.html');
const MONEY = ['get_trial_offer', 'get_pack_offer', 'get_members_annual_offer', 'get_express_offer', 'get_referral_code', 'get_walkthrough_capacity'];
const BANNED = [/A\$/, /\$/, /\bpacks?\b/i, /super[\s-]*fast/i, /\bexpress\b/i, /\/offer\b/i, /pric(?:e|ing)/i];

test('app mode: the plan is its state in words, and no money function is even asked', async () => {
  const plan = { status: 'active', plan_code: 'solo', source: 'web', billing_interval: 'monthly', price_aud_cents: 9900, renewal_price_aud_cents: 9900,
    current_period_ends_at: '2026-10-25T00:00:00Z', auto_renews: true, included_per_month: 2, accepted_this_period: 1, hosting_included: true };
  const answers = Object.fromEntries(MONEY.map(name => [name, async () => ({ data: [{ available: true }] })]));
  const h = await load({ markup: appMarkup, tours: [liveTour()], approved: true, hosting: [released({ plan_active: false, hosting_state: 'offline_on', offline_on: '2027-03-01' })],
    rpc: { ...answers, get_workspace_plan: async () => ({ data: [plan] }) } });
  await settle();
  for (const name of MONEY) assert.equal(h.count(name), 0, name);
  assert.equal(h.count('get_workspace_plan'), 1);
  const body = h.ids['account-plan-body'];
  assert.deepEqual(body.all().filter(el => el.tagName === 'DT' || el.tagName === 'DD').map(el => el.textContent), ['State', 'Active']);
  assert.ok(byText(body, 'See your plan in the app.'));
  // The hosting line keeps its date and names no purchase path: the plan restarts in the app.
  assert.equal(h.card('t1').all().find(el => el.className === 'tour-hosting-words').textContent,
    'Your plan has ended. This walkthrough goes offline on 1 Mar 2027. Restart your plan in the app to keep it live.');
  assert.equal(byText(h.card('t1'), 'Full website guide'), undefined, 'no link out to the public site');
  const text = h.visible();
  for (const pattern of BANNED) assert.doesNotMatch(text, pattern);
  // The app never names the hosting extension: no request, in any state, and an extended walkthrough is just online until a day.
  assert.doesNotMatch(h.all().map(el => el.textContent).join('\n'), /extension|A\$49/i);
  assert.equal(h.all().some(el => el.dataset.control === 'hosting-extension'), false);
  const extended = await load({ markup: appMarkup, tours: [liveTour()], approved: true,
    hosting: [released({ plan_active: false, hosting_state: 'live_with_extension', offline_on: '2027-10-01', extended_until: '2027-10-01T00:00:00Z' })] });
  assert.equal(extended.card('t1').all().find(el => el.className === 'tour-hosting-words').textContent, 'Online until 1 Oct 2027.');
  assert.doesNotMatch(extended.all().map(el => el.textContent).join('\n'), /extension|A\$|\$\d/i);
  // Every plan state reads as its word; an unreadable one says so, with a refresh.
  for (const [status, word] of [['pending', 'Not started'], ['trial', 'Free months'], ['ended', 'Ended']]) {
    const other = await load({ markup: appMarkup, rpc: { get_workspace_plan: async () => ({ data: [{ ...plan, status }] }) } });
    await settle();
    assert.equal(other.ids['account-plan-body'].all().find(el => el.tagName === 'DD').textContent, word);
  }
  const broken = await load({ markup: appMarkup, rpc: { get_workspace_plan: async () => ({ error: { message: 'boom' } }) } });
  await settle();
  assert.equal(broken.ids['account-plan-body'].all().find(el => el.tagName === 'DD').textContent, 'Status unavailable');
  assert.ok(byText(broken.ids['account-plan-body'], 'Refresh plan status'));
});

test('app mode: a refusal at approval, an empty desk and the next-step links stay inside the app', async () => {
  const blocked = await load({ markup: appMarkup, tours: [readyTour()], rpc: { review_tour_versioned: async () => ({ error: { details: 'VEYLET_WALKTHROUGH_CAPACITY_EXHAUSTED', message: 'Your included walkthroughs are used.' } }) } });
  await approve(blocked);
  assert.equal(blocked.status(), 'This walkthrough was not accepted. Your plan’s walkthroughs are used; see your plan in the app, or Veylet support can confirm available capacity. No charge was created. Start a fresh review after capacity is confirmed.');
  const empty = await load({ markup: appMarkup, properties: [] });
  const next = empty.ids['account-next-step'];
  assert.deepEqual(next.children.map(el => el.textContent), ['Start with one space.', 'Create a space in Veylet Capture and capture it room by room. Its walkthrough appears here, ready for your review.']);
  assert.match(empty.visible(), /No spaces yet\. Create one in Veylet Capture; its walkthrough appears here\./);
  // A space with nothing sent yet: the public first-tour guide is not linked.
  const fresh = await load({ markup: appMarkup, tours: [] });
  assert.equal(fresh.ids['account-next-step'].all().some(el => el.tagName === 'A'), false);
  // The public desk keeps its link.
  const publicDesk = await load({ tours: [] });
  assert.equal(publicDesk.ids['account-next-step'].all().find(el => el.tagName === 'A').href, '/start');
});

test('the public desk is unchanged by app mode: its plan panel, offers and website guide stay', async () => {
  const h = await load({ tours: [liveTour()], approved: true });
  await settle();
  assert.ok(h.count('get_pack_offer') >= 1 || h.count('get_trial_offer') >= 1, 'the public desk still asks for its offers');
  assert.ok(byText(h.card('t1'), 'Full website guide'));
});

/* ---- Why a capture waits (hold) and the quality check's advice (review_flags) -------
 * Migration 20260926110000_admission_and_gate_policy.sql (not released): a queued job
 * carries hold {reason: admission | paused | weekly_limit, until}; a ready one carries
 * review_flags [{room, reason}], advice that never blocks approval. */

const renderAnswer = job => async () => ({ data: { active: job.state !== 'ready_for_review', spaces: [{ property_id: 'p1', job: { job_id: 'j1', property_id: 'p1', attempts_allowed: 2, ...job } }] } });
const renderBlockOf = h => h.ids['account-properties'].all().find(el => /\brender-block\b/.test(el.className));
const textOf = el => [el, ...el.all()].map(node => node.textContent).filter(Boolean).join(' ');

test('a held capture stays Waiting to render with the contract’s words for its hold, no failure and nothing to press', async () => {
  const words = {
    admission: 'We’ll start your render as soon as a rendering place opens for your account.',
    paused: 'Rendering is paused for a moment. Yours keeps its place in line.',
    weekly_limit: 'You’ve used this week’s renders. This one starts on 2 Oct 2026.',
  };
  for (const [reason, said] of Object.entries(words)) {
    const hold = { reason, until: reason === 'weekly_limit' ? '2026-10-02T03:00:00Z' : null };
    const h = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ state: 'waiting', status: 'queued', queue_position: 3, typical_start_minutes: 40, hold }) } });
    const block = renderBlockOf(h);
    assert.equal(block.dataset.state, 'waiting', reason);
    assert.equal(block.all().find(el => el.className === 'render-title').textContent, 'Waiting to render');
    const lines = block.all().filter(el => /\brender-line\b/.test(el.className)).map(el => el.textContent);
    assert.deepEqual(lines, [said], reason + ': the hold instead of the place in line and the minutes');
    assert.equal(block.all().some(el => el.tagName === 'BUTTON' || el.tagName === 'A'), false, reason + ': nothing to press');
    assert.doesNotMatch(textOf(block), /Failed|Try again|Retry|Contact Veylet support|You’re \d|Usually starts/, reason);
    assert.equal(h.ids['account-next-step'].children[0].textContent, 'Your capture is waiting to start.', reason);
    assert.equal(h.ids['account-next-step'].children[1].textContent, said + ' It shows on Sample space below.');
  }
  // A weekly limit without a readable date, and a hold this page does not know.
  const undated = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ state: 'waiting', status: 'queued', hold: { reason: 'weekly_limit', until: 'soon' } }) } });
  assert.match(textOf(renderBlockOf(undated)), /You’ve used this week’s renders\. This one starts as soon as the week allows another\./);
  const strange = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ state: 'waiting', status: 'queued', queue_position: 3, hold: { reason: 'weather' } }) } });
  assert.match(textOf(renderBlockOf(strange)), /You’re 3rd in line\./, 'an unknown hold reads as a place in line');
});

/* ---- Offer 2026-09-26.3 (20260926140000): rooms, and the free months' render attempts ---- */

test('each capture and its review say how many rooms it has and the walkthroughs its approval uses; unknown rooms say nothing', async () => {
  for (const [rooms, used, words] of [[1, 1, '1 room · uses 1 walkthrough'], [8, 1, '8 rooms · uses 1 walkthrough'],
    [9, 2, '9 rooms · uses 2 walkthroughs'], [17, 3, '17 rooms · uses 3 walkthroughs']]) {
    const h = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1', rooms, walkthroughs_used: used }) } });
    await settle();
    assert.equal(renderBlockOf(h).all().find(el => /\brender-units\b/.test(el.className)).textContent, words);
    const line = reviewForm(h.card('t1')).all().find(el => /tour-review-units/.test(el.className));
    assert.equal(line.hidden, false, words);
    assert.equal(line.textContent, words);
    // Also on a capture still on its way.
    const waiting = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ state: 'waiting', status: 'queued', queue_position: 2, rooms, walkthroughs_used: used }) } });
    assert.equal(renderBlockOf(waiting).all().find(el => /\brender-units\b/.test(el.className)).textContent, words);
  }
  // Rooms not counted yet (null), an odd count or no walkthroughs used: nothing, and approval still works (it uses 1).
  for (const fields of [{ rooms: null, walkthroughs_used: 1 }, { rooms: 9, walkthroughs_used: null }, { rooms: -1, walkthroughs_used: 1 }, { rooms: 3, walkthroughs_used: 0 }, {}]) {
    const h = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1', ...fields }) } });
    await settle();
    assert.equal(renderBlockOf(h).all().some(el => /\brender-units\b/.test(el.className)), false, JSON.stringify(fields));
    assert.equal(reviewForm(h.card('t1')).all().find(el => /tour-review-units/.test(el.className)).hidden, true);
    assert.doesNotMatch(textOf(h.card('t1')), /rooms? ·/);
  }
  const approving = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1', rooms: null, walkthroughs_used: 1 }) } });
  await settle();
  await approve(approving);
  assert.ok(approving.calls.some(([name]) => name === 'review_tour_versioned'));
});

test('a paused walkthrough (render state paused) says so on its card and offers Resume sharing; the queue’s global pause keeps its own line', async () => {
  const PAUSED = 'Paused. Within a minute, the link, embed and QR show "not available" until you resume; the link stays the same.';
  const resumed = [];
  const h = await load({ tours: [liveTour({ share_paused_at: '2026-09-26T00:00:00Z' })], approved: true,
    rpc: { list_workspace_render_status: renderAnswer({ state: 'paused', status: 'awaiting_review', tour_id: 't1', share_paused: true }),
      resume_tour_share: async args => { resumed.push({ ...args }); return { data: TOKEN }; } } });
  await settle();
  const block = renderBlockOf(h);
  assert.equal(block.all().find(el => el.className === 'render-title').textContent, 'Paused');
  assert.deepEqual(block.all().filter(el => /\brender-line\b/.test(el.className)).map(el => el.textContent), [PAUSED]);
  const resume = block.all().find(el => el.dataset.control === 'render-resume-share');
  assert.equal(resume.textContent, 'Resume sharing');
  await resume.fire('click'); await settle();
  assert.deepEqual(resumed, [{ p_tour_id: 't1' }]);
  // A server before the draft: a live row whose share_paused is true reads the same.
  const older = await load({ tours: [liveTour()], approved: true,
    rpc: { list_workspace_render_status: renderAnswer({ state: 'live', status: 'awaiting_review', tour_id: 't1', share_paused: true }) } });
  await settle();
  assert.equal(renderBlockOf(older).all().find(el => el.className === 'render-title').textContent, 'Paused');
  // Someone who may not share reads the state without the button.
  const operator = await load({ role: 'operator', tours: [liveTour({ share_paused_at: '2026-09-26T00:00:00Z' })], approved: true,
    rpc: { list_workspace_render_status: renderAnswer({ state: 'paused', status: 'awaiting_review', tour_id: 't1', share_paused: true }) } });
  await settle();
  assert.equal(renderBlockOf(operator).all().some(el => el.dataset.control === 'render-resume-share'), false);
  // Not the render queue's global pause: that is a waiting capture with its own words.
  const queue = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ state: 'waiting', status: 'queued', hold: { reason: 'paused', until: null } }) } });
  assert.deepEqual(renderBlockOf(queue).all().filter(el => /\brender-line\b/.test(el.className)).map(el => el.textContent),
    ['Rendering is paused for a moment. Yours keeps its place in line.']);
});

test('a failed attempt never shows the walkthrough count that acceptance would use, including when recapture is required', async () => {
  // This covers the failed attempt only; it does not waive the next accepted capture.
  for (const job of [{ state: 'failed', status: 'failed' }, { state: 'needs_recapture', status: 'awaiting_review', recapture: [{ room: 'Kitchen', reason: 'Too dark' }] }]) {
    const h = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer({ ...job, rooms: 9, walkthroughs_used: 2 }) } });
    assert.equal(renderBlockOf(h).all().some(el => /\brender-units\b/.test(el.className)), false, job.state);
    assert.doesNotMatch(textOf(renderBlockOf(h)), /uses 2 walkthroughs/, job.state);
  }
});

test('an older trial_limit hold stays waiting, ignores the retired billing trigger, and offers only a safe check or support', async () => {
  const trial = { status: 'trial', plan_code: 'solo', source: 'web', billing_interval: 'monthly', trial_started_at: '2026-09-01T00:00:00Z',
    trial_ends_at: '2026-12-01T00:00:00Z', trial_included_walkthroughs: 6, accepted_in_free_months: 1, auto_renews: true, renewal_price_aud_cents: 9900 };
  const words = 'Your current offer has no render-attempt cap. Check again now; if this capture still waits, contact Veylet support.';
  // Older servers can still send the retired date, message and billing flag. The desk ignores all three.
  const job = { state: 'waiting', status: 'queued', queue_position: 3, typical_start_minutes: 40,
    hold: { reason: 'trial_limit', until: '2026-12-01T00:00:00+10:00', plan_starts_on: '2026-12-01',
      message: 'Legacy trial-limit hold from an older backend.', start_plan_now: true } };
  const h = await load({ tours: [], rpc: { list_workspace_render_status: renderAnswer(job), get_workspace_plan: async () => ({ data: [trial] }) } });
  await settle();
  const block = renderBlockOf(h);
  assert.equal(block.dataset.state, 'waiting');
  assert.equal(block.all().find(el => el.className === 'render-title').textContent, 'Waiting to render');
  assert.deepEqual(block.all().filter(el => /\brender-line\b/.test(el.className)).map(el => el.textContent), [words]);
  assert.equal(block.all().find(el => /\bpill\b/.test(el.className || '')).textContent, 'Automatic');
  assert.doesNotMatch(textOf(block), /Failed|12 render attempts|1 Dec 2026|Legacy trial-limit hold|Start my plan|charged today|invoice|You’re \d|Usually starts/i);
  assert.equal(block.all().some(el => el.dataset.control === 'start-plan-today'), false);
  const check = block.all().find(el => el.dataset.control === 'render-check-again');
  const support = block.all().find(el => el.dataset.control === 'contact');
  assert.equal(check.textContent, 'Check again');
  assert.equal(support.textContent, 'Contact Veylet support');
  assert.match(support.href, /^mailto:support@veylet\.com\?/);
  assert.deepEqual(h.ids['account-next-step'].children.map(el => el.textContent),
    ['Your capture is waiting to start.', words + ' Use Check again or Contact Veylet support on Sample space below.']);
  assert.equal(h.count('get_start_plan_now') + h.count('start_plan_now'), 0);
  const reads = h.count('list_workspace_render_status');
  await check.fire('click'); await settle();
  assert.equal(h.count('list_workspace_render_status'), reads + 1, 'Check again only reloads render status');
  assert.equal(h.count('get_start_plan_now') + h.count('start_plan_now'), 0);
  // /app/account: the same compatibility words and read-only/support actions, with no purchase path.
  const app = await load({ markup: appMarkup, tours: [], rpc: { list_workspace_render_status: renderAnswer(job), get_workspace_plan: async () => ({ data: [trial] }) } });
  await settle();
  const appBlock = renderBlockOf(app);
  assert.deepEqual(appBlock.all().filter(el => /\brender-line\b/.test(el.className)).map(el => el.textContent), [words]);
  assert.equal(appBlock.all().find(el => el.dataset.control === 'render-check-again').textContent, 'Check again');
  assert.equal(appBlock.all().find(el => el.dataset.control === 'contact').textContent, 'Contact Veylet support');
  assert.equal(appBlock.all().some(el => el.dataset.control === 'start-plan-today'), false);
  assert.equal(app.count('get_start_plan_now') + app.count('start_plan_now'), 0);
  assert.deepEqual(app.ids['account-next-step'].children.map(el => el.textContent),
    ['Your capture is waiting to start.', words + ' Use Check again or Contact Veylet support on Sample space below.']);
  for (const pattern of BANNED) assert.doesNotMatch(app.visible(), pattern);
});

const GATE = {
  photo_match: 'The 3D walkthrough does not match the photos closely enough (blur or movement). Recapture it moving slowly with the phone steady.',
  coverage: 'Parts of this room were not photographed from where you stood. Recapture it, turning a full circle at each spot.',
  few_views: 'Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.',
  floaters: 'Stray smudges float in the air of the 3D walkthrough. Recapture moving slowly, with the lights on and nothing moving.',
  no_floor: 'We could not find a clear floor to walk on here. Recapture it, including the floor and doorways.',
  not_connected: 'We could not find a clear path on the floor from here to the other rooms. Recapture the doorway and the floor between rooms.',
};
const flagsOf = card => card.all().find(el => el.className === 'tour-flags');

test('the review shows the quality check’s advice as plain lines just above Approve and share, and approving still works', async () => {
  const review_flags = [
    { room: 'Kitchen', reason: GATE.photo_match }, { room: 'Living room', reason: GATE.coverage }, { room: 'Bedroom 1', reason: GATE.few_views },
    { room: 'Bathroom', reason: GATE.floaters }, { room: 'Hallway', reason: GATE.no_floor }, { room: '', reason: GATE.not_connected },
    { room: 'Kitchen', reason: GATE.photo_match }, { room: 'Garage', reason: 'A check this page has never heard of.' }, { room: 'Study', rule: 'coverage', reason: 'x' },
  ];
  const h = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1', review_flags }) } });
  await settle();
  const form = reviewForm(h.card('t1'));
  const flags = flagsOf(h.card('t1'));
  assert.equal(flags.hidden, false);
  assert.equal(flags.children[0].textContent, 'Worth a look before you share');
  assert.deepEqual(flags.children[1].children.map(el => el.textContent), [
    'Kitchen: some areas may look blurry', 'Living room: some corners may be missing', 'Bedroom 1: few photos were taken here, so detail may be thin',
    'Bathroom: there may be stray smudges in the air', 'Hallway: the floor may be hard to walk on', 'Walking on to the next room may not work',
    'Garage: worth a closer look', 'Study: some corners may be missing']);
  assert.equal(flags.children[2].textContent, 'Open the preview to check these areas. They never stop you approving.');
  // One-press approval: the advice, then what approving uses, then the one tick, then Approve and share.
  const order = form.children.map(el => el.className || el.textContent);
  assert.ok(order.indexOf('tour-flags') < order.indexOf('tour-state-help tour-review-units'), 'advice first');
  assert.equal(order.indexOf('tour-state-help tour-review-units') + 1, order.indexOf('review-steps'), 'then the numbered steps');
  const steps = form.children.find(el => el.className === 'review-steps').children;
  assert.equal(steps[1].children[0].className, 'review-right', 'the one tick is step 2');
  assert.equal(steps[2].children[0].textContent, 'Approve and share', 'Approve and share is step 3, right after the tick');
  assert.doesNotMatch(textOf(flags), /Recapture|Needs recapture|failed/i, 'advice, not the recapture words');
  await approve(h);
  assert.deepEqual(h.calls.filter(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)).map(([name]) => name), ['review_tour_versioned', 'enable_tour_share'], 'flags never block');
  // None: no block at all. A flag for another walkthrough stays on its own card.
  const none = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't1', review_flags: [] }) } });
  await settle();
  assert.equal(flagsOf(none.card('t1')), undefined);
  assert.doesNotMatch(none.visible(), /Worth a look/);
  const other = await load({ tours: [readyTour()], rpc: { list_workspace_render_status: renderAnswer({ state: 'ready_for_review', status: 'awaiting_review', tour_id: 't9', review_flags }) } });
  await settle();
  assert.doesNotMatch(other.visible(), /Worth a look/);
});

test('app mode: the review preview opens /play with from=app, so its links stay on the app’s pages', async () => {
  const h = await load({ markup: appMarkup, tours: [readyTour()] });
  assert.match(byText(h.card('t1'), 'Preview').href, /^\/play\/\?id=t1&review_revision=a{64}&from=app$/);
  const site = await load({ tours: [readyTour()] });
  assert.match(byText(site.card('t1'), 'Preview').href, /^\/play\/\?id=t1&review_revision=a{64}$/);
});

test('Walkthrough insights & vendor report, open-home QR sign card and pre-capture readiness kit work on the desk', async () => {
  const stats = {
    opens: 14,
    days_with_opens: 5,
    call_taps: 3,
    email_taps: 1,
    share_taps: 2,
    avg_dwell_seconds: 105,
    by_src: { link: 8, qr: 4, embed: 2 },
    by_host: { 'harbourrealty.com.au': 2 },
    by_room: { Kitchen: 9, 'Living room': 7 },
    last_opened_at: '2026-09-24T02:00:00Z',
  };
  const h = await load({
    tours: [liveTour()],
    approved: true,
    hosting: [released()],
    properties: [{ id: 'p1', title: '12 Rue Café & Co.', location_general: 'Paddington QLD', workspace_id: 'w1' }],
    rpc: { get_tour_view_stats: async () => ({ data: [stats] }) },
  });
  await settle();
  const card = h.card('t1');

  // 1. Walkthrough insights & vendor report disclosure.
  assert.equal(toggleOf(card, 'insights').textContent, 'Insights');
  assert.equal(toggleOf(card, 'insights').hidden, false, 'offered once the counts are read');
  const insights = await openPanel(card, 'insights');
  assert.equal(insights.hidden, false);
  // One sentence to repeat to a vendor leads; the figures, rooms and channels follow it.
  const insightTexts = className => insights.all().filter(el => el.className === className).map(el => el.textContent);
  assert.equal(insights.children[0].children[0].className, 'tour-insights-lead', 'the sentence comes first');
  assert.deepEqual(insightTexts('tour-insights-lead'),
    ['Opened 14 times on 5 days, for 1m 45s on average. The call button was tapped 3 times and the email button once.']);
  // The all-time figures under their one period line; the calls and emails behind Enquiries are said under it, link shares under the row.
  assert.deepEqual(insightTexts('tour-insights-scope'), ['All time, every version · last opened 24 Sep 2026', 'Last 90 days, every version']);
  assert.deepEqual(insights.all().find(el => el.className === 'tour-insights-figures').children.map(group => group.children.map(el => el.textContent)),
    [['Opens', '14'], ['Days active', '5'], ['Enquiries', '4', '3 calls, 1 email']]);
  // The average is of the last 90 days, so it is said in that group, not beside the all-time counts.
  assert.deepEqual(insightTexts('tour-insights-dwell'), ['Average time per visit: 1m 45s']);
  assert.deepEqual(insightTexts('tour-insights-shares'), ['Link shares: 2']);
  assert.deepEqual(insightTexts('tour-insights-channels'), ['Opened from: Direct link 8 (57%) · QR code 4 (29%) · Website embed 2 (14%)']);
  assert.equal(insights.all().find(el => el.className === 'tour-insights-hosts').textContent,
    'Embedded on: harbourrealty.com.au (2)');
  // No viewing time by room in this answer: the rooms are ranked by visits, and say so.
  assert.deepEqual(insightTexts('tour-insights-title'), ['Rooms by visits']);
  assert.deepEqual(insights.all().filter(el => el.tagName === 'TH' && el.getAttribute('scope') === 'col').map(el => el.textContent), ['Room', 'Visits']);
  assert.deepEqual(insights.all().filter(el => el.className === 'tour-insights-room').map(row => row.children.map(el => el.textContent)),
    [['Kitchen', '9'], ['Living room', '7']]);

  const copyReport = insights.all().find(el => el.dataset.control === 'copy-vendor-report');
  await copyReport.fire('click');
  await settle();
  assert.match(h.copied.at(-1), /^Walkthrough update: 12 Rue Café & Co\.\nOpened 14 times on 5 days, for 1m 45s on average\. The call button was tapped 3 times and the email button once\.\n\n/, 'the report opens with the same sentence');
  assert.match(h.copied.at(-1), /\nOpens: 14 on 5 days, last opened 24 Sep 2026\nAverage time: 1m 45s\nEnquiries: 3 calls, 1 email · Link shares: 2\nOpened from: Direct link 8 \(57%\) · QR code 4 \(29%\) · Website embed 2 \(14%\)\nEmbedded on: harbourrealty\.com\.au \(2\)\nVisits by room: Kitchen 9 · Living room 7$/);
  assert.equal(rowLine(insights), 'Vendor report copied. Paste it into your vendor update.');

  const dlReport = insights.all().find(el => el.dataset.control === 'download-vendor-report');
  await dlReport.fire('click');
  await settle();
  const reportAnchor = h.created.filter(el => el.tagName === 'A' && el.download).at(-1);
  assert.equal(reportAnchor.download, '12-rue-cafe-co-vendor-report.txt');
  assert.equal(rowLine(insights), 'Vendor report saved as 12-rue-cafe-co-vendor-report.txt.');

  // 2. Open-home QR sign card download.
  const qr = await openPanel(card, 'qr');
  assert.equal(insights.hidden, true, 'one panel open at a time');
  assert.equal(toggleOf(card, 'insights').attributes['aria-expanded'], 'false');
  const signDl = qr.all().find(el => el.dataset.control === 'qr-sign-download');
  assert.equal(signDl.disabled, false);
  await signDl.fire('click');
  await settle();
  const signAnchor = h.created.filter(el => el.tagName === 'A' && el.download).at(-1);
  assert.equal(signAnchor.download, '12-rue-cafe-co-open-home-sign.png');
  const signCanvas = h.created.filter(el => el.tagName === 'CANVAS').at(-1);
  assert.deepEqual([signCanvas.width, signCanvas.height], [1200, 1600]);
  assert.equal(rowLine(qr), 'Open-home sign saved as 12-rue-cafe-co-open-home-sign.png.');

  // 3. Pre-capture readiness kit on the space card.
  const space = h.ids['account-properties'].children[0];
  const prep = space.all().find(el => el.className === 'account-details space-prep');
  assert.ok(prep);
  assert.equal(prep.children[0].textContent, 'Prepare a capture', 'named for what it does: nothing is scheduled with Veylet here');
  assert.ok(space.children.indexOf(prep) < space.children.findIndex(el => el.tagName === 'UL'), 'in the space head, before its walkthroughs');
  prep.open = true;
  await prep.fire('toggle');
  const copyPrep = prep.all().find(el => el.dataset.control === 'copy-prep-note');
  await copyPrep.fire('click');
  await settle();
  assert.match(h.copied.at(-1), /we are preparing to capture the 3D walkthrough for 12 Rue Café & Co\./);
  assert.equal(rowLine(prep), 'Prep checklist copied. Send it to the owner or tenant before capture.');

  const dlIcs = prep.all().find(el => el.dataset.control === 'download-capture-ics');
  await dlIcs.fire('click');
  await settle();
  const icsAnchor = h.created.filter(el => el.tagName === 'A' && el.download).at(-1);
  assert.equal(icsAnchor.download, '12-rue-cafe-co-capture.ics');
  assert.equal(rowLine(prep), 'Calendar slot saved as 12-rue-cafe-co-capture.ics.');
});

/* ---- Where viewers stood and looked (get_tour_view_heatmap, 10 November 2026) ----------- */

const VIEW_STATS = { opens: 14, days_with_opens: 5, call_taps: 3, email_taps: 1, share_taps: 2, by_src: { link: 14 }, by_host: {},
  last_opened_at: '2026-09-24T02:00:00Z', explores: 9, avg_dwell_seconds: 96, visits: 11,
  by_room: { Kitchen: 7, Lounge: 9 }, by_room_seconds: { Kitchen: 272, Lounge: 61 } };
// The contract's shape: stops in stop order, whole seconds, bins that need not add up to seconds.
const HEATMAP = { visits: 11, since: '2026-11-01T01:00:10+00:00', stops: [
  { stop: 0, room: 'Lounge', visits: 11, seconds: 61, bins: { '0_1': 30, '11_1': 20, '6_0': 10 } },
  { stop: 1, room: 'Kitchen', visits: 9, seconds: 272, bins: { '2_1': 136, '3_1': 68, '2_0': 34, '8_2': 34 } },
  { stop: 2, room: null, visits: 1, seconds: 0, bins: {} },
] };
async function heatDesk(heatmap, extra = {}) {
  const h = await load({ tours: [liveTour(extra.tour || {})], approved: true, hosting: extra.hosting || [released()], fetch: extra.fetch, share: extra.share,
    rpc: { get_tour_view_stats: extra.statsRpc || (async () => ({ data: [extra.stats || VIEW_STATS] })), ...(heatmap === undefined ? {} : { get_tour_view_heatmap: heatmap }), ...(extra.rpc || {}) } });
  await settle();
  const insights = panelOf(h.card('t1'), 'insights');
  const toggle = toggleOf(h.card('t1'), 'insights');
  const open = async () => { await openPanel(h.card('t1'), 'insights'); await settle(); };
  const panel = () => insights.all().find(el => /^tour-heat$/.test(el.className));
  const list = () => insights.all().find(el => el.className === 'tour-heat-list');
  const texts = className => insights.all().filter(el => el.className === className).map(el => el.textContent);
  const control = name => insights.all().find(el => el.dataset.control === name);
  // A table as people read it: its column headers, then each row's cells.
  const table = className => { const found = insights.all().find(el => el.tagName === 'TABLE' && el.className.split(' ')[0] === className);
    return found ? { el: found, caption: found.all().find(el => el.tagName === 'CAPTION').textContent,
      head: found.all().filter(el => el.tagName === 'TH' && el.getAttribute('scope') === 'col').map(el => el.textContent),
      lines: found.all().filter(el => el.tagName === 'TR' && el.parent.tagName === 'TBODY'),
      rows: found.all().filter(el => el.tagName === 'TR' && el.parent.tagName === 'TBODY').map(row => row.children.map(cell => cell.textContent)) } : null; };
  const figures = () => insights.all().find(el => el.className === 'tour-insights-figures')?.children.map(group => group.children.map(el => el.textContent));
  return { h, insights, toggle, open, panel, list, texts, control, table, figures };
}

test('the extended stats fill the sentence and the room table: average time, rooms ranked by viewing time with visits, average per visit and share, and the vendor report', async () => {
  const x = await heatDesk(async () => ({ data: HEATMAP }));
  await x.open();
  const LEAD = 'Opened 14 times on 5 days, for 1m 36s on average. Viewers spent longest in Kitchen (82% of viewing time), followed by Lounge (18%). The call button was tapped 3 times and the email button once.';
  assert.deepEqual(x.texts('tour-insights-lead'), [LEAD]);
  assert.deepEqual(x.texts('tour-insights-title'), ['Time per room']);
  // The same data as the map, as a ranked table: room, visits, the average per visit (seconds over visits) and the share of all rooms' time.
  const rooms = x.table('tour-insights-rooms');
  // The period heads the group once; the caption only says the order.
  assert.equal(rooms.caption, 'Most time first.');
  const recent = x.insights.all().find(el => el.className === 'tour-insights-roomlist');
  assert.deepEqual(recent.children.slice(0, 3).map(el => el.textContent), ['Last 90 days, every version', 'Average time per visit: 1m 36s', 'Time per room']);
  assert.deepEqual(rooms.head, ['Room', 'Visits', 'Avg per visit', 'Share']);
  assert.deepEqual(rooms.rows, [['Kitchen', '7', '39s', '82%', ''], ['Lounge', '9', '7s', '18%', '']], 'by time, not by visits');
  assert.deepEqual(rooms.lines.map(row => row.children.map(cell => cell.className)), Array(2).fill(['tour-cell-name', 'tour-cell-number', 'tour-cell-number', 'tour-cell-number', 'tour-insights-room-bar']), 'numbers are their own right-aligned cells');
  assert.deepEqual(rooms.lines.map(row => [row.children[0].tagName, row.children[0].getAttribute('scope')]), [['TH', 'row'], ['TH', 'row']]);
  // The bar is scaled to the longest room and hidden from assistive technology: the cells beside it say it.
  assert.deepEqual(rooms.lines.map(row => [row.children[4].getAttribute('aria-hidden'), row.children[4].dataset.share]), [['true', '100'], ['true', '22']]);
  await x.control('copy-vendor-report').fire('click');
  await settle();
  assert.equal(x.h.copied.at(-1).split('\n')[1], LEAD);
  assert.match(x.h.copied.at(-1), /\nAverage time: 1m 36s\n/);
  assert.match(x.h.copied.at(-1), /\nTime by room: Kitchen 4m 32s \(82%, 7 visits\) · Lounge 1m 1s \(18%, 9 visits\)$/);
  // PostgREST may hand a numeric over as a number with a fraction or as text; an average is still said, rounded.
  for (const [value, said] of [[96.4, '1m 36s'], ['104.6', '1m 45s']]) {
    const odd = await heatDesk(undefined, { stats: { ...VIEW_STATS, avg_dwell_seconds: value } });
    assert.match(odd.texts('tour-insights-lead')[0], new RegExp('^Opened 14 times on 5 days, for ' + said + ' on average\\.'));
    assert.deepEqual(odd.texts('tour-insights-dwell'), ['Average time per visit: ' + said]);
  }
  // Under five opens a ranking of rooms is noise: the sentence says so, the rows still show, as counts only.
  const few = await heatDesk(undefined, { stats: { ...VIEW_STATS, opens: 4, days_with_opens: 1, call_taps: 0, email_taps: 2 } });
  assert.deepEqual(few.texts('tour-insights-lead'), ['Opened 4 times on 1 day, for 1m 36s on average. It is too early to say which rooms hold attention. The email button was tapped twice.']);
  assert.equal(few.insights.all().filter(el => el.className === 'tour-insights-room').length, 2);
  // A database from before these columns: the lines are simply not there.
  const before = await heatDesk(undefined, { stats: { opens: 3, days_with_opens: 1, call_taps: 0, email_taps: 0, share_taps: 0, by_src: {}, by_host: {}, last_opened_at: '2026-09-24T02:00:00Z' } });
  assert.deepEqual(before.texts('tour-insights-lead'), ['Opened 3 times on 1 day. Nobody has tapped call or email yet.']);
  assert.deepEqual(before.figures(), [['Opens', '3'], ['Days active', '1'], ['Enquiries', '0']]);
  assert.deepEqual(before.texts('tour-insights-scope'), ['All time, every version · last opened 24 Sep 2026'], 'no 90-day group without its figures');
  assert.deepEqual(before.texts('tour-insights-shares'), ['Link shares: 0']);
  assert.deepEqual([before.texts('tour-insights-room'), before.texts('tour-insights-title'), before.texts('tour-insights-channels')], [[], [], []]);
  // Counts are of opens and taps, never of people.
  assert.doesNotMatch(x.insights.textContent + x.h.copied.at(-1), /buyers?|people who|visitors? who/i);
});

test('the headline row is at most three figures of one period, said once above them; each of the three periods heads its own group', async () => {
  const x = await heatDesk(async () => ({ data: HEATMAP }));
  await x.open();
  assert.deepEqual(x.figures(), [['Opens', '14'], ['Days active', '5'], ['Enquiries', '4', '3 calls, 1 email']]);
  const groups = x.insights.all().find(el => el.className === 'tour-insights-figures').children;
  assert.ok(groups.length <= 3);
  assert.deepEqual(groups.map(group => group.children.map(el => [el.tagName, el.className])), [[['DT', ''], ['DD', '']], [['DT', ''], ['DD', '']], [['DT', ''], ['DD', ''], ['DD', 'tour-insights-detail']]], 'a label and a value; no period under each');
  // Three periods, because the answers cover three (stats: every stored record and the last 90 days; the heat map: this version).
  // Each is said once, first in its group, and nowhere else.
  const body = x.insights.children[0];
  const scopes = x.insights.all().filter(el => /^tour-(insights|heat)-scope$/.test(el.className)).map(el => el.textContent);
  assert.deepEqual(scopes, ['All time, every version · last opened 24 Sep 2026', 'Last 90 days, every version', 'This version of the walkthrough: 11 visits since 1 Nov 2026.']);
  assert.equal(body.children[body.children.indexOf(x.insights.all().find(el => el.className === 'tour-insights-figures')) - 1].className, 'tour-insights-scope', 'the all-time line heads the figures');
  const version = body.children.find(el => el.className === 'tour-insights-version');
  assert.deepEqual(version.children.map(el => el.className), ['tour-heat-scope', 'tour-heat', 'tour-heat-list'], 'the plan and the stops share their period line');
  const said = x.insights.all().filter(el => !el.children.length).map(el => el.textContent).join(' | ');
  assert.equal(said.split(/All time|Last 90 days|This version/).length - 1, 3, 'no period said twice: ' + said);
  // Link shares are a line under the row, not a fifth figure.
  assert.deepEqual(x.texts('tour-insights-shares'), ['Link shares: 2']);
  // The card's one-line count gives way while the panel is open, so no figure is on screen twice.
  assert.match(guideCss, /\.desk \.dash-tour:has\(> \.tour-insights:not\(\[hidden\]\)\) \.tour-views \{ display: none; \}/);
  // One enquiry kind tapped once reads in the singular.
  const one = await heatDesk(undefined, { stats: { ...VIEW_STATS, call_taps: 1, email_taps: 0 } });
  assert.deepEqual(one.figures()[2], ['Enquiries', '1', '1 call, 0 emails']);
});

test('too few visits: rooms and stops show counts only; time, shares, shades and look directions are withheld and the panel says from when', async () => {
  // Three visits in the last 90 days, though the link was opened 14 times: the room times are of those three.
  const stats = { ...VIEW_STATS, visits: 3, by_room: { Kitchen: 2, Lounge: 3 }, by_room_seconds: { Kitchen: 60, Lounge: 20 } };
  const heat = { visits: 3, since: '2026-11-08T01:00:00+00:00', stops: [
    { stop: 0, room: 'Lounge', visits: 3, seconds: 20, bins: { '0_1': 20 } }, { stop: 1, room: 'Kitchen', visits: 2, seconds: 60, bins: { '4_1': 60 } }] };
  const x = await heatDesk(async () => ({ data: heat }), { stats });
  await x.open();
  assert.match(x.texts('tour-insights-lead')[0], /It is too early to say which rooms hold attention\./);
  assert.deepEqual(x.texts('tour-insights-title'), ['Rooms by visits']);
  const rooms = x.table('tour-insights-rooms');
  assert.equal(rooms.el.className, 'tour-insights-rooms tour-insights-rooms-counts');
  assert.deepEqual([rooms.head, rooms.rows], [['Room', 'Visits'], [['Lounge', '3'], ['Kitchen', '2']]], 'counts, most visits first; no time, no share, no bar');
  // The note is about the rooms only, so it agrees with the average shown above it in the same group; 5 is said once.
  assert.deepEqual(x.texts('tour-insights-dwell'), ['Average time per visit: 1m 36s']);
  assert.deepEqual(x.texts('tour-insights-few'), ['Rooms show visit counts only until there are 5 visits; then their time and share appear.']);
  assert.equal(x.texts('tour-insights-few')[0].match(/\b5\b/g).length, 1);
  // The stops: visits and time per stop, and nothing about where anyone looked.
  assert.deepEqual(x.texts('tour-heat-scope'), ['This version of the walkthrough: 3 visits since 8 Nov 2026.']);
  assert.deepEqual(x.texts('tour-heat-few'), ['Fewer than 5 visits so far, so only counts are shown. Shades and look directions appear from 5 visits.']);
  const stops = x.table('tour-heat-table');
  assert.deepEqual(stops.head, ['No.', 'Stop', 'Visits', 'Total time']);
  assert.deepEqual(stops.rows, [['2', 'Kitchen', '2', '1m'], ['1', 'Lounge', '3', '20s']]);
  const said = [x.insights.all().find(el => el.className === 'tour-insights-roomlist'), x.panel(), x.list()].flatMap(el => el.all().map(node => node.textContent)).join(' ');
  assert.doesNotMatch(said, /%|Mostly|Looked|Level|down|\bup\b/, 'no share of time and no look direction in the rooms or the stops');
  // Opens short but visits known and enough is named for what is short.
  const opens = await heatDesk(undefined, { stats: { ...VIEW_STATS, opens: 4 } });
  assert.deepEqual(opens.texts('tour-insights-few'), ['Rooms show visit counts only until there are 5 opens; then their time and share appear.']);
  // A walkthrough with enough visits still withholds the look of a stop only one or two people reached.
  const mixed = await heatDesk(async () => ({ data: { visits: 9, since: null, stops: [
    { stop: 0, room: 'Hall', visits: 9, seconds: 90, bins: { '1_1': 90 } }, { stop: 1, room: 'Attic', visits: 2, seconds: 80, bins: { '5_2': 80 } }] } }));
  await mixed.open();
  assert.deepEqual(mixed.table('tour-heat-table').rows, [['1', 'Hall', '9', '1m 30s', 'Mostly one direction (100% of the time)'],
    ['2', 'Attic', '2', '1m 20s', 'Too few visits to say where they looked']]);
});

test('Where viewers stood: asked once when the insights are opened, and every stop is a row of the table with its number, visits, time and how people looked', async () => {
  const x = await heatDesk(async () => ({ data: HEATMAP }));
  assert.equal(x.h.count('get_tour_view_heatmap'), 0, 'not asked for until the insights are opened');
  assert.equal(x.panel().hidden, true);
  await x.open();
  assert.deepEqual(JSON.parse(JSON.stringify(x.h.calls.filter(([name]) => name === 'get_tour_view_heatmap'))), [['get_tour_view_heatmap', { p_tour_id: 't1' }]]);
  const panel = x.panel();
  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute('aria-label'), 'Where viewers stood and looked');
  assert.equal(panel.children[0].tagName, 'H4');
  assert.equal(panel.children[0].textContent, 'Where viewers stood and looked');
  assert.equal(x.texts('tour-heat-scope')[0], 'This version of the walkthrough: 11 visits since 1 Nov 2026.');
  // A zipped package has no floor to draw: the panel says so and asks for nothing more.
  assert.deepEqual(x.texts('tour-heat-noplan'), ['There is no floor plan for this walkthrough here. The table lists every stop.']);
  assert.equal(x.h.count('get_tour_package_base'), 0);
  assert.equal(panel.all().filter(el => el.tagName === 'SVG').length, 0);
  // Ranked by time, not stop order; the stop with no time read at it is still listed, in words.
  // A stop is named by its room, never by a bare number when the room is known; its number is the walkthrough's own.
  const stops = x.table('tour-heat-table');
  assert.equal(x.list().children[0].textContent, 'Time per stop');
  assert.equal(stops.caption, 'Most time first.');
  // Total time per stop, named so: the room table's figure is an average per visit.
  assert.deepEqual(stops.head, ['No.', 'Stop', 'Visits', 'Total time', 'How they looked around']);
  // In words the bins support: how concentrated the looking was (never what was looked at). The level / down / up
  // split is gone: no decision an agent makes turns on it.
  assert.deepEqual(stops.rows, [
    ['2', 'Kitchen', '9', '4m 32s', 'Mostly one direction (63% of the time)'],
    ['1', 'Lounge', '11', '1m 1s', 'Mostly one direction (50% of the time)'],
    ['3', 'Stop 3 (room not named)', '1', 'Under 1s', 'No look direction recorded'],
  ]);
  assert.doesNotMatch(x.insights.textContent, /Level \d+%|down \d+%|up \d+%/);
  assert.doesNotMatch(panel.textContent + stops.rows.join(' '), /°|anticlockwise/, 'no degrees');
  // Each cell carries its column's label and a role, because the rows are laid out as a grid, never scrolled sideways.
  assert.deepEqual(stops.lines[0].children.map(cell => cell.dataset.label), ['No.', 'Stop', 'Visits', 'Total time', 'How they looked around']);
  assert.deepEqual(stops.lines[0].children.map(cell => cell.getAttribute('role')), ['cell', 'rowheader', 'cell', 'cell', 'cell']);
  assert.deepEqual(stops.lines[0].children.map(cell => cell.className), ['tour-cell-key', 'tour-cell-name', 'tour-cell-number', 'tour-cell-number', 'tour-cell-words']);
  assert.equal(stops.el.getAttribute('role'), 'table');
  assert.equal(stops.el.all().filter(el => el.tagName === 'TH' && el.getAttribute('scope') === 'row').length, 3);
  assert.equal(x.insights.all().some(el => /scroll/.test(el.className || '')), false, 'no sideways scroller');
  // Closing and opening again does not ask again.
  await x.toggle.fire('click');
  assert.equal(x.insights.hidden, true);
  await x.open();
  assert.equal(x.h.count('get_tour_view_heatmap'), 1);
  assert.equal(x.panel().hidden, false, 'what it drew is still there');
  // Escape closes the panel and returns to its button.
  await x.insights.fire('keydown', { key: 'Escape' });
  assert.equal(x.insights.hidden, true);
  assert.equal(x.toggle.attributes['aria-expanded'], 'false');
  assert.equal(x.h.documentStub.activeElement, x.toggle);
  // More than eight stops: the table opens on the eight with most time and one button shows the rest.
  const many = { visits: 6, since: null, stops: Array.from({ length: 9 }, (_, stop) => ({ stop, room: null, visits: 6, seconds: 10 + stop, bins: { '0_1': 10 + stop } })) };
  const long = await heatDesk(async () => ({ data: many }));
  await long.open();
  const all = long.table('tour-heat-table');
  assert.deepEqual(all.rows.map(row => row[1]), [9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => 'Stop ' + n + ' (room not named)'));
  assert.deepEqual(all.lines.map(row => row.hidden), [false, false, false, false, false, false, false, false, true]);
  assert.deepEqual([...new Set(all.rows.map(row => row[4]))], ['Mostly one direction (100% of the time)', 'Too brief to say where they looked'], 'under 15 seconds at a stop is too brief to say');
  assert.equal(long.texts('tour-heat-scope')[0], 'This version of the walkthrough: 6 visits.');
  const more = long.control('heat-all');
  assert.deepEqual([more.textContent, more.getAttribute('aria-expanded')], ['Show all 9 stops', 'false']);
  await more.fire('click');
  assert.deepEqual([more.textContent, more.getAttribute('aria-expanded'), all.lines.some(row => row.hidden)], ['Show the top 8', 'true', false]);
  await more.fire('click');
  assert.deepEqual([more.textContent, all.lines.filter(row => row.hidden).length], ['Show all 9 stops', 1]);
});

test('Where viewers stood: "No visits yet" for an empty answer; no panel for a missing function; a failed or odd answer says so and offers Try again', async () => {
  const empty = await heatDesk(async () => ({ data: { stops: [], visits: 0, since: null } }));
  await empty.open();
  assert.equal(empty.panel().hidden, false);
  assert.deepEqual(empty.panel().children.map(el => el.textContent),
    ['Where viewers stood and looked', 'No visits to this version yet. Time at each stop and where people look fills in as the link is walked through.']);
  // The all-time opens above may come from earlier versions: the group still says which period it is.
  assert.deepEqual([empty.texts('tour-heat-scope'), empty.insights.all().find(el => el.className === 'tour-heat-scope').hidden], [['This version of the walkthrough.'], false]);
  assert.equal(empty.insights.all().filter(el => el.tagName === 'SVG' || (el.tagName === 'TABLE' && el.className === 'tour-heat-table')).length, 0);
  assert.equal(empty.list().hidden, true);
  // An older backend (PGRST202): nothing is shown, nothing is said, and no other walkthrough asks again.
  const missing = await load({ tours: [liveTour(), liveTour({ id: 't2' })], approved: true, hosting: [released(), released({ tour_id: 't2' })],
    rpc: { get_tour_view_stats: async () => ({ data: [VIEW_STATS] }),
      get_tour_view_heatmap: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_tour_view_heatmap(p_tour_id) in the schema cache' } }) } });
  await settle();
  const status = missing.status();
  for (const id of ['t1', 't2']) {
    const insights = await openPanel(missing.card(id), 'insights'); await settle();
    const panel = insights.all().find(el => el.className === 'tour-heat');
    assert.equal(panel.hidden, true, id);
    assert.equal(panel.children.length, 0);
    assert.equal(insights.all().find(el => el.className === 'tour-heat-list').hidden, true);
    assert.equal(insights.all().find(el => el.className === 'tour-insights-lead').textContent.startsWith('Opened 14 times on 5 days'), true, 'the rest of the insights stay');
  }
  assert.equal(missing.count('get_tour_view_heatmap'), 1, 'asked once; the second walkthrough does not ask a backend known not to have it');
  assert.equal(missing.status(), status, 'silently');
  // A failed read, a thrown one, and answers that are not the contract's shape: nothing is drawn from them, the
  // panel says the stops could not be loaded and that the counts above are whole, and the one button asks again.
  const odd = [async () => ({ data: null, error: { message: 'boom' } }), async () => { throw new TypeError('Failed to fetch'); }, async () => ({ data: null }),
    async () => ({ data: 'yes' }), async () => ({ data: { visits: 3 } }), async () => ({ data: { stops: [{ stop: 64, room: null, visits: 1, seconds: 3, bins: {} }], visits: 1, since: null } }),
    async () => ({ data: { stops: [{ stop: 0, room: null, visits: -1, seconds: 3, bins: {} }], visits: 1, since: null } }),
    async () => ({ data: { stops: [{ stop: 0, room: null, visits: 1, seconds: 'long', bins: {} }], visits: 1, since: null } })];
  for (const answer of odd) {
    const x = await heatDesk(answer);
    await x.open();
    assert.equal(x.panel().hidden, false);
    assert.deepEqual(x.panel().children.map(el => el.textContent), ['Where viewers stood and looked', 'Where viewers stood couldn’t be loaded. The counts above are complete.', '']);
    assert.equal(x.insights.all().filter(el => el.tagName === 'SVG' || (el.tagName === 'TABLE' && el.className === 'tour-heat-table')).length, 0);
    assert.equal(x.list().hidden, true);
    assert.equal(x.control('heat-retry').textContent, 'Try again');
    assert.equal(x.texts('tour-insights-lead').length, 1, 'the counts stay');
    assert.deepEqual([x.texts('tour-heat-scope'), x.insights.all().find(el => el.className === 'tour-heat-scope').hidden], [['This version of the walkthrough.'], false], 'the failed group still names its period');
  }
  // Try again asks once more and draws the answer when it comes.
  let asked = 0;
  const flaky = await heatDesk(async () => (++asked === 1 ? { data: null, error: { message: 'boom' } } : { data: HEATMAP }));
  await flaky.open();
  await flaky.control('heat-retry').fire('click');
  await settle();
  assert.equal(asked, 2);
  assert.equal(flaky.control('heat-retry'), undefined);
  assert.equal(flaky.table('tour-heat-table').rows.length, 3);
  // Bin keys outside the 36, and amounts that are not positive numbers, are ignored rather than drawn.
  const stray = await heatDesk(async () => ({ data: { visits: 5, since: null, stops: [{ stop: 0, room: '<b>Hall</b>', visits: 5, seconds: 20,
    bins: { '0_1': 6, '12_1': 50, '1_3': 50, '01_1': 50, '2_1': -4, '3_1': '7', north: 9 } }] } }));
  await stray.open();
  assert.deepEqual(stray.table('tour-heat-table').rows, [['1', '<b>Hall</b>', '5', '20s', 'Mostly one direction (100% of the time)']], 'a room name is text, never markup');
});

test('Where viewers stood: stops in one room are told apart by their order, and the words follow how spread the looking was', async () => {
  const spread = Object.fromEntries(Array.from({ length: 12 }, (_, sector) => [sector + '_1', 10]));
  const x = await heatDesk(async () => ({ data: { visits: 6, since: null, stops: [
    { stop: 0, room: 'Kitchen', visits: 6, seconds: 40, bins: { '0_1': 12, '1_1': 10, '2_1': 10, '7_1': 8 } },
    { stop: 1, room: 'Hall', visits: 6, seconds: 30, bins: { '4_1': 30 } },
    { stop: 2, room: 'Kitchen', visits: 5, seconds: 120, bins: spread },
    { stop: 3, room: 'Kitchen', visits: 5, seconds: 8, bins: { '5_2': 8 } },
  ] } }));
  await x.open();
  const rows = x.table('tour-heat-table').rows;
  // Ranked by time; the ordinal is the stop's place in its room along the walkthrough, not its rank.
  assert.deepEqual(rows.map(row => [row[0], row[1]]), [['3', 'Kitchen, second stop'], ['1', 'Kitchen, first stop'], ['2', 'Hall'], ['4', 'Kitchen, third stop']]);
  assert.deepEqual(rows.map(row => row[4]), ['Looked all around', 'Mostly one side of the room (80% of the time)', 'Mostly one direction (100% of the time)', 'Too brief to say where they looked']);
});

/* ---- The floor plan: stops where they stand, from the walkthrough's own package ---------- */

const PLAN_BASE = 'https://packages.example.invalid/w1/t1/';
// A 4 m by 2 m floor in half-metre cells with one cell missing (a pillar); bit c + r * columns, least significant first.
const PLAN_HOLE = [3, 1];
function planFloor() {
  const columns = 8, rows = 4, bits = Buffer.alloc(Math.ceil(columns * rows / 8));
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) if (c !== PLAN_HOLE[0] || r !== PLAN_HOLE[1]) bits[(r * columns + c) >> 3] |= 1 << ((r * columns + c) & 7);
  return { version: 1, cell_metres: 0.5, origin: [0, 0], columns, rows, floor_y: -1.4, eye_height: 1.4, area_m2: 7.75, mask: bits.toString('base64') };
}
const planStops = (lift = [0, 0, 0], ids = []) => [[1, 0.5], [3, 1.5], [3.5, 0.5]].map(([x, z], index) =>
  ({ id: 's' + (index + 1), room: 'r1', position: [x, lift[index], z], target: [x, lift[index] - 0.3, z - 2], floor: [x, lift[index] - 1.4, z], floor_measured: true, ...(ids[index] ? { floor_id: ids[index] } : {}) }));
const planManifest = (overrides = {}) => ({ format: 'veylet.tour-package', package_format_version: 2, walkable: { path: 'walkable.json' },
  truth_label: 'Built only from photos and depth captured on site. Not to scale.', rooms: [{ id: 'r1', name: 'Lounge' }], stops: planStops(), ...overrides });
// The two visited stops of HEATMAP stand on the plan; the third of the package was never reached.
const PLAN_HEAT = { ...HEATMAP, stops: HEATMAP.stops.slice(0, 2) };
async function planDesk(options = {}) {
  const fetched = [];
  const files = { 'manifest.json': options.manifest === undefined ? planManifest() : options.manifest, 'walkable.json': options.walkable === undefined ? planFloor() : options.walkable };
  const base = options.base === undefined ? PLAN_BASE : options.base;
  const fetch = async (url, init) => {
    // The desk's own service lookups also use fetch; only package reads are of interest here.
    if (url.startsWith('https://hooks.example.invalid/')) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    fetched.push([url, init]);
    const body = url.startsWith(base) ? files[url.slice(base.length)] : null;
    return body ? { ok: true, status: 200, text: async () => JSON.stringify(body) } : { ok: false, status: 404, text: async () => '' };
  };
  const x = await heatDesk(async () => ({ data: options.heat || PLAN_HEAT }), { tour: { storage_path: options.path || 'w1/t1/manifest.json' }, fetch, stats: options.stats,
    rpc: { get_tour_package_base: options.locate || (async () => ({ data: [{ package_base_url: base }] })) } });
  await x.open();
  const svg = x.panel().all().find(el => el.tagName === 'SVG' && el.getAttribute('class') === 'tour-heat-plan') || null;
  const marks = name => (svg ? svg.children.filter(el => el.getAttribute('class') === name) : []);
  const legend = () => x.panel().all().filter(el => el.tagName === 'LI').map(line => [line.className, ...line.all().filter(el => el.tagName === 'SPAN' && !el.children.length).map(el => el.textContent)]);
  return { ...x, fetched, svg, marks, legend };
}
const attrs = (el, ...names) => names.map(name => el.getAttribute(name));

test('the floor plan draws the walkable floor from the package and every stop where it stands: size by visits, shade by time, a wedge where they looked', async () => {
  const x = await planDesk();
  // The owner's package is found through the function the preview uses, and read without credentials.
  assert.deepEqual(JSON.parse(JSON.stringify(x.h.calls.filter(([name]) => name === 'get_tour_package_base'))), [['get_tour_package_base', { p_tour_id: 't1' }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(x.fetched)), [[PLAN_BASE + 'manifest.json', { credentials: 'omit' }], [PLAN_BASE + 'walkable.json', { credentials: 'omit' }]]);
  assert.ok(x.svg, 'a plan is drawn');
  assert.equal(x.svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(x.svg.parent.tagName, 'FIGURE');
  // One scale for both axes: 4 m by 2 m of floor in a 320-wide picture with a 30 px margin is 65 px to the metre.
  assert.equal(x.svg.getAttribute('viewBox'), '0 0 320 190');
  assert.deepEqual(attrs(x.svg, 'role', 'aria-label'), ['img', 'Floor plan from above with 2 stops marked, most time at Kitchen. The table lists every stop.']);
  // The floor is the package's own mask, read as the player reads it: every cell agrees with decodeWalkable.
  const floors = x.svg.children.filter(el => /^tour-heat-floor/.test(el.getAttribute('class')));
  assert.deepEqual(floors.map(el => el.getAttribute('class')), ['tour-heat-floor-edge', 'tour-heat-floor']);
  assert.equal(floors[0].getAttribute('d'), floors[1].getAttribute('d'));
  const lit = new Set();
  for (const [, px, pz, width] of floors[1].getAttribute('d').matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v[\d.]+h-[\d.]+Z/g)) {
    const c = (Number(px) - 30) / 32.5, r = (Number(pz) - 30) / 32.5;
    for (let i = 0; i < Number(width) / 32.5; i++) lit.add((c + i) + ',' + r);
  }
  const window = {};
  vm.runInNewContext(read('dist/tour-player-v2.js'), { window, atob, Uint8Array, document: {}, navigator: {}, location: {}, URL, console });
  const walkable = window.VeyletPlayerV2.decodeWalkable(planFloor());
  let cells = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) { cells += 1; assert.equal(lit.has(c + ',' + r), walkable.walkable(c * 0.5 + 0.25, r * 0.5 + 0.25), 'cell ' + c + ',' + r); }
  assert.deepEqual([cells, lit.size, lit.has(PLAN_HOLE.join(','))], [32, 31, false]);
  // Stops in the package's own frame: +X to the right, -Z up. Stop n of the answer is stops[n] of the manifest.
  const spots = x.marks('tour-heat-spot').map(el => attrs(el, 'data-stop', 'cx', 'cy', 'r', 'data-level'));
  // Size is visits (area grows with the count: 5 + 9 * sqrt(visits / most)); shade is the step of time (61 s is the lightest, 4m 32s the darkest).
  assert.deepEqual(spots, [['0', '95', '62.5', '14', '1'], ['1', '225', '127.5', '13.1', '3']]);
  // A stop of the package nobody reached is a small ring, so the plan shows the whole walkthrough.
  assert.deepEqual(x.marks('tour-heat-spot-unvisited').map(el => attrs(el, 'data-stop', 'cx', 'cy', 'r')), [['2', '257.5', '62.5', '3.5']]);
  // The wedge points where most of the looking went: 0 degrees is up the plan (-Z) and angles turn anticlockwise, as yaw does.
  const looks = x.marks('tour-heat-look');
  assert.deepEqual(looks.map(el => attrs(el, 'data-stop', 'data-from', 'data-to')), [['0', '0', '30'], ['1', '60', '90']]);
  assert.equal(looks[0].getAttribute('d'), 'M95 62.5L95.0 38.5A24 24 0 0 0 83.0 41.7Z', 'from straight up, sweeping to the left');
  // Marks are layered so none hides another: floor, rings, wedges, circles, then numbers.
  const order = x.svg.children.map(el => el.getAttribute('class'));
  assert.deepEqual(order, ['tour-heat-floor-edge', 'tour-heat-floor', 'tour-heat-spot-unvisited', 'tour-heat-look', 'tour-heat-look', 'tour-heat-spot', 'tour-heat-spot', 'tour-heat-number', 'tour-heat-number']);
  // Each circle wears the walkthrough's own stop number, the same as its table row; the picture's text is said by the table.
  assert.deepEqual(x.marks('tour-heat-number').map(el => [el.textContent, el.getAttribute('aria-hidden')]), [['1', 'true'], ['2', 'true']]);
  assert.deepEqual(x.table('tour-heat-table').rows.map(row => row.slice(0, 4)), [['2', 'Kitchen', '9', '4m 32s'], ['1', 'Lounge', '11', '1m 1s']]);
  // The legend names every encoding with its unit: one hue in three steps of time, and the package's own "Not to scale".
  assert.deepEqual(x.legend(), [
    ['tour-heat-legend-size', 'Circle size: visits, 9 to 11'],
    ['tour-heat-legend-shade', 'Shade: time at the stop', 'Under 2m', '2m to 4m', '4m and over'],
    ['tour-heat-legend-look', 'Wedge: where most of the looking went'],
    ['tour-heat-legend-none', 'Small ring: a stop with no visits'],
    ['tour-heat-legend-note', 'Seen from above, numbered as in the walkthrough. Not to scale.'],
  ]);
  assert.deepEqual(x.texts('tour-heat-noplan'), []);
  // Nothing in the plan is a control: no stop is reachable only by pointing at it.
  assert.equal(x.svg.all().some(el => el.events.click || el.events.mouseenter || el.events.pointerenter || el.getAttribute('tabindex') !== null), false);
});

test('the floor plan under five visits: outlined circles sized by visits, with no shade, no wedge and no shade line in the legend', async () => {
  const x = await planDesk({ heat: { visits: 3, since: null, stops: [{ stop: 0, room: 'Lounge', visits: 3, seconds: 61, bins: { '0_1': 60 } }, { stop: 1, room: 'Kitchen', visits: 1, seconds: 200, bins: { '2_1': 200 } }] } });
  assert.deepEqual(x.marks('tour-heat-spot').map(el => attrs(el, 'data-stop', 'r', 'data-level')), [['0', '14', 'count'], ['1', '10.2', 'count']]);
  assert.equal(x.marks('tour-heat-look').length, 0);
  assert.equal(x.svg.getAttribute('aria-label'), 'Floor plan from above with 2 stops marked. The table lists every stop.');
  assert.deepEqual(x.legend().map(line => line[0]), ['tour-heat-legend-size', 'tour-heat-legend-none', 'tour-heat-legend-note']);
  assert.deepEqual(x.legend()[0], ['tour-heat-legend-size', 'Circle size: visits, 1 to 3']);
});

test('no floor to draw: a zipped package, two storeys, an unreadable package or an untrusted address leaves the table, says so and invents nothing', async () => {
  const NOPLAN = ['There is no floor plan for this walkthrough here. The table lists every stop.'];
  const none = async (label, options, reads) => {
    const x = await planDesk(options);
    assert.equal(x.svg, null, label);
    assert.deepEqual(x.texts('tour-heat-noplan'), NOPLAN, label);
    assert.equal(x.table('tour-heat-table').rows.length, 2, label + ': the table still lists every stop');
    if (reads !== undefined) assert.equal(x.fetched.length, reads, label + ': reads');
    return x;
  };
  // A zipped (v1) package has no manifest to read: nothing is asked for at all.
  const zip = await none('zip', { path: 'w1/t1/package.zip' }, 0);
  assert.equal(zip.h.count('get_tour_package_base'), 0);
  // One picture cannot hold two storeys: by the package's floor ids, or by stops more than 1.5 m apart in height.
  await none('floor ids', { manifest: planManifest({ stops: planStops([0, 0, 0], ['ground', 'upper', 'ground']) }) });
  await none('heights', { manifest: planManifest({ stops: planStops([0, 2.8, 0]) }) });
  // The package cannot be found or read: a refused lookup, an address that is not https or this site, a missing or malformed manifest.
  await none('refused', { locate: async () => ({ data: null, error: { message: 'tour unavailable' } }) }, 0);
  await none('http', { base: 'http://packages.example.invalid/w1/t1/' }, 0);
  await none('other host by scheme-relative address', { base: '//packages.example.invalid/w1/t1/' }, 0);
  await none('no trailing slash', { base: 'https://packages.example.invalid/w1/t1' }, 0);
  await none('missing manifest', { manifest: null }, 1);
  await none('no stops', { manifest: planManifest({ stops: [] }) });
  await none('a stop without a floor point', { manifest: planManifest({ stops: [{ id: 's1', room: 'r1' }] }) });
  // An older backend without the lookup is asked once, then never again for any walkthrough.
  const older = await none('no lookup', { locate: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_tour_package_base' } }) }, 0);
  assert.equal(older.h.count('get_tour_package_base'), 1);
});

test('a package without a walkable floor still gets a stop map in the same proportions; a floor path outside the package is never read', async () => {
  for (const [label, manifest] of [['no walkable', planManifest({ walkable: null })], ['a path that climbs out', planManifest({ walkable: { path: '../other/walkable.json' } })],
    ['an absolute address', planManifest({ walkable: { path: 'https://elsewhere.example.invalid/walkable.json' } })]]) {
    const x = await planDesk({ manifest });
    assert.deepEqual(x.fetched.map(([url]) => url), [PLAN_BASE + 'manifest.json'], label);
    assert.ok(x.svg, label);
    assert.equal(x.svg.children.some(el => /^tour-heat-floor/.test(el.getAttribute('class'))), false, label);
    // The stops alone span 2.5 m by 1 m: still one scale for both axes.
    const [[ax, ay], [bx, by]] = x.marks('tour-heat-spot').map(el => [Number(el.getAttribute('cx')), Number(el.getAttribute('cy'))]);
    assert.ok(Math.abs((bx - ax) / (by - ay) - 2 / 1) < 0.01, label);
  }
  // A mask that is not the stated size is not drawn; the stops still are.
  const bad = await planDesk({ walkable: { ...planFloor(), columns: 9 } });
  assert.ok(bad.svg);
  assert.equal(bad.svg.children.some(el => /^tour-heat-floor/.test(el.getAttribute('class'))), false);
  // A stop of the answer the package does not have is said, not placed.
  const extra = await planDesk({ heat: { ...PLAN_HEAT, stops: [...PLAN_HEAT.stops, { stop: 7, room: 'Shed', visits: 5, seconds: 30, bins: {} }] } });
  assert.deepEqual(extra.texts('tour-heat-off'), ['1 stop is not on this plan. The table lists it.']);
  assert.equal(extra.table('tour-heat-table').rows.length, 3);
});

/* ---- States: loading, error, not opened yet, paused and offline ------------------------- */

test('waiting for the stops shows a placeholder in the answer’s shape only after 300 ms; a quick answer never flashes one', async () => {
  let answer;
  const slow = await heatDesk(() => new Promise(resolve => { answer = resolve; }));
  await slow.open();
  assert.equal(slow.panel().hidden, true, 'nothing yet');
  assert.equal(slow.h.timers.heat.size, 1, 'one 300 ms timer');
  for (const timer of slow.h.timers.heat) timer.fire();
  assert.equal(slow.panel().hidden, false);
  assert.equal(slow.panel().getAttribute('aria-busy'), 'true');
  assert.deepEqual(slow.panel().children.map(el => [el.tagName, el.className, el.textContent]),
    [['H4', 'tour-heat-title', 'Where viewers stood and looked'], ['P', 'tour-heat-busy', 'Loading where viewers stood…'], ['DIV', 'tour-heat-map tour-heat-skeleton', '']]);
  assert.deepEqual([slow.texts('tour-heat-scope'), slow.insights.all().find(el => el.className === 'tour-heat-scope').hidden], [['This version of the walkthrough.'], false], 'waiting, the group already names its period');
  // The placeholder has the answer's shape: the plan's box and key, then the stops' heading and rows.
  assert.deepEqual(slow.list().children.map(el => el.className), ['tour-heat-title', 'tour-heat-row tour-heat-skeleton', 'tour-heat-row tour-heat-skeleton', 'tour-heat-row tour-heat-skeleton']);
  assert.equal(slow.list().hidden, false);
  answer({ data: HEATMAP });
  await settle();
  assert.equal(slow.panel().getAttribute('aria-busy'), null);
  assert.equal(slow.insights.all().some(el => /skeleton/.test(el.className || '')), false, 'the placeholder is gone');
  assert.equal(slow.table('tour-heat-table').rows.length, 3);
  // Answered before the timer: the timer finds nothing to do.
  const quick = await heatDesk(async () => ({ data: HEATMAP }));
  await quick.open();
  for (const timer of quick.h.timers.heat) timer.fire();
  assert.equal(quick.panel().getAttribute('aria-busy'), null);
  assert.equal(quick.insights.all().some(el => /skeleton/.test(el.className || '')), false);
  // An empty answer is said in words, never left as a placeholder.
  const empty = await heatDesk(async () => ({ data: { stops: [], visits: 0, since: null } }));
  await empty.open();
  for (const timer of empty.h.timers.heat) timer.fire();
  assert.equal(empty.insights.all().some(el => /skeleton/.test(el.className || '')), false);
  // The placeholder, the plan and the tables hold still: this block of the stylesheet moves nothing, so there is nothing for reduced motion to switch off.
  assert.doesNotMatch(insightsCss, /animation|transition|@keyframes/);
});

test('the view counts could not be read: Insights says so with Try again, shows no figure, and the retry draws the answer', async () => {
  let asked = 0;
  const x = await heatDesk(async () => ({ data: HEATMAP }), { statsRpc: async () => (++asked === 1 ? { data: null, error: { message: 'boom' } } : { data: [VIEW_STATS] }) });
  assert.equal(x.toggle.hidden, false, 'the disclosure is offered, so the failure is not silent');
  await x.open();
  assert.deepEqual(x.insights.children[0].children.map(el => [el.className, el.textContent]), [['tour-insights-problem', 'The view counts couldn’t be loaded. Nothing is lost.'], ['tour-actions-row', '']]);
  assert.equal(x.figures(), undefined, 'a missing count is never shown as zero');
  assert.doesNotMatch(x.h.visible(), /Not opened yet|0 opens/);
  const again = x.control('insights-retry');
  assert.equal(again.textContent, 'Try again');
  await again.fire('click');
  await settle();
  assert.equal(asked, 2);
  assert.deepEqual(x.figures()[0], ['Opens', '14']);
  assert.equal(x.control('insights-retry'), undefined);
  // An answer that is not the contract's shape is the same failure, not an empty walkthrough.
  for (const data of [null, [], [{}], [{ opens: '14' }], [{ opens: -1 }]]) {
    const odd = await heatDesk(undefined, { statsRpc: async () => ({ data }) });
    await odd.open();
    assert.deepEqual(odd.texts('tour-insights-problem'), ['The view counts couldn’t be loaded. Nothing is lost.'], JSON.stringify(data));
  }
  // A backend without the function says nothing at all, as before.
  const older = await heatDesk(undefined, { statsRpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
  assert.equal(older.toggle.hidden, true);
});

test('not opened yet: Insights explains what will appear and offers the card’s own share control; no figure, table or map is drawn', async () => {
  const ZERO = { opens: 0, days_with_opens: 0, call_taps: 0, email_taps: 0, share_taps: 0, by_src: {}, by_host: {}, last_opened_at: null,
    explores: 0, avg_dwell_seconds: null, visits: 0, by_room: {}, by_room_seconds: {} };
  const x = await heatDesk(async () => ({ data: { stops: [], visits: 0, since: null } }), { stats: ZERO });
  assert.equal(x.toggle.hidden, false, 'offered before the first open, so the agent learns what it will hold');
  await x.open();
  assert.deepEqual(x.insights.children[0].children.map(el => [el.className, el.textContent]), [['tour-insights-lead', 'Not opened yet.'],
    ['tour-insights-note', 'When someone opens the link, this shows how often it was opened, which rooms held attention and where viewers stood.'], ['tour-actions-row', '']]);
  assert.equal(x.figures(), undefined);
  assert.equal(x.insights.all().some(el => el.tagName === 'TABLE' || el.tagName === 'SVG' || /skeleton/.test(el.className || '')), false, 'an empty result is words, never a placeholder');
  assert.equal(x.h.count('get_tour_view_heatmap'), 0, 'nothing to ask the stops for');
  // The one next action is the card's own: Copy link here, where there is no share sheet.
  const send = x.control('insights-share');
  const copyLink = x.h.card('t1').all().find(el => el.dataset.control === 'copy-link');
  assert.equal(send.textContent, 'Copy link');
  await send.fire('click');
  assert.equal(copyLink.clicked, 1, 'it presses the card’s button rather than doing the job a second way');
  // With a share sheet it reads Share and presses Share.
  const sheet = await heatDesk(undefined, { stats: ZERO, share: async () => {} });
  await sheet.open();
  assert.equal(sheet.control('insights-share').textContent, 'Share');
  await sheet.control('insights-share').fire('click');
  assert.equal(sheet.h.card('t1').all().find(el => el.dataset.control === 'share').clicked, 1);
});

test('paused or offline: Insights says first that nobody can open the link and the counts stand still; with no opens it offers no share', async () => {
  const past = '2026-09-01';
  const paused = await heatDesk(async () => ({ data: HEATMAP }), { tour: { share_paused_at: '2026-09-24T00:00:00Z' } });
  await paused.open();
  assert.deepEqual(paused.insights.children[0].children.slice(0, 3).map(el => el.className), ['tour-insights-stopped', 'tour-insights-lead', 'tour-actions-row tour-insights-report'], 'why the counts stand still comes before them');
  assert.deepEqual(paused.texts('tour-insights-stopped'), ['Sharing is paused, so nobody can open the link and these counts stay as they are until you resume sharing.']);
  assert.ok(paused.control('copy-vendor-report'), 'the vendor report still works');
  const offline = await heatDesk(async () => ({ data: HEATMAP }), { hosting: [released({ plan_active: false, hosting_state: 'offline', offline_on: past })] });
  await offline.open();
  assert.deepEqual(offline.texts('tour-insights-stopped'), ['This walkthrough is offline, so nobody can open the link and these counts stay as they are. Restarting your plan brings the same link back.']);
  // Live: no such line.
  const live = await heatDesk(async () => ({ data: HEATMAP }));
  await live.open();
  assert.deepEqual(live.texts('tour-insights-stopped'), []);
  // Never opened and paused: the reason, and no share button to press.
  const ZERO = { ...VIEW_STATS, opens: 0, days_with_opens: 0, call_taps: 0, email_taps: 0, share_taps: 0, last_opened_at: null, visits: 0, by_room: {}, by_room_seconds: {}, avg_dwell_seconds: null };
  const idle = await heatDesk(undefined, { stats: ZERO, tour: { share_paused_at: '2026-09-24T00:00:00Z' } });
  await idle.open();
  assert.deepEqual(idle.texts('tour-insights-note'), ['Sharing is paused, so nobody can open the link. Opens are counted once you resume sharing.']);
  assert.equal(idle.control('insights-share'), undefined);
});

test('the insights panel is one column that changes layout at two widths only, both steps the card and the desk already have, and its tables never scroll sideways', () => {
  // What made the page jump (craft-check F-stable, 10 November): a grid of stop cards that re-flowed by itself, room rows that
  // restacked, and report buttons that wrapped, each at its own width. Now: four figures across from the card's 560 px step,
  // the plan beside the tables from the desk bar's 720 px step, and nothing else.
  // The plan stands beside the stop table only when both are shown: no visits or a failed read leaves the plan's message in one column.
  assert.match(insightsCss, /\.tour-insights-version:has\(> \.tour-heat:not\(\[hidden\]\)\):has\(> \.tour-heat-list:not\(\[hidden\]\)\) \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 42%\);/);
  assert.doesNotMatch(insightsCss, /\.tour-heat:not\(\[hidden\]\)\)(?!:has\(> (\.tour-insights-version > )?\.tour-heat-list)/, 'no two-column rule keys on the plan alone');
  assert.deepEqual(insightsCss.match(/@(media|container)[^{]*/g).map(rule => rule.trim()), ['@container (min-width: 561px)', '@media (min-width: 720px)', '@container (min-width: 600px)']);
  assert.match(guideCss, /@container \(max-width: 560px\) \{\s*\.desk \.tour-views/, 'the card’s own step is 560 px');
  assert.doesNotMatch(insightsCss, /auto-fill|auto-fit|flex-wrap: wrap-reverse|overflow-x|overflow: (auto|scroll)/);
  assert.match(insightsCss, /\.desk \.dash-tour \.tour-insights-report \{ flex-wrap: nowrap; align-items: stretch; \}/, 'the two report buttons never take a second row');
  // Tables: a grid of rows at every width, the name flexible, numbers right-aligned in tabular figures in fixed columns.
  assert.match(insightsCss, /\.tour-insights-rooms, \.tour-heat-table \{ display: block; width: 100%;[^}]*font-variant-numeric: tabular-nums; \}/);
  assert.match(insightsCss, /:is\(\.tour-insights-rooms, \.tour-heat-table\) \.tour-cell-number \{ text-align: right; \}/);
  // Each number column is as wide as its longest value or header (one grid shared by every row); the name keeps at least 6.5em.
  assert.match(insightsCss, /@supports \(grid-template-columns: subgrid\) \{\s*\.tour-insights-rooms, \.tour-heat-table \{ display: grid; column-gap: 12px; \}\s*\.tour-insights-rooms \{ grid-template-columns: minmax\(6\.5em, 1fr\) auto auto auto; \}/);
  assert.match(insightsCss, /\.tour-heat-table \{ grid-template-columns: auto minmax\(6\.5em, 1fr\) auto auto; \}/);
  assert.match(insightsCss, /:is\(\.tour-insights-rooms, \.tour-heat-table\) tr \{ grid-template-columns: subgrid; \}/);
  // A header never squeezes into a column of letters: one line, ending in an ellipsis if a translation outgrows it.
  assert.match(insightsCss, /thead th \{ font-size: 13px; color: var\(--muted\); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  // Without subgrid the same rows keep fixed columns.
  assert.match(insightsCss, /\.tour-insights-rooms tr \{ grid-template-columns: minmax\(0, 1fr\) 3em 6em 3em; \}/);
  assert.match(insightsCss, /\.tour-heat-table tr \{ grid-template-columns: 1\.75em minmax\(0, 1fr\) 3em 4\.5em; \}/);
  // Outside the panel, the two wraps that cost a control's height on every card or row happen at the card's step, not at widths of their own.
  assert.match(guideCss, /@media \(pointer: coarse\) \{\s*@container \(max-width: 560px\) \{\s*\.dash-tour \.tour-hosting-fix \{ display: flex; flex-direction: column; flex-wrap: nowrap; align-items: flex-start; \}/);
  // The buttons and the five toggles share a line only from the desk's 720px step (a 672px card);
  // below it they are two rows, so no card loses a row at a width of its own.
  assert.match(guideCss, /@container \(max-width: 671px\) \{\s*\.desk \.dash-tour \.tour-card-row > \.tour-actions-row \{ flex: 1 1 100%; \}[^}]*\s*\.tour-disclosures \{ flex: 1 1 100%; margin-left: 0; gap: 0 4px; \}/);
  assert.doesNotMatch(guideCss, /@container \(max-width: 560px\) \{[^@]*\.tour-disclosures \{/);
  assert.match(guideCss, /@media \(max-width: 608px\) \{\s*\.desk \.needs-list > li\.needs-row \{ flex-direction: column; flex-wrap: nowrap; align-items: flex-start; justify-content: center; \}\s*\.needs-row > \.needs-words \{ flex: 0 1 auto; \}/);
  assert.match(insightsCss, /\.tour-heat-table td\.tour-cell-words \{ grid-column: 2 \/ -1;/, 'a stop’s words run under its name instead of adding columns');
  // The scale is one hue in three steps, light to dark, from the desk's own tokens; no colour of its own beyond the floor.
  assert.deepEqual([1, 2, 3].map(level => insightsCss.match(new RegExp('\\.tour-heat-spot\\[data-level="' + level + '"\\] \\{ fill: (var\\(--[\\w-]+\\));'))[1]), ['var(--line)', 'var(--accent)', 'var(--ink)']);
  assert.match(insightsCss, /\.tour-heat-spot\[data-level="1"\] \{ fill: var\(--line\); stroke: var\(--field-line\); \}/, 'the palest step keeps a 3:1 edge against the floor');
  assert.deepEqual([...new Set(insightsCss.match(/#[0-9a-fA-F]{3,8}\b/g))], ['#fdfcfa']);
});

test('Refresh keeps the reader’s place: the panel that was open on a card is open again, and a closed one stays closed', async () => {
  const x = await heatDesk(async () => ({ data: HEATMAP }));
  await x.open();
  const before = x.h.card('t1');
  x.toggle.focus();
  await x.h.ids['account-refresh'].fire('click');
  await settle(); await settle();
  const card = x.h.card('t1');
  assert.notEqual(card, before, 'the card was redrawn');
  assert.equal(panelOf(card, 'insights').hidden, false, 'Insights is open again');
  assert.equal(toggleOf(card, 'insights').attributes['aria-expanded'], 'true');
  assert.equal(x.h.documentStub.activeElement, toggleOf(card, 'insights'), 'focus returns to the same control on the new card');
  assert.equal(panelOf(card, 'insights').all().filter(el => el.className === 'tour-insights-lead').length, 1);
  // Only one panel per card comes back, and closing it is remembered too.
  assert.equal(panelOf(card, 'link').hidden, true);
  await toggleOf(card, 'insights').fire('click');
  await x.h.ids['account-refresh'].fire('click');
  await settle(); await settle();
  assert.equal(panelOf(x.h.card('t1'), 'insights').hidden, true);
});

/* ---- Desk words: walkthrough and space, one name per control, no dead end -------- */
test('an unavailable walkthrough names its one next step and its button says what it does', async () => {
  const h = await load({ tours: [readyTour({ status: 'revoked' })] });
  const next = h.ids['account-next-step'].children;
  assert.deepEqual(next.map(el => el.textContent), ['This walkthrough is unavailable.',
    'New access is blocked, so its old links and embeds no longer open it. Email Veylet support for the next step.', 'Email Veylet support']);
  assert.equal(next[2].tagName, 'A');
  assert.match(decodeURIComponent(next[2].href), /^mailto:support@veylet\.com\?subject=Unavailable walkthrough · walkthrough t1/);
  const card = h.card('t1');
  assert.ok(card.all().some(el => el.textContent === 'This walkthrough is unavailable for new access, so its old links and embeds no longer open it. Email Veylet support for the next step.'));
  const ask = card.all().find(el => el.dataset?.control === 'unavailable-support');
  assert.equal(ask.tagName, 'A');
  assert.equal(ask.textContent, 'Email Veylet support');
  assert.equal(ask.href, next[2].href, 'the card and the next step send the same email');
});

test('desk copy says walkthrough and space, and the sharing controls have one name', () => {
  const strings = [...account.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(match => match[1])
    .filter(text => /\s/.test(text) || /^[A-Z]/.test(text)).join('\n');
  for (const old of [/Open tour details/, /current tour/, /tour package/, /Tour status/, /tour list/, /available tours?\b/i, /reviewed tour/, /first-tour/, /tour progress/,
    /Every tour/, /Listing URL/i, /Listing portal/, /Manage sharing/, /from your listing/]) assert.doesNotMatch(strings, old, 'account.js still says ' + old);
  const words = markup.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(words, /first-tour|from your listings?\b/i);
  assert.match(account, /copyField\('Link for portals and CRM', 'input', listingUrl\)/);
});

test('review in place: Preview, the tick and Approve and share are three numbered steps inside the disclosure', async () => {
  const h = await load({ tours: [readyTour()], hosting: [] });
  const card = h.card('t1');
  const review = card.all().find(el => el.tagName === 'DETAILS' && el.className === 'tour-review');
  // Nothing about the review sits outside its disclosure: the card shows the state line and the disclosure.
  assert.equal(card.children.some(el => el.textContent === 'Preview'), false, 'Preview is no longer a separate card button');
  const steps = review.all().find(el => el.tagName === 'OL' && el.className === 'review-steps');
  assert.ok(steps, 'one ordered row of steps');
  assert.deepEqual(steps.children.map(li => li.className), ['review-step', 'review-step', 'review-step']);
  const [first, second, third] = steps.children;
  const preview = first.children[0];
  assert.equal(preview.textContent, 'Preview');
  assert.match(preview.href, /^\/play\/\?id=t1&review_revision=a{64}$/);
  assert.equal(preview.target, '_blank', '/play cannot be framed (X-Frame-Options DENY), so it opens in a new tab');
  assert.equal(second.children[0].children[0].type, 'checkbox');
  assert.equal(second.children[0].children[0].required, true, 'the server still needs the tick');
  assert.deepEqual(filled(review), ['Approve and share'], 'the one filled button is the last step');
  assert.equal(third.children[0].textContent, 'Approve and share');
  assert.equal(third.children[1].textContent, 'Anyone with the link can open it and forward it while your plan is active.', 'what the press does, beside it');
  await approve(h);
  assert.deepEqual(h.calls.filter(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)).map(([name]) => name), ['review_tour_versioned', 'enable_tour_share'], 'still one press');
});
