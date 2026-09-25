const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const account = fs.readFileSync(path.join(__dirname, '../dist/account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(__dirname, '../dist/tour-sharing.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelector(selector) { return this.all().find(el => selector.includes('button') ? el.tagName === 'BUTTON' && el.type === 'submit' : selector.includes('token') ? el.name === 'token' : el.name === 'location_general') || null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  click() { this.wasClicked = true; } focus() { this.wasFocused = true; } scrollIntoView(options) { this.wasScrolled = true; this.scrollOptions = options; this.expandedAtScroll = this.all().some(el => el.tagName === 'DETAILS' && el.open); } select() {} reset() { this.wasReset = true; }
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
}
function controlledTimer(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }
async function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  const verifySubmit = new Element('button'); verifySubmit.type = 'submit';
  const codeInput = new Element('input'); codeInput.name = 'token';
  ids['account-verify'].append(codeInput, verifySubmit);
  const intervals = new Map(); let intervalId = 0;
  const requestTimers = new Set();
  const pollTimers = new Set(), documentEvents = {}, exported = [];
  const scheduleTimeout = (fn, ms) => {
    if (ms === 45000) { const timer = { fire: fn, poll: true }; pollTimers.add(timer); return timer; }
    if (!options.manualTimeouts || ms !== 20000) return controlledTimer(fn, ms);
    const timer = { fire: fn }; requestTimers.add(timer); return timer;
  };
  const cancelTimeout = timer => { if (timer?.poll) pollTimers.delete(timer); else if (timer?.fire) requestTimers.delete(timer); else clearTimeout(timer); };
  const calls = [], queries = [], selects = [];
  const user = { id: 'user-1', email: 'person@example.invalid' };
  const table = {
    properties: { data: [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }] },
    tours: { data: options.tours || [] },
    memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
    ...options.tables,
  };
  let reviewApproved = options.approved || false;
  // The tour rows the desk was last given, for the review target answers below.
  let shownTours = options.tours || [];
  const supabase = {
    auth: {
      getSession: async () => options.sessionError ? { error: { message: 'offline' } } : { data: { session: options.signedOut ? null : { user, access_token: options.accessToken === undefined ? 'token-1' : options.accessToken } } },
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signInWithOtp: async input => { calls.push(['otp', input]); return options.otp ? options.otp(input) : {}; },
      verifyOtp: async input => { calls.push(['verify', input]); return options.verify ? options.verify(input) : {}; },
      signOut: async () => { calls.push(['signOut']); return options.signOutError ? { error: { message: 'offline' } } : {}; },
    },
    from(name) {
      queries.push(name);
      // A table may be a function of the columns asked for, as a database without a column answers.
      let columns = '';
      const answer = () => {
        const result = typeof table[name] === 'function' ? table[name](columns) : table[name];
        if (name === 'tours' && Array.isArray(result?.data)) shownTours = result.data;
        return result;
      };
      const builder = { select(value) { columns = String(value || ''); selects.push([name, columns]); return builder; }, order() { return builder; }, eq() { return builder; }, single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); }, then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc?.[name]) return options.rpc[name](args);
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      // Walkthrough packs, starting the free months, express renders and render status
      // have their own tests; elsewhere the function is absent, so no card.
      if (['get_pack_offer', 'get_trial_offer', 'get_express_offer', 'list_workspace_render_status'].includes(name)) return { error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (name === 'get_tour_review') return { data: [{ approved: reviewApproved }] };
      if (name === 'get_tour_review_target') { const selected = shownTours.find(row => row.id === args.p_tour_id); return { data: [{ tour_id: selected?.id, storage_path: selected?.storage_path, package_revision: 'a'.repeat(64) }] }; }
      if (name === 'review_tour_versioned') { reviewApproved = true; return { data: [{ approved: true }] }; }
      if (name === 'withdraw_tour_review') { reviewApproved = false; return { data: [{ approved: false }] }; }
      if (name === 'revoke_tour_share') { for (const tour of table.tours.data || []) tour.share_token = null; return { data: null }; }
      return { data: 'receipt' };
    },
  };
  const windowEvents = {};
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase }, VeyletPlace: { generalLocationProblem: () => '' },
    VEYLET_HOOKS: { url: 'https://hooks.example.invalid' }, fetch: options.fetch, addEventListener: (name, handler) => { windowEvents[name] = handler; } };
  // Per-browser storage: absent unless a test supplies one, or 'throw' for a
  // browser that refuses it outright.
  if ('localStorage' in options) Object.defineProperty(window, 'localStorage', { get() { if (options.localStorage === 'throw') throw new Error('SecurityError'); return options.localStorage; } });
  if ('sessionStorage' in options) Object.defineProperty(window, 'sessionStorage', { get() { if (options.sessionStorage === 'throw') throw new Error('SecurityError'); return options.sessionStorage; } });
  const redirects = [];
  const FileURL = function (...args) { return new URL(...args); }; FileURL.createObjectURL = blob => { exported.push(blob); return 'blob:records'; }; FileURL.revokeObjectURL = () => {};
  const documentStub = { hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener: (name, handler) => { documentEvents[name] = handler; } };
  // Script elements the page adds (Square's Web Payments SDK). `options.sdk` decides
  // each load: 'fail' fires onerror, anything else installs `options.square`.
  const scripts = [];
  documentStub.head = { append: el => { scripts.push(el); Promise.resolve().then(() => {
    const mode = typeof options.sdk === 'function' ? options.sdk() : options.sdk;
    if (mode === 'fail') { el.onerror?.(); return; }
    if (options.square) window.Square = options.square;
    el.onload?.();
  }); } };
  const context = { window, document: documentStub, Blob: class { constructor(parts, init) { this.parts = parts; this.type = init?.type; } }, URL: FileURL, Date, navigator: { clipboard: { writeText: async () => { if (options.clipboardBlocked) throw new Error('blocked'); } } }, location: { pathname: options.pathname || '/account', search: options.search || '', replace: value => redirects.push(value), assign: value => redirects.push(value) }, URLSearchParams, setTimeout: scheduleTimeout, clearTimeout: cancelTimeout, setInterval: fn => { intervals.set(++intervalId, fn); return intervalId; }, clearInterval: id => intervals.delete(id), FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key]; } } };
  if (options.Date) context.Date = options.Date;
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(options.accountScript || account, context);
  await new Promise(resolve => setImmediate(resolve));
  return { ids, calls, queries, selects, redirects, supabase, verifySubmit, exported, documentStub, documentEvents, windowEvents, scripts, pollCount: () => pollTimers.size, async firePolls() { for (const timer of [...pollTimers]) { pollTimers.delete(timer); timer.fire(); } await new Promise(resolve => setImmediate(resolve)); }, expireRequests() { for (const timer of [...requestTimers]) { requestTimers.delete(timer); timer.fire(); } }, tickSeconds(count) { for (let i=0;i<count;i++) for (const fn of [...intervals.values()]) fn(); }, all: () => Object.values(ids).flatMap(el => el.all()), text: () => Object.values(ids).flatMap(el => [el, ...el.all()]).map(el => el.textContent).join('\n') };
}
const tour = { id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/original.zip', created_by: 'user-1' };
const requestedID = 'dddddddd-2222-4333-8444-555555555555';
test('a new account gets one setup action without changing access or creating a space', async () => {
  const h = await load({ tables: { properties: { data: [] } } });
  const panel = h.ids['account-next-step'];
  assert.match(panel.all().map(el => el.textContent).join(' '), /Start with one space/);
  await panel.all().find(el => el.tagName === 'BUTTON').fire('click');
  assert.equal(h.ids['account-add-space'].open, true);
  // Reading the plan, hosting dates and the team's invites and members are the only calls
  // added here; nothing changes access or creates a space.
  assert.deepEqual(h.calls.map(call => call[0]), ['can_produce_tours', 'get_tour_hosting', 'get_tour_hosting_states', 'get_workspace_plan', 'get_account_deletion', 'get_email_preferences', 'list_workspace_invites', 'list_workspace_members', 'get_walkthrough_capacity', 'get_pack_offer', 'get_members_annual_offer', 'get_referral_code']);
});
test('an owner with a saved space gets self-capture preparation without an unavailable visit offer', async () => {
  const h = await load();
  const elements = h.ids['account-next-step'].all();
  assert.match(elements.map(el => el.textContent).join(' '), /Use Veylet Capture on a LiDAR iPhone or iPad/);
  assert.doesNotMatch(elements.map(el => el.textContent).join(' '), /studio visit/i);
  assert.equal(elements.find(el => el.tagName === 'A').href, '/start');
});
test('an approved operator sees capture preparation only from confirmed production access', async () => {
  const h = await load({ rpc: { can_produce_tours: () => ({ data: true }) } });
  assert.equal(h.ids['account-next-step'].all().find(el => el.tagName === 'A').href, '/start#capture-partners');
  const unavailable = await load({ rpc: { can_produce_tours: () => ({ error: { message: 'offline' } }) } });
  assert.match(unavailable.ids['account-next-step'].all().map(el => el.textContent).join(' '), /approval could not be checked/);
  assert.equal(unavailable.ids['account-next-step'].all().some(el => el.href === '/start#capture-partners'), false);
});
test('tour guidance follows the requested visible tour and never publishes or approves', async () => {
  const target = { ...tour, id: requestedID, status: 'draft' };
  const h = await load({ tours: [tour, target], search: '?tour=' + requestedID });
  const panel = h.ids['account-next-step'];
  assert.match(panel.all().map(el => el.textContent).join(' '), /Your walkthrough is at its quality check\. Rendering, step 5 of 5: Checking quality\. The check is automatic/);
  assert.doesNotMatch(panel.all().map(el => el.textContent).join(' '), /studio|a person|business day/i);
  await panel.all().find(el => el.tagName === 'BUTTON').fire('click');
  assert.equal(h.all().find(el => el.id === 'requested-tour').wasFocused, true);
  assert.equal(h.calls.some(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)), false);
});
test('failed tour or membership loading cannot appear as a new or complete job', async () => {
  for (const name of ['tours', 'memberships']) {
    const h = await load({ tours: [tour], tables: { [name]: { error: { message: 'offline' } } } });
    assert.match(h.ids['account-next-step'].all().map(el => el.textContent).join(' '), /Refresh your walkthrough status/);
    assert.equal(h.ids['account-next-step'].all().some(el => el.tagName === 'A'), false);
  }
});
test('sign out clears personalised next-step guidance', async () => {
  const h = await load({ tours: [tour] });
  assert.ok(h.ids['account-next-step'].children.length);
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['account-next-step'].children.length, 0);
});
test('capture handoff selects the exact authorized tour among multiple drafts without approving it', async () => {
  const target = { ...tour, id: requestedID, storage_path: 'w1/new/package.zip' };
  const h = await load({ tours: [tour, target], search: '?tour=' + requestedID });
  const selected = h.all().find(el => el.id === 'requested-tour');
  assert.ok(selected?.wasFocused && selected.wasScrolled);
  assert.equal(selected.scrollOptions.block, 'start');
  assert.equal(selected.expandedAtScroll, true);
  assert.equal(selected.all().find(el => el.textContent === 'Open review preview').href,
    '/play/?id=' + requestedID + '&review_revision=' + 'a'.repeat(64));
  assert.equal(selected.all().find(el => el.tagName === 'DETAILS').open, true);
  const details = h.all().filter(el => el.tagName === 'DETAILS' && el.className === 'tour-review');
  assert.equal(details.filter(el => el.open).length, 1);
  assert.ok(selected.all().filter(el => el.type === 'checkbox').every(el => !el.checked));
  assert.equal(h.calls.some(([name]) => ['review_tour_versioned', 'enable_tour_share'].includes(name)), false);
  assert.match(h.ids['account-target-status'].textContent, /selected below/);
});
test('handoff positioning waits for asynchronous reviews above it and does not jump again on refresh', async () => {
  const pending = new Map();
  const target = { ...tour, id: requestedID };
  const h = await load({ tours: [tour, target], search: '?tour=' + requestedID,
    rpc: { get_tour_review_target: args => new Promise(resolve => pending.set(args.p_tour_id, resolve)) } });
  const selected = h.all().find(el => el.id === 'requested-tour');
  assert.equal(selected.wasScrolled, undefined);
  pending.get(requestedID)({ data: [{ tour_id: requestedID, storage_path: target.storage_path, package_revision: 'a'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected.all().find(el => el.tagName === 'DETAILS').open, true);
  assert.equal(selected.wasScrolled, undefined, 'the preceding card still has pending layout');
  pending.get(tour.id)({ data: [{ tour_id: tour.id, storage_path: tour.storage_path, package_revision: 'a'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected.expandedAtScroll, true);
  assert.equal(selected.scrollOptions.block, 'start');
  await h.ids['account-refresh'].fire('click');
  await new Promise(resolve => setImmediate(resolve));
  const refreshed = h.all().find(el => el.id === 'requested-tour');
  for (const row of [tour, target]) pending.get(row.id)({ data: [{ tour_id: row.id, storage_path: row.storage_path, package_revision: 'a'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(refreshed, selected);
  assert.equal(refreshed.wasFocused, undefined);
  assert.equal(refreshed.wasScrolled, undefined);
});
test('sign-out retires pending handoff positioning before a late review can steal focus', async () => {
  let finish;
  const target = { ...tour, id: requestedID };
  const h = await load({ tours: [target], search: '?tour=' + requestedID,
    rpc: { get_tour_review_target: () => new Promise(resolve => { finish = resolve; }) } });
  const selected = h.all().find(el => el.id === 'requested-tour');
  h.supabase.auth.callback('SIGNED_OUT', null);
  finish({ data: [{ tour_id: requestedID, storage_path: target.storage_path, package_revision: 'a'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected.wasFocused, undefined);
  assert.equal(selected.wasScrolled, undefined);
  assert.equal(h.ids['account-properties'].children.length, 0);
});
test('an inaccessible or unknown handoff shows a generic fallback and never requests that target directly', async () => {
  const h = await load({ tours: [tour], search: '?tour=' + requestedID });
  assert.equal(h.all().some(el => el.id === 'requested-tour'), false);
  assert.match(h.ids['account-target-status'].textContent, /not available in this account/);
  assert.equal(h.text().includes(requestedID), false);
  assert.equal(h.calls.some(([, args]) => args?.p_tour_id === requestedID), false);
});
test('a tour row without a visible owning property cannot become the requested review', async () => {
  const h = await load({ tours: [{ ...tour, id: requestedID, property_id: 'not-visible' }], search: '?tour=' + requestedID });
  assert.equal(h.all().some(el => el.id === 'requested-tour'), false);
  assert.equal(h.calls.some(([, args]) => args?.p_tour_id === requestedID), false);
  assert.match(h.ids['account-target-status'].textContent, /not available/);
});
test('invalid, duplicate and injected tour targets are not reflected or forwarded', async () => {
  for (const search of ['?tour=SECRET', '?tour=' + requestedID.toUpperCase(),
                        '?tour=' + requestedID + '&tour=' + requestedID, '?tour=https://evil.invalid']) {
    const h = await load({ signedOut: true, search });
    h.ids['account-sign-in'].values = { email: 'owner@example.invalid' };
    await h.ids['account-sign-in'].fire('submit');
    assert.equal(h.calls.find(([name]) => name === 'otp')[1].options.emailRedirectTo, 'https://veylet.com/auth/callback');
    const signedIn = await load({ search, tours: [tour] });
    assert.match(signedIn.ids['account-target-status'].textContent, /review link is incomplete/);
    assert.equal(signedIn.text().includes('SECRET'), false);
    assert.equal(signedIn.all().some(el => el.id === 'requested-tour'), false);
  }
});
test('canonical capture handoff survives sign-in resend and the callback redirect', async () => {
  const h = await load({ signedOut: true, search: '?tour=' + requestedID });
  assert.match(h.ids['account-status'].textContent, /capture account/);
  h.ids['account-sign-in'].values = { email: 'owner@example.invalid' };
  await h.ids['account-sign-in'].fire('submit');
  h.tickSeconds(45); await h.ids['account-verify-resend'].fire('click');
  assert.ok(h.calls.filter(([name]) => name === 'otp').every(([, args]) =>
    args.options.emailRedirectTo === 'https://veylet.com/auth/callback?tour=' + requestedID));
  const callback = await load({ pathname: '/auth/callback', search: '?code=synthetic-code&tour=' + requestedID });
  assert.deepEqual(callback.redirects, ['/account?tour=' + requestedID]);
  assert.equal(callback.queries.length, 0);
});
test('requested review still waits for its original revision snapshot and clears stale checks', async () => {
  let finish;
  const target = { ...tour, id: requestedID };
  const h = await load({ tours: [target], search: '?tour=' + requestedID,
    rpc: { get_tour_review_target: () => new Promise(resolve => { finish = resolve; }),
           review_tour_versioned: async () => ({ error: { details: 'VEYLET_PACKAGE_REVISION_CHANGED' } }) } });
  assert.equal(h.all().some(el => el.textContent === 'Approve and share'), false);
  finish({ data: [{ tour_id: requestedID, storage_path: target.storage_path, package_revision: 'c'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  const selected = h.all().find(el => el.id === 'requested-tour');
  const form = selected.all().find(el => el.tagName === 'FORM');
  form.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  await form.fire('submit');
  assert.ok(form.all().filter(el => el.type === 'checkbox').every(el => !el.checked && el.disabled));
  assert.equal(h.calls.find(([name]) => name === 'review_tour_versioned')[1].p_expected_package_revision, 'c'.repeat(64));
});
test('operator handoff selects the preview but cannot open an owner review form', async () => {
  const h = await load({ role: 'operator', tours: [{ ...tour, id: requestedID }], search: '?tour=' + requestedID });
  const selected = h.all().find(el => el.id === 'requested-tour');
  assert.ok(selected?.wasFocused);
  assert.equal(selected.all().some(el => el.tagName === 'FORM'), false);
  assert.match(h.text(), /Awaiting the workspace owner/);
});
test('existing email session restores the desk on a fresh page load', async () => {
  const h = await load();
  assert.equal(h.ids['account-home'].hidden, false);
  // The page is the account; "Your walkthroughs" heads its work section, once.
  assert.equal(h.ids['account-title'].textContent, 'Your account.');
  assert.equal(h.ids['account-who'].textContent, 'Signed in as person@example.invalid');
  assert.equal(h.ids['account-setup-note'].hidden, true);
  assert.equal(h.ids['account-access-note'].hidden, true);
  assert.equal(h.ids['account-sign-in'].hidden, true);
  assert.ok(h.queries.includes('properties'));
  assert.match(h.text(), /Sample space/);
});
test('limited-access guidance survives signed-out startup and sign-out without blocking existing sign-in', async () => {
  const h = await load({ signedOut: true });
  assert.equal(h.ids['account-access-note'].hidden, false);
  assert.equal(h.ids['account-sign-in'].hidden, false);
  assert.equal(h.ids['account-sign-in-submit'].disabled, false);
  assert.doesNotMatch(h.ids['account-intro'].textContent, /creates a free email account/);
  h.supabase.auth.callback('SIGNED_IN', { user: { id: 'studio-user', email: 'studio@example.invalid' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.ids['account-access-note'].hidden, true);
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['account-access-note'].hidden, false);
  assert.equal(h.ids['account-sign-in'].hidden, false);
});
test('updated account HTML bypasses a fresh legacy script cached at the bare URL', async () => {
  const { createHash } = require('node:crypto');
  const src = markup.match(/<script\b[^>]*src="([^"]*\/account\.js[^\"]*)"/)?.[1];
  const version = createHash('sha256').update(account).digest('hex').slice(0, 16);
  assert.equal(src, `/account.js?v=${version}`);
  const legacy = "document.getElementById('account-title').textContent = 'Sign in or create your account.';";
  const freshBrowserCache = new Map([['/account.js', legacy]]);
  const served = freshBrowserCache.get(src) || account;
  const h = await load({ signedOut: true, accountScript: served });
  assert.equal(h.ids['account-title'].textContent, 'Sign in to your account.');
  assert.equal(h.ids['account-access-note'].hidden, false);
  assert.equal(freshBrowserCache.get('/account.js'), legacy);
});
test('a failed saved-session lookup is not reported as a signed-out account', async () => {
  const h = await load({ sessionError: true });
  assert.match(h.ids['account-status'].textContent, /could not be checked/);
  assert.equal(h.queries.length, 0);
});
test('tour service errors never look like an empty property', async () => {
  const h = await load({ tables: { tours: { error: { message: 'unavailable' } } } });
  assert.match(h.text(), /Tour status could not load/);
  assert.doesNotMatch(h.text(), /No tour package yet/);
});
test('release review checks the exact package, then turns sharing on in the same press', async () => {
  const h = await load({ tours: [tour] });
  assert.equal(h.all().some(el => el.textContent === 'Turn sharing on'), false);
  const form = h.all().find(el => el.tagName === 'FORM' && el.children.some(child => child.textContent === 'Approve and share'));
  await form.fire('submit');
  assert.equal(h.calls.some(call => call[0] === 'review_tour_versioned'), false);
  form.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  await form.fire('submit');
  await new Promise(resolve => setImmediate(resolve));
  const payload = h.calls.find(call => call[0] === 'review_tour_versioned')[1];
  assert.equal(payload.p_expected_storage_path, tour.storage_path);
  assert.equal(payload.p_expected_package_revision, 'a'.repeat(64));
  assert.equal(h.calls.some(call => call[0] === 'review_tour'), false);
  assert.equal(Object.keys(payload.p_checks).sort().join(','), 'alignment,coverage,mobile,navigation,privacy');
  assert.equal(payload.p_capture_permission, true);
  assert.equal(payload.p_publication_permission, true);
  // Approve and share: sharing is turned on once, for this tour, after the approval.
  assert.deepEqual(h.calls.filter(call => ['review_tour_versioned', 'enable_tour_share'].includes(call[0])).map(call => [call[0], call[1].p_tour_id]),
    [['review_tour_versioned', 't1'], ['enable_tour_share', 't1']]);
});
test('review preview and checks wait for the original opaque target snapshot', async () => {
  let finish;
  const h = await load({ tours: [tour], rpc: { get_tour_review_target: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(h.all().some(el => el.tagName === 'A' && /Preview|preview/.test(el.textContent)), false);
  assert.equal(h.all().some(el => el.textContent === 'Approve and share'), false);
  finish({ data: [{ tour_id: tour.id, storage_path: tour.storage_path, package_revision: 'c'.repeat(64) }] });
  await new Promise(resolve => setImmediate(resolve));
  const preview = h.all().find(el => el.textContent === 'Open review preview');
  assert.equal(preview.href, '/play/?id=t1&review_revision=' + 'c'.repeat(64));
  assert.equal(preview.target, '_blank');
  assert.equal(preview.href.includes(tour.storage_path), false);
  assert.ok(h.all().some(el => el.textContent === 'Approve and share'));
});
test('missing, malformed, stale-path and failed target snapshots cannot create approval forms', async () => {
  for (const reply of [
    { data: [] }, { error: { message: 'RPC unavailable' } },
    { data: [{ tour_id: tour.id, storage_path: tour.storage_path }] },
    { data: [{ tour_id: tour.id, storage_path: tour.storage_path, package_revision: 'not-a-revision' }] },
    { data: [{ tour_id: tour.id, storage_path: 'replacement.zip', package_revision: 'b'.repeat(64) }] },
  ]) {
    const h = await load({ tours: [tour], rpc: { get_tour_review_target: async () => reply } });
    assert.equal(h.all().some(el => el.textContent === 'Approve and share'), false);
    assert.equal(h.all().some(el => el.textContent === 'Open review preview'), false);
    assert.match(h.text(), /package version could not be confirmed/);
  }
});
test('same-path replacement cannot approve from stale answers or silently refresh its revision', async () => {
  let revision = 'a'.repeat(64), approved = false;
  const h = await load({ tours: [tour], rpc: {
    get_tour_review: async () => ({ data: [{ approved }] }),
    get_tour_review_target: async () => ({ data: [{ tour_id: tour.id, storage_path: tour.storage_path, package_revision: revision }] }),
    review_tour_versioned: async args => {
      if (args.p_expected_package_revision !== revision) return { error: { code: 'P0001', message: 'tour package changed; reload and review again', details: 'VEYLET_PACKAGE_REVISION_CHANGED' } };
      approved = true; return { data: [{ approved: true }] };
    },
  } });
  const form = h.all().find(el => el.tagName === 'FORM' && el.children.some(child => child.textContent === 'Approve and share'));
  const checks = form.all().filter(el => el.type === 'checkbox'); checks.forEach(el => { el.checked = true; });
  revision = 'b'.repeat(64);
  await form.fire('submit');
  assert.equal(h.calls.find(call => call[0] === 'review_tour_versioned')[1].p_expected_package_revision, 'a'.repeat(64));
  assert.equal(h.calls.filter(call => call[0] === 'get_tour_review_target').length, 1);
  assert.ok(checks.every(el => el.checked === false && el.disabled));
  assert.match(h.ids['account-status'].textContent, /package changed/i);
  checks.forEach(el => { el.checked = true; }); await form.fire('submit');
  assert.equal(h.calls.filter(call => call[0] === 'review_tour_versioned').length, 1);
  await h.all().find(el => el.textContent === 'Start a fresh review').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  const fresh = h.all().find(el => el.tagName === 'FORM' && el.children.some(child => child.textContent === 'Approve and share'));
  assert.ok(fresh.all().filter(el => el.type === 'checkbox').every(el => !el.checked));
  assert.match(h.all().find(el => el.textContent === 'Open review preview').href, new RegExp(revision));
  fresh.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  await fresh.fire('submit');
  assert.equal(h.calls.filter(call => call[0] === 'review_tour_versioned')[1][1].p_expected_package_revision, revision);
  assert.equal(approved, true);
});
test('an uncertain approval response clears old checks without automatic resubmission', async () => {
  for (const reply of [{ error: { message: 'network unavailable' } }, { data: [{ approved: 'false' }] }, { data: [] }]) {
    const h = await load({ tours: [tour], rpc: { review_tour_versioned: async () => reply } });
    const form = h.all().find(el => el.tagName === 'FORM' && el.children.some(child => child.textContent === 'Approve and share'));
    const checks = form.all().filter(el => el.type === 'checkbox'); checks.forEach(el => { el.checked = true; });
    await form.fire('submit');
    assert.ok(checks.every(el => el.checked === false && el.disabled));
    assert.equal(h.calls.filter(call => call[0] === 'get_tour_review_target').length, 1);
    assert.match(h.ids['account-status'].textContent, /not confirmed/);
  }
});
test('an operator cannot review their own capture or publish a different creator tour', async () => {
  const h = await load({ role: 'operator', tours: [{ ...tour, created_by: 'another-user' }], approved: true });
  assert.equal(h.all().some(el => el.textContent === 'Approve and share' || el.textContent === 'Turn sharing on'), false);
});
test('draft tours do not offer publication controls', async () => {
  const h = await load({ tours: [{ ...tour, status: 'draft' }], approved: true });
  assert.match(h.text(), /Rendering, step 5 of 5: Checking quality\. The check is automatic; sharing opens once it is ready for your review\./);
  assert.doesNotMatch(h.text(), /studio is|a person checks/i);
  assert.equal(h.calls.some(call => call[0] === 'get_tour_review'), false);
});
test('an old link can be revoked when its release review is stale', async () => {
  const h = await load({ tours: [{ ...tour, share_token: 'abcdefghijklmnop' }] });
  assert.ok(h.all().some(el => el.textContent === 'Turn off sharing'));
  assert.equal(h.all().some(el => el.textContent === 'Copy embed code'), false);
});
test('duplicate clicks do not start duplicate sharing requests', async () => {
  let finish;
  const h = await load({ tours: [tour], approved: true, rpc: { enable_tour_share: () => new Promise(resolve => { finish = resolve; }) } });
  const action = h.all().find(el => el.textContent === 'Turn sharing on');
  const first = action.fire('click'); await action.fire('click');
  assert.equal(h.calls.filter(call => call[0] === 'enable_tour_share').length, 1);
  finish({ data: 'receipt' }); await first;
});
test('account intent follows the selected role, including resend', async () => {
  const h = await load({ signedOut: true });
  h.ids['account-sign-in'].values = { email: 'owner@example.invalid', role_intent: 'owner' };
  await h.ids['account-sign-in'].fire('submit');
  h.tickSeconds(45);
  await h.ids['account-verify-resend'].fire('click');
  const requests = h.calls.filter(call => call[0] === 'otp');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(call => call[1].options.data.role_intent === 'owner'));
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const authRender = () => new Promise(resolve => setTimeout(resolve, 5));
async function beginCode(h, email = 'owner@example.invalid', role_intent = 'owner') {
  h.ids['account-sign-in'].values = { email, role_intent };
  await h.ids['account-sign-in'].fire('submit');
  h.ids['account-verify'].values = { token: '123456' };
}

test('a delayed email response cannot reopen verification after an authoritative sign-in', async () => {
  for (const response of [{}, { error: { message: 'old send failed' } }]) {
    const send = deferred();
    const h = await load({ signedOut: true, otp: () => send.promise });
    h.ids['account-sign-in'].values = { email: 'old@example.invalid' };
    const pending = h.ids['account-sign-in'].fire('submit');
    h.supabase.auth.callback('SIGNED_IN', { user: { id: 'current', email: 'current@example.invalid' } });
    // Complete before the queued session render as well as before checking UI.
    send.resolve(response); await pending; await authRender();
    assert.equal(h.ids['account-home'].hidden, false);
    assert.equal(h.ids['account-verify'].hidden, true);
    assert.equal(h.ids['account-sign-in'].dataset.awaitingCode, 'no');
    assert.equal(h.ids['account-sign-in-submit'].disabled, false);
    assert.doesNotMatch(h.ids['account-status'].textContent, /Check your email|Could not send/);
  }
});

test('editing pending sign-in details preserves the new email and role intent', async () => {
  const first = deferred(), second = deferred(); let requests = 0;
  const h = await load({ signedOut: true, otp: () => (++requests === 1 ? first : second).promise });
  h.ids['account-sign-in'].values = { email: 'old@example.invalid', role_intent: 'owner' };
  const oldRequest = h.ids['account-sign-in'].fire('submit');
  h.ids['account-sign-in'].values = { email: 'new@example.invalid', role_intent: 'operator' };
  await h.ids['account-sign-in'].fire('input');
  const newRequest = h.ids['account-sign-in'].fire('submit');
  first.resolve({}); await oldRequest;
  assert.equal(h.ids['account-verify'].hidden, true);
  assert.equal(h.ids['account-sign-in-submit'].disabled, true);
  second.resolve({}); await newRequest;
  assert.equal(h.ids['account-verify-email'].textContent, 'new@example.invalid');
  h.tickSeconds(45); await h.ids['account-verify-resend'].fire('click');
  const resends = h.calls.filter(call => call[0] === 'otp');
  assert.equal(resends[2][1].email, 'new@example.invalid');
  assert.equal(resends[2][1].options.data.role_intent, 'operator');
});

test('a resend completing after changing email cannot overwrite the new verification state', async () => {
  const resend = deferred(); let requests = 0;
  const h = await load({ signedOut: true, otp: () => ++requests === 2 ? resend.promise : {} });
  await beginCode(h); h.tickSeconds(45);
  const pending = h.ids['account-verify-resend'].fire('click');
  assert.equal(h.verifySubmit.disabled, true);
  await h.ids['account-verify'].fire('submit');
  assert.equal(h.calls.some(call => call[0] === 'verify'), false);
  await h.ids['account-verify-restart'].fire('click');
  await beginCode(h, 'new@example.invalid', 'operator');
  const currentStatus = h.ids['account-status'].textContent;
  resend.resolve({ error: { message: 'old resend failed' } }); await pending;
  assert.equal(h.ids['account-verify-email'].textContent, 'new@example.invalid');
  assert.equal(h.ids['account-status'].textContent, currentStatus);
  assert.equal(h.ids['account-verify-resend'].disabled, true);
  assert.equal(h.verifySubmit.disabled, false);
});

test('pending code verification blocks conflicting actions even after the resend cooldown ends', async () => {
  const verify = deferred();
  const h = await load({ signedOut: true, verify: () => verify.promise });
  await beginCode(h);
  const pending = h.ids['account-verify'].fire('submit');
  h.tickSeconds(45);
  assert.equal(h.ids['account-verify-resend'].disabled, true);
  assert.equal(h.ids['account-verify-restart'].disabled, true);
  await h.ids['account-verify-restart'].fire('click');
  await h.ids['account-verify-resend'].fire('click');
  await h.ids['account-verify'].fire('submit');
  assert.equal(h.calls.filter(call => call[0] === 'otp').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'verify').length, 1);
  assert.equal(h.ids['account-sign-in'].hidden, true);
  verify.resolve({ error: { message: 'expired' } }); await pending;
  assert.match(h.ids['account-status'].textContent, /wrong or has expired/);
  assert.equal(h.verifySubmit.disabled, false);
  assert.equal(h.ids['account-verify-restart'].disabled, false);
  assert.equal(h.ids['account-verify-resend'].disabled, false);
});

test('stale verification responses cannot overwrite signed-in or signed-out sessions', async () => {
  for (const signedIn of [true, false]) {
    const verify = deferred();
    const h = await load({ signedOut: true, verify: () => verify.promise });
    await beginCode(h); const pending = h.ids['account-verify'].fire('submit');
    h.supabase.auth.callback(signedIn ? 'SIGNED_IN' : 'SIGNED_OUT', signedIn ? { user: { id: 'new-user', email: 'new@example.invalid' } } : null);
    await authRender(); const currentStatus = h.ids['account-status'].textContent;
    verify.resolve(signedIn ? { error: { message: 'old code failed' } } : {}); await pending;
    assert.equal(h.ids['account-status'].textContent, currentStatus);
    assert.equal(h.ids['account-home'].hidden, !signedIn);
    assert.equal(h.ids['account-verify'].hidden, true);
    assert.equal(h.verifySubmit.disabled, false);
    assert.equal(h.ids['account-verify-restart'].disabled, false);
  }
});

test('unconfirmed code verification requires reload or its authoritative session before a new identity attempt', async () => {
  const verify = deferred();
  const h = await load({ signedOut: true, manualTimeouts: true, verify: () => verify.promise });
  await beginCode(h); const pending = h.ids['account-verify'].fire('submit');
  h.expireRequests(); await pending; h.tickSeconds(45);
  assert.match(h.ids['account-status'].textContent, /Reload this page/);
  await h.ids['account-verify-restart'].fire('click');
  await h.ids['account-verify-resend'].fire('click');
  await h.ids['account-verify'].fire('submit');
  assert.equal(h.calls.filter(call => call[0] === 'verify').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'otp').length, 1);
  assert.equal(h.ids['account-verify-restart'].disabled, true);
  assert.equal(h.ids['account-verify-resend'].disabled, true);
  h.supabase.auth.callback('SIGNED_IN', { user: { id: 'confirmed-user', email: 'owner@example.invalid' } });
  verify.resolve({ data: { session: { user: { id: 'confirmed-user' } } } }); await authRender();
  assert.equal(h.ids['account-home'].hidden, false);
  assert.equal(h.ids['account-verify'].hidden, true);
});
test('an unconfirmed sign-out does not report success', async () => {
  const h = await load({ signOutError: true });
  await h.ids['account-sign-out'].fire('click');
  assert.match(h.ids['account-status'].textContent, /not confirmed/);
});
test('withdrawing review requires confirmation and removes publish controls', async () => {
  const h = await load({ tours: [tour], approved: true });
  const action = h.all().find(el => el.textContent === 'Withdraw approval');
  await action.fire('click');
  assert.equal(h.calls.some(call => call[0] === 'withdraw_tour_review'), false);
  await action.fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call[0] === 'withdraw_tour_review').length, 1);
  assert.equal(h.all().some(el => el.textContent === 'Turn sharing on'), false);
  assert.ok(h.all().some(el => el.textContent === 'Approve and share'));
});
test('a queued sign-in callback cannot reopen a desk after sign-out', async () => {
  const h = await load();
  h.supabase.auth.callback('SIGNED_IN', { user: { id: 'stale-user', email: 'stale@example.invalid' } });
  h.supabase.auth.callback('SIGNED_OUT', null);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.ids['account-home'].hidden, true);
  assert.equal(h.ids['account-properties'].children.length, 0);
});

test('revoke announces completion only after the stored token is read back as null', async () => {
  const h = await load({ tours: [{ ...tour, share_token: 'abcdefghijklmnop' }], approved: true });
  const action = h.all().find(el => el.textContent === 'Turn off sharing');
  await action.fire('click');
  assert.ok(h.all().some(el => el.textContent === 'Keep link' && !el.hidden));
  // The old six-second window re-armed the first click while people read the
  // consequence. Confirmation must remain available until cancelled.
  await new Promise(resolve => setTimeout(resolve, 6200));
  assert.equal(action.textContent, 'Confirm: turn off sharing');
  assert.equal(h.calls.some(call => call[0] === 'revoke_tour_share'), false);
  await action.fire('click');
  assert.match(h.ids['account-status'].textContent, /Sharing turned off/);
  assert.equal(h.all().some(el => el.textContent === 'Copy embed code'), false);
});
test('revoke keeps an uncertain readback separate from confirmed revocation', async () => {
  const h = await load({ tours: [{ ...tour, share_token: 'abcdefghijklmnop' }], approved: true, rpc: { revoke_tour_share: async () => ({ data: null }) } });
  const action = h.all().find(el => el.textContent === 'Turn off sharing');
  await action.fire('click');
  await action.fire('click');
  assert.match(h.ids['account-status'].textContent, /current sharing state could not be confirmed/);
  assert.doesNotMatch(h.ids['account-status'].textContent, /Sharing turned off/);
});

const rowStatus = h => h.all().filter(el => el.className === 'tour-row-status' && !el.hidden).map(el => el.textContent).join('\n');
test('a row action explains itself beside the control as well as in the page status', async () => {
  const h = await load({ tours: [{ ...tour, share_token: 'abcdefghijklmnop' }], approved: true });
  const revoke = h.all().find(el => el.textContent === 'Turn off sharing');
  await revoke.fire('click');
  assert.equal(revoke.dataset.armed, 'true');
  assert.match(rowStatus(h), /Downloaded copies cannot be recalled/);
  assert.match(h.ids['account-status'].textContent, /Downloaded copies cannot be recalled/);
  await h.all().find(el => el.textContent === 'Keep link').fire('click');
  assert.equal(revoke.dataset.armed, 'false');
  assert.match(rowStatus(h), /Link left unchanged/);
  assert.equal(h.calls.some(call => call[0] === 'revoke_tour_share'), false);
});
test('a confirmed handoff is still explained in its row after the desk reloads', async () => {
  const h = await load({ tours: [tour], approved: true, rpc: { enable_tour_share: async () => { tour.share_token = 'abcdefghijklmnop'; return { data: 'receipt' }; } } });
  try {
    await h.all().find(el => el.textContent === 'Turn sharing on').fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(rowStatus(h), /^Live\. Anyone with the link can open it\.$/m);
    assert.ok(h.all().some(el => el.textContent === 'Copy link'));
  } finally { delete tour.share_token; }
});
test('a failed check becomes one itemised correction request without recording a review', async () => {
  const h = await load({ tours: [tour] });
  const boxes = h.all().filter(el => el.tagName === 'INPUT' && el.type === 'checkbox');
  for (const box of boxes) box.checked = box.name !== 'alignment';
  const link = h.all().find(el => el.textContent === 'Request corrections by email');
  await link.fire('click');
  const body = decodeURIComponent(link.href.split('&body=')[1]);
  assert.match(body, /Walls, furniture and edges stay aligned/);
  assert.doesNotMatch(body, /Every included room/);
  assert.doesNotMatch(link.href, /Sample space|original\.zip/);
  assert.match(link.href, /^mailto:/);
  assert.equal(h.calls.some(call => call[0] === 'review_tour_versioned'), false);
});
test('a processing tour is rechecked quietly, but never over work in progress', async () => {
  const h = await load({ tours: [{ ...tour, status: 'processing' }] });
  assert.equal(h.pollCount(), 1);
  const before = h.queries.length;
  await h.firePolls();
  assert.ok(h.queries.length > before, 'an idle desk refreshes itself');
  assert.equal(h.pollCount(), 1, 'and keeps watching while processing continues');
  await h.ids['account-properties'].fire('input');
  const busy = h.queries.length;
  await h.firePolls();
  assert.equal(h.queries.length, busy, 'a desk in use is left alone');
  const settled = await load({ tours: [tour] });
  assert.equal(settled.pollCount(), 0, 'nothing polls once processing is over');
});
test('returning to the tab refreshes waiting work once, and sign-out stops the watch', async () => {
  const h = await load({ tours: [{ ...tour, status: 'processing' }] });
  const before = h.queries.length;
  h.documentEvents.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.queries.length > before);
  const once = h.queries.length;
  h.documentEvents.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queries.length, once, 'a second return within a minute does not reload again');
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.pollCount(), 0);
  assert.equal(h.ids['account-updated'].textContent, '');
});
test('the records file lists spaces and tours without link secrets or storage paths', async () => {
  const h = await load({ tours: [{ ...tour, share_token: 'abcdefghijklmnop' }], approved: true });
  assert.equal(h.ids['account-export'].disabled, false);
  assert.match(h.ids['account-updated'].textContent, /^Updated /);
  await h.ids['account-export'].fire('click');
  assert.equal(h.exported.length, 1);
  const text = h.exported[0].parts.join('');
  const records = JSON.parse(text);
  assert.equal(records.spaces[0].tours[0].has_active_link, true);
  assert.doesNotMatch(text, /abcdefghijklmnop|original\.zip|share_token|storage_path/);
  assert.match(h.ids['account-status'].textContent, /does not contain the tours themselves/);
});
test('the records file is unavailable while tour status could not load', async () => {
  const h = await load({ tables: { tours: { error: { message: 'unavailable' } } } });
  assert.equal(h.ids['account-export'].disabled, true);
  await h.ids['account-export'].fire('click');
  assert.equal(h.exported.length, 0);
});

/* ---- Your plan -------------------------------------------------------
 * Three free months with six walkthroughs in total, started by activating the
 * plan and renewing afterwards unless cancelled; a source that decides which
 * price is true; and a failed lookup that must read as unavailable rather than
 * as started, empty or approved. Nothing in this panel may take a payment.
 */
// Offer 2026-09-25.2: the Veylet plan (code solo), 3 free months with 6 walkthroughs, 2 a month, no extra price.
const planRow = {
  workspace_id: 'w1', plan_code: 'solo', source: 'studio', status: 'trial', trial_months: 3, billing_interval: 'monthly',
  trial_included_walkthroughs: 6, accepted_in_free_months: 2, extras_in_free_months: 0,
  trial_started_at: '2026-09-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z',
  period_started_at: '2026-09-01T00:00:00Z', period_ends_at: '2026-10-01T00:00:00Z',
  current_period_ends_at: null, auto_renews: true, cancelled_at: null,
  included_per_month: 2, accepted_this_period: 0, accepted_total: 4,
  price_aud_cents: 9900, extra_walkthrough_aud_cents: null,
  app_price_aud_cents: 11999, app_extra_walkthrough_aud_cents: null,
  apple_verified: null, apple_product_id: null, hosting_included: true,
  updated_at: '2026-09-22T00:00:00Z',
};
// An existing row on the retired Team plan (code studio), which keeps its own terms and name.
const TEAM = { plan_code: 'studio', included_per_month: 3, trial_included_walkthroughs: 4, price_aud_cents: 18900,
  extra_walkthrough_aud_cents: 8900, app_price_aud_cents: 21999, app_extra_walkthrough_aud_cents: 9999 };
const longDate = value => new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
const inDays = days => new Date(Date.now() + days * 86400000).toISOString();
const withPlan = (overrides, options = {}) => load({
  ...options,
  rpc: { ...options.rpc, get_workspace_plan: async () => ({ data: [{ ...planRow, ...overrides }] }) },
});
const planText = h => h.ids['account-plan-body'].all().map(el => el.textContent).join('\n');
const planTerms = h => h.ids['account-plan-body'].all().filter(el => el.tagName === 'DT').map(el => el.textContent);
const planLinks = h => h.ids['account-plan-body'].all().filter(el => el.tagName === 'A').map(el => el.href);
const planTitle = h => (h.ids['account-plan-body'].all().find(el => el.className === 'plan-title') || {}).textContent;
const planValues = h => h.ids['account-plan-body'].all().filter(el => el.tagName === 'DD').map(el => el.textContent);
const planScopes = h => h.ids['account-plan-body'].all().filter(el => el.className === 'plan-scope').map(el => el.textContent);
const HOSTING_INCLUDED = 'Included while your plan is active';
const FREE_TERMS = ['State', 'Free walkthroughs', 'Renews', 'Hosting', 'Extra walkthroughs', 'Managed in'];
const ACTIVE_TERMS = ['State', 'This month', 'Renews', 'Hosting', 'Extra walkthroughs', 'Managed in'];

test('the plan date format is one day, one month name and one year', () => {
  assert.match(longDate('2026-12-01T12:00:00Z'), /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
});

test('the pending plan panel states conditional introductory terms in the shared words', async () => {
  const h = await withPlan({ status: 'pending', trial_started_at: null, trial_ends_at: null,
    accepted_this_period: 0, accepted_in_free_months: 0 });
  assert.match(planText(h), /Review the available plan\. Eligible subscribers can start with 3 free months and 6 walkthroughs in total\./);
  assert.deepEqual(planTerms(h), FREE_TERMS);
  assert.deepEqual(planValues(h), ['Not started', '0 of 6', 'Not started', HOSTING_INCLUDED, '—', 'Studio invoice']);
  // An invoiced account cannot start itself, so it is given the studio.
  assert.deepEqual(planLinks(h), ['/offer', 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan']);
  const four = await withPlan({ status: 'pending', trial_months: 4, trial_included_walkthroughs: 2,
    trial_started_at: null, trial_ends_at: null });
  assert.match(planText(four), /Eligible subscribers can start with 4 free months and 2 walkthroughs in total\./);
});

test('a pending workspace never establishes introductory eligibility or promises free activation', async () => {
  // A workspace row cannot tell whether the signed-in Apple Account has already
  // used its introductory offer. This also covers a new workspace for a returning
  // subscriber: missing/unverified Apple information must not become eligibility.
  for (const source of [null, 'studio', 'apple']) {
    const h = await withPlan({ source, status: 'pending', apple_verified: false,
      trial_started_at: null, trial_ends_at: null, accepted_in_free_months: 0 });
    assert.equal(planTitle(h), 'Plan not started');
    assert.match(planText(h), /Eligible subscribers can start with 3 free months and 6 walkthroughs in total/);
    assert.doesNotMatch(planText(h), /Start your (?:six )?free months|Free until|Renews on|A\$0/);
    if (source === null) {
      assert.match(planScopes(h).join(' '), /Start in the app through the App Store, where Apple checks introductory-offer eligibility/);
      assert.match(planScopes(h).join(' '), /the first charge is on the day the free months end\./);
    }
  }
});

test('a returning paid Apple workspace retains the ended-plan recovery without a fresh-trial promise', async () => {
  const h = await withPlan({ ...TEAM, source: 'apple', status: 'ended', apple_verified: true,
    apple_product_id: 'dev.property3d.capture.plan.annual', billing_interval: 'annual',
    renewal_price_aud_cents: 318999, accepted_in_free_months: 4, auto_renews: false,
    current_period_ends_at: '2026-08-05T00:00:00Z' });
  assert.equal(planTitle(h), 'Plan ended ' + longDate('2026-08-05T00:00:00Z'));
  assert.match(planText(h), /a second free trial is not guaranteed/);
  assert.doesNotMatch(planText(h), /Start your.*free months|Eligible subscribers can start|Renews on/);
  assert.ok(planLinks(h).includes('https://apps.apple.com/account/subscriptions'));
});

test('pending accounts have management routes without a card form', async () => {
  for (const source of ['web', 'apple']) {
    const h = await withPlan({ source, status: 'pending', trial_started_at: null, trial_ends_at: null,
      accepted_this_period: 0, accepted_in_free_months: 0 });
    if (source === 'apple') {
      assert.match(planScopes(h).join(' '), /Manage in Settings › Subscriptions/);
      assert.ok(planLinks(h).includes('https://apps.apple.com/account/subscriptions'));
    } else {
      // A card plan on this website is still changed or cancelled through the studio.
      assert.match(planScopes(h).join(' '), /Your card plan is managed by Veylet support: email to change or cancel it/);
      assert.ok(planLinks(h).some(link => link.startsWith('mailto:')));
    }
    assert.equal(h.ids['account-plan-body'].all().some(el => el.type === 'submit'
      || /pay now|checkout form|card number|enter your card/i.test(el.textContent || '')), false);
  }
});

test('the plan panel counts the six free walkthroughs and states the renewal while they run', async () => {
  const h = await withPlan({});
  const until = longDate(planRow.trial_ends_at);
  // The reminder sentence, word for word: the date the free months end, then the price that follows.
  assert.match(planText(h), new RegExp('2 of 6 free walkthroughs used\\. Free until ' + until +
    ', then A\\$99 a month unless you cancel\\.'));
  assert.doesNotMatch(planText(h), /Renews on/);
  assert.deepEqual(planTerms(h), FREE_TERMS);
  assert.deepEqual(planValues(h), ['Free months', '2 of 6', until, HOSTING_INCLUDED, '—', 'Studio invoice']);
  assert.equal(planTitle(h), 'Free until ' + until);
  assert.equal(planTitle(h).split(until).length - 1, 1, 'the lead line states the date once');
  assert.deepEqual(planLinks(h), ['/offer', 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan']);
});

test('an App Store account is shown the App Store price, and where to cancel it', async () => {
  const h = await withPlan({ source: 'apple', apple_verified: true });
  const until = longDate(planRow.trial_ends_at);
  assert.match(planText(h), new RegExp('Free until ' + until + ', then A\\$119\\.99 a month unless you cancel\\.'));
  assert.deepEqual(planValues(h), ['Free months', '2 of 6', until, HOSTING_INCLUDED, '—', 'App Store']);
  assert.doesNotMatch(planText(h), /A\$99(?![\d.])/, 'the website price is not shown to an App Store account');
  assert.match(planScopes(h).join(' '), /Manage in Settings › Subscriptions/);
  assert.match(planScopes(h).join(' '), /Packs are not sold in the app\./);
  // With included walkthroughs left, the packs card below is the pointer; the panel does not repeat it.
  assert.doesNotMatch(planText(h), /Need more walkthroughs\?/);
  const web = await withPlan({ source: 'web' });
  assert.deepEqual(planValues(web), ['Free months', '2 of 6', until, HOSTING_INCLUDED, '—', 'Website']);
  assert.match(planText(web), new RegExp(', then A\\$99 a month unless you cancel'));
});

test('a cancelled trial says it ends, and never that it renews', async () => {
  const h = await withPlan({ auto_renews: false, cancelled_at: '2026-09-20T00:00:00Z' });
  const until = longDate(planRow.trial_ends_at);
  assert.match(planText(h), new RegExp('2 of 6 free walkthroughs used\\. It ends on ' + until + ' and will not renew\\.'));
  assert.deepEqual(planValues(h), ['Free months', '2 of 6', 'Does not renew', HOSTING_INCLUDED, '—', 'Studio invoice']);
  assert.doesNotMatch(planText(h), /Renews on/);
});

test('the plan panel states the plan and its price once it is active', async () => {
  const renews = '2026-10-01T00:00:00Z';
  const h = await withPlan({ status: 'active', accepted_this_period: 1, accepted_total: 11, current_period_ends_at: renews });
  assert.match(planText(h), new RegExp('1 of 2 walkthroughs this month\\. Next billing date: ' +
    longDate(renews) + '\\. Hosting included\\.'));
  assert.deepEqual(planTerms(h), ACTIVE_TERMS);
  assert.deepEqual(planValues(h), ['Active', '1 of 2 accepted', longDate(renews), HOSTING_INCLUDED, '—', 'Studio invoice']);
  assert.equal(planTitle(h), 'Veylet plan · A$99 a month');
  assert.equal(planText(h).split('Veylet plan · A$99 a month').length - 1, 1, 'the price is stated once');
  assert.deepEqual(planLinks(h), ['/offer', 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan']);
  // An active plan with no period end cannot say when it renews.
  const noPeriod = await withPlan({ status: 'active', current_period_ends_at: null });
  assert.equal(planTitle(noPeriod), 'Plan status unavailable');
});

test('the plan panel names the Veylet plan from its code, and each retired plan by its own name', async () => {
  const renews = '2026-10-01T00:00:00Z';
  const plan = await withPlan({ status: 'active', current_period_ends_at: renews });
  assert.equal(planTitle(plan), 'Veylet plan · A$99 a month');
  assert.match(planText(plan), /0 of 2 walkthroughs this month/);
  assert.match(planText(plan), /2 included walkthroughs remaining this month/);
  const apple = await withPlan({ status: 'active', current_period_ends_at: renews, source: 'apple', apple_verified: true,
    apple_product_id: 'dev.property3d.capture.solo.monthly' });
  assert.equal(planTitle(apple), 'Veylet plan · A$119.99 a month');
  // Existing rows on plans retired for new buyers (offer 2026-09-24.2) keep their terms and names.
  const active = { status: 'active', current_period_ends_at: renews };
  for (const [overrides, title] of [
    [{ ...TEAM }, 'Team · A$189 a month'],
    [{ ...TEAM, plan_code: 'founding', price_aud_cents: null, billing_interval: 'monthly', renewal_price_aud_cents: 18900 }, 'Team, founding rate · A$189 a month'],
    [{ plan_code: 'office', included_per_month: 10, price_aud_cents: 59900 }, 'Office · A$599 a month'],
    [{ ...TEAM, source: 'apple', apple_verified: true, apple_product_id: 'dev.property3d.capture.plan.monthly' }, 'Team · A$219.99 a month'],
    [{ source: 'apple', apple_verified: true, apple_product_id: 'dev.property3d.capture.solo.annual',
      billing_interval: 'annual', renewal_price_aud_cents: 131999 }, 'Veylet plan · A$1,319.99 a year'],
    // A code that disagrees with the purchased App Store product is not given either name.
    [{ plan_code: 'studio', source: 'apple', apple_verified: true, apple_product_id: 'dev.property3d.capture.solo.monthly',
      renewal_price_aud_cents: 11999 }, 'Plan · A$119.99 a month'],
    [{ plan_code: 'unknown' }, 'Plan · A$99 a month'],
  ]) {
    const h = await withPlan({ ...active, ...overrides });
    assert.equal(planTitle(h), title);
    assert.doesNotMatch(planText(h), /\bSolo\b/, 'the retired name Solo is never shown');
  }
});

test('the panel separates free months that lapsed from a plan that ended', async () => {
  const lapsed = '2026-09-01T00:00:00Z';
  const h = await withPlan({ status: 'ended', trial_ends_at: lapsed, accepted_this_period: 0, accepted_in_free_months: 3 });
  assert.equal(planTitle(h), 'Free months ended ' + longDate(lapsed));
  assert.deepEqual(planValues(h), ['Ended', '3 of 6', '—', 'Offline 14 days after the plan ends', '—', 'Studio invoice']);
  assert.match(planText(h), /Your released walkthroughs stay online for 14 days after the plan ends, then go offline\. Restarting the plan brings the same links back at once; a second free trial is not guaranteed\./);
  assert.deepEqual(planLinks(h), ['/offer', 'mailto:yoda@yodalai.xyz?subject=Veylet%20plan']);
  const restart = h.ids['account-plan-body'].all().find(el => el.tagName === 'A' && el.textContent === 'Restart your plan');
  assert.equal(restart.className, 'button', 'the one fix is filled');
  assert.doesNotMatch(planText(h), /12 months|twelve months|A\$49|Guaranteed/);
  const paidUntil = '2026-08-05T00:00:00Z';
  const afterPlan = await withPlan({ source: 'web', status: 'ended', accepted_in_free_months: 6,
    current_period_ends_at: paidUntil, auto_renews: false });
  assert.equal(planTitle(afterPlan), 'Plan ended ' + longDate(paidUntil));
  assert.match(planScopes(afterPlan).join(' '), /Your card plan is managed by Veylet support/);
});

test('an unanswered plan lookup is unavailable, not started and not approved', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { data: [] }, { data: [{ status: 'surprise' }] }]) {
    const h = await load({ rpc: { get_workspace_plan: async () => reply } });
    assert.match(planText(h), /Plan status unavailable/);
    assert.match(planText(h), /Refresh to check your free months and allowance\./);
    // The row labels stay; no date, allowance or price is claimed from a failure.
    assert.doesNotMatch(planText(h), /Free until \d|free months: |Veylet plan ·|Team ·|A\$/);
    assert.deepEqual(planTerms(h), FREE_TERMS);
    assert.deepEqual(planLinks(h), []);
    const refresh = h.ids['account-plan-body'].all().find(el => el.textContent === 'Refresh plan status');
    assert.ok(refresh, 'the unavailable state offers a refresh');
    const before = h.calls.filter(call => call[0] === 'get_workspace_plan').length;
    await refresh.fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.filter(call => call[0] === 'get_workspace_plan').length, before + 1);
  }
});

test('missing allowance or dates cannot create a plan claim; unknown billing stays explicit', async () => {
  for (const overrides of [{ trial_included_walkthroughs: null }, { accepted_in_free_months: null }, { trial_ends_at: null }]) {
    const h = await withPlan(overrides);
    assert.equal(planTitle(h), 'Plan status unavailable', JSON.stringify(overrides));
    assert.ok(planLinks(h).some(link => link.startsWith('mailto:')), 'billing management remains reachable');
  }
  for (const overrides of [{ billing_interval: null }, { price_aud_cents: null },
    { source: 'apple', billing_interval: 'annual', apple_product_id: 'dev.property3d.capture.plan.annual' }]) {
    const h = await withPlan(overrides);
    assert.match(planTitle(h), /^Free until /);
    assert.match(planText(h), /Confirm the renewal amount and billing period/);
    assert.doesNotMatch(planText(h), /Renews on .* at A\$/);
  }
});

test('the plan panel shows the rows that are coming before any number arrives', async () => {
  let finish;
  const h = await load({ rpc: { get_workspace_plan: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(h.ids['account-plan'].attributes['aria-busy'], 'true');
  assert.deepEqual(planTerms(h), FREE_TERMS);
  assert.match(planText(h), /Checking your free months, what is left and when the plan renews…/);
  assert.equal(h.ids['account-plan-body'].all().filter(el => el.className === 'plan-skeleton').length, 6);
  // The rest of the loaded panel is waiting too, in its own classes: the count, the notes and the links.
  const skeletonClasses = h.ids['account-plan-body'].all().filter(el => el.all().some(child => /plan-skeleton-(?:line|link)/.test(child.className || '')) || /plan-skeleton-link/.test(el.className || '')).map(el => el.className);
  for (const name of ['plan-allowance', 'plan-scope', 'tour-actions-row plan-actions']) assert.ok(skeletonClasses.includes(name), name);
  // Every bar is hidden filler: nothing is read out and no number is claimed.
  const bars = h.ids['account-plan-body'].all().filter(el => /\bplan-skeleton\b/.test(el.className || ''));
  assert.ok(bars.every(bar => bar.attributes['aria-hidden'] === 'true' && /^[n ]+$/.test(bar.textContent)));
  assert.match(h.text(), /Sample space/, 'the spaces list does not wait for the plan');
  finish({ data: [planRow] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids['account-plan'].attributes['aria-busy'], 'false');
  assert.equal(h.ids['account-plan-body'].all().some(el => el.className === 'plan-skeleton'), false);
});

test('the plan panel reads the first active membership and names it when there are several', async () => {
  const h = await withPlan({}, { tables: { memberships: { data: [
    { workspace_id: 'w1', role: 'owner', status: 'active' },
    { workspace_id: 'w2', role: 'owner', status: 'active' },
  ] } } });
  assert.equal(h.calls.find(call => call[0] === 'get_workspace_plan')[1].p_workspace_id, 'w1');
  assert.match(planText(h), /Showing Sample space\. You are an active member of 2 workspaces/);
  const single = await withPlan({});
  assert.doesNotMatch(planText(single), /You are an active member of/);
});

test('an unreadable membership list cannot produce a plan claim', async () => {
  const h = await load({ tables: { memberships: { error: { message: 'offline' } } },
    rpc: { get_workspace_plan: async () => ({ data: [planRow] }) } });
  assert.equal(h.calls.some(call => call[0] === 'get_workspace_plan'), false);
  assert.match(planText(h), /Plan status unavailable/);
});

test('signing out clears the plan panel', async () => {
  const h = await withPlan({});
  assert.ok(h.ids['account-plan-body'].children.length);
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['account-plan-body'].children.length, 0);
});

test('the desk first-capture steps follow the app-first flow', () => {
  assert.match(markup, /Install Veylet Capture on a LiDAR iPhone and sign in with this same email/);
  assert.match(markup, /Do one practice capture in a space you are allowed to record/);
  assert.match(markup, /choose Export capture/);
  assert.match(markup, /Direct sending from the app and public website import are not available/);
  assert.match(markup, /Review the walkthrough here, confirm its permissions, then press Approve and share/);
  assert.doesNotMatch(markup, /Save a space\. Suburb or city only/);
  // The walkthroughs come first and the plan follows them; the page still says
  // the heading without JavaScript having to write it.
  assert.ok(markup.indexOf('>Your walkthroughs<') < markup.indexOf('id="account-plan"'));
  assert.equal(markup.match(/id="account-plan-title"/g).length, 1);
  // This desk takes no card, with or without a script.
  assert.doesNotMatch(markup, /autocomplete="cc-|card number|cardholder|cvc/i);
  assert.doesNotMatch(account, /never charge without your yes|never an automatic charge/);
});

test('a signed-in account with no workspace is told how the free months start, not offered a dead refresh', async () => {
  const h = await load({ tables: { memberships: { data: [] } },
    rpc: { get_workspace_plan: async () => ({ data: [planRow] }) } });
  assert.equal(h.calls.some(call => call[0] === 'get_workspace_plan'), false, 'there is no workspace to ask about');
  assert.deepEqual(planTerms(h), FREE_TERMS);
  assert.deepEqual(planValues(h), ['Not started', '—', 'Not started', '—', '—', '—']);
  assert.match(planText(h), /Add a space to prepare your account\. Saving a space does not activate the plan\./);
  assert.doesNotMatch(planText(h), /Plan status unavailable|Refresh to check/);
  assert.equal(h.ids['account-plan-body'].all().some(el => el.tagName === 'BUTTON'), false, 'no refresh that cannot succeed');
  assert.deepEqual(planLinks(h), ['/offer']);
});

test('the State row says the state in short, and never repeats a date or a price', async () => {
  const cases = [
    [{ status: 'pending', trial_ends_at: null }, 'Not started'],
    [{}, 'Free months'],
    [{ status: 'active', current_period_ends_at: '2026-10-01T00:00:00Z' }, 'Active'],
    [{ status: 'ended', trial_ends_at: '2026-09-01T00:00:00Z' }, 'Ended'],
  ];
  for (const [overrides, word] of cases) {
    const h = await withPlan(overrides);
    assert.equal(planValues(h)[0], word);
    assert.doesNotMatch(planValues(h)[0], /\d/, 'no date or amount in the State row');
  }
});

test('the next step leads with its heading, without a tracked-caps kicker', async () => {
  const h = await load({ tours: [tour] });
  const panel = h.ids['account-next-step'];
  assert.equal(panel.children[0].tagName, 'H2');
  assert.equal(panel.all().some(el => el.className === 'eyebrow'), false);
  assert.doesNotMatch(h.text(), /YOUR NEXT STEP/);
});

test('the panel leads with the vocabulary title, then the rows, then the sentence', async () => {
  const titles = [
    [{ status: 'pending', trial_ends_at: null }, 'Plan not started'],
    [{}, 'Free until ' + longDate(planRow.trial_ends_at)],
    [{ status: 'active', current_period_ends_at: '2026-10-01T00:00:00Z' }, 'Veylet plan · A$99 a month'],
    [{ status: 'ended', trial_ends_at: '2026-09-01T00:00:00Z' }, 'Free months ended ' + longDate('2026-09-01T00:00:00Z')],
    [{ status: 'ended', current_period_ends_at: '2026-08-05T00:00:00Z' }, 'Plan ended ' + longDate('2026-08-05T00:00:00Z')],
  ];
  for (const [overrides, title] of titles) {
    const h = await withPlan(overrides);
    const parts = h.ids['account-plan-body'].children;
    assert.equal(parts[0].className, 'plan-title');
    assert.equal(parts[0].textContent, title);
    assert.equal(parts[1].tagName, 'DL');
    assert.equal(parts[2].className, 'plan-body');
    // A trial's date comes back once more, in its reminder sentence, and nowhere else.
    const reminder = title.startsWith('Free until ');
    assert.equal(planText(h).split(title).length - 1, reminder ? 2 : 1, 'the title is stated once');
    if (reminder) assert.match(parts[2].textContent, new RegExp(title + ', then A\\$99 a month unless you cancel\\.$'));
  }
  const unavailable = await load({ rpc: { get_workspace_plan: async () => ({ error: { message: 'offline' } }) } });
  assert.equal(planTitle(unavailable), 'Plan status unavailable');
  assert.equal(planValues(unavailable)[0], '—', 'an unavailable State row claims nothing');
});

/* ---- Deleting your account -------------------------------------------
 * Asked for here or in the app, completed by the studio within 30 days. An
 * unanswered check is unavailable — never a safe account and never a deletion
 * already under way — and nothing is written without the named confirmation.
 */
const DELETE_CONFIRM = 'Your account, spaces and walkthroughs will be deleted within 30 days. Access and handoff links pause when removal starts. This cannot be undone.';
const deletionText = h => h.ids['account-deletion'].all().map(el => el.textContent).join('\n');
const deletionAction = (h, label) => h.ids['account-deletion'].all()
  .find(el => el.tagName === 'BUTTON' && el.textContent === label);
const requestedRow = (overrides = {}) => ({ user_id: 'user-1', requested_at: '2026-09-20T04:30:00Z',
  reason: null, status: 'requested', cancelled_at: null, completed_at: null, ...overrides });

test('the desk offers deletion only once it has read the current state', async () => {
  let finish;
  const h = await load({ rpc: { get_account_deletion: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(h.ids['account-deletion'].attributes['aria-busy'], 'true');
  assert.match(deletionText(h), /Checking whether a deletion has been requested/);
  assert.equal(deletionAction(h, 'Delete my account'), undefined, 'nothing is offered before the state is known');
  assert.match(h.text(), /Sample space/, 'the spaces list does not wait for the deletion check');
  finish({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids['account-deletion'].attributes['aria-busy'], 'false');
  assert.ok(deletionAction(h, 'Delete my account'));
  assert.equal(deletionAction(h, 'Cancel deletion'), undefined);
});

test('an unanswered deletion check is unavailable, not a safe account', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { data: 'receipt' },
    { data: [{ status: 'surprise' }] }]) {
    const h = await load({ rpc: { get_account_deletion: async () => reply } });
    assert.match(deletionText(h), /unavailable|could not be read/);
    assert.equal(deletionAction(h, 'Delete my account'), undefined, JSON.stringify(reply));
    assert.equal(deletionAction(h, 'Cancel deletion'), undefined);
    const again = deletionAction(h, 'Check again');
    assert.ok(again, 'the unavailable state offers a check');
    const before = h.calls.filter(call => call[0] === 'get_account_deletion').length;
    await again.fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.filter(call => call[0] === 'get_account_deletion').length, before + 1);
    assert.equal(h.calls.some(call => ['request_account_deletion', 'cancel_account_deletion'].includes(call[0])), false);
  }
});

test('a requested deletion whose date cannot be read is unavailable, not a line with a hole', async () => {
  for (const requested_at of [null, 'not-a-date']) {
    const h = await load({ rpc: { get_account_deletion: async () => ({ data: [requestedRow({ requested_at })] }) } });
    assert.match(deletionText(h), /date could not be read/);
    assert.doesNotMatch(deletionText(h), /Deletion requested \./);
    assert.equal(deletionAction(h, 'Delete my account'), undefined, 'a pending deletion is never offered again');
  }
});

test('deleting is confirmed in its own words, and keeping the account writes nothing', async () => {
  const h = await load();
  await deletionAction(h, 'Delete my account').fire('click');
  assert.match(deletionText(h), new RegExp(DELETE_CONFIRM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(h.ids['account-deletion'].all().some(el => el.tagName === 'TEXTAREA'), 'the reason is offered, not demanded');
  assert.ok(deletionAction(h, 'Keep my account'));
  assert.equal(h.calls.some(call => call[0] === 'request_account_deletion'), false);
  await deletionAction(h, 'Keep my account').fire('click');
  assert.doesNotMatch(deletionText(h), /will be deleted within 30 days/);
  assert.ok(deletionAction(h, 'Delete my account'));
  assert.match(h.ids['account-status'].textContent, /Your account is unchanged/);
  assert.equal(h.calls.some(call => call[0] === 'request_account_deletion'), false);
});

test('a confirmed deletion sends its optional reason and states the date from a fresh read', async () => {
  let stored = null;
  const rpc = {
    get_account_deletion: async () => ({ data: stored ? [stored] : [] }),
    request_account_deletion: async args => { stored = requestedRow({ reason: args?.p_reason ?? null }); return { data: [stored] }; },
  };
  const h = await load({ rpc });
  await deletionAction(h, 'Delete my account').fire('click');
  h.ids['account-deletion'].all().find(el => el.tagName === 'TEXTAREA').value = '  Sold the agency.  ';
  await deletionAction(h, 'Delete my account').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'request_account_deletion')[1] }, { p_reason: 'Sold the agency.' });
  assert.equal(deletionText(h).includes('Deletion requested ' + longDate(stored.requested_at) +
    '. Cancel before removal starts.'), true, deletionText(h));
  assert.ok(deletionAction(h, 'Cancel deletion'));
  assert.equal(deletionAction(h, 'Delete my account'), undefined);
  // The state shown is the one read back, not the one the button assumed.
  assert.equal(h.calls.filter(call => call[0] === 'get_account_deletion').length, 2);

  const blank = await load({ rpc: { ...rpc, get_account_deletion: async () => ({ data: [] }) } });
  await deletionAction(blank, 'Delete my account').fire('click');
  await deletionAction(blank, 'Delete my account').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual({ ...blank.calls.find(call => call[0] === 'request_account_deletion')[1] }, {},
    'an empty reason is not sent as one');
});

test('a requested deletion can be cancelled, and the cancellation is read back', async () => {
  let stored = requestedRow({ reason: 'Moving to another studio.' });
  const h = await load({ rpc: {
    get_account_deletion: async () => ({ data: stored ? [stored] : [] }),
    cancel_account_deletion: async () => { stored = { ...stored, status: 'cancelled', cancelled_at: '2026-09-22T00:00:00Z' }; return { data: [stored] }; },
  } });
  assert.match(deletionText(h), /Cancel before removal starts\./);
  await deletionAction(h, 'Cancel deletion').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call[0] === 'cancel_account_deletion').length, 1);
  assert.ok(deletionAction(h, 'Delete my account'), 'a cancelled request is not a pending one');
  assert.equal(deletionAction(h, 'Cancel deletion'), undefined);
  assert.match(h.ids['account-status'].textContent, /cancelled/i);
});

test('an unconfirmed deletion write is reported, never assumed', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { error: { message: 'denied' } }]) {
    const request = await load({ rpc: { request_account_deletion: async () => reply } });
    await deletionAction(request, 'Delete my account').fire('click');
    await deletionAction(request, 'Delete my account').fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(deletionText(request), /was not confirmed\. Check again before asking a second time\./);
    assert.doesNotMatch(deletionText(request), /Deletion requested/);
    assert.equal(request.calls.filter(call => call[0] === 'request_account_deletion').length, 1, 'no automatic retry');
    assert.ok(deletionAction(request, 'Check again'));

    const cancel = await load({ rpc: {
      get_account_deletion: async () => ({ data: [requestedRow()] }),
      cancel_account_deletion: async () => reply,
    } });
    await deletionAction(cancel, 'Cancel deletion').fire('click');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(deletionText(cancel), /cancellation was not confirmed\. Check again before retrying\./);
    assert.equal(cancel.calls.filter(call => call[0] === 'cancel_account_deletion').length, 1);
  }
});

test('an expired sign-in during a deletion write signs the desk out rather than reporting success', async () => {
  const h = await load({ rpc: { request_account_deletion: async () => ({ error: { code: '401', message: 'JWT expired' } }) } });
  await deletionAction(h, 'Delete my account').fire('click');
  await deletionAction(h, 'Delete my account').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids['account-home'].hidden, true);
  assert.match(h.ids['account-status'].textContent, /sign-in has expired/i);
  assert.equal(h.ids['account-deletion'].children.length, 0);
});

test('signing out clears the deletion panel', async () => {
  const h = await load({ rpc: { get_account_deletion: async () => ({ data: [requestedRow()] }) } });
  assert.ok(h.ids['account-deletion'].children.length);
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['account-deletion'].children.length, 0);
});

test('the desk replaces the deletion mailto with the flow, and keeps what it cannot promise off the page', () => {
  assert.doesNotMatch(markup, /Ask for deletion/);
  assert.doesNotMatch(markup, /mailto:[^"]*deletion/i);
  assert.match(markup, /<div id="account-deletion" aria-live="polite"><\/div>/);
  assert.match(markup, /Deleting your account cannot recall downloaded copies/);
  // One statement of the confirmation, written where the confirmation happens.
  assert.equal(account.split(DELETE_CONFIRM).length - 1, 1);
  assert.equal(account.split("'Delete my account'").length - 1, 2, 'the opener and the confirmation, and nothing else');
  assert.equal(account.split("'Keep my account'").length - 1, 1);
  assert.equal(account.split("'Cancel deletion'").length - 1, 1);
  assert.equal(account.split("'. Cancel before removal starts.'").length - 1, 1);
});

/* ---- The words the subscription and the deletion are sold on ----------
 * /terms is the Terms of Use the App Store listing links to, so the free
 * months, the renewal, the cancellation routes, the refunds and the deletion
 * have to be on it, and nothing on it may be a clause the product cannot keep.
 */
const terms = fs.readFileSync(path.join(__dirname, '../dist/terms/index.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '../dist/privacy/index.html'), 'utf8');
const llms = fs.readFileSync(path.join(__dirname, '../dist/llms.txt'), 'utf8');

test('the terms state the subscription the App Store listing points at', () => {
  const flat = terms.replace(/\s+/g, ' ');
  for (const phrase of [
    'Last updated 25 September 2026',
    '3 free months with 6 accepted walkthroughs included',
    'in the app through Apple’s 3-month free introductory offer',
    'with a card saved in Square’s own card field in your account on this website',
    'or through the studio for an account it invoices, on a paid start date agreed in writing',
    'The first charge is on the day they end, at the price of the plan you chose; if you cancel before then, nothing is charged.',
    'renews automatically each month after its introductory offer at the monthly price shown by Apple',
    'The App Store sells the Veylet plan monthly and annual',
    'an annual invoice is charged in full',
    'A reminder email 7 days before the first charge is planned but not running yet',
    'Cancel any time.',
    'Settings › Subscriptions',
    'cancel by email to',
    'Every released walkthrough stays live while your account has a running plan (free months, monthly or annual).',
    'When the plan ends, its link, embed and QR code keep working for 14 days, then go offline; they are not deleted or revoked, and restarting the plan brings the same links back at once.',
    'Deleting the Veylet account ends its hosting. It does not cancel an Apple subscription',
    'Apple refunds it under its own policy',
    'within 14 days of that charge and no walkthrough was accepted in the period it paid for',
    'guarantees that cannot be excluded under the Australian Consumer Law',
    'If GST applies it is included in the price shown',
    'governed by the law of Queensland, Australia',
    'yoda@yodalai.xyz',
    'Card payment on this website is coming later',
  ]) assert.ok(flat.includes(phrase), `the terms say: ${phrase}`);
  // Nothing the product cannot keep, and no card on this website.
  assert.doesNotMatch(terms, /autocomplete="cc-|card number|cardholder|cvc/i);
  assert.doesNotMatch(terms, /class="eyebrow"/);
  assert.doesNotMatch(flat, /guarantee(?!s that cannot be excluded)/i);
  assert.doesNotMatch(flat, /Square Sandbox|production charging is off/);
  // Card payment on the website is not live, so activation is not promised there.
  assert.doesNotMatch(flat, /a card on the website|or on the website \u2014/);
  // Offer 2026-09-25.1: the App Store sells monthly and annual, each at the price Apple shows for it.
  assert.doesNotMatch(flat, /monthly or annual price shown by Apple/);
  assert.doesNotMatch(flat, /members\u2019 annual|members only/i);
});

test('the terms and the privacy notice tell one story about deletion', () => {
  for (const page of [terms, privacy]) {
    const flat = page.replace(/\s+/g, ' ');
    for (const phrase of [
      'Ask in the app or on your desk',
      'complete the deletion within 30 days',
      'You cannot undo it yourself',
      'every handoff link and embed stops working',
      'hosting of every released walkthrough ends with them',
      'deletion ends hosting at once, without the 14 days that follow the end of a plan.',
      'Once removal starts, these files cannot be restored through your account.',
      'records of payments, accepted services and deletion may be retained',
    ]) assert.ok(flat.includes(phrase), `the page says: ${phrase}`);
    // The old, withdrawn retention numbers must be gone, not merely unused.
    assert.doesNotMatch(flat, /twelve months from the day the deletion completes|kept for five years|reversed on request inside those 90 days/);
  }
});

test('the privacy notice says what is collected and what is never sold', () => {
  const flat = privacy.replace(/\s+/g, ' ');
  for (const phrase of [
    'Last updated 25 September 2026',
    'Your email address, which is how you sign in',
    'The captures you send us',
    'Your plan\u2019s purchase state from the App Store',
    'never your card number',
    'counts of use: walkthroughs sent, accepted, handoffs created and revoked',
    'We never sell, rent or trade personal information',
    'no advertising cookies and no third-party trackers',
  ]) assert.ok(flat.includes(phrase), `the privacy notice says: ${phrase}`);
});

test('llms.txt points at the subscription terms and at account deletion', () => {
  const lines = llms.split('\n').filter(line => /veylet\.com\/(terms|account)/.test(line));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- Subscription terms .*https:\/\/veylet\.com\/terms$/);
  assert.match(lines[1], /^- Delete your account .*https:\/\/veylet\.com\/account$/);
  assert.match(lines[0], /App Store automatic renewal at the plan price/);
  assert.match(lines[0], /studio invoices do not auto-renew/);
  assert.match(lines[1], /completed within 30 days/);
  assert.match(lines[1], /cancel the request before removal starts/);
  assert.match(lines[1], /once removal starts, access and sharing stop/);
  assert.match(lines[1], /covered hosted files cannot be restored through your account/);
  assert.match(lines[1], /device\/exported\/downloaded copies are outside this deletion/);
  assert.match(lines[1], /minimal accounting and legal records may be retained/);
  assert.match(lines[1], /deleting Veylet does not cancel an Apple subscription/);
  assert.doesNotMatch(lines[1], /reversible|removed within 90 days|kept 7 years/);
});


// A row for either App Store annual product keeps the verified price Apple recorded for it;
// plan.annual is the retired Team plan. Without the capacity answer's allowance_kind the
// panel states the row's own counts and claims no monthly reset for a yearly plan.
test('annual Apple renewal uses the verified yearly total and claims no monthly reset', async () => {
  const annual = { ...TEAM, source: 'apple', apple_product_id: 'dev.property3d.capture.plan.annual',
    billing_interval: 'annual', renewal_price_aud_cents: 318999, apple_verified: true };
  const trial = await withPlan(annual);
  assert.match(planText(trial), /, then A\$3,189\.99 a year unless you cancel/);
  assert.doesNotMatch(planText(trial), /A\$219\.99 a month|A\$3,189\.99 a month/);
  assert.ok(planLinks(trial).includes('https://apps.apple.com/account/subscriptions'));
  const active = await withPlan({ ...annual, status: 'active', accepted_this_period: 2,
    current_period_ends_at: '2027-09-23T00:00:00Z' });
  assert.equal(planTitle(active), 'Team · A$3,189.99 a year');
  assert.match(planText(active), /2 of 3 walkthroughs this month/);
  assert.match(planText(active), /1 included walkthrough remaining this month/);
  assert.match(planText(active), /Hosting included\. Billed annually\./);
  assert.doesNotMatch(planText(active), /allowance resets monthly|do not carry over/);
});

test('legacy annual rows and unknown invoice cadence never reuse the monthly list price', async () => {
  for (const overrides of [
    { source: 'apple', apple_product_id: 'dev.property3d.capture.plan.annual', billing_interval: null },
    { source: 'studio', billing_interval: null },
    { source: 'apple', apple_product_id: 'dev.property3d.capture.plan.annual', billing_interval: 'monthly', renewal_price_aud_cents: 318999 },
  ]) {
    const h = await withPlan(overrides);
    assert.match(planText(h), /Confirm the renewal amount and billing period/);
    assert.doesNotMatch(planText(h), /(?:at|then) A\$[\d,.]+ a (month|year)/);
  }
  const invoice = await withPlan({ ...TEAM, source: 'studio', billing_interval: 'annual', renewal_price_aud_cents: 207900 });
  assert.match(planText(invoice), /, then A\$2,079 a year unless you cancel/);
  const members = await withPlan({ source: 'web', billing_interval: 'annual', renewal_price_aud_cents: 99000 });
  assert.match(planText(members), /, then A\$990 a year unless you cancel/);
});

test('cancelled annual plans and unknown renewal settings never promise another charge', async () => {
  const h = await withPlan({ ...TEAM, source: 'apple', billing_interval: 'annual', renewal_price_aud_cents: 318999,
    apple_product_id: 'dev.property3d.capture.plan.annual', auto_renews: false,
    status: 'active', current_period_ends_at: '2027-09-23T00:00:00Z' });
  assert.match(planText(h), /will not renew/);
  assert.doesNotMatch(planText(h), /Next billing date|Renews on/);
  const unknown = await withPlan({ auto_renews: null });
  assert.match(planText(unknown), /Check your renewal setting/);
  assert.doesNotMatch(planText(unknown), /Renews on/);
});

test('exhausted trial keeps its end date and points at a walkthrough pack without creating debt', async () => {
  const h = await withPlan({ accepted_in_free_months: 6, extras_in_free_months: 1 });
  assert.match(planText(h), /included walkthroughs are used for these free months/);
  assert.match(planText(h), /free-months end date stays the same/);
  assert.match(planText(h), /Need more walkthroughs\? A walkthrough pack adds them; they are used after your included ones\./);
  assert.match(planText(h), /Saving another space does not authorize a charge/);
  assert.doesNotMatch(planText(h), /extra owed|pay now|trial ends early|agree the extra work|each, by agreement/i);
  assert.equal(h.calls.some(([name]) => /purchase|charge|extra|set_plan/.test(name)), false);
  const apple = await withPlan({ source: 'apple', accepted_in_free_months: 6 });
  assert.match(planText(apple), /Packs are not sold in the app\./);
  assert.doesNotMatch(planText(apple), /A\$99\.99|A\$89(?![\d.])/);
  // A retired Team row's agreed extra price is not offered any more: packs replace it.
  const team = await withPlan({ ...TEAM, accepted_in_free_months: 4 });
  assert.doesNotMatch(planText(team), /A\$89(?![\d.])|by agreement/);
});

test('a sandbox plan is labelled as test billing without granting new access', async () => {
  const h = await withPlan({ source: 'apple', apple_environment: 'Sandbox' });
  // Sandbox says so first, under the title, in the cards' own "Test ·" words.
  assert.equal(h.ids['account-plan-body'].children[1].textContent, 'Test · App Store Sandbox: a test subscription, not a live payment.');
  assert.doesNotMatch(planText(h), /Sandbox purchase|Test purchase/);
  assert.ok(planValues(h).includes('Test subscription'));
  assert.match(planText(h), /Production walkthroughs are not included in a sandbox subscription\./);
  assert.match(planText(h), /Free until .*, then A\$119\.99 a month unless you cancel/);
  assert.doesNotMatch(planText(h), /\d+ of \d+|included walkthroughs remaining|included walkthroughs are used/);
  assert.equal(h.calls.some(([name]) => /grant|activate/.test(name)), false);
});

const capacityRow = { plan_status: 'trial', included_limit: 6, included_used: 2, included_remaining: 4,
  extra_credits_available: 0, allowance_starts_at: '2026-03-01T00:00:00Z', allowance_ends_at: '2026-12-01T00:00:00Z', can_accept: true, reason_code: null };
const withCapacity = (cap, plan = {}, options = {}) => withPlan(plan, { ...options,
  rpc: { ...options.rpc, get_walkthrough_capacity: async () => ({ data: [cap] }) } });
const capacityText = h => h.ids['account-plan-body'].all().find(el => el.className === 'plan-capacity')?.all().map(el => el.textContent).join('\n') || '';

test('verified acceptance capacity distinguishes included units from pack and extra walkthroughs', async () => {
  const h = await withCapacity({ ...capacityRow, included_used: 6, included_remaining: 0, extra_credits_available: 2 },
    { accepted_in_free_months: 8 });
  assert.match(capacityText(h), /0 included walkthroughs remaining · 2 extra walkthroughs available/);
  assert.match(capacityText(h), /next new walkthrough uses one extra walkthrough, the one that expires first/);
  assert.match(capacityText(h), /Each new walkthrough you approve uses one, even another of the same property; saving a space, a failed capture or a correction uses none\./);
  assert.ok(planValues(h).includes('6 of 6 included accepted'));
  assert.ok(planValues(h).includes('2 available'), 'the Extra walkthroughs row states the ledger’s count');
  assert.match(planText(h), /6 of 6 included free walkthroughs used/);
  assert.doesNotMatch(planText(h), /8 of 6 free walkthroughs used/);
});

test('exhausted capacity points at a walkthrough pack, never automatic debt', async () => {
  const h = await withCapacity({ ...capacityRow, included_used: 6, included_remaining: 0, can_accept: false, reason_code: 'allowance_exhausted' });
  assert.match(capacityText(h), /no extra walkthrough is available, so another can be accepted once a walkthrough pack adds more/);
  assert.match(capacityText(h), /Nothing is charged automatically and no debt is created/);
  assert.match(capacityText(h), /Your free-months end date stays the same/);
  assert.match(capacityText(h), /Resolve walkthrough capacity with Veylet support/);
  assert.doesNotMatch(capacityText(h), /agree and settle an extra/);
});

test('banked extras do not imply acceptance while the plan is inactive', async () => {
  const h = await withCapacity({ ...capacityRow, plan_status: 'ended', included_limit: 0, included_used: 0, included_remaining: 0,
    extra_credits_available: 1, can_accept: false, reason_code: 'plan_not_active' });
  assert.match(capacityText(h), /1 extra walkthrough available/);
  assert.match(capacityText(h), /acceptance is paused/);
  assert.match(capacityText(h), /A pack or an extra walkthrough does not activate an expired or unverified plan/);
  assert.doesNotMatch(capacityText(h), /Capacity is available for acceptance/);
});

test('an unavailable or malformed capacity reply never invents an extra-walkthrough balance', async () => {
  for (const reply of [{ error: { code: 'PGRST202' } }, { data: [{ ...capacityRow, extra_credits_available: null }] },
    { data: [{ ...capacityRow, included_remaining: 100 }] }]) {
    const h = await withPlan({}, { rpc: { get_walkthrough_capacity: async () => reply } });
    assert.match(capacityText(h), /could not be verified/);
    assert.doesNotMatch(capacityText(h), /0 extra walkthroughs/);
    assert.equal(planValues(h)[4], '—', 'the Extra walkthroughs row claims nothing');
    assert.match(planText(h), /4 included walkthroughs remaining across your free months/);
  }
});

test('a late capacity reply cannot restore a signed-out account', async () => {
  let finish;
  const h = await withPlan({}, { rpc: { get_walkthrough_capacity: () => new Promise(resolve => { finish = resolve; }) } });
  h.supabase.auth.callback('SIGNED_OUT', null);
  finish({ data: [capacityRow] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids['account-home'].hidden, true);
  assert.equal(h.ids['account-plan-body'].children.length, 0);
});

test('one-time paid service never promises a monthly reset or recurring bill', async () => {
  const h = await withCapacity({ ...capacityRow, plan_status: 'active', included_limit: 1, included_used: 0, included_remaining: 1 },
    { status: 'active', billing_interval: 'once', renewal_price_aud_cents: 19900, current_period_ends_at: inDays(90), auto_renews: false, plan_code: 'one', included_per_month: 1 });
  assert.match(planTitle(h), /A\$199 once/);
  assert.match(planText(h), /does not reset monthly/);
  assert.doesNotMatch(planText(h), /allowance resets monthly|walkthroughs this month|A\$199 a month/);
});

test('processing deletion shows frozen access and no cancellation or repeat delete', async () => {
  const h = await load({ rpc: { get_account_deletion: async () => ({ data: [{ ...requestedRow(), status: 'processing' }] }) } });
  assert.match(deletionText(h), /Deletion is in progress. Account access is paused/);
  assert.equal(h.ids['account-deletion'].all().some(el => el.tagName === 'BUTTON'), false);
});


test('sandbox capacity cannot promise real production even with settled credits', async () => {
  const ends = inDays(1);
  const h = await withCapacity({ ...capacityRow, included_limit: 0, included_used: 0, included_remaining: 0,
    extra_credits_available: 1, can_accept: false, reason_code: 'sandbox_test_only' },
    { source: 'apple', apple_environment: 'Sandbox', apple_verified: true, auto_renews: false, trial_ends_at: ends });
  assert.equal(planTitle(h), 'Free until ' + longDate(ends));
  assert.ok(planValues(h).includes('Test subscription'));
  assert.ok(planValues(h).includes('Does not renew'));
  assert.match(planText(h), /Production walkthroughs are not included in a sandbox subscription\./);
  assert.match(planText(h), /will not renew/);
  assert.ok(planLinks(h).includes('https://apps.apple.com/account/subscriptions'));
  assert.doesNotMatch(planText(h), /\d+ of \d+|included walkthroughs remaining|extra walkthroughs? available|Renews on/);
  assert.match(capacityText(h), /^Test · real walkthroughs need a live plan\./);
  assert.match(capacityText(h), /cannot accept production work or spend an extra walkthrough/);
  assert.doesNotMatch(capacityText(h), /Capacity is available for acceptance/);
});

test('an annual sandbox keeps its verified price and end date without a monthly production allowance', async () => {
  const ends = inDays(1);
  const h = await withCapacity({ ...capacityRow, plan_status: 'active', included_limit: 0, included_used: 0,
    included_remaining: 0, can_accept: false, reason_code: 'sandbox_test_only' },
    { ...TEAM, source: 'apple', apple_environment: 'Sandbox', apple_verified: true, status: 'active',
      billing_interval: 'annual', apple_product_id: 'dev.property3d.capture.plan.annual',
      renewal_price_aud_cents: 318999, current_period_ends_at: ends, auto_renews: false });
  assert.equal(planTitle(h), 'Test · Team · A$3,189.99 a year');
  assert.match(planText(h), new RegExp('Ends ' + longDate(ends) + '; will not renew'));
  assert.doesNotMatch(planText(h), /\d+ of \d+|walkthroughs this month|allowance resets monthly|extra walkthroughs? available/);
  assert.equal(h.calls.some(([name]) => /grant|activate|purchase|charge/.test(name)), false);
});

test('production subscriptions still show the authoritative monthly included balance on either billing cadence', async () => {
  for (const billing_interval of ['monthly', 'annual']) {
    const h = await withCapacity({ ...capacityRow, plan_status: 'active', included_limit: 3,
      included_used: 2, included_remaining: 1 },
      { ...TEAM, source: 'apple', apple_environment: 'Production', apple_verified: true, status: 'active',
        billing_interval, apple_product_id: 'dev.property3d.capture.plan.' + billing_interval,
        renewal_price_aud_cents: billing_interval === 'annual' ? 318999 : 21999,
        accepted_this_period: 2, current_period_ends_at: inDays(30) });
    assert.ok(planValues(h).includes('2 of 3 included accepted'));
    assert.match(capacityText(h), /1 included walkthrough remaining · 0 extra walkthroughs available/);
    assert.match(planText(h), /2 of 3 walkthroughs this month/);
    assert.doesNotMatch(planText(h), /Test subscription|Production walkthroughs are not included/);
  }
});

/* ---- Sharing, the website builders and hosting -------------------------
 * A live walkthrough: its state, the hosting line in the spec's words, the
 * link, the builder's own steps and the one embed code. Hosting dates only
 * choose words; a failed lookup never blocks sharing.
 */
const share = (() => { const shared = {}; vm.runInNewContext(sharing, { window: shared, URL, navigator: {} }); return shared.VeyletSharing; })();
const TOKEN = 'abcdefghijklmnop';
const liveTour = { ...tour, share_token: TOKEN };
const hostingFor = (overrides = {}) => ({ tour_id: 't1', property_id: 'p1', status: 'ready', approved: true, share_token: TOKEN, sharing_on: true,
  released_at: '2026-09-23T04:00:00Z', guaranteed_until: '2027-09-23T04:00:00Z', extended_until: null,
  hosted_until: '2027-09-23T04:00:00Z', plan_active: true, ...overrides });
const withHosting = (rows, options = {}) => load({ approved: true, ...options,
  rpc: { ...options.rpc, get_tour_hosting: async () => ({ data: rows }) } });
const hostingText = h => (h.all().find(el => (el.className || '').includes('tour-hosting')) || {}).textContent;
const byText = (h, text) => h.all().find(el => el.textContent === text);
const radios = h => h.all().filter(el => el.tagName === 'INPUT' && el.type === 'radio');
const stepsShown = h => h.all().filter(el => el.className === 'tour-builder-steps').flatMap(el => el.children.map(step => step.textContent));
const fieldOf = (h, tag) => h.all().find(el => el.tagName === tag && el.className === 'copy-field');
// The desk hands out the link and the embed code tagged with their channel (?src=).
const taggedCode = token => share.embedCode(token).split('"' + share.embedUrl(token) + '"').join('"' + share.embedUrl(token) + '&src=embed"')
  .split('"' + share.handoffUrl(token) + '"').join('"' + share.handoffUrl(token) + '&src=embed"');

test('a live walkthrough shows Live, its hosting line, the link and the website steps', async () => {
  const h = await withHosting([hostingFor()], { tours: [liveTour] });
  assert.ok(h.all().some(el => el.className === 'pill pill-good' && el.textContent === 'Live'));
  assert.equal(hostingText(h), 'Live while your plan is active.');
  const link = fieldOf(h, 'INPUT');
  assert.equal(link.value, share.handoffUrl(TOKEN) + '&src=link');
  assert.equal(link.readOnly, true);
  assert.ok(byText(h, 'Copy link'));
  assert.equal(byText(h, 'Open as your client').href, share.handoffUrl(TOKEN));
  assert.ok(byText(h, 'Add to your website'));
  assert.deepEqual(radios(h).map(el => el.value), ['wordpress', 'squarespace', 'wix', 'webflow', 'other']);
  assert.deepEqual(radios(h).filter(el => el.checked).map(el => el.value), ['wordpress']);
  assert.ok(radios(h).every(el => el.name === 'builder-t1'));
  assert.deepEqual(stepsShown(h), [...share.builder('wordpress').steps]);
  const code = fieldOf(h, 'TEXTAREA');
  assert.equal(code.value, taggedCode(TOKEN));
  assert.equal(code.readOnly, true);
  assert.ok(byText(h, 'Copy embed code'));
  assert.equal(byText(h, 'Full website guide').href, '/website-guide');
  // Stopping lives in a closed Manage sharing section, not beside Copy link.
  const manage = h.all().find(el => el.tagName === 'DETAILS' && el.children[0]?.textContent === 'Manage sharing');
  assert.ok(!manage.open, 'Manage sharing starts closed');
  assert.ok(manage.all().some(el => el.textContent === 'Turn off sharing'));
  assert.ok(manage.all().some(el => el.textContent === 'Withdraw approval'));
  assert.equal(h.all().some(el => el.textContent === 'Approve and share' || el.textContent === 'Turn sharing on'), false);
  assert.equal(h.calls.filter(([name]) => name === 'get_tour_hosting').length, 1);
});

test('each hosting situation reads its own line on the card', async () => {
  // Owner decision 26 September 2026: live while the plan is active, then 14 days, then offline (same link).
  const recent = new Date(Date.now() - 3 * 86400000).toISOString();
  const long = new Date(Date.now() - 30 * 86400000).toISOString();
  const offlineDay = ended => share.hostingDate(new Date(Date.parse(ended) + 14 * 86400000).toISOString());
  const rpc = row => ({ get_tour_hosting: async () => ({ data: [row] }) });
  // Without the member hosting read, the plan panel's end day decides once it answers.
  const grace = await withPlan({ status: 'ended', current_period_ends_at: recent, source: 'web' }, { approved: true, tours: [liveTour], rpc: rpc(hostingFor({ plan_active: false })) });
  assert.equal(hostingText(grace), 'Your plan has ended. This walkthrough goes offline on ' + offlineDay(recent) + '. Restart your plan to keep it live.');
  assert.ok(planText(grace).includes('Your plan has ended. 1 live walkthrough goes offline on ' + offlineDay(recent) + '. Restart your plan to keep it live.'));
  assert.ok(grace.all().some(el => el.className === 'pill pill-good' && el.textContent === 'Live'));
  // Once the plan's answer says the plan ended, the card's fix shows: the filled restart and the extension request.
  assert.equal(extensionFix(grace).hidden, false);
  const offline = await withPlan({ status: 'ended', current_period_ends_at: long, source: 'web' }, { approved: true, tours: [liveTour], rpc: rpc(hostingFor({ plan_active: false })) });
  assert.equal(hostingText(offline), 'Offline since ' + offlineDay(long) + '. Restart your plan and this link works again — same link, embed and QR.');
  assert.ok(offline.all().some(el => el.className === 'pill pill-quiet' && el.textContent === 'Offline'), 'the chip follows once the plan answers');
  // The member hosting read, when get_tour_hosting carries it, wins.
  for (const [extra, line, ended] of [
    [{ hosting_state: 'live_with_plan', offline_on: null }, 'Live while your plan is active.', false],
    [{ hosting_state: 'offline_on', offline_on: '2027-10-10' }, 'Your plan has ended. This walkthrough goes offline on 10 Oct 2027. Restart your plan to keep it live.', true],
    [{ hosting_state: 'offline', offline_on: '2026-09-12' }, 'Offline since 12 Sep 2026. Restart your plan and this link works again — same link, embed and QR.', true],
    [{ hosting_state: 'live_with_extension', offline_on: '2027-10-01', extended_until: '2027-10-01T00:00:00Z' }, 'Live until 1 Oct 2027 with a hosting extension.', false],
  ]) {
    const h = await withHosting([hostingFor({ plan_active: false, ...extra })], { tours: [liveTour] });
    assert.equal(hostingText(h), line);
    assert.ok(byText(h, 'Copy link'), 'the card keeps its controls');
    assert.doesNotMatch(h.text(), /12 months|Guaranteed/);
    // Offer 2026-09-26.2: an ended plan's card offers the filled restart and, beside it, the extension request by email.
    const fix = extensionFix(h);
    assert.equal(fix.hidden, !ended, line);
    assert.deepEqual(fix.children.map(el => [el.textContent, el.className]), [['Restart your plan', 'tour-action tour-action-primary'],
      ['Keep this walkthrough online (A$49 a year)', 'text-link tour-extension-request']]);
    const mail = decodeURIComponent(fix.children[1].href);
    assert.ok(mail.startsWith('mailto:yoda@yodalai.xyz?subject=Veylet hosting extension · walkthrough t1'), mail);
    assert.match(mail, /Tour ID: t1\n/);
    assert.equal(h.all().some(el => el.className === 'pill pill-good' && el.textContent === 'Live'), extra.hosting_state !== 'offline', line);
  }
});
const extensionFix = h => h.all().find(el => el.className === 'tour-actions-row tour-hosting-fix');

test('the member hosting read (get_tour_hosting_states) chooses the words when the backend has it', async () => {
  const states = rows => ({ get_tour_hosting_states: async () => ({ data: rows }) });
  const grace = await withHosting([hostingFor()], { tours: [liveTour], rpc: states([{ tour_id: 't1', property_id: 'p1', state: 'offline_on', offline_at: '2027-10-10T00:00:00Z', sharing_on: true, share_paused: false, plan_active: false }]) });
  assert.equal(hostingText(grace), 'Your plan has ended. This walkthrough goes offline on 10 Oct 2027. Restart your plan to keep it live.');
  const off = await withHosting([hostingFor()], { tours: [liveTour], rpc: states([{ tour_id: 't1', state: 'offline', offline_at: '2026-09-12T00:00:00Z', plan_active: false }]) });
  assert.equal(hostingText(off), 'Offline since 12 Sep 2026. Restart your plan and this link works again — same link, embed and QR.');
  assert.ok(off.all().some(el => el.className === 'pill pill-quiet' && el.textContent === 'Offline'));
  // live_with_extension (offer 2026-09-26.2): no plan, a paid extension keeps this one online until extended_until.
  const extended = await withHosting([hostingFor()], { tours: [liveTour], rpc: states([{ tour_id: 't1', state: 'live_with_extension', offline_at: '2027-11-02T00:00:00Z', extended_until: '2027-11-03T00:00:00Z', plan_active: false }]) });
  assert.equal(hostingText(extended), 'Live until 3 Nov 2027 with a hosting extension.');
  assert.ok(extended.all().some(el => el.className === 'pill pill-good' && el.textContent === 'Live'));
  const unenforced = await withHosting([hostingFor()], { tours: [liveTour], rpc: states([{ tour_id: 't1', state: 'live_not_enforced', offline_at: null, plan_active: false }]) });
  assert.equal(hostingText(unenforced), 'Live while your plan is active.');
  // Absent (PGRST202) or odd: get_tour_hosting's plan_active decides, as before.
  for (const reply of [{ error: { code: 'PGRST202' } }, { data: 'receipt' }, { data: [{ tour_id: 't1', state: 7 }] }]) {
    const h = await withHosting([hostingFor()], { tours: [liveTour], rpc: { get_tour_hosting_states: async () => reply } });
    assert.equal(hostingText(h), 'Live while your plan is active.');
  }
});

test('hosting dates that fail to load never block sharing or the desk', async () => {
  const replies = [async () => ({ error: { message: 'offline' } }), async () => { throw new Error('network'); },
    async () => ({ data: 'receipt' }), async () => ({ data: [] }), async () => ({ error: { code: '401', message: 'JWT expired' } })];
  for (const reply of replies) {
    const second = { ...tour, id: 't2', share_token: null };
    const h = await load({ approved: true, tours: [liveTour, second], rpc: { get_tour_hosting: reply } });
    assert.equal(h.ids['account-home'].hidden, false, 'the desk stays signed in');
    assert.equal(hostingText(h), 'Hosting dates could not load. Refresh to check.');
    for (const control of ['Copy link', 'Copy embed code', 'Turn off sharing', 'Turn sharing on']) assert.ok(byText(h, control), control);
    assert.doesNotMatch(h.text(), /Guaranteed until|Live until|hosting ended|Offline since/);
  }
});

test('an approved walkthrough that was never shared offers one primary action and one line', async () => {
  const h = await withHosting([hostingFor({ share_token: null, sharing_on: false, released_at: null, guaranteed_until: null, hosted_until: null })], { tours: [tour] });
  assert.ok(byText(h, 'Turn sharing on'));
  assert.match(h.text(), /Approved\. Sharing isn’t on yet\./);
  assert.match(h.text(), /Anyone with the link can open it\./);
  assert.equal(hostingText(h), undefined);
  assert.doesNotMatch(h.text(), /Sharing is off|Hosting dates/);
  assert.equal(byText(h, 'Copy link'), undefined);
  assert.equal(fieldOf(h, 'TEXTAREA'), undefined, 'no embed code before sharing');
});

test('sharing turned off after release says so, keeps no old link and can be turned back on', async () => {
  const h = await withHosting([hostingFor({ share_token: null, sharing_on: false })], { tours: [tour] });
  assert.match(h.text(), /Sharing is off\. The link and embed show "not available"\./);
  assert.ok(byText(h, 'Turn sharing back on'));
  assert.equal(fieldOf(h, 'INPUT'), undefined);
  assert.equal(h.text().includes(TOKEN), false);
});

test('a failed turn-on says sharing didn’t turn on and leaves the card as it was', async () => {
  const h = await withHosting([], { tours: [tour], rpc: { enable_tour_share: async () => ({ error: { message: 'offline' } }) } });
  const enable = byText(h, 'Turn sharing on');
  await enable.fire('click');
  assert.match(rowStatus(h), /^Approved\. Sharing didn’t turn on\. Try again\.$/m);
  assert.equal(enable.disabled, false);
  assert.match(h.text(), /Approved\. Sharing isn’t on yet\./);
  assert.ok(byText(h, 'Withdraw approval'));
});

test('choosing a builder shows its steps and is remembered for the next visit', async () => {
  const stored = new Map();
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)) };
  const h = await withHosting([hostingFor()], { tours: [liveTour], localStorage });
  const wix = radios(h).find(el => el.value === 'wix');
  wix.checked = true; await wix.fire('change');
  assert.deepEqual(stepsShown(h), [...share.builder('wix').steps]);
  assert.match(stepsShown(h).join(' '), /at least 320 pixels tall/);
  assert.equal(fieldOf(h, 'TEXTAREA').value, taggedCode(TOKEN), 'one code for every builder');
  const again = await withHosting([hostingFor()], { tours: [liveTour], localStorage });
  assert.deepEqual(radios(again).filter(el => el.checked).map(el => el.value), ['wix']);
  assert.deepEqual(stepsShown(again), [...share.builder('wix').steps]);
});

test('a browser that refuses storage still gets the chooser and its steps', async () => {
  const h = await withHosting([hostingFor()], { tours: [liveTour], localStorage: 'throw' });
  assert.deepEqual(radios(h).filter(el => el.checked).map(el => el.value), ['wordpress']);
  const webflow = radios(h).find(el => el.value === 'webflow');
  webflow.checked = true;
  await assert.doesNotReject(async () => webflow.fire('change'));
  assert.deepEqual(stepsShown(h), [...share.builder('webflow').steps]);
});

test('blocked copying leaves the code selected in its field with an instruction', async () => {
  const h = await withHosting([hostingFor()], { tours: [liveTour], clipboardBlocked: true });
  await byText(h, 'Copy embed code').fire('click');
  assert.equal(fieldOf(h, 'TEXTAREA').wasFocused, true);
  assert.match(h.ids['account-status'].textContent, /Select and copy the text below/);
  await byText(h, 'Copy link').fire('click');
  assert.equal(fieldOf(h, 'INPUT').wasFocused, true);
});

test('a creator who may share but not approve gets the live card without Withdraw approval', async () => {
  const h = await withHosting([hostingFor()], { tours: [liveTour], role: 'operator' });
  assert.ok(byText(h, 'Copy link'));
  assert.ok(byText(h, 'Turn off sharing'));
  assert.equal(byText(h, 'Withdraw approval'), undefined);
  const other = await withHosting([hostingFor()], { tours: [{ ...liveTour, created_by: 'another-user' }], role: 'operator' });
  assert.equal(byText(other, 'Copy link'), undefined);
  assert.equal(byText(other, 'Turn off sharing'), undefined);
  assert.equal(hostingText(other), 'Live while your plan is active.', 'the hosting line is still true');
});

test('the signed-in desk puts walkthroughs first and leaving last', () => {
  const home = markup.slice(markup.indexOf('id="account-home"'));
  // Adding a space sits with the list it adds to; the plan, capture help and
  // the account follow the walkthroughs in source order, so a phone reads the
  // same sequence the wide two-column desk shows.
  const order = ['id="account-next-step"', '>Your walkthroughs<', 'id="account-refresh"', 'id="account-add-space"', 'id="account-properties"',
    'id="account-plan"', '>First capture? See the steps<', 'id="account-gate"', '>Account details<', 'id="account-leaving"', 'id="account-sign-out"'];
  const positions = order.map(marker => home.indexOf(marker));
  assert.ok(positions.every(position => position >= 0), 'every section is present');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(markup, />Your spaces</);
});


/* ---- Annual plan --------------------------------------------------------
 * The card inside Your plan: the Veylet plan's one public annual price (offer
 * 2026-09-25.1; the card flow of docs/design/members-annual-offer-20260924.md),
 * no plan to choose, open once the free months have started. Every state is
 * forced from a mocked get_members_annual_offer answer, a mocked veylet-hooks
 * service and a fake Square Web Payments SDK. The page decides nothing the server
 * did not say, sends Square's single-use token and never card data, shows at most
 * one filled action, and states the same yearly price and date in the price,
 * beside the button and in the scheduled answer.
 */
const annualPlan = (months = 2) => ({ code: 'solo', year_cents: 9900 * (12 - months), monthly_cents: 9900, months_free: months, saving_cents: 9900 * months });
const annualPlans = (months = 2) => [annualPlan(months)];
// A year bought before offer 2026-09-24.2 on the retired Team plan (code studio).
const TEAM_YEAR = { code: 'studio', year_cents: 189000, monthly_cents: 18900, months_free: 2, saving_cents: 37800 };
const annualOffer = (overrides = {}) => ({ eligible: true, missing: [], tier: 'standard', plans: annualPlans(), source: 'apple',
  plan_status: 'trial', apple_auto_renews: true, apple_in_free_trial: true, starts_on: '2027-03-24', can_start_now: false,
  free_walkthroughs_remaining: 3, scheduled: null, checkout_pending: null, conflict: false, active_annual: false, ...overrides });
const annualLocked = overrides => annualOffer({ eligible: false, plans: [], starts_on: null, ...overrides });
const brisbaneToday = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
};
const HOOKS_URL = 'https://hooks.example.invalid';
const SQUARE_SDK = 'https://sandbox.web.squarecdn.com/v1/square.js';
const CARD_FORM = { sdk_url: SQUARE_SDK, application_id: 'sandbox-sq0idb-test-application', location_id: 'LTEST123' };
const YEAR = { solo: 99000, studio: 189000 };
const PACKS = [{ code: 'pack3', walkthroughs: 3, price_cents: 16900 }, { code: 'pack10', walkthroughs: 10, price_cents: 49900 }];
// The server's answers: they fix the price, the start and the walkthroughs added, whatever the page shows.
const scheduledAnswer = (body, overrides = {}) => [200, { scheduled: { plan_code: body.plan_code, year_cents: YEAR[body.plan_code],
  starts_on: body.start === 'now' ? brisbaneToday() : '2027-03-24' }, charge_today: body.start === 'now', sandbox: false, ...overrides }];
const boughtAnswer = (body, overrides = {}) => {
  const pack = PACKS.find(entry => entry.code === body.pack_code);
  return [200, { credited: pack.walkthroughs, credits_available: pack.walkthroughs, amount_cents: pack.price_cents, sandbox: false, ...overrides }];
};
function hooksService(routes = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const path = String(url).replace(HOOKS_URL, '');
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), path, method: init.method, body, auth: init.headers?.Authorization, credentials: init.credentials });
    const route = routes[path];
    if (route === 'reject') throw new TypeError('offline');
    const [status, value] = route ? route(body, requests) : path === '/square/lane' ? [200, { open: true, sandbox: false, card_form: CARD_FORM }]
      : path === '/square/members-annual/checkout' ? scheduledAnswer(body)
        : path === '/square/members-annual/cancel' ? [200, { cancelled: true }]
          : path === '/square/packs/checkout' ? boughtAnswer(body) : [404, { error: 'invalid_request' }];
    return { status, ok: status >= 200 && status < 300, json: async () => value };
  };
  return { fetch, requests };
}
function fakeSquare(opts = {}) {
  const log = [];
  const card = {
    attach: async selector => { log.push(['attach', selector]); if (opts.attach) throw new Error('attach failed'); },
    focus: async field => { log.push(['focus', field]); },
    tokenize: async () => { log.push(['tokenize']); return opts.tokenize ? opts.tokenize(log) : { status: 'OK', token: 'cnon:card-nonce-ok' }; },
    destroy: async () => { log.push(['destroy']); },
  };
  return { log, payments: (applicationId, locationId) => { log.push(['payments', applicationId, locationId]);
    return { card: async options => { log.push(['card', options]); return card; } }; } };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const sequence = (answers, counter) => async args => {
  const next = answers[Math.min(counter.reads, answers.length - 1)]; counter.reads += 1;
  return typeof next === 'function' ? next(args) : { data: next };
};
async function withAnnual(offers, options = {}) {
  const service = hooksService(options.hooks);
  const square = options.square === undefined ? fakeSquare(options.squareOptions) : options.square;
  const counter = { reads: 0 };
  const h = await load({ ...options, square, fetch: service.fetch, rpc: {
    get_workspace_plan: async () => ({ data: [{ ...planRow, ...options.plan }] }),
    get_members_annual_offer: sequence(Array.isArray(offers) ? offers : [offers], counter),
    ...options.rpc,
  } });
  await settle();
  return Object.assign(h, { requests: service.requests, reads: () => counter.reads, square });
}
const annualCard = h => h.ids['account-annual'];
const annualNodes = h => annualCard(h).all();
const annualText = h => annualNodes(h).filter(el => !el.hidden).map(el => el.textContent).join('\n');
const annualFilled = h => annualNodes(h).filter(el => /\btour-action-primary\b/.test(el.className || ''));
const annualButton = (h, text) => annualNodes(h).find(el => el.tagName === 'BUTTON' && el.textContent === text);
const annualClass = (h, name) => annualNodes(h).find(el => (el.className || '').split(' ').includes(name));
const annualAll = (h, name) => annualNodes(h).filter(el => (el.className || '').split(' ').includes(name));
const annualRadio = (h, value) => annualNodes(h).find(el => el.tagName === 'INPUT' && el.value === value);
const annualProblemText = h => { const box = annualClass(h, 'annual-problem'); return box && !box.hidden ? box.all().find(el => el.className === 'annual-alert-text').textContent : null; };
const choose = async (h, value) => { const radio = annualRadio(h, value); radio.checked = true; await radio.fire('change'); };
const press = async (h, text) => { await annualButton(h, text).fire('click'); await settle(); };
const posts = (h, path) => h.requests.filter(request => request.path === path);
const squareLog = (h, name) => h.square.log.filter(entry => entry[0] === name);
const renewalOff = overrides => annualOffer({ apple_auto_renews: false, ...overrides });

test('the annual plan reads its own answer for the plan’s workspace, and the lane without a token', async () => {
  const h = await withAnnual(annualOffer());
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'get_members_annual_offer')[1] }, { p_workspace_id: 'w1' });
  const lane = h.requests.find(request => request.path === '/square/lane');
  assert.equal(lane.url, HOOKS_URL + '/square/lane');
  assert.equal(lane.auth, undefined, 'the lane is public');
  assert.equal(lane.credentials, 'omit');
  assert.equal(annualCard(h).hidden, false);
  assert.equal(annualCard(h).attributes['aria-busy'], 'false');
  assert.equal(annualClass(h, 'annual-title').tagName, 'H3');
  assert.equal(annualClass(h, 'annual-title').textContent, 'Annual plan');
  // Plan, then walkthrough packs, then the annual plan, then Refer an office, then capture help.
  assert.ok(markup.indexOf('id="account-plan-body"') < markup.indexOf('id="account-packs"'));
  assert.ok(markup.indexOf('id="account-packs"') < markup.indexOf('id="account-annual"'));
  assert.ok(markup.indexOf('id="account-annual"') < markup.indexOf('id="account-referral"'));
  assert.ok(markup.indexOf('id="account-referral"') < markup.indexOf('id="account-capture-title"'));
  assert.match(fs.readFileSync(path.join(__dirname, '../dist/supabase-public.js'), 'utf8'), /window\.VEYLET_HOOKS = \{ url: 'https:\/\/veylet-hooks\.vercel\.app' \}/);
  assert.equal(h.scripts.length, 0, 'Square’s SDK is not loaded just to show the card');
});

test('while the answer is on its way the card shows its own rows, not prices', async () => {
  const h = await withAnnual(() => new Promise(() => {}));
  assert.equal(annualCard(h).attributes['aria-busy'], 'true');
  assert.match(annualText(h), /Checking the annual plan…/);
  // One plan: one price row, then the start, the charge line, the action and the note, as the loaded card has them.
  assert.equal(annualAll(h, 'annual-skeleton-row').length, 1);
  for (const name of ['annual-plans', 'annual-option-name', 'annual-amount', 'annual-qualifier', 'annual-pay', 'annual-step-text', 'annual-charge', 'annual-actions', 'annual-note']) assert.ok(annualClass(h, name), name);
  assert.ok(annualClass(h, 'annual-skeleton-action'));
  assert.doesNotMatch(annualText(h), /A\$/);
  assert.equal(annualNodes(h).some(el => el.tagName === 'BUTTON'), false);
});

test('before the free months: one sentence on how they start, and no price, checklist or button', async () => {
  // Offer 2026-09-25.1 unlocks on started free months alone; an older server may still add the accepted-walkthrough code.
  for (const missing of [['free_months_not_started'], ['free_months_not_started', 'no_accepted_walkthrough']]) {
    const h = await withAnnual(annualLocked({ missing, source: null, plan_status: 'pending' }));
    assert.equal(annualClass(h, 'annual-lead').textContent, 'You can choose the annual plan here once your free months have started.');
    assert.match(annualText(h), /They start when the plan is activated with a payment method on file: in the app through the App Store, with a card on this page, or by Veylet for an invoiced account\./);
    assert.equal(annualAll(h, 'annual-check').length, 0, 'no second step to unlock it');
    assert.doesNotMatch(annualText(h), /A\$|Locked|Unlocked|accepted|member/i);
    assert.equal(annualNodes(h).some(el => ['A', 'BUTTON', 'INPUT'].includes(el.tagName)), false, 'the next action is text only');
  }
});

test('an older server’s accepted-walkthrough lock still reads: the first item done, and the first-capture steps as the one action', async () => {
  const h = await withAnnual(annualLocked({ missing: ['no_accepted_walkthrough'], source: 'studio' }));
  assert.equal(annualClass(h, 'annual-lead').textContent, 'The annual plan opens here after one more step.');
  assert.doesNotMatch(annualText(h), /member/i);
  assert.deepEqual(annualAll(h, 'annual-check').map(item => item.dataset.state), ['done', 'next']);
  assert.match(annualText(h), /Done: [\s\S]*Free months started/);
  assert.deepEqual(annualNodes(h).filter(el => el.tagName === 'A').map(link => [link.textContent, link.href]), [['See your first-capture steps', '/start']]);
  assert.match(annualText(h), /A walkthrough counts once its automatic quality check has passed and you have approved it for release\. Saving a space or sending a capture does not\./);
  assert.doesNotMatch(annualText(h), /A\$/);
  assert.equal(annualFilled(h).length, 0);
});

test('App Store renewal on: the one yearly price as a statement, then step 1 links to Apple and payment waits', async () => {
  const h = await withAnnual(annualOffer());
  const text = annualText(h);
  const lines = ['Veylet plan', 'A$990 a year', '24 walkthroughs to use any time in the plan year', '2 months free: A$198 less than 12 monthly payments of A$99'];
  for (const line of lines) assert.ok(text.includes(line), line);
  assert.deepEqual(lines.map(line => text.indexOf(line)), lines.map(line => text.indexOf(line)).sort((a, b) => a - b),
    'the name, the yearly total, what the year includes, then the months free and the saving');
  assert.doesNotMatch(text, /About A\$|a month over the year/, 'no derived monthly figure beside A$99');
  assert.equal(annualAll(h, 'annual-amount').length, 1, 'one plan, one price');
  assert.equal(annualNodes(h).some(el => el.tagName === 'INPUT' || el.tagName === 'FIELDSET'), false, 'there is no plan to choose');
  assert.match(text, /Your App Store plan keeps running until 24 March 2027\. Turning off renewal does not end it early\./);
  const [apple] = annualFilled(h);
  assert.equal(annualFilled(h).length, 1);
  assert.deepEqual([apple.tagName, apple.textContent, apple.href, apple.target, apple.rel],
    ['A', 'Turn off App Store renewal', 'https://apps.apple.com/account/subscriptions', '_blank', 'noopener noreferrer']);
  assert.ok(annualButton(h, 'Check again'));
  assert.equal(annualButton(h, 'Pay yearly by card'), undefined, 'no card payment while Apple still renews');
  assert.doesNotMatch(text, /Nothing is charged today|First charge/);
  assert.match(text, /Opens once App Store renewal is off\./);
});

test('Check again and coming back to the page re-read the server; Step 2 opens only when it says renewal is off', async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = await withAnnual([annualOffer(), annualOffer(), renewalOff()], { Date: Clock });
  await press(h, 'Check again');
  assert.equal(h.reads(), 2);
  assert.match(annualText(h), /App Store renewal is still on\. Apple can take a few minutes to tell us\./);
  assert.equal(annualButton(h, 'Check again').wasFocused, true);
  h.windowEvents.focus(); await settle();
  assert.equal(h.reads(), 2, 'a focus straight after a check does not read again');
  now += 6000;
  h.windowEvents.focus(); await settle();
  assert.equal(h.reads(), 3);
  assert.equal(annualButton(h, 'Pay yearly by card').className, 'tour-action tour-action-primary');
  assert.match(h.ids['account-status'].textContent, /App Store renewal is off\. Step 2 is ready\./);
  now += 6000;
  h.windowEvents.focus(); await settle();
  assert.equal(h.reads(), 3, 'nothing is waiting, so focus alone does not read again');
});

test('App Store renewal off: step 1 done, and the one filled button with the charge beside it', async () => {
  const h = await withAnnual(renewalOff());
  assert.deepEqual(annualAll(h, 'annual-step').map(step => step.dataset.state), ['done', 'active']);
  assert.match(annualText(h), /App Store renewal is off[\s\S]*Your App Store plan runs until 24 March 2027\./);
  const charge = annualClass(h, 'annual-charge');
  assert.equal(charge.textContent, 'Nothing is charged today. First charge A$990 on 24 March 2027, then it renews each year until you cancel.');
  const [pay] = annualFilled(h);
  assert.equal(annualFilled(h).length, 1);
  assert.equal(pay.textContent, 'Pay yearly by card');
  assert.equal(pay.attributes['aria-describedby'], charge.id);
  assert.equal(annualProblemText(h), null);
  assert.equal(annualClass(h, 'annual-card-field'), undefined, 'no card field until asked for');
});

test('Pay yearly by card loads Square’s SDK once, on demand, and moves focus into its labelled card field', async () => {
  const h = await withAnnual(renewalOff());
  await press(h, 'Pay yearly by card');
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, SQUARE_SDK);
  assert.deepEqual(squareLog(h, 'payments'), [['payments', CARD_FORM.application_id, CARD_FORM.location_id]]);
  assert.deepEqual(squareLog(h, 'attach'), [['attach', '#account-annual-card-field']]);
  assert.deepEqual(squareLog(h, 'focus'), [['focus', 'cardNumber']]);
  const field = annualClass(h, 'annual-card-field');
  assert.equal(field.id, 'account-annual-card-field');
  assert.equal(field.attributes.role, 'group');
  assert.equal(annualNodes(h).find(el => el.id === field.attributes['aria-labelledby']).textContent, 'Card details');
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Confirm yearly plan']);
  assert.equal(annualButton(h, 'Pay yearly by card'), undefined);
  assert.equal(annualClass(h, 'annual-charge').textContent, 'Nothing is charged today. First charge A$990 on 24 March 2027, then it renews each year until you cancel.');
  assert.equal(posts(h, '/square/members-annual/checkout').length, 0, 'opening the form sends nothing');
  // Not now closes Square's field and puts focus back on Pay; opening again reuses the loaded SDK.
  await press(h, 'Not now');
  assert.equal(squareLog(h, 'destroy').length, 1);
  assert.equal(annualButton(h, 'Pay yearly by card').wasFocused, true);
  await press(h, 'Pay yearly by card');
  assert.equal(h.scripts.length, 1, 'the SDK is loaded once');
  assert.equal(squareLog(h, 'attach').length, 2);
});

test('Confirm yearly plan sends only Square’s token for the Veylet plan and shows the scheduled plan from the answer', async () => {
  const h = await withAnnual(renewalOff());
  await press(h, 'Pay yearly by card');
  await press(h, 'Confirm yearly plan');
  const [checkout] = posts(h, '/square/members-annual/checkout');
  assert.equal(checkout.method, 'POST');
  assert.equal(checkout.auth, 'Bearer token-1');
  assert.deepEqual(checkout.body, { workspace_id: 'w1', plan_code: 'solo', start: 'scheduled', source_id: 'cnon:card-nonce-ok' });
  assert.equal(h.reads(), 1, 'the scheduled state is the answer itself');
  assert.equal(annualClass(h, 'annual-lead').textContent, 'Yearly plan starts 24 March 2027. Your App Store plan runs until then.');
  assert.equal(annualClass(h, 'annual-charge').textContent, 'Nothing has been charged. First charge A$990 on 24 March 2027, then it renews each year until you cancel.');
  assert.match(annualText(h), /Veylet plan[\s\S]*A\$990 a year/);
  assert.equal(annualClass(h, 'annual-title').wasFocused, true);
  assert.equal(squareLog(h, 'destroy').length, 1);
  assert.ok(annualButton(h, 'Cancel yearly plan'));
  assert.match(h.ids['account-status'].textContent, /Yearly plan confirmed\. Nothing is charged today\./);
});

test('there is no plan to choose: a Team account sees and buys the Veylet plan’s year, and an older answer’s Team price is not offered', async () => {
  const team = await withAnnual(renewalOff(), { plan: { plan_code: 'studio', included_per_month: 3, price_aud_cents: 18900 } });
  assert.deepEqual(annualAll(team, 'annual-amount').map(el => el.textContent), ['A$990 a year']);
  await press(team, 'Pay yearly by card');
  await press(team, 'Confirm yearly plan');
  assert.equal(posts(team, '/square/members-annual/checkout')[0].body.plan_code, 'solo');
  // A backend answering in the 2026-09-24.1 shape still lists Team: only the Veylet plan is shown and sent.
  const older = await withAnnual(renewalOff({ plans: [annualPlan(), TEAM_YEAR] }));
  assert.deepEqual(annualAll(older, 'annual-amount').map(el => el.textContent), ['A$990 a year']);
  assert.doesNotMatch(annualText(older), /A\$1,890|Team/);
  await press(older, 'Pay yearly by card');
  await press(older, 'Confirm yearly plan');
  assert.equal(posts(older, '/square/members-annual/checkout')[0].body.plan_code, 'solo');
  // An older server's second tier still states the price the server sends (one month free).
  const oneMonth = await withAnnual(renewalOff({ tier: 'oneMonthFree', plans: annualPlans(1) }));
  assert.match(annualText(oneMonth), /A\$1,089 a year[\s\S]*1 month free: A\$99 less than 12 monthly payments of A\$99/);
  assert.equal(annualClass(oneMonth, 'annual-charge').textContent, 'Nothing is charged today. First charge A$1,089 on 24 March 2027, then it renews each year until you cancel.');
});

test('an invoiced member skips the Apple step; with nothing running the charge is today, and says so', async () => {
  const invoice = await withAnnual(annualOffer({ source: 'studio', apple_auto_renews: null, apple_in_free_trial: null }));
  assert.equal(annualAll(invoice, 'annual-step').length, 0);
  assert.equal(annualNodes(invoice).some(el => el.href === 'https://apps.apple.com/account/subscriptions'), false);
  assert.match(annualText(invoice), /Your free months run until 24 March 2027\. The yearly plan starts then\./);
  assert.equal(annualFilled(invoice).map(el => el.textContent).join(), 'Pay yearly by card');
  const active = await withAnnual(annualOffer({ source: 'studio', plan_status: 'active', apple_auto_renews: null }));
  assert.match(annualText(active), /Your current plan runs until 24 March 2027\. The yearly plan starts then\./);
  const today = brisbaneToday();
  const none = await withAnnual(annualOffer({ source: 'web', plan_status: 'ended', apple_auto_renews: null, starts_on: today }),
    { hooks: { '/square/members-annual/checkout': body => [200, { scheduled: { plan_code: body.plan_code, year_cents: YEAR[body.plan_code], starts_on: today }, charge_today: true, sandbox: false }] } });
  assert.equal(annualClass(none, 'annual-charge').textContent, 'First charge A$990 today, then it renews each year until you cancel.');
  assert.doesNotMatch(annualText(none), /Nothing is charged today|runs until/);
  await press(none, 'Pay yearly by card');
  await press(none, 'Confirm yearly plan');
  assert.equal(posts(none, '/square/members-annual/checkout')[0].body.start, 'scheduled', 'a start that is already today is not a start-now request');
  // charge_today: the scheduled state says today, never "nothing has been charged", and offers no cancel.
  assert.equal(annualClass(none, 'annual-lead').textContent, 'Yearly plan starts today.');
  assert.equal(annualClass(none, 'annual-charge').textContent, 'First charge A$990 today, then it renews each year until you cancel.');
  assert.doesNotMatch(annualText(none), /Nothing (?:is|has been) charged/);
  assert.equal(annualButton(none, 'Cancel yearly plan'), undefined);
  assert.equal(annualNodes(none).find(el => el.tagName === 'A').href, 'mailto:yoda@yodalai.xyz?subject=Veylet%20yearly%20plan');
  assert.match(none.ids['account-status'].textContent, /The first charge is today\./);
});

test('free walkthroughs used up: Start yearly plan today, beside the scheduled start', async () => {
  const offer = annualOffer({ source: 'studio', apple_auto_renews: null, can_start_now: true, free_walkthroughs_remaining: 0 });
  const h = await withAnnual(offer);
  assert.match(annualText(h), /Your free walkthroughs are used up, so you can start today\./);
  assert.equal(annualRadio(h, 'now').checked, true);
  assert.ok(annualText(h).includes('24 March 2027'), 'the scheduled start is shown beside Today');
  const [start] = annualFilled(h);
  assert.equal(start.textContent, 'Start yearly plan today');
  assert.equal(annualClass(h, 'annual-charge').textContent, 'First charge A$990 today, then it renews each year until you cancel.');
  await choose(h, 'scheduled');
  assert.equal(start.textContent, 'Pay yearly by card');
  assert.match(annualClass(h, 'annual-charge').textContent, /^Nothing is charged today\. First charge A\$990 on 24 March 2027/);
  await press(h, 'Pay yearly by card');
  await press(h, 'Confirm yearly plan');
  assert.equal(posts(h, '/square/members-annual/checkout')[0].body.start, 'scheduled');
  const now = await withAnnual(offer);
  await press(now, 'Start yearly plan today');
  assert.equal(annualFilled(now)[0].textContent, 'Confirm yearly plan');
  await choose(now, 'scheduled'); await choose(now, 'now');
  assert.equal(annualFilled(now)[0].textContent, 'Confirm yearly plan', 'the open form keeps its confirm label');
  await press(now, 'Confirm yearly plan');
  assert.equal(posts(now, '/square/members-annual/checkout')[0].body.start, 'now');
  assert.equal(annualClass(now, 'annual-lead').textContent, 'Yearly plan starts today.');
  assert.equal(annualClass(now, 'annual-charge').textContent, 'First charge A$990 today, then it renews each year until you cancel.');
  const not = await withAnnual(annualOffer({ source: 'studio', apple_auto_renews: null, can_start_now: false }));
  assert.equal(annualRadio(not, 'now'), undefined);
  assert.equal(annualButton(not, 'Start yearly plan today'), undefined);
});

test('a checkout left open on the server is not a state of its own: the card form is offered again', async () => {
  for (const plan_code of ['solo', 'studio']) {
    const h = await withAnnual(renewalOff({ checkout_pending: { plan_code, created_at: '2026-09-24T02:10:00Z' } }));
    assert.doesNotMatch(annualText(h), /Checkout not finished|Continue checkout/);
    assert.deepEqual(annualAll(h, 'annual-amount').map(el => el.textContent), ['A$990 a year'], plan_code);
    assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Pay yearly by card']);
  }
  assert.doesNotMatch(account, /Continue checkout|checkout_url|location\.assign/);
});

test('Square’s script failing to load says so and offers Try again, which loads it afresh', async () => {
  let mode = 'fail';
  const h = await withAnnual(renewalOff(), { sdk: () => mode });
  await press(h, 'Pay yearly by card');
  assert.equal(annualProblemText(h), 'Card form couldn’t load. Try again.');
  assert.equal(annualClass(h, 'annual-card-field'), undefined);
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try again']);
  assert.equal(annualFilled(h)[0].wasFocused, true);
  mode = 'ok';
  await press(h, 'Try again');
  assert.equal(h.scripts.length, 2, 'a failed load is not reused');
  assert.ok(annualClass(h, 'annual-card-field'));
  assert.equal(annualProblemText(h), null);
  // A lane with no card form, or a script from anywhere but Square's CDN, is never loaded.
  for (const card_form of [undefined, { ...CARD_FORM, sdk_url: 'https://cdn.example.com/square.js' }, { ...CARD_FORM, application_id: 'x' }]) {
    const bad = await withAnnual(renewalOff(), { hooks: { '/square/lane': () => [200, { open: true, sandbox: false, card_form }] } });
    await press(bad, 'Pay yearly by card');
    assert.equal(bad.scripts.length, 0, JSON.stringify(card_form));
    assert.equal(annualProblemText(bad), 'Card form couldn’t load. Try again.');
  }
  // Square loads but its card cannot attach: the same sentence, and the field is let go.
  const attach = await withAnnual(renewalOff(), { squareOptions: { attach: true } });
  await press(attach, 'Pay yearly by card');
  assert.equal(annualProblemText(attach), 'Card form couldn’t load. Try again.');
  assert.equal(squareLog(attach, 'destroy').length, 1);
});

test('a card Square cannot tokenize keeps the form, says so, and sends nothing', async () => {
  let tries = 0;
  const h = await withAnnual(renewalOff(), { squareOptions: { tokenize: () => (++tries === 1
    ? { status: 'Invalid', errors: [{ field: 'cardNumber', type: 'VALIDATION_ERROR' }] } : { status: 'OK', token: 'cnon:card-nonce-ok' }) } });
  await press(h, 'Pay yearly by card');
  await press(h, 'Confirm yearly plan');
  assert.equal(annualProblemText(h), 'Square couldn’t use those card details. Check them and try again. Nothing was charged.');
  assert.ok(annualClass(h, 'annual-card-field'), 'the card form stays');
  assert.equal(squareLog(h, 'destroy').length, 0);
  assert.equal(posts(h, '/square/members-annual/checkout').length, 0);
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try again']);
  await press(h, 'Try again');
  assert.equal(posts(h, '/square/members-annual/checkout').length, 1, 'a fresh token each time');
  assert.equal(annualClass(h, 'annual-lead').textContent, 'Yearly plan starts 24 March 2027. Your App Store plan runs until then.');
});

test('each refusal is a plain sentence under the button, with the card form kept and Try again', async () => {
  const sentences = {
    checkout_failed: [502, 'The yearly plan wasn’t confirmed. Nothing was charged. Try again.'],
    not_eligible: [403, 'The annual plan isn’t available for this workspace right now, so nothing was set up. Nothing was charged.'],
    apple_still_renews: [409, 'App Store renewal is still on, so nothing was set up. Turn it off in the App Store, then try again. Nothing was charged.'],
    start_now_unavailable: [409, 'Starting today is no longer available, so nothing was set up. Choose the later start, then try again. Nothing was charged.'],
    lane_closed: [503, 'Card payment for the annual price is closed right now, so nothing was set up. Nothing was charged.'],
    invalid_request: [400, 'The yearly plan wasn’t confirmed. Nothing was charged. Try again.'],
  };
  for (const [code, [status, sentence]] of Object.entries(sentences)) {
    const h = await withAnnual(renewalOff(), { hooks: { '/square/members-annual/checkout': () => [status, { error: code }] } });
    await press(h, 'Pay yearly by card');
    const charge = annualClass(h, 'annual-charge').textContent;
    await press(h, 'Confirm yearly plan');
    assert.equal(annualProblemText(h), sentence, code);
    assert.ok(annualClass(h, 'annual-card-field'), `${code} keeps the card form`);
    assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try again'], code);
    assert.equal(annualFilled(h)[0].wasFocused, true, code);
    assert.equal(annualClass(h, 'annual-charge').textContent, charge, `${code} keeps the price and date`);
    assert.equal(h.reads(), 1, `${code} saves nothing as scheduled`);
  }
  // A network failure reads as checkout_failed; on a start today the retry is said not to charge twice.
  const offline = await withAnnual(annualOffer({ source: 'web', plan_status: 'ended', apple_auto_renews: null, starts_on: brisbaneToday() }),
    { hooks: { '/square/members-annual/checkout': 'reject' } });
  await press(offline, 'Pay yearly by card');
  await press(offline, 'Confirm yearly plan');
  assert.equal(annualProblemText(offline), 'The yearly plan wasn’t confirmed. Try again: a retry finishes the same plan and never charges twice.');
});

test('already scheduled, an unreadable answer and an expired session go to the server’s record or to sign-in', async () => {
  const scheduled = { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' };
  const h = await withAnnual([renewalOff(), renewalOff({ scheduled })], { hooks: { '/square/members-annual/checkout': () => [409, { error: 'already_scheduled' }] } });
  await press(h, 'Pay yearly by card');
  await press(h, 'Confirm yearly plan');
  assert.equal(h.reads(), 2);
  assert.equal(annualClass(h, 'annual-notice').textContent, 'A yearly plan is already scheduled for this workspace, so nothing more was set up.');
  assert.match(annualText(h), /Yearly plan starts 24 March 2027/);
  assert.equal(squareLog(h, 'destroy').length, 1);
  const odd = await withAnnual([renewalOff(), renewalOff({ scheduled })], { hooks: { '/square/members-annual/checkout': () => [200, { checkout_url: 'https://square.link/u/x' }] } });
  await press(odd, 'Pay yearly by card');
  await press(odd, 'Confirm yearly plan');
  assert.equal(odd.reads(), 2);
  assert.match(annualClass(odd, 'annual-notice').textContent, /The answer could not be read/);
  assert.deepEqual(odd.redirects, [], 'no URL is ever followed');
  const expired = await withAnnual(renewalOff(), { hooks: { '/square/members-annual/checkout': () => [401, { error: 'unauthorized' }] } });
  await press(expired, 'Pay yearly by card');
  await press(expired, 'Confirm yearly plan');
  assert.equal(expired.ids['account-home'].hidden, true);
  assert.match(expired.ids['account-status'].textContent, /sign-in has expired[\s\S]*Nothing was set up/);
  assert.equal(annualCard(expired).hidden, true);
  const tokenless = await withAnnual(renewalOff(), { accessToken: null });
  await press(tokenless, 'Pay yearly by card');
  await press(tokenless, 'Confirm yearly plan');
  assert.equal(posts(tokenless, '/square/members-annual/checkout').length, 0, 'no request without a bearer token');
});

test('coming back to the page never redraws over an open card form', async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = await withAnnual(annualOffer({ source: 'studio', apple_auto_renews: null }), { Date: Clock });
  await press(h, 'Pay yearly by card');
  now += 60000;
  h.windowEvents.focus(); h.windowEvents.pageshow?.({ persisted: true }); await settle();
  assert.equal(h.reads(), 1);
  assert.equal(squareLog(h, 'attach').length, 1);
  assert.equal(squareLog(h, 'destroy').length, 0);
});

test('scheduled: the start date and what runs until then, with a secondary cancel that names the date', async () => {
  const scheduled = { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' };
  const h = await withAnnual([renewalOff({ scheduled }), renewalOff()]);
  assert.equal(annualClass(h, 'annual-lead').textContent, 'Yearly plan starts 24 March 2027. Your App Store plan runs until then.');
  assert.equal(annualClass(h, 'annual-charge').textContent, 'Nothing has been charged. First charge A$990 on 24 March 2027, then it renews each year until you cancel.');
  assert.deepEqual([annualClass(h, 'annual-option-name').textContent, annualClass(h, 'annual-amount').textContent], ['Veylet plan', 'A$990 a year']);
  assert.equal(annualFilled(h).length, 0, 'cancelling is secondary');
  await press(h, 'Cancel yearly plan');
  const confirm = annualClass(h, 'annual-confirm');
  assert.equal(confirm.textContent, 'Cancel the yearly plan that starts 24 March 2027? Nothing has been charged. Your App Store plan still ends on 24 March 2027 unless you turn its renewal back on. A later yearly plan uses the annual price at that time.');
  assert.equal(confirm.wasFocused, true);
  assert.equal(posts(h, '/square/members-annual/cancel').length, 0, 'nothing is sent before the confirmation');
  await press(h, 'Keep yearly plan');
  assert.equal(annualButton(h, 'Cancel yearly plan').wasFocused, true);
  await press(h, 'Cancel yearly plan');
  const armed = annualNodes(h).find(el => el.tagName === 'BUTTON' && el.dataset.armed === 'true');
  assert.equal(armed.className, 'tour-action tour-action-danger');
  await armed.fire('click'); await settle();
  const [request] = posts(h, '/square/members-annual/cancel');
  assert.equal(request.auth, 'Bearer token-1');
  assert.deepEqual(request.body, { workspace_id: 'w1' });
  assert.equal(h.reads(), 2, 'the result is read back, not assumed');
  assert.equal(annualClass(h, 'annual-notice').textContent, 'Yearly plan cancelled. Nothing was charged.');
  assert.equal(annualClass(h, 'annual-title').wasFocused, true);
  assert.ok(annualButton(h, 'Pay yearly by card'));
});

test('a year already scheduled on the retired Team plan still reads by its own name and price', async () => {
  const scheduled = { plan_code: 'studio', year_cents: 189000, starts_on: '2027-03-24' };
  const h = await withAnnual(renewalOff({ scheduled }), { plan: { plan_code: 'studio', included_per_month: 3, price_aud_cents: 18900 } });
  assert.deepEqual([annualClass(h, 'annual-option-name').textContent, annualClass(h, 'annual-amount').textContent], ['Team', 'A$1,890 a year']);
  assert.equal(annualClass(h, 'annual-charge').textContent, 'Nothing has been charged. First charge A$1,890 on 24 March 2027, then it renews each year until you cancel.');
  assert.ok(annualButton(h, 'Cancel yearly plan'));
  // Whatever the tier is now, a closed tier keeps what was bought.
  const closed = await withAnnual(annualLocked({ tier: 'closed', apple_auto_renews: false, scheduled }));
  assert.match(annualText(closed), /Yearly plan starts 24 March 2027[\s\S]*Team[\s\S]*A\$1,890 a year/);
});

test('conflict: a warning with an icon and words, and no payment', async () => {
  const scheduled = { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' };
  const h = await withAnnual(annualOffer({ apple_auto_renews: true, conflict: true, scheduled }));
  const alert = annualClass(h, 'annual-alert');
  assert.equal(alert.all().find(el => el.className === 'annual-alert-icon').attributes['aria-hidden'], 'true');
  assert.equal(alert.all().find(el => el.className === 'annual-alert-text').textContent,
    'App Store renewal is on again, so both would charge. We paused your yearly plan, due to start 24 March 2027. Nothing has been charged.');
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Turn off App Store renewal']);
  assert.ok(annualButton(h, 'Cancel yearly plan'));
  assert.equal(annualButton(h, 'Pay yearly by card'), undefined);
  await press(h, 'Cancel yearly plan');
  assert.match(annualClass(h, 'annual-confirm').textContent, /Nothing has been charged\. Your App Store plan keeps renewing\./);
});

test('an active annual plan hides the card; the plan panel states the yearly plan', async () => {
  const h = await withAnnual(annualOffer({ source: 'web', plan_status: 'active', active_annual: true }), { plan: {
    source: 'web', status: 'active', billing_interval: 'annual', renewal_price_aud_cents: 99000, current_period_ends_at: '2027-09-24T00:00:00Z' } });
  assert.equal(annualCard(h).hidden, true);
  assert.equal(annualCard(h).children.length, 0);
  assert.equal(planTitle(h), 'Veylet plan · A$990 a year');
  assert.match(planText(h), /Hosting included\. Billed annually\./);
  assert.doesNotMatch(planText(h), /allowance resets monthly/);
  assert.match(planScopes(h).join(' '), /Your card plan is managed by Veylet support: email to change or cancel it; nothing changes until Veylet confirms it in writing\./);
  assert.doesNotMatch(planScopes(h).join(' '), /Invoiced plans|not paid by card/);
});

test('card lane closed: the one price and “opens soon”, with no action', async () => {
  const h = await withAnnual(renewalOff(), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.match(annualText(h), /Card payment for the annual price opens soon\./);
  assert.deepEqual(annualAll(h, 'annual-amount').map(el => el.textContent), ['A$990 a year']);
  assert.equal(annualNodes(h).some(el => ['A', 'BUTTON', 'INPUT'].includes(el.tagName)), false);
});

test('an unreadable answer is an error with Try again, never a price or a locked state', async () => {
  const h = await withAnnual([() => ({ error: { message: 'offline' } }), annualOffer()]);
  assert.equal(annualClass(h, 'annual-lead').textContent, 'Couldn’t check the annual plan.');
  assert.doesNotMatch(annualText(h), /A\$|Locked|Unlocked/);
  assert.equal(annualFilled(h).length, 0);
  await press(h, 'Try again');
  assert.equal(h.reads(), 2);
  assert.ok(annualButton(h, 'Check again'), 'the second answer is shown');
  assert.equal(annualClass(h, 'annual-title').wasFocused, true);
  const broken = [
    annualOffer({ plans: [{ ...annualPlan(), saving_cents: 15000 }] }),
    annualOffer({ plans: [{ ...annualPlan(), months_free: 3 }] }),
    // Unlocked, but without the Veylet plan's price.
    annualOffer({ plans: [TEAM_YEAR] }),
    annualOffer({ plans: [] }),
    annualLocked({ missing: ['no_accepted_walkthrough'], plans: annualPlans() }),
    annualOffer({ missing: ['something_else'], eligible: false, plans: [] }),
    annualOffer({ starts_on: '24/03/2027' }),
    annualOffer({ scheduled: { plan_code: 'solo', year_cents: 'lots', starts_on: '2027-03-24' } }),
    'receipt',
  ];
  for (const offer of broken) {
    const bad = await withAnnual(offer);
    assert.match(annualText(bad), /Couldn’t check the annual plan\./, JSON.stringify(offer).slice(0, 80));
  }
  const noLane = await withAnnual(annualOffer(), { hooks: { '/square/lane': 'reject' } });
  assert.match(annualText(noLane), /Couldn’t check the annual plan\./);
  const lockedNoLane = await withAnnual(annualLocked({ missing: ['no_accepted_walkthrough'] }), { hooks: { '/square/lane': 'reject' } });
  assert.match(annualText(lockedNoLane), /Get your first walkthrough accepted/);
});

test('before the backend has the function, and without a workspace, there is no card', async () => {
  const missing = await withAnnual(() => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }));
  assert.equal(annualCard(missing).hidden, true);
  const none = await load({ tables: { memberships: { data: [] } } });
  await settle();
  assert.equal(annualCard(none).hidden, true);
  assert.equal(none.calls.some(call => call[0] === 'get_members_annual_offer'), false);
});

test('a member who is not the owner, and a closed tier, get a sentence and nothing to press', async () => {
  const member = await withAnnual(annualLocked({ missing: ['not_owner'] }));
  assert.match(annualText(member), /Only the workspace owner can choose the annual plan here\./);
  const closed = await withAnnual(annualLocked({ tier: 'closed' }));
  assert.match(annualText(closed), /Choosing the annual plan here is paused for now\./);
  for (const h of [member, closed]) {
    assert.doesNotMatch(annualText(h), /A\$/);
    assert.equal(annualNodes(h).some(el => ['A', 'BUTTON', 'INPUT'].includes(el.tagName)), false);
  }
  const kept = await withAnnual(annualLocked({ tier: 'closed', apple_auto_renews: false, scheduled: { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' } }));
  assert.match(annualText(kept), /Yearly plan starts 24 March 2027/);
});

test('Square Sandbox labels every price and payment action Test, before and after confirming', async () => {
  const sandbox = { '/square/lane': () => [200, { open: true, sandbox: true, card_form: CARD_FORM }],
    '/square/members-annual/checkout': body => scheduledAnswer(body, { sandbox: true }) };
  const h = await withAnnual(renewalOff(), { hooks: sandbox });
  assert.deepEqual(annualAll(h, 'annual-amount').map(el => el.textContent), ['Test · A$990 a year']);
  assert.match(annualClass(h, 'annual-charge').textContent, /^Test · Nothing is charged today\./);
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Test · Pay yearly by card']);
  assert.match(annualText(h), /Square Sandbox: a test checkout, not a live payment\./);
  await press(h, 'Test · Pay yearly by card');
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Test · Confirm yearly plan']);
  await press(h, 'Test · Confirm yearly plan');
  assert.match(annualClass(h, 'annual-lead').textContent, /^Test · Yearly plan starts/);
  assert.ok(annualButton(h, 'Test · Cancel yearly plan'));
  // The answer's own sandbox flag labels the result even if the lane said nothing.
  const flagged = await withAnnual(renewalOff(), { hooks: { '/square/members-annual/checkout': body => scheduledAnswer(body, { sandbox: true }) } });
  await press(flagged, 'Pay yearly by card');
  await press(flagged, 'Confirm yearly plan');
  assert.match(annualClass(flagged, 'annual-charge').textContent, /^Test · /);
  const live = await withAnnual(renewalOff());
  assert.doesNotMatch(annualText(live), /Test|Sandbox/);
});

test('every state has at most one filled action, and the App Store is never called dearer', async () => {
  const scheduled = { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' };
  const states = [
    [annualLocked({ missing: ['free_months_not_started', 'no_accepted_walkthrough'] }), 0],
    [annualLocked({ missing: ['no_accepted_walkthrough'] }), 0],
    [annualOffer(), 1],
    [renewalOff(), 1],
    [annualOffer({ source: 'studio', apple_auto_renews: null }), 1],
    [annualOffer({ source: 'studio', apple_auto_renews: null, can_start_now: true }), 1],
    [renewalOff({ scheduled }), 0],
    [annualOffer({ conflict: true, scheduled }), 1],
    [() => ({ error: { message: 'offline' } }), 0],
  ];
  const noComparison = /App Store[^.]*(?:more expensive|dearer|costs? more|cheaper)|save[sd]?[^.]*(?:vs\.?|versus|against|than)[^.]*(?:App Store|Apple)|(?:App Store|Apple)[^.]*save/i;
  for (const [offer, filled] of states) {
    const h = await withAnnual(offer);
    assert.equal(annualFilled(h).length, filled, annualText(h).slice(0, 120));
    assert.doesNotMatch(annualText(h), noComparison);
  }
  const open = await withAnnual(renewalOff());
  await press(open, 'Pay yearly by card');
  assert.equal(annualFilled(open).length, 1, 'the card form has one filled action');
  assert.doesNotMatch(annualText(open), noComparison);
});

test('truth check: the yearly price and start date read the same in the price, beside the button and in the scheduled answer', async () => {
  const h = await withAnnual(renewalOff());
  const amount = annualClass(h, 'annual-amount').textContent.match(/A\$[\d,]+/)[0];
  const before = annualClass(h, 'annual-charge').textContent.match(/First charge (A\$[\d,]+) on (\d{1,2} \w+ \d{4})/);
  await press(h, 'Pay yearly by card');
  const beside = annualClass(h, 'annual-charge').textContent.match(/First charge (A\$[\d,]+) on (\d{1,2} \w+ \d{4})/);
  await press(h, 'Confirm yearly plan');
  const lead = annualClass(h, 'annual-lead').textContent.match(/Yearly plan starts (\d{1,2} \w+ \d{4})\./);
  const after = annualClass(h, 'annual-charge').textContent.match(/First charge (A\$[\d,]+) on (\d{1,2} \w+ \d{4})/);
  const row = annualClass(h, 'annual-amount').textContent.match(/A\$[\d,]+/)[0];
  assert.deepEqual([amount, before[2]], ['A$990', '24 March 2027']);
  assert.deepEqual([before[1], beside[1], after[1], row], [amount, amount, amount, amount]);
  assert.deepEqual([beside[2], after[2], lead[1]], [before[2], before[2], before[2]]);
  assert.equal(annualClass(h, 'annual-notice'), undefined, 'nothing differs, so nothing is flagged');
  // When the server's terms differ from what the button stated, its terms are shown, and said to differ.
  const moved = await withAnnual(renewalOff(), { hooks: { '/square/members-annual/checkout': body => [200, { scheduled: { plan_code: body.plan_code, year_cents: YEAR[body.plan_code], starts_on: '2027-04-01' }, charge_today: false, sandbox: false }] } });
  await press(moved, 'Pay yearly by card');
  await press(moved, 'Confirm yearly plan');
  assert.match(annualClass(moved, 'annual-lead').textContent, /Yearly plan starts 1 April 2027/);
  assert.match(annualClass(moved, 'annual-notice').textContent, /they differ from what was shown before you confirmed/);
  // The plan panel above states the same App Store end date as the card's start.
  const panel = await withAnnual(renewalOff({ starts_on: '2026-12-01' }), { plan: { source: 'apple', apple_verified: true } });
  assert.equal(planTitle(panel), 'Free until ' + longDate(planRow.trial_ends_at));
  assert.match(annualText(panel), new RegExp('runs until ' + longDate(planRow.trial_ends_at)));
});

test('signing out hides the annual plan and lets go of Square’s card field', async () => {
  const h = await withAnnual(renewalOff());
  await press(h, 'Pay yearly by card');
  h.supabase.auth.callback('SIGNED_OUT', null);
  await settle();
  assert.equal(annualCard(h).hidden, true);
  assert.equal(annualCard(h).children.length, 0);
  assert.equal(squareLog(h, 'destroy').length, 1);
});

test('the plan panel no longer points at a public annual comparison or says no card is ever taken', async () => {
  const h = await withPlan({});
  assert.doesNotMatch(planText(h), /compare monthly and annual|Website card checkout is not available|cannot take a card/i);
  // Offer 2026-09-25.2 takes a card on this website to start the free months, so the panel no longer says it never does.
  assert.doesNotMatch(planScopes(h).join(' '), /not paid by card on this website/);
  assert.match(planScopes(h).join(' '), /Invoiced plans are managed by Veylet support; nothing changes until Veylet confirms it in writing\./);
  assert.ok(planLinks(h).includes('/offer'));
});

/* ---- Walkthrough packs -------------------------------------------------
 * The card between Your plan and the members' annual price (offer 2026-09-24.2;
 * docs/design/one-plan-and-packs-20260924.md). Every state is forced from a
 * mocked get_pack_offer answer, the mocked hooks service and the fake Square
 * SDK. Paying charges the card at once, so the card never says nothing is
 * charged before it knows; the pack's price and walkthrough count read the same
 * in the choice, on both buttons, beside them and in the bought state.
 */
const packOffer = (overrides = {}) => ({ available: true, missing: [], packs: PACKS.map(pack => ({ ...pack })), credits_available: 0, next_expiry: null, ...overrides });
const packLocked = (missing, overrides = {}) => packOffer({ available: false, missing, packs: [], ...overrides });
const capacityOf = extra => ({ data: [{ plan_status: 'trial', included_limit: 6, included_used: 2, included_remaining: 4,
  extra_credits_available: extra, can_accept: true, reason_code: null }] });
async function withPacks(offers, options = {}) {
  const service = hooksService(options.hooks);
  const square = options.square === undefined ? fakeSquare(options.squareOptions) : options.square;
  const counter = { reads: 0 };
  let capacityReads = 0;
  const extras = options.capacity || [0];
  const h = await load({ ...options, square, fetch: service.fetch, rpc: {
    get_workspace_plan: async () => ({ data: [{ ...planRow, ...options.plan }] }),
    get_pack_offer: sequence(Array.isArray(offers) ? offers : [offers], counter),
    get_walkthrough_capacity: async () => capacityOf(extras[Math.min(capacityReads++, extras.length - 1)]),
    // The members' annual price has its own tests; here it stays out of the way.
    get_members_annual_offer: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }),
    ...options.rpc,
  } });
  await settle();
  return Object.assign(h, { requests: service.requests, reads: () => counter.reads, capacityReads: () => capacityReads, square });
}
const packsCard = h => h.ids['account-packs'];
const packNodes = h => packsCard(h).all();
const packText = h => packNodes(h).filter(el => !el.hidden).map(el => el.textContent).join('\n');
const packFilled = h => packNodes(h).filter(el => /\btour-action-primary\b/.test(el.className || ''));
const packButton = (h, text) => packNodes(h).find(el => el.tagName === 'BUTTON' && el.textContent === text);
const packClass = (h, name) => packNodes(h).find(el => (el.className || '').split(' ').includes(name));
const packAll = (h, name) => packNodes(h).filter(el => (el.className || '').split(' ').includes(name));
const packRadio = (h, value) => packNodes(h).find(el => el.tagName === 'INPUT' && el.value === value);
const packProblem = h => { const box = packClass(h, 'annual-problem'); return box && !box.hidden ? box.all().find(el => el.className === 'annual-alert-text').textContent : null; };
const pressPack = async (h, text) => { await packButton(h, text).fire('click'); await settle(); };
const choosePack = async (h, value) => { const radio = packRadio(h, value); radio.checked = true; await radio.fire('change'); };
// A pack bought today is used by the same day twelve months on, in Brisbane.
const useBy = () => {
  const [year, month, day] = brisbaneToday().split('-').map(Number);
  const last = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year + 1, month - 1, Math.min(day, last))).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const NO_CHARGE_PROMISE = /Nothing (?:is|will be) charged/;

test('walkthrough packs read their own answer for the plan’s workspace and sit between the plan and the members’ price', async () => {
  const h = await withPacks(packOffer());
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'get_pack_offer')[1] }, { p_workspace_id: 'w1' });
  assert.equal(packsCard(h).hidden, false);
  assert.equal(packsCard(h).attributes['aria-busy'], 'false');
  assert.equal(packClass(h, 'annual-title').tagName, 'H3');
  assert.equal(packClass(h, 'annual-title').textContent, 'Walkthrough packs');
  assert.match(markup, /<section id="account-packs" class="packs-offer" aria-labelledby="account-packs-title" hidden><\/section>/);
  assert.equal(h.scripts.length, 0, 'Square’s SDK is not loaded just to show the card');
  // One lane read serves both cards on a desk load, and it carries no token.
  const both = await withAnnual(renewalOff(), { rpc: { get_pack_offer: async () => ({ data: packOffer() }) } });
  const lanes = both.requests.filter(request => request.path === '/square/lane');
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].auth, undefined);
});

test('while the answer is on its way the packs card shows its own rows, not prices', async () => {
  const h = await withPacks(() => new Promise(() => {}));
  assert.equal(packsCard(h).attributes['aria-busy'], 'true');
  assert.match(packText(h), /Checking walkthrough packs and how many extra walkthroughs you have…/);
  assert.equal(packAll(h, 'annual-skeleton-row').length, 2);
  // The two pack rows are the loaded choice rows' own boxes, between the balance and the charge line.
  assert.equal(packAll(h, 'annual-option').length, 2);
  for (const name of ['packs-balance', 'annual-choice', 'annual-charge', 'annual-actions', 'annual-note']) assert.ok(packClass(h, name), name);
  assert.ok(packClass(h, 'annual-skeleton-action'));
  assert.doesNotMatch(packText(h), /A\$/);
  assert.equal(packNodes(h).some(el => el.tagName === 'BUTTON'), false);
});

test('not available: before the free months or plan start, and for a member who is not the owner, a sentence and nothing to press', async () => {
  const pending = await withPacks(packLocked(['not_activated']));
  assert.match(packText(pending), /Packs can be bought once your free months or plan have started\./);
  assert.match(packText(pending), /used after your included ones and expire 12 months after purchase/);
  const member = await withPacks(packLocked(['not_owner']));
  assert.match(packText(member), /Only the workspace owner can buy walkthrough packs\./);
  // Both reasons at once: the owner question is answered first.
  const both = await withPacks(packLocked(['not_owner', 'not_activated']));
  assert.match(packText(both), /Only the workspace owner can buy walkthrough packs\./);
  for (const h of [pending, member, both]) {
    assert.doesNotMatch(packText(h), /A\$/);
    assert.equal(packNodes(h).some(el => ['A', 'BUTTON', 'INPUT'].includes(el.tagName)), false);
  }
});

test('choose a pack: prices as statements, the charge beside the one filled button, and choosing changes only those words', async () => {
  const h = await withPacks(packOffer());
  assert.deepEqual(packAll(h, 'annual-option-name').map(el => el.textContent), ['3 walkthroughs', '10 walkthroughs']);
  assert.deepEqual(packAll(h, 'annual-amount').map(el => el.textContent), ['A$169', 'A$499']);
  assert.deepEqual(packAll(h, 'annual-qualifier').map(el => el.textContent), ['Use within 12 months of purchase', 'Use within 12 months of purchase']);
  assert.equal(packRadio(h, 'pack3').checked, true, 'the smaller pack is chosen first');
  assert.equal(packClass(h, 'packs-balance').textContent, 'No extra walkthroughs available.');
  const charge = packClass(h, 'annual-charge');
  assert.equal(charge.textContent, 'Charged today: A$169 for 3 walkthroughs, to use within 12 months.');
  const [buy] = packFilled(h);
  assert.equal(packFilled(h).length, 1);
  assert.equal(buy.textContent, 'Buy 3 walkthroughs');
  assert.equal(buy.attributes['aria-describedby'], charge.id);
  assert.equal(charge.id, 'account-packs-charge');
  assert.doesNotMatch(packText(h), NO_CHARGE_PROMISE);
  await choosePack(h, 'pack10');
  assert.equal(packButton(h, 'Buy 10 walkthroughs'), buy, 'the card was not redrawn under the choice');
  assert.equal(packClass(h, 'annual-charge').textContent, 'Charged today: A$499 for 10 walkthroughs, to use within 12 months.');
  // A balance and its next expiry, from the answer.
  const credits = await withPacks(packOffer({ credits_available: 2, next_expiry: '2027-03-02' }));
  assert.equal(packClass(credits, 'packs-balance').textContent, '2 extra walkthroughs available; the next expiry is 2 March 2027.');
});

test('Buy loads Square’s SDK once, on demand, opens its labelled card field in the card and moves focus into it', async () => {
  const h = await withPacks(packOffer());
  await pressPack(h, 'Buy 3 walkthroughs');
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, SQUARE_SDK);
  assert.deepEqual(squareLog(h, 'attach'), [['attach', '#account-packs-card-field']]);
  assert.deepEqual(squareLog(h, 'focus'), [['focus', 'cardNumber']]);
  const field = packClass(h, 'annual-card-field');
  assert.equal(field.id, 'account-packs-card-field');
  assert.equal(field.attributes.role, 'group');
  assert.equal(packNodes(h).find(el => el.id === field.attributes['aria-labelledby']).textContent, 'Card details');
  assert.deepEqual(packFilled(h).map(el => el.textContent), ['Pay A$169']);
  assert.equal(packClass(h, 'annual-charge').textContent, 'Charged today: A$169 for 3 walkthroughs, to use within 12 months.');
  assert.equal(posts(h, '/square/packs/checkout').length, 0, 'opening the form sends nothing');
  await pressPack(h, 'Not now');
  assert.equal(squareLog(h, 'destroy').length, 1);
  assert.equal(packButton(h, 'Buy 3 walkthroughs').wasFocused, true);
  assert.match(h.ids['account-status'].textContent, /Card form closed\. Nothing was charged\./);
  await pressPack(h, 'Buy 3 walkthroughs');
  assert.equal(h.scripts.length, 1, 'the SDK is loaded once');
});

test('Pay sends only Square’s token and shows what the server added, the balance and the date to use them by', async () => {
  const h = await withPacks(packOffer(), { capacity: [0, 3] });
  await pressPack(h, 'Buy 3 walkthroughs');
  await pressPack(h, 'Pay A$169');
  const [checkout] = posts(h, '/square/packs/checkout');
  assert.equal(checkout.method, 'POST');
  assert.equal(checkout.auth, 'Bearer token-1');
  assert.equal(checkout.credentials, 'omit');
  const { attempt_id: attemptID, ...rest } = checkout.body;
  assert.deepEqual(rest, { workspace_id: 'w1', pack_code: 'pack3', source_id: 'cnon:card-nonce-ok' });
  assert.match(attemptID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'one attempt id per purchase intent');
  assert.equal(packClass(h, 'annual-lead').textContent, '3 walkthroughs added; 3 available; use by ' + useBy() + '.');
  assert.equal(packClass(h, 'annual-charge').textContent, 'A$169 charged today.');
  assert.match(packText(h), /They are used after your included walkthroughs, oldest pack first\./);
  assert.equal(packClass(h, 'annual-title').wasFocused, true);
  assert.equal(squareLog(h, 'destroy').length, 1);
  assert.equal(packFilled(h).length, 0, 'done: nothing filled');
  assert.match(h.ids['account-status'].textContent, /3 walkthroughs added\. A\$169 charged today\./);
  assert.equal(h.reads(), 1, 'the bought state is the answer itself');
  // The plan panel above re-reads the ledger, so both state the same balance.
  assert.equal(h.capacityReads(), 2);
  assert.match(capacityText(h), /4 included walkthroughs remaining · 3 extra walkthroughs available/);
  assert.ok(planValues(h).includes('3 available'));
  // Buy another pack goes back to the choice, with the balance the answer stated.
  await pressPack(h, 'Buy another pack');
  assert.equal(packClass(h, 'packs-balance').textContent, '3 extra walkthroughs available; the next expiry is ' + useBy() + '.');
  assert.deepEqual(packFilled(h).map(el => el.textContent), ['Buy 3 walkthroughs']);
  assert.equal(packFilled(h)[0].wasFocused, true);
  // The server's own expiry is used when it gives one.
  const dated = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': body => boughtAnswer(body, { expires_on: '2027-09-30' }) } });
  await pressPack(dated, 'Buy 3 walkthroughs');
  await pressPack(dated, 'Pay A$169');
  assert.match(packClass(dated, 'annual-lead').textContent, /use by 30 September 2027\.$/);
});

test('a declined card is a plain sentence under the button, the card field kept, and Try again pays with a fresh token', async () => {
  let attempt = 0;
  const h = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': body => (++attempt === 1 ? [402, { error: 'payment_declined' }] : boughtAnswer(body)) } });
  await pressPack(h, 'Buy 3 walkthroughs');
  const charge = packClass(h, 'annual-charge').textContent;
  await pressPack(h, 'Pay A$169');
  assert.equal(packProblem(h), 'Your card was declined, so nothing was charged. Check the details or use another card, then try again.');
  const box = packClass(h, 'annual-problem');
  assert.equal(box.all().find(el => el.className === 'annual-alert-icon').attributes['aria-hidden'], 'true', 'an icon and words, never colour alone');
  assert.ok(packClass(h, 'annual-card-field'), 'the card field stays');
  assert.equal(squareLog(h, 'destroy').length, 0);
  assert.deepEqual(packFilled(h).map(el => el.textContent), ['Try again']);
  assert.equal(packFilled(h)[0].wasFocused, true);
  assert.equal(packClass(h, 'annual-charge').textContent, charge, 'the price and count are unchanged');
  assert.match(h.ids['account-status'].textContent, /Your card was declined/);
  await pressPack(h, 'Try again');
  assert.equal(squareLog(h, 'tokenize').length, 2, 'a fresh token each time');
  const tries = posts(h, '/square/packs/checkout');
  assert.equal(tries.length, 2);
  assert.ok(tries[0].body.attempt_id, 'the first try names its attempt');
  assert.equal(tries[1].body.attempt_id, tries[0].body.attempt_id, 'Try again keeps the same attempt, so a charge Square already took is never repeated');
  assert.match(packClass(h, 'annual-lead').textContent, /^3 walkthroughs added; 3 available/);
});

test('each refusal made before a payment says nothing was charged; the card field and Try again stay', async () => {
  const sentences = {
    not_eligible: [403, 'Packs aren’t available for this workspace right now, so nothing was charged.'],
    lane_closed: [503, 'Card payment for packs is closed right now, so nothing was charged.'],
    invalid_request: [400, 'The purchase wasn’t accepted, so nothing was charged. Try again.'],
  };
  for (const [code, [status, sentence]] of Object.entries(sentences)) {
    const h = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': () => [status, { error: code }] } });
    await pressPack(h, 'Buy 3 walkthroughs');
    await pressPack(h, 'Pay A$169');
    assert.equal(packProblem(h), sentence, code);
    assert.ok(packClass(h, 'annual-card-field'), `${code} keeps the card field`);
    assert.deepEqual(packFilled(h).map(el => el.textContent), ['Try again'], code);
    assert.equal(h.reads(), 1, `${code} is certain, so the balance is not re-read`);
  }
});

test('an unconfirmed purchase never claims nothing was charged; it re-reads the balance in place and keeps the card field', async () => {
  for (const route of [() => [502, { error: 'checkout_failed' }], 'reject', () => [200, { receipt: 'unreadable' }], () => [500, { error: 'server_error' }]]) {
    const h = await withPacks([packOffer(), packOffer({ credits_available: 3, next_expiry: '2027-09-24' })], { hooks: { '/square/packs/checkout': route } });
    await pressPack(h, 'Buy 3 walkthroughs');
    const field = packClass(h, 'annual-card-field');
    await pressPack(h, 'Pay A$169');
    assert.equal(packProblem(h), 'We couldn’t confirm the purchase. If your card was charged, the walkthroughs are added when the payment clears. Check the count above in a few minutes before you try again.');
    assert.doesNotMatch(packText(h), /nothing was charged/i);
    assert.equal(packClass(h, 'annual-card-field'), field, 'Square’s field was not redrawn');
    assert.equal(h.reads(), 2, 'the balance is read again');
    assert.equal(packClass(h, 'packs-balance').textContent, '3 extra walkthroughs available; the next expiry is 24 September 2027.');
    assert.deepEqual(packFilled(h).map(el => el.textContent), ['Try again']);
  }
});

test('card details Square cannot use, an expired session and a missing token send nothing to the checkout', async () => {
  const declined = await withPacks(packOffer(), { squareOptions: { tokenize: () => ({ status: 'Invalid', errors: [{ field: 'cardNumber' }] }) } });
  await pressPack(declined, 'Buy 3 walkthroughs');
  await pressPack(declined, 'Pay A$169');
  assert.equal(packProblem(declined), 'Square couldn’t use those card details. Check them and try again. Nothing was charged.');
  assert.equal(posts(declined, '/square/packs/checkout').length, 0);
  assert.ok(packClass(declined, 'annual-card-field'));
  const expired = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': () => [401, { error: 'unauthorized' }] } });
  await pressPack(expired, 'Buy 3 walkthroughs');
  await pressPack(expired, 'Pay A$169');
  assert.equal(expired.ids['account-home'].hidden, true);
  assert.match(expired.ids['account-status'].textContent, /sign-in has expired\. Sign in again to buy a pack\. Nothing was charged\./);
  assert.equal(packsCard(expired).hidden, true);
  assert.equal(squareLog(expired, 'destroy').length, 1, 'Square’s field is let go');
  const tokenless = await withPacks(packOffer(), { accessToken: null });
  await pressPack(tokenless, 'Buy 3 walkthroughs');
  await pressPack(tokenless, 'Pay A$169');
  assert.equal(posts(tokenless, '/square/packs/checkout').length, 0, 'no request without a bearer token');
});

test('card lane closed: the packs as statements, “opens soon” and the studio invoice route, with nothing filled', async () => {
  const h = await withPacks(packOffer(), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.match(packText(h), /Card payment for packs opens soon\./);
  assert.deepEqual(packAll(h, 'annual-amount').map(el => el.textContent), ['A$169', 'A$499']);
  assert.deepEqual(packNodes(h).filter(el => el.tagName === 'A').map(link => [link.textContent, link.href]),
    [['Ask Veylet support to invoice a pack', 'mailto:yoda@yodalai.xyz?subject=Veylet%20walkthrough%20pack']]);
  assert.equal(packNodes(h).some(el => ['BUTTON', 'INPUT'].includes(el.tagName)), false);
  assert.equal(packFilled(h).length, 0);
});

test('an unreadable pack answer or lane is an error with Try again; a missing function or workspace shows no card', async () => {
  const h = await withPacks([() => ({ error: { message: 'offline' } }), packOffer()]);
  assert.equal(packClass(h, 'annual-lead').textContent, 'Couldn’t check walkthrough packs.');
  assert.match(packText(h), /Nothing has changed, and your plan above is not affected\./);
  assert.doesNotMatch(packText(h), /A\$/);
  assert.equal(packFilled(h).length, 0);
  await pressPack(h, 'Try again');
  assert.equal(h.reads(), 2);
  assert.ok(packButton(h, 'Buy 3 walkthroughs'), 'the second answer is shown');
  assert.equal(packClass(h, 'annual-title').wasFocused, true);
  const broken = [
    packOffer({ packs: [{ code: 'pack3', walkthroughs: 4, price_cents: 16900 }] }),
    packOffer({ packs: [{ code: 'pack5', walkthroughs: 5, price_cents: 20000 }] }),
    packOffer({ packs: [PACKS[0], PACKS[0]] }),
    packOffer({ packs: [{ ...PACKS[0], price_cents: '169' }] }),
    packOffer({ packs: [] }),
    packOffer({ missing: ['not_owner'] }),
    packOffer({ available: false, missing: [] }),
    packOffer({ missing: ['something_else'], available: false }),
    packOffer({ credits_available: -1 }),
    packOffer({ next_expiry: '02/03/2027' }),
    'receipt',
  ];
  for (const offer of broken) {
    const bad = await withPacks(offer);
    assert.match(packText(bad), /Couldn’t check walkthrough packs\./, JSON.stringify(offer).slice(0, 90));
  }
  const noLane = await withPacks(packOffer(), { hooks: { '/square/lane': 'reject' } });
  assert.match(packText(noLane), /Couldn’t check walkthrough packs\./);
  const lockedNoLane = await withPacks(packLocked(['not_owner']), { hooks: { '/square/lane': 'reject' } });
  assert.match(packText(lockedNoLane), /Only the workspace owner can buy walkthrough packs\./);
  const missing = await withPacks(() => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }));
  assert.equal(packsCard(missing).hidden, true);
  const none = await load({ tables: { memberships: { data: [] } } });
  await settle();
  assert.equal(packsCard(none).hidden, true);
  assert.equal(none.calls.some(call => call[0] === 'get_pack_offer'), false);
});

test('Square Sandbox labels every pack price and payment action Test, before and after paying', async () => {
  const sandbox = { '/square/lane': () => [200, { open: true, sandbox: true, card_form: CARD_FORM }],
    '/square/packs/checkout': body => boughtAnswer(body, { sandbox: true }) };
  const h = await withPacks(packOffer(), { hooks: sandbox });
  assert.deepEqual(packAll(h, 'annual-amount').map(el => el.textContent), ['Test · A$169', 'Test · A$499']);
  assert.equal(packClass(h, 'annual-charge').textContent, 'Test · Charged today: A$169 for 3 walkthroughs, to use within 12 months.');
  assert.deepEqual(packFilled(h).map(el => el.textContent), ['Test · Buy 3 walkthroughs']);
  assert.match(packText(h), /Square Sandbox: a test payment, not a live charge\./);
  await pressPack(h, 'Test · Buy 3 walkthroughs');
  assert.deepEqual(packFilled(h).map(el => el.textContent), ['Test · Pay A$169']);
  await pressPack(h, 'Test · Pay A$169');
  assert.match(packClass(h, 'annual-lead').textContent, /^Test · 3 walkthroughs added;/);
  assert.equal(packClass(h, 'annual-charge').textContent, 'Test · A$169 charged today.');
  assert.match(packText(h), /Square Sandbox: a test payment, not a live charge\./);
  // The answer's own sandbox flag labels the result even if the lane said nothing.
  const flagged = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': body => boughtAnswer(body, { sandbox: true }) } });
  await pressPack(flagged, 'Buy 3 walkthroughs');
  await pressPack(flagged, 'Pay A$169');
  assert.match(packClass(flagged, 'annual-lead').textContent, /^Test · /);
  const live = await withPacks(packOffer());
  assert.doesNotMatch(packText(live), /Test|Sandbox/);
});

test('every pack state has at most one filled action, and none promises that nothing is charged', async () => {
  const states = [
    [packLocked(['not_activated']), 0],
    [packLocked(['not_owner']), 0],
    [packOffer(), 1],
    [packOffer({ credits_available: 4, next_expiry: '2027-01-10' }), 1],
    [() => ({ error: { message: 'offline' } }), 0],
  ];
  for (const [offer, filled] of states) {
    const h = await withPacks(offer);
    assert.equal(packFilled(h).length, filled, packText(h).slice(0, 120));
    assert.doesNotMatch(packText(h), NO_CHARGE_PROMISE);
  }
  const open = await withPacks(packOffer());
  await pressPack(open, 'Buy 3 walkthroughs');
  assert.equal(packFilled(open).length, 1, 'the card form has one filled action');
  assert.doesNotMatch(packText(open), NO_CHARGE_PROMISE);
  await pressPack(open, 'Pay A$169');
  assert.equal(packFilled(open).length, 0, 'bought: nothing filled');
});

test('truth check: the pack’s price and walkthrough count read the same in the choice, on both buttons, beside them and when bought', async () => {
  for (const pack of PACKS) {
    const h = await withPacks(packOffer());
    if (pack.code !== 'pack3') await choosePack(h, pack.code);
    const option = packRadio(h, pack.code).checked && packAll(h, 'annual-option-body')[PACKS.indexOf(pack)];
    const optionCount = Number(option.all().find(el => el.className === 'annual-option-name').textContent.match(/^(\d+) walkthroughs$/)[1]);
    const optionPrice = option.all().find(el => el.className === 'annual-amount').textContent;
    const buy = packFilled(h)[0].textContent.match(/^Buy (\d+) walkthroughs$/);
    const before = packClass(h, 'annual-charge').textContent.match(/^Charged today: (A\$[\d,]+) for (\d+) walkthroughs, to use within 12 months\.$/);
    await pressPack(h, buy[0]);
    const pay = packFilled(h)[0].textContent.match(/^Pay (A\$[\d,]+)$/);
    const beside = packClass(h, 'annual-charge').textContent.match(/^Charged today: (A\$[\d,]+) for (\d+) walkthroughs/);
    await pressPack(h, pay[0]);
    const lead = packClass(h, 'annual-lead').textContent.match(/^(\d+) walkthroughs added; (\d+) available; use by (.+)\.$/);
    const charged = packClass(h, 'annual-charge').textContent.match(/^(A\$[\d,]+) charged today\.$/);
    const price = 'A$' + (pack.price_cents / 100).toLocaleString('en-AU');
    assert.deepEqual([optionPrice, before[1], pay[1], beside[1], charged[1]], [price, price, price, price, price], pack.code + ' price');
    assert.deepEqual([optionCount, Number(buy[1]), Number(before[2]), Number(beside[2]), Number(lead[1])],
      Array(5).fill(pack.walkthroughs), pack.code + ' walkthroughs');
    assert.equal(posts(h, '/square/packs/checkout')[0].body.pack_code, pack.code);
    assert.equal(lead[3], useBy());
    assert.equal(packClass(h, 'annual-notice'), undefined, 'nothing differs, so nothing is flagged');
  }
  // When the server's terms differ from what was shown, its terms are stated, and said to differ.
  const moved = await withPacks(packOffer(), { hooks: { '/square/packs/checkout': () => [200, { credited: 10, credits_available: 10, amount_cents: 49900, sandbox: false }] } });
  await pressPack(moved, 'Buy 3 walkthroughs');
  await pressPack(moved, 'Pay A$169');
  assert.match(packClass(moved, 'annual-lead').textContent, /^10 walkthroughs added; 10 available;/);
  assert.equal(packClass(moved, 'annual-charge').textContent, 'A$499 charged today.');
  assert.match(packClass(moved, 'annual-notice').textContent, /they differ from what was shown before you paid/);
});

test('one card form on the desk at a time: opening packs closes the yearly form, and the other way round', async () => {
  const h = await withAnnual(renewalOff(), { rpc: { get_pack_offer: async () => ({ data: packOffer() }) } });
  await press(h, 'Pay yearly by card');
  assert.ok(annualClass(h, 'annual-card-field'));
  await pressPack(h, 'Buy 3 walkthroughs');
  assert.equal(annualClass(h, 'annual-card-field'), undefined, 'the yearly form closed');
  assert.ok(annualButton(h, 'Pay yearly by card'));
  assert.ok(packClass(h, 'annual-card-field'));
  assert.equal(squareLog(h, 'destroy').length, 1);
  await press(h, 'Pay yearly by card');
  assert.equal(packClass(h, 'annual-card-field'), undefined, 'the pack form closed');
  assert.ok(packButton(h, 'Buy 3 walkthroughs'));
  assert.equal(squareLog(h, 'destroy').length, 2);
  assert.equal([...annualFilled(h), ...packFilled(h)].filter(el => /^(?:Confirm yearly plan|Pay A\$)/.test(el.textContent)).length, 1);
});

test('signing out hides walkthrough packs and lets go of Square’s card field', async () => {
  const h = await withPacks(packOffer());
  await pressPack(h, 'Buy 3 walkthroughs');
  h.supabase.auth.callback('SIGNED_OUT', null);
  await settle();
  assert.equal(packsCard(h).hidden, true);
  assert.equal(packsCard(h).children.length, 0);
  assert.equal(squareLog(h, 'destroy').length, 1);
});

/* ---- Your plan, tightened (design pass, 24 September 2026) ----------------
 * The panel says what matters first: the state, the rows, the sentence, then
 * what is left, then how the plan is managed and its links. Sandbox reads the
 * same "Test ·" way on the plan and on both cards, said once under each heading.
 */
test('what is left follows the sentence, then how the plan is managed, then its links, with nothing said twice', async () => {
  const h = await withCapacity(capacityRow);
  const parts = h.ids['account-plan-body'].children;
  assert.deepEqual(parts.map(el => el.className), ['plan-title', 'leaving-list plan-list', 'plan-body', 'plan-capacity', 'plan-scope', 'tour-actions-row plan-actions']);
  const capacity = parts[3];
  assert.deepEqual(capacity.children.map(el => el.className), ['plan-allowance', 'plan-scope']);
  assert.equal(capacity.children[0].textContent, '4 included walkthroughs remaining · 0 extra walkthroughs available.');
  // The count line is rewritten in place when the ledger answers, never shown twice.
  assert.equal(h.ids['account-plan-body'].all().filter(el => el.className === 'plan-allowance').length, 1);
  // With walkthroughs left, the packs card below is the pointer to packs; the panel does not repeat it.
  assert.doesNotMatch(planText(h), /Need more walkthroughs|Ask about another walkthrough/);
  const prose = h.ids['account-plan-body'].all().filter(el => el.tagName === 'P' && !/plan-title|plan-actions/.test(el.className));
  assert.ok(prose.length <= 4, 'at most four short paragraphs: ' + prose.map(el => el.className).join(', '));
  // Used up: the pack is the next step, so the panel names it and the studio link returns.
  const used = await withCapacity({ ...capacityRow, included_used: 6, included_remaining: 0, can_accept: false, reason_code: 'allowance_exhausted' }, { accepted_in_free_months: 6 });
  assert.match(capacityText(used), /a walkthrough pack adds more/);
  assert.ok(planLinks(used).includes('mailto:yoda@yodalai.xyz?subject=Veylet%20walkthrough%20capacity'));
});

test('Sandbox reads “Test ·” on the plan and on both cards, said once under each heading', async () => {
  const plan = await withPlan({ source: 'apple', apple_environment: 'Sandbox', apple_verified: true, status: 'active',
    apple_product_id: 'dev.property3d.capture.solo.monthly', current_period_ends_at: '2026-10-01T00:00:00Z' });
  assert.equal(planTitle(plan), 'Test · Veylet plan · A$119.99 a month');
  assert.equal(plan.ids['account-plan-body'].children[1].textContent, 'Test · App Store Sandbox: a test subscription, not a live payment.');
  const lane = { '/square/lane': () => [200, { open: true, sandbox: true, card_form: CARD_FORM }] };
  const packs = await withPacks(packOffer(), { hooks: lane });
  assert.equal(packsCard(packs).children[1].textContent, 'Test · Square Sandbox: a test payment, not a live charge.');
  const annual = await withAnnual(renewalOff(), { hooks: lane });
  assert.equal(annualCard(annual).children[1].textContent, 'Test · Square Sandbox: a test checkout, not a live payment.');
  for (const [name, words] of [['plan', planText(plan)], ['packs', packText(packs)], ['annual', annualText(annual)]]) {
    assert.doesNotMatch(words, /Sandbox purchase|Test purchase|Test subscription ·/, `${name} uses one Sandbox wording`);
    assert.equal(words.split(/Sandbox:/).length - 1, 1, `${name} says Sandbox once`);
    // Every "Test" label leads its line.
    for (const line of words.split('\n').filter(entry => /\bTest\b/.test(entry) && !/Test subscription$/.test(entry))) assert.match(line, /^Test · /, `${name}: ${line}`);
  }
});

/* ---- Corrections on one walkthrough (20260924140000) -------------------
 * A correction the studio recorded is a later version of the same walkthrough.
 * The desk reads each tour's walkthrough and version, lists only versions no
 * later approval replaced, keeps one walkthrough's versions together, and asks
 * the server how approving a later version counts before saying so.
 */
const W1 = '1a2b3c4d-0000-4000-8000-000000000001', W2 = '5e6f7a8b-0000-4000-8000-000000000002', W3 = '7a8b9c0d-0000-4000-8000-000000000005';
const OTHER = '2b3c4d5e-0000-4000-8000-000000000003';
const version = (id, revision, extra = {}) => ({ ...tour, id, storage_path: 'w1/' + id + '/package.zip', walkthrough_id: W1, revision,
  revision_of: revision > 1 ? W1 : null, superseded_at: null, ...extra });
const lineage = (overrides = {}) => ({ tour_id: W2, walkthrough_id: W1, revision: 2, revision_of: W1, superseded_at: null,
  correction_reason: 'requested_change', walkthrough_accepted: true, approval_uses_allowance: false, link_moves_on_approval: true, ...overrides });
const itemOf = (h, id) => h.all().find(el => el.tagName === 'LI' && el.dataset.tour === id);
const tourItems = h => h.all().filter(el => el.tagName === 'LI' && /\bdash-tour\b/.test(el.className || ''));
const itemText = item => item.all().filter(el => !el.hidden).map(el => el.textContent).filter(Boolean).join('\n');
const correctionNote = h => (h.all().find(el => (el.className || '').includes('tour-correction')) || {}).textContent;
const LINEAGE_SENTENCE = 'This is a correction of walkthrough 1a2b3c4d. Approving it uses no walkthrough from your allowance, and your existing link and embed will show this version.';

test('the tour list asks for each tour’s walkthrough and version, and lists no version a later one replaced', async () => {
  const h = await load({ tours: [version(W2, 2, { share_token: TOKEN }), version(W1, 1, { superseded_at: '2026-09-20T01:00:00Z' })], approved: true });
  const [, columns] = h.selects.find(([name]) => name === 'tours');
  for (const column of ['id', 'status', 'share_token', 'storage_path', 'walkthrough_id', 'revision', 'revision_of', 'superseded_at']) {
    assert.ok(columns.split(',').includes(column), column);
  }
  const items = tourItems(h);
  assert.equal(items.length, 1, 'the replaced version is not listed');
  assert.deepEqual(items[0].children[0].children.map(el => el.textContent), ['Live', 'Correction']);
  assert.match(itemText(items[0]), /^Version 2 of walkthrough 1a2b3c4d\.$/m);
  assert.ok(items[0].all().some(el => el.textContent === 'Copy link'), 'the current version carries the link');
  // The records file still lists the replaced version, marked as replaced.
  await h.ids['account-export'].fire('click');
  const records = JSON.parse(h.exported[0].parts.join(''));
  assert.deepEqual(records.spaces[0].tours.map(row => [row.id, row.walkthrough_id, row.version, Boolean(row.replaced_at)]),
    [[W2, W1, 2, false], [W1, W1, 1, true]]);
});

test('a database without the lineage columns still lists every tour as its own walkthrough', async () => {
  const h = await load({ tours: [], tables: { tours: columns => /walkthrough_id/.test(columns)
    ? { error: { code: '42703', message: 'column tours.walkthrough_id does not exist' } } : { data: [{ ...tour }] } } });
  assert.deepEqual(h.selects.filter(([name]) => name === 'tours').map(([, columns]) => /walkthrough_id/.test(columns)), [true, false]);
  assert.doesNotMatch(h.text(), /Tour status could not load/);
  assert.equal(tourItems(h).length, 1);
  assert.doesNotMatch(h.text(), /Version \d|Correction/);
  assert.ok(h.all().some(el => el.textContent === 'Review this walkthrough'));
  assert.equal(h.calls.some(([name]) => name === 'get_walkthrough_revision'), false);
});

test('one walkthrough’s versions sit together, newest first, and the version a correction replaces says so', async () => {
  const other = { ...tour, id: OTHER, storage_path: 'w1/other/package.zip', walkthrough_id: OTHER, revision: 1, revision_of: null, superseded_at: null };
  const h = await load({ tours: [version(W2, 2), other, version(W1, 1, { share_token: TOKEN })],
    rpc: { get_tour_review: async args => ({ data: [{ approved: args.p_tour_id === W1 }] }), get_walkthrough_revision: async () => ({ data: [lineage()] }) } });
  const items = tourItems(h);
  assert.deepEqual(items.map(item => [W2, W1, OTHER].find(id => item === itemOf(h, id))), [W2, W1, OTHER]);
  assert.match(itemText(items[0]), /Version 2 of walkthrough 1a2b3c4d\./);
  assert.match(itemText(items[1]), /Version 1 of walkthrough 1a2b3c4d\. Version 2 replaces it once you approve that version\./);
  assert.match(items[1].className, /\bdash-tour-earlier\b/);
  assert.doesNotMatch(items[0].className, /dash-tour-earlier/);
  // A walkthrough with one version says nothing about versions.
  assert.doesNotMatch(itemText(items[2]), /Version/);
});

test('a correction’s review says how approving it counts, from the server’s answer only', async () => {
  const h = await load({ tours: [version(W2, 2), version(W1, 1)], rpc: { get_walkthrough_revision: async () => ({ data: [lineage()] }) } });
  assert.deepEqual(h.calls.filter(([name]) => name === 'get_walkthrough_revision').map(([, args]) => ({ ...args })), [{ p_tour_id: W2 }],
    'asked for the later version only');
  assert.equal(correctionNote(h), LINEAGE_SENTENCE);
  const words = async answer => correctionNote(await load({ tours: [version(W2, 2)], rpc: { get_walkthrough_revision: async () => answer } }));
  assert.equal(await words({ data: [lineage({ link_moves_on_approval: false })] }),
    'This is a correction of walkthrough 1a2b3c4d. Approving it uses no walkthrough from your allowance. It has no live link now, so approving it also turns sharing on.');
  assert.equal(await words({ data: [lineage({ approval_uses_allowance: true, walkthrough_accepted: false, link_moves_on_approval: false })] }),
    'This is a correction of walkthrough 1a2b3c4d. That walkthrough hasn’t been accepted yet, so approving this version uses one walkthrough from your allowance; later corrections of it use none.');
  // Unanswered or unreadable: nothing is claimed about the allowance, and the review stays available.
  for (const answer of [{ error: { message: 'offline' } }, { data: [lineage({ tour_id: W1 })] }, { data: [{ tour_id: W2 }] }]) {
    const unread = await load({ tours: [version(W2, 2)], rpc: { get_walkthrough_revision: async () => answer } });
    assert.equal(correctionNote(unread), 'This is a correction of walkthrough 1a2b3c4d. Whether approving it uses your allowance couldn’t be checked. Refresh to check before you approve it.');
    assert.ok(unread.all().some(el => el.textContent === 'Approve and share'));
  }
});

test('approving a correction reads the desk again and says the existing link now shows it', async () => {
  let approved = false;
  const h = await load({ tours: [], tables: { tours: () => ({ data: approved
      ? [version(W2, 2, { share_token: TOKEN }), version(W1, 1, { superseded_at: '2026-09-24T01:00:00Z' })]
      : [version(W2, 2), version(W1, 1, { share_token: TOKEN })] }) },
    rpc: { get_walkthrough_revision: async () => ({ data: [lineage()] }),
      get_tour_review: async args => ({ data: [{ approved: args.p_tour_id === W1 ? !approved : approved }] }),
      review_tour_versioned: async () => { approved = true; return { data: [{ approved: true }] }; } } });
  const form = itemOf(h, W2).all().find(el => el.tagName === 'FORM');
  form.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  const before = h.queries.filter(name => name === 'tours').length;
  await form.fire('submit');
  await settle();
  assert.equal(h.queries.filter(name => name === 'tours').length, before + 1, 'the desk is read again');
  assert.equal(tourItems(h).length, 1);
  assert.match(rowStatus(h), /^Approved\. Your existing link and embed now show this version\.$/m);
  assert.ok(h.all().some(el => el.textContent === 'Copy link'));
});

test('a version replaced meanwhile is not approved: the desk reloads and says so on the current version', async () => {
  let replaced = false;
  const h = await load({ tours: [], tables: { tours: () => ({ data: replaced
      ? [version(W3, 3, { revision_of: W2, share_token: TOKEN }), version(W2, 2, { superseded_at: '2026-09-24T01:00:00Z' }), version(W1, 1, { superseded_at: '2026-09-24T01:00:00Z' })]
      : [version(W2, 2), version(W1, 1, { share_token: TOKEN })] }) },
    rpc: { get_walkthrough_revision: async args => ({ data: [lineage({ tour_id: args.p_tour_id })] }),
      get_tour_review: async args => ({ data: [{ approved: replaced ? args.p_tour_id === W3 : args.p_tour_id === W1 }] }),
      review_tour_versioned: async () => { replaced = true;
        return { error: { code: 'P0001', message: 'A newer revision of this walkthrough is approved; review that revision instead.', details: 'VEYLET_REVISION_SUPERSEDED' } }; } } });
  const form = itemOf(h, W2).all().find(el => el.tagName === 'FORM');
  form.all().filter(el => el.type === 'checkbox').forEach(el => { el.checked = true; });
  await form.fire('submit');
  await settle();
  const said = 'A newer version of this walkthrough was approved, so this version was not. Your walkthroughs have been reloaded to show the current one.';
  assert.equal(h.ids['account-status'].textContent, said);
  assert.equal(tourItems(h).length, 1);
  assert.equal(itemOf(h, W2), undefined);
  assert.match(itemText(tourItems(h)[0]), /Version 3 of walkthrough 1a2b3c4d\./);
  assert.equal(rowStatus(h), said, 'the reason stays on the walkthrough’s current version');
  assert.equal(h.all().some(el => el.textContent === 'Start a fresh review'), false);
});

test('a correction the server already reports as replaced offers a reload, not a review form', async () => {
  const h = await load({ tours: [version(W2, 2)], rpc: { get_walkthrough_revision: async () => ({ data: [lineage({ superseded_at: '2026-09-24T01:00:00Z', link_moves_on_approval: false })] }) } });
  assert.match(h.text(), /A newer version of this walkthrough was approved and replaced this one\. Reload to see the current version\./);
  assert.equal(h.all().some(el => el.tagName === 'FORM' && el.children.some(child => child.textContent === 'Approve and share')), false);
  const reload = h.all().find(el => el.tagName === 'BUTTON' && el.textContent === 'Reload walkthroughs');
  const before = h.queries.filter(name => name === 'tours').length;
  await reload.fire('click');
  assert.equal(h.queries.filter(name => name === 'tours').length, before + 1);
});

test('the corrections email names the walkthrough and version, so the studio records it against the right one', async () => {
  const h = await load({ tours: [version(W2, 2)], rpc: { get_walkthrough_revision: async () => ({ data: [lineage()] }) } });
  const link = h.all().find(el => el.textContent === 'Request corrections by email');
  await link.fire('click');
  const [head, query] = link.href.split('?');
  assert.equal(head, 'mailto:yoda@yodalai.xyz');
  const params = new URLSearchParams(query.replace(/\+/g, '%2B'));
  assert.equal(params.get('subject'), 'Veylet corrections · walkthrough 1a2b3c4d');
  assert.match(params.get('body'), /^Walkthrough reference: 1a2b3c4d\nVersion: 2\nTour reference: 5e6f7a8b\n/);
  // A first version names itself as its own walkthrough.
  const first = await load({ tours: [tour] });
  const firstLink = first.all().find(el => el.textContent === 'Request corrections by email');
  await firstLink.fire('click');
  assert.match(decodeURIComponent(firstLink.href.split('&body=')[1]), /^Walkthrough reference: t1\nVersion: 1\nTour reference: t1\n/);
});

test('a link to a version that was replaced selects its walkthrough’s current version and says why', async () => {
  const h = await load({ search: '?tour=' + W1, tours: [version(W2, 2, { share_token: TOKEN }), version(W1, 1, { superseded_at: '2026-09-20T01:00:00Z' })], approved: true });
  const selected = h.all().find(el => el.id === 'requested-tour');
  assert.equal(selected, itemOf(h, W2));
  assert.match(itemText(selected), /A newer version of this walkthrough replaced the one in your link\. This is the current version\./);
  assert.equal(h.ids['account-target-status'].textContent, 'A newer version of the walkthrough from your capture replaced it. The current version is selected below.');
  assert.doesNotMatch(h.text(), /not available in this account/);
});

/* ---- Members' annual: a failed first charge (20260924130000) ------------ */
const failedStart = (overrides = {}) => annualOffer({ source: 'studio', plan_status: 'ended', apple_auto_renews: null, apple_in_free_trial: null,
  starts_on: brisbaneToday(), can_start_now: true, free_walkthroughs_remaining: 0,
  start_failed: { plan_code: 'solo', year_cents: 99000, starts_on: '2026-09-01', failed_at: '2026-09-01T00:12:00Z', retrying: false, ...overrides } });
const startedToday = body => [200, { scheduled: { plan_code: body.plan_code, year_cents: 99000, starts_on: brisbaneToday() }, charge_today: true, sandbox: false }];
const FAILED_ALERT = 'Your first yearly charge of A$990, due 1 September 2026, didn’t go through. Nothing was charged, and your yearly plan hasn’t started.';

test('a failed first yearly charge says so with its price and day, and offers one filled Try another card', async () => {
  const h = await withAnnual(failedStart());
  assert.deepEqual(annualClass(h, 'annual-head').children.map(el => el.textContent), ['Annual plan', 'Charge failed']);
  assert.equal(annualClass(h, 'annual-alert-text').textContent, FAILED_ALERT);
  assert.equal(annualClass(h, 'annual-alert-icon').attributes['aria-hidden'], 'true', 'the mark is not the only signal');
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try another card']);
  assert.ok(annualButton(h, 'Cancel yearly plan'), 'the way out sits beside it');
  assert.equal(annualClass(h, 'annual-actions').children.map(el => el.textContent).join(' | '), 'Try another card | Cancel yearly plan');
  assert.match(annualText(h), /Use another card to start your yearly plan at the same price, or cancel it\./);
  assert.equal(annualClass(h, 'annual-charge').textContent, 'First charge A$990 today, then it renews each year until you cancel.');
  // Same fact, same value: the price in the alert, the statement and the charge line.
  assert.deepEqual([...annualText(h).matchAll(/A\$\d{1,3}(?:,\d{3})*/g)].map(match => match[0]), ['A$990', 'A$990', 'A$990']);
  assert.equal(annualClass(h, 'annual-amount').textContent, 'A$990 a year');
  assert.equal(annualNodes(h).some(el => el.className === 'annual-choice'), false, 'no start choice after a failed start');
  assert.equal(h.scripts.length, 0);
});

test('Try another card takes a new card and restarts the year at the price it was bought at', async () => {
  // The tier moved on to one month free (A$869); the failed start keeps A$990.
  const h = await withAnnual({ ...failedStart(), tier: 'oneMonthFree', plans: annualPlans(1) },
    { hooks: { '/square/members-annual/checkout': startedToday } });
  assert.doesNotMatch(annualText(h), /A\$869/);
  await press(h, 'Try another card');
  assert.ok(annualClass(h, 'annual-card-field'));
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Confirm yearly plan']);
  assert.equal(annualButton(h, 'Cancel yearly plan'), undefined, 'one path while the card is open');
  await press(h, 'Confirm yearly plan');
  const [post] = posts(h, '/square/members-annual/checkout');
  assert.deepEqual(post.body, { workspace_id: 'w1', plan_code: 'solo', start: 'scheduled', source_id: 'cnon:card-nonce-ok' });
  assert.equal(post.auth, 'Bearer token-1');
  assert.equal(annualClass(h, 'annual-lead').textContent, 'Yearly plan starts today.');
  assert.equal(annualClass(h, 'annual-notice'), undefined, 'the terms matched what was shown');
  assert.match(annualText(h), /First charge A\$990 today/);
  assert.doesNotMatch(annualText(h), /didn’t go through/);
});

test('cancelling after a failed charge is confirmed in its own words, then the plan is read again', async () => {
  const h = await withAnnual([failedStart(), renewalOff()]);
  await press(h, 'Cancel yearly plan');
  assert.equal(annualClass(h, 'annual-confirm').textContent,
    'Cancel the yearly plan? Its first charge didn’t go through, so nothing has been charged, and nothing will be. A later yearly plan uses the annual price at that time.');
  const danger = annualButton(h, 'Cancel yearly plan');
  assert.equal(danger.dataset.armed, 'true');
  await press(h, 'Keep yearly plan');
  assert.equal(posts(h, '/square/members-annual/cancel').length, 0);
  assert.equal(annualClass(h, 'annual-alert-text').textContent, FAILED_ALERT);
  await press(h, 'Cancel yearly plan');
  await press(h, 'Cancel yearly plan');
  assert.deepEqual(posts(h, '/square/members-annual/cancel').map(request => request.body), [{ workspace_id: 'w1' }]);
  assert.equal(h.reads(), 2);
  assert.equal(annualClass(h, 'annual-notice').textContent, 'Yearly plan cancelled. Nothing was charged.');
});

test('a retry still waiting on Square says so, and an unconfirmed retry says to wait, never that it charged twice', async () => {
  const h = await withAnnual(failedStart({ retrying: true }), { hooks: { '/square/members-annual/checkout': () => [502, { error: 'checkout_failed' }] } });
  assert.match(annualText(h), /The start that failed is still being stopped at Square\. A new card is used only once it has stopped, so nobody pays twice\./);
  await press(h, 'Try another card');
  await press(h, 'Confirm yearly plan');
  assert.equal(annualProblemText(h), 'The yearly plan wasn’t confirmed. Square may still be stopping the start that failed. Try again in a few minutes: a retry never charges twice.');
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try again']);
  assert.ok(annualClass(h, 'annual-card-field'), 'the card field stays for the retry');
});

test('a declined card is said whole, before or after a failed start, with the card kept for another', async () => {
  const declined = 'Your card was declined, so nothing was charged and the yearly plan hasn’t started. Check the details or use another card, then try again.';
  for (const offer of [renewalOff(), failedStart()]) {
    const h = await withAnnual(offer, { hooks: { '/square/members-annual/checkout': () => [402, { error: 'payment_declined' }] } });
    await press(h, offer.start_failed ? 'Try another card' : 'Pay yearly by card');
    await press(h, 'Confirm yearly plan');
    assert.equal(annualProblemText(h), declined);
    assert.ok(annualClass(h, 'annual-card-field'));
    assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Try again']);
    assert.equal(h.reads(), 1, 'nothing is shown as scheduled');
  }
});

test('a failed start that cannot take a new card here says where to go, and a malformed one is not a price', async () => {
  const team = await withAnnual(failedStart({ plan_code: 'studio', year_cents: 189000 }));
  assert.match(annualText(team), /This yearly plan was for Team, which is no longer sold, so it can’t be restarted with a new card\. Cancel it; nothing is charged\./);
  assert.equal(annualFilled(team).length, 0);
  assert.ok(annualButton(team, 'Cancel yearly plan'));
  assert.equal(annualButton(team, 'Try another card'), undefined);
  const closed = await withAnnual(failedStart(), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.equal(annualClass(closed, 'annual-alert-text').textContent, FAILED_ALERT);
  assert.match(annualText(closed), /Card payment for the annual price is closed right now, so a new card can’t be added here\./);
  assert.deepEqual(annualNodes(closed).filter(el => el.tagName === 'A').map(el => el.href), ['mailto:yoda@yodalai.xyz?subject=Veylet%20yearly%20plan']);
  assert.equal(annualNodes(closed).some(el => el.tagName === 'BUTTON'), false);
  const unread = await withAnnual([failedStart(), failedStart()], { hooks: { '/square/lane': 'reject' } });
  assert.equal(annualClass(unread, 'annual-alert-text').textContent, FAILED_ALERT, 'the failure is named even when the lane is unread');
  assert.match(annualText(unread), /Card payment couldn’t be reached, so a new card can’t be added right now\./);
  await press(unread, 'Check again');
  assert.equal(unread.reads(), 2);
  for (const broken of [failedStart({ retrying: undefined }), failedStart({ year_cents: 0 }), failedStart({ starts_on: '1 Sept' })]) {
    const h = await withAnnual(broken);
    assert.match(annualText(h), /Couldn’t check the annual plan\./);
    assert.doesNotMatch(annualText(h), /A\$/);
  }
});

/* ---- Offer v8 (2026-09-25.1) ---------------------------------------------
 * Three free months with six walkthroughs, the reminder sentence, and what the
 * capacity read appends in migration 20260925100000_offer_v8: allowance_kind,
 * banked_units (inside a monthly plan's included_limit) and bonus_credits_available
 * (inside extra_credits_available). The public A$990 annual plan with its
 * early_annual_bonus, and Refer an office. An answer without a new field reads as
 * today, with no invented line.
 */
const dayOf = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const isoIn = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const allowanceLine = h => (h.ids['account-plan-body'].all().find(el => el.className === 'plan-allowance') || {}).textContent;
const ACTIVE_MONTHLY = { status: 'active', accepted_this_period: 0, current_period_ends_at: '2026-10-01T00:00:00Z' };
// Offer 2026-09-25.2: 2 a month, and up to 4 banked inside this month's limit.
const MONTH_CAP = { ...capacityRow, plan_status: 'active', included_limit: 2, included_used: 0, included_remaining: 2 };
const BANKED_CAP = { ...MONTH_CAP, included_limit: 4, included_remaining: 4, allowance_kind: 'monthly', banked_units: 2, bonus_credits_available: 0 };
const ACTIVE_ANNUAL = { source: 'web', status: 'active', billing_interval: 'annual', renewal_price_aud_cents: 99000,
  accepted_this_period: 0, current_period_ends_at: '2027-07-15T00:00:00Z' };
const POOL_CAP = { ...capacityRow, plan_status: 'active', included_limit: 24, included_used: 5, included_remaining: 19,
  allowance_kind: 'annual_pool', banked_units: 0, bonus_credits_available: 0, allowance_ends_at: '2027-07-15T00:00:00Z' };
const bonusOffer = (overrides = {}) => ({ walkthroughs: 4, express_renders: 4, granted: false, available: true, ...overrides });

test('offer v8: the free months say “Free until {date}, then {price} unless you cancel.” and promise no reminder email', async () => {
  const until = longDate(planRow.trial_ends_at);
  for (const [overrides, price] of [[{}, 'A$99 a month'], [{ source: 'apple', apple_verified: true }, 'A$119.99 a month'],
    [{ source: 'web', billing_interval: 'annual', renewal_price_aud_cents: 99000 }, 'A$990 a year']]) {
    const h = await withPlan(overrides);
    assert.equal(planTitle(h), 'Free until ' + until, 'the heading stays the state');
    const body = h.ids['account-plan-body'].children[2].textContent;
    assert.ok(body.endsWith('Free until ' + until + ', then ' + price + ' unless you cancel.'), body);
    assert.doesNotMatch(planText(h), /remind/i, 'no reminder email is running yet, so none is promised');
  }
  // With no workspace yet, the offer's own default: 3 free months with 6 walkthroughs.
  const none = await load({ tables: { memberships: { data: [] } } });
  assert.match(planText(none), /Eligible subscribers can start with 3 free months and 6 walkthroughs in total\./);
  // No string the desk can show mentions a reminder (comments aside).
  assert.doesNotMatch(account.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /remind/i);
});

test('offer v9: a monthly plan of 2 a month states its banked rollover, up to 4, only when the capacity answer carries it', async () => {
  const h = await withCapacity(BANKED_CAP, ACTIVE_MONTHLY);
  assert.equal(planTitle(h), 'Veylet plan · A$99 a month');
  assert.deepEqual(planTerms(h), ACTIVE_TERMS, 'the ledger keeps its rows');
  assert.equal(planValues(h)[1], '0 of 4 included accepted', 'the bank is part of this month’s limit');
  assert.equal(allowanceLine(h), '4 included walkthroughs remaining · 0 extra walkthroughs available.');
  assert.match(capacityText(h), /This month’s 4 include 2 banked from earlier months\. Unused monthly walkthroughs roll over, up to 4 banked\./);
  assert.doesNotMatch(planText(h), /resets monthly|do not carry over/);
  // Nothing banked yet: the rule, and no count.
  const empty = await withCapacity({ ...BANKED_CAP, included_limit: 2, included_remaining: 2, banked_units: 0 }, ACTIVE_MONTHLY);
  assert.match(capacityText(empty), /Unused monthly walkthroughs roll over, up to 4 banked\./);
  assert.doesNotMatch(capacityText(empty), /banked from earlier/);
  // A full bank of 4 beside this month's 2.
  const full = await withCapacity({ ...BANKED_CAP, banked_units: 4, included_limit: 6, included_remaining: 6 }, ACTIVE_MONTHLY);
  assert.match(capacityText(full), /This month’s 6 include 4 banked from earlier months\. Unused monthly walkthroughs roll over, up to 4 banked\./);
  // Absent or unreadable: today's reading, and no rollover line at all.
  for (const cap of [MONTH_CAP, { ...MONTH_CAP, allowance_kind: 'monthly' }, { ...BANKED_CAP, banked_units: 5, included_limit: 7, included_remaining: 7 },
    { ...BANKED_CAP, banked_units: '2' }, { ...BANKED_CAP, banked_units: 4, included_limit: 4 }, { ...BANKED_CAP, allowance_kind: 'weekly' }]) {
    const today = await withCapacity(cap, ACTIVE_MONTHLY);
    assert.doesNotMatch(planText(today), /banked|roll over|carry/, JSON.stringify(cap).slice(-90));
    assert.match(capacityText(today), /The allowance resets monthly\./);
  }
  // A retired plan's row keeps its own terms: a bank the server reports, but no rollover rule.
  const team = await withCapacity({ ...BANKED_CAP, banked_units: 1, included_limit: 4, included_remaining: 4 }, { ...TEAM, ...ACTIVE_MONTHLY });
  assert.match(capacityText(team), /This month’s 4 include 1 banked from earlier months\./);
  assert.doesNotMatch(capacityText(team), /roll over/);
  // An annual row never reads a monthly rollover, whatever the answer says.
  const annual = await withCapacity(BANKED_CAP, ACTIVE_ANNUAL);
  assert.doesNotMatch(planText(annual), /banked|roll over/);
});

test('offer v9: an annual plan states its yearly pool of 24, the bonus as extra walkthroughs, and the day it resets', async () => {
  const resets = longDate('2027-07-15T00:00:00Z');
  const h = await withCapacity(POOL_CAP, ACTIVE_ANNUAL);
  assert.equal(planTitle(h), 'Veylet plan · A$990 a year');
  assert.deepEqual(planTerms(h), ['State', 'Plan year', 'Renews', 'Hosting', 'Extra walkthroughs', 'Managed in']);
  assert.equal(planValues(h)[1], '5 of 24 included accepted');
  assert.equal(allowanceLine(h), '19 of 24 walkthroughs left this plan year · 0 extra walkthroughs available.');
  assert.ok(capacityText(h).includes('Your 24 walkthroughs are a yearly pool to use any time, with no monthly limit; it resets on ' + resets +
    '. Unused ones do not carry into the next plan year.'), capacityText(h));
  assert.match(planText(h), new RegExp('5 of 24 walkthroughs used this plan year\\. Next billing date: ' + resets + '\\. Hosting included\\. Billed annually\\.'));
  assert.doesNotMatch(planText(h), /this month|resets monthly|banked/);
  // The early-annual bonus: 4 bonus credits beside the pool, 28 walkthroughs this first year in all.
  const bonus = await withCapacity({ ...POOL_CAP, extra_credits_available: 4, bonus_credits_available: 4 }, ACTIVE_ANNUAL);
  assert.equal(allowanceLine(bonus), '19 of 24 walkthroughs left this plan year · 4 extra walkthroughs available, including 4 bonus.');
  assert.equal(planValues(bonus)[4], '4 available');
  // A bonus count the extras cannot hold is not stated.
  const odd = await withCapacity({ ...POOL_CAP, extra_credits_available: 1, bonus_credits_available: 2 }, ACTIVE_ANNUAL);
  assert.doesNotMatch(allowanceLine(odd), /bonus/);
  // No reset day in the answer: the pool without an invented date.
  const undated = await withCapacity({ ...POOL_CAP, allowance_ends_at: null }, ACTIVE_ANNUAL);
  assert.match(capacityText(undated), /Your 24 walkthroughs are a yearly pool to use any time, with no monthly limit\. Unused ones/);
  // Today's server (no kind): the row's own counts, and no pool, reset or monthly reset claimed.
  const today = await withCapacity({ ...capacityRow, plan_status: 'active', included_limit: 1, included_used: 0, included_remaining: 1 }, ACTIVE_ANNUAL);
  assert.deepEqual(planTerms(today), ACTIVE_TERMS);
  assert.doesNotMatch(planText(today), /plan year|yearly pool|resets/);
  // A monthly row is never re-read as a yearly pool.
  const monthly = await withCapacity({ ...MONTH_CAP, allowance_kind: 'annual_pool' }, ACTIVE_MONTHLY);
  assert.doesNotMatch(planText(monthly), /plan year|yearly pool/);
});

test('offer v8: the annual plan opens once the free months have started, with no accepted walkthrough needed', async () => {
  const h = await withAnnual(annualOffer({ source: 'studio', apple_auto_renews: null, apple_in_free_trial: null, free_walkthroughs_remaining: 6 }),
    { plan: { accepted_in_free_months: 0, accepted_total: 0 } });
  assert.equal(annualClass(h, 'annual-title').textContent, 'Annual plan');
  assert.deepEqual(annualAll(h, 'annual-amount').map(el => el.textContent), ['A$990 a year']);
  assert.deepEqual(annualFilled(h).map(el => el.textContent), ['Pay yearly by card']);
  assert.equal(annualAll(h, 'annual-check').length, 0);
  assert.equal(annualAll(h, 'pill').length, 0, 'an open public plan carries no lock state');
  assert.doesNotMatch(annualText(h), /accepted|Locked|Unlocked|unlock/i);
});

test('offer v9: the early-annual bonus, +4 walkthroughs and 4 express renders, is stated only while the answer says it is available, dated by the free months’ end', async () => {
  const ends = isoIn(60);
  const h = await withAnnual(renewalOff({ starts_on: ends, early_annual_bonus: bonusOffer() }));
  assert.equal(annualClass(h, 'annual-bonus').textContent,
    'Choose it before ' + dayOf(ends) + ' and get 4 bonus walkthroughs and 4 super fast renders in your first plan year (28 walkthroughs in total; super fast renders are used on this website).');
  // An older answer without an express count states the walkthroughs alone, never an express render it did not send.
  const older = await withAnnual(renewalOff({ starts_on: ends, early_annual_bonus: bonusOffer({ express_renders: undefined }) }));
  assert.equal(annualClass(older, 'annual-bonus').textContent, 'Choose it before ' + dayOf(ends) + ' and get 4 bonus walkthroughs in your first plan year (28 walkthroughs in total).');
  for (const express of ['4', 0, -1, 25]) {
    const odd = await withAnnual(renewalOff({ starts_on: ends, early_annual_bonus: bonusOffer({ express_renders: express }) }));
    assert.doesNotMatch(annualClass(odd, 'annual-bonus').textContent, /express|super fast/i, String(express));
  }
  const text = annualText(h);
  assert.ok(text.indexOf('2 months free: A$198') < text.indexOf('Choose it before') && text.indexOf('Choose it before') < text.indexOf('App Store renewal is off'),
    'under the price it adds to, before the steps');
  assert.equal(annualFilled(h).length, 1);
  // The same line whatever the lane, including a closed one.
  const closed = await withAnnual(renewalOff({ starts_on: ends, early_annual_bonus: bonusOffer() }), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.ok(annualClass(closed, 'annual-bonus'));
  // Granted, not available, missing or malformed, outside the free months, or no day ahead: no line, and the price is unaffected.
  for (const overrides of [{ early_annual_bonus: bonusOffer({ available: false, granted: true }) }, { early_annual_bonus: bonusOffer({ available: false }) },
    { early_annual_bonus: undefined }, { early_annual_bonus: null }, { early_annual_bonus: bonusOffer({ walkthroughs: '4' }) }, { early_annual_bonus: 'yes' },
    { early_annual_bonus: bonusOffer(), plan_status: 'active' }, { early_annual_bonus: bonusOffer(), starts_on: brisbaneToday() }]) {
    const none = await withAnnual(renewalOff({ starts_on: ends, ...overrides }));
    assert.equal(annualClass(none, 'annual-bonus'), undefined, JSON.stringify(overrides));
    assert.doesNotMatch(annualText(none), /bonus|28 walkthroughs in total|express|super fast/i);
    assert.deepEqual(annualAll(none, 'annual-amount').map(el => el.textContent), ['A$990 a year']);
  }
  // Once a year is scheduled the choice is made, so the bonus is not offered again.
  const scheduled = await withAnnual(renewalOff({ early_annual_bonus: bonusOffer(), scheduled: { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' } }));
  assert.doesNotMatch(annualText(scheduled), /bonus/);
});

test('offer v8: an App Store member moves to the A$990 year by card only once App Store renewal is off', async () => {
  const on = await withAnnual(annualOffer({ early_annual_bonus: bonusOffer() }));
  assert.equal(annualClass(on, 'annual-amount').textContent, 'A$990 a year');
  assert.deepEqual(annualFilled(on).map(el => el.textContent), ['Turn off App Store renewal']);
  assert.equal(annualButton(on, 'Pay yearly by card'), undefined);
  assert.match(annualText(on), /Opens once App Store renewal is off\./);
  const off = await withAnnual(renewalOff({ early_annual_bonus: bonusOffer() }));
  assert.deepEqual(annualAll(off, 'annual-step').map(step => step.dataset.state), ['done', 'active']);
  assert.equal(annualClass(off, 'annual-charge').textContent, 'Nothing is charged today. First charge A$990 on 24 March 2027, then it renews each year until you cancel.');
  await press(off, 'Pay yearly by card');
  await press(off, 'Confirm yearly plan');
  assert.deepEqual(posts(off, '/square/members-annual/checkout')[0].body, { workspace_id: 'w1', plan_code: 'solo', start: 'scheduled', source_id: 'cnon:card-nonce-ok' });
  assert.equal(annualClass(off, 'annual-lead').textContent, 'Yearly plan starts 24 March 2027. Your App Store plan runs until then.');
  // Renewal switched back on after scheduling pauses it, with the one filled action pointing at Apple.
  const paused = await withAnnual(annualOffer({ conflict: true, scheduled: { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' } }));
  assert.deepEqual(annualFilled(paused).map(el => el.textContent), ['Turn off App Store renewal']);
  assert.match(annualText(paused), /We paused your yearly plan, due to start 24 March 2027\. Nothing has been charged\./);
});

test('offer v8: the annual plan is public — no “members” wording in any card state or in the desk’s strings', async () => {
  const scheduled = { plan_code: 'solo', year_cents: 99000, starts_on: '2027-03-24' };
  const states = [annualLocked({ missing: ['free_months_not_started'] }), annualLocked({ missing: ['no_accepted_walkthrough'] }),
    annualLocked({ missing: ['not_owner'] }), annualLocked({ tier: 'closed' }), annualOffer(), renewalOff(), renewalOff({ scheduled }),
    annualOffer({ conflict: true, scheduled }), failedStart(), () => ({ error: { message: 'offline' } }), () => new Promise(() => {})];
  for (const offer of states) {
    const h = await withAnnual(offer);
    assert.doesNotMatch(annualText(h), /\bmembers?\b|members’/i, annualText(h).slice(0, 100));
  }
  const confirm = await withAnnual(renewalOff({ scheduled }));
  await press(confirm, 'Cancel yearly plan');
  assert.doesNotMatch(annualText(confirm), /member/i);
  const refused = await withAnnual(renewalOff(), { hooks: { '/square/members-annual/checkout': () => [403, { error: 'not_eligible' }] } });
  await press(refused, 'Pay yearly by card');
  await press(refused, 'Confirm yearly plan');
  assert.doesNotMatch(annualText(refused), /member/i);
  // Every string the desk can show (comments aside; the RPC and hook names are addresses, not words).
  const code = account.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/get_members_annual_offer|list_workspace_members|\/square\/members-annual\//g, '');
  assert.doesNotMatch(code, /members’|members'|members only|for members/i);
  assert.doesNotMatch(markup, /members’|members only/i);
});

test('offer v9 truth check: A$990 and A$99 read the same in the plan panel and on the annual card, as offer.json states them', async () => {
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/offer/offer.json'), 'utf8'));
  const solo = record.plans.find(entry => entry.code === 'solo');
  assert.deepEqual([YEAR.solo, planRow.price_aud_cents], [solo.annualAud * 100, solo.webAud * 100], 'these answers carry the record’s amounts');
  const h = await withAnnual(annualOffer({ source: 'studio', apple_auto_renews: null, apple_in_free_trial: null, starts_on: '2026-12-01' }));
  const monthly = planText(h).match(/, then (A\$[\d,.]+) a month unless you cancel\./)[1];
  const saving = annualText(h).match(/less than 12 monthly payments of (A\$[\d,.]+)/)[1];
  const amount = annualClass(h, 'annual-amount').textContent.match(/^(A\$[\d,.]+) a year$/)[1];
  const charge = annualClass(h, 'annual-charge').textContent.match(/First charge (A\$[\d,.]+) on (.+?), then/);
  assert.deepEqual([monthly, saving], ['A$99', 'A$99'], 'the monthly price');
  assert.deepEqual([amount, charge[1]], ['A$990', 'A$990'], 'the yearly price');
  // The year starts the day the plan panel says the free months end.
  assert.equal(planTitle(h), 'Free until ' + charge[2]);
  await press(h, 'Pay yearly by card');
  await press(h, 'Confirm yearly plan');
  const scheduled = annualClass(h, 'annual-charge').textContent.match(/First charge (A\$[\d,.]+)/)[1];
  const active = await withAnnual(annualOffer({ source: 'web', plan_status: 'active', active_annual: true }), { plan: ACTIVE_ANNUAL });
  const title = planTitle(active).match(/^Veylet plan · (A\$[\d,.]+) a year$/)[1];
  assert.deepEqual([scheduled, title], ['A$990', 'A$990'], 'the charge that was scheduled is the year the plan panel names');
});

/* ---- Refer an office ----------------------------------------------------
 * The workspace's own code from get_referral_code, shown as the link the website
 * builds from it, with a Copy link that is not a second filled button; words only
 * when the function is missing, refuses or fails. An office that arrived through
 * another office's link (?ref=) records it with claim_workspace_referral.
 */
const REFERRAL_RULE = 'When an office you refer becomes a paying account, you each get 1 bonus walkthrough.';
const REFERRAL_CODE = '7a3f09c2b41e';
const REFERRAL_URL = 'https://veylet.com/account?ref=' + REFERRAL_CODE;
const REFERRED_BY = '0123456789ab';
const RECORD = 'Record the office that referred us';
const referralBlock = h => h.ids['account-referral'];
const referralNodes = h => referralBlock(h).all();
const referralText = h => referralNodes(h).filter(el => !el.hidden).map(el => el.textContent).filter(Boolean).join('\n');
const referralButton = (h, text) => referralNodes(h).find(el => el.tagName === 'BUTTON' && el.textContent === text);
const codeAnswer = (overrides = {}) => ({ data: { code: REFERRAL_CODE, referred_offices: 0, bonus_walkthroughs: 0, ...overrides } });
const withReferral = async (reply, options = {}) => {
  const h = await load({ ...options, rpc: { get_workspace_plan: async () => ({ data: [{ ...planRow, ...options.plan }] }),
    get_referral_code: typeof reply === 'function' ? reply : async () => reply, ...options.rpc } });
  await settle();
  return h;
};
const sessionStore = (entries = {}) => {
  const store = new Map(Object.entries(entries));
  return { store, getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => { store.set(key, String(value)); }, removeItem: key => { store.delete(key); } };
};

test('refer an office: the rule, the link built from the account’s own code, and Copy link as a secondary action announced when done', async () => {
  const h = await withReferral(codeAnswer());
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'get_referral_code')[1] }, { p_workspace_id: 'w1' });
  const block = referralBlock(h);
  assert.equal(block.hidden, false);
  assert.equal(block.attributes['aria-busy'], 'false');
  assert.match(markup, /<section id="account-referral" class="referral-offer" aria-labelledby="account-referral-title" hidden><\/section>/);
  const title = referralNodes(h).find(el => el.tagName === 'H3');
  assert.deepEqual([title.textContent, title.id], ['Refer an office', 'account-referral-title']);
  assert.ok(referralText(h).includes(REFERRAL_RULE));
  const field = referralNodes(h).find(el => el.tagName === 'INPUT');
  assert.deepEqual([field.className, field.readOnly, field.value], ['copy-field', true, REFERRAL_URL]);
  assert.equal(referralNodes(h).find(el => el.tagName === 'LABEL').children[0].textContent, 'Your share link');
  const copy = referralButton(h, 'Copy link');
  assert.equal(copy.className, 'tour-action', 'secondary: the plan’s cards keep their one filled action each');
  assert.equal(referralNodes(h).some(el => /tour-action-primary/.test(el.className || '')), false);
  assert.equal(referralNodes(h).some(el => /referral-tally/.test(el.className || '')), false, 'no counts while there are none');
  await copy.fire('click');
  const said = 'Share link copied. Send it to the office you are referring.';
  assert.equal(h.ids['account-status'].textContent, said, 'the page’s live status announces it');
  const line = referralNodes(h).find(el => el.className === 'referral-said');
  assert.deepEqual([line.textContent, line.hidden], [said, false], 'and the line under the link repeats it');
  // What the link has done so far, as one quiet line.
  const tally = await withReferral(codeAnswer({ referred_offices: 2, bonus_walkthroughs: 1 }));
  assert.equal(referralNodes(tally).find(el => /referral-tally/.test(el.className || '')).textContent, '2 offices referred so far · 1 bonus walkthrough received.');
  // Blocked copying selects the link in its field and says so.
  const blocked = await withReferral(codeAnswer(), { clipboardBlocked: true });
  await referralButton(blocked, 'Copy link').fire('click');
  assert.match(blocked.ids['account-status'].textContent, /Your browser did not allow automatic copying/);
  assert.equal(referralNodes(blocked).find(el => el.tagName === 'INPUT').wasFocused, true);
});

test('refer an office: a missing function, a test workspace, an error or an odd code reads as words, with no link', async () => {
  for (const reply of [{ error: { code: 'PGRST202', message: 'Could not find the function public.get_referral_code' } },
    { error: { code: 'P0001', message: 'test workspaces cannot take part in referrals' } }, { error: { message: 'offline' } },
    { data: [] }, { data: 'receipt' }, { data: { referred_offices: 1 } }, codeAnswer({ code: '7A3F09C2B41E' }), codeAnswer({ code: '7a3f09c2b41' }),
    codeAnswer({ code: '7a3f09c2b41e&x=1' }), codeAnswer({ code: 12345678 })]) {
    const h = await withReferral(reply);
    assert.equal(referralBlock(h).hidden, false, JSON.stringify(reply));
    assert.equal(referralText(h), ['Refer an office', REFERRAL_RULE, 'Your share link appears here once referral links open.'].join('\n'), JSON.stringify(reply));
    assert.equal(referralNodes(h).some(el => ['INPUT', 'BUTTON', 'A'].includes(el.tagName)), false, 'no fake link');
  }
  // The desk's default (this backend has no answer yet) is the same words.
  const plain = await load();
  await settle();
  assert.match(referralText(plain), /Your share link appears here once referral links open\./);
});

test('refer an office: its own rows while the code is on its way; hidden with no workspace, after sign-out and on an expired session', async () => {
  let finish;
  const h = await withReferral(() => new Promise(resolve => { finish = resolve; }));
  const block = referralBlock(h);
  assert.equal(block.hidden, false);
  assert.equal(block.attributes['aria-busy'], 'true');
  assert.ok(referralText(h).startsWith('Refer an office\n' + REFERRAL_RULE));
  const bars = referralNodes(h).filter(el => /\bplan-skeleton\b/.test(el.className || ''));
  assert.ok(bars.length >= 3 && bars.every(bar => bar.attributes['aria-hidden'] === 'true' && /^[n ]+$/.test(bar.textContent || 'n')));
  assert.equal(referralNodes(h).some(el => ['INPUT', 'BUTTON'].includes(el.tagName)), false);
  finish(codeAnswer());
  await settle();
  assert.equal(block.attributes['aria-busy'], 'false');
  assert.equal(referralNodes(h).find(el => el.tagName === 'INPUT').value, REFERRAL_URL);
  h.supabase.auth.callback('SIGNED_OUT', null);
  assert.equal(block.hidden, true);
  assert.equal(block.children.length, 0);
  // A late answer cannot bring it back.
  let late;
  const slow = await withReferral(() => new Promise(resolve => { late = resolve; }));
  slow.supabase.auth.callback('SIGNED_OUT', null);
  late(codeAnswer());
  await settle();
  assert.equal(referralBlock(slow).hidden, true);
  assert.equal(referralBlock(slow).children.length, 0);
  const none = await load({ tables: { memberships: { data: [] } } });
  await settle();
  assert.equal(referralBlock(none).hidden, true);
  assert.equal(none.calls.some(call => call[0] === 'get_referral_code'), false);
  const expired = await withReferral({ error: { code: 'PGRST301', message: 'JWT expired' } });
  assert.equal(expired.ids['account-home'].hidden, true);
  assert.equal(referralBlock(expired).hidden, true);
});

test('referred: signed out, the gate says an office referred you and keeps the code for this session only', async () => {
  const kept = sessionStore();
  const h = await load({ signedOut: true, search: '?ref=' + REFERRED_BY.toUpperCase(), sessionStorage: kept });
  const line = h.ids['account-referred'];
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, 'An office referred you to Veylet. When your office first pays, you and that office each get 1 bonus walkthrough.');
  assert.equal(kept.store.get('veylet-referred-by'), REFERRED_BY, 'kept lower-case, as the server records codes');
  assert.match(markup, /<p class="contact-note" id="account-referred" hidden><\/p>/);
  // No link, an odd code or two codes: no line and nothing kept.
  for (const search of ['', '?ref=0123', '?ref=0123456789az', '?ref=' + REFERRED_BY + '&ref=' + REFERRAL_CODE]) {
    const store = sessionStore();
    const other = await load({ signedOut: true, search, sessionStorage: store });
    assert.equal(other.ids['account-referred'].hidden, true, search);
    assert.equal(store.store.size, 0, search);
  }
  // A browser that refuses storage still shows the line for this page load.
  const refused = await load({ signedOut: true, search: '?ref=' + REFERRED_BY, sessionStorage: 'throw' });
  assert.equal(refused.ids['account-referred'].hidden, false);
  // Signed in, the gate line is gone.
  const signedIn = await withReferral(codeAnswer(), { search: '?ref=' + REFERRED_BY, sessionStorage: sessionStore() });
  assert.equal(signedIn.ids['account-referred'].hidden, true);
});

test('referred: the owner of an office on its free months records the referring office once, in place, and the code is let go', async () => {
  const kept = sessionStore({ 'veylet-referred-by': REFERRED_BY });
  const h = await withReferral(codeAnswer(), { sessionStorage: kept,
    rpc: { claim_workspace_referral: async () => ({ data: { recorded: true, walkthroughs: 1, granted_when: 'first_payment' } }) } });
  assert.match(referralText(h), /An office referred you to Veylet\. Record it before your office first pays, and you and the office that referred you each get 1 bonus walkthrough when it does\./);
  const record = referralButton(h, RECORD);
  assert.equal(record.className, 'tour-action', 'a ghost button: no second filled action');
  assert.equal(h.calls.some(call => call[0] === 'claim_workspace_referral'), false, 'nothing is recorded before the press');
  await record.fire('click');
  await settle();
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'claim_workspace_referral')[1] }, { p_workspace_id: 'w1', p_code: REFERRED_BY });
  const said = referralNodes(h).find(el => el.attributes.role === 'status');
  assert.equal(said.textContent, 'Recorded. When your office first pays, you and the office that referred you each get 1 bonus walkthrough.');
  assert.equal(said.wasFocused, true, 'focus stays in the block when the button goes');
  assert.equal(record.hidden, true);
  assert.equal(kept.store.has('veylet-referred-by'), false);
  // A repeat of the same record answers recorded false.
  const again = await withReferral(codeAnswer(), { search: '?ref=' + REFERRED_BY, sessionStorage: sessionStore(),
    rpc: { claim_workspace_referral: async () => ({ data: { recorded: false, walkthroughs: 1, granted_when: 'first_payment' } }) } });
  await referralButton(again, RECORD).fire('click');
  await settle();
  assert.match(referralText(again), /Already recorded\. When your office first pays/);
  // The claim does not wait on the office's own link: shown even when that function is missing.
  const missing = await withReferral({ error: { code: 'PGRST202' } }, { search: '?ref=' + REFERRED_BY, sessionStorage: sessionStore() });
  assert.ok(referralButton(missing, RECORD));
  assert.match(referralText(missing), /Your share link appears here once referral links open\./);
});

test('referred: each refusal is said in place and lets the code go; an unconfirmed claim keeps it for another try', async () => {
  const refusals = {
    'unknown referral link': 'That referral link isn’t recognised, so nothing was recorded. Ask the office that referred you to send its link again.',
    'an office cannot refer itself': 'An office can’t refer itself, so nothing was recorded.',
    'two offices cannot refer each other': 'Two offices can’t refer each other, so nothing was recorded.',
    'this office already records who referred it': 'Your office already records the office that referred it, so nothing changed.',
    'a referral is recorded before the office first pays; ask the studio': 'A referral is recorded before your office first pays, so nothing was recorded here. Ask Veylet support about it.',
    'only the owner of the new office can record who referred it': 'Only your office’s owner can record who referred it, so nothing was recorded.',
    'test workspaces cannot take part in referrals': 'Test workspaces can’t take part in referrals, so nothing was recorded.',
  };
  for (const [message, words] of Object.entries(refusals)) {
    const kept = sessionStore({ 'veylet-referred-by': REFERRED_BY });
    const h = await withReferral(codeAnswer(), { sessionStorage: kept,
      rpc: { claim_workspace_referral: async () => ({ error: { code: 'P0001', message } }) } });
    await referralButton(h, RECORD).fire('click');
    await settle();
    assert.equal(referralNodes(h).find(el => el.attributes.role === 'status').textContent, words, message);
    assert.equal(kept.store.has('veylet-referred-by'), false, message);
  }
  for (const [reply, words] of [[{ error: { message: 'offline' } }, 'The referral wasn’t confirmed, so nothing changed. Try again.'],
    [{ data: 'receipt' }, 'The referral wasn’t confirmed, so nothing changed. Try again.'],
    [{ error: { code: 'PGRST202', message: 'Could not find the function' } }, 'Recording a referral isn’t available yet, so nothing was recorded. Try again later.']]) {
    const kept = sessionStore({ 'veylet-referred-by': REFERRED_BY });
    const h = await withReferral(codeAnswer(), { sessionStorage: kept, rpc: { claim_workspace_referral: async () => reply } });
    const record = referralButton(h, RECORD);
    await record.fire('click');
    await settle();
    assert.equal(referralNodes(h).find(el => el.attributes.role === 'status').textContent, words);
    assert.equal(kept.store.get('veylet-referred-by'), REFERRED_BY, 'kept for another try');
    assert.deepEqual([record.hidden, record.disabled], [false, false]);
  }
  const expired = await withReferral(codeAnswer(), { sessionStorage: sessionStore({ 'veylet-referred-by': REFERRED_BY }),
    rpc: { claim_workspace_referral: async () => ({ error: { code: 'PGRST301', message: 'JWT expired' } }) } });
  await referralButton(expired, RECORD).fire('click');
  await settle();
  assert.equal(expired.ids['account-home'].hidden, true);
});

test('referred: only the owner, and only before the office pays, is offered the record', async () => {
  const withCode = options => withReferral(codeAnswer(), { sessionStorage: sessionStore({ 'veylet-referred-by': REFERRED_BY }), ...options });
  const owner = await withCode({ plan: { status: 'pending', trial_started_at: null, trial_ends_at: null, accepted_in_free_months: 0 } });
  assert.ok(referralButton(owner, RECORD), 'a pending plan');
  for (const [label, options] of [['an operator', { role: 'operator' }], ['a reviewer', { role: 'reviewer' }],
    ['an active plan', { plan: { status: 'active', current_period_ends_at: '2026-10-01T00:00:00Z' } }],
    ['an ended plan', { plan: { status: 'ended' } }], ['an unreadable plan', { rpc: { get_workspace_plan: async () => ({ error: { message: 'offline' } }) } }]]) {
    const h = await withCode(options);
    assert.equal(referralButton(h, RECORD), undefined, label);
    assert.doesNotMatch(referralText(h), /An office referred you/, label);
  }
  const noCode = await withReferral(codeAnswer(), { sessionStorage: sessionStore() });
  assert.equal(referralButton(noCode, RECORD), undefined, 'no code, nothing to record');
});

/* ---- Offer v9: start the free months with a card on file ------------------
 * Offer 2026-09-25.2. A pending plan that is not Apple's shows Start your free
 * months: both plans from get_trial_offer (proposed name), the first charge day,
 * "Nothing is charged today", the ABN beside its field, and Square's card field
 * from the same loader as the annual plan and packs. POST /square/trial/start
 * (proposed) gets only Square's token, the plan, the ABN and one attempt id; the
 * plan panel then says, once, what the answer said.
 */
const OFFER_RECORD = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/offer/offer.json'), 'utf8'));
const OFFER_SOLO = OFFER_RECORD.plans.find(entry => entry.code === 'solo');
const EXAMPLE_ABN = '51 824 753 556';
const PENDING = { source: null, status: 'pending', trial_started_at: null, trial_ends_at: null, accepted_this_period: 0, accepted_in_free_months: 0, accepted_total: 0 };
const trialOffer = (overrides = {}) => ({ eligible: true, missing: [], months: 3, walkthroughs: 6, first_charge_on: isoIn(91),
  plans: [{ interval: 'monthly', cents: 9900, included: 2 }, { interval: 'annual', cents: 99000, included: 24 }],
  early_annual_bonus: { walkthroughs: 4, express_renders: 4 }, ...overrides });
const trialLocked = missing => ({ eligible: false, missing, plans: [] });
const startedAnswer = (body, offer = trialOffer()) => [200, { trial: { plan_interval: body.plan_interval,
  amount_cents: offer.plans.find(plan => plan.interval === body.plan_interval).cents, first_charge_on: offer.first_charge_on, starts_on: brisbaneToday() },
charged_today: false, sandbox: false }];
async function withTrial(offer, options = {}) {
  const service = hooksService({ '/square/trial/start': body => startedAnswer(body, offer), ...options.hooks });
  const square = options.square === undefined ? fakeSquare(options.squareOptions) : options.square;
  let planReads = 0;
  const started = () => service.requests.some(request => request.path === '/square/trial/start' && request.method === 'POST');
  const h = await load({ ...options, square, fetch: service.fetch, rpc: {
    get_workspace_plan: async () => { planReads += 1;
      return { data: [started() && options.after ? { ...planRow, ...options.after } : { ...planRow, ...PENDING, ...options.plan }] }; },
    get_trial_offer: async () => (typeof offer === 'function' ? offer() : { data: offer }),
    get_members_annual_offer: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }),
    ...options.rpc,
  } });
  await settle();
  return Object.assign(h, { requests: service.requests, square, planReads: () => planReads });
}
const trialCard = h => h.ids['account-trial'];
const trialNodes = h => trialCard(h).all();
const trialText = h => trialNodes(h).filter(el => !el.hidden).map(el => el.textContent).join('\n');
const trialFilled = h => trialNodes(h).filter(el => /\btour-action-primary\b/.test(el.className || ''));
const trialButton = (h, text) => trialNodes(h).find(el => el.tagName === 'BUTTON' && el.textContent === text);
const trialClass = (h, name) => trialNodes(h).find(el => (el.className || '').split(' ').includes(name));
const trialAll = (h, name) => trialNodes(h).filter(el => (el.className || '').split(' ').includes(name));
const trialAbnInput = h => trialNodes(h).find(el => el.tagName === 'INPUT' && el.name === 'abn');
const trialProblem = h => { const box = trialClass(h, 'annual-problem'); return box && !box.hidden ? box.all().find(el => el.className === 'annual-alert-text').textContent : null; };
const pressTrial = async (h, text) => { await trialButton(h, text).fire('click'); await settle(); };
const typeAbn = async (h, value) => { const input = trialAbnInput(h); input.value = value; await input.fire('input'); await input.fire('blur'); };
const chooseTrial = async (h, value) => { const radio = trialNodes(h).find(el => el.tagName === 'INPUT' && el.value === value); radio.checked = true; await radio.fire('change'); };
const ADD_CARD = 'Add a card and start free months';

test('offer v9: a pending plan offers the free months with a card on file: both plans, the first charge day and “Nothing is charged today”', async () => {
  const offer = trialOffer();
  const h = await withTrial(offer);
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'get_trial_offer')[1] }, { p_workspace_id: 'w1' });
  assert.equal(trialCard(h).hidden, false);
  assert.equal(trialClass(h, 'annual-title').textContent, 'Start your free months');
  assert.equal(trialClass(h, 'annual-lead').textContent, '3 free months with 6 walkthroughs. A card on file starts them, and nothing is charged today.');
  assert.deepEqual(trialAll(h, 'annual-amount').map(el => el.textContent), ['A$99 a month', 'A$990 a year']);
  const text = trialText(h);
  for (const line of ['2 walkthroughs a month; unused ones roll over, up to 4 banked', '24 walkthroughs to use any time in the plan year',
    '+4 walkthroughs and 4 super fast renders in your first plan year for choosing it now']) assert.ok(text.includes(line), line);
  const day = dayOf(offer.first_charge_on);
  assert.equal(trialClass(h, 'annual-charge').textContent, 'Nothing is charged today. First charge A$99 on ' + day + ', the day your free months end. Cancel before then and nothing is charged.');
  assert.deepEqual(trialFilled(h).map(el => el.textContent), [ADD_CARD], 'one filled action');
  assert.equal(trialFilled(h)[0].attributes['aria-describedby'], 'account-trial-charge');
  // Choosing annual changes only the words beside the button.
  await chooseTrial(h, 'annual');
  assert.equal(trialClass(h, 'annual-charge').textContent, 'Nothing is charged today. First charge A$990 on ' + day + ', the day your free months end. Cancel before then and nothing is charged.');
  // The same prices as offer.json, and no card field until it is asked for.
  assert.deepEqual([OFFER_SOLO.webAud, OFFER_SOLO.annualAud, OFFER_SOLO.includedPerMonth, OFFER_SOLO.annualIncluded, OFFER_SOLO.rollover.maxBanked],
    [99, 990, 2, 24, 4]);
  assert.equal(h.scripts.length, 0, 'Square’s script loads only when a card is asked for');
  assert.equal(trialNodes(h).some(el => /card-field/.test(el.id || '')), false);
  // The panel above keeps its shared words, and the packs and annual cards still say what they say.
  assert.equal(planTitle(h), 'Plan not started');
});

test('offer v9: the ABN is checked beside its field before the card opens, and what was typed survives the redraw', async () => {
  const h = await withTrial(trialOffer());
  const input = trialAbnInput(h);
  assert.equal(input.attributes['aria-describedby'], 'account-trial-abn-hint');
  assert.equal(trialClass(h, 'trial-abn-label').textContent, 'Your agency’s ABN');
  await pressTrial(h, ADD_CARD);
  assert.equal(h.scripts.length, 0, 'no card form without a valid ABN');
  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.equal(trialClass(h, 'trial-abn-error').hidden, false);
  assert.match(trialClass(h, 'trial-abn-error').textContent, /That isn’t a valid ABN\. Enter your agency’s 11-digit ABN, as shown on ABN Lookup\./);
  assert.equal(input.wasFocused, true);
  await typeAbn(h, '12 345 678 901');
  assert.equal(trialAbnInput(h).attributes['aria-invalid'], 'true', 'eleven digits that fail the check');
  await typeAbn(h, EXAMPLE_ABN);
  assert.equal(trialAbnInput(h).attributes['aria-invalid'], undefined);
  assert.equal(trialClass(h, 'trial-abn-error').hidden, true);
  await pressTrial(h, ADD_CARD);
  assert.deepEqual(squareLog(h, 'attach'), [['attach', '#account-trial-card-field']]);
  assert.equal(trialAbnInput(h).value, EXAMPLE_ABN, 'the ABN is kept when the card field opens');
  assert.deepEqual(trialFilled(h).map(el => el.textContent), ['Start free months']);
  assert.ok(trialButton(h, 'Not now'));
  await pressTrial(h, 'Not now');
  assert.deepEqual(squareLog(h, 'destroy'), [['destroy']]);
  assert.equal(trialAbnInput(h).value, EXAMPLE_ABN);
});

test('offer v9: Start free months sends only Square’s token, the plan, the ABN and one attempt id; the plan panel then says the dates the answer carries', async () => {
  const offer = trialOffer();
  const day = dayOf(offer.first_charge_on);
  const ends = offer.first_charge_on + 'T00:00:00+10:00';
  const h = await withTrial(offer, { after: { source: 'web', status: 'trial', auto_renews: true, accepted_in_free_months: 0,
    trial_started_at: brisbaneToday() + 'T00:00:00+10:00', trial_ends_at: ends, billing_interval: 'monthly' } });
  await typeAbn(h, EXAMPLE_ABN);
  await pressTrial(h, ADD_CARD);
  await pressTrial(h, 'Start free months');
  const [start] = posts(h, '/square/trial/start');
  assert.equal(start.auth, 'Bearer token-1');
  assert.equal(start.credentials, 'omit');
  assert.deepEqual(Object.keys(start.body).sort(), ['abn', 'attempt_id', 'plan_interval', 'source_id', 'workspace_id']);
  assert.deepEqual({ ...start.body, attempt_id: 'id' }, { workspace_id: 'w1', plan_interval: 'monthly', abn: '51824753556', source_id: 'cnon:card-nonce-ok', attempt_id: 'id' });
  assert.match(start.body.attempt_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(JSON.stringify(start.body), /4111|cvc|expiry/i, 'no card data leaves Square’s field');
  await settle();
  // The desk reads the plan again: free months, and the same price and day as the card said.
  assert.equal(h.planReads(), 2);
  assert.equal(trialCard(h).hidden, true, 'the card has done its job');
  const notice = h.ids['account-plan-body'].all().find(el => /plan-notice/.test(el.className || ''));
  assert.equal(notice.textContent, 'Free months started. Nothing was charged today. First charge A$99 on ' + day + ' and A$99 a month after that until you cancel; cancel before then and nothing is charged.');
  assert.equal(notice.wasFocused, true);
  assert.equal(planTitle(h), 'Free until ' + day);
  assert.match(planText(h), new RegExp('Free until ' + day + ', then A\\$99 a month unless you cancel\\.'));
  assert.match(planScopes(h).join(' '), new RegExp('Your card is charged first on ' + day + ', the day your free months end\\. Cancel before then and nothing is charged\\.'));
  // Said once: a later reload does not repeat the notice.
  await h.ids['account-refresh'].fire('click'); await settle();
  assert.equal(h.ids['account-plan-body'].all().some(el => /plan-notice/.test(el.className || '')), false);
});

test('offer v9: a start that is refused or unconfirmed keeps what was typed, says nothing was charged, and a retry keeps its attempt id', async () => {
  // Declined: Square's field stays, with the reason and Try again.
  const declined = await withTrial(trialOffer(), { hooks: { '/square/trial/start': () => [402, { error: 'payment_declined' }] } });
  await typeAbn(declined, EXAMPLE_ABN);
  await pressTrial(declined, ADD_CARD);
  await pressTrial(declined, 'Start free months');
  assert.equal(trialProblem(declined), 'Your card was declined, so nothing was set up and nothing was charged. Check the details or use another card, then try again.');
  assert.deepEqual(trialFilled(declined).map(el => el.textContent), ['Try again']);
  // Unconfirmed: nothing is charged today either way, and the retry is the same intent.
  let replies = 0;
  const lost = await withTrial(trialOffer(), { hooks: { '/square/trial/start': body => (replies++ ? startedAnswer(body) : [502, { error: 'checkout_failed' }]) } });
  await typeAbn(lost, EXAMPLE_ABN);
  await chooseTrial(lost, 'annual');
  await pressTrial(lost, ADD_CARD);
  await pressTrial(lost, 'Start free months');
  assert.equal(trialProblem(lost), 'Your free months weren’t confirmed. Nothing is charged today. Try again: a retry never starts a second trial or charges twice.');
  assert.equal(trialAbnInput(lost).value, EXAMPLE_ABN);
  await pressTrial(lost, 'Try again');
  const tries = posts(lost, '/square/trial/start');
  assert.equal(tries.length, 2);
  assert.equal(tries[0].body.attempt_id, tries[1].body.attempt_id, 'one start intent, one attempt id');
  assert.equal(tries[1].body.plan_interval, 'annual');
  // Refusals the server is sure of: the ABN goes back to its field.
  const abn = await withTrial(trialOffer(), { hooks: { '/square/trial/start': () => [400, { error: 'abn_invalid' }] } });
  await typeAbn(abn, EXAMPLE_ABN);
  await pressTrial(abn, ADD_CARD);
  await pressTrial(abn, 'Start free months');
  assert.equal(trialProblem(abn), 'That ABN wasn’t accepted, so nothing was set up. Check the 11 digits, then try again.');
  assert.equal(trialAbnInput(abn).attributes['aria-invalid'], 'true');
  assert.equal(trialAbnInput(abn).wasFocused, true);
  for (const [code, words] of [['trial_used', /already had its free months, so nothing was set up/], ['lane_closed', /Card sign-up is closed right now, so nothing was set up/],
    ['not_eligible', /Free months aren’t available for this workspace right now/]]) {
    const refused = await withTrial(trialOffer(), { hooks: { '/square/trial/start': () => [409, { error: code }] } });
    await typeAbn(refused, EXAMPLE_ABN);
    await pressTrial(refused, ADD_CARD);
    await pressTrial(refused, 'Start free months');
    assert.match(trialProblem(refused), words, code);
    assert.equal(refused.planReads(), 1, code + ': nothing started, so nothing is read again');
  }
  // Square could not tokenize the card: nothing was sent.
  const bad = await withTrial(trialOffer(), { squareOptions: { tokenize: () => ({ status: 'Invalid' }) } });
  await typeAbn(bad, EXAMPLE_ABN);
  await pressTrial(bad, ADD_CARD);
  await pressTrial(bad, 'Start free months');
  assert.equal(posts(bad, '/square/trial/start').length, 0);
  assert.match(trialProblem(bad), /Square couldn’t use those card details\. Check them and try again\. Nothing was set up\./);
});

test('offer v9: not the owner, a used trial, a closed or unreachable card lane, an error and a missing function: words, at most one action, never a card field', async () => {
  const owner = await withTrial(trialLocked(['not_owner']));
  assert.equal(trialClass(owner, 'annual-lead').textContent, 'Only the workspace owner can start the free months here.');
  assert.equal(trialNodes(owner).some(el => ['BUTTON', 'INPUT'].includes(el.tagName)), false);
  const used = await withTrial(trialLocked(['trial_used']));
  assert.match(trialText(used), /This agency or workspace has already had its free months\.[\s\S]*A second free trial is not available/);
  assert.deepEqual(trialNodes(used).filter(el => el.tagName === 'A').map(el => el.href), ['mailto:yoda@yodalai.xyz?subject=Veylet%20plan']);
  assert.equal(trialFilled(used).length, 0);
  const closed = await withTrial(trialOffer(), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.deepEqual(trialAll(closed, 'annual-amount').map(el => el.textContent), ['A$99 a month', 'A$990 a year']);
  assert.match(trialText(closed), /Card sign-up on this website opens soon\.[\s\S]*Until then, start in the app through the App Store, or ask Veylet support for invoice terms\./);
  assert.equal(trialFilled(closed).length, 0);
  assert.equal(trialNodes(closed).some(el => el.tagName === 'INPUT'), false);
  const down = await withTrial(trialOffer(), { hooks: { '/square/lane': () => [503, { error: 'unavailable' }] } });
  assert.match(trialText(down), /Card payment couldn’t be reached, so a card can’t be added right now\./);
  assert.ok(trialButton(down, 'Check again'));
  for (const answer of [null, { eligible: true, missing: [], plans: [] }, trialOffer({ first_charge_on: brisbaneToday() }),
    trialOffer({ plans: [{ interval: 'monthly', cents: 9900, included: 2 }] }), trialOffer({ plans: [{ interval: 'monthly', cents: '9900', included: 2 }, { interval: 'annual', cents: 99000, included: 24 }] }),
    trialLocked(['something_else'])]) {
    const broken = await withTrial(answer);
    assert.equal(trialClass(broken, 'annual-lead').textContent, 'Couldn’t check how to start your free months here.', JSON.stringify(answer));
    assert.deepEqual(trialNodes(broken).filter(el => el.tagName === 'BUTTON').map(el => el.textContent), ['Try again']);
    assert.doesNotMatch(trialText(broken), /A\$/);
  }
  const missing = await withTrial(() => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }));
  assert.equal(trialCard(missing).hidden, true);
  const started = await withTrial(trialLocked(['already_started']));
  assert.equal(trialCard(started).hidden, true);
});

test('offer v9: the trial card shows only on a plan that has not started and is not an App Store plan; Sandbox labels it Test', async () => {
  for (const plan of [{}, { status: 'trial', trial_started_at: '2026-09-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z' },
    { source: 'apple', apple_verified: false }, { status: 'active', current_period_ends_at: '2026-10-01T00:00:00Z' }]) {
    const h = await withTrial(trialOffer(), { plan: { ...PENDING, status: 'trial', ...plan, ...(plan.status ? {} : { status: 'pending' }) } });
    const shown = !plan.status && plan.source !== 'apple';
    assert.equal(trialCard(h).hidden, !shown, JSON.stringify(plan));
    assert.equal(h.calls.some(call => call[0] === 'get_trial_offer'), shown, JSON.stringify(plan));
  }
  const sandbox = await withTrial(trialOffer(), { hooks: { '/square/lane': () => [200, { open: true, sandbox: true, card_form: CARD_FORM }] } });
  assert.equal(trialClass(sandbox, 'plan-test').textContent, 'Test · Square Sandbox: a test card, not a live payment.');
  assert.deepEqual(trialAll(sandbox, 'annual-amount').map(el => el.textContent), ['Test · A$99 a month', 'Test · A$990 a year']);
  assert.match(trialClass(sandbox, 'annual-charge').textContent, /^Test · Nothing is charged today\./);
  assert.deepEqual(trialFilled(sandbox).map(el => el.textContent), ['Test · ' + ADD_CARD]);
});

test('offer v9: one card form on the desk at a time, across the trial card and a super fast render', async () => {
  const h = await withTrial(trialOffer(), { rpc: { get_express_offer: async () => ({ data: expressOffer() }) } });
  await pressExpress(h, 'Super fast for A$29');
  assert.equal(expressNodes(h).some(el => el.id === 'account-express-card-field'), true);
  await typeAbn(h, EXAMPLE_ABN);
  await pressTrial(h, ADD_CARD);
  assert.equal(trialNodes(h).some(el => el.id === 'account-trial-card-field'), true);
  assert.equal(expressNodes(h).some(el => el.id === 'account-express-card-field'), false, 'the express card form closed');
  assert.ok(expressButton(h, 'Super fast for A$29'));
  await pressExpress(h, 'Super fast for A$29');
  assert.equal(trialNodes(h).some(el => el.id === 'account-trial-card-field'), false, 'and the other way round');
  assert.equal(trialAbnInput(h).value, EXAMPLE_ABN);
});

/* ---- Offer v9: Super fast render (code express) on a space ----------------------
 * A sent capture (queued or processing) shows a Super fast render block on its space:
 * the price, when it would be ready, the 30-minute promise and the refund promise,
 * and a quiet action (a card, or a super fast render from the early-annual bonus).
 * No daily cap and no business hours (owner decision, 25 September 2026). An ordered
 * render says it is automatic and when it is due. An older answer that still counts
 * against a cap offers nothing when full, and never states the cap.
 */
const EXPRESS_JOB = 'e1f2a3b4-0000-4000-8000-0000000000e1';
const inMinutes = minutes => new Date(Date.now() + minutes * 60000).toISOString();
const brisbaneTime = iso => new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' });
const sameBrisbaneDay = iso => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane' }).format(new Date(iso)) === new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane' }).format(new Date());
const expressWhen = iso => brisbaneTime(iso) + (sameBrisbaneDay(iso) ? ' today' : ' ' + new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short' }));
const READY_BY = inMinutes(120);
const sentCapture = (overrides = {}) => ({ job_id: EXPRESS_JOB, property_id: 'p1', status: 'queued', ready_by: READY_BY, express: null, ...overrides });
const expressOffer = (overrides = {}) => ({ price_cents: 2900, daily_cap: null, full_today: false, credits_available: 0, can_order: true,
  captures: [sentCapture()], ...overrides });
// An older backend's answer, still counted against a daily cap.
const cappedOffer = (overrides = {}) => expressOffer({ daily_cap: 5, taken_today: 2, ...overrides });
const orderedAnswer = (overrides = {}) => [200, { job_id: EXPRESS_JOB, express: { state: 'open', due_at: READY_BY, completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null },
  taken_today: 3, credits_available: 0, sandbox: false, ...overrides }];
async function withExpress(offer, options = {}) {
  const service = hooksService({ '/square/express/checkout': () => orderedAnswer(), ...options.hooks });
  const square = options.square === undefined ? fakeSquare(options.squareOptions) : options.square;
  const h = await load({ ...options, square, fetch: service.fetch, rpc: {
    get_workspace_plan: async () => ({ data: [{ ...planRow }] }),
    get_express_offer: async () => (typeof offer === 'function' ? offer() : { data: offer }),
    get_members_annual_offer: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }),
    ...options.rpc,
  } });
  await settle();
  return Object.assign(h, { requests: service.requests, square });
}
const expressSlot = h => h.ids['account-properties'].all().find(el => el.className === 'dash-express');
const expressNodes = h => expressSlot(h).all();
const expressText = h => expressNodes(h).filter(el => !el.hidden).map(el => el.textContent).join('\n');
const expressButton = (h, text) => expressNodes(h).find(el => el.tagName === 'BUTTON' && el.textContent === text);
const expressFilled = h => expressNodes(h).filter(el => /\btour-action-primary\b/.test(el.className || ''));
const expressClass = (h, name) => expressNodes(h).find(el => (el.className || '').split(' ').includes(name));
const expressProblem = h => { const box = expressClass(h, 'annual-problem'); return box && !box.hidden ? box.all().find(el => el.className === 'annual-alert-text').textContent : null; };
const pressExpress = async (h, text) => { await expressButton(h, text).fire('click'); await settle(); };
const PROMISE = 'First in the queue: ready in about 30 minutes, any day, any time, instead of the usual 1–2 hours. If it isn’t, the A$29 is refunded automatically.';

