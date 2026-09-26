/*
 * Public copy against what the system does (launch audit 26 September 2026, wave 2 lane E, slice S12).
 *
 * Owner decisions of 26-27 September 2026: processing is fully automatic (no studio, no person checking);
 * DIY iPhone only; "Approve and share" is one press; ONE WALKTHROUGH = ONE CAPTURE = ONE LINK (never one
 * link per property). Contracts: dist/offer/offer.json 2026-09-26.3 (descriptive text only),
 * docs/render-status-contract-20260925.md and docs/ux/capture-to-client-journey-20260925.md §5.2 in the
 * product repository. Legal wording on /terms, /privacy and their /app copies is a draft for the owner's
 * legal pass (OWNERSHIP item 7), marked with LEGAL REVIEW comments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');
const exists = file => fs.existsSync(path.join(DIST, file));
const offer = JSON.parse(read('offer/offer.json'));
const checker = import(pathToFileURL(path.join(ROOT, 'scripts/check-app-pages.mjs')));

const decode = text => text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’');
/** What a reader sees: no comments, scripts, styles or tags. */
const visible = html => decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** What a crawler or an assistant reads: visible text plus the JSON-LD answers and meta descriptions. */
const readable = html => visible(html) + ' ' + [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).join(' ') + ' ' + [...html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/g)].map(match => decode(match[1])).join(' ');

function walk(dir) {
  return fs.readdirSync(path.join(DIST, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = dir ? dir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) return ['samples', 'vendor', 'media'].includes(relative) ? [] : walk(relative);
    return [relative];
  });
}
const ALL = walk('');
const HTML = ALL.filter(file => file.endsWith('.html'));

// This lane's public pages (wave 2 lane E ownership), plus the help centre it renders.
const OWNED_PAGES = ['index.html', 'offer/index.html', 'start/index.html', 'support/index.html', 'app/support/index.html',
  'terms/index.html', 'app/terms/index.html', 'privacy/index.html', 'app/privacy/index.html', 'see/index.html',
  'waitlist/index.html', 'apply/index.html', 'request/index.html', 'report/index.html', 'website-guide/index.html'];
const HELP = HTML.filter(file => file.startsWith('help/') || file.startsWith('app/help/'));
const PUBLIC_COPY = [...OWNED_PAGES, ...HELP];
// The offer record's descriptive text, less its history (a record of what earlier versions said).
const offerText = JSON.stringify({ ...offer, history: undefined });

// ---- one walkthrough = one capture = one link ------------------------------------------------------

const UNIT = 'Each capture is one walkthrough, with one link and one QR code.';
const ONE_LINK_PER_PROPERTY = [
  /one link (?:and (?:one )?QR code )?(?:per|for (?:each|every|the whole|a)) property/i,
  /every property gets (?:one|a single) link/i,
  /one property: one link/i,
  /however many walkthroughs/i,
  /up to 8 rooms of one property/i,
  /rooms captured at one property/i,
  /linkPerProperty|walkthroughsPerProperty/,
];

test('one walkthrough = one capture = one link: no page, summary or offer text promises one link per property', () => {
  const sources = [...HTML.map(file => [file, readable(read(file))]), ['llms.txt', read('llms.txt')], ['offer/offer.json (less history)', offerText]];
  for (const [file, text] of sources) {
    for (const pattern of ONE_LINK_PER_PROPERTY) assert.doesNotMatch(text, pattern, `${file} still says ${pattern}`);
  }
  for (const file of ['offer/index.html', 'start/index.html', 'terms/index.html', 'app/terms/index.html', 'help/your-plan/index.html',
    'app/help/your-plan/index.html']) {
    assert.ok(visible(read(file)).includes(UNIT), `${file} states the unit: ${UNIT}`);
  }
  assert.ok(read('llms.txt').includes(UNIT), 'llms.txt states the unit');
  const scope = offer.walkthroughScope;
  assert.equal(scope.unit, 'one capture: one walkthrough with one link and one QR code, counted by the rooms captured');
  assert.match(scope.link, /^one link and one QR code per capture; a correction or a recapture of named rooms keeps the same link$/);
  assert.equal(offer.counting.roomsRule, 'counted automatically from the rooms in one capture; a correction of the same walkthrough and a recapture of named rooms use none');
  // The record of the change that introduced the rooms rule stays as written, with the owner's restatement beside it.
  const restated = offer.history.find(entry => entry.version === '2026-09-26.2');
  assert.match(restated.restated, /^27 September 2026, owner decision, version unchanged: one walkthrough = one capture = one link/);
});

