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
  assert.doesNotMatch(markup, /formsubmit|googleapis|gtag|recaptcha|hcaptcha/i);
  assert.doesNotMatch(script, /https?:\/\//);
});

test('answers are trimmed and allowlisted; consent is true only when ticked', () => {
  const api = load();
  const answers = api.answersFrom(new FakeFormData(ANSWERS));
  assert.deepEqual(JSON.parse(JSON.stringify(answers)), {
    p_name: 'Sam Agent', p_email: 'Sam@Agency.com.au', p_business_type: 'sales_agent', p_device: 'iphone_pro_lidar',
    p_region: 'Brisbane', p_channels: ['own_website', 'domain'], p_consent_tips: false, p_consent_wording: 'tips-v1',
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
  assert.deepEqual(Object.keys(body).sort(), ['p_business_type', 'p_channels', 'p_consent_tips', 'p_consent_wording', 'p_device', 'p_email', 'p_name', 'p_region']);
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

test('success hides the form and says the weekly-groups sentence; a missing waitlist gives the email route', async () => {
  const api = load();
  const joined = page([{ status: 200, body: { state: 'joined' } }]);
  joined.ids['waitlist-form'].data = new FakeFormData(ANSWERS);
  assert.equal(await api.send(joined.window, joined.ids['waitlist-form']), 'joined');
  assert.equal(joined.ids['waitlist-form'].hidden, true);
  assert.equal(joined.ids['waitlist-done'].hidden, false);
  assert.equal(`${api.COPY.joinedTitle} ${api.COPY.joined}`,
    'You’re on the list. We admit new accounts in weekly groups and will email you when it’s your turn.');
  assert.match(markup, /<h2 id="waitlist-done-title" tabindex="-1">You’re on the list\.<\/h2>\s*<p id="waitlist-done-body">We admit new accounts in weekly groups and will email you when it’s your turn\.<\/p>/);
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