test('offer v9: a sent capture’s space offers a super fast render: A$29, when it would be ready, the 30-minute and refund promises, and a quiet action', async () => {
  const h = await withExpress(expressOffer({ captures: [sentCapture({ status: 'processing' })] }));
  assert.deepEqual({ ...h.calls.find(call => call[0] === 'get_express_offer')[1] }, { p_workspace_id: 'w1' });
  const slot = expressSlot(h);
  assert.equal(slot.hidden, false);
  const space = h.ids['account-properties'].children[0];
  assert.ok(space.children.indexOf(slot) > space.children.findIndex(el => el.className === 'dash-space-title'), 'on the space, under its name');
  assert.equal(expressClass(h, 'express-title').textContent, 'Need it sooner? Super fast render');
  assert.equal(expressClass(h, 'express-amount').textContent, 'A$29');
  assert.equal(expressClass(h, 'express-by').textContent, 'ready by ' + expressWhen(READY_BY));
  assert.ok(expressText(h).includes(PROMISE));
  assert.doesNotMatch(expressText(h), /taken today|a day|business|Mon–Fri/i, 'no cap and no business hours');
  assert.deepEqual(expressNodes(h).filter(el => el.tagName === 'BUTTON').map(el => [el.textContent, el.className]), [['Super fast for A$29', 'tour-action']]);
  assert.equal(expressFilled(h).length, 0, 'the offer adds no filled button to the desk');
  assert.equal(OFFER_RECORD.expressRender.webAud * 100, 2900);
  assert.equal(OFFER_RECORD.expressRender.name, 'Super fast render');
  assert.equal(OFFER_RECORD.expressRender.dailyCap, null);
  assert.equal(OFFER_RECORD.expressRender.appStore, false);
  // An older answer that still counts against a cap reads the same, and states no count.
  const capped = await withExpress(cappedOffer());
  assert.ok(expressText(capped).includes(PROMISE));
  assert.doesNotMatch(expressText(capped), /taken today|2 of 5|a day/i);
  // A space whose capture is not open, and a capture of another space, show nothing.
  const none = await withExpress(expressOffer({ captures: [] }));
  assert.equal(expressSlot(none).hidden, true);
  const other = await withExpress(expressOffer({ captures: [sentCapture({ property_id: 'p-elsewhere' })] }));
  assert.equal(expressSlot(other).hidden, true);
  assert.equal(h.ids['account-express-status'].hidden, true);
});

