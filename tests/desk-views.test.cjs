/*
 * The desk as views: a bar with Walkthroughs, Plan, Your team and the account menu;
 * one view shown at a time, chosen by the URL hash; a Needs you list above the
 * walkthroughs; the plan in one line; and "Restart your plan" landing where that
 * walkthrough's office plan can be restarted. Layout is proven in the browser runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDesk } = require('./desk-fake.cjs');

const dist = path.join(__dirname, '../dist');
const markup = fs.readFileSync(path.join(dist, 'account/index.html'), 'utf8');
const css = fs.readFileSync(path.join(dist, 'account-guide.css'), 'utf8');
const VIEW_IDS = ['view-walkthroughs', 'view-plan', 'view-team', 'view-account'];
const shownViews = h => VIEW_IDS.filter(id => !h.ids[id].hidden);
const TOKEN = 'a'.repeat(43);
const planRow = { status: 'trial', trial_ends_at: '2027-01-01T00:00:00Z', trial_months: 3, trial_included_walkthroughs: 3, accepted_in_free_months: 2,
  auto_renews: true, source: 'studio', billing_interval: 'monthly', price_aud_cents: 9900, hosting_included: true };

test('nothing of the sign-in form or the desk paints until the session check answers', async () => {
  assert.match(markup, /<body class="session-checking">/);
  assert.match(css, /\.session-checking #main > \* \{ display: none; \}/);
  assert.match(css, /\.session-checking #main > #account-opening,\s*\.session-checking #main > #account-status \{ display: block; \}/);
  assert.match(markup, /<p id="account-opening" class="contact-note desk-opening">Opening your desk…<\/p>/);
  // Without a script the heading and the routes that still work are shown, never the waiting line.
  assert.match(markup, /<noscript><style>#account-sign-in, #account-verify, #account-opening \{ display: none !important; \}/);
  const signedIn = await loadDesk();
  assert.equal(signedIn.ids['account-opening'].hidden, true);
  assert.equal(signedIn.ids['account-sign-in'].hidden, true);
  assert.equal(signedIn.ids['account-home'].hidden, false);
  const signedOut = await loadDesk({ signedOut: true });
  assert.equal(signedOut.ids['account-opening'].hidden, true);
  assert.equal(signedOut.ids['account-sign-in'].hidden, false, 'auth is unchanged: signed out still gets the form');
  assert.equal(signedOut.ids['account-home'].hidden, true);
});

test('signed in, the desk bar replaces the marketing header; signed out, it is the other way round', async () => {
  const h = await loadDesk();
  assert.equal(h.ids['desk-bar'].hidden, false);
  assert.equal(h.ids['site-header'].hidden, true);
  assert.equal(h.ids['desk-footer'].hidden, false);
  assert.equal(h.ids['account-title'].hidden, true, 'each view has its own heading');
  assert.equal(h.ids['desk-menu-who'].textContent, 'owner@example.invalid');
  const out = await loadDesk({ signedOut: true });
  assert.equal(out.ids['desk-bar'].hidden, true);
  assert.equal(out.ids['site-header'].hidden, false);
  assert.equal(out.ids['desk-footer'].hidden, true);
  assert.equal(out.ids['account-title'].hidden, false);
  // The bar's views and the menu are links and buttons in the page, not hover menus.
  assert.match(markup, /<a href="#walkthroughs" id="desk-link-walkthroughs" aria-current="page">Walkthroughs<\/a><a href="#plan" id="desk-link-plan">Plan<\/a><a href="#team" id="desk-link-team">Your team<\/a><a href="\/help" id="desk-link-help">Help<\/a>/);
  assert.match(markup, /<a href="#account" id="desk-link-account">Account<\/a>\s*<button type="button" id="desk-menu-sign-out">Sign out<\/button>/);
});

test('the hash chooses the view: Walkthroughs by default, the named one on load, and focus on its heading when it changes', async () => {
  const h = await loadDesk();
  assert.deepEqual(shownViews(h), ['view-walkthroughs']);
  assert.equal(h.ids['desk-link-walkthroughs'].getAttribute('aria-current'), 'page');
  // A reload at #plan opens Plan; nothing steals focus on load.
  const plan = await loadDesk({ hash: '#plan' });
  assert.deepEqual(shownViews(plan), ['view-plan']);
  assert.equal(plan.ids['desk-link-plan'].getAttribute('aria-current'), 'page');
  assert.equal(plan.ids['desk-link-walkthroughs'].getAttribute('aria-current'), null);
  assert.equal(plan.ids['account-plan-title'].wasFocused, undefined);
  // Back, Forward or a link: the hash changes and the view follows, heading focused.
  plan.location.hash = '#account'; plan.windowEvents.hashchange();
  assert.deepEqual(shownViews(plan), ['view-account']);
  assert.equal(plan.ids['account-self-title'].wasFocused, true);
  plan.location.hash = '#team'; plan.windowEvents.hashchange();
  assert.deepEqual(shownViews(plan), ['view-team']);
  plan.location.hash = ''; plan.windowEvents.hashchange();
  assert.deepEqual(shownViews(plan), ['view-walkthroughs']);
  assert.equal(plan.ids['account-work-title'].wasFocused, true);
  // An address this page does not know leaves the view alone.
  plan.location.hash = '#access_token=zzz'; plan.windowEvents.hashchange();
  assert.deepEqual(shownViews(plan), ['view-walkthroughs']);
});

test('anchors from the one-page desk still land on their control, in its view', async () => {
  const leaving = await loadDesk({ hash: '#account-leaving' });
  assert.deepEqual(shownViews(leaving), ['view-account']);
  assert.equal(leaving.ids['account-leaving'].open, true, 'the disclosure asked for by name is open');
  const plan = await loadDesk({ hash: '#account-packs' });
  assert.deepEqual(shownViews(plan), ['view-plan']);
  assert.equal(plan.ids['account-packs'].wasFocused, true);
  const team = await loadDesk({ hash: '#account-team' });
  assert.deepEqual(shownViews(team), ['view-team']);
});

test('Add a space is a button in the page head that opens the same form', async () => {
  const h = await loadDesk();
  assert.equal(h.ids['account-add-space'].open, false);
  assert.equal(h.ids['account-add-open'].getAttribute('aria-expanded'), 'false');
  await h.ids['account-add-open'].fire('click');
  assert.equal(h.ids['account-add-space'].open, true);
  assert.equal(h.ids['account-add-open'].getAttribute('aria-expanded'), 'true');
  await h.ids['account-add-open'].fire('click');
  assert.equal(h.ids['account-add-space'].open, false);
});

test('Needs you lists what waits on the reader, one action each, only the first filled, the rest behind "n more"', async () => {
  const tours = ['t1', 't2', 't3', 't4', 't5'].map((id, index) => ({ id, property_id: 'p' + (index + 1), status: 'ready', storage_path: 'w1/' + id + '/package.zip',
    created_by: 'user-1', share_token: null, created_at: '2026-10-0' + (index + 1) + 'T00:00:00Z' }));
  const properties = tours.map((tour, index) => ({ id: 'p' + (index + 1), title: 'Space ' + (index + 1), workspace_id: 'w1' }));
  // t1 and t2 wait for review; t3 to t5 are approved and never shared.
  const h = await loadDesk({ tables: { tours: { data: tours }, properties: { data: properties } }, approved: ['t3', 't4', 't5'] });
  assert.equal(h.ids['account-needs'].hidden, false);
  assert.equal(h.ids['account-next-step'].hidden, true, 'one place says what is next');
  const list = h.ids['account-needs-list'];
  const rows = () => list.children.filter(el => el.className === 'needs-row');
  assert.deepEqual(rows().map(el => [el.children[0].text(), el.children[1].textContent, el.hidden]), [
    ['Space 1  is ready for your review.', 'Review walkthrough', false],
    ['Space 2  is ready for your review.', 'Review walkthrough', false],
    ['Space 3  is approved, not shared yet.', 'Go to sharing', false],
    ['Space 4  is approved, not shared yet.', 'Go to sharing', true],
    ['Space 5  is approved, not shared yet.', 'Go to sharing', true],
  ]);
  assert.deepEqual(rows().map(el => el.children[1].className), ['tour-action tour-action-primary', 'tour-action', 'tour-action', 'tour-action', 'tour-action']);
  const more = () => h.control(list, 'needs-more');
  assert.equal(more().textContent, '2 more');
  assert.equal(more().getAttribute('aria-expanded'), 'false');
  await more().fire('click');
  assert.deepEqual(rows().map(el => el.hidden), [false, false, false, false, false]);
  assert.equal(more().textContent, 'Show fewer');
  // A row opens the place where the job is done; it approves and shares nothing itself.
  await rows()[0].children[1].fire('click');
  assert.equal(h.card('t1').wasFocused, true);
  assert.deepEqual(h.called('review_tour'), []);
  assert.deepEqual(h.called('enable_tour_share'), []);
});

test('with nothing waiting, Needs you stays away and the next step speaks', async () => {
  const live = await loadDesk({ tables: { tours: { data: [{ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: TOKEN }] } } });
  assert.equal(live.ids['account-needs'].hidden, true);
  assert.equal(live.ids['account-next-step'].hidden, false);
  assert.equal(live.ids['account-next-step'].children[0].textContent, 'Your walkthrough is live.');
  // Sharing turned off on purpose is not a job waiting on anyone.
  const hosting = [{ tour_id: 't1', property_id: 'p1', status: 'ready', approved: true, share_token: null, sharing_on: false, released_at: '2026-09-23T04:00:00Z', plan_active: true }];
  const off = await loadDesk({ rpc: { get_tour_hosting: async () => ({ data: hosting }) } });
  assert.equal(off.ids['account-needs'].hidden, true);
  assert.equal(off.ids['account-next-step'].children[0].textContent, 'Sharing is off.');
});

test('the plan in one line uses the Plan view’s own title, count and price, and links to it', async () => {
  const h = await loadDesk({ rpc: { get_workspace_plan: async () => ({ data: [planRow] }),
    get_walkthrough_capacity: async () => ({ data: [{ included_limit: 3, included_used: 2, included_remaining: 1, extra_credits_available: 0, can_accept: true, reason_code: null, plan_status: 'trial' }] }) } });
  const line = h.ids['account-plan-line'];
  assert.equal(line.hidden, false);
  assert.equal(line.children[0].textContent, 'Free until 1 January 2027 · Free walkthroughs: 2 of 3 used · then A$99 a month');
  assert.deepEqual([line.children[1].tagName, line.children[1].href, line.children[1].textContent], ['A', '#plan', 'Plan details']);
  // Every figure in the line is one the Plan view shows.
  const planText = h.ids['account-plan-body'].text();
  for (const part of ['Free until 1 January 2027', '2 of 3 used', 'A$99 a month']) assert.ok(planText.includes(part), part);
  // A plan that could not be read says so; it states no figure.
  const none = await loadDesk({ rpc: { get_workspace_plan: async () => ({ data: null, error: { message: 'down' } }) } });
  assert.equal(none.ids['account-plan-line'].children[0].textContent, 'Plan status unavailable');
});

/* ---- Restart your plan lands on a control that restarts that office's plan ---- */
const two = { data: [{ workspace_id: 'w1', role: 'owner', status: 'active' }, { workspace_id: 'w2', role: 'owner', status: 'active' }] };
const props = { data: [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }, { id: 'p2', title: 'Other hall', workspace_id: 'w2' }] };
const workspaces = { data: [{ id: 'w1', name: 'Harbour Realty' }, { id: 'w2', name: 'Hill Venues' }] };
const hallTour = { id: 't2', property_id: 'p2', status: 'ready', storage_path: 'w2/t2/package.zip', created_by: 'user-1', share_token: TOKEN, created_at: '2026-03-10T00:00:00Z' };
const hallHosting = [{ tour_id: 't2', property_id: 'p2', status: 'ready', approved: true, share_token: TOKEN, sharing_on: true, released_at: '2026-03-12T04:00:00Z',
  plan_active: false, hosting_state: 'offline_on', offline_on: '2027-10-10' }];
