const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

// The client's page (/handoff) and the embed invitation (journey D4, §5.2):
// the agent card, Share, the buyer's words and the missing-function rule.
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const clientSource = read('client-page.js');
const handoff = read('handoff/index.html');
const embed = read('embed/index.html');
const TOKEN = 'synthetic-valid-token-1234';
const TITLE = 'Fictional practice space';
const CONTACT = { display_name: 'Alex Example', agency: 'Example Realty', phone: '+61 400 000 000', email: 'alex@example.invalid' };
const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.lookup_tour_share_contact(p_token) in the schema cache' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
// Values made inside a vm context carry that context's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

function loadModule(extra = {}) {
  const window = {};
  vm.runInNewContext(clientSource, { window, setTimeout, clearTimeout, ...extra });
  return window.VeyletClientPage;
}

class TourFailure extends Error {
  constructor(message, options) { super(message); this.transient = Boolean(options && options.transient); }
}

/* The shipped handoff markup on a stand-in DOM, with the player replaced by a
 * recorder: its own behaviour is covered by tour-player(-v2).test.cjs. */
function handoffPage({ search = '?t=' + TOKEN, nav = {} } = {}) {
  const document = createDocument();
  for (const match of handoff.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const [, tag, before, id, after] = match;
    const node = document.createElement(tag);
    node.id = id;
    const attrs = before + after;
    if (/\shidden\b/.test(attrs)) node.hidden = true;
    if (/\sdata-tour-help\b/.test(attrs)) node.setAttribute('data-tour-help', '');
    const text = handoff.slice(match.index + match[0].length).match(/^([^<]*)</);
    if (text && text[1].trim()) node.textContent = text[1].replace(/\s+/g, ' ').trim();
    document.body.append(node);
  }
  const calls = [];
  let bootOptions = null, finishBoot = null;
  const player = {
    TourFailure,
    showFailure(els, options) { calls.push({ failure: options }); els.title.textContent = options.heading; els.body.textContent = options.body; },
    boot(options) { bootOptions = options; return new Promise(resolve => { finishBoot = resolve; }); },
  };
  const window = { VeyletPlayer: player };
  const location = { origin: 'https://veylet.com', pathname: '/handoff', search };
  const context = { window, document, location, navigator: nav, URLSearchParams, setTimeout, clearTimeout };
  vm.runInNewContext(clientSource, context);
  vm.runInNewContext(handoff.match(/<script type="module">([\s\S]*?)<\/script>/)[1], context);
  const id = name => document.getElementById(name);
  return { document, id, calls, get bootOptions() { return bootOptions; }, finishBoot: () => finishBoot() };
}

function fakeClient({ share = { data: [{ storage_path: 'synthetic/fixture.zip', space_title: TITLE }] }, contact = { data: [CONTACT] } } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'lookup_tour_share') return share;
      if (name === 'lookup_tour_share_contact') return typeof contact === 'function' ? contact() : contact;
      throw new Error('unexpected ' + name);
    },
  };
}

function nodes(root) {
  const all = [];
  const walk = node => { for (const child of node.children) { all.push(child); walk(child); } };
  walk(root);
  return all;
}

// ---------- rules ----------

test('Call dials digits and one leading +; Email carries the listing title as its subject', () => {
  const page = loadModule();
  assert.equal(page.telHref('+61 400 000 000'), 'tel:+61400000000');
  assert.equal(page.telHref('(07) 3000-0000'), 'tel:0730000000');
  assert.equal(page.telHref('61 +400 000'), 'tel:61400000', 'only a leading + is kept');
  assert.equal(page.telHref(' + 61 4 '), 'tel:+614');
  assert.equal(page.telHref('+'), '');
  assert.equal(page.telHref(null), '');
  assert.equal(page.mailtoHref('alex@example.invalid', TITLE), 'mailto:alex@example.invalid?subject=Walkthrough%3A%20Fictional%20practice%20space');
  assert.equal(page.mailtoHref('alex@example.invalid', 'Unit 4 & garden #2?'), 'mailto:alex@example.invalid?subject=Walkthrough%3A%20Unit%204%20%26%20garden%20%232%3F');
  assert.equal(page.mailtoHref('a?b&c@example.invalid', 'x'), 'mailto:a%3Fb%26c@example.invalid?subject=Walkthrough%3A%20x');
  assert.equal(page.mailtoHref('not an email', TITLE), '');
});