test('offer v9: Super fast for A$29 opens Square’s field on the space; Pay A$29 sends only the token, the job and one attempt id, then says when it is due', async () => {
  const h = await withExpress(expressOffer());
  await pressExpress(h, 'Super fast for A$29');
  assert.deepEqual(squareLog(h, 'attach'), [['attach', '#account-express-card-field']]);
  assert.equal(expressClass(h, 'annual-charge').textContent, 'Charged today: A$29. Ready by ' + expressWhen(READY_BY) + ', or the A$29 is refunded automatically.');
  assert.deepEqual(expressFilled(h).map(el => el.textContent), ['Pay A$29']);
  assert.equal(expressFilled(h)[0].attributes['aria-describedby'], 'account-express-charge');
  await pressExpress(h, 'Pay A$29');
  const [order] = posts(h, '/square/express/checkout');
  assert.equal(order.auth, 'Bearer token-1');
  assert.deepEqual(Object.keys(order.body).sort(), ['attempt_id', 'job_id', 'source_id', 'workspace_id']);
  assert.deepEqual({ ...order.body, attempt_id: 'id' }, { workspace_id: 'w1', job_id: EXPRESS_JOB, source_id: 'cnon:card-nonce-ok', attempt_id: 'id' });
  assert.equal(expressClass(h, 'express-title').textContent, 'Super fast · ready by ' + expressWhen(READY_BY));
  assert.equal(expressClass(h, 'pill').textContent, 'Automatic');
  assert.match(expressText(h), /First in the queue; nothing for you to do\. If it isn’t ready by then, the A\$29 is refunded automatically\./);
  assert.doesNotMatch(expressText(h), /studio/i);
  assert.equal(expressNodes(h).some(el => el.tagName === 'BUTTON'), false);
  assert.deepEqual(squareLog(h, 'destroy'), [['destroy']]);
});

