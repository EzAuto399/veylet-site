// Buyer view quick wins (design spec v2 6.13, 11.3, 11.5; build map P1-WEB-5): the tab names the space, a
// walkthrough this browser can't play says what to do in buyer words, and a paused link names the agent with
// Call and Email when the server gives them. Off, withdrawn, expired and unknown links keep the neutral page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');
const { WORDS } = require('./client-words.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const tick = () => new Promise(resolve => setImmediate(resolve));

/** A handoff-shaped page: heading, body, status, frame, stage and Try again, with a stand-in account service. */
function page({ answer = { data: [], error: null }, v2 } = {}) {
  const document = createDocument();
  const node = (tag, id, parent = document.body) => { const n = document.createElement(tag); n.id = id; parent.append(n); return n; };
  const els = { title: node('h1', 'handoff-title'), body: node('p', 'handoff-body'), status: node('p', 'handoff-status'), frame: node('iframe', 'tour-frame'), stage: node('div', 'tour-stage') };
  els.title.textContent = 'Private walkthrough';
  const actions = node('p', 'tour-actions');
  actions.hidden = true;
  const retry = node('button', 'tour-retry', actions);
  retry.textContent = 'Try again';
  document.title = 'Private walkthrough — Veylet';
  const calls = [];
  const client = { rpc(name, args) { calls.push([name, args]); return Promise.resolve(answer); } };
  const window = { addEventListener() {}, removeEventListener() {}, VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'k' }, supabase: { createClient: () => client }, VeyletPlayerV2: v2 };
  window.top = window; window.self = window;
  vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} } });
  return { player: window.VeyletPlayer, document, els, actions, retry, calls };
}
const streamed = { packageFormatVersion: 2, packageBaseUrl: '/samples/eyeful-apartment/', title: 'Riverside apartment' };
const playing = { start: async () => ({ readiness: 'viewer-ready' }) };

// ---------- the tab names the space ----------

test('a client page names its tab after the space once the share resolves; the owner preview keeps its suffix', async () => {
  for (const [client, expected] of [[true, 'Riverside apartment'], [false, 'Riverside apartment — Veylet']]) {
    const x = page({ v2: playing });
    const outcome = await x.player.boot({ els: x.els, client, resolve: async () => streamed });
    assert.equal(outcome.outcome, 'ready');
    assert.equal(x.document.title, expected, String(client));
    assert.equal(x.els.title.textContent, 'Riverside apartment');
  }
});

test('the tab stays neutral while the link is checked and on a dead link', async () => {
  const html = read('handoff/index.html');
  assert.match(html, /<title>Private walkthrough — Veylet<\/title>/);
  assert.match(html, /<h1 id="handoff-title">Private walkthrough<\/h1>/);
  const checking = page({ v2: playing });
  checking.player.boot({ els: checking.els, client: true, resolve: () => new Promise(() => {}) });
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(checking.document.title, 'Private walkthrough — Veylet');
  assert.equal(checking.els.title.textContent, 'Private walkthrough');
  const dead = page({ v2: playing });
  await dead.player.boot({ els: dead.els, client: true, shareToken: TOKEN, resolve: async () => { throw new dead.player.TourFailure('share-not-found', { transient: false }); } });
  assert.equal(dead.document.title, 'This walkthrough isn’t available right now — Veylet');
  assert.doesNotMatch(dead.document.title, /Riverside/);
});

// ---------- a walkthrough this browser can't play ----------

test('the browser error asks for Safari or Chrome, or a video from the agent by first name when known', async () => {
  const { player } = page();
  assert.doesNotMatch(read('tour-player.js'), /This package is not a playable reconstructed tour/);
  assert.equal(player.browserBody('Sam Lee'), 'This walkthrough can’t open in this browser. Try Safari or Chrome, or ask Sam for a video.');
  assert.equal(player.browserBody('Priya'), 'This walkthrough can’t open in this browser. Try Safari or Chrome, or ask Priya for a video.');
  for (const name of [undefined, null, '', '   ', 42]) {
    assert.equal(player.browserBody(name), 'This walkthrough can’t open in this browser. Try Safari or Chrome, or ask the person who sent it for a video.', String(name));
  }
  // Through the player: a streamed package it cannot use, on a page that keeps its own words (not a client's).
  const unusable = { start: async () => { const error = new Error('manifest-invalid:format'); error.code = 'manifest-invalid:format'; throw error; } };
  for (const [agentName, who] of [['Sam Lee', 'Sam'], [undefined, 'the person who sent it']]) {
    const x = page({ v2: unusable });
    const outcome = await x.player.boot({ els: x.els, agentName, resolve: async () => streamed });
    assert.equal(outcome.outcome, 'missing');
    assert.equal(x.els.body.textContent, 'This walkthrough can’t open in this browser. Try Safari or Chrome, or ask ' + who + ' for a video.');
    assert.equal(x.retry.hidden, true);
  }
});

// ---------- a paused link ----------

const SAM = { paused: true, display_name: 'Sam Lee', space_title: 'Riverside apartment' };
async function paused(row, options = {}) {
  const x = page({ answer: row ? { data: [row], error: null } : { data: [], error: null } });
  const result = await x.player.boot({ els: x.els, client: true, shareToken: TOKEN, pausedContact: true, ...options,
    resolve: async () => { throw new x.player.TourFailure('share-not-found', { transient: false }); } });
  const links = x.actions.querySelectorAll('a').map(link => [link.textContent, link.getAttribute('href')]);
  return { ...x, result, links, words: [x.els.title.textContent, x.els.body.textContent] };
}

