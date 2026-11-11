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
const { WORDS, withClientHelpers } = require('./client-words.cjs');

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
  assert.deepEqual(net.sent[0].body, { p_token: TOKEN, p_kind: 'open', p_src: 'link', p_host: null, p_detail: null }, 'no CSPRNG here: no visit, and nothing invented in its place');
  assert.deepEqual(net.sent.at(-1).body, { p_token: TOKEN, p_kind: 'first_frame', p_src: 'link', p_host: null, p_detail: 4 });
  assert.equal(observed.disconnected, true);
  assert.equal(listeners.pagehide.options.once, true);
  now += 95 * 1000 + 400;
  listeners.pagehide.fn();
  listeners.pagehide.fn();
  assert.deepEqual(net.kinds(), ['open', 'first_frame', 'dwell']);
  assert.deepEqual(net.sent.at(-1).body.p_detail, { seconds: 95 });
  assert.equal(net.sent.at(-1).init.keepalive, true, 'the dwell survives pagehide as sendBeacon would');
  const long = page.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', fetch: net.fetch, now: () => now });
  const longWin = { addEventListener: (name, fn) => { listeners.long = fn; } };
  long.opened(longWin);
  now += 5 * 3600 * 1000;
  listeners.long();
  assert.deepEqual(net.sent.at(-1).body.p_detail, { seconds: 3600 }, 'capped');
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
  const player = withClientHelpers({ TourFailure, showFailure(els, options) { els.title.textContent = options.heading; }, boot(options) { bootOptions = options; return new Promise(resolve => { finishBoot = resolve; }); } });
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
  // The share lookup before Explore (a live share here) is not a view: only the beacon's posts are recorded.
  const fetch = (url, init) => (String(url).endsWith('/lookup_tour_share')
    ? Promise.resolve({ ok: true, status: 200, json: async () => [{ storage_path: 'p/package.zip' }] }) : net.fetch(url, init));
  const window = { VeyletPlayer: player, VEYLET_SUPABASE: CONFIG, supabase: { createClient() {} }, addEventListener() {} };
  const context = { window, document: { getElementById: id => ids[id], referrer }, location: { search }, URLSearchParams, URL, setTimeout, clearTimeout, fetch };
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
  await settle();
  tagged.ids['embed-start'].events.click();
  await tagged.bootOptions.resolve(client()); await settle();
  assert.deepEqual([tagged.net.sent[0].body.p_src, tagged.net.sent[0].body.p_host], ['portal', null]);
  const off = embedPage();
  await settle();
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
  const player = withClientHelpers({
    TourFailure,
    showFailure(els, options) { calls.push(options); els.title.textContent = options.heading; els.body.textContent = options.body; document.title = options.heading.replace(/\.$/, '') + ' — Veylet'; },
    boot(options) { bootOptions = options; return new Promise(resolve => { finishBoot = resolve; }); },
  });
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
  // One link only: the quiet "Report this walkthrough" (launch plan C2.3), a new tab to /report?t=.
  const report = '<a id="tour-report" target="_blank" rel="noopener noreferrer">Report this walkthrough</a>';
  assert.equal(tour.split(report).length, 2, 'the report link, exactly once');
  assert.doesNotMatch(tour.replace(report, ''), /<a\b|agent-card|agent-bar|client-share|tel:|mailto:|brand-host\.js|style\.css|client-page\.css/);
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
  // The shared client words (tour-player.js WORDS), the same on /handoff and /embed; none of its own.
  assert.equal(h.bootOptions.client, true);
  assert.deepEqual([h.bootOptions.missingHeading, h.bootOptions.missingBody, h.bootOptions.transientBody], [undefined, undefined, undefined]);
  assert.equal(WORDS.missingBody, 'It may have been paused or turned off. Ask the person who sent it for a new link.');
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
  assert.deepEqual(plain(incomplete.calls[0]), { heading: 'This link looks incomplete.', body: 'Check you copied all of it, or ask the person who sent it.' });
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
    assert.match(html, /<meta property="og:description" content="Look around this property in 3D, stop by stop\." \/>/, name);
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

