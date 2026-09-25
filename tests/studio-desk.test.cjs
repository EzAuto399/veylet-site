const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const markup = read('dist/studio/index.html');
const script = read('dist/studio.js');
const styles = read('dist/studio.css');
const accountScript = read('dist/account.js');
const accountMarkup = read('dist/account/index.html');
const homeMarkup = read('dist/index.html');
// The canonical offer record (2026-09-25.1): every amount the desk records is
// checked against it rather than typed into these tests.
const offer = JSON.parse(read('dist/offer/offer.json'));
const cents = amount => Math.round(amount * 100);
const soloPlan = offer.plans[0];
const escapeMoney = text => text.replace(/[$.,]/g, '\\$&');
const aud = amountCents => 'A$' + (amountCents / 100).toLocaleString('en-AU',
  { minimumFractionDigits: amountCents % 100 ? 2 : 0, maximumFractionDigits: 2 });
// One public annual price: the invoice year is the plan's annualAud, never a tier.
const OFFER = {
  month: cents(soloPlan.webAud),
  year: cents(soloPlan.annualAud),
  yearlyPool: soloPlan.annualIncluded,
  rolloverMax: soloPlan.rollover.maxBanked,
  earlyBonus: offer.earlyAnnualBonus.walkthroughs,
  earlyExpress: offer.earlyAnnualBonus.expressRenders,
  monthlyIncluded: soloPlan.includedPerMonth,
  express: cents(offer.expressRender.webAud),
  expressCap: offer.expressRender.dailyCap,
  referral: offer.referral.referrerWalkthroughs,
  packs: Object.fromEntries(offer.packs.map(pack => [pack.code, { walkthroughs: pack.walkthroughs, cents: cents(pack.webAud) }])),
};

/* ---- The page itself ------------------------------------------------- */

test('the studio desk stays out of search and out of a frame', () => {
  assert.match(markup, /<meta name="robots" content="noindex,nofollow" \/>/);
  assert.match(markup, /<meta name="referrer" content="no-referrer" \/>/);
  assert.doesNotMatch(read('dist/sitemap.xml'), /\/studio/);
  const vercel = JSON.parse(read('vercel.json'));
  const entry = vercel.headers.find(rule => rule.source === '/studio');
  assert.ok(entry, 'vercel.json carries a /studio header rule');
  const headers = Object.fromEntries(entry.headers.map(header => [header.key, header.value]));
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.match(headers['X-Robots-Tag'], /noindex/);
  assert.match(headers['Permissions-Policy'], /payment=\(\)/);
});

test('the studio desk carries the shared shell and names itself only in its own nav', () => {
  assert.match(markup, /<a class="brand" href="\/" aria-label="Veylet Studio home"/);
  const nav = markup.match(/<nav aria-label="Main">(.*?)<\/nav>/)[1];
  const items = [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(items[items.length - 1], ['/studio', 'Studio']);
  assert.match(nav, /<a href="\/studio" aria-current="page">Studio<\/a>/);
  assert.equal(markup.includes('<footer class="wrap">'), true);
  assert.equal(accountMarkup.match(/<footer class="wrap">.*<\/footer>/s)[0], markup.match(/<footer class="wrap">.*<\/footer>/s)[0]);
  // No other page advertises the studio desk.
  for (const other of [accountMarkup, homeMarkup]) assert.doesNotMatch(other, /href="\/studio"/);
});

test('the studio desk loads only first-party assets and the pinned vendor client', () => {
  const sources = [...markup.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const source of sources) {
    assert.equal(/^https?:|^\/\//.test(source), false, `${source} must not be a third-party host`);
  }
  assert.doesNotMatch(markup, /jsdelivr|unpkg|cdnjs|googleapis|gstatic/);
  // The page selects versioned URLs so a cached older script cannot win.
  assert.ok(sources.some(source => /^\/studio\.js\?v=[a-f\d]{16}$/.test(source)));
  assert.ok(sources.some(source => /^\/studio\.css\?v=[a-f\d]{16}$/.test(source)));
  assert.ok(sources.some(source => source.startsWith('/vendor/supabase-js-')));
  // The QA fixture intercepts these two exact tags; keep them interceptable.
  assert.equal(markup.match(/<script src="\/supabase-public\.js(?:\?[^"]*)?"><\/script>/g).length, 1);
  assert.equal(markup.match(/<script src="\/vendor\/supabase-js-2\.116\.0\.min\.js(?:\?[^"]*)?"><\/script>/g).length, 1);
});

test('the accounts list is a real table a screen reader can read', () => {
  assert.match(markup, /<table class="studio-table" id="studio-table">/);
  assert.match(markup, /<caption>/);
  const accountsTable = markup.slice(markup.indexOf('<table class="studio-table" id="studio-table">'), markup.indexOf('id="studio-rows"'));
  const headers = [...accountsTable.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/gs)].map(match => match[1].replace(/<[^>]+>[^<]*<\/[^>]+>/g, '').trim());
  assert.deepEqual(headers, ['Account', 'Status', 'Source', 'Free months', 'Free walkthroughs',
    'This month', 'Total', 'Renews', 'Auto-renew', 'Walkthroughs', 'Last activity', 'Note']);
  // The assertions below index by name, so the map must follow the markup.
  assert.equal(headers.length, 12);
  assert.equal(headers[COL.source], 'Source');
  assert.equal(headers[COL.freeWalkthroughs], 'Free walkthroughs');
  assert.equal(headers[COL.renews], 'Renews');
  assert.equal(headers[COL.autoRenew], 'Auto-renew');
  assert.match(markup, /<tbody id="studio-rows"><\/tbody>/);
  assert.match(markup, /<select id="studio-filter-status">/);
  assert.match(markup, /<label for="studio-filter-status">/);
  assert.match(markup, /<label for="studio-filter-name">/);
  assert.match(markup, /id="studio-sort-activity" aria-pressed="true"/);
  assert.match(markup, /id="studio-sort-trial" aria-pressed="false"/);
});

test('the studio desk says what it needs without JavaScript, and asks for nothing else', () => {
  assert.match(markup, /<noscript><p class="contact-note">The studio desk needs JavaScript\./);
  assert.match(markup, /href="\/account"/);
  // This desk never takes a payment detail.
  assert.doesNotMatch(markup, /type="(?:password|tel)"|card number|cardholder|cvc|autocomplete="cc-/i);
  // One vocabulary: the filter offers the same short state words the State row
  // uses on the app and the account desk, and no second set of names.
  const options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(options, [['all', 'All statuses'], ['pending', 'Not started'],
    ['trial', 'Free months'], ['active', 'Active'], ['ended', 'Ended']]);
  assert.doesNotMatch(markup, /In free months|On the plan|Free months finished|Free months not started/);
});

test('the twelve columns are reachable without a mouse when the desk scrolls', () => {
  // A scroll region only a pointer can move hides the last columns from a
  // keyboard, so the region is named and studio.js makes it a tab stop.
  assert.match(markup, /<div class="studio-table-wrap" id="studio-table-wrap" role="region" aria-label="[^"]+"/);
  assert.match(markup, /id="studio-scroll-hint" hidden/);
  assert.match(styles, /\.studio-table-wrap:focus-visible \{[^}]*outline: 3px solid #897033/s);
  // Set plan opens inside that scroll, so its warning is bounded by what is
  // actually visible rather than by the table's full width.
  assert.match(styles, /@media \(min-width: 721px\) \{\s*\.studio-set-plan summary,\s*\.studio-plan-form \{[^}]*position: sticky;[^}]*max-width: var\(--studio-view, 100%\)/s);
  // Below the stacked breakpoint nothing scrolls, so nothing may be pinned or
  // given a width that pushes the page past 320px.
  assert.match(styles, /@media \(min-width: 721px\) \{\s*\.studio-table thead th \{\s*white-space: normal/s);
});

test('the studio desk stays usable on a phone and keeps 44px targets', () => {
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /content: attr\(data-label\)/);
  assert.match(styles, /\.studio-table thead \{[^}]*position: absolute/s);
  assert.equal(/min-height: 44px/.test(styles), true);
  assert.doesNotMatch(styles, /@import|url\(https?:/);
});

test('health checks cover the studio route and its two assets', () => {
  const health = read('scripts/health-check.sh');
  assert.match(health, /for route in .*\/studio /);
  assert.match(health, /for asset in .*\/studio\.js \/studio\.css /);
});

test('the studio desk and the account desk use one vocabulary, written once each', () => {
  const shared = [
    "'Plan status unavailable'", "'Refresh to check your free months and allowance.'",
    "'Plan not started'", "'Free until '", "(PLAN_NAMES[planCode(row)] || 'Plan') + ' · '",
    // Offer 2026-09-24.2: plan code solo is the Veylet plan, the one plan on sale;
    // the retired codes keep their names so existing rows still read correctly.
    "{ solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' }",
    "{ 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] }",
    "'Free months ended '", "'Plan ended '",
    "'Review the available plan. Eligible subscribers can start with '",
    "' free months and '", "' walkthroughs in total.'",
    // Offer 2026-09-26.1: hosting follows the plan; offline 14 days after it ends, links restored on restart.
    "'Your released walkthroughs stay online for 14 days after the plan ends, then go offline. Restarting the plan brings the same links back at once; a second free trial is not guaranteed.'",
    "' free walkthroughs used. '",
    // Offer 2026-09-25.1: the reminder reads "Free until {date}, then {price} unless you cancel."
    "', then '", "' unless you cancel.'",
    "'It ends on '", "' and will not renew.'",
    "' walkthroughs this month. '", "' Hosting included.'", "' Billed annually.'",
  ];
  for (const phrase of shared) {
    assert.equal(script.split(phrase).length - 1, 1, `studio.js states ${phrase} once`);
    assert.equal(accountScript.split(phrase).length - 1, 1, `account.js states ${phrase} once`);
  }
  // The withdrawn promises are gone from both, not merely unused: the old renewal
  // sentence, the monthly reset of an annual allowance, and month words for offer counts.
  for (const withdrawn of [/never charge without your yes/, /never an automatic charge/,
    /free months begin the day your first walkthrough is accepted/, /'Renews on '/, /Billed annually; the walkthrough allowance resets monthly/, /PLAN_MONTH_WORDS/]) {
    assert.doesNotMatch(script, withdrawn);
    assert.doesNotMatch(accountScript, withdrawn);
  }
});

test('one price source: an App Store account is never shown the website price', () => {
  for (const source of [script, accountScript]) {
    // Both files choose the price from the same field, by the same rule.
    assert.match(source, /planSource\(row\) === 'apple' \? row\.app_price_aud_cents : row\.price_aud_cents/);
  }
  // The single extra walkthrough is retired for new purchases (packs replace it),
  // so the studio desk no longer prices one.
  assert.doesNotMatch(script, /extra_walkthrough_aud_cents|planExtraPrice/);
});

test('the studio desk carries no retired price and no annual tier: one public annual amount, written once', () => {
  // Offer 2026-09-25.1: Team, Office, One walkthrough, the founding rate and the
  // single extra are retired, so none of their amounts may be written in the desk;
  // nor the withdrawn one-month-free annual tier.
  assert.doesNotMatch(script, /(?<![\d.])(?:18900|189000|207900|59900|658900|19900|8900|21999|9999|86900)(?!\d)/);
  for (const retired of ['A$189', 'A$1,890', 'A$2,079', 'A$599', 'A$6,589', 'A$199', 'A$89', 'A$219.99', 'A$99.99', 'A$869']) {
    assert.equal(new RegExp(retired.replace(/[$.,]/g, '\\$&') + '(?!\\d|[,.]\\d)').test(script), false, `studio.js states ${retired}`);
  }
  // Prices are formatted from cents at run time, never written as text (a
  // comment may still give an example).
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const amount of [soloPlan.webAud, soloPlan.annualAud, 12 * soloPlan.webAud - soloPlan.annualAud]) {
    const written = new RegExp(escapeMoney('A$' + amount.toLocaleString('en-AU')) + '(?!\\d|[,.]\\d)');
    assert.equal(written.test(code), false, `studio.js writes A$${amount}`);
  }
  // Every current amount is written once, in cents, beside its name, and the
  // annual amount is the one public price: no tier map and no tier read.
  assert.match(script, new RegExp(`const PLAN_MONTH_CENTS = ${cents(soloPlan.webAud)};`));
  assert.match(script, new RegExp(`const PLAN_YEAR_CENTS = ${cents(soloPlan.annualAud)};`));
  assert.equal(offer.membersAnnual.tiers.standard.planAud, soloPlan.annualAud);
  assert.doesNotMatch(script, /MEMBERS_ANNUAL_CENTS|studio_members_annual_tier|twoMonthsFree|oneMonthFree|members' annual/);
  assert.match(script, new RegExp(`const ROLLOVER_MAX = ${soloPlan.rollover.maxBanked};`));
  assert.match(script, new RegExp(`const YEARLY_POOL = ${soloPlan.annualIncluded};`));
  assert.match(script, new RegExp(`const EARLY_ANNUAL_BONUS = ${offer.earlyAnnualBonus.walkthroughs};`));
  assert.match(script, new RegExp(`const REFERRAL_WALKTHROUGHS = ${offer.referral.referrerWalkthroughs};`));
  assert.equal(offer.referral.referredWalkthroughs, offer.referral.referrerWalkthroughs, 'each office gets the same');
  for (const pack of offer.packs) {
    assert.match(script, new RegExp(`${pack.code}: \\{ walkthroughs: ${pack.walkthroughs}, cents: ${cents(pack.webAud)} \\}`));
    assert.equal(pack.validMonths, 12);
  }
  assert.match(script, /const PACK_VALID_MONTHS = 12;/);
  // The four App Store product IDs stay mapped for existing rows.
  assert.equal((script.match(/'dev\.property3d\.capture\.[a-z]+\.(?:monthly|annual)': \['(?:solo|studio)', '(?:monthly|annual)'\]/g) || []).length, 4);
});

/* ---- Behaviour ------------------------------------------------------- */

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.open = false; this.checked = false;
    this.textContent = ''; this.value = ''; this.className = '';
    this.classList = { add: () => {}, remove: () => {} };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  focus() { this.wasFocused = true; }
  get style() { this._style = this._style || { properties: {}, setProperty(key, value) { this.properties[key] = value; } }; return this._style; }
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
  text() { return [this, ...this.all()].map(el => el.textContent).filter(Boolean).join(' | '); }
}

const PLAN_FIELDS = ['workspace_id', 'plan_code', 'source', 'status', 'trial_months',
  'trial_included_walkthroughs', 'accepted_in_free_months', 'extras_in_free_months',
  'trial_started_at', 'trial_ends_at', 'period_started_at', 'period_ends_at',
  'current_period_ends_at', 'auto_renews', 'cancelled_at', 'included_per_month',
  'accepted_this_period', 'accepted_total', 'price_aud_cents', 'extra_walkthrough_aud_cents',
  'app_price_aud_cents', 'app_extra_walkthrough_aud_cents', 'apple_verified', 'apple_product_id',
  'hosting_included', 'updated_at', 'billing_interval', 'renewal_price_aud_cents', 'apple_environment'];
const planFields = row => Object.fromEntries(PLAN_FIELDS.map(key => [key, row[key] ?? null]));
const studioAccounts = () => accounts().map(row => ({ ...row, source: 'studio' }));
const money = { billing_interval: 'monthly', price_aud_cents: 18900, extra_walkthrough_aud_cents: 8900,
  app_price_aud_cents: 21999, app_extra_walkthrough_aud_cents: 9999, hosting_included: true };
// Offer 2026-09-25.1: 3 free months with 6 walkthroughs for new and never-started
// rows; running free months keep the longer end they started with (Northgate's
// six months), and an account whose free months ended earlier keeps its four.
const accounts = () => [
  { workspace_id: 'ws-northgate', workspace_name: 'Northgate Property Co', owner_user_id: 'o1',
    owner_display_name: 'Alina Northgate', member_count: 4, plan_code: 'studio', source: 'apple',
    status: 'trial', apple_verified: false, apple_product_id: 'dev.property3d.capture.plan.monthly',
    trial_months: 6, trial_included_walkthroughs: 6, accepted_in_free_months: 3, extras_in_free_months: 0,
    trial_started_at: '2026-07-01T00:00:00Z', trial_ends_at: '2027-01-01T00:00:00Z',
    period_started_at: '2026-09-01T00:00:00Z', period_ends_at: '2026-10-01T00:00:00Z',
    current_period_ends_at: null, auto_renews: true, cancelled_at: null,
    included_per_month: 3, accepted_this_period: 2, accepted_total: 5, ...money,
    tours_ready: 1, tours_processing: 1, last_activity_at: '2026-09-22T01:10:00Z', note: 'Asked about a second walkthrough.' },
  { workspace_id: 'ws-wren', workspace_name: 'Wren & Fielding', owner_user_id: 'o2',
    owner_display_name: 'Marcus Fielding', member_count: 9, plan_code: 'office', source: 'studio',
    status: 'active', apple_verified: null, apple_product_id: null,
    trial_months: 6, trial_included_walkthroughs: 4, accepted_in_free_months: 4, extras_in_free_months: 2,
    trial_started_at: '2025-11-01T00:00:00Z', trial_ends_at: '2026-05-01T00:00:00Z',
    period_started_at: '2026-09-05T00:00:00Z', period_ends_at: '2026-10-05T00:00:00Z',
    current_period_ends_at: '2026-10-05T00:00:00Z', auto_renews: true, cancelled_at: null,
    included_per_month: 3, accepted_this_period: 3, accepted_total: 18, ...money, price_aud_cents: 59900,
    tours_ready: 2, tours_processing: 0, last_activity_at: '2026-09-20T05:45:00Z', note: 'Monthly invoice.' },
  { workspace_id: 'ws-kelvin-grove', workspace_name: 'Kelvin Grove Dental', owner_user_id: 'o3',
    owner_display_name: null, member_count: 2, plan_code: 'studio', source: 'web',
    status: 'pending', apple_verified: null, apple_product_id: null,
    trial_months: 3, trial_included_walkthroughs: 6, accepted_in_free_months: 0, extras_in_free_months: 0,
    trial_started_at: null, trial_ends_at: null,
    period_started_at: null, period_ends_at: null,
    current_period_ends_at: null, auto_renews: false, cancelled_at: null,
    included_per_month: 3, accepted_this_period: 0, accepted_total: 0, ...money,
    tours_ready: 0, tours_processing: 1, last_activity_at: '2026-09-11T23:20:00Z', note: null },
];
// Column order, so an index never has to be counted by hand in an assertion.
const COL = { account: 0, status: 1, source: 2, freeMonths: 3, freeWalkthroughs: 4,
  thisMonth: 5, total: 6, renews: 7, autoRenew: 8, walkthroughs: 9, activity: 10, note: 11 };

function controlledTimer(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }

async function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1]);
    ids[match[2]].hidden = /\bhidden\b/.test(match[0]);
  }
  const calls = [], confirms = [];
  const rows = options.accounts === undefined ? accounts() : options.accounts;
  const user = options.signedOut ? null : { id: 'studio-user', email: 'studio@example.invalid' };
  const client = {
    auth: {
      getSession: async () => options.sessionError ? { error: { message: 'offline' } } : { data: { session: user ? { user } : null } },
      onAuthStateChange: callback => { client.auth.callback = callback; },
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc?.[name]) return options.rpc[name](args);
      if (name === 'studio_is_member') return { data: true };
      if (name === 'studio_list_deletion_requests') return { data: options.deletions || [] };
      if (name === 'studio_list_hosted_tours') return { data: (options.hosted || []).map(row => ({ ...row })) };
      if (name === 'studio_money_exceptions') return { data: (options.exceptions || []).map(row => ({ ...row })) };
      if (name === 'studio_capture_queue') return { data: (options.queue || []).map(row => ({ ...row })) };
      if (name === 'studio_capture_sla') return { data: (options.sla || []).map(row => ({ ...row })) };
      if (name === 'studio_express_queue') return { data: (options.express || []).map(row => ({ ...row })) };
      if (name === 'studio_list_accounts') return { data: rows.map(row => ({ ...row })) };
      if (name === 'studio_set_plan') {
        const row = rows.find(item => item.workspace_id === args.p_workspace_id);
        if (!row) return { error: { message: 'unknown workspace' } };
        const months = args.p_trial_months ?? row.trial_months;
        const started = args.p_trial_started_at ?? row.trial_started_at;
        let ends = row.trial_ends_at;
        if (args.p_status === 'pending') ends = null;
        else if (started) {
          const when = new Date(started);
          when.setMonth(when.getMonth() + (months || 6));
          ends = when.toISOString();
        }
        return { data: [planFields({ ...row, status: args.p_status, trial_months: months,
          // The App Store owns an Apple subscription's source whatever is sent.
          source: row.source === 'apple' ? 'apple' : (args.p_source ?? row.source),
          plan_code: args.p_plan_code ?? row.plan_code,
          trial_included_walkthroughs: args.p_trial_included ?? row.trial_included_walkthroughs,
          auto_renews: typeof args.p_auto_renews === 'boolean' ? args.p_auto_renews : row.auto_renews,
          trial_started_at: args.p_status === 'pending' ? null : started,
          trial_ends_at: ends, updated_at: '2026-09-22T09:00:00Z' })] };
      }
      return { error: { message: 'unexpected rpc' } };
    },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => client } };
  const documentStub = { getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener: () => {} };
  const context = {
    window, document: documentStub, Date, URLSearchParams,
    setTimeout: controlledTimer, clearTimeout,
    location: { pathname: '/studio', search: '' },
  };
  // A page with no confirm() at all must refuse the irreversible answers.
  if (!options.noConfirm) {
    context.confirm = question => {
      confirms.push(question);
      return typeof options.confirm === 'function' ? options.confirm(question)
        : options.confirm === undefined ? true : options.confirm;
    };
  }
  // The desk's own error handler is attached in source, so the harness does not
  // await the whole start sequence: a pending request must still leave a page.
  void vm.runInNewContext(options.script || script, context);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const body = () => ids['studio-rows'].children;
  return {
    ids, calls, confirms, client,
    dataRows: () => body().filter(el => el.className === 'studio-row'),
    formFor: index => body()[index * 2 + 1].all().find(el => el.tagName === 'FORM'),
    hostedRows: () => ids['studio-hosted-rows'].children.filter(el => el.className === 'studio-row'),
    invoiceFormFor: index => body()[index * 2 + 1].all().find(el => el.className.includes('studio-invoice-form')),
    grantFormFor: index => body()[index * 2 + 1].all().find(el => el.className.includes('studio-grant-form')),
    referralFormFor: index => body()[index * 2 + 1].all().find(el => el.className.includes('studio-referral-form')),
    text: () => Object.values(ids).flatMap(el => [el, ...el.all()]).map(el => el.textContent).filter(Boolean).join(' | '),
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}