test('paused with a phone and an email: the agent named, Call and Email by first name, then Try again, no media', async () => {
  const x = await paused({ ...SAM, phone: '+61 400 111 222', email: 'sam@leeproperty.example' });
  assert.deepEqual(x.words, ['This walkthrough is paused.', 'Sam Lee has paused it for now. Ask Sam Lee about Riverside apartment.']);
  assert.deepEqual(x.links, [['Call Sam', 'tel:+61400111222'], ['Email Sam', 'mailto:sam@leeproperty.example?subject=Riverside%20apartment']]);
  assert.deepEqual(x.actions.children.map(child => child.textContent), ['Call Sam', 'Email Sam', 'Try again'], 'contact first, Try again last');
  for (const link of x.actions.querySelectorAll('a')) {
    assert.match(link.className, /\bbutton-tonal\b/, 'tonal, not filled (11.5)');
    assert.doesNotMatch(link.className, /button-ghost/);
  }
  assert.deepEqual([x.actions.hidden, x.retry.hidden], [false, false]);
  assert.deepEqual([x.els.frame.hidden, x.els.stage.hidden], [true, true], 'a paused link shows no media (11.3)');
  assert.equal(x.result.outcome, 'missing');
  assert.equal(x.document.title, 'This walkthrough is paused — Veylet');
  assert.equal(JSON.stringify(x.calls), JSON.stringify([['lookup_tour_share_pause', { p_token: TOKEN }]]));
});

test('paused with an email only: Email alone; without the space name the line asks about this property', async () => {
  const x = await paused({ paused: true, display_name: 'Sam Lee', email: 'sam@leeproperty.example' });
  assert.deepEqual(x.words, ['This walkthrough is paused.', 'Sam Lee has paused it for now. Ask Sam Lee about this property.']);
  assert.deepEqual(x.links, [['Email Sam', 'mailto:sam@leeproperty.example']]);
  assert.deepEqual(x.actions.children.map(child => child.textContent), ['Email Sam', 'Try again']);
});

test('paused with neither a phone nor an email: the line stays and there are no contact buttons', async () => {
  for (const row of [SAM, { ...SAM, phone: 'call me', email: 'not an email' }, { ...SAM, phone: '12', email: '' }, { ...SAM, phone: 61400111222, email: { at: 'x' } }]) {
    const x = await paused(row);
    assert.deepEqual(x.words, ['This walkthrough is paused.', 'Sam Lee has paused it for now. Ask Sam Lee about Riverside apartment.'], JSON.stringify(row));
    assert.deepEqual(x.links, []);
    assert.deepEqual(x.actions.children.map(child => child.textContent), ['Try again']);
  }
});

test('only the page that shows the agent adds contact to a paused link (/handoff, not /tour or /embed)', async () => {
  const x = await paused({ ...SAM, phone: '+61 400 111 222', email: 'sam@leeproperty.example' }, { pausedContact: undefined });
  assert.equal(x.words[0], 'This walkthrough is paused.');
  assert.deepEqual(x.links, []);
  const tourPage = read('tour-page.js');
  const uses = [...tourPage.matchAll(/pausedContact: true/g)].map(match => match.index);
  assert.equal(uses.length, 1);
  assert.ok(uses[0] > tourPage.indexOf('function handoff()') && uses[0] < tourPage.indexOf('function tour()'), 'set by handoff() only');
  // The embed's own check (showMissing) names the agent but adds no contact.
  const embed = page({ answer: { data: [{ ...SAM, phone: '+61 400 111 222' }], error: null } });
  await embed.player.showMissing({ ...embed.els, actions: embed.actions, retry: embed.retry }, { client: { rpc: () => Promise.resolve({ data: [{ ...SAM, phone: '+61 400 111 222' }], error: null }) }, token: TOKEN });
  assert.equal(embed.els.body.textContent, 'Sam Lee has paused it for now. Ask Sam Lee about Riverside apartment.');
  assert.equal(embed.actions.querySelectorAll('a').length, 0);
});

test('off, withdrawn, expired and unknown links keep the neutral page, with no contact', async () => {
  for (const row of [null, { paused: false, display_name: 'Sam Lee', phone: '+61 400 111 222' }, { paused: true, display_name: null, phone: '+61 400 111 222' }]) {
    const x = await paused(row);
    assert.deepEqual(x.words, [WORDS.missingHeading, WORDS.missingBody], JSON.stringify(row));
    assert.deepEqual(x.links, []);
    assert.equal(x.retry.hidden, true);
  }
});

test('lookupPause still answers the name alone, as before', async () => {
  const { player } = page();
  const client = { rpc: () => Promise.resolve({ data: [{ ...SAM, phone: '+61 400 111 222' }], error: null }) };
  assert.equal(await player.lookupPause(client, TOKEN), 'Sam Lee');
  assert.deepEqual({ ...(await player.lookupPaused(client, TOKEN)) }, { name: 'Sam Lee', space: 'Riverside apartment', phone: '+61400111222', email: '' });
});

test('the tonal contact style uses the site tokens and is never filled with the accent', () => {
  const css = read('client-page.css');
  const rule = css.match(/\.client-surface \.button-tonal,\n\.client-surface \.button-tonal:hover \{([^}]*)\}/)[1];
  assert.match(rule, /background: var\(--sage\);/);
  assert.match(rule, /color: var\(--ink\);/);
  assert.doesNotMatch(rule, /var\(--accent\)|#[0-9a-f]{3,6}/i);
});