test('bookingHref, viewingRequestHref, contactActions booking CTA and beacon.roomVisited work first-party without cookies', async () => {
  const mod = loadModule();
  assert.equal(mod.bookingHref('https://cal.com/harbour-realty/inspection'), 'https://cal.com/harbour-realty/inspection');
  assert.equal(mod.bookingHref('http://insecure.example.com'), '');
  assert.equal(mod.bookingHref('javascript:alert(1)'), '');
  const mailHref = mod.viewingRequestHref('ari@harbour.example.au', '12 Harbour Loft', 'Ari Lee');
  assert.match(mailHref, /^mailto:ari@harbour\.example\.au\?subject=Book%20a%20viewing%3A%2012%20Harbour%20Loft&body=/);

  const contactWithUrl = mod.contactFrom([{
    display_name: 'Ari Lee',
    agency: 'Harbour Realty',
    phone: '+61 400 000 000',
    email: 'ari@harbour.example.au',
    booking_url: 'https://cal.com/harbour-realty/inspection',
  }]);
  assert.equal(contactWithUrl.bookingUrl, 'https://cal.com/harbour-realty/inspection');

  const contactWithRequest = mod.contactFrom([{
    display_name: 'Ari Lee',
    agency: 'Harbour Realty',
    phone: '+61 400 000 000',
    email: 'ari@harbour.example.au',
    allow_viewing_request: true,
  }]);
  assert.equal(contactWithRequest.allowViewingRequest, true);

  const net = recorder();
  const docListeners = {};
  const win = {
    addEventListener() {},
    document: {
      addEventListener(name, fn) { docListeners[name] = fn; },
    },
  };
  const beacon = mod.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', fetch: net.fetch });
  beacon.opened(win);
  docListeners['veylet:room']?.({ detail: { room: 'Kitchen' } });
  docListeners['veylet:room']?.({ detail: { room: 'Kitchen' } });
  docListeners['veylet:room']?.({ detail: { room: 'Living Room' } });
  await settle();
  const roomEvents = net.sent.filter(item => item.body.p_kind === 'room');
  assert.deepEqual(roomEvents.map(item => item.body.p_detail), [{ room: 'Kitchen' }, { room: 'Living Room' }]);
});

/* ---- walkthrough insights: visit, stop, look (10 Nov 2026) ------------------- */

const HEX32 = /^[0-9a-f]{32}$/;
/** A CSPRNG stand-in that counts its calls and never repeats. */
function fakeCrypto() {
  const random = { calls: 0, getRandomValues(bytes) { random.calls++; for (let i = 0; i < bytes.length; i++) bytes[i] = (random.calls * 37 + i * 11) & 255; return bytes; } };
  return random;
}
/**
 * A page for the beacon: a document and window that keep their listeners, an interval the test
 * fires by hand, a clock, and a player whose view() answers whatever the test last set.
 */
function insightPage(options = {}) {
  const net = recorder(options.answer);
  const listeners = { doc: {}, win: {} };
  const intervals = new Map();
  let nextId = 1;
  const page = {
    now: 10000, view: null, viewReads: 0, net, listeners, intervals,
    document: { hidden: false, visibilityState: 'visible', addEventListener: (name, fn) => { (listeners.doc[name] ||= []).push(fn); } },
  };
  page.win = {
    document: page.document,
    addEventListener: (name, fn) => { (listeners.win[name] ||= []).push(fn); },
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => { intervals.delete(id); },
    VeyletPlayerV2: { current: { view: () => { page.viewReads++; return page.view; } } },
  };
  page.emit = (name, detail) => { for (const fn of listeners.doc[name] || []) fn({ detail }); };
  page.leave = () => { for (const fn of listeners.win.pagehide || []) fn(); };
  /** Half-second readings, as the browser's timer would make them. */
  page.tick = (times = 1, ms = 500) => { for (let i = 0; i < times; i++) { page.now += ms; for (const timer of [...intervals.values()]) timer.fn(); } };
  page.hide = hidden => { page.document.hidden = hidden; page.document.visibilityState = hidden ? 'hidden' : 'visible'; page.emit('visibilitychange'); };
  page.module = loadModule(options.context || {});
  page.beacon = page.module.viewBeacon({ config: CONFIG, token: TOKEN, src: 'link', fetch: net.fetch, now: () => page.now,
    ...('crypto' in options ? { crypto: options.crypto } : { crypto: fakeCrypto() }) });
  page.of = kind => net.sent.filter(item => item.body.p_kind === kind);
  return page;
}

