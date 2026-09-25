/*
 * The viewer beacon (record_tour_view, launch plan C5), the portal-safe listing
 * URL (/tour, C3) and the link preview card. record_tour_view is the integrator
 * lane's 2026092610xxxx migration, not yet written: every answer here is a
 * stand-in and nothing reaches the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8');
const clientSource = read('client-page.js');
const handoff = read('handoff/index.html');
const embed = read('embed/index.html');
const tour = read('tour/index.html');
const TOKEN = 'synthetic-valid-token-1234';
const CONFIG = { url: 'https://fixture.invalid/', anonKey: 'non-network-fixture' };
const ENDPOINT = 'https://fixture.invalid/rest/v1/rpc/record_tour_view';
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const plain = value => JSON.parse(JSON.stringify(value));

function loadModule(extra = {}) {
  const window = {};
  vm.runInNewContext(clientSource, { window, setTimeout, clearTimeout, URLSearchParams, URL, ...extra });
  return window.VeyletClientPage;
}

/** A fetch that records each request and answers as told. */
function recorder(answer = () => ({ ok: true, status: 204, json: async () => null })) {
  const sent = [];
  const fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return answer(url, init); };
  return { sent, fetch, kinds: () => sent.map(item => item.body.p_kind) };
}

class TourFailure extends Error {
  constructor(message, options) { super(message); this.transient = Boolean(options && options.transient); }
}

/* ---- the beacon ------------------------------------------------------------- */

test('channelFrom keeps the six channels and falls back to the page’s own; referrerHost keeps the hostname only', () => {
  const page = loadModule();
  assert.equal(page.channelFrom('?t=x&src=qr', 'unknown'), 'qr');
  assert.equal(page.channelFrom('?t=x&src=PORTAL', 'unknown'), 'portal');
  for (const src of ['link', 'qr', 'embed', 'video', 'portal', 'unknown']) assert.equal(page.channelFrom('?src=' + src, 'embed'), src);
  assert.equal(page.channelFrom('?t=x', 'embed'), 'embed', 'a link made before tags reads as its page');
  assert.equal(page.channelFrom('?t=x&src=facebook', 'portal'), 'portal');
  assert.equal(page.channelFrom('?src=javascript:alert(1)', 'nonsense'), 'unknown');
  assert.equal(page.referrerHost('https://Agency.example.invalid/listings/12-harbour?utm=1#top'), 'agency.example.invalid');
  for (const value of ['', null, undefined, 'not a url', 'file:///etc/passwd', 'javascript:alert(1)']) assert.equal(page.referrerHost(value), null, String(value));
});

test('each event is one first-party POST with the token, kind, channel and host, and no referrer', async () => {
  const page = loadModule();
  const net = recorder();
  const beacon = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'qr', host: 'agency.example.invalid', fetch: net.fetch });
  assert.equal(beacon.enabled, true);
  assert.equal(beacon.send('call_tap'), true);
  assert.equal(net.sent.length, 1);
  const [{ url, init, body }] = net.sent;
  assert.equal(url, ENDPOINT);
  assert.deepEqual(body, { p_token: TOKEN, p_kind: 'call_tap', p_src: 'qr', p_host: 'agency.example.invalid', p_detail: null });
  assert.equal(init.method, 'POST');
  assert.equal(init.keepalive, false, 'only the dwell sent on pagehide needs keepalive');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer', 'the page address (with its token) is never sent as a referrer');
  assert.deepEqual(plain(init.headers), { apikey: CONFIG.anonKey, Authorization: 'Bearer ' + CONFIG.anonKey, 'Content-Type': 'application/json' });
  // Unknown kinds, and a channel or host the page did not vouch for, are not sent as given.
  assert.equal(beacon.send('scroll'), false);
  const odd = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'facebook', host: '', fetch: net.fetch });
  odd.send('email_tap');
  assert.deepEqual([net.sent.at(-1).body.p_src, net.sent.at(-1).body.p_host], ['unknown', null]);
  // No configuration, a short token or no fetch at all: nothing is ever sent.
  const sentBefore = net.sent.length;
  for (const quiet of [page.viewBeacon({ config: {}, token: TOKEN, fetch: net.fetch }), page.viewBeacon({ config: CONFIG, token: 'short', fetch: net.fetch }),
    loadModule().viewBeacon({ config: CONFIG, token: TOKEN })]) {
    assert.equal(quiet.enabled, false);
    assert.equal(quiet.send('open'), false);
  }
  assert.equal(net.sent.length, sentBefore);
});