test('offer v9: an older answer that is full offers nothing to press, keeps the capture’s place and never states a daily cap', async () => {
  const h = await withExpress(cappedOffer({ taken_today: 5, full_today: true }));
  assert.equal(expressClass(h, 'express-title').textContent, 'Super fast render');
  assert.equal(expressClass(h, 'pill').textContent, 'Not available right now');
  assert.match(expressText(h), /Super fast isn’t available right now\. Your capture keeps its place and is usually ready within 1–2 hours\./);
  assert.doesNotMatch(expressText(h), /5 a day|full today|taken|business/i);
  assert.equal(expressNodes(h).some(el => el.tagName === 'BUTTON'), false);
  // Refused as full meanwhile: before any charge, and the space offers nothing more.
  for (const offer of [cappedOffer(), expressOffer()]) {
    const late = await withExpress(offer, { hooks: { '/square/express/checkout': () => [409, { error: 'express_full_today' }] } });
    await pressExpress(late, 'Super fast for A$29');
    await pressExpress(late, 'Pay A$29');
    assert.equal(expressProblem(late), 'Super fast isn’t available right now, so nothing was charged. Your capture keeps its place in the queue.');
    assert.equal(expressClass(late, 'pill').textContent, 'Not available right now');
    assert.equal(expressNodes(late).some(el => el.tagName === 'BUTTON'), false);
  }
  // A count that disagrees with its own "full" flag, or "full" with no cap, is unreadable, never a promise.
  for (const offer of [cappedOffer({ taken_today: 5, full_today: false }), expressOffer({ full_today: true })]) {
    const odd = await withExpress(offer);
    assert.equal(expressSlot(odd).hidden, true);
    assert.equal(odd.ids['account-express-status'].hidden, false);
    assert.match(odd.ids['account-express-status'].textContent, /Super fast renders couldn’t be checked\. Your captures keep their place in the queue/);
  }
});

