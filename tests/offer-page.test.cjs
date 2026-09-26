const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const distDir = path.join(__dirname, '../dist');
const read = (rel) => fs.readFileSync(path.join(distDir, rel), 'utf8');
const offer = read('offer/index.html');
const body = offer.slice(offer.indexOf('<body'));
const record = JSON.parse(read('offer/offer.json'));
// Offer 2026-09-25.2: 3 free months with 6 walkthroughs and a card on file, then one plan
// (code solo, named "Veylet plan") at 2 a month with rollover up to 4, or annual with a
// yearly pool of 24; the early-annual bonus of 4 walkthroughs and 4 express renders; the
// A$29 express render; the photographer anchor; the first-walkthrough redo; and packs.
// Team, Office, One walkthrough, the single extra and the founding rate stay retired.
const plan = record.plans.find((entry) => entry.code === 'solo');
const pack3 = record.packs.find((entry) => entry.code === 'pack3');
const pack10 = record.packs.find((entry) => entry.code === 'pack10');
const free = record.freeMonths;
const bonus = record.earlyAnnualBonus.walkthroughs;
const bonusExpress = record.earlyAnnualBonus.expressRenders;
const express = record.expressRender;
// Straight and typographic apostrophes are one letter to a reader.
const plain = (value) => value.replace(/’/g, "'");
const banked = plan.rollover.maxBanked;
const founding = record.programmes.founding;
// Offer 2026-09-26.1: hosting follows the plan (14 days after it ends). Offer 2026-09-26.2 keeps the
// A$49 hosting extension, on request, for a single walkthrough after that.
const graceDays = record.freeMonths.hostingDaysAfterPlanEnds;
// Offer 2026-09-26.3 (v9.1): the rooms rule and Super fast's availability, in the offer page's words.
const ROOMS_SENTENCE = 'One walkthrough covers up to 8 rooms of one property, counted automatically from your capture; each further 8 rooms uses one more. '
  + 'Every property gets one link and one QR code. A correction of the same walkthrough, or a recapture of the rooms the quality check names, uses none.';
