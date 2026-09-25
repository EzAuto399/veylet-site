const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const flat = (text) => text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const record = JSON.parse(read('dist/offer/offer.json'));
const plan = record.plans.find((entry) => entry.code === 'solo');
const packs = Object.fromEntries(record.packs.map((pack) => [pack.code, pack]));
const bonus = record.earlyAnnualBonus.walkthroughs;
const bonusExpress = record.earlyAnnualBonus.expressRenders;
const current = Object.fromEntries([
  'dist/offer/index.html', 'dist/start/index.html', 'dist/index.html', 'dist/terms/index.html',
  'dist/account/index.html', 'dist/llms.txt',
].map((file) => [file, flat(read(file))]));
// Changelog entries preserve former decisions; they must not become instructions
// for the next generated campaign or be confused with current capability.
current['.agents/product-marketing.md'] = read('.agents/product-marketing.md').split('## Changelog')[0];
// Packs replace the single extra: their walkthroughs are added only once the pack's payment has settled.
const PACK_PAID_FIRST = /Pack walkthroughs are added once payment has settled/;
const fmt = (n) => 'A$' + n.toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const escape = (s) => s.replace(/[$.*+?()[\]{}|\\^]/g, '\\$&');
const strategy = read('docs/pricing-strategy-20260923.md');
const between = (start, end) => {
  const from = strategy.indexOf(start);
  assert.ok(from >= 0, start);
  return strategy.slice(from, strategy.indexOf(end, from + start.length));
};
const currentTerms = strategy.slice(strategy.indexOf('## The offer we can explain consistently'));