test('a studio member sees the summary, the three accounts and the shared status words', async () => {
  const h = await load();
  assert.equal(h.ids['studio-desk'].hidden, false);
  assert.equal(h.ids['studio-gate'].hidden, true);
  assert.equal(h.ids['studio-summary'].textContent,
    '3 accounts · 1 in free months · 1 on the plan · 3 walkthroughs ready for review · 2 processing · 1 unverified App Store');
  const rows = h.dataRows();
  assert.equal(rows.length, 3);
  const statuses = rows.map(row => row.children[COL.status].textContent);
  assert.ok(statuses.some(text => /^Free until \d/.test(text)));
  assert.ok(statuses.includes('Office · A$599 a month'));
  assert.ok(statuses.includes('Plan not started'));
  // Newest activity first, and an account without an owner name shows a dash.
  assert.deepEqual(rows.map(row => row.children[COL.account].children[0].textContent),
    ['Northgate Property Co', 'Wren & Fielding', 'Kelvin Grove Dental']);
  assert.match(rows[2].children[COL.account].children[1].textContent, /^— · 2 members$/);
  assert.deepEqual(rows[2].children[COL.freeMonths].children.map(el => el.textContent), ['not started', '3 free months with 6 walkthroughs']);
  assert.deepEqual(rows[0].children[COL.thisMonth].children.map(el => el.textContent), ['2 / 3', ''], 'a retired plan states no v8 allowance rule');
  assert.equal(rows[1].children[COL.total].textContent, '18');
  assert.equal(rows[1].children[COL.walkthroughs].textContent, '2 / 0');
  assert.equal(rows[2].children[COL.note].textContent, '—');
  const activity = rows[0].children[COL.activity];
  assert.ok(activity.children[0].attributes.datetime, 'the relative time carries its exact moment');
  assert.ok(activity.children[1].textContent.length > 4);
  assert.equal(h.ids['studio-table'].attributes['aria-busy'], 'false');
});

test('the desk says where each account is billed, how far into its free walkthroughs it is, and whether it renews', async () => {
  const h = await load();
  const rows = h.dataRows();
  const source = index => rows[index].children[COL.source].children.map(el => el.textContent);
  assert.deepEqual(source(0), ['App Store', 'unverified'], 'an unconfirmed Apple purchase says so');
  assert.deepEqual(source(1), ['Studio', '']);
  assert.deepEqual(source(2), ['Website', '']);
  // The allowance is the row's own: six for running and new free months, and the
  // four an account kept when its free months ended before the offer changed.
  assert.equal(offer.freeMonths.includedWalkthroughs, 6);
  const free = index => rows[index].children[COL.freeWalkthroughs].children.map(el => el.textContent);
  assert.deepEqual(free(0), ['3 / 6', '']);
  assert.deepEqual(free(1), ['4 / 4', '2 beyond included; check agreed billing']);
  assert.deepEqual(free(2), ['0 / 6', '']);
  assert.deepEqual(rows.map(row => row.children[COL.autoRenew].textContent), ['yes', 'yes', 'no']);
  assert.equal(rows[1].children[COL.renews].textContent, '5 Oct 2026', 'an active plan renews at its period end');
  assert.equal(rows[0].children[COL.renews].textContent, '1 Jan 2027', 'free months renew when they end');
  assert.equal(rows[2].children[COL.renews].textContent, '—');
  // Apple's price is the only price an App Store account is shown.
  assert.match(rows[0].children[COL.status].textContent, /^Free until /);
  const verified = await load({ accounts: accounts().map(row => ({ ...row, apple_verified: true })) });
  assert.match(verified.ids['studio-summary'].textContent, /0 unverified App Store$/);
  assert.deepEqual(verified.dataRows()[0].children[COL.source].children.map(el => el.textContent), ['App Store', 'verified']);
});

test('a signed-in outsider is refused and no account is ever listed to them', async () => {
  const h = await load({ rpc: { studio_is_member: async () => ({ data: false }) } });
  assert.equal(h.ids['studio-gate'].hidden, false);
  assert.equal(h.ids['studio-desk'].hidden, true);
  assert.match(h.ids['studio-gate-body'].textContent, /^This desk is for the Veylet studio\./);
  assert.match(h.ids['studio-gate-body'].textContent, /not a studio member, so no account is listed/);
  assert.equal(h.ids['studio-gate-link'].hidden, false);
  assert.equal(h.ids['studio-gate-retry'].hidden, true);
  // A refusal that names no way back is a dead end; the studio's address is it.
  assert.equal(h.ids['studio-gate-ask'].hidden, false);
  assert.equal(h.calls.some(([name]) => name === 'studio_list_accounts'), false);
  assert.equal(h.ids['studio-rows'].children.length, 0);
  assert.doesNotMatch(h.text(), /Northgate|Wren|Kelvin/);
});

test('an unanswered studio check is unavailable, not a refusal and not an approval', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { data: null }, { data: 'yes' }]) {
    const h = await load({ rpc: { studio_is_member: async () => reply } });
    assert.equal(h.ids['studio-desk'].hidden, true);
    assert.equal(h.calls.some(([name]) => name === 'studio_list_accounts'), false);
    assert.doesNotMatch(h.text(), /Northgate/);
  }
  const unavailable = await load({ rpc: { studio_is_member: async () => ({ error: { message: 'offline' } }) } });
  assert.match(unavailable.ids['studio-gate-body'].textContent, /could not be checked/);
  assert.equal(unavailable.ids['studio-gate-retry'].hidden, false);
  assert.equal(unavailable.ids['studio-gate-link'].hidden, true);
  await unavailable.ids['studio-gate-retry'].fire('click');
  await unavailable.settle();
  assert.equal(unavailable.calls.filter(([name]) => name === 'studio_is_member').length, 2);
});

test('without a session the desk sends you to the account page and checks nothing', async () => {
  const h = await load({ signedOut: true });
  assert.equal(h.ids['studio-gate-body'].textContent, 'Sign in on your account page first.');
  assert.equal(h.ids['studio-gate-link'].hidden, false);
  assert.equal(h.calls.length, 0);
});

test('a failed account list is a failed request, never an empty studio', async () => {
  const h = await load({ rpc: { studio_list_accounts: async () => ({ error: { message: 'offline' } }) } });
  const state = h.ids['studio-rows'].children[0];
  assert.match(state.all()[0].textContent, /failed request, not an empty studio/);
  assert.doesNotMatch(h.text(), /No accounts yet/);
  const retry = state.all().find(el => el.textContent === 'Retry');
  assert.ok(retry);
  await retry.fire('click');
  await h.settle();
  assert.equal(h.calls.filter(([name]) => name === 'studio_list_accounts').length, 2);
});

test('an empty studio says so plainly', async () => {
  const h = await load({ accounts: [] });
  const empty = h.ids['studio-rows'].children[0].all()[0];
  assert.match(empty.textContent, /^No accounts yet\./);
  // An empty studio says what would put a row here, and offers no false action.
  assert.match(empty.textContent, /once someone signs in and the studio creates its workspace/);
  assert.equal(empty.children.length, 0);
  assert.match(h.ids['studio-summary'].textContent, /^0 accounts · 0 in free months/);
});

test('the accounts wait as rows, not as a spinner', async () => {
  let finish;
  const h = await load({ rpc: { studio_list_accounts: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(h.ids['studio-table'].attributes['aria-busy'], 'true');
  const skeleton = h.ids['studio-rows'].children;
  assert.equal(skeleton.length, 3);
  assert.equal(skeleton.every(row => row.className.includes('studio-skeleton')), true);
  assert.equal(skeleton[0].children.length, 12);
  assert.match(h.ids['studio-summary'].textContent, /Counting accounts/);
  finish({ data: accounts() });
  await h.settle();
  assert.equal(h.dataRows().length, 3);
});

test('the status filter, the name filter and both sorts change only what is shown', async () => {
  const h = await load();
  h.ids['studio-filter-status'].value = 'active';
  await h.ids['studio-filter-status'].fire('change');
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent), ['Wren & Fielding']);
  assert.match(h.ids['studio-summary'].textContent, /· showing 1$/);
  h.ids['studio-filter-status'].value = 'all';
  h.ids['studio-filter-name'].value = 'kelvin';
  await h.ids['studio-filter-name'].fire('input');
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent), ['Kelvin Grove Dental']);
  h.ids['studio-filter-name'].value = 'nothing here';
  await h.ids['studio-filter-name'].fire('input');
  assert.match(h.ids['studio-rows'].children[0].all()[0].textContent, /^No account matches this filter\./);
  h.ids['studio-filter-name'].value = '';
  await h.ids['studio-filter-name'].fire('input');
  // Reversing the active sort, then sorting by the end of the free months.
  await h.ids['studio-sort-activity'].fire('click');
  assert.equal(h.ids['studio-sort-activity'].dataset.direction, 'asc');
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent),
    ['Kelvin Grove Dental', 'Wren & Fielding', 'Northgate Property Co']);
  await h.ids['studio-sort-trial'].fire('click');
  assert.equal(h.ids['studio-sort-trial'].attributes['aria-pressed'], 'true');
  assert.equal(h.ids['studio-sort-activity'].attributes['aria-pressed'], 'false');
  assert.equal(h.ids['studio-th-trial'].attributes['aria-sort'], 'descending');
  // An account with no free-months end sorts last rather than first.
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent),
    ['Northgate Property Co', 'Wren & Fielding', 'Kelvin Grove Dental']);
  assert.equal(h.calls.filter(([name]) => name === 'studio_list_accounts').length, 1, 'filtering does not re-read the studio');
});

test('setting a plan sends the chosen arguments and repaints that row from the answer', async () => {
  const h = await load({ accounts: studioAccounts() });
  const form = h.formFor(2);
  const radios = form.all().filter(el => el.type === 'radio');
  assert.deepEqual(radios.map(el => el.value), ['pending', 'trial', 'active', 'ended']);
  assert.deepEqual(radios.map(el => el.checked), [true, false, false, false]);
  const [months, included] = form.all().filter(el => el.type === 'number');
  assert.equal(months.value, '3');
  assert.equal(months.min, '1');
  assert.equal(months.max, '12');
  // The allowance is what the offer caps, so the desk sets it explicitly.
  assert.equal(included.value, '6');
  assert.equal(included.min, '1');
  assert.equal(included.max, '24');
  const selects = form.all().filter(el => el.tagName === 'SELECT');
  // The one plan on sale, plus this account's own retired plan and no other.
  assert.deepEqual(selects.map(select => select.children.map(option => option.value)),
    [['studio', 'apple', 'web'], ['solo', 'studio']]);
  assert.deepEqual(selects[1].children.map(option => option.textContent), ['Veylet plan', 'Team (retired, existing terms)']);
  assert.deepEqual(selects.map(select => select.value), ['studio', 'studio'], 'the form opens on what the row says');
  assert.equal(selects[0].disabled, true, 'the source cannot be changed by a status form');
  const renews = form.all().find(el => el.type === 'checkbox');
  assert.equal(renews.checked, false, 'the checkbox mirrors the row, not a wish');
  radios[1].checked = true; radios[0].checked = false;
  months.value = '4';
  included.value = '5';
  renews.checked = true;
  form.all().find(el => el.type === 'date').value = '2026-09-01';
  form.all().find(el => el.tagName === 'TEXTAREA').value = 'Free months agreed by email.';
  await form.fire('submit');
  await h.settle();
  // Saving without touching the plan keeps the account's existing terms.
  assert.deepEqual({ ...h.calls.find(([name]) => name === 'studio_set_plan')[1] }, {
    p_workspace_id: 'ws-kelvin-grove', p_status: 'trial', p_trial_months: 4,
    p_trial_included: 5, p_plan_code: 'studio', p_auto_renews: false,
    p_trial_started_at: '2026-09-01', p_note: 'Free months agreed by email.',
  });
  assert.equal(h.confirms.length, 0, 'starting free months needs no irreversible confirmation');
  const row = h.dataRows()[2];
  assert.match(row.children[COL.status].textContent, /^Free until \d/);
  assert.equal(row.dataset.status, 'trial');
  const result = form.all().find(el => el.className === 'studio-result');
  assert.match(result.textContent, /^Saved: Free until /);
  assert.match(result.textContent, /The stored note is not returned by this call; refresh the accounts to read it back\./);
  assert.match(h.ids['studio-summary'].textContent, /2 in free months/);
  const save = form.all().find(el => el.type === 'submit');
  assert.equal(save.disabled, false);
  assert.equal(save.textContent, 'Save plan');
});

test('an App Store subscription keeps its source: the desk reads it and cannot move it', async () => {
  const h = await load();
  const form = h.formFor(0);
  const source = form.all().find(el => el.tagName === 'SELECT');
  assert.equal(source.value, 'apple');
  assert.equal(source.disabled, true);
  assert.equal(form.all().some(el => el.className === 'studio-field-note' && el.hidden === false), true,
    'the disabled control says why it is disabled');
  for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
  // A disabled control still holds a value; it must not become an argument.
  source.value = 'studio';
  await form.fire('submit');
  await h.settle();
  assert.equal(h.calls.some(([name]) => name === 'studio_set_plan'), false, 'the desk never writes an Apple plan');
  assert.deepEqual(h.dataRows()[0].children[COL.source].children.map(el => el.textContent), ['App Store', 'unverified']);
});

test('ending studio service is confirmed by name and declining leaves it unchanged', async () => {
  for (const accepted of [false, true]) {
    const h = await load({ confirm: accepted });
    const form = h.formFor(1);
    for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'ended';
    await form.fire('submit');
    assert.equal(h.confirms.length, 1);
    assert.match(h.confirms[0], /Wren & Fielding/);
    assert.equal(h.calls.some(([name]) => name === 'studio_set_plan'), accepted);
    assert.equal(h.dataRows()[1].dataset.status, accepted ? 'ended' : 'active');
  }
});

test('the old active selector cannot manufacture paid service', async () => {
  const h = await load({ accounts: studioAccounts() });
  const form = h.formFor(2);
  for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'active';
  await form.fire('submit');
  assert.equal(h.calls.some(([name]) => name === 'studio_set_plan'), false);
  assert.match(form.text(), /Use Record a settled invoice below/);
});

test('an irreversible plan change is refused when no confirmation is possible', async () => {
  const h = await load({ noConfirm: true });
  const form = h.formFor(1);
  for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'ended';
  await form.fire('submit');
  await h.settle();
  assert.equal(h.calls.some(([name]) => name === 'studio_set_plan'), false);
  assert.equal(form.all().find(el => el.className === 'studio-result').textContent, 'Left unchanged.');
  assert.equal(h.dataRows()[1].children[COL.status].textContent, 'Office · A$599 a month');
});

test('an unconfirmed plan write is reported, not assumed', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { data: [] }, { data: [{ status: 'invented' }] }]) {
    const h = await load({ accounts: studioAccounts(), rpc: { studio_set_plan: async () => reply } });
    const form = h.formFor(2);
    for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
    await form.fire('submit');
    await h.settle();
    const result = form.all().find(el => el.className === 'studio-result');
    assert.match(result.textContent, /was not saved, or the result could not be confirmed/);
    assert.equal(h.dataRows()[2].children[COL.status].textContent, 'Plan not started');
    assert.equal(form.all().find(el => el.type === 'submit').disabled, false);
  }
});

test('a plan write that lands after a refresh cannot repaint a replaced row', async () => {
  let finish;
  const h = await load({ accounts: studioAccounts(), rpc: { studio_set_plan: () => new Promise(resolve => { finish = resolve; }) } });
  const form = h.formFor(2);
  for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
  const pending = form.fire('submit');
  await h.ids['studio-refresh'].fire('click');
  await h.settle();
  finish({ data: [planFields({ ...accounts()[2], status: 'trial', trial_ends_at: '2027-03-01T00:00:00Z' })] });
  await pending;
  assert.equal(h.dataRows()[2].children[COL.status].textContent, 'Plan not started');
  assert.match(h.ids['studio-summary'].textContent, /1 in free months/);
});

test('a plan row that cannot state its own date or price reads as unavailable', async () => {
  const broken = accounts().map(row => ({ ...row, trial_ends_at: null, price_aud_cents: null }));
  const h = await load({ accounts: broken });
  const statuses = h.dataRows().map(row => row.children[COL.status].textContent);
  assert.deepEqual(statuses, ['Plan status unavailable', 'Office · confirm billing details', 'Plan not started']);
  assert.doesNotMatch(h.text(), /Free until \s*\||Office · \s*a month/);
  // A retired plan is never renamed to the plan on sale because its price is missing.
  assert.equal(statuses.some(text => /Veylet plan/.test(text)), false);
});

test('the Set plan disclosure and its legend both name the account being changed', async () => {
  const h = await load();
  const names = ['Northgate Property Co', 'Wren & Fielding', 'Kelvin Grove Dental'];
  for (const [index, name] of names.entries()) {
    const form = h.formFor(index);
    const details = h.ids['studio-rows'].children[index * 2 + 1].all().find(el => el.tagName === 'DETAILS');
    assert.equal(details.all().find(el => el.tagName === 'SUMMARY').textContent, 'Set plan · ' + name);
    assert.equal(form.all().find(el => el.tagName === 'LEGEND').textContent, 'Status for ' + name);
  }
});

test('the radios offer the short state words, not a second vocabulary', async () => {
  const h = await load();
  const form = h.formFor(0);
  const labels = form.all().filter(el => el.type === 'radio')
    .map(input => form.all().find(el => el.children.includes(input)).all().find(el => el.tagName === 'SPAN').textContent);
  assert.deepEqual(labels, ['Not started', 'Free months', 'Active', 'Ended']);
  assert.doesNotMatch(script, /Trial — in free months|Ended — free months finished|Pending — free/);
});

test('filtering during the first load keeps the rows that are coming', async () => {
  let finish;
  const h = await load({ rpc: { studio_list_accounts: () => new Promise(resolve => { finish = resolve; }) } });
  h.ids['studio-filter-name'].value = 'north';
  await h.ids['studio-filter-name'].fire('input');
  h.ids['studio-filter-status'].value = 'active';
  await h.ids['studio-filter-status'].fire('change');
  await h.ids['studio-sort-trial'].fire('click');
  const waiting = h.ids['studio-rows'].children;
  assert.equal(waiting.every(row => row.className.includes('studio-skeleton')), true, 'still the skeleton');
  assert.doesNotMatch(h.text(), /No accounts yet|No account matches/);
  assert.equal(h.ids['studio-table'].attributes['aria-busy'], 'true');
  finish({ data: accounts() });
  await h.settle();
  // The filters typed while waiting are applied to the first answer.
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent), []);
  assert.match(h.ids['studio-rows'].children[0].all()[0].textContent, /^No account matches this filter\./);
});

test('the accounts region becomes a tab stop exactly while it is cut off', async () => {
  const h = await load();
  const wrap = h.ids['studio-table-wrap'];
  const hint = h.ids['studio-scroll-hint'];
  assert.equal(wrap.attributes.tabindex, undefined, 'a table that fits adds no tab stop');
  assert.equal(hint.hidden, true);
  wrap.clientWidth = 720; wrap.scrollWidth = 1168;
  await h.ids['studio-refresh'].fire('click');
  await h.settle();
  assert.equal(wrap.attributes.tabindex, '0');
  assert.equal(hint.hidden, false);
  // The visible width is published so the Set plan form can fit inside it.
  assert.equal(wrap.style.properties['--studio-view'], '720px');
  wrap.scrollWidth = 720;
  await h.ids['studio-refresh'].fire('click');
  await h.settle();
  assert.equal(wrap.attributes.tabindex, undefined);
  assert.equal(hint.hidden, true);
});

test('a filter that matches nothing offers the way back to every account', async () => {
  const h = await load();
  h.ids['studio-filter-name'].value = 'nothing-matches-this';
  await h.ids['studio-filter-name'].fire('input');
  const empty = h.ids['studio-rows'].children[0].all()[0];
  assert.match(empty.textContent, /^No account matches this filter\./);
  const clear = empty.children.find(el => el.tagName === 'BUTTON');
  assert.equal(clear.textContent, 'Clear the filters');
  await clear.fire('click');
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent),
    ['Northgate Property Co', 'Wren & Fielding', 'Kelvin Grove Dental']);
  assert.equal(h.ids['studio-filter-name'].value, '');
  assert.equal(h.ids['studio-filter-name'].wasFocused, true);
  // Clearing a filter is a view change, not a new request.
  assert.equal(h.calls.filter(([name]) => name === 'studio_list_accounts').length, 1);
});

test('a refresh keeps the skeleton rather than briefly emptying the studio', async () => {
  let finish;
  let first = true;
  const h = await load({ rpc: { studio_list_accounts: () => first
    ? Promise.resolve({ data: accounts() }) : new Promise(resolve => { finish = resolve; }) } });
  assert.equal(h.dataRows().length, 3);
  first = false;
  await h.ids['studio-refresh'].fire('click');
  await h.settle();
  assert.equal(h.ids['studio-rows'].children.every(row => row.className.includes('studio-skeleton')), true);
  await h.ids['studio-sort-activity'].fire('click');
  assert.equal(h.ids['studio-rows'].children.every(row => row.className.includes('studio-skeleton')), true);
  finish({ data: accounts() });
  await h.settle();
  assert.equal(h.dataRows().length, 3);
});