test('look directions fall into 12 sectors of 30 degrees and 3 pitch bands, in the tour’s own frame', () => {
  const { lookBin } = loadModule();
  // Yaw 0 looks along -Z and grows turning left (anticlockwise from above): bin k is 30k <= yaw < 30k + 30.
  assert.equal(lookBin(0, 0), '0_1');
  assert.equal(lookBin(29.999, 0), '0_1');
  assert.equal(lookBin(30, 0), '1_1');
  assert.equal(lookBin(90, 0), '3_1', 'yaw 90 looks along -X');
  assert.equal(lookBin(180, 0), '6_1');
  assert.equal(lookBin(359.999, 0), '11_1');
  assert.equal(lookBin(360, 0), '0_1');
  assert.equal(lookBin(725, 0), '0_1', 'whole turns are taken off');
  assert.equal(lookBin(-1, 0), '11_1', 'a turn to the right of 0 is the last sector');
  assert.equal(lookBin(-90, 0), '9_1');
  assert.equal(lookBin(-1e-13, 0), '11_1', 'never a 12th sector');
  // Pitch: 0 is down (below -15), 1 level (-15..15 inclusive), 2 up (above 15).
  assert.deepEqual([-80, -15.01, -15, 0, 15, 15.01, 80].map(pitch => lookBin(45, pitch)), ['1_0', '1_0', '1_1', '1_1', '1_1', '1_2', '1_2']);
  for (const bad of [[NaN, 0], [0, NaN], [Infinity, 0], ['90', 0], [null, 0], [0, undefined]]) assert.equal(lookBin(...bad), null, String(bad));
  // Every reading lands in one of exactly 36 bins.
  const seen = new Set();
  for (let yaw = -720; yaw <= 720; yaw += 7.5) for (const pitch of [-80, -20, 0, 20, 80]) seen.add(lookBin(yaw, pitch));
  assert.equal(seen.size, 36);
  for (const key of seen) assert.match(key, /^(\d|1[01])_[0-2]$/);
});

test('the visit is 32 random hex per page load, in memory only: no cookie, no storage, never Math.random', async () => {
  // Any touch of browser storage or a cookie throws; Math.random throws.
  const trap = name => new Proxy({}, { get() { throw new Error(name + ' was touched'); }, set() { throw new Error(name + ' was written'); } });
  const touched = [];
  const documentTrap = new Proxy({}, { get(target, key) { touched.push(String(key)); return undefined; }, set(target, key) { touched.push('set ' + String(key)); return true; } });
  const context = { localStorage: trap('localStorage'), sessionStorage: trap('sessionStorage'), indexedDB: trap('indexedDB'), document: documentTrap,
    Math: Object.assign(Object.create(Math), { random() { throw new Error('Math.random was used'); } }) };
  const random = fakeCrypto();
  const page = insightPage({ context, crypto: random });
  assert.match(page.beacon.visit, HEX32);
  assert.equal(random.calls, 1, 'one draw of 16 bytes');
  page.beacon.opened(page.win);
  page.view = { stop: 0, yaw: 10, pitch: 0 };
  page.emit('veylet:stop', { stop: 0, room: 'Kitchen' });
  page.emit('veylet:room', { room: 'Kitchen' });
  page.tick(4);
  page.leave();
  await settle();
  assert.deepEqual(page.net.kinds(), ['open', 'stop', 'room', 'look', 'dwell']);
  for (const item of page.net.sent) assert.equal(item.body.p_detail.visit, page.beacon.visit, item.body.p_kind + ' carries the visit');
  assert.deepEqual(page.of('open')[0].body.p_detail, { visit: page.beacon.visit });
  assert.deepEqual(page.of('room')[0].body.p_detail, { visit: page.beacon.visit, room: 'Kitchen' });
  assert.deepEqual(page.of('dwell')[0].body.p_detail, { visit: page.beacon.visit, seconds: 2 });
  // first_frame stays the bare number of seconds it always was, even with a visit in hand.
  const framed = insightPage();
  let observer = null;
  framed.win.PerformanceObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() {} };
  framed.beacon.opened(framed.win);
  observer({ getEntries: () => [{ name: 'veylet:first-3d', startTime: 3200 }] });
  assert.equal(framed.of('first_frame')[0].body.p_detail, 3);
  assert.deepEqual(touched, [], 'the module’s own document (cookies live there) is never read or written');
  assert.equal(random.calls, 1, 'the same token for the whole page load');
  // The token never rides in the address, a header or anywhere but the JSON body.
  for (const { url, init } of page.net.sent) {
    assert.equal(url, ENDPOINT);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.ok(!JSON.stringify(init.headers).includes(page.beacon.visit));
  }
  // Another page load is another visit.
  const again = insightPage({ crypto: random });
  assert.match(again.beacon.visit, HEX32);
  assert.notEqual(again.beacon.visit, page.beacon.visit);
  // The source names no storage at all outside its comments.
  const code = clientSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|\.cookie|Math\.random/);
});