const twoOffices = (rpc = {}) => loadDesk({ tables: { memberships: two, properties: props, workspaces, tours: { data: [hallTour] } },
  rpc: { get_tour_hosting: async () => ({ data: hallHosting }), get_workspace_plan: async () => ({ data: [planRow] }), ...rpc } });

test('a walkthrough of an office the Plan view does not show: Needs you says so once and Restart your plan opens the offer', async () => {
  const h = await twoOffices();
  const card = h.card('t2');
  const restart = h.control(card, 'share-fix-plan');
  assert.equal(restart.hidden, false);
  assert.equal(h.find(card, el => /tour-plan-where/.test(el.className || '')) || null, null, 'the explanation is not repeated on each card');
  await restart.fire('click');
  assert.deepEqual(h.assigned, ['/offer'], 'the same route the Plan view’s own restart uses; no billing call is made');
  assert.deepEqual(shownViews(h), ['view-walkthroughs'], 'not a jump to a panel with no restart for this office');
  // Needs you names the count, the day and whose plan ended, with the same route.
  const row = h.ids['account-needs-list'].children[0];
  assert.equal(row.children[0].text(), 'Other hall  goes offline on 10 Oct 2027: Hill Venues’ plan has ended.  The Plan view shows Harbour Realty, not this office. Restart plan opens the offer instead.');
  assert.equal(row.children[1].textContent, 'Restart plan');
  await row.children[1].fire('click');
  assert.deepEqual(h.assigned, ['/offer', '/offer']);
});