/* ---- Deletion requests ------------------------------------------------
 * Accounts that asked to be deleted, above the table because they are the only
 * rows here with a clock on them. This desk lists them; the CLI deletes.
 */
const deletionRequests = () => [
  { user_id: 'aaaaaaaa-1111-4222-8333-444444444444', requested_at: '2026-09-20T04:30:00Z',
    reason: 'Sold the agency; the new owner uses their own tools.', status: 'requested',
    workspace_names: ['Northgate Property Co'], property_count: 4, tour_count: 6, active_share_count: 2 },
  { user_id: 'bbbbbbbb-1111-4222-8333-444444444444', requested_at: '2026-09-21T22:05:00Z',
    reason: null, status: 'requested', workspace_names: ['Kelvin Grove Dental', 'Kelvin Grove Rooms'],
    property_count: 2, tour_count: 1, active_share_count: 0 },
];
const NEXT_STEP = 'Complete with the deletion CLI; the desk does not delete.';
const shortDate = value => new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const deletionsText = h => h.ids['studio-deletions'].all().map(el => el.textContent).filter(Boolean).join(' | ');
const deletionItems = h => h.ids['studio-deletions'].all().filter(el => el.className === 'studio-deletion');

test('a studio with nothing to delete says so in one line', async () => {
  const h = await load();
  assert.equal(h.ids['studio-deletions'].children.length, 1);
  assert.equal(h.ids['studio-deletions'].children[0].textContent, 'No deletion requests.');
  assert.doesNotMatch(deletionsText(h), /Deletion requests/);
  assert.equal(deletionItems(h).length, 0);
});

test('deletion requests are listed above the accounts table with their counts, reason and next step', async () => {
  const h = await load({ deletions: deletionRequests() });
  const heading = h.ids['studio-deletions'].children[0];
  assert.equal(heading.tagName, 'H2');
  assert.equal(heading.textContent, 'Deletion requests');
  const items = deletionItems(h);
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].textContent, 'Northgate Property Co');
  // Several workspaces belong to one person, and the row names all of them.
  assert.equal(items[1].children[0].textContent, 'Kelvin Grove Dental · Kelvin Grove Rooms');
  const rows = item => item.all().filter(el => el.tagName === 'DIV')
    .map(group => group.children.map(el => el.textContent));
  assert.deepEqual(rows(items[0]), [
    ['Requested', shortDate('2026-09-20T04:30:00Z')],
    ['Status', 'Requested'],
    ['Account id', 'aaaaaaaa-1111-4222-8333-444444444444'],
    ['Spaces', '4'],
    ['Walkthroughs', '6'],
    ['Live links', '2'],
    ['Reason', 'Sold the agency; the new owner uses their own tools.'],
    ['Next step', NEXT_STEP],
  ]);
  // A request with no reason says so rather than leaving the row blank.
  assert.deepEqual(rows(items[1])[6], ['Reason', '—']);
  assert.deepEqual(rows(items[1])[5], ['Live links', '0']);
  // The desk lists and explains; it never offers to delete anything itself.
  assert.equal(h.ids['studio-deletions'].all().some(el => el.tagName === 'BUTTON'), false);
  assert.equal(deletionsText(h).split(NEXT_STEP).length - 1, 2, 'every row carries the next step');
  assert.equal(h.calls.some(([name]) => /delete_account|studio_delete/.test(name)), false);
});

test('a failed deletion lookup is a failed request, never an empty list', async () => {
  const h = await load({ rpc: { studio_list_deletion_requests: async () => ({ error: { message: 'offline' } }) } });
  assert.match(deletionsText(h), /failed request, not an empty list/);
  assert.doesNotMatch(deletionsText(h), /No deletion requests\./);
  const retry = h.ids['studio-deletions'].all().find(el => el.textContent === 'Retry');
  assert.ok(retry);
  await retry.fire('click');
  await h.settle();
  assert.equal(h.calls.filter(([name]) => name === 'studio_list_deletion_requests').length, 2);
});

test('the deletion band waits as its own line and never blocks the accounts table', async () => {
  let finish;
  const h = await load({ rpc: { studio_list_deletion_requests: () => new Promise(resolve => { finish = resolve; }) } });
  assert.match(deletionsText(h), /Checking for deletion requests/);
  assert.equal(h.dataRows().length, 3, 'the accounts arrive without waiting for the deletion check');
  finish({ data: deletionRequests() });
  await h.settle();
  assert.equal(deletionItems(h).length, 2);
});

test('the deletion band sits above the accounts table and clears on sign-out', async () => {
  assert.ok(markup.indexOf('id="studio-deletions"') < markup.indexOf('class="studio-controls"'));
  assert.ok(markup.indexOf('id="studio-deletions"') < markup.indexOf('id="studio-table-wrap"'));
  assert.match(markup, /<section class="studio-deletions" id="studio-deletions" aria-label="Deletion requests" aria-live="polite"><\/section>/);
  assert.match(styles, /\.studio-deletions:empty \{\s*display: none;/);
  const h = await load({ deletions: deletionRequests() });
  assert.ok(h.ids['studio-deletions'].children.length);
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['studio-deletions'].children.length, 0);
  // Nothing about a deletion is listed to someone the desk has refused.
  const outsider = await load({ rpc: { studio_is_member: async () => ({ data: false }) } });
  assert.equal(outsider.calls.some(([name]) => name === 'studio_list_deletion_requests'), false);
  assert.equal(outsider.ids['studio-deletions'].children.length, 0);
});

test('the studio next step is written once, and the desk never claims to delete', () => {
  assert.equal(script.split(NEXT_STEP).length - 1, 1);
  assert.equal(script.split("'No deletion requests.'").length - 1, 1);
  assert.equal(script.split("'Deletion requests'").length - 1, 1);
  assert.doesNotMatch(script, /delete_account|studio_delete_/);
  assert.match(markup, /Read-only except\s*\n?\s*for Set plan/);
});


// The App Store sells monthly only (offer 2026-09-24.1), but an existing verified row for an annual
// product still reads with the price Apple recorded for it.
test('studio distinguishes annual renewals from monthly capacity and does not invent legacy annual totals', async () => {
  const rows = accounts();
  rows[1] = { ...rows[1], source: 'apple', apple_verified: true,
    plan_code: 'studio', apple_product_id: 'dev.property3d.capture.plan.annual', billing_interval: 'annual', renewal_price_aud_cents: 318999 };
  const annual = await load({ accounts: rows });
  assert.equal(annual.dataRows()[1].children[COL.status].textContent, 'Team · A$3,189.99 a year');
  delete rows[1].renewal_price_aud_cents;
  const legacy = await load({ accounts: rows });
  assert.equal(legacy.dataRows()[1].children[COL.status].textContent, 'Team · confirm billing details');
  assert.doesNotMatch(legacy.dataRows()[1].children[COL.status].textContent, /219\.99/);
});

/* ---- Record a settled invoice -------------------------------------------
 * Offer 2026-09-25.1: exactly four items and no retired plan. The Veylet plan
 * for one month (A$79) or one year at the one public annual price (A$790, no
 * tier); or a walkthrough pack of 3 or 10. Every amount is read from offer.json.
 */
const INVOICE_CHOICES = ['solo-monthly', 'solo-annual', 'pack3', 'pack10'];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const soon = days => new Date(Date.now() + days * 86400000).toISOString();
const longDate = value => new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
// One account on its own, so the form under test is always the first row's.
const oneAccount = (extra = {}) => [{ ...studioAccounts()[2], workspace_id: 'ws-harbour', workspace_name: 'Harbour Realty', ...extra }];
const runningFreeMonths = { status: 'trial', trial_started_at: soon(-30), trial_ends_at: soon(150), accepted_in_free_months: 1 };
const activePlan = { status: 'active', plan_code: 'solo', price_aud_cents: OFFER.month, billing_interval: 'monthly',
  trial_started_at: soon(-220), trial_ends_at: soon(-40), current_period_ends_at: soon(20) };
const fieldsOf = form => Object.fromEntries(form.all().filter(el => el.name).map(el => [el.name, el]));
const labelOf = (form, input) => form.all().find(el => el.tagName === 'LABEL' && el.children.includes(input));
const resultOf = form => form.all().find(el => el.className === 'studio-result').textContent;
const submitOf = form => form.all().find(el => el.type === 'submit');

function prepareInvoice(h, { item = 'solo-monthly', index = 2 } = {}) {
  const form = h.invoiceFormFor(index);
  const fields = fieldsOf(form);
  fields.item.value = item;
  fields.item.events.change();
  fields.period_start.value = new Date().toISOString().slice(0, 10);
  fields.agreement_id.value = 'agreement-001';
  fields.settlement_id.value = 'settled-line-001';
  fields.receipt_key.value = 'invoice-plan-001';
  fields.period_start.events.change();
  return { form, fields };
}
// The billing row studio_activate_invoice_plan answers with: the one price for the cadence.
const invoiceResponse = (args, extra = {}) => ({ data: [planFields({ ...studioAccounts()[2], status: 'active',
  plan_code: args.p_plan_code, source: 'studio', billing_interval: args.p_billing_interval,
  renewal_price_aud_cents: args.p_billing_interval === 'annual' ? OFFER.year : OFFER.month,
  current_period_ends_at: args.p_period_end, auto_renews: false, ...extra })] });
// The proposed studio_record_pack_invoice answer: exactly what was credited.
const packResponse = (args, extra = {}) => ({ data: [{ credited: OFFER.packs[args.p_pack_code].walkthroughs,
  credits_available: OFFER.packs[args.p_pack_code].walkthroughs + 2, amount_cents: OFFER.packs[args.p_pack_code].cents,
  expires_on: '2027-09-24', ...extra }] });
const EARLY_BONUS_WORDS = 'the server adds the early-annual bonus, once per workspace: ' + OFFER.earlyBonus +
  ' bonus walkthroughs and ' + OFFER.earlyExpress + ' Super fast renders in the first plan year (' + (OFFER.yearlyPool + OFFER.earlyBonus) + ' walkthroughs in total).';

test('a settled invoice offers exactly four items, priced from the canonical offer, and no retired plan', async () => {
  assert.equal(soloPlan.code, 'solo');
  assert.equal(soloPlan.name, 'Veylet plan');
  assert.deepEqual(offer.packs.map(pack => pack.code), ['pack3', 'pack10']);
  assert.deepEqual([OFFER.month, OFFER.year, OFFER.packs.pack3.cents, OFFER.packs.pack10.cents], [9900, 99000, 16900, 49900]);
  assert.deepEqual([OFFER.monthlyIncluded, OFFER.rolloverMax, OFFER.yearlyPool, OFFER.earlyBonus, OFFER.earlyExpress], [2, 4, 24, 4, 4]);
  const h = await load({ accounts: studioAccounts() });
  const { fields } = prepareInvoice(h);
  assert.equal(fields.item.tagName, 'SELECT', 'one native select');
  // The plan items read exactly as the plan panel will then read the plan.
  assert.deepEqual(fields.item.children.map(option => [option.value, option.textContent]), [
    ['solo-monthly', 'Veylet plan · ' + aud(OFFER.month) + ' a month'],
    ['solo-annual', 'Veylet plan · ' + aud(OFFER.year) + ' a year'],
    ['pack3', 'Walkthrough pack · 3 walkthroughs (' + aud(OFFER.packs.pack3.cents) + ')'],
    ['pack10', 'Walkthrough pack · 10 walkthroughs (' + aud(OFFER.packs.pack10.cents) + ')'],
  ]);
  // No retired plan is a choice on any row, whatever that row's own plan is.
  for (const index of [0, 1, 2]) {
    const item = fieldsOf(h.invoiceFormFor(index)).item;
    assert.deepEqual(item.children.map(option => option.value), INVOICE_CHOICES);
    assert.doesNotMatch(item.children.map(option => option.textContent).join(' '), /Team|Office|One walkthrough|[Ff]ounding|Solo|members/);
  }
  assert.equal(Object.hasOwn(fields, 'plan_code'), false);
  assert.equal(Object.hasOwn(fields, 'billing_interval'), false);
  // The v8 desk reads no annual tier and has no tier control.
  assert.equal(h.calls.some(([name]) => /tier/.test(name)), false);
  assert.doesNotMatch(markup, /tier/i);
});

test('a Veylet plan month is recorded at 9900 cents with exact references and dates, 2 a month and rollover stated, and no auto-renewal', async () => {
  const h = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => invoiceResponse(args) } });
  const { form, fields } = prepareInvoice(h);
  assert.ok(form.text().includes(aud(OFFER.month) + ' for this invoice: one month of the Veylet plan. ' + OFFER.monthlyIncluded + ' walkthroughs a month; unused ones roll over, up to ' +
    OFFER.rolloverMax + ' banked. No automatic renewal.'));
  assert.equal(labelOf(form, fields.period_start).hidden, false);
  assert.equal(fields.period_end.readOnly, true, 'the end is derived, not typed');
  await form.fire('submit');
  const args = h.calls.find(([name]) => name === 'studio_activate_invoice_plan')[1];
  assert.deepEqual({ ...args }, { p_workspace_id: 'ws-kelvin-grove', p_plan_code: 'solo', p_billing_interval: 'monthly',
    p_period_start: fields.period_start.value + 'T00:00:00.000Z', p_period_end: fields.period_end.value + 'T00:00:00.000Z',
    p_agreement_id: 'agreement-001', p_settlement_id: 'settled-line-001', p_receipt_key: 'invoice-plan-001' });
  assert.equal(Object.hasOwn(args, 'p_auto_renews'), false);
  assert.ok(h.confirms[0].startsWith('Record ' + aud(OFFER.month) + ' already settled for Kelvin Grove Dental, Veylet plan one month, '));
  assert.doesNotMatch(h.confirms[0], /early-annual/);
  assert.match(form.text(), new RegExp('Recorded: ' + escape(aud(OFFER.month)) + ' a month, ending '));
  assert.equal(h.dataRows()[2].dataset.status, 'active');
  assert.equal(h.dataRows()[2].children[COL.status].textContent, 'Veylet plan · ' + aud(OFFER.month) + ' a month');
  assert.equal(submitOf(form).disabled, true, 'a current paid period blocks a second plan invoice');
});

test('a Veylet plan year is recorded at the one public price, 99000 cents, with no tier read', async () => {
  const h = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => invoiceResponse(args) } });
  const { form, fields } = prepareInvoice(h, { item: 'solo-annual' });
  const amount = aud(OFFER.year);
  const saving = aud(12 * OFFER.month - OFFER.year);
  assert.equal(saving, 'A$198', 'two months free is A$198 against 12 monthly invoices');
  assert.ok(form.text().includes(amount + ' for this invoice: one year of the Veylet plan, 2 months free (' + saving +
    ' less than 12 monthly payments of ' + aud(OFFER.month) + '). ' + OFFER.yearlyPool +
    ' walkthroughs a year to use any time: a yearly pool, no monthly limit, reset at each plan-year anniversary, no rollover between years. No automatic renewal.'));
  // Not in free months, so no early-annual bonus is mentioned anywhere.
  assert.doesNotMatch(form.text(), /early-annual|members' annual|one accepted walkthrough/);
  const start = new Date(fields.period_start.value + 'T00:00:00Z');
  const end = new Date(fields.period_end.value + 'T00:00:00Z');
  assert.equal(end.getUTCFullYear() - start.getUTCFullYear(), 1, 'one UTC year');
  await form.fire('submit');
  const args = h.calls.find(([name]) => name === 'studio_activate_invoice_plan')[1];
  assert.deepEqual([args.p_plan_code, args.p_billing_interval, args.p_period_start, args.p_period_end],
    ['solo', 'annual', fields.period_start.value + 'T00:00:00.000Z', fields.period_end.value + 'T00:00:00.000Z']);
  assert.ok(h.confirms[0].startsWith('Record ' + amount + ' already settled for Kelvin Grove Dental, Veylet plan annual, '));
  assert.doesNotMatch(h.confirms[0], /early-annual/);
  assert.match(form.text(), new RegExp('Recorded: ' + escape(amount) + ' a year, ending '));
  assert.equal(h.dataRows()[2].children[COL.status].textContent, 'Veylet plan · ' + amount + ' a year');
  assert.equal(h.calls.some(([name]) => /tier/.test(name)), false, 'the amount is never looked up');
});

test('an annual answer at any other price is not confirmed', async () => {
  for (const other of [OFFER.year + OFFER.month, OFFER.month, String(OFFER.year), null]) {
    const h = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => invoiceResponse(args, { renewal_price_aud_cents: other }) } });
    const { form } = prepareInvoice(h, { item: 'solo-annual' });
    await form.fire('submit');
    assert.match(form.text(), /Paid service was not confirmed/, String(other));
    assert.equal(h.dataRows()[2].dataset.status, 'pending');
  }
});

test('while the free months run no plan invoice is recorded; the annual says to record it once they end, starting that day', async () => {
  const rows = oneAccount({ source: 'studio', ...runningFreeMonths });
  const h = await load({ accounts: rows, rpc: { studio_activate_invoice_plan: async args => invoiceResponse(args) } });
  const annual = prepareInvoice(h, { item: 'solo-annual', index: 0 });
  assert.equal(submitOf(annual.form).disabled, true);
  assert.ok(annual.form.text().includes('The free months are still running. Record the annual once they end on ' + longDate(rows[0].trial_ends_at) +
    ', starting that day: the server then adds the ' + OFFER.earlyBonus + ' bonus walkthroughs (' + (OFFER.yearlyPool + OFFER.earlyBonus) +
    ' in the first plan year) and ' + OFFER.earlyExpress + ' Super fast renders, once per workspace. A walkthrough pack can be recorded now.'));
  await annual.form.fire('submit');
  const monthly = prepareInvoice(h, { item: 'solo-monthly', index: 0 });
  assert.equal(submitOf(monthly.form).disabled, true);
  assert.ok(monthly.form.text().includes('The free months are still running. An early paid switch is not available: record the plan once they end on ' +
    longDate(rows[0].trial_ends_at) + ', or a walkthrough pack now.'));
  await monthly.form.fire('submit');
  assert.equal(h.calls.some(([name]) => name === 'studio_activate_invoice_plan'), false, 'the server would refuse it, so nothing is sent');
  // A pack is still open during the free months.
  const pack = prepareInvoice(h, { item: 'pack3', index: 0 });
  assert.equal(submitOf(pack.form).disabled, false);
});

test('once the free months end, the annual start is offered from that day, where the server adds the early-annual bonus', async () => {
  const endedAt = new Date(Date.now() - 3 * 86400000); endedAt.setUTCHours(3, 12, 0, 0);
  const endsAt = endedAt.toISOString();
  const endDay = endsAt.slice(0, 10);
  const rows = oneAccount({ source: 'studio', status: 'ended', trial_started_at: soon(-95), trial_ends_at: endsAt, accepted_in_free_months: 6, current_period_ends_at: null });
  const h = await load({ accounts: rows, rpc: { studio_activate_invoice_plan: async args => ({ data: [planFields({ ...rows[0], status: 'active', plan_code: 'solo',
    source: 'studio', billing_interval: 'annual', renewal_price_aud_cents: OFFER.year, current_period_ends_at: args.p_period_end, auto_renews: false })] }) } });
  const form = h.invoiceFormFor(0);
  const fields = fieldsOf(form);
  fields.item.value = 'solo-annual'; fields.item.events.change();
  assert.equal(fields.period_start.value, endDay, 'the start is offered from the day the free months ended');
  const yearOn = new Date(endDay + 'T00:00:00Z'); yearOn.setUTCFullYear(yearOn.getUTCFullYear() + 1);
  assert.equal(fields.period_end.value, yearOn.toISOString().slice(0, 10));
  const bonus = EARLY_BONUS_WORDS;
  assert.ok(form.text().includes('This year starts where the free months ended (' + longDate(endsAt) + '), so ' + bonus));
  // A later start is the studio's call; then the bonus is only said conditionally.
  fields.period_start.value = new Date().toISOString().slice(0, 10); fields.period_start.events.change();
  assert.ok(form.text().includes('Started on the day the free months ended (' + longDate(endsAt) + '), ' + bonus));
  fields.period_start.value = endDay; fields.period_start.events.change();
  fields.agreement_id.value = 'agreement-001';
  fields.settlement_id.value = 'settled-line-001'; fields.receipt_key.value = 'invoice-plan-001';
  await form.fire('submit');
  const args = h.calls.find(([name]) => name === 'studio_activate_invoice_plan')[1];
  assert.deepEqual([args.p_billing_interval, args.p_period_start, args.p_period_end], ['annual', endDay + 'T00:00:00.000Z', yearOn.toISOString()]);
  assert.ok(h.confirms[0].includes(' UTC? It starts where the free months ended, so ' + bonus));
  // Informational only: the desk makes no grant of its own.
  assert.deepEqual(h.calls.filter(([name]) => !/^studio_(?:is_member|list_|money_|capture_|express_queue)/.test(name)).map(([name]) => name), ['studio_activate_invoice_plan']);
  assert.equal(resultOf(form), 'Recorded: ' + aud(OFFER.year) + ' a year, ending ' + longDate(yearOn.toISOString()) + '. It started where the free months ended, so ' + bonus + ' No automatic renewal.');
});

test('the annual start is not offered, and no bonus is said, when that day has passed its window, a paid period exists or the plan is billed elsewhere', async () => {
  const cases = [
    ['long ago', { source: 'studio', status: 'ended', trial_started_at: soon(-500), trial_ends_at: soon(-400), current_period_ends_at: null }],
    ['had a paid period', { source: 'studio', status: 'ended', trial_started_at: soon(-150), trial_ends_at: soon(-60), current_period_ends_at: soon(-30) }],
    ['never started', { source: 'studio', status: 'pending', trial_started_at: null, trial_ends_at: null }],
  ];
  for (const [kind, extra] of cases) {
    const h = await load({ accounts: oneAccount(extra) });
    const form = h.invoiceFormFor(0);
    const fields = fieldsOf(form);
    fields.item.value = 'solo-annual'; fields.item.events.change();
    assert.equal(fields.period_start.value, '', kind);
    assert.doesNotMatch(form.text(), /early-annual/, kind);
  }
  const apple = await load({ accounts: oneAccount({ source: 'apple', apple_verified: true, plan_code: 'solo', apple_product_id: 'dev.property3d.capture.solo.monthly', ...runningFreeMonths }) });
  const store = prepareInvoice(apple, { item: 'solo-annual', index: 0 });
  assert.doesNotMatch(store.form.text(), /early-annual/);
  assert.equal(submitOf(store.form).disabled, true);
  assert.match(store.form.text(), /managed by its billing provider/);
});