// ---- one-press approval: no "seven checks" ------------------------------------------------------

test('no page or summary says "seven checks"; the approve-and-share help quotes the one required tick word for word', () => {
  const RIGHT_TO_SHARE = read('account.js').match(/const RIGHT_TO_SHARE = '([^']+)';/)[1];
  assert.equal(RIGHT_TO_SHARE, 'I have the right to share this walkthrough.');
  const sources = [...ALL.filter(file => /\.(?:html|js|txt)$/.test(file)).map(file => [file, read(file)]),
    ['tests/help-articles.cjs', fs.readFileSync(path.join(__dirname, 'help-articles.cjs'), 'utf8')]];
  for (const [file, text] of sources) assert.doesNotMatch(text, /seven checks|all seven|7 checks/i, file);
  for (const file of ['help/approve-and-share/index.html', 'app/help/approve-and-share/index.html']) {
    const html = read(file);
    const words = visible(html);
    assert.match(html, /<h1>Approve and share<\/h1>/, file);
    assert.ok(words.includes(`“${RIGHT_TO_SHARE}”`), `${file} quotes the tick: ${RIGHT_TO_SHARE}`);
    assert.match(words, /The button stays off until that one box is ticked\./, file);
    assert.match(words, /Worth a look before you share/, `${file} shows the flags as advice`);
    assert.doesNotMatch(words, /Tick each check|Capture permission Permission to publish/, file);
  }
  assert.match(read('llms.txt'), /- Approve and share: https:\/\/veylet\.com\/help\/approve-and-share/);
});

test('the privacy help matches one-press approval: a look for people, photos, documents and screens, no privacy tick', () => {
  for (const file of ['help/privacy-and-consent/index.html', 'app/help/privacy-and-consent/index.html']) {
    const words = visible(read(file));
    assert.doesNotMatch(words, /tick the privacy check|both permissions/i, file);
    assert.match(words, /Before you approve, walk the whole walkthrough and look for people, photos, documents and screens\./, file);
  }
});

// ---- no studio, no person checking ----------------------------------------------------------------

test('no page describes a studio, attended processing or a person checking', () => {
  // Every page and script (PRODUCT_SIMPLICITY-20): the retired process wording.
  for (const file of ALL.filter(name => /\.(?:html|js|txt)$/.test(name))) {
    assert.doesNotMatch(read(file), /studio check|processing is attended|installation link Veylet sends|confirm[^.<]{0,80}with Veylet support/i, file);
  }
  // This lane's pages: no studio at all, except the brand ("Veylet Studio") and the studio invoice channel.
  // tests/account-flow.test.cjs pins one /terms clause word for word (a follow-up for its owner).
  const PINNED = { 'terms/index.html': 'through the studio for an account it invoices' };
  for (const file of PUBLIC_COPY) {
    const words = visible(read(file)).replace(PINNED[file] || '\u0000', '')
      .replace(/\bVeylet Studio\b|\bVEYLET STUDIO\b|\bstudio[ -]invoice[sd]?\b|\bStudio-invoiced\b/gi, '');
    assert.doesNotMatch(words, /\bstudio\b/i, `${file}: ${(words.match(/.{0,60}\bstudio\b.{0,40}/i) || [''])[0]}`);
    assert.doesNotMatch(words, /production approval|(?<!no )person checks|consolidated list of corrections|send one list of corrections|reviewed within a few working days/i, file);
  }
  const llms = read('llms.txt').replace(/\bVeylet Studio\b|\bstudio invoices?\b/gi, '');
  assert.doesNotMatch(llms, /\bstudio\b/i, 'llms.txt');
});

