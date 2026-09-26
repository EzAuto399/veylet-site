'use strict';
// Public acquisition wiring and the intake boundary. No vendor SDK or hosted request runs here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element, elementsById, FakeFormData, recordingFetch } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const pages = ['index.html', 'start/index.html', 'offer/index.html', 'see/index.html',
  'waitlist/index.html', 'request/index.html', 'apply/index.html', 'privacy/index.html'];
const destinations = ['waitlist', 'request', 'apply', 'see', 'offer', 'start'];
const placements = ['header', 'hero', 'body', 'footer', 'sticky', 'form'];
const answers = { name: 'Synthetic Name Canary', email: 'canary@example.invalid',
  business_type: 'sales_agent', device: 'iphone_pro_lidar', region: 'Synthetic Region', channels: ['own_website'] };
const config = { url: 'https://fixture.invalid', anonKey: 'synthetic-public-key' };

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/\b([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], match[2] ?? '']));
}

function publicHtml(dir = dist, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === 'samples' || entry.name === 'vendor') return [];
    const file = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? publicHtml(path.join(dir, entry.name), file) : file.endsWith('.html') ? [file] : [];
  });
}

function fixture(replies = [{ status: 200, body: { state: 'joined' } }], overrides = {}) {
  const ids = elementsById(read('waitlist/index.html'));
  ids['waitlist-form'].data = new FakeFormData({ ...answers, ...overrides });
  const events = [];
  const request = recordingFetch(replies);
  const document = { getElementById: id => ids[id] || null, createElement: tag => new Element(tag) };
  const window = { document, VEYLET_WAITLIST_MANUAL: true, VEYLET_SUPABASE: config, fetch: request.fetch,
    FormData: class { constructor(form) { return form.data; } },
    VeyletAnalytics: { track(name, props) { events.push(JSON.parse(JSON.stringify({ name, props }))); } } };
  vm.runInNewContext(read('waitlist/waitlist.js'), { window, document, JSON, Promise, Object, String, encodeURIComponent });
  return { window, ids, events, requests: request.requests, api: window.VeyletWaitlist,
    send: () => window.VeyletWaitlist.send(window, ids['waitlist-form']) };
}

function validatorFixture(formID = 'waitlist', analytics) {
  const f = fixture();
  if (arguments.length > 1) f.window.VeyletAnalytics = analytics;
  const form = f.ids['waitlist-form'];
  if (formID === null) delete form.attributes['data-analytics-form'];
  else form.setAttribute('data-analytics-form', formID);
  const label = new Element('label');
  const control = new Element('input');
  Object.assign(control, { name: 'email', type: 'email', value: 'private-field-canary',
    willValidate: true, validity: { valid: false, typeMismatch: true }, dataset: {},
    closest: selector => selector === 'label' ? label : null,
    removeAttribute: name => { delete control.attributes[name]; }, scrollIntoView() {} });
  form.elements = [control];
  const handlers = [], calledPhases = [];
  form.addEventListener = (name, handler, capture) => { handlers.push({ name, handler, capture: capture === true }); };
  form.fire = async name => {
    const event = { target: form, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; } };
    // Model the browser's at-target capture-before-bubble ordering, including the stop.
    for (const capture of [true, false]) {
      for (const entry of handlers.filter(entry => entry.name === name && entry.capture === capture)) {
        if (event.stopped) return event;
        calledPhases.push(capture ? 'capture' : 'bubble');
        await entry.handler(event);
      }
    }
    return event;
  };
  f.window.addEventListener = () => {};
  vm.runInNewContext(read('place-fields.js'), { window: f.window, document: f.window.document });
  f.api.run(f.window);
  return { ...f, form, control, calledPhases };
}

test('only the eight public acquisition pages load local analytics, in config-before-runtime order', () => {
  const loaded = [];
  for (const file of publicHtml()) {
    const html = read(file);
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(match => attrs(match[0]));
    const source = script => (script.src || '').split('?')[0];
    const configs = scripts.filter(script => source(script) === '/analytics-config.js');
    const runtimes = scripts.filter(script => source(script) === '/analytics.js');
    if (configs.length || runtimes.length) loaded.push(file);
    if (!pages.includes(file)) {
      assert.equal(configs.length + runtimes.length, 0, `${file} must not load acquisition trackers`);
      continue;
    }
    assert.equal(configs.length, 1, `${file} has one local config loader`);
    assert.equal(runtimes.length, 1, `${file} has one local runtime loader`);
    assert.ok('defer' in configs[0] && 'defer' in runtimes[0], `${file} defers both loaders`);
    assert.ok(scripts.indexOf(configs[0]) < scripts.indexOf(runtimes[0]), `${file} config loads first`);
    assert.match(html, /<link\b[^>]*href="\/analytics\.css(?:\?[^"]*)?"[^>]*>/, `${file} has consent styles`);
    assert.doesNotMatch(html, /<script\b[^>]*src="(?:https?:)?\/\/(?:[^/]*\.)?(?:googletagmanager\.com|facebook\.net)/i,
      `${file} does not bypass consent with a vendor script tag`);
  }
  assert.deepEqual(loaded.sort(), [...pages].sort());
});

