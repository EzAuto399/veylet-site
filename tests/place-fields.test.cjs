const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const handlers = new Map();
  const timers = new Map(); let timerId = 0;
  const window = { addEventListener(name, callback) { handlers.set(name, callback); }, setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/place-fields.js'), 'utf8'), { window });
  let markup = 'Send enquiry <span aria-hidden="true">↗</span>';
  const button = {
    disabled: false,
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; },
    set textContent(value) { markup = value; },
  };
  const status = { textContent: '' };
  let submit;
  const form = {
    querySelector: () => button,
    addEventListener(name, callback) { assert.equal(name, 'submit'); submit = callback; },
  };
  window.VeyletPlace.guardDoubleSubmit(form, status);
  return {
    button, status,
    submit(prevented = false) {
      const event = { defaultPrevented: prevented, preventDefault() { this.defaultPrevented = true; } };
      submit(event);
      return event;
    },
    restore(persisted) { handlers.get('pageshow')({ persisted }); },
    expire() { for (const callback of timers.values()) callback(); timers.clear(); },
  };
}

test('a duplicate submit is stopped while a first submission is in progress', () => {
  const page = setup();
  assert.equal(page.submit().defaultPrevented, false);
  assert.equal(page.button.disabled, true);
  assert.equal(page.submit().defaultPrevented, true);
  assert.match(page.status.textContent, /in progress/);
  assert.doesNotMatch(page.status.textContent, /already sent|received/i);
});

test('a validation-prevented submission does not consume the submission attempt', () => {
  const page = setup();
  page.status.textContent = 'Use a suburb or city.';
  page.submit(true);
  assert.equal(page.button.disabled, false);
  assert.equal(page.status.textContent, 'Use a suburb or city.');
  assert.equal(page.submit().defaultPrevented, false);
  assert.equal(page.status.textContent, 'Opening the submission page…');
});

test('browser Back restores the original button and allows one deliberate new submission', () => {
  const page = setup();
  const original = page.button.innerHTML;
  page.submit();
  assert.equal(page.button.innerHTML, 'Sending…');
  page.restore(true);
  assert.equal(page.button.disabled, false);
  assert.equal(page.button.innerHTML, original);
  assert.match(page.status.textContent, /wait for our email reply/);
  assert.equal(page.submit().defaultPrevented, false);
  assert.equal(page.submit().defaultPrevented, true);
  page.restore(true);
  assert.equal(page.button.disabled, false);
});

test('ordinary page show does not reset an in-flight submission', () => {
  const page = setup();
  page.submit();
  page.restore(false);
  assert.equal(page.button.disabled, true);
  assert.equal(page.submit().defaultPrevented, true);
});

test('a stalled external submission offers recovery without silently retrying or claiming failure', () => {
  const page = setup();
  page.submit(); page.expire();
  assert.match(page.status.textContent, /Delivery is uncertain/);
  assert.match(page.status.textContent, /Keep a copy/);
  assert.equal(page.button.disabled, true);
  assert.equal(page.submit().defaultPrevented, true);
});

test('browser Back retires the previous recovery timer', () => {
  const page = setup();
  page.submit(); page.restore(true);
  const message = page.status.textContent;
  page.expire();
  assert.equal(page.status.textContent, message);
});

/* ---- Inline validation and drafts -------------------------------------
 * A small DOM that behaves the way the real one does for the parts these two
 * helpers use: capture-phase listeners (blur does not bubble), label wrapping,
 * constraint validation, and a localStorage that can refuse to work.
 */
