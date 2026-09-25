const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The QA fixture's desk (S1) cases answer as documented, so each desk state can
// be opened in the loopback browser. The fixture never ships (outside dist).
const source = fs.readFileSync(path.join(__dirname, 'account-browser-fixture.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const never = Symbol('never');
const within = (promise, ms = 20) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(never), ms))]);

function fixture(search, { pathname = '/__qa/account/', navigator = {} } = {}) {
  const context = { URLSearchParams, location: { search, pathname }, navigator,
    localStorage: { getItem: () => null, setItem() {} }, document: { createElement: () => ({}), addEventListener() {} } };
  context.window = context;
  vm.runInNewContext(source, context);
  return { client: context.supabase.createClient(), context };
}
const lost = error => error && error.name === 'TypeError' && error.message === 'Failed to fetch';
const read = (client, table) => client.from(table).select('id').order('created_at').then(value => ({ value }), error => ({ error }));
const SAVE = { p_workspace_id: 'synthetic-workspace', p_show: true, p_display_name: '  Alex Example ', p_agency: '', p_phone: ' +61 400 000 000 ', p_email: null };

test('the desk contact read stays away by default and answers each ?contact= case', async () => {
  const get = async search => fixture(search).client.rpc('get_workspace_public_contact', { p_workspace_id: 'synthetic-workspace' });
  assert.equal((await get('')).error.code, 'PGRST202', 'the section stays away, as today');
  assert.equal((await get('?contact=missing')).error.code, 'PGRST202');
  assert.deepEqual(plain((await get('?contact=empty')).data[0]), { show_on_shared: false, display_name: null, agency: null, phone: null, email: null, updated_at: null });
  const shown = (await get('?contact=shown')).data[0];
  assert.deepEqual([shown.show_on_shared, shown.display_name, shown.agency, shown.phone, shown.email], [true, 'Alex Example', 'Example Realty', '+61 400 000 000', 'alex@example.invalid']);
  assert.equal((await get('?contact=hidden')).data[0].show_on_shared, false);
  assert.equal((await get('?contact=hidden')).data[0].display_name, 'Alex Example');
  assert.equal((await get('?contact=readonly')).data[0].show_on_shared, true);
  assert.equal((await get('?contact=phone')).data[0].email, null);
  assert.ok((await get('?contact=error')).error);
  assert.equal(await within(get('?contact=loading')), never);
  // The client page's lookup reads the same switch, with its own default.
  const lookup = async search => fixture(search, { pathname: '/__qa/handoff/' }).client.rpc('lookup_tour_share_contact', { p_token: 'synthetic-fixture-token' });
  assert.equal((await lookup('')).data[0].display_name, 'Alex Example');
  assert.equal((await lookup('?contact=shown')).data[0].display_name, 'Alex Example');
  for (const value of ['empty', 'hidden', 'none']) assert.deepEqual(plain((await lookup('?contact=' + value)).data), [], value);
  assert.equal(await within(lookup('?contact=loading')), never);
});

test('a save is trimmed, refused as the migration refuses, kept and echoed back', async () => {
  const { client } = fixture('?contact=empty');
  const saved = await client.rpc('set_workspace_public_contact', SAVE);
  assert.deepEqual(plain(saved.data[0]).display_name, 'Alex Example');
  assert.deepEqual([saved.data[0].agency, saved.data[0].phone, saved.data[0].email, saved.data[0].show_on_shared], [null, '+61 400 000 000', null, true]);
  const again = await client.rpc('get_workspace_public_contact', { p_workspace_id: 'synthetic-workspace' });
  assert.equal(again.data[0].display_name, 'Alex Example', 'the next read returns what was saved');
  const refused = await client.rpc('set_workspace_public_contact', { ...SAVE, p_phone: '', p_email: '' });
  assert.equal(refused.error.message, 'showing the contact needs a display name and a phone or email');
  assert.equal((await client.rpc('set_workspace_public_contact', { ...SAVE, p_phone: 'call me' })).error.message, 'phone must be up to 32 digits, spaces and + ( ) -');
  assert.equal((await client.rpc('set_workspace_public_contact', { ...SAVE, p_email: 'nope' })).error.message, 'email must look like name@example.com');
  assert.equal((await client.rpc('set_workspace_public_contact', { ...SAVE, p_show: false, p_phone: '', p_email: '' })).data[0].show_on_shared, false);
});

test('?contact-save= and ?contact=readonly refuse every save in the server’s words', async () => {
  const save = async search => fixture(search).client.rpc('set_workspace_public_contact', SAVE).then(value => ({ value }), error => ({ error }));
  assert.equal((await save('?contact=readonly')).value.error.message, 'contact permission required');
  assert.equal((await save('?contact=shown&contact-save=permission')).value.error.message, 'contact permission required');
  assert.equal((await save('?contact=shown&contact-save=phone')).value.error.message, 'phone must be up to 32 digits, spaces and + ( ) -');
  assert.ok((await save('?contact=shown&contact-save=fail')).value.error.message);
  assert.ok(lost((await save('?contact=shown&contact-save=offline')).error));
  assert.deepEqual(plain((await save('?contact=shown&contact-save=expired')).value.error), { code: 'PGRST301', message: 'JWT expired' });
});

