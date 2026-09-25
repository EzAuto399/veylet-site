const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'dist/website-guide/index.html'), 'utf8');
const guide = fs.readFileSync(path.join(root, 'dist/website-guide.js'), 'utf8');
const sharing = fs.readFileSync(path.join(root, 'dist/tour-sharing.js'), 'utf8');

const TOKEN = 'synthetic-fixture-token';

function element(id) {
  return {
    id, hidden: false, textContent: '', value: '', attributes: {}, children: [],
    events: {},
    addEventListener(name, fn) { this.events[name] = fn; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
    append(child) { this.children.push(child); },
    querySelector: () => ({ tag: 'iframe' }),
  };
}

function load({ writeText = async () => {} } = {}) {
  const ids = {};
  for (const name of ['share-guide', 'share-guide-output', 'share-code', 'share-guide-status',
    'share-open', 'share-preview', 'share-copy-code', 'share-copy-link']) ids[name] = element(name);
  const link = element('link');
  ids['share-guide'].elements = { link };
  let submit;
  ids['share-guide'].addEventListener = (name, fn) => { if (name === 'submit') submit = fn; };
  const created = [];
  const document = {
    getElementById: id => ids[id],
    createElement: () => {
      const node = { children: [], querySelector: () => node.frame };
      Object.defineProperty(node, 'innerHTML', { set(value) { node.html = value; node.frame = { tag: 'iframe', html: value }; } });
      created.push(node);
      return node;
    },
  };
  const window = {};
  const context = { window, document, URL, navigator: { clipboard: { writeText } }, FormData: class {
    constructor(form) { this.form = form; }
    get(name) { return this.form.elements[name].value; }
  } };
  vm.runInNewContext(sharing, context);
  vm.runInNewContext(guide, context);
  return { ids, link, created, sharing: window.VeyletSharing,
    submit: () => submit({ preventDefault() {} }) };
}

test('an owner preview or a stranger link is refused, announced and tied to the field', () => {
  const h = load();
  h.link.value = 'https://veylet.com/play?id=' + TOKEN;
  h.submit();
  assert.equal(h.ids['share-guide-output'].hidden, true);
  assert.equal(h.ids['share-code'].value, '');
  assert.equal(h.link.attributes['aria-invalid'], 'true');
  assert.equal(h.link.focused, true);
  assert.match(h.ids['share-guide-status'].textContent, /full client handoff link/);
  // role="alert" so the refusal is spoken, not left in a polite queue.
  assert.match(markup, /id="share-guide-status"[^>]*role="alert"/);
});

test('a good link yields the code and a live test embed built from that same code', () => {
  const h = load();
  h.link.value = 'https://veylet.com/handoff?t=' + TOKEN;
  h.submit();
  assert.equal(h.ids['share-guide-output'].hidden, false);
  assert.equal(h.ids['share-code'].value, h.sharing.embedCode(TOKEN));
  assert.equal(h.ids['share-open'].attributes.href, undefined);
  assert.equal(h.ids['share-open'].href, h.sharing.handoffUrl(TOKEN));
  assert.equal(h.link.attributes['aria-invalid'], undefined);
  const frame = h.ids['share-preview'].children[0];
  assert.equal(frame.tag, 'iframe');
  assert.equal(frame.html, h.sharing.embedCode(TOKEN));
  assert.match(h.ids['share-guide-status'].textContent, /Explore in 3D/);
});

test('a later refusal clears the prepared code and its test embed', () => {
  const h = load();
  h.link.value = 'https://veylet.com/handoff?t=' + TOKEN;
  h.submit();
  h.ids['share-preview'].textContent = 'seeded';
  h.link.value = 'https://not-veylet.invalid/handoff?t=' + TOKEN;
  h.submit();
  assert.equal(h.ids['share-guide-output'].hidden, true);
  assert.equal(h.ids['share-preview'].textContent, '');
  assert.equal(h.ids['share-preview'].children.length, 1); // cleared by textContent, never re-added
});

test('the client link can be copied on its own, not only the embed code', async () => {
  const copied = [];
  const h = load({ writeText: async value => { copied.push(value); } });
  h.link.value = 'https://veylet.com/handoff?t=' + TOKEN;
  h.submit();
  h.ids['share-copy-link'].events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, [h.sharing.handoffUrl(TOKEN)]);
  // Copying the link must not overwrite the embed code field.
  assert.equal(h.ids['share-code'].value, h.sharing.embedCode(TOKEN));
  assert.match(h.ids['share-guide-status'].textContent, /Client link copied/);
});

test('the guide names the real control and the real height a fixed element needs', () => {
  // The button says "Explore in 3D"; the guide used to quote a label that does
  // not exist, and told Wix users the player keeps its aspect ratio.
  const embed = fs.readFileSync(path.join(root, 'dist/embed/index.html'), 'utf8');
  assert.match(embed, /id="embed-start" type="button" hidden>Explore in 3D</);
  assert.doesNotMatch(markup, /Explore this property” before/);
  assert.match(markup, /at least 320 pixels tall/);
  assert.doesNotMatch(markup, /keeps its own aspect ratio inside it/);
  // The floor quoted to customers must be the floor the snippet actually sets.
  const share = {};
  vm.runInNewContext(sharing, { window: share, URL, navigator: {} });
  assert.match(share.VeyletSharing.embedCode(TOKEN), /min-height:320px/);
});

test('the guide answers the portal question once, and says no', () => {
  const portal = markup.match(/<summary>Will it work on a property portal\?<\/summary><p>([\s\S]*?)<\/p>/)[1];
  assert.match(portal, /^No\. Listing portals do not accept this embed\./);
  assert.doesNotMatch(portal, /each portal and website builder controls its own rules/);
  assert.match(markup, /Listing portals do not accept this embed;/);
});
