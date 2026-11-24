// A paused buyer link (design spec D3, decided 19 November 2026): when the server says the link is only
// paused and names the agent (lookup_tour_share_pause, release 8), /handoff, /tour and /embed say so.
// Without that answer (an older database, an error, no public name) they keep today's missing words.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { WORDS, realPlayer } = require('./client-words.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HEADING = 'This walkthrough is paused.';
const BODY = 'Sam Lee has paused it for now. Ask Sam Lee about this property.';
// The page's objects come from another realm (vm), so calls are compared as JSON.
const ONE_CALL = JSON.stringify([['lookup_tour_share_pause', { p_token: TOKEN }]]);
const NAMED = { data: [{ paused: true, display_name: 'Sam Lee' }], error: null };
// PostgREST before the release 8 function exists.
const NO_FUNCTION = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.lookup_tour_share_pause(p_token) in the schema cache' } };

const surface = () => ({ title: {}, body: {}, status: {}, frame: { hidden: false }, stage: { hidden: false }, actions: { hidden: true },
  retry: { hidden: true, events: {}, addEventListener(name, fn) { this.events[name] = fn; } } });
const clientAnswering = (answer) => {
  const calls = [];
  return { calls, rpc(name, args) { calls.push([name, args]); return typeof answer === 'function' ? answer() : Promise.resolve(answer); } };
};

test('the paused words are the design spec v2 6.13 sentences, kept in the player and in no page', () => {
  const player = realPlayer();
  assert.deepEqual(Object.keys(player.PAUSED_WORDS), ['heading', 'body']);
  assert.equal(player.PAUSED_WORDS.heading, HEADING);
  assert.equal(player.PAUSED_WORDS.body('Sam Lee'), BODY);
  assert.equal(player.PAUSED_WORDS.body('Sam Lee', 'Riverside apartment'), 'Sam Lee has paused it for now. Ask Sam Lee about Riverside apartment.');
  const tourPage = read('tour-page.js');
  for (const page of ['handoff/index.html', 'tour/index.html', 'embed/index.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /walkthrough is paused|has paused it|lookup_tour_share_pause/, page);
    assert.match(tourPage, /client: true,\n\s*\/\/[^\n]*\n\s*shareToken: token,/, page);
  }
  // The embed's check before Explore asks too, with the client it already has.
  assert.match(tourPage, /showMissing\(els, \{ client: shareClient, token \}\)/);
});

test('lookupPause gives the name only for a paused link the server names; everything else is null', async () => {
  const player = realPlayer();
  const named = clientAnswering(NAMED);
  assert.equal(await player.lookupPause(named, TOKEN), 'Sam Lee');
  assert.equal(JSON.stringify(named.calls), ONE_CALL, 'one call, the token only');
  assert.equal(await player.lookupPause(clientAnswering({ data: { paused: true, display_name: '  Sam Lee ' }, error: null }), TOKEN), 'Sam Lee');
  const nothing = [
    NO_FUNCTION,
    { data: [], error: null },
    { data: null, error: null },
    { data: [{ paused: true, display_name: null }], error: null },
    { data: [{ paused: true, display_name: '   ' }], error: null },
    { data: [{ paused: true, display_name: 'x'.repeat(81) }], error: null },
    { data: [{ paused: true, display_name: { name: 'Sam Lee' } }], error: null },
    { data: [{ paused: false, display_name: 'Sam Lee' }], error: null },
    { data: [{ paused: 'true', display_name: 'Sam Lee' }], error: null },
    { data: [{ display_name: 'Sam Lee' }], error: null },
    null,
    () => Promise.reject(new Error('network')),
    () => { throw new Error('sync'); },
  ];
  for (const answer of nothing) assert.equal(await player.lookupPause(clientAnswering(answer), TOKEN), null, JSON.stringify(answer));
  assert.equal(await player.lookupPause(clientAnswering(() => new Promise(() => {})), TOKEN, 20), null, 'no answer in time');
  // Nothing is asked without a client or a whole token.
  for (const token of ['', 'short', TOKEN + '0', undefined, null, 42]) {
    const client = clientAnswering(NAMED);
    assert.equal(await player.lookupPause(client, token), null);
    assert.equal(client.calls.length, 0, String(token));
  }
  assert.equal(await player.lookupPause(null, TOKEN), null);
  assert.equal(await player.lookupPause({}, TOKEN), null);
});

const boot = async ({ answer, failure = { code: 'share-not-found', transient: false }, options = {} }) => {
  const client = clientAnswering(answer);
  const window = { addEventListener() {}, removeEventListener() {}, VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'k' }, supabase: { createClient: () => client } };
  const els = surface();
  const dead = [{ hidden: false }];
  const document = { hidden: false, title: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    getElementById: id => (id === 'tour-actions' ? els.actions : id === 'tour-retry' ? els.retry : null),
    querySelectorAll: selector => (selector === '[data-tour-dead-end]' ? dead : []) };
  vm.runInNewContext(read('tour-player.js'), { window, document, performance, setTimeout, clearTimeout, AbortController, navigator: { onLine: true }, location: { reload() {} } });
  const player = window.VeyletPlayer;
  const result = await player.boot({ els, client: true, shareToken: TOKEN, resolve: async () => { throw new player.TourFailure(failure.code, { transient: failure.transient }); }, ...options });
  return { els, result, client, document, dead };
};