test('without a CSPRNG there is no visit, no stop and no look; the counts carry on as before', async () => {
  for (const crypto of [null, {}, { getRandomValues() { throw new Error('blocked'); } }]) {
    const page = insightPage({ crypto });
    assert.equal(page.beacon.visit, null);
    page.beacon.opened(page.win);
    assert.equal(page.intervals.size, 0, 'nothing is sampled');
    page.view = { stop: 0, yaw: 0, pitch: 0 };
    page.emit('veylet:stop', { stop: 0, room: 'Kitchen' });
    assert.equal(page.beacon.stopArrived(1, 'Hall'), false);
    assert.equal(page.beacon.sampleLook(page.view), false);
    page.now += 3000;
    page.leave();
    assert.deepEqual(page.net.kinds(), ['open', 'dwell']);
    assert.deepEqual(page.of('open')[0].body.p_detail, null);
    assert.deepEqual(page.of('dwell')[0].body.p_detail, { seconds: 3 });
  }
});

test('a stop is said on arrival; its one look is said on leaving it, with the time in each direction', async () => {
  const page = insightPage();
  const visit = page.beacon.visit;
  page.beacon.opened(page.win);
  assert.deepEqual([...page.intervals.values()].map(timer => timer.ms), [500], 'one reading about twice a second');
  // Before the first 3D frame the player has no view: nothing is counted and nothing is sent.
  page.tick(6);
  assert.ok(page.viewReads >= 6);
  assert.deepEqual(page.net.kinds(), ['open']);
  // The opening stop, announced by the player with its room.
  page.view = { stop: 2, yaw: 10, pitch: 0 };
  page.emit('veylet:stop', { stop: 2, room: '  Kitchen   and dining ' });
  assert.deepEqual(page.of('stop')[0].body, { p_token: TOKEN, p_kind: 'stop', p_src: 'link', p_host: null, p_detail: { visit, stop: 2, room: 'Kitchen and dining' } });
  assert.equal(page.of('stop')[0].init.keepalive, false);
  page.tick(4);                                   // 2000 ms looking at 0_1
  page.view = { stop: 2, yaw: 95, pitch: -40 };
  page.tick(2);                                   // 1000 ms at 3_0
  page.view = { stop: 2, yaw: -20, pitch: 30 };
  page.tick(1);                                   // 500 ms at 11_2
  // Arriving again where you stand is not a new arrival, and says nothing.
  page.emit('veylet:stop', { stop: 2, room: 'Kitchen and dining' });
  assert.equal(page.of('stop').length, 1);
  assert.equal(page.of('look').length, 0, 'nothing about the look until the stop is left');
  // A flight: the player answers stop -1, and that time belongs to no stop.
  page.view = { stop: -1, yaw: 180, pitch: 0 };
  page.tick(3);
  // Arrival at the next stop: its stop event, and the look for the one just left.
  page.view = { stop: 5, yaw: 200, pitch: 0 };
  page.emit('veylet:stop', { stop: 5, room: null });
  assert.deepEqual(page.net.kinds(), ['open', 'stop', 'look', 'stop']);
  const look = page.of('look')[0];
  assert.deepEqual(look.body, { p_token: TOKEN, p_kind: 'look', p_src: 'link', p_host: null,
    p_detail: { visit, stop: 2, ms: 3500, bins: { '0_1': 2000, '3_0': 1000, '11_2': 500 } } });
  assert.equal(look.init.keepalive, false);
  assert.equal(look.init.credentials, 'omit');
  assert.equal(look.init.referrerPolicy, 'no-referrer');
  assert.deepEqual(page.of('stop')[1].body.p_detail, { visit, stop: 5, room: null });
  // Leaving the page: the last stop's look, then the dwell, both keepalive, both once.
  page.tick(3);
  page.leave();
  page.leave();
  assert.deepEqual(page.net.kinds(), ['open', 'stop', 'look', 'stop', 'look', 'dwell']);
  const last = page.of('look')[1];
  assert.deepEqual(last.body.p_detail, { visit, stop: 5, ms: 1500, bins: { '6_1': 1500 } });
  assert.equal(last.init.keepalive, true);
  assert.equal(page.of('dwell')[0].init.keepalive, true);
  assert.equal(page.intervals.size, 0, 'the reading stops with the page');
  // Every look: whole milliseconds, bins that add up to ms, no empty bin, at most 36 keys, under the 1 KB the table keeps.
  for (const item of page.of('look')) {
    const { ms, bins } = item.body.p_detail;
    assert.ok(Number.isInteger(ms) && ms > 0 && ms <= 600000);
    assert.equal(Object.values(bins).reduce((sum, value) => sum + value, 0), ms);
    assert.ok(Object.keys(bins).length <= 36 && Object.values(bins).every(value => Number.isInteger(value) && value > 0));
    for (const key of Object.keys(bins)) assert.match(key, /^(\d|1[01])_[0-2]$/);
  }
});

