/*
 * The studio desk as the operator's day (wave 2 lane D, 27 September 2026; launch audit
 * SITE_DESK-01, -05, -17, -18, -21, LEGAL_LIFECYCLE-04, SITE_PUBLIC-04): a Rendering panel
 * (the renders switch and the weekly admission ceiling, the kill switch and the month's spend
 * against its cap, per-account Admit and Revoke, render alerts and ready-for-review jobs without
 * a verdict), a Reports panel (privacy reports first, Take down with a note, Dismiss, Delete
 * contact, and Lift), a label for every money-exception kind the SQL emits, and the waitlist
 * with Invite (the invitation is the render admission, owner default 1, 27 September 2026).
 * A function the server does not have yet (PGRST202) reads "not available on this server yet",
 * never an error page. Every answer here is a stand-in; nothing reaches Supabase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const markup = read('dist/studio/index.html');
const script = read('dist/studio.js');
const styles = read('dist/studio.css');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.open = false; this.checked = false;
    this.textContent = ''; this.value = ''; this.className = '';
    this.classList = { add: () => {}, remove: () => {} };
  }
  append(...children) { this.children.push(...children.filter(child => typeof child !== 'string')); }
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

const MISSING = { error: { code: 'PGRST202', message: 'Could not find the function public.x without parameters in the schema cache' } };
const ACCOUNTS = [
  { workspace_id: 'ws-harbour', workspace_name: 'Harbour Realty', status: 'trial', source: 'web', plan_code: 'solo' },
  { workspace_id: 'ws-wren', workspace_name: 'Wren & Fielding', status: 'active', source: 'studio', plan_code: 'solo' },
];
function controlledTimer(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }

async function load(options = {}) {
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    ids[match[2]] = new Element(match[1]);
    ids[match[2]].hidden = /\bhidden\b/.test(match[0]);
  }
  const calls = [], confirms = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'studio-user', email: 'studio@example.invalid' } } } }),
      onAuthStateChange: callback => { client.auth.callback = callback; },
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (options.rpc && Object.prototype.hasOwnProperty.call(options.rpc, name)) return options.rpc[name](args);
      if (name === 'studio_is_member') return { data: true };
      if (name === 'studio_list_accounts') return { data: ACCOUNTS.map(row => ({ ...row })) };
      if (['studio_list_deletion_requests', 'studio_money_exceptions', 'studio_capture_queue', 'studio_capture_sla',
        'studio_express_queue', 'studio_list_hosted_tours', 'studio_render_alerts', 'studio_list_walkthrough_reports',
        'studio_list_takedowns', 'studio_list_waitlist', 'studio_capture_queue_holds'].includes(name)) return { data: [] };
      if (name === 'get_render_spend_guard') return { data: guard() };
      if (name === 'studio_render_settings') return { data: settings() };
      return MISSING;
    },
  };
  const window = { VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => client } };
  const documentStub = { getElementById: id => ids[id], createElement: tag => new Element(tag), addEventListener: () => {} };
  const context = {
    window, document: documentStub, Date, URLSearchParams, setTimeout: controlledTimer, clearTimeout,
    location: { pathname: '/studio', search: '' },
    confirm: question => { confirms.push(question); return options.confirm === undefined ? true : options.confirm; },
  };
  void vm.runInNewContext(script, context);
  for (let index = 0; index < 6; index += 1) await new Promise(resolve => setImmediate(resolve));
  return {
    ids, calls, confirms, client,
    settle: async () => { for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve)); },
    control: (id, name) => ids[id].all().find(el => el.dataset.control === name),
    controls: (id, name) => ids[id].all().filter(el => el.dataset.control === name),
    textOf: id => ids[id].text(),
    called: name => calls.filter(([called]) => called === name).map(([, args]) => ({ ...args })),
  };
}
const guard = (extra = {}) => ({ kill_switch: false, monthly_cap_usd: 400, month: '2026-09-01', month_spend_usd: 123.4,
  remaining_usd: 276.6, updated_at: '2026-09-20T00:00:00Z', ...extra });
const WORKER = '0b0b0b0b-0000-4000-8000-00000000000b';
const settings = (extra = {}) => ({ renders_enabled: true, weekly_admission_ceiling: 0, worker_id: WORKER,
  default_weekly_gpu_jobs: 10, admitted_this_week: 2, waitlisted: 5, updated_at: '2026-09-20T00:00:00Z', ...extra });

/* ---- Rendering panel ---------------------------------------------------- */