const SUPER_FAST_AVAILABILITY = 'Super fast is sold only while fast GPUs in Sydney are starting quickly; when they aren’t, your account says “Super fast isn’t available right now” and nothing is charged. An order already paid keeps its promise.';
const hostingYear = record.services.hostingPerWalkthroughPerFurtherYearAud;
const aud = (n) => `A$${n.toLocaleString('en-AU', {
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  maximumFractionDigits: 2,
})}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A$49 may end a sentence or a clause, so the guard rejects a following digit, a
// thousands group and decimals, but not a full stop or a clause comma.
const priceRe = (price, flags) => new RegExp(escape(price) + '(?!\\d|[,.]\\d)', flags);
// Visible text of a fragment: comments and inline tags dropped, whitespace collapsed.
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const cents = (n) => Math.round(Number(n) * 100);
// The first twelve months: monthly pays each paid month after the free months; annual pays
// its year once when the free months end. A pack adds its website price once.
const firstYear = (cadence, bill, pack = 0) =>
  ((cadence === 'annual' ? cents(bill) : cents(bill) * (12 - free.months)) + cents(pack)) / 100;
// "2 months free" is the website annual against 12 website monthly payments.
const monthsFree = 12 - plan.annualAud / plan.webAud;
const saving = 12 * plan.webAud - plan.annualAud;
// What one walkthrough costs when every included one is used: the plan monthly and the annual pool.
const perMonthly = Math.round((plan.webAud / plan.includedPerMonth) * 100) / 100;
const perAnnual = Math.round((plan.annualAud / plan.annualIncluded) * 100) / 100;
const anchorRange = record.anchor.text.match(/A\$\d+–\d+/)[0];
// Published files, skipping third-party code and media.
const walk = (pattern, dir = distDir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['vendor', 'media'].includes(entry.name)) walk(pattern, full, files); }
    else if (pattern.test(entry.name)) files.push(full);
  }
  return files;
};
const rel = (file) => path.relative(distDir, file);
const section = (id, end) => body.slice(body.indexOf(`id="${id}"`), body.indexOf(end, body.indexOf(`id="${id}"`)));
// The five surfaces that restate the offer, as a reader sees them.
const SURFACES = ['offer/index.html', 'index.html', 'start/index.html', 'terms/index.html', 'llms.txt'];
const visible = (page) => {
  const content = read(page);
  return page.endsWith('.txt') ? content.replace(/\s+/g, ' ') : text(content.slice(Math.max(0, content.indexOf('<body'))));
};

test('the canonical record is offer 2026-09-26.3: 3 free months with 6 and a card on file, 2 a month or a pool of 24, express, the anchor, the redo, and packs', () => {
  assert.equal(record.version, '2026-09-26.3');
  assert.equal(record.plans.length, 1, 'one plan for new buyers');
  // The pages spell these facts out, so a change here must change the copy too.
  assert.deepEqual({ code: plan.code, name: plan.name, kind: plan.kind, includedPerMonth: plan.includedPerMonth,
    seats: plan.seats, hostingWhileSubscribed: plan.hostingWhileSubscribed, rollover: plan.rollover.enabled, banked,
    annualAud: plan.annualAud, annualAppAud: plan.annualAppAud, annualIncluded: plan.annualIncluded },
  { code: 'solo', name: 'Veylet plan', kind: 'monthly', includedPerMonth: 2, seats: 'unlimited', hostingWhileSubscribed: true,
    rollover: true, banked: 4, annualAud: 990, annualAppAud: 1199.99, annualIncluded: 24 });
  assert.deepEqual([plan.webAud, plan.appAud], [99, 119.99]);
  assert.deepEqual([perMonthly, perAnnual], [49.5, 41.25], 'A$49.50 and A$41.25 a walkthrough');
  assert.equal(monthsFree, 2, 'the website annual is ten website months');
  assert.deepEqual([free.months, free.includedWalkthroughs, record.counting.freeMonthsAllowanceIsTotal], [3, 6, true]);
  assert.deepEqual([bonus, bonusExpress, record.referral.referrerWalkthroughs, record.referral.referredWalkthroughs], [4, 4, 1, 1]);
  assert.deepEqual({ name: express.name, webAud: express.webAud, appStore: express.appStore, dailyCap: express.dailyCap, channels: express.channels },
    { name: 'Super fast render', webAud: 29, appStore: false, dailyCap: null, channels: ['web'] });
  assert.equal(express.promise, 'rendered on the fastest GPU available in Australia and first in the queue: ready in about 30 minutes, any day, any time, or the A$29 is refunded automatically');
  assert.match(express.refund, /within 30 minutes of the upload finishing, the A\$29 is refunded automatically/);
  // Owner decision, 25 September 2026: processing is automatic; nobody checks a walkthrough by hand.
  assert.equal(record.processing.automatic, true);
  assert.equal(record.processing.turnaround, 'usually within 1–2 hours of the upload finishing; no person checks it');
  assert.match(record.processing.qualityGate, /plus an AI visual check once the privacy notice covers it/);
  assert.equal(record.processing.approval, 'the account reviews and approves before sharing');
  assert.equal(record.counting.acceptedMeans, 'the automatic quality check passed and the workspace approved the exact revision for release');
  assert.equal(record.programmes.founding.perks[0], 'priority rendering');
  assert.deepEqual({ text: record.anchor.text, checked: record.anchor.checked, surfaces: record.anchor.surfaces },
    { text: "A photographer's 3D tour costs A$215–400 each", checked: '2026-09-13', surfaces: ['website'] });
  assert.equal(record.guarantee.text, "If your first walkthrough isn't listing-ready, we redo it free");
  assert.equal(free.cardRequired, true);
  assert.match(free.cardOnFile.web, /Square card on file at trial start; the first charge is scheduled for the day the free months end/);
  // Offer 2026-09-26.3 (v9.1): a property is counted by its rooms, 8 rooms a walkthrough; nothing is declared.
  assert.deepEqual({ unit: record.walkthroughScope.unit, rooms: record.walkthroughScope.roomsPerWalkthrough, countedBy: record.walkthroughScope.countedBy },
    { unit: 'one property: one link and one QR code, counted by the rooms captured', rooms: 8, countedBy: 'the app counts the rooms captured; nothing is declared' });
  assert.equal('countsAsTwo' in record.walkthroughScope, false);
  assert.equal(free.renderAttemptCap, 12);
  assert.equal(express.unavailableText, "Super fast isn't available right now");
  assert.deepEqual({ who: record.audience.who, separateTiers: record.audience.separateTiers }, { who: 'anyone: agents, property managers and freelancers', separateTiers: false });
  assert.deepEqual(record.packs.map(({ code, walkthroughs, validMonths }) => ({ code, walkthroughs, validMonths })),
    [{ code: 'pack3', walkthroughs: 3, validMonths: 12 }, { code: 'pack10', walkthroughs: 10, validMonths: 12 }]);
  assert.match(record.packRules.availableTo, /during the free months or on the plan/);
  assert.match(record.packRules.channels.app, /later app version/);
  assert.match(free.morePacks, /can be bought during the free months(?: on the website)?; the free-months end date stays the same/);
  assert.equal(free.reminderDaysBeforeFirstCharge, 7);
  assert.match(free.reminderStatus, /^planned: .*not yet operational/);
  assert.deepEqual(record.appStore.introductoryOffer, { type: 'free_trial', months: 3, oncePerAppleId: true });
  assert.deepEqual(record.retiredPlans.codes, ['studio', 'office', 'one', 'founding']);
  // Owner decisions 26 September 2026: live while a plan is active, 14 days after it ends; then only a
  // paid hosting extension keeps a single walkthrough online, A$49 a year, on request, never in the app.
  assert.equal(graceDays, 14);
  assert.deepEqual({ days: plan.hosting.daysAfterPlanEnds, sold: plan.hosting.extensionSold }, { days: 14, sold: true });
  assert.equal(hostingYear, 49);
  assert.deepEqual({ price: plan.hosting.extension.priceAud, per: plan.hosting.extension.per, term: plan.hosting.extension.term,
    channels: plan.hosting.extension.channels, surfaces: plan.hosting.extension.surfaces },
  { price: hostingYear, per: 'walkthrough', term: 'a year', channels: ['studioInvoice'], surfaces: ['website'] });
  assert.match(plan.hosting.extension.appStore, /^never sold or mentioned in the app/);
  assert.equal('hostingMinimumMonthsAfterRelease' in record.services, false);
  assert.deepEqual(record.retiredServices.items, { hostingMinimumMonthsAfterRelease: 12 });
  assert.equal(plan.listingExports.included, true);
});

// Every price on the page comes from the canonical record, on its own
// data-price element, and appears exactly as many times as it has keys.
const prices = {
  'plan-month': aud(plan.webAud),
  anchor: anchorRange,
  'anchor-text': anchorRange,
  'anchor-monthly': aud(perMonthly),
  'anchor-monthly-plan': aud(plan.webAud),
  'anchor-annual': aud(perAnnual),
  'anchor-annual-plan': aud(plan.annualAud),
  express: aud(express.webAud),
  'express-refund': aud(express.webAud),
  'answer-express': aud(express.webAud),
  'answer-express-refund': aud(express.webAud),
  'calc-pack': aud(pack3.webAud),
  'first-year': aud(firstYear('monthly', plan.webAud)),
  'terms-pack3': aud(pack3.webAud),
  'terms-pack10': aud(pack10.webAud),
  'hosting-year': aud(hostingYear),
  'pay-plan': aud(plan.webAud),
  'pay-plan-app': aud(plan.appAud),
  'pay-plan-year': aud(plan.annualAud),
  'pay-plan-year-app': aud(plan.annualAppAud),
  'pay-plan-year-saving': aud(saving),
  pack3: aud(pack3.webAud),
  pack10: aud(pack10.webAud),
  editing: aud(record.services.editingPerHourAud),
  'answer-plan-month': aud(plan.webAud),
  'answer-plan-year': aud(plan.annualAud),
  'answer-pack3': aud(pack3.webAud),
  'answer-pack10': aud(pack10.webAud),
  // The worked example states only the plan and the 10-pack, never a derived total.
  'example-2-plan': aud(plan.webAud),
  'example-4-plan': aud(plan.webAud),
  'example-4-pack': aud(pack10.webAud),
  'example-7-plan': aud(plan.webAud),
  'example-7-pack': aud(pack10.webAud),
};

test('every amount on the offer page sits on its own data-price element and equals the canonical amount', () => {
  assert.equal((body.match(/data-price="/g) || []).length, Object.keys(prices).length, 'every price element is checked');
  for (const [key, price] of Object.entries(prices)) {
    assert.equal((body.match(new RegExp(`data-price="${key}"`, 'g')) || []).length, 1, `${key} is unique`);
    assert.match(body, new RegExp(`<span[^>]*\\bdata-price="${key}"[^>]*>${escape(price)}</span>`), key);
  }
  assert.equal(prices['first-year'], 'A$891', 'the no-script first year: 9 monthly payments');
  assert.deepEqual([prices['anchor-monthly'], prices['anchor-annual'], prices.anchor], ['A$49.50', 'A$41.25', 'A$215–400']);
  // Nothing else in the markup states an amount; the free rows carry A$0 on data-amount.
  const rest = body.replace(/<span[^>]*\bdata-price="[^"]+"[^>]*>A\$[\d,.]+(?:–\d+)?<\/span>/g, '')
    .replace(/<dd class="amount" data-amount="0">A\$0<\/dd>/g, '');
  assert.doesNotMatch(rest, /A\$/, 'an amount outside a data-price element');
  // Each amount is set in tabular figures where it sits.
  const css = read('conversion.css');
  for (const rule of ['.amount {', '.offer-price {', '.offer-terms dd [data-price]', '.statement-note [data-price]',
    '.offer-ways .offer-price-note [data-price]', '.offer-scope [data-price]', '.offer-page .guide-section details [data-price]']) {
    const at = css.indexOf(rule);
    assert.ok(at >= 0, rule);
    assert.match(css.slice(at, css.indexOf('}', at)), /font-variant-numeric: tabular-nums/, rule);
  }
});

const formTag = body.match(/<form[^>]*data-statement-form[^>]*>/)[0];
const formData = Object.fromEntries([...formTag.matchAll(/data-([a-z0-9-]+)="([^"]*)"/g)]
  .map(([, name, value]) => [name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));

test('the calculator reads every amount and count from the record, with a native Plan select beside the channel and the pack', () => {
  assert.equal(pack3.validMonths, pack10.validMonths, 'one validity for both packs');
  assert.deepEqual(formData, {
    freeIncluded: String(free.includedWalkthroughs),
    planWebMonth: String(plan.webAud), planAppMonth: String(plan.appAud), planIncluded: String(plan.includedPerMonth),
    planBankedMax: String(banked),
    planWebYear: String(plan.annualAud), planAppYear: String(plan.annualAppAud), planYearIncluded: String(plan.annualIncluded),
    earlyAnnualBonus: String(bonus), earlyAnnualExpress: String(bonusExpress),
    pack3Web: String(pack3.webAud), pack3Walkthroughs: String(pack3.walkthroughs),
    pack10Web: String(pack10.webAud), pack10Walkthroughs: String(pack10.walkthroughs),
    packValidMonths: String(pack3.validMonths),
  });
  const form = body.slice(body.indexOf(formTag), body.indexOf('</form>', body.indexOf(formTag)));
  // Native selects with visible labels and no amount in their options.
  assert.ok(form.includes('<label for="billing-cadence">Plan</label><select id="billing-cadence" name="billing-cadence">'
    + '<option value="monthly">Monthly</option><option value="annual">Annual</option></select>'), 'the Plan select');
  assert.ok(form.includes('<label for="billing-channel">Billed through</label><select id="billing-channel" name="billing-channel">'
    + '<option value="studio">Card or studio invoice</option><option value="apple">App Store</option></select>'), 'the channel select');
  assert.ok(form.includes('<label for="billing-pack">Walkthrough pack</label><select id="billing-pack" name="billing-pack"><option value="none">No pack</option>'
    + `<option value="pack3">Pack of ${pack3.walkthroughs} walkthroughs</option><option value="pack10">Pack of ${pack10.walkthroughs} walkthroughs</option></select>`),
  'an optional pack');
  assert.match(form, /<label for="accepted-on">If you start your free months on<\/label>\s*<input id="accepted-on" name="accepted-on" type="date" aria-describedby="accepted-on-hint">/);
  const order = ['billing-cadence', 'billing-channel', 'billing-pack', 'accepted-on'].map((id) => form.indexOf(`for="${id}"`));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `control order ${order}`);
  assert.doesNotMatch(form, /<option[^>]*>[^<]*A\$/, 'no amount inside an option');
  // Native controls, set at the 44px target by the shared statement rule.
  const css = read('conversion.css');
  const selectRule = css.slice(css.indexOf('.statement-date select {'), css.indexOf('}', css.indexOf('.statement-date select {')));
  assert.match(selectRule, /min-height: 44px/);
  assert.match(css, /\.statement-date select:focus-visible \{ outline: 3px solid/);
});

test('the statement shows 3 A$0 months, the Veylet plan, an optional pack and the first twelve months', () => {
  const lines = body.slice(body.indexOf('data-statement-lines'), body.indexOf('</dl>', body.indexOf('data-statement-lines')));
  assert.match(lines, new RegExp(`^data-statement-lines data-trial-months="${free.months}"`));
  assert.equal((lines.match(/data-free-month="\d"/g) || []).length, free.months);
  assert.equal((body.match(/>A\$0</g) || []).length, 3);
  assert.equal(free.months, 3);
  assert.equal(free.startsOn, 'activation');
  assert.match(lines, /<div data-free-month="3"><dt><span class="line-when" data-line-when>Month 3<\/span><span class="line-what">Free · cancel before it ends and pay nothing<\/span>/);
  assert.match(lines, /<div class="line-paid" data-paid-month><dt><span class="line-when" data-line-when>Month 4 onward<\/span><span class="line-what">Veylet plan<\/span>/);
  assert.match(lines, /<div class="line-pack" data-pack-line hidden>/, 'the pack line waits for a pack');
  assert.ok(lines.includes(`data-pack-what>Pack of ${pack3.walkthroughs} walkthroughs · by card or invoice · valid ${pack3.validMonths} months<`));
  assert.match(lines, /<span class="amount-note">once<\/span>/);
  assert.match(lines, /data-total-caption>3 free months, then 9 monthly payments</);
  assert.ok(lines.indexOf('data-paid-month') < lines.indexOf('data-pack-line') && lines.indexOf('data-pack-line') < lines.indexOf('line-total'));
  const after = body.slice(body.indexOf('</dl>', body.indexOf('data-statement-lines')), body.indexOf('</aside>'));
  // The first charge, said plainly before any allowance: on the day the free months end, and nothing if cancelled first.
  assert.ok(after.includes('<p class="statement-charge" data-statement-charge>Nothing is charged during the free months. The first charge is on the day they end; cancel before then and nothing is charged.</p>'));
  assert.ok(after.indexOf('data-statement-charge') < after.indexOf('data-statement-allowance'));
  assert.ok(after.includes(`data-statement-allowance>${free.includedWalkthroughs} accepted walkthroughs in total during the ${free.months} free months. `
    + `Then ${plan.includedPerMonth} a month on the plan; unused ones roll over, up to ${banked} banked. `
    + `Need more? A pack adds ${pack3.walkthroughs} or ${pack10.walkthroughs} walkthroughs, and you can buy one during the free months. The free-months end date stays the same.<`));
  assert.match(after, /<strong>On the Veylet plan, monthly or annual:<\/strong> every released walkthrough kept live/);
  assert.match(after, /data-billing-explanation>Illustration for the Veylet plan paid monthly by card or studio invoice\. Card payment on this website is coming later, and nothing is charged by this calculator\.</);
  assert.match(after, /<noscript><p class="statement-note">This illustration shows the Veylet plan paid monthly by card or studio invoice, with no pack\. The annual price, the App Store prices, Super fast renders and both walkthrough packs are listed below\.<\/p><\/noscript>/);
  assert.doesNotMatch(body, /data-members-annual/, 'no members’ line');
  assert.match(body, /no client-accepted tour to show yet/);
  assert.match(body, /Prices are totals in Australian dollars/);
});

const { offerTotal } = require('../dist/offer.js');
test('offerTotal: monthly and annual, on either channel, with no pack or one pack', () => {
  // The literal first years this offer publishes, then the same grid read from the record.
  assert.deepEqual(offerTotal({ channel: 'studio', monthly: 99 }), { billCents: 9900, packCents: 0, firstTwelveMonthsCents: 89100 });
  assert.deepEqual(offerTotal({ channel: 'studio', cadence: 'annual', monthly: 99, annual: 990 }), { billCents: 99000, packCents: 0, firstTwelveMonthsCents: 99000 });
  assert.deepEqual(offerTotal({ channel: 'apple', monthly: '119.99' }), { billCents: 11999, packCents: 0, firstTwelveMonthsCents: 107991 });
  assert.deepEqual(offerTotal({ channel: 'apple', cadence: 'annual', annual: '1199.99' }), { billCents: 119999, packCents: 0, firstTwelveMonthsCents: 119999 });
  assert.deepEqual(offerTotal({ channel: 'studio', monthly: 99, packPrice: '169' }), { billCents: 9900, packCents: 16900, firstTwelveMonthsCents: 106000 });
  assert.deepEqual(offerTotal({ channel: 'studio', cadence: 'annual', annual: 990, packPrice: 499 }), { billCents: 99000, packCents: 49900, firstTwelveMonthsCents: 148900 });
  for (const cadence of ['monthly', 'annual']) {
    for (const [channel, monthly, annual] of [['studio', plan.webAud, plan.annualAud], ['apple', plan.appAud, plan.annualAppAud]]) {
      const bill = cadence === 'annual' ? annual : monthly;
      for (const packPrice of [0, pack3.webAud, pack10.webAud]) {
        assert.deepEqual(offerTotal({ channel, cadence, monthly, annual, freeMonths: free.months, packPrice }),
          { billCents: cents(bill), packCents: cents(packPrice), firstTwelveMonthsCents: cents(firstYear(cadence, bill, packPrice)) },
          `${cadence} ${channel} ${packPrice}`);
      }
    }
  }
  // Annual is charged once whatever the free months; monthly pays the months after them.
  assert.equal(offerTotal({ channel: 'studio', cadence: 'annual', annual: 990, freeMonths: 6 }).firstTwelveMonthsCents, 99000);
  assert.equal(offerTotal({ channel: 'studio', monthly: 99, freeMonths: 6 }).firstTwelveMonthsCents, 59400);
  for (const bad of [
    { channel: 'studio', cadence: 'yearly', monthly: 79, annual: 790 },
    { channel: 'studio', cadence: 'annual', monthly: 79 },
    { channel: 'apple', cadence: 'annual', monthly: 94.99, annual: 0 },
    { channel: 'unknown', monthly: 79 },
    { channel: 'studio', monthly: 'bad' },
    { channel: 'studio', monthly: 0 },
    { channel: 'studio', monthly: 79, packPrice: -169 },
    { channel: 'studio', monthly: 79, packPrice: 'bad' },
    { channel: 'studio', monthly: 79, freeMonths: 13 },
    { channel: 'studio', monthly: 79, freeMonths: 2.5 },
  ]) assert.equal(offerTotal(bad), null, JSON.stringify(bad));
});

// Runs the page script against the page's own form inputs, with the three selects as stubs.
const renderCalculator = () => {
  const listeners = {};
  const select = (id, value) => ({ value, addEventListener(type, fn) { (listeners[id] ||= {})[type] = fn; } });
  const cadence = select('cadence', 'monthly');
  const channel = select('channel', 'studio');
  const pack = select('pack', 'none');
  const input = { value: '2026-09-25', addEventListener() {} };
  const form = { dataset: { ...formData }, querySelector: () => input, addEventListener() {} };
  const out = {};
  const nodes = {};
  const node = (key) => ({ set textContent(v) { out[key] = v; }, get textContent() { return out[key] || ''; },
    set hidden(v) { out[`${key}.hidden`] = v; }, get hidden() { return out[`${key}.hidden`]; } });
  const lines = { dataset: { trialMonths: String(free.months) }, querySelectorAll: () => [], querySelector: () => null };
  const document = {
    querySelector: (selector) => ({ '[data-statement-form]': form, '[data-statement-lines]': lines,
      '#billing-cadence': cadence, '#billing-channel': channel, '#billing-pack': pack })[selector] || (nodes[selector] ||= node(selector)),
  };
  vm.runInNewContext(read('offer.js'), { document, Intl, Date, Number, String, Math, RegExp });
  const show = (k, c, p) => { cadence.value = k; channel.value = c; pack.value = p; listeners.cadence.change(); return { ...out }; };
  return { out, show, listeners };
};

test('the calculator states the plan monthly and annual, on each channel, with no pack, a 3-pack or a 10-pack', () => {
  const { out, show, listeners } = renderCalculator();
  // On load (monthly, studio invoice, no pack) the script writes exactly the page's own text.
  const staticText = (attr) => text(body.match(new RegExp(`<[^>]*\\b${attr}\\b[^>]*>([\\s\\S]*?)</(?:p|span)>`))[1]);
  for (const attr of ['data-bill-amount', 'data-bill-cadence', 'data-year-total', 'data-total-caption',
    'data-statement-allowance', 'data-billing-explanation']) {
    assert.equal(out[`[${attr}]`], staticText(attr), `${attr} matches the no-script text`);
  }
  assert.equal(out['[data-pack-line].hidden'], true);
  assert.deepEqual(Object.keys(listeners).sort(), ['cadence', 'channel', 'pack'], 'the plan, the channel and the pack each redraw');
  for (const cadence of ['monthly', 'annual']) {
    const annual = cadence === 'annual';
    for (const [channel, monthly, yearly] of [['studio', plan.webAud, plan.annualAud], ['apple', plan.appAud, plan.annualAppAud]]) {
      const bill = annual ? yearly : monthly;
      const apple = channel === 'apple';
      for (const [code, entry] of [['none', null], ['pack3', pack3], ['pack10', pack10]]) {
        const v = show(cadence, channel, code);
        const label = `${cadence} ${channel} ${code}`;
        assert.equal(v['[data-bill-amount]'], aud(bill), label);
        assert.equal(v['[data-bill-cadence]'], `${annual ? 'a year' : 'a month'} ${apple ? 'in the App Store' : 'by card or invoice'}`, label);
        assert.equal(v['[data-year-total]'], aud(firstYear(cadence, bill, entry ? entry.webAud : 0)), label);
        assert.equal(v['[data-pack-line].hidden'], !entry, label);
        const payments = annual ? `1 yearly ${apple ? 'App Store payment' : 'payment'} for months ${free.months + 1} to ${free.months + 12}`
          : `${12 - free.months} monthly ${apple ? 'App Store payments' : 'payments'}`;
        assert.equal(v['[data-total-caption]'], entry ? `${free.months} free months, ${payments} and the pack` : `${free.months} free months, then ${payments}`, label);
        const allowance = v['[data-statement-allowance]'];
        assert.ok(allowance.startsWith(`${free.includedWalkthroughs} accepted walkthroughs in total during the ${free.months} free months. `), label);
        if (annual) {
          assert.ok(allowance.includes(`Then ${plan.annualIncluded} to use any time in your plan year, with no monthly limit. `
            + `Choose annual before your free months end and get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in your first plan year, ${plan.annualIncluded + bonus} walkthroughs in total.`), label);
        } else {
          assert.ok(allowance.includes(`Then ${plan.includedPerMonth} a month on the plan; unused ones roll over, up to ${banked} banked.`), label);
        }
        assert.match(allowance, /the free-months end date stays the same\.$/i, label);
        if (entry) {
          assert.equal(v['[data-pack-amount]'], aud(entry.webAud), label);
          assert.equal(v['[data-pack-what]'], `Pack of ${entry.walkthroughs} walkthroughs · by card or invoice · valid ${entry.validMonths} months`, label);
          assert.ok(allowance.includes(`The pack adds ${entry.walkthroughs}, used after the included ones and valid ${entry.validMonths} months from purchase.`), label);
        }
        const explanation = v['[data-billing-explanation]'];
        if (apple) {
          assert.ok(explanation.includes(`an eligible ${free.months}-month App Store introductory offer, then ${aud(bill)} each ${annual ? 'year' : 'month'} automatically unless cancelled through Apple`), label);
          assert.equal(explanation.includes('The pack is bought on the website by card or invoice; the app sells packs in a later version.'), !!entry, label);
          assert.doesNotMatch(explanation, /months free/, `${label}: months free is stated only against the website price`);
        } else {
          assert.match(explanation, /Card payment on this website is coming later/, label);
          assert.equal(explanation.includes(`That is ${monthsFree} months free: ${aud(saving)} less than 12 monthly payments.`), annual, label);
        }
        assert.match(explanation, /nothing is charged by this calculator\.$/i, label);
        assert.doesNotMatch(Object.values(v).join(' '), /members|price of eleven|Solo|Team|extra/i, `${label}: no members’ price, retired plan or extra`);
      }
    }
  }
});

test('the statement dates the free months and the paid year from the chosen day, and invents nothing without a date', () => {
  const script = read('offer.js');
  const rows = Array.from({ length: free.months }, (_, i) => ({ dataset: { freeMonth: String(i + 1) }, when: { textContent: '' } }));
  const paidWhen = { textContent: '' };
  const until = { textContent: '' };
  const cadence = { value: 'monthly', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const input = { value: '2026-09-22', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const form = { querySelector: () => input, addEventListener() {} };
  const lines = {
    dataset: { trialMonths: String(free.months) },
    querySelectorAll: () => rows.map((row) => ({ dataset: row.dataset, querySelector: () => row.when })),
    querySelector: () => paidWhen,
  };
  const document = {
    querySelector: (selector) => ({ '[data-statement-form]': form, '[data-statement-lines]': lines, '[data-statement-until]': until,
      '#billing-cadence': cadence })[selector] || null,
  };
  vm.runInNewContext(script, { document, Intl, Date, Number, String, Math, RegExp });
  assert.equal(rows[0].when.textContent, '22 Sept – 21 Oct 2026');
  assert.equal(rows[2].when.textContent, '22 Nov – 21 Dec 2026');
  assert.equal(paidWhen.textContent, 'From 22 Dec 2026');
  assert.equal(until.textContent, 'Illustrated first charge: 22 December 2026, the day your free months end.');
  cadence.value = 'annual';
  cadence.listeners.change();
  assert.equal(paidWhen.textContent, '22 Dec 2026 – 21 Dec 2027', 'the annual covers one year from the first charge');
  assert.equal(until.textContent, 'Illustrated first charge: 22 December 2026, the day your free months end.');
  input.value = '';
  input.listeners.input();
  assert.equal(rows[0].when.textContent, 'Month 1');
  assert.equal(paidWhen.textContent, 'Months 4 to 15');
  assert.equal(until.textContent, '');
  cadence.value = 'monthly';
  cadence.listeners.change();
  assert.equal(paidWhen.textContent, 'Month 4 onward');
  input.value = '2026-08-31';
  input.listeners.change();
  assert.equal(rows[0].when.textContent, '31 Aug – 29 Sept 2026', 'month ends clamp instead of overflowing');
  assert.match(body, /<input id="accepted-on" name="accepted-on" type="date"/);
  assert.match(body, /<span class="line-when" data-line-when>Month 1<\/span>/, 'the no-script rows carry month numbers, not dates');
});

test('what counts: an accepted walkthrough, a whole home, the free months, rollover, the yearly pool, the early bonus, packs, the first-walkthrough redo, seats, hosting, starting with a card on file, the first charge and stopping', () => {
  const counts = section('counts-title', 'id="ways-title"');
  const ledgers = [...counts.matchAll(/<dl class="offer-terms[^"]*">([\s\S]*?)<\/dl>/g)].map((match) =>
    Object.fromEntries([...match[1].matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map(([, dt, dd]) => [text(dt), text(dd)])));
  assert.deepEqual(ledgers.map(Object.keys), [
    ['An accepted walkthrough', 'A whole home', '6 in your free months', '2 a month', '24 a year', '4 more, and 4 Super fast renders, for choosing early', 'Packs'],
    ['Your first walkthrough', 'A capture that is not good enough', 'Seats', 'Hosting', 'Listing videos and photos', 'Starting', 'Before the first charge', 'Stopping'],
  ]);
  const terms = Object.assign({}, ...ledgers);
  assert.match(counts, /<dt><span class="tally">2 a month<\/span><\/dt>/);
  assert.equal(terms['A whole home'], ROOMS_SENTENCE);
  assert.match(terms['6 in your free months'], new RegExp(`^${free.includedWalkthroughs} accepted walkthroughs across the ${free.months} free months in total, not ${free.includedWalkthroughs} a month\\.`));
  assert.equal(terms['2 a month'], `On the monthly plan, ${plan.includedPerMonth} accepted walkthroughs a month, however you are billed. Unused ones roll over, up to ${banked} banked at any time.`);
  assert.equal(terms['24 a year'], `On the annual plan, ${plan.annualIncluded} walkthroughs to use any time in the plan year: a yearly pool with no monthly limit. `
    + 'It resets on each plan-year anniversary, and unused ones do not carry into the next year.');
  assert.equal(terms['4 more, and 4 Super fast renders, for choosing early'], `Choose annual before your free months end and get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in your first plan year: `
    + `${plan.annualIncluded + bonus} walkthroughs in total. Once per workspace, however you pay for the plan. Super fast renders are used on this website.`);
  // Accepted means the automatic check passed and the account approved it; nobody checks by hand.
  assert.equal(terms['An accepted walkthrough'], 'One space, captured with the app, that passed the automatic quality check and that you approved for release. It is the only thing we count.');
  // The guarantee, word for word from the record, with its scope; it is not called a guarantee.
  assert.equal(plain(terms['Your first walkthrough']), `${record.guarantee.text}. The redo corrects your account's first accepted walkthrough on the same link and uses no walkthrough; a new capture visit is not included.`);
  assert.equal(terms.Packs, `A pack of ${pack3.walkthroughs} walkthroughs is ${aud(pack3.webAud)} and a pack of ${pack10.walkthroughs} is ${aud(pack10.webAud)}. `
    + 'The account owner can buy one during the free months or on the plan. Its walkthroughs are used after the ones your free months or plan include, '
    + `and stay valid ${pack3.validMonths} months from purchase. Pack walkthroughs are added once payment has settled: by studio invoice today, `
    + 'or by card in your account once card payment opens.');
  assert.match(terms.Seats, /^Unlimited\. Everyone in your office can capture on the same account\./);
  assert.equal(terms['A capture that is not good enough'], 'Never counted. The automatic quality check retries once, then asks for a recapture of the rooms it names; that attempt costs nothing.');
  assert.equal(terms.Hosting, 'Every released walkthrough stays live while your account has a running plan: the free months, monthly or annual. '
    + `When the plan ends, its links, embeds and QR codes keep working for ${graceDays} days, then go offline. Restart the plan and the same links come back at once. `
    + `To keep a single walkthrough online without a plan, ask us for a hosting extension: ${aud(hostingYear)} a year per walkthrough.`);
  assert.equal(terms['Listing videos and photos'], 'Included in the plan: a landscape listing video, a vertical social video and still photos of each released walkthrough, once video exports open. Files you download are yours to keep.');
  // Starting needs a payment method on file, in each channel's own words.
  assert.ok(terms.Starting.startsWith('Starting needs a payment method on file: Apple’s 3-month free introductory offer in the App Store, a card saved in Square’s card field in your account on this website, or a paid start date agreed in writing for a studio invoice.'));
  assert.ok(terms.Starting.includes(`It provides ${free.months} free months of the Veylet plan with ${free.includedWalkthroughs} walkthroughs, monthly or annual. During them, nothing is charged unless the account owner buys a pack or a Super fast render.`));
  assert.match(terms.Starting, /Card payment on this website is coming later\./);
  assert.ok(terms.Starting.endsWith('One trial per agency (ABN) and workspace; real captures unlock in the app once the practice room passes. '
    + `Fair use: up to ${free.renderAttemptCap} render attempts during the free months, including retries.`));
  assert.equal(terms['Before the first charge'], 'The first charge is on the day your free months end, at the price of the plan you chose. Cancel before then and nothing is charged. '
    + `Your account shows that date and the price. A reminder email ${free.reminderDaysBeforeFirstCharge} days before the first charge is planned but not running yet, so check that date in your account or in your Apple subscription settings.`);
  assert.match(terms.Stopping, /Manage an App Store subscription in Settings › Subscriptions/);
  assert.match(terms.Stopping, /email us to cancel/);
  assert.ok(terms.Stopping.endsWith(`Released walkthroughs stay live for ${graceDays} days after the plan ends, then go offline until you restart it, unless you ask us for a hosting extension for a walkthrough.`));
  assert.equal(free.earlyPaidSwitchAvailable, false);
  assert.equal(free.cardRequired, true, 'every channel starts with a payment method on file');
  assert.equal(record.counting.notGoodEnoughCounts, false);
  assert.doesNotMatch(body, /Larger spaces|one allowance unit|we remind you|cancel[^.]*on your desk/i);
});