test('a refusal the database answers with is shown and frees the form; a lost answer keeps the stable intent', async () => {
  let attempt = 0;
  const h = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => ++attempt === 1
    ? { error: { code: 'P0001', message: 'the Veylet plan annual is paused for new sales' } } : invoiceResponse(args) } });
  const { form, fields } = prepareInvoice(h, { item: 'solo-annual' });
  await form.fire('submit');
  assert.equal(resultOf(form), 'Not recorded: the Veylet plan annual is paused for new sales');
  assert.equal(submitOf(form).disabled, false);
  assert.equal(fields.receipt_key.value, 'invoice-plan-001', 'what was typed stays');
  // Nothing was written, so a changed item or receipt may be sent.
  fields.item.value = 'solo-monthly'; fields.item.events.change();
  await form.fire('submit');
  assert.equal(attempt, 2);
  assert.match(resultOf(form), new RegExp('^Recorded: ' + escape(aud(OFFER.month)) + ' a month'));
  // An answer as the status still in free months is not paid service.
  const trial = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => invoiceResponse(args, { status: 'trial' }) } });
  const other = prepareInvoice(trial, { item: 'solo-annual' });
  await other.form.fire('submit');
  assert.match(resultOf(other.form), /^Paid service was not confirmed/);
});

test('invoice activation requires all evidence and an explicit confirmation', async () => {
  for (const kind of ['missing-evidence', 'declined']) {
    for (const item of ['solo-monthly', 'pack3']) {
      const rows = item === 'pack3' ? oneAccount({ source: 'studio', ...activePlan }) : studioAccounts();
      const h = await load({ accounts: rows, confirm: kind !== 'declined' });
      const { form, fields } = prepareInvoice(h, { item, index: item === 'pack3' ? 0 : 2 });
      if (kind === 'missing-evidence') fields.settlement_id.value = '';
      await form.fire('submit');
      assert.equal(h.calls.some(([name]) => /studio_activate_invoice_plan|studio_record_pack_invoice/.test(name)), false, kind + ' ' + item);
      assert.match(form.text(), kind === 'declined' ? /Left unchanged/ : /Enter all three opaque evidence references/);
    }
  }
});

test('invoice activation preserves a stable intent after an uncertain reply', async () => {
  let attempt = 0;
  const h = await load({ accounts: studioAccounts(), rpc: { studio_activate_invoice_plan: async args => ++attempt === 1 ? { error: { message: 'offline' } } : invoiceResponse(args) } });
  const { form, fields } = prepareInvoice(h);
  await form.fire('submit');
  assert.match(form.text(), /Paid service was not confirmed/);
  fields.receipt_key.value = 'different-key';
  await form.fire('submit');
  assert.equal(attempt, 1, 'changing an uncertain receipt must not create another intent');
  // Switching to a pack is a different intent too.
  fields.receipt_key.value = 'invoice-plan-001';
  fields.item.value = 'pack3'; fields.item.events.change();
  await form.fire('submit');
  assert.equal(h.calls.some(([name]) => name === 'studio_record_pack_invoice'), false);
  fields.item.value = 'solo-monthly'; fields.item.events.change();
  // A view change rebuilds the rows but keeps the unconfirmed intent.
  h.ids['studio-filter-name'].value = 'kelvin';
  await h.ids['studio-filter-name'].fire('input');
  const rebuilt = prepareInvoice(h, { index: 0 });
  rebuilt.fields.receipt_key.value = 'different-key';
  await rebuilt.form.fire('submit');
  assert.equal(attempt, 1);
  assert.match(rebuilt.form.text(), /The previous result is unconfirmed/);
  rebuilt.fields.receipt_key.value = 'invoice-plan-001';
  await rebuilt.form.fire('submit');
  assert.equal(attempt, 2);
  const writes = h.calls.filter(([name]) => name === 'studio_activate_invoice_plan');
  assert.deepEqual(writes[0][1], writes[1][1]);
  assert.match(rebuilt.form.text(), /Recorded:/);
});

test('store-managed accounts and active free months cannot be overridden by a plan invoice', async () => {
  for (const source of ['apple', 'web', 'studio']) {
    const rows = studioAccounts();
    rows[2].source = source;
    if (source === 'studio') { rows[2].status = 'trial'; rows[2].trial_ends_at = new Date(Date.now() + 86400000).toISOString(); }
    const h = await load({ accounts: rows });
    const { form, fields } = prepareInvoice(h);
    assert.equal(submitOf(form).disabled, true);
    assert.equal(fields.item.disabled, false, 'the item stays choosable, so a pack can be picked instead');
    await form.fire('submit');
    assert.equal(h.calls.some(([name]) => name === 'studio_activate_invoice_plan'), false);
    assert.match(form.text(), source === 'studio' ? /free months are still running\. An early paid switch is not available: record the plan once they end on .+, or a walkthrough pack now\./
      : /cannot replace that subscription; a walkthrough pack can still be recorded/);
  }
});

/* ---- Walkthrough packs by settled invoice --------------------------------
 * A pack is separate from the subscription: any activated account (free months
 * or plan, App Store included) may have one recorded; it carries no service
 * dates, and it counts only when the server credits exactly that pack.
 */
test('a walkthrough pack is recorded for any activated account, App Store included, without service dates', async () => {
  const cases = [
    ['App Store free months', { source: 'apple', apple_verified: true, plan_code: 'solo', apple_product_id: 'dev.property3d.capture.solo.monthly', ...runningFreeMonths }, 'pack3'],
    ['studio free months', { source: 'studio', ...runningFreeMonths }, 'pack10'],
    ['studio plan', { source: 'studio', ...activePlan }, 'pack3'],
    ['App Store Team plan', { ...activePlan, source: 'apple', apple_verified: true, plan_code: 'studio', apple_product_id: 'dev.property3d.capture.plan.monthly' }, 'pack10'],
  ];
  for (const [kind, extra, code] of cases) {
    const h = await load({ accounts: oneAccount(extra), rpc: { studio_record_pack_invoice: async args => packResponse(args) } });
    const statusBefore = h.dataRows()[0].children[COL.status].textContent;
    const { form, fields } = prepareInvoice(h, { item: code, index: 0 });
    const pack = OFFER.packs[code];
    assert.equal(labelOf(form, fields.period_start).hidden, true, kind + ': a pack has no service dates');
    assert.equal(labelOf(form, fields.period_end).hidden, true);
    assert.equal(fields.period_start.disabled, true);
    assert.ok(form.text().includes(aud(pack.cents) + ' for this invoice: adds ' + pack.walkthroughs + ' walkthroughs, valid 12 months after purchase'), kind);
    assert.equal(submitOf(form).disabled, false, kind);
    await form.fire('submit');
    const writes = h.calls.filter(([name]) => name === 'studio_record_pack_invoice');
    assert.equal(writes.length, 1, kind);
    assert.deepEqual({ ...writes[0][1] }, { p_workspace_id: 'ws-harbour', p_pack_code: code,
      p_agreement_id: 'agreement-001', p_settlement_id: 'settled-line-001', p_receipt_key: 'invoice-plan-001' });
    assert.equal(h.calls.some(([name]) => /studio_activate_invoice_plan|studio_set_plan/.test(name)), false, 'a pack never touches the plan');
    assert.equal(h.confirms.length, 1);
    for (const part of ['Harbour Realty', aud(pack.cents), pack.walkthroughs + ' walkthroughs', 'valid 12 months']) {
      assert.ok(h.confirms[0].includes(part), kind + ' confirms ' + part);
    }
    assert.equal(resultOf(form), 'Recorded: ' + pack.walkthroughs + ' walkthroughs added (' + aud(pack.cents) + '). ' +
      (pack.walkthroughs + 2) + ' available; use by 24 September 2027.');
    // The same references are never offered again for a second pack.
    assert.deepEqual([fields.agreement_id.value, fields.settlement_id.value, fields.receipt_key.value], ['', '', '']);
    assert.equal(h.dataRows()[0].children[COL.status].textContent, statusBefore, 'the plan reads as it did');
  }
  // On an App Store row the plan items still say why they cannot be recorded.
  const apple = await load({ accounts: oneAccount(cases[0][1]) });
  const { form } = prepareInvoice(apple, { item: 'solo-monthly', index: 0 });
  assert.match(form.text(), /managed by its billing provider/);
});

test('a pack is refused for an account that has not started or has ended, with the reason', async () => {
  const cases = [
    ['pending', { status: 'pending' }, 'This account has not started its free months. A walkthrough pack can be recorded once the account is activated.'],
    ['ended', { status: 'ended', trial_started_at: soon(-400), trial_ends_at: soon(-220), current_period_ends_at: soon(-10) },
      'This account has no running plan or free months. A walkthrough pack can be recorded only for an activated account; restart its plan first.'],
  ];
  for (const [status, extra, reason] of cases) {
    for (const code of ['pack3', 'pack10']) {
      for (const source of ['studio', 'apple']) {
        const h = await load({ accounts: oneAccount({ ...extra, source }), rpc: { studio_record_pack_invoice: async args => packResponse(args) } });
        const { form } = prepareInvoice(h, { item: code, index: 0 });
        assert.equal(submitOf(form).disabled, true, status);
        assert.ok(form.text().includes(reason), status + ' ' + source);
        await form.fire('submit');
        assert.equal(h.calls.some(([name]) => name === 'studio_record_pack_invoice'), false, status + ' sends nothing');
        assert.equal(h.confirms.length, 0);
      }
    }
  }
});

test('a pack answer that does not match is not confirmed, and only the identical request is sent again', async () => {
  const wrong = [
    { error: { message: 'offline' } },
    { data: [] },
    packResponse({ p_pack_code: 'pack3' }, { credited: 10 }),
    packResponse({ p_pack_code: 'pack3' }, { credited: 0 }),
    packResponse({ p_pack_code: 'pack3' }, { amount_cents: OFFER.packs.pack10.cents }),
    packResponse({ p_pack_code: 'pack3' }, { amount_cents: String(OFFER.packs.pack3.cents) }),
    packResponse({ p_pack_code: 'pack3' }, { expires_on: null }),
    packResponse({ p_pack_code: 'pack3' }, { expires_on: '2027-02-30' }),
    packResponse({ p_pack_code: 'pack3' }, { credits_available: '5' }),
  ];
  for (const reply of wrong) {
    let attempt = 0;
    const h = await load({ accounts: oneAccount({ source: 'studio', ...activePlan }),
      rpc: { studio_record_pack_invoice: async args => ++attempt === 1 ? reply : packResponse(args) } });
    const { form, fields } = prepareInvoice(h, { item: 'pack3', index: 0 });
    await form.fire('submit');
    assert.match(resultOf(form), /^The pack was not confirmed\./, JSON.stringify(reply));
    assert.equal(fields.receipt_key.value, 'invoice-plan-001', 'the references stay for an identical retry');
    assert.equal(submitOf(form).disabled, false);
    // A different receipt, or a different pack, is a new intent and is refused.
    fields.receipt_key.value = 'invoice-plan-002';
    await form.fire('submit');
    assert.match(resultOf(form), /^The previous result is unconfirmed\./);
    fields.receipt_key.value = 'invoice-plan-001';
    fields.item.value = 'pack10'; fields.item.events.change();
    await form.fire('submit');
    assert.match(resultOf(form), /^The previous result is unconfirmed\./);
    assert.equal(attempt, 1);
    fields.item.value = 'pack3'; fields.item.events.change();
    await form.fire('submit');
    assert.equal(attempt, 2);
    const writes = h.calls.filter(([name]) => name === 'studio_record_pack_invoice');
    assert.deepEqual(writes[0][1], writes[1][1]);
    assert.match(resultOf(form), /^Recorded: 3 walkthroughs added/);
  }
});