test('offer v9: a super fast render from the early-annual bonus is used without a card, and comes back if it is late', async () => {
  const calls = [];
  const h = await withExpress(expressOffer({ credits_available: 4 }), { rpc: { use_express_credit: async args => { calls.push(args);
    return { data: { job_id: EXPRESS_JOB, express: { state: 'open', due_at: READY_BY, completed_at: null, paid_with: 'credit', amount_cents: null, refund: null }, taken_today: 3, credits_available: 3 } }; } } });
  assert.deepEqual(expressNodes(h).filter(el => el.tagName === 'BUTTON').map(el => el.textContent), ['Use a super fast render (4 left)']);
  await pressExpress(h, 'Use a super fast render (4 left)');
  assert.deepEqual(calls.map(args => ({ ...args })), [{ p_job_id: EXPRESS_JOB }]);
  assert.equal(h.scripts.length, 0, 'no card form for a credit');
  assert.match(expressText(h), /If it isn’t ready by then, your super fast render is returned\./);
  const none = await withExpress(expressOffer({ credits_available: 1 }), { rpc: { use_express_credit: async () => ({ error: { code: 'P0001', message: 'no express render left' } }) } });
  await pressExpress(none, 'Use a super fast render (1 left)');
  assert.equal(expressProblem(none), 'No super fast render is left from your bonus, so nothing was used.');
});