test('the quality gate is described as it works: impossible renders stop, everything else is a flag for review', () => {
  const GATE = 'An automatic quality check stops a render that cannot work, such as one with no usable photos or depth, and asks for a recapture of the rooms it names; anything else it finds is flagged as worth a look for you to check before you approve.';
  assert.equal(offer.processing.qualityGate, 'an automatic quality check stops a render that cannot work (no usable photos or depth, too large for a phone, over the upload limits): it retries once when a retry can help, then asks for a recapture of the named rooms; other findings (held-out photo match, coverage, floaters, walkable paths, plus an AI visual check once the privacy notice covers it) do not block: they are shown as flagged areas for the account to look at before approving');
  for (const file of ['index.html', 'offer/index.html', 'start/index.html']) {
    const words = visible(read(file));
    assert.ok(words.includes(GATE), `${file}: ${GATE}`);
    assert.doesNotMatch(words, /Not good enough\? It retries once|the check retries once, then names/i, file);
  }
  assert.ok(read('llms.txt').includes(GATE), 'llms.txt');
  assert.doesNotMatch(read('llms.txt') + offerText, /must pass before the walkthrough appears/);
});

// ---- listing videos -------------------------------------------------------------------------------

test('"listing video" always carries its availability qualifier until video exports open', () => {
  const sentences = text => text.split(/(?<=[.!?])\s+/);
  for (const [file, text] of [...HTML.map(file => [file, visible(read(file))]), ['llms.txt', read('llms.txt')]]) {
    for (const sentence of sentences(text).filter(item => /listing videos?/i.test(item))) {
      assert.match(sentence, /(?:once|when) video exports open/, `${file}: ${sentence}`);
    }
  }
  assert.match(offer.plans[0].listingExports.status, /^not open yet: video exports are included in the plan once they open$/);
});

// ---- /app/terms and the app-page checker ----------------------------------------------------------

test('/app/terms names no Square, invoice, website purchase or studio; the checker bans them on every app page', async t => {
  const words = visible(read('app/terms/index.html')).replace(/\bVeylet Studio\b/g, '');
  for (const pattern of [/\bSquare\b/, /(?<!tax )\binvoic/i, /on this (?:web)?site/i, /\bstudio\b/i, /\bcard\b/i]) {
    assert.doesNotMatch(words, pattern, `/app/terms: ${(words.match(new RegExp('.{0,60}' + pattern.source + '.{0,40}', pattern.flags)) || [''])[0]}`);
  }
  assert.match(words, /In the app, the Veylet plan is bought and managed through the App Store\./);
  const { findBanned } = await checker;
  for (const [text, word] of [['a card saved in Square’s card field', 'Square'], ['or by studio invoice', 'invoice'], ['Invoiced plans', 'invoice'],
    ['with a card on this website', 'on this website'], ['the studio reviews it', 'studio']]) {
    assert.ok(findBanned(text, 'x').some(item => item.word === word), `${word}: ${text}`);
  }
  for (const text of ['Veylet Studio is operated by', 'Apple’s receipt is the tax invoice for them', '/media/studio-avatar.png', 'the square room']) {
    assert.deepEqual(findBanned(text, 'x'), [], text);
  }
});

// ---- the launch stage reaches every waitlist call to action ----------------------------------------

