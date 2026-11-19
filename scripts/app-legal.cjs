'use strict';
/*
 * The app legal pages' single source. dist/app/terms and dist/app/privacy render
 * from the public /terms and /privacy pages by the declared rules below, the same
 * way scripts/help-articles.cjs renders /app/help from one source. After editing
 * either public page:
 *   node scripts/app-legal.cjs --write
 * (scripts/write-build-info.mjs runs it before stamping asset versions.)
 * tests/app-legal.test.cjs fails when dist differs from what this renders.
 */
const fs = require('node:fs');
const path = require('node:path');
const { assetHash } = require('./help-articles.cjs');

const DIST = path.join(__dirname, '../dist');

/* ---- declared data ------------------------------------------------------------ */

// The app edition's own shell: no marketing navigation, noindex, links only to
// /app pages. ${inner} is the transformed <main> content of the public page.
const SHELL = {
  terms: {
    title: 'Terms — Veylet',
    description: 'Veylet terms of use, as shown in the Veylet Capture app.',
    notice: 'terms-notice',
    comment: `The page the Veylet Capture app opens: no marketing navigation. The legal
         text is /terms word for word, except where a sentence names an amount or
         a purchase the app does not sell; those sentences read "See your plan in
         the app." or are left out (listed in the release notes for legal review).`,
    nav: '<a href="/app/account">Account</a><a href="/app/support">Support</a><a href="/app/privacy">Privacy</a><a href="/app/terms" aria-current="page">Terms</a>',
  },
  privacy: {
    title: 'Privacy — Veylet',
    description: 'What Veylet collects, what it never sells, and how to have an account and its records deleted, as shown in the Veylet Capture app.',
    notice: 'privacy-notice',
    comment: `The page the Veylet Capture app opens: no marketing navigation. The notice
         is /privacy word for word; only the account link stays inside the app.`,
    nav: '<a href="/app/account">Account</a><a href="/app/support">Support</a><a href="/app/privacy" aria-current="page">Privacy</a><a href="/app/terms">Terms</a>',
  },
};

