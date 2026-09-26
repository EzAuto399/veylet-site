const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const flat = (text) => text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const record = JSON.parse(read('dist/offer/offer.json'));
const plan = record.plans.find((entry) => entry.code === 'solo');
const bonus = record.earlyAnnualBonus.walkthroughs;
const bonusExpress = record.earlyAnnualBonus.expressRenders;
const current = Object.fromEntries([
  'dist/offer/index.html', 'dist/start/index.html', 'dist/index.html', 'dist/terms/index.html',
  'dist/account/index.html', 'dist/llms.txt',
].map((file) => [file, flat(read(file))]));
// Packs replace the single extra: their walkthroughs are added only once the pack's payment has settled.
const PACK_PAID_FIRST = /Pack walkthroughs are added once payment has settled/;
const fmt = (n) => 'A$' + n.toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const escape = (s) => s.replace(/[$.*+?()[\]{}|\\^]/g, '\\$&');

test('the canonical offer is 2026-09-26.3 and separates payment channels and unavailable conversion paths', () => {
  // Offer 2026-09-26.1 changed hosting only (live while a plan is active, offline 14 days after it ends);
  // 2026-09-26.2 keeps the A$49 hosting extension in a new role (owner, 26 September 2026): after the
  // plan's 14 days it keeps one walkthrough online until the extension ends, on request, by studio invoice,
  // never in the app. 2026-09-26.3 (owner, offer v9.1) counts walkthroughs by rooms, sells Super fast only
  // while fast GPUs start quickly, opens sign-up to anyone and adds a fair-use cap of 12 render attempts
  // to the free months. 2026-09-25.2's prices and allowances stand; every earlier version is history.
  assert.equal(record.version, '2026-09-26.3');
  assert.deepEqual(record.history.map((entry) => [entry.version, entry.replacedBy]),
    [['2026-09-25.2', '2026-09-26.1'], ['2026-09-26.1', '2026-09-26.2'], ['2026-09-26.2', '2026-09-26.3']]);
  assert.deepEqual(record.audience, { who: 'anyone: agents, property managers and freelancers', separateTiers: false,
    rule: 'open sign-up on the same plan and prices for everyone; one trial per ABN and workspace; new accounts are admitted within the weekly admission budget' });
  assert.equal(record.freeMonths.renderAttemptCap, 12);
  assert.equal(record.freeMonths.fairUse.text, 'up to 12 render attempts during the free months, including retries');
  assert.equal(record.freeMonths.fairUse.cap, 'freeMonths.renderAttemptCap');
  assert.match(record.freeMonths.fairUse.kind, /^fair-use line in the terms; an internal cap, not a sold allowance$/);
  assert.equal(record.expressRender.availability, 'only while fast GPUs start quickly');
  assert.equal(record.expressRender.unavailableText, "Super fast isn't available right now");
  assert.match(record.expressRender.availabilityRule, /fast GPUs in Sydney are starting quickly.*nothing is charged/);
  assert.match(record.expressRender.refundPromise, /^unchanged for orders taken: an order already paid keeps the 30-minute promise or is refunded automatically$/);
  assert.equal(record.freeMonths.hostingDaysAfterPlanEnds, 14);
  assert.equal(record.services.hostingPerWalkthroughPerFurtherYearAud, 49, 'the hosting extension is on sale again');
  assert.equal('hostingPerWalkthroughPerFurtherYearAud' in record.retiredServices.items, false);
  const extension = plan.hosting.extension;
  assert.equal(plan.hosting.extensionSold, true);
  assert.deepEqual([extension.priceAud, extension.per, extension.term, extension.channels, extension.surfaces],
    [record.services.hostingPerWalkthroughPerFurtherYearAud, 'walkthrough', 'a year', ['studioInvoice'], ['website']]);
  assert.match(extension.rule, /keeps one walkthrough online after the plan's 14 days, until the extension ends/);
  assert.match(extension.howBought, /on request.*after payment.*card on the website is not built/);
  assert.equal(extension.appStore, 'never sold or mentioned in the app');
  assert.equal(plan.listingExports.included, true);
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
  assert.deepEqual(record.freeMonths.earlyPaidSwitchAvailable, { websiteCard: true, studioInvoice: true, appStore: false });
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
  assert.match(current['dist/start/index.html'], /Eligible App Store subscribers.*agreed invoiced start/);
  // Only the website annual is stated as months free, and only with the annual named beside it.
  for (const file of ['dist/offer/index.html', 'dist/index.html', 'dist/llms.txt']) {
    for (const match of current[file].matchAll(/[^.]*\b2 months free\b[^.]*/g)) {
      assert.match(match[0], /annual|a year/i, `${file}: months free without the annual: ${match[0]}`);
      assert.doesNotMatch(match[0], new RegExp(`${escape(fmt(plan.annualAppAud))}[^;,]{0,20}2 months free`), `${file}: months free against the App Store price`);
    }
  }
});

// Offer 2026-09-26.3: a property is counted by its rooms: up to 8 rooms is 1 walkthrough, each further 8 rooms 1 more.
const ROOMS_RULE = /One walkthrough covers up to 8 rooms of one property, counted automatically from your capture; each further 8 rooms uses one more\./;
const RETIRED_HOME_RULE = /5 or more bedrooms, a second dwelling or more than 350 m² of floor area counts as 2/;

test('service units: one accepted walkthrough; a property is counted by its rooms, 8 rooms a walkthrough', () => {
  assert.equal(record.counting.unit, 'accepted_walkthrough');
  assert.equal(record.counting.notGoodEnoughCounts, false);
  const scope = record.walkthroughScope;
  assert.equal(scope.roomsPerWalkthrough, 8);
  assert.equal(scope.walkthroughs, 'max(1, ceil(rooms / 8))');
  assert.equal(scope.rule, 'up to 8 rooms uses 1 walkthrough; each further 8 rooms uses 1 more');
  assert.match(scope.unit, /^one property: one link and one QR code, counted by the rooms captured$/);
  assert.match(scope.countedBy, /^the app counts the rooms captured; nothing is declared$/);
  assert.match(scope.usesNone, /a correction of the same walkthrough, and a recapture of rooms the quality check names/);
  for (const key of ['countsAsTwo', 'declaredAt']) assert.equal(key in scope, false, `walkthroughScope.${key} is retired`);
  for (const key of ['largeOrMultiLevelMayCountAsTwo', 'largeHomeUnits', 'largeHomeRule']) assert.equal(key in record.counting, false, key);
  assert.equal(record.retiredTerms.items['walkthroughScope.countsAsTwo'], '5 or more bedrooms, a second dwelling, or more than 350 m² of floor area');
  // The rule, as the offer states it: 1 to 8 rooms is 1 walkthrough, 9 to 16 is 2, 17 is 3.
  const walkthroughs = (rooms) => Math.max(1, Math.ceil(rooms / scope.roomsPerWalkthrough));
  assert.deepEqual([0, 1, 8, 9, 16, 17].map(walkthroughs), [1, 1, 1, 2, 2, 3]);
  assert.match(record.packRules.unit, /one accepted walkthrough per pack walkthrough; a capture that is not good enough uses none/);
  assert.match(current['dist/offer/index.html'], ROOMS_RULE, 'the offer page states the rooms rule');
  assert.doesNotMatch(current['dist/offer/index.html'], RETIRED_HOME_RULE, 'the offer page drops the bedroom rule');
  assert.doesNotMatch(current['dist/offer/index.html'], /One accepted walkthrough uses one allowance unit|scope of larger spaces/i);
  assert.match(current['dist/offer/index.html'], /Fair use: up to 12 render attempts during the free months, including retries\./);
  assert.match(current['dist/offer/index.html'], /Super fast is sold only while fast GPUs in Sydney are starting quickly; when they aren’t, your account says “Super fast isn’t available right now” and nothing is charged\./);
  assert.match(current['dist/llms.txt'], /corrections to the same walkthrough do not use a second unit/i);
});

test('the rooms rule reaches /start, /terms and llms.txt, and the bedroom rule it replaces is gone', () => {
  for (const file of ['dist/start/index.html', 'dist/terms/index.html', 'dist/llms.txt']) {
    assert.match(current[file], /up to 8 rooms/i, `${file} states the rooms rule`);
    assert.doesNotMatch(current[file], RETIRED_HOME_RULE, `${file} still states the retired bedroom rule`);
    assert.doesNotMatch(current[file], /One accepted walkthrough uses one allowance unit|scope of larger spaces/i, `${file} keeps the retired one-unit wording`);
  }
});

test('human and machine summaries keep renewal and exhausted-trial recovery truthful', () => {
  for (const file of ['dist/start/index.html', 'dist/llms.txt']) {
    assert.match(current[file], /(?:studio|invoiced|invoice)[^.]{0,140}do(?:es)? not auto-renew/i,
      `${file} must distinguish explicit invoices from Apple renewal`);
  }
  assert.match(current['dist/offer/index.html'], PACK_PAID_FIRST);
  assert.match(current['dist/llms.txt'], /no automatic debt or early paid trial switch/i);
  assert.match(current['dist/offer/index.html'], /A reminder email 7 days before the first charge is planned but not running yet/);
  assert.match(current['dist/llms.txt'], /in the app in a later app version/);
  assert.doesNotMatch(current['dist/llms.txt'], /plan renews afterwards unless cancelled/);
  // No page or summary offers the retired single extra.
  for (const [file, text] of Object.entries(current)) {
    assert.doesNotMatch(text, /A\$89(?![\d.,])|A\$99\.99|extra walkthrough(?:s)? (?:at|for) A\$/, `${file} offers no single extra`);
  }
});

test('the annual move keeps one public price and requires a server eligibility check', () => {
  const members = record.membersAnnual;
  assert.match(members.status, /^the public annual price \(offer 2026-09-25\.2\); the website card switch flow \(Apple renewal off, scheduled start\) is kept for App Store members moving to the website annual$/);
  assert.equal(members.currentTier, 'standard');
  assert.deepEqual(members.tiers, { standard: { planAud: plan.annualAud, monthsCharged: plan.annualAud / plan.webAud } });
  assert.match(members.tierRule, /^one public annual price; scheduled or active annual plans keep the price they were bought at$/);
  assert.deepEqual(members.unlock, { freeMonthsStarted: true, acceptedWalkthroughsAtLeast: 0, checkedBy: 'server, before any checkout or invoice' });
  assert.match(members.switchFromAppStore, /turns off App Store renewal themselves/);
});