test('where the main office can be changed, Restart your plan opens Plan on "Make this my main office" for that office', async () => {
  const h = await twoOffices({ get_primary_workspace: async () => ({ data: 'w1' }) });
  const card = h.card('t2');
  assert.equal(h.ids['account-needs-list'].children[0].children[0].text(), 'Other hall  goes offline on 10 Oct 2027: Hill Venues’ plan has ended.  The Plan view shows Harbour Realty, not this office. Restart plan opens it so you can make this your main office.');
  await h.control(card, 'share-fix-plan').fire('click');
  assert.deepEqual(h.assigned, []);
  assert.deepEqual(shownViews(h), ['view-plan']);
  const make = h.control(h.ids['account-plan-body'], 'make-primary');
  assert.equal(make.wasFocused, true);
  assert.ok(h.ids['account-plan-body'].text().includes('To restart Hill Venues’ plan, make it your main office. Its plan then shows here.'));
  assert.deepEqual(h.called('set_primary_workspace'), [], 'nothing is changed until the person presses it');
});

test('a walkthrough of the office the Plan view shows goes to that view’s own Restart your plan', async () => {
  const ended = { ...planRow, status: 'ended', trial_ends_at: new Date(Date.now() - 3 * 86400000).toISOString(), current_period_ends_at: null };
  const tour = { id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: TOKEN };
  const hosting = [{ tour_id: 't1', property_id: 'p1', status: 'ready', approved: true, share_token: TOKEN, sharing_on: true, released_at: '2026-03-12T04:00:00Z', plan_active: false }];
  const h = await loadDesk({ tables: { tours: { data: [tour] } }, rpc: { get_tour_hosting: async () => ({ data: hosting }), get_workspace_plan: async () => ({ data: [ended] }) } });
  const row = h.ids['account-needs-list'].children[0];
  assert.equal(row.children[1].textContent, 'Restart plan');
  await row.children[1].fire('click');
  assert.deepEqual(shownViews(h), ['view-plan']);
  const restart = h.find(h.ids['account-plan-body'], el => el.tagName === 'A' && el.textContent === 'Restart your plan');
  assert.equal(restart.href, '/offer');
  assert.equal(restart.wasFocused, true);
  assert.deepEqual(h.assigned, []);
});