/* ---- Set plan and the retired plans ------------------------------------ */
test("Set plan offers the Veylet plan plus only the row's own retired plan", async () => {
  const names = { studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  for (const [code, name] of Object.entries(names)) {
    const h = await load({ accounts: oneAccount({ source: 'studio', plan_code: code }) });
    const plan = h.formFor(0).all().filter(el => el.tagName === 'SELECT')[1];
    assert.deepEqual(plan.children.map(option => [option.value, option.textContent]), [['solo', 'Veylet plan'], [code, name + ' (retired, existing terms)']]);
    assert.equal(plan.value, code, 'the form opens on the existing plan');
  }
  const solo = await load({ accounts: oneAccount({ source: 'studio', plan_code: 'solo' }) });
  const plan = solo.formFor(0).all().filter(el => el.tagName === 'SELECT')[1];
  assert.deepEqual(plan.children.map(option => option.value), ['solo'], 'no retired plan is offered to a Veylet plan account');
  // An App Store Team subscription reads as Team and cannot be changed here.
  const apple = await load();
  const applePlan = apple.formFor(0).all().filter(el => el.tagName === 'SELECT')[1];
  assert.deepEqual(applePlan.children.map(option => option.value), ['solo', 'studio']);
  assert.equal(applePlan.value, 'studio');
  assert.equal(applePlan.disabled, true);
});

test('moving an account off its retired plan is confirmed by name, and declining leaves it', async () => {
  for (const accepted of [false, true]) {
    const h = await load({ accounts: oneAccount({ source: 'studio', plan_code: 'office' }), confirm: accepted });
    const form = h.formFor(0);
    for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
    form.all().filter(el => el.tagName === 'SELECT')[1].value = 'solo';
    await form.fire('submit');
    await h.settle();
    assert.deepEqual(h.confirms, ['Move Harbour Realty to the Veylet plan? Its retired plan, Office, cannot be chosen again for this account.']);
    const write = h.calls.find(([name]) => name === 'studio_set_plan');
    assert.equal(Boolean(write), accepted);
    if (!accepted) { assert.equal(resultOf(form), 'Left unchanged.'); continue; }
    assert.equal(write[1].p_plan_code, 'solo');
    assert.deepEqual(form.all().filter(el => el.tagName === 'SELECT')[1].children.map(option => option.value), ['solo']);
  }
  const refused = await load({ accounts: oneAccount({ source: 'studio', plan_code: 'office' }), noConfirm: true });
  const form = refused.formFor(0);
  for (const radio of form.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
  form.all().filter(el => el.tagName === 'SELECT')[1].value = 'solo';
  await form.fire('submit');
  assert.equal(refused.calls.some(([name]) => name === 'studio_set_plan'), false);
  // A plan the form never offered is refused before any write.
  const forged = await load({ accounts: oneAccount({ source: 'studio', plan_code: 'solo' }) });
  const forgedForm = forged.formFor(0);
  for (const radio of forgedForm.all().filter(el => el.type === 'radio')) radio.checked = radio.value === 'trial';
  forgedForm.all().filter(el => el.tagName === 'SELECT')[1].value = 'office';
  await forgedForm.fire('submit');
  assert.equal(forged.calls.some(([name]) => name === 'studio_set_plan'), false);
  assert.match(resultOf(forgedForm), /^Choose the Veylet plan/);
});

test('Set plan falls back to 3 free months and 6 free walkthroughs when the row cannot say', async () => {
  assert.deepEqual([offer.freeMonths.months, offer.freeMonths.includedWalkthroughs], [3, 6]);
  assert.match(script, new RegExp(`const FREE_MONTHS_DEFAULT = ${offer.freeMonths.months};`));
  assert.match(script, new RegExp(`const FREE_WALKTHROUGHS_DEFAULT = ${offer.freeMonths.includedWalkthroughs};`));
  const h = await load({ accounts: oneAccount({ source: 'studio', trial_months: null, trial_included_walkthroughs: null }) });
  const [months, included] = h.formFor(0).all().filter(el => el.type === 'number');
  assert.deepEqual([months.value, included.value], ['3', '6']);
  // A row that cannot state its terms states none, rather than the defaults.
  assert.equal(h.dataRows()[0].children[COL.freeMonths].children[1].textContent, '');
});

test('each row states its own free-months terms in digits, and a running row keeps its longer terms', async () => {
  const h = await load();
  const terms = h.dataRows().map(row => row.children[COL.freeMonths].children[1].textContent);
  assert.deepEqual(terms, ['6 free months with 6 walkthroughs', '6 free months with 4 walkthroughs', '3 free months with 6 walkthroughs']);
  const single = await load({ accounts: oneAccount({ trial_months: 1, trial_included_walkthroughs: 1 }) });
  assert.equal(single.dataRows()[0].children[COL.freeMonths].children[1].textContent, '1 free month with 1 walkthrough');
  for (const odd of [{ trial_months: '3' }, { trial_months: 0 }, { trial_months: 13 }, { trial_included_walkthroughs: 2.5 }, { trial_included_walkthroughs: undefined }]) {
    const other = await load({ accounts: oneAccount(odd) });
    assert.equal(other.dataRows()[0].children[COL.freeMonths].children[1].textContent, '', JSON.stringify(odd));
  }
  // The pending plan sentence uses digits too, the same words as the account desk.
  assert.doesNotMatch(script, /\b(?:three|six) (?:free months|walkthroughs)/);
});

test('existing Team, Office, founding and single-walkthrough rows still read as their own plans', async () => {
  const active = { source: 'studio', status: 'active', trial_ends_at: soon(-40), current_period_ends_at: soon(20), billing_interval: 'monthly' };
  const rows = [
    ['Team row', { plan_code: 'studio', price_aud_cents: 18900 }, 'Team · A$189 a month'],
    ['Founding row', { plan_code: 'founding', renewal_price_aud_cents: 18900 }, 'Team, founding rate · A$189 a month'],
    ['Office row', { plan_code: 'office', price_aud_cents: 59900 }, 'Office · A$599 a month'],
    ['Single row', { plan_code: 'one', billing_interval: 'once', renewal_price_aud_cents: 19900 }, 'One walkthrough · A$199 once'],
    ['Plan row', { plan_code: 'solo', price_aud_cents: OFFER.month }, 'Veylet plan · ' + aud(OFFER.month) + ' a month'],
  ];
  const h = await load({ accounts: rows.map(([name, extra], index) => ({ ...oneAccount()[0], ...active, ...extra,
    workspace_id: 'ws-' + index, workspace_name: name, last_activity_at: soon(-index) })) });
  assert.deepEqual(h.dataRows().map(row => [row.children[COL.account].children[0].textContent, row.children[COL.status].textContent]),
    rows.map(([name, , title]) => [name, title]));
});

test('the This month column never prints an allowance rule the row does not carry; a yearly pool shows no monthly figure', async () => {
  // Today's studio_list_accounts carries no billing interval, rollover or pool
  // counts: a Veylet plan row reads its counts and nothing more.
  const active = { source: 'studio', status: 'active', trial_ends_at: soon(-40), current_period_ends_at: soon(20) };
  const listed = { ...oneAccount()[0], ...active, plan_code: 'solo', billing_interval: undefined, apple_product_id: undefined,
    banked_walkthroughs: 2, accepted_this_period: 1, included_per_month: 1 };
  const h = await load({ accounts: [listed] });
  assert.deepEqual(h.dataRows()[0].children[COL.thisMonth].children.map(el => el.textContent), ['1 / 1', '']);
  assert.doesNotMatch(script, /banked_walkthroughs|units_reason|units_locked|job\.walkthrough_units/);
  // A row that does carry its cadence (an invoice answer, or an App Store product)
  // and is annual shows the pool rule in place of a monthly figure.
  const rows = [
    ['Annual invoice', { plan_code: 'solo', billing_interval: 'annual', renewal_price_aud_cents: OFFER.year }, 'Veylet plan · ' + aud(OFFER.year) + ' a year', ['—', OFFER.yearlyPool + '-walkthrough yearly pool']],
    ['App Store annual', { source: 'apple', apple_verified: true, plan_code: 'solo', apple_product_id: 'dev.property3d.capture.solo.annual',
      billing_interval: 'annual', renewal_price_aud_cents: cents(soloPlan.annualAppAud) }, 'Veylet plan · ' + aud(cents(soloPlan.annualAppAud)) + ' a year', ['—', OFFER.yearlyPool + '-walkthrough yearly pool']],
    ['Monthly invoice', { plan_code: 'solo', billing_interval: 'monthly', renewal_price_aud_cents: OFFER.month }, 'Veylet plan · ' + aud(OFFER.month) + ' a month', ['0 / 3', '']],
    ['Team annual', { source: 'apple', apple_verified: true, plan_code: 'studio', apple_product_id: 'dev.property3d.capture.plan.annual',
      billing_interval: 'annual', renewal_price_aud_cents: 318999 }, 'Team · A$3,189.99 a year', ['0 / 3', '']],
  ];
  const carried = await load({ accounts: rows.map(([name, extra], index) => ({ ...oneAccount()[0], ...active, ...extra,
    workspace_id: 'ws-' + index, workspace_name: name, last_activity_at: soon(-index) })) });
  assert.deepEqual(carried.dataRows().map(row => [row.children[COL.account].children[0].textContent, row.children[COL.status].textContent,
    row.children[COL.thisMonth].children.map(el => el.textContent)]), rows.map(([name, , title, month]) => [name, title, month]));
});

/* ---- Founding referral grant -------------------------------------------
 * A free 3-pack for each referred office that becomes paying, at most four per
 * founding workspace. Proposed list fields: founding_member, founding_grants_used.
 */
const foundingRow = (extra = {}) => oneAccount({ source: 'studio', ...activePlan, founding_member: true, founding_grants_used: 1, ...extra });
// The proposed studio_grant_founding_pack answer.
const grantResponse = (used, extra = {}) => ({ data: [{ credited: 3, credits_available: 3, grants_used: used, expires_on: '2027-09-24', ...extra }] });
const grantCountOf = form => form.all().find(el => el.className === 'studio-grant-count').textContent;

test('a founding account shows the grants it has left and records one referral grant', async () => {
  const h = await load({ accounts: foundingRow(), rpc: { studio_grant_founding_pack: async () => grantResponse(2) } });
  const form = h.grantFormFor(0);
  assert.equal(form.hidden, false);
  assert.equal(grantCountOf(form), '3 of 4 grants left');
  const fields = fieldsOf(form);
  fields.grant_reference.value = 'INV-REFERRED-0042';
  fields.grant_note.value = 'Referred office paid its first invoice.';
  await form.fire('submit');
  assert.equal(h.confirms.length, 1);
  assert.ok(h.confirms[0].includes('Harbour Realty'));
  assert.ok(h.confirms[0].includes('free 3-pack, grant 2 of 4'));
  const call = h.calls.find(([name]) => name === 'studio_grant_founding_pack');
  assert.deepEqual({ ...call[1] }, { p_workspace_id: 'ws-harbour', p_reference: 'INV-REFERRED-0042', p_note: 'Referred office paid its first invoice.' });
  assert.equal(resultOf(form), 'Granted: 3 walkthroughs. 2 of 4 grants left.');
  assert.equal(grantCountOf(form), '2 of 4 grants left');
  assert.deepEqual([fields.grant_reference.value, fields.grant_note.value], ['', '']);
  // The count belongs to the row, so a view change keeps it.
  h.ids['studio-filter-name'].value = 'harbour';
  await h.ids['studio-filter-name'].fire('input');
  assert.equal(grantCountOf(h.grantFormFor(0)), '2 of 4 grants left');
  // No note is sent when none is written.
  const plain = await load({ accounts: foundingRow(), rpc: { studio_grant_founding_pack: async () => grantResponse(2) } });
  fieldsOf(plain.grantFormFor(0)).grant_reference.value = 'INV-REFERRED-0043';
  await plain.grantFormFor(0).fire('submit');
  assert.deepEqual({ ...plain.calls.find(([name]) => name === 'studio_grant_founding_pack')[1] }, { p_workspace_id: 'ws-harbour', p_reference: 'INV-REFERRED-0043' });
});

test('the fourth grant closes the form, and a spent or unreadable count sends nothing', async () => {
  const h = await load({ accounts: foundingRow({ founding_grants_used: 3 }), rpc: { studio_grant_founding_pack: async () => grantResponse(4) } });
  const form = h.grantFormFor(0);
  assert.equal(grantCountOf(form), '1 of 4 grants left');
  fieldsOf(form).grant_reference.value = 'INV-REFERRED-0099';
  await form.fire('submit');
  assert.ok(h.confirms[0].includes('free 3-pack, grant 4 of 4'));
  assert.equal(resultOf(form), 'Granted: 3 walkthroughs. 0 of 4 grants left.');
  assert.equal(grantCountOf(form), 'All four founding grants are used.');
  assert.equal(submitOf(form).disabled, true);
  assert.equal(fieldsOf(form).grant_reference.disabled, true);
  const unreadable = 'The grant count could not be read; refresh the accounts.';
  for (const [kind, extra, count] of [
    ['spent', { founding_grants_used: 4 }, 'All four founding grants are used.'],
    ['missing', { founding_grants_used: undefined }, unreadable],
    ['null', { founding_grants_used: null }, unreadable],
    ['beyond four', { founding_grants_used: 5 }, unreadable],
    ['text', { founding_grants_used: '2' }, unreadable],
    ['negative', { founding_grants_used: -1 }, unreadable],
    ['fraction', { founding_grants_used: 1.5 }, unreadable],
  ]) {
    const other = await load({ accounts: foundingRow(extra), rpc: { studio_grant_founding_pack: async () => grantResponse(1) } });
    const grant = other.grantFormFor(0);
    assert.equal(grant.hidden, false, kind);
    assert.equal(grantCountOf(grant), count, kind);
    assert.equal(submitOf(grant).disabled, true, kind);
    fieldsOf(grant).grant_reference.value = 'INV-REFERRED-0100';
    await grant.fire('submit');
    assert.equal(other.calls.some(([name]) => name === 'studio_grant_founding_pack'), false, kind + ' sends nothing');
    assert.equal(other.confirms.length, 0);
  }
});

test('a declined, impossible or non-opaque grant sends nothing', async () => {
  const declined = await load({ accounts: foundingRow(), confirm: false });
  const form = declined.grantFormFor(0);
  fieldsOf(form).grant_reference.value = 'INV-REFERRED-0042';
  await form.fire('submit');
  assert.equal(declined.confirms.length, 1);
  assert.equal(resultOf(form), 'Left unchanged.');
  assert.equal(declined.calls.some(([name]) => name === 'studio_grant_founding_pack'), false);
  assert.equal(grantCountOf(form), '3 of 4 grants left');
  const none = await load({ accounts: foundingRow(), noConfirm: true });
  fieldsOf(none.grantFormFor(0)).grant_reference.value = 'INV-REFERRED-0042';
  await none.grantFormFor(0).fire('submit');
  assert.equal(none.calls.some(([name]) => name === 'studio_grant_founding_pack'), false);
  const personal = await load({ accounts: foundingRow() });
  fieldsOf(personal.grantFormFor(0)).grant_reference.value = 'office@example.com';
  await personal.grantFormFor(0).fire('submit');
  assert.equal(personal.confirms.length, 0);
  assert.match(resultOf(personal.grantFormFor(0)), /^Enter the referred office's first paid invoice reference/);
});

test('an unconfirmed grant is reported, and only the identical request is retried', async () => {
  for (const reply of [{ error: { message: 'offline' } }, { data: [] }, grantResponse(1), grantResponse(3), grantResponse(2, { credited: 10 })]) {
    let attempt = 0;
    const h = await load({ accounts: foundingRow(), rpc: { studio_grant_founding_pack: async () => ++attempt === 1 ? reply : grantResponse(2) } });
    const form = h.grantFormFor(0);
    const fields = fieldsOf(form);
    fields.grant_reference.value = 'INV-REFERRED-0042';
    await form.fire('submit');
    assert.match(resultOf(form), /^The grant was not confirmed\./, JSON.stringify(reply));
    assert.equal(grantCountOf(form), '3 of 4 grants left', 'an unconfirmed answer moves no count');
    fields.grant_reference.value = 'INV-REFERRED-0043';
    await form.fire('submit');
    assert.match(resultOf(form), /^The previous grant is unconfirmed\./);
    assert.equal(attempt, 1);
    fields.grant_reference.value = 'INV-REFERRED-0042';
    await form.fire('submit');
    assert.equal(attempt, 2);
    assert.equal(resultOf(form), 'Granted: 3 walkthroughs. 2 of 4 grants left.');
  }
});

test('plan code founding counts as a founding account, and any other account has no grant form', async () => {
  const byPlan = await load({ accounts: oneAccount({ source: 'studio', plan_code: 'founding', founding_grants_used: 0 }) });
  assert.equal(byPlan.grantFormFor(0).hidden, false);
  assert.equal(grantCountOf(byPlan.grantFormFor(0)), '4 of 4 grants left');
  const plain = await load();
  for (const index of [0, 1, 2]) {
    const grant = plain.grantFormFor(index);
    assert.equal(grant.hidden, true, 'no dead form on an account that is not founding');
    assert.equal(submitOf(grant).disabled, true);
  }
  // Forms are laid out as flex, so the hidden attribute needs its own rule.
  assert.match(styles, /\.studio-plan-form\[hidden\],\s*\.studio-inline-field\[hidden\] \{\s*display: none;/);
});

/* ---- Referral walkthroughs (offer v8 migration) ----------------------------
 * studio_grant_referral_bonus(p_workspace_id, p_referrer_workspace_id default
 * null, p_reference default null) answers { granted, reason?, referrer_granted,
 * walkthroughs, expires_at, referrer_workspace_id } and never raises for a rule.
 * The grant is automatic when the referred office first pays; the desk is the
 * fallback, and the way to record a referring office named in writing.
 */
const referralAccounts = () => [
  { ...oneAccount({ source: 'studio', ...activePlan })[0], last_activity_at: soon(-1) },
  { ...oneAccount({ source: 'studio', ...activePlan })[0], workspace_id: 'ws-bayside', workspace_name: 'Bayside Homes', last_activity_at: soon(-2) },
  { ...oneAccount({ source: 'studio', ...runningFreeMonths })[0], workspace_id: 'ws-acre', workspace_name: 'Acre & Co', last_activity_at: soon(-3) },
];
const REFERRAL_EXPIRES = '2027-09-25T00:00:00Z';
const referralAnswer = (extra = {}) => ({ data: { granted: true, referrer_granted: true, walkthroughs: OFFER.referral,
  expires_at: REFERRAL_EXPIRES, referrer_workspace_id: 'ws-bayside', ...extra } });
const referralCalls = h => h.calls.filter(([name]) => name === 'studio_grant_referral_bonus');
const REFERRAL_ACTION = 'Grant ' + OFFER.referral + ' bonus walkthrough to each office';
const fillReferral = (form, values = {}) => {
  const fields = fieldsOf(form);
  fields.referrer_workspace.value = values.referrer ?? 'ws-bayside';
  fields.referrer_workspace.events.change();
  if (values.reference !== undefined || fields.referrer_workspace.value) fields.referral_reference.value = values.reference ?? 'INV-HARBOUR-0001';
  return fields;
};

test('the referral form is the fallback: its own link first, then every other account, never the office itself', async () => {
  const h = await load({ accounts: referralAccounts() });
  assert.deepEqual(h.dataRows().map(row => row.children[COL.account].children[0].textContent), ['Harbour Realty', 'Bayside Homes', 'Acre & Co']);
  const form = h.referralFormFor(0);
  assert.equal(form.all().find(el => el.tagName === 'H3').textContent, 'Referral walkthroughs');
  assert.match(form.text(), /When a referred office first pays, the server grants 1 bonus walkthrough to it and 1 to the office that referred it, once per referred office\. Use this only when that grant did not happen/);
  const fields = fieldsOf(form);
  assert.equal(fields.referrer_workspace.tagName, 'SELECT', 'a native select');
  assert.equal(labelOf(form, fields.referrer_workspace).textContent, 'Referred by');
  assert.deepEqual(fields.referrer_workspace.children.map(option => [option.value, option.textContent]),
    [['', 'Referred through its own link'], ['ws-acre', 'Acre & Co'], ['ws-bayside', 'Bayside Homes']]);
  for (const [index, row] of referralAccounts().entries()) {
    assert.equal(fieldsOf(h.referralFormFor(index)).referrer_workspace.children.some(option => option.value === row.workspace_id), false, row.workspace_name);
  }
  // A reference belongs to a named office; with its own link it is not asked for.
  assert.equal(fields.referral_reference.disabled, true);
  assert.equal(fields.referral_reference.required, false);
  fields.referrer_workspace.value = 'ws-bayside'; fields.referrer_workspace.events.change();
  assert.equal(fields.referral_reference.disabled, false);
  assert.equal(fields.referral_reference.required, true);
  assert.equal(labelOf(form, fields.referral_reference).textContent, 'Reference (when you name the office)');
  assert.deepEqual(form.all().filter(el => el.tagName === 'BUTTON').map(el => [el.textContent, el.type, el.className]), [[REFERRAL_ACTION, 'submit', 'button']]);
  // Every office may be asked: the server says when one has not paid yet.
  for (const index of [0, 1, 2]) assert.equal(submitOf(h.referralFormFor(index)).disabled, false);
  assert.equal(Object.hasOwn(fields, 'referral_note'), false, 'the server takes no note');
  assert.doesNotMatch(script, /studio_grant_referral'|referral_granted|p_referred_workspace_id/);
});

test('naming the referring office records it with its reference, then states both walkthroughs from the answer', async () => {
  const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: async () => referralAnswer() } });
  const form = h.referralFormFor(0);
  const fields = fillReferral(form);
  await form.fire('submit');
  assert.equal(h.confirms.length, 1);
  assert.equal(h.confirms[0], REFERRAL_ACTION + '? Records Bayside Homes as the office that referred Harbour Realty (reference INV-HARBOUR-0001), ' +
    'then grants 1 bonus walkthrough to each once Harbour Realty has paid. Once per referred office; the server keeps an audit row. No payment is taken.');
  assert.deepEqual(referralCalls(h).map(([, args]) => ({ ...args })), [{ p_workspace_id: 'ws-harbour', p_referrer_workspace_id: 'ws-bayside', p_reference: 'INV-HARBOUR-0001' }]);
  assert.equal(resultOf(form), 'Granted: 1 bonus walkthrough each to Harbour Realty and Bayside Homes, usable until ' + longDate(REFERRAL_EXPIRES) + '.');
  assert.equal(form.all().find(el => el.className === 'studio-result').attributes.role, 'status');
  assert.deepEqual([fields.referrer_workspace.value, fields.referral_reference.value, fields.referral_reference.disabled], ['', '', true]);
});

test('its own link sends only the office, and a referrer that received nothing is said so', async () => {
  const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: async () => referralAnswer({ referrer_granted: false, referrer_workspace_id: 'ws-gone' }) } });
  const form = h.referralFormFor(0);
  await form.fire('submit');
  assert.equal(h.confirms[0], REFERRAL_ACTION + '? Harbour Realty and the office it recorded through its own link each get 1 bonus walkthrough once Harbour Realty has paid. ' +
    'Once per referred office; the server keeps an audit row. No payment is taken.');
  assert.deepEqual(referralCalls(h).map(([, args]) => ({ ...args })), [{ p_workspace_id: 'ws-harbour' }]);
  assert.equal(resultOf(form), 'Granted: 1 bonus walkthrough to Harbour Realty, usable until ' + longDate(REFERRAL_EXPIRES) +
    '. The referring office received none: it no longer exists or is being deleted.');
});

test('a rule the server answers with is said in place: already granted, not paying yet, no referral recorded', async () => {
  const cases = [
    [{ granted: false, reason: 'already_granted', referrer_workspace_id: 'ws-bayside' }, "Already granted: Harbour Realty's referral walkthroughs were granted before. Nothing new was added."],
    [{ granted: false, reason: 'not_paying', referrer_workspace_id: 'ws-bayside' }, 'Not granted yet: Harbour Realty has not paid. Its referral by Bayside Homes is recorded, and the walkthroughs are granted automatically when its plan first turns active.'],
    [{ granted: false, reason: 'no_referral', referrer_workspace_id: null }, 'No referral is recorded for Harbour Realty. Choose the referring office and give a reference.'],
    [{ granted: false, reason: 'something_new' }, 'Not granted: something new.'],
  ];
  for (const [answer, said] of cases) {
    const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: async () => ({ data: answer }) } });
    const form = h.referralFormFor(0);
    fillReferral(form);
    await form.fire('submit');
    assert.equal(resultOf(form), said, answer.reason);
    assert.equal(submitOf(form).disabled, false);
  }
});

test('a refusal the server raises is shown in place and the form is kept; a lost or odd answer is not confirmed', async () => {
  const cases = [
    [async () => ({ error: { code: 'P0001', message: 'this office already records another referring office' } }), 'Not granted: this office already records another referring office'],
    [async () => ({ error: { code: 'P0001', message: 'two offices cannot refer each other' } }), 'Not granted: two offices cannot refer each other'],
    [async () => ({ error: { code: 'P0001', message: 'no referral is recorded for this office: name the referring office and a reference' } }),
      'Not granted: no referral is recorded for this office: name the referring office and a reference'],
    [async () => { throw new Error('network'); }, 'The referral grant was not confirmed. Sending it again is safe: the server grants once per referred office.'],
    [async () => ({ error: { message: 'offline' } }), /^The referral grant was not confirmed\./],
    [async () => ({ data: null }), /^The referral grant was not confirmed\./],
    [async () => referralAnswer({ walkthroughs: 2 }), /^The referral grant was not confirmed\./],
    [async () => referralAnswer({ referrer_granted: undefined }), /^The referral grant was not confirmed\./],
    [async () => ({ data: { referrer_credited: 1, referred_credited: 1, replay: false } }), /^The referral grant was not confirmed\./],
  ];
  for (const [reply, expected] of cases) {
    const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: reply } });
    const form = h.referralFormFor(0);
    const fields = fillReferral(form);
    await form.fire('submit');
    const result = resultOf(form);
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.deepEqual([fields.referrer_workspace.value, fields.referral_reference.value], ['ws-bayside', 'INV-HARBOUR-0001'], 'what was typed stays');
    assert.equal(submitOf(form).disabled, false);
  }
});

test('a named office needs an opaque reference, a forged choice is refused, and nothing is sent without an explicit confirmation', async () => {
  const cases = [
    [{ reference: '' }, /^Enter the reference for the named referring office/],
    [{ reference: 'office@example.com' }, /^Enter the reference for the named referring office/],
    [{ reference: 'x' }, /^Enter the reference for the named referring office/],
  ];
  for (const [values, expected] of cases) {
    const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: async () => referralAnswer() } });
    const form = h.referralFormFor(0);
    fillReferral(form, values);
    await form.fire('submit');
    assert.match(resultOf(form), expected);
    assert.equal(h.confirms.length, 0, JSON.stringify(values));
    assert.equal(referralCalls(h).length, 0, JSON.stringify(values));
  }
  // This office itself, or an account not listed, is never sent as the referrer.
  for (const forged of ['ws-harbour', 'ws-nowhere']) {
    const h = await load({ accounts: referralAccounts(), rpc: { studio_grant_referral_bonus: async () => referralAnswer() } });
    const form = h.referralFormFor(0);
    fieldsOf(form).referrer_workspace.value = forged;
    fieldsOf(form).referral_reference.value = 'INV-HARBOUR-0001';
    await form.fire('submit');
    assert.equal(resultOf(form), 'Choose the office that referred this one, or its own link.');
    assert.equal(referralCalls(h).length, 0, forged);
  }
  const declined = await load({ accounts: referralAccounts(), confirm: false });
  fillReferral(declined.referralFormFor(0));
  await declined.referralFormFor(0).fire('submit');
  assert.equal(declined.confirms.length, 1);
  assert.ok(declined.confirms[0].startsWith(REFERRAL_ACTION + '?'));
  assert.equal(resultOf(declined.referralFormFor(0)), 'Left unchanged.');
  assert.equal(referralCalls(declined).length, 0);
  const none = await load({ accounts: referralAccounts(), noConfirm: true });
  fillReferral(none.referralFormFor(0));
  await none.referralFormFor(0).fire('submit');
  assert.equal(referralCalls(none).length, 0, 'no confirmation possible, no grant');
  // The founding 3-pack grant is a separate perk and is unchanged.
  const founding = await load({ accounts: foundingRow() });
  assert.equal(founding.grantFormFor(0).hidden, false);
  assert.equal(grantCountOf(founding.grantFormFor(0)), '3 of 4 grants left');
});

test('each Set plan form has one filled button, labelled native fields and a live result', async () => {
  const h = await load({ accounts: foundingRow() });
  const forms = h.ids['studio-rows'].children[1].all().filter(el => el.tagName === 'FORM');
  assert.deepEqual(forms.map(form => form.className), ['veylet-form studio-plan-form', 'veylet-form studio-plan-form studio-invoice-form',
    'veylet-form studio-plan-form studio-grant-form', 'veylet-form studio-plan-form studio-referral-form']);
  for (const form of forms) {
    assert.equal(form.all().filter(el => el.tagName === 'BUTTON' && el.className === 'button').length, 1, form.className);
    for (const field of form.all().filter(el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['radio', 'checkbox'].includes(el.type))) {
      assert.ok(labelOf(form, field)?.textContent, 'every field sits inside its visible label');
    }
    assert.equal(form.all().filter(el => el.className === 'studio-result').every(el => el.attributes.role === 'status'), true);
  }
  assert.match(styles, /\.studio-grant-count \{[^}]*font-variant-numeric: tabular-nums/s);
});

test('every reference field carries a pattern the browser can compile, matching the desk\'s own rule', async () => {
  const h = await load({ accounts: foundingRow(), hosted: [hostedRow('aaaaaaaa-0001', 'Harbour loft', 'ended', 20)] });
  const invoiceFields = fieldsOf(h.invoiceFormFor(0));
  const references = [invoiceFields.agreement_id, invoiceFields.settlement_id, invoiceFields.receipt_key,
    fieldsOf(h.grantFormFor(0)).grant_reference, fieldsOf(h.referralFormFor(0)).referral_reference];
  assert.equal(references.length, 5);
  for (const input of references) {
    // Browsers compile pattern attributes with the v flag; an invalid one switches the check off.
    const compiled = new RegExp('^(?:' + input.pattern + ')$', 'v');
    assert.deepEqual(['INV-2027-014', 'a/b:c.d_e', 'x', 'office@example.com', '-abc', 'a b c'].map(value => compiled.test(value)),
      [true, true, false, false, false, false]);
    assert.equal(input.maxLength, 160);
    assert.match(input.title, /3–160 letters, numbers or \. _ : \/ -/);
  }
});

/* ---- Hosted walkthroughs ----------------------------------------------
 * Offer 2026-09-26.1: released walkthroughs and whether a plan keeps them live,
 * those without an active plan first; read-only (no paid extension), and a
 * failed lookup is never read as an empty list.
 */
const DAY = 86400000;
const inDays = days => new Date(Date.now() + days * DAY).toISOString();
const brisbaneDay = value => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return Number(parts.day) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(parts.month) - 1] + ' ' + parts.year;
};
const hostedRow = (id, title, plan, hostedIn, extra = {}) => ({ tour_id: id, workspace_id: 'ws-' + id, property_title: title, status: 'ready',
  sharing_on: true, released_at: inDays(hostedIn - 365), guaranteed_until: inDays(hostedIn), extended_until: null, hosted_until: inDays(hostedIn), plan_status: plan, ...extra });
const hostedTours = () => [
  hostedRow('aaaaaaaa-0001', 'Harbour loft', 'active', 20),
  hostedRow('bbbbbbbb-0002', 'Corner clinic', 'ended', 30),
  hostedRow('cccccccc-0003', 'Old showroom', 'ended', -10, { sharing_on: false }),
  hostedRow('dddddddd-0004', 'Garden studio', 'pending', 200),
  hostedRow('eeeeeeee-0005', 'Rooftop venue', 'trial', 400),
];
const hostedName = row => row.children[0].children[0].textContent;
const dueBadge = row => row.children[0].children[2];
const OFFLINE_RULE = 'Offline 14 days after the plan ends; restarting the plan restores the link';