// Pages outside this lane that still carry an unmarked waitlist link: {file: count}. Each is a follow-up for
// its owner; the test fails if one gains a link or loses one without this list being lowered.
const UNMARKED_ELSEWHERE = {
  '404.html': 2, 'account/index.html': 2, 'auth/callback/index.html': 2, 'guides/3d-tour-cost-australia/index.html': 1,
  'guides/3d-tours-realestate-com-au-domain/index.html': 1, 'guides/do-3d-tours-help-sell-faster/index.html': 1,
  'guides/iphone-lidar-vs-matterport/index.html': 2, 'guides/privacy-3d-home-tour/index.html': 1,
  'guides/what-is-a-3d-walkthrough/index.html': 1, 'join/index.html': 1, 'studio/index.html': 1, 'thanks/index.html': 1,
  'unsubscribe/index.html': 1,
  // This lane may change /see's copy only, and tests/see-page.test.cjs pins its buttons' exact markup.
  'see/index.html': 4,
};

function unmarkedWaitlistLinks(html) {
  // A link inside the stage's account line is written by stage.js with the rest of that line.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(\w+)\b[^>]*\bdata-launch-account\b[^>]*>[\s\S]*?<\/\1\s*>/g, '');
  return [...clean.matchAll(/<a\b[^>]*\bhref="\/waitlist[^"]*"[^>]*>/g)].map(match => match[0]).filter(tag => !/\bdata-launch-cta\b/.test(tag));
}

test('every waitlist call to action carries a stage marker, and every page with one loads stage.js', () => {
  const found = {};
  for (const file of HTML) {
    const html = read(file);
    const unmarked = unmarkedWaitlistLinks(html);
    if (unmarked.length) found[file] = unmarked.length;
    if (/\bdata-launch-(?:cta|label|note)\b/.test(html)) {
      assert.match(html, /<script src="\/stage\.js(\?v=[a-f\d]{16})?" defer><\/script>/, `${file} marks stage text, so it loads stage.js`);
    }
  }
  for (const file of OWNED_PAGES.filter(page => page !== 'see/index.html')) assert.equal(found[file], undefined, `${file} has ${found[file]} unmarked waitlist link(s)`);
  assert.deepEqual(found, UNMARKED_ELSEWHERE);
  // The stage's own words for each marker exist in every stage.
  const window = { VEYLET_STAGE_MANUAL: true };
  vm.runInNewContext(read('stage.js'), { window, document: undefined, Object });
  for (const [name, words] of Object.entries(window.VeyletStage.STAGES)) assert.equal(typeof words.note, 'string', `${name} has a note`);
});

// ---- partner lane and the sitemap ------------------------------------------------------------------

test('no public page sends visitors to /apply or /request; both are kept out of search', () => {
  for (const file of OWNED_PAGES.filter(page => !['apply/index.html', 'request/index.html'].includes(page))) {
    const html = read(file);
    assert.doesNotMatch(html, /href="\/(?:apply|request)(?:[?#"])/, `${file} links /apply or /request`);
    assert.doesNotMatch(visible(html), /Capture partners|Apply as a (?:capture )?partner|handoff pages carry your branding/i, file);
  }
  for (const file of ['apply/index.html', 'request/index.html']) {
    assert.match(read(file), /<meta name="robots" content="noindex(?:,\s?nofollow)?" ?\/?>/, `${file} is noindex`);
  }
  assert.doesNotMatch(visible(read('request/index.html')), /Help me choose|We will check the device and space with you/);
  assert.doesNotMatch(read('llms.txt'), /veylet\.com\/(?:apply|request)\b/);
});