test('public CTA hooks use fixed destinations and placements and intake forms keep separate IDs', () => {
  for (const file of pages) {
    const html = read(file);
    const hooks = [...html.matchAll(/<a\b[^>]*\bdata-analytics-cta="[^"]*"[^>]*>/g)].map(match => attrs(match[0]));
    assert.ok(hooks.length > 0, `${file} has explicit public CTA hooks`);
    for (const hook of hooks) {
      assert.ok(destinations.includes(hook['data-analytics-cta']), `${file} fixed destination`);
      assert.ok(placements.includes(hook['data-analytics-placement']), `${file} fixed placement`);
      assert.equal(hook.href, '/' + hook['data-analytics-cta'], `${file} the destination matches the actual link`);
      assert.notEqual(hook['aria-hidden'], 'true', `${file} decorative links are not CTAs`);
    }
  }
  for (const [file, id] of [['waitlist/index.html', 'waitlist'], ['request/index.html', 'request'], ['apply/index.html', 'apply']]) {
    const forms = [...read(file).matchAll(/<form\b[^>]*>/g)].map(match => attrs(match[0]));
    assert.equal(forms.filter(form => form['data-analytics-form'] === id).length, 1, `${file} fixed form ID`);
  }
  assert.doesNotMatch(read('offer/index.html'), /<form\b[^>]*data-analytics-form/, 'the price illustration is not intake');
});

test('a real accepted waitlist response emits only the safe accepted-submission event', async () => {
  const f = fixture();
  assert.equal(await f.send(), 'joined');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.events, [{ name: 'waitlist_submission_accepted', props: { form_id: 'waitlist' } }]);
  assert.equal(f.ids['waitlist-form'].hidden, true);
  assert.equal(f.ids['waitlist-done'].hidden, false);
  assert.doesNotMatch(JSON.stringify(f.events), /Canary|canary@|Synthetic Region|sales_agent|iphone_pro|own_website|synthetic-public-key/);
});

test('the conversion waits for the RPC; duplicate in-flight submits do not create duplicate requests', async () => {
  const f = fixture();
  let finish;
  let calls = 0;
  f.window.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  f.api.run(f.window);
  const first = f.ids['waitlist-form'].fire('submit');
  const duplicate = f.ids['waitlist-form'].fire('submit');
  await duplicate;
  assert.equal(calls, 1);
  assert.deepEqual(f.events, []);
  finish({ ok: true, status: 200, json: async () => ({ state: 'joined' }) });
  await first;
  assert.deepEqual(f.events, [{ name: 'waitlist_submission_accepted', props: { form_id: 'waitlist' } }]);
});

test('validation and RPC failures emit fixed error codes without false conversions or personal fields', async () => {
  const cases = [
    [fixture([], { email: 'invalid' }), 'validation'],
    [fixture([{ status: 404, body: { code: 'PGRST202' } }]), 'unavailable'],
    [fixture([{ status: 200, body: { state: 'busy' } }]), 'busy'],
    [fixture([{ status: 200, body: { state: 'invalid', field: 'email' } }]), 'validation'],
    [fixture([{ status: 500, body: { message: 'raw-error-canary@example.invalid' } }]), 'network'],
    [fixture([{ status: 200, body: { state: 'unknown' } }]), 'network'],
    [fixture([new TypeError('network-canary@example.invalid')]), 'network'],
  ];
  for (const [f, error_code] of cases) {
    await f.send();
    assert.deepEqual(f.events, [{ name: 'form_error', props: { form_id: 'waitlist', error_code } }]);
    assert.doesNotMatch(JSON.stringify(f.events), /Canary|canary@|Synthetic Region|sales_agent|iphone_pro|own_website|raw-error|synthetic-public-key/);
  }
  assert.equal(cases[0][0].requests.length, 0, 'invalid local answers never reach the API');
});

