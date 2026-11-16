/*
 * The launch stage switch (dist/stage.js; launch readiness plan §5 in the product repository):
 * one line, window.VEYLET_STAGE, decides what /, /start and /account say about getting an account.
 * The markup carries the default stage's words, so the pages read correctly before the script runs
 * and without it; sign-in by email link stays for existing and invited accounts at every stage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element } = require('./form-page-fake.cjs');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const source = read('stage.js');
const PAGES = ['index.html', 'start/index.html', 'account/index.html'];

function load(extra = {}) {
  const window = { VEYLET_STAGE_MANUAL: true, ...extra };
  vm.runInNewContext(source, { window, document: undefined, Object });
  return window;
}

/** The launch-stage elements of one page's markup, as a person reads them before any script. */
function marked(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const text = inner => inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const pick = attr => [...clean.matchAll(new RegExp(`<(\\w+)\\b([^>]*\\b${attr}\\b[^>]*)>([\\s\\S]*?)</\\1\\s*>`, 'g'))]
    .map(m => ({ attrs: m[2], text: text(m[3]), href: (/\bhref="([^"]*)"/.exec(m[2]) || [])[1] || null,
      links: [...m[3].matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(l => ({ href: l[1], text: text(l[2]) })) }));
  return { labels: pick('data-launch-label'), ctas: pick('data-launch-cta'), accounts: pick('data-launch-account') };
}

/** A page with one label, one CTA (with its arrow icon) and one account line. */
function fakePage() {
  const label = new Element('strong');
  const icon = new Element('span', false, { class: 'icon-arrow' });
  const cta = new Element('a', false, { href: '/request?capture=self' });
  cta.textContent = 'Ask for an invitation ';
  cta.append(icon);
  cta.selectors = { '.icon-arrow': icon };
  const account = new Element('p');
  const root = new Element('html');
  const lists = { '[data-launch-label]': [label], '[data-launch-cta]': [cta], '[data-launch-account]': [account] };
  const doc = { documentElement: root, querySelectorAll: selector => lists[selector] || [], createElement: tag => new Element(tag) };
  return { doc, label, cta, icon, account, root };
}

test('the stage is one line, window.VEYLET_STAGE, and it is app (16 November 2026: on the App Store, rendering admitted weekly)', () => {
  const lines = source.split('\n').filter(line => /VEYLET_STAGE\s*=/.test(line));
  assert.deepEqual(lines, ["window.VEYLET_STAGE = 'app';"]);
  const window = load();
  assert.equal(window.VEYLET_STAGE, 'app');
  assert.equal(window.VeyletStage.DEFAULT, 'app');
  assert.deepEqual(Object.keys(window.VeyletStage.STAGES), ['test', 'invitation', 'waitlist', 'open', 'app']);
  assert.equal(window.VeyletStage.resolve(window.VEYLET_STAGE), 'app');
});

test('each page loads stage.js and its markup already reads as the default stage', () => {
  const { STAGES } = load().VeyletStage;
  const words = STAGES.app;
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<script src="\/stage\.js(\?v=[a-f\d]{16})?" defer><\/script>/, page);
    const { labels, ctas, accounts } = marked(html);
    for (const label of labels) assert.equal(label.text, words.label, page);
    for (const cta of ctas) assert.deepEqual([cta.text, cta.href], [words.cta.text, words.cta.href], page);
    for (const account of accounts) {
      assert.equal(account.text, `${words.account} ${words.accountLink.text}.`, page);
      assert.deepEqual(account.links, [{ href: words.accountLink.href, text: words.accountLink.text }], page);
    }
  }
  const home = marked(read('index.html')), start = marked(read('start/index.html')), account = marked(read('account/index.html'));
  assert.deepEqual([home.labels.length, home.ctas.length], [1, 1]);
  assert.deepEqual([start.labels.length, start.ctas.length], [1, 1]);
  assert.equal(account.accounts.length, 1);
  assert.match(account.accounts[0].attrs, /\bid="account-access-note"/, 'account.js still hides this line once signed in');
});

test('the old self-serve wording is gone from the sign-up calls to action', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.doesNotMatch(html, /Start free/i, page);
    assert.doesNotMatch(html, />\s*Start with one space\s*(<span|<\/a)/, page);
    assert.doesNotMatch(html, /limited studio test|Account access is in a limited test\. Contact Veylet support/, page);
  }
});