test('the plan is one ledger with a monthly and an annual row, then the anchor, express, the packs, the referral line, founding and the fine print', () => {
  const ways = section('ways-title', 'id="services-title"');
  assert.match(body, /<h2 id="ways-title">One plan, monthly or annual\. Super fast renders and packs when you need more\.<\/h2>/);
  assert.ok(ways.includes(`<p class="for-line">The Veylet plan includes ${plan.includedPerMonth} accepted walkthroughs a month, or ${plan.annualIncluded} a year to use any time. `
    + `When you need one fast, add a Super fast render; when you need more, add a pack. Eligible accounts start with ${free.months} free months and ${free.includedWalkthroughs} walkthroughs.</p>`));
  const names = [...ways.slice(0, ways.indexOf('data-offer-example')).matchAll(/<dt>([^<]+)<\/dt>/g)].map((match) => match[1].trim());
  assert.deepEqual(names, ['Veylet plan, monthly', 'Veylet plan, annual', 'A photographer’s 3D tour', 'A Veylet walkthrough, monthly', 'A Veylet walkthrough, annual',
    'Super fast render', `Pack of ${pack3.walkthroughs} walkthroughs`, `Pack of ${pack10.walkthroughs} walkthroughs`]);
  // The plan leads with its two rows; the anchor, express and the packs follow it, so the plan never shares a row with an add-on.
  assert.match(ways, /<div class="offer-plans" data-offer-plans>\s*<dl class="offer-list offer-ways offer-plan" data-offer-plan>\s*<div data-plan-cadence="monthly">[\s\S]*?<div data-plan-cadence="annual">/);
  assert.match(ways, /<\/dl>\s*<div class="offer-anchor" data-offer-anchor>[\s\S]*?<\/div>\s*<dl class="offer-list offer-ways offer-express" data-offer-express>[\s\S]*?<\/dl>\s*<div class="offer-packs">\s*<dl class="offer-list offer-ways" data-offer-packs>/);
  const css = read('conversion.css');
  const rule = (selector) => { const at = css.indexOf(selector + ' {'); assert.ok(at >= 0, selector); return css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.offer-plan > div'), /border-top: 2px solid var\(--ink\)/, 'a 2px ink rule opens the plan');
  assert.match(rule('.offer-plan > div + div'), /border-top: 1px solid var\(--line\)/, 'a hairline divides monthly from annual');
  assert.match(rule('.offer-plan .offer-price'), /font-size: 32px/, 'the plan prices at the statement’s paid-line size');
  assert.match(rule('.offer-example-list .offer-price'), /font-size: 22px/, 'packs and the example at the free rows’ size');
  const monthly = ways.slice(ways.indexOf('data-plan-cadence="monthly"'), ways.indexOf('data-plan-cadence="annual"'));
  const annual = ways.slice(ways.indexOf('data-plan-cadence="annual"'), ways.indexOf('data-offer-packs'));
  assert.match(monthly, /<span class="offer-price" data-price="pay-plan">[^<]+<\/span><span class="offer-price-note">a month<\/span><span class="offer-price-note offer-price-app"><span data-price="pay-plan-app">[^<]+<\/span> a month in the App Store<\/span>/);
  assert.ok(annual.includes(`<span class="offer-price" data-price="pay-plan-year">${aud(plan.annualAud)}</span><span class="offer-price-note">a year, ${monthsFree} months free</span>`
    + `<span class="offer-price-note offer-price-app"><span data-price="pay-plan-year-app">${aud(plan.annualAppAud)}</span> a year in the App Store</span>`), 'the annual row');
  const scope = (row) => text(row.match(/<dd class="offer-scope">([\s\S]*?)<\/dd>/)[1]);
  for (const phrase of [`${plan.includedPerMonth} accepted walkthroughs a month; unused ones roll over, up to ${banked} banked.`,
    'Unlimited seats: everyone in your office captures on one account.', 'every released walkthrough stays live while you subscribe',
    'By studio invoice today, and by card on this website once card payment opens.']) {
    assert.ok(scope(monthly).includes(phrase), phrase);
  }
  assert.equal(scope(annual), `${plan.annualIncluded} walkthroughs to use any time in the plan year: a yearly pool with no monthly limit, reset on each plan-year anniversary, `
    + `with no rollover between years. At ${monthsFree} months free, the annual costs ${aud(saving)} less than 12 monthly payments by card or invoice. `
    + `Choose annual before your free months end and get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in your first plan year, ${plan.annualIncluded + bonus} walkthroughs in total. Everything else is the same as monthly.`);
  // The anchor: the record's sentence with its source and date, beside what one Veylet walkthrough costs.
  const anchor = ways.slice(ways.indexOf('data-offer-anchor'), ways.indexOf('data-offer-express'));
  assert.match(anchor, /<h3 id="anchor-title">What one walkthrough costs\.<\/h3>/);
  const anchorScope = text(anchor.match(/<div data-anchor="photographer">[\s\S]*?<dd class="offer-scope">([\s\S]*?)<\/dd>/)[1]);
  assert.ok(plain(anchorScope).startsWith(record.anchor.text + ', from published prices of Brisbane and Gold Coast 3D tour photographers, checked 13 September 2026.'), anchorScope);
  assert.equal(new Date(record.anchor.checked + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }), '13 September 2026');
  assert.match(anchor, /<a href="\/guides\/3d-tour-cost-australia">What does a 3D tour cost in Australia\?<\/a>/);
  assert.ok(fs.existsSync(path.join(distDir, 'guides/3d-tour-cost-australia/index.html')), 'the source guide exists');
  assert.equal(text(anchor.match(/<div data-anchor="monthly">[\s\S]*?<dd class="offer-scope">([\s\S]*?)<\/dd>/)[1]), `${aud(plan.webAud)} a month for ${plan.includedPerMonth}, when you use both.`);
  assert.equal(text(anchor.match(/<div data-anchor="annual">[\s\S]*?<dd class="offer-scope">([\s\S]*?)<\/dd>/)[1]), `${aud(plan.annualAud)} a year for ${plan.annualIncluded}, when you use all of them.`);
  assert.doesNotMatch(anchor, /cheaper|save|best value|less than/i, 'the figures sit side by side; the page draws no comparison for the reader');
  // Super fast: the price, the 30-minute promise any day, the refund, no daily cap, and never in the app.
  const expressRow = ways.slice(ways.indexOf('data-offer-express'), ways.indexOf('<div class="offer-packs">'));
  assert.ok(expressRow.includes(`<dt>${express.name}</dt>\n<dd><span class="offer-price" data-price="express">${aud(express.webAud)}</span><span class="offer-price-note">a capture, on this website</span></dd>`));
  assert.equal(text(expressRow.match(/<dd class="offer-scope">([\s\S]*?)<\/dd>/)[1]),
    `First in the queue on the fastest GPU available in Australia: ready for your review in about 30 minutes, any day, any time, or we refund it: if it isn’t ready within 30 minutes of the upload finishing, the ${aud(express.webAud)} is refunded automatically. `
    + `Your account offers it when you send a capture. No daily limit and no business hours. ${SUPER_FAST_AVAILABILITY} Not sold in the app.`);
  const packRows = ways.slice(ways.indexOf('data-offer-packs'), ways.indexOf('</dl>', ways.indexOf('data-offer-packs')));
  for (const entry of [pack3, pack10]) {
    assert.ok(packRows.includes(`<dt>Pack of ${entry.walkthroughs} walkthroughs</dt>\n<dd><span class="offer-price" data-price="${entry.code}">${aud(entry.webAud)}</span>`
      + `<span class="offer-price-note">once, valid ${entry.validMonths} months</span><span class="offer-price-note">usable during the free months</span></dd>`), entry.code);
  }
  assert.match(ways, /Pack walkthroughs are used after the ones your free months or plan include\. The account owner buys a pack: by studio invoice today, or by card in your account once card payment opens\./);
  const order = ['data-offer-plans', 'data-offer-anchor', 'data-offer-express', 'data-offer-packs', 'data-offer-example', 'data-offer-referral', 'data-offer-founding', 'App Store and website prices are separate totals']
    .map((marker) => ways.indexOf(marker));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `section order ${order}`);
  assert.equal(record.referral.referrerWalkthroughs, record.referral.referredWalkthroughs, 'both offices get the same');
  assert.ok(ways.includes(`<p class="pilot-note" data-offer-referral><strong>Referrals.</strong> When an office you refer becomes a paying account, `
    + `you each get ${record.referral.referrerWalkthroughs} bonus walkthrough. Share your own link from your account.</p>`));
  assert.match(ways, /The App Store sells the Veylet plan monthly and annual; Super fast renders are sold on this website only, and packs come to the app in a later version\. Card payment on this website is coming later\./);
  // Ledgers, not cards, and no filled action beside the prices: the hero's is the one filled button.
  assert.doesNotMatch(body, /class="[^"]*(?:pricing-card|plan-card)/);
  for (const [id, end] of [['statement-title', '</aside>'], ['counts-title', 'id="ways-title"'], ['ways-title', 'id="services-title"'],
    ['services-title', '</section>'], ['answers-title', '</section>']]) {
    assert.doesNotMatch(section(id, end), /class="button/, `${id} adds no filled button`);
  }
  const main = body.slice(body.indexOf('<main'), body.indexOf('<section class="offer-close"'));
  assert.equal((main.match(/class="button"/g) || []).length, 1, 'one filled action before the closing band');
  assert.match(body, /<a href="#ways-title">Plan, Super fast and packs<\/a>/);
  // The redo promise sits under the one filled action, in the record's words.
  const promise = text(body.match(/<p class="offer-promise" data-offer-redo>([\s\S]*?)<\/p>/)[1]);
  assert.equal(plain(promise), `${record.guarantee.text}. The redo corrects your account's first accepted walkthrough on the same link and uses no walkthrough; a new capture visit is not included.`);
  assert.ok(body.indexOf('offer-actions') < body.indexOf('data-offer-redo') && body.indexOf('data-offer-redo') < body.indexOf('offer-contents'));
  assert.match(body, /Same app, same plan, your client\./);
  assert.equal(record.appStore.annualSoldInApp, true);
  assert.deepEqual(record.appStore.sold, ['soloMonthly', 'soloAnnual']);
});