test('open, first frame and dwell are sent once; dwell carries whole seconds, capped at an hour', async () => {
  const page = loadModule();
  const net = recorder();
  let now = 1000;
  const listeners = {};
  let observed = null;
  class PerformanceObserver {
    constructor(callback) { this.callback = callback; observed = this; }
    observe(options) { this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const win = { addEventListener: (name, fn, options) => { listeners[name] = { fn, options }; }, performance: { now: () => 500 }, PerformanceObserver };
  const beacon = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', host: null, fetch: net.fetch, now: () => now });
  assert.equal(beacon.opened(win), true);
  assert.equal(beacon.opened(win), false, 'a second open is not counted');
  assert.deepEqual(net.kinds(), ['open']);
  assert.deepEqual(plain(observed.options), { type: 'mark', buffered: true });
  // The player's own mark for its first 3D frame, 4.4 s after the open.
  observed.callback({ getEntries: () => [{ name: 'veylet:manifest', startTime: 900 }, { name: 'veylet:first-3d', startTime: 4900 }] });
  assert.deepEqual(net.sent.at(-1).body, { p_token: TOKEN, p_kind: 'first_frame', p_src: 'link', p_host: null, p_detail: 4 });
  assert.equal(observed.disconnected, true);
  assert.equal(listeners.pagehide.options.once, true);
  now += 95 * 1000 + 400;
  listeners.pagehide.fn();
  listeners.pagehide.fn();
  assert.deepEqual(net.kinds(), ['open', 'first_frame', 'dwell']);
  assert.equal(net.sent.at(-1).body.p_detail, 95);
  assert.equal(net.sent.at(-1).init.keepalive, true, 'the dwell survives pagehide as sendBeacon would');
  const long = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', fetch: net.fetch, now: () => now });
  const longWin = { addEventListener: (name, fn) => { listeners.long = fn; } };
  long.opened(longWin);
  now += 5 * 3600 * 1000;
  listeners.long();
  assert.equal(net.sent.at(-1).body.p_detail, 3600, 'capped');
  // A player without the mark, or a browser without the observer: no first_frame and no error.
  const bare = page.viewBeacon({ config: CONFIG, token: TOKEN, fetch: net.fetch });
  assert.doesNotThrow(() => bare.opened({}));
});

test('a backend without record_tour_view (PGRST202 or 404) turns the beacon off for the visit; a failed call never throws', async () => {
  const page = loadModule();
  const missing = recorder(() => ({ ok: false, status: 404, json: async () => ({ code: 'PGRST202', message: 'Could not find the function' }) }));
  const beacon = page.viewBeacon({ config: CONFIG, token: TOKEN, fetch: missing.fetch });
  beacon.send('open');
  await settle();
  assert.equal(beacon.enabled, false);
  assert.equal(beacon.send('call_tap'), false);
  assert.equal(missing.sent.length, 1);
  const refused = recorder(() => ({ ok: false, status: 400, json: async () => ({ code: 'P0001', message: 'link not live' }) }));
  const other = page.viewBeacon({ config: CONFIG, token: TOKEN, fetch: refused.fetch });
  other.send('open'); await settle();
  assert.equal(other.enabled, true, 'a refusal for one link is not a missing function');
  const throwing = page.viewBeacon({ config: CONFIG, token: TOKEN, fetch: () => { throw new TypeError('Failed to fetch'); } });
  assert.doesNotThrow(() => throwing.send('open'));
  const rejecting = page.viewBeacon({ config: CONFIG, token: TOKEN, fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.doesNotThrow(() => rejecting.send('share_tap'));
  await settle();
});

/* ---- the client's page ---------------------------------------------------------- */

function handoffPage({ search = '?t=' + TOKEN + '&src=qr', nav = {} } = {}) {
  const document = createDocument();
  for (const match of handoff.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const [, tag, before, id, after] = match;
    const node = document.createElement(tag);
    node.id = id;
    if (/\shidden\b/.test(before + after)) node.hidden = true;
    document.body.append(node);
  }
  let bootOptions = null, finishBoot = null;
  const player = { TourFailure, showFailure(els, options) { els.title.textContent = options.heading; }, boot(options) { bootOptions = options; return new Promise(resolve => { finishBoot = resolve; }); } };
  const net = recorder();
  const window = { VeyletPlayer: player, VEYLET_SUPABASE: CONFIG, addEventListener() {} };
  const location = { origin: 'https://veylet.com', pathname: '/handoff', search };
  const context = { window, document, location, navigator: nav, URLSearchParams, URL, setTimeout, clearTimeout, fetch: net.fetch };
  vm.runInNewContext(clientSource, context);
  vm.runInNewContext(handoff.match(/<script type="module">([\s\S]*?)<\/script>/)[1], context);
  return { document, net, get bootOptions() { return bootOptions; }, finishBoot: () => finishBoot() };
}
const contactRow = { display_name: 'Alex Example', agency: 'Example Realty', phone: '+61 400 000 000', email: 'alex@example.invalid' };
const client = (share = { data: [{ storage_path: 'synthetic/fixture.zip', space_title: 'Fictional practice space' }] }) => ({
  rpc: async name => (name === 'lookup_tour_share' ? share : { data: [contactRow] }),
});

test('the client’s page counts an open only once the walkthrough is found, with the link’s channel and no host', async () => {
  const h = handoffPage();
  assert.equal(h.net.sent.length, 0, 'nothing before the lookup');
  await h.bootOptions.resolve(client());
  await settle();
  assert.deepEqual(h.net.sent.map(item => item.body), [{ p_token: TOKEN, p_kind: 'open', p_src: 'qr', p_host: null, p_detail: null }]);
  // Call, Email (card and phone bar) and Share are counted when pressed.
  const links = h.document.getElementById('agent-card').querySelectorAll('a');
  assert.deepEqual(links.map(link => link.textContent), ['Call', 'Email']);
  links[0].click(); links[1].click();
  h.document.getElementById('agent-bar').querySelectorAll('a')[0].click();
  h.document.getElementById('client-share').click();
  await settle();
  assert.deepEqual(h.net.kinds(), ['open', 'call_tap', 'email_tap', 'call_tap', 'share_tap']);
  // A link that is off, or a link made before tags.
  const off = handoffPage();
  await off.bootOptions.resolve(client({ data: [] })).catch(() => {});
  await settle();
  assert.equal(off.net.sent.length, 0, 'a link that is not live is never counted');
  const old = handoffPage({ search: '?t=' + TOKEN });
  await old.bootOptions.resolve(client()); await settle();
  assert.equal(old.net.sent[0].body.p_src, 'unknown');
  const incomplete = handoffPage({ search: '?t=short' });
  await settle();
  assert.equal(incomplete.net.sent.length, 0);
});

/* ---- the embed ------------------------------------------------------------------- */

function embedPage({ search = '?t=' + TOKEN, referrer = 'https://agency.example.invalid/listing/12?x=1' } = {}) {
  const ids = {};
  for (const match of embed.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = { hidden: /\bhidden\b/.test(match[0]), dataset: {}, textContent: '', events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
  }
  let bootOptions = null;
  const player = { TourFailure, boot: options => { bootOptions = options; return new Promise(() => {}); }, showFailure: () => {}, clientFor: () => ({ rpc: async () => ({ data: [] }) }) };
  const net = recorder();
  const window = { VeyletPlayer: player, VEYLET_SUPABASE: CONFIG, supabase: { createClient() {} }, addEventListener() {} };
  const context = { window, document: { getElementById: id => ids[id], referrer }, location: { search }, URLSearchParams, URL, setTimeout, clearTimeout, fetch: net.fetch };
  vm.runInNewContext(clientSource, context);
  vm.runInNewContext(embed.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { ids, net, get bootOptions() { return bootOptions; } };
}

test('the embed counts an open when Explore finds the walkthrough, as the embed channel, naming the framing site by hostname', async () => {
  const h = embedPage();
  await settle();
  assert.equal(h.net.sent.length, 0, 'loading the invitation is not an open');
  h.ids['embed-start'].events.click();
  await h.bootOptions.resolve(client()); await settle();
  assert.deepEqual(h.net.sent.map(item => item.body), [{ p_token: TOKEN, p_kind: 'open', p_src: 'embed', p_host: 'agency.example.invalid', p_detail: null }]);
  const tagged = embedPage({ search: '?t=' + TOKEN + '&src=portal', referrer: '' });
  tagged.ids['embed-start'].events.click();
  await tagged.bootOptions.resolve(client()); await settle();
  assert.deepEqual([tagged.net.sent[0].body.p_src, tagged.net.sent[0].body.p_host], ['portal', null]);
  const off = embedPage();
  off.ids['embed-start'].events.click();
  await off.bootOptions.resolve(client({ data: [] })).catch(() => {}); await settle();
  assert.equal(off.net.sent.length, 0);
});

/* ---- /tour: the portal-safe listing URL ------------------------------------------- */

function tourPage({ search = '?t=' + TOKEN + '&src=portal', framed = false, referrer = 'https://www.domain.example.invalid/listing/1' } = {}) {
  const document = createDocument();
  for (const match of tour.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const [, tag, before, id, after] = match;
    const node = document.createElement(tag);
    node.id = id;
    if (/\shidden\b/.test(before + after)) node.hidden = true;
    const text = tour.slice(match.index + match[0].length).match(/^([^<]*)</);
    if (text && text[1].trim()) node.textContent = text[1].replace(/\s+/g, ' ').trim();
    document.body.append(node);
  }
  document.referrer = referrer;
  document.title = 'Property walkthrough';
  const calls = [];
  let bootOptions = null, finishBoot = null;
  const player = {
    TourFailure,
    showFailure(els, options) { calls.push(options); els.title.textContent = options.heading; els.body.textContent = options.body; document.title = options.heading.replace(/\.$/, '') + ' — Veylet'; },
    boot(options) { bootOptions = options; return new Promise(resolve => { finishBoot = resolve; }); },
  };
  const net = recorder();
  const window = { VeyletPlayer: player, VEYLET_SUPABASE: CONFIG, addEventListener() {} };
  window.self = window;
  window.top = framed ? {} : window;
  const context = { window, document, location: { search }, URLSearchParams, URL, setTimeout, clearTimeout, fetch: net.fetch };
  vm.runInNewContext(clientSource, context);
  vm.runInNewContext(tour.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const id = name => document.getElementById(name);
  return { document, id, net, calls, get bootOptions() { return bootOptions; }, finishBoot: () => finishBoot() };
}

test('/tour is the walkthrough alone: no agent, contact, address, QR, maker’s mark or links, and the truth line stays', () => {
  const words = tour.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(words, /Veylet|Call|Email|QR|Share|Made with|Privacy|Terms|agent/i);
  assert.doesNotMatch(tour, /<a\b|agent-card|agent-bar|client-share|tel:|mailto:|brand-host\.js|style\.css|client-page\.css/);
  assert.match(tour, /<p class="tour-truth" id="tour-truth" hidden>Captured on site with an iPhone\. Not to scale\.<\/p>/);
  assert.match(tour, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(tour, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(tour, /<title>Property walkthrough<\/title>/);
  assert.match(tour, /<link rel="icon" href="data:," \/>/, 'no maker’s icon');
  assert.match(tour, /<script src="\/client-page\.js\?v=[a-f\d]{16}"><\/script>/);
  assert.match(tour, /<script src="\/tour-player\.js\?v=[a-f\d]{16}"><\/script>/);
  assert.match(tour, /\.tour-notice button \{[^}]*min-height: 44px;/);
  assert.match(tour, /:focus-visible/);
  assert.doesNotMatch(tour, /animation|transition/, 'nothing moves, so reduced motion has nothing to stop');
});

test('/tour opens the walkthrough at once, keeps the truth line, counts a portal open and names a framing site by hostname', async () => {
  const h = tourPage({ framed: true });
  assert.ok(h.bootOptions, 'no Explore press on a portal: the visitor already asked for the tour');
  assert.equal(h.id('tour-truth').hidden, true);
  const resolved = await h.bootOptions.resolve(client());
  assert.equal(resolved.title, 'Fictional practice space');
  assert.equal(h.id('tour-truth').hidden, false);
  await settle();
  assert.deepEqual(h.net.sent.map(item => item.body), [{ p_token: TOKEN, p_kind: 'open', p_src: 'portal', p_host: 'www.domain.example.invalid', p_detail: null }]);
  // Opened directly (not framed): no host. A link without a tag still reads as the portal channel.
  const direct = tourPage({ search: '?t=' + TOKEN });
  await direct.bootOptions.resolve(client()); await settle();
  assert.deepEqual([direct.net.sent[0].body.p_src, direct.net.sent[0].body.p_host], ['portal', null]);
  // The viewer on screen: the notice gives way (streamed) or shrinks (version 1).
  h.id('tour-stage').hidden = false; h.bootOptions.onVisible();
  assert.equal(h.id('tour-notice').hidden, true);
  const v1 = tourPage();
  v1.id('tour-frame').hidden = false; v1.bootOptions.onVisible();
  assert.equal(v1.id('tour-notice').dataset.mode, 'loading');
  v1.finishBoot(); await settle();
  assert.equal(v1.id('tour-notice').hidden, true);
  assert.equal(v1.id('tour-notice').dataset.mode, undefined);
});

test('/tour failures read plainly, with no agent to ask, and the tab keeps no maker’s name', async () => {
  const h = tourPage();
  assert.equal(h.bootOptions.missingHeading, 'This walkthrough isn’t available right now.');
  assert.equal(h.bootOptions.missingBody, 'It may have been paused or turned off.');
  assert.match(h.bootOptions.transientBody, /Check your connection and try again\.$/);
  const miss = await h.bootOptions.resolve(client({ data: [] })).catch(error => error);
  assert.equal(miss.message, 'share-not-found');
  assert.equal(miss.transient, false);
  h.id('tour-help').hidden = false;
  h.finishBoot(); await settle();
  assert.equal(h.id('tour-help').hidden, true, 'another browser will not help');
  assert.equal(h.id('tour-notice').hidden, false, 'nothing on the stage: the notice stays');
  assert.equal(h.net.sent.length, 0);
  const down = tourPage();
  const failure = await down.bootOptions.resolve(client({ error: { message: 'Synthetic' } })).catch(error => error);
  assert.equal(failure.transient, true);
  const incomplete = tourPage({ search: '?t=short' });
  assert.equal(incomplete.bootOptions, null);
  assert.deepEqual(plain(incomplete.calls[0]), { heading: 'This link looks incomplete.', body: 'Check you copied all of it.' });
  assert.equal(incomplete.document.title, 'This link looks incomplete', 'the player’s “— Veylet” is taken off');
});

/* ---- link preview card, headers, fixture --------------------------------------- */

test('the client’s page, the embed and /tour carry one generic preview card, with no link address in it', () => {
  const image = path.join(__dirname, '../dist/media/walkthrough-card.png');
  const bytes = fs.readFileSync(image);
  assert.ok(bytes.length < 100 * 1024, 'under 100 KB');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1200, 630]);
  for (const [name, html] of [['handoff', handoff], ['embed', embed], ['tour', tour]]) {
    assert.match(html, /<meta property="og:title" content="Property walkthrough" \/>/, name);
    assert.match(html, /<meta property="og:description" content="Walk through this property in 3D\." \/>/, name);
    assert.match(html, /<meta property="og:image" content="https:\/\/veylet\.com\/media\/walkthrough-card\.png" \/>/, name);
    assert.match(html, /<meta property="og:image:width" content="1200" \/>\s*<meta property="og:image:height" content="630" \/>/, name);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, name);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+" \/>/, name);
    assert.doesNotMatch(html, /<meta property="og:(url|site_name)"/, name + ': no address (it would carry the token) and no maker');
  }
});

test('vercel.json: /tour may be framed anywhere, /handoff still may not, and /app pages are not indexed', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  const rule = source => config.headers.find(item => item.source === source);
  const header = (source, key) => rule(source)?.headers.find(item => item.key === key)?.value;
  assert.equal(header('/tour', 'Content-Security-Policy'), 'frame-ancestors *');
  assert.equal(header('/tour', 'X-Frame-Options'), undefined);
  assert.equal(header('/tour', 'X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(header('/app/(.*)', 'X-Robots-Tag'), 'noindex, nofollow');
  // The catch-all DENY: every path but the embed and /tour itself (not /tour-player-v2.js, not /handoff).
  const deny = config.headers.filter(item => item.headers.some(h => h.key === 'X-Frame-Options' && h.value === 'DENY'));
  const matches = pathname => deny.some(item => {
    const pattern = '^' + item.source.replace(/\//g, '\\/') + '\\/?$';
    return new RegExp(pattern).test(pathname);
  });
  assert.equal(matches('/tour'), false);
  assert.equal(matches('/embed'), false);
  for (const pathname of ['/handoff', '/account', '/app/account', '/tour-player-v2.js', '/tour-sharing.js', '/tours', '/']) assert.equal(matches(pathname), true, pathname);
});

test('the QA fixture records record_tour_view from the beacon’s own POST and answers view counts and pause for each switch', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
  const load = search => {
    const context = { URLSearchParams, Response, location: { search, pathname: '/__qa/handoff/' }, localStorage: { getItem: () => null, setItem() {} },
      document: { createElement: () => ({}), addEventListener() {} } };
    context.window = context;
    vm.runInNewContext(source, context);
    return context;
  };
  const page = load('?t=' + TOKEN);
  const net = { fetch: page.fetch };
  const beacon = loadModule().viewBeacon({ config: page.VEYLET_SUPABASE, token: TOKEN, src: 'qr', fetch: net.fetch });
  beacon.send('open'); await settle();
  assert.deepEqual(plain(page.VEYLET_QA_CALLS.at(-1)), { name: 'record_tour_view', args: { p_token: TOKEN, p_kind: 'open', p_src: 'qr', p_host: null, p_detail: null } });
  const stats = (await page.supabase.createClient().rpc('get_tour_view_stats', { p_tour_id: 'synthetic-live-active' })).data[0];
  assert.deepEqual([stats.opens, stats.days_with_opens, stats.call_taps, stats.email_taps, stats.share_taps], [14, 5, 3, 1, 2]);
  assert.equal((await load('?views=zero').supabase.createClient().rpc('get_tour_view_stats', {})).data[0].opens, 0);
  assert.equal((await load('?views=missing').supabase.createClient().rpc('get_tour_view_stats', {})).error.code, 'PGRST202');
  const missing = load('?views=missing');
  const off = loadModule().viewBeacon({ config: missing.VEYLET_SUPABASE, token: TOKEN, fetch: missing.fetch });
  off.send('open'); await settle();
  assert.equal(off.enabled, false, 'the fixture answers 404 PGRST202 as PostgREST does');
  assert.deepEqual(plain((await load('?pause=paused').supabase.createClient().rpc('lookup_tour_share', { p_token: TOKEN })).data), []);
  assert.equal((await load('?pause=missing').supabase.createClient().rpc('pause_tour_share', { p_tour_id: 'x' })).error.code, 'PGRST202');
  assert.match(source, /`\?pause=paused` starts the live walkthrough on \/__qa\/account\/ paused/);
});