class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.childNodes = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.className = ''; this.id = '';
    this.name = ''; this.type = 'text'; this.value = ''; this.checked = false;
    this.required = false; this.maxLength = -1; this.willValidate = true;
    this.open = false; this.listeners = {};
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); this.childNodes.push(node); } }
  prepend(node) { node.parentNode = this; this.children.unshift(node); this.childNodes.unshift(node); }
  remove() {
    const parent = this.parentNode; if (!parent) return;
    parent.children = parent.children.filter(node => node !== this);
    parent.childNodes = parent.childNodes.filter(node => node !== this);
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler, capture) { (this.listeners[name] = this.listeners[name] || []).push({ handler, capture: capture === true }); }
  closest(selector) {
    const want = selector.toUpperCase();
    let node = this;
    while (node) { if (node.tagName === want) return node; node = node.parentNode; }
    return null;
  }
  focus() { this.wasFocused = true; }
  scrollIntoView() { this.wasScrolled = true; }
  all() { return this.children.flatMap(node => [node, ...(node.all ? node.all() : [])]); }
  set textContent(value) { this._text = String(value); this.children = []; this.childNodes = []; }
  get textContent() {
    if (this._text !== undefined) return this._text;
    return this.childNodes.map(node => node.textContent || '').join('');
  }
  get validity() {
    const empty = this.type === 'checkbox' ? !this.checked : !String(this.value || '').trim();
    const text = String(this.value || '');
    return {
      valueMissing: this.required && empty,
      typeMismatch: this.type === 'email' ? Boolean(text) && !/^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(text)
        : this.type === 'url' ? Boolean(text) && !/^https?:\/\/\S+$/.test(text) : false,
      patternMismatch: false,
      tooLong: this.maxLength > 0 && text.length > this.maxLength,
      get valid() { return !this.valueMissing && !this.typeMismatch && !this.patternMismatch && !this.tooLong; },
    };
  }
  get validationMessage() { return this.validity.valid ? '' : 'Please fill in this field.'; }
}
function textNode(text) { return { nodeType: 3, textContent: text }; }

function formPage(fields) {
  const registry = new Map();
  const document = {
    getElementById: id => registry.get(id) || null,
    createElement: tag => new FakeNode(tag),
  };
  const form = new FakeNode('form');
  form.noValidate = false;
  const controls = [];
  for (const spec of fields) {
    const holder = spec.inOptional ? (form.optional = form.optional || (() => {
      const details = new FakeNode('details'); form.append(details); return details;
    })()) : form;
    const label = new FakeNode('label');
    label.childNodes.push(textNode(spec.label || ''));
    const control = new FakeNode(spec.tag || 'input');
    Object.assign(control, { name: spec.name, type: spec.type || 'text', required: Boolean(spec.required), value: spec.value || '' });
    if (spec.type === 'checkbox') control.checked = Boolean(spec.checked);
    label.append(control);
    holder.append(label);
    controls.push(control);
  }
  form.elements = controls;
  // getElementById must see every element that has been given an id.
  const trackIds = () => { for (const node of [form, ...form.all()]) if (node.id) registry.set(node.id, node); };
  const dispatch = (target, name, event = {}) => {
    trackIds();
    const chain = []; let node = target;
    while (node) { chain.unshift(node); node = node.parentNode; }
    const detail = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...event };
    for (const node of chain) for (const entry of node.listeners[name] || []) if (entry.capture) entry.handler(detail);
    for (const node of [...chain].reverse()) for (const entry of node.listeners[name] || []) if (!entry.capture) entry.handler(detail);
    trackIds();
    return detail;
  };
  return { form, controls, document, dispatch, trackIds,
    problems: () => [form, ...form.all()].filter(node => node.className === 'field-problem').map(node => node.textContent),
    notice: () => [form, ...form.all()].find(node => node.className === 'draft-notice') || null };
}

function placeIn(document, storage) {
  const window = { addEventListener() {}, setTimeout(fn) { fn(); return 1; }, clearTimeout() {} };
  if (storage !== undefined) window.localStorage = storage;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/place-fields.js'), 'utf8'),
    { window, document, Date, Math, JSON, Object, String, Number, Boolean, Array });
  return window.VeyletPlace;
}

const intakeFields = [
  { name: 'name_and_business', label: 'Your name / business *', required: true },
  { name: 'email', label: 'Email *', type: 'email', required: true },
  { name: 'space_category', label: 'What sort of space? *', tag: 'select', required: true },
  { name: 'audience', label: 'What should your viewers be able to explore? *', tag: 'textarea', required: true },
  { name: 'portfolio', label: 'Portfolio link', type: 'url', inOptional: true },
];