test('the sitemap lists only pages that exist, are indexable and are linked from another listed page', () => {
  const locs = [...read('sitemap.xml').matchAll(/<url><loc>https:\/\/veylet\.com(\/[^<]*)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod><\/url>/g)]
    .map(match => ({ route: match[1], lastmod: match[2] }));
  assert.equal(locs.length, (read('sitemap.xml').match(/<url>/g) || []).length, 'every entry has a loc and a lastmod');
  const fileOf = route => route === '/' ? 'index.html' : route.slice(1) + '/index.html';
  const links = new Map();
  for (const { route } of locs) {
    assert.ok(exists(fileOf(route)), `${route} exists`);
    const html = read(fileOf(route));
    assert.doesNotMatch(html, /<meta name="robots" content="noindex/, `${route} is indexable`);
    for (const match of html.matchAll(/\bhref="(\/[^"#?]*)/g)) {
      const target = match[1].replace(/\/$/, '') || '/';
      if (target !== route) links.set(target, (links.get(target) || 0) + 1);
    }
  }
  for (const { route, lastmod } of locs) {
    if (route !== '/') assert.ok(links.get(route), `${route} is linked from another listed page`);
    assert.ok(lastmod >= '2026-09-24' && lastmod <= '2026-12-31', `${route} lastmod ${lastmod}`);
  }
  for (const route of ['/apply', '/request']) assert.ok(!locs.some(loc => loc.route === route), `${route} is not in the sitemap`);
});

// ---- privacy notices ------------------------------------------------------------------------------

test('the privacy notices describe the automatic upload and name the processors', () => {
  for (const file of ['privacy/index.html', 'app/privacy/index.html']) {
    const html = read(file);
    const words = visible(html);
    assert.doesNotMatch(words, /does not automatically upload|held separately by the studio|When you send a reconstructed tour/i, file);
    assert.match(words, /When you tap Send to Veylet, the app uploads the capture/, file);
    for (const processor of ['Supabase', 'Modal', 'Cloudflare', 'Vercel', 'Resend', 'Apple']) assert.match(words, new RegExp(`\\b${processor}\\b`), `${file} names ${processor}`);
    assert.match(html, /<!-- LEGAL REVIEW 2026-09-27: automatic upload and processors -->/, `${file} marks the draft for the legal pass`);
  }
});

// ---- prices, clocks and summaries ------------------------------------------------------------------

test('the Super fast refund clock runs from the later of the upload finishing and the purchase', () => {
  const LATER = /within 30 minutes of the upload finishing or (?:your|the) purchase, whichever is later/;
  assert.match(offer.expressRender.refund, LATER);
  for (const [file, text] of [['offer/index.html', readable(read('offer/index.html'))], ['terms/index.html', visible(read('terms/index.html'))], ['llms.txt', read('llms.txt')]]) {
    const mentions = text.match(/within 30 minutes of the upload finishing[^.;]*/g) || [];
    assert.ok(mentions.length > 0, `${file} states the refund clock`);
    for (const mention of mentions) assert.match(mention, LATER, `${file}: ${mention}`);
  }
});

test('llms.txt states the early paid switch and the pack channels as offer.json does', () => {
  const llms = read('llms.txt');
  assert.deepEqual(offer.freeMonths.earlyPaidSwitchAvailable, { websiteCard: true, studioInvoice: true, appStore: false });
  assert.doesNotMatch(llms, /no automatic debt or early paid trial switch|in a later app version|later app version/i);
  assert.match(llms, /When the free months' 12 render attempts are used, the owner of a website card or invoice trial can start the plan early; an App Store free trial cannot be started early\./);
  assert.match(offer.packRules.channels.app, /^never sold in the app$/);
  assert.match(llms, /Packs are sold on the website and by studio invoice only, never in the app\./);
  for (const file of ['offer/index.html', 'terms/index.html']) assert.doesNotMatch(visible(read(file)), /later (?:app )?version/i, file);
});

// /see's hero line is pinned word for word by tests/see-page.test.cjs (a follow-up for its owner).
test('the free-month headlines say a payment method is needed', () => {
  for (const file of ['index.html']) {
    const words = visible(read(file));
    const headlines = words.match(/3 free months with 6 walkthroughs included[^.]*\./g) || [];
    assert.ok(headlines.length > 0, file);
    for (const line of headlines) assert.match(line, /\(payment method needed\)/, `${file}: ${line}`);
  }
});

test('marketing footers link Help, Support and Service status', () => {
  for (const file of ['index.html', 'offer/index.html', 'start/index.html', 'see/index.html', 'support/index.html', 'terms/index.html',
    'privacy/index.html', 'waitlist/index.html', 'website-guide/index.html', 'apply/index.html', 'request/index.html']) {
    const footer = read(file).match(/<footer\b[\s\S]*?<\/footer>/)[0];
    for (const href of ['/help', '/support', '/status']) assert.match(footer, new RegExp(`href="${href}"`), `${file} footer links ${href}`);
  }
});

test('/waitlist has a share card; /report and the support pages promise nothing without a rota', () => {
  const waitlist = read('waitlist/index.html');
  assert.match(waitlist, /<meta property="og:image" content="https:\/\/veylet\.com\/media\/share\/[\w-]+\.jpg\?v=[a-f\d]{16}"/);
  assert.match(waitlist, /<meta property="og:image:type" content="image\/jpeg"/);
  assert.match(waitlist, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(waitlist, /<meta property="og:title" content="[^"]+"/);
  assert.doesNotMatch(visible(read('report/index.html')), /taken down while we check/);
  for (const file of ['support/index.html', 'app/support/index.html']) {
    assert.doesNotMatch(visible(read(file)), /says what is kept and for how long|working days|One studio/i, file);
  }
});

test('the website guide sends portals the listing URL, not the client link', () => {
  const portal = read('website-guide/index.html').match(/<summary>Will it work on a property portal\?<\/summary><p>([\s\S]*?)<\/p>/)[1];
  assert.match(portal, /Copy listing URL \(portals, CRM\)/);
  assert.doesNotMatch(portal, /client handoff link can go in it/);
});

test('an unsubscribe link asks before it acts: nothing is sent until Confirm unsubscribe is pressed', async () => {
  const script = read('unsubscribe.js');
  const TOKEN = 'b2'.repeat(32);
  const elements = {};
  const el = (id, hidden = false) => (elements[id] = { hidden, disabled: false, textContent: '', attributes: {}, listeners: [],
    setAttribute(key, value) { this.attributes[key] = String(value); }, focus() {},
    addEventListener(name, fn, options) { this.listeners.push({ name, fn, once: Boolean(options && options.once) }); } });
  ['main', 'unsubscribe-title', 'unsubscribe-message', 'unsubscribe-scope'].forEach(id => el(id, id === 'unsubscribe-scope'));
  el('unsubscribe-retry', true);
  const requests = [], replaced = [];
  const window = {
    VEYLET_SUPABASE: { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' },
    location: { search: '?t=' + TOKEN, pathname: '/unsubscribe' },
    history: { replaceState: (_, __, url) => replaced.push(url) },
    document: { readyState: 'complete', getElementById: id => elements[id], addEventListener() {} },
    fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, status: 200, json: async () => ({ state: 'unsubscribed', unsubscribed: true }) }; },
  };
  vm.runInNewContext(script, { window, document: window.document, JSON, Promise });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [], 'loading the page (as a link scanner does) sends nothing');
  assert.deepEqual(replaced, ['/unsubscribe'], 'the token still leaves the address bar at once');
  const button = elements['unsubscribe-retry'];
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Confirm unsubscribe');
  assert.equal(elements.main.attributes['data-state'], 'confirm');
  const press = button.listeners.find(item => item.name === 'click');
  assert.ok(press && press.once, 'the confirm press is a one-time listener');
  await press.fn();
  assert.equal(requests.length, 2, 'one press asks both functions once');
  for (const { init } of requests) assert.deepEqual(JSON.parse(init.body), { p_token: TOKEN });
  assert.equal(elements.main.attributes['data-state'], 'tips');
  assert.equal(button.textContent, 'Try again');
});

test('the site README says a push to main deploys to production', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /A Git commit or push does not establish that those bytes are live\./);
  assert.match(readme, /A push to `main` deploys to production: Vercel builds `main` automatically\./);
});
