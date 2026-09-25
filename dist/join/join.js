/*
 * /join?i=<invite>: the link a workspace owner copies or shares from "Your team" on their desk
 * (invite_to_workspace answers it; no email is sent). The sibling repository's release-2
 * draft supabase/drafts/release-2/20260926123000_team_invites.sql (not released) accepts it
 * with accept_workspace_invite(p_token) → { state: joined | already_member, workspace_id,
 * workspace_name, role } for a signed-in person, and refuses 'invite unavailable' (unknown,
 * malformed, revoked or someone else's accepted invite), 'invite expired' or 'sign in to
 * accept an invite'. It never compares the account's email with the invite's.
 *
 * The page takes the invite out of the address bar before anything else runs, and keeps
 * it on this device (session and local storage, at most a day) only until it has an
 * answer, so signing in can come back for it: a signed-out person goes to
 * /account?join=1, whose email link and code both return to /join. Then it asks once and
 * says one of: joined, already in the team, expired, can't be used (a revoked invite and
 * an unknown one read the same, so the page never says whether an invite existed), not
 * open yet (a backend without the function, PGRST202), offline or a failure (both with
 * Try again, the invite kept).
 */
(function () {
  'use strict';

  var KEY = 'veylet-join-invite';
  var MAX_AGE = 24 * 60 * 60 * 1000;
  var TOKEN = /^[A-Za-z0-9_-]{16,512}$/;
  var ROLE = {
    reviewer: 'You’re a reviewer: you can review and share walkthroughs.',
    operator: 'You’re an operator: you can capture and send walkthroughs.',
  };
  var APP = 'In the Veylet Capture app, sign in with this same email.';
  var COPY = {
    loading: { title: 'Checking your invite…', message: 'One moment.' },
    signin: { title: 'Sign in to join your team', message: 'Sign in with the email address the invite was sent to. You come back here to join.',
      action: ['Sign in to join', '/account?join=1'] },
    accepted: { title: 'You’ve joined {team}.', message: 'You can open your account now.', action: ['Open your account', '/account'] },
    member: { title: 'You’re already in {team}.', message: 'Nothing changed. Your account shows its walkthroughs.', action: ['Open your account', '/account'] },
    expired: { title: 'This invite has expired', message: 'Ask the person who sent it for a new link.' },
    invalid: { title: 'This invite can’t be used', message: 'It may have been revoked, or the link isn’t complete. Ask the person who sent it for a new link.' },
    unavailable: { title: 'Joining a team isn’t open yet', message: 'Nothing changed. Try the link again later.' },
    offline: { title: 'You’re offline', message: 'Your invite is kept on this device. Try again when you’re back online.', retry: true },
    error: { title: 'We couldn’t check your invite', message: 'Nothing changed. Try again in a minute.', retry: true },
  };
  // An answer that settles the invite: it is not kept any longer.
  var FINAL = ['accepted', 'member', 'expired', 'invalid', 'unavailable'];
  var NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network connection was lost|internet connection appears to be offline/i;

  function readToken(search) {
    var value = null;
    try { value = new URLSearchParams(search || '').get('i'); } catch (unreadable) { value = null; }
    return value && TOKEN.test(value) ? value : null;
  }
  function stores(win) {
    var found = [];
    ['sessionStorage', 'localStorage'].forEach(function (name) { try { if (win[name]) found.push(win[name]); } catch (blocked) { /* not here */ } });
    return found;
  }
  function keep(win, token, now) {
    var value = JSON.stringify({ t: token, at: now });
    stores(win).forEach(function (store) { try { store.setItem(KEY, value); } catch (full) { /* this page load still has it */ } });
  }
  function kept(win, now) {
    var list = stores(win);
    for (var i = 0; i < list.length; i += 1) {
      try {
        var saved = JSON.parse(list[i].getItem(KEY) || 'null');
        if (saved && TOKEN.test(String(saved.t)) && typeof saved.at === 'number' && now - saved.at >= 0 && now - saved.at < MAX_AGE) return saved.t;
      } catch (unreadable) { /* try the next one */ }
    }
    return null;
  }
  function forget(win) {
    stores(win).forEach(function (store) { try { store.removeItem(KEY); } catch (blocked) { /* nothing to clear */ } });
  }

  /** What accept_workspace_invite's reply means for the page. */
  function outcome(reply) {
    if (!reply || reply.timedOut) return { state: 'error' };
    var error = reply.error || (reply.value && reply.value.error) || null;
    if (!error) {
      var data = reply.value && reply.value.data;
      var row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object' || typeof row.workspace_id !== 'string') return { state: 'error' };
      var team = typeof row.workspace_name === 'string' ? row.workspace_name.trim() : '';
      // Already an active member (the owner opening their own link too): role unchanged.
      if (row.state === 'already_member') return { state: 'member', team: team, role: row.role };
      if (row.state !== undefined && row.state !== 'joined') return { state: 'error' };
      return { state: 'accepted', team: team, role: row.role };
    }
    var code = String(error.code || error.status || '');
    var text = String(error.message || '').toLowerCase();
    if (code === 'PGRST202' || /could not find the function/.test(text)) return { state: 'unavailable' };
    if (code === '401' || code === 'PGRST301' || /jwt|not signed in|sign in to accept|sign in required|refresh token/.test(text)) return { state: 'signin' };
    if ((error.name === 'TypeError' || /typeerror|fetcherror/i.test(text)) && NETWORK.test(text)) return { state: 'offline' };
    if (/invite expired/.test(text)) return { state: 'expired' };
    if (/invite unavailable|invite|revoked|not found|invalid/.test(text)) return { state: 'invalid' };
    return { state: 'error' };
  }

  function show(doc, result, email) {
    var state = result.state;
    var copy = COPY[state];
    var team = result.team || '';
    var main = doc.getElementById('main');
    if (main) main.setAttribute('data-state', state);
    doc.getElementById('join-title').textContent = copy.title.replace('{team}', team || (state === 'member' ? 'this team' : 'the team'));
    var message = state === 'accepted' && ROLE[result.role] ? ROLE[result.role] : copy.message;
    doc.getElementById('join-message').textContent = message;
    var detail = doc.getElementById('join-detail');
    var words = state === 'accepted' ? APP : state === 'member' && email ? 'You’re signed in as ' + email + '.' : '';
    detail.textContent = words; detail.hidden = !words;
    var primary = doc.getElementById('join-primary');
    primary.hidden = !copy.action;
    if (copy.action) { primary.textContent = copy.action[0]; primary.setAttribute('href', copy.action[1]); }
    doc.getElementById('join-retry').hidden = !copy.retry;
    if (state !== 'loading') doc.getElementById('join-title').focus();
    return state;
  }

  async function settled(promise, ms) {
    var timer = null;
    var expired = new Promise(function (resolve) { timer = setTimeout(function () { resolve({ timedOut: true }); }, ms || 20000); });
    var result = await Promise.race([promise.then(function (value) { return { value: value }; }, function (error) { return { error: error }; }), expired]);
    if (timer) clearTimeout(timer);
    return result;
  }

  async function run(win) {
    var doc = win.document;
    var now = Date.now();
    var fromLink = readToken(win.location.search);
    // The invite is a key to this team: keep it out of history, screenshots and every later request's address.
    if (win.location.search && win.history && typeof win.history.replaceState === 'function') {
      win.history.replaceState(null, '', win.location.pathname);
    }
    if (fromLink) keep(win, fromLink, now);
    var token = fromLink || kept(win, now);
    if (!token) return show(doc, { state: 'invalid' });
    var config = win.VEYLET_SUPABASE;
    if (!config || !config.url || !config.anonKey || !win.supabase || !win.supabase.createClient) return show(doc, { state: 'error' });
    var client = win.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, detectSessionInUrl: false, flowType: 'pkce' } });
    var retry = doc.getElementById('join-retry');
    var email = '';
    var busy = false;
    async function attempt() {
      if (busy) return null;
      busy = true;
      show(doc, { state: 'loading' });
      retry.disabled = true;
      var session = await settled(Promise.resolve().then(function () { return client.auth.getSession(); }));
      var current = session.value && session.value.data && session.value.data.session;
      var result;
      if (session.timedOut || session.error || (session.value && session.value.error)) result = { state: 'error' };
      else if (!current || !current.user) result = { state: 'signin' };
      else {
        email = current.user.email || '';
        result = outcome(await settled(Promise.resolve().then(function () { return client.rpc('accept_workspace_invite', { p_token: token }); })));
      }
      if (FINAL.indexOf(result.state) !== -1) forget(win);
      busy = false;
      retry.disabled = false;
      return show(doc, result, email);
    }
    retry.addEventListener('click', function () { return attempt(); });
    return attempt();
  }

  var api = { readToken: readToken, outcome: outcome, run: run, COPY: COPY, ROLE: ROLE, KEY: KEY, MAX_AGE: MAX_AGE };
  if (typeof window !== 'undefined') {
    window.VeyletJoin = api;
    if (!window.VEYLET_JOIN_MANUAL) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(window); });
      else run(window);
    }
  }
})();
