/*
 * Sign in with Apple on the account pages (/account, /app/account): the capture app's
 * first choice, landing in the same Supabase account. The button sits above the email
 * form and hides with it; a click asks Supabase for Apple with the same /auth/callback
 * return the email link uses, so ?tour=, ?join= and the app's edition come back where
 * they began. /auth/callback turns an error in its address into fixed words and a
 * retry link. Synthetic stubs only: nothing here reaches Apple or Supabase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

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

const tick = () => new Promise(resolve => setImmediate(resolve));

async function load({ page = 'web', pathname, search = '', hash = '', session = null, appMode = page === 'app', oauth, sessionStorage } = {}) {
  const ids = {};
  for (const match of PAGES[page === 'callback' ? 'callback' : page].matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1]);
    ids[match[2]].hidden = /\shidden[\s>]/.test(match[0]);
  }
  const calls = [], redirects = [], windowEvents = {};
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signInWithOtp: async input => { calls.push(['otp', input]); return {}; },
      signInWithOAuth: async input => { calls.push(['oauth', input]); return oauth ? oauth(input) : { data: { provider: input.provider, url: 'https://example.invalid/authorize' }, error: null }; },
      verifyOtp: async () => ({}),
      signOut: async () => ({}),
    },
    from() { const builder = { select: () => builder, order: () => builder, eq: () => builder, then: (resolve) => resolve({ data: [] }) }; return builder; },
    async rpc(name) { calls.push([name]); return { error: { code: 'PGRST202', message: 'Could not find the function' } }; },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, addEventListener: (name, handler) => { windowEvents[name] = handler; } };
  if (sessionStorage) window.sessionStorage = sessionStorage;
  const documentStub = { hidden: false, getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener() {}, querySelector: () => null };
  if (appMode) documentStub.documentElement = { dataset: { appMode: 'true' } };
  const context = { window, document: documentStub, URL, URLSearchParams, Date, Blob: class {}, navigator: {},
    location: { pathname: pathname || (page === 'app' ? '/app/account' : page === 'callback' ? '/auth/callback' : '/account'), search, hash,
      replace: value => redirects.push(value), assign: value => redirects.push(value) },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout, setInterval: () => 0, clearInterval() {},
    FormData: class { constructor(form) { this.values = form.values || {}; } get(key) { return this.values[key]; } } };
  await vm.runInNewContext(account, context);
  await tick();
  return { ids, calls, redirects, windowEvents, status: () => ids['account-status'].textContent,
    oauth: () => calls.filter(([name]) => name === 'oauth').map(([, input]) => input) };
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

test('a click asks Supabase for Apple with exactly the email link’s return, on every page and query', async () => {
  const store = () => { const data = {}; return { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); }, removeItem: key => { delete data[key]; }, data }; };
  for (const [page, search, expected] of [
    ['web', '', 'https://veylet.com/auth/callback'],
    ['web', '?tour=' + TOUR, 'https://veylet.com/auth/callback?tour=' + TOUR],
    ['web', '?join=1', 'https://veylet.com/auth/callback?join=1'],
    ['web', '?tour=SECRET', 'https://veylet.com/auth/callback'],
    ['app', '', 'https://veylet.com/auth/callback?app=1'],
    ['app', '?tour=' + TOUR, 'https://veylet.com/auth/callback?app=1&tour=' + TOUR],
    ['app', '?join=1', 'https://veylet.com/auth/callback?app=1&join=1'],
  ]) {
    const session = store();
    const h = await load({ page, search, sessionStorage: session });
    assert.equal(h.ids['account-apple'].hidden, false);
    await h.ids['account-apple'].fire('click');
    assert.deepEqual(JSON.parse(JSON.stringify(h.oauth())), [{ provider: 'apple', options: { redirectTo: expected } }], page + search);
    assert.equal(session.data['veylet-auth-edition'], page === 'app' ? 'app' : undefined, 'the edition is kept as for an email link');
    // The email path from the same page returns to the same address.
    const email = await load({ page, search });
    email.ids['account-sign-in'].values = { email: 'owner@example.invalid', role_intent: 'owner' };
    await email.ids['account-sign-in'].fire('submit');
    assert.equal(email.calls.find(([name]) => name === 'otp')[1].options.emailRedirectTo, expected, page + search);
  }
});

test('the Apple button is busy until the page leaves, refuses a second press, and comes back from the back button', async () => {
  let answer;
  const h = await load({ oauth: () => new Promise(resolve => { answer = resolve; }) });
  const button = h.ids['account-apple'];
  const pressed = button.fire('click');
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(h.status(), 'Opening Apple sign-in…');
  await button.fire('click');
  assert.equal(h.oauth().length, 1, 'one request');
  answer({ data: { provider: 'apple', url: 'https://example.invalid/authorize' }, error: null });
  await pressed;
  assert.equal(button.disabled, true, 'still busy while the browser goes to Apple');
  h.windowEvents.pageshow({ persisted: true });
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-busy'), null);
});

test('an unavailable Apple provider falls back to email in the page’s own status line', async () => {
  for (const oauth of [() => ({ data: { provider: 'apple', url: null }, error: { message: 'Unsupported provider: provider is not enabled', status: 400 } }),
    () => { throw new Error('Failed to fetch'); }]) {
    const h = await load({ oauth });
    await h.ids['account-apple'].fire('click');
    assert.equal(h.status(), UNAVAILABLE);
    assert.equal(h.ids['account-apple'].disabled, false);
    assert.equal(h.ids['account-apple'].getAttribute('aria-busy'), null);
    assert.equal(h.ids['account-sign-in'].hidden, false, 'the email form stays');
    assert.equal(h.ids['account-sign-in-submit'].disabled, false);
  }
});

test('the Apple button hides with the email form while a code is awaited and once signed in', async () => {
  const h = await load();
  h.ids['account-sign-in'].values = { email: 'owner@example.invalid', role_intent: 'owner' };
  await h.ids['account-sign-in'].fire('submit');
  assert.equal(h.ids['account-sign-in'].hidden, true, 'the button is inside the form, so it hides too');
  await h.ids['account-apple'].fire('click');
  assert.equal(h.oauth().length, 0, 'no Apple request while a code is awaited');
  const signedIn = await load({ session: { user: { id: 'user-1', email: 'person@example.invalid' }, access_token: 'token-1' } });
  assert.equal(signedIn.ids['account-sign-in'].hidden, true);
  await signedIn.ids['account-apple'].fire('click');
  assert.equal(signedIn.oauth().length, 0);
});

test('/auth/callback completes an Apple return like an email link, and turns an error into fixed words and a retry link', async () => {
  // The code exchange is supabase-js's own (detectSessionInUrl, PKCE) for both; a session goes back where sign-in began.
  const session = { user: { id: 'user-1', email: 'person@example.invalid' }, access_token: 'token-1' };
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