test('a paused link the server names says who paused it, with Try again', async () => {
  const paused = await boot({ answer: NAMED });
  assert.deepEqual([paused.els.title.textContent, paused.els.body.textContent], [HEADING, BODY]);
  assert.equal(paused.result.outcome, 'missing', 'the page still treats it as a link that did not open');
  assert.deepEqual([paused.els.actions.hidden, paused.els.retry.hidden], [false, false], 'Try again: the agent can resume the same link');
  assert.deepEqual([paused.els.frame.hidden, paused.els.stage.hidden], [true, true]);
  assert.equal(paused.dead[0].hidden, true, 'links to the same paused token still go');
  assert.equal(paused.document.title, 'This walkthrough is paused — Veylet');
  assert.equal(JSON.stringify(paused.client.calls), ONE_CALL);
});

test('without the name the page says what it says today: before the database change, and for a neutral answer', async () => {
  const today = [WORDS.missingHeading, WORDS.missingBody];
  assert.deepEqual(today, ['This walkthrough isn’t available right now.', 'It may have been paused or turned off. Ask the person who sent it for a new link.']);
  for (const answer of [NO_FUNCTION, { data: [], error: null }, { data: [{ paused: true, display_name: null }], error: null }, () => Promise.reject(new Error('network'))]) {
    const gone = await boot({ answer });
    assert.deepEqual([gone.els.title.textContent, gone.els.body.textContent], today, JSON.stringify(answer));
    assert.equal(gone.result.outcome, 'missing');
    assert.equal(gone.els.retry.hidden, true, 'definitive miss hides Try again');
  }
});

test('the pause is asked only for a client link that answered nothing', async () => {
  const down = await boot({ answer: NAMED, failure: { code: 'share-unavailable', transient: true } });
  assert.equal(down.els.body.textContent, WORDS.transientBody);
  assert.equal(down.client.calls.length, 0, 'a passing failure asks nothing');
  const other = await boot({ answer: NAMED, failure: { code: 'package-not-playable', transient: false } });
  assert.deepEqual([other.els.title.textContent, other.client.calls.length], [WORDS.missingHeading, 0]);
  const owner = await boot({ answer: NAMED, options: { client: false } });
  assert.equal(owner.client.calls.length, 0, 'a page that is not a client page asks nothing');
  assert.notEqual(owner.els.title.textContent, HEADING);
  const tokenless = await boot({ answer: NAMED, options: { shareToken: undefined } });
  assert.deepEqual([tokenless.els.title.textContent, tokenless.client.calls.length], [WORDS.missingHeading, 0]);
});

test('showMissing keeps its words at once, and with a client and token says who paused the link', async () => {
  const player = realPlayer();
  const plain = surface();
  assert.equal(player.showMissing(plain), undefined);
  assert.deepEqual([plain.title.textContent, plain.body.textContent], [WORDS.missingHeading, WORDS.missingBody]);
  const paused = surface();
  await player.showMissing(paused, { client: clientAnswering(NAMED), token: TOKEN });
  assert.deepEqual([paused.title.textContent, paused.body.textContent], [HEADING, BODY]);
  assert.deepEqual([paused.actions.hidden, paused.retry.hidden], [false, false]);
  for (const ask of [{ client: clientAnswering(NO_FUNCTION), token: TOKEN }, { client: null, token: TOKEN }]) {
    const gone = surface();
    await player.showMissing(gone, ask);
    assert.deepEqual([gone.title.textContent, gone.body.textContent], [WORDS.missingHeading, WORDS.missingBody]);
  }
});