// What you pay at one, three or six a month on the monthly plan: the plan's one, then the rest
// from a pack of 10. Only amounts in the record are stated; the months a pack lasts are its
// count over the extra walkthroughs a month, and a pack must last no longer than it stays valid.
test('the worked example states what you pay at 2, 4 and 7 a month from the record’s amounts alone', () => {
  const ways = section('ways-title', 'id="services-title"');
  const example = ways.slice(ways.indexOf('data-offer-example'), ways.indexOf('</dl>', ways.indexOf('data-offer-example')));
  assert.match(example, /<h3 id="example-title">What you pay at two, four or seven walkthroughs a month\.<\/h3>/);
  assert.match(text(example), /On the monthly plan, after the free months, at the card or studio invoice price\./, 'the example says which price and when');
  const words = { 2: 'two', 5: 'five' };
  const rows = [...example.matchAll(/<div><dt>(\d+) a month<\/dt>([\s\S]*?)<\/div>/g)];
  assert.deepEqual(rows.map((row) => Number(row[1])), [2, 4, 7]);
  for (const [, count, row] of rows) {
    const perMonth = Number(count);
    const extra = perMonth - plan.includedPerMonth;
    assert.ok(row.includes(`<span class="offer-price" data-price="example-${count}-plan">${aud(plan.webAud)}</span> a month`), `${count}: the plan a month`);
    if (!extra) {
      assert.doesNotMatch(row, /pack/, 'two a month needs no pack');
      assert.match(text(row), /The two walkthroughs the plan includes\./);
      continue;
    }
    const months = pack10.walkthroughs / extra;
    assert.ok(Number.isInteger(months) && months <= pack10.validMonths, `${count}: a pack of 10 lasts ${months} months`);
    const every = { 5: 'five', 2: 'two' }[months];
    assert.ok(row.includes(`<span class="offer-price" data-price="example-${count}-pack">${aud(pack10.webAud)}</span> every ${every} months`), `${count}: the pack and how often`);
    assert.match(text(row), new RegExp(`The plan’s two, and ${words[extra]} a month from a pack of ${pack10.walkthroughs}\\.`));
  }
  // No derived total, per-walkthrough figure or comparison sneaks in.
  const amounts = [...text(example).matchAll(/A\$[\d,.]+/g)].map((match) => match[0]);
  assert.ok(amounts.every((amount) => [aud(plan.webAud), aud(pack10.webAud)].includes(amount)), amounts.join(' '));
  assert.doesNotMatch(text(example), /per walkthrough|each walkthrough costs|saves?|cheaper|best value/i);
});