test('invitation and waitlist say "By invitation" with their own call to action; the account line says new accounts are by invitation', () => {
  const { apply } = load().VeyletStage;
  const invited = fakePage();
  assert.equal(apply(invited.doc, 'invitation'), 'invitation');
  assert.deepEqual([invited.label.textContent, invited.cta.textContent, invited.cta.getAttribute('href')],
    ['By invitation', 'Ask for an invitation ', '/request?capture=self']);
  assert.equal(invited.cta.links().length, 0);
  assert.ok(invited.cta.children.includes(invited.icon), 'the arrow icon is kept');
  assert.match(invited.account.textContent, /^New accounts are by invitation for now\./);
  assert.equal(invited.account.links()[0].getAttribute('href'), '/request?capture=self');
  assert.equal(invited.root.getAttribute('data-launch-stage'), 'invitation');

  const waiting = fakePage();
  apply(waiting.doc, 'waitlist');
  assert.deepEqual([waiting.label.textContent, waiting.cta.textContent.trim(), waiting.cta.getAttribute('href')],
    ['By invitation', 'Join the waitlist', '/waitlist']);
  assert.match(waiting.account.textContent, /^New accounts are by invitation for now\. .*Join the waitlist\.$/);
  assert.equal(waiting.account.links()[0].getAttribute('href'), '/waitlist');
});