test('hosted walkthroughs list those without an active plan first, each with its plan and the plan rule', async () => {
  const h = await load({ hosted: hostedTours() });
  const rows = h.hostedRows();
  // No active plan first (then oldest release first), whatever the older 12-month dates say.
  assert.deepEqual(rows.map(hostedName), ['Old showroom', 'Corner clinic', 'Garden studio', 'Harbour loft', 'Rooftop venue']);
  assert.deepEqual(rows.map(row => dueBadge(row).hidden), [false, false, false, true, true],
    'free months and an active plan keep a walkthrough live');
  assert.equal(dueBadge(rows[0]).textContent, 'No active plan');
  const old = hostedTours()[2];
  const cells = rows[0].children.slice(1).map(el => el.textContent);
  assert.deepEqual(cells, ['Off', brisbaneDay(old.released_at), 'Ended', OFFLINE_RULE]);
  assert.deepEqual(rows.map(row => row.children[3].textContent), ['Ended', 'Ended', 'Not started', 'Active', 'Free months']);
  assert.deepEqual(rows.map(row => row.children[4].textContent),
    [OFFLINE_RULE, OFFLINE_RULE, OFFLINE_RULE, 'Live while the plan is active', 'Live while the plan is active']);
  assert.equal(rows[0].children[0].children[1].textContent, 'Walkthrough cccccccc');
  assert.equal(h.ids['studio-hosted-table'].attributes['aria-busy'], 'false');
});

test('hosted walkthroughs sell no extension: no form, no extension call, no 12-month or paid-hosting wording', async () => {
  const h = await load({ hosted: hostedTours() });
  const body = h.ids['studio-hosted-rows'];
  assert.equal(body.children.length, 5, 'one row per walkthrough, no form rows');
  assert.equal(body.all().some(el => ['FORM', 'DETAILS', 'INPUT', 'BUTTON'].includes(el.tagName)), false);
  assert.equal(h.calls.some(([name]) => name === 'studio_record_hosting_extension'), false);
  assert.doesNotMatch(script, /studio_record_hosting_extension|Record extension|twelve months after their release/);
  const section = markup.slice(markup.indexOf('id="studio-hosted"'), markup.indexOf('</section>', markup.indexOf('id="studio-hosted"')));
  assert.match(section.replace(/\s+/g, ' '), /When the plan ends, its links, embeds and QR codes stay up 14 days, then go offline; restarting the plan brings the same links back at once\. There is no paid extension\./);
  assert.doesNotMatch(section, /Guaranteed until|Extended until|Record extension|A\$49/);
  assert.deepEqual([...section.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]), ['Walkthrough', 'Sharing', 'Released', 'Plan', 'Hosting']);
});

test('hosted dates print the Brisbane day with a fixed month', async () => {
  const h = await load({ hosted: [hostedRow('ffffffff-0006', 'Brisbane edge', 'ended', 10,
    { released_at: '2026-09-22T15:30:00Z', guaranteed_until: '2027-09-22T15:30:00Z', hosted_until: '2027-09-22T15:30:00Z' })] });
  const cells = h.hostedRows()[0].children.map(el => el.textContent);
  assert.equal(cells[2], '23 Sep 2026');
});