// The structured answers are the visible answers, word for word.
const faqPairs = (html) => {
  const docs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const faq = docs.flatMap((doc) => doc['@graph'] || [doc]).find((node) => node['@type'] === 'FAQPage');
  return faq.mainEntity.map((question) => [question.name, question.acceptedAnswer.text]);
};
const visibleAnswer = (html, question) => {
  const at = html.indexOf(`<summary>${question}</summary>`);
  assert.ok(at > 0, `visible question: ${question}`);
  return text(html.slice(at).match(/<\/summary>\s*<p>([\s\S]*?)<\/p>/)[1]);
};

test('the straight answers match their structured data word for word, and answer the v9 questions', () => {
  const pairs = faqPairs(offer);
  const answers = section('answers-title', '</section>');
  assert.equal(pairs.length, (answers.match(/<summary>/g) || []).length, 'every visible question is structured, and no more');
  for (const [question, answer] of pairs) assert.equal(visibleAnswer(answers, question), answer, question);
  const byQuestion = Object.fromEntries(pairs);
  assert.ok(!Object.keys(byQuestion).some((question) => /Solo|Team|office plan|four|six/i.test(question)));
  assert.equal(byQuestion[`We need more than ${plan.includedPerMonth} a month. What then?`],
    `Add a walkthrough pack: ${pack3.walkthroughs} walkthroughs for ${aud(pack3.webAud)} or ${pack10.walkthroughs} for ${aud(pack10.webAud)}, `
    + `each valid ${pack3.validMonths} months and used after the ones your plan includes. On the annual plan, the year’s ${plan.annualIncluded} walkthroughs can also go into one busy month. `
    + 'If you expect more than about ten a month, tell us first, and we will say plainly what we can process before you rely on it.');
  const used = byQuestion[`I used my ${free.includedWalkthroughs} free walkthroughs. Do my free months end?`];
  assert.match(used, /^No\. Your free months end on the same date\./);
  assert.match(used, /buy a pack of 3 or 10 walkthroughs: by studio invoice today, or by card in your account once card payment opens\. Packs come to the app in a later version\. Nothing is added or charged automatically/);
  const ends = byQuestion[`What happens when the ${free.months} free months end?`];
  assert.match(ends, /^The plan you chose starts, monthly or annual, and its first charge is on that day\. Cancel before then and nothing is charged\./);
  assert.match(ends, /A card saved in your account on this website is charged on that day unless you cancel first; card payment here is coming later\./);
  assert.match(ends, /A studio-invoiced plan starts on the paid start date agreed in writing\./);
  assert.ok(ends.includes(`A reminder email ${free.reminderDaysBeforeFirstCharge} days before the first charge is planned but not running yet.`));
  assert.ok(ends.includes(`If you stop, they stay live for ${graceDays} days after the plan ends, then go offline until you restart it; a hosting extension, on request, keeps a single walkthrough online. Your account and records stay yours.`), ends);
  assert.equal(byQuestion['Monthly or annual: which should we choose?'],
    `Monthly suits uneven use: ${aud(plan.webAud)} a month for ${plan.includedPerMonth} walkthroughs, and unused ones roll over, up to ${banked} banked. `
    + `Annual suits a steady year: ${aud(plan.annualAud)} a year is ${monthsFree} months free, and its ${plan.annualIncluded} walkthroughs can be used any time in the plan year, so a busy month can use several. `
    + `Choose annual before your free months end and you get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in your first plan year, ${plan.annualIncluded + bonus} walkthroughs in total.`);
  assert.equal(byQuestion['What is a Super fast render?'],
    'Your capture goes first in the queue and is rendered on the fastest GPU available in Australia, so it is ready for your review in about 30 minutes, any day, any time, '
    + `instead of the usual 1–2 hours, for ${aud(express.webAud)}. If it isn’t ready within 30 minutes of the upload finishing, the ${aud(express.webAud)} is refunded automatically. `
    + `There is no daily limit: your account offers it when you send a capture. ${SUPER_FAST_AVAILABILITY} It is sold on this website only, not in the app.`);
  assert.equal(plain(byQuestion['What if our first walkthrough is not good enough to list?']),
    `We redo it free. If your first walkthrough isn't listing-ready, we correct it on the same link, and the redo uses no walkthrough. It covers your account's first accepted walkthrough; a new capture visit is not included.`);
  assert.equal(byQuestion['How many walkthroughs does a property use?'], ROOMS_SENTENCE);
  assert.equal('When does a home count as 2 walkthroughs?' in byQuestion, false);
  assert.match(byQuestion['Why is the App Store price higher?'], /The plan is identical either way/);
  assert.match(byQuestion['What if my capture is not good enough?'], /route checks, but these do not prove capture quality/);
  assert.match(byQuestion['What if my capture is not good enough?'], /an automatic quality check decides: it retries once, then asks for a recapture of the rooms it names/);
  // Privacy: nobody at Veylet looks during normal processing, and the AI visual check is only promised once the notice covers it.
  const privacy = byQuestion['Who checks for private details?'];
  assert.match(privacy, /^You do\. Before capture, clear people, documents, screens and personal photographs/);
  assert.match(privacy, /no one at Veylet views the capture as part of normal processing/);
  assert.match(privacy, /An AI visual check is planned and will be described in the privacy notice before it is switched on\./);
  assert.ok(!('What does the privacy check cover?' in byQuestion));
  // The home page's cost answer is its structured answer too.
  const home = read('index.html');
  assert.equal(visibleAnswer(home, 'What does a walkthrough cost?'), Object.fromEntries(faqPairs(home))['What does a walkthrough cost?']);
  // /start's structured answers are its visible ones.
  const start = read('start/index.html');
  for (const [question, answer] of faqPairs(start)) assert.equal(visibleAnswer(start, question), answer, `/start: ${question}`);
});

test('the offer page head and structured description state this offer', () => {
  const head = offer.slice(0, offer.indexOf('<body'));
  const title = 'Veylet offer and prices: 3 free months, then one plan';
  assert.ok(head.includes(`<title>${title}</title>`) && head.includes(`<meta property="og:title" content="${title}">`));
  const description = `${free.months} free months with ${free.includedWalkthroughs} walkthroughs, then the Veylet plan at ${aud(plan.webAud)} a month or ${aud(plan.annualAud)} a year, with every released tour kept live. Packs for busier months.`;
  assert.ok(head.includes(`<meta name="description" content="${description}">`), 'meta description');
  assert.ok(head.includes(`<meta property="og:description" content="${description}">`), 'og description');
  const docs = [...offer.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const page = docs.flatMap((doc) => doc['@graph'] || [doc]).find((node) => node['@type'] === 'WebPage');
  for (const phrase of [`${free.months} free months with ${free.includedWalkthroughs} walkthroughs included from the day the plan is activated with a payment method on file`,
    'The first charge is on the day the free months end, and cancelling before then charges nothing.',
    `${aud(plan.webAud)} a month by card or studio invoice or ${aud(plan.appAud)} a month in the App Store`, `up to ${banked} banked`,
    `${aud(plan.annualAud)} a year by card or studio invoice or ${aud(plan.annualAppAud)} a year in the App Store`,
    `${plan.annualIncluded} walkthroughs to use any time in the plan year`, `A Super fast render, sold while fast GPUs are starting quickly, is ready in about 30 minutes, any day, any time, for ${aud(express.webAud)}, or refunded.`,
    'processed and quality-checked automatically, ready for your review usually within 1–2 hours of the upload finishing',
    'If your first walkthrough isn’t listing-ready, we redo it free.']) {
    assert.ok(page.description.includes(phrase), `WebPage description: ${phrase}`);
  }
  assert.doesNotMatch(head, /six free months|six walkthroughs/i);
});

test('unavailable in-person work is absent from the public offer and enquiry choices', () => {
  assert.equal(record.services.visitCompactAud, undefined);
  assert.equal(record.services.visitStandardAud, undefined);
  assert.equal(record.services.whiteGloveAud, undefined);
  assert.doesNotMatch(body, /data-price="(?:visit|visit-standard|white-glove)"|white-glove/i);
  assert.doesNotMatch(body, /A\$690|A\$170|A\$230/);
  assert.match(body, /In-person capture and office visits are not currently offered/);
  const request = read('request/index.html');
  const start = read('start/index.html');
  assert.doesNotMatch(request, /capture_route" value="visit"|ask for a studio visit/i);
  assert.doesNotMatch(start, /request\?capture=visit|Ask us to capture it/i);
  assert.match(start, /request\?capture=unsure/);
});

test('the offer page makes no claim the product cannot back', () => {
  for (const banned of [/certified/i, /guarantee/i, /listing on realestate\.com\.au included/i, /captured by us/i,
    /six months on us/i, /per accepted walkthrough/i, /Office plan|Group plan/, /never an automatic charge/i, /most popular/i,
    /no card to start/i, /limited time|only \d+ left|hurry/i, /cheaper than|less than (?:one|a) photographer|Matterport/i,
    /best value|better value|unlimited walkthroughs|save \d+%/i]) {
    assert.equal((body.match(banned) || []).length, 0, `offer page must not say ${banned}`);
  }
  assert.ok(/Not included[\s\S]*unlimited revisions/.test(body) && (body.match(/unlimited revisions/g) || []).length === 1);
  assert.match(body, /Not yet\. REA shows tours only from its supported suppliers/);
  assert.match(body, /tenant as well as the owner/);
  assert.match(body, /iPhone 12 Pro and later Pro or Pro Max models/);
  assert.match(body, /If you expect more than about ten a month, tell us first, and we will say plainly what we can process/);
  // Owner decision, 25 September 2026: no studio or person checks a walkthrough, and no business-hours promise.
  assert.doesNotMatch(body, /studio check|person checks|checked by a person|by hand|(?<!no )business (?:day|hour)|a day, and your account says/i);
  assert.doesNotMatch(body, /AI visual check (?:runs|is on|checks)/i, 'the AI visual check is only ever described as planned');
  assert.doesNotMatch(body, /class="eyebrow"/, 'the headings carry their own weight');
  // No card is taken on this website, on this page or anywhere in its markup.
  assert.doesNotMatch(body, /autocomplete="cc-|card number|cardholder|cvc/i);
});

test('every marketing page links to the offer in its header and footer, and the offer is in the sitemap', () => {
  for (const page of ['index.html', 'request/index.html', 'apply/index.html', 'start/index.html', 'thanks/index.html', 'account/index.html', 'website-guide/index.html', 'privacy/index.html', 'terms/index.html', 'support/index.html', '404.html', 'offer/index.html']) {
    const html = read(page);
    assert.match(html, /<nav aria-label="Main">[\s\S]*?href="\/offer"/, `${page} header links to the offer`);
    assert.match(html, /<nav aria-label="Footer">[\s\S]*?href="\/offer"/, `${page} footer links to the offer`);
  }
  for (const page of ['handoff/index.html', 'embed/index.html', 'play/index.html']) {
    assert.doesNotMatch(read(page), /href="\/offer"/, `${page} is a tour surface and carries no sales navigation`);
  }
  assert.match(read('sitemap.xml'), /https:\/\/veylet\.com\/offer/);
  assert.match(read('llms.txt'), /veylet\.com\/offer/);
  assert.match(read('llms.txt'), /3 free months with 6 accepted walkthroughs/);
  const home = read('index.html');
  assert.match(home, /3 free months with 6 walkthroughs/);
  assert.match(home, priceRe(`${aud(plan.webAud)} a month`));
  assert.match(home, /then the Veylet plan/);
  assert.doesNotMatch(home, /then Solo or Team/);
});

test('the pages that repeat the offer repeat this version of it', () => {
  for (const page of SURFACES) {
    const flat = read(page).replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /never an automatic charge/i, `${page} withdraws the no-automatic-charge line`);
    assert.doesNotMatch(flat, /free months (?:begin|start) the day (?:its|your) first walkthrough is accepted/i,
      `${page} dates the free months from activation`);
    assert.match(flat, new RegExp(`${free.months} free months with ${free.includedWalkthroughs} (?:accepted )?walkthroughs`), `${page} states the 3 free months with 6`);
    assert.doesNotMatch(flat, /\bsix (?:free )?months\b|\bsix-month\b|\b6 (?:free )?months\b|six (?:free |accepted )?walkthroughs(?! a month)|Month [5-7]\b/i,
      `${page} keeps a 2026-09-24.2 free-months fact`);
  }
  // No public page keeps the former allowance of four.
  for (const file of walk(/\.(?:html|txt)$/)) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8').replace(/\s+/g, ' '), /four walkthroughs|(?<![\d+])4 walkthroughs|four accepted/i,
      `${rel(file)} states the former four`);
  }
  assert.match(read('llms.txt'), priceRe(aud(plan.appAud)), 'llms.txt states the App Store price it is asked about');
});

