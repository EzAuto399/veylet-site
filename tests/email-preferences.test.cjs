/*
 * Email preferences on the desk (dist/account.js + dist/account/index.html): the "tips and offers" box
 * of the sibling repository's docs/lifecycle-email.md and its draft 20260926114000_lifecycle_email.sql
 * (get_email_preferences, set_email_tips_preference; not yet released, so a missing function hides
 * everything). Two places: the sign-in form (unticked, recorded once sign-in completes) and Account ›
 * Email preferences (the recorded choice, labelled with the exact current wording).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto, createHash } = require('node:crypto');

const account = fs.readFileSync(path.join(__dirname, '../dist/account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(__dirname, '../dist/tour-sharing.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');
const fixtureSource = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
const V1 = 'Email me tips and offers from Veylet Studio. I can unsubscribe at any time.';
const V2 = 'Email me tips, offers and product news from Veylet Studio. I can unsubscribe at any time.';
const MISSING = name => ({ error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.checked = false; this.textContent = ''; this.value = ''; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
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

/**
 * The desk on a stand-in DOM. `email` answers get_email_preferences for a signed-in caller (an object,
 * or a function of the call count); signed out, the function refuses unless `email` is 'missing'.
 * `save` answers set_email_tips_preference. `storage` is this browser's localStorage.
 */
async function load({ signedOut = false, email = 'missing', save, user, storage, now } = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1]); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  const verifySubmit = new Element('button'); verifySubmit.type = 'submit';
  ids['account-verify'].append(verifySubmit);
  const calls = [];
  const state = { signedIn: !signedOut, reads: 0 };
  const me = user || { id: 'user-1', email: 'person@example.invalid', email_confirmed_at: '2026-01-05T00:00:00Z' };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: signedOut ? null : { user: me, access_token: 'token-1' } } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signInWithOtp: async input => { calls.push(['otp', input]); return {}; },
      verifyOtp: async input => { calls.push(['verify', input]); return {}; },
      signOut: async () => ({}),
    },
    from() {
      const answer = { data: [] };
      const builder = { select() { return builder; }, order() { return builder; }, eq() { return builder; }, single: async () => ({ data: null }), then: (resolve, reject) => Promise.resolve(answer).then(resolve, reject) };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'get_email_preferences') {
        if (email === 'missing') return MISSING(name);
        if (!state.signedIn) return { error: { code: 'P0001', message: 'sign in required' } };
        state.reads += 1;
        return typeof email === 'function' ? email(state.reads) : email;
      }
      if (name === 'set_email_tips_preference') {
        if (save) return save(args);
        return { data: { tips_opt_in: args.p_opt_in, wording_version: args.p_opt_in ? args.p_wording_version : null, changed_at: '2026-09-25T00:00:00Z' } };
      }
      if (['get_pack_offer', 'get_trial_offer', 'get_express_offer', 'list_workspace_render_status', 'get_members_annual_offer', 'get_referral_code', 'get_walkthrough_capacity', 'get_workspace_plan'].includes(name)) return MISSING(name);
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      return { data: null };
    },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase }, VeyletPlace: { generalLocationProblem: () => '' }, addEventListener() {} };
  if (storage) window.localStorage = storage;
  const documentStub = { hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener() {}, head: { append() {} } };
  const timer = (fn, ms) => { const t = setTimeout(fn, Math.min(ms, 50)); t.unref(); return t; };
  const context = { window, document: documentStub, Date: now ? class extends Date { static now() { return now(); } } : Date, navigator: {}, crypto: webcrypto, TextEncoder,
    location: { pathname: '/account', search: '', replace() {}, assign() {} }, URLSearchParams, URL, setTimeout: timer, clearTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key]; } } };
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(account, context);
  await settle();
  const signIn = async (who = me) => { state.signedIn = true; supabase.auth.callback('SIGNED_IN', { user: who }); await settle(); await settle(); };
  const submit = async (address, tick) => {
    ids['account-signup-tips'].checked = Boolean(tick);
    ids['account-sign-in'].values = { email: address, role_intent: 'owner' };
    await ids['account-sign-in'].fire('submit');
    await settle();
  };
  return { ids, calls, state, supabase, signIn, submit, saves: () => calls.filter(([name]) => name === 'set_email_tips_preference').map(([, args]) => args) };
}

const box = h => ({ shown: !h.ids['account-email'].hidden, ticked: h.ids['account-email-tips'].checked, label: h.ids['account-email-tips-label'].textContent,
  disabled: h.ids['account-email-tips'].disabled, said: h.ids['account-email-status'].textContent });
const answer = (optIn, current = 'tips-v1', wording = V1) => ({ data: { tips_opt_in: optIn, wording_version: optIn ? 'tips-v1' : null, changed_at: null, time_zone: null, current_wording_version: current, current_wording: wording } });

