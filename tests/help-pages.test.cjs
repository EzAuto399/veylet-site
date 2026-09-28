/*
 * The help centre: /help (public, indexable) and /app/help (the same articles for the
 * Veylet Capture app: noindex, price-free, links only to /app pages). Both are rendered
 * from tests/help-articles.cjs; these tests hold dist to that source, run the app-page
 * checker over /app/help, and keep the words, rule ids and links in step with the desk.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const help = require('./help-articles.cjs');

const DIST = path.join(__dirname, '../dist');
const checker = import(pathToFileURL(path.join(__dirname, '../scripts/check-app-pages.mjs')));
const read = file => fs.readFileSync(path.join(DIST, file), 'utf8');
const pages = help.pages();
const articles = pages.filter(page => page.kind === 'article');
const main = html => (html.match(/<main\b[\s\S]*?<\/main>/) || [''])[0];
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hrefs = html => [...html.matchAll(/\bhref="([^"]*)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
const unversioned = html => html.replace(/\?v=[a-f\d]{16}/g, '?v=');

function files(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(root, entry.name)) : [path.relative(DIST, path.join(root, entry.name))]);
}

test('dist/help and dist/app/help are exactly what tests/help-articles.cjs renders (run it with --write after editing)', () => {
  const expected = new Set(pages.map(page => page.file));
  for (const page of pages) {
    assert.ok(fs.existsSync(path.join(DIST, page.file)), page.file + ' is missing');
    assert.equal(unversioned(read(page.file)), unversioned(page.html), page.file + ' differs from its source');
  }
  const extra = [...files(path.join(DIST, 'help')), ...files(path.join(DIST, 'app/help'))]
    .filter(file => !expected.has(file) && file !== 'help/help.css');
  assert.deepEqual(extra, []);
});

test('sending help uses status checks and describes standard timing only as an unproved pilot target', () => {
  for (const base of ['help', 'app/help']) {
    const uploading = text(read(`${base}/uploading/index.html`));
    const status = text(read(`${base}/render-status/index.html`));
    assert.match(uploading, /Send from the app: it uploads in the background\. Check your account for rendering status\./, base);
    assert.match(status, /Standard rendering targets 1–2 hours after upload; pilot turnaround is not yet established\./, base);
    assert.doesNotMatch(uploading + status, /usually (?:ready(?: in| within)?|within) 1(?:–|-| to )2 hours/i, base);
  }
});

test('your-plan mirrors the accepted capture allowance and says exports are not open yet', () => {
  for (const file of ['help/your-plan/index.html', 'app/help/your-plan/index.html']) {
    const words = text(main(read(file)));
    assert.match(words, /One accepted capture uses one walkthrough, regardless of room count\./, file);
    assert.match(words, /if all rooms do not fit, make more captures\. Each additional capture is another walkthrough with its own link and QR code\./, file);
    assert.match(words, /permitted whole recapture containing every original room, replaces it on the same link and uses no extra walkthrough\./, file);
    assert.match(words, /A partial recapture of only named rooms is not a permitted whole recapture and does not receive that waiver\./, file);
    assert.doesNotMatch(words, /up to 8 rooms|each further 8 rooms|recapture of the rooms the quality check names, uses none/i, file);
    assert.match(words, /Listing videos and stills are included in your plan once exports open\. Exports are not open yet\./, file);
    assert.doesNotMatch(words, /Listing videos and stills are included in your plan\. Files you already downloaded/, file);
  }
});

test('render-status and every blocking-fix page state the bounded recapture allowance', () => {
  const allowance = /This failed attempt uses no walkthrough\. A later accepted new capture uses one\. Only a correction or reprocessing of the same walkthrough, or a permitted whole recapture containing every original room, keeps the same link and uses no extra walkthrough\. A partial named-room recapture is not a waiver\./;
  const slugs = ['render-status', ...help.RECAPTURE_RULES.map(rule => `fix/${rule}`)];
  for (const base of ['help', 'app/help']) {
    for (const slug of slugs) {
      const file = `${base}/${slug}/index.html`;
      const words = text(main(read(file)));
      assert.match(words, allowance, file);
      assert.doesNotMatch(words, /recaptur(?:e this room|e it|ing)[^.]{0,100}(?:won’t|won't|will not) use a walkthrough/i, file);
    }
  }
});

test('each page loads the current bytes of its stylesheets', () => {
  for (const page of pages) {
    const links = [...read(page.file).matchAll(/<link rel="stylesheet" href="\/([\w./-]+)\?v=([a-f\d]{16})">/g)];
    assert.equal(links.length, 3, page.file);
    for (const [, file, version] of links) assert.equal(version, help.assetHash(fs.readFileSync(path.join(DIST, file))), page.file + ' → ' + file);
  }
});

test('the app checker covers every /app/help page and finds them clean', async () => {
  const { checkAppPages } = await checker;
  const result = await checkAppPages(DIST);
  const appHelp = pages.filter(page => page.edition === 'app').map(page => page.file).sort();
  assert.deepEqual(result.helpPages, appHelp);
  assert.equal(result.pages.includes('app/help/index.html'), false, 'the help centre is listed once, as help pages');
  assert.deepEqual(result.problems, []);
});

test('the checker catches a price, a purchase word and a public link on an /app/help page', async t => {
  const { checkAppPages } = await checker;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veylet-help-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(DIST, root, { recursive: true });
  const file = path.join(root, 'app/help/fix/no_frames/index.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</main>', '<p>From A$99, or buy a pack. <a href="/help/website">More</a></p></main>'));
  const words = (await checkAppPages(root)).problems.filter(problem => problem.where.startsWith('app/help/fix/no_frames')).map(problem => problem.word);
  for (const word of ['A$', '$', 'pack', 'outside /app']) assert.ok(words.includes(word), word + ' was not caught: ' + words.join(', '));
});

test('public pages are indexable with their own title, description, canonical URL and structured data', () => {
  const titles = new Set(), descriptions = new Set();
  for (const page of pages.filter(item => item.edition === 'public' && item.kind !== 'redirect')) {
    const html = page.html;
    const route = page.kind === 'index' ? '/help' : '/help/' + page.slug;
    assert.doesNotMatch(html, /name="robots"/, page.file);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://veylet\\.com${route}">`), page.file);
    assert.match(html, new RegExp(`<meta property="og:url" content="https://veylet\\.com${route}">`), page.file);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]+)">/)[1];
    assert.ok(title.length <= 90 && !titles.has(title), page.file + ' title: ' + title);
    assert.ok(description.length >= 60 && description.length <= 160 && !descriptions.has(description), page.file + ' description (' + description.length + ')');
    titles.add(title); descriptions.add(description);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data['@context'], 'https://schema.org', page.file);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, page.file);
  }
});

test('app pages are noindex, have no canonical to the public site and no marketing navigation', () => {
  for (const page of pages.filter(item => item.edition === 'app')) {
    assert.match(page.html, /<meta name="robots" content="noindex/, page.file);
    assert.doesNotMatch(page.html, /rel="canonical"|aria-label="Main"|application\/ld\+json/, page.file);
    for (const link of hrefs(page.html)) assert.match(link, /^(\/app\/|mailto:|\/[\w./-]+\.css\?v=|\/media\/|#)/, page.file + ' → ' + link);
  }
});

test('the redirect pages for review flags are noindex and point at their section', () => {
  for (const page of pages.filter(item => item.kind === 'redirect')) {
    const rule = page.slug.slice('fix/'.length);
    const base = page.edition === 'app' ? '/app/help' : '/help';
    assert.match(page.html, /<meta name="robots" content="noindex/, page.file);
    assert.match(page.html, new RegExp(`<meta http-equiv="refresh" content="0; url=${base}/${help.FLAG_ARTICLE}#${rule}">`), page.file);
  }
});

test('every article: breadcrumbs back, a short title, 3 to 6 steps per list, what to do if it does not work, and Veylet support', () => {
  const supportPage = read('support/index.html');
  assert.ok(supportPage.includes('mailto:' + help.SUPPORT), 'the help centre uses the site’s support address');
  assert.ok(articles.length >= 20 && articles.length <= 60, articles.length + ' articles in two editions');
  for (const page of articles) {
    const html = main(page.html);
    const base = page.edition === 'app' ? '/app/help' : '/help';
    assert.match(html, new RegExp(`<nav class="crumbs" aria-label="Breadcrumb"><a href="${base}">Help</a>`), page.file);
    assert.match(html, /<h2 id="if-it-does-not-work">If it doesn’t work<\/h2>/, page.file);
    assert.match(html, /<h2 id="still-stuck">Still stuck\? Email Veylet support<\/h2>/, page.file);
    assert.ok(html.includes(`href="mailto:${help.SUPPORT}?subject=`), page.file);
    assert.ok(html.includes(`<p class="help-back"><a href="${base}">All help topics</a></p>`), page.file);
    const h1 = text(html.match(/<h1>([\s\S]*?)<\/h1>/)[1]).trim();
    assert.ok(h1.length <= 70, page.file + ' title is long: ' + h1);
    for (const list of html.matchAll(/<ol class="help-steps">([\s\S]*?)<\/ol>/g)) {
      const steps = (list[1].match(/<li>/g) || []).length;
      assert.ok(steps >= 3 && steps <= 6, page.file + ' has a list of ' + steps + ' steps');
    }
  }
});

test('the index lists every article once, in at most seven groups, and each breadcrumb group exists', () => {
  for (const edition of ['public', 'app']) {
    const index = pages.find(page => page.edition === edition && page.kind === 'index').html;
    const base = edition === 'app' ? '/app/help' : '/help';
    const groups = [...index.matchAll(/<section class="help-group" aria-labelledby="([\w-]+)"><h2 id="\1">/g)].map(match => match[1]);
    assert.ok(groups.length >= 1 && groups.length <= 7, edition + ': ' + groups.length + ' groups');
    for (const article of help.ARTICLES) {
      const listed = index.split(`<a href="${base}/${article.slug}">`).length - 1;
      assert.equal(listed, 1, edition + ' index lists ' + article.slug + ' ' + listed + ' times');
      assert.ok(groups.includes(article.group), article.slug + ' is in group ' + article.group);
    }
  }
});

test('only the public index links to /offer, and only from its footer', () => {
  for (const page of pages) {
    const offers = hrefs(page.html).filter(link => /\/offer\b/.test(link));
    if (page.edition === 'public' && page.kind === 'index') {
      assert.deepEqual(offers, ['/offer'], page.file);
      assert.ok(/<footer\b[\s\S]*href="\/offer"[\s\S]*<\/footer>/.test(page.html) && !main(page.html).includes('/offer'), page.file);
    } else {
      assert.deepEqual(offers, [], page.file);
    }
  }
});

test('every internal help link opens a page that exists, at a section that exists', () => {
  const byRoute = new Map(pages.map(page => ['/' + page.file.replace(/\/index\.html$/, ''), page.html]));
  for (const page of pages) {
    for (const link of hrefs(page.html).filter(value => /^\/(app\/)?help(\/|#|$)/.test(value) && !value.endsWith(".css") && !/\.css\?/.test(value))) {
      const [route, section] = link.split('#');
      assert.ok(byRoute.has(route), page.file + ' links to a missing page: ' + link);
      if (section) assert.ok(byRoute.get(route).includes(`id="${section}"`), page.file + ' links to a missing section: ' + link);
    }
  }
});

test('every rule id the app and the desk know has a page at fix/<rule> in both editions', () => {
  const desk = read('account.js');
  const flagWords = desk.match(/const REVIEW_FLAG_WORDS = \{([\s\S]*?)\};/)[1];
  const deskFlags = [...flagWords.matchAll(/^\s*(\w+):/gm)].map(match => match[1]);
  assert.deepEqual([...deskFlags].sort(), [...help.FLAG_RULES].sort(), 'the desk and the help centre know the same review flags');
  const routes = new Set(pages.map(page => page.file));
  for (const rule of [...help.RECAPTURE_RULES, ...help.FLAG_RULES]) {
    for (const dir of ['help', 'app/help']) assert.ok(routes.has(`${dir}/fix/${rule}/index.html`), `${dir}/fix/${rule}`);
  }
  // Each flag's section is titled with the desk's own words for it.
  const flags = help.ARTICLES.find(article => article.slug === help.FLAG_ARTICLE);
  for (const [rule, words] of [...flagWords.matchAll(/^\s*(\w+): '([^']+)'/gm)].map(match => [match[1], match[2]])) {
    const section = flags.body.find(item => item.id === rule);
    assert.ok(section, rule + ' has a section');
    assert.equal(section.title, words.charAt(0).toUpperCase() + words.slice(1), rule);
  }
  for (const rule of help.RECAPTURE_RULES) assert.equal(help.ARTICLES.find(article => article.slug === 'fix/' + rule).rule, rule);
});

// The app's HelpTopics.swift (sibling checkout, as scripts in property-3d-studio find this one):
// every path the app opens must be a page this site ships. Skipped when the checkout is absent.
const APP_HELP_TOPICS = path.join(__dirname, '../../property-3d-studio/local-pipeline/ios/Sources/Core/HelpTopics.swift');
test('every help page the app links to exists under /app/help', { skip: !fs.existsSync(APP_HELP_TOPICS) && 'no property-3d-studio checkout beside this one' }, () => {
  const swift = fs.readFileSync(APP_HELP_TOPICS, 'utf8');
  const list = swift.match(/static let articleSlugs: Set<String> = Set\(\[([\s\S]*?)\]/)[1];
  const slugs = [...list.matchAll(/"([^"]*)"/g)].map(match => match[1]).filter(slug => slug !== '');
  const rules = name => [...swift.match(new RegExp(`static let ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(rules('recaptureRules'), help.RECAPTURE_RULES);
  assert.deepEqual(rules('flagRules'), help.FLAG_RULES);
  assert.match(swift, /static let base = URL\(string: "https:\/\/veylet\.com\/app\/help"\)!/);
  const shipped = new Set(pages.filter(page => page.edition === 'app').map(page => page.file.replace(/^app\/help\/?/, '').replace(/\/?index\.html$/, '')));
  for (const slug of [...slugs, ...[...help.RECAPTURE_RULES, ...help.FLAG_RULES].map(rule => 'fix/' + rule)]) {
    assert.ok(shipped.has(slug), 'the app links to /app/help/' + slug + ', which this site does not ship');
  }
});

test('the status article uses the desk’s exact status words, and no page says a person or studio checks anything', () => {
  const desk = read('account.js');
  const status = main(pages.find(page => page.file === 'help/render-status/index.html').html).replace(/&quot;/g, '"');
  for (const label of JSON.parse(desk.match(/const RENDER_STEPS = (\[[^\]]+\])/)[1].replace(/'/g, '"'))) assert.ok(status.includes(label), label);
  for (const words of ['We’ll start your render as soon as a rendering place opens for your account.',
    'Rendering is paused for a moment. Yours keeps its place in line.', 'You’ve used this week’s renders.']) {
    assert.ok(desk.includes(words), 'the desk still says: ' + words);
    assert.ok(status.includes(words), 'the article says: ' + words);
  }
  const retired = /\b(studio|processing|processed|draft)\b|check and approve|approved – sharing off|turn on sharing|a person checks|someone checks/i;
  for (const page of pages) {
    const words = text(main(page.html));
    assert.doesNotMatch(words, retired, page.file);
    assert.doesNotMatch(words, /A\$|\$\d|\bpric(e|ing)\b|super[\s-]*fast|\bexpress\b/i, page.file);
  }
});