test('the Rendering panel is on the desk above money exceptions, with its own regions', () => {
  assert.match(markup, /<section class="studio-rendering" id="studio-rendering" aria-labelledby="studio-rendering-title">/);
  assert.match(markup, /<h2 class="dash-heading" id="studio-rendering-title">Rendering<\/h2>/);
  for (const id of ['studio-rendering-switches', 'studio-rendering-spend', 'studio-admission-body', 'studio-alerts-body', 'studio-verdict-body']) {
    assert.match(markup, new RegExp('id="' + id + '"'), id);
  }
  assert.ok(markup.indexOf('id="studio-desk"') < markup.indexOf('id="studio-rendering"'));
  assert.ok(markup.indexOf('id="studio-rendering"') < markup.indexOf('id="studio-money"'));
  assert.match(styles, /\.studio-rendering/);
});

test('the Rendering panel reads the switch, the ceiling and the spend, and saves them through the admission setter and the kill switch', async () => {
  const h = await load({ rpc: {
    studio_set_render_admission: async args => ({ data: settings({ renders_enabled: args.p_renders_enabled, weekly_admission_ceiling: args.p_weekly_admission_ceiling }) }),
    studio_set_render_spend_guard: async args => ({ data: guard({ kill_switch: args.p_kill_switch, monthly_cap_usd: args.p_monthly_cap_usd }) }),
  } });
  const switches = h.textOf('studio-rendering-switches');
  assert.match(switches, /New renders \| On/);
  assert.match(switches, /Weekly admission ceiling \| 0 new accounts/);
  assert.match(switches, /Admitted this week \| 2/);
  assert.match(switches, /Waiting for a place \| 5/);
  const spend = h.textOf('studio-rendering-spend');
  assert.match(spend, /Kill switch \| Off/);
  assert.match(spend, /Spent this month \| US\$123\.40 of US\$400\.00/);
  assert.match(spend, /Left this month \| US\$276\.60/);
  // The ceiling: typed, confirmed, then sent with the worker and GPU cap the server answered, unchanged.
  const ceiling = h.control('studio-rendering-switches', 'admission-ceiling');
  ceiling.value = '12';
  await h.control('studio-rendering-switches', 'admission-ceiling-form').fire('submit');
  await h.settle();
  assert.deepEqual(h.called('studio_set_render_admission'), [{ p_renders_enabled: true, p_weekly_admission_ceiling: 12, p_worker_id: WORKER, p_default_weekly_gpu_jobs: 10 }]);
  assert.match(h.confirms.at(-1), /weekly admission ceiling to 12/);
  assert.match(h.textOf('studio-rendering-switches'), /Weekly admission ceiling \| 12 new accounts/);
  // The renders switch: turning new renders off keeps the ceiling it now has.
  await h.control('studio-rendering-switches', 'renders-switch').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_set_render_admission')[1], { p_renders_enabled: false, p_weekly_admission_ceiling: 12, p_worker_id: WORKER, p_default_weekly_gpu_jobs: 10 });
  assert.match(h.textOf('studio-rendering-switches'), /New renders \| Off/);
  // The kill switch: the month's cap is sent back unchanged.
  await h.control('studio-rendering-spend', 'kill-switch').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_set_render_spend_guard'), [{ p_monthly_cap_usd: 400, p_kill_switch: true }]);
  assert.match(h.confirms.at(-1), /Stop every render now/);
  assert.match(h.textOf('studio-rendering-spend'), /Kill switch \| On/);
  assert.equal(h.control('studio-rendering-spend', 'kill-switch').textContent, 'Let renders run again');
});