test('the markup never ticks either box, keeps them apart from anything else, and labels each with exactly the wording', () => {
  for (const id of ['account-signup-tips', 'account-email-tips']) {
    const tag = new RegExp(`<input type="checkbox" id="${id}"[^>]*>`).exec(markup)[0];
    assert.doesNotMatch(tag, /\bchecked\b|\brequired\b|\bname="(?:terms|accept)/, id);
    assert.match(tag, new RegExp(`aria-labelledby="${id}-label"`), id);
    assert.equal(new RegExp(`<span id="${id}-label">([^<]*)</span>`).exec(markup)[1], V1, id);
  }
  // Both are hidden until the backend is known to record the choice.
  assert.match(markup, /<div class="signup-tips" id="account-signup-tips-row" hidden>/);
  assert.match(markup, /<details class="account-details" id="account-email" hidden><summary>Email preferences<\/summary>/);
  // The one-line notes: service email is not affected.
  assert.match(markup, /<small id="account-signup-tips-note">Optional\. Service emails about your account and walkthroughs still arrive\.<\/small>/);
  assert.match(markup, /<p class="contact-note" id="account-email-note">Service emails about your account and walkthroughs still arrive, whatever you choose here\.<\/p>/);
  // No terms box on the sign-in form to bundle it with.
  const form = markup.split('<form id="account-sign-in"')[1].split('</form>')[0];
  assert.equal((form.match(/type="checkbox"/g) || []).length, 1);
  assert.doesNotMatch(form, /terms/i);
  // Email preferences sits in the Account section, beside the other account disclosures.
  const self = markup.split('id="account-self-title"')[1].split('</section>')[0];
  assert.ok(self.includes('id="account-email"'));
  const hash = createHash('sha256').update(account).digest('hex').slice(0, 16);
  assert.ok(markup.includes(`/account.js?v=${hash}`), 'account.js is versioned by its bytes');
});

test('before the backend has the functions nothing is shown and nothing is recorded', async () => {
  const signedIn = await load();
  assert.equal(box(signedIn).shown, false);
  assert.equal(signedIn.calls.filter(([name]) => name === 'get_email_preferences').length, 1);
  const signedOut = await load({ signedOut: true });
  assert.equal(signedOut.ids['account-signup-tips-row'].hidden, true, 'no box on the sign-in form');
  await signedOut.submit('new@example.invalid', true);
  await signedOut.signIn({ id: 'user-9', email: 'new@example.invalid', email_confirmed_at: new Date().toISOString() });
  assert.deepEqual(signedOut.saves(), []);
});

test('Account shows the recorded choice, unticked by default, with the exact current wording', async () => {
  const out = await load({ email: answer(false) });
  assert.deepEqual(box(out), { shown: true, ticked: false, label: V1, disabled: false, said: '' });
  const inn = await load({ email: answer(true) });
  assert.deepEqual(box(inn), { shown: true, ticked: true, label: V1, disabled: false, said: '' });
  // A newer wording is shown as the server words it, and a tick records that version.
  const v2 = await load({ email: answer(false, 'tips-v2', V2) });
  assert.equal(box(v2).label, V2);
  v2.ids['account-email-tips'].checked = true;
  await v2.ids['account-email-tips'].fire('change'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(v2.saves())), [{ p_opt_in: true, p_source: 'account', p_wording_version: 'tips-v2' }]);
  // Without a version and its words together, the first wording is shown and recorded.
  for (const odd of [{ current_wording_version: 'tips-v2' }, { current_wording: V2 }, { current_wording_version: 'v2', current_wording: V2 }]) {
    const h = await load({ email: { data: { tips_opt_in: false, ...odd } } });
    assert.equal(box(h).label, V1, JSON.stringify(odd));
    h.ids['account-email-tips'].checked = true;
    await h.ids['account-email-tips'].fire('change'); await settle();
    assert.equal(h.saves()[0].p_wording_version, 'tips-v1');
  }
  // An answer without a choice, or a failed read, claims nothing.
  for (const bad of [{ data: { current_wording_version: 'tips-v1' } }, { data: 'receipt' }, { error: { message: 'boom' } }]) {
    const h = await load({ email: bad });
    assert.equal(box(h).shown, false, JSON.stringify(bad));
  }
});

