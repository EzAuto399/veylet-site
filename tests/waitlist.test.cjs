/*
 * /waitlist (dist/waitlist/index.html + waitlist.js): the form the launch plan's stage 2 opens
 * (§3 onboarding items 1-2): device, segment and "Where will you show walkthroughs?", an unticked
 * and separate "tips and offers" consent (Spam Act), a honeypot, one call to rpc/join_waitlist
 * (the product repository's supabase/drafts/release-2/20260926102000_waitlist.sql), and the
 * support address when the database did not take the sign-up. Since 30 September 2026 the database is
 * the only destination: it stores the sign-up and emails the studio (release 3); the page sends nothing
 * to FormSubmit and promises no confirmation email.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { elementsById, FakeFormData, recordingFetch } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const markup = fs.readFileSync(path.join(dist, 'waitlist/index.html'), 'utf8');
const script = fs.readFileSync(path.join(dist, 'waitlist/waitlist.js'), 'utf8');
const CONFIG = { url: 'https://project.supabase.invalid', anonKey: 'public-anon-key' };
const ANSWERS = {
  name: '  Sam   Agent ', email: ' Sam@Agency.com.au ', business_type: 'sales_agent', device: 'iphone_pro_lidar',
  region: 'Brisbane', channels: ['own_website', 'domain', 'domain', 'not-a-channel'],
};

function load() {
  const window = { VEYLET_WAITLIST_MANUAL: true };
  vm.runInNewContext(script, { window, document: undefined, JSON, Promise, Object, String, encodeURIComponent });
  return window.VeyletWaitlist;
}

function page(answers = [], config = CONFIG) {
  const ids = elementsById(markup);
  const { fetch, requests } = recordingFetch(answers);
  const doc = { getElementById: id => ids[id] || null, createElement: tag => new (ids['waitlist-form'].constructor)(tag) };
  const window = { VEYLET_SUPABASE: config, document: doc, fetch, FormData: class { constructor(form) { return form.data; } } };
  return { ids, doc, window, requests };
}

const fieldTags = () => [...markup.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].map(m => ({ tag: m[1], attrs: m[2],
  name: (/\bname="([^"]+)"/.exec(m[2]) || [])[1] }));

test('the form asks the plan\'s questions, and only the waitlist answers are required', () => {
  const fields = fieldTags();
  const required = fields.filter(f => /\brequired\b/.test(f.attrs)).map(f => f.name);
  assert.deepEqual(required, ['name', 'email', 'business_type', 'device', 'region']);
  const api = load();
  const options = name => [...markup.split(`name="${name}"`)[1].split('</select>')[0].matchAll(/<option value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
  assert.deepEqual(options('business_type'), [...api.BUSINESS]);
  assert.deepEqual(options('device'), [...api.DEVICES]);
  assert.deepEqual(fields.filter(f => f.name === 'channels').map(f => (/value="([^"]+)"/.exec(f.attrs) || [])[1]), [...api.CHANNELS]);
  assert.match(markup, /Buyer’s agent/);
  assert.match(markup, /Photographer or freelancer/);
  assert.match(markup, /<option value="iphone_pro_lidar">iPhone 12 Pro or newer \(Pro or Pro Max\)</);
  assert.match(markup, /<option value="ipad_pro_lidar">iPad Pro, 2020 or newer</);
  assert.match(markup, /<option value="iphone_other">Another iPhone \(standard, Plus or older\)</);
  // Plain words on the page: no sensor jargon (owner, 29 Sep).
  assert.doesNotMatch(markup, /LiDAR/);
  assert.match(markup, /Where will you show walkthroughs\?/);
  // The device line explains the question and is read with it.
  assert.match(markup, /aria-describedby="waitlist-lidar"/);
  assert.match(markup, /id="waitlist-lidar"[^>]*>Capture works on iPhone 12 Pro and newer Pro or Pro Max models, and iPad Pro 2020 and newer\. Standard and Plus iPhones, older models and Android phones can’t capture yet\. Any phone can view a walkthrough\.</);
});

test('the tips box is unticked, optional and separate from joining, labelled with wording tips-v1; there is a honeypot and a privacy line', () => {
  const consent = fieldTags().find(f => f.name === 'consent_tips');
  assert.ok(consent, 'the consent box exists');
  assert.doesNotMatch(consent.attrs, /\bchecked\b|\brequired\b/);
  // The box's accessible name is exactly the consent wording whose version is sent.
  const api = load();
  assert.deepEqual(JSON.parse(JSON.stringify(api.TIPS)), { version: 'tips-v1', wording: 'Email me tips and offers from Veylet Studio. I can unsubscribe at any time.' });
  assert.match(consent.attrs, /aria-labelledby="waitlist-tips-label"/);
  assert.equal(/<span id="waitlist-tips-label">([^<]*)<\/span>/.exec(markup)[1], api.TIPS.wording);
  assert.doesNotMatch(markup, /Send me tips and offers by email/);
  assert.match(markup, /Separate from the waitlist: you can join without it\. We still email you when it’s your turn\./);
  assert.match(markup, /class="honey-label" aria-hidden="true">Leave this field empty<input type="text" name="_honey" class="honey" tabindex="-1"/);
  assert.match(markup, /<a href="\/privacy">How we handle personal information<\/a>/);
});

test('no third-party script, font or form service: every script and stylesheet is first party', () => {
  const sources = [...markup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"|<link\b[^>]*\brel="(?:stylesheet|icon)"[^>]*\bhref="([^"]+)"/g)]
    .map(m => m[1] || m[2]);
  assert.ok(sources.length >= 4);
  for (const src of sources) assert.match(src, /^\/(?!\/)/, src);
  assert.doesNotMatch(markup, /googleapis|gtag|recaptcha|hcaptcha/i);
  assert.doesNotMatch(markup, /action="https?:|<iframe/i);
  // The script's only address is the share link on the success state, which is shared or copied, never
  // fetched; the database address comes from /supabase-public.js.
  assert.deepEqual([...new Set(script.match(/https?:\/\/[^'"\s)]+/g) || [])],
    ['https://veylet.com/waitlist?utm_source=referral&utm_medium=share&utm_campaign=waitlist-thanks']);
});

// 30 Sep 2026: the hosted database stores the sign-up and emails the studio (release 3); FormSubmit's
// AJAX endpoint answers 500. The page says where the answers go and promises no confirmation email.
test('the page says the answers are stored in Veylet’s database and we are emailed; no FormSubmit, no confirmation', () => {
  const assurance = /<p class="contact-note form-assurance">([\s\S]*?)<\/p>/.exec(markup)[1];
  assert.equal(assurance, 'We use your answers to run the waitlist and to email you when it is your turn. They are stored in Veylet’s database, and we are notified by email. To leave the list, email <a href="mailto:support@veylet.com?subject=Leave%20the%20Veylet%20waitlist">support@veylet.com</a>. <a href="/privacy">How we handle personal information</a>.');
  assert.doesNotMatch(markup, /formsubmit|confirmation/i);
  assert.doesNotMatch(script, /formsubmit|yodalai|_replyto|_autoresponse/i, 'the script has no FormSubmit route at all');
});

test('answers are trimmed and allowlisted; consent is true only when ticked', () => {
  const api = load();
  const answers = api.answersFrom(new FakeFormData(ANSWERS));
  assert.deepEqual(JSON.parse(JSON.stringify(answers)), {
    p_name: 'Sam Agent', p_email: 'Sam@Agency.com.au', p_business_type: 'sales_agent', p_device: 'iphone_pro_lidar',
    p_region: 'Brisbane', p_channels: ['own_website', 'domain'], p_consent_tips: false, p_consent_wording: 'tips-v1',
    p_volume: null, p_utm_source: null, p_utm_medium: null, p_utm_campaign: null, p_utm_content: null, p_click: null, p_landing: null,
  });
  assert.equal(api.answersFrom(new FakeFormData({ ...ANSWERS, consent_tips: 'yes' })).p_consent_tips, true);
  assert.equal(api.answersFrom(new FakeFormData({ ...ANSWERS, consent_tips: 'yes' })).p_consent_wording, 'tips-v1', 'the wording shown travels with a tick');
  assert.equal(api.problem(answers), '');
  assert.equal(api.problem({ ...answers, p_email: 'not-an-email' }), 'email');
  assert.equal(api.problem({ ...answers, p_device: 'nokia' }), 'device');
  assert.equal(api.problem({ ...answers, p_business_type: '' }), 'business_type');
});

test('joining is one POST to rpc/join_waitlist with the public key and the answers only', async () => {
  const api = load();
  const { fetch, requests } = recordingFetch([{ status: 200, body: { state: 'joined' } }]);
  const answers = api.answersFrom(new FakeFormData(ANSWERS));
  assert.equal(await api.join(fetch, CONFIG, answers), 'joined');
  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(url, 'https://project.supabase.invalid/rest/v1/rpc/join_waitlist');
  assert.equal(init.method, 'POST');
  assert.deepEqual([init.headers.apikey, init.headers.Authorization, init.credentials], ['public-anon-key', 'Bearer public-anon-key', 'omit']);
  assert.deepEqual(Object.keys(body).sort(), ['p_business_type', 'p_channels', 'p_click', 'p_consent_tips', 'p_consent_wording', 'p_device',
    'p_email', 'p_landing', 'p_name', 'p_region', 'p_utm_campaign', 'p_utm_content', 'p_utm_medium', 'p_utm_source', 'p_volume']);
});

test('a backend without the function, the hourly limit, a refusal and a failure each have their own answer', async () => {
  const api = load();
  // "No such function" is asked again with the eight released parameters; only a second "no" is missing.
  const MISSING = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.join_waitlist' } };
  const cases = [
    [[MISSING, MISSING], 'missing'],
    [[{ status: 400, body: { code: 'PGRST202' } }, { status: 400, body: { code: 'PGRST202' } }], 'missing'],
    [{ status: 200, body: { state: 'busy' } }, 'busy'],
    [{ status: 200, body: { state: 'invalid', field: 'email' } }, 'invalid'],
    [{ status: 500, body: { message: 'boom' } }, 'error'],
    [{ status: 200, body: { state: 'something-new' } }, 'error'],
    [new TypeError('Failed to fetch'), 'error'],
  ];
  for (const [answer, expected] of cases) {
    const { fetch } = recordingFetch(Array.isArray(answer) ? answer : [answer]);
    assert.equal(await api.join(fetch, CONFIG, {}), expected, JSON.stringify(answer));
  }
});

test('success hides the form and moves focus to "You’re on the list."; a missing waitlist gives the email route', async () => {
  const api = load();
  const joined = page([{ status: 200, body: { state: 'joined' } }]);
  joined.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(joined.window, joined.ids['waitlist-form']), 'joined');
  assert.equal(joined.ids['waitlist-form'].hidden, true);
  assert.equal(joined.ids['waitlist-done'].hidden, false);
  assert.match(markup, /<h2 id="waitlist-done-title" tabindex="-1">You’re on the list\.<\/h2>/);
  assert.equal(joined.ids['waitlist-done-title'].focused, 1);

  const missing = page([{ status: 404, body: { code: 'PGRST202' } }, { status: 404, body: { code: 'PGRST202' } }]);
  missing.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(missing.window, missing.ids['waitlist-form']), 'missing');
  const fallback = missing.ids['waitlist-fallback'];
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.textContent, `We couldn’t add you just now, so nothing was saved. Try again in a minute, or email ${api.SUPPORT} to be added.`);
  assert.equal(fallback.links()[0].getAttribute('href'), `mailto:${api.SUPPORT}?subject=Veylet%20waitlist`);
  assert.equal(missing.ids['waitlist-form'].hidden, false, 'nothing typed is lost');
});

test('a filled honeypot sees the same success and nothing is sent', async () => {
  const api = load();
  const bot = page([]);
  bot.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, _honey: 'https://spam.example' });
  assert.equal(await api.send(bot.window, bot.ids['waitlist-form']), 'joined');
  assert.equal(bot.requests.length, 0);
});

test('the fallback address is the one the support page gives', () => {
  const support = fs.readFileSync(path.join(dist, 'app/support/index.html'), 'utf8');
  const address = /mailto:([^?"]+)\?subject=Veylet%20support/.exec(support)[1];
  assert.equal(load().SUPPORT, address);
  assert.match(markup, new RegExp(`mailto:${address.replace('.', '\\.')}`));
});


test('a sign-up the database did not take says nothing was saved, gives the support address, and sends nothing else', async () => {
  const api = load();
  const NOT_SAVED = 'We couldn’t add you just now, so nothing was saved. Try again in a minute, or email support@veylet.com to be added.';
  const MISSING = { status: 404, body: { code: 'PGRST202' } };
  const cases = [
    ['no function either way', [MISSING, MISSING], 'missing', 2, NOT_SAVED],
    ['a server error', [{ status: 500, body: { message: 'boom' } }], 'error', 1, NOT_SAVED],
    ['no network', [new TypeError('Failed to fetch')], 'error', 1, NOT_SAVED],
    ['an error on the eight-answer retry', [MISSING, { status: 503, body: null }], 'error', 2, NOT_SAVED],
    ['the hourly limit', [{ status: 200, body: { state: 'busy' } }], 'busy', 1,
      'The waitlist is busy right now, so nothing was saved. Try again in an hour, or email support@veylet.com to be added.'],
  ];
  for (const [label, answers, state, calls, words] of cases) {
    const p = page(answers);
    p.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
    assert.equal(await api.send(p.window, p.ids['waitlist-form']), state, label);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.requests.length, calls, `${label}: only join_waitlist is called`);
    for (const request of p.requests) {
      assert.equal(request.url, 'https://project.supabase.invalid/rest/v1/rpc/join_waitlist', label);
      assert.equal(request.init.referrerPolicy, 'no-referrer', label);
    }
    const fallback = p.ids['waitlist-fallback'];
    assert.equal(fallback.hidden, false, label);
    assert.equal(fallback.textContent, words, label);
    assert.equal(fallback.links()[0].getAttribute('href'), 'mailto:support@veylet.com?subject=Veylet%20waitlist', label);
    assert.equal(p.ids['waitlist-form'].hidden, false, `${label}: nothing typed is lost`);
    assert.equal(p.ids['waitlist-done'].hidden, true, `${label}: no success is shown`);
  }
  // A page without its database configuration sends nothing and says the same.
  const noConfig = page([{ status: 200, body: { success: 'true' } }], null);
  noConfig.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(noConfig.window, noConfig.ids['waitlist-form']), 'missing');
  assert.equal(noConfig.requests.length, 0);
  assert.equal(noConfig.ids['waitlist-fallback'].textContent, NOT_SAVED);
  assert.equal(noConfig.ids['waitlist-done'].hidden, true);
});

// 29 Sep 2026 (owner): lead quality and attribution. An optional volume answer matching the Meta lead form,
// the campaign labels of the link that brought the visit (never the click identifiers), and a success
// state that says what happens next.
function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}
const TOUCH = { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'waitlist-sep', utm_content: 'reel_a', click: 'meta', landing: '/see' };

test('an optional volume question follows the device question, with the Meta lead form\'s answers', () => {
  const api = load();
  assert.deepEqual([...api.VOLUMES], ['none', '1_2', '3_5', '6_plus', 'not_sure']);
  const select = /How many listings or spaces do you expect to capture in the next 3 months\? \(optional\)\s*<select name="volume">([\s\S]*?)<\/select>/.exec(markup);
  assert.ok(select, 'the volume question and its label');
  assert.deepEqual([...select[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m => [m[1], m[2]]),
    [['', 'Choose one'], ['none', 'None yet'], ['1_2', '1–2'], ['3_5', '3–5'], ['6_plus', '6 or more'], ['not_sure', 'Not sure yet']]);
  const order = ['name="device"', 'name="volume"', 'name="region"'].map(needle => markup.indexOf(needle));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'device, then volume, then region');
  assert.doesNotMatch(fieldTags().find(f => f.name === 'volume').attrs, /\brequired\b/);
});

test('answers carry the volume and the visit\'s campaign labels; empty ones are null and bad shapes never leave', () => {
  const api = load();
  const answers = api.answersFrom(new FakeFormData({ ...ANSWERS, volume: '3_5' }), TOUCH);
  assert.deepEqual([answers.p_volume, answers.p_utm_source, answers.p_utm_medium, answers.p_utm_campaign, answers.p_utm_content,
    answers.p_click, answers.p_landing], ['3_5', 'instagram', 'paid', 'waitlist-sep', 'reel_a', 'meta', '/see']);
  assert.equal(api.problem(answers), '');
  const bare = api.answersFrom(new FakeFormData(ANSWERS), { utm_source: '<script>', utm_medium: 'a b', click: 'tiktok', landing: 'https://evil.example/' });
  assert.deepEqual([bare.p_volume, bare.p_utm_source, bare.p_utm_medium, bare.p_utm_campaign, bare.p_utm_content, bare.p_click, bare.p_landing],
    [null, null, null, null, null, null, null]);
  assert.equal(api.problem(api.answersFrom(new FakeFormData({ ...ANSWERS, volume: '11_plus' }))), 'volume');
  assert.equal(api.problem({ ...answers, p_volume: null }), '', 'volume is optional');
});

test('attribution is the stored first touch, else this page\'s own link, else nothing; click ids are never read', () => {
  const api = load();
  const withStore = { sessionStorage: storage({ [api.TOUCH_KEY]: JSON.stringify(TOUCH) }), location: { search: '?utm_source=google' }, URLSearchParams };
  assert.deepEqual(JSON.parse(JSON.stringify(api.attribution(withStore))), TOUCH);
  // Tampered storage is re-checked here too.
  const tampered = { sessionStorage: storage({ [api.TOUCH_KEY]: JSON.stringify({ utm_source: 'x'.repeat(101), click: 'meta', landing: '/see?x=<b>' }) }) };
  assert.deepEqual(JSON.parse(JSON.stringify(api.attribution(tampered))),
    { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', click: 'meta', landing: '' });
  const otherHost = { sessionStorage: storage({ [api.TOUCH_KEY]: JSON.stringify({ ...TOUCH, landing: '//other.example/x' }) }) };
  assert.equal(api.attribution(otherHost).landing, '', 'a second leading slash is refused');
  const own = { sessionStorage: storage(), location: { search: '?utm_source=facebook&utm_campaign=lead+form&fbclid=IwAR0secret' }, URLSearchParams };
  const touch = api.attribution(own);
  assert.deepEqual(JSON.parse(JSON.stringify(touch)),
    { utm_source: 'facebook', utm_medium: '', utm_campaign: '', utm_content: '', click: 'meta', landing: '/waitlist' });
  assert.doesNotMatch(JSON.stringify(api.answersFrom(new FakeFormData(ANSWERS), touch)), /IwAR0secret/);
  const blocked = { get sessionStorage() { throw new Error('SecurityError'); }, location: { search: '?gclid=abc' }, URLSearchParams };
  assert.equal(api.attribution(blocked).click, 'google');
  assert.equal(api.attribution(blocked).landing, '/waitlist');
  assert.deepEqual(JSON.parse(JSON.stringify(api.attribution({ location: { search: '?ref=x' }, URLSearchParams }))),
    { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', click: '', landing: '' });
});

test('both privacy notices say waitlist sign-ups are stored with Supabase and emailed to us through Resend; /request still goes via FormSubmit', () => {
  for (const file of ['privacy/index.html', 'app/privacy/index.html']) {
    const privacy = fs.readFileSync(path.join(dist, file), 'utf8');
    const enquiries = /<strong>Enquiries\.<\/strong>([\s\S]*?)<\/p>/.exec(privacy)[1].replace(/\s+/g, ' ');
    assert.ok(enquiries.includes('<!-- LEGAL REVIEW 2026-09-30: waitlist storage and notification -->Request forms go to yoda@yodalai.xyz via FormSubmit. Waitlist sign-ups are stored in our database with Supabase in Sydney (ap-southeast-2), and Resend, an email service that may process information outside Australia, emails us a copy of your answers.'), file);
    assert.doesNotMatch(privacy, /waitlist sign-ups while|waitlist database is not yet live/i, file);
    assert.match(privacy, /Last updated 30 September 2026\./, file);
  }
});

test('the success state lists what happens next, offers /see and sharing, and names the capture devices only when needed', async () => {
  assert.match(markup, /<ol class="next-steps waitlist-next"[^>]*>\s*<li>We review new sign-ups each week\.<\/li>\s*<li>When your group opens, we email your invitation to the Veylet Capture app\.<\/li>\s*<li>Your first month is free, with 3 walkthroughs included\.<\/li>\s*<\/ol>/);
  assert.match(markup, />What happens next</);
  assert.match(markup, /<a class="button" href="\/see">See a result /);
  assert.match(markup, /<button class="button button-ghost" type="button" id="waitlist-share">Share with a colleague<\/button>/);
  assert.match(markup, /\.waitlist-page \.button \{ min-height: 44px; \}/, 'the share button keeps a 44px target');
  assert.match(markup, /id="waitlist-share-status" role="status" aria-live="polite"/);
  assert.match(markup, /id="waitlist-done-device" hidden>Capture works on iPhone 12 Pro and newer Pro or Pro Max models, and iPad Pro 2020 and newer\. Any phone can view a walkthrough\.</);
  const api = load();
  for (const [device, hidden] of [['android', false], ['iphone_other', false], ['not_sure', false], ['iphone_pro_lidar', true], ['ipad_pro_lidar', true]]) {
    const joined = page([{ status: 200, body: { state: 'joined' } }]);
    joined.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, device });
    assert.equal(await api.send(joined.window, joined.ids['waitlist-form']), 'joined');
    assert.equal(joined.ids['waitlist-done-device'].hidden, hidden, device);
  }
  const bot = page([]);
  bot.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, device: 'android', _honey: 'x' });
  await api.send(bot.window, bot.ids['waitlist-form']);
  assert.equal(bot.ids['waitlist-done-device'].hidden, true);
});

test('sharing uses the share sheet, else copies the link, else shows it; a dismissed sheet does nothing', async () => {
  const api = load();
  const URL_ = 'https://veylet.com/waitlist?utm_source=referral&utm_medium=share&utm_campaign=waitlist-thanks';
  assert.equal(api.SHARE_URL, URL_);
  const run = async navigator => { const p = page([]); p.window.navigator = navigator; return [await api.share(p.window), p.ids['waitlist-share-status'].textContent]; };
  const calls = [];
  const clipboard = { writeText: async url => { calls.push(['copy', url]); } };
  assert.deepEqual(await run({ share: async data => { calls.push(['share', data.url]); }, clipboard }), ['shared', '']);
  assert.deepEqual(calls, [['share', URL_]]);
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  assert.deepEqual(await run({ share: async () => { throw abort; }, clipboard }), ['cancelled', '']);
  assert.equal(calls.length, 1, 'no copy after a dismissed share sheet');
  assert.deepEqual(await run({ clipboard }), ['copied', 'Link copied.']);
  assert.deepEqual(calls[1], ['copy', URL_]);
  assert.deepEqual(await run({ share: async () => { throw new Error('NotAllowedError'); }, clipboard: { writeText: async () => { throw new Error('denied'); } } }), ['shown', URL_]);
  assert.deepEqual(await run({}), ['shown', URL_]);
  assert.deepEqual(await run(undefined), ['shown', URL_]);
});

test('both privacy notices say campaign labels, ad source and landing page travel with a sign-up, and click identifiers are not kept', () => {
  for (const file of ['privacy/index.html', 'app/privacy/index.html']) {
    const privacy = fs.readFileSync(path.join(dist, file), 'utf8');
    const enquiries = /<strong>Enquiries\.<\/strong>([\s\S]*?)<\/p>/.exec(privacy)[1];
    assert.ok(enquiries.includes('<!-- LEGAL REVIEW 2026-09-29: campaign labels on waitlist sign-ups -->When you arrive from a campaign link, this browser keeps that link’s campaign labels (such as utm_source=instagram), whether it came from a Meta or Google ad, and the Veylet page you arrived on, for the visit; a waitlist sign-up includes them so we know which link brought you. The click identifiers Meta and Google add to links are not kept.'), file);
  }
});

test('a landing path alone is not a touch: the page\'s own link counts only when a label or click survives', () => {
  const api = load();
  const empty = { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', click: '', landing: '' };
  const bad = { sessionStorage: storage(), location: { search: '?utm_source=Instagram%20Post' }, URLSearchParams };
  assert.deepEqual(JSON.parse(JSON.stringify(api.attribution(bad))), empty);
  // A stored touch with nothing left but its landing gives way to this page's own clean link.
  const staleStore = storage({ [api.TOUCH_KEY]: JSON.stringify({ utm_source: 'bad value', landing: '/see' }) });
  const own = { sessionStorage: staleStore, location: { search: '?utm_source=instagram' }, URLSearchParams };
  assert.deepEqual(JSON.parse(JSON.stringify(api.attribution(own))), { ...empty, utm_source: 'instagram', landing: '/waitlist' });
});

test('the share live region stays rendered and a repeated message is cleared, then written in a later task', async () => {
  assert.doesNotMatch(markup, /waitlist-share-status:empty|waitlist-share-status[^{]*\{[^}]*display:\s*none/);
  assert.match(markup, /\.waitlist-done \.waitlist-share-status \{[^}]*min-height: 24px/);
  const api = load();
  const p = page([]);
  const timers = [];
  p.window.setTimeout = (fn, ms) => { timers.push(ms); fn(); };
  const note = p.ids['waitlist-share-status'];
  const seen = [];
  Object.defineProperty(note, 'textContent', { get() { return this._text; }, set(value) { seen.push(String(value)); this._text = String(value); } });
  p.window.navigator = { clipboard: { writeText: async () => {} } };
  assert.equal(await api.share(p.window), 'copied');
  assert.equal(await api.share(p.window), 'copied');
  assert.deepEqual(seen.filter(Boolean), ['Link copied.', 'Link copied.']);
  assert.equal(seen[seen.length - 2], '', 'cleared before the repeat');
  assert.deepEqual(timers, [50, 50]);
});


// 30 Sep 2026: Release 2's join_waitlist takes 8 parameters. The page sends all 15 first (a later migration
// adds the rest) and asks once more with the 8 when the function does not take them. The database is the
// only destination: no copy goes anywhere else.
const RPC = 'https://project.supabase.invalid/rest/v1/rpc/join_waitlist';
const NO_FUNCTION = { status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.join_waitlist(p_business_type, p_channels, p_click, ...)' } };
const withTouch = extra => {
  const p = page(extra);
  p.window.sessionStorage = storage({ 'veylet.firstTouch': JSON.stringify(TOUCH) });
  p.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, volume: '3_5' });
  return p;
};
const settled = () => new Promise(resolve => setImmediate(resolve));

test('a database that takes every answer: one call carrying the volume and the visit\'s attribution, and nothing else', async () => {
  const api = load();
  const tracked = [];
  const p = withTouch([{ status: 200, body: { state: 'joined' } }, { status: 200, body: { success: 'true' } }]);
  p.window.VeyletAnalytics = { track: (name, props) => tracked.push([name, props.error_code || null]) };
  assert.equal(await api.send(p.window, p.ids['waitlist-form']), 'joined');
  await settled(); await settled();
  assert.deepEqual(p.requests.map(request => request.url), [RPC], 'no copy is sent anywhere after the database took it');
  const body = p.requests[0].body;
  assert.equal(Object.keys(body).length, 15);
  assert.deepEqual([body.p_volume, body.p_utm_source, body.p_utm_medium, body.p_utm_campaign, body.p_utm_content, body.p_click, body.p_landing],
    ['3_5', 'instagram', 'paid', 'waitlist-sep', 'reel_a', 'meta', '/see']);
  assert.equal(p.requests[0].init.referrerPolicy, 'no-referrer');
  assert.equal(p.requests[0].init.credentials, 'omit');
  assert.equal(p.ids['waitlist-form'].hidden, true);
  assert.equal(p.ids['waitlist-fallback'].hidden, true);
  assert.deepEqual(tracked, [['waitlist_submission_accepted', null]], 'measured once, as the database answered');
});

test('Release 2’s function: all answers, then exactly the eight it takes, and nothing else', async () => {
  const api = load();
  const p = withTouch([NO_FUNCTION, { status: 200, body: { state: 'joined' } }, { status: 200, body: { success: 'true' } }]);
  assert.equal(await api.send(p.window, p.ids['waitlist-form']), 'joined');
  await settled(); await settled();
  assert.deepEqual(p.requests.map(request => request.url), [RPC, RPC]);
  assert.equal(Object.keys(p.requests[0].body).length, 15, 'the first call carries every answer');
  assert.equal(p.requests[0].body.p_utm_campaign, 'waitlist-sep');
  assert.deepEqual(Object.keys(p.requests[1].body).sort(), ['p_business_type', 'p_channels', 'p_consent_tips', 'p_consent_wording', 'p_device', 'p_email', 'p_name', 'p_region']);
  assert.deepEqual(p.requests[1].body, Object.fromEntries(api.BASE_PARAMS.map(name => [name, p.requests[0].body[name]])));
  assert.deepEqual(p.requests.map(request => request.init.referrerPolicy), ['no-referrer', 'no-referrer']);
  assert.equal(p.ids['waitlist-done'].hidden, false);
});

test('busy and invalid send one call and nothing else', async () => {
  const api = load();
  for (const state of ['busy', 'invalid']) {
    const q = withTouch([{ status: 200, body: { state } }, { status: 200, body: { success: 'true' } }]);
    assert.equal(await api.send(q.window, q.ids['waitlist-form']), state);
    await settled();
    assert.deepEqual(q.requests.map(request => request.url), [RPC], state);
  }
});