test('a hidden page is not sampled: the timer is cleared, no time is counted, and nothing is read from the player', () => {
  const page = insightPage();
  page.beacon.opened(page.win);
  page.view = { stop: 1, yaw: 40, pitch: 0 };
  page.emit('veylet:stop', { stop: 1, room: 'Hall' });
  page.tick(2);                                   // 1000 ms
  page.hide(true);
  assert.equal(page.intervals.size, 0, 'no timer runs while hidden');
  const reads = page.viewReads;
  page.now += 5 * 60 * 1000;                      // five minutes in another tab
  page.tick(10, 0);                               // nothing left to fire
  assert.equal(page.viewReads, reads, 'the player is not asked anything while hidden');
  assert.equal(page.beacon.sampleLook(page.view), false, 'a reading with nothing before it counts no time');
  page.hide(false);
  assert.equal(page.intervals.size, 1, 'and it starts again when the page is seen');
  page.tick(2);                                   // 1000 ms more, counted from the return: none of the five minutes
  page.leave();
  assert.deepEqual(page.of('look')[0].body.p_detail.bins, { '1_1': 2000 });
  assert.equal(page.of('look')[0].body.p_detail.ms, 2000);
  // A page opened in a background tab starts no timer until it is seen.
  const background = insightPage();
  background.document.hidden = true; background.document.visibilityState = 'hidden';
  background.beacon.opened(background.win);
  assert.equal(background.intervals.size, 0);
  background.hide(false);
  assert.equal(background.intervals.size, 1);
  // A timer the browser held back counts as one second at most, never the whole gap.
  const slow = insightPage();
  slow.beacon.opened(slow.win);
  slow.view = { stop: 0, yaw: 0, pitch: 0 };
  slow.emit('veylet:stop', { stop: 0, room: null });
  slow.tick(1, 45000);
  slow.leave();
  assert.equal(slow.of('look')[0].body.p_detail.ms, 1000);
});

test('the insight events stay few and in range: 0..63 stops, 60-character rooms, ten minutes a stop, 32 of each a visit', () => {
  const page = insightPage();
  const visit = page.beacon.visit;
  page.beacon.opened(page.win);
  // Stops outside 0..63, fractions and words are not stops.
  for (const stop of [-1, 64, 1.5, '3', null, undefined, NaN]) {
    page.emit('veylet:stop', { stop, room: 'Hall' });
    assert.equal(page.beacon.sampleLook({ stop, yaw: 0, pitch: 0 }), false);
  }
  page.emit('veylet:stop', null);
  assert.deepEqual(page.net.kinds(), ['open']);
  // A long room name is cut at 60 characters; a room that is not text is null.
  page.emit('veylet:stop', { stop: 63, room: 'R'.repeat(90) });
  page.emit('veylet:stop', { stop: 0, room: { name: 'x' } });
  assert.deepEqual(page.of('stop').map(item => item.body.p_detail), [{ visit, stop: 63, room: 'R'.repeat(60) }, { visit, stop: 0, room: null }]);
  assert.equal(page.of('look').length, 0, 'a stop left with no time read at it has no look');
  // A stop the player never announced is still noticed from the reading itself, without a room.
  page.view = { stop: 7, yaw: 0, pitch: 0 };
  page.tick(1);
  assert.deepEqual(page.of('stop').at(-1).body.p_detail, { visit, stop: 7, room: null });
  // Ten minutes at one stop is the most a look says.
  page.tick(1500);                                // 750 s of readings
  page.emit('veylet:stop', { stop: 8, room: null });
  assert.deepEqual(page.of('look').at(-1).body.p_detail, { visit, stop: 7, ms: 600000, bins: { '0_1': 600000 } });
  // However long someone wanders: at most 32 stop events and 32 look events.
  for (let i = 0; i < 200; i++) {
    page.view = { stop: i % 40, yaw: i * 17, pitch: 0 };
    page.emit('veylet:stop', { stop: i % 40, room: null });
    page.tick(2);
  }
  page.leave();
  assert.equal(page.of('stop').length, 32);
  assert.equal(page.of('look').length, 32);
  assert.equal(page.net.sent.length, 1 + 32 + 32 + 1, 'open, stops, looks, dwell');
});