test('Sign out is in the account menu on every view and signs out this browser only', async () => {
  const h = await loadDesk({ hash: '#plan' });
  let scope = null;
  h.supabase.auth.signOut = async args => { scope = args; return {}; };
  await h.ids['desk-menu-sign-out'].fire('click');
  assert.deepEqual(JSON.parse(JSON.stringify(scope)), { scope: 'local' });
  assert.equal(h.status(), 'Signed out on this browser.');
  assert.equal(h.ids['account-home'].hidden, true);
  assert.equal(h.ids['desk-bar'].hidden, true);
  assert.equal(h.ids['account-sign-in'].hidden, false);
  assert.equal(h.ids['account-title'].wasFocused, true, 'focus continues on the sign-in heading, not on a removed button');
});

test('the page the app opens has no bar and no views, and still reads as one desk', async () => {
  const app = await loadDesk({ appMode: true });
  assert.equal(app.ids['desk-bar'], undefined);
  assert.equal(app.ids['account-home'].hidden, false);
  assert.equal(app.ids['account-title'].hidden, false);
  assert.equal(app.ids['account-next-step'].hidden, false, 'no Needs you list there: the next step still speaks');
});

/* ---- Polish: say each thing once, and line things up ------------------------- */

test('the bar, the page and the desk footer share one width, and the views read in one column under an edge-to-edge title rule', () => {
  assert.match(css, /:root \{ --desk-width: 1152px; \}/);
  assert.match(css, /\.desk-bar-inner, \.desk-footer, \.form-page:has\(> \.desk:not\(\[hidden\]\) > \.desk-view\) \{ max-width: var\(--desk-width\); \}/);
  assert.doesNotMatch(css, /#view-walkthroughs \{ max-width: 1040px; \}|\.desk-view \{ min-width: 0; max-width: 720px; \}/, 'no view carries a width of its own');
  assert.match(css, /\.desk-view:not\(#view-walkthroughs\) > \.desk-section > :not\(\.view-title\) \{ max-width: 720px; \}/);
});

test('one filled button on the Walkthroughs view: card actions are outlines; Add a space leads only on a desk with nothing waiting and no walkthrough', async () => {
  assert.match(css, /#view-walkthroughs \.dash-tour \.tour-action-primary:not\(\.tour-panel \*, form \*\) \{ background: transparent; color: var\(--ink\); border-color: var\(--field-line\); \}/);
  // Something waits: the Needs you row is the filled one, and Add a space is an outline.
  const busy = await loadDesk();
  assert.equal(busy.ids['account-needs'].hidden, false);
  assert.equal(busy.ids['account-add-open'].className, 'tour-action');
  // A space saved, no walkthrough yet, nothing waiting: Add a space is the filled one.
  const quiet = await loadDesk({ tables: { tours: { data: [] } } });
  assert.equal(quiet.ids['account-needs'].hidden, true);
  assert.equal(quiet.ids['account-add-open'].className, 'tour-action tour-action-primary');
  // Its form open, the form's own Save is the filled one.
  await quiet.ids['account-add-open'].fire('click');
  assert.equal(quiet.ids['account-add-open'].className, 'tour-action');
});

test('disclosures are hairlines, never boxes, and a closed one leaves no box behind', () => {
  assert.match(css, /\.desk-view \.tour-review \{ margin: 12px 0 0; padding: 0; border: 0; border-top: 1px solid var\(--line\); border-radius: 0; background: none; \}/);
  assert.match(css, /\.desk-view \.account-details:not\(\[open\]\) > :not\(summary\) \{ display: none; \}/);
  assert.match(css, /\.tour-hosting-fix \{ display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0 16px;/, 'an ended plan’s two links wrap; they cannot overlap');
  // Prepare a capture is a quiet link in the space head on desktop, in the flow under the meta line on a phone.
  assert.match(css, /@media \(min-width: 720px\) \{\s*\.desk-view \.account-details\.space-prep > summary \{ position: absolute; top: 8px; right: 0; \}/);
});

test('pack options sit on the paper: transparent with a hairline, sage when chosen, and the radio shows the site’s focus ring', () => {
  assert.match(css, /\.desk-view \.annual-option \{ background: transparent; border-color: var\(--line\); \}/);
  assert.match(css, /\.desk-view \.annual-option:has\(input:checked\) \{ border-color: var\(--ink\); background: #eef1e8; \}/);
  assert.match(css, /\.desk-view \.annual-option input:focus-visible \{ outline: 3px solid #897033; outline-offset: 3px; \}/);
  // "No extra walkthroughs available." is not said again under the table row that says "0 available".
  assert.match(css, /#view-plan:has\(\[data-extra-said="true"\]\) \[data-none="true"\] \{ display: none; \}/);
});