test('a problem is named beside its own field, in text, and never clears the answer', () => {
  const page = formPage(intakeFields);
  const status = new FakeNode('p');
  placeIn(page.document).inlineValidation(page.form, status);
  assert.equal(page.form.noValidate, true, 'our messages replace the browser bubble');
  const [name, email] = page.controls;
  name.value = 'Harbourline Property';
  email.value = 'dana@harbourline';
  page.dispatch(email, 'input');
  page.dispatch(email, 'blur');
  assert.deepEqual(page.problems(), ['This needs an email address with an @ and a domain, like name@agency.com.au. We reply to it.']);
  assert.equal(email.getAttribute('aria-invalid'), 'true');
  // The message is linked to the field, not only placed near it.
  assert.equal(email.getAttribute('aria-describedby'), email.dataset.errorId);
  assert.equal(email.value, 'dana@harbourline', 'the answer is kept exactly');
  email.value = 'dana@harbourline.example';
  page.dispatch(email, 'input');
  assert.deepEqual(page.problems(), []);
  assert.equal(email.getAttribute('aria-invalid'), null);
  assert.equal(email.getAttribute('aria-describedby'), null);
});

test('leaving an untouched empty field alone says nothing until a send is attempted', () => {
  const page = formPage(intakeFields);
  const place = placeIn(page.document);
  place.inlineValidation(page.form, new FakeNode('p'));
  page.dispatch(page.controls[0], 'blur');
  assert.deepEqual(page.problems(), [], 'tabbing past a field is not a mistake');
  page.dispatch(page.form, 'submit');
  page.dispatch(page.controls[0], 'blur');
  assert.equal(page.problems().length > 0, true, 'after a send attempt the field does report itself');
});

test('a send with problems is stopped, counted, focused and loses nothing', () => {
  const page = formPage(intakeFields);
  const status = new FakeNode('p');
  placeIn(page.document).inlineValidation(page.form, status);
  page.controls[1].value = 'not-an-address';
  page.controls[4].value = 'example.com/work';
  const event = page.dispatch(page.form, 'submit');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true, 'nothing downstream may treat this as a submission');
  assert.deepEqual(page.problems(), [
    'Add your name / business before sending.',
    'This needs an email address with an @ and a domain, like name@agency.com.au. We reply to it.',
    'Choose one from the list before sending.',
    'Answer this before sending.',
    'This needs a full web address starting with https://, or leave it empty.',
  ]);
  assert.match(status.textContent, /^5 answers need checking before this can be sent\./);
  assert.match(status.textContent, /nothing you typed was cleared/);
  assert.equal(page.controls[0].wasFocused, true, 'focus lands on the first problem');
  assert.equal(page.controls[1].value, 'not-an-address');
  // A problem inside a closed optional section is a problem nobody can see.
  assert.equal(page.form.optional.open, true);
  // One valid form later, nothing is in the way.
  page.controls[0].value = 'Harbourline Property';
  page.controls[1].value = 'dana@harbourline.example';
  page.controls[2].value = 'Home';
  page.controls[3].value = 'Buyers who cannot attend the open home.';
  page.controls[4].value = 'https://example.com/work';
  const sent = page.dispatch(page.form, 'submit');
  assert.equal(sent.defaultPrevented, false);
  assert.deepEqual(page.problems(), []);
});

test('a single problem is counted as one, and a tick box asks to be ticked', () => {
  const page = formPage([{ name: 'assessment_understood', label: 'I understand assessment comes first. *', type: 'checkbox', required: true }]);
  const status = new FakeNode('p');
  placeIn(page.document).inlineValidation(page.form, status);
  page.dispatch(page.form, 'submit');
  assert.deepEqual(page.problems(), ['Tick this box before sending.']);
  assert.match(status.textContent, /^One answer needs checking/);
});