test('each change is one call with source account and the wording version; unchanged, nothing is sent', async () => {
  const h = await load({ email: answer(false) });
  h.ids['account-email-tips'].checked = true;
  await h.ids['account-email-tips'].fire('change'); await settle();
  assert.deepEqual(box(h), { shown: true, ticked: true, label: V1, disabled: false, said: 'Saved. We’ll email you tips and offers.' });
  h.ids['account-email-tips'].checked = false;
  await h.ids['account-email-tips'].fire('change'); await settle();
  assert.equal(box(h).said, 'Saved. We won’t email you tips or offers.');
  assert.deepEqual(JSON.parse(JSON.stringify(h.saves())), [
    { p_opt_in: true, p_source: 'account', p_wording_version: 'tips-v1' },
    { p_opt_in: false, p_source: 'account', p_wording_version: 'tips-v1' },
  ]);
  await h.ids['account-email-tips'].fire('change'); await settle();
  assert.equal(h.saves().length, 2, 'a change event without a change sends nothing');
  // A second desk load does not read or redraw over the choice.
  assert.equal(h.calls.filter(([name]) => name === 'get_email_preferences').length, 1);
});

test('a failed save puts the box back and says so; a missing function hides it; an expired sign-in signs out', async () => {
  const failed = await load({ email: answer(false), save: () => ({ error: { message: 'boom' } }) });
  failed.ids['account-email-tips'].checked = true;
  await failed.ids['account-email-tips'].fire('change'); await settle();
  assert.deepEqual(box(failed), { shown: true, ticked: false, label: V1, disabled: false, said: 'Your choice wasn’t saved, so nothing changed. Try again.' });
  const offline = await load({ email: answer(true), save: () => { throw new TypeError('Failed to fetch'); } });
  offline.ids['account-email-tips'].checked = false;
  await offline.ids['account-email-tips'].fire('change'); await settle();
  assert.equal(box(offline).ticked, true);
  assert.match(box(offline).said, /offline, so nothing changed/);
  const missing = await load({ email: answer(false), save: () => MISSING('set_email_tips_preference') });
  missing.ids['account-email-tips'].checked = true;
  await missing.ids['account-email-tips'].fire('change'); await settle();
  assert.equal(box(missing).shown, false);
  const expired = await load({ email: answer(false), save: () => ({ error: { code: 'PGRST301', message: 'JWT expired' } }) });
  expired.ids['account-email-tips'].checked = true;
  await expired.ids['account-email-tips'].fire('change'); await settle();
  assert.equal(expired.ids['account-home'].hidden, true);
  assert.equal(box(expired).shown, false);
  assert.match(expired.ids['account-status'].textContent, /sign-in has expired/);
});

test('signed out, the sign-in form offers the unticked box only when the function exists', async () => {
  const h = await load({ signedOut: true, email: answer(false) });
  assert.equal(h.ids['account-signup-tips-row'].hidden, false);
  assert.equal(h.ids['account-signup-tips'].checked, false);
  assert.equal(h.ids['account-signup-tips-label'].textContent, V1);
  assert.equal(box(h).shown, false, 'no Account block while signed out');
});

test('a tick on the sign-in form is recorded once sign-in completes, as signup, with the wording shown', async () => {
  const h = await load({ signedOut: true, email: answer(false, 'tips-v2', V2) });
  await h.submit('New.Person@Example.invalid', true);
  assert.equal(h.calls.find(([name]) => name === 'otp')[1].options.data.tips_opt_in, undefined, 'the choice is not sent with the sign-in email');
  await h.signIn({ id: 'user-9', email: 'new.person@example.invalid', email_confirmed_at: new Date().toISOString() });
  // The form showed tips-v1 (the current wording can't be read signed out), so tips-v1 is recorded.
  assert.deepEqual(JSON.parse(JSON.stringify(h.saves())), [{ p_opt_in: true, p_source: 'signup', p_wording_version: 'tips-v1' }]);
  assert.deepEqual(box(h), { shown: true, ticked: true, label: V2, disabled: false, said: 'Saved. We’ll email you tips and offers.' });
  assert.equal(h.ids['account-signup-tips-row'].hidden, true);
});

test('no tick records nothing; a tick for another email, or an account already opted in, records nothing', async () => {
  const unticked = await load({ signedOut: true, email: answer(false) });
  await unticked.submit('new@example.invalid', false);
  await unticked.signIn({ id: 'user-9', email: 'new@example.invalid', email_confirmed_at: new Date().toISOString() });
  assert.deepEqual(unticked.saves(), []);
  assert.equal(box(unticked).ticked, false);

  const other = await load({ signedOut: true, email: answer(false) });
  await other.submit('first@example.invalid', true);
  await other.signIn({ id: 'user-8', email: 'second@example.invalid', email_confirmed_at: new Date().toISOString() });
  assert.deepEqual(other.saves(), [], 'the tick belongs to the email it was given with');

  const already = await load({ signedOut: true, email: answer(true) });
  await already.submit('new@example.invalid', true);
  await already.signIn({ id: 'user-9', email: 'new@example.invalid', email_confirmed_at: new Date().toISOString() });
  assert.deepEqual(already.saves(), []);
});