test('declining a Rendering change sends nothing, and a refusal says the server reason', async () => {
  const h = await load({ confirm: false });
  await h.control('studio-rendering-spend', 'kill-switch').fire('click');
  await h.control('studio-rendering-switches', 'renders-switch').fire('click');
  assert.equal(h.called('studio_set_render_spend_guard').length, 0);
  assert.equal(h.called('studio_set_render_admission').length, 0);
  const refused = await load({ rpc: { studio_set_render_spend_guard: async () => ({ error: { code: 'P0001', message: 'studio members only' } }) } });
  await refused.control('studio-rendering-spend', 'kill-switch').fire('click');
  await refused.settle();
  assert.match(refused.textOf('studio-rendering-spend'), /Not changed: studio members only/);
  assert.match(refused.textOf('studio-rendering-spend'), /Kill switch \| Off/);
});

test('Admit and Revoke name the account, are confirmed, and say what the server answered', async () => {
  const h = await load({ rpc: {
    studio_admit_workspace: async args => ({ data: { workspace_id: args.p_workspace_id, state: 'admitted', reason: null, changed: true } }),
    studio_revoke_render_admission: async args => ({ data: { workspace_id: args.p_workspace_id, state: 'revoked' } }),
  } });
  const choose = h.control('studio-admission-body', 'admission-account');
  assert.deepEqual(choose.children.map(option => option.textContent), ['Choose an account', 'Harbour Realty', 'Wren & Fielding']);
  choose.value = 'ws-harbour';
  await h.control('studio-admission-body', 'admit').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_admit_workspace'), [{ p_workspace_id: 'ws-harbour' }]);
  assert.match(h.confirms.at(-1), /Admit Harbour Realty to rendering now/);
  assert.match(h.textOf('studio-admission-body'), /Harbour Realty is admitted: its renders can start\./);
  choose.value = 'ws-wren';
  await h.control('studio-admission-body', 'revoke').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_revoke_render_admission'), [{ p_workspace_id: 'ws-wren' }]);
  assert.match(h.confirms.at(-1), /Stop rendering for Wren & Fielding/);
  assert.match(h.textOf('studio-admission-body'), /Wren & Fielding is revoked: no new render starts for it\./);
  // An admission the server could not grant says why.
  const noWorker = await load({ rpc: { studio_admit_workspace: async args => ({ data: { workspace_id: args.p_workspace_id, state: 'waitlisted', reason: 'no_worker', changed: true } }) } });
  noWorker.control('studio-admission-body', 'admission-account').value = 'ws-harbour';
  await noWorker.control('studio-admission-body', 'admit').fire('click');
  await noWorker.settle();
  assert.match(noWorker.textOf('studio-admission-body'), /Harbour Realty is still waiting: no render worker is set\./);
  // No account chosen: nothing is sent.
  const none = await load();
  await none.control('studio-admission-body', 'admit').fire('click');
  assert.equal(none.called('studio_admit_workspace').length, 0);
  assert.match(none.textOf('studio-admission-body'), /Choose the account first\./);
});