function fakeStore(options = {}) {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { if (options.readOnly) throw new Error('blocked'); map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

test('a brief survives a refresh, says where it is kept, and can be thrown away', () => {
  const store = fakeStore();
  const first = formPage(intakeFields);
  placeIn(first.document, store).keepDraft(first.form, new FakeNode('p'), 'managed');
  first.controls[0].value = 'Harbourline Property';
  first.controls[1].value = 'dana@harbourline.example';
  first.controls[4].value = 'https://example.com/work';
  first.dispatch(first.form, 'input');
  assert.equal(store.map.has('veylet-draft-managed'), true);

  // A new page load of the same form, as a refresh or a fresh visit would be.
  const back = formPage(intakeFields);
  const status = new FakeNode('p');
  placeIn(back.document, store).keepDraft(back.form, status, 'managed');
  assert.equal(back.controls[0].value, 'Harbourline Property');
  assert.equal(back.controls[1].value, 'dana@harbourline.example');
  assert.equal(back.form.optional.open, true, 'a restored optional answer is shown, not hidden');
  const notice = back.notice();
  assert.match(notice.textContent, /restored/);
  assert.match(notice.textContent, /kept in this browser only and has not been sent/);
  assert.equal(notice.getAttribute('role'), 'status');

  const discard = notice.children.find(node => node.tagName === 'BUTTON');
  assert.equal(discard.textContent, 'Discard draft');
  discard.listeners.click[0].handler({ preventDefault() {} });
  assert.equal(store.map.has('veylet-draft-managed'), false);
  assert.equal(back.controls[0].value, '');
  assert.equal(back.notice(), null);
  assert.match(status.textContent, /Draft discarded/);
});

test('a submitted brief is kept, and says it was submitted rather than claiming delivery', () => {
  const store = fakeStore();
  const page = formPage(intakeFields);
  placeIn(page.document, store).keepDraft(page.form, new FakeNode('p'), 'partner');
  page.controls[0].value = 'Harbourline Property';
  page.dispatch(page.form, 'input');
  page.dispatch(page.form, 'submit');
  assert.equal(JSON.parse(store.map.get('veylet-draft-partner')).sent > 0, true);

  const back = formPage(intakeFields);
  placeIn(back.document, store).keepDraft(back.form, new FakeNode('p'), 'partner');
  assert.equal(back.controls[0].value, 'Harbourline Property');
  assert.match(back.notice().textContent, /answers you submitted on/);
  assert.match(back.notice().textContent, /cannot confirm they arrived/);
});

test('a stopped submission is not recorded as sent, and a blocked store is not an error', () => {
  const store = fakeStore();
  const page = formPage(intakeFields);
  placeIn(page.document, store).keepDraft(page.form, new FakeNode('p'), 'managed');
  page.controls[0].value = 'Harbourline Property';
  page.dispatch(page.form, 'input');
  page.dispatch(page.form, 'submit', { defaultPrevented: true });
  assert.equal(JSON.parse(store.map.get('veylet-draft-managed')).sent, null);

  const blocked = formPage(intakeFields);
  const place = placeIn(blocked.document, fakeStore({ readOnly: true }));
  assert.doesNotThrow(() => place.keepDraft(blocked.form, new FakeNode('p'), 'managed'));
  assert.equal(blocked.notice(), null);
  const none = formPage(intakeFields);
  assert.doesNotThrow(() => placeIn(none.document, undefined).keepDraft(none.form, new FakeNode('p'), 'managed'));
});

test('both intake pages check their answers and keep their brief', () => {
  for (const [page, key] of [['dist/request/index.html', 'managed'], ['dist/apply/index.html', 'partner']]) {
    const source = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.match(source, /place\.inlineValidation\(form, status\);/);
    assert.match(source, new RegExp("place\\.keepDraft\\(form, status, '" + key + "'\\);"));
    // Checking answers must happen before one intent becomes two submissions.
    assert.ok(source.indexOf('inlineValidation') < source.indexOf('guardDoubleSubmit'));
    // The person is told before they type, not only after a draft comes back.
    assert.match(source, /kept in this browser as you type/);
  }
});