test('a contact needs a name and a phone or an email; anything else is no card', () => {
  const page = loadModule();
  assert.deepEqual({ ...page.contactFrom([CONTACT]) }, { name: 'Alex Example', agency: 'Example Realty', phone: '+61 400 000 000', email: 'alex@example.invalid' });
  assert.deepEqual({ ...page.contactFrom({ ...CONTACT, agency: null, email: '  ' }) }, { name: 'Alex Example', agency: '', phone: '+61 400 000 000', email: '' });
  assert.equal(page.contactFrom([]), null);
  assert.equal(page.contactFrom(null), null);
  assert.equal(page.contactFrom([{ ...CONTACT, display_name: ' ' }]), null);
  assert.equal(page.contactFrom([{ ...CONTACT, phone: '()', email: 'nope' }]), null);
  assert.equal(page.agentLine(page.contactFrom([CONTACT])), 'Alex Example, Example Realty');
  assert.equal(page.agentLine(page.contactFrom([{ ...CONTACT, agency: null }])), 'Alex Example');
});

test('the contact lookup asks for this token only and never throws: a missing function, an error or silence is no card', async () => {
  const page = loadModule();
  const client = fakeClient();
  assert.equal((await page.lookupContact(client, TOKEN)).name, 'Alex Example');
  assert.deepEqual(plain(client.calls), [['lookup_tour_share_contact', { p_token: TOKEN }]]);
  for (const contact of [MISSING, { error: { message: 'boom' } }, { data: [] }, () => { throw new Error('offline'); }, () => Promise.reject(new Error('offline'))]) {
    assert.equal(await page.lookupContact(fakeClient({ contact }), TOKEN), null);
  }
  const silent = { rpc: () => new Promise(() => {}) };
  assert.equal(await page.lookupContact(silent, TOKEN, { timeoutMs: 5 }), null);
  assert.equal(await page.lookupContact(null, TOKEN), null);
  assert.equal(await page.lookupContact(client, 'short'), null);
});

