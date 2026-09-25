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
  const timers = { render: new Set(), desk: new Set(), skeleton: new Set() };
  const scheduleTimeout = (fn, ms) => {
    const timer = { fire: fn, ms };
    if (ms === 10000) timers.render.add(timer); else if (ms === 45000) timers.desk.add(timer); else if (ms === 400) timers.skeleton.add(timer);
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
      if (['get_pack_offer', 'get_trial_offer', 'get_express_offer', 'get_members_annual_offer', 'get_referral_code', 'list_workspace_render_status', 'get_workspace_public_contact'].includes(name)) return missing;
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
  Object.assign(documentStub, {
    getElementById: id => ids[id], createElement: tag => new Element(tag),
    addEventListener: (name, handler) => { documentStub.listeners[name] = handler; }, head: { append() {} },
  });
  const FakeURL = function (...args) { return new URL(...args); };
  FakeURL.createObjectURL = blob => { downloads.push(blob); return 'blob:veylet-' + downloads.length; };
  FakeURL.revokeObjectURL = () => {};
  const context = { window, document: documentStub, navigator, Date, URL: FakeURL, URLSearchParams, TextEncoder, Blob: class {},
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
  assert.ok(byText(form, 'Anyone with the link can open it and forward it. It stays online while your plan is active.'));
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
    assert.equal(chipOf(card), null, 'never shared: no state chip claims one');
    assert.equal(shownIn(card).some(el => el.textContent === 'Anyone with the link can open it.'), false, 'the reason replaces the usual line');
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
  assert.equal(byText(reviewForm(fresh.card(W2)), 'Anyone with the link can open it and forward it. It stays online while your plan is active.'), undefined,
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
  assert.equal(stateLine(never.card('t1')), 'Approved. Sharing isn’t on yet.');
  assert.deepEqual(filled(never.card('t1')), ['Turn sharing on']);
  assert.ok(byText(never.card('t1'), 'Anyone with the link can open it.'));
  // A refusal on the press itself is said in place, with its fix, and nothing reloads.
  const refused = await load({ tours: [readyTour()], approved: true, hosting: [released()], rpc: { enable_tour_share: async () => ({ error: { message: 'sharing permission required' } }) } });
  const reads = refused.tourReads();
  await byText(refused.card('t1'), 'Turn sharing back on').fire('click'); await settle();
  assert.equal(refused.tourReads(), reads);
  assert.equal(rowLine(refused.card('t1')), 'Approved. Sharing waits for someone with sharing permission.');
  assert.ok(shownIn(refused.card('t1')).some(el => el.textContent === 'Ask the workspace owner to turn sharing on.'));
  // Someone who may not share reads whose press it is, never a disabled button.
  const reviewerOnly = await load({ tours: [readyTour({ created_by: 'someone-else' })], approved: true, role: 'operator' });
  assert.equal(stateLine(reviewerOnly.card('t1')), 'Approved. The workspace owner or this walkthrough’s creator can turn sharing on.');
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
    'Offline since ' + day(past) + '. Restart your plan and this link works again — same link, embed and QR.', 'Restart your plan']);
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
    const qr = h.all().find(el => el.className === 'account-details tour-qr');
    if (qr) { qr.open = true; await qr.fire('toggle'); }
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
  assert.match(selling.visible(), /ready in about 30 minutes, any day, any time, instead of the usual 1–2 hours\. If it isn’t, the A\$29 is refunded automatically\./);
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
  assert.ok(byText(card, 'Copy link'));
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
  // The website steps and the one embed code are still there.
  assert.ok(byText(desk.card('t1'), 'Add to your website'));
  assert.ok(byText(desk.card('t1'), 'Copy embed code'));
});