const ALERT_ROWS = () => [
  { job_id: 'aaaaaaaa-0000-4000-8000-000000000001', workspace_id: 'ws-harbour', alert: 'stale_heartbeat', status: 'processing', stage: 'train', failure_code: null, error_code: null, attempt: 1, since: new Date(Date.now() - 9 * 60000).toISOString() },
  { job_id: 'bbbbbbbb-0000-4000-8000-000000000002', workspace_id: 'ws-wren', alert: 'render_failed', status: 'failed', stage: null, failure_code: 'worker_failed', error_code: 'worker_failed', attempt: 2, since: new Date(Date.now() - 3 * 3600000).toISOString() },
  { job_id: 'cccccccc-0000-4000-8000-000000000003', workspace_id: 'ws-wren', alert: 'studio_check_due', status: 'awaiting_review', stage: null, failure_code: null, error_code: null, attempt: 1, since: new Date(Date.now() - 45 * 60000).toISOString() },
  { job_id: 'dddddddd-0000-4000-8000-000000000004', workspace_id: 'ws-harbour', alert: 'studio_check_due', status: 'awaiting_review', stage: null, failure_code: null, error_code: null, attempt: 1, since: new Date(Date.now() - 5 * 60000).toISOString() },
];

test('render alerts are listed with plain labels, and ready-for-review jobs without a verdict have their own list', async () => {
  const h = await load({ rpc: { studio_render_alerts: async () => ({ data: ALERT_ROWS() }) } });
  const alerts = h.textOf('studio-alerts-body');
  assert.match(alerts, /No heartbeat for 3 minutes/);
  assert.match(alerts, /Job aaaaaaaa/);
  assert.match(alerts, /Harbour Realty/);
  assert.match(alerts, /Render failed/);
  assert.match(alerts, /worker failed/);
  assert.doesNotMatch(alerts, /stale_heartbeat|studio_check_due|cccccccc/);
  const verdict = h.textOf('studio-verdict-body');
  assert.match(verdict, /Job cccccccc/);
  assert.match(verdict, /Over 30 min/);
  assert.match(verdict, /Job dddddddd/);
  assert.equal((verdict.match(/Over 30 min/g) || []).length, 1, 'only the job past 30 minutes is marked');
  const quiet = await load();
  assert.match(quiet.textOf('studio-alerts-body'), /No render alerts\./);
  assert.match(quiet.textOf('studio-verdict-body'), /Every finished render has its verdict\./);
  const broken = await load({ rpc: { studio_render_alerts: async () => ({ error: { message: 'offline' } }) } });
  assert.match(broken.textOf('studio-alerts-body'), /could not be loaded\. This is a failed request, not an empty list\./);
});

test('a function the server does not have yet reads "not available on this server yet", never an error page', async () => {
  const missing = async () => MISSING;
  const h = await load({ rpc: { studio_render_settings: missing, get_render_spend_guard: missing, studio_render_alerts: missing,
    studio_list_walkthrough_reports: missing, studio_list_takedowns: missing, studio_list_waitlist: missing,
    studio_list_deletion_requests: missing, studio_capture_queue_holds: missing } });
  for (const id of ['studio-rendering-switches', 'studio-rendering-spend', 'studio-alerts-body', 'studio-reports-body', 'studio-takedowns-body', 'studio-waitlist-body', 'studio-deletions']) {
    const text = h.textOf(id);
    assert.match(text, /not available on this server yet/, id);
    assert.doesNotMatch(text, /could not be loaded|failed request|Retry/, id);
  }
  // Nothing to press where the server cannot answer.
  assert.equal(h.control('studio-rendering-switches', 'renders-switch'), undefined);
  assert.equal(h.control('studio-rendering-spend', 'kill-switch'), undefined);
  // The accounts and the rest of the desk still load.
  assert.equal(h.ids['studio-rows'].children.length > 0, true);
  // A missing lift function leaves Take down working and says Lift is not there yet.
  assert.match(h.textOf('studio-takedowns-body'), /Lifting a takedown is not available on this server yet/);
});

/* ---- Reports panel ------------------------------------------------------ */