test('a player error, a missing player or an older player never reaches the page; an older backend ends stops and looks quietly', async () => {
  // view() throws, is missing, or answers nonsense: no error, no event.
  for (const current of [{ view() { throw new Error('lost context'); } }, {}, null, { view: () => 'north' }, { view: () => ({ stop: 0, yaw: 'left', pitch: 0 }) }]) {
    const page = insightPage();
    page.win.VeyletPlayerV2 = { current };
    page.beacon.opened(page.win);
    assert.doesNotThrow(() => page.tick(4));
    assert.deepEqual(page.net.kinds(), ['open']);
  }
  const bare = insightPage();
  delete bare.win.VeyletPlayerV2;
  bare.beacon.opened(bare.win);
  assert.doesNotThrow(() => bare.tick(2));
  // A window without timers (or a document without events) still counts the open and the dwell.
  const plain = insightPage();
  assert.doesNotThrow(() => plain.beacon.opened({ addEventListener: plain.win.addEventListener }));
  assert.deepEqual(plain.net.kinds(), ['open']);
  // A backend from before the two kinds refuses them (400): after the first refusal no more are sent this visit...
  const old = insightPage({ answer: (url, init) => (['stop', 'look'].includes(JSON.parse(init.body).p_kind)
    ? { ok: false, status: 400, json: async () => ({ code: 'P0001', message: 'unknown kind' }) } : { ok: true, status: 204, json: async () => null }) });
  old.beacon.opened(old.win);
  old.view = { stop: 0, yaw: 0, pitch: 0 };
  old.emit('veylet:stop', { stop: 0, room: 'Hall' });
  await settle();
  old.tick(4);
  assert.equal(old.intervals.size, 0, 'and the reading stops');
  old.emit('veylet:stop', { stop: 1, room: 'Hall' });
  old.emit('veylet:room', { room: 'Hall' });
  old.leave();
  // ...while the kinds it does know carry on.
  assert.deepEqual(old.net.kinds(), ['open', 'stop', 'room', 'dwell']);
  assert.equal(old.beacon.enabled, true);
  // A backend without the function at all turns everything off, as before.
  const gone = insightPage({ answer: () => ({ ok: false, status: 404, json: async () => ({ code: 'PGRST202' }) }) });
  gone.beacon.opened(gone.win);
  await settle();
  gone.emit('veylet:stop', { stop: 0, room: null });
  gone.tick(2);
  gone.leave();
  assert.deepEqual(gone.net.kinds(), ['open']);
});

