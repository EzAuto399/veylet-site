/*
 * Terms assent (LEGAL_LIFECYCLE-15, wave 2 lane D, 27 September 2026): the sign-in form says
 * "By continuing you agree to the Terms and Privacy notice", with both links, right above the
 * press that creates the account. Pressing it keeps that Terms version and moment for the email
 * in this tab; once sign-in completes the desk records it against the active workspace through
 * record_terms_acceptance. Missing or failed RPCs preserve that intent for a later refresh. Starting the
 * website free months carries the same line beside its card form.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const account = fs.readFileSync(path.join(__dirname, '../dist/account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(__dirname, '../dist/tour-sharing.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const MISSING = name => ({ error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
const settle = async () => { for (let round = 0; round < 5; round++) await new Promise(resolve => setTimeout(resolve, 10)); };

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.checked = false; this.textContent = ''; this.value = ''; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children.filter(child => typeof child !== 'string')); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelector() { return null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  click() {} focus() {} scrollIntoView() {} select() {} reset() {}
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
}
function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
}

async function load({ signedOut = false, record, session, memberships, primary, authRead, otp } = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  const verifySubmit = new Element('button'); verifySubmit.type = 'submit';
  ids['account-verify'].append(verifySubmit);
  const calls = [];
  const state = { signedIn: !signedOut, memberships: memberships || [{ workspace_id: WORKSPACE, role: 'owner', status: 'active' }], primary: primary === undefined ? WORKSPACE : primary };
  let me = { id: 'user-1', email: 'person@example.invalid', email_confirmed_at: '2026-01-05T00:00:00Z' };
  const supabase = {
    auth: {
      getSession: async () => authRead ? authRead(me, state) : ({ data: { session: state.signedIn ? { user: me, access_token: 'token-1' } : null } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signInWithOtp: async input => { calls.push(['otp', input]); return otp ? otp(input) : {}; },
      verifyOtp: async input => { calls.push(['verify', input]); return {}; },
      signOut: async () => ({}),
    },
    from(table) {
      const answer = { data: table === 'memberships' ? state.memberships : [] };
      const builder = { select() { return builder; }, order() { return builder; }, eq() { return builder; }, single: async () => ({ data: null }), then: (resolve, reject) => Promise.resolve(answer).then(resolve, reject) };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'record_terms_acceptance') return record ? record(args) : MISSING(name);
      if (name === 'get_primary_workspace') return { data: state.primary };
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      return MISSING(name);
    },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase }, VeyletPlace: { generalLocationProblem: () => '' }, addEventListener() {} };
  if (session) window.sessionStorage = session;
  const documentStub = { hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener() {}, head: { append() {} } };
  const timer = (fn, ms) => { const t = setTimeout(fn, Math.min(ms, 50)); t.unref(); return t; };
  const context = { window, document: documentStub, Date, navigator: {}, crypto: webcrypto, TextEncoder,
    location: { pathname: '/account', search: '', replace() {}, assign() {} }, URLSearchParams, URL, setTimeout: timer, clearTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key]; } } };
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(account, context);
  await settle();
  const signIn = async (user = me) => { me = user; state.signedIn = true; supabase.auth.callback('SIGNED_IN', { user: me }); await settle(); await settle(); };
  const signOut = async () => { state.signedIn = false; supabase.auth.callback('SIGNED_OUT', null); await settle(); };
  const refresh = async () => { await ids['account-refresh'].fire('click'); await settle(); };
  const submit = async address => {
    ids['account-sign-in'].values = { email: address, role_intent: 'owner' };
    await ids['account-sign-in'].fire('submit');
    await settle();
  };
  return { ids, calls, signIn, signOut, refresh, submit, state, recorded: () => calls.filter(([name]) => name === 'record_terms_acceptance').map(([, args]) => JSON.parse(JSON.stringify(args))) };
}

test('right under its one press, the sign-in form says continuing agrees to the Terms and Privacy notice', () => {
  const end = markup.indexOf('</form>', markup.indexOf('<form id="account-sign-in"'));
  const after = markup.slice(end, markup.indexOf('<form id="account-verify"'));
  assert.match(after, /<p class="contact-note account-terms-assent" id="account-terms-assent">By continuing you agree to the <a href="\/terms">Terms<\/a> and <a href="\/privacy">Privacy notice<\/a>\.<\/p>/);
  // The next element after the form, so the stylesheet hides it with the form (never a tick bundled inside it).
  assert.match(after, /^<\/form>\s*(?:<!--[\s\S]*?-->\s*)?<p class="contact-note account-terms-assent"/);
  const styles = fs.readFileSync(path.join(__dirname, '../dist/account-guide.css'), 'utf8');
  assert.match(styles, /#account-sign-in\[hidden\] \+ \.account-terms-assent \{ display: none; \}/);
  // The version recorded is the Terms page's own Last updated date.
  const terms = fs.readFileSync(path.join(__dirname, '../dist/terms/index.html'), 'utf8');
  const updated = terms.match(/Last updated (\d{1,2}) September (2026)/);
  assert.ok(updated, 'the Terms page says when it was last updated');
  assert.match(account, new RegExp("const TERMS_VERSION = '" + updated[2] + '-09-' + updated[1].padStart(2, '0') + "';"));
});

function receipt(args, extra = {}) {
  return { data: { terms_version: args.p_terms_version, surface: args.p_surface, accepted_at: new Date().toISOString(), recorded: true, ...extra } };
}

test('actual sign-in assent records the active primary workspace using the exact release-2 RPC contract', async () => {
  const session = memoryStorage();
  const h = await load({ signedOut: true, session, record: receipt });
  await h.submit('person@example.invalid');
  assert.ok(session.items.has('veylet-terms-intent'));
  assert.doesNotMatch([...session.items.values()].join(' '), /person@|example/);
  await h.signIn();
  assert.deepEqual(h.recorded(), [{ p_workspace_id: WORKSPACE, p_terms_version: '2026-09-25', p_surface: 'sign_in' }]);
  assert.equal(session.items.has('veylet-terms-intent'), false);
  await h.refresh();
  assert.equal(h.recorded().length, 1, 'acknowledged intent is consumed once');
});

test('a missing RPC keeps the actual intent for a later refresh and consumes only a valid receipt', async () => {
  const session = memoryStorage(); let available = false;
  const h = await load({ signedOut: true, session, record: args => available ? receipt(args) : MISSING('record_terms_acceptance') });
  await h.submit('person@example.invalid'); await h.signIn();
  assert.equal(h.recorded().length, 1);
  assert.ok(session.items.has('veylet-terms-intent'));
  available = true; await h.refresh();
  assert.equal(h.recorded().length, 2);
  assert.equal(session.items.has('veylet-terms-intent'), false);
});

test('a signed-in visit without actual assent sends nothing', async () => {
  const h = await load({ record: receipt });
  await h.refresh(); assert.equal(h.recorded().length, 0);
});

test('an intent waits for an active workspace and never uses an unverified primary or inactive membership', async () => {
  const session = memoryStorage();
  const h = await load({ signedOut: true, session, memberships: [{ workspace_id: WORKSPACE, role: 'owner', status: 'inactive' }], primary: OTHER_WORKSPACE, record: receipt });
  await h.submit('person@example.invalid'); await h.signIn();
  assert.equal(h.recorded().length, 0); assert.ok(session.items.has('veylet-terms-intent'));
  h.state.memberships = [{ workspace_id: WORKSPACE, role: 'owner', status: 'active' }];
  h.state.primary = WORKSPACE; await h.refresh();
  assert.equal(h.recorded().length, 1);
});

test('multiple memberships without an authoritative primary do not choose an arbitrary workspace', async () => {
  const h = await load({ signedOut: true, primary: null, memberships: [
    { workspace_id: WORKSPACE, status: 'active' }, { workspace_id: OTHER_WORKSPACE, status: 'active' },
  ], record: receipt });
  await h.submit('person@example.invalid'); await h.signIn(); assert.equal(h.recorded().length, 0);
});

test('a pending intent is not moved to a different workspace after a failed record', async () => {
  const h = await load({ signedOut: true, session: memoryStorage() });
  await h.submit('person@example.invalid'); await h.signIn();
  assert.equal(h.recorded().length, 1);
  h.state.memberships = [{ workspace_id: OTHER_WORKSPACE, status: 'active' }]; h.state.primary = OTHER_WORKSPACE;
  await h.refresh(); assert.equal(h.recorded().length, 1);
});

test('unreadable success data never acknowledges an intent; an idempotent prior-surface receipt does', async () => {
  const session = memoryStorage(); let valid = false;
  const h = await load({ signedOut: true, session, record: args => valid ? receipt(args, { recorded: false, surface: 'app_paywall' }) : ({ data: { ok: true } }) });
  await h.submit('person@example.invalid'); await h.signIn(); assert.ok(session.items.has('veylet-terms-intent'));
  valid = true; await h.refresh(); assert.equal(session.items.has('veylet-terms-intent'), false);
});

test('sign-out while the receipt is pending preserves the intent; another account cannot record it', async () => {
  const session = memoryStorage(); let finish;
  const h = await load({ signedOut: true, session, record: args => new Promise(resolve => { finish = () => resolve(receipt(args)); }) });
  await h.submit('person@example.invalid'); await h.signIn(); assert.equal(typeof finish, 'function');
  await h.signOut(); finish(); await settle(); assert.ok(session.items.has('veylet-terms-intent'));
  await h.signIn({ id: 'user-2', email: 'other@example.invalid' }); assert.equal(h.recorded().length, 1);
});

test('a stale auth receipt cannot erase a newer sign-in intent in this tab', async () => {
  const session = memoryStorage(); let finish;
  const h = await load({ signedOut: true, session, record: args => new Promise(resolve => { finish = () => resolve(receipt(args)); }) });
  await h.submit('person@example.invalid'); await h.signIn(); await h.signOut();
  await h.submit('other@example.invalid'); const newer = session.getItem('veylet-terms-intent');
  finish(); await settle(); assert.equal(session.getItem('veylet-terms-intent'), newer);
});

test('a confirmed session for a different user cannot send the previous user intent', async () => {
  let reads = 0;
  const h = await load({ signedOut: true, record: receipt, authRead: () => ({ data: { session: ++reads === 1 ? null : { user: { id: 'other-user', email: 'other@example.invalid' } } } }) });
  await h.submit('person@example.invalid'); await h.signIn(); assert.equal(h.recorded().length, 0);
});

test('the website free months card form carries the same assent line with both links', () => {
  assert.match(account, /parts\.push\(termsAssentLine\('By starting your free months you agree to the '\)\);/);
  assert.match(account, /const terms = annualNode\('a', 'text-link', 'Terms'\); terms\.href = '\/terms';/);
  assert.match(account, /const privacy = annualNode\('a', 'text-link', 'Privacy notice'\); privacy\.href = '\/privacy';/);
});


test('an unacknowledged intent survives reloading this tab and remains bound to its workspace', async () => {
  const session = memoryStorage();
  const first = await load({ signedOut: true, session });
  await first.submit('person@example.invalid'); await first.signIn();
  assert.ok(session.items.has('veylet-terms-intent'));
  const next = await load({ session, record: receipt });
  assert.deepEqual(next.recorded(), [{ p_workspace_id: WORKSPACE, p_terms_version: '2026-09-25', p_surface: 'sign_in' }]);
  assert.equal(session.items.has('veylet-terms-intent'), false);
});

test('auth completing before the email-request answer still records the actual form press', async () => {
  let finish;
  const h = await load({ signedOut: true, session: memoryStorage(), record: receipt,
    otp: () => new Promise(resolve => { finish = resolve; }) });
  const submission = h.submit('person@example.invalid'); await settle();
  await h.signIn(); finish({}); await submission;
  assert.equal(h.recorded().length, 1);
});


test('a client exception keeps the actual intent without claiming a record', async () => {
  const session = memoryStorage();
  const h = await load({ signedOut: true, session, record: () => { throw new Error('synthetic offline'); } });
  await h.submit('person@example.invalid'); await h.signIn();
  assert.ok(session.items.has('veylet-terms-intent')); assert.equal(h.recorded().length, 1);
});