const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
const REPORTS = () => [
  { id: 7, created_at: hoursAgo(30), reason: 'misleading', details: 'The floor plan is wrong.', reporter_email: null, status: 'open', closed_at: null, token_sha256: 'a'.repeat(64), tour_id: 'tour-1', walkthrough_id: 'wt-1', space_title: 'Harbour loft', sharing_on: true },
  { id: 9, created_at: hoursAgo(2), reason: 'privacy', details: 'My family photos are visible.', reporter_email: 'tenant@example.invalid', status: 'open', closed_at: null, token_sha256: 'b'.repeat(64), tour_id: 'tour-2', walkthrough_id: 'wt-2', space_title: '12 Wren St', sharing_on: true },
  { id: 8, created_at: hoursAgo(26), reason: 'privacy', details: null, reporter_email: null, status: 'open', closed_at: null, token_sha256: 'c'.repeat(64), tour_id: null, walkthrough_id: null, space_title: null, sharing_on: false },
];

test('the Reports panel lists privacy reports first, oldest first, with how long each has been open', async () => {
  assert.match(markup, /<section class="studio-reports" id="studio-reports" aria-labelledby="studio-reports-title">/);
  assert.ok(markup.indexOf('id="studio-rendering"') < markup.indexOf('id="studio-reports"'));
  assert.ok(markup.indexOf('id="studio-reports"') < markup.indexOf('id="studio-money"'));
  const h = await load({ rpc: { studio_list_walkthrough_reports: async () => ({ data: REPORTS() }) } });
  assert.deepEqual(h.called('studio_list_walkthrough_reports'), [{ p_status: 'open' }]);
  const items = h.ids['studio-reports-body'].all().filter(el => el.className === 'studio-report');
  assert.deepEqual(items.map(item => item.dataset.report), ['8', '9', '7']);
  assert.deepEqual(items.map(item => item.dataset.reason), ['privacy', 'privacy', 'misleading']);
  assert.match(items[0].text(), /Privacy report/);
  assert.match(items[0].text(), /Open 26 h/);
  assert.match(items[0].text(), /Over 24 h/);
  assert.doesNotMatch(items[1].text(), /Over 24 h/);
  assert.match(items[1].text(), /12 Wren St/);
  assert.match(items[1].text(), /tenant@example\.invalid/);
  assert.match(items[2].text(), /Misleading/);
  assert.match(h.textOf('studio-reports-body'), /3 open · 2 privacy · oldest privacy report open 26 h/);
});

test('Take down needs a note, is confirmed, ends the links and closes that walkthrough’s reports; Dismiss and Delete contact are confirmed', async () => {
  const h = await load({ rpc: {
    studio_list_walkthrough_reports: async () => ({ data: REPORTS() }),
    studio_takedown_tour: async args => ({ data: { tour_id: args.p_tour_id, walkthrough_id: 'wt-2', links_ended: 1, reports_closed: 1, recorded_at: '2026-09-27T00:00:00Z' } }),
    studio_dismiss_walkthrough_report: async args => ({ data: { id: args.p_report_id, status: 'dismissed' } }),
    studio_delete_contact_by_email: async () => ({ data: { waitlist_deleted: 0, report_emails_cleared: 1 } }),
  } });
  const report = h.ids['studio-reports-body'].all().find(el => el.dataset.report === '9');
  const form = report.all().find(el => el.dataset.control === 'takedown-form');
  const note = report.all().find(el => el.dataset.control === 'takedown-note');
  await form.fire('submit');
  assert.equal(h.called('studio_takedown_tour').length, 0, 'no note, nothing sent');
  assert.match(report.text(), /Write a note of 1 to 500 characters/);
  note.value = 'Family photos visible in the hallway.';
  await form.fire('submit');
  await h.settle();
  assert.deepEqual(h.called('studio_takedown_tour'), [{ p_tour_id: 'tour-2', p_note: 'Family photos visible in the hallway.' }]);
  assert.match(h.confirms.at(-1), /Take down 12 Wren St/);
  assert.match(h.textOf('studio-status'), /Taken down: 12 Wren St\. 1 link ended, 1 report closed\./);
  assert.equal(h.ids['studio-reports-body'].all().some(el => el.dataset.report === '9'), false);
  // A report with no walkthrough linked offers no Take down.
  const orphan = h.ids['studio-reports-body'].all().find(el => el.dataset.report === '8');
  assert.equal(orphan.all().some(el => el.dataset.control === 'takedown-form'), false);
  assert.match(orphan.text(), /No walkthrough is linked to this report/);
  await orphan.all().find(el => el.dataset.control === 'dismiss').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_dismiss_walkthrough_report'), [{ p_report_id: 8 }]);
  assert.equal(h.ids['studio-reports-body'].all().some(el => el.dataset.report === '8'), false);
  // Delete contact names the address in its confirmation and is offered only when there is one.
  const fresh = await load({ rpc: { studio_list_walkthrough_reports: async () => ({ data: REPORTS() }), studio_delete_contact_by_email: async () => ({ data: { waitlist_deleted: 0, report_emails_cleared: 1 } }) } });
  const withEmail = fresh.ids['studio-reports-body'].all().find(el => el.dataset.report === '9');
  await withEmail.all().find(el => el.dataset.control === 'delete-contact').fire('click');
  await fresh.settle();
  assert.deepEqual(fresh.called('studio_delete_contact_by_email'), [{ p_email: 'tenant@example.invalid' }]);
  assert.match(fresh.confirms.at(-1), /tenant@example\.invalid/);
  assert.equal(fresh.ids['studio-reports-body'].all().find(el => el.dataset.report === '7').all().some(el => el.dataset.control === 'delete-contact'), false);
});

