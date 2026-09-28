const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require('node:path').join(__dirname, '../dist/enquiry.js'), 'utf8');
const ref = 'VY-123456781234423482341234';
function setup(options = {}) {
  const elements = {};
  for (const id of ['enquiry-copy', 'enquiry-copy-button', 'enquiry-copy-text', 'enquiry-copy-status', 'enquiry-reference', 'enquiry-followup', 'request-device-field', 'enquiry-route-next']) {
    elements[id] = { hidden: true, textContent: '', events: {}, addEventListener(name, callback) { this.events[name] = callback; }, focus() { this.focused = true; }, select() { this.selected = true; } };
  }
  const fields = { enquiry_ref: { value: '' }, _next: { value: 'https://veylet.com/thanks' }, device_model: { value: '' } };
  const choices = options.captureChoices ? ['self', 'unsure'].map(value => ({ value, checked: value === 'self' })) : [];
  const events = {};
  const values = { name_and_business: 'Fictional example', email: 'sample@example.invalid', location: 'Brisbane', audience: '<b>Show the meeting room</b>', _honey: 'do not copy', _subject: 'internal', ...options.values };
  const form = { dataset: { enquiryRoute: options.route || 'managed' }, addEventListener(name, callback) { events[name] = callback; }, querySelectorAll() { return choices; }, querySelector(selector) { return fields[selector.match(/name="([^"]+)"/)[1]]; } };
  const copied = [];
  vm.runInNewContext(script, {
    window: { crypto: options.noCrypto ? {} : { randomUUID: () => '12345678-1234-4234-8234-123456789abc' } },
    document: { querySelector: () => options.thanks ? null : form, getElementById: id => elements[id] },
    navigator: { clipboard: { writeText: async value => { if (options.copyError) throw new Error('denied'); copied.push(value); } } },
    FormData: class { get(name) { return values[name]; } }, URLSearchParams,
    location: { search: options.search || '' },
  });
  return { elements, fields, copied, choices, changeCapture(value) { choices.forEach(choice => { choice.checked = choice.value === value; }); events.change(); }, copy: () => elements['enquiry-copy-button'].events.click() };
}
test('each enquiry gets an opaque correlation reference without claiming delivery', async () => {
  const h = setup();
  assert.equal(h.fields.enquiry_ref.value, ref);
  assert.equal(h.fields._next.value, 'https://veylet.com/thanks?route=managed&ref=' + ref);
  assert.equal(h.elements['enquiry-copy'].hidden, false);
  assert.equal(h.copied.length, 0, 'copying requires an explicit click');
  await h.copy();
  assert.match(h.copied[0], /delivery has not been confirmed/);
  assert.match(h.copied[0], /sample@example.invalid/);
  assert.match(h.copied[0], /<b>Show the meeting room<\/b>/);
  assert.doesNotMatch(h.copied[0], /internal|do not copy/);
  assert.equal(h.elements['enquiry-copy-text'].value, h.copied[0], 'user content is assigned as text, not HTML');
  assert.equal(h.elements['enquiry-copy-button'].disabled, false);
});
test('clipboard denial leaves an accessible manual copy and no lost brief', async () => {
  const h = setup({ copyError: true, values: { device_model: 'Example device' } });
  await h.copy();
  assert.equal(h.elements['enquiry-copy-text'].hidden, false);
  assert.equal(h.elements['enquiry-copy-text'].selected, true);
  assert.match(h.elements['enquiry-copy-text'].value, /Exact device model: Example device/);
  assert.match(h.elements['enquiry-copy-status'].textContent, /does not send/);
});
test('reference support is optional and the original form destination remains usable', async () => {
  const h = setup({ noCrypto: true });
  assert.equal(h.fields._next.value, 'https://veylet.com/thanks');
  await h.copy();
  assert.doesNotMatch(h.copied[0], /Reference:/);
});
test('the return page accepts a well-formed reference as context, never a receipt', () => {
  const h = setup({ thanks: true, search: '?route=managed&ref=' + ref });
  assert.equal(h.elements['enquiry-reference'].hidden, false);
  assert.match(h.elements['enquiry-reference'].textContent, /does not confirm delivery/);
  assert.match(decodeURIComponent(h.elements['enquiry-followup'].href), new RegExp(ref));
});
test('injected, ambiguous and unknown return parameters are not reflected', () => {
  // '?route=partner' is unknown since the capture-partner programme was removed (29 September 2026).
  for (const search of ['?route=managed&ref=<script>', '?route=managed&ref=' + ref + '&ref=' + ref, '?route=__proto__&ref=' + ref, '?route=partner&route=managed&ref=' + ref, '?route=partner&ref=' + ref]) {
    const h = setup({ thanks: true, search });
    assert.equal(h.elements['enquiry-reference'].hidden, true);
    assert.equal(h.elements['enquiry-followup'].href, undefined);
  }
});


test('self-capture intent survives the form, recovery copy and next-step context', async () => {
  const h = setup({ captureChoices: true, search: '?capture=self', values: { device_model: 'iPhone 15 Pro' } });
  assert.equal(h.elements['request-device-field'].hidden, false);
  assert.match(h.fields._next.value, /&capture=self$/);
  await h.copy();
  assert.match(h.copied[0], /Capture route: I will capture it/);
  assert.match(h.copied[0], /Exact device model: iPhone 15 Pro/);
  const thanks = setup({ thanks: true, search: '?route=managed&ref=' + ref + '&capture=self' });
  assert.match(thanks.elements['enquiry-route-next'].textContent, /device check and one practice capture/);
  assert.match(thanks.elements['enquiry-route-next'].textContent, /Send from the app: it uploads in the background\. Check your account for rendering status\./);
  assert.doesNotMatch(thanks.elements['enquiry-route-next'].textContent, /usually (?:ready(?: in| within)?|within) 1.?2 hours/i);
  assert.doesNotMatch(thanks.elements['enquiry-route-next'].textContent, /private transfer route/);
});

test('an old visit link leads to capture advice and keeps the device in the brief', async () => {
  const h = setup({ captureChoices: true, search: '?capture=visit', values: { device_model: 'Retained device' } });
  assert.equal(h.elements['request-device-field'].hidden, false);
  assert.equal(h.fields.device_model.disabled, false);
  assert.match(h.fields._next.value, /&capture=unsure$/);
  await h.copy();
  assert.match(h.copied[0], /Capture route: Help me choose/);
  assert.match(h.copied[0], /Retained device/);
  h.changeCapture('self');
  assert.equal(h.fields.device_model.disabled, false);
  await h.copy();
  assert.match(h.copied[1], /Retained device/);
  const oldThanks = setup({ thanks: true, search: '?route=managed&ref=' + ref + '&capture=visit' });
  assert.match(oldThanks.elements['enquiry-route-next'].textContent, /Studio visits are not currently available/);
});

test('unknown or duplicate capture intent never becomes a personalised return message', () => {
  for (const tail of ['&capture=arbitrary', '&capture=self&capture=visit', '&capture=__proto__']) {
    const h = setup({ thanks: true, search: '?route=managed&ref=' + ref + tail });
    assert.equal(h.elements['enquiry-route-next'].hidden, true);
  }
  const partner = setup({ thanks: true, search: '?route=partner&ref=' + ref + '&capture=self' });
  assert.equal(partner.elements['enquiry-route-next'].hidden, true);
  assert.equal(partner.elements['enquiry-reference'].hidden, true, 'the retired partner route is not a known route');
});

test('a form still marked as a partner enquiry is not wired up: the capture-partner route is retired', async () => {
  const h = setup({ route: 'partner' });
  assert.equal(h.fields.enquiry_ref.value, '');
  assert.equal(h.fields._next.value, 'https://veylet.com/thanks');
  assert.equal(h.elements['enquiry-copy'].hidden, true);
  assert.doesNotMatch(script, /Capture partner|partner:/);
});