test('the canonical offer is 2026-09-26.1 and separates payment channels and unavailable conversion paths', () => {
  // Offer 2026-09-26.1 changed hosting only (live while a plan is active, offline 14 days after it ends);
  // 2026-09-25.2's prices and allowances stand, and it is kept as the record's history.
  assert.equal(record.version, '2026-09-26.1');
  assert.deepEqual(record.history.map((entry) => [entry.version, entry.replacedBy]), [['2026-09-25.2', '2026-09-26.1']]);
  assert.equal(record.freeMonths.hostingDaysAfterPlanEnds, 14);
  assert.equal('hostingPerWalkthroughPerFurtherYearAud' in record.services, false, 'no further-year hosting on sale');
  assert.equal(record.retiredServices.items.hostingPerWalkthroughPerFurtherYearAud, 49);
  assert.deepEqual(record.plans.map((entry) => [entry.code, entry.name]), [['solo', 'Veylet plan']]);
  assert.deepEqual(record.retiredPlans.codes, ['studio', 'office', 'one', 'founding']);
  assert.deepEqual(record.appStore.sold, ['soloMonthly', 'soloAnnual']);
  assert.equal(record.appStore.annualSoldInApp, true);
  assert.deepEqual(record.appStore.introductoryOffer, { type: 'free_trial', months: 3, oncePerAppleId: true });
  assert.equal(record.freeMonths.months, 3);
  assert.equal(record.freeMonths.includedWalkthroughs, 6);
  // Offer 2026-09-25.2: every channel starts with a payment method on file; renewal stays per channel.
  assert.equal(record.freeMonths.cardRequired, true);
  assert.deepEqual(record.freeMonths.cardOnFile, { required: true,
    appStore: "Apple's 3-month free introductory offer (a payment method on the Apple Account is required)",
    web: "Square card on file at trial start; the first charge is scheduled for the day the free months end (Square Sandbox until the card lane opens)",
    invoice: 'an agreed paid start date in writing' });
  assert.equal(record.freeMonths.autoRenews, null);
  assert.deepEqual(record.freeMonths.autoRenewalByChannel, { appStore: true, websiteCard: true, studioInvoice: false });
  assert.equal(record.freeMonths.earlyPaidSwitchAvailable, false);
  // The reminder has a day count but is not running: every surface says planned.
  assert.equal(record.freeMonths.reminderDaysBeforeFirstCharge, 7);
  assert.match(record.freeMonths.reminderStatus, /^planned: reminder email 7 days before the first charge \(not yet operational\)$/);
  assert.match(record.freeMonths.renewalNotice, /Veylet email reminders are not yet operational/);
  // The practice-room gate is the app's today, not the server's: the record says so in these words.
  assert.equal(record.freeMonths.verification, 'one trial per agency (ABN) and workspace; the app unlocks real captures once the practice room passes (checked in the app, not yet enforced on the server)');
  assert.match(record.freeMonths.paymentSetup, /App Store.*written studio invoice terms/);
  assert.match(record.freeMonths.morePacks, /walkthrough packs can be bought during the free months(?: on the website)?; the free-months end date stays the same/);
  assert.deepEqual({ webAud: plan.webAud, appAud: plan.appAud, includedPerMonth: plan.includedPerMonth, annualAud: plan.annualAud,
    annualAppAud: plan.annualAppAud, annualIncluded: plan.annualIncluded, maxBanked: plan.rollover.maxBanked },
  { webAud: 99, appAud: 119.99, includedPerMonth: 2, annualAud: 990, annualAppAud: 1199.99, annualIncluded: 24, maxBanked: 4 });
  assert.deepEqual([bonus, bonusExpress], [4, 4]);
  assert.deepEqual({ name: record.expressRender.name, webAud: record.expressRender.webAud, appStore: record.expressRender.appStore, dailyCap: record.expressRender.dailyCap },
    { name: 'Super fast render', webAud: 29, appStore: false, dailyCap: null });
  assert.deepEqual(record.processing, { automatic: true,
    turnaround: 'usually within 1–2 hours of the upload finishing; no person checks it',
    qualityGate: 'an automatic quality check (held-out photo match, coverage, floaters, walkable paths, plus an AI visual check once the privacy notice covers it) must pass before the walkthrough appears; otherwise it retries once, then asks for a recapture of the named rooms',
    approval: 'the account reviews and approves before sharing' });
  assert.match(record.anchor.sourceDoc, /^property-3d-studio\/docs\/pricing-and-unit-economics\.md$/);
  assert.equal(record.anchor.checked, '2026-09-13');
  assert.match(record.guarantee.scope, /the account's first accepted walkthrough; the redo is a correction revision \(no unit, same link\); a recapture visit is not included/);
  assert.deepEqual(record.earlyAnnualBonus.channels.sort(), ['appStore', 'invoice', 'web']);
  assert.deepEqual([record.referral.referrerWalkthroughs, record.referral.referredWalkthroughs], [1, 1]);
  assert.match(record.packRules.channels.web, /Square card on \/account \(Sandbox until the card lane opens\) or studio invoice/);
  assert.match(record.packRules.channels.app, /later app version/);
  assert.match(record.packRules.expires, /12 months after purchase/);
  for (const pack of record.packs) assert.equal(pack.validMonths, 12, pack.code);
  // The single extra is gone from the record; packs replace it for new purchases.
  for (const key of ['extraWalkthroughWebAud', 'extraWalkthroughAppAud', 'extraWalkthroughInApp', 'extraAuthorizationRequired']) {
    assert.equal(record.freeMonths[key], undefined, key);
  }
});

test('current sales and onboarding copy cannot restore universal trial, a members-only annual or unsupported delivery promises', () => {
  for (const [file, text] of Object.entries(current)) {
    for (const forbidden of [
      // No studio check, no person checking and no business-hours turnaround (owner decision, 25 September 2026).
      /studio check|a person checks|checked by a person|next business day|2 business hours|5 a day/i,
      /every new account (?:gets|receives|with)|(?:six|3|three) free months for every new account/i,
      // Whole-home counting is by bedrooms, a second dwelling or floor area, never by levels.
      /multi-level[^.]{0,100}count(?:s)? as (?:two|2)/i,
      /app[^.]{0,100}(?:tells you|judges)[^.]{0,100}good enough/i,
      /practice capture the app judges/i,
      /(?:we|Veylet|the website) (?:will )?(?:send|remind)[^.]{0,100}(?:seven|7) days/i,
      /reminder (?:email )?(?:is|was|will be) sent|reminder seven days before the first charge/i,
      /members[ -]only|Members get an annual price|after (?:their|your) first accepted walkthrough/i,
    ]) assert.doesNotMatch(text, forbidden, `${file} must not restore ${forbidden}`);
  }
  for (const file of ['dist/offer/index.html', 'dist/start/index.html', 'dist/index.html', 'dist/account/index.html']) {
    assert.match(current[file], /route checks/i, `${file} identifies the actual app feedback`);
    // Owner decision, 25 September 2026: an automatic quality check assesses capture quality; no person does.
    assert.match(current[file], /automatic(?:ally| quality check) assess(?:es)? capture quality/i,
      `${file} leaves capture-quality assessment with the automatic check`);
    assert.doesNotMatch(current[file], /studio assess(?:es)? capture quality|(?<!no )person checks|checked by a person/i, `${file} puts a person back in the loop`);
  }
  assert.match(current['dist/start/index.html'], /Eligible App Store subscribers.*agreed studio trial/);
  // Only the website annual is stated as months free, and only with the annual named beside it.
  for (const file of ['dist/offer/index.html', 'dist/index.html', 'dist/llms.txt']) {
    for (const match of current[file].matchAll(/[^.]*\b2 months free\b[^.]*/g)) {
      assert.match(match[0], /annual|a year/i, `${file}: months free without the annual: ${match[0]}`);
      assert.doesNotMatch(match[0], new RegExp(`${escape(fmt(plan.annualAppAud))}[^;,]{0,20}2 months free`), `${file}: months free against the App Store price`);
    }
  }
});

test('service units: one accepted walkthrough, a whole home of 5+ bedrooms, a second dwelling or over 350 m² counts as 2', () => {
  assert.equal(record.counting.unit, 'accepted_walkthrough');
  assert.equal(record.counting.notGoodEnoughCounts, false);
  assert.match(record.walkthroughScope.unit, /^one visit to the interior rooms of one home$/);
  assert.match(record.walkthroughScope.countsAsTwo, /^5 or more bedrooms, a second dwelling, or more than 350 m² of floor area$/);
  assert.match(record.walkthroughScope.declaredAt, /new listing; the count locks when capture starts/);
  assert.match(record.packRules.unit, /one accepted walkthrough per pack walkthrough; a capture that is not good enough uses none/);
  for (const file of ['dist/offer/index.html', 'dist/start/index.html', 'dist/terms/index.html', 'dist/llms.txt']) {
    assert.match(current[file], /1 walkthrough is one visit to the interior rooms of one home/, `${file} states the unit`);
    assert.match(current[file], /5 or more bedrooms, a second dwelling or more than 350 m² of floor area counts as 2/, `${file} states the whole-home rule`);
    assert.doesNotMatch(current[file], /One accepted walkthrough uses one allowance unit|scope of larger spaces/i, `${file} keeps the retired one-unit wording`);
  }
  assert.match(current['dist/llms.txt'], /corrections to the same walkthrough do not use a second unit/i);
});

test('human and machine summaries keep renewal and exhausted-trial recovery truthful', () => {
  for (const file of ['dist/start/index.html', 'dist/llms.txt', '.agents/product-marketing.md']) {
    assert.match(current[file], /(?:studio|invoiced|invoice)[^.]{0,140}do(?:es)? not auto-renew/i,
      `${file} must distinguish explicit invoices from Apple renewal`);
  }
  assert.match(current['dist/offer/index.html'], PACK_PAID_FIRST);
  assert.match(current['dist/llms.txt'], /no automatic debt or early paid trial switch/i);
  assert.match(current['.agents/product-marketing.md'], /reminder email 7 days before the first charge is planned/);
  assert.ok(current['.agents/product-marketing.md'].includes(`In-app packs at ${fmt(packs.pack3.appAud)} / ${fmt(packs.pack10.appAud)} are planned for a later app version and are unavailable`));
  assert.doesNotMatch(current['dist/llms.txt'], /plan renews afterwards unless cancelled/);
  // No page or summary offers the retired single extra.
  for (const [file, text] of Object.entries(current)) {
    assert.doesNotMatch(text, /A\$89(?![\d.,])|A\$99\.99|extra walkthrough(?:s)? (?:at|for) A\$/, `${file} offers no single extra`);
  }
});

test('the strategy’s current terms carry this offer and label unit economics as assumptions', () => {
  // Gross ceilings per included walkthrough, from the record: the plan monthly, the annual pool
  // (and its first year with the early bonus) and each pack.
  for (const ceiling of [plan.webAud / plan.includedPerMonth, plan.annualAud / plan.annualIncluded,
    plan.annualAud / (plan.annualIncluded + bonus), ...record.packs.map((pack) => pack.webAud / pack.walkthroughs)]) {
    assert.ok(currentTerms.includes(`A$${ceiling.toFixed(2)}`), `gross revenue ceiling ${ceiling.toFixed(2)} must follow the canonical prices`);
  }
  for (const pack of record.packs) assert.ok(currentTerms.includes(`${fmt(pack.webAud)} / ${pack.walkthroughs}`), `${pack.code} receipts / units`);
  assert.ok(currentTerms.includes(`${fmt(plan.annualAud)} / ${plan.annualIncluded}`) && currentTerms.includes(`${fmt(plan.annualAud)} / ${plan.annualIncluded + bonus}`), 'the annual pool, with and without the bonus');
  // The 10-pack sits below the documented ~A$56 assumption, and the page says so plainly.
  assert.ok(packs.pack10.webAud / packs.pack10.walkthroughs < 56);
  assert.match(currentTerms, /The 10-pack is below the ~A\$56 assumption before any deduction/);
  // Free months reserve the record's six units: A$56 and half an attended hour each.
  const units = record.freeMonths.includedWalkthroughs;
  assert.ok(currentTerms.includes(`The free months reserve six units: **${fmt(units * 56)} and three attended hours per account`));
  assert.ok(currentTerms.includes(`Twelve promised free-months units model **${fmt(2 * units * 56)} and six attended hours**`));
  // The current terms state v9 as current.
  for (const phrase of ['**3 calendar months from activation, 6 accepted walkthroughs total**', 'unused ones roll over, at most 4 banked',
    `**${fmt(plan.webAud)}/month** website price`, `**${fmt(plan.appAud)}/month**`, '**2 accepted walkthroughs per monthly anniversary',
    `**${fmt(plan.annualAud)}/year**`, `**${fmt(plan.annualAppAud)}/year** in the App Store`, '**24 walkthroughs as a yearly pool**',
    `**${bonus} bonus walkthroughs** and ${bonusExpress} express renders`, 'a home with 5 or more bedrooms, a second dwelling or more than 350 m² of floor area counts as 2',
    'a reminder email 7 days before the first charge is planned, not operational', 'with the first charge on the day the free months end and nothing charged if cancelled before then',
    `**Super fast render ${fmt(record.expressRender.webAud)}**`, `"${record.guarantee.text}"`, `"${record.anchor.text}"`]) {
    assert.ok(currentTerms.includes(phrase), `current terms: ${phrase}`);
  }
  assert.doesNotMatch(currentTerms, /Members only|never public|six calendar months|no rollover,|an unsupported two-unit multiplier/, 'no 2026-09-24.2 fact stays current');
  assert.doesNotMatch(currentTerms, /A\$(?:79|94\.99|790|949\.99|158|65\.83|56\.43)(?![\d.,]\d)|at most 3 banked|12 walkthroughs as a yearly pool/, 'no 2026-09-25.1 fact stays current');
  assert.match(currentTerms, /Offer 2026-09-25\.2 puts every included walkthrough below the ~A\$56 assumption before any deduction/);
  assert.match(strategy, /working assumptions, not measured cost/);
  assert.match(strategy, /not contribution margins/);
  assert.match(strategy, /unverified modelling assumption/);
  assert.match(strategy, /two newly admitted accounts/);
  assert.match(strategy, /one active attended delivery at a time/);
  assert.match(strategy, /First accepted walkthrough embedded/);
  assert.match(strategy, /No current WTP interviews, ARPU, renewal rate, CAC or LTV/);
  // Nothing retired for new buyers is a current term.
  assert.doesNotMatch(currentTerms, /A\$(?:189|219\.99|599|6,589|199|89|99\.99|1,890|2,079|157\.50|57\.75|52\.50|869|72\.42)(?![\d.,]\d)/,
    'the current terms and economics carry no retired amount');
  assert.doesNotMatch(currentTerms, /\bSolo\b/);
});

test('the strategy records the 2026-09-25.2 decision on top, with the record’s amounts, counts, the desk’s cents and its boundaries', () => {
  const top = '## Offer 2026-09-25.2 — 25 September 2026';
  const section = between(top, '## Offer 2026-09-25.1');
  assert.ok(section.length > 3000, 'dated decision section exists');
  const at = (heading) => strategy.indexOf(heading);
  assert.ok(at(top) > 0 && at(top) < at('## Offer 2026-09-25.1') && at('## Offer 2026-09-25.1') < at('## Offer 2026-09-24.2')
    && at('## Offer 2026-09-24.2') < at("## Members' annual price") && at("## Members' annual price") < at('## Offer 2026-09-24.1'), 'the newest decision is on top, history kept in order');
  assert.ok(strategy.slice(0, at(top)).includes(`Offer version **${record.version}** is the owner-approved offer`), 'the intro names the current version');
  assert.match(section, /\*\*Decision \(owner-approved, 25 September 2026\)\.\*\* The money model:/);
  assert.match(section, /\| \| 2026-09-25\.1 \| 2026-09-25\.2 \|/);
  assert.match(section, /Build contract: \[offer v9\]\(design\/offer-v9-20260925\.md\)/);
  for (const amount of [plan.webAud, plan.appAud, plan.annualAud, plan.annualAppAud, 12 * plan.webAud - plan.annualAud, record.expressRender.webAud,
    // The 2026-09-25.2 decision stated the further-year hosting price, now retired (offer 2026-09-26.1).
    record.retiredServices.items.hostingPerWalkthroughPerFurtherYearAud, record.services.editingPerHourAud, ...record.packs.map((pack) => pack.webAud),
    plan.webAud / plan.includedPerMonth, plan.annualAud / plan.annualIncluded]) {
    assert.ok(section.includes(fmt(amount)), `decision states ${fmt(amount)}`);
  }
  for (const phrase of ['**3 months with 6 accepted walkthroughs**', '**with a payment method on file**',
    '**The first charge is on the day the free months end; cancelling before then charges nothing.**', '`CreateSubscription` with `start_date` on the free months\' end (day 91)',
    'One trial per agency (ABN) and workspace', '**2 accepted walkthroughs a month**', '**at most 4 banked**', '**24 walkthroughs as a yearly pool**',
    '**4 bonus walkthroughs and 4 express renders** in the first plan year', 'capped at 5 a day', 'refunded automatically if the promise is missed',
    `"${record.anchor.text}"`, `"${record.guarantee.text}"`, 'a correction revision (no unit, same link)', 'checked 13 September 2026',
    'no public outreach until 5 design partners have accepted walkthroughs and given testimonials', 'Packs, referral, whole home and founding are unchanged']) {
    assert.ok(section.includes(phrase), `decision: ${phrase}`);
  }
  // The studio desk's exact invoice totals, in cents, from the record.
  const cents = (n) => String(Math.round(n * 100));
  assert.ok(section.includes(`Veylet plan monthly ${cents(plan.webAud)}; Veylet plan annual ${cents(plan.annualAud)} (one public price, with no tier lookup); `
    + `\`pack3\` ${cents(packs.pack3.webAud)}; \`pack10\` ${cents(packs.pack10.webAud)}; founding referral grant = one \`pack3\` at no charge, at most 4 per founding workspace, audited; `
    + `referral grant = 1 walkthrough to each office, once per referred workspace; the express render (${cents(record.expressRender.webAud)}) is sold by card on the website and is not an invoice item on the desk; `
    + 'the first-walkthrough redo is recorded as a correction with the reason `first_walkthrough_redo`'), 'desk cents');
  for (const key of ['soloMonthly', 'soloAnnual']) {
    const id = record.appStore.productIds[key];
    assert.ok(section.includes(id) || section.includes(id.replace('dev.property3d.capture.', '…')), `names ${id}`);
  }
  assert.match(section, /no further rationale is inferred here/);
  assert.match(section, /These are modelled figures, not measured margins\./);
  assert.match(section, /`supabase\/migrations\/20260925105000_offer_v9\.sql` and the hooks routes `POST \/square\/trial\/start` and `POST \/square\/express\/checkout` do not exist yet/);
  assert.match(section, /Nothing here is released, deployed, submitted to Apple or charged\./);
});

test('the superseded 2026-09-25.1 decision stays on record with its own amounts', () => {
  const section = between('## Offer 2026-09-25.1', '## Offer 2026-09-24.2');
  assert.ok(section.length > 3000);
  assert.match(section, /\*Superseded later on 25 September 2026 by \[Offer 2026-09-25\.2\]\(#offer-2026-09-252--25-september-2026\) above, before release; kept as the dated record of that decision\.\*/);
  assert.match(section, /\*\*Decision \(owner-approved, 25 September 2026\)\.\*\* 3 free months with 6 walkthroughs, then the Veylet plan monthly or annual\./);
  assert.match(section, /Build contract: \[offer v8\]\(design\/offer-v8-20260925\.md\)/);
  for (const amount of ['A$79', 'A$94.99', 'A$790', 'A$949.99', 'A$158', 'A$65.83', 'A$56.43']) assert.ok(section.includes(amount), `2026-09-25.1 record keeps ${amount}`);
  assert.ok(section.includes('Veylet plan monthly 7900; Veylet plan annual 79000 (one public price, with no tier lookup);'), '2026-09-25.1 invoice cents kept');
  assert.match(section, /\*\*unused ones roll over, at most 3 banked\*\*/);
  assert.match(section, /Nothing here is released, deployed, submitted to Apple or charged\./);
});

test('the superseded 2026-09-24.2 decision stays on record with its own amounts', () => {
  const section = between('## Offer 2026-09-24.2', "## Members' annual price");
  assert.ok(section.length > 1500);
  assert.match(section, /\*Superseded on 25 September 2026 by \[Offer 2026-09-25\.1\]/);
  assert.match(section, /\*\*Decision \(owner-approved, 24 September 2026\)\.\*\* One plan and walkthrough packs\./);
  assert.match(section, /\| \| 2026-09-24\.1 \| 2026-09-24\.2 \|/);
  assert.match(section, /\*\*6 months from activation, 6 accepted walkthroughs total\.\*\*/);
  for (const amount of ['A$79', 'A$94.99', 'A$169', 'A$499', 'A$199.99', 'A$589.99', 'A$790', 'A$869', 'A$49']) {
    assert.ok(section.includes(amount), `2026-09-24.2 record keeps ${amount}`);
  }
  assert.ok(section.includes("Veylet plan monthly 7900; members' annual 79000 (`twoMonthsFree`) / 86900 (`oneMonthFree`); `pack3` 16900; `pack10` 49900; "
    + 'founding referral grant = one `pack3` at no charge, at most 4 per founding workspace, audited.'), '2026-09-24.2 invoice cents kept');
  assert.match(section, /The studio sets the tier by hand; there is no minutes rule\./);
  assert.match(section, /\*\*What it earns \(modelled, not measured\)\.\*\*/);
  for (const figure of ['+A$26', '+A$1', 'A$178.80', '+A$55 / −A$20', 'A$528.10', '+A$155 / −A$95', 'A$156 non-labour']) {
    assert.ok(section.includes(figure), `economics state ${figure}`);
  }
  // The documented three-a-month and ten-a-month totals follow that decision's own plan price (A$79) plus 10-pack walkthroughs.
  const perPack10 = packs.pack10.webAud / packs.pack10.walkthroughs;
  assert.equal(fmt(Math.round((79 + 2 * perPack10) * 100) / 100), 'A$178.80');
  assert.equal(fmt(Math.round((79 + 9 * perPack10) * 100) / 100), 'A$528.10');
  assert.match(section, /Nothing here is released, deployed, submitted to Apple or charged\./);
});

test('the superseded 2026-09-24.1 decision stays on record with its own amounts', () => {
  const section = between('## Offer 2026-09-24.1', '## Offer 2026-09-23.4');
  assert.ok(section.length > 500);
  assert.match(section, /\*Superseded later on 24 September 2026 by \[Offer 2026-09-24\.2\]/);
  assert.match(section, /owner-approved, 24 September 2026/);
  assert.match(section, /judged the 2026-09-23\.4 prices too high against do-it-yourself capture apps/);
  assert.match(section, /Matterport US\$14–69 a month/);
  assert.match(section, /Borderland A\$215 for 1–2 bedrooms, checked 13 September 2026/);
  assert.match(section, /Solo about A\$57, Team A\$52, Office A\$53 and founding A\$52/);
  assert.match(section, /\*\*Yearly billing is by studio invoice only; the App Store sells monthly only\.\*\*/);
  for (const amount of ['A$79', 'A$869', 'A$94.99', 'A$189', 'A$2,079', 'A$219.99', 'A$599', 'A$6,589', 'A$199', 'A$89', 'A$99.99']) {
    assert.ok(section.includes(amount), `2026-09-24.1 record keeps ${amount}`);
  }
  for (const text of ['Solo 7900 / 86900', 'Team (`studio`) 18900 / 207900', 'Office 59900 / 658900', 'founding 18900 monthly only', 'One walkthrough 19900 once']) {
    assert.ok(section.includes(text), `2026-09-24.1 invoice cents kept: ${text}`);
  }
});

test('the superseded 2026-09-23.4 decision stays on record with its own amounts', () => {
  const section = between('## Offer 2026-09-23.4', '## Offer 2026-09-23.3');
  assert.ok(section.length > 500, 'dated decision section exists before the older decision');
  assert.match(section, /Superseded by 2026-09-24\.1 above/);
  assert.match(section, /owner-approved, 23 September 2026/);
  assert.match(section, /The owner judged 2026-09-23\.3 too expensive/);
  assert.match(section, /\*\*Solo\*\* lowers the entry to \*\*A\$99 a month\*\*/);
  assert.match(section, /about A\$75 on Solo, A\$70 on Team and A\$67 on Office/);
  assert.match(section, /Proposal, not yet an owner decision/);
  for (const amount of ['A$99', 'A$1,089', 'A$119.99', 'A$1,319.99', 'A$119.89', 'A$249', 'A$2,739', 'A$289.99',
    'A$3,189.99', 'A$289.89', 'A$749', 'A$8,239', 'A$219']) {
    assert.ok(section.includes(amount), `2026-09-23.4 record keeps ${amount}`);
  }
  assert.ok(section.includes('Solo 9900 / 108900') && section.includes('founding 21900 monthly only'), '2026-09-23.4 invoice cents kept');
  // A$99 and A$119.99 are current again (offer 2026-09-25.2, at 2 walkthroughs a month); the rest of 2026-09-23.4 stays out.
  assert.doesNotMatch(currentTerms, /A\$(?:1,089|1,319\.99|119\.89|249|2,739|289\.99|3,189\.99|289\.89|749|8,239|219)(?!\d|[,.]\d)/,
    'the current terms and economics carry no 2026-09-23.4 amount');
});

test('the superseded 2026-09-23.3 decision stays on record with its own amounts', () => {
  const section = between('## Offer 2026-09-23.3', '## The offer we can explain consistently');
  assert.ok(section.length > 500, 'dated decision section exists before the current terms');
  assert.match(section, /Superseded by 2026-09-23\.4 above/);
  assert.match(section, /owner-approved, 23 September 2026/);
  assert.match(section, /A\$56 per accepted walkthrough/);
  assert.match(section, /every 2026-09-23\.2 plan lost money at full use/);
  for (const amount of ['A$299', 'A$3,289', 'A$349.99', 'A$3,849.99', 'A$89', 'A$249', 'A$199', 'A$899', 'A$9,889']) {
    assert.ok(section.includes(amount), `2026-09-23.3 record keeps ${amount}`);
  }
  // "Veylet plan" is the one plan's name again (offer 2026-09-24.2); only its 2026-09-23.3 amounts stay out of the current terms.
  assert.doesNotMatch(currentTerms, /A\$299|A\$3,289|A\$349\.99|A\$3,849\.99|A\$899|A\$9,889|Veylet (?:monthly|annual)\b/,
    'the current terms and economics carry no 2026-09-23.3 amount');
});

test('the members’ annual price decision stays on record, superseded by the one public annual price', () => {
  const members = record.membersAnnual;
  const section = between("## Members' annual price", '## Offer 2026-09-24.1');
  assert.ok(section.length > 500);
  assert.match(section, /\*Superseded on 25 September 2026 by \[Offer 2026-09-25\.1\]/);
  assert.match(section, /\*Amended later on 24 September 2026 by \[Offer 2026-09-24\.2\]/);
  assert.match(section, /owner-approved, 24 September 2026/);
  assert.match(section, /members-annual-offer-20260924\.md/);
  for (const name of ['twoMonthsFree', 'oneMonthFree', 'closed']) assert.ok(section.includes('`' + name + '`'), `names the ${name} tier`);
  assert.ok(section.includes('**A$790/year**') && section.includes('A$869/year'), 'the dated tiers keep their prices');
  assert.match(section, /free months have started and at least one walkthrough is accepted/);
  assert.match(section, /turns off App Store renewal themselves/);
  assert.match(section, /turned back on before that date, the yearly start is paused/);
  // The record now carries one public annual price and keeps the card switch.
  assert.match(members.status, /^the public annual price \(offer 2026-09-25\.2\); the website card switch flow \(Apple renewal off, scheduled start\) is kept for App Store members moving to the website annual$/);
  assert.equal(members.currentTier, 'standard');
  assert.deepEqual(members.tiers, { standard: { planAud: plan.annualAud, monthsCharged: plan.annualAud / plan.webAud } });
  assert.match(members.tierRule, /^one public annual price; scheduled or active annual plans keep the price they were bought at$/);
  assert.deepEqual(members.unlock, { freeMonthsStarted: true, acceptedWalkthroughsAtLeast: 0, checkedBy: 'server, before any checkout or invoice' });
  assert.match(members.switchFromAppStore, /turns off App Store renewal themselves/);
  assert.ok(currentTerms.includes(`${fmt(plan.annualAud)} / ${plan.annualIncluded}`), 'the economics table carries the public annual');
  assert.ok(!currentTerms.includes('A$1,890 / 36') && !currentTerms.includes('A$869 / 12'), 'no Team year or retired tier in the current economics');
});

test('the superseded design notes point to the contract that replaced them and keep their dated content', () => {
  const v8 = read('docs/design/offer-v8-20260925.md').split('\n');
  assert.match(v8[0], /^# Offer v8 \(2026-09-25\.1\)/);
  assert.equal(v8[2], '**Superseded later on 25 September 2026 by offer 2026-09-25.2: see [the v9 build contract](offer-v9-20260925.md); kept as the dated record.**');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs/design/offer-v9-20260925.md')), 'the v9 contract exists');
  for (const file of ['docs/design/members-annual-offer-20260924.md', 'docs/design/one-plan-and-packs-20260924.md']) {
    const doc = read(file);
    const lines = doc.split('\n');
    assert.match(lines[0], /^# /, `${file} keeps its title`);
    assert.equal(lines[2], '**Superseded on 25 September 2026 by offer 2026-09-25.1: see [the v8 build contract](offer-v8-20260925.md); kept as the dated record.**', file);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs/design/offer-v8-20260925.md')), 'the contract it points to exists');
  }
  const spec = read('docs/design/members-annual-offer-20260924.md');
  assert.match(spec, /Amended 24 September 2026 for offer 2026-09-24\.2: Veylet plan only/);
  assert.match(spec, /The studio sets the tier by hand/);
  assert.match(spec, /\*\*Walkthrough packs\*\* card sits between the plan panel and this card/);
  assert.doesNotMatch(spec, /\{TEAM_YEAR\}|A\$1,890 \(two months free\)/);
  const packsContract = read('docs/design/one-plan-and-packs-20260924.md');
  assert.match(packsContract, /# One plan and walkthrough packs — build contract \(offer 2026-09-24\.2\)/);
  assert.match(packsContract, /6 months from activation, \*\*6 accepted walkthroughs total\*\*/);
});

test('the strategy opens with the 25 September automatic-processing note, before the dated offer sections', () => {
  const note = '**Processing and Super fast render (owner decision, 25 September 2026; prices unchanged, still offer 2026-09-25.2).**';
  const at = strategy.indexOf(note);
  assert.ok(at > 0 && at < strategy.indexOf('## Offer 2026-09-25.2 — 25 September 2026'), 'the note sits above the newest offer section');
  const text = strategy.slice(at, strategy.indexOf('\n\n', at));
  for (const phrase of ['There is no studio and no person checking.', 'usually ready for review within 1–2 hours of the upload finishing',
    'An AI visual check is described only as coming once the privacy notice covers it; it does not run now.',
    `**Super fast render** (${fmt(record.expressRender.webAud)}, website only)`, 'ready in about 30 minutes any day and any time',
    'no daily cap and no business hours', '"priority rendering"']) {
    assert.ok(text.includes(phrase), `note: ${phrase}`);
  }
});