test('a taken-down walkthrough is listed until lifted, and Lift needs a note and a confirmation', async () => {
  const h = await load({ rpc: {
    studio_list_takedowns: async () => ({ data: [
      { tour_id: 'tour-2', walkthrough_id: 'wt-2', space_title: '12 Wren St', note: 'Family photos', created_at: hoursAgo(5), lifted_at: null },
      { tour_id: 'tour-3', walkthrough_id: 'wt-3', space_title: 'Old lift', note: 'x', created_at: hoursAgo(50), lifted_at: hoursAgo(40) },
    ] }),
    studio_lift_takedown: async args => ({ data: { tour_id: args.p_tour_id, lifted_at: '2026-09-27T01:00:00Z' } }),
  } });
  const body = h.textOf('studio-takedowns-body');
  assert.match(body, /12 Wren St/);
  assert.doesNotMatch(body, /Old lift/, 'a lifted takedown is not listed');
  assert.match(body, /Sharing again is refused until the takedown is lifted\./);
  const form = h.control('studio-takedowns-body', 'lift-form');
  await form.fire('submit');
  assert.equal(h.called('studio_lift_takedown').length, 0);
  h.control('studio-takedowns-body', 'lift-note').value = 'Owner removed the photos; reviewed.';
  await form.fire('submit');
  await h.settle();
  assert.deepEqual(h.called('studio_lift_takedown'), [{ p_tour_id: 'tour-2', p_note: 'Owner removed the photos; reviewed.' }]);
  assert.match(h.confirms.at(-1), /Lift the takedown of 12 Wren St/);
  assert.match(h.textOf('studio-status'), /Takedown lifted: 12 Wren St\. The office can share it again\./);
});

/* ---- Money exceptions: every kind the SQL emits has a label ------------- */

// Every kind studio_money_exceptions emits, from its latest body (release-2 draft
// 20260927101000_status_money_edges.sql in the sibling repository): pack and Super fast
// payments share duplicate_charge and mismatch, told apart by their key.
const SQL_MONEY_KINDS = ['charge_refused', 'duplicate_charge', 'mismatch', 'refunded_after_use', 'square_cancel_unconfirmed',
  'start_failed', 'start_unconfirmed', 'apple_inbox_blocked', 'apple_inbox_stuck', 'pack_intent_unresolved',
  'express_refund_failed', 'express_refund_unconfirmed', 'express_intent_unresolved', 'apple_superseded_charge',
  'apple_orphan_charge', 'start_plan_now_invoice'];
