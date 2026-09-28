/*
 * The pages the Veylet Capture app opens (/app/account, /app/terms, /app/privacy,
 * /app/support): no price, no purchase, no link out of /app (launch plan C1,
 * App Store Guideline 3.1.1). scripts/check-app-pages.mjs does the work; these
 * tests run it on dist, prove it catches what it must, and hold the legal text
 * to the public pages' words.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '../dist');
const checker = import(pathToFileURL(path.join(__dirname, '../scripts/check-app-pages.mjs')));
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');

function copyDist(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veylet-app-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(DIST, root, { recursive: true });
  const edit = (file, change) => fs.writeFileSync(path.join(root, file), change(fs.readFileSync(path.join(root, file), 'utf8')));
  return { root, edit };
}

test('every page the app opens is clean: rendered, in reach of its scripts in app mode, and in its links', async () => {
  const { checkAppPages, APP_ACCOUNT_CASES } = await checker;
  const result = await checkAppPages(DIST);
  assert.deepEqual(result.pages, ['app/account/index.html', 'app/privacy/index.html', 'app/status/index.html', 'app/support/index.html', 'app/terms/index.html']);
  assert.deepEqual(result.scripts, ['status.js'], 'the other app pages\' scripts are read for their strings');
  assert.equal(result.cases, APP_ACCOUNT_CASES.length);
  assert.ok(result.rendered > 1000, 'the desk really drew its states: ' + result.rendered + ' strings');
  assert.deepEqual(result.problems, []);
});

test('the checker fails on each forbidden word, an outside link, a missing noindex and marketing navigation', async t => {
  const { checkAppPages, findBanned } = await checker;
  for (const [text, word] of [['From A$99 a month', 'A$'], ['US$20', '$'], ['Buy a pack of 3', 'pack'], ['Super fast render', 'Super fast'],
    ['Express render', 'express'], ['see /offer', '/offer'], ['Our prices', 'price'], ['pricing', 'price']]) {
    assert.ok(findBanned(text, 'x').some(item => item.word === word), text);
  }
  for (const text of ['Packing it for phones', 'The package changed.', 'expressly', 'Offered']) assert.deepEqual(findBanned(text, 'x'), [], text);
  const f = copyDist(t);
  f.edit('app/terms/index.html', html => html.replace('<strong>Refunds.</strong>', '<strong>Refunds.</strong> Packs cost A$169, see <a href="/offer">the offer</a>.'));
  f.edit('app/support/index.html', html => html.replace('<meta name="robots" content="noindex,nofollow" />', '').replace('</header>', '<nav aria-label="Main"><a href="/start">Start</a></nav></header>'));
  const { problems } = await checkAppPages(f.root);
  const said = problems.map(item => item.where + ' ' + item.word);
  for (const expected of ['app/terms/index.html (text) A$', 'app/terms/index.html (text) pack', 'app/terms/index.html (href) /offer',
    'app/terms/index.html (link) outside /app', 'app/support/index.html noindex', 'app/support/index.html navigation', 'app/support/index.html (link) outside /app']) {
    assert.ok(said.includes(expected), expected + ' in ' + said.join(', '));
  }
});

test('without app mode the same page renders the money blocks, and the checker says so (the rendered pass is real)', async t => {
  const { checkAppPages } = await checker;
  const f = copyDist(t);
  f.edit('app/account/index.html', html => html.replace(' data-app-mode="true"', ''));
  const { problems } = await checkAppPages(f.root);
  const words = new Set(problems.map(item => item.word));
  for (const word of ['mode', 'A$', 'money call', '/offer']) assert.ok(words.has(word), word);
  assert.ok(problems.some(item => item.word === 'money call' && item.excerpt === 'get_express_offer'));
  assert.ok(!problems.some(item => /extend hosting/i.test(item.excerpt)), 'no hosting extension is sold any more (retired 26 September 2026)');
});

test('the app pages have a minimal header, and their only navigation is to one another', () => {
  for (const page of ['account', 'terms', 'privacy', 'support']) {
    const html = read('app/' + page + '/index.html');
    assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/, page);
    assert.match(html, /<header class="wrap app-header">\s*<span class="brand"><span class="portal" aria-hidden="true"><\/span>VEYLET<\/span>\s*<\/header>/, page + ': no links in the header');
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
    assert.deepEqual([...footer.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/app/account', '/app/support', '/app/privacy', '/app/terms'], page);
    assert.match(footer, new RegExp('href="/app/' + page + '" aria-current="page"'), page);
    assert.doesNotMatch(html, /brand-host\.js|<link rel="canonical"|og:image/, page + ': not a public page');
  }
  const account = read('app/account/index.html');
  assert.match(account, /^<!doctype html>\s*<html lang="en" data-app-mode="true">/);
  for (const id of ['account-trial', 'account-packs', 'account-annual', 'account-referral', 'account-referred', 'account-express-status', 'account-add-space', 'account-gate'])
    assert.doesNotMatch(account, new RegExp('id="' + id + '"'), id + ' is not on the app page');
  for (const id of ['account-sign-in', 'account-verify', 'account-properties', 'account-plan-body', 'account-contact', 'account-deletion', 'account-export', 'account-sign-out'])
    assert.match(account, new RegExp('id="' + id + '"'), id);
  // The same desk script as /account, at the same version.
  const script = src => [...src.matchAll(/<script src="(\/account\.js\?v=[a-f\d]{16})"/g)].map(match => match[1]);
  assert.deepEqual(script(account), script(read('account/index.html')));
});

const words = html => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const mainOf = html => html.match(/<main\b[\s\S]*?<\/main>/)[0];

test('/app/privacy is the public notice word for word; only its account link stays in the app', () => {
  const app = mainOf(read('app/privacy/index.html'));
  const site = mainOf(read('privacy/index.html'));
  assert.equal(app.replace('<a href="/app/account">', '<a href="/account">'), site);
});

test('/app/terms is the public terms word for word, less the sentences that name an amount or a purchase the app does not sell', () => {
  const REPLACED = 'See your plan in the app.';
  const NOTE = 'This copy of the terms is the one shown in the app. It leaves out sections about purchases that are not available in the app.';
  const site = words(mainOf(read('terms/index.html')));
  const app = words(mainOf(read('app/terms/index.html')));
  // Every sentence of the app copy is a sentence of the public terms, the stand-in, or the note.
  const sentences = app.replace(NOTE, '').split(/(?<=[.!?])\s+(?=[A-Z0-9“])/).map(item => item.trim()).filter(Boolean);
  const unknown = sentences.filter(sentence => sentence !== REPLACED && !site.includes(sentence));
  assert.deepEqual(unknown, []);
  assert.equal(app.split(REPLACED).length - 1, 5, 'five sentences stand in for amounts (listed for legal review)');
  assert.ok(app.includes(NOTE));
  // What was left out, by heading.
  for (const heading of ['One-time walkthrough packs.', 'Super fast renders.', 'Other work.']) {
    assert.ok(site.includes(heading), heading);
    assert.ok(!app.includes(heading), heading + ' is not in the app copy');
  }
  // The consumer-law and deletion promises are all there.
  for (const kept of ['Australian Consumer Law.', 'Deleting your account.', 'What deletion covers.', 'Limited records we retain.', 'Cancelling.', 'Refunds.', 'Governing law.']) assert.ok(app.includes(kept), kept);
});

test('/app/support: support contact, help and deletion, all inside the app', () => {
  const html = read('app/support/index.html');
  assert.match(html, /<a href="mailto:yoda@yodalai\.xyz\?subject=Veylet%20support">yoda@yodalai\.xyz<\/a>/);
  assert.match(words(html), /Deleting your account In the app under Account, or in your account under "Finishing, exporting or leaving"\. We complete it within 30 days/);
  assert.match(words(html), /Pause sharing keeps the same link: within a minute, the link, embed and QR show "not available" until you resume\./);
  assert.doesNotMatch(words(html), /studio|business day|working day/i, 'no studio and no promised turnaround');
});

test('the QA fixture holds waiting captures and flags the ready one, for each documented switch', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
  const jobs = async search => {
    const context = { URLSearchParams, Response, location: { search, pathname: '/__qa/account/' }, localStorage: { getItem: () => null, setItem() {} },
      document: { createElement: () => ({}), addEventListener() {} } };
    context.window = context;
    vm.runInNewContext(source, context);
    const answer = await context.supabase.createClient().rpc('list_workspace_render_status', { p_workspace_id: 'synthetic-workspace' });
    return JSON.parse(JSON.stringify(answer.data.spaces.map(space => space.job).filter(Boolean)));
  };
  for (const reason of ['admission', 'paused', 'weekly_limit']) {
    const [job] = await jobs('?render=waiting&hold=' + reason);
    assert.equal(job.state, 'waiting');
    assert.equal(job.hold.reason, reason);
    assert.equal(job.hold.until === null, reason !== 'weekly_limit', reason);
  }
  const [limited] = await jobs('?render=waiting&hold=trial_limit');
  assert.equal(limited.hold.reason, 'trial_limit');
  assert.match(limited.hold.plan_starts_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(limited.hold.start_plan_now, true, 'legacy field remains so the account UI can prove it ignores the retired billing trigger');
  assert.equal(limited.hold.message, 'Legacy trial-limit hold from an older backend.');
  const [paused] = await jobs('?render=paused');
  assert.deepEqual([paused.state, paused.share_paused], ['paused', true]);
  // Offer 2026-09-27.1: ?rooms= keeps the observed rooms but every capture uses exactly one walkthrough.
  for (const [rooms, used] of [[1, 1], [8, 1], [9, 1], [17, 1]]) {
    const [job] = await jobs('?render=ready&rooms=' + rooms);
    assert.deepEqual([job.rooms, job.walkthroughs_used], [rooms, used], String(rooms));
  }
  assert.deepEqual((({ rooms, walkthroughs_used }) => [rooms, walkthroughs_used])((await jobs('?render=ready'))[0]), [null, 1]);
  assert.equal((await jobs('?render=waiting'))[0].hold, null);
  assert.equal((await jobs('?render=rendering&hold=paused'))[0].hold, null, 'only a queued job is held');
  const [ready] = await jobs('?render=ready&flags=all');
  assert.equal(ready.review_flags.length, 6);
  assert.ok(ready.review_flags.every(flag => Object.keys(flag).join() === 'room,reason'), 'as the member read names them: no rule');
  assert.deepEqual((await jobs('?render=ready'))[0].review_flags, []);
  assert.equal((await jobs('?render=waiting&flags=all'))[0].review_flags, null, 'only a ready capture carries flags');
});