test('an empty, failed or pending hosted list says which it is', async () => {
  const empty = await load({ hosted: [] });
  assert.equal(empty.ids['studio-hosted-rows'].children[0].all()[0].textContent, 'No released walkthroughs yet.');
  const failed = await load({ rpc: { studio_list_hosted_tours: async () => ({ error: { message: 'offline' } }) } });
  const state = failed.ids['studio-hosted-rows'].children[0].all()[0];
  assert.match(state.textContent, /failed request, not an empty list/);
  assert.doesNotMatch(failed.text(), /No released walkthroughs yet/);
  await state.all().find(el => el.textContent === 'Retry').fire('click');
  await failed.settle();
  assert.equal(failed.calls.filter(([name]) => name === 'studio_list_hosted_tours').length, 2);
  let finish;
  const pending = await load({ rpc: { studio_list_hosted_tours: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(pending.ids['studio-hosted-table'].attributes['aria-busy'], 'true');
  assert.equal(pending.dataRows().length, 3, 'the accounts never wait for the hosted list');
  finish({ data: hostedTours() }); await pending.settle();
  assert.equal(pending.hostedRows().length, 5);
});

test('the hosted list is for studio members only and clears on sign-out', async () => {
  const outsider = await load({ hosted: hostedTours(), rpc: { studio_is_member: async () => ({ data: false }) } });
  assert.equal(outsider.calls.some(([name]) => name === 'studio_list_hosted_tours'), false);
  assert.equal(outsider.ids['studio-hosted-rows'].children.length, 0);
  const h = await load({ hosted: hostedTours() });
  assert.equal(h.hostedRows().length, 5);
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['studio-hosted-rows'].children.length, 0);
  assert.match(markup, /<h2 class="dash-heading" id="studio-hosted-title">Hosted walkthroughs<\/h2>/);
  assert.ok(markup.indexOf('id="studio-hosted"') > markup.indexOf('id="studio-table-wrap"'));
});

/* ---- Money exceptions ---------------------------------------------------
 * Charges and payment states that need a person, above the deletion band. The
 * desk lists them and can mark one resolved with an opaque reference; nothing
 * here moves money, and a failed lookup is never an empty list.
 */
const MONEY_LABELS = {
  charge_refused: 'Annual charge not granted', duplicate_charge: 'Pack charged twice',
  mismatch: 'Pack charged a different amount', refunded_after_use: 'Pack refunded after use',
  square_cancel_unconfirmed: 'Square cancel unconfirmed', start_failed: 'Annual first charge failed',
  start_unconfirmed: 'Annual start not confirmed', apple_inbox_blocked: 'App Store stream blocked',
  apple_inbox_stuck: 'App Store notice waiting', pack_intent_unresolved: 'Pack payment unresolved',
};
const moneyRows = () => [
  { exception_key: 'charge_refused:chk-1:1', kind: 'charge_refused', severity: 'high', workspace_id: 'ws-harbour',
    workspace_name: 'Harbour Realty', amount_cents: OFFER.year, currency: 'AUD',
    occurred_at: '2026-09-22T04:05:00Z', age_minutes: 12, runbook: 'R1', reference: 'chk-1',
    detail: 'The annual charge was not granted.', resolvable: true },
  { exception_key: 'duplicate_charge:sq-pay-7', kind: 'duplicate_charge', severity: 'high', workspace_id: 'ws-gone',
    workspace_name: null, amount_cents: OFFER.packs.pack3.cents, currency: 'AUD',
    occurred_at: '2026-09-21T23:30:00Z', age_minutes: 185, runbook: 'R2', reference: 'sq-pay-7',
    detail: 'Two payments for one pack.', resolvable: true },
  { exception_key: 'apple_inbox_stuck:0f0e0d0c', kind: 'apple_inbox_stuck', severity: 'medium', workspace_id: 'ws-northgate',
    workspace_name: 'Northgate Property Co', amount_cents: null, currency: null,
    occurred_at: '2026-09-20T01:00:00Z', age_minutes: 2 * 1440 + 30, runbook: 'R8', reference: '0f0e0d0c',
    detail: 'An App Store notice is waiting to be applied.', resolvable: false },
  { exception_key: 'ledger_drift:x-1', kind: 'ledger_drift', severity: 'medium', workspace_id: 'ws-wren',
    workspace_name: 'Wren & Fielding', amount_cents: OFFER.month, currency: 'AUD',
    occurred_at: '2026-09-19T01:00:00Z', age_minutes: 1440, runbook: 'R9', reference: 'x-1',
    detail: 'A kind this desk does not know yet.', resolvable: false },
];
const moneyBody = h => h.ids['studio-money-body'];
const moneyText = h => moneyBody(h).all().map(el => el.textContent).filter(Boolean).join(' | ');
const moneyItems = h => moneyBody(h).all().filter(el => el.className === 'studio-money-item');
const moneyHead = item => item.children[0].children.map(el => el.textContent);
const moneyTerms = item => item.all().filter(el => el.tagName === 'DIV' && el.children[0]?.tagName === 'DT')
  .map(group => group.children.map(el => el.textContent));
const resolveFormOf = item => item.all().find(el => el.tagName === 'FORM');
const resolveCalls = h => h.calls.filter(([name]) => name === 'studio_resolve_money_exception');

test('money exceptions wait as a stated line, then list each one with its facts', async () => {
  let finish;
  const h = await load({ rpc: { studio_money_exceptions: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(moneyBody(h).attributes['aria-busy'], 'true');
  assert.equal(moneyText(h), 'Checking for money exceptions…');
  assert.equal(h.dataRows().length, 3, 'the accounts never wait for money exceptions');
  finish({ data: moneyRows() });
  await h.settle();
  assert.equal(moneyBody(h).attributes['aria-busy'], 'false');
  assert.equal(moneyBody(h).children[0].tagName, 'UL');
  const items = moneyItems(h);
  // The server's order is kept, and an unknown kind is listed under its own text.
  assert.deepEqual(items.map(moneyHead), [
    ['Annual charge not granted', 'High', 'Runbook R1'],
    ['Pack charged twice', 'High', 'Runbook R2'],
    ['App Store notice waiting', 'Medium', 'Runbook R8'],
    ['ledger_drift', 'Medium', 'Runbook R9'],
  ]);
  const pill = items[0].children[0].children[1];
  assert.match(pill.className, /\bpill\b/);
  assert.match(pill.className, /\bpill-busy\b/, 'high severity reuses the existing pill');
  assert.doesNotMatch(items[2].children[0].children[1].className, /pill-busy/);
  assert.deepEqual(moneyTerms(items[0]), [
    ['Account', 'Harbour Realty'], ['Amount', aud(OFFER.year)], ['Since', '22 Sep 2026, 14:05'],
    ['Age', '12 min'], ['Reference', 'chk-1'], ['Detail', 'The annual charge was not granted.'],
  ]);
  assert.deepEqual(moneyTerms(items[1]).slice(0, 4), [['Account', 'Deleted account'], ['Amount', aud(OFFER.packs.pack3.cents)],
    ['Since', '22 Sep 2026, 09:30'], ['Age', '3 h']]);
  assert.deepEqual(moneyTerms(items[2]).slice(0, 2), [['Account', 'Northgate Property Co'], ['Amount', 'Amount unknown']]);
  assert.deepEqual(moneyTerms(items[2])[3], ['Age', '2 days']);
  assert.deepEqual(moneyTerms(items[3])[3], ['Age', '1 day']);
  assert.deepEqual(moneyTerms(items[2])[4], ['Reference', '0f0e0d0c']);
});

test('each money exception kind is named once, and an unnamed or unreadable row still shows', async () => {
  for (const label of Object.values(MONEY_LABELS)) assert.equal(script.split("'" + label + "'").length - 1, 1, label);
  const rows = Object.keys(MONEY_LABELS).map((kind, index) => ({ ...moneyRows()[0], exception_key: kind + ':' + index, kind }));
  const h = await load({ exceptions: [...rows, { exception_key: 'odd:1', severity: 'low', workspace_id: null, workspace_name: null,
    amount_cents: null, currency: null, occurred_at: null, age_minutes: null, runbook: null, reference: null, detail: null, resolvable: false }] });
  const items = moneyItems(h);
  assert.equal(items.length, rows.length + 1, 'no row is dropped');
  assert.deepEqual(items.slice(0, -1).map(item => moneyHead(item)[0]), Object.values(MONEY_LABELS));
  assert.deepEqual(moneyHead(items.at(-1)), ['Unnamed money exception', 'low', 'No runbook']);
  assert.deepEqual(moneyTerms(items.at(-1)), [['Account', 'No account linked'], ['Amount', 'Amount unknown'], ['Since', '—'],
    ['Age', '—'], ['Reference', '—'], ['Detail', '—']]);
});

test('no money exceptions says so in one line', async () => {
  const h = await load();
  assert.equal(moneyBody(h).children.length, 1);
  assert.equal(moneyBody(h).children[0].textContent, 'No money exceptions.');
  assert.equal(moneyBody(h).attributes['aria-busy'], 'false');
  assert.equal(h.calls.filter(([name]) => name === 'studio_money_exceptions').length, 1);
  assert.deepEqual(h.calls.find(([name]) => name === 'studio_money_exceptions')[1], undefined, 'the server default window is used');
});

test('a failed money lookup is a failed request, never an empty list, and Retry asks again', async () => {
  for (const reply of [async () => ({ error: { message: 'offline' } }), async () => { throw new Error('network'); }, async () => ({ data: null })]) {
    let attempt = 0;
    const h = await load({ rpc: { studio_money_exceptions: async () => ++attempt === 1 ? reply() : { data: moneyRows() } } });
    assert.match(moneyText(h), /^Money exceptions could not be loaded\. This is a failed request, not an empty list\./);
    assert.doesNotMatch(moneyText(h), /No money exceptions\./);
    assert.equal(moneyBody(h).attributes['aria-busy'], 'false');
    const retry = moneyBody(h).all().find(el => el.textContent === 'Retry');
    assert.equal(retry.tagName, 'BUTTON');
    await retry.fire('click');
    await h.settle();
    assert.equal(attempt, 2);
    assert.equal(moneyItems(h).length, 4);
  }
});

test('a stale money answer never paints over a newer one', async () => {
  let first;
  let attempt = 0;
  const h = await load({ rpc: { studio_money_exceptions: () => ++attempt === 1 ? new Promise(resolve => { first = resolve; }) : Promise.resolve({ data: [] }) } });
  await h.ids['studio-refresh'].fire('click');
  await h.settle();
  assert.equal(moneyText(h), 'No money exceptions.');
  first({ data: moneyRows() });
  await h.settle();
  assert.equal(moneyText(h), 'No money exceptions.');
});

test('money exceptions sit above the deletion band, are for studio members only and clear on sign-out', async () => {
  assert.match(markup, /<section class="studio-money" id="studio-money" aria-labelledby="studio-money-title">/);
  assert.match(markup, /<h2 class="dash-heading" id="studio-money-title">Money exceptions<\/h2>/);
  assert.match(markup, /id="studio-money-body" aria-live="polite"/);
  assert.match(markup.slice(markup.indexOf('id="studio-money"'), markup.indexOf('id="studio-money-body"')), /Brisbane time\. Nothing here moves money\./);
  assert.ok(markup.indexOf('id="studio-desk"') < markup.indexOf('id="studio-money"'));
  assert.ok(markup.indexOf('id="studio-money"') < markup.indexOf('id="studio-deletions"'));
  const outsider = await load({ exceptions: moneyRows(), rpc: { studio_is_member: async () => ({ data: false }) } });
  assert.equal(outsider.calls.some(([name]) => name === 'studio_money_exceptions'), false);
  assert.equal(moneyBody(outsider).children.length, 0);
  const signedOut = await load({ signedOut: true, exceptions: moneyRows() });
  assert.equal(signedOut.calls.some(([name]) => name === 'studio_money_exceptions'), false);
  const h = await load({ exceptions: moneyRows() });
  assert.equal(moneyItems(h).length, 4);
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(moneyBody(h).children.length, 0);
  assert.doesNotMatch(h.text(), /Harbour Realty|chk-1/);
});

test('only a resolvable exception offers a resolve form, with a reference field and one button', async () => {
  const h = await load({ exceptions: moneyRows() });
  const items = moneyItems(h);
  assert.deepEqual(items.map(item => Boolean(resolveFormOf(item))), [true, true, false, false]);
  assert.equal(items.slice(2).some(item => item.all().some(el => el.tagName === 'BUTTON' || el.tagName === 'INPUT')), false);
  const form = resolveFormOf(items[0]);
  assert.equal(items[0].all().find(el => el.tagName === 'SUMMARY').textContent, 'Mark resolved · Annual charge not granted · Harbour Realty');
  const input = form.all().find(el => el.tagName === 'INPUT');
  assert.ok(labelOf(form, input).textContent);
  // The desk's one reference rule, as a pattern the browser can compile.
  const compiled = new RegExp('^(?:' + input.pattern + ')$', 'v');
  assert.deepEqual(['sq-refund-0042', 'x', 'owner@example.com'].map(value => compiled.test(value)), [true, false, false]);
  assert.equal(input.maxLength, 160);
  assert.equal(submitOf(form).textContent, 'Mark resolved');
  assert.equal(form.all().filter(el => el.tagName === 'BUTTON').length, 1);
  assert.equal(form.all().find(el => el.className === 'studio-result').attributes.role, 'status');
});

test('resolving sends exactly the key and reference after a named confirmation, then drops that row', async () => {
  const h = await load({ exceptions: moneyRows(), rpc: { studio_resolve_money_exception: async args =>
    ({ data: { exception_key: args.p_exception_key, resolved_at: '2026-09-24T02:00:00Z' } }) } });
  const other = resolveFormOf(moneyItems(h)[0]);
  other.all().find(el => el.tagName === 'INPUT').value = 'typed-but-not-sent';
  const form = resolveFormOf(moneyItems(h)[1]);
  form.all().find(el => el.tagName === 'INPUT').value = ' sq-refund-0042 ';
  await form.fire('submit');
  assert.equal(h.confirms.length, 1);
  for (const part of ['Pack charged twice', 'Deleted account', 'sq-refund-0042', 'does not refund']) assert.ok(h.confirms[0].includes(part), part);
  assert.deepEqual(resolveCalls(h).map(([, args]) => ({ ...args })), [{ p_exception_key: 'duplicate_charge:sq-pay-7', p_note: 'sq-refund-0042' }]);
  assert.deepEqual(moneyItems(h).map(item => moneyHead(item)[0]), ['Annual charge not granted', 'App Store notice waiting', 'ledger_drift']);
  assert.equal(h.ids['studio-status'].textContent, 'Resolved: Pack charged twice for Deleted account.');
  // The other rows keep what was typed in them.
  assert.equal(resolveFormOf(moneyItems(h)[0]).all().find(el => el.tagName === 'INPUT').value, 'typed-but-not-sent');
  // An answer wrapped in an array is accepted, and the last row leaves the none state.
  const last = await load({ exceptions: [moneyRows()[0]], rpc: { studio_resolve_money_exception: async args =>
    ({ data: [{ exception_key: args.p_exception_key, resolved_at: '2026-09-24T02:00:00Z' }] }) } });
  const lastForm = resolveFormOf(moneyItems(last)[0]);
  lastForm.all().find(el => el.tagName === 'INPUT').value = 'sq-refund-0043';
  await lastForm.fire('submit');
  assert.equal(moneyText(last), 'No money exceptions.');
});

test('a refused resolution shows the server reason; a lost or mismatched answer is not confirmed', async () => {
  const cases = [
    [async () => ({ error: { code: 'P0001', message: 'This exception is already resolved.' } }), 'Not resolved: This exception is already resolved.'],
    [async () => { throw new Error('network'); }, /^The resolution was not confirmed\. Refresh the accounts/],
    [async () => ({ data: null }), /^The resolution was not confirmed\./],
    [async () => ({ data: { exception_key: 'duplicate_charge:other', resolved_at: '2026-09-24T02:00:00Z' } }), /^The resolution was not confirmed\./],
  ];
  for (const [reply, expected] of cases) {
    const h = await load({ exceptions: moneyRows(), rpc: { studio_resolve_money_exception: reply } });
    const form = resolveFormOf(moneyItems(h)[1]);
    const input = form.all().find(el => el.tagName === 'INPUT');
    input.value = 'sq-refund-0042';
    await form.fire('submit');
    const result = form.all().find(el => el.className === 'studio-result').textContent;
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.equal(moneyItems(h).length, 4, 'the row stays');
    assert.equal(input.value, 'sq-refund-0042', 'what was typed stays');
    assert.equal(submitOf(form).disabled, false);
    assert.doesNotMatch(h.ids['studio-status'].textContent, /^Resolved/);
  }
});

test('a declined, unconfirmable or non-opaque resolution sends nothing', async () => {
  const declined = await load({ exceptions: moneyRows(), confirm: false });
  const form = resolveFormOf(moneyItems(declined)[0]);
  form.all().find(el => el.tagName === 'INPUT').value = 'sq-refund-0042';
  await form.fire('submit');
  assert.equal(declined.confirms.length, 1);
  assert.equal(form.all().find(el => el.className === 'studio-result').textContent, 'Left unchanged.');
  assert.equal(resolveCalls(declined).length, 0);
  assert.equal(moneyItems(declined).length, 4);
  const none = await load({ exceptions: moneyRows(), noConfirm: true });
  const noneForm = resolveFormOf(moneyItems(none)[0]);
  noneForm.all().find(el => el.tagName === 'INPUT').value = 'sq-refund-0042';
  await noneForm.fire('submit');
  assert.equal(resolveCalls(none).length, 0);
  for (const value of ['', 'x', 'owner@example.com', 'refund 42', '-abc']) {
    const h = await load({ exceptions: moneyRows() });
    const bad = resolveFormOf(moneyItems(h)[0]);
    bad.all().find(el => el.tagName === 'INPUT').value = value;
    await bad.fire('submit');
    assert.equal(h.confirms.length, 0, value);
    assert.equal(resolveCalls(h).length, 0, value);
    assert.match(bad.all().find(el => el.className === 'studio-result').textContent, /^Enter the resolution reference/);
  }
});

test('the money band keeps the desk\'s phone and target rules', () => {
  assert.match(styles, /\.studio-money-item dd \{[^}]*overflow-wrap: anywhere/s);
  assert.match(styles, /\.studio-money-list \{[^}]*list-style: none/s);
  assert.doesNotMatch(styles, /@import|url\(/);
});

/* ---- Capture queue (20260924140000) ----------------------------------- */
const HOUR = 3600000;
const inHours = hours => new Date(Date.now() + hours * HOUR).toISOString();
const job = (id, workspace, overrides = {}) => ({ job_id: id, workspace_id: workspace, founding: false, status: 'queued', stage: null, attempt: 0,
  error_code: null, queued_at: inHours(-2), claimed_at: null, completed_at: null, failed_at: null, queue_position: null, priority: 'standard',
  elapsed_hours: 2, sla_hours: 24, sla_due_at: inHours(22), sla_state: 'open', ...overrides });
const queueRows = () => [
  job('3f2e1d0c-0000-4000-8000-00000000000a', 'ws-wren', { founding: true, priority: 'founding', queue_position: 1, elapsed_hours: 3.2, sla_hours: 12 }),
  job('4a3b2c1d-0000-4000-8000-00000000000b', 'ws-northgate', { priority: 'promoted', queue_position: 2, elapsed_hours: 7.5 }),
  job('6c5d4e3f-0000-4000-8000-00000000000d', 'ws-unknown-9999', { status: 'processing', stage: 'reconstructing', attempt: 2, elapsed_hours: 26.4,
    sla_due_at: '2026-09-24T10:30:00Z', sla_state: 'breached' }),
  job('7d6e5f40-0000-4000-8000-00000000000e', 'ws-wren', { founding: true, priority: 'founding', status: 'failed', error_code: 'lease_expired', elapsed_hours: 0.5,
    sla_hours: 12, sla_state: 'open' }),
  job('8e7f6051-0000-4000-8000-00000000000f', 'ws-kelvin-grove', { status: 'uploading', queued_at: null, elapsed_hours: null, sla_due_at: null, sla_state: 'not_started' }),
  job('9f807162-0000-4000-8000-000000000010', 'ws-wren', { status: 'awaiting_review', completed_at: inHours(-1), elapsed_hours: 13.4, sla_hours: 12, sla_state: 'breached' }),
  job('a0918273-0000-4000-8000-000000000011', 'ws-northgate', { status: 'awaiting_review', completed_at: inHours(-3), elapsed_hours: 11.6, sla_state: 'met' }),
];
const slaRows = () => [
  { priority_class: 'founding', sla_hours: 12, completed: 4, met: 3, breached: 1, p50_hours: 7.25, p90_hours: 13.4, open_jobs: 2, open_breached: 1, oldest_queued_hours: 3.2 },
  { priority_class: 'standard', sla_hours: 24, completed: 0, met: 0, breached: 0, p50_hours: null, p90_hours: null, open_jobs: 3, open_breached: 1, oldest_queued_hours: 7.5 },
];
const queueBody = h => h.ids['studio-queue-rows'];
const queueCells = row => row.children.map(cellEl => cellEl.text());
const slaText = h => h.ids['studio-sla-body'].all().map(el => el.textContent).filter(Boolean).join(' | ');

test('the capture queue lists open jobs in claim order with priority, age since upload, due time and target', async () => {
  const h = await load({ queue: queueRows(), sla: slaRows() });
  const rows = queueBody(h).children;
  assert.equal(rows.length, 5, 'finished jobs are counted, not listed');
  assert.deepEqual(rows.map(row => row.children[0].children.map(el => el.textContent)), [
    ['Job 3f2e1d0c', 'Wren & Fielding'], ['Job 4a3b2c1d', 'Northgate Property Co'], ['Job 6c5d4e3f', 'Account ws-unkno'],
    ['Job 7d6e5f40', 'Wren & Fielding'], ['Job 8e7f6051', 'Kelvin Grove Dental']]);
  assert.deepEqual(rows.map(row => row.children.slice(1).map(el => el.dataset.label)).at(0),
    ['In line', 'Priority', 'Status', 'Since upload', 'Due', 'Target'], 'each cell restates its column on a phone');
  assert.deepEqual(rows.map(row => row.children[1].textContent), ['1', '2', '—', '—', '—']);
  assert.deepEqual(rows.map(row => row.children[2].text()), ['Founding', 'Waited over 6 h', 'Standard', 'Founding', 'Standard']);
  assert.match(rows[0].children[2].children[0].className, /\bpill\b/);
  assert.deepEqual(rows.map(row => row.children[3].textContent), ['Queued', 'Queued', 'Processing · reconstructing', 'Failed · lease expired', 'Uploading']);
  assert.deepEqual(rows.map(row => row.children[4].textContent), ['3.2 h', '7.5 h', '26.4 h', '30 min', '—']);
  assert.equal(rows[2].children[5].textContent.replace(/^\d+ \w{3}(?: \d{4})?, /, ''), '20:30', 'due at the Brisbane clock');
  assert.equal(rows[4].children[5].textContent, '—');
  assert.deepEqual(rows.map(row => row.children[6].text()), ['On time (12 h)', 'On time (24 h)', 'Over target (24 h)', 'On time (12 h)', 'Not started (24 h)']);
  // Over target is a word in the existing pill, never colour alone.
  assert.match(rows[2].children[6].children[0].className, /\bpill\b.*\bpill-busy\b/);
  assert.equal(rows[2].dataset.breached, 'true');
  assert.equal(h.ids['studio-queue-summary'].textContent, '5 open · 1 over target · longest in line 7.5 h · 2 finished in the last 30 days, 1 over target');
  assert.equal(h.ids['studio-queue-table'].attributes['aria-busy'], 'false');
});

test('the last 7 days are read with that window and shown per class; a failed read is not a quiet week', async () => {
  const h = await load({ queue: queueRows(), sla: slaRows() });
  assert.deepEqual(h.calls.filter(([name]) => name === 'studio_capture_sla').map(([, args]) => ({ ...args })), [{ p_days: 7 }]);
  assert.deepEqual(h.calls.filter(([name]) => name === 'studio_capture_queue').map(([, args]) => args), [undefined]);
  const classes = h.ids['studio-sla-body'].all().filter(el => el.className === 'studio-sla-class');
  assert.deepEqual(classes.map(item => item.children[0].textContent), ['Founding accounts · 12-hour target', 'Everyone else · 24-hour target']);
  const terms = item => item.all().filter(el => el.tagName === 'DIV' && el.children[0]?.tagName === 'DT').map(group => group.children.map(el => el.textContent));
  assert.deepEqual(terms(classes[0]), [['Finished', '4'], ['Within target', '3'], ['Over target', '1'], ['Median', '7.3 h'], ['90th percentile', '13.4 h']]);
  assert.deepEqual(terms(classes[1]).slice(3), [['Median', '—'], ['90th percentile', '—']], 'no finished job has no median');
  assert.equal(classes[0].dataset.breached, 'true');
  assert.equal(markup.includes('<h3 class="studio-queue-subhead" id="studio-sla-title">Last 7 days</h3>'), true);
  let attempt = 0;
  const failing = await load({ queue: queueRows(), rpc: { studio_capture_sla: async () => ++attempt === 1 ? { error: { message: 'offline' } } : { data: slaRows() } } });
  assert.match(slaText(failing), /^Target figures could not be loaded\. This is a failed request, not a quiet week\./);
  assert.equal(queueBody(failing).children.length, 5, 'the queue does not wait for, or fail with, the figures');
  await failing.ids['studio-sla-body'].all().find(el => el.textContent === 'Retry').fire('click');
  await failing.settle();
  assert.equal(failing.ids['studio-sla-body'].all().filter(el => el.className === 'studio-sla-class').length, 2);
});

test('an empty, failed or pending capture queue says which it is', async () => {
  const empty = await load({ queue: [], sla: slaRows() });
  assert.equal(queueBody(empty).children.length, 1);
  assert.equal(queueBody(empty).children[0].text(), 'No capture is waiting. A job appears here once its upload has finished.');
  assert.equal(empty.ids['studio-queue-summary'].textContent, 'Nothing open · none finished in the last 30 days');
  const quiet = await load({ queue: queueRows().filter(row => row.status === 'awaiting_review') });
  assert.equal(quiet.ids['studio-queue-summary'].textContent, 'Nothing open · 2 finished in the last 30 days, 1 over target');
  for (const reply of [async () => ({ error: { message: 'offline' } }), async () => { throw new Error('network'); }, async () => ({ data: null })]) {
    let attempt = 0;
    const h = await load({ rpc: { studio_capture_queue: async () => ++attempt === 1 ? reply() : { data: queueRows() } } });
    assert.match(queueBody(h).children[0].text(), /^The capture queue could not be loaded\. This is a failed request, not an empty queue\./);
    assert.equal(h.ids['studio-queue-summary'].textContent, 'The capture queue is unavailable.');
    await queueBody(h).all().find(el => el.textContent === 'Retry').fire('click');
    await h.settle();
    assert.equal(attempt, 2);
    assert.equal(queueBody(h).children.length, 5);
  }
  let finish;
  const pending = await load({ rpc: { studio_capture_queue: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(pending.ids['studio-queue-table'].attributes['aria-busy'], 'true');
  assert.equal(pending.ids['studio-queue-summary'].textContent, 'Reading the capture queue…');
  assert.ok(queueBody(pending).children.every(row => row.className === 'studio-row studio-skeleton' && row.attributes['aria-hidden'] === 'true'));
  assert.equal(pending.dataRows().length, 3, 'the accounts never wait for the queue');
  finish({ data: queueRows() });
  await pending.settle();
  assert.equal(queueBody(pending).children.length, 5);
});

test('the queue names accounts once they arrive, and clears on sign-out', async () => {
  let finish;
  const h = await load({ queue: queueRows(), rpc: { studio_list_accounts: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(queueBody(h).children[0].children[0].children[1].textContent, 'Account ws-wren');
  finish({ data: accounts() });
  await h.settle();
  assert.equal(queueBody(h).children[0].children[0].children[1].textContent, 'Wren & Fielding');
  assert.ok(markup.indexOf('id="studio-deletions"') < markup.indexOf('id="studio-queue"'));
  assert.ok(markup.indexOf('id="studio-queue"') < markup.indexOf('id="studio-table"'));
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(queueBody(h).children.length, 0);
  assert.equal(h.ids['studio-queue-summary'].textContent, '');
  assert.equal(h.ids['studio-sla-body'].children.length, 0);
  const outsider = await load({ queue: queueRows(), rpc: { studio_is_member: async () => ({ data: false }) } });
  assert.equal(outsider.calls.some(([name]) => ['studio_capture_queue', 'studio_capture_sla'].includes(name)), false);
});

/* ---- Record correction ------------------------------------------------ */
const NEW_PACKAGE = '9f8e7d6c-0000-4000-8000-000000000a0a';
const LIVE_WALKTHROUGH = '1a2b3c4d-0000-4000-8000-000000000001';
const correctionForm = h => h.ids['studio-correction-body'].all().find(el => el.tagName === 'FORM');
const correctionInput = (h, name) => correctionForm(h).all().find(el => el.tagName === 'INPUT' && el.name === name && el.type !== 'radio');
const correctionRadio = (h, value) => correctionForm(h).all().find(el => el.type === 'radio' && el.value === value);
const correctionCalls = h => h.calls.filter(([name]) => name === 'studio_record_tour_correction');
const fillCorrection = (h, values = {}) => {
  correctionInput(h, 'tour_id').value = values.tour ?? NEW_PACKAGE;
  correctionInput(h, 'corrects_tour_id').value = values.corrects ?? LIVE_WALKTHROUGH;
  if (values.reason !== null) correctionRadio(h, values.reason ?? 'requested_change').checked = true;
  correctionInput(h, 'reference').value = values.reference ?? 'TCK-1042';
};
const recorded = (args, overrides = {}) => ({ data: { tour_id: args.p_tour_id, walkthrough_id: args.p_corrects_tour_id, revision: 2,
  corrects_tour_id: args.p_corrects_tour_id, reason: args.p_reason, reference: args.p_reference, recorded_at: '2026-09-24T03:00:00Z',
  recorded: true, walkthrough_accepted: true, ...overrides } });

test('Record correction is one inline form: labelled fields, both tours, a reason, a reference and one filled button', async () => {
  assert.match(markup, /<section class="studio-corrections" id="studio-corrections" aria-labelledby="studio-corrections-title">/);
  assert.match(markup, /<h2 class="dash-heading" id="studio-corrections-title">Corrections<\/h2>/);
  assert.ok(markup.indexOf('id="studio-hosted"') < markup.indexOf('id="studio-corrections"'));
  const h = await load({ hosted: [hostedRow(LIVE_WALKTHROUGH, 'Harbour loft', 'active', 200), hostedRow('not-a-uuid', 'Odd row', 'active', 100)] });
  const details = h.ids['studio-correction-body'].children[0];
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.open, false, 'closed until the studio opens it');
  assert.equal(details.children[0].textContent, 'Record correction');
  const form = correctionForm(h);
  for (const name of ['tour_id', 'corrects_tour_id', 'reference']) {
    const input = correctionInput(h, name);
    assert.ok(labelOf(form, input)?.textContent, name + ' has a visible label');
    assert.equal(input.required, true, name);
  }
  assert.equal(labelOf(form, correctionInput(h, 'tour_id')).textContent, 'New package (tour id)');
  assert.equal(labelOf(form, correctionInput(h, 'corrects_tour_id')).textContent, 'Walkthrough it corrects (tour id of its latest version)');
  const ids = new RegExp('^(?:' + correctionInput(h, 'tour_id').pattern + ')$', 'v');
  assert.deepEqual([NEW_PACKAGE, 'x', NEW_PACKAGE.slice(0, 8)].map(value => ids.test(value)), [true, false, false]);
  // The note describes its field instead of lengthening its name.
  const note = form.all().find(el => el.id === correctionInput(h, 'tour_id').attributes['aria-describedby']);
  assert.equal(note.textContent, 'The ready package, not yet reviewed by the account.');
  const legend = form.all().find(el => el.tagName === 'LEGEND');
  assert.equal(legend.textContent, 'Reason');
  assert.deepEqual(form.all().filter(el => el.type === 'radio').map(el => [el.value, el.required]), [['defect', true], ['requested_change', true], ['first_walkthrough_redo', true]]);
  // Offer 2026-09-25.2: the free redo of the first walkthrough is a correction too, with its scope beside it.
  const redo = form.all().find(el => el.value === 'first_walkthrough_redo');
  const redoNote = form.all().find(el => el.id === redo.attributes['aria-describedby']);
  assert.equal(redoNote.textContent, 'First-walkthrough redo: only for the account’s first accepted walkthrough, once per account. It uses no walkthrough and keeps the same link; a new capture visit is not included.');
  assert.deepEqual(form.all().filter(el => el.tagName === 'BUTTON').map(el => [el.textContent, el.type, el.className]), [['Record correction', 'submit', 'button']]);
  assert.equal(form.all().find(el => el.className === 'studio-result').attributes.role, 'status');
  // Released walkthroughs are offered as suggestions, by title and short reference.
  const list = form.all().find(el => el.tagName === 'DATALIST');
  assert.equal(correctionInput(h, 'corrects_tour_id').attributes.list, list.id);
  assert.deepEqual(list.children.map(option => [option.value, option.label]), [[LIVE_WALKTHROUGH, 'Harbour loft · walkthrough 1a2b3c4d']]);
});

test('recording sends the exact tours, reason and reference after a confirmation naming both, then states the version', async () => {
  const h = await load({ hosted: [hostedRow(LIVE_WALKTHROUGH, 'Harbour loft', 'active', 200)],
    rpc: { studio_record_tour_correction: async args => recorded(args) } });
  fillCorrection(h, { tour: ' ' + NEW_PACKAGE.toUpperCase() + ' ', reference: ' TCK-1042 ' });
  await correctionForm(h).fire('submit');
  assert.equal(h.confirms.length, 1);
  assert.equal(h.confirms[0], 'Record package 9f8e7d6c as a correction of walkthrough 1a2b3c4d (Harbour loft)? Reason: requested change. Reference: TCK-1042. ' +
    'When the account approves it, its link and embed move to package 9f8e7d6c. This cannot be moved to another walkthrough later.');
  assert.deepEqual(correctionCalls(h).map(([, args]) => ({ ...args })),
    [{ p_tour_id: NEW_PACKAGE, p_corrects_tour_id: LIVE_WALKTHROUGH, p_reason: 'requested_change', p_reference: 'TCK-1042' }]);
  const said = 'Recorded: package 9f8e7d6c is version 2 of walkthrough 1a2b3c4d. Approving it uses no walkthrough from the account’s allowance.';
  assert.equal(resultOf(correctionForm(h)), said);
  assert.equal(h.ids['studio-status'].textContent, said);
  assert.deepEqual(['tour_id', 'corrects_tour_id', 'reference'].map(name => correctionInput(h, name).value), ['', '', '']);
  assert.equal(correctionRadio(h, 'requested_change').checked, false);
  // A replay answers the same record; a walkthrough not yet accepted says its first approval counts.
  const again = await load({ rpc: { studio_record_tour_correction: async args => recorded(args, { recorded: false, revision: 3, walkthrough_accepted: false }) } });
  fillCorrection(again, { reason: 'defect' });
  await correctionForm(again).fire('submit');
  assert.match(again.confirms[0], /Reason: studio defect\./);
  assert.equal(resultOf(correctionForm(again)), 'Already recorded: package 9f8e7d6c is version 3 of walkthrough 1a2b3c4d. That walkthrough has not been accepted yet, so its first approval uses one walkthrough.');
});

test('a missing or malformed tour, the same tour twice, no reason, a non-opaque reference or a declined confirmation sends nothing', async () => {
  const cases = [
    [{ tour: '' }, 'Enter the new package’s full tour id (36 characters).'],
    [{ tour: NEW_PACKAGE.slice(0, 8) }, 'Enter the new package’s full tour id (36 characters).'],
    [{ corrects: 'harbour loft' }, 'Enter the full tour id of the walkthrough’s latest version (36 characters).'],
    [{ corrects: NEW_PACKAGE }, 'The new package and the walkthrough it corrects must be different tours.'],
    [{ reason: null }, 'Choose the reason: a studio defect, a requested change or the first-walkthrough redo.'],
    [{ reference: 'owner@example.com' }, /^Enter the ticket or estimate reference/],
    [{ reference: 'x' }, /^Enter the ticket or estimate reference/],
  ];
  for (const [values, expected] of cases) {
    const h = await load();
    fillCorrection(h, values);
    await correctionForm(h).fire('submit');
    const result = resultOf(correctionForm(h));
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.equal(h.confirms.length, 0, JSON.stringify(values));
    assert.equal(correctionCalls(h).length, 0, JSON.stringify(values));
  }
  const declined = await load({ confirm: false });
  fillCorrection(declined);
  await correctionForm(declined).fire('submit');
  assert.equal(resultOf(correctionForm(declined)), 'Left unchanged.');
  assert.equal(correctionCalls(declined).length, 0);
  const none = await load({ noConfirm: true });
  fillCorrection(none);
  await correctionForm(none).fire('submit');
  assert.equal(correctionCalls(none).length, 0);
});

test('a refused correction shows the server reason and keeps what was typed; a lost or odd answer says a resend is safe', async () => {
  const cases = [
    [async () => ({ error: { code: 'P0001', message: 'correct the latest revision of this walkthrough (revision 2)' } }), 'Not recorded: correct the latest revision of this walkthrough (revision 2)'],
    [async () => { throw new Error('network'); }, 'The correction was not confirmed. Sending the same details again is safe: an identical request returns the same record.'],
    [async () => ({ data: null }), /^The correction was not confirmed\./],
    [async args => recorded(args, { tour_id: LIVE_WALKTHROUGH }), /^The correction was not confirmed\./],
    [async args => recorded(args, { revision: 1 }), /^The correction was not confirmed\./],
  ];
  for (const [reply, expected] of cases) {
    const h = await load({ rpc: { studio_record_tour_correction: reply } });
    fillCorrection(h);
    await correctionForm(h).fire('submit');
    const result = resultOf(correctionForm(h));
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.equal(correctionInput(h, 'tour_id').value, NEW_PACKAGE, 'what was typed stays');
    assert.equal(correctionInput(h, 'reference').value, 'TCK-1042');
    assert.equal(submitOf(correctionForm(h)).disabled, false);
    assert.doesNotMatch(h.ids['studio-status'].textContent, /^Recorded/);
  }
  const h = await load();
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['studio-correction-body'].children.length, 0, 'the form leaves with the desk');
});

/* ---- Whole-home count (offer v8 migration) ---------------------------------
 * studio_set_listing_home(p_property_id, p_bedrooms 0-99, p_second_dwelling,
 * p_floor_area_m2 int|null, p_reference) answers the listing's state:
 * { property_id, declared, bedrooms, second_dwelling, floor_area_m2, declared_at,
 *   walkthrough_units, locked, locked_at }. The capture queue is unchanged.
 */
const LISTING = '5e6f7081-0000-4000-8000-00000000000c';
const homeForm = h => h.ids['studio-home-body'].all().find(el => el.tagName === 'FORM');
const homeField = (h, name) => homeForm(h).all().find(el => el.name === name && el.type !== 'radio');
const homeRadio = (h, value) => homeForm(h).all().find(el => el.type === 'radio' && el.value === value);
const homeCalls = h => h.calls.filter(([name]) => name === 'studio_set_listing_home');
const fillHome = (h, values = {}) => {
  homeField(h, 'property_id').value = values.listing ?? LISTING;
  homeField(h, 'bedrooms').value = values.bedrooms ?? '5';
  if (values.dwelling !== null) homeRadio(h, values.dwelling ?? 'no').checked = true;
  homeField(h, 'floor_area_m2').value = values.area ?? '';
  homeField(h, 'reference').value = values.reference ?? 'TCK-2201';
};
const homeState = (args, extra = {}) => ({ data: { property_id: args.p_property_id, declared: true, bedrooms: args.p_bedrooms,
  second_dwelling: args.p_second_dwelling, floor_area_m2: args.p_floor_area_m2, declared_at: '2026-09-20T01:00:00Z',
  walkthrough_units: args.p_bedrooms >= 5 || args.p_second_dwelling || args.p_floor_area_m2 > 350 ? 2 : 1,
  locked: true, locked_at: '2026-09-22T23:30:00Z', ...extra } });

test('the capture queue reads no whole-home fields; the rule sits with its own correction form', async () => {
  const rows = queueRows();
  Object.assign(rows[0], { walkthrough_units: 2, units_reason: 'bedrooms_5_plus', units_locked: true });
  const h = await load({ queue: rows });
  assert.ok(queueBody(h).children.every(row => row.children[0].children.length === 2), 'the queue is unchanged');
  assert.doesNotMatch(h.ids['studio-queue-rows'].text(), /Counts as/);
  const note = markup.slice(markup.indexOf('id="studio-home"'), markup.indexOf('id="studio-home-body"')).replace(/\s+/g, ' ');
  assert.match(markup, /<h2 class="dash-heading" id="studio-home-title">Whole-home count<\/h2>/);
  assert.match(note, /1 walkthrough is one visit to the interior rooms of one home\. A home with 5 or more bedrooms, a second dwelling or more than 350 m² of floor area counts as 2: the account declares it when it adds the listing, and the count locks when capture starts\./);
  assert.match(offer.walkthroughScope.countsAsTwo, /5 or more bedrooms, a second dwelling, or more than 350 m²/);
  assert.ok(markup.indexOf('id="studio-corrections"') < markup.indexOf('id="studio-home"'));
});

test('Correct the whole-home count is one inline form: labelled native fields, one filled button and a live result', async () => {
  const h = await load();
  const details = h.ids['studio-home-body'].children[0];
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.open, false, 'closed until the studio opens it');
  assert.equal(details.children[0].textContent, 'Correct the whole-home count');
  const form = homeForm(h);
  assert.deepEqual(['property_id', 'bedrooms', 'floor_area_m2', 'reference'].map(name => labelOf(form, homeField(h, name))?.textContent),
    ['Listing (property id)', 'Bedrooms (0–99)', 'Floor area in m² (optional)', 'Ticket or estimate reference']);
  assert.deepEqual([homeField(h, 'bedrooms').type, homeField(h, 'bedrooms').min, homeField(h, 'bedrooms').max, homeField(h, 'bedrooms').required], ['number', '0', '99', true]);
  assert.deepEqual([homeField(h, 'floor_area_m2').type, Boolean(homeField(h, 'floor_area_m2').required)], ['number', false], 'the floor area is optional');
  assert.equal(form.all().find(el => el.tagName === 'LEGEND').textContent, 'Second dwelling');
  assert.deepEqual(form.all().filter(el => el.type === 'radio').map(el => [el.value, el.required]), [['yes', true], ['no', true]]);
  const ids = new RegExp('^(?:' + homeField(h, 'property_id').pattern + ')$', 'v');
  assert.deepEqual([LISTING, LISTING.slice(0, 8), 'x'].map(value => ids.test(value)), [true, false, false]);
  const refs = new RegExp('^(?:' + homeField(h, 'reference').pattern + ')$', 'v');
  assert.deepEqual(['TCK-2201', 'owner@example.com'].map(value => refs.test(value)), [true, false]);
  assert.deepEqual(form.all().filter(el => el.tagName === 'BUTTON').map(el => [el.textContent, el.type, el.className]), [['Correct the whole-home count', 'submit', 'button']]);
  assert.equal(form.all().find(el => el.className === 'studio-result').attributes.role, 'status');
  h.client.auth.callback('SIGNED_OUT', null);
  assert.equal(h.ids['studio-home-body'].children.length, 0, 'the form leaves with the desk');
});

test('a correction sends the declared facts after a named confirmation, then states the count and the lock from the answer', async () => {
  const h = await load({ rpc: { studio_set_listing_home: async args => homeState(args) } });
  fillHome(h, { listing: ' ' + LISTING.toUpperCase() + ' ', bedrooms: '5', dwelling: 'no', area: '', reference: ' TCK-2201 ' });
  await homeForm(h).fire('submit');
  assert.equal(h.confirms.length, 1);
  assert.equal(h.confirms[0], 'Correct the whole-home count for listing 5e6f7081? Declared: 5 bedrooms, no second dwelling, floor area not given. ' +
    'By the offer rule this counts as 2. Reference: TCK-2201. A walkthrough already accepted keeps the units it used; the server keeps an audit row.');
  assert.deepEqual(homeCalls(h).map(([, args]) => ({ ...args })), [{ p_property_id: LISTING, p_bedrooms: 5, p_second_dwelling: false, p_floor_area_m2: null, p_reference: 'TCK-2201' }]);
  const said = 'Corrected listing 5e6f7081: Counts as 2 · 5+ bedrooms · locked since capture started (' + brisbaneDay('2026-09-22T23:30:00Z') + ').';
  assert.equal(resultOf(homeForm(h)), said);
  assert.equal(h.ids['studio-status'].textContent, said);
  assert.deepEqual(['property_id', 'bedrooms', 'floor_area_m2', 'reference'].map(name => homeField(h, name).value), ['', '', '', '']);
  // Every reason is named, and a home that counts as 1 says so plainly.
  const all = await load({ rpc: { studio_set_listing_home: async args => homeState(args, { locked: false, locked_at: null }) } });
  fillHome(all, { bedrooms: '6', dwelling: 'yes', area: '420' });
  await homeForm(all).fire('submit');
  assert.deepEqual({ ...homeCalls(all)[0][1] }, { p_property_id: LISTING, p_bedrooms: 6, p_second_dwelling: true, p_floor_area_m2: 420, p_reference: 'TCK-2201' });
  assert.equal(resultOf(homeForm(all)), 'Corrected listing 5e6f7081: Counts as 2 · 5+ bedrooms · second dwelling · over 350 m².');
  const one = await load({ rpc: { studio_set_listing_home: async args => homeState(args, { locked: false, locked_at: null }) } });
  fillHome(one, { bedrooms: '3', dwelling: 'no', area: '180' });
  await homeForm(one).fire('submit');
  assert.match(one.confirms[0], /this counts as 1\./);
  assert.equal(resultOf(homeForm(one)), 'Corrected listing 5e6f7081: Counts as 1.');
});

test('a missing or malformed fact, a non-opaque reference or a declined confirmation sends nothing; a refusal keeps the form', async () => {
  const cases = [
    [{ listing: LISTING.slice(0, 8) }, 'Enter the listing’s full property id (36 characters).'],
    [{ bedrooms: '' }, 'Enter the number of bedrooms, 0 to 99.'],
    [{ bedrooms: '100' }, 'Enter the number of bedrooms, 0 to 99.'],
    [{ bedrooms: '2.5' }, 'Enter the number of bedrooms, 0 to 99.'],
    [{ dwelling: null }, 'Say whether there is a second dwelling.'],
    [{ area: '0' }, 'Enter the floor area in whole square metres (1 to 100000), or leave it empty.'],
    [{ area: '120.5' }, 'Enter the floor area in whole square metres (1 to 100000), or leave it empty.'],
    [{ reference: 'owner@example.com' }, /^Enter the ticket or estimate reference/],
  ];
  for (const [values, expected] of cases) {
    const h = await load();
    fillHome(h, values);
    await homeForm(h).fire('submit');
    const result = resultOf(homeForm(h));
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.equal(h.confirms.length, 0, JSON.stringify(values));
    assert.equal(homeCalls(h).length, 0, JSON.stringify(values));
  }
  const declined = await load({ confirm: false });
  fillHome(declined);
  await homeForm(declined).fire('submit');
  assert.equal(resultOf(homeForm(declined)), 'Left unchanged.');
  assert.equal(homeCalls(declined).length, 0);
  const none = await load({ noConfirm: true });
  fillHome(none);
  await homeForm(none).fire('submit');
  assert.equal(homeCalls(none).length, 0);
  const replies = [
    [async () => ({ error: { code: 'P0001', message: 'listing not available' } }), 'Not corrected: listing not available'],
    [async () => { throw new Error('network'); }, 'The correction was not confirmed. Sending the same details again is safe: it sets the same facts.'],
    [async () => ({ error: { message: 'offline' } }), /^The correction was not confirmed\./],
    [async args => homeState(args, { property_id: 'other' }), /^The correction was not confirmed\./],
    [async args => homeState(args, { walkthrough_units: 3 }), /^The correction was not confirmed\./],
    [async args => homeState(args, { locked: 'yes' }), /^The correction was not confirmed\./],
  ];
  for (const [reply, expected] of replies) {
    const h = await load({ rpc: { studio_set_listing_home: reply } });
    fillHome(h);
    await homeForm(h).fire('submit');
    const result = resultOf(homeForm(h));
    if (typeof expected === 'string') assert.equal(result, expected); else assert.match(result, expected);
    assert.deepEqual(['property_id', 'bedrooms', 'reference'].map(name => homeField(h, name).value), [LISTING, '5', 'TCK-2201'], 'what was typed stays');
    assert.equal(submitOf(homeForm(h)).disabled, false);
    assert.doesNotMatch(h.ids['studio-status'].textContent, /^Corrected/);
  }
});

/* ---- Offer v9: Super fast renders (code name express), the capture queue's
 * express priority and the first-walkthrough redo (studio_express_queue and the
 * redo reason are proposed names). Owner decision, 25 September 2026: processing
 * is automatic; Super fast is ready for review within 30 minutes of the upload
 * finishing, any day, any time, with no daily cap, and a missed one is refunded
 * automatically. The desk lists what is owed and counts, never acts. */
const minutesFrom = minutes => new Date(Date.now() + minutes * 60000).toISOString();
// uploadedAgo null: the upload has not finished, so the 30-minute clock has not started.
// withDue false: the row carries only uploaded_at, and the desk derives the due time.
const expressOrder = (job_id, workspace_id, paid_with, uploadedAgo, state, { refund = null, completedAgo = null, withDue = true, ...extra } = {}) => ({
  express_id: 'x-' + job_id.slice(0, 8), job_id, workspace_id, paid_with, amount_cents: paid_with === 'card' ? OFFER.express : null,
  ordered_at: minutesFrom(-(uploadedAgo ?? 0) - 5), uploaded_at: uploadedAgo === null ? null : minutesFrom(-uploadedAgo),
  due_at: uploadedAgo === null || !withDue ? null : minutesFrom(30 - uploadedAgo), completed_at: completedAgo === null ? null : minutesFrom(-completedAgo),
  state, refund, refunded_at: null, ...extra });
const expressOrders = () => [
  expressOrder('e1f2a3b4-0000-4000-8000-0000000000e1', 'ws-northgate', 'card', 10, 'open', { daily_cap: 5 }),
  expressOrder('e2f3a4b5-0000-4000-8000-0000000000e2', 'ws-wren', 'credit', 45, 'open', { withDue: false, daily_cap: null }),
  expressOrder('e6a7b8c9-0000-4000-8000-0000000000e6', 'ws-northgate', 'card', null, 'open'),
  expressOrder('e3f4a5b6-0000-4000-8000-0000000000e3', 'ws-kelvin-grove', 'card', 3 * 1440, 'met', { completedAgo: 3 * 1440 - 25 }),
  expressOrder('e4f5a6b7-0000-4000-8000-0000000000e4', 'ws-northgate', 'card', 4 * 1440, 'missed', { refund: 'refunded' }),
  expressOrder('e5f6a7b8-0000-4000-8000-0000000000e5', 'ws-kelvin-grove', 'card', 2 * 1440, 'missed', { refund: 'pending' }),
];
const expressBody = h => h.ids['studio-express-rows'];
const NO_CAP = /business hours|business h\b|daily cap|\d+ a day|of \d+ taken|\(full\)|studio check/i;

test('offer v9: the Super fast band lists open renders soonest due first, then a refund not through, with the 30-minute promise in words', async () => {
  assert.match(markup, /<section class="studio-queue studio-express" id="studio-express" aria-labelledby="studio-express-title">/);
  assert.ok(markup.indexOf('id="studio-express"') < markup.indexOf('id="studio-queue"'), 'Super fast is read before the queue it jumps');
  assert.match(markup, /<h2 class="dash-heading" id="studio-express-title">Super fast renders<\/h2>/);
  assert.match(markup.replace(/\s+/g, ' '), /ready for review within 30 minutes of the upload finishing, any day, any time\. Open ones are listed soonest due first, then any missed one whose refund has not gone through\. A missed one is refunded automatically: the A\$29, or the bonus render returned\./);
  assert.doesNotMatch(markup, NO_CAP, 'no cap, no business hours and no studio check on the desk');
  // The offer record agrees: A$29, no daily cap, refunded if not ready 30 minutes after the upload finishes.
  assert.deepEqual([OFFER.express, OFFER.expressCap], [2900, null]);
  assert.match(offer.expressRender.refund, /isn't ready for review within 30 minutes of the upload finishing/);
  const h = await load({ express: expressOrders() });
  assert.deepEqual(h.calls.filter(([name]) => name === 'studio_express_queue').map(([, args]) => args), [undefined]);
  assert.ok(!h.calls.some(([name]) => name === 'get_express_offer'), 'the desk never reads the account offer or its cap');
  const rows = expressBody(h).children;
  assert.deepEqual(rows.map(row => row.children[0].children[0].textContent), ['Job e2f3a4b5', 'Job e1f2a3b4', 'Job e6a7b8c9', 'Job e5f6a7b8'],
    'late first, then on time, then one whose upload has not finished, then the refund not through');
  const cells = row => Object.fromEntries(row.children.slice(1).map(td => [td.dataset.label, td.text()]));
  assert.deepEqual(Object.keys(cells(rows[0])), ['Paid with', 'Ordered', 'Due', 'Left', 'Promise']);
  assert.equal(cells(rows[0])['Paid with'], 'Bonus render');
  assert.equal(cells(rows[1])['Paid with'], 'Card · A$29');
  // Due is the upload finishing plus 30 minutes, even when the row carries no due_at.
  assert.notEqual(cells(rows[0]).Due, '—');
  assert.match(cells(rows[0]).Left, /^late 1[45] min$/);
  assert.match(cells(rows[1]).Left, /^(19|20) min$/);
  assert.equal(cells(rows[0]).Promise, 'Late (30 min)');
  assert.equal(rows[0].dataset.breached, 'true');
  assert.equal(rows[0].children[5].children[0].className, 'pill pill-busy studio-over', 'late is a word in a pill, never colour alone');
  assert.equal(cells(rows[1]).Promise, 'On time (30 min)');
  assert.equal(rows[1].dataset.breached, 'false');
  assert.deepEqual([cells(rows[2]).Due, cells(rows[2]).Left, cells(rows[2]).Promise], ['—', '—', 'Upload not finished (30 min)'], 'the clock starts when the upload finishes');
  assert.equal(cells(rows[3]).Promise, 'Missed · refund pending (30 min)');
  assert.equal(h.ids['studio-express-summary'].textContent, '3 open · 1 late · 1 refund not through');
  // The last 7 days against the promise, as a ledger: met and missed counts.
  const terms = h.ids['studio-express-sla'].all().filter(el => el.tagName === 'DT').map(el => el.textContent);
  const values = h.ids['studio-express-sla'].all().filter(el => el.tagName === 'DD').map(el => el.textContent);
  assert.deepEqual(terms, ['Finished', 'Within 30 minutes', 'Missed', 'Refunded or returned', 'Refund not through']);
  assert.deepEqual(values, ['3', '1', '2', '1', '1']);
  assert.doesNotMatch(h.ids['studio-express'].text(), NO_CAP);
});

test('offer v9: an empty, failed or not-yet-built Super fast band says which it is, and a busy day has no cap', async () => {
  const empty = await load({ express: [] });
  assert.match(expressBody(empty).children[0].text(), /^No Super fast render is open\./);
  assert.equal(empty.ids['studio-express-summary'].textContent, 'None open');
  assert.match(empty.ids['studio-express-sla'].text(), /No Super fast render finished in the last 7 days\./);
  let attempt = 0;
  const failing = await load({ rpc: { studio_express_queue: async () => ++attempt === 1 ? { error: { message: 'offline' } } : { data: expressOrders() } } });
  assert.match(expressBody(failing).children[0].text(), /^Super fast renders could not be loaded\. This is a failed request, not an empty list\./);
  assert.equal(failing.ids['studio-express-summary'].textContent, 'Super fast renders are unavailable.');
  await expressBody(failing).children[0].all().find(el => el.tagName === 'BUTTON').fire('click');
  await failing.settle();
  assert.equal(expressBody(failing).children.length, 4);
  const missing = await load({ rpc: { studio_express_queue: async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  assert.equal(missing.ids['studio-express-summary'].textContent, 'Super fast renders are not available on this server yet.');
  // Seven orders today, more than the old cap of 5: all listed, nothing reads full.
  const busy = await load({ express: [0, 1, 2, 3, 4, 5, 6].map(i => expressOrder('f' + i + '000000-0000-4000-8000-00000000000' + i, 'ws-wren', 'card', 5 + i, 'open', { daily_cap: i % 2 ? 5 : null })) });
  assert.equal(expressBody(busy).children.length, 7);
  assert.equal(busy.ids['studio-express-summary'].textContent, '7 open · 0 late');
  // The accounts never wait for, or fail with, the band.
  assert.equal(failing.dataRows().length, 3);
});

test('offer v9: the capture queue names a Super fast job first, as Super fast, against its 30-minute target', async () => {
  const express = { job_id: 'e1f2a3b4-0000-4000-8000-0000000000e1', workspace_id: 'ws-northgate', founding: false, status: 'queued', stage: null, attempt: 0,
    error_code: null, queued_at: minutesFrom(-10), claimed_at: null, completed_at: null, failed_at: null, queue_position: 1, priority: 'express',
    elapsed_hours: 0.17, sla_hours: 0.5, sla_due_at: minutesFrom(20), sla_state: 'open' };
  const sla = [{ priority_class: 'express', sla_hours: 0.5, completed: 2, met: 1, breached: 1, p50_hours: 0.4, p90_hours: 0.6 }, ...slaRows()];
  const h = await load({ queue: [express, ...queueRows().map(row => ({ ...row, queue_position: row.queue_position ? row.queue_position + 1 : null }))], sla });
  const first = queueBody(h).children[0];
  const cells = Object.fromEntries(first.children.slice(1).map(td => [td.dataset.label, td]));
  assert.equal(cells.Priority.children[0].textContent, 'Super fast');
  assert.equal(cells.Priority.children[0].className, 'pill');
  assert.equal(cells.Target.text(), 'On time (30 min)');
  const classes = h.ids['studio-sla-body'].all().filter(el => el.tagName === 'H4').map(el => el.textContent);
  assert.deepEqual(classes, ['Super fast renders · 30-minute target', 'Founding accounts · 12-hour target', 'Everyone else · 24-hour target']);
  assert.match(markup.replace(/\s+/g, ' '), /Super fast renders first, then founding accounts, then the longest waiting\. .*Processing is automatic and usually takes 1–2 hours\. Target from upload to ready: 30 minutes for a Super fast render, 12 hours for founding accounts, 24 hours for everyone else\./);
});

test('offer v9: the first-walkthrough redo is recorded as a correction, confirmed as the account’s one free redo, and a refusal keeps what was typed', async () => {
  const h = await load({ hosted: [hostedRow(LIVE_WALKTHROUGH, 'Harbour loft', 'active', 200)],
    rpc: { studio_record_tour_correction: async args => recorded(args) } });
  fillCorrection(h, { reason: 'first_walkthrough_redo' });
  await correctionForm(h).fire('submit');
  assert.match(h.confirms[0], /Reason: first-walkthrough redo \(our promise\)\. Reference: TCK-1042\. .* This uses the account’s one free first-walkthrough redo\.$/);
  assert.deepEqual(correctionCalls(h).map(([, args]) => ({ ...args })),
    [{ p_tour_id: NEW_PACKAGE, p_corrects_tour_id: LIVE_WALKTHROUGH, p_reason: 'first_walkthrough_redo', p_reference: 'TCK-1042' }]);
  assert.equal(resultOf(correctionForm(h)), 'Recorded: package 9f8e7d6c is version 2 of walkthrough 1a2b3c4d, the account’s free first-walkthrough redo. Approving it uses no walkthrough from the account’s allowance.');
  // The server decides whether this is the first accepted walkthrough, and whether the redo is still unused.
  for (const message of ['the first-walkthrough redo applies only to the account’s first accepted walkthrough', 'the first-walkthrough redo is already used for this account']) {
    const refused = await load({ rpc: { studio_record_tour_correction: async () => ({ error: { code: 'P0001', message } }) } });
    fillCorrection(refused, { reason: 'first_walkthrough_redo' });
    await correctionForm(refused).fire('submit');
    assert.equal(resultOf(correctionForm(refused)), 'Not recorded: ' + message);
    assert.equal(correctionInput(refused, 'tour_id').value, NEW_PACKAGE, 'what was typed stays');
  }
  // Offer record: the guarantee's scope is what the desk says.
  assert.match(offer.guarantee.scope, /first accepted walkthrough; the redo is a correction revision \(no unit, same link\); a recapture visit is not included/);
});

test('offer v9: the desk states the v9 invoice terms and the early-annual bonus in walkthroughs and express renders, and no v8 amount', () => {
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(script, /const PLAN_MONTH_CENTS = 9900;/);
  assert.match(script, /const PLAN_YEAR_CENTS = 99000;/);
  assert.match(script, /const MONTHLY_INCLUDED = 2;\s+const ROLLOVER_MAX = 4;\s+const YEARLY_POOL = 24;\s+const EARLY_ANNUAL_BONUS = 4;\s+const EARLY_ANNUAL_EXPRESS = 4;/);
  assert.match(script, /const EXPRESS_MINUTES = 30;/);
  assert.doesNotMatch(script, /EXPRESS_DAILY_CAP/, 'Super fast has no daily cap');
  assert.doesNotMatch(code, /(?<!\d)(?:7900|79000|9499|94999)(?!\d)/, 'no v8 cents in the desk');
});

test('offer v9: the Super fast band names each job’s account once the accounts arrive', async () => {
  let finish;
  const h = await load({ express: expressOrders(), rpc: { studio_list_accounts: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(expressBody(h).children[0].children[0].children[1].textContent, 'Account ws-wren');
  finish({ data: accounts().map(row => ({ ...row })) });
  await h.settle(); await h.settle();
  assert.equal(expressBody(h).children[0].children[0].children[1].textContent, 'Wren & Fielding');
});
