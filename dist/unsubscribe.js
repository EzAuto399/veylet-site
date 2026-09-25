/*
 * /unsubscribe: the link at the foot of a Veylet reminder email (the 7-day trial reminder). It reads the
 * token from ?t=, takes it out of the address bar, and asks the database once (rpc/unsubscribe_mail,
 * the sibling repository's 20260925110000_render_status.sql), which answers unsubscribed, already or
 * invalid. The page says which, in plain words; a failed request can be tried again. It names no person
 * and sends nothing but the token.
 */
(function () {
  'use strict';

  var COPY = {
    loading: {
      title: 'Unsubscribing…',
      message: 'One moment while we record your choice.',
    },
    unsubscribed: {
      title: 'You’re unsubscribed',
      message: 'We won’t send you reminder emails any more. Your account page still shows when your free months end and what happens next.',
    },
    already: {
      title: 'You’re already unsubscribed',
      message: 'Nothing has changed: reminder emails stopped earlier. Your account page still shows when your free months end.',
    },
    invalid: {
      title: 'This link doesn’t work',
      message: 'It may be incomplete, or the account it belonged to has been deleted. To stop reminder emails, write to support@veylet.com from the address that receives them.',
    },
    error: {
      title: 'We couldn’t record that',
      message: 'Nothing has changed yet. Try again in a minute; if it keeps failing, write to support@veylet.com.',
    },
  };

  function readToken(search) {
    var match = /(?:^|[?&])t=([0-9a-f]{64})(?:&|$)/.exec(search || '');
    return match ? match[1] : null;
  }

  function show(doc, state) {
    var copy = COPY[state];
    var main = doc.getElementById('main');
    if (main) main.setAttribute('data-state', state);
    doc.getElementById('unsubscribe-title').textContent = copy.title;
    doc.getElementById('unsubscribe-message').textContent = copy.message;
    doc.getElementById('unsubscribe-retry').hidden = state !== 'error';
    doc.getElementById('unsubscribe-scope').hidden = state !== 'unsubscribed' && state !== 'already';
    if (state !== 'loading') doc.getElementById('unsubscribe-title').focus();
    return state;
  }

  async function ask(fetchImpl, config, token) {
    try {
      var response = await fetchImpl(config.url + '/rest/v1/rpc/unsubscribe_mail', {
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
      if (!response.ok) return 'error';
      var answer = await response.json();
      var state = answer && answer.state;
      return state === 'unsubscribed' || state === 'already' || state === 'invalid' ? state : 'error';
    } catch (failure) {
      return 'error';
    }
  }

  async function run(win) {
    var doc = win.document;
    var token = readToken(win.location.search);
    // The token is a key to this one preference: keep it out of history and screenshots.
    if (win.history && typeof win.history.replaceState === 'function') {
      win.history.replaceState(null, '', win.location.pathname);
    }
    if (!token) return show(doc, 'invalid');
    var config = win.VEYLET_SUPABASE;
    if (!config || !config.url || !config.anonKey) return show(doc, 'error');
    var retry = doc.getElementById('unsubscribe-retry');
    var attempt = async function () {
      show(doc, 'loading');
      retry.disabled = true;
      var state = await ask(win.fetch.bind(win), config, token);
      retry.disabled = false;
      return show(doc, state);
    };
    retry.addEventListener('click', function () { return attempt(); });
    return attempt();
  }

  var api = { readToken: readToken, ask: ask, run: run, COPY: COPY };
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