// A price is one string wherever it appears: the same amount beside the same words on the
// offer page, the home page, /start, /terms and llms.txt, and no public page pairs those
// words with a different amount.
const PRICE = {
  month: aud(plan.webAud), monthApp: aud(plan.appAud), year: aud(plan.annualAud), yearApp: aud(plan.annualAppAud),
  pack3: aud(pack3.webAud), pack10: aud(pack10.webAud),
};
// Express is sold on the website only; the pages that price it say the same A$29 everywhere.
const EXPRESS = aud(express.webAud);
const priceClaims = (flat) => {
  const found = [];
  const add = (re, allowed, what) => { for (const match of flat.matchAll(re)) found.push({ amount: match.slice(1).find(Boolean), allowed, what, at: match[0] }); };
  add(/(A\$[\d,.]*\d) a month\b/g, [PRICE.month, PRICE.monthApp], 'a month');
  add(/(A\$[\d,.]*\d) a month in the App Store/g, [PRICE.monthApp], 'a month in the App Store');
  add(/(A\$[\d,.]*\d) a month by studio invoice/g, [PRICE.month], 'a month by studio invoice');
  add(/(A\$[\d,.]*\d) a year\b(?! per walkthrough)/g, [PRICE.year, PRICE.yearApp], 'a year');
  add(/(A\$[\d,.]*\d) a year in the App Store/g, [PRICE.yearApp], 'a year in the App Store');
  add(/(A\$[\d,.]*\d) a year by studio invoice/g, [PRICE.year], 'a year by studio invoice');
  add(/(A\$[\d,.]*\d) a month by card or (?:studio )?invoice/g, [PRICE.month], 'a month by card or invoice');
  add(/(A\$[\d,.]*\d) a year by card or (?:studio )?invoice/g, [PRICE.year], 'a year by card or invoice');
  add(/(?:express|Super fast) render (?:is |at |for )?(A\$[\d,.]*\d)|(A\$[\d,.]*\d) a capture/gi, [EXPRESS], 'a Super fast render');
  add(/the (A\$[\d,.]*\d) is refunded/g, [EXPRESS], 'the express refund');
  add(/(A\$[\d,.]*\d)(?: on the monthly plan)? \(A\$99 for 2\)|(A\$[\d,.]*\d)(?: each)? on the monthly/g, [aud(perMonthly)], 'one walkthrough, monthly');
  add(/(A\$[\d,.]*\d)(?: each)? on the annual/g, [aud(perAnnual)], 'one walkthrough, annual');
  add(/(A\$[\d,.]*\d) a year per walkthrough/g, [aud(hostingYear)], 'hosting extension, a year');
  add(/photographer's 3D tour costs (A\$\d+–\d+)|photographer’s 3D tour costs (A\$\d+–\d+)/g, [anchorRange], 'the anchor');
  for (const entry of record.packs) {
    add(new RegExp(`\\b${entry.walkthroughs}(?: walkthroughs)? (?:for|is|\\() ?(A\\$[\\d,.]*\\d)`, 'g'), [aud(entry.webAud)], `pack of ${entry.walkthroughs}`);
  }
  add(/(A\$[\d,.]*\d) less than 12 monthly/g, [aud(saving)], 'the annual saving');
  return found;
};

test('truth check: every plan, annual and pack price reads the same string on /offer, /, /start, /terms and llms.txt, and nowhere with a different value', () => {
  const required = {
    'offer/index.html': Object.values(PRICE), 'index.html': Object.values(PRICE), 'terms/index.html': Object.values(PRICE),
    'llms.txt': Object.values(PRICE), 'start/index.html': [PRICE.month, PRICE.year],
  };
  for (const page of ['offer/index.html', 'index.html', 'terms/index.html', 'llms.txt']) required[page].push(EXPRESS);
  for (const page of ['offer/index.html', 'llms.txt']) required[page].push(aud(perMonthly), aud(perAnnual), anchorRange);
  for (const page of SURFACES) {
    const flat = visible(page);
    for (const price of required[page]) assert.match(flat, priceRe(price), `${page} states ${price}`);
    // One spelling: no bare dollar sign, spaced symbol, AUD prefix or trailing zeros on a Veylet price.
    assert.doesNotMatch(flat, /A\$\s\d|\bAUD\s?\$?\d|(?<![A-Z])\$(?:99|119\.99|990|1,199\.99|169|499|29)(?![\d])|A\$\d+\.\d{3}|A\$(?:99|990|169|499|29)\.00\b/,
      `${page} spells a price another way`);
  }
  const pages = walk(/\.(?:html|txt)$/).filter((file) => !/[\\/](?:account|studio)[\\/]/.test(file));
  assert.ok(pages.length > 15);
  let checked = 0;
  for (const file of pages) {
    const page = rel(file);
    for (const claim of priceClaims(visible(page))) {
      checked += 1;
      assert.ok(claim.allowed.includes(claim.amount), `${page}: "${claim.at}" (${claim.what}) should read ${claim.allowed.join(' or ')}`);
    }
  }
  assert.ok(checked > 30, `the truth check read ${checked} priced phrases`);
  // The derived first-year totals the statement can show come from the same record.
  assert.deepEqual([firstYear('monthly', plan.webAud), firstYear('monthly', plan.appAud), firstYear('annual', plan.annualAud), firstYear('annual', plan.annualAppAud)],
    [891, 1079.91, 990, 1199.99]);
});

test('the rooms rule is stated on /offer, /start, /terms and llms.txt, and the whole-home and one-unit rules it replaces are gone', () => {
  // Offer 2026-09-26.3: up to 8 rooms of one property is 1 walkthrough, counted from the capture; nothing is declared.
  for (const page of ['offer/index.html', 'start/index.html', 'terms/index.html', 'llms.txt']) {
    const flat = visible(page);
    assert.match(flat, /up to 8 rooms of one property/i, `${page} states the rooms rule`);
    assert.match(flat, /each further 8 rooms/i, `${page} says what further rooms use`);
    assert.doesNotMatch(flat, /5 or more bedrooms|more than 350 m²|second dwelling/i, `${page} keeps the retired whole-home rule`);
    assert.doesNotMatch(flat, /count locks when capture starts|declare it when you add the listing/i, `${page} keeps the retired declaration`);
    assert.doesNotMatch(flat, /One accepted walkthrough uses one allowance unit|agrees the scope of larger spaces|larger-space scope/i, `${page} keeps the retired one-unit rule`);
  }
});

test('the reminder email is planned, never claimed as sent, on every public page', () => {
  assert.match(record.freeMonths.renewalNotice, /Veylet email reminders are not yet operational/);
  let mentions = 0;
  for (const file of walk(/\.(?:html|txt)$/)) {
    const flat = visible(rel(file));
    for (const sentence of flat.split(/(?<=[.!?])\s+/).filter((s) => /remind/i.test(s))) {
      mentions += 1;
      assert.match(sentence, /planned/i, `${rel(file)}: a reminder that is not marked planned: ${sentence}`);
      assert.doesNotMatch(sentence, /(?:we|Veylet) (?:will )?(?:send|email)|is sent|will be sent|we remind you|reminds? you/i, `${rel(file)}: ${sentence}`);
    }
  }
  assert.ok(mentions >= 4, `the planned reminder is stated (${mentions} mentions)`);
  for (const page of ['offer/index.html', 'terms/index.html', 'llms.txt']) {
    assert.ok(visible(page).includes(`A reminder email ${free.reminderDaysBeforeFirstCharge} days before the first charge is planned but not running yet`), page);
  }
});

test('no public page gates the annual behind membership', () => {
  assert.match(record.membersAnnual.visibility, /^annual is public on \/offer/);
  assert.equal(record.membersAnnual.unlock.acceptedWalkthroughsAtLeast, 0);
  assert.deepEqual(Object.keys(record.membersAnnual.tiers), ['standard']);
  assert.equal(record.membersAnnual.tiers.standard.planAud, plan.annualAud);
  const gating = /members[ -]only|Members get an annual price|annual price in (?:their|your) account|after (?:their|your) first accepted walkthrough|never (?:on )?a public page|members[’'] annual|members’ price/i;
  for (const file of walk(/\.(?:html|txt)$/)) {
    assert.doesNotMatch(visible(rel(file)), gating, `${rel(file)} gates the annual`);
  }
  // The retired one-month-free tier and the 2026-09-24.2 first-year totals are published nowhere.
  for (const file of walk(/\.(?:html|js|txt|css)$/)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const amount of ['A$869', 'A$72.42', 'A$474', 'A$643', 'A$973', 'A$569.94', 'A$738.94', 'A$1,068.94']) {
      assert.doesNotMatch(content, priceRe(amount), `${rel(file)} states ${amount}`);
    }
  }
});

test('the terms state the free months, the plan’s walkthroughs, referrals, the whole home, packs, renewal and hosting', () => {
  const terms = read('terms/index.html').replace(/\s+/g, ' ');
  for (const phrase of [
    'Last updated 25 September 2026',
    `An eligible new account gets ${free.months} free months with ${free.includedWalkthroughs} accepted walkthroughs included across them, on the Veylet plan monthly or annual.`,
    'There is one trial per agency (ABN) and workspace, and real captures unlock in the app once your practice room passes.',
    'Starting them needs a payment method on file.',
    'The first charge is on the day they end, at the price of the plan you chose; if you cancel before then, nothing is charged.',
    'More walkthroughs during the free months come only from a walkthrough pack the account owner chooses to buy.',
    `the Veylet plan monthly includes ${plan.includedPerMonth} accepted walkthroughs per monthly allowance window; unused ones roll over, up to ${banked} banked at any time.`,
    `The Veylet plan annual includes ${plan.annualIncluded} accepted walkthroughs to use any time in the plan year, with no monthly limit; the pool resets on each plan-year anniversary, and unused ones do not carry into the next year.`,
    `If you choose annual before your free months end, your first plan year includes ${bonus} bonus walkthroughs, ${plan.annualIncluded + bonus} in total, and ${bonusExpress} Super fast renders, once per workspace; Super fast renders are used on this website.`,
    // The first-walkthrough redo, in the record's words and scope, beside the Australian Consumer Law.
    'If your first walkthrough isn’t listing-ready, we redo it free. This covers your account’s first accepted walkthrough: the redo is a correction on the same link and uses no walkthrough. A new capture visit is not included. This promise is in addition to your rights under the Australian Consumer Law.',
    // Super fast: price, promise, refund, no daily cap and the channel.
    `ask for a Super fast render of a capture that has been sent, for ${EXPRESS} or one Super fast render from the early-annual bonus.`,
    'It goes first in the queue on the fastest GPU available in Australia and is ready for review in about 30 minutes, any day and any time.',
    `If it is not ready within 30 minutes of the upload finishing, the ${EXPRESS} is refunded automatically, or the Super fast render is returned. There is no daily limit.`,
    'Super fast renders are not sold in the app.',
    'A walkthrough counts as accepted when the automatic quality check passed and your account approved that exact revision;',
    'Veylet never sees or stores your card number.',
    'Existing Team or Office plans keep their agreed allowance.',
    `When an office you refer becomes a paying account, your account and theirs each get ${record.referral.referrerWalkthroughs} bonus walkthrough.`,
    `The account owner can buy a pack of ${pack3.walkthroughs} or ${pack10.walkthroughs} walkthroughs, during the free months or on the plan`,
    `used only after the walkthroughs your free months or plan include, and they expire ${pack3.validMonths} months after purchase; walkthroughs unused by then are not refunded.`,
    'For a walkthrough pack, that rule applies only while none of its walkthroughs was used, and a refund removes the pack’s unused walkthroughs.',
    `The Veylet plan is ${PRICE.month} a month or ${PRICE.year} a year by card or studio invoice, and ${PRICE.monthApp} a month or ${PRICE.yearApp} a year in the App Store.`,
    'The first charge is on the day your free months end; a card saved on this website is charged that day and then each month, or each year if you chose annual, until you cancel.',
    'renews automatically each month after its introductory offer at the monthly price shown by Apple before purchase, or each year at the annual price if you chose annual',
    'The App Store sells the Veylet plan monthly and annual.',
    'an annual invoice is charged in full',
    'Every released walkthrough stays live while your account has a running plan (free months, monthly or annual).',
    'When the plan ends, its link, embed and QR code keep working for 14 days, then go offline; they are not deleted or revoked, and restarting the plan brings the same links back at once.',
    'deletion ends hosting at once, without the 14 days that follow the end of a plan.',
    'To keep a single walkthrough online without a plan, ask us for a hosting extension: A$49 a year per walkthrough.',
    'Editing and hosting extensions are priced on the <a href="/offer">offer page</a>.',
    'Card payment on this website is coming later',
  ]) assert.ok(terms.includes(phrase), `the terms say: ${phrase}`);
  assert.doesNotMatch(terms, /monthly only|including when you pay yearly|Unused allowance does not carry over/);
  assert.doesNotMatch(terms, /studio check|(?<!no )business (?:day|hour)|express render|at most \d+ a day/i);
});

test('no page promises an App Store product or a website card payment that does not exist', () => {
  const surfaces = { 'offer/index.html': body, 'llms.txt': read('llms.txt'), 'offer/offer.json': read('offer/offer.json'),
    'index.html': read('index.html'), 'start/index.html': read('start/index.html'), 'terms/index.html': read('terms/index.html') };
  for (const [page, content] of Object.entries(surfaces)) {
    const flat = content.replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /A\$409\.99|A\$179\.99|409\.99|179\.99/, `${page} states no App Store price for Office or One walkthrough`);
    assert.doesNotMatch(flat, /on the website with a card|a card on the website|in the app or here/i, `${page} does not promise card payment on the website`);
  }
  // App Store pack prices wait for a later app version and are published nowhere.
  for (const file of walk(/\.(?:html|js|txt|css)$/)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const entry of record.packs) {
      assert.doesNotMatch(content, priceRe(aud(entry.appAud)), `${rel(file)} publishes the App Store ${entry.code} price`);
    }
  }
  assert.match(record.freeMonths.activationMeans, /card payment on the website is coming later/);
  assert.match(body, /packs come to the app in a later version/);
  assert.match(read('llms.txt'), /in the app in a later app version/);
});