test('the QA fixture records stop and look as the beacon posts them, and answers the heat map for each ?heat= switch', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
  const load = search => {
    const context = { URLSearchParams, Response, location: { search, pathname: '/__qa/handoff/' }, localStorage: { getItem: () => null, setItem() {} },
      document: { createElement: () => ({}), addEventListener() {} } };
    context.window = context;
    vm.runInNewContext(source, context);
    return context;
  };
  const qa = load('?t=' + TOKEN);
  const beacon = loadModule().viewBeacon({ config: qa.VEYLET_SUPABASE, token: TOKEN, src: 'link', fetch: qa.fetch, crypto: fakeCrypto(), now: () => 0 });
  beacon.stopArrived(3, 'Kitchen');
  await settle();
  assert.deepEqual(plain(qa.VEYLET_QA_CALLS.at(-1)), { name: 'record_tour_view',
    args: { p_token: TOKEN, p_kind: 'stop', p_src: 'link', p_host: null, p_detail: { visit: beacon.visit, stop: 3, room: 'Kitchen' } } });
  const client = search => load(search).supabase.createClient();
  const heat = (await client('').rpc('get_tour_view_heatmap', { p_tour_id: 'synthetic-live-active' })).data;
  assert.equal(heat.visits, 11);
  assert.ok(!Number.isNaN(Date.parse(heat.since)));
  assert.equal(heat.stops.length, 8);
  for (const row of heat.stops) {
    assert.ok(Number.isInteger(row.stop) && row.stop >= 0 && row.stop <= 63);
    assert.ok(row.room === null || (typeof row.room === 'string' && row.room.length <= 60));
    assert.ok(Number.isInteger(row.visits) && Number.isInteger(row.seconds));
    assert.ok(Object.keys(row.bins).length <= 36);
    for (const [key, value] of Object.entries(row.bins)) { assert.match(key, /^(\d|1[01])_[0-2]$/); assert.ok(value > 0); }
    assert.equal(Object.values(row.bins).reduce((sum, value) => sum + value, 0), row.seconds, 'the fixture’s bins add up to its seconds');
  }
  assert.deepEqual(plain(heat.stops.map(row => row.stop)), [0, 1, 2, 3, 4, 5, 6, 7], 'stops in stop order, as the function answers');
  const stats = (await client('').rpc('get_tour_view_stats', {})).data[0];
  // Every room that has seconds has visits (the desk divides one by the other), and the busiest room is entered on every visit.
  assert.deepEqual([stats.visits, stats.avg_dwell_seconds, plain(stats.by_room)], [11, 96, { 'Living area': 11, Kitchen: 9, 'Main bedroom': 6, Balcony: 2 }]);
  assert.deepEqual(plain(stats.by_room_seconds), { Kitchen: 272, 'Living area': 258, 'Main bedroom': 129, Balcony: 5 });
  // by_room_seconds is the heat map's seconds added up by room, as the draft's two functions read the same rows.
  const byRoom = {};
  for (const row of heat.stops) if (row.room) byRoom[row.room] = (byRoom[row.room] || 0) + row.seconds;
  assert.deepEqual(byRoom, plain(stats.by_room_seconds));
  // Every answer carries exactly the thirteen columns get_tour_view_stats returns (draft 20261110100000), whatever the case.
  const COLUMNS = ['opens', 'days_with_opens', 'call_taps', 'email_taps', 'share_taps', 'by_src', 'by_host', 'last_opened_at', 'explores', 'avg_dwell_seconds', 'visits', 'by_room', 'by_room_seconds'];
  for (const search of ['', '?views=zero', '?views=few']) {
    const row = (await client(search).rpc('get_tour_view_stats', {})).data[0];
    assert.deepEqual(plain(Object.keys(row)), COLUMNS, search || 'default');
  }
  const few = (await client('?views=few').rpc('get_tour_view_heatmap', {})).data;
  assert.deepEqual([Object.keys(plain(few)), few.visits < 5, plain(few.stops).every(row => row.visits <= few.visits)], [['stops', 'visits', 'since'], true, true]);
  assert.deepEqual(Object.keys(plain(heat)), ['stops', 'visits', 'since']);
  for (const row of [...plain(heat.stops), ...plain(few.stops)]) assert.deepEqual(Object.keys(row), ['stop', 'room', 'visits', 'seconds', 'bins']);
  assert.deepEqual(plain((await client('?heat=empty').rpc('get_tour_view_heatmap', {})).data.stops), []);
  assert.deepEqual(plain((await client('?heat=empty').rpc('get_tour_view_heatmap', {})).data), { stops: [], visits: 0, since: null });
  assert.equal((await client('?heat=missing').rpc('get_tour_view_heatmap', {})).error.code, 'PGRST202');
  assert.equal((await client('?views=missing').rpc('get_tour_view_heatmap', {})).error.code, 'PGRST202');
  assert.equal((await client('?heat=error').rpc('get_tour_view_heatmap', {})).error.code, undefined);
  assert.match(source, /`\?heat=empty` answers no visits yet/);
});
