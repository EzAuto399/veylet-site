/*
 * /request (dist/request/index.html + dist/enquiry.js) since 30 September 2026: the walkthrough enquiry goes
 * to rpc/submit_enquiry on the hosted database (the product repository's enquiry migration), which stores
 * it and emails the studio a copy and the person a confirmation. The page shows the database's reference,
 * never one of its own; FormSubmit is gone from the whole site. Fictional data only; no host is contacted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element, elementsById, FakeFormData, recordingFetch } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const markup = fs.readFileSync(path.join(dist, 'request/index.html'), 'utf8');
const script = fs.readFileSync(path.join(dist, 'enquiry.js'), 'utf8');
const CONFIG = { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' };
const REF = 'VY-0123456789abcdef01234567';
const PARAMS = ['p_name_and_business', 'p_email', 'p_space_category', 'p_location', 'p_audience', 'p_capture_route',
  'p_device_model', 'p_timing', 'p_size_and_rooms', 'p_enquiry_as', 'p_agency_fit', 'p_honey'];
const ANSWERS = {
  capture_route: 'self', name_and_business: '  Sam   Example  ', email: ' sam@example.invalid ', space_category: 'Home',
  location: ' Parramatta ', audience: 'Buyers from interstate.\nThey need the kitchen and yard.', timing: '', device_model: '',
  size_and_rooms: '', enquiry_as: '', agency_fit: '', _honey: '',
};
const FIELDS = ['device_model', 'name_and_business', 'email', 'space_category', 'location', 'audience', 'timing',
  'size_and_rooms', 'enquiry_as', 'agency_fit', '_honey'];

function page(answers = [], { values = {}, config = CONFIG } = {}) {
  const ids = elementsById(markup);
  const { fetch, requests } = recordingFetch(answers);
  const form = new Element('form');
  form.dataset = { enquiryRoute: 'managed' };
  form.data = new FakeFormData({ ...ANSWERS, ...values });
  const controls = Object.fromEntries(FIELDS.map(name => [name, new Element(name === 'audience' ? 'textarea' : 'input')]));
  const choices = ['self', 'unsure'].map(value => Object.assign(new Element('input'), { value, checked: value === 'self' }));
  const button = new Element('button');
  button.innerHTML = 'Ask about my space <span class="icon-arrow" aria-hidden="true"></span>';
  form.selectors = { 'button[type="submit"]': button };
  for (const [name, control] of Object.entries(controls)) form.selectors[`[name="${name}"]`] = control;
  form.lists = { '[name="capture_route"]': choices };
  const store = new Map([['veylet-draft-managed', '{"at":1,"values":{}}']]);
  const events = [];
  const doc = { getElementById: id => ids[id] || null, querySelector: sel => (sel === 'form[data-enquiry-route]' ? form : null),
    createElement: tag => new Element(tag) };
  const window = {
    document: doc, fetch, VEYLET_SUPABASE: config, location: { search: '' },
    FormData: class { constructor(target) { return target.data; } },
    localStorage: { removeItem: key => store.delete(key) }, setTimeout: callback => callback(),
    VeyletAnalytics: { track: (name, props) => { events.push({ name, props }); return true; } },
    navigator: { clipboard: { writeText: async () => {} } },
  };
  vm.runInNewContext(script, { window, document: doc, location: window.location, URLSearchParams });
  return { ids, form, controls, choices, button, window, requests, store, events, submit: () => form.fire('submit') };
}

// Objects made inside the vm context have that context's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const received = () => ({ status: 200, body: { state: 'received', reference: REF } });
const statusText = p => p.ids['request-status'].textContent;
const NOT_SAVED = 'We couldn’t send your enquiry just now, so nothing was saved. Try again in a minute, or email support@veylet.com.';

test('received: one POST to rpc/submit_enquiry with exactly the RPC parameters; the form gives way to the server reference', async () => {
  const p = page([received()]);
  const event = await p.submit();
  assert.equal(event.defaultPrevented, true, 'the browser never submits the form itself');
  assert.equal(p.requests.length, 1);
  const [request] = p.requests;
  assert.equal(request.url, 'https://project.supabase.invalid/rest/v1/rpc/submit_enquiry');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.referrerPolicy, 'no-referrer');
  assert.deepEqual(plain(request.init.headers), { apikey: 'public-anon-key', Authorization: 'Bearer public-anon-key', 'Content-Type': 'application/json' });
  assert.deepEqual(Object.keys(request.body), PARAMS);
  assert.deepEqual(request.body, {
    p_name_and_business: 'Sam Example', p_email: 'sam@example.invalid', p_space_category: 'Home', p_location: 'Parramatta',
    p_audience: 'Buyers from interstate.\nThey need the kitchen and yard.', p_capture_route: 'self', p_device_model: null,
    p_timing: null, p_size_and_rooms: null, p_enquiry_as: null, p_agency_fit: null, p_honey: null,
  });
  for (const retired of ['_subject', '_next', '_template', 'enquiry_ref', 'p_description']) assert.equal(retired in request.body, false, retired);
  assert.equal(p.form.hidden, true);
  assert.equal(p.ids['request-done'].hidden, false);
  assert.equal(p.ids['request-done-reference'].textContent, 'Your reference is ' + REF + '.');
  assert.equal(p.ids['request-done-title'].focused, 1, 'focus moves to the success heading');
  assert.match(markup, /<h2 id="request-done-title" tabindex="-1">Received\.<\/h2>/);
  assert.match(/<section class="request-done"[\s\S]*?<\/section>/.exec(markup)[0], /<p>Check your inbox for a confirmation\.<\/p>/);
  assert.equal(p.store.has('veylet-draft-managed'), false, 'the kept draft is cleared once the database has it');
  assert.deepEqual(plain(p.events), [], 'no accepted-enquiry event exists, so a received enquiry is not measured');
});

test('the copy after a received enquiry carries the server reference', async () => {
  const p = page([received()]);
  await p.submit();
  let copied = '';
  p.window.navigator.clipboard.writeText = async value => { copied = value; };
  await p.ids['enquiry-copy-button'].fire('click');
  assert.match(copied, new RegExp('^Walkthrough enquiry\\nReference: ' + REF + '\\n'));
  assert.match(copied, /Email: sam@example\.invalid/);
});

test('optional answers and the capture choice are sent as given; a legacy visit choice becomes unsure', async () => {
  const p = page([received()], { values: { capture_route: 'visit', device_model: 'iPhone 15 Pro', timing: 'Next month',
    size_and_rooms: '3 bedrooms', enquiry_as: 'A homeowner or occupier', agency_fit: 'Line one\nLine two' } });
  await p.submit();
  assert.equal(p.requests[0].body.p_capture_route, 'unsure');
  assert.equal(p.requests[0].body.p_device_model, 'iPhone 15 Pro');
  assert.equal(p.requests[0].body.p_enquiry_as, 'A homeowner or occupier');
  assert.equal(p.requests[0].body.p_agency_fit, 'Line one\nLine two');
});

test('the honeypot is sent as p_honey and the server decides', async () => {
  const p = page([received()], { values: { _honey: 'filled by a robot' } });
  await p.submit();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].body.p_honey, 'filled by a robot');
  const failed = page([{ status: 200, body: { state: 'busy' } }], { values: { _honey: 'filled by a robot' } });
  await failed.submit();
  assert.deepEqual(plain(failed.events), [], 'a robot\'s outcome is never measured');
});

test('invalid: the page names the refused answer and focuses that field; the form stays usable', async () => {
  const p = page([{ status: 200, body: { state: 'invalid', field: 'email' } }, received()]);
  await p.submit();
  assert.equal(statusText(p), 'Your answer to “Email” wasn’t accepted, so nothing was saved. Check it and send again.');
  assert.equal(p.controls.email.focused, 1);
  assert.equal(p.form.hidden, false);
  assert.equal(p.ids['request-done'].hidden, true);
  assert.equal(p.button.disabled, false);
  assert.match(p.button.innerHTML, /Ask about my space/, 'the button is restored');
  assert.deepEqual(plain(p.events), [{ name: 'form_error', props: { form_id: 'request', error_code: 'validation' } }]);
  await p.submit();
  assert.equal(p.requests.length, 2, 'a corrected answer can be sent again');
  assert.equal(p.ids['request-done'].hidden, false);
});

test('invalid with an unknown field focuses the first question', async () => {
  const p = page([{ status: 200, body: { state: 'invalid', field: 'p_mystery' } }]);
  await p.submit();
  assert.equal(statusText(p), 'One answer wasn’t accepted, so nothing was saved. Check your answers and send again.');
  assert.equal(p.choices[0].focused, 1, 'the checked capture choice, the form\'s first question');
  const located = page([{ status: 200, body: { state: 'invalid', field: 'location' } }]);
  await located.submit();
  assert.equal(located.controls.location.focused, 1);
  assert.match(statusText(located), /“General area”/);
});

test('answers the server would refuse are not sent', async () => {
  for (const values of [{ email: 'no-at-sign.example.invalid' }, { email: 'sam@example' }, { space_category: 'Castle' },
    { location: 'x'.repeat(81) }, { enquiry_as: 'An alien' }, { audience: '   ' }]) {
    const p = page([received()], { values });
    await p.submit();
    assert.equal(p.requests.length, 0, JSON.stringify(values));
    assert.equal(p.form.hidden, false);
  }
});

test('busy: nothing saved, try again, with the support address as a mail link', async () => {
  const p = page([{ status: 200, body: { state: 'busy' } }]);
  await p.submit();
  assert.equal(statusText(p), 'We’re receiving a lot of enquiries right now, so nothing was saved. Try again in a minute, or email support@veylet.com.');
  const [link] = p.ids['request-status'].links();
  assert.equal(link.getAttribute('href'), 'mailto:support@veylet.com?subject=Veylet%20walkthrough%20enquiry');
  assert.equal(p.form.hidden, false);
  assert.equal(p.button.disabled, false);
  assert.equal(p.button.focused, 1, 'focus returns to the re-enabled button');
  assert.equal(p.store.has('veylet-draft-managed'), true, 'the draft is kept when nothing was saved');
  assert.deepEqual(plain(p.events), [{ name: 'form_error', props: { form_id: 'request', error_code: 'busy' } }]);
});

test('errors: a failed call, an unreadable or unknown answer and a malformed reference all say nothing was saved', async () => {
  const cases = [
    { status: 500, body: { message: 'raw-error-canary' } }, new TypeError('offline'), { status: 200, body: { state: 'queued' } },
    { status: 200, body: null }, { status: 200, body: { state: 'received', reference: 'VY-123' } },
    { status: 200, body: { state: 'received', reference: 'VY-0123456789ABCDEF01234567' } }, { status: 200, body: { state: 'received' } },
  ];
  for (const answer of cases) {
    const p = page([answer]);
    await p.submit();
    assert.equal(statusText(p), NOT_SAVED, JSON.stringify(answer));
    assert.equal(p.ids['request-status'].links().length, 1);
    assert.equal(p.form.hidden, false);
    assert.equal(p.ids['request-done'].hidden, true, 'no success without a well-formed server reference');
    assert.equal(p.button.disabled, false);
    assert.deepEqual(plain(p.events), [{ name: 'form_error', props: { form_id: 'request', error_code: 'network' } }]);
    assert.doesNotMatch(JSON.stringify(p.events), /canary|Sam|example\.invalid|Parramatta/);
  }
});

test('missing: a 404 or PGRST202 is a missing function; a page without configuration sends nothing', async () => {
  for (const answer of [{ status: 404, body: { code: 'PGRST202' } }, { status: 404, body: null }, { status: 400, body: { code: 'PGRST202' } }]) {
    const p = page([answer]);
    await p.submit();
    assert.equal(p.requests.length, 1);
    assert.equal(statusText(p), NOT_SAVED);
    assert.deepEqual(plain(p.events), [{ name: 'form_error', props: { form_id: 'request', error_code: 'unavailable' } }]);
  }
  for (const config of [null, { url: CONFIG.url }, { anonKey: 'k' }]) {
    const p = page([received()], { config });
    await p.submit();
    assert.equal(p.requests.length, 0);
    assert.equal(statusText(p), NOT_SAVED);
    assert.equal(p.form.hidden, false);
  }
});

test('one request per submit intent: a repeat while sending sends nothing, and the button says Sending…', async () => {
  const p = page();
  let finish;
  let calls = 0;
  p.window.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = p.submit();
  await Promise.resolve();
  assert.equal(p.button.disabled, true);
  assert.equal(p.button.textContent, 'Sending…');
  assert.equal(statusText(p), 'Sending…');
  const repeat = await p.submit();
  assert.equal(repeat.defaultPrevented, true);
  assert.equal(calls, 1);
  finish({ ok: true, status: 200, json: async () => ({ state: 'received', reference: REF }) });
  await first;
  assert.equal(calls, 1);
  assert.equal(p.ids['request-done'].hidden, false);
});

test('the form has no form service: no action, hidden routing fields or client reference; it loads the database config', () => {
  const form = /<form\b[^>]*>/.exec(markup)[0];
  assert.doesNotMatch(form, /\baction=/);
  assert.match(form, /data-analytics-form="request"/);
  assert.doesNotMatch(markup, /name="(?:_subject|_next|_template|enquiry_ref|_replyto|_autoresponse)"/);
  assert.doesNotMatch(markup, /type="hidden"/);
  assert.match(markup, /class="honey-label" aria-hidden="true">Leave this field empty<input type="text" name="_honey" class="honey" tabindex="-1"/);
  const scripts = [...markup.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map(m => m[1]);
  assert.ok(scripts.includes('/supabase-public.js'));
  assert.ok(scripts.indexOf('/supabase-public.js') < scripts.indexOf('/enquiry.js'), 'config loads before the sender');
  assert.match(markup, /<noscript><p class="contact-note request-noscript">This form needs JavaScript\. Without it, email <a href="mailto:support@veylet\.com\?subject=Veylet%20walkthrough%20enquiry">support@veylet\.com<\/a>/);
  assert.doesNotMatch(markup, /place\.guardDoubleSubmit\(/, 'the navigation guard is not wired; enquiry.js restores the button');
});

test('the location asks for a general area only, and each maxlength matches the server limit', () => {
  assert.match(markup, /General area \(suburb or town\) — never a street address \*\s*<input name="location"[^>]*\bmaxlength="80"/);
  assert.match(markup, /For example, Parramatta or Geelong\. No street address or access details\./);
  const limits = { name_and_business: 200, email: 254, location: 80, audience: 1500, timing: 300, size_and_rooms: 300, agency_fit: 600, device_model: 120 };
  for (const [name, max] of Object.entries(limits)) {
    const tag = new RegExp(`<(?:input|textarea)\\b[^>]*\\bname="${name}"[^>]*>`).exec(markup)[0];
    assert.match(tag, new RegExp(`\\bmaxlength="${max}"`), name);
  }
  const options = [...markup.split('name="space_category"')[1].split('</select>')[0].matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]);
  assert.deepEqual(options, ['Home', 'Clinic', 'Hospitality', 'Venue', 'Showroom', 'Interior or installation', 'Other']);
  const as = [...markup.split('name="enquiry_as"')[1].split('</select>')[0].matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]);
  assert.deepEqual(as, ['A property agency or team', 'A homeowner or occupier', 'A business or venue', 'Something else']);
  assert.doesNotMatch(markup, /<(?:input|textarea)\b[^>]*name="description"/, 'the RPC\'s optional description is not asked');
});

test('no file in dist mentions FormSubmit or the former inbox', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const files = walk(dist);
  assert.ok(files.length > 100);
  for (const file of files) {
    const text = fs.readFileSync(file).toString('latin1');
    assert.doesNotMatch(text, /formsubmit/i, path.relative(dist, file));
    assert.doesNotMatch(text, /yodalai/i, path.relative(dist, file));
  }
});