// Every amount a reader sees must trace to the canonical record: the plan monthly and annual on
// both channels, the annual saving, the pack website prices, the hosting extension, editing and the derived
// first-year totals.
const canonicalAmounts = () => {
  // Offer 2026-09-25.2 adds express, one walkthrough's cost on each plan when every one is used, and the
  // photographer anchor's own low end (the page writes it as a range, A$215–400).
  const amounts = [0, plan.webAud, plan.appAud, plan.annualAud, plan.annualAppAud, saving, hostingYear,
    record.services.editingPerHourAud, ...record.packs.map((entry) => entry.webAud), express.webAud, perMonthly, perAnnual,
    Number(anchorRange.match(/\d+/)[0])];
  for (const [cadence, bill] of [['monthly', plan.webAud], ['monthly', plan.appAud], ['annual', plan.annualAud], ['annual', plan.annualAppAud]]) {
    for (const packPrice of [0, ...record.packs.map((entry) => entry.webAud)]) amounts.push(firstYear(cadence, bill, packPrice));
  }
  return new Set(amounts.map(aud));
};

test('every amount on the offer page, home page, /start, /terms and llms.txt is a canonical offer amount', () => {
  const allowed = canonicalAmounts();
  for (const amount of ['A$891', 'A$1,060', 'A$1,390', 'A$1,079.91', 'A$990', 'A$1,159', 'A$1,489', 'A$1,199.99', 'A$198', 'A$29', 'A$49.50', 'A$41.25', 'A$215']) {
    assert.ok(allowed.has(amount), `derived amount ${amount}`);
  }
  for (const page of SURFACES) {
    const found = [...read(page).matchAll(/A\$\d{1,3}(?:,\d{3})*(?:\.\d\d)?/g)].map((match) => match[0]);
    assert.ok(found.length > 0, page);
    for (const amount of found) assert.ok(allowed.has(amount), `${page} states ${amount}, which is not in offer.json`);
  }
  const home = read('index.html');
  assert.ok(home.includes(`Monthly is ${aud(plan.webAud)} a month by card or studio invoice, or ${aud(plan.appAud)} a month in the App Store, with ${plan.includedPerMonth} accepted walkthroughs a month; unused ones roll over, up to ${banked} banked`));
  assert.ok(home.includes(`Annual is ${aud(plan.annualAud)} a year by card or studio invoice (${monthsFree} months free), or ${aud(plan.annualAppAud)} a year in the App Store, with ${plan.annualIncluded} walkthroughs`));
  assert.ok(home.includes(`a Super fast render is ${aud(express.webAud)}, ready in about 30 minutes, any day, any time, or refunded`));
  assert.ok(home.includes('the first charge is on the day they end, and cancelling before then charges nothing'));
  assert.ok(home.includes(`add a pack of ${pack3.walkthroughs} walkthroughs for ${aud(pack3.webAud)} or ${pack10.walkthroughs} for ${aud(pack10.webAud)}`));
  const llms = read('llms.txt');
  for (const amount of [plan.webAud, plan.appAud, plan.annualAud, plan.annualAppAud, pack3.webAud, pack10.webAud, hostingYear, record.services.editingPerHourAud, express.webAud, perMonthly, perAnnual]) {
    assert.match(llms, priceRe(aud(amount)), `llms.txt states ${aud(amount)}`);
  }
});

// The one-line mentions on / and /start: the free months, then the plan from its lowest monthly
// price and its annual price, and no renewal promise that an invoice does not make.
test('the short pricing lines on the home page and /start name the plan monthly and annual, and no invoice is said to renew', () => {
  const flat = (html) => text(html).replace(/\s+/g, ' ');
  const home = read('index.html');
  const start = read('start/index.html');
  const lead = `${free.months} free months with ${free.includedWalkthroughs} walkthroughs included, then the Veylet plan from ${aud(plan.webAud)} a month or ${aud(plan.annualAud)} a year`;
  const heroNote = flat(home.match(/<p class="hero-note">([\s\S]*?)<\/p>/)[1]);
  assert.ok(heroNote.startsWith(`${lead}, which you can cancel any time.`), heroNote);
  const walkAfter = flat(home.match(/<div class="walk-after">[\s\S]*?<p class="contact-note">([\s\S]*?)<\/p>/)[1]);
  assert.equal(walkAfter, `Enquiries are free. ${lead}; cancel any time. This site takes no card payment yet.`);
  assert.equal(record.freeMonths.autoRenewalByChannel.studioInvoice, false, 'an invoice does not renew by itself');
  assert.equal(record.freeMonths.cancelAnytime, true);
  for (const [page, html] of [['index.html', home], ['start/index.html', start]]) {
    assert.doesNotMatch(flat(html), /the Veylet plan renews unless you cancel|Plans are started in the app/, `${page} promises a renewal an invoice does not make`);
  }
  const startIntro = flat(start.match(/<section class="guide-intro">([\s\S]*?)<\/section>/)[1]);
  assert.ok(startIntro.includes(`receive ${free.months} free months with ${free.includedWalkthroughs} accepted walkthroughs in total, starting the day the plan is activated, `
    + `then the Veylet plan from ${aud(plan.webAud)} a month or ${aud(plan.annualAud)} a year; the offer page itemises the first year.`), startIntro);
  const agency = Object.fromEntries(faqPairs(start))['Can an agency use it free?'];
  for (const phrase of ['one trial per agency (ABN) and workspace', 'App Store subscriptions renew at the price of the plan you chose, monthly or annual, unless cancelled through Apple',
    `unused ones roll over, up to ${banked} banked`, `the annual plan has ${plan.annualIncluded} to use any time in the plan year, and ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders if you choose it before your free months end`,
    'They begin when the plan is activated with a payment method on file', 'The first charge is on the day they end; cancel before then and nothing is charged.']) {
    assert.ok(agency.includes(phrase), `/start: ${phrase}`);
  }
});

test('no retired or superseded amount remains in the published HTML, scripts or text', () => {
  // Offer 2026-09-23.2 to 2026-09-24.1 amounts, then those retired by 2026-09-24.2: Team (web and
  // App Store), Office and its yearly price, One walkthrough, the single extra and its in-app price,
  // and Team's per-walkthrough figure. A$49 is the hosting extension again from 2026-09-26.2, so it is
  // allowed only where hosting or keeping a walkthrough online is named just before it (A$49.50, one
  // monthly walkthrough, is a different amount). offer.json keeps the App Store pack prices (A$199.99,
  // A$589.99), which the guard's decimals rule leaves alone, and is skipped as the record itself.
  // Offer 2026-09-25.2 brings back A$99 and A$119.99 (the 2026-09-23.4 Solo amounts) at 2 walkthroughs a
  // month, so those two leave this list; the 2026-09-25.1 amounts (A$79, A$94.99, A$790, A$949.99, A$158,
  // A$711) join it.
  const old = ['A$119', 'A$1,190', 'A$139.99', 'A$1,399.99', 'A$238', 'A$279.89', 'A$149', 'A$349', 'A$3,490',
    'A$39', 'A$59.99', 'A$714',
    'A$299', 'A$3,289', 'A$349.99', 'A$3,849.99', 'A$349.89', 'A$899', 'A$9,889', 'A$1,794', 'A$2,099.94', 'A$100',
    'A$1,089', 'A$1,319.99', 'A$119.89', 'A$594', 'A$719.94', 'A$249', 'A$2,739', 'A$289.99',
    'A$3,189.99', 'A$289.89', 'A$1,494', 'A$83', 'A$749', 'A$8,239', 'A$219',
    'A$189', 'A$219.99', 'A$599', 'A$6,589', 'A$199', 'A$89', 'A$99.99', 'A$63',
    'A$79', 'A$94.99', 'A$790', 'A$949.99', 'A$158', 'A$711', 'A$854.91'];
  const oldNumbers = /(?<![\d.])(?:11900|119000|13999|139999|14900|34900|349000|4900|3900|5999|29900|328900|34999|384999|89900|988900|108900|131999|24900|273900|28999|318999|21900|74900|823900|7900|79000|9499|94999)(?!\d)|data-(?:(?:solo|team)-)?(?:web|app)-(?:month|year)="(?:119|1190|139\.99|1399\.99|299|3289|349\.99|3849\.99|99|1089|119\.99|1319\.99|249|2739|289\.99|3189\.99)"|data-plan-(?:web|app)-(?:month|year)="(?:79|94\.99|790|949\.99)"|16\.67?%/;
  const files = walk(/\.(?:html|js|txt|json)$/).filter((file) => !['build-info.json', 'offer.json'].includes(path.basename(file)));
  assert.ok(files.length > 20);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const price of old) assert.doesNotMatch(content, priceRe(price), `${rel(file)} still states ${price}`);
    for (const match of content.matchAll(priceRe('A$49', 'g'))) {
      assert.match(content.slice(Math.max(0, match.index - 100), match.index), /hosting|walkthrough online/i, `${rel(file)} uses A$49 outside hosting`);
    }
    assert.doesNotMatch(content, oldNumbers, `${rel(file)} keeps a superseded amount`);
    assert.doesNotMatch(content.replace(/\s+/g, ' '), /[Ff]ounding[^.]{0,200}A\$(?:249|219|189)(?!\d|[,.]\d)|founding: \{ monthly: (?:24900|21900|18900) \}/,
      `${rel(file)} states a retired founding rate`);
  }
});

