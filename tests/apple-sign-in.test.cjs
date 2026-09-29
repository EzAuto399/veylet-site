/*
 * Sign in with Apple on the account pages (/account, /app/account): the capture app's
 * first choice, landing in the same Supabase account. The button sits above the email
 * form and hides with it; a press opens Apple's popup through Apple's JS (Services ID
 * com.veylet.web) and signs in to Supabase with the identity token and raw nonce, and the
 * new session routes as after an email code. /auth/callback, still the email link's
 * return, turns an error in its address into fixed words and a retry link. Synthetic
 * stubs only: nothing here reaches Apple or Supabase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const DIST = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');
const account = read('account.js');
const PAGES = { web: read('account/index.html'), app: read('app/account/index.html'), callback: read('auth/callback/index.html') };
const TOUR = 'dddddddd-2222-4333-8444-555555555555';
const UNAVAILABLE = 'Apple sign-in isn’t available right now. Use email instead.';

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return key in this.attributes ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelector() { return null; }
  focus() {} reset() {}
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
}

const tick = async (count = 3) => { for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve)); };
const APPLE_JS = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const sha256hex = value => crypto.createHash('sha256').update(value).digest('hex');
const SESSION = { user: { id: 'user-1', email: 'person@example.invalid' }, access_token: 'token-1' };

// Apple's JS as a stand-in: init is recorded, signIn answers as `answer` says (default: a token
// for the state it was given).
function appleStub(answer) {
  const inits = [];
  return { inits, AppleID: { auth: {
    init: config => { inits.push({ ...config }); },
    signIn: async () => (answer ? answer(inits[inits.length - 1]) : { authorization: { id_token: 'synthetic.id.token', code: 'c', state: inits[inits.length - 1].state } }),
  } } };
}

async function load({ page = 'web', pathname, search = '', hash = '', session = null, appMode = page === 'app', apple = appleStub(), idToken, sdk } = {}) {
  const ids = {};
  for (const match of PAGES[page].matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1]);
    ids[match[2]].hidden = /\shidden[\s>]/.test(match[0]);
  }
  const calls = [], redirects = [], windowEvents = {}, scripts = [], idle = [];
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signInWithOtp: async input => { calls.push(['otp', input]); return {}; },
      // Supabase announces a new session on its own event, as it does after an email code.
      signInWithIdToken: async input => {
        calls.push(['idToken', input]);
        const answer = idToken ? await idToken(input) : { data: { session: SESSION }, error: null };
        if (answer?.data?.session) supabase.auth.callback('SIGNED_IN', answer.data.session);
        return answer;
      },
      verifyOtp: async () => ({}),
      signOut: async () => ({}),
    },
    from() { const builder = { select: () => builder, order: () => builder, eq: () => builder, single: async () => ({ data: null }), then: (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject) }; return builder; },
    async rpc(name) { calls.push([name]); return { error: { code: 'PGRST202', message: 'Could not find the function' } }; },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, addEventListener: (name, handler) => { windowEvents[name] = handler; } };
  if (apple) window.AppleID = apple.AppleID;
  const documentStub = { hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener() {}, querySelector: () => null,
    // Apple's script tag: `sdk` decides the load ('fail' or a stand-in AppleID to install).
    head: { append: el => { scripts.push(el.src); Promise.resolve().then(() => { if (sdk && sdk !== 'fail') { window.AppleID = sdk.AppleID; el.onload?.(); } else el.onerror?.(); }); } } };
  if (appMode) documentStub.documentElement = { dataset: { appMode: 'true' } };
  const context = { window, document: documentStub, URL, URLSearchParams, Date, Blob: class {}, navigator: {},
    crypto: crypto.webcrypto, TextEncoder, btoa,
    location: { pathname: pathname || (page === 'app' ? '/app/account' : page === 'callback' ? '/auth/callback' : '/account'), search, hash,
      replace: value => redirects.push(value), assign: value => redirects.push(value) },
    setTimeout: (fn, ms) => { if (ms === 1500) { idle.push(fn); return 0; } const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key]; } } };
  await vm.runInNewContext(account, context);
  await tick();
  return { ids, calls, redirects, windowEvents, scripts, apple, status: () => ids['account-status'].textContent,
    idle: () => { for (const fn of idle.splice(0)) fn(); },
    idTokens: () => calls.filter(([name]) => name === 'idToken').map(([, input]) => input) };
}

test('each sign-in page puts Sign in with Apple first, above the email form, per Apple’s web button guidelines', () => {
  const pages = Object.entries({ '/account': PAGES.web, '/app/account': PAGES.app });
  // Every page that carries the sign-in form is one of these two.
  const withForm = [];
  (function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'vendor') walk(full);
    else if (entry.name.endsWith('.html') && /id="account-sign-in"/.test(fs.readFileSync(full, 'utf8'))) withForm.push(path.relative(DIST, full));
  } })(DIST);
  assert.deepEqual(withForm.sort(), ['account/index.html', 'app/account/index.html']);
  for (const [name, html] of pages) {
    const form = html.match(/<form id="account-sign-in"[\s\S]*?<\/form>/)[0];
    const apple = form.indexOf('id="account-apple"'), or = form.indexOf('or use email'), email = form.indexOf('name="email"');
    assert.ok(apple > 0 && apple < or && or < email, name + ': Apple, then "or use email", then the email field');
    const button = form.match(/<button class="apple-button" type="button" id="account-apple">([\s\S]*?)<\/button>/);
    assert.ok(button, name + ': a plain button, never the form’s submit');
    assert.match(button[1], /<svg class="apple-logo" viewBox="0 0 814 1000" aria-hidden="true" focusable="false"><path d="M788\.1 340\.9/, name + ': the Apple logo as inline SVG');
    assert.equal(button[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 'Sign in with Apple', name);
    assert.match(form, /<p class="apple-note">One tap, no password\. New to Veylet\? This creates your account\.<\/p>/, name);
    assert.match(html, /Use the same sign-in on the website and capture app: Apple, or the same email\./, name);
  }
  const css = read('account-guide.css');
  const rule = css.match(/\.apple-button \{([\s\S]*?)\}/)[1];
  assert.match(rule, /min-height: 48px;/);
  assert.match(rule, /background: #000;/);
  assert.match(rule, /color: #fff;/);
  assert.match(rule, /border-radius: 0;/, 'square corners, like the site’s .button');
  for (const page of ['account/index.html', 'app/account/index.html']) assert.match(read(page), /account-guide\.css\?v=/, page + ' loads the button’s style');
});

test('a press opens Apple’s popup for com.veylet.web with a hashed nonce, and gives Supabase the raw nonce and the token', async () => {
  const h = await load();
  await h.ids['account-apple'].fire('click'); await tick();
  assert.equal(h.apple.inits.length, 1);
  const [init] = h.apple.inits;
  assert.deepEqual({ ...init, state: undefined, nonce: undefined }, { clientId: 'com.veylet.web', scope: 'name email', redirectURI: 'https://veylet.com/auth/callback', state: undefined, nonce: undefined, usePopup: true });
  const [sent] = h.idTokens();
  assert.deepEqual(Object.keys(sent).sort(), ['nonce', 'provider', 'token']);
  assert.equal(sent.provider, 'apple');
  assert.equal(sent.token, 'synthetic.id.token');
  assert.match(sent.nonce, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.equal(init.nonce, sha256hex(sent.nonce), 'Apple gets the lowercase SHA-256 hex of the raw nonce');
  assert.match(init.state, /^[A-Za-z0-9_-]{22}$/);
  // Each press has its own nonce and state.
  const again = await load();
  await again.ids['account-apple'].fire('click'); await tick();
  assert.notEqual(again.idTokens()[0].nonce, sent.nonce);
  assert.notEqual(again.apple.inits[0].state, init.state);
});

test('after Apple, the session routes exactly as after an email code: ?join= to the invite, the desk otherwise', async () => {
  const joined = await load({ search: '?join=1' });
  await joined.ids['account-apple'].fire('click'); await tick(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(joined.redirects, ['/join']);
  for (const [page, search] of [['web', ''], ['web', '?tour=' + TOUR], ['app', '?join=1'], ['app', '?tour=' + TOUR]]) {
    const h = await load({ page, search });
    await h.ids['account-apple'].fire('click'); await tick(); await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(h.redirects, [], page + search + ': no detour; the desk opens here');
    assert.equal(h.ids['account-home'].hidden, false, page + search);
    assert.equal(h.ids['account-sign-in'].hidden, true, page + search);
    assert.equal(h.ids['account-title'].textContent, 'Your account.');
  }
});

test('the Apple button is busy while Apple’s window is open and refuses a second press', async () => {
  let answer;
  const apple = appleStub(config => new Promise(resolve => { answer = () => resolve({ authorization: { id_token: 'synthetic.id.token', state: config.state } }); }));
  const h = await load({ apple });
  const button = h.ids['account-apple'];
  const pressed = button.fire('click'); await tick();
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(h.status(), 'Opening Apple sign-in…');
  await button.fire('click');
  assert.equal(apple.inits.length, 1, 'one popup');
  answer(); await pressed; await tick();
  assert.equal(h.idTokens().length, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), null);
});

test('closing Apple’s window is quiet; a state mismatch, a blocked popup, a failed load or a Supabase refusal fall back to email', async () => {
  for (const error of ['popup_closed_by_user', 'user_cancelled_authorize']) {
    const h = await load({ apple: appleStub(() => { throw { error }; }) });
    const before = h.status();
    await h.ids['account-apple'].fire('click'); await tick();
    assert.equal(h.status(), before, error + ': the page says what it said before');
    assert.equal(h.ids['account-apple'].disabled, false);
    assert.equal(h.idTokens().length, 0);
  }
  const cases = {
    'state mismatch': { apple: appleStub(() => ({ authorization: { id_token: 'synthetic.id.token', state: 'someone-else' } })) },
    'no token': { apple: appleStub(config => ({ authorization: { state: config.state } })) },
    'popup blocked': { apple: appleStub(() => { throw { error: 'popup_blocked_by_browser' }; }) },
    'script failed': { apple: null, sdk: 'fail' },
    'script without AppleID': { apple: null, sdk: { AppleID: undefined } },
    'supabase refused': { idToken: () => ({ data: { session: null }, error: { message: 'Unacceptable audience in id_token: [com.veylet.web]' } }) },
    'supabase unreachable': { idToken: () => { throw new TypeError('Failed to fetch'); } },
  };
  for (const [name, options] of Object.entries(cases)) {
    const h = await load(options);
    await h.ids['account-apple'].fire('click'); await tick(5);
    assert.equal(h.status(), UNAVAILABLE, name);
    assert.equal(h.ids['account-apple'].disabled, false, name);
    assert.equal(h.ids['account-sign-in'].hidden, false, name + ': the email form stays');
    if (/state|token|popup/.test(name)) assert.equal(h.idTokens().length, 0, name + ': nothing reaches Supabase');
  }
});

test('Apple’s script loads only on the signed-out sign-in pages, once, when idle or on the first press', async () => {
  const stub = appleStub();
  const h = await load({ apple: null, sdk: stub });
  assert.deepEqual(h.scripts, [], 'nothing before the browser is idle');
  h.idle(); await tick();
  assert.deepEqual(h.scripts, [APPLE_JS]);
  await h.ids['account-apple'].fire('click'); await tick();
  assert.deepEqual(h.scripts, [APPLE_JS], 'loaded once');
  assert.equal(stub.inits.length, 1);
  // Pressed before idle: the press loads it.
  const early = await load({ apple: null, sdk: appleStub() });
  await early.ids['account-apple'].fire('click'); await tick(5);
  assert.deepEqual(early.scripts, [APPLE_JS]);
  assert.equal(early.idTokens().length, 1);
  for (const options of [{ session: SESSION }, { page: 'callback' }]) {
    const quiet = await load({ ...options, apple: null, sdk: appleStub() });
    quiet.idle(); await tick();
    assert.deepEqual(quiet.scripts, [], JSON.stringify(options));
  }
  for (const page of ['account/index.html', 'app/account/index.html', 'auth/callback/index.html']) assert.doesNotMatch(read(page), /appleid/, page + ': no Apple script in the page itself');
});

test('the QA fixture stands in for Apple: nothing is loaded from Apple or sent to Apple', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
  assert.doesNotMatch(source, /appleid\.(?:apple|cdn-apple)\.com/);
  const context = { URLSearchParams, location: { search: '?session=out', pathname: '/__qa/account/' }, navigator: {},
    localStorage: { getItem: () => null, setItem() {} }, document: { createElement: () => ({}), addEventListener() {} } };
  context.window = context;
  vm.runInNewContext(source, context);
  assert.equal(typeof context.AppleID.auth.init, 'function', 'the page sees AppleID and never adds Apple’s script');
  await assert.rejects(context.AppleID.auth.signIn(), value => value.error === 'fixture_no_apple');
  const answer = await context.supabase.createClient().auth.signInWithIdToken({ provider: 'apple', token: 'x', nonce: 'y' });
  assert.ok(answer.error);
});

test('the Apple button hides with the email form while a code is awaited and once signed in', async () => {
  const h = await load();
  h.ids['account-sign-in'].values = { email: 'owner@example.invalid', role_intent: 'owner' };
  await h.ids['account-sign-in'].fire('submit');
  assert.equal(h.ids['account-sign-in'].hidden, true, 'the button is inside the form, so it hides too');
  await h.ids['account-apple'].fire('click'); await tick();
  assert.equal(h.apple.inits.length, 0, 'no Apple popup while a code is awaited');
  const signedIn = await load({ session: SESSION });
  assert.equal(signedIn.ids['account-sign-in'].hidden, true);
  await signedIn.ids['account-apple'].fire('click'); await tick();
  assert.equal(signedIn.apple.inits.length, 0);
});

test('/auth/callback still completes an email link, and turns an error in its address into fixed words and a retry link', async () => {
  // The code exchange is supabase-js's own (detectSessionInUrl, PKCE); a session goes back where sign-in began.
  const session = SESSION;
  assert.deepEqual((await load({ page: 'callback', search: '?code=synthetic-code', session })).redirects, ['/account']);
  assert.deepEqual((await load({ page: 'callback', search: '?code=synthetic-code&app=1&tour=' + TOUR, session })).redirects, ['/app/account?tour=' + TOUR]);
  assert.match(PAGES.callback, /<a class="button" href="\/account" id="auth-retry">Sign in again/);
  assert.doesNotMatch(PAGES.callback, /Sign-in link received/, 'the page no longer assumes an email link');
  for (const [search, hash, words, retry] of [
    ['?error=access_denied&error_code=provider_disabled&error_description=Unsupported+provider%3A+provider+is+not+enabled', '', UNAVAILABLE, '/account'],
    ['?app=1&tour=' + TOUR + '&error=server_error&error_description=Unable+to+exchange+external+code', '', 'Sign-in did not complete. Sign in again, or use email instead.', '/app/account?tour=' + TOUR],
    ['?join=1&error=access_denied&error_description=The+user+cancelled+the+request', '', 'Sign-in was cancelled. Nothing changed. Sign in again when you’re ready.', '/account?join=1'],
    ['', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', 'That sign-in link has expired or was already used. Sign in again for a new one.', '/account'],
    ['?error=invalid_request&error_description=Call+0400+000+000+to+finish+signing+in', '', 'Sign-in did not complete. Sign in again, or use email instead.', '/account'],
  ]) {
    const h = await load({ page: 'callback', search, hash });
    assert.equal(h.status(), words, search + hash);
    assert.equal(h.ids['auth-retry'].href, retry, search + hash);
    assert.deepEqual(h.redirects, []);
    assert.doesNotMatch(h.status(), /0400|exchange external/, 'the address’s own words are never shown');
  }
  const plain = await load({ page: 'callback' });
  assert.equal(plain.status(), 'Sign-in did not complete. Sign in again.');
});