test('?share= makes enable_tour_share refuse, fail or lose its answer; without it sharing turns on as before', async () => {
  const share = search => fixture(search).client.rpc('enable_tour_share', { p_tour_id: 'synthetic-approved' });
  assert.equal((await share('')).data, 'synthetic-fixture-token-approved');
  assert.equal((await share('?share=review')).error.message, 'review this tour before sharing');
  assert.equal((await share('?share=uploader')).error.message, 'tour uploader membership is no longer active');
  assert.equal((await share('?share=permission')).error.message, 'sharing permission required');
  assert.ok((await share('?share=fail')).error);
  const { client } = fixture('?share=lost');
  const answer = await client.rpc('enable_tour_share', { p_tour_id: 'synthetic-approved' });
  assert.equal(answer.data, null);
  assert.match(answer.error.message, /TypeError: Failed to fetch/);
  const tours = await client.from('tours').select('id,share_token').order('created_at');
  assert.equal(tours.data.find(row => row.id === 'synthetic-approved').share_token, 'synthetic-fixture-token-approved', 'the link is live on the next read');
});

test('?offline= loses the first desk read, every later desk read, or every render-status read', async () => {
  const first = fixture('?offline=first').client;
  for (const table of ['properties', 'memberships', 'tours']) assert.ok(lost((await read(first, table)).error), table);
  for (const table of ['properties', 'memberships', 'tours']) assert.ok((await read(first, table)).value.data, 'the next read ' + table);

  const later = fixture('?offline=list').client;
  for (const table of ['properties', 'memberships', 'tours']) assert.ok((await read(later, table)).value.data, table);
  for (const table of ['properties', 'memberships', 'tours']) assert.ok(lost((await read(later, table)).error), 'later ' + table);

  const status = fixture('?offline=status&render=rendering').client;
  assert.ok(lost(await status.rpc('list_workspace_render_status', { p_workspace_id: 'synthetic-workspace' }).catch(error => error)));
  assert.ok((await read(status, 'properties')).value.data, 'the desk itself still reads');
  assert.ok((await read(fixture('').client, 'properties')).value.data, 'no switch, no loss');
});

test('?share-sheet= removes the share sheet or stubs one that resolves', async () => {
  const none = { share: async () => {}, canShare: () => true };
  fixture('?share-sheet=none', { navigator: none });
  assert.equal(typeof none.share, 'undefined');
  const native = {};
  const { context } = fixture('?share-sheet=native', { navigator: native });
  assert.equal(native.canShare({ url: 'x' }), true);
  await native.share({ title: 'Fictional practice space', url: 'https://veylet.com/handoff?t=synthetic-fixture-token' });
  assert.deepEqual(plain(context.VEYLET_QA_CALLS.at(-1)), { name: 'navigator.share', args: { title: 'Fictional practice space', url: 'https://veylet.com/handoff?t=synthetic-fixture-token' } });
  const untouched = { share: 'kept' };
  fixture('', { navigator: untouched });
  assert.equal(untouched.share, 'kept');
});

test('every new switch is documented in the fixture header', () => {
  const header = source.slice(0, source.indexOf('if (params.get(\'graphics\') === \'none\')'));
  for (const words of ['`readonly`', '`&contact-save=permission|phone|fail|offline|expired`', '`?share=review|uploader|permission`', '`lost`',
    '`?offline=first`', '`list`', '`status`', '`?share-sheet=none`', '`native`']) assert.ok(header.includes(words), words);
});

test('?render=checking is an older backend’s studio_check, ?render=walk goes from step 5 straight to ready, and ?express= has no daily cap except full', async () => {
  const status = async search => (await fixture(search).client.rpc('list_workspace_render_status', { p_workspace_id: 'synthetic-workspace' })).data;
  const checking = (await status('?render=checking')).spaces.find(entry => entry.job);
  assert.deepEqual([checking.job.state, checking.job.status, checking.job.progress_pct, checking.job.eta_seconds], ['studio_check', 'awaiting_review', null, null]);
  assert.equal((await status('?render=studio-check')).spaces.some(entry => entry.job), false, 'the retired case name answers nothing');
  const walk = fixture('?render=walk').client;
  const states = [];
  for (let read = 0; read < 12; read += 1) {
    const job = (await walk.rpc('list_workspace_render_status', { p_workspace_id: 'synthetic-workspace' })).data.spaces.find(entry => entry.job).job;
    states.push(job.state + (job.step ? ':' + job.step : ''));
  }
  assert.equal(states.includes('studio_check'), false, 'no person checks it');
  assert.equal(states.indexOf('ready_for_review'), states.indexOf('rendering:5') + 1, 'Checking quality, then ready for review');
  const offer = async search => (await fixture(search).client.rpc('get_express_offer', { p_workspace_id: 'synthetic-workspace' })).data;
  const open = await offer('?express=offer');
  assert.deepEqual([open.daily_cap, open.full_today, open.taken_today], [null, false, undefined]);
  assert.ok(Date.parse(open.captures[0].ready_by) - Date.now() <= 31 * 60000, 'about 30 minutes, any time');
  const full = await offer('?express=full');
  assert.deepEqual([full.daily_cap, full.taken_today, full.full_today], [5, 5, true]);
});