test('Show QR code draws the code in this browser and saves a PNG named after the listing', async () => {
  const h = await load({ tours: [readyTour({ share_token: TOKEN })], approved: true, hosting: [released()],
    properties: [{ id: 'p1', title: '12 Rue Café & Co.', workspace_id: 'w1' }] });
  const card = h.card('t1');
  const qr = card.all().find(el => el.tagName === 'DETAILS' && el.className === 'account-details tour-qr');
  assert.equal(qr.children[0].textContent, 'Show QR code');
  const code = qr.all().find(el => el.className === 'tour-qr-code');
  const download = byText(qr, 'Download QR code (PNG)');
  assert.equal(code.innerHTML, undefined, 'nothing is drawn until it is opened');
  assert.equal(download.disabled, true);
  qr.open = true; await qr.fire('toggle');
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
  const closed = none.card('t1').all().find(el => el.className === 'account-details tour-qr');
  closed.open = true; await closed.fire('toggle');
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
const manageOf = card => card.all().find(el => el.tagName === 'DETAILS' && el.children[0]?.textContent === 'Manage sharing');
const pausing = () => ({
  pause_tour_share: async (args, { tours }) => { tours.find(row => row.id === args.p_tour_id).share_paused_at = '2026-09-25T01:00:00Z'; return { data: null }; },
  resume_tour_share: async (args, { tours }) => { const row = tours.find(item => item.id === args.p_tour_id); row.share_paused_at = null; return { data: row.share_token }; },
});

test('Pause sharing sits first under Manage sharing, unconfirmed and secondary; the paused card offers Resume, and the link never changes', async () => {
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
  assert.equal(byText(paused, 'Show QR code'), undefined);
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

test('Copy listing URL gives portals and CRMs the unbranded /tour address, tagged as the portal channel', async () => {
  const h = await load({ tours: [liveTour()], approved: true });
  const card = h.card('t1');
  const row = card.all().find(el => el.className === 'tour-actions-row' && el.children.some(child => child.textContent === 'Copy link'));
  assert.deepEqual(row.children.map(child => child.textContent), ['Copy link', 'Copy listing URL (portals, CRM)', 'Open as your client'], 'next to Copy link');
  const field = card.all().find(el => el.tagName === 'LABEL' && el.children[0]?.textContent === 'Listing URL (portals, CRM)');
  assert.equal(field.hidden, true, 'the address shows once asked for');
  await byText(card, 'Copy listing URL (portals, CRM)').fire('click');
  assert.deepEqual(h.copied, ['https://veylet.com/tour?t=' + TOKEN + '&src=portal']);
  assert.equal(field.hidden, false);
  assert.equal(rowLine(card), 'Listing URL copied. Paste it into the virtual tour field. It shows the walkthrough only: no agent card, links or QR code.');
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
  assert.deepEqual(views.children.map(el => el.textContent), ['Opened 14 times · last 24 Sep 2026', 'Call taps 3 · Email taps 1']);
  const order = card.children.map(el => el.className);
  assert.equal(order.indexOf('tour-views'), order.indexOf('tour-state-help tour-hosting') + 1, 'right under the state line');
  assert.deepEqual(h.calls.filter(([name]) => name === 'get_tour_view_stats').map(([, args]) => args.p_tour_id), ['t1']);
  const once = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => ({ data: [{ ...stats, opens: 1 }] }) } });
  await settle();
  assert.equal(once.card('t1').all().find(el => el.className === 'tour-views').children[0].textContent, 'Opened 1 time · last 24 Sep 2026');
  const none = await load({ tours: [liveTour()], approved: true, rpc: { get_tour_view_stats: async () => ({ data: [{ ...stats, opens: 0, call_taps: 0, email_taps: 0, last_opened_at: null }] }) } });
  await settle();
  assert.deepEqual(none.card('t1').all().find(el => el.className === 'tour-views').children.map(el => el.textContent), ['Not opened yet.']);
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
    assert.doesNotMatch(odd.visible(), /Opened|Not opened/);
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
  assert.equal(h.card('t1').all().find(el => /tour-hosting/.test(el.className)).textContent,
    'Your plan has ended. This walkthrough goes offline on 1 Mar 2027. Restart your plan in the app to keep it live.');
  assert.equal(byText(h.card('t1'), 'Full website guide'), undefined, 'no link out to the public site');
  const text = h.visible();
  for (const pattern of BANNED) assert.doesNotMatch(text, pattern);
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
  const order = form.children.map(el => el.className || el.textContent);
  assert.equal(order.indexOf('tour-flags') + 1, order.indexOf('button'), 'right above Approve and share');
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
  assert.match(byText(h.card('t1'), 'Open review preview').href, /^\/play\/\?id=t1&review_revision=a{64}&from=app$/);
  const site = await load({ tours: [readyTour()] });
  assert.match(byText(site.card('t1'), 'Open review preview').href, /^\/play\/\?id=t1&review_revision=a{64}$/);
});
