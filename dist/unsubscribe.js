/*
 * /unsubscribe: the link at the foot of a Veylet email. Two kinds of email carry it with a 64-hex
 * token in ?t=, both built in the sibling repository:
 *   - tips and offers (docs/lifecycle-email.md; rpc/unsubscribe_email_tips, draft
 *     20260926114000_lifecycle_email.sql), and
 *   - the dispatcher's 7-day trial reminder (rpc/unsubscribe_mail, 20260925110000_render_status.sql),
 *     for as long as that email still carries the link.
 * The page reads the token, takes it out of the address bar, and asks both functions once each (the
 * token belongs to at most one of them). Each answers unsubscribed, already or invalid; a backend
 * without a function answers PGRST202 and that function is left out without a word. The page says
 * only "unsubscribed" or "This link has already been used or is not valid": it never names a person
 * and never says whether a token existed. A failed request can be tried again. It sends nothing but
 * the token, with the public key, no cookie and no referrer.
 */
(function () {
  'use strict';

  // Remove 'unsubscribe_mail' once the dispatcher's reminder no longer carries this link.
  var FUNCTIONS = ['unsubscribe_email_tips', 'unsubscribe_mail'];
  var KIND = { unsubscribe_email_tips: 'tips', unsubscribe_mail: 'reminder' };
  var SERVICE = 'Service messages about your account and walkthroughs still arrive.';

  var COPY = {
    loading: {
      title: 'Unsubscribing…',
      message: 'One moment while we record your choice.',
    },
    tips: {
      title: 'You’re unsubscribed',
      message: 'You’re unsubscribed from tips and offers. ' + SERVICE,
    },
    reminder: {
      title: 'You’re unsubscribed',
      message: 'You’re unsubscribed from reminder emails. Your account page still shows when your free months end. ' + SERVICE,
    },
    used: {
      title: 'Nothing changed',
      message: 'This link has already been used or is not valid.',
    },
    unavailable: {
      title: 'We couldn’t record that',
      message: 'Unsubscribing online isn’t available yet, so nothing has changed. Write to yoda@yodalai.xyz from the address that receives these emails and we’ll stop them.',
    },
    error: {
      title: 'We couldn’t record that',
      message: 'Nothing has changed yet. Try again in a minute; if it keeps failing, write to yoda@yodalai.xyz.',
    },
  };
  var NEXT = {
    tips: 'To change your email preferences, sign in to your account.',
    reminder: 'To change your email preferences, sign in to your account.',
    used: 'If you used this link before, you’re already unsubscribed. To check or change your email preferences, sign in to your account.',
  };

  function readToken(search) {
    var match = /(?:^|[?&])t=([0-9a-f]{64})(?:&|$)/.exec(search || '');
    return match ? match[1] : null;
  }

  /** One function's answer: unsubscribed, already, invalid, missing (not deployed) or error. */
  async function ask(fetchImpl, config, token, name) {
    try {
      var response = await fetchImpl(config.url + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: 'Bearer ' + config.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_token: token }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      var answer = null;
      try { answer = await response.json(); } catch (unreadable) { answer = null; }
      if (!response.ok) {
        var missing = answer && (answer.code === 'PGRST202' || /could not find the function/i.test(String(answer.message || '')));
        return missing ? 'missing' : 'error';
      }
      var state = answer && answer.state;
      return state === 'unsubscribed' || state === 'already' || state === 'invalid' ? state : 'error';
    } catch (failure) {
      return 'error';
    }
  }

  /*
   * What the page says, from every function's answer. The token is 256 random bits, so a function
   * that knows it decides: unsubscribed now, or already. Otherwise a failure is worth trying again;
   * no function deployed at all is not the link's fault; the rest is an unknown link.
   */
  function outcome(answers) {
    var names = Object.keys(answers);
    var states = names.map(function (name) { return answers[name]; });
    for (var i = 0; i < names.length; i += 1) {
      if (answers[names[i]] === 'unsubscribed') return KIND[names[i]] || 'tips';
    }
    if (states.indexOf('already') !== -1) return 'used';
    if (states.indexOf('error') !== -1) return 'error';
    if (states.length && states.every(function (state) { return state === 'missing'; })) return 'unavailable';
    return 'used';
  }

  function show(doc, state) {
    var copy = COPY[state];
    var main = doc.getElementById('main');
    if (main) main.setAttribute('data-state', state);
    doc.getElementById('unsubscribe-title').textContent = copy.title;
    doc.getElementById('unsubscribe-message').textContent = copy.message;
    doc.getElementById('unsubscribe-retry').hidden = state !== 'error';
    var next = doc.getElementById('unsubscribe-scope');
    next.textContent = NEXT[state] || '';
    next.hidden = !NEXT[state];
    if (state !== 'loading') doc.getElementById('unsubscribe-title').focus();
    return state;
  }

  async function run(win) {
    var doc = win.document;
    var token = readToken(win.location.search);
    // The token is a key to this one preference: keep it out of history and screenshots.
    if (win.history && typeof win.history.replaceState === 'function') {
      win.history.replaceState(null, '', win.location.pathname);
    }
    if (!token) return show(doc, 'used');
    var config = win.VEYLET_SUPABASE;
    if (!config || !config.url || !config.anonKey) return show(doc, 'error');
    var retry = doc.getElementById('unsubscribe-retry');
    var answers = {};
    var attempt = async function () {
      show(doc, 'loading');
      retry.disabled = true;
      // Only a function that failed is asked again; a settled answer stands.
      var pending = FUNCTIONS.filter(function (name) { return !answers[name] || answers[name] === 'error'; });
      var fetchImpl = win.fetch.bind(win);
      var states = await Promise.all(pending.map(function (name) { return ask(fetchImpl, config, token, name); }));
      pending.forEach(function (name, index) { answers[name] = states[index]; });
      retry.disabled = false;
      return show(doc, outcome(answers));
    };
    retry.addEventListener('click', function () { return attempt(); });
    return attempt();
  }

  var api = { readToken: readToken, ask: ask, outcome: outcome, run: run, COPY: COPY, NEXT: NEXT, FUNCTIONS: FUNCTIONS };
  if (typeof window !== 'undefined') {
    window.VeyletUnsubscribe = api;
    if (!window.VEYLET_UNSUBSCRIBE_MANUAL) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { run(window); });
      } else {
        run(window);
      }
    }
  }
})();
