'use strict';
/*
 * Veylet studio desk: the accounts we look after, their free months, and the
 * walkthroughs waiting on us. Everything here is a read except a few deliberate
 * writes, each recording a decision the account has already agreed to: Set
 * plan, a settled walkthrough-pack invoice, a referral
 * grant, a founding referral grant, a paid hosting extension and a correction
 * recorded against the walkthrough it corrects. Marking a money exception resolved
 * records the reference of what a person already did; it moves no money. This
 * desk takes no payment, and an
 * unanswered check is reported as unavailable — never as "not a member" and
 * never as approved.
 *
 * supabase-js loads from /vendor before this file, so there is no module import
 * that can fail silently.
 */
(async () => {
  const cfg = window.VEYLET_SUPABASE;
  const statusEl = document.getElementById('studio-status');
  const desk = document.getElementById('studio-desk');
  const gate = document.getElementById('studio-gate');
  const gateBody = document.getElementById('studio-gate-body');
  const gateLink = document.getElementById('studio-gate-link');
  const gateRetry = document.getElementById('studio-gate-retry');
  const whoEl = document.getElementById('studio-who');
  const summaryEl = document.getElementById('studio-summary');
  const tableEl = document.getElementById('studio-table');
  const rowsEl = document.getElementById('studio-rows');
  const statusFilter = document.getElementById('studio-filter-status');
  const nameFilter = document.getElementById('studio-filter-name');
  const sortButtons = {
    activity: document.getElementById('studio-sort-activity'),
    trial: document.getElementById('studio-sort-trial'),
  };
  const sortHeaders = {
    activity: document.getElementById('studio-th-activity'),
    trial: document.getElementById('studio-th-trial'),
  };
  const deletionsEl = document.getElementById('studio-deletions');
  const refreshButton = document.getElementById('studio-refresh');
  const tableWrap = document.getElementById('studio-table-wrap');
  const scrollHint = document.getElementById('studio-scroll-hint');
  const gateAsk = document.getElementById('studio-gate-ask');

  const COLUMNS = 12;
  const DASH = '—';
  const PLAN_STATUSES = ['pending', 'trial', 'active', 'ended'];
  // One vocabulary. These are the same short state words the app and the account
  // desk put in their State row; the Status cell keeps the full title and date.
  const STATUS_CHOICES = { pending: 'Not started', trial: 'Free months', active: 'Active', ended: 'Ended' };
  // Where the money is arranged decides which price is true for this account.
  // An App Store subscription belongs to Apple, so this desk may not move it.
  const PLAN_SOURCES = ['studio', 'apple', 'web'];
  const SOURCE_CHOICES = { studio: 'Studio', web: 'Website', apple: 'App Store' };
  // Plan code to the name customers see. Offer 2026-09-25.2 sells one plan, the
  // Veylet plan (code solo), monthly or annual; the retired codes keep their
  // names so an existing row still reads as the plan it was agreed on (plan code
  // 'studio' is Team). The account desk states the same names from the same table.
  const PLAN_NAMES = { solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  const PLAN_ON_SALE = 'solo';
  const RETIRED_PLANS = ['studio', 'founding', 'office', 'one'];
  // App Store product to plan and cadence, as offer.json lists the product IDs.
  // The App Store sells the Veylet plan monthly and annual; the two Team IDs stay
  // mapped so an existing verified row still reads correctly.
  const APPLE_PRODUCTS = { 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] };
  // Offer 2026-09-27.1 closes new invoice subscriptions. The studio desk records
  // only the two one-time walkthrough packs; existing subscription rows retain
  // the provider, price, allowance and dates already stored for their agreement.
  const PACKS = { pack3: { walkthroughs: 3, cents: 16900 }, pack10: { walkthroughs: 10, cents: 49900 } };
  const PACK_VALID_MONTHS = 12;
  // Annual rows use a yearly pool of 36 (offer 2026-09-29.2). Existing rows continue to display the
  // exact cadence, price and allowance already recorded for them.
  const YEARLY_POOL = 36;
  const INVOICE_ITEMS = ['pack3', 'pack10'];
  // A founding workspace gets one free 3-pack for each referred office that
  // becomes a paying account, at most four, granted here with an audit row.
  const FOUNDING_GRANT_PACK = PACKS.pack3;
  const FOUNDING_GRANTS_MAX = 4;
  // Any referral: when a referred office becomes a paying account, it and the
  // office that referred it each get 1 bonus walkthrough, once per referred office.
  // The server grants them when its plan first turns active; the desk is the fallback.
  const REFERRAL_WALKTHROUGHS = 1;
  const FREE_MONTHS_DEFAULT = 1;
  const FREE_WALKTHROUGHS_DEFAULT = 3;
  // Retired whole-home rule (offer.json retiredTerms): 5 or more bedrooms, a
  // second dwelling or more than 350 m² of floor area counted as 2. Offer
  // 2026-09-27.1 supersedes both this and the later rooms rule for new captures;
  // this remains only to correct historical declarations for older listings.
  const HOME_BEDROOMS_FOR_TWO = 5;
  const HOME_AREA_OVER_M2 = 350;
  const TRIAL_INCLUDED_MAX = 24;
  // An opaque agreement, invoice or receipt reference: never a name or an email.
  const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
  // The same rule as a pattern attribute. Browsers compile patterns with the v
  // flag, where an unescaped / or - in a class is a syntax error that switches
  // the check off, so both are escaped; the title names the format natively.
  const REFERENCE_PATTERN = '[A-Za-z0-9][A-Za-z0-9._:\\/\\-]{2,159}';
  const REFERENCE_FORMAT = '3–160 letters, numbers or . _ : / -';
  function referenceInput(input) {
    input.type = 'text'; input.maxLength = 160; input.autocomplete = 'off';
    input.pattern = REFERENCE_PATTERN; input.title = REFERENCE_FORMAT;
    return input;
  }
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let client = null;
  let accounts = [];
  let loading = true;
  let listVersion = 0;
  let sortKey = 'activity';
  let sortDirection = 'desc';
  const openForms = new Set();
  // A write whose answer never arrived, per account and form. Until a refresh,
  // only the identical request may be sent again, so a lost reply can never
  // become a second invoice or a second grant.
  const uncertainIntents = new Map();

  function setStatus(value) { if (statusEl) statusEl.textContent = value; }
  function setSummary(value) { if (summaryEl) summaryEl.textContent = value; }
  /** Never leave the desk waiting on one unanswered request. */
  async function settled(promise, ms) {
    let timer = null;
    const expired = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms || 20000); });
    const result = await Promise.race([
      promise.then(value => ({ value })).catch(error => ({ error })),
      expired,
    ]);
    if (timer) clearTimeout(timer);
    return result;
  }
  function failed(result) { return !result || result.timedOut || result.error || Boolean(result.value && result.value.error); }
  function firstRow(data) { return Array.isArray(data) ? data[0] : data; }
  // The database's own refusal: an error answered with a code and a message.
  // A lost request or a client failure has no code and is never called a refusal.
  function serverRefusal(result) {
    const said = result && !result.timedOut && result.value && result.value.error;
    return said && typeof said.code === 'string' && said.code.trim() && typeof said.message === 'string' && said.message.trim()
      ? said.message.trim() : '';
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  function countText(value) {
    if (value === null || value === undefined || value === '') return DASH;
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : DASH;
  }
  // Offer counts are digits, as on the account desk: "1 free month and 3 walkthroughs".
  function planMonths(value) {
    const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return value !== '' && Number.isInteger(count) && count >= 1 && count <= 24 ? String(count) : '';
  }
  /** Integer cents, written the way the invoice would. Legacy invoices retain their agreed price. */
  function planMoney(cents) {
    const amount = Number(cents);
    if (cents === null || cents === undefined || cents === '' || !Number.isInteger(amount) || amount < 0) return '';
    const dollars = amount / 100;
    return 'A$' + dollars.toLocaleString('en-AU', {
      minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  /* An App Store account pays Apple's price, so that is the only price it may
   * be shown. Anything else is the website price. */
  function planSource(row) {
    const source = row && typeof row === 'object' ? row.source : null;
    return PLAN_SOURCES.includes(source) ? source : null;
  }
  // The monthly list price is not an annual renewal total. Older Apple rows
  // may supply only a product ID; an unknown invoice cadence stays unknown.
  function planInterval(row) {
    const value = row && row.billing_interval;
    const explicit = ['monthly', 'annual', 'once'].includes(value) ? value : null;
    if (planSource(row) !== 'apple') return explicit;
    const product = Object.prototype.hasOwnProperty.call(APPLE_PRODUCTS, row.apple_product_id) ? APPLE_PRODUCTS[row.apple_product_id][1] : null;
    if (explicit && product && explicit !== product) return null;
    return product || explicit;
  }
  // The plan an account is on. An App Store product names its own plan; a row
  // whose code disagrees with its product is not given either name.
  function planCode(row) {
    const code = row && Object.prototype.hasOwnProperty.call(PLAN_NAMES, row.plan_code) ? row.plan_code : null;
    if (planSource(row) !== 'apple' || !Object.prototype.hasOwnProperty.call(APPLE_PRODUCTS, row.apple_product_id)) return code;
    const product = APPLE_PRODUCTS[row.apple_product_id][0];
    return code && code !== product ? null : product;
  }
  function planPrice(row) {
    if (!row || !planSource(row) || !planInterval(row)) return '';
    if (row.renewal_price_aud_cents !== null && row.renewal_price_aud_cents !== undefined) {
      return planMoney(row.renewal_price_aud_cents);
    }
    if (planInterval(row) !== 'monthly') return '';
    return planMoney(planSource(row) === 'apple' ? row.app_price_aud_cents : row.price_aud_cents);
  }
  function planBilling(row) {
    const price = planPrice(row);
    return price ? price + (planInterval(row) === 'annual' ? ' a year' : planInterval(row) === 'once' ? ' once' : ' a month') : '';
  }
  function planDate(value) {
    if (!value) return '';
    const when = new Date(value);
    return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(value) {
    if (!value) return '';
    const when = new Date(value);
    return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function exactMoment(value) {
    if (!value) return '';
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return '';
    return shortDate(value) + ', ' + when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }
  function relativeMoment(value) {
    if (!value) return DASH;
    const when = new Date(value).getTime();
    if (Number.isNaN(when)) return DASH;
    const minutes = Math.round((Date.now() - when) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hours / 24);
    if (days < 14) return days + (days === 1 ? ' day ago' : ' days ago');
    if (days < 60) return Math.round(days / 7) + ' weeks ago';
    return Math.round(days / 30) + ' months ago';
  }
  function moment(value) {
    if (!value) return null;
    const when = new Date(value).getTime();
    return Number.isNaN(when) ? null : when;
  }
  /** A calendar day the server sent as YYYY-MM-DD, printed as that same day. */
  function dayDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) return '';
    const when = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (when.getUTCMonth() !== Number(match[2]) - 1 || when.getUTCDate() !== Number(match[3])) return '';
    return when.getUTCDate() + ' ' + MONTH_NAMES[when.getUTCMonth()] + ' ' + when.getUTCFullYear();
  }

  /* One invoiced pack: what it is called, what it costs and what it adds. */
  function invoiceItem(value) {
    if (Object.prototype.hasOwnProperty.call(PACKS, value)) {
      const pack = PACKS[value];
      return { value, code: value, cents: pack.cents, walkthroughs: pack.walkthroughs,
        label: 'Walkthrough pack · ' + pack.walkthroughs + ' walkthroughs (' + planMoney(pack.cents) + ')' };
    }
    return null;
  }
  function invoiceTerms(item) {
    if (!item) return 'Choose the item invoiced.';
    return planMoney(item.cents) + ' for this invoice: adds ' + item.walkthroughs + ' walkthroughs, valid ' + PACK_VALID_MONTHS +
      ' months after purchase, used after free-months, monthly (including banked) or annual-pool included walkthroughs. A pack is separate from the subscription: no service dates and no renewal.';
  }
  // A pack counts as recorded only when the server credited exactly this pack.
  function packConfirmed(answer, item) {
    return Boolean(answer) && typeof answer === 'object' && answer.credited === item.walkthroughs &&
      answer.amount_cents === item.cents && Number.isInteger(answer.credits_available) &&
      answer.credits_available >= 0 && Boolean(dayDate(answer.expires_on));
  }
  function isFounding(row) {
    return Boolean(row) && typeof row === 'object' && (row.founding_member === true || row.plan_code === 'founding');
  }
  // Grants used so far, or null when the row cannot say.
  function foundingGrantsUsed(row) {
    const used = row && typeof row === 'object' ? row.founding_grants_used : null;
    return Number.isInteger(used) && used >= 0 && used <= FOUNDING_GRANTS_MAX ? used : null;
  }
  function plural(number, word) { return number + ' ' + word + (number === 1 ? '' : 's'); }
  // The row's own free-months terms, in digits: "1 free month with 3
  // walkthroughs" (a total, not a monthly figure). A running row may keep longer
  // terms it started with; a row that cannot say shows nothing.
  function freeMonthsTerms(row) {
    const months = row && row.trial_months;
    const included = row && row.trial_included_walkthroughs;
    if (!Number.isInteger(months) || months < 1 || months > 12 || !Number.isInteger(included) || included < 1) return '';
    return plural(months, 'free month') + ' with ' + plural(included, 'walkthrough');
  }
  // The annual Veylet plan counts a yearly pool, not a month, so its row shows no
  // monthly figure. studio_list_accounts carries no billing interval or pool
  // counts today; only a row repainted from an invoice answer carries its cadence.
  function annualPoolRow(row) {
    return planCode(row) === PLAN_ON_SALE && planInterval(row) === 'annual';
  }
  /*
   * The same words the app, the account desk and this desk use, from the same
   * fields. Keep these strings identical to the ones in the account desk.
   */
  function planVocabulary(row) {
    const unavailable = { status: 'unavailable', title: 'Plan status unavailable', body: 'Refresh to check your free months and allowance.' };
    const status = row && typeof row === 'object' && PLAN_STATUSES.includes(row.status) ? row.status : null;
    const accepted = countText(row && row.accepted_this_period) + ' of ' + countText(row && row.included_per_month);
    if (status === 'pending') {
      const months = planMonths(row.trial_months);
      const included = planMonths(row.trial_included_walkthroughs);
      return months && included ? { status, title: 'Plan not started',
        body: 'Review the available plan. Eligible subscribers can start with ' + months + ' free month' + (months === '1' ? '' : 's') + ' and ' + included + ' walkthroughs in total.' } : unavailable;
    }
    if (status === 'trial') {
      const until = planDate(row.trial_ends_at);
      const billing = planBilling(row);
      const used = countText(row.accepted_in_free_months);
      const allowance = countText(row.trial_included_walkthroughs);
      if (!until || used === DASH || allowance === DASH) return unavailable;
      // The heading is the state; the sentence is the reminder, with the price that
      // follows. No reminder email is running yet, so none is promised here.
      const free = 'Free until ' + until;
      const renewal = row.auto_renews === false
        ? 'It ends on ' + until + ' and will not renew.'
        : row.auto_renews !== true ? 'Check your renewal setting with your billing provider.'
          : billing ? free + ', then ' + billing + ' unless you cancel.'
            : 'Confirm the renewal amount and billing period with your billing provider before the free months end.';
      return { status, title: free,
        body: used + ' of ' + allowance + ' free walkthroughs used. ' + renewal };
    }
    if (status === 'active') {
      const billing = planBilling(row);
      const until = planDate(row.current_period_ends_at);
      if (!until) return unavailable;
      const renewal = row.auto_renews === false ? 'Ends ' + until + '; will not renew.'
        : row.auto_renews === true ? 'Next billing date: ' + until + '.'
          : 'Current period ends ' + until + '; check your renewal setting.';
      return { status, title: (PLAN_NAMES[planCode(row)] || 'Plan') + ' · ' + (billing || 'confirm billing details'),
        body: (planInterval(row) === 'once' ? 'One walkthrough included in this paid service period. ' : accepted + ' walkthroughs this month. ') + renewal + ' Hosting included.' +
          (planInterval(row) === 'annual' ? ' Billed annually.' : '') };
    }
    if (status === 'ended') {
      const afterPlan = row.current_period_ends_at !== null && row.current_period_ends_at !== undefined;
      const ended = planDate(afterPlan ? row.current_period_ends_at : row.trial_ends_at);
      return ended ? { status, title: (afterPlan ? 'Plan ended ' : 'Free months ended ') + ended,
        body: 'Your released walkthroughs stay online for 14 days after the plan ends, then go offline. Restarting the plan brings the same links back at once; a second free trial is not guaranteed.' } : unavailable;
    }
    return unavailable;
  }
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function cell(row, label, className) {
    const td = element('td', className);
    td.dataset.label = label;
    row.append(td);
    return td;
  }
  function spanRow(className) {
    const row = element('tr', className);
    const td = element('td');
    td.setAttribute('colspan', String(COLUMNS));
    row.append(td);
    return { row, td };
  }

  function showGate(message, options = {}) {
    if (desk) desk.hidden = true;
    if (gate) gate.hidden = false;
    if (gateBody) gateBody.textContent = message;
    if (gateLink) {
      gateLink.hidden = options.link !== true;
      gateLink.textContent = options.linkLabel || 'Go to your account page';
    }
    if (gateRetry) gateRetry.hidden = options.retry !== true;
    // A refusal that leaves no way to ask is a dead end. Someone who should be
    // on this desk needs the studio's address, not a second sign-in attempt.
    if (gateAsk) gateAsk.hidden = options.ask !== true;
  }

  /*
   * Twelve columns do not fit every window. Where the desk scrolls sideways it
   * becomes a focusable, named region, because a scroll only a mouse can move
   * hides the Note and Last activity columns from a keyboard (WCAG 2.1.1). The
   * measured visible width also bounds the Set plan form, whose warning would
   * otherwise be written off the right-hand edge of the scroll.
   */
  function syncScrollRegion() {
    if (!tableWrap) return;
    const view = tableWrap.clientWidth || 0;
    const scrolls = tableWrap.scrollWidth > view + 1;
    if (view) tableWrap.style.setProperty('--studio-view', view + 'px');
    if (scrolls) tableWrap.setAttribute('tabindex', '0');
    else tableWrap.removeAttribute('tabindex');
    if (scrollHint) scrollHint.hidden = !scrolls;
  }

  // Waiting is rows that are coming, not a spinner that says nothing.
  function skeletonRows() {
    if (!rowsEl) return;
    tableEl?.setAttribute('aria-busy', 'true');
    const rows = [];
    for (let index = 0; index < 3; index += 1) {
      const row = element('tr', 'studio-row studio-skeleton');
      row.setAttribute('aria-hidden', 'true');
      const head = element('th');
      head.setAttribute('scope', 'row');
      head.append(element('span', 'studio-bar'));
      row.append(head);
      for (let column = 1; column < COLUMNS; column += 1) {
        const td = element('td');
        td.append(element('span', 'studio-bar'));
        row.append(td);
      }
      rows.push(row);
    }
    rowsEl.replaceChildren(...rows);
    setSummary('Counting accounts, free months and walkthroughs…');
    syncScrollRegion();
  }

  function summaryText() {
    return accounts.length + ' accounts · ' +
      accounts.filter(row => row.status === 'trial').length + ' in free months · ' +
      accounts.filter(row => row.status === 'active').length + ' on the plan · ' +
      accounts.reduce((total, row) => total + count(row.tours_ready), 0) + ' walkthroughs ready for review · ' +
      accounts.reduce((total, row) => total + count(row.tours_processing), 0) + ' processing · ' +
      // A purchase Apple has not confirmed is not money; it is a claim.
      accounts.filter(row => row.source === 'apple' && row.apple_verified !== true).length + ' unverified App Store';
  }

  function paintSortControls() {
    for (const key of Object.keys(sortButtons)) {
      const button = sortButtons[key];
      if (button) {
        button.setAttribute('aria-pressed', sortKey === key ? 'true' : 'false');
        button.dataset.direction = sortKey === key ? sortDirection : 'desc';
      }
      const header = sortHeaders[key];
      if (header) {
        if (sortKey === key) header.setAttribute('aria-sort', sortDirection === 'desc' ? 'descending' : 'ascending');
        else header.removeAttribute('aria-sort');
      }
    }
  }
  function chooseSort(key) {
    if (sortKey === key) sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    else { sortKey = key; sortDirection = 'desc'; }
    paintSortControls();
    render();
  }

  /*
   * One account, one row, plus the row underneath that holds its Set plan form.
   * paint() rewrites the cells in place so a saved plan can be shown from what
   * the write returned without rebuilding, re-sorting or re-filtering the table.
   */
  function buildAccount(account) {
    const workspaceID = account.workspace_id;
    const row = element('tr', 'studio-row');
    const nameCell = element('th');
    nameCell.setAttribute('scope', 'row');
    const nameText = element('strong', 'studio-name');
    const ownerText = element('span', 'studio-sub');
    nameCell.append(nameText, ownerText);
    row.append(nameCell);
    const statusCell = cell(row, 'Status', 'studio-status-cell');
    const sourceCell = cell(row, 'Source');
    const sourceText = element('span');
    const sourceSub = element('span', 'studio-sub');
    sourceCell.append(sourceText, sourceSub);
    const trialCell = cell(row, 'Free months', 'studio-figure');
    const trialSpan = element('span');
    const trialTerms = element('span', 'studio-sub');
    trialCell.append(trialSpan, trialTerms);
    const freeCell = cell(row, 'Free walkthroughs', 'studio-figure');
    const freeUsed = element('span');
    const freeOwed = element('span', 'studio-sub');
    freeCell.append(freeUsed, freeOwed);
    const monthCell = cell(row, 'This month', 'studio-figure');
    const monthCount = element('span');
    const monthRule = element('span', 'studio-sub');
    monthCell.append(monthCount, monthRule);
    const totalCell = cell(row, 'Total', 'studio-figure');
    const renewsCell = cell(row, 'Renews', 'studio-figure');
    const renewCell = cell(row, 'Auto-renew');
    const workCell = cell(row, 'Walkthroughs', 'studio-figure');
    const activityCell = cell(row, 'Last activity');
    const activityRelative = element('time');
    const activityExact = element('span', 'studio-sub');
    activityCell.append(activityRelative, activityExact);
    const noteCell = cell(row, 'Note', 'studio-note-cell');

    const planRow = element('tr', 'studio-plan-row');
    const planCell = element('td');
    planCell.setAttribute('colspan', String(COLUMNS));
    planRow.append(planCell);
    const details = element('details', 'studio-set-plan');
    details.open = openForms.has(workspaceID);
    details.addEventListener('toggle', () => {
      if (details.open) openForms.add(workspaceID); else openForms.delete(workspaceID);
      syncScrollRegion();
    });
    // Both the disclosure and the legend name the account, so a plan can never
    // be written to the row above or below the one being read.
    const summary = element('summary');
    const form = element('form', 'veylet-form studio-plan-form');
    const fieldset = element('fieldset', 'studio-radio-group');
    const legend = element('legend');
    fieldset.append(legend);
    const radios = [];
    for (const value of PLAN_STATUSES) {
      const label = element('label', 'studio-radio');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'studio-status-' + workspaceID;
      input.value = value;
      label.append(input, element('span', undefined, STATUS_CHOICES[value]));
      fieldset.append(label);
      radios.push(input);
    }
    // Where the subscription lives, and which product it is. An App Store
    // subscription is Apple's record, so this desk reads it and cannot move it.
    const sourceLabel = element('label', 'studio-inline-field', 'Source');
    const sourceSelect = document.createElement('select');
    for (const value of PLAN_SOURCES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = SOURCE_CHOICES[value];
      sourceSelect.append(option);
    }
    sourceLabel.append(sourceSelect);
    const sourceNote = element('span', 'studio-field-note', 'An App Store subscription is changed in the App Store.');
    sourceNote.hidden = true;
    sourceLabel.append(sourceNote);
    // The stored plan is shown for identification only. New subscriptions are
    // chosen in the App Store, never in this generic studio status form.
    const planLabel = element('label', 'studio-inline-field', 'Plan');
    const planSelect = document.createElement('select');
    planLabel.append(planSelect);
    const monthsLabel = element('label', 'studio-inline-field', 'Free months (1–12)');
    const monthsInput = document.createElement('input');
    monthsInput.type = 'number';
    monthsInput.min = '1';
    monthsInput.max = '12';
    monthsInput.step = '1';
    monthsInput.inputMode = 'numeric';
    monthsLabel.append(monthsInput);
    const includedLabel = element('label', 'studio-inline-field', 'Free walkthroughs (1–' + TRIAL_INCLUDED_MAX + ')');
    const includedInput = document.createElement('input');
    includedInput.type = 'number';
    includedInput.min = '1';
    includedInput.max = String(TRIAL_INCLUDED_MAX);
    includedInput.step = '1';
    includedInput.inputMode = 'numeric';
    includedLabel.append(includedInput);
    const startLabel = element('label', 'studio-inline-field', 'Free months started (optional)');
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startLabel.append(startInput);
    const renewLabel = element('label', 'studio-radio studio-check');
    const renewInput = document.createElement('input');
    renewInput.type = 'checkbox';
    renewLabel.append(renewInput, element('span', undefined, 'Auto-renews'));
    const noteLabel = element('label', 'studio-inline-field', 'Note (optional)');
    const noteInput = document.createElement('textarea');
    noteInput.rows = 2;
    noteInput.maxLength = 400;
    noteLabel.append(noteInput);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'button';
    save.textContent = 'Save plan';
    const result = element('span', 'studio-result');
    result.setAttribute('role', 'status');
    const saveRow = element('p', 'studio-save-row');
    saveRow.append(save, result);
    const warning = element('p', 'studio-warning', 'This form may maintain or end existing studio free months; it cannot start or replace a subscription. New subscriptions start in the App Store. Existing App Store, card and invoice agreements keep their recorded provider and terms. The invoice form below records walkthrough packs only.');
    form.append(fieldset, sourceLabel, planLabel, monthsLabel, includedLabel, startLabel, renewLabel, noteLabel, warning, saveRow);
    // The row as last painted; the invoice and grant forms read their guards from it.
    let shown = account;

    /*
     * Record a settled walkthrough-pack invoice. New subscriptions use the App
     * Store, so this generic desk has no plan item or service-period control.
     * Existing plan rows remain visible on their stored provider terms. Each
     * pack write is confirmed by account and amount; after an answer that never
     * arrived, only the identical request may be sent again.
     */
    const invoice = element('form', 'veylet-form studio-plan-form studio-invoice-form');
    const invoiceHeading = element('h3', undefined, 'Record a settled walkthrough pack');
    const invoiceNotice = element('p', 'studio-warning');
    const itemLabel = element('label', 'studio-inline-field', 'Item invoiced');
    const itemSelect = document.createElement('select');
    itemSelect.name = 'item'; itemSelect.required = true;
    for (const value of INVOICE_ITEMS) {
      const option = document.createElement('option');
      option.value = value;
      itemSelect.append(option);
    }
    itemSelect.value = INVOICE_ITEMS[0];
    itemLabel.append(itemSelect);
    const invoiceTermsLine = element('p', 'studio-warning studio-invoice-terms');
    // The item and what it records share one full-width row, the terms under the choice.
    const itemRow = element('div', 'studio-form-row');
    itemRow.append(itemLabel, invoiceTermsLine);
    invoice.append(invoiceHeading, invoiceNotice, itemRow);
    const invoiceFields = {};
    function invoiceField(key, title) {
      const label = element('label', 'studio-inline-field', title);
      const input = document.createElement('input');
      input.name = key; input.required = true;
      referenceInput(input);
      label.append(input); invoiceFields[key] = input; invoice.append(label); return input;
    }
    const REFERENCE_KEYS = ['agreement_id', 'settlement_id', 'receipt_key'];
    invoiceField('agreement_id', 'Written agreement reference');
    invoiceField('settlement_id', 'Settled invoice line reference');
    invoiceField('receipt_key', 'Unique receipt reference (keep the same when retrying)');
    invoice.append(element('p', 'studio-field-note', 'Use opaque references only, not names, emails, addresses or payment details. Verify the agreement and settled invoice outside this desk. No payment is collected here.'));
    const invoiceSave = element('button', 'button', 'Record settled invoice'); invoiceSave.type = 'submit';
    const invoiceResult = element('span', 'studio-result'); invoiceResult.setAttribute('role', 'status');
    const invoiceSaveRow = element('p', 'studio-save-row'); invoiceSaveRow.append(invoiceSave, invoiceResult); invoice.append(invoiceSaveRow);
    const invoiceKey = workspaceID + ':invoice';
    let invoiceBusy = false;
    // Why this account cannot have this item recorded, or '' when it can.
    function invoiceBlocked(current, item) {
      if (!item) return 'Choose the item invoiced.';
      // A pack is separate from the subscription, so any activated account may
      // have one recorded, whoever bills its plan.
      if (current.status === 'trial' || current.status === 'active') return '';
      if (current.status === 'pending') return 'This account has not started its free months. A walkthrough pack can be recorded once the account is activated.';
      if (current.status === 'ended') return 'This account has no running plan or free months. A walkthrough pack can be recorded only for an activated account.';
      return "This account's plan status could not be read. Refresh the accounts before recording a pack.";
    }
    function paintInvoice() {
      for (const option of itemSelect.children) option.textContent = invoiceItem(option.value).label;
      const item = invoiceItem(itemSelect.value);
      invoiceTermsLine.textContent = invoiceTerms(item);
      const blocked = invoiceBlocked(shown, item);
      invoiceNotice.textContent = blocked || 'Record only a walkthrough pack the customer agreed to in writing and already paid. New subscriptions start in the App Store; existing subscription terms stay with their recorded provider.';
      const closed = Boolean(blocked || !item) || invoiceBusy;
      for (const input of [...Object.values(invoiceFields), invoiceSave]) input.disabled = closed;
      itemSelect.disabled = invoiceBusy;
    }
    itemSelect.addEventListener('change', paintInvoice);
    invoice.addEventListener('submit', async event => {
      event.preventDefault(); if (invoiceSave.disabled) return;
      const current = accounts.find(entry => entry.workspace_id === workspaceID) || shown;
      const item = invoiceItem(itemSelect.value);
      const blocked = invoiceBlocked(current, item);
      if (blocked) { invoiceResult.textContent = blocked; return; }
      const rpc = 'studio_record_pack_invoice';
      const args = { p_workspace_id: workspaceID, p_pack_code: item.code };
      for (const key of REFERENCE_KEYS) {
        const value = String(invoiceFields[key].value || '').trim();
        if (!REFERENCE.test(value)) {
          invoiceResult.textContent = 'Enter all three opaque evidence references (' + REFERENCE_FORMAT + ').'; return;
        }
        args['p_' + key] = value;
      }
      const uncertain = uncertainIntents.get(invoiceKey);
      if (uncertain && (uncertain.rpc !== rpc || JSON.stringify(args) !== JSON.stringify(uncertain.args))) {
        invoiceResult.textContent = 'The previous result is unconfirmed. Restore the same item, terms and receipt reference to retry, or refresh and reconcile the recorded invoice before changing them.'; return;
      }
      const named = current.workspace_name || 'this account';
      const question = 'Record ' + planMoney(item.cents) + ' already settled for ' + named + ': a walkthrough pack of ' + item.walkthroughs +
        ' walkthroughs, valid ' + PACK_VALID_MONTHS + ' months? Confirm the written agreement and invoice payment match. No card is charged.';
      if (typeof confirm !== 'function' || !confirm(question)) { invoiceResult.textContent = 'Left unchanged.'; return; }
      const version = listVersion;
      invoiceBusy = true; paintInvoice();
      invoiceResult.textContent = 'Recording the settled pack…';
      uncertainIntents.set(invoiceKey, { rpc, args });
      const reply = await settled(client.rpc(rpc, args));
      if (version !== listVersion) return;
      invoiceBusy = false;
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      // A database refusal carries its code: nothing was written, so the reason is
      // shown and the form is free again. Anything else stays unconfirmed.
      const refused = serverRefusal(reply);
      if (!answer && refused) {
        uncertainIntents.delete(invoiceKey);
        paintInvoice();
        invoiceResult.textContent = 'Not recorded: ' + refused; return;
      }
      if (!packConfirmed(answer, item)) {
        paintInvoice();
        invoiceResult.textContent = 'The pack was not confirmed. Keep this item and these references unchanged and retry, or refresh before changing them. No second invoice should be collected.'; return;
      }
      uncertainIntents.delete(invoiceKey);
      // The same references must never be offered for a second pack.
      for (const key of REFERENCE_KEYS) invoiceFields[key].value = '';
      paintInvoice();
      invoiceResult.textContent = 'Recorded: ' + item.walkthroughs + ' walkthroughs added (' + planMoney(item.cents) + '). ' +
        answer.credits_available + ' available; use by ' + dayDate(answer.expires_on) + '.';
    });

    /*
     * Founding referral grant: a free 3-pack for each referred office that
     * becomes a paying account, at most four per founding workspace. It appears
     * only on a founding row, and a count the desk cannot read closes the form
     * rather than guessing.
     */
    const grant = element('form', 'veylet-form studio-plan-form studio-grant-form');
    const grantHeading = element('h3', undefined, 'Founding referral grant');
    const grantCount = element('p', 'studio-grant-count');
    const grantRefLabel = element('label', 'studio-inline-field', "Referred office's first paid invoice reference");
    const grantRef = document.createElement('input');
    referenceInput(grantRef); grantRef.name = 'grant_reference'; grantRef.required = true;
    grantRefLabel.append(grantRef);
    const grantNoteLabel = element('label', 'studio-inline-field', 'Note (optional)');
    const grantNote = document.createElement('textarea');
    grantNote.name = 'grant_note'; grantNote.rows = 2; grantNote.maxLength = 400;
    grantNoteLabel.append(grantNote);
    const grantTerms = element('p', 'studio-warning', 'One free ' + FOUNDING_GRANT_PACK.walkthroughs + '-pack for each referred office that becomes a paying account, up to ' +
      FOUNDING_GRANTS_MAX + '. It adds ' + FOUNDING_GRANT_PACK.walkthroughs + ' walkthroughs, valid ' + PACK_VALID_MONTHS +
      ' months, and the server keeps an audit row. Use an opaque reference, not a name, email or payment detail. No payment is taken.');
    const grantSave = element('button', 'button', 'Grant free ' + FOUNDING_GRANT_PACK.walkthroughs + '-pack'); grantSave.type = 'submit';
    const grantResult = element('span', 'studio-result'); grantResult.setAttribute('role', 'status');
    const grantSaveRow = element('p', 'studio-save-row'); grantSaveRow.append(grantSave, grantResult);
    const grantTermsRow = element('div', 'studio-form-row');
    grantTermsRow.append(grantTerms);
    grant.append(grantHeading, grantCount, grantTermsRow, grantRefLabel, grantNoteLabel, grantSaveRow);
    const grantKey = workspaceID + ':grant';
    let grantBusy = false;
    function paintGrant() {
      const founding = isFounding(shown);
      grant.hidden = !founding;
      const used = foundingGrantsUsed(shown);
      const left = used === null ? null : FOUNDING_GRANTS_MAX - used;
      grantCount.textContent = !founding ? '' : used === null ? 'The grant count could not be read; refresh the accounts.'
        : left === 0 ? 'All four founding grants are used.' : left + ' of ' + FOUNDING_GRANTS_MAX + ' grants left';
      for (const input of [grantRef, grantNote, grantSave]) input.disabled = !founding || used === null || left === 0 || grantBusy;
    }
    grant.addEventListener('submit', async event => {
      event.preventDefault(); if (grantSave.disabled) return;
      const current = accounts.find(entry => entry.workspace_id === workspaceID) || shown;
      const used = foundingGrantsUsed(current);
      if (!isFounding(current) || used === null) { grantResult.textContent = 'The grant count could not be read; refresh the accounts.'; return; }
      if (used >= FOUNDING_GRANTS_MAX) { grantResult.textContent = 'All four founding grants are used.'; return; }
      const reference = String(grantRef.value || '').trim();
      if (!REFERENCE.test(reference)) {
        grantResult.textContent = "Enter the referred office's first paid invoice reference (" + REFERENCE_FORMAT + ').'; return;
      }
      const args = { p_workspace_id: workspaceID, p_reference: reference };
      const note = String(grantNote.value || '').trim();
      if (note) args.p_note = note;
      const uncertain = uncertainIntents.get(grantKey);
      if (uncertain && JSON.stringify(args) !== JSON.stringify(uncertain.args)) {
        grantResult.textContent = 'The previous grant is unconfirmed. Restore the same reference and note to retry, or refresh and check the count before changing them.'; return;
      }
      const question = 'Record a free ' + FOUNDING_GRANT_PACK.walkthroughs + '-pack, grant ' + (used + 1) + ' of ' + FOUNDING_GRANTS_MAX + ', for ' +
        (current.workspace_name || 'this account') + "? Referred office's first paid invoice: " + reference + '. It adds ' +
        FOUNDING_GRANT_PACK.walkthroughs + ' walkthroughs, valid ' + PACK_VALID_MONTHS + ' months. No payment is taken.';
      if (typeof confirm !== 'function' || !confirm(question)) { grantResult.textContent = 'Left unchanged.'; return; }
      const version = listVersion;
      grantBusy = true; paintGrant();
      grantResult.textContent = 'Recording the grant…';
      uncertainIntents.set(grantKey, { rpc: 'studio_grant_founding_pack', args });
      const reply = await settled(client.rpc('studio_grant_founding_pack', args));
      if (version !== listVersion) return;
      grantBusy = false;
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (!answer || typeof answer !== 'object' || answer.credited !== FOUNDING_GRANT_PACK.walkthroughs || answer.grants_used !== used + 1) {
        paintGrant();
        grantResult.textContent = 'The grant was not confirmed. Keep this reference and note unchanged and retry, or refresh and check the count before changing them.'; return;
      }
      uncertainIntents.delete(grantKey);
      const merged = { ...current, founding_grants_used: answer.grants_used };
      const index = accounts.findIndex(entry => entry.workspace_id === workspaceID);
      if (index >= 0) accounts[index] = merged;
      grantRef.value = ''; grantNote.value = '';
      paint(merged);
      grantResult.textContent = 'Granted: ' + FOUNDING_GRANT_PACK.walkthroughs + ' walkthroughs. ' +
        (FOUNDING_GRANTS_MAX - answer.grants_used) + ' of ' + FOUNDING_GRANTS_MAX + ' grants left.';
    });
    /*
     * Referral walkthroughs, under the referred office's own row. The server
     * grants them by itself when a referred office's plan first turns active: 1
     * bonus walkthrough to it and 1 to the office that referred it, once per
     * referred office. This is the fallback when that did not happen, and the way
     * to record a referring office named in writing (with an opaque reference).
     * studio_grant_referral_bonus answers why nothing was granted rather than
     * raising for a rule; it raises for a bad reference, a missing or conflicting
     * referral, a self or mutual referral and test workspaces. What was typed stays.
     */
    const referral = element('form', 'veylet-form studio-plan-form studio-referral-form');
    const referralHeading = element('h3', undefined, 'Referral walkthroughs');
    const referralTerms = element('p', 'studio-warning', 'When a referred office first pays, the server grants ' + REFERRAL_WALKTHROUGHS +
      ' bonus walkthrough to it and ' + REFERRAL_WALKTHROUGHS + ' to the office that referred it, once per referred office. Use this only when that grant did not happen, ' +
      'or to record the referring office named in writing. Leave "Referred through its own link" when the office recorded its referrer from the link. ' +
      'Use an opaque reference, not a name, email or payment detail. No payment is taken.');
    const referralTermsRow = element('div', 'studio-form-row');
    referralTermsRow.append(referralTerms);
    const referrerLabel = element('label', 'studio-inline-field', 'Referred by');
    const referrerSelect = document.createElement('select');
    referrerSelect.name = 'referrer_workspace';
    referrerLabel.append(referrerSelect);
    const referralRefLabel = element('label', 'studio-inline-field', 'Reference (when you name the office)');
    const referralRef = document.createElement('input');
    referenceInput(referralRef); referralRef.name = 'referral_reference';
    referralRefLabel.append(referralRef);
    const REFERRAL_ACTION = 'Grant ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough to each office';
    const referralSave = element('button', 'button', REFERRAL_ACTION); referralSave.type = 'submit';
    const referralResult = element('span', 'studio-result'); referralResult.setAttribute('role', 'status');
    const referralSaveRow = element('p', 'studio-save-row'); referralSaveRow.append(referralSave, referralResult);
    referral.append(referralHeading, referralTermsRow, referrerLabel, referralRefLabel, referralSaveRow);
    let referralBusy = false;
    const OWN_LINK = '';
    // "Its own link" first, then every other listed account by name; this office
    // can never be chosen as its own referrer.
    function paintReferrers() {
      const chosen = referrerSelect.value;
      const others = accounts.filter(entry => entry && entry.workspace_id && entry.workspace_id !== workspaceID)
        .sort((left, right) => String(left.workspace_name || '').localeCompare(String(right.workspace_name || '')));
      const own = element('option', undefined, 'Referred through its own link');
      own.value = OWN_LINK;
      referrerSelect.replaceChildren(own, ...others.map(entry => {
        const option = element('option', undefined, entry.workspace_name || 'Account ' + String(entry.workspace_id).slice(0, 8));
        option.value = entry.workspace_id;
        return option;
      }));
      referrerSelect.value = others.some(entry => entry.workspace_id === chosen) ? chosen : OWN_LINK;
    }
    function paintReferral() {
      if (!referralBusy) paintReferrers();
      // A reference is recorded only with a named referring office.
      const named = referrerSelect.value !== OWN_LINK;
      referralRef.required = named;
      referrerSelect.disabled = referralBusy;
      referralRef.disabled = referralBusy || !named;
      referralSave.disabled = referralBusy;
    }
    referrerSelect.addEventListener('change', paintReferral);
    function accountName(id, fallback) {
      const entry = accounts.find(item => item.workspace_id === id);
      return entry && entry.workspace_name ? entry.workspace_name : fallback;
    }
    referral.addEventListener('submit', async event => {
      event.preventDefault(); if (referralSave.disabled) return;
      const current = accounts.find(entry => entry.workspace_id === workspaceID) || shown;
      const chosen = referrerSelect.value;
      const referrer = chosen === OWN_LINK ? null
        : accounts.find(entry => entry.workspace_id === chosen && entry.workspace_id !== workspaceID);
      if (chosen !== OWN_LINK && !referrer) { referralResult.textContent = 'Choose the office that referred this one, or its own link.'; referrerSelect.focus?.(); return; }
      const args = { p_workspace_id: workspaceID };
      const referred = current.workspace_name || 'this office';
      let question;
      if (referrer) {
        const reference = String(referralRef.value || '').trim();
        if (!REFERENCE.test(reference)) {
          referralResult.textContent = 'Enter the reference for the named referring office (' + REFERENCE_FORMAT + ').'; referralRef.focus?.(); return;
        }
        args.p_referrer_workspace_id = referrer.workspace_id;
        args.p_reference = reference;
        question = REFERRAL_ACTION + '? Records ' + (referrer.workspace_name || 'the named office') + ' as the office that referred ' + referred +
          ' (reference ' + reference + '), then grants ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough to each once ' + referred +
          ' has paid. Once per referred office; the server keeps an audit row. No payment is taken.';
      } else {
        question = REFERRAL_ACTION + '? ' + referred + ' and the office it recorded through its own link each get ' + REFERRAL_WALKTHROUGHS +
          ' bonus walkthrough once ' + referred + ' has paid. Once per referred office; the server keeps an audit row. No payment is taken.';
      }
      if (typeof confirm !== 'function' || !confirm(question)) { referralResult.textContent = 'Left unchanged.'; return; }
      const version = listVersion;
      referralBusy = true; paintReferral();
      referralResult.textContent = 'Granting the referral walkthroughs…';
      const reply = await settled(client.rpc('studio_grant_referral_bonus', args));
      if (version !== listVersion) return;
      referralBusy = false;
      paintReferral();
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (!answer || typeof answer !== 'object' || typeof answer.granted !== 'boolean') {
        const refused = serverRefusal(reply);
        referralResult.textContent = refused ? 'Not granted: ' + refused
          : 'The referral grant was not confirmed. Sending it again is safe: the server grants once per referred office.';
        return;
      }
      const referrerName = accountName(answer.referrer_workspace_id, referrer ? referrer.workspace_name || 'the referring office' : 'the referring office');
      if (answer.granted) {
        if (answer.walkthroughs !== REFERRAL_WALKTHROUGHS || typeof answer.referrer_granted !== 'boolean') {
          referralResult.textContent = 'The referral grant was not confirmed. Sending it again is safe: the server grants once per referred office.'; return;
        }
        const until = planDate(answer.expires_at);
        referralRef.value = ''; referrerSelect.value = OWN_LINK; paintReferral();
        referralResult.textContent = answer.referrer_granted
          ? 'Granted: ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough each to ' + referred + ' and ' + referrerName + (until ? ', usable until ' + until : '') + '.'
          : 'Granted: ' + REFERRAL_WALKTHROUGHS + ' bonus walkthrough to ' + referred + (until ? ', usable until ' + until : '') +
            '. The referring office received none: it no longer exists or is being deleted.';
        return;
      }
      referralResult.textContent = answer.reason === 'already_granted'
        ? 'Already granted: ' + referred + "'s referral walkthroughs were granted before. Nothing new was added."
        : answer.reason === 'not_paying'
          ? 'Not granted yet: ' + referred + ' has not paid. ' + (answer.referrer_workspace_id
            ? 'Its referral by ' + referrerName + ' is recorded, and the walkthroughs are granted automatically when its plan first turns active.'
            : 'The walkthroughs are granted automatically when its plan first turns active.')
          : answer.reason === 'no_referral'
            ? 'No referral is recorded for ' + referred + '. Choose the referring office and give a reference.'
            : 'Not granted' + (typeof answer.reason === 'string' && answer.reason ? ': ' + answer.reason.replace(/_/g, ' ') + '.' : '.');
    });

    details.append(summary, form, invoice, grant, referral);
    planCell.append(details);

    function paint(next) {
      shown = next;
      const view = planVocabulary(next);
      row.dataset.status = next.status || '';
      nameText.textContent = next.workspace_name || 'Unnamed workspace';
      ownerText.textContent = (next.owner_display_name || DASH) + ' · ' + countText(next.member_count) +
        (count(next.member_count) === 1 ? ' member' : ' members');
      statusCell.textContent = view.title;
      const source = planSource(next);
      sourceText.textContent = source ? SOURCE_CHOICES[source] : DASH;
      // Apple's word, not ours: a purchase the server has not verified is a
      // claim, and the desk says which one it is looking at.
      sourceSub.textContent = source === 'apple' ? (next.apple_verified === true ? 'verified' : 'unverified') : '';
      const from = shortDate(next.trial_started_at);
      const until = shortDate(next.trial_ends_at);
      trialSpan.textContent = from || until ? (from || DASH) + ' → ' + (until || DASH) : 'not started';
      trialTerms.textContent = freeMonthsTerms(next);
      freeUsed.textContent = countText(next.accepted_in_free_months) + ' / ' + countText(next.trial_included_walkthroughs);
      freeOwed.textContent = count(next.extras_in_free_months) > 0
        ? count(next.extras_in_free_months) + ' beyond included; check agreed billing' : '';
      // A yearly pool has no monthly figure, and the list carries no pool counts.
      const pool = annualPoolRow(next);
      monthCount.textContent = pool ? DASH : countText(next.accepted_this_period) + ' / ' + countText(next.included_per_month);
      monthRule.textContent = pool ? YEARLY_POOL + '-walkthrough yearly pool' : '';
      totalCell.textContent = countText(next.accepted_total);
      renewsCell.textContent = shortDate(next.current_period_ends_at) || shortDate(next.trial_ends_at) || DASH;
      renewCell.textContent = next.auto_renews === true ? 'yes' : next.auto_renews === false ? 'no' : DASH;
      workCell.textContent = countText(next.tours_ready) + ' / ' + countText(next.tours_processing);
      activityRelative.textContent = relativeMoment(next.last_activity_at);
      if (next.last_activity_at) activityRelative.setAttribute('datetime', String(next.last_activity_at));
      else activityRelative.removeAttribute('datetime');
      activityExact.textContent = exactMoment(next.last_activity_at) || DASH;
      noteCell.textContent = next.note || DASH;
      const named = next.workspace_name || 'this account';
      summary.textContent = 'Set plan · ' + named;
      legend.textContent = 'Status for ' + named;
      for (const input of radios) {
        input.checked = next.status === input.value;
        input.disabled = source !== 'studio' || input.value === 'active' || ![next.status, 'ended'].includes(input.value);
      }
      const months = Number(next.trial_months);
      monthsInput.value = String(Number.isInteger(months) && months >= 1 && months <= 12 ? months : FREE_MONTHS_DEFAULT);
      const included = Number(next.trial_included_walkthroughs);
      includedInput.value = String(Number.isInteger(included) && included >= 1 && included <= TRIAL_INCLUDED_MAX ? included : FREE_WALKTHROUGHS_DEFAULT);
      sourceSelect.value = source || 'studio';
      sourceSelect.disabled = true;
      sourceNote.hidden = source !== 'apple';
      // Show only the row's stored plan. Retired rows keep their exact name and
      // terms; a studio edit cannot migrate them into today's App Store offer.
      const storedPlan = Object.prototype.hasOwnProperty.call(PLAN_NAMES, next.plan_code) ? next.plan_code : PLAN_ON_SALE;
      const planChoices = [[storedPlan, PLAN_NAMES[storedPlan] + (RETIRED_PLANS.includes(storedPlan) ? ' (retired, existing terms)' : ' (existing terms)')]];
      planSelect.replaceChildren(...planChoices.map(([value, text]) => {
        const option = element('option', undefined, text);
        option.value = value;
        return option;
      }));
      planSelect.value = storedPlan;
      renewInput.checked = false; renewInput.disabled = true;
      planSelect.disabled = true;
      const trialEditable = source === 'studio' && next.status === 'trial';
      for (const input of [monthsInput, includedInput, startInput]) input.disabled = !trialEditable;
      for (const input of [noteInput, save]) input.disabled = source !== 'studio';
      paintInvoice();
      paintGrant();
      paintReferral();
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const current = accounts.find(item => item.workspace_id === workspaceID) || account;
      if (planSource(current) !== 'studio') { result.textContent = 'This subscription is managed by its billing provider.'; return; }
      const chosen = radios.find(input => input.checked)?.value;
      if (chosen === 'active') { result.textContent = 'Paid subscriptions are not started here. New subscriptions start in the App Store; existing obligations stay with their recorded provider.'; return; }
      if (!chosen || !PLAN_STATUSES.includes(chosen)) {
        result.textContent = 'Choose a status before saving.';
        return;
      }
      const name = current.workspace_name || 'this account';
      const allowedStatuses = current.status === 'trial' ? ['trial', 'ended']
        : current.status === 'active' ? ['ended']
          : current.status === 'pending' ? ['pending', 'ended'] : ['ended'];
      if (!allowedStatuses.includes(chosen)) {
        result.textContent = 'New subscriptions start in the App Store. This desk can maintain or end an existing studio agreement, but it cannot start or restart one.'; return;
      }
      // A stored plan is historical customer data, not a migration choice.
      const planChoice = planSelect.value;
      if (planChoice !== current.plan_code || !Object.prototype.hasOwnProperty.call(PLAN_NAMES, planChoice)) {
        result.textContent = "Keep this account's existing plan. New subscriptions and plan choices start in the App Store."; return;
      }
      const questions = [];
      if (chosen === 'ended') questions.push('End studio service for ' + name + '? New walkthrough acceptance will pause. Released walkthroughs stay online for 14 days, then go offline until the plan restarts. This does not issue a refund.');
      if (questions.length && (typeof confirm !== 'function' || !confirm(questions.join(' ')))) { result.textContent = 'Left unchanged.'; return; }
      const args = { p_workspace_id: workspaceID, p_status: chosen };
      if (current.status === 'trial' && chosen === 'trial') {
        const months = Number(monthsInput.value);
        if (Number.isInteger(months) && months >= 1 && months <= 12) args.p_trial_months = months;
        const included = Number(includedInput.value);
        if (Number.isInteger(included) && included >= 1 && included <= TRIAL_INCLUDED_MAX) args.p_trial_included = included;
        const started = String(startInput.value || '').trim();
        if (started) args.p_trial_started_at = started;
      }
      // The App Store owns an Apple subscription's source; the desk never
      // rewrites it, and never claims a plan it did not sell.
      if (!sourceSelect.disabled && PLAN_SOURCES.includes(sourceSelect.value)) args.p_source = sourceSelect.value;
      args.p_plan_code = planChoice;
      args.p_auto_renews = false;
      const note = String(noteInput.value || '').trim();
      if (note) args.p_note = note;
      const version = listVersion;
      save.disabled = true;
      save.textContent = 'Saving…';
      result.textContent = 'Saving the plan…';
      const reply = await settled(client.rpc('studio_set_plan', args));
      if (version !== listVersion) return;
      save.disabled = false;
      save.textContent = 'Save plan';
      const updated = failed(reply) ? null : firstRow(reply.value?.data);
      if (!updated || typeof updated !== 'object' || !PLAN_STATUSES.includes(updated.status)) {
        result.textContent = 'The plan was not saved, or the result could not be confirmed. Refresh the accounts and check this one before saving again.';
        return;
      }
      const merged = { ...current, ...updated };
      const index = accounts.findIndex(item => item.workspace_id === workspaceID);
      if (index >= 0) accounts[index] = merged;
      paint(merged);
      setSummary(summaryText());
      result.textContent = 'Saved: ' + planVocabulary(merged).title + '.' +
        (note ? ' The stored note is not returned by this call; refresh the accounts to read it back.' : '');
      noteInput.value = '';
    });

    paint(account);
    return [row, planRow];
  }

  function render() {
    // Typing a filter before the first answer arrives must keep the rows that
    // are coming. An empty list is a fact about the studio, not about timing.
    if (!rowsEl || loading) return;
    tableEl?.setAttribute('aria-busy', 'false');
    const wanted = statusFilter ? statusFilter.value || 'all' : 'all';
    const text = String((nameFilter && nameFilter.value) || '').trim().toLowerCase();
    const visible = accounts.filter(row =>
      (wanted === 'all' || row.status === wanted) &&
      (!text || String(row.workspace_name || '').toLowerCase().includes(text)));
    const field = row => moment(sortKey === 'trial' ? row.trial_ends_at : row.last_activity_at);
    visible.sort((left, right) => {
      const a = field(left), b = field(right);
      if (a === null && b === null) return String(left.workspace_name || '').localeCompare(String(right.workspace_name || ''));
      if (a === null) return 1;
      if (b === null) return -1;
      return sortDirection === 'desc' ? b - a : a - b;
    });
    setSummary(summaryText() + (visible.length === accounts.length ? '' : ' · showing ' + visible.length));
    if (!accounts.length) {
      const empty = spanRow('studio-empty');
      empty.td.textContent = 'No accounts yet. An account appears here once someone signs in and the studio creates its workspace.';
      rowsEl.replaceChildren(empty.row);
      syncScrollRegion();
      return;
    }
    if (!visible.length) {
      const empty = spanRow('studio-empty');
      empty.td.textContent = 'No account matches this filter. ';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'tour-action';
      clear.textContent = 'Clear the filters';
      clear.addEventListener('click', () => {
        if (statusFilter) statusFilter.value = 'all';
        if (nameFilter) nameFilter.value = '';
        render();
        nameFilter?.focus();
      });
      empty.td.append(clear);
      rowsEl.replaceChildren(empty.row);
      syncScrollRegion();
      return;
    }
    rowsEl.replaceChildren(...visible.flatMap(row => buildAccount(row)));
    syncScrollRegion();
  }

  function unavailableRows() {
    if (!rowsEl) return;
    tableEl?.setAttribute('aria-busy', 'false');
    const state = spanRow('studio-empty');
    state.td.textContent = 'Accounts could not be loaded. This is a failed request, not an empty studio. ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'tour-action';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => { void loadAccounts(); });
    state.td.append(retry);
    rowsEl.replaceChildren(state.row);
    setSummary('Accounts are unavailable.');
    syncScrollRegion();
  }

  /* ---- Deletion requests -----------------------------------------------
   * Accounts that have asked to be deleted, above the table because they are
   * the only row here with a clock on it. This desk lists them; it does not
   * delete, and it never reports a failed lookup as an empty list.
   */
  const DELETION_WORDS = { requested: 'Requested', processing: 'In progress', cancelled: 'Cancelled', completed: 'Completed' };
  const DELETION_NEXT_STEP = 'Complete with the deletion CLI; the desk does not delete.';

  function deletionNames(row) {
    const names = row && row.workspace_names;
    const list = Array.isArray(names) ? names.filter(Boolean).map(String)
      : typeof names === 'string' && names.trim() ? [names.trim()] : [];
    return list.length ? list.join(' · ') : 'No workspace';
  }
  function deletionTerm(parent, term, value, figure) {
    const group = element('div');
    const dt = element('dt', undefined, term);
    const dd = element('dd', figure ? 'plan-figure' : undefined, value);
    group.append(dt, dd); parent.append(group);
  }
  function deletionRequest(row) {
    const item = element('li', 'studio-deletion');
    item.append(element('h3', 'studio-deletion-name', deletionNames(row)));
    const dl = element('dl', 'leaving-list plan-list');
    deletionTerm(dl, 'Requested', shortDate(row.requested_at) || DASH);
    deletionTerm(dl, 'Status', DELETION_WORDS[row.status] || DASH);
    deletionTerm(dl, 'Account id', row.user_id ? String(row.user_id) : DASH);
    deletionTerm(dl, 'Spaces', countText(row.property_count), true);
    deletionTerm(dl, 'Walkthroughs', countText(row.tour_count), true);
    deletionTerm(dl, 'Live links', countText(row.active_share_count), true);
    deletionTerm(dl, 'Reason', row.reason ? String(row.reason) : DASH);
    deletionTerm(dl, 'Next step', DELETION_NEXT_STEP);
    item.append(dl);
    return item;
  }
  function deletionsShow(...parts) {
    if (deletionsEl) deletionsEl.replaceChildren(...parts);
  }
  async function loadDeletions() {
    if (!deletionsEl) return;
    const version = listVersion;
    deletionsShow(element('p', 'contact-note', 'Checking for deletion requests…'));
    const reply = await settled(client.rpc('studio_list_deletion_requests'));
    if (version !== listVersion) return;
    if (failed(reply)) {
      const note = element('p', 'contact-note', 'Deletion requests could not be loaded. This is a failed request, not an empty list. ');
      const retry = element('button', 'tour-action', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => { void loadDeletions(); });
      note.append(retry);
      deletionsShow(note);
      return;
    }
    const rows = (Array.isArray(reply.value?.data) ? reply.value.data : []).filter(row => row && typeof row === 'object');
    if (!rows.length) { deletionsShow(element('p', 'contact-note', 'No deletion requests.')); return; }
    const heading = element('h2', 'dash-heading', 'Deletion requests');
    const list = element('ul', 'studio-deletion-list');
    list.append(...rows.map(deletionRequest));
    deletionsShow(heading, list);
  }

  /* ---- Hosted walkthroughs --------------------------------------------
   * Released walkthroughs and whether a plan keeps them live, those without an
   * active plan first. Offer 2026-09-26.2: a walkthrough is live while its
   * office has an active plan (free months, monthly or annual); when the plan
   * ends its links, embeds and QR codes stay up 14 days, then go offline, and
   * restarting the plan brings the same links back. After that, only a paid
   * hosting extension (on request, invoiced) keeps that one walkthrough online,
   * until the extension ends. The one write is studio_record_hosting_extension,
   * recorded after the invoice is paid; the server lets it move a date later
   * only and keeps an audit row. Nothing here switches sharing off, and a
   * failed lookup is never shown as an empty list.
   */
  const hostedRowsEl = document.getElementById('studio-hosted-rows');
  const hostedTable = document.getElementById('studio-hosted-table');
  const HOSTED_COLUMNS = 6;
  const HOSTED_DAYS_AFTER_PLAN = 14;
  const HOSTED_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hostedVersion = 0;
  let hosted = [];
  const openExtensions = new Set();

  // The same Brisbane "23 Sep 2027" the account desk and the app print, with a
  // fixed month list so locale data ("Sept") cannot change it.
  let brisbane = null;
  function hostedDate(value) {
    const when = moment(value);
    if (when === null) return '';
    try {
      brisbane = brisbane || new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'numeric', year: 'numeric' });
      const parts = {};
      for (const part of brisbane.formatToParts(new Date(when))) parts[part.type] = part.value;
      return Number(parts.day) + ' ' + HOSTED_MONTHS[Number(parts.month) - 1] + ' ' + Number(parts.year);
    } catch {
      // Brisbane keeps UTC+10 all year, so a browser without zone data agrees.
      const local = new Date(when + 10 * 3600000);
      return local.getUTCDate() + ' ' + HOSTED_MONTHS[local.getUTCMonth()] + ' ' + local.getUTCFullYear();
    }
  }
  // Without an active plan (free months, monthly or annual) a walkthrough goes
  // offline 14 days after the plan ends.
  function hostedDue(row) {
    return !['trial', 'active'].includes(row.plan_status);
  }
  // A recorded extension that has not ended yet keeps the walkthrough online after the plan's 14 days.
  function hostedExtended(row, now = Date.now()) {
    const until = moment(row.extended_until);
    return until !== null && until > now;
  }
  function hostedOrder(rows) {
    const released = row => moment(row.released_at) ?? Number.MAX_SAFE_INTEGER;
    return [...rows].sort((left, right) => (hostedDue(right) - hostedDue(left)) || (released(left) - released(right)) ||
      String(left.property_title || '').localeCompare(String(right.property_title || '')));
  }
  function hostedState(text, retry) {
    if (!hostedRowsEl) return;
    hostedTable?.setAttribute('aria-busy', 'false');
    const row = element('tr', 'studio-empty');
    const td = element('td', undefined, text);
    td.setAttribute('colspan', String(HOSTED_COLUMNS));
    if (retry) {
      const again = element('button', 'tour-action', 'Retry'); again.type = 'button';
      again.addEventListener('click', () => { void loadHosted(); });
      td.append(again);
    }
    row.append(td);
    hostedRowsEl.replaceChildren(row);
  }
  function hostedSkeleton() {
    if (!hostedRowsEl) return;
    hostedTable?.setAttribute('aria-busy', 'true');
    const rows = [];
    for (let index = 0; index < 2; index += 1) {
      const row = element('tr', 'studio-row studio-skeleton');
      row.setAttribute('aria-hidden', 'true');
      const head = element('th'); head.setAttribute('scope', 'row'); head.append(element('span', 'studio-bar'));
      row.append(head);
      for (let column = 1; column < HOSTED_COLUMNS; column += 1) {
        const td = element('td'); td.append(element('span', 'studio-bar')); row.append(td);
      }
      rows.push(row);
    }
    hostedRowsEl.replaceChildren(...rows);
  }
  function buildHosted(start) {
    const tourID = start.tour_id;
    const row = element('tr', 'studio-row');
    const nameCell = element('th'); nameCell.setAttribute('scope', 'row');
    const nameText = element('strong', 'studio-name');
    const idText = element('span', 'studio-sub');
    const badge = element('span', 'pill pill-busy studio-due', 'No active plan');
    nameCell.append(nameText, idText, badge); row.append(nameCell);
    const sharingCell = cell(row, 'Sharing');
    const releasedCell = cell(row, 'Released', 'studio-figure');
    const planCell = cell(row, 'Plan');
    const hostingCell = cell(row, 'Hosting');
    const extendedCell = cell(row, 'Extended until', 'studio-figure');

    const formRow = element('tr', 'studio-plan-row');
    const formCell = element('td'); formCell.setAttribute('colspan', String(HOSTED_COLUMNS)); formRow.append(formCell);
    const details = element('details', 'studio-set-plan studio-extension');
    details.open = openExtensions.has(tourID);
    details.addEventListener('toggle', () => { if (details.open) openExtensions.add(tourID); else openExtensions.delete(tourID); });
    const summary = element('summary');
    const form = element('form', 'veylet-form studio-plan-form studio-extension-form');
    const dateLabel = element('label', 'studio-inline-field', 'Extension ends (Brisbane date)');
    const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.required = true; dateInput.name = 'extended_until';
    dateLabel.append(dateInput);
    const refLabel = element('label', 'studio-inline-field', 'Paid invoice reference');
    const refInput = document.createElement('input'); refInput.type = 'text'; refInput.required = true; refInput.name = 'reference';
    referenceInput(refInput);
    refLabel.append(refInput);
    const note = element('p', 'studio-field-note studio-extension-note', 'A paid hosting extension keeps this one walkthrough online after the plan\'s ' + HOSTED_DAYS_AFTER_PLAN + ' days, until the date you enter. Record it only after the invoice is paid. Use an opaque reference, not a name, email or payment detail. An extension can only move the date later; the server keeps an audit row. No payment is taken here.');
    const save = element('button', 'button', 'Record extension'); save.type = 'submit';
    const result = element('span', 'studio-result'); result.setAttribute('role', 'status');
    const saveRow = element('p', 'studio-save-row'); saveRow.append(save, result);
    const noteRow = element('div', 'studio-extension-note-row'); noteRow.append(note);
    form.append(dateLabel, refLabel, noteRow, saveRow);
    details.append(summary, form); formCell.append(details);

    let current = start;
    function paint(next) {
      current = next;
      const title = next.property_title || 'Untitled space';
      nameText.textContent = title;
      idText.textContent = 'Walkthrough ' + String(tourID || '').slice(0, 8);
      const due = hostedDue(next);
      badge.hidden = !due;
      row.dataset.due = due ? 'true' : 'false';
      sharingCell.textContent = next.sharing_on === true ? 'On' : next.sharing_on === false ? 'Off' : DASH;
      releasedCell.textContent = hostedDate(next.released_at) || DASH;
      planCell.textContent = STATUS_CHOICES[next.plan_status] || DASH;
      hostingCell.textContent = !due ? 'Live while the plan is active'
        : hostedExtended(next) ? 'Kept online by a hosting extension until ' + hostedDate(next.extended_until)
          : 'Offline ' + HOSTED_DAYS_AFTER_PLAN + ' days after the plan ends; restarting the plan restores the link';
      extendedCell.textContent = hostedDate(next.extended_until) || DASH;
      summary.textContent = 'Record extension · ' + title;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const day = String(dateInput.value || '').trim();
      const reference = String(refInput.value || '').trim();
      // The start of that day in Brisbane, so the desk prints back the date typed.
      const until = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T00:00:00+10:00') : null;
      if (!until || Number.isNaN(until.getTime())) { result.textContent = 'Enter the date the paid extension ends.'; return; }
      // Later than today and than any extension already recorded; the server has the last word.
      const extended = moment(current.extended_until);
      const floor = Math.max(Date.now(), extended ?? 0);
      if (until.getTime() <= floor) {
        result.textContent = 'Choose a date after ' + hostedDate(new Date(floor).toISOString()) + '. An extension can only move the date later.'; return;
      }
      if (!REFERENCE.test(reference)) { result.textContent = 'Enter the paid invoice reference (' + REFERENCE_FORMAT + ').'; return; }
      const title = current.property_title || 'this walkthrough';
      const question = 'Record a paid hosting extension for ' + title + ' until ' + hostedDate(until.toISOString()) + ' (reference ' + reference + ')? It keeps this walkthrough online after the plan\'s ' + HOSTED_DAYS_AFTER_PLAN + ' days, until that date. The date can only move later. No payment is taken here.';
      if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      const version = hostedVersion;
      save.disabled = true;
      result.textContent = 'Recording the extension…';
      const reply = await settled(client.rpc('studio_record_hosting_extension',
        { p_tour_id: tourID, p_extended_until: until.toISOString(), p_reference: reference }));
      if (version !== hostedVersion) return;
      save.disabled = false;
      const updated = failed(reply) ? null : firstRow(reply.value?.data);
      if (!updated || updated.tour_id !== tourID || moment(updated.extended_until) === null) {
        // The typed date and reference stay, so a retry sends the same intent.
        // Only an answer from the server is a rejection; a lost request is unknown.
        const said = reply.value?.error;
        const reason = said && typeof said.message === 'string' && said.message.trim() ? said.message.trim() : '';
        result.textContent = reason ? 'Not recorded: ' + reason
          : 'The extension was not confirmed. Refresh and check this walkthrough before recording it again.';
        return;
      }
      const merged = { ...current, ...updated };
      const index = hosted.findIndex(item => item.tour_id === tourID);
      if (index >= 0) hosted[index] = merged;
      paint(merged);
      dateInput.value = ''; refInput.value = '';
      const said = 'Recorded: ' + title + ' kept online until ' + hostedDate(merged.extended_until) + '.';
      result.textContent = said; setStatus(said);
    });
    paint(start);
    return [row, formRow];
  }
  async function loadHosted() {
    if (!hostedRowsEl) return;
    const version = ++hostedVersion;
    hostedSkeleton();
    const reply = await settled(client.rpc('studio_list_hosted_tours'));
    if (version !== hostedVersion) return;
    if (failed(reply)) {
      hosted = [];
      hostedState('Hosted walkthroughs could not be loaded. This is a failed request, not an empty list. ', true);
      return;
    }
    hosted = (Array.isArray(reply.value?.data) ? reply.value.data : []).filter(row => row && typeof row === 'object' && row.tour_id);
    paintCorrectionOptions();
    if (!hosted.length) { hostedState('No released walkthroughs yet.', false); return; }
    hostedTable?.setAttribute('aria-busy', 'false');
    hostedRowsEl.replaceChildren(...hostedOrder(hosted).flatMap(buildHosted));
  }

  /* ---- Money exceptions -----------------------------------------------
   * Charges and payment states that need a person, first on the desk. The
   * server orders them high severity first, then oldest. The one write marks
   * an exception resolved with an opaque reference (a Square refund id, say);
   * it moves no money. A failed lookup is never shown as an empty list.
   */
  const moneyBody = document.getElementById('studio-money-body');
  // Each kind named once. An unknown kind keeps its raw text; no row is dropped.
  const MONEY_KINDS = {
    charge_refused: 'Annual charge not granted',
    duplicate_charge: 'Pack charged twice',
    mismatch: 'Pack charged a different amount',
    refunded_after_use: 'Pack refunded after use',
    square_cancel_unconfirmed: 'Square cancel unconfirmed',
    start_failed: 'Annual first charge failed',
    start_unconfirmed: 'Annual start not confirmed',
    apple_inbox_blocked: 'App Store stream blocked',
    apple_inbox_stuck: 'App Store notice waiting',
    pack_intent_unresolved: 'Pack payment unresolved',
  };
  const MONEY_SEVERITY = { high: 'High', medium: 'Medium' };
  let moneyVersion = 0;
  // Each shown exception and its list item, so resolving one keeps the others'
  // open forms and typed references.
  let money = [];

  function moneyLabel(row) {
    const kind = typeof row.kind === 'string' ? row.kind.trim() : '';
    return Object.prototype.hasOwnProperty.call(MONEY_KINDS, kind) ? MONEY_KINDS[kind] : kind || 'Unnamed money exception';
  }
  function moneyAccount(row) {
    const name = typeof row.workspace_name === 'string' ? row.workspace_name.trim() : '';
    return name || (row.workspace_id ? 'Deleted account' : 'No account linked');
  }
  // Integer cents. App Store amounts are unknown to us, and are said to be.
  function moneyAmount(row) {
    const cents = row.amount_cents;
    if (cents === null || cents === undefined || cents === '') return 'Amount unknown';
    if (row.currency === null || row.currency === undefined || row.currency === 'AUD') return planMoney(cents) || 'Amount unknown';
    const amount = Number(cents);
    return Number.isInteger(amount) ? (amount / 100).toFixed(2) + ' ' + String(row.currency) : 'Amount unknown';
  }
  function moneyAge(minutes) {
    const value = Number(minutes);
    if (minutes === null || minutes === undefined || minutes === '' || !Number.isFinite(value) || value < 0) return DASH;
    const whole = Math.floor(value);
    if (whole < 60) return whole + ' min';
    const hours = Math.floor(whole / 60);
    if (hours < 24) return hours + ' h';
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day' : ' days');
  }
  // The Brisbane day hostedDate prints, and the Brisbane clock (UTC+10 all year).
  function brisbaneClock(value) {
    const day = hostedDate(value);
    if (!day) return '';
    const local = new Date(moment(value) + 10 * 3600000);
    return day + ', ' + String(local.getUTCHours()).padStart(2, '0') + ':' + String(local.getUTCMinutes()).padStart(2, '0');
  }
  function moneyShow(busy, ...parts) {
    if (!moneyBody) return;
    moneyBody.setAttribute('aria-busy', busy ? 'true' : 'false');
    moneyBody.replaceChildren(...parts);
  }
  function paintMoney() {
    if (!money.length) { moneyShow(false, element('p', 'contact-note', 'No money exceptions.')); return; }
    const list = element('ul', 'studio-money-list');
    list.append(...money.map(entry => entry.item));
    moneyShow(false, list);
  }
  function moneyResolveForm(key, label, account) {
    const details = element('details', 'studio-set-plan studio-money-resolve');
    const summary = element('summary', undefined, 'Mark resolved · ' + label + ' · ' + account);
    const form = element('form', 'veylet-form studio-plan-form studio-money-form');
    const refLabel = element('label', 'studio-inline-field', 'Resolution reference');
    const refInput = document.createElement('input');
    referenceInput(refInput); refInput.required = true; refInput.name = 'resolution_reference';
    refLabel.append(refInput);
    const note = element('p', 'studio-field-note', 'An opaque reference such as the Square refund id, not a name, email or payment detail. This records the reference only; it moves no money.');
    const noteRow = element('div', 'studio-form-row'); noteRow.append(note);
    const save = element('button', 'button', 'Mark resolved'); save.type = 'submit';
    const result = element('span', 'studio-result'); result.setAttribute('role', 'status');
    const saveRow = element('p', 'studio-save-row'); saveRow.append(save, result);
    form.append(refLabel, noteRow, saveRow);
    details.append(summary, form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const reference = String(refInput.value || '').trim();
      if (!REFERENCE.test(reference)) { result.textContent = 'Enter the resolution reference, such as the Square refund id (' + REFERENCE_FORMAT + ').'; return; }
      const question = 'Mark "' + label + '" for ' + account + ' as resolved, with reference ' + reference + '? This records the reference only. It does not refund, charge or cancel anything.';
      if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      const version = moneyVersion;
      save.disabled = true;
      result.textContent = 'Marking resolved…';
      const reply = await settled(client.rpc('studio_resolve_money_exception', { p_exception_key: key, p_note: reference }));
      if (version !== moneyVersion) return;
      save.disabled = false;
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (!answer || typeof answer !== 'object' || answer.exception_key !== key) {
        // The typed reference stays. Only an answer from the server is a
        // refusal; a lost request is unknown, and the list must be read again.
        const said = reply.value?.error;
        const reason = said && typeof said.message === 'string' && said.message.trim() ? said.message.trim() : '';
        result.textContent = reason ? 'Not resolved: ' + reason
          : 'The resolution was not confirmed. Refresh the accounts to read this list again before trying again.';
        return;
      }
      money = money.filter(entry => entry.row.exception_key !== key);
      paintMoney();
      setStatus('Resolved: ' + label + ' for ' + account + '.');
    });
    return details;
  }
  function moneyItem(row) {
    const label = moneyLabel(row);
    const account = moneyAccount(row);
    const severity = typeof row.severity === 'string' ? row.severity : '';
    const item = element('li', 'studio-money-item');
    item.dataset.severity = severity;
    const head = element('div', 'studio-money-head');
    head.append(element('h3', 'studio-money-name', label),
      element('span', 'pill studio-money-severity' + (severity === 'high' ? ' pill-busy' : ''), MONEY_SEVERITY[severity] || severity || DASH),
      element('span', 'studio-money-runbook', row.runbook ? 'Runbook ' + String(row.runbook) : 'No runbook'));
    const dl = element('dl', 'leaving-list plan-list');
    deletionTerm(dl, 'Account', account);
    deletionTerm(dl, 'Amount', moneyAmount(row), true);
    deletionTerm(dl, 'Since', brisbaneClock(row.occurred_at) || DASH);
    deletionTerm(dl, 'Age', moneyAge(row.age_minutes), true);
    deletionTerm(dl, 'Reference', row.reference ? String(row.reference) : DASH);
    deletionTerm(dl, 'Detail', row.detail ? String(row.detail) : DASH);
    item.append(head, dl);
    const key = typeof row.exception_key === 'string' ? row.exception_key : '';
    if (row.resolvable === true && key) item.append(moneyResolveForm(key, label, account));
    return item;
  }
  async function loadMoney() {
    if (!moneyBody) return;
    const version = ++moneyVersion;
    moneyShow(true, element('p', 'contact-note', 'Checking for money exceptions…'));
    const reply = await settled(client.rpc('studio_money_exceptions'));
    if (version !== moneyVersion) return;
    // Only an answered list can say there is nothing: anything else is a failure.
    if (failed(reply) || !Array.isArray(reply.value?.data)) {
      money = [];
      const note = element('p', 'contact-note', 'Money exceptions could not be loaded. This is a failed request, not an empty list. ');
      const retry = element('button', 'tour-action', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => { void loadMoney(); });
      note.append(retry);
      moneyShow(false, note);
      return;
    }
    money = reply.value.data.filter(row => row && typeof row === 'object').map(row => ({ row, item: moneyItem(row) }));
    paintMoney();
  }

  /* ---- Capture queue ----------------------------------------------------
   * Open capture jobs in the order the worker claims them (founding accounts
   * first, then the longest waiting; a job past the 6-hour queue-promotion
   * threshold is passed over no more), with its operational queue clock from
   * studio_capture_queue(). Below it, the last 7 days are grouped against the
   * 12- and 24-hour escalation thresholds from studio_capture_sla(7). Those
   * thresholds are not customer ready-time targets and do not establish pilot
   * turnaround. Both calls are reads. A failed read is never shown as an empty
   * queue or a quiet week.
   */
  const queueRowsEl = document.getElementById('studio-queue-rows');
  const queueTable = document.getElementById('studio-queue-table');
  const queueSummaryEl = document.getElementById('studio-queue-summary');
  const slaBody = document.getElementById('studio-sla-body');
  const QUEUE_COLUMNS = 7;
  const QUEUE_OPEN = ['uploading', 'queued', 'processing', 'failed'];
  const SLA_DAYS = 7;
  const QUEUE_STATUS = { uploading: 'Uploading', queued: 'Queued', processing: 'Processing', failed: 'Failed', awaiting_review: 'Ready for review' };
  // Super fast (code name express, A$29, website only) is claimed first and due 30 minutes after the upload finishes.
  const QUEUE_PRIORITY = { express: 'Super fast', founding: 'Founding', promoted: '6-hour queue promotion', standard: 'Standard' };
  const QUEUE_THRESHOLD = { breached: 'Past threshold', open: 'Before threshold', met: 'Before threshold', not_started: 'Not started' };
  const EXPRESS_TARGET = { breached: 'Late', open: 'On time', met: 'Met', not_started: 'Not started' };
  const SLA_CLASSES = { express: 'Super fast renders', founding: 'Founding accounts', standard: 'Everyone else' };
  let queueVersion = 0;
  let slaVersion = 0;
  // The last answered queue, so the account names can follow the accounts list.
  let queue = null;

  // Hours as the desk reads them: minutes under an hour, one decimal under two
  // days, then days and hours. Tabular in the cell, so a changed age shifts nothing.
  function hoursText(value) {
    if (value === null || value === undefined || value === '') return DASH;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0) return DASH;
    if (hours < 1) return Math.round(hours * 60) + ' min';
    if (hours < 48) return (Math.round(hours * 10) / 10).toLocaleString('en-AU', { maximumFractionDigits: 1 }) + ' h';
    const days = Math.floor(hours / 24);
    return days + ' days ' + Math.round(hours - days * 24) + ' h';
  }
  // A due time is a day or two away: its day, month and Brisbane clock, with the
  // year only when it is not this year's.
  function queueDue(value) {
    const clock = brisbaneClock(value);
    const year = hostedDate(new Date().toISOString()).slice(-4);
    return clock.replace(new RegExp(' ' + year + ','), ',');
  }
  function queueAccount(row) {
    const account = accounts.find(item => item.workspace_id === row.workspace_id);
    const name = account && typeof account.workspace_name === 'string' ? account.workspace_name.trim() : '';
    return name || (row.workspace_id ? 'Account ' + String(row.workspace_id).slice(0, 8) : 'No account linked');
  }
  function queueStatus(row) {
    const label = QUEUE_STATUS[row.status] || (row.status ? String(row.status) : DASH);
    if (row.status === 'processing' && row.stage) return label + ' · ' + String(row.stage).replace(/_/g, ' ');
    if (row.status === 'failed' && row.error_code) return label + ' · ' + String(row.error_code).replace(/_/g, ' ');
    return label;
  }
  function queueShow(...rows) {
    if (!queueRowsEl) return;
    queueTable?.setAttribute('aria-busy', 'false');
    queueRowsEl.replaceChildren(...rows);
  }
  function queueState(text, retry) {
    const row = element('tr', 'studio-empty');
    const td = element('td', undefined, text);
    td.setAttribute('colspan', String(QUEUE_COLUMNS));
    if (retry) {
      const again = element('button', 'tour-action', 'Retry'); again.type = 'button';
      again.addEventListener('click', () => { void loadQueue(); });
      td.append(again);
    }
    row.append(td);
    return row;
  }
  function queueSkeleton() {
    if (!queueRowsEl) return;
    queueTable?.setAttribute('aria-busy', 'true');
    const rows = [];
    for (let index = 0; index < 2; index += 1) {
      const row = element('tr', 'studio-row studio-skeleton');
      row.setAttribute('aria-hidden', 'true');
      const head = element('th'); head.setAttribute('scope', 'row'); head.append(element('span', 'studio-bar'));
      row.append(head);
      for (let column = 1; column < QUEUE_COLUMNS; column += 1) {
        const td = element('td'); td.append(element('span', 'studio-bar')); row.append(td);
      }
      rows.push(row);
    }
    queueRowsEl.replaceChildren(...rows);
  }
  function queueRow(job) {
    const row = element('tr', 'studio-row');
    const breached = job.sla_state === 'breached';
    row.dataset.breached = breached ? 'true' : 'false';
    const head = element('th'); head.setAttribute('scope', 'row');
    head.append(element('strong', 'studio-name', 'Job ' + String(job.job_id || '').slice(0, 8)),
      element('span', 'studio-sub', queueAccount(job)));
    row.append(head);
    const place = Number.isInteger(job.queue_position) && job.queue_position > 0 ? String(job.queue_position) : DASH;
    cell(row, 'In line', 'studio-figure').textContent = place;
    const priority = cell(row, 'Priority');
    const words = QUEUE_PRIORITY[job.priority] || (job.priority ? String(job.priority) : DASH);
    if (['express', 'founding', 'promoted'].includes(job.priority)) priority.append(element('span', 'pill', words));
    else priority.textContent = words;
    cell(row, 'Status').textContent = queueStatus(job);
    // The operational clock starts when upload finishes; it is not a customer ready-time estimate.
    cell(row, 'Since upload', 'studio-figure').textContent = job.queued_at ? hoursText(job.elapsed_hours) : DASH;
    cell(row, 'Due', 'studio-figure').textContent = queueDue(job.sla_due_at) || DASH;
    const isExpress = job.priority === 'express';
    const timing = cell(row, isExpress ? 'Super fast target' : 'Escalation threshold');
    const timingWords = isExpress ? EXPRESS_TARGET : QUEUE_THRESHOLD;
    const verdict = timingWords[job.sla_state] || (job.sla_state ? String(job.sla_state) : DASH);
    const hours = typeof job.sla_hours === 'number' && job.sla_hours > 0 ? ' (' + hoursText(job.sla_hours) + ')' : '';
    // A passed timing rule is stated in words and marked, never shown by colour alone.
    if (breached) timing.append(element('span', 'pill pill-busy studio-over', verdict + hours));
    else timing.textContent = verdict + hours;
    return row;
  }
  function paintQueue() {
    if (!queueRowsEl || !queue) return;
    const open = queue.filter(job => QUEUE_OPEN.includes(job.status));
    const finished = queue.filter(job => job.status === 'awaiting_review');
    const over = open.filter(job => job.sla_state === 'breached').length;
    const waiting = open.filter(job => job.status === 'queued' && job.queued_at).map(job => Number(job.elapsed_hours)).filter(Number.isFinite);
    const longest = waiting.length ? Math.max(...waiting) : null;
    const finishedOver = finished.filter(job => job.sla_state === 'breached').length;
    if (queueSummaryEl) {
      queueSummaryEl.textContent = (open.length ? open.length + ' open · ' + over + ' past timing mark' +
        (longest === null ? '' : ' · longest in line ' + hoursText(longest)) : 'Nothing open') + ' · ' +
        (finished.length ? finished.length + ' finished in the last 30 days, ' + finishedOver + ' past timing mark' : 'none finished in the last 30 days');
    }
    if (!open.length) { queueShow(queueState('No capture is waiting. A job appears here once its upload has finished.', false)); return; }
    queueShow(...open.map(queueRow));
  }
  async function loadQueue() {
    if (!queueRowsEl) return;
    const version = ++queueVersion;
    queueSkeleton();
    if (queueSummaryEl) queueSummaryEl.textContent = 'Reading the capture queue…';
    const reply = await settled(client.rpc('studio_capture_queue'));
    if (version !== queueVersion) return;
    if (failed(reply) || !Array.isArray(reply.value?.data)) {
      queue = null;
      if (queueSummaryEl) queueSummaryEl.textContent = 'The capture queue is unavailable.';
      queueShow(queueState('The capture queue could not be loaded. This is a failed request, not an empty queue. ', true));
      return;
    }
    queue = reply.value.data.filter(row => row && typeof row === 'object' && row.job_id);
    paintQueue();
  }

  function slaShow(busy, ...parts) {
    if (!slaBody) return;
    slaBody.setAttribute('aria-busy', busy ? 'true' : 'false');
    slaBody.replaceChildren(...parts);
  }
  function slaClass(row) {
    const item = element('li', 'studio-sla-class');
    const label = SLA_CLASSES[row.priority_class] || (row.priority_class ? String(row.priority_class) : 'Unnamed class');
    const slaHours = Number(row.sla_hours);
    const isExpress = row.priority_class === 'express';
    const timing = typeof row.sla_hours === 'number' && slaHours > 0
      ? (isExpress ? Math.round(slaHours * 60) + '-minute target' : slaHours + '-hour escalation threshold')
      : (isExpress ? 'target unknown' : 'threshold unknown');
    item.append(element('h4', 'studio-sla-name', label + ' · ' + timing));
    const dl = element('dl', 'leaving-list plan-list');
    const finished = countText(row.completed);
    deletionTerm(dl, 'Finished', finished, true);
    deletionTerm(dl, isExpress ? 'Within promise' : 'Before threshold', countText(row.met), true);
    deletionTerm(dl, isExpress ? 'Past promise' : 'Past threshold', countText(row.breached), true);
    deletionTerm(dl, 'Median', hoursText(row.p50_hours), true);
    deletionTerm(dl, '90th percentile', hoursText(row.p90_hours), true);
    item.append(dl);
    if (count(row.breached) > 0) item.dataset.breached = 'true';
    return item;
  }
  async function loadSla() {
    if (!slaBody) return;
    const version = ++slaVersion;
    slaShow(true, element('p', 'contact-note', 'Reading the last ' + SLA_DAYS + ' days…'));
    const reply = await settled(client.rpc('studio_capture_sla', { p_days: SLA_DAYS }));
    if (version !== slaVersion) return;
    if (failed(reply) || !Array.isArray(reply.value?.data)) {
      const note = element('p', 'contact-note', 'Threshold figures could not be loaded. This is a failed request, not a quiet week. ');
      const retry = element('button', 'tour-action', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', () => { void loadSla(); });
      note.append(retry);
      slaShow(false, note);
      return;
    }
    const rows = reply.value.data.filter(row => row && typeof row === 'object');
    if (!rows.length) { slaShow(false, element('p', 'contact-note', 'No threshold figures yet.')); return; }
    const list = element('ul', 'studio-sla-list');
    list.append(...rows.map(slaClass));
    slaShow(false, list);
  }

  /* ---- Super fast renders ----------------------------------------------
   * Owner decision 25 September 2026: processing is automatic; standard
   * rendering has no time promise until pilot turnaround is measured,
   * and no person checks a walkthrough. A Super fast render (code name
   * express, A$29, website only) runs first on the fastest GPU in Australia and
   * is ready for review within 30 minutes of the upload finishing, any day, any
   * time, or it is refunded automatically (the A$29, or the bonus render
   * returned). Orders are not limited per day, and the clock never pauses.
   * studio_express_queue() (a proposed name) answers the orders of today and the
   * last 7 days with their due time, state and refund. The desk lists the open
   * ones soonest due first (due = the upload finished + 30 minutes; the server's
   * due_at when it sends one), then a missed one whose refund has not gone
   * through, and counts the last 7 days against the 30-minute promise.
   * Read-only; a failed read is never an empty list.
   */
  const expressRowsEl = document.getElementById('studio-express-rows');
  const expressTable = document.getElementById('studio-express-table');
  const expressSummaryEl = document.getElementById('studio-express-summary');
  const expressSlaEl = document.getElementById('studio-express-sla');
  const EXPRESS_COLUMNS = 6;
  // offer.json expressRender: webAud 29, ready within 30 minutes of the upload finishing, dailyCap null.
  const EXPRESS_MINUTES = 30;
  const EXPRESS_PAID = { card: 'Card', credit: 'Bonus render' };
  const EXPRESS_REFUND = { pending: 'refund pending', refunded: 'refunded', returned: 'render returned', failed: 'refund failed' };
  let expressVersion = 0;
  let expressRows = null;

  function expressAccount(row) { return queueAccount(row); }
  // Due 30 minutes after the upload finished. The server's due_at decides the
  // refund, so it wins; before the upload has finished the clock has not started.
  function expressDue(row) {
    const due = moment(row.due_at);
    if (due !== null) return due;
    const uploaded = moment(row.uploaded_at);
    return uploaded === null ? null : uploaded + EXPRESS_MINUTES * 60000;
  }
  function expressVerdict(row, now) {
    if (row.state === 'open') {
      const due = expressDue(row);
      if (due === null) return 'Upload not finished';
      return due < now ? 'Late' : 'On time';
    }
    if (row.state === 'met') return 'Met';
    if (row.state === 'missed') return 'Missed · ' + (EXPRESS_REFUND[row.refund] || 'refund not recorded');
    return row.state ? String(row.state) : DASH;
  }
  // Time to the due moment while open; how late once it has passed.
  function expressLeft(row, now) {
    const due = expressDue(row);
    if (row.state !== 'open' || due === null) return DASH;
    const hours = (due - now) / 3600000;
    return hours >= 0 ? hoursText(hours) : 'late ' + hoursText(-hours);
  }
  function expressShow(...rows) {
    if (!expressRowsEl) return;
    expressTable?.setAttribute('aria-busy', 'false');
    expressRowsEl.replaceChildren(...rows);
  }
  function expressState(text, retry) {
    const row = element('tr', 'studio-empty');
    const td = element('td', undefined, text);
    td.setAttribute('colspan', String(EXPRESS_COLUMNS));
    if (retry) {
      const again = element('button', 'tour-action', 'Retry'); again.type = 'button';
      again.addEventListener('click', () => { void loadExpress(); });
      td.append(again);
    }
    row.append(td);
    return row;
  }
  function expressSkeleton() {
    if (!expressRowsEl) return;
    expressTable?.setAttribute('aria-busy', 'true');
    const row = element('tr', 'studio-row studio-skeleton');
    row.setAttribute('aria-hidden', 'true');
    const head = element('th'); head.setAttribute('scope', 'row'); head.append(element('span', 'studio-bar'));
    row.append(head);
    for (let column = 1; column < EXPRESS_COLUMNS; column += 1) { const td = element('td'); td.append(element('span', 'studio-bar')); row.append(td); }
    expressRowsEl.replaceChildren(row);
  }
  function expressRow(item, now) {
    const row = element('tr', 'studio-row');
    const verdict = expressVerdict(item, now);
    const late = verdict === 'Late' || (item.state === 'missed' && ['pending', 'failed'].includes(item.refund));
    row.dataset.breached = late ? 'true' : 'false';
    const head = element('th'); head.setAttribute('scope', 'row');
    head.append(element('strong', 'studio-name', 'Job ' + String(item.job_id || '').slice(0, 8)), element('span', 'studio-sub', expressAccount(item)));
    row.append(head);
    cell(row, 'Paid with').textContent = (EXPRESS_PAID[item.paid_with] || DASH) +
      (item.paid_with === 'card' && Number.isInteger(item.amount_cents) ? ' · ' + planMoney(item.amount_cents) : '');
    cell(row, 'Ordered', 'studio-figure').textContent = queueDue(item.ordered_at) || DASH;
    const due = expressDue(item);
    cell(row, 'Due', 'studio-figure').textContent = due === null ? DASH : queueDue(new Date(due).toISOString()) || DASH;
    cell(row, 'Left', 'studio-figure').textContent = expressLeft(item, now);
    const promise = cell(row, 'Promise');
    // Late or unrefunded is a word and a mark, never colour alone.
    const within = ' (' + EXPRESS_MINUTES + ' min)';
    if (late) promise.append(element('span', 'pill pill-busy studio-over', verdict + within));
    else promise.textContent = verdict + (item.state === 'open' ? within : '');
    return row;
  }
  function paintExpress() {
    if (!expressRowsEl || !expressRows) return;
    const now = Date.now();
    const open = expressRows.filter(row => row.state === 'open').sort((a, b) => (expressDue(a) ?? Infinity) - (expressDue(b) ?? Infinity));
    const owing = expressRows.filter(row => row.state === 'missed' && ['pending', 'failed'].includes(row.refund));
    const late = open.filter(row => expressVerdict(row, now) === 'Late').length;
    if (expressSummaryEl) {
      expressSummaryEl.textContent = (open.length ? open.length + ' open · ' + late + ' late' : 'None open') +
        (owing.length ? ' · ' + owing.length + ' refund' + (owing.length === 1 ? '' : 's') + ' not through' : '');
    }
    // The last 7 days, finished orders only, against the promise.
    const week = now - 7 * 86400000;
    const done = expressRows.filter(row => row.state !== 'open' && (moment(row.ordered_at) ?? 0) >= week);
    if (expressSlaEl) {
      const dl = element('dl', 'leaving-list plan-list');
      deletionTerm(dl, 'Finished', String(done.length), true);
      deletionTerm(dl, 'Within ' + EXPRESS_MINUTES + ' minutes', String(done.filter(row => row.state === 'met').length), true);
      deletionTerm(dl, 'Missed', String(done.filter(row => row.state === 'missed').length), true);
      deletionTerm(dl, 'Refunded or returned', String(done.filter(row => ['refunded', 'returned'].includes(row.refund)).length), true);
      deletionTerm(dl, 'Refund not through', String(done.filter(row => ['pending', 'failed'].includes(row.refund)).length), true);
      const item = element('div', 'studio-sla-class'); item.append(dl);
      if (done.some(row => row.state === 'missed')) item.dataset.breached = 'true';
      expressSlaEl.setAttribute('aria-busy', 'false');
      expressSlaEl.replaceChildren(done.length ? item : element('p', 'contact-note', 'No Super fast render finished in the last 7 days.'));
    }
    const listed = [...open, ...owing];
    if (!listed.length) { expressShow(expressState('No Super fast render is open. One appears here when an account orders it for a sent capture.', false)); return; }
    expressShow(...listed.map(row => expressRow(row, now)));
  }
  async function loadExpress() {
    if (!expressRowsEl) return;
    const version = ++expressVersion;
    expressSkeleton();
    if (expressSummaryEl) expressSummaryEl.textContent = 'Reading Super fast renders…';
    expressSlaEl?.setAttribute('aria-busy', 'true');
    const reply = await settled(client.rpc('studio_express_queue'));
    if (version !== expressVersion) return;
    // Before the backend has the function there are no Super fast orders to read; the band says so.
    if (reply.value?.error?.code === 'PGRST202') {
      expressRows = null;
      if (expressSummaryEl) expressSummaryEl.textContent = 'Super fast renders are not available on this server yet.';
      expressShow(expressState('Super fast renders are not recorded on this server yet.', false));
      expressSlaEl?.replaceChildren(); expressSlaEl?.setAttribute('aria-busy', 'false');
      return;
    }
    if (failed(reply) || !Array.isArray(reply.value?.data)) {
      expressRows = null;
      if (expressSummaryEl) expressSummaryEl.textContent = 'Super fast renders are unavailable.';
      expressShow(expressState('Super fast renders could not be loaded. This is a failed request, not an empty list. ', true));
      expressSlaEl?.replaceChildren(); expressSlaEl?.setAttribute('aria-busy', 'false');
      return;
    }
    expressRows = reply.value.data.filter(row => row && typeof row === 'object' && row.job_id);
    paintExpress();
  }

  /* ---- Record correction --------------------------------------------------
   * A new package the studio made for a walkthrough the account already has.
   * studio_record_tour_correction makes it that walkthrough's next version, so
   * its approval uses no second walkthrough and the link moves to it. The
   * server checks the rest: same space, the package ready and never reviewed,
   * the walkthrough named by its latest version. Recording cannot be undone, so
   * it is confirmed with both named. An identical request returns the same
   * record, so a lost answer is safe to send again.
   */
  const correctionBody = document.getElementById('studio-correction-body');
  const TOUR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TOUR_ID_PATTERN = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';
  // Offer 2026-09-25.2: "If your first walkthrough isn't listing-ready, we redo it free."
  // The redo is a correction of the account's first accepted walkthrough, once per
  // account; the server refuses it for any other walkthrough or a second time.
  const CORRECTION_REASONS = { defect: 'Studio defect', requested_change: 'Requested change', first_walkthrough_redo: 'First-walkthrough redo (our promise)' };
  const REDO_NOTE = 'First-walkthrough redo: only for the account’s first accepted walkthrough, once per account. It uses no walkthrough and keeps the same link; a new capture visit is not included.';
  const CORRECTION_LIST = 'studio-correction-walkthroughs';
  let correctionOptions = null;
  // Bumped when the form is rebuilt or the desk signs out, so a late answer writes nowhere.
  let correctionVersion = 0;

  function tourIdInput(input, name) {
    input.type = 'text'; input.name = name; input.required = true; input.maxLength = 36; input.autocomplete = 'off';
    input.spellcheck = false; input.pattern = TOUR_ID_PATTERN; input.title = 'The full tour id: 36 characters, such as 1a2b3c4d-0000-4000-8000-000000000001';
    return input;
  }
  // Released walkthroughs are offered as suggestions; any other tour id can be pasted.
  function paintCorrectionOptions() {
    if (!correctionOptions) return;
    correctionOptions.replaceChildren(...hosted.filter(row => typeof row.tour_id === 'string' && TOUR_ID.test(row.tour_id)).map(row => {
      const option = element('option');
      option.value = row.tour_id;
      option.label = (row.property_title || 'Untitled space') + ' · walkthrough ' + row.tour_id.slice(0, 8);
      return option;
    }));
  }
  // A labelled field with its note beside it, not inside the label, so the
  // control's name stays short and the note is read as its description.
  function correctionField(labelText, input, noteText, noteID) {
    const group = element('div', 'studio-field-group studio-id-field');
    const label = element('label', 'studio-inline-field', labelText);
    label.append(input);
    const note = element('p', 'studio-field-note', noteText); note.id = noteID;
    input.setAttribute('aria-describedby', noteID);
    group.append(label, note);
    return group;
  }
  function buildCorrection() {
    if (!correctionBody) return;
    correctionVersion += 1;
    const details = element('details', 'studio-set-plan studio-correction');
    details.id = 'studio-correction';
    const summary = element('summary', undefined, 'Record correction');
    const form = element('form', 'veylet-form studio-plan-form studio-correction-form');
    const packageInput = tourIdInput(document.createElement('input'), 'tour_id');
    const packageField = correctionField('New package (tour id)', packageInput,
      'The ready package, not yet reviewed by the account.', 'studio-correction-package-note');
    const walkInput = tourIdInput(document.createElement('input'), 'corrects_tour_id');
    walkInput.setAttribute('list', CORRECTION_LIST);
    const walkField = correctionField('Walkthrough it corrects (tour id of its latest version)', walkInput,
      'Released walkthroughs are suggested as you type.', 'studio-correction-walkthrough-note');
    correctionOptions = element('datalist'); correctionOptions.id = CORRECTION_LIST;
    walkField.append(correctionOptions);
    const reasons = element('fieldset', 'studio-radio-group');
    reasons.append(element('legend', undefined, 'Reason'));
    const radios = Object.entries(CORRECTION_REASONS).map(([value, words]) => {
      const label = element('label', 'studio-radio');
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'correction_reason'; input.value = value; input.required = true;
      label.append(input, element('span', undefined, words)); reasons.append(label);
      return input;
    });
    const redoNote = element('p', 'studio-field-note', REDO_NOTE); redoNote.id = 'studio-correction-redo-note';
    reasons.append(redoNote);
    radios.find(input => input.value === 'first_walkthrough_redo')?.setAttribute('aria-describedby', redoNote.id);
    const refLabel = element('label', 'studio-inline-field', 'Ticket or estimate reference');
    const refInput = document.createElement('input'); referenceInput(refInput); refInput.required = true; refInput.name = 'reference';
    refLabel.append(refInput);
    const note = element('p', 'studio-field-note', 'Both must be packages of the same space. Use an opaque reference, not a name, email or address. Nothing is charged.');
    const noteRow = element('div', 'studio-form-row'); noteRow.append(note);
    const save = element('button', 'button', 'Record correction'); save.type = 'submit';
    const result = element('span', 'studio-result'); result.setAttribute('role', 'status');
    const saveRow = element('p', 'studio-save-row'); saveRow.append(save, result);
    // Which two tours, then why and on whose record: two rows, whatever the width.
    const which = element('div', 'studio-correction-row'); which.append(packageField, walkField);
    const why = element('div', 'studio-correction-row'); why.append(reasons, refLabel);
    form.append(which, why, noteRow, saveRow);
    details.append(summary, form);
    correctionBody.replaceChildren(details);
    paintCorrectionOptions();

    const titleOf = id => {
      const row = hosted.find(item => item.tour_id === id);
      return row && row.property_title ? ' (' + row.property_title + ')' : '';
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const tourID = String(packageInput.value || '').trim().toLowerCase();
      const correctsID = String(walkInput.value || '').trim().toLowerCase();
      const reason = (radios.find(input => input.checked) || {}).value || '';
      const reference = String(refInput.value || '').trim();
      if (!TOUR_ID.test(tourID)) { result.textContent = 'Enter the new package’s full tour id (36 characters).'; packageInput.focus?.(); return; }
      if (!TOUR_ID.test(correctsID)) { result.textContent = 'Enter the full tour id of the walkthrough’s latest version (36 characters).'; walkInput.focus?.(); return; }
      if (tourID === correctsID) { result.textContent = 'The new package and the walkthrough it corrects must be different tours.'; walkInput.focus?.(); return; }
      if (!Object.prototype.hasOwnProperty.call(CORRECTION_REASONS, reason)) { result.textContent = 'Choose the reason: a studio defect, a requested change or the first-walkthrough redo.'; radios[0]?.focus?.(); return; }
      if (!REFERENCE.test(reference)) { result.textContent = 'Enter the ticket or estimate reference (' + REFERENCE_FORMAT + ').'; refInput.focus?.(); return; }
      const question = 'Record package ' + tourID.slice(0, 8) + ' as a correction of walkthrough ' + correctsID.slice(0, 8) + titleOf(correctsID) +
        '? Reason: ' + CORRECTION_REASONS[reason].toLowerCase() + '. Reference: ' + reference + '. When the account approves it, its link and embed move to package ' +
        tourID.slice(0, 8) + '. This cannot be moved to another walkthrough later.' +
        (reason === 'first_walkthrough_redo' ? ' This uses the account’s one free first-walkthrough redo.' : '');
      if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      const version = correctionVersion;
      save.disabled = true;
      result.textContent = 'Recording the correction…';
      const reply = await settled(client.rpc('studio_record_tour_correction',
        { p_tour_id: tourID, p_corrects_tour_id: correctsID, p_reason: reason, p_reference: reference }));
      if (version !== correctionVersion) return;
      save.disabled = false;
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (!answer || typeof answer !== 'object' || answer.tour_id !== tourID || answer.corrects_tour_id !== correctsID
        || !Number.isInteger(answer.revision) || answer.revision < 2 || typeof answer.walkthrough_id !== 'string') {
        // What was typed stays. Only an answer from the server is a refusal; a lost
        // one is unknown, and the same request returns the same record.
        const said = reply.value?.error;
        const why = said && typeof said.message === 'string' && said.message.trim() ? said.message.trim() : '';
        result.textContent = why ? 'Not recorded: ' + why
          : 'The correction was not confirmed. Sending the same details again is safe: an identical request returns the same record.';
        return;
      }
      const walkthrough = 'walkthrough ' + answer.walkthrough_id.slice(0, 8);
      const said = (answer.recorded === false ? 'Already recorded: ' : 'Recorded: ') + 'package ' + tourID.slice(0, 8) + ' is version ' +
        answer.revision + ' of ' + walkthrough + (answer.reason === 'first_walkthrough_redo' ? ', the account’s free first-walkthrough redo' : '') + '. ' + (answer.walkthrough_accepted === true
          ? 'Approving it uses no walkthrough from the account’s allowance.'
          : 'That walkthrough has not been accepted yet, so its first approval uses one walkthrough.');
      result.textContent = said; setStatus(said);
      packageInput.value = ''; walkInput.value = ''; refInput.value = '';
      for (const input of radios) input.checked = false;
    });
  }

  /* ---- Declared large home (older listings) -------------------------------
   * Offer 2026-09-27.1 makes one new accepted capture one walkthrough,
   * regardless of rooms. studio_set_listing_home remains only to correct an
   * older listing's retired whole-home declaration: 5 or more bedrooms, a
   * second dwelling or more than 350 m² counted as 2. It records an opaque
   * reference and audit row without rewriting historical accepted usage. The
   * answer is the listing's historical state, and the desk shows only it,
   * read-only.
   */
  const homeBody = document.getElementById('studio-home-body');
  let homeVersion = 0;
  // The historical state the server answered with: a rooms-era record when it
  // carries `rooms` and `walkthroughs_used`, otherwise the older listing's
  // retired whole-home declaration, read-only.
  function homeCount(state) {
    const locked = state.locked === true
      ? ' · locked since capture started' + (hostedDate(state.locked_at) ? ' (' + hostedDate(state.locked_at) + ')' : '') : '';
    if (Number.isInteger(state.rooms) && Number.isInteger(state.walkthroughs_used)) {
      return 'Historical accepted usage: ' + plural(state.rooms, 'room') + ' · ' + plural(state.walkthroughs_used, 'walkthrough') + locked;
    }
    if (state.walkthrough_units === 2) return 'Declared large home (older listing): ' + plural(2, 'walkthrough') + locked;
    return 'Older listing: ' + plural(state.walkthrough_units, 'walkthrough') + locked;
  }
  function buildHomeCount() {
    if (!homeBody) return;
    homeVersion += 1;
    const details = element('details', 'studio-set-plan studio-home');
    details.id = 'studio-home-count';
    const summary = element('summary', undefined, 'Correct the declared large home (older listing)');
    const form = element('form', 'veylet-form studio-plan-form studio-home-form');
    const listingInput = tourIdInput(document.createElement('input'), 'property_id');
    listingInput.title = 'The full property id: 36 characters, such as 5e6f7081-0000-4000-8000-00000000000c';
    const listingField = correctionField('Listing (property id)', listingInput,
      'The full property id from the ticket.', 'studio-home-listing-note');
    const bedroomsLabel = element('label', 'studio-inline-field', 'Bedrooms (0–99)');
    const bedroomsInput = document.createElement('input');
    bedroomsInput.type = 'number'; bedroomsInput.name = 'bedrooms'; bedroomsInput.required = true;
    bedroomsInput.min = '0'; bedroomsInput.max = '99'; bedroomsInput.step = '1'; bedroomsInput.inputMode = 'numeric';
    bedroomsLabel.append(bedroomsInput);
    const dwelling = element('fieldset', 'studio-radio-group');
    dwelling.append(element('legend', undefined, 'Second dwelling'));
    const dwellingRadios = [['yes', 'Yes'], ['no', 'No']].map(([value, words]) => {
      const label = element('label', 'studio-radio');
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'second_dwelling'; input.value = value; input.required = true;
      label.append(input, element('span', undefined, words)); dwelling.append(label);
      return input;
    });
    const areaLabel = element('label', 'studio-inline-field', 'Floor area in m² (optional)');
    const areaInput = document.createElement('input');
    areaInput.type = 'number'; areaInput.name = 'floor_area_m2'; areaInput.min = '1'; areaInput.max = '100000'; areaInput.step = '1'; areaInput.inputMode = 'numeric';
    areaLabel.append(areaInput);
    const refLabel = element('label', 'studio-inline-field', 'Ticket or estimate reference');
    const refInput = document.createElement('input'); referenceInput(refInput); refInput.required = true; refInput.name = 'reference';
    refLabel.append(refInput);
    const note = element('p', 'studio-field-note', 'For an older listing declared under the retired large-home rule only. One new accepted capture now uses one walkthrough regardless of room count. Correcting this historical declaration does not rewrite accepted usage. The server keeps the declared facts, the previous ones and an audit row. Use an opaque reference, not a name, email or address. Nothing is charged.');
    const noteRow = element('div', 'studio-form-row'); noteRow.append(note);
    const HOME_ACTION = 'Correct the declared large home (older listing)';
    const save = element('button', 'button', HOME_ACTION); save.type = 'submit';
    const result = element('span', 'studio-result'); result.setAttribute('role', 'status');
    const saveRow = element('p', 'studio-save-row'); saveRow.append(save, result);
    const facts = element('div', 'studio-correction-row'); facts.append(listingField, bedroomsLabel, dwelling, areaLabel);
    form.append(facts, refLabel, noteRow, saveRow);
    details.append(summary, form);
    homeBody.replaceChildren(details);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const propertyID = String(listingInput.value || '').trim().toLowerCase();
      const bedroomsText = String(bedroomsInput.value ?? '').trim();
      const bedrooms = Number(bedroomsText);
      const dwellingChoice = (dwellingRadios.find(input => input.checked) || {}).value || '';
      const areaText = String(areaInput.value ?? '').trim();
      const area = areaText === '' ? null : Number(areaText);
      const reference = String(refInput.value || '').trim();
      if (!TOUR_ID.test(propertyID)) { result.textContent = 'Enter the listing’s full property id (36 characters).'; listingInput.focus?.(); return; }
      if (bedroomsText === '' || !Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 99) { result.textContent = 'Enter the number of bedrooms, 0 to 99.'; bedroomsInput.focus?.(); return; }
      if (!['yes', 'no'].includes(dwellingChoice)) { result.textContent = 'Say whether there is a second dwelling.'; dwellingRadios[0]?.focus?.(); return; }
      if (area !== null && (!Number.isInteger(area) || area < 1 || area > 100000)) { result.textContent = 'Enter the floor area in whole square metres (1 to 100000), or leave it empty.'; areaInput.focus?.(); return; }
      if (!REFERENCE.test(reference)) { result.textContent = 'Enter the ticket or estimate reference (' + REFERENCE_FORMAT + ').'; refInput.focus?.(); return; }
      const second = dwellingChoice === 'yes';
      const expected = bedrooms >= HOME_BEDROOMS_FOR_TWO || second || (area !== null && area > HOME_AREA_OVER_M2) ? 2 : 1;
      const question = HOME_ACTION + ' for listing ' + propertyID.slice(0, 8) + '? Declared: ' + plural(bedrooms, 'bedroom') + ', ' +
        (second ? 'a second dwelling' : 'no second dwelling') + ', floor area ' + (area === null ? 'not given' : area + ' m²') +
        '. By the retired whole-home rule (older listings only) this counts as ' + expected + '. Reference: ' + reference +
        '. A walkthrough already accepted keeps the units it used; the server keeps an audit row.';
      if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      const version = homeVersion;
      save.disabled = true;
      result.textContent = 'Correcting the declared large home…';
      const reply = await settled(client.rpc('studio_set_listing_home', { p_property_id: propertyID, p_bedrooms: bedrooms,
        p_second_dwelling: second, p_floor_area_m2: area, p_reference: reference }));
      if (version !== homeVersion) return;
      save.disabled = false;
      const answer = failed(reply) ? null : firstRow(reply.value?.data);
      if (!answer || typeof answer !== 'object' || answer.property_id !== propertyID ||
        ![1, 2].includes(answer.walkthrough_units) || typeof answer.locked !== 'boolean') {
        // What was typed stays. Only the database's refusal is called one.
        const refused = serverRefusal(reply);
        result.textContent = refused ? 'Not corrected: ' + refused
          : 'The correction was not confirmed. Sending the same details again is safe: it sets the same facts.';
        return;
      }
      const said = 'Corrected listing ' + propertyID.slice(0, 8) + ': ' + homeCount(answer) + '.';
      result.textContent = said; setStatus(said);
      listingInput.value = ''; bedroomsInput.value = ''; areaInput.value = ''; refInput.value = '';
      for (const input of dwellingRadios) input.checked = false;
    });
  }

  async function loadAccounts() {
    const version = ++listVersion;
    loading = true;
    // A refresh is the reconcile step: the rows are read again from the server.
    uncertainIntents.clear();
    skeletonRows();
    void loadMoney();
    void loadDeletions();
    void loadExpress();
    void loadQueue();
    void loadSla();
    void loadHosted();
    const reply = await settled(client.rpc('studio_list_accounts'));
    // A newer load owns the loading flag; leave its skeleton in place.
    if (version !== listVersion) return;
    loading = false;
    if (failed(reply)) {
      accounts = [];
      unavailableRows();
      setStatus('Accounts could not be loaded. Retry, or check the studio service.');
      return;
    }
    setStatus('');
    accounts = (Array.isArray(reply.value?.data) ? reply.value.data : []).filter(row => row && row.workspace_id);
    render();
    // The queue and the express band name each job's account from this list once it has arrived.
    paintQueue();
    paintExpress();
  }

  if (!window.supabase || !window.supabase.createClient) {
    setStatus('The studio service did not load on this device. Check the connection and reload this page.');
    return;
  }
  if (!cfg || !cfg.url || !cfg.anonKey) {
    setStatus('Studio service is not configured.');
    return;
  }

  client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
  });

  statusFilter?.addEventListener('change', () => render());
  nameFilter?.addEventListener('input', () => render());
  sortButtons.activity?.addEventListener('click', () => chooseSort('activity'));
  sortButtons.trial?.addEventListener('click', () => chooseSort('trial'));
  refreshButton?.addEventListener('click', () => { void loadAccounts(); });
  let resizeTimer = null;
  window.addEventListener?.('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; syncScrollRegion(); }, 150);
  });

  async function start() {
    if (gateRetry) gateRetry.disabled = true;
    setStatus('Checking your studio access…');
    const session = await settled(client.auth.getSession());
    if (gateRetry) gateRetry.disabled = false;
    if (failed(session)) {
      setStatus('');
      showGate('Sign-in could not be checked. Check the connection, then check again.', { retry: true });
      return;
    }
    const user = session.value?.data?.session?.user || null;
    if (!user) {
      setStatus('');
      showGate('Sign in on your account page first.', { link: true, linkLabel: 'Go to the account page' });
      return;
    }
    if (whoEl) whoEl.textContent = user.email || 'signed in';
    // An unanswered membership check is unavailable, never a refusal and never
    // an approval. Nothing about this account is listed until it answers true.
    const member = await settled(client.rpc('studio_is_member'));
    if (failed(member)) {
      setStatus('');
      showGate('Studio access could not be checked. This desk lists nothing until it answers.', { retry: true });
      return;
    }
    if (member.value?.data !== true) {
      setStatus('');
      showGate('This desk is for the Veylet studio. You are signed in, but this account is not a studio member, so no account is listed.', { link: true, ask: true });
      return;
    }
    if (gate) gate.hidden = true;
    if (desk) desk.hidden = false;
    paintSortControls();
    buildCorrection();
    buildHomeCount();
    await loadAccounts();
  }

  gateRetry?.addEventListener('click', () => { void start(); });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !session) {
      accounts = [];
      listVersion += 1;
      uncertainIntents.clear();
      rowsEl?.replaceChildren();
      deletionsEl?.replaceChildren();
      moneyVersion += 1; money = [];
      moneyShow(false);
      hostedVersion += 1; hosted = [];
      hostedRowsEl?.replaceChildren();
      queueVersion += 1; slaVersion += 1; queue = null;
      queueRowsEl?.replaceChildren();
      expressVersion += 1; expressRows = null;
      expressRowsEl?.replaceChildren();
      if (expressSummaryEl) expressSummaryEl.textContent = '';
      expressSlaEl?.replaceChildren();
      if (queueSummaryEl) queueSummaryEl.textContent = '';
      slaShow(false);
      correctionVersion += 1; correctionOptions = null;
      correctionBody?.replaceChildren();
      homeVersion += 1;
      homeBody?.replaceChildren();
      setSummary('');
      if (whoEl) whoEl.textContent = '';
      showGate('Sign in on your account page first.', { link: true, linkLabel: 'Go to the account page' });
    }
  });

  await start();
})().catch(() => {
  const el = document.getElementById('studio-status');
  if (el) el.textContent = 'The studio desk could not start on this device. Check the connection and reload.';
});
