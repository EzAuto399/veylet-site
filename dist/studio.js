'use strict';
/*
 * Veylet studio desk: the accounts we look after, their free months, and the
 * walkthroughs waiting on us. Everything here is a read except one deliberate
 * write, studio_set_plan, which records a decision the account has already
 * agreed to. No payment is taken on this website, and an unanswered check is
 * reported as unavailable — never as "not a member" and never as approved.
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
  const PLAN_MONTH_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  // One vocabulary. These are the same short state words the app and the account
  // desk put in their State row; the Status cell keeps the full title and date.
  const STATUS_CHOICES = { pending: 'Not started', trial: 'Free months', active: 'Active', ended: 'Ended' };
  // Where the money is arranged decides which price is true for this account.
  // An App Store subscription belongs to Apple, so this desk may not move it.
  const PLAN_SOURCES = ['studio', 'apple', 'web'];
  const SOURCE_CHOICES = { studio: 'Studio', web: 'Website', apple: 'App Store' };
  // Plan code to the name customers see; plan code 'studio' is the Team plan.
  // The account desk states the same names from the same table.
  const PLAN_NAMES = { solo: 'Solo', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  const PLAN_CODES = PLAN_NAMES;
  // App Store product to plan and cadence, as offer.json lists the product IDs.
  const APPLE_PRODUCTS = { 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] };
  // Offer 2026-09-23.4 invoice totals in cents, by plan and period. Annual is twelve
  // months for the price of eleven; the founding rate is invoiced monthly only.
  const INVOICE_CENTS = { solo: { monthly: 9900, annual: 108900 }, studio: { monthly: 24900, annual: 273900 },
    founding: { monthly: 21900 }, office: { monthly: 74900, annual: 823900 }, one: { once: 19900 } };
  const INCLUDED_PER_MONTH = { solo: 1, studio: 3, founding: 3, office: 10 };
  const TRIAL_INCLUDED_MAX = 24;

  let client = null;
  let accounts = [];
  let loading = true;
  let listVersion = 0;
  let sortKey = 'activity';
  let sortDirection = 'desc';
  const openForms = new Set();

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

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  function countText(value) {
    if (value === null || value === undefined || value === '') return DASH;
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : DASH;
  }
  function planMonths(value) {
    const months = Number(value);
    return Number.isInteger(months) && months >= 1 && months <= 12 ? PLAN_MONTH_WORDS[months] : String(value ?? '');
  }
  /** Integer cents, written the way the invoice would: A$99, or A$99.50. */
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
  function planExtraPrice(row) {
    return planMoney(planSource(row) === 'apple' ? row.app_extra_walkthrough_aud_cents : row && row.extra_walkthrough_aud_cents);
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
        body: 'Review the available plan. Eligible subscribers can start with ' + months + ' free months and ' + included + ' walkthroughs in total.' } : unavailable;
    }
    if (status === 'trial') {
      const until = planDate(row.trial_ends_at);
      const billing = planBilling(row);
      const used = countText(row.accepted_in_free_months);
      const allowance = countText(row.trial_included_walkthroughs);
      if (!until || used === DASH || allowance === DASH) return unavailable;
      const renewal = row.auto_renews === false
        ? 'It ends on ' + until + ' and will not renew.'
        : row.auto_renews !== true ? 'Check your renewal setting with your billing provider.'
          : billing ? 'Renews on ' + until + ' at ' + billing + ' unless you cancel.'
            : 'Confirm the renewal amount and billing period with your billing provider before the free months end.';
      return { status, title: 'Free until ' + until,
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
          (planInterval(row) === 'annual' ? ' Billed annually; the walkthrough allowance resets monthly.' : '') };
    }
    if (status === 'ended') {
      const afterPlan = row.current_period_ends_at !== null && row.current_period_ends_at !== undefined;
      const ended = planDate(afterPlan ? row.current_period_ends_at : row.trial_ends_at);
      return ended ? { status, title: (afterPlan ? 'Plan ended ' : 'Free months ended ') + ended,
        body: 'Your released walkthroughs stay hosted for twelve months after their release. Ask about restarting the plan; a second free trial is not guaranteed.' } : unavailable;
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
    const freeCell = cell(row, 'Free walkthroughs', 'studio-figure');
    const freeUsed = element('span');
    const freeOwed = element('span', 'studio-sub');
    freeCell.append(freeUsed, freeOwed);
    const monthCell = cell(row, 'This month', 'studio-figure');
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
    const planLabel = element('label', 'studio-inline-field', 'Plan');
    const planSelect = document.createElement('select');
    for (const value of Object.keys(PLAN_CODES)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = PLAN_CODES[value];
      planSelect.append(option);
    }
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
    const warning = element('p', 'studio-warning', 'This form sets or ends studio free months. Paid service requires the settled invoice form below. App Store and card subscriptions remain with their billing provider. Studio invoices do not renew automatically.');
    form.append(fieldset, sourceLabel, planLabel, monthsLabel, includedLabel, startLabel, renewLabel, noteLabel, warning, saveRow);
    const invoice = element('form', 'veylet-form studio-plan-form studio-invoice-form');
    const invoiceHeading = element('h3', undefined, 'Record a settled invoice');
    const invoiceNotice = element('p', 'studio-warning');
    const invoiceFields = {};
    function invoiceField(key, title, type, choices) {
      const label = element('label', 'studio-inline-field', title);
      const input = document.createElement(choices ? 'select' : 'input');
      input.name = key; input.required = true;
      if (choices) for (const [value, text] of choices) {
        const option = element('option', undefined, text); option.value = value; input.append(option);
      } else input.type = type;
      if (type === 'text') { input.maxLength = 160; input.pattern = '[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}'; input.autocomplete = 'off'; }
      label.append(input); invoiceFields[key] = input; invoice.append(label); return input;
    }
    invoice.append(invoiceHeading, invoiceNotice);
    const invoicePlan = invoiceField('plan_code', 'Invoiced plan', null, Object.entries(PLAN_CODES));
    const invoiceInterval = invoiceField('billing_interval', 'Paid service period', null,
      [['monthly', 'One month'], ['annual', 'One year'], ['once', 'One walkthrough']]);
    const invoiceStart = invoiceField('period_start', 'Service starts (UTC date)', 'date');
    const invoiceEnd = invoiceField('period_end', 'Service ends (UTC date)', 'date');
    invoiceField('agreement_id', 'Written agreement reference', 'text');
    invoiceField('settlement_id', 'Settled invoice line reference', 'text');
    invoiceField('receipt_key', 'Unique receipt reference (keep the same when retrying)', 'text');
    const invoiceTerms = element('p', 'studio-warning');
    invoice.append(invoiceTerms, element('p', 'studio-field-note', 'Use opaque references only, not names, emails, addresses or payment details. Verify the agreement and settled invoice outside this desk. No payment is collected here.'));
    const invoiceSave = element('button', 'button', 'Record paid service'); invoiceSave.type = 'submit';
    const invoiceResult = element('span', 'studio-result'); invoiceResult.setAttribute('role', 'status');
    const invoiceSaveRow = element('p', 'studio-save-row'); invoiceSaveRow.append(invoiceSave, invoiceResult); invoice.append(invoiceSaveRow);
    let uncertainInvoiceArgs = null;
    function invoiceAmount() {
      const periods = Object.prototype.hasOwnProperty.call(INVOICE_CENTS, invoicePlan.value) ? INVOICE_CENTS[invoicePlan.value] : null;
      return periods && Object.prototype.hasOwnProperty.call(periods, invoiceInterval.value) ? periods[invoiceInterval.value] : null;
    }
    function paintInvoiceTerms() {
      const one = invoicePlan.value === 'one';
      if (one) invoiceInterval.value = 'once';
      else if (invoiceInterval.value === 'once' || invoicePlan.value === 'founding') invoiceInterval.value = 'monthly';
      invoiceEnd.readOnly = !one;
      const start = new Date(String(invoiceStart.value || '') + 'T00:00:00Z');
      if (!one && !Number.isNaN(start.getTime())) {
        const month = start.getUTCMonth() + (invoiceInterval.value === 'annual' ? 12 : 1);
        const last = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate();
        invoiceEnd.value = new Date(Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), last))).toISOString().slice(0, 10);
      } else if (!one) invoiceEnd.value = '';
      const quota = one ? 'One walkthrough in the stated period; no monthly reset.' :
        invoicePlan.value === 'founding' ? '3 walkthroughs per monthly anniversary. Founding rate, invoiced monthly only.' :
        (INCLUDED_PER_MONTH[invoicePlan.value] === 1 ? '1 walkthrough' : INCLUDED_PER_MONTH[invoicePlan.value] + ' walkthroughs') +
          ' per monthly anniversary, including annual billing.';
      invoiceTerms.textContent = planMoney(invoiceAmount()) + ' for this invoice. ' + quota + ' No automatic renewal.';
    }
    invoicePlan.value = 'studio'; invoiceInterval.value = 'monthly';
    for (const field of [invoicePlan, invoiceInterval, invoiceStart]) field.addEventListener('change', paintInvoiceTerms);
    paintInvoiceTerms();
    function invoiceBlocked(current) {
      if (planSource(current) !== 'studio') return 'This account is managed by its billing provider. This desk cannot replace that subscription.';
      if (moment(current.trial_ends_at) > Date.now()) return 'The free months are still running. An early paid switch is not available; agree and settle extras separately.';
      if (moment(current.current_period_ends_at) > Date.now()) return 'This account already has a current paid service period. A new invoice must start after that period and cannot be recorded in advance.';
      return '';
    }
    invoice.addEventListener('submit', async event => {
      event.preventDefault(); if (invoiceSave.disabled) return;
      const current = accounts.find(item => item.workspace_id === workspaceID) || account;
      const blocked = invoiceBlocked(current);
      if (blocked) { invoiceResult.textContent = blocked; return; }
      const code = invoicePlan.value, interval = invoiceInterval.value;
      if (!((['solo', 'studio', 'office'].includes(code) && ['monthly', 'annual'].includes(interval)) || (code === 'one' && interval === 'once')
        || (code === 'founding' && interval === 'monthly'))) {
        invoiceResult.textContent = 'Choose a billing period that matches the invoiced plan.'; return;
      }
      const start = new Date(String(invoiceStart.value || '') + 'T00:00:00Z');
      const end = new Date(String(invoiceEnd.value || '') + 'T00:00:00Z');
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > Date.now() || end.getTime() <= Date.now() || end <= start) {
        invoiceResult.textContent = 'Enter the current agreed service dates in UTC. The start cannot be in the future and the end must be in the future.'; return;
      }
      const args = { p_workspace_id: workspaceID, p_plan_code: code, p_billing_interval: interval,
        p_period_start: start.toISOString(), p_period_end: end.toISOString() };
      for (const key of ['agreement_id', 'settlement_id', 'receipt_key']) {
        const value = String(invoiceFields[key].value || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(value)) {
          invoiceResult.textContent = 'Enter all three opaque evidence references (3–160 letters, numbers or . _ : / -).'; return;
        }
        args['p_' + key] = value;
      }
      if (uncertainInvoiceArgs && JSON.stringify(args) !== JSON.stringify(uncertainInvoiceArgs)) {
        invoiceResult.textContent = 'The previous result is unconfirmed. Restore the same terms and receipt reference to retry, or refresh and reconcile the recorded invoice before changing them.'; return;
      }
      const question = 'Record ' + planMoney(invoiceAmount()) + ' already settled for ' + (current.workspace_name || 'this account') +
        ', ' + PLAN_CODES[code] + ', ' + invoiceStart.value + ' to ' + invoiceEnd.value + ' UTC? Confirm the written agreement and invoice payment match. No card is charged and no automatic renewal is started.';
      if (typeof confirm !== 'function' || !confirm(question)) { invoiceResult.textContent = 'Left unchanged.'; return; }
      const version = listVersion; invoiceSave.disabled = true;
      invoiceResult.textContent = 'Recording agreed and settled service…';
      uncertainInvoiceArgs = args;
      const reply = await settled(client.rpc('studio_activate_invoice_plan', args));
      if (version !== listVersion) return;
      const updated = failed(reply) ? null : firstRow(reply.value?.data);
      invoiceSave.disabled = false;
      if (!updated || updated.workspace_id !== workspaceID || updated.source !== 'studio' || updated.status !== 'active' ||
        updated.plan_code !== code || updated.billing_interval !== interval || updated.renewal_price_aud_cents !== invoiceAmount()) {
        invoiceResult.textContent = 'Paid service was not confirmed. Keep these terms and receipt reference unchanged. Refresh and check the account before retrying; no second invoice should be collected.'; return;
      }
      uncertainInvoiceArgs = null;
      const merged = { ...current, ...updated };
      const index = accounts.findIndex(item => item.workspace_id === workspaceID);
      if (index >= 0) accounts[index] = merged;
      paint(merged); setSummary(summaryText());
      invoiceResult.textContent = 'Recorded: ' + planBilling(merged) + ', ending ' + planDate(merged.current_period_ends_at) + '. No automatic renewal.';
    });
    details.append(summary, form, invoice);
    planCell.append(details);

    function paint(next) {
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
      trialCell.textContent = from || until ? (from || DASH) + ' → ' + (until || DASH) : 'not started';
      freeUsed.textContent = countText(next.accepted_in_free_months) + ' / ' + countText(next.trial_included_walkthroughs);
      freeOwed.textContent = count(next.extras_in_free_months) > 0
        ? count(next.extras_in_free_months) + ' beyond included; check agreed billing' : '';
      monthCell.textContent = countText(next.accepted_this_period) + ' / ' + countText(next.included_per_month);
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
      for (const input of radios) { input.checked = next.status === input.value; input.disabled = source !== 'studio' || input.value === 'active'; }
      const months = Number(next.trial_months);
      monthsInput.value = String(Number.isInteger(months) && months >= 1 && months <= 12 ? months : 6);
      const included = Number(next.trial_included_walkthroughs);
      includedInput.value = String(Number.isInteger(included) && included >= 1 && included <= TRIAL_INCLUDED_MAX ? included : 4);
      sourceSelect.value = source || 'studio';
      sourceSelect.disabled = true;
      sourceNote.hidden = source !== 'apple';
      planSelect.value = Object.prototype.hasOwnProperty.call(PLAN_CODES, next.plan_code) ? next.plan_code : 'studio';
      renewInput.checked = false; renewInput.disabled = true;
      for (const input of [planSelect, monthsInput, includedInput, startInput, noteInput, save]) input.disabled = source !== 'studio';
      const blocked = invoiceBlocked(next);
      invoiceNotice.textContent = blocked || 'Record only a current service period that the customer has agreed to in writing and already paid. The server verifies the plan, amount, dates and unique references.';
      for (const input of [...Object.values(invoiceFields), invoiceSave]) input.disabled = Boolean(blocked);
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const current = accounts.find(item => item.workspace_id === workspaceID) || account;
      if (planSource(current) !== 'studio') { result.textContent = 'This subscription is managed by its billing provider.'; return; }
      const chosen = radios.find(input => input.checked)?.value;
      if (chosen === 'active') { result.textContent = 'Use Record a settled invoice below. A status change cannot activate paid service.'; return; }
      if (!chosen || !PLAN_STATUSES.includes(chosen)) {
        result.textContent = 'Choose a status before saving.';
        return;
      }
      const name = current.workspace_name || 'this account';
      if (chosen === 'ended') {
        const question = 'End studio service for ' + name + '? New walkthrough acceptance will pause. Existing released walkthroughs keep their agreed hosting. This does not issue a refund.';
        if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      }
      const args = { p_workspace_id: workspaceID, p_status: chosen };
      const months = Number(monthsInput.value);
      if (Number.isInteger(months) && months >= 1 && months <= 12) args.p_trial_months = months;
      const included = Number(includedInput.value);
      if (Number.isInteger(included) && included >= 1 && included <= TRIAL_INCLUDED_MAX) args.p_trial_included = included;
      // The App Store owns an Apple subscription's source; the desk never
      // rewrites it, and never claims a plan it did not sell.
      if (!sourceSelect.disabled && PLAN_SOURCES.includes(sourceSelect.value)) args.p_source = sourceSelect.value;
      if (Object.prototype.hasOwnProperty.call(PLAN_CODES, planSelect.value)) args.p_plan_code = planSelect.value;
      args.p_auto_renews = false;
      const started = String(startInput.value || '').trim();
      if (started) args.p_trial_started_at = started;
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
   * Released walkthroughs and their hosting terms, due soon first. The one
   * write is studio_record_hosting_extension, which the server lets move a
   * date later only and records with an audit row. Nothing here switches
   * sharing off, and a failed lookup is never shown as an empty list.
   */
  const hostedRowsEl = document.getElementById('studio-hosted-rows');
  const hostedTable = document.getElementById('studio-hosted-table');
  const HOSTED_COLUMNS = 6;
  const DUE_SOON_MS = 60 * 86400000;
  const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
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
  function hostedDue(row, now = Date.now()) {
    const until = moment(row.hosted_until);
    return until !== null && !['trial', 'active'].includes(row.plan_status) && until - now <= DUE_SOON_MS;
  }
  function hostedOrder(rows) {
    const now = Date.now();
    const end = row => moment(row.hosted_until) ?? Number.MAX_SAFE_INTEGER;
    return [...rows].sort((left, right) => (hostedDue(right, now) - hostedDue(left, now)) || (end(left) - end(right)) ||
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
    const badge = element('span', 'pill pill-busy studio-due', 'Due soon');
    nameCell.append(nameText, idText, badge); row.append(nameCell);
    const sharingCell = cell(row, 'Sharing');
    const releasedCell = cell(row, 'Released', 'studio-figure');
    const guaranteedCell = cell(row, 'Guaranteed until', 'studio-figure');
    const extendedCell = cell(row, 'Extended until', 'studio-figure');
    const planCell = cell(row, 'Plan');

    const formRow = element('tr', 'studio-plan-row');
    const formCell = element('td'); formCell.setAttribute('colspan', String(HOSTED_COLUMNS)); formRow.append(formCell);
    const details = element('details', 'studio-set-plan studio-extension');
    details.open = openExtensions.has(tourID);
    details.addEventListener('toggle', () => { if (details.open) openExtensions.add(tourID); else openExtensions.delete(tourID); });
    const summary = element('summary');
    const form = element('form', 'veylet-form studio-plan-form studio-extension-form');
    const dateLabel = element('label', 'studio-inline-field', 'New hosting end (Brisbane date)');
    const dateInput = document.createElement('input'); dateInput.type = 'date'; dateInput.required = true; dateInput.name = 'extended_until';
    dateLabel.append(dateInput);
    const refLabel = element('label', 'studio-inline-field', 'Agreement or invoice reference');
    const refInput = document.createElement('input'); refInput.type = 'text'; refInput.required = true; refInput.name = 'reference';
    refInput.maxLength = 160; refInput.autocomplete = 'off'; refInput.pattern = '[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}';
    refLabel.append(refInput);
    const note = element('p', 'studio-field-note studio-extension-note', 'Use an opaque reference, not a name, email or payment detail. An extension can only move the date later; the server keeps an audit row. No payment is taken here.');
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
      guaranteedCell.textContent = hostedDate(next.guaranteed_until) || DASH;
      extendedCell.textContent = hostedDate(next.extended_until) || DASH;
      planCell.textContent = STATUS_CHOICES[next.plan_status] || DASH;
      summary.textContent = 'Record extension · ' + title;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const day = String(dateInput.value || '').trim();
      const reference = String(refInput.value || '').trim();
      // The start of that day in Brisbane, so the desk prints back the date typed.
      const until = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T00:00:00+10:00') : null;
      if (!until || Number.isNaN(until.getTime())) { result.textContent = 'Enter the agreed new end date.'; return; }
      const hostedUntil = moment(current.hosted_until);
      if (hostedUntil !== null && until.getTime() <= hostedUntil) {
        result.textContent = 'Choose a date after ' + hostedDate(current.hosted_until) + '. An extension can only move the date later.'; return;
      }
      if (!REFERENCE.test(reference)) { result.textContent = 'Enter the agreement or invoice reference (3–160 letters, numbers or . _ : / -).'; return; }
      const title = current.property_title || 'this walkthrough';
      const question = 'Extend hosting for ' + title + ' to ' + hostedDate(until.toISOString()) + ' (reference ' + reference + ')? The date can only move later. No payment is taken here.';
      if (typeof confirm !== 'function' || !confirm(question)) { result.textContent = 'Left unchanged.'; return; }
      const version = hostedVersion;
      save.disabled = true;
      result.textContent = 'Recording the extension…';
      const reply = await settled(client.rpc('studio_record_hosting_extension',
        { p_tour_id: tourID, p_extended_until: until.toISOString(), p_reference: reference }));
      if (version !== hostedVersion) return;
      save.disabled = false;
      const updated = failed(reply) ? null : firstRow(reply.value?.data);
      if (!updated || updated.tour_id !== tourID || moment(updated.hosted_until) === null) {
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
      const said = 'Recorded: ' + title + ' hosted until ' + hostedDate(merged.hosted_until) + '.';
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
    if (!hosted.length) { hostedState('No released walkthroughs yet.', false); return; }
    hostedTable?.setAttribute('aria-busy', 'false');
    hostedRowsEl.replaceChildren(...hostedOrder(hosted).flatMap(buildHosted));
  }

  async function loadAccounts() {
    const version = ++listVersion;
    loading = true;
    skeletonRows();
    void loadDeletions();
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
    await loadAccounts();
  }

  gateRetry?.addEventListener('click', () => { void start(); });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !session) {
      accounts = [];
      listVersion += 1;
      rowsEl?.replaceChildren();
      deletionsEl?.replaceChildren();
      hostedVersion += 1; hosted = [];
      hostedRowsEl?.replaceChildren();
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