const moneyRow = (kind, extra = {}) => ({ exception_key: kind + ':1', kind, severity: 'high', workspace_id: 'ws-harbour', workspace_name: 'Harbour Realty',
  amount_cents: 2900, currency: 'AUD', occurred_at: '2026-09-26T00:00:00Z', age_minutes: 60, runbook: 'R1', reference: 'ref-1', detail: 'd', resolvable: false, ...extra });
const moneyHeads = h => h.ids['studio-money-body'].all().filter(el => el.className === 'studio-money-name').map(el => el.textContent);

test('every money-exception kind the SQL emits has its own label, and none is shown raw', async () => {
  const h = await load({ rpc: { studio_money_exceptions: async () => ({ data: SQL_MONEY_KINDS.map(kind => moneyRow(kind)) }) } });
  const heads = moneyHeads(h);
  assert.equal(heads.length, SQL_MONEY_KINDS.length);
  heads.forEach((label, index) => {
    assert.notEqual(label, SQL_MONEY_KINDS[index], SQL_MONEY_KINDS[index] + ' is shown raw');
    assert.doesNotMatch(label, /_/, label);
  });
  assert.equal(new Set(heads).size, heads.length, 'each kind reads differently');
  // A trial's monthly charge is not called annual.
  assert.doesNotMatch(heads[SQL_MONEY_KINDS.indexOf('charge_refused')], /Annual/);
  assert.doesNotMatch(heads[SQL_MONEY_KINDS.indexOf('start_failed')], /Annual/);
  // A Super fast payment charged twice is not called a pack.
  const express = await load({ rpc: { studio_money_exceptions: async () => ({ data: [
    moneyRow('duplicate_charge', { exception_key: 'express_payment:sq-1' }), moneyRow('mismatch', { exception_key: 'express_payment:sq-2' }),
    moneyRow('duplicate_charge', { exception_key: 'pack_payment:sq-3' })] }) } });
  const labels = moneyHeads(express);
  assert.match(labels[0], /Super fast/); assert.match(labels[1], /Super fast/); assert.match(labels[2], /Pack/);
});

test('a start-today invoice request is completed from its money row with the three references', async () => {
  const row = moneyRow('start_plan_now_invoice', { exception_key: 'start_plan_now_invoice:5e5e5e5e-0000-4000-8000-000000000005', reference: '5e5e5e5e-0000-4000-8000-000000000005', runbook: 'R12', severity: 'medium', amount_cents: 9900 });
  const h = await load({ rpc: { studio_money_exceptions: async () => ({ data: [row] }),
    studio_complete_start_plan_now: async () => ({ data: { started: { state: 'started' } } }) } });
  const form = h.control('studio-money-body', 'start-now-form');
  assert.ok(form, 'the row has its own completion form');
  await form.fire('submit');
  assert.equal(h.called('studio_complete_start_plan_now').length, 0, 'references first');
  for (const [name, value] of [['agreement_id', 'AGR-7'], ['settlement_id', 'INV-7-1'], ['receipt_key', 'RCPT-7']]) {
    form.all().find(el => el.name === name).value = value;
  }
  await form.fire('submit');
  await h.settle();
  assert.deepEqual(h.called('studio_complete_start_plan_now'), [{ p_attempt_id: '5e5e5e5e-0000-4000-8000-000000000005', p_agreement_id: 'AGR-7', p_settlement_id: 'INV-7-1', p_receipt_key: 'RCPT-7' }]);
  assert.match(h.confirms.at(-1), /Harbour Realty/);
  assert.match(h.textOf('studio-status'), /Plan started today for Harbour Realty/);
});

/* ---- Waitlist: Invite is the render admission ----------------------------- */

