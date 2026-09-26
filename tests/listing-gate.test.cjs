/*
 * Is anyone living here? The listing gate on /account and /app/account (the sibling
 * repository's docs/launch-readiness-plan-20260925.md C2 and docs/ux/capture-to-client-
 * journey-20260925.md §5.1 "Blocked: tenant consent"; the backend lane's release-2
 * drafts, not released). A listing with a walkthrough asks once before its first share;
 * "Yes — tenants" asks for the tenant's written consent (reference and date signed);
 * enable_tour_share, resume_tour_share and request_listing_exports refusals read
 * "Approved. Sharing waits for …" with the gate as the one fix; a grandfathered live
 * share gets one quiet line; a backend without the functions (PGRST202) shows nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadDesk, missing } = require('./desk-fake.cjs');

const NOTE = 'In Queensland you need the tenant’s written consent before advertising images show their belongings. Keep the signed form; record its reference here.';
const WAIT_OCCUPANCY = 'Approved. Sharing waits for you to say whether anyone lives here.';
const WAIT_CONSENT = 'Approved. Sharing waits for the tenant’s signed consent.';
const WAIT_BUSINESS = 'Approved. Sharing waits for the business’s written permission.';
const readiness = (fields = {}) => () => ({ data: { occupancy: 'unknown', consent_recorded_at: null, consent_reference: null, blocked_reason: 'occupancy_not_declared', grandfathered: false, ...fields } });
const LIVE = { id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: 'abcdefghijklmnop' };
const radios = gate => gate.all().filter(el => el.tagName === 'INPUT' && el.type === 'radio');

test('a backend without the functions shows no question, and sharing reads as before', async () => {
  const h = await loadDesk();
  assert.deepEqual(h.called('get_listing_sharing_readiness'), [{ p_property_id: 'p1' }]);
  assert.equal(h.gate().hidden, true);
  assert.equal(h.gate().children.length, 0);
  const card = h.card();
  assert.ok(h.words(card).includes('Approved. Sharing isn’t on yet.'));
  assert.ok(h.button(card, 'Turn sharing on'));
  assert.equal(h.control(card, 'share-fix-occupancy'), null);
});

test('a listing without a walkthrough is not asked', async () => {
  const h = await loadDesk({ tables: { tours: { data: [] } }, rpc: { get_listing_sharing_readiness: readiness() } });
  assert.equal(h.called('get_listing_sharing_readiness').length, 0);
  assert.equal(h.gate(), null);
});

test('the question: four answers in order, nothing chosen until the person chooses, then saved and read again', async () => {
  let state = { occupancy: 'unknown', blocked_reason: 'occupancy_not_declared' };
  const h = await loadDesk({ approved: [], rpc: {
    get_listing_sharing_readiness: () => ({ data: { consent_recorded_at: null, consent_reference: null, grandfathered: false, ...state } }),
    set_listing_occupancy: args => { state = { occupancy: args.p_occupancy, blocked_reason: args.p_occupancy === 'tenanted' ? 'tenant_consent_required' : null }; return { data: null }; },
  } });
  const gate = h.gate();
  assert.equal(gate.hidden, false);
  assert.equal(gate.dataset.occupancy, 'question');
  assert.ok(h.words(gate).includes('Is anyone living or working here?'));
  assert.ok(h.words(gate).includes('Veylet asks once for each listing, before its walkthrough is shared.'));
  assert.deepEqual(gate.all().filter(el => el.className === 'occupancy-choice-text').map(el => el.textContent),
    ['Yes — tenants live here', 'Yes — the owner lives here', 'It’s a business or workplace', 'No — it’s empty']);
  assert.deepEqual(radios(gate).map(el => [el.value, el.checked]), [['tenanted', false], ['owner_occupied', false], ['business', false], ['vacant', false]]);
  // Saving without an answer says so beside the question and sends nothing.
  const form = gate.all().find(el => el.tagName === 'FORM');
  await form.fire('submit');
  assert.ok(h.words(gate).includes('Choose one answer.'));
  assert.equal(h.called('set_listing_occupancy').length, 0);
  radios(gate).find(el => el.value === 'vacant').checked = true;
  await form.fire('change');
  await form.fire('submit'); await h.settle();
  assert.deepEqual(h.called('set_listing_occupancy'), [{ p_property_id: 'p1', p_occupancy: 'vacant' }]);
  assert.equal(h.called('get_listing_sharing_readiness').length, 2, 'the desk is read again after a save');
  const after = h.gate();
  assert.equal(after.dataset.occupancy, 'summary');
  assert.ok(h.words(after).includes('Nobody lives or works here.'));
  assert.ok(h.words(after).includes('Saved.'));
  assert.ok(h.button(after, 'Change answer'));
  // Change answer reopens the question with the answer chosen, and Keep my answer closes it.
  await h.button(after, 'Change answer').fire('click');
  assert.equal(after.dataset.occupancy, 'question');
  assert.equal(radios(after).find(el => el.checked)?.value, 'vacant');
  assert.equal(radios(after).find(el => el.checked).wasFocused, true);
  await h.button(after, 'Keep my answer').fire('click');
  assert.equal(after.dataset.occupancy, 'summary');
});

test('“Yes — tenants” asks for the written consent: the note, the fields, their checks, then record_tenant_consent', async () => {
  let state = { occupancy: 'tenanted', blocked_reason: 'tenant_consent_required', consent_reference: null, consent_recorded_at: null };
  const h = await loadDesk({ approved: [], rpc: {
    get_listing_sharing_readiness: () => ({ data: { grandfathered: false, ...state } }),
    record_tenant_consent: args => { state = { occupancy: 'tenanted', blocked_reason: null, consent_reference: args.p_consent_reference, consent_recorded_at: '2026-09-25T02:00:00Z' }; return { data: null }; },
  } });
  const gate = h.gate();
  assert.equal(gate.dataset.occupancy, 'consent');
  const words = h.words(gate);
  assert.ok(words.includes('You said tenants live here.'));
  assert.ok(words.includes('Record the tenant’s written consent'));
  assert.ok(words.some(text => text.startsWith(NOTE)), 'the Queensland note, word for word');
  const help = gate.all().find(el => el.tagName === 'A');
  assert.equal(help.href, '/help/privacy-and-consent');
  assert.equal(help.textContent, 'Privacy and permission');
  assert.ok(words.includes('Consent reference'));
  assert.ok(words.includes('For example, the consent form’s name or number.'));
  assert.ok(words.includes('Date signed'));
  const reference = h.control(gate, 'consent-reference'), signed = h.control(gate, 'consent-signed');
  assert.equal(signed.type, 'date');
  assert.match(signed.max, /^\d{4}-\d{2}-\d{2}$/);
  const form = gate.all().find(el => el.tagName === 'FORM');
  await form.fire('submit');
  assert.ok(h.words(gate).includes('Enter the consent form’s name or number.'));
  assert.ok(h.words(gate).includes('Enter the date the tenant signed.'));
  assert.equal(reference.getAttribute('aria-invalid'), 'true');
  assert.equal(reference.wasFocused, true);
  reference.value = '  Form 18a, signed copy  ';
  signed.value = '2999-01-01';
  await form.fire('input'); await form.fire('submit');
  assert.ok(h.words(gate).includes('The date signed can’t be in the future.'));
  assert.equal(h.called('record_tenant_consent').length, 0);
  signed.value = '2026-09-20';
  await form.fire('submit'); await h.settle();
  assert.deepEqual(h.called('record_tenant_consent'), [{ p_property_id: 'p1', p_consent_reference: 'Form 18a, signed copy', p_consented_on: '2026-09-20' }]);
  const after = h.gate();
  assert.equal(after.dataset.occupancy, 'summary');
  assert.ok(h.words(after).some(text => /^Tenants live here\. Written consent recorded on 25 Sep 2026 \(reference: Form 18a, signed copy\)\.$/.test(text)));
  assert.ok(h.words(after).includes('Consent recorded.'));
});

test('an approved walkthrough on an unanswered listing says what sharing waits for, and its fix opens the question', async () => {
  const h = await loadDesk({ rpc: { get_listing_sharing_readiness: readiness() } });
  const card = h.card();
  assert.ok(h.words(card).includes(WAIT_OCCUPANCY));
  const fix = h.control(card, 'share-fix-occupancy');
  assert.equal(fix.textContent, 'Answer the question');
  assert.match(fix.className, /tour-action-primary/);
  assert.ok(h.button(card, 'Turn sharing on'), 'turning sharing on stays beside the fix');
  await fix.fire('click');
  assert.equal(radios(h.gate())[0].wasFocused, true);
  // The next step says the same, with the same fix.
  const next = h.ids['account-next-step'];
  assert.ok(h.words(next).includes(WAIT_OCCUPANCY));
  assert.ok(h.button(next, 'Answer the question'));
});

test('enable_tour_share’s two new refusals read in the contract’s words, each with its own fix', async () => {
  let refusal = 'tenant consent required';
  const h = await loadDesk({ rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'vacant', blocked_reason: null }),
    enable_tour_share: () => ({ data: null, error: { code: 'P0001', message: refusal } }),
  } });
  const card = h.card();
  await h.button(card, 'Turn sharing on').fire('click'); await h.settle();
  assert.equal(h.status(), WAIT_CONSENT);
  const fix = h.control(card, 'share-fix-consent');
  assert.equal(fix.textContent, 'Add consent');
  // The refusal is newer than the page's answer: the consent form opens anyway.
  await fix.fire('click');
  assert.equal(h.gate().dataset.occupancy, 'consent');
  assert.equal(h.control(h.gate(), 'consent-reference').wasFocused, true);
  refusal = 'occupancy not declared';
  await h.button(card, 'Turn sharing on').fire('click'); await h.settle();
  assert.equal(h.status(), WAIT_OCCUPANCY);
});

test('one press of Approve and share on an unanswered listing keeps the approval and names the fix', async () => {
  let approvedNow = false;
  const h = await loadDesk({ approved: [], rpc: {
    get_listing_sharing_readiness: readiness(),
    get_tour_review: () => ({ data: [{ approved: approvedNow }] }),
    review_tour_versioned: () => { approvedNow = true; return { data: [{ approved: true }] }; },
    enable_tour_share: () => ({ data: null, error: { code: 'P0001', message: 'occupancy not declared' } }),
  } });
  const card = h.card();
  const form = card.all().find(el => el.tagName === 'FORM');
  for (const box of form.all().filter(el => el.tagName === 'INPUT')) box.checked = true;
  await form.fire('submit'); await h.settle();
  assert.equal(h.called('review_tour_versioned').length, 1);
  assert.equal(h.called('enable_tour_share').length, 1);
  const after = h.card();
  assert.ok(h.words(after).includes(WAIT_OCCUPANCY));
  assert.ok(h.control(after, 'share-fix-occupancy'));
});

test('a grandfathered live share gets one quiet line and no warning; its link keeps working', async () => {
  const h = await loadDesk({ tables: { tours: { data: [LIVE] } }, rpc: { get_listing_sharing_readiness: readiness({ grandfathered: true }) } });
  const gate = h.gate();
  assert.equal(gate.hidden, false);
  const box = gate.children[0];
  assert.equal(box.tagName, 'DETAILS');
  assert.equal(box.open, false);
  const summary = box.children[0];
  assert.deepEqual(summary.children.map(el => el.textContent), ['Is anyone living or working here?', 'Answer this before sharing again.']);
  // Inside, the question is said to assistive technology but not drawn a second time.
  assert.equal(box.all().find(el => el.tagName === 'LEGEND').className, 'occupancy-title render-sr');
  const card = h.card();
  assert.equal(card.all().some(el => /tour-share-problem/.test(el.className)), false, 'no warning on the live card');
  assert.equal(h.words(card).includes(WAIT_OCCUPANCY), false);
  assert.ok(h.control(card, 'copy-link'), 'the share kit stays');
});

test('a paused share on a blocked listing leads with the fix; a resume refusal maps the same way', async () => {
  const paused = { ...LIVE, share_paused_at: '2026-09-25T01:00:00Z' };
  const tables = { tours: { data: [paused] } };
  const h = await loadDesk({ tables, rpc: { get_listing_sharing_readiness: readiness({ occupancy: 'tenanted', blocked_reason: 'tenant_consent_required', grandfathered: true }) } });
  const card = h.card();
  assert.ok(h.words(card).includes(WAIT_CONSENT));
  assert.equal(h.control(card, 'share-fix-consent').textContent, 'Add consent');
  assert.ok(h.button(card, 'Resume sharing'));

  const h2 = await loadDesk({ tables, rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'owner_occupied', blocked_reason: null }),
    resume_tour_share: () => ({ data: null, error: { code: 'P0001', message: 'occupancy not declared' } }),
  } });
  const card2 = h2.card();
  assert.equal(h2.control(card2, 'share-fix-occupancy'), null);
  await h2.button(card2, 'Resume sharing').fire('click'); await h2.settle();
  assert.equal(h2.status(), WAIT_OCCUPANCY);
  assert.equal(h2.control(card2, 'share-fix-occupancy').textContent, 'Answer the question');
});

test('the videos and stills block shows the same block, and maps the same refusals', async () => {
  const exportsNothing = args => ({ data: { tour_id: args.p_tour_id, state: null, requested: false, downloadable: false, consent_version: 'export-consent-v0-draft' } });
  const blocked = await loadDesk({ tables: { tours: { data: [LIVE] } }, rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'tenanted', blocked_reason: 'tenant_consent_required', grandfathered: true }),
    get_listing_exports: exportsNothing,
  } });
  const box = blocked.card().all().find(el => /\btour-exports\b/.test(el.className));
  assert.equal(box.hidden, false);
  assert.ok(blocked.words(box).includes(WAIT_CONSENT));
  assert.equal(blocked.control(box, 'exports-fix-consent').textContent, 'Add consent');
  assert.equal(box.all().some(el => el.tagName === 'FORM'), false, 'no request form while sharing waits');

  const refused = await loadDesk({ tables: { tours: { data: [LIVE] } }, rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'vacant', blocked_reason: null }),
    get_listing_exports: exportsNothing,
    request_listing_exports: () => ({ data: null, error: { code: 'P0001', message: 'occupancy not declared' } }),
  } });
  const box2 = refused.card().all().find(el => /\btour-exports\b/.test(el.className));
  box2.all().find(el => el.dataset?.control === 'exports-consent').checked = true;
  await box2.all().find(el => el.tagName === 'FORM').fire('submit'); await refused.settle();
  assert.ok(refused.words(box2).includes(WAIT_OCCUPANCY));
  assert.ok(refused.control(box2, 'exports-fix-occupancy'));
});

test('a save that fails says why beside the question and keeps the answer on screen', async () => {
  const cases = [
    [() => ({ data: null, error: { code: 'P0001', message: 'sharing permission required' } }), 'Your role can’t change this. Ask your workspace owner.'],
    [() => { throw new TypeError('Failed to fetch'); }, 'You’re offline. Nothing was saved.'],
    [() => ({ data: null, error: { message: 'Synthetic failure' } }), 'Your answer wasn’t saved. Try again.'],
  ];
  for (const [answer, words] of cases) {
    const h = await loadDesk({ approved: [], rpc: { get_listing_sharing_readiness: readiness(), set_listing_occupancy: answer } });
    const gate = h.gate();
    radios(gate)[1].checked = true;
    await gate.all().find(el => el.tagName === 'FORM').fire('submit'); await h.settle();
    assert.ok(h.words(gate).includes(words), words);
    assert.equal(radios(gate)[1].checked, true);
    assert.equal(h.called('get_listing_sharing_readiness').length, 1, 'no reload after a failed save');
  }
  // Missing set function: the question goes away without a word.
  const gone = await loadDesk({ approved: [], rpc: { get_listing_sharing_readiness: readiness(), set_listing_occupancy: () => missing('set_listing_occupancy') } });
  radios(gone.gate())[2].checked = true;
  await gone.gate().all().find(el => el.tagName === 'FORM').fire('submit'); await gone.settle();
  assert.equal(gone.gate().hidden, true);
});

test('an answer the draft does not describe asks nothing', async () => {
  for (const data of [null, 'receipt', { occupancy: 'lodgers', blocked_reason: null }, { occupancy: 'unknown', blocked_reason: 'something_else' }]) {
    const h = await loadDesk({ rpc: { get_listing_sharing_readiness: () => ({ data }) } });
    assert.equal(h.gate().hidden, true, JSON.stringify(data));
    assert.ok(h.button(h.card(), 'Turn sharing on'));
  }
});

test('the app’s page asks the same question, links the in-app help, and still names no amount', async () => {
  const h = await loadDesk({ appMode: true, rpc: { get_listing_sharing_readiness: readiness({ occupancy: 'tenanted', blocked_reason: 'tenant_consent_required' }) } });
  const help = h.gate().all().find(el => el.tagName === 'A');
  assert.equal(help.href, '/app/help/privacy-and-consent');
  const { renderAppAccount, findBanned } = await import(pathToFileURL(path.join(__dirname, '../scripts/check-app-pages.mjs')));
  const dist = path.join(__dirname, '../dist');
  for (const search of ['?occupancy=question', '?occupancy=tenanted', '?occupancy=mixed&exports=request', '?occupancy=consented', '?occupancy=question&pause=paused',
    '?occupancy=vacant&share=consent', '?occupancy=question&occupancy-save=permission']) {
    const { written, calls } = await renderAppAccount(dist, search);
    const problems = [...new Set(written)].flatMap(value => findBanned(value, search));
    assert.deepEqual(problems, [], search);
    assert.ok(calls.includes('get_listing_sharing_readiness'), search);
    assert.ok(written.includes('Is anyone living or working here?') || written.includes('Record the tenant’s written consent') || written.some(text => /lives here|lives or works here|Tenants live here/.test(text)), search);
  }
});

test('consent refused because the home is no longer tenanted asks the question again', async () => {
  const h = await loadDesk({ approved: [], rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'tenanted', blocked_reason: 'tenant_consent_required' }),
    record_tenant_consent: () => ({ data: null, error: { code: 'P0001', message: 'declare the home tenanted before recording tenant consent' } }),
  } });
  const gate = h.gate();
  h.control(gate, 'consent-reference').value = 'Form 18a';
  h.control(gate, 'consent-signed').value = '2026-09-20';
  await gate.all().find(el => el.tagName === 'FORM').fire('submit'); await h.settle();
  assert.equal(gate.dataset.occupancy, 'question');
  assert.ok(h.words(gate).includes('Say whether anyone lives here first. Nothing was recorded.'));
  assert.equal(radios(gate)[0].wasFocused, true);
});

test('a business or workplace is sent as its own occupancy, and its permission step names the business, not the Queensland tenancy rule', async () => {
  // release-2 draft 20260926122000_tenant_consent_gate.sql: 'business' is its own
  // occupancy value, blocked on 'business_permission_required' until permission is recorded.
  let state = { occupancy: 'unknown', blocked_reason: 'occupancy_not_declared' };
  const h = await loadDesk({ approved: [], rpc: {
    get_listing_sharing_readiness: () => ({ data: { consent_recorded_at: null, consent_reference: null, grandfathered: false, ...state } }),
    set_listing_occupancy: args => {
      state = { occupancy: args.p_occupancy, blocked_reason: args.p_occupancy === 'business' ? 'business_permission_required'
        : args.p_occupancy === 'tenanted' ? 'tenant_consent_required' : null };
      return { data: null };
    },
    record_tenant_consent: args => { state = { occupancy: 'business', blocked_reason: null, consent_reference: args.p_consent_reference, consent_recorded_at: '2026-09-25T02:00:00Z' }; return { data: null }; },
  } });
  const gate = h.gate();
  radios(gate).find(el => el.value === 'business').checked = true;
  await gate.all().find(el => el.tagName === 'FORM').fire('submit'); await h.settle();
  // Sent as its own value: a server that keeps 'business' needs no local memory to know it.
  assert.deepEqual(h.called('set_listing_occupancy'), [{ p_property_id: 'p1', p_occupancy: 'business' }]);
  const after = h.gate();
  assert.equal(after.dataset.occupancy, 'consent');
  const words = h.words(after);
  assert.ok(words.includes('Saved. Now record the business’s written permission.'));
  assert.ok(words.includes('You said it’s a business or workplace.'));
  assert.ok(words.includes('Record the business’s written permission'));
  assert.ok(words.some(text => text.startsWith('Get permission from the business before you capture people, screens or documents.')));
  assert.equal(words.some(text => /Queensland|tenant’s written consent/.test(text)), false, 'no residential tenancy note for a business');
  const reference = h.control(after, 'consent-reference'), signed = h.control(after, 'consent-signed');
  reference.value = 'Letter from the practice manager';
  signed.value = '2026-09-20';
  await after.all().find(el => el.tagName === 'FORM').fire('submit'); await h.settle();
  assert.deepEqual(h.called('record_tenant_consent'), [{ p_property_id: 'p1', p_consent_reference: 'Letter from the practice manager', p_consented_on: '2026-09-20' }]);
  const done = h.gate();
  assert.equal(done.dataset.occupancy, 'summary');
  assert.ok(h.words(done).some(text => /^A business or workplace\. Permission recorded on 25 Sep 2026 \(reference: Letter from the practice manager\)\.$/.test(text)));
  assert.ok(h.words(done).includes('Permission recorded.'));
  // A tenanted listing keeps the residential tenant wording (the legal default).
  const other = await loadDesk({ approved: [], rpc: { get_listing_sharing_readiness: readiness({ occupancy: 'tenanted', blocked_reason: 'tenant_consent_required' }) } });
  assert.ok(h.words(other.gate()).some(text => /In Queensland you need the tenant’s written consent/.test(text)));
});

test('an old server without the business value refuses it by name: this browser saves tenanted instead and remembers the business wording locally', async () => {
  const data = {};
  const storage = { getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = String(value); } };
  let state = { occupancy: 'unknown', blocked_reason: 'occupancy_not_declared' };
  const h = await loadDesk({ approved: [], localStorage: storage, rpc: {
    get_listing_sharing_readiness: () => ({ data: { consent_recorded_at: null, consent_reference: null, grandfathered: false, ...state } }),
    set_listing_occupancy: args => {
      if (args.p_occupancy === 'business') return { data: null, error: { code: 'P0001', message: 'occupancy is owner_occupied, vacant, tenanted or unknown' } };
      state = { occupancy: args.p_occupancy, blocked_reason: args.p_occupancy === 'tenanted' ? 'tenant_consent_required' : null };
      return { data: null };
    },
  } });
  const gate = h.gate();
  radios(gate).find(el => el.value === 'business').checked = true;
  await gate.all().find(el => el.tagName === 'FORM').fire('submit'); await h.settle();
  // Tried as 'business' first; refused by name, so it fell back to 'tenanted'.
  assert.deepEqual(h.called('set_listing_occupancy'), [
    { p_property_id: 'p1', p_occupancy: 'business' },
    { p_property_id: 'p1', p_occupancy: 'tenanted' },
  ]);
  const after = h.gate();
  assert.equal(after.dataset.occupancy, 'consent');
  const words = h.words(after);
  assert.ok(words.includes('Saved. Now record the business’s written permission.'));
  // The server still reads 'tenanted': the business wording comes from local memory.
  assert.ok(words.includes('You said it’s a business or workplace.'));
  assert.equal(words.some(text => /Queensland|tenant’s written consent/.test(text)), false);
});

test('enable_tour_share’s business refusal reads in the contract’s words, with its own fix', async () => {
  const h = await loadDesk({ rpc: {
    get_listing_sharing_readiness: readiness({ occupancy: 'business', blocked_reason: null }),
    enable_tour_share: () => ({ data: null, error: { code: 'P0001', message: 'business permission required' } }),
  } });
  const card = h.card();
  await h.button(card, 'Turn sharing on').fire('click'); await h.settle();
  assert.equal(h.status(), WAIT_BUSINESS);
  const fix = h.control(card, 'share-fix-business');
  assert.equal(fix.textContent, 'Add permission');
  // The refusal is newer than the page's answer: the permission form opens anyway.
  await fix.fire('click');
  assert.equal(h.gate().dataset.occupancy, 'consent');
  assert.ok(h.words(h.gate()).includes('Record the business’s written permission'));
  assert.equal(h.control(h.gate(), 'consent-reference').wasFocused, true);
});