test('honeypot, DOM success and page loads never fabricate a submission outcome', async () => {
  const bot = fixture([], { _honey: 'bot' });
  await bot.send();
  assert.deepEqual(bot.events, []);
  assert.equal(bot.requests.length, 0);
  assert.equal(bot.ids['waitlist-done'].hidden, false, 'honeypot may show synthetic success without a conversion');
  const missingConfig = fixture(); missingConfig.window.VEYLET_SUPABASE = null;
  await missingConfig.send(); assert.deepEqual(missingConfig.events, [], 'no configured request produced an outcome');
  const shown = fixture(); shown.api.show(shown.window.document, 'joined');
  assert.deepEqual(shown.events, [], 'DOM success alone never emits');
  const fresh = fixture(); fresh.api.run(fresh.window);
  assert.deepEqual(fresh.events, [], 'a page load never implies a prior accepted submission');
});

test('the address guard emits only validation and never the private rejection text', async () => {
  const f = fixture();
  const region = new Element('input'); region.value = '12 Private Canary Street';
  f.ids['waitlist-form'].selectors = { '[name="region"]': region };
  f.window.VeyletPlace = { briefLocationProblem: () => 'private-address-canary: reject this location' };
  f.api.run(f.window);
  await f.ids['waitlist-form'].fire('submit');
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.events, [{ name: 'form_error', props: { form_id: 'waitlist', error_code: 'validation' } }]);
  assert.equal(region.focused, 1);
});

test('capture-phase validation emits one safe error before stopping the actual waitlist submit handler', async () => {
  const f = validatorFixture();
  const submitted = await f.form.fire('submit');
  assert.equal(f.form.noValidate, true, 'the real custom validator handles browser validation');
  assert.equal(submitted.defaultPrevented, true);
  assert.equal(submitted.stopped, true);
  assert.deepEqual(f.calledPhases, ['capture'], 'the waitlist bubble handler never receives this rejected submission');
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.events, [{ name: 'form_error', props: { form_id: 'waitlist', error_code: 'validation' } }]);
  assert.equal(f.control.value, 'private-field-canary', 'the typed answer remains intact');
  assert.equal(f.control.getAttribute('aria-invalid'), 'true');
  assert.equal(f.control.focused, 1);
  assert.match(f.ids['waitlist-status'].textContent, /One answer needs checking/);
});

test('capture-phase validation on private or uninstrumented forms produces no analytics event', async () => {
  for (const formID of [null, 'account', 'private-form-canary']) {
    const f = validatorFixture(formID);
    const submitted = await f.form.fire('submit');
    assert.equal(submitted.stopped, true);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.events, []);
  }
  const bot = validatorFixture();
  const honey = new Element('input'); honey.value = 'bot-canary';
  bot.form.selectors = { '[name="_honey"]': honey };
  await bot.form.fire('submit');
  assert.deepEqual(bot.events, [], 'an invalid honeypot submission is still silent');
  assert.equal(bot.requests.length, 0);
});

test('capture-phase rejection preserves validation behavior when optional analytics is absent or throws', async () => {
  for (const analytics of [undefined, { track() { throw new Error('unavailable'); } }]) {
    const f = validatorFixture('waitlist', analytics);
    const submitted = await f.form.fire('submit');
    assert.equal(submitted.stopped, true);
    assert.equal(f.requests.length, 0);
    assert.equal(f.control.value, 'private-field-canary');
    assert.equal(f.control.focused, 1);
    assert.match(f.ids['waitlist-status'].textContent, /One answer needs checking/);
  }
});

test('missing, rejecting or throwing analytics cannot prevent real waitlist completion or recovery', async () => {
  for (const analytics of [undefined, {}, { track: () => false }, { track() { throw new Error('blocked'); } }]) {
    const f = fixture(); f.window.VeyletAnalytics = analytics;
    assert.equal(await f.send(), 'joined');
    assert.equal(f.requests.length, 1);
    assert.equal(f.ids['waitlist-form'].hidden, true);
    assert.equal(f.ids['waitlist-done'].hidden, false);
    const busy = fixture([{ status: 200, body: { state: 'busy' } }]); busy.window.VeyletAnalytics = analytics;
    assert.equal(await busy.send(), 'busy');
    assert.equal(busy.ids['waitlist-form'].hidden, false);
    assert.equal(busy.ids['waitlist-fallback'].hidden, false);
  }
});

test('the public privacy notice distinguishes optional analytics, advertising and email choices', () => {
  const privacy = read('privacy/index.html').replace(/\s+/g, ' ');
  assert.match(privacy, /Google Analytics/);
  assert.match(privacy, /Meta Pixel/);
  assert.match(privacy, /Analytics and Advertising separately/);
  assert.match(privacy, /Privacy choices/);
  assert.match(privacy, /Email tips consent is separate/);
  assert.doesNotMatch(privacy, /we run no advertising cookies and no third-party trackers/);
  assert.match(privacy, /without accepting either/);
});