test('the waitlist lists who is waiting, oldest first, and Invite records the invitation that admits them', async () => {
  assert.match(markup, /<section class="studio-waitlist" id="studio-waitlist" aria-labelledby="studio-waitlist-title">/);
  const rows = [
    { id: 3, created_at: '2026-09-20T00:00:00Z', name: 'Priya', email: 'priya@example.invalid', business_type: 'agency', device: 'iphone', region: 'QLD', channels: [], consent_tips: false, submissions: 1, invited_at: null, declined_at: null },
    { id: 4, created_at: '2026-09-21T00:00:00Z', name: 'Sam', email: 'sam@example.invalid', business_type: 'solo', device: 'iphone', region: 'NSW', channels: [], consent_tips: false, submissions: 1, invited_at: '2026-09-22T00:00:00Z', declined_at: null },
  ];
  const h = await load({ rpc: { studio_list_waitlist: async () => ({ data: rows }),
    studio_set_waitlist_outcome: async args => ({ data: { id: args.p_id, outcome: args.p_outcome, at: '2026-09-27T00:00:00Z' } }) } });
  const body = h.textOf('studio-waitlist-body');
  assert.match(body, /1 waiting · 1 invited/);
  assert.match(body, /priya@example\.invalid/);
  assert.equal(h.controls('studio-waitlist-body', 'invite').length, 1, 'only someone still waiting can be invited');
  await h.control('studio-waitlist-body', 'invite').fire('click');
  await h.settle();
  assert.deepEqual(h.called('studio_set_waitlist_outcome'), [{ p_id: 3, p_outcome: 'invited' }]);
  assert.match(h.confirms.at(-1), /Invite priya@example\.invalid/);
  assert.match(h.confirms.at(-1), /admitted to rendering/);
  assert.match(h.textOf('studio-waitlist-body'), /0 waiting · 2 invited/);
  // The desk says honestly that it sends no email.
  assert.match(markup.slice(markup.indexOf('id="studio-waitlist"'), markup.indexOf('id="studio-waitlist-body"')), /sends no email/);
});

/* ---- Deletions and the queue ---------------------------------------------- */

test('deletion requests show their 30-day due date, overdue first', async () => {
  const day = 86400000;
  const rows = [
    { user_id: 'u-new', requested_at: new Date(Date.now() - 2 * day).toISOString(), status: 'requested', workspace_names: ['New Co'] },
    { user_id: 'u-old', requested_at: new Date(Date.now() - 31 * day).toISOString(), status: 'requested', workspace_names: ['Old Co'] },
    { user_id: 'u-near', requested_at: new Date(Date.now() - 26 * day).toISOString(), status: 'processing', workspace_names: ['Near Co'] },
  ];
  const h = await load({ rpc: { studio_list_deletion_requests: async () => ({ data: rows }) } });
  const names = h.ids['studio-deletions'].all().filter(el => el.className === 'studio-deletion-name').map(el => el.textContent);
  assert.deepEqual(names, ['Old Co', 'Near Co', 'New Co']);
  const text = h.textOf('studio-deletions');
  assert.match(text, /Due \| [^|]+ · overdue/);
  assert.match(text, /Due \| [^|]+ · due within 7 days/);
});

test('the capture queue says why a held job waits', async () => {
  const job = { job_id: 'eeeeeeee-0000-4000-8000-000000000005', workspace_id: 'ws-harbour', status: 'queued', queue_position: 1, priority: 'standard',
    queued_at: '2026-09-27T00:00:00Z', elapsed_hours: 3, sla_due_at: '2026-09-28T00:00:00Z', sla_state: 'open', sla_hours: 24 };
  const h = await load({ rpc: { studio_capture_queue: async () => ({ data: [job] }),
    studio_capture_queue_holds: async () => ({ data: [{ job_id: job.job_id, hold: { reason: 'admission', until: null }, eligible: false, sla_state: 'held' }] }) } });
  const text = h.ids['studio-queue-rows'].text();
  assert.match(text, /Held: waiting for admission/);
  assert.match(text, /Held/);
  assert.doesNotMatch(text, /On time/, 'a held job’s clock is not on time');
});