test('offer v9: an ordered, met and missed super fast render each say what happened, whose turn it is and what came back', async () => {
  const due = inMinutes(95);
  const cases = [
    [{ state: 'open', due_at: due, completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null }, 'Super fast · ready by ' + expressWhen(due), /the A\$29 is refunded automatically/],
    [{ state: 'met', due_at: inMinutes(-20), completed_at: inMinutes(-60), paid_with: 'card', amount_cents: 2900, refund: null }, 'Super fast · ready ' + expressWhen(inMinutes(-60)), /Check it below and approve it when you are ready\./],
    [{ state: 'missed', due_at: inMinutes(-30), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: 'refunded' }, 'Super fast was late', /A\$29 refunded\. The walkthrough still comes, as soon as it is ready\./],
    [{ state: 'missed', due_at: inMinutes(-5), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: 'pending' }, 'Super fast was late', /Your A\$29 refund is on its way\./],
    [{ state: 'missed', due_at: inMinutes(-30), completed_at: null, paid_with: 'credit', amount_cents: null, refund: 'returned' }, 'Super fast was late', /Your super fast render was returned\./],
  ];
  for (const [express, title, words] of cases) {
    const h = await withExpress(expressOffer({ captures: [sentCapture({ status: express.state === 'met' ? 'awaiting_review' : 'processing', express })] }));
    assert.equal(expressClass(h, 'express-title').textContent, title, express.state);
    assert.match(expressText(h), words, express.state);
    assert.equal(expressNodes(h).some(el => el.tagName === 'BUTTON'), false, express.state + ': nothing to press');
  }
});

