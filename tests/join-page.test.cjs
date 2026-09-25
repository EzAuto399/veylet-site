/*
 * /join (dist/join/index.html + dist/join/join.js): the invite link from "Your team".
 * It takes ?i= out of the address bar at once, keeps the invite on this device only
 * until it has an answer, sends a signed-out person to /account?join=1 (which comes
 * back here), then asks accept_workspace_invite once (the sibling repository's draft
 * 20260926123000_team_invites.sql) and says: joined, already in the team, expired, can't
 * be used (a revoked and an unknown invite read the same), not open yet (PGRST202),
 * offline or a failure (both with Try again).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const script = fs.readFileSync(path.join(dist, 'join/join.js'), 'utf8');
const markup = fs.readFileSync(path.join(dist, 'join/index.html'), 'utf8');
const TOKEN = 'QAinviteToken_0123456789-abcdefghij';

class Element {
  constructor(tag, hidden) { this.tagName = tag.toUpperCase(); this.hidden = hidden; this.disabled = false; this.textContent = ''; this.attributes = {}; this.listeners = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({ preventDefault() {} }); }
  focus() { this.focused = (this.focused || 0) + 1; }
}
function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

/** `accept` answers each accept_workspace_invite call in turn (an Error throws, as a lost connection does). */
async function page({ search = '?i=' + TOKEN, signedIn = true, accept = [], session, local = storage(), sessionStore = storage(), now } = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) ids[match[2]] = new Element(match[1], /\shidden\b/.test(match[0]));
  const calls = [], replaced = [];
  const answers = [...accept];
  const client = {
    auth: {
      getSession: async () => session || ({ data: { session: signedIn ? { user: { id: 'u-2', email: 'invitee@example.invalid' } } : null } }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next instanceof Error) throw next;
      return next || { data: null, error: { message: 'no answer set' } };
    },
  };
  const location = { pathname: '/join', search };
  const window = {
    VEYLET_JOIN_MANUAL: true, VEYLET_SUPABASE: { url: 'https://project.invalid', anonKey: 'public' },
    supabase: { createClient: () => client }, location,
    history: { replaceState: (state, title, url) => { replaced.push(url); location.search = ''; } },
    localStorage: local, sessionStorage: sessionStore,
    document: { getElementById: id => ids[id], readyState: 'complete' },
  };
  const context = { window, document: window.document, URLSearchParams, JSON, Date: now ? { now: () => now } : Date, Promise, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(script, context);
  const state = await window.VeyletJoin.run(window);
  const view = () => ({
    state: ids.main.getAttribute('data-state'), title: ids['join-title'].textContent, message: ids['join-message'].textContent,
    detail: ids['join-detail'].hidden ? '' : ids['join-detail'].textContent,
    primary: ids['join-primary'].hidden ? null : [ids['join-primary'].textContent, ids['join-primary'].getAttribute('href')],
    retry: !ids['join-retry'].hidden,
  });
  return { state, ids, calls, replaced, local, sessionStore, view };
}
const ok = (name = 'Harbour Realty', role = 'reviewer') => ({ data: { state: 'joined', workspace_id: 'w-1', workspace_name: name, role } });
const refused = message => ({ data: null, error: { code: 'P0001', message } });

