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

test('the stage is one line, window.VEYLET_STAGE, and it is invitation', () => {
  const lines = source.split('\n').filter(line => /VEYLET_STAGE\s*=/.test(line));
  assert.deepEqual(lines, ["window.VEYLET_STAGE = 'invitation';"]);
  const window = load();
  assert.equal(window.VEYLET_STAGE, 'invitation');
  assert.equal(window.VeyletStage.DEFAULT, 'invitation');
  assert.deepEqual(Object.keys(window.VeyletStage.STAGES), ['test', 'invitation', 'waitlist', 'open']);
  assert.equal(window.VeyletStage.resolve(window.VEYLET_STAGE), 'invitation');
});

test('each page loads stage.js and its markup already reads as the default stage', () => {
  const { STAGES } = load().VeyletStage;
  const words = STAGES.invitation;
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
    ['New accounts weekly', 'Join the waitlist', '/waitlist', false]);
  assert.match(open.account.textContent, /weekly groups from the waitlist/);

  const typo = fakePage();
  assert.equal(apply(typo.doc, 'opne'), 'invitation');
  assert.equal(typo.cta.textContent.trim(), 'Ask for an invitation');
});

test('sign-in stays at every stage: the email-link form is markup the stage script never touches', () => {
  const account = read('account/index.html');
  assert.match(account, /<form id="account-sign-in" class="veylet-form">/);
  assert.match(account, /Email me a sign-in link/);
  assert.doesNotMatch(source, /account-sign-in|signIn|hidden = true;[^\n]*form/i);
  const signIn = fs.readFileSync(path.join(dist, 'account.js'), 'utf8');
  assert.match(signIn, /signInWithOtp\(/, 'sign-in by email link is unchanged');
});