test('the App Store sells the Veylet plan monthly and annual, and both desks still map the four App Store products', () => {
  assert.equal(record.appStore.annualSoldInApp, true);
  assert.match(record.appStore.annualNote, /The App Store sells the Veylet plan monthly \(dev\.property3d\.capture\.solo\.monthly, A\$119\.99\) and annual \(dev\.property3d\.capture\.solo\.annual, A\$1,199\.99\)/);
  assert.match(record.appStore.annualNote, /Express renders and packs are not sold in the app\./);
  // Public pages name the App Store annual only at its canonical price.
  for (const page of ['offer/index.html', 'index.html', 'terms/index.html', 'llms.txt']) {
    assert.ok(visible(page).includes(`${aud(plan.annualAppAud)} a year in the App Store`), `${page} states the App Store annual`);
  }
  // Retired App Store products stay in the record and both desks map them, so a verified row still reads correctly.
  const products = record.appStore.productIds;
  assert.deepEqual(record.appStore.productPlans, { soloMonthly: 'solo', soloAnnual: 'solo', monthly: 'studio', annual: 'studio' });
  for (const script of ['account.js', 'studio.js']) {
    const content = read(script);
    for (const [key, code, interval] of [['monthly', 'studio', 'monthly'], ['annual', 'studio', 'annual'], ['soloMonthly', 'solo', 'monthly'], ['soloAnnual', 'solo', 'annual']]) {
      assert.match(content, new RegExp(`'${escape(products[key])}': \\['${code}', '${interval}'\\]`), `${script} maps ${products[key]}`);
    }
  }
});

test('the founding programme is invitation only, at most five, at the normal prices, with its three perks', () => {
  assert.deepEqual({ invitationOnly: founding.invitationOnly, maxAccounts: founding.maxAccounts, freeMonthsEligible: founding.freeMonthsEligible },
    { invitationOnly: true, maxAccounts: 5, freeMonthsEligible: true });
  assert.match(founding.price, /normal Veylet plan and pack prices; no special or locked price/);
  assert.equal(founding.perks.length, 3);
  for (const key of ['webAud', 'lockMonths', 'extraWebAud', 'basePlan', 'note']) assert.equal(founding[key], undefined, `founding has no ${key}`);
  const line = body.match(/<p[^>]*data-offer-founding[^>]*>[\s\S]*?<\/p>/)[0];
  assert.match(line, /<strong>Founding agencies, by invitation only\.<\/strong>/);
  assert.match(line, /At most five agencies, on the normal plan and pack prices, with no locked or special price\./);
  for (const perk of founding.perks) assert.ok(line.includes(perk), `the founding line names: ${perk}`);
  assert.match(line, /nothing to sign up for here/);
  assert.doesNotMatch(line, /A\$|App Store|apply|white-glove|fixed for twelve months|founding rate/i);
  const llmsLine = read('llms.txt').split('\n').find((entry) => entry.startsWith('- Founding agencies'));
  assert.match(llmsLine, /^- Founding agencies \(by invitation only, at most five\): the normal plan and pack prices, with no locked or special price\./);
  for (const perk of founding.perks) assert.ok(llmsLine.includes(perk), `llms.txt names: ${perk}`);
  assert.doesNotMatch(llmsLine, /A\$|white-glove|fixed for twelve months/);
});

test('llms.txt states the plan monthly and annual, the first charge, the bonus, express, the anchor, the redo, packs, referrals and the hosting rule the offer page states', () => {
  const llms = read('llms.txt');
  const lineStarting = (start) => llms.split('\n').find((entry) => entry.startsWith(start)) || '';
  const planLine = lineStarting('- One plan, the Veylet plan, monthly or annual.');
  assert.ok(planLine.includes(`Monthly: ${aud(plan.webAud)} a month by studio invoice (and by card on this website once card payment opens), or ${aud(plan.appAud)} a month in the App Store; `
    + `${plan.includedPerMonth} accepted walkthroughs a month, and unused ones roll over, up to ${banked} banked.`), 'monthly');
  assert.ok(planLine.includes(`Annual: ${aud(plan.annualAud)} a year by studio invoice, or by card once card payment opens (${monthsFree} months free: ${aud(saving)} less than 12 monthly payments), or ${aud(plan.annualAppAud)} a year in the App Store; `
    + `${plan.annualIncluded} walkthroughs to use any time in the plan year`), 'annual');
  assert.match(planLine, /unlimited seats/);
  assert.equal(lineStarting('- Early annual bonus:'), `- Early annual bonus: choose annual before the free months end and get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in the first plan year (${plan.annualIncluded + bonus} walkthroughs in total), once per workspace. Super fast renders are used on the website.`);
  assert.equal(lineStarting('- Per walkthrough:'), `- Per walkthrough: ${aud(perMonthly)} on the monthly plan (${aud(plan.webAud)} for ${plan.includedPerMonth}) and ${aud(perAnnual)} on the annual (${aud(plan.annualAud)} for ${plan.annualIncluded}), when every included walkthrough is used. `
    + `For comparison, ${record.anchor.text.replace(/^A /, 'a ')} (published prices of Brisbane and Gold Coast 3D tour photographers, checked 13 September 2026; see the 3D tour cost guide below).`);
  assert.equal(lineStarting('- Super fast render:'), `- Super fast render: ${aud(express.webAud)} a capture, on the website only: ${express.promise}. When a bonus Super fast render was used, it is returned instead. `
    + 'No daily limit and no business hours. Super fast is sold only while fast GPUs in Sydney are starting quickly; when they aren\'t, the account says "Super fast isn\'t available right now" and nothing is charged. An order already paid keeps its promise. Not sold in the app.');
  // Offer 2026-09-26.3: the rooms rule, fair use and the audience, in llms.txt's words.
  assert.match(lineStarting('- One walkthrough covers'), /^- One walkthrough covers up to 8 rooms of one property, counted automatically from the capture; each further 8 rooms uses one more\./);
  assert.match(lineStarting('- One trial per agency'), /Fair use: up to 12 render attempts during the free months, including retries\.$/);
  assert.equal(lineStarting('- Who it is for:'), '- Who it is for: anyone: agents, property managers and freelancers, on the same plan and prices; there is no separate tier.');
  assert.equal(lineStarting('- An accepted walkthrough'), '- An accepted walkthrough is one the automatic quality check passed and the account approved for release; a failed capture never counts.');
  const processing = lineStarting('- Processing:');
  assert.match(processing, /^- Processing: automatic, with no person checking\./);
  assert.match(processing, /usually ready for review within 1–2 hours of the upload finishing/);
  assert.match(processing, /An AI visual check is planned and comes only once the privacy notice covers it; it does not run today\.$/);
  assert.doesNotMatch(llms, /studio check|(?<!no )business (?:day|hour)|express render|priority in the studio queue/i);
  assert.equal(lineStarting('- First walkthrough:'), `- First walkthrough: if an account's first walkthrough isn't listing-ready, we redo it free. The redo is a correction on the same link and uses no walkthrough; a new capture visit is not included.`);
  assert.match(llms, /The first charge is on the day the free months end, at the price of the plan chosen; cancelling before then charges nothing\./);
  const packLine = lineStarting('- Walkthrough packs');
  assert.ok(packLine.includes(`${pack3.walkthroughs} walkthroughs for ${aud(pack3.webAud)} or ${pack10.walkthroughs} walkthroughs for ${aud(pack10.webAud)}`), 'pack sizes and prices');
  assert.ok(packLine.includes(`each valid ${pack3.validMonths} months after purchase and used only after the included walkthroughs of the free months or the plan.`));
  assert.match(packLine, /during the free months or on the plan: by studio invoice today, by card in the account once card payment opens, and in the app in a later app version\./);
  assert.equal(lineStarting('- Referrals:'), `- Referrals: when an office you refer becomes a paying account, you each get ${record.referral.referrerWalkthroughs} bonus walkthrough. Share your own link from your account.`);
  assert.match(llms, /More walkthroughs inside the free months come from a walkthrough pack \(below\), which can be bought during the free months; the free-months end date stays the same\./);
  assert.equal(lineStarting('- Hosting:'), '- Hosting: every released walkthrough stays live while the account has an active plan (free months, monthly or annual). When the plan ends, its links, embeds and QR codes keep working for 14 days, then go offline; they are not deleted or revoked, and restarting the plan brings the same links back at once. '
    + `To keep a single walkthrough online without a plan, ask us for a hosting extension: ${aud(hostingYear)} a year per walkthrough.`);
  assert.match(lineStarting('- While subscribed:'), /Listing videos \(MP4\) and stills are included in the plan; downloaded files are the account's to keep\.$/);
  assert.doesNotMatch(llms, /at least twelve months|hosting costs|There is no hosting without a plan/);
  assert.match(llms, /The App Store sells the Veylet plan monthly and annual\./);
  assert.match(llms, /corrections to the same walkthrough do not use a second unit/i);
  assert.match(llms, /no automatic debt or early paid trial switch/);
  assert.match(llms, /studio invoice periods require explicit agreement and settlement and do not auto-renew/);
});

test('the website guide gives a paste location for each major builder and does not promise portals', () => {
  const guide = read('website-guide/index.html');
  for (const builder of ['WordPress', 'Squarespace', 'Wix', 'Webflow']) assert.match(guide, new RegExp(`<summary>${builder}</summary>`));
  assert.match(guide, /Listing portals do not accept this embed/);
});

// Names retired for new buyers by offer 2026-09-24.2. Existing rows still read correctly on the
// desks, which name the retired plans in one shared constant and nowhere else.
const SHARED_PLAN_NAMES = "{ solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' }";
// "One walkthrough" as a product name: mid-sentence, or ending a name (a quote, tag, bracket, comma or "once", "at", "plan").
const retiredNames = [/\bSolo\b/, /\bTeam\b/, /\bOffice\b/,
  /[a-z,]\s+One walkthrough\b|One walkthrough(?=\s*(?:['"<>()[\],]|$|once\b|at\b|plan\b|is\b|are\b|and\b|or\b))/];

test('retired plan names appear on no public page, and the desks name them only in the shared constant', () => {
  const allowed = ['Office of the Australian Information Commissioner', 'existing Team or Office plans keep their agreed allowance',
    'Existing Team or Office plans keep their agreed allowance'];
  for (const file of walk(/\.(?:html|txt)$/)) {
    let content = fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    for (const phrase of allowed) content = content.split(phrase).join(' ');
    for (const name of retiredNames) assert.doesNotMatch(content, name, `${rel(file)} names a retired plan (${name})`);
  }
  assert.ok(read('terms/index.html').replace(/\s+/g, ' ').includes('Existing Team or Office plans keep their agreed allowance'), 'the terms keep existing plans on their agreed allowance');
  for (const script of ['account.js', 'studio.js']) {
    // Comments are shown to nobody; every string is.
    const code = read(script).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(code.split(SHARED_PLAN_NAMES).length - 1, 1, `${script} keeps the shared plan names exactly once`);
    const rest = code.replace(SHARED_PLAN_NAMES, '');
    for (const name of retiredNames) assert.doesNotMatch(rest, name, `${script} names a retired plan outside the shared constant (${name})`);
  }
});