test('offer v9: not the owner, a closed lane, an unreadable or missing answer: the super fast block says so or stays away', async () => {
  const member = await withExpress(expressOffer({ can_order: false }));
  assert.match(expressText(member), /Only the workspace owner can order it\./);
  assert.equal(expressNodes(member).some(el => el.tagName === 'BUTTON'), false);
  const closed = await withExpress(expressOffer(), { hooks: { '/square/lane': () => [200, { open: false, sandbox: false }] } });
  assert.match(expressText(closed), /Card payment for super fast renders opens soon\./);
  assert.equal(expressNodes(closed).some(el => el.tagName === 'BUTTON'), false);
  const broken = await withExpress(() => ({ error: { message: 'offline' } }));
  assert.equal(expressSlot(broken).hidden, true);
  assert.equal(broken.ids['account-express-status'].hidden, false);
  const missing = await withExpress(() => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }));
  assert.equal(expressSlot(missing).hidden, true);
  assert.equal(missing.ids['account-express-status'].hidden, true);
  const declined = await withExpress(expressOffer(), { hooks: { '/square/express/checkout': () => [402, { error: 'payment_declined' }] } });
  await pressExpress(declined, 'Super fast for A$29');
  await pressExpress(declined, 'Pay A$29');
  assert.equal(expressProblem(declined), 'Your card was declined, so nothing was charged. Check the details or use another card, then try again.');
  assert.deepEqual(expressFilled(declined).map(el => el.textContent), ['Try again']);
  let replies = 0;
  const lost = await withExpress(expressOffer(), { hooks: { '/square/express/checkout': () => (replies++ ? orderedAnswer() : [502, { error: 'checkout_failed' }]) } });
  await pressExpress(lost, 'Super fast for A$29');
  await pressExpress(lost, 'Pay A$29');
  assert.match(expressProblem(lost), /We couldn’t confirm the super fast order\. .*a retry never charges twice\./);
  await pressExpress(lost, 'Try again');
  const tries = posts(lost, '/square/express/checkout');
  assert.equal(tries[0].body.attempt_id, tries[1].body.attempt_id, 'one order intent, one attempt id');
});

test('offer v9 truth check: A$29 reads the same in the offer, the button, the charge line, the refund promise and the ordered space, as offer.json states it', async () => {
  const h = await withExpress(expressOffer());
  const price = '$' + OFFER_RECORD.expressRender.webAud;
  const said = [expressClass(h, 'express-amount').textContent, expressButton(h, 'Super fast for A' + price).textContent.replace('Super fast for ', ''),
    expressText(h).match(/If it isn’t, the (A\$[\d.]+) is refunded/)[1]];
  await pressExpress(h, 'Super fast for A' + price);
  said.push(...expressClass(h, 'annual-charge').textContent.match(/A\$\d+(?:\.\d\d)?/g), expressFilled(h)[0].textContent.replace('Pay ', ''));
  await pressExpress(h, 'Pay A' + price);
  said.push(expressText(h).match(/the (A\$[\d.]+) is refunded automatically/)[1]);
  assert.deepEqual([...new Set(said)], ['A' + price], said.join(' | '));
  // The page never sells it in the app's words, and no string pairs it with the App Store.
  assert.doesNotMatch(account, /(?:express|super fast)[^'\n]{0,80}App Store|App Store[^'\n]{0,80}(?:express|super fast)/i);
});