test('the embed’s REST lookup answers as client.rpc does, PGRST202 included', async () => {
  const requests = [];
  const answers = [];
  const fetch = async (url, init) => { requests.push({ url, init }); return answers.shift(); };
  const page = loadModule({ fetch });
  const client = page.restClient({ url: 'https://fixture.invalid/', anonKey: 'public-anon' });
  answers.push({ ok: true, status: 200, json: async () => [CONTACT] });
  assert.equal((await page.lookupContact(client, TOKEN)).phone, '+61 400 000 000');
  const { url, init } = requests[0];
  assert.equal(url, 'https://fixture.invalid/rest/v1/rpc/lookup_tour_share_contact');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.apikey, 'public-anon');
  assert.equal(init.headers.Authorization, 'Bearer public-anon');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(init.body), { p_token: TOKEN });
  answers.push({ ok: false, status: 404, json: async () => ({ code: 'PGRST202', message: MISSING.error.message }) });
  assert.deepEqual(plain(await client.rpc('lookup_tour_share_contact', { p_token: TOKEN })), { data: null, error: { code: 'PGRST202', message: MISSING.error.message } });
  answers.push({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  assert.equal(await page.lookupContact(client, TOKEN), null);
  const offline = loadModule({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).restClient({ url: 'https://x.invalid', anonKey: 'k' });
  assert.equal((await offline.rpc('lookup_tour_share_contact', {})).error.code, 'network');
  assert.equal(page.restClient({}), null);
});

test('the page URL to share carries nothing but its token', () => {
  const page = loadModule();
  assert.equal(page.shareUrl({ origin: 'https://veylet.com', pathname: '/handoff', search: '?t=abc&utm_source=sms#x' }, 'abc'), 'https://veylet.com/handoff?t=abc');
  assert.equal(page.shareUrl({ origin: 'https://veylet.com', pathname: '/handoff' }, 'a b"c'), 'https://veylet.com/handoff?t=a%20b%22c');
});

// ---------- the handoff page ----------

test('a found walkthrough shows the truth line, Share and the agent card; Call is filled and both are labelled', async () => {
  const h = handoffPage();
  assert.equal(h.id('client-truth').hidden, true, 'the truth line waits for a walkthrough');
  const client = fakeClient();
  const resolved = await h.bootOptions.resolve(client);
  assert.deepEqual({ ...resolved }, { storagePath: 'synthetic/fixture.zip', packageFormatVersion: 1, packageBaseUrl: null, title: TITLE, intro: '', footer: '' });
  assert.equal(h.id('client-truth').hidden, false);
  assert.equal(h.id('client-truth').textContent, 'Captured on site with an iPhone. Not to scale.');
  assert.equal(h.id('handoff-body').textContent, '', 'no operator sentence is left under the title');
  assert.equal(h.id('client-share').hidden, false);
  assert.equal(h.id('client-help').hidden, true, 'the movement help describes the streamed player only');
  await settle();
  assert.deepEqual(client.calls.map(call => call[0]), ['lookup_tour_share', 'lookup_tour_share_contact']);
  const card = h.id('agent-card');
  assert.equal(card.hidden, false);
  assert.equal(card.getAttribute('aria-labelledby'), 'agent-card-name');
  assert.equal(card.querySelector('h2').textContent, 'Alex Example');
  assert.equal(card.querySelector('.agent-agency').textContent, 'Example Realty');
  const [call, email] = card.querySelectorAll('a');
  assert.equal(call.textContent, 'Call');
  assert.equal(call.getAttribute('href'), 'tel:+61400000000');
  assert.equal(call.getAttribute('aria-label'), 'Call Alex Example');
  assert.match(call.className, /\bbutton\b/);
  assert.doesNotMatch(call.className, /button-ghost/);
  assert.equal(email.textContent, 'Email');
  assert.equal(email.getAttribute('href'), 'mailto:alex@example.invalid?subject=Walkthrough%3A%20Fictional%20practice%20space');
  assert.equal(email.getAttribute('aria-label'), 'Email Alex Example');
  assert.match(email.className, /button-ghost/);
  const bar = h.id('agent-bar');
  assert.equal(bar.hidden, false);
  assert.equal(bar.getAttribute('aria-label'), 'Contact Alex Example');
  assert.deepEqual(bar.querySelectorAll('a').map(link => link.getAttribute('href')), [call.getAttribute('href'), email.getAttribute('href')]);
  assert.ok(h.document.body.classList.contains('has-agent-bar'), 'the page makes room for the bar');
  assert.equal(h.id('client-footnote').textContent, 'A private link from Alex Example, not listed publicly.');
  assert.equal(h.id('client-trouble').textContent, 'Trouble opening it? Try another browser, or contact Alex Example.');
  assert.ok(nodes(h.document.body).every(node => node.innerHTML === ''), 'built with textContent and setAttribute only');
});

test('Email is the filled action when there is no phone; a phone-only agent has no Email', async () => {
  const emailOnly = handoffPage();
  await emailOnly.bootOptions.resolve(fakeClient({ contact: { data: [{ ...CONTACT, phone: null }] } }));
  await settle();
  const links = emailOnly.id('agent-card').querySelectorAll('a');
  assert.deepEqual(links.map(link => link.textContent), ['Email']);
  assert.doesNotMatch(links[0].className, /button-ghost/);
  const phoneOnly = handoffPage();
  await phoneOnly.bootOptions.resolve(fakeClient({ contact: { data: [{ ...CONTACT, email: null, agency: null }] } }));
  await settle();
  assert.deepEqual(phoneOnly.id('agent-card').querySelectorAll('a').map(link => link.textContent), ['Call']);
  assert.equal(phoneOnly.id('agent-card').querySelector('.agent-agency'), null);
});

test('no contact, an error or a backend without the function shows no card and no bar, and nothing else changes', async () => {
  for (const contact of [MISSING, { data: [] }, { error: { message: 'Synthetic contact failure' } }, () => { throw new Error('offline'); }]) {
    const h = handoffPage();
    await h.bootOptions.resolve(fakeClient({ contact }));
    await settle();
    assert.equal(h.id('agent-card').hidden, true);
    assert.equal(h.id('agent-card').children.length, 0);
    assert.equal(h.id('agent-bar').hidden, true);
    assert.equal(h.document.body.classList.contains('has-agent-bar'), false);
    assert.equal(h.id('client-footnote').textContent, 'A private link, not listed publicly.');
    assert.equal(h.id('client-trouble').textContent, 'Trouble opening it? Try another browser, or ask the person who sent it.');
    assert.equal(h.id('client-truth').hidden, false);
    assert.equal(h.id('client-share').hidden, false);
  }
});

test('a streamed walkthrough gets the movement help under the stage', async () => {
  const h = handoffPage();
  const resolved = await h.bootOptions.resolve(fakeClient({ share: { data: [{ storage_path: 'p/manifest.json', space_title: TITLE, package_format_version: 2, package_base_url: 'https://tours.veylet.com/t/abc/' }] } }));
  assert.equal(resolved.packageFormatVersion, 2);
  assert.equal(h.id('client-help').hidden, false);
  h.id('tour-stage').hidden = false; // the player owns the stage
  h.finishBoot(); await settle();
  assert.deepEqual([h.id('tour-frame-wrap').hidden, h.id('client-help').hidden], [false, false]);
  // A failure the player explained leaves nothing on the stage: no empty shell, no help.
  const failed = handoffPage();
  await failed.bootOptions.resolve(fakeClient({ share: { data: [{ storage_path: 'p/manifest.json', space_title: TITLE, package_format_version: 2, package_base_url: 'https://tours.veylet.com/t/abc/' }] } }));
  assert.equal(failed.id('tour-frame-wrap').hidden, false);
  failed.finishBoot(); await settle();
  assert.deepEqual([failed.id('tour-frame-wrap').hidden, failed.id('client-help').hidden], [true, true]);
  assert.equal(failed.id('agent-card').hidden, false, 'the agent stays reachable when 3D does not');
  assert.match(handoff, /<summary>How to move around<\/summary>\s*<p>Drag to look around\. Tap the floor or a numbered circle to walk\. Use the arrows to go room to room\.<\/p>/);
});

test('Share opens the system sheet with the title and the bare link; cancelling says nothing', async () => {
  const shared = [], copied = [];
  let refuse = null;
  const nav = { share: async data => { shared.push(data); if (refuse) throw refuse; }, clipboard: { writeText: async text => { copied.push(text); } } };
  const h = handoffPage({ search: '?t=' + TOKEN + '&utm_source=sms', nav });
  await h.bootOptions.resolve(fakeClient());
  const button = h.id('client-share');
  assert.equal(button.textContent, 'Share');
  button.click(); await settle();
  assert.deepEqual(shared.map(item => ({ ...item })), [{ title: TITLE, url: 'https://veylet.com/handoff?t=' + TOKEN }]);
  refuse = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  button.click(); await settle();
  assert.deepEqual(copied, []);
  assert.equal(h.id('client-share-status').textContent, '');
  refuse = new Error('share failed');
  button.click(); await settle();
  assert.deepEqual(copied, ['https://veylet.com/handoff?t=' + TOKEN], 'a failed sheet falls back to copying');
  assert.equal(h.id('client-share-status').textContent, 'Link copied.');
});

test('without a share sheet the button reads Copy link, copies and says so in a live region every time', async () => {
  const copied = [];
  let fail = false;
  const nav = { clipboard: { writeText: async text => { if (fail) throw new Error('denied'); copied.push(text); } } };
  const h = handoffPage({ nav });
  await h.bootOptions.resolve(fakeClient());
  const button = h.id('client-share'), status = h.id('client-share-status');
  assert.equal(button.textContent, 'Copy link');
  assert.match(handoff, /<p class="client-share-status" id="client-share-status" role="status"><\/p>/);
  button.click(); await settle();
  assert.deepEqual(copied, ['https://veylet.com/handoff?t=' + TOKEN]);
  assert.equal(status.textContent, 'Link copied.');
  button.click(); await settle();
  assert.equal(status.textContent.trim(), 'Link copied.');
  assert.notEqual(status.textContent, 'Link copied.', 'a second copy is announced again');
  fail = true;
  button.click(); await settle();
  assert.equal(status.textContent, 'Copying didn’t work. Copy the address from your browser instead.');
});

test('the three failure states read as §5.2 says, in the page’s own TourFailure codes', async () => {
  const incomplete = handoffPage({ search: '?t=short' });
  assert.equal(incomplete.bootOptions, null);
  assert.deepEqual({ ...incomplete.calls[0].failure }, { heading: 'This link looks incomplete.', body: 'Check you copied all of it, or ask the person who sent it.' });

  const h = handoffPage();
  assert.equal(h.bootOptions.missingHeading, 'This walkthrough isn’t available right now.');
  assert.equal(h.bootOptions.missingBody, 'The agent may have turned it off or not shared it yet.');
  assert.equal(h.bootOptions.transientBody, 'The walkthrough couldn’t be reached just now. Check your connection and try again.');
  const miss = await h.bootOptions.resolve(fakeClient({ share: { data: [] } })).catch(error => error);
  assert.equal(miss.message, 'share-not-found');
  assert.equal(miss.transient, false);
  h.id('client-trouble').hidden = false; // the player shows it while loading
  h.finishBoot(); await settle();
  assert.equal(h.id('client-trouble').hidden, true, 'another browser will not bring back a link that is off');
  assert.equal(h.id('client-truth').hidden, true);
  assert.equal(h.id('client-share').hidden, true, 'nothing to forward');
  assert.equal(h.id('agent-card').hidden, true);

  const down = handoffPage();
  const failure = await down.bootOptions.resolve(fakeClient({ share: { error: { message: 'Synthetic service failure' } } })).catch(error => error);
  assert.equal(failure.message, 'share-unavailable');
  assert.equal(failure.transient, true, 'a service error keeps Try again');
  down.id('client-trouble').hidden = false;
  down.finishBoot(); await settle();
  assert.equal(down.id('client-trouble').hidden, false);
});

test('the page speaks to the client: no operator, payment, support or listing-builder words, and a small maker’s mark', () => {
  const flat = handoff.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /Not payment|operator|Veylet support|leave out the address|until the operator revokes/i);
  assert.doesNotMatch(flat, /embed code|QR|Domain|listing builder|mailto:yoda/i);
  assert.match(flat, /<a class="client-made" href="https:\/\/veylet\.com">Made with Veylet<\/a>/);
  assert.match(flat, /<p class="client-truth" id="client-truth" hidden>Captured on site with an iPhone\. Not to scale\.<\/p>/);
  assert.match(flat, /id="client-footnote">A private link, not listed publicly\.<\/p>/);
  assert.match(flat, /id="client-trouble" data-tour-help hidden>Trouble opening it\? Try another browser, or ask the person who sent it\.<\/p>/);
  assert.match(flat, /<section class="agent-card" id="agent-card" hidden><\/section>/);
  assert.match(flat, /<aside class="agent-bar" id="agent-bar" hidden><\/aside>/);
  // One h1; the agent's name is the only h2 the page adds.
  assert.equal((handoff.match(/<h1\b/g) || []).length, 1);
  assert.doesNotMatch(clientSource + handoff, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(handoff, /<script src="\/client-page\.js\?v=[a-f\d]{16}"><\/script>/);
  assert.match(handoff, /<link rel="stylesheet" href="\/client-page\.css\?v=[a-f\d]{16}" \/>/);
  assert.match(handoff, /viewport-fit=cover/, 'the safe area is only reported with viewport-fit=cover');
});

test('the phone bar respects the safe area, never shows above 768px and moves only when motion is welcome', () => {
  const css = read('client-page.css');
  assert.match(css, /\.agent-bar \{\s*display: none;\s*\}/);
  const phone = css.match(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /position: fixed;/);
  assert.match(phone, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(phone, /body\.has-agent-bar \{\s*padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  // While the bar shows, the inline card keeps name, agency and details but not a second Call and Email.
  assert.match(phone, /body\.has-agent-bar \.agent-card \.agent-actions \{\s*display: none;\s*\}/);
  assert.doesNotMatch(phone, /\.agent-(?:name|agency|details)[^{]*\{\s*display: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.agent-bar:not\(\[hidden\]\) \{\s*animation: none;/);
  assert.match(css, /min-height: 44px;/);
  assert.match(css, /:focus-visible/);
  for (const token of css.match(/var\(--[\w-]+\)/g)) assert.match(token, /var\(--(ink|paper|sage|muted|line|accent|panel|danger)\)/, token);
});

test('from 1080px Help and Share move under the agent card in the document, and back below it', () => {
  const document = createDocument();
  const node = (tag, id, parent) => { const el = document.createElement(tag); el.id = id; parent.append(el); return el; };
  const side = node('div', 'client-side', document.body);
  const card = node('section', 'agent-card', side);
  const home = node('div', 'client-extras-home', document.body);
  const extras = node('div', 'client-extras', home);
  const share = node('button', 'client-share', extras);
  let wide = false, changed = null;
  const window = { matchMedia: query => ({ get matches() { assert.equal(query, '(min-width: 1080px)'); return wide; }, addEventListener: (type, fn) => { changed = fn; } }) };
  const page = loadModule();
  page.mountColumns(document, window);
  assert.equal(extras.parentNode, home, 'one column: under the walkthrough');
  wide = true; share.focus(); changed();
  assert.equal(extras.parentNode, side);
  assert.deepEqual(side.children.map(child => child.id), [card.id, 'client-extras'], 'after the card, so focus order matches the screen');
  assert.equal(document.activeElement, share, 'focus survives the move');
  wide = false; changed();
  assert.equal(extras.parentNode, home);
  assert.doesNotThrow(() => page.mountColumns(document, {}), 'no matchMedia: the one-column markup stands');
  assert.match(handoff, /page\?\.mountColumns\(document, window\);/);
  assert.match(handoff, /<div id="client-extras-home">\s*<div class="client-extras" id="client-extras">\s*<details class="client-help"/);
});

test('from 1080px the stage column takes the width beside a 320px sticky column; below it stays one column', () => {
  const css = read('client-page.css');
  const wide = css.match(/@media \(min-width: 1080px\) \{([\s\S]*?)\n\}/)[1];
  assert.match(wide, /grid-template-columns: minmax\(0, 1fr\) 320px;/);
  assert.match(wide, /\.client-side \{[^}]*position: sticky;[^}]*top: 24px;/);
  assert.match(wide, /\.client-page \{\s*max-width: 1312px;/);
  assert.doesNotMatch(css.replace(wide, ''), /\.client-layout \{[^}]*display: grid/, 'no grid below 1080px');
  // Title and truth line come before the columns; the agent card before the stage.
  const order = ['id="handoff-title"', 'id="client-truth"', 'class="client-layout"', 'id="agent-card"', 'id="tour-frame-wrap"', 'id="client-extras"', 'id="client-trouble"'].map(mark => handoff.indexOf(mark));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every(index => index > 0));
});

// ---------- the embed invitation ----------

function embedPage({ withSdk = true, contact = { data: [CONTACT] }, fetch } = {}) {
  const ids = {};
  for (const match of embed.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, textContent: '', events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  }
  const client = fakeClient({ contact });
  let bootCalls = 0;
  const player = {
    boot: () => { bootCalls++; return new Promise(() => {}); },
    showFailure: () => {},
    clientFor: () => client,
  };
  const window = { VeyletPlayer: player, VEYLET_SUPABASE: { url: 'https://fixture.invalid', anonKey: 'non-network-fixture' } };
  if (withSdk) window.supabase = { createClient() {} };
  const context = { window, document: { getElementById: id => ids[id] }, location: { search: '?t=' + TOKEN }, URLSearchParams, setTimeout, clearTimeout, fetch };
  vm.runInNewContext(clientSource, context);
  vm.runInNewContext(embed.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { ids, client, get bootCalls() { return bootCalls; } };
}

test('the embed invitation names the agent under its title before anyone presses Explore', async () => {
  const h = embedPage();
  await settle();
  assert.equal(h.bootCalls, 0, 'nothing of the walkthrough loads for the name');
  assert.deepEqual(plain(h.client.calls), [['lookup_tour_share_contact', { p_token: TOKEN }]]);
  assert.equal(h.ids['embed-agent'].hidden, false);
  assert.equal(h.ids['embed-agent'].textContent, 'Alex Example, Example Realty');
  const noAgency = embedPage({ contact: { data: [{ ...CONTACT, agency: null }] } });
  await settle();
  assert.equal(noAgency.ids['embed-agent'].textContent, 'Alex Example');
  assert.match(embed, /<h1 id="embed-title">Explore this property in 3D\.<\/h1>\s*<p id="embed-agent" hidden><\/p>/);
  assert.doesNotMatch(embed, /tel:|mailto:|agent-action/, 'the embed gets no contact buttons');
  assert.match(embed, /:not\(#embed-title\):not\(#embed-agent\):not\(#embed-status\)/, 'the name stays while the viewer prepares');
});

test('the embed leaves the line out on PGRST202, no row or an error, over the SDK or the REST call', async () => {
  for (const contact of [MISSING, { data: [] }, { error: { message: 'x' } }]) {
    const h = embedPage({ contact });
    await settle();
    assert.equal(h.ids['embed-agent'].hidden, true);
    assert.equal(h.ids['embed-agent'].textContent, '');
  }
  const requests = [];
  const rest = answer => async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return answer; };
  const missing = embedPage({ withSdk: false, fetch: rest({ ok: false, status: 404, json: async () => ({ code: 'PGRST202' }) }) });
  await settle();
  assert.equal(missing.ids['embed-agent'].hidden, true);
  // The share lookup before Explore goes the same REST way; the contact read is its own call.
  assert.deepEqual(requests.find(request => request.url.endsWith('/lookup_tour_share_contact')), { url: 'https://fixture.invalid/rest/v1/rpc/lookup_tour_share_contact', body: { p_token: TOKEN } });
  assert.equal(missing.client.calls.length, 0, 'no SDK client before Explore');
  const found = embedPage({ withSdk: false, fetch: rest({ ok: true, status: 200, json: async () => [CONTACT] }) });
  await settle();
  assert.equal(found.ids['embed-agent'].textContent, 'Alex Example, Example Realty');
});

// ---------- the QA fixture ----------

test('the QA fixture answers lookup_tour_share_contact for each documented switch', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
  const answer = async search => {
    const context = { URLSearchParams, location: { search, pathname: '/__qa/handoff/' }, localStorage: { getItem: () => null, setItem() {} },
      document: { createElement: () => ({}), addEventListener() {} } };
    context.window = context;
    vm.runInNewContext(source, context);
    return context.supabase.createClient().rpc('lookup_tour_share_contact', { p_token: TOKEN });
  };
  const loadPage = loadModule();
  const shown = loadPage.contactFrom((await answer('?t=' + TOKEN)).data);
  assert.deepEqual({ ...shown }, { name: 'Alex Example', agency: 'Example Realty', phone: '+61 400 000 000', email: 'alex@example.invalid' });
  assert.deepEqual(plain((await answer('?contact=none')).data), []);
  assert.equal((await answer('?contact=missing')).error.code, 'PGRST202');
  assert.ok((await answer('?contact=error')).error);
  assert.deepEqual([(await answer('?contact=phone')).data[0].email, (await answer('?contact=email')).data[0].phone], [null, null]);
  assert.deepEqual(plain((await answer('?case=missing')).data), [], 'a link that is not live has no contact');
  assert.match(source, /`none`, `empty` and `hidden` return no row/);
});

test('the client’s page and the embed imply no studio, no person checking and no business hours, rendered or static', async () => {
  // Owner decision, 25 September 2026: processing is automatic; no studio, no person checks it.
  const NO_STUDIO = [/studio check/i, /a person checks/i, /with the studio/i, /contact the studio/i, /business hours/i, /5 a day/i];
  const words = text => text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
  const shown = [];
  const found = handoffPage();
  await found.bootOptions.resolve(fakeClient()); found.finishBoot(); await settle();
  const phoneOnly = handoffPage();
  await phoneOnly.bootOptions.resolve(fakeClient({ contact: { data: [{ ...CONTACT, email: null }] } })); phoneOnly.finishBoot(); await settle();
  const off = handoffPage();
  await off.bootOptions.resolve(fakeClient({ share: { data: [] } })).catch(() => {}); off.finishBoot(); await settle();
  const incomplete = handoffPage({ search: '?t=short' });
  for (const h of [found, phoneOnly, off, incomplete]) shown.push(nodes(h.document.body).map(node => node.textContent).join('\n'));
  shown.push(words(handoff), words(embed), clientSource);
  for (const [index, text] of shown.entries()) {
    for (const phrase of NO_STUDIO) assert.doesNotMatch(text, phrase, 'client page output ' + index + ': ' + phrase);
  }
});