const shell = ({ title, description, notice, comment, nav }) => ({
  head: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#10231d" />
    <link rel="icon" href="/media/favicon.svg" type="image/svg+xml" /><link rel="icon" href="/media/favicon-32.png" sizes="32x32" type="image/png" /><link rel="apple-touch-icon" href="/media/apple-touch-icon.png" />
    <link rel="stylesheet" href="/style.css?v=${assetHash(fs.readFileSync(path.join(DIST, 'style.css')))}" />
    <style>
      .${notice} > p:not(.eyebrow):not(.intro) { margin-top: 1.25rem; }
    </style>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <!-- ${comment} -->
    <header class="wrap app-header">
      <span class="brand"><span class="portal" aria-hidden="true"></span>VEYLET</span>
    </header>
    <main id="main" class="form-page wrap ${notice}">`,
  foot: `</main>
    <footer class="wrap app-footer">
      <nav aria-label="Account and help">${nav}</nav>
    </footer>
  </body>
</html>
`,
});

// Both pages: each section heading becomes a run-in bold lead, and the account
// link stays inside the app.
const RUN_IN = /<h2>([^<]+)<\/h2>\s*<p> /g;
const runIn = html => html.replace(RUN_IN, '<p>\n        <strong>$1</strong> ');
const appLink = html => html.replaceAll('href="/account"', 'href="/app/account"');

// Privacy: the sections marked for owner legal review are not in the app copy;
// the public page's one link to Google's policy becomes plain words.
const DRAFT_1110 = /\s*<!-- DRAFT 2026-11-10: owner legal review required before release -->\s*<h2>[^<]*<\/h2>\s*<p>[\s\S]*?<\/p>\s*<!-- \/DRAFT 2026-11-10 -->/g;
const DRAFT_1112 = /\s*<!-- DRAFT 2026-11-12: owner legal review required before release -->\s*<h2>[^<]*<\/h2>[\s\S]*?<!-- \/DRAFT 2026-11-12 -->/g;
const GOOGLE_LINK = '<a href="https://policies.google.com/privacy">Privacy Policy</a>';

// Terms: sections about purchases the app does not sell are cut whole
// (heading + paragraph + review comments).
const OMITTED_TERMS = ['One-time packs.', 'Super fast renders.', 'Other work.'];

// The sentence that stands in for any sentence naming an amount or a purchase
// the app does not sell, and the note that says so.
const STAND_IN = 'See your plan in the app.';
const NOTE = '<p class="contact-note">\n        This copy of the terms is the one shown in the app. It leaves out\n        sections about purchases that are not available in the app.\n      </p>';

// Terms rewrites after the section cuts and run-in transform. Each from must
// occur exactly once; to is the app copy. Besides the stand-ins and cuts the
// app re-wraps the touched paragraphs, so the pairs carry the lines verbatim.
const TERMS_REWRITES = [
  { note: 'the NOTE follows the intro',
    from: 'This is not legal advice.\n      </p>',
    to: `This is not legal advice.\n      </p>\n      ${NOTE}` },
  { note: 'review comment sits on the public page only',
    from: '      <!-- legal review: 2026-09-25 automatic processing -->\n',
    to: '' },
  { note: 'stand-in 1: pack and Super fast charges during the free month',
    from: '        Nothing is charged during it unless the account owner buys a pack or\n        a Super fast render. The first charge is on the day it ends, at the price\n        of the plan you chose; if you cancel before then, nothing is charged.',
    to: `        ${STAND_IN}` },
  { note: 're-wrap after the stand-in',
    from: '        unlock in the app once your practice room passes. Apple confirms introductory-offer eligibility for the subscription group. Existing signed offers retain their dates and allowances. Rooms are used when a tour passes the automatic quality check',
    to: '        unlock in the app once your practice room passes. Apple confirms\n        introductory-offer eligibility for the subscription group. Existing\n        signed offers retain their dates and allowances. Rooms are used\n        when a tour passes the automatic quality check' },
  { note: 'cut: free-month rooms come only from a pack purchase',
    from: '        good enough uses none. More rooms during the free month come\n        only from a pack the account owner chooses to buy. Using the',
    to: '        good enough uses none. Using the' },
  { note: 'stand-in 2: plan rooms, inserted where the public copy names nothing',
    from: '        anniversary, and unused ones do not carry into the next year. Existing Team',
    to: '        anniversary, and unused ones do not carry into the next year. See your\n        plan in the app. Existing Team' },
  { note: 'cut: legacy App Store/card/invoice agreements sentence; re-wrap',
    from: '        <strong>Activating.</strong> New subscriptions start in the app through Apple. Eligible subscribers receive 1 month free with 30 rooms in total, starting on activation. A payment method on the Apple Account is required. Existing signed App Store, card and invoice agreements retain their agreed dates, prices and allowances. No new website subscription or automatic transfer from Apple is offered.',
    to: '        <strong>Activating.</strong> New subscriptions start in the app through\n        Apple. Eligible subscribers receive 1 month free with 30\n        rooms in total, starting on activation. A payment\n        method on the Apple Account is required. No new website subscription or\n        automatic transfer from Apple is offered.' },
  { note: 'stand-in 3: plan prices; cuts Apple renewal wording and the offer link',
    from: '        <strong>Renewal.</strong> The Veylet plan is A$139.99 a month or A$1,399.99 upfront a year through the App Store. Yearly is A$279.89 (16.7%) less than 12 monthly payments. After an eligible trial, the first charge is on the day the free month ends. Apple subscriptions renew automatically at the selected monthly or yearly price unless cancelled through Apple. Apple confirms the local price and exact renewal date before purchase. Existing studio-invoiced agreements follow their written terms and do not auto-renew. Check Settings › Subscriptions or your account. A reminder email 7 days before the first charge is planned but not running yet. Changing a renewal preference does not buy extra capacity or start paid service early. The <a href="/offer">offer page</a> lists the current prices.',
    to: `        <strong>Renewal.</strong> ${STAND_IN} After an eligible\n        trial, the first charge is on the day the free month ends. Existing\n        studio-invoiced agreements follow their written terms and do not\n        auto-renew. Check Settings › Subscriptions or your account. A reminder\n        email 7 days before the first charge is planned but not running yet.\n        Changing a renewal preference does not buy extra capacity or start paid\n        service early.` },
  { note: 're-wrap in Cancelling',
    from: '        including any effect on an introductory offer. For an existing card or invoiced agreement, cancel by email to',
    to: '        including any effect on an introductory offer. For an existing card or\n        invoiced agreement, cancel by email to' },
  { note: 'hosting extension went back into Other work, which the app omits',
    from: 'hosting 14 days after plan ends; hosting extension restored by offer 2026-09-26.2 -->',
    to: 'hosting 14 days after plan ends -->' },
  { note: 'stand-in 4: hosting extension price',
    from: '        the plan brings the same links back at once. To keep a single\n        walkthrough online without a plan, ask us for a hosting extension:\n        A$49 a year per walkthrough.',
    to: `        the plan brings the same links back at once. ${STAND_IN}` },
  { note: 'cut: pack refund rule names a purchase the app does not sell',
    from: '        charge and no walkthrough was accepted in the period it paid for. For a\n        pack, that rule applies only while none of its rooms\n        was used, and a refund removes the pack’s unused rooms. Nothing',
    to: '        charge and no walkthrough was accepted in the period it paid for. Nothing' },
  { note: 'stand-in 5: GST treatment',
    from: '        If GST applies it is included in the price shown, and the receipt states\n        the exact treatment. Apple is the merchant of record for App Store',
    to: `        ${STAND_IN} Apple is the merchant of record for App Store` },
];

/* ---- rendering ------------------------------------------------------------------ */

const innerOf = html => html.match(/<main id="main"[^>]*>([\s\S]*)<\/main>/)[1];

function applyRewrites(html, rules) {
  for (const rule of rules) {
    const count = html.split(rule.from).length - 1;
    if (count !== 1) throw new Error(`app-legal rule matches ${count} times, expected 1: ${rule.note}`);
    html = html.replace(rule.from, () => rule.to);
  }
  return html;
}

function terms() {
  let inner = innerOf(fs.readFileSync(path.join(DIST, 'terms/index.html'), 'utf8'));
  for (const heading of OMITTED_TERMS) {
    const section = new RegExp(`\\s*<h2>${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>\\s*<p>[\\s\\S]*?</p>(?:\\s*<!--[^>]*-->)*`);
    inner = inner.replace(section, '');
  }
  inner = applyRewrites(appLink(runIn(inner)), TERMS_REWRITES);
  const s = shell(SHELL.terms);
  return s.head + inner + s.foot;
}

function privacy() {
  let inner = innerOf(fs.readFileSync(path.join(DIST, 'privacy/index.html'), 'utf8'));
  inner = inner.replace(DRAFT_1110, '').replace(DRAFT_1112, '');
  inner = appLink(runIn(inner)).replace(GOOGLE_LINK, 'Privacy Policy');
  const s = shell(SHELL.privacy);
  return s.head + inner + s.foot;
}

function render() {
  return {
    'app/terms/index.html': terms(),
    'app/privacy/index.html': privacy(),
  };
}

function write() {
  for (const [file, html] of Object.entries(render())) {
    const target = path.join(DIST, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html);
    console.log(`wrote dist/${file}`);
  }
}

module.exports = { render, write, SHELL, STAND_IN, NOTE, OMITTED_TERMS, TERMS_REWRITES };

if (require.main === module) {
  if (process.argv.includes('--write')) write();
  else console.log('Usage: node scripts/app-legal.cjs --write');
}