test('test stage says Limited test with no sign-up link; open admits weekly from the waitlist; an unknown value is the default', () => {
  const { apply } = load().VeyletStage;
  const limited = fakePage();
  apply(limited.doc, 'test');
  assert.equal(limited.label.textContent, 'Limited test');
  assert.equal(limited.cta.hidden, true);
  assert.equal(limited.account.links().length, 0);
  assert.doesNotMatch(limited.account.textContent, /waitlist|invitation/i);

  const open = fakePage();
  apply(open.doc, 'open');
  assert.deepEqual([open.label.textContent, open.cta.textContent.trim(), open.cta.getAttribute('href'), open.cta.hidden],
    ['Open to anyone, admitted weekly', 'Join the waitlist', '/waitlist', false]);
  assert.match(open.account.textContent, /^Anyone can join\. New accounts are admitted in weekly groups from the waitlist\./);
  assert.doesNotMatch(open.label.textContent + open.account.textContent, /invitation|Start free/i);

  const store = fakePage();
  apply(store.doc, 'app');
  assert.deepEqual([store.label.textContent, store.cta.textContent.trim(), store.cta.getAttribute('href'), store.cta.hidden],
    ['On the App Store, admitted weekly', 'Get the app', 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913', false]);
  assert.ok(store.cta.children.includes(store.icon), 'the arrow icon is kept');
  assert.match(store.account.textContent, /Rendering opens to new accounts in weekly groups from the waitlist\..*Join the waitlist\.$/);
  assert.equal(store.account.links()[0].getAttribute('href'), '/waitlist', 'the waitlist stays the way to be admitted');

  const typo = fakePage();
  assert.equal(apply(typo.doc, 'opne'), 'app');
  assert.equal(typo.cta.textContent.trim(), 'Get the app');
});

test('sign-in stays at every stage: the email-link form is markup the stage script never touches', () => {
  const account = read('account/index.html');
  assert.match(account, /<form id="account-sign-in" class="veylet-form">/);
  assert.match(account, /Email me a sign-in link/);
  assert.doesNotMatch(source, /account-sign-in|signIn|hidden = true;[^\n]*form/i);
  const signIn = fs.readFileSync(path.join(dist, 'account.js'), 'utf8');
  assert.match(signIn, /signInWithOtp\(/, 'sign-in by email link is unchanged');
});

// Owner decisions, 26 September 2026: captures are sent from the app; the public pages have one main
// path, the waitlist, with the weekly-groups line beside it; /request stays only for existing agreements.
const SEND = 'Send from the app: it uploads in the background. Check your account for rendering status.';
const flatText = html => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('home and /start describe sending from the app, and no export or private-transfer route survives', () => {
  for (const page of ['index.html', 'start/index.html']) {
    const words = flatText(read(page));
    assert.ok(words.includes(SEND), `${page} says: ${SEND}`);
    assert.doesNotMatch(words, /\bZIP\b|AirDrop|to Files|private transfer|capture-upload form|sending directly from the app|in-app sending is not|Export capture/i, page);
    assert.match(words, /automatic quality check/, `${page} keeps the automatic quality check`);
  }
  assert.match(flatText(read('start/index.html')), /Review before sharing\./);
  for (const page of [
    'help/uploading/index.html',
    'app/help/uploading/index.html',
    'account/index.html',
    'guides/iphone-lidar-vs-matterport/index.html',
  ]) {
    const words = flatText(read(page));
    assert.ok(words.includes(SEND), `${page} says the complete current sending status`);
    assert.doesNotMatch(words, /\busually (?:ready(?: in| within)?|within) 1(?:–|-|&ndash;|&#8211;)2 hours\b/i,
      `${page} does not promise the retired usual turnaround`);
  }
});

test('home and /start have one main path, the App Store, and do not send visitors to the enquiry form', () => {
  for (const page of ['index.html', 'start/index.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /href="\/request/, `${page} does not link /request`);
    assert.doesNotMatch(html, /Request a walkthrough|Tell us about your space|Ask about capture|Managed clients/i, page);
    assert.match(flatText(html), /in weekly groups/, page);
    const mainButtons = [...html.matchAll(/<a class="button"[^>]*href="([^"]*)"/g)].map(m => m[1]);
    assert.ok(mainButtons.length > 0 && mainButtons.every(href => href === 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913'), `${page} main buttons: ${mainButtons}`);
    assert.match(html, /href="\/waitlist"/, `${page} still links the waitlist for render admission`);
  }
  assert.doesNotMatch(read('index.html'), /without the capture app/, 'the managed-option answer is gone');
});

test('the privacy notices describe weekly admission from the waitlist with a legal-review marker, and no studio test', () => {
  const sentence = 'New accounts are admitted in weekly groups from the waitlist; for help, contact Veylet support at support@veylet.com.';
  for (const page of ['privacy/index.html', 'app/privacy/index.html']) {
    const html = read(page);
    assert.ok(html.includes(`<!-- LEGAL REVIEW 2026-09-26: access wording (stage open) -->${sentence}`), page);
    assert.doesNotMatch(html, /limited studio test|contact the studio before/i, page);
  }
  assert.doesNotMatch(read('app/privacy/index.html'), /href="\/waitlist"|A\$/, '/app/privacy names no purchase path or price');
});

// 29 Sep 2026 (owner): support@veylet.com (Cloudflare Email Routing) is the public address. Since 30 Sep 2026
// waitlist sign-ups and /request enquiries both go to the database, so FormSubmit and its former inbox
// (yoda@yodalai.xyz) appear nowhere.
test('the marketing, guide, help and privacy pages show support@veylet.com, and the old inbox and FormSubmit nowhere', () => {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const roots = ['guides', 'help', 'app/help', 'privacy', 'app/privacy', 'start', 'request', 'waitlist'].map(dir => path.join(dist, dir));
  const files = [...roots.flatMap(walk), ...['index.html', 'llms.txt', 'enquiry.js'].map(file => path.join(dist, file))];
  for (const file of files.filter(f => /\.(?:html|js|txt)$/.test(f))) {
    const where = path.relative(dist, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /yoda@yodalai|yodalai\.xyz/i, where);
    assert.doesNotMatch(text, /formsubmit/i, where);
  }
  assert.doesNotMatch(read('waitlist/waitlist.js'), /formsubmit/i, 'waitlist sign-ups never go to FormSubmit');
});

test('the guides state the plan-bound hosting rule and the app send, with no studio route or twelve-month hosting', () => {
  const hosting = 'stays live while your plan is active; when the plan ends, its links keep working for 14 days, then go offline until the plan restarts.';
  for (const page of ['guides/what-is-a-3d-walkthrough/index.html', 'guides/iphone-lidar-vs-matterport/index.html']) {
    const words = flatText(read(page));
    assert.ok(words.includes(hosting), `${page}: ${hosting}`);
    assert.doesNotMatch(words, /twelve months after release|agreed private route|send it to the studio|the studio (?:reconstructs|processes)/i, page);
  }
  const lidarGuide = flatText(read('guides/iphone-lidar-vs-matterport/index.html'));
  assert.ok(lidarGuide.includes(SEND), `iPhone LiDAR guide says: ${SEND}`);
  assert.ok(lidarGuide.includes('We’ll email you when it’s ready.'),
    'iPhone LiDAR guide describes the wait without promising a turnaround');
  assert.match(lidarGuide, /automatic quality check stops a render that cannot work/i,
    'iPhone LiDAR guide identifies a hard quality failure');
  assert.match(lidarGuide, /Other findings .* do not block the render: they are flagged for you to check before approval\./,
    'iPhone LiDAR guide distinguishes advisory review flags');
  for (const page of ['guides/index.html', 'guides/what-is-a-3d-walkthrough/index.html', 'guides/iphone-lidar-vs-matterport/index.html']) {
    assert.doesNotMatch(read(page), /href="\/request/, `${page} does not link /request`);
  }
});

test('home: the App Store is asked for in the hero and the closing band only, one See a result link per section, one stage line', () => {
  const home = read('index.html');
  const main = home.match(/<main\b[\s\S]*?<\/main>/)[0];
  const store = [...main.matchAll(/<a [^>]*data-analytics-cta="app_store"[^>]*data-analytics-placement="(\w+)"/g)].map(match => match[1]);
  assert.deepEqual(store, ['hero', 'body'], 'hero and closing band');
  const closing = main.match(/<section class="closing-invitation"[\s\S]*?<\/section>/)[0];
  assert.match(closing, /data-analytics-cta="app_store"/, 'the body one is the closing band');
  assert.match(closing, /href="\/waitlist"/, 'the closing band still names the waitlist for render admission');
  assert.doesNotMatch(main.match(/<div class="walk-after">[\s\S]*?<\/div>/)[0], /app_store|href="\/waitlist"/, 'no mid-page main button');
  assert.match(home, /data-analytics-cta="app_store" data-analytics-placement="sticky">Get the app<\/a>/, 'the mobile sticky bar stays');
  const see = main.match(/<section class="see-band[\s\S]*?<\/section>/)[0];
  assert.equal((see.match(/href="\/see"/g) || []).length, 1, 'one See a result link in the section');
  // The stage label and the weekly-groups note are one line, then the price line, unchanged.
  assert.doesNotMatch(main, /hero-admit/);
  assert.equal((main.match(/data-launch-label/g) || []).length, 1);
  assert.match(main, /<\/div>\s*<p class="hero-note hero-stage"><strong data-launch-label>On the App Store, admitted weekly<\/strong><\/p>\s*<p class="hero-note">\n            1 free month with 30 rooms included, then the Veylet plan\n            at A\$139\.99 a month or A\$1,399\.99 a year through the App Store, which you can cancel any time\.\n            Early accounts in south-east Queensland\.\n          <\/p>/);
  // Shorter copy that keeps what is not yet proven, said once.
  const text = main.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const sentences = html => html.replace(/<[^>]+>/g, '').trim().split(/(?<=[.?!])\s+/).length;
  assert.equal(sentences(main.match(/<p class="pilot-note">([\s\S]*?)<\/p>/)[1].replace(/^<strong>Where we are today\.<\/strong>/, '')), 1);
  assert.doesNotMatch(text, /Pilot status|onboarding early accounts/, 'the App Store launch drops the pilot framing');
  const steps = [...main.matchAll(/<li data-walk-step[^>]*>.*?<\/button><p>([\s\S]*?)<\/p><\/li>/g)].map(match => match[1]);
  assert.equal(sentences(steps[2]), 1, 'step 3 is one sentence');
  assert.equal(sentences(steps[3]), 1, 'step 4 is one sentence');
  assert.ok(sentences(main.match(/<div class="closing-action">\s*<p>([\s\S]*?)<\/p>/)[1]) <= 2, 'closing paragraph');
  assert.match(text, /no client-accepted walkthrough to show yet/);
});

// 17 November 2026: the app has been on the App Store since 15 November 2026, so every guide's main
// button is the same App Store button as the home page, and no guide says the app is invite-only.
test('each guide’s main button is the App Store button, with no waitlist button or invitation-only wording', () => {
  const STORE = 'https://apps.apple.com/au/app/veylet-3d-property-tours/id6814273913';
  const guides = fs.readdirSync(path.join(dist, 'guides'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `guides/${e.name}/index.html`);
  assert.ok(guides.length >= 6, `guides found: ${guides}`);
  for (const page of guides) {
    const html = read(page);
    const buttons = [...html.matchAll(/<a class="button"[^>]*>/g)].map(m => m[0]);
    assert.ok(buttons.length > 0, `${page} has a main button`);
    for (const button of buttons) {
      assert.equal(button, `<a class="button" href="${STORE}" data-analytics-cta="app_store" data-analytics-placement="body">`, page);
    }
    assert.doesNotMatch(html, />Join the waitlist </, `${page} has no waitlist button`);
    assert.doesNotMatch(flatText(html), /TestFlight|not (?:yet )?on the App Store|not listed on the App Store|invitation comes|by invitation only|from your invitation/i, page);
  }
  const llmsFull = read('llms-full.txt');
  assert.doesNotMatch(llmsFull, /Pilot status|TestFlight|invitation comes|from your invitation|Join the waitlist See/, 'llms-full.txt');
  assert.doesNotMatch(read('llms.txt'), /TestFlight|invited pilot/, 'llms.txt');
});