test('the markup keeps the page out of search and referrers, and carries no invite', () => {
  assert.match(markup, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(markup, /<meta name="referrer" content="no-referrer" \/>/);
  assert.doesNotMatch(markup, /\bTeam\b/, 'the retired plan name stays off public pages');
  assert.match(markup, /<script defer src="\/join\/join\.js[^"]*"><\/script>/);
});

test('the invite leaves the address bar before anything is asked, and a joined person reads their role', async () => {
  const p = await page({ accept: [ok()] });
  assert.deepEqual(p.replaced, ['/join']);
  assert.deepEqual(p.calls, [{ name: 'accept_workspace_invite', args: { p_token: TOKEN } }]);
  assert.deepEqual(p.view(), { state: 'accepted', title: 'You’ve joined Harbour Realty.', message: 'You’re a reviewer: you can review and share walkthroughs.',
    detail: 'In the Veylet Capture app, sign in with this same email.', primary: ['Open your account', '/account'], retry: false });
  assert.equal(p.ids['join-title'].focused, 1);
  assert.equal(p.local.map.size + p.sessionStore.map.size, 0, 'an answered invite is not kept');
  const operator = await page({ accept: [ok('Coast Property', 'operator')] });
  assert.equal(operator.view().message, 'You’re an operator: you can capture and send walkthroughs.');
});

test('signed out, the page keeps the invite and sends the person to sign in, which returns here', async () => {
  const local = storage(), sessionStore = storage();
  const p = await page({ signedIn: false, local, sessionStore });
  assert.deepEqual(p.replaced, ['/join']);
  assert.equal(p.calls.length, 0);
  assert.deepEqual(p.view(), { state: 'signin', title: 'Sign in to join your team', message: 'Sign in with the email address the invite was sent to. You come back here to join.',
    detail: '', primary: ['Sign in to join', '/account?join=1'], retry: false });
  assert.equal(JSON.parse(local.map.get('veylet-join-invite')).t, TOKEN);
  assert.equal(JSON.parse(sessionStore.map.get('veylet-join-invite')).t, TOKEN);
  // Back from signing in: no invite in the address, the kept one is asked.
  const back = await page({ search: '', local, sessionStore, accept: [ok()] });
  assert.deepEqual(back.replaced, [], 'nothing to take out of the address');
  assert.deepEqual(back.calls, [{ name: 'accept_workspace_invite', args: { p_token: TOKEN } }]);
  assert.equal(back.view().state, 'accepted');
  assert.equal(local.map.size + sessionStore.map.size, 0);
});

test('expired and unavailable invites read as the draft refuses them; already a member is an answer, not a refusal', async () => {
  const expired = await page({ accept: [refused('invite expired')] });
  assert.deepEqual([expired.view().title, expired.view().message], ['This invite has expired', 'Ask the person who sent it for a new link.']);
  // The draft says 'invite unavailable' for an unknown, malformed, revoked or someone else's accepted invite.
  const unavailable = await page({ accept: [refused('invite unavailable')] });
  assert.deepEqual([unavailable.view().title, unavailable.view().message], ['This invite can’t be used',
    'It may have been revoked, or the link isn’t complete. Ask the person who sent it for a new link.']);
  const revoked = await page({ accept: [refused('invite revoked')] });
  assert.deepEqual(revoked.view(), unavailable.view(), 'however it is worded, a revoked invite reads as an unknown one');
  const member = await page({ accept: [{ data: { state: 'already_member', workspace_id: 'w-1', workspace_name: 'Harbour Realty', role: 'owner' } }] });
  assert.deepEqual(member.view(), { state: 'member', title: 'You’re already in Harbour Realty.', message: 'Nothing changed. Your account shows its walkthroughs.',
    detail: 'You’re signed in as invitee@example.invalid.', primary: ['Open your account', '/account'], retry: false });
  const joinedAgain = await page({ accept: [{ data: { state: 'joined', workspace_id: 'w-1', workspace_name: 'Harbour Realty', role: 'operator' } }] });
  assert.equal(joinedAgain.view().state, 'accepted');
  const strange = await page({ accept: [{ data: { state: 'something_else', workspace_id: 'w-1' } }] });
  assert.equal(strange.view().state, 'error');
  for (const done of [expired, unavailable, revoked, member, joinedAgain]) assert.equal(done.local.map.size, 0);
  const signIn = await page({ accept: [refused('sign in to accept an invite')] });
  assert.equal(signIn.view().state, 'signin', 'the draft’s own sign-in refusal');
  assert.equal(JSON.parse(signIn.local.map.get('veylet-join-invite')).t, TOKEN);
});

test('not open yet, offline and failures: nothing claimed, Try again where it can help', async () => {
  const missing = await page({ accept: [{ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.accept_workspace_invite(p_token) in the schema cache' } }] });
  assert.deepEqual([missing.view().title, missing.view().retry], ['Joining a team isn’t open yet', false]);
  const offline = await page({ accept: [new TypeError('Failed to fetch'), ok()] });
  assert.deepEqual([offline.view().title, offline.view().message, offline.view().retry], ['You’re offline', 'Your invite is kept on this device. Try again when you’re back online.', true]);
  assert.equal(JSON.parse(offline.local.map.get('veylet-join-invite')).t, TOKEN);
  await offline.ids['join-retry'].fire('click');
  assert.equal(offline.calls.length, 2);
  assert.equal(offline.view().state, 'accepted');
  const failing = await page({ accept: [{ data: null, error: { message: 'Internal Server Error', code: '500' } }] });
  assert.deepEqual([failing.view().title, failing.view().retry], ['We couldn’t check your invite', true]);
  const expiredSignIn = await page({ accept: [{ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }] });
  assert.equal(expiredSignIn.view().state, 'signin', 'an expired sign-in is not an expired invite');
  assert.equal(JSON.parse(expiredSignIn.local.map.get('veylet-join-invite')).t, TOKEN);
  const odd = await page({ accept: [{ data: { hello: 'world' } }] });
  assert.equal(odd.view().state, 'error');
});

test('a missing, malformed or day-old invite reads as one that can’t be used, and asks nothing', async () => {
  for (const search of ['', '?i=', '?i=short', '?i=' + encodeURIComponent('<script>') + 'aaaaaaaaaaaaaaaa']) {
    const p = await page({ search });
    assert.equal(p.view().state, 'invalid', search);
    assert.equal(p.calls.length, 0, search);
  }
  const now = Date.parse('2026-09-26T00:00:00Z');
  const stale = storage({ 'veylet-join-invite': JSON.stringify({ t: TOKEN, at: now - 25 * 3600 * 1000 }) });
  const p = await page({ search: '', local: stale, sessionStore: storage(), now });
  assert.equal(p.view().state, 'invalid');
  assert.equal(p.calls.length, 0);
});