test('an existing account that ticks the box on the sign-in form is recorded from the account page, not as a signup', async () => {
  const h = await load({ signedOut: true, email: answer(false) });
  await h.submit('person@example.invalid', true);
  await h.signIn({ id: 'user-1', email: 'person@example.invalid', email_confirmed_at: '2026-01-05T00:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.saves())), [{ p_opt_in: true, p_source: 'account', p_wording_version: 'tips-v1' }]);
});

test('the email link opened in another tab still records the tick, from storage that holds no address', async () => {
  const storage = memoryStorage();
  const first = await load({ signedOut: true, email: answer(false), storage });
  await first.submit('new@example.invalid', true);
  assert.equal(storage.items.size, 1);
  const kept = storage.items.get('veylet-tips-intent');
  assert.doesNotMatch(kept, /example|@/, 'only the address’s SHA-256 is kept');
  const parsed = JSON.parse(kept);
  assert.equal(parsed.v, 'tips-v1');
  assert.equal(parsed.h, createHash('sha256').update('new@example.invalid').digest('hex'));
  // A fresh page (the link's tab) signed in as that email.
  const second = await load({ email: answer(false), storage, user: { id: 'user-9', email: 'new@example.invalid', email_confirmed_at: new Date().toISOString() } });
  assert.deepEqual(JSON.parse(JSON.stringify(second.saves())), [{ p_opt_in: true, p_source: 'signup', p_wording_version: 'tips-v1' }]);
  assert.equal(storage.items.size, 0, 'one sign-in uses it up');
  // Another account signing in on this browser finds nothing, and clears what it finds.
  const third = await load({ signedOut: true, email: answer(false), storage });
  await third.submit('someone@example.invalid', true);
  const fourth = await load({ email: answer(false), storage });
  assert.deepEqual(fourth.saves(), []);
  assert.equal(storage.items.size, 0);
});

test('a tick older than an hour is not recorded', async () => {
  const storage = memoryStorage();
  const start = Date.now();
  const first = await load({ signedOut: true, email: answer(false), storage, now: () => start });
  await first.submit('new@example.invalid', true);
  const later = await load({ email: answer(false), storage, now: () => start + 61 * 60 * 1000,
    user: { id: 'user-9', email: 'new@example.invalid', email_confirmed_at: new Date(start + 61 * 60 * 1000).toISOString() } });
  assert.deepEqual(later.saves(), []);
});

test('the QA fixture answers each ?email= case as documented', async () => {
  const fixture = search => {
    const context = { URLSearchParams, location: { search, pathname: '/__qa/account/' }, navigator: {},
      localStorage: { getItem: () => null, setItem() {} }, document: { createElement: () => ({}), addEventListener() {} }, setTimeout };
    context.window = context;
    vm.runInNewContext(fixtureSource, context);
    return { client: context.supabase.createClient(), context };
  };
  const read = async search => fixture(search).client.rpc('get_email_preferences');
  assert.equal((await read('')).error.code, 'PGRST202', 'by default the backend has no function, as today');
  assert.equal((await read('?email=out')).data.tips_opt_in, false);
  assert.equal((await read('?email=out')).data.current_wording, V1);
  assert.equal((await read('?email=in')).data.tips_opt_in, true);
  assert.equal((await read('?email=v2')).data.current_wording, V2);
  assert.equal((await read('?email=out&session=out')).error.message, 'sign in required');
  assert.equal((await read('?session=out')).error.code, 'PGRST202');
  assert.ok((await read('?email=error')).error);
  const { client, context } = fixture('?email=out');
  const saved = await client.rpc('set_email_tips_preference', { p_opt_in: true, p_source: 'account', p_wording_version: 'tips-v1' });
  assert.equal(saved.data.tips_opt_in, true);
  assert.equal((await client.rpc('get_email_preferences')).data.tips_opt_in, true, 'the next read returns what was saved');
  assert.equal((await client.rpc('set_email_tips_preference', { p_opt_in: true, p_source: 'website', p_wording_version: 'tips-v1' })).error.message,
    'a choice and its source (signup, account or app) are required');
  assert.equal((await client.rpc('set_email_tips_preference', { p_opt_in: true, p_source: 'account', p_wording_version: 'tips-v9' })).error.message, 'unknown consent wording');
  assert.equal(context.VEYLET_QA_CALLS.filter(call => call.name === 'set_email_tips_preference').length, 3);
  assert.equal((await fixture('?email=out&email-save=missing').client.rpc('set_email_tips_preference', { p_opt_in: false, p_source: 'account' })).error.code, 'PGRST202');
  await assert.rejects(fixture('?email=out&email-save=offline').client.rpc('set_email_tips_preference', { p_opt_in: false, p_source: 'account' }));
});
