/*
 * /waitlist (dist/waitlist/index.html + waitlist.js): the form the launch plan's stage 2 opens
 * (§3 onboarding items 1-2): device, segment and "Where will you show walkthroughs?", an unticked
 * and separate "tips and offers" consent (Spam Act), a honeypot, one call to rpc/join_waitlist
 * (the product repository's supabase/drafts/release-2/20260926102000_waitlist.sql), and the email
 * route when the function does not exist yet.
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
  assert.match(markup, /iPhone 12 Pro or later/);
  assert.match(markup, /iPad Pro with LiDAR/);
  assert.match(markup, /Where will you show walkthroughs\?/);
  // The LiDAR line explains the device question and is read with it.
  assert.match(markup, /aria-describedby="waitlist-lidar"/);
  assert.match(markup, /id="waitlist-lidar"[^>]*>Capture needs the LiDAR scanner/);
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
  // 29 Sep 2026 (owner): until the release-2 waitlist is applied, a sign-up the database cannot take goes
  // to the owner's inbox through FormSubmit's JSON endpoint. No form action, script or frame points there,
  // the page says so, and it is the script's only external address.
  assert.doesNotMatch(markup, /action="https?:|<script[^>]+formsubmit|<iframe/i);
  assert.match(markup, /Until our waitlist database is live, they reach us by email through FormSubmit, which also emails you a confirmation\./);
  // The only other address is the share link on the success state, which is shared or copied, never fetched.
  assert.deepEqual([...new Set(script.match(/https?:\/\/[^'"\s)]+/g) || [])],
    ['https://formsubmit.co/ajax/', 'https://veylet.com/waitlist?utm_source=referral&utm_medium=share&utm_campaign=waitlist-thanks']);
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
  const cases = [
    [{ status: 404, body: { code: 'PGRST202', message: 'Could not find the function public.join_waitlist' } }, 'missing'],
    [{ status: 400, body: { code: 'PGRST202' } }, 'missing'],
    [{ status: 200, body: { state: 'busy' } }, 'busy'],
    [{ status: 200, body: { state: 'invalid', field: 'email' } }, 'invalid'],
    [{ status: 500, body: { message: 'boom' } }, 'error'],
    [{ status: 200, body: { state: 'something-new' } }, 'error'],
    [new TypeError('Failed to fetch'), 'error'],
  ];
  for (const [answer, expected] of cases) {
    const { fetch } = recordingFetch([answer]);
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

  const missing = page([{ status: 404, body: { code: 'PGRST202' } }]);
  missing.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(missing.window, missing.ids['waitlist-form']), 'missing');
  const fallback = missing.ids['waitlist-fallback'];
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.textContent, `The waitlist opens soon. Email ${api.SUPPORT} to be added.`);
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


test('while the database has no waitlist, a sign-up reaches the owner\'s inbox once; if that fails too, the email route', async () => {
  const api = load();
  assert.equal(api.INBOX_ENDPOINT, 'https://formsubmit.co/ajax/' + api.SUPPORT);
  // The database answers "no such function"; FormSubmit accepts: the visitor is on the list.
  const ok = page([{ status: 404, body: { code: 'PGRST202' } }, { status: 200, body: { success: 'true', message: 'The form was submitted successfully.' } }]);
  ok.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, consent_tips: 'yes' });
  assert.equal(await api.send(ok.window, ok.ids['waitlist-form']), 'joined');
  assert.equal(ok.requests.length, 2);
  const inbox = ok.requests[1];
  assert.equal(inbox.url, 'https://formsubmit.co/ajax/yoda@yodalai.xyz');
  assert.equal(inbox.init.credentials, 'omit');
  assert.deepEqual(inbox.body, { _subject: 'Veylet waitlist', _template: 'table', _captcha: 'false', name: 'Sam Agent',
    email: 'Sam@Agency.com.au', business: 'sales_agent', device: 'iphone_pro_lidar', region: 'Brisbane',
    channels: 'own_website, domain', tips_and_offers: 'yes', consent_wording: 'tips-v1', volume: '', utm_source: '',
    utm_medium: '', utm_campaign: '', utm_content: '', click: '', landing: '', _replyto: 'Sam@Agency.com.au',
    _autoresponse: api.AUTORESPONSE });
  assert.equal(ok.ids['waitlist-form'].hidden, true);
  // Both fail: nothing is claimed, the email route shows, and nothing typed is lost.
  const down = page([{ status: 404, body: { code: 'PGRST202' } }, { status: 500, body: { success: 'false' } }]);
  down.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(down.window, down.ids['waitlist-form']), 'missing');
  assert.equal(down.ids['waitlist-fallback'].hidden, false);
  assert.equal(down.ids['waitlist-form'].hidden, false);
  // A page without its database configuration goes straight to the inbox.
  const noConfig = page([{ status: 200, body: { success: 'true' } }], null);
  noConfig.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(noConfig.window, noConfig.ids['waitlist-form']), 'joined');
  assert.equal(noConfig.requests.length, 1);
  // A working database never touches the inbox.
  const live = page([{ status: 200, body: { state: 'joined' } }]);
  live.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(live.window, live.ids['waitlist-form']), 'joined');
  assert.equal(live.requests.length, 1);
});

// 29 Sep 2026 (owner): lead quality and attribution. An optional volume answer matching the Meta lead form,
// the campaign labels of the link that brought the visit (never the click identifiers), a FormSubmit
// auto-reply, and a success state that says what happens next.
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

test('the inbox route sends volume, labels, a reply-to and the auto-reply the owner approved', async () => {
  const api = load();
  // Transactional only: no offer, price or plan line.
  assert.equal(api.AUTORESPONSE, 'Thanks for joining the Veylet waitlist. We admit new accounts in weekly groups and will email you when your group opens. You\'re getting this because this address was entered at veylet.com/waitlist. If that wasn\'t you, or to leave the list, email yoda@yodalai.xyz. Veylet Studio (Yo-Da Lai)');
  assert.doesNotMatch(api.AUTORESPONSE, /free|month|walkthroughs included|\$/);
  const sent = page([{ status: 200, body: { success: 'true' } }], null);
  sent.window.sessionStorage = storage({ [api.TOUCH_KEY]: JSON.stringify(TOUCH) });
  sent.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, volume: '6_plus' });
  assert.equal(await api.send(sent.window, sent.ids['waitlist-form']), 'joined');
  const { body } = sent.requests[0];
  assert.deepEqual([body.volume, body.utm_source, body.utm_medium, body.utm_campaign, body.utm_content, body.click, body.landing],
    ['6_plus', 'instagram', 'paid', 'waitlist-sep', 'reel_a', 'meta', '/see']);
  assert.equal(body._replyto, 'Sam@Agency.com.au');
  assert.equal(body._autoresponse, api.AUTORESPONSE);
  // The database route gets the same labels as its own parameters.
  const rpc = page([{ status: 200, body: { state: 'joined' } }]);
  rpc.window.sessionStorage = storage({ [api.TOUCH_KEY]: JSON.stringify(TOUCH) });
  rpc.ids['waitlist-form'].data = new FakeFormData({ ...ANSWERS, volume: 'none' });
  await api.send(rpc.window, rpc.ids['waitlist-form']);
  assert.deepEqual([rpc.requests[0].body.p_volume, rpc.requests[0].body.p_utm_source, rpc.requests[0].body.p_landing], ['none', 'instagram', '/see']);
});

test('the success state lists what happens next, offers /see and sharing, and names the capture devices only when needed', async () => {
  assert.match(markup, /<ol class="next-steps waitlist-next"[^>]*>\s*<li>We review new sign-ups each week\.<\/li>\s*<li>When your group opens, we email your invitation to the Veylet Capture app\.<\/li>\s*<li>Your first month is free, with 3 walkthroughs included\.<\/li>\s*<\/ol>/);
  assert.match(markup, />What happens next</);
  assert.match(markup, /<a class="button" href="\/see">See a result /);
  assert.match(markup, /<button class="button button-ghost" type="button" id="waitlist-share">Share with a colleague<\/button>/);
  assert.match(markup, /\.waitlist-page \.button \{ min-height: 44px; \}/, 'the share button keeps a 44px target');
  assert.match(markup, /id="waitlist-share-status" role="status" aria-live="polite"/);
  assert.match(markup, /id="waitlist-done-device" hidden>Capturing needs an iPhone 12 Pro or later Pro model, or an iPad Pro with LiDAR\. Any phone can view a walkthrough\.</);
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

test('the auto-reply goes once per address and at most 3 times a session; the owner copy always goes', async () => {
  const api = load();
  const store = storage();
  const sendAs = async (email, win = { sessionStorage: store }) => {
    const { fetch, requests } = recordingFetch([{ status: 200, body: { success: 'true' } }]);
    const answers = api.answersFrom(new FakeFormData({ ...ANSWERS, email }));
    assert.equal(await api.joinByInbox(fetch, answers, win), 'joined');
    assert.equal(requests.length, 1, 'the owner copy is sent');
    assert.equal(requests[0].body.email, email);
    return '_autoresponse' in requests[0].body;
  };
  assert.equal(await sendAs('a@agency.com.au'), true);
  assert.equal(await sendAs('A@Agency.com.au'), false, 'the same address in other case');
  assert.equal(await sendAs('b@agency.com.au'), true);
  assert.equal(await sendAs('c@agency.com.au'), true);
  assert.equal(await sendAs('d@agency.com.au'), false, 'a fourth address in the session');
  assert.doesNotMatch(store.getItem(api.REPLIES_KEY), /agency|@/, 'the addresses themselves are not stored');
  // A failed send does not use up the address.
  const fresh = storage();
  const failing = recordingFetch([{ status: 500, body: { success: 'false' } }, { status: 200, body: { success: 'true' } }]);
  const answers = api.answersFrom(new FakeFormData(ANSWERS));
  assert.equal(await api.joinByInbox(failing.fetch, answers, { sessionStorage: fresh }), 'missing');
  assert.equal(await api.joinByInbox(failing.fetch, answers, { sessionStorage: fresh }), 'joined');
  assert.ok('_autoresponse' in failing.requests[1].body);
  // Storage that throws: still sent, the auto-reply once per page load.
  const blocked = { get sessionStorage() { throw new Error('SecurityError'); } };
  const again = load();
  const twice = recordingFetch([{ status: 200, body: { success: 'true' } }, { status: 200, body: { success: 'true' } }]);
  assert.equal(await again.joinByInbox(twice.fetch, answers, blocked), 'joined');
  assert.equal(await again.joinByInbox(twice.fetch, { ...answers, p_email: 'other@agency.com.au' }, blocked), 'joined');
  assert.deepEqual(twice.requests.map(r => '_autoresponse' in r.body), [true, false]);
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

