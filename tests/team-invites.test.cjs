/*
 * Your team on /account (the sibling repository's docs/launch-readiness-plan-20260925.md
 * §3, onboarding item 3; the release-2 drafts, not released). The owner invites a
 * teammate by email and role (Reviewer: can review and share; Operator: can capture and
 * send) and gets a link to copy or share, with when it expires; no email is sent. The
 * invites list says each state in words, and Revoke is confirmed in place. Anyone else
 * reads their role. Everyone sees the members (list_workspace_members) by name; the owner
 * removes or hands over to another member, and a teammate leaves from their own row. A
 * backend without the functions (PGRST202) shows no section; the app's page has none (the
 * app shows its own). Signing in from /join comes back to /join.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadDesk } = require('./desk-fake.cjs');

const ROWS = [
  { invite_id: 'i-1', email: 'sam@example.invalid', role: 'reviewer', status: 'pending', created_at: '2026-09-25T00:00:00Z', expires_at: '2026-10-02T00:00:00Z' },
  { invite_id: 'i-2', email: 'jo@example.invalid', role: 'operator', status: 'accepted', created_at: '2026-09-20T00:00:00Z', expires_at: '2026-09-27T00:00:00Z', user_id: 'bbbb2222-0000-4000-8000-000000000002' },
  { invite_id: 'i-3', email: 'old@example.invalid', role: 'reviewer', status: 'revoked', created_at: '2026-09-10T00:00:00Z', expires_at: '2026-09-17T00:00:00Z' },
  { invite_id: 'i-4', email: 'late@example.invalid', role: 'operator', status: 'expired', created_at: '2026-09-01T00:00:00Z', expires_at: '2026-09-08T00:00:00Z' },
];
// The section, and its body where everything is drawn (the stand-in keeps ids flat).
const section = h => h.ids['account-team'];
const team = h => h.ids['account-team-body'];
const invites = h => team(h).all().filter(el => el.className === 'team-invite');
const form = h => team(h).all().find(el => el.tagName === 'FORM');
const role = (h, value) => team(h).all().find(el => el.dataset?.control === 'team-role-' + value);

function owner(extra = {}) {
  let rows = ROWS.map(row => ({ ...row }));
  return loadDesk({ ...extra, rpc: {
    list_workspace_invites: () => ({ data: rows.map(row => ({ ...row })) }),
    invite_to_workspace: args => {
      rows = [{ invite_id: 'i-new', email: args.p_email, role: args.p_role, status: 'pending', created_at: '2026-09-26T00:00:00Z', expires_at: '2026-10-03T00:00:00Z' }, ...rows];
      return { data: { invite_id: 'i-new', invite_url: 'https://veylet.com/join?i=abcdefghijklmnopqrstuvwxyz012345', expires_at: '2026-10-03T00:00:00Z' } };
    },
    revoke_workspace_invite: args => { rows = rows.map(row => row.invite_id === args.p_invite_id ? { ...row, status: 'revoked' } : row); return { data: null }; },
    ...(extra.rpc || {}),
  } });
}

test('a backend without the functions shows no team section', async () => {
  const h = await loadDesk();
  assert.deepEqual(h.called('list_workspace_invites'), [{ p_workspace_id: 'w1' }]);
  assert.equal(section(h).hidden, true);
  assert.equal(team(h).children.length, 0);
});

test('the heading avoids the retired plan name, and the app’s page has no team section', () => {
  const desk = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');
  assert.match(desk, /<h2 class="dash-heading" id="account-team-title">Your team<\/h2>/);
  const app = fs.readFileSync(path.join(__dirname, '../dist/app/account/index.html'), 'utf8');
  assert.doesNotMatch(app, /account-team/);
});

test('the owner sees the invite form, what each role can do, and every invite’s state in words', async () => {
  const h = await owner();
  assert.equal(section(h).hidden, false);
  const words = h.words(team(h));
  for (const text of ['Invite a teammate', 'Email', 'What they can do', 'Reviewer', 'Can review and share.', 'Operator', 'Can capture and send.',
    'No email is sent. Copy the link and send it to them yourself.', 'Create invite link', 'Invites']) assert.ok(words.includes(text), text);
  assert.equal(role(h, 'reviewer').checked, false, 'no role is chosen for the owner');
  assert.equal(role(h, 'operator').checked, false);
  assert.deepEqual(invites(h).map(item => item.all().find(el => el.className === 'team-invite-email').textContent), ROWS.map(row => row.email));
  assert.deepEqual(invites(h).map(item => item.all().find(el => /\bpill\b/.test(el.className)).textContent), ['Pending', 'Accepted', 'Revoked', 'Expired']);
  assert.ok(h.words(invites(h)[0]).includes('Expires 2 Oct 2026'));
  assert.deepEqual(invites(h).map(item => Boolean(h.control(item, 'team-revoke'))), [true, false, false, false], 'only a pending invite can be revoked');
});

test('the form checks the address and the role before asking, then shows the link to copy with its expiry', async () => {
  const h = await owner();
  const email = h.control(team(h), 'team-email');
  assert.equal(email.type, 'email');
  assert.equal(email.autocomplete, 'off');
  await form(h).fire('submit');
  assert.ok(h.words(team(h)).includes('Enter an email address like name@agency.com.au.'));
  assert.ok(h.words(team(h)).includes('Choose what they can do.'));
  assert.equal(email.wasFocused, true);
  assert.equal(h.called('invite_to_workspace').length, 0);
  email.value = ' new.agent@example.invalid ';
  role(h, 'operator').checked = true;
  await form(h).fire('input');
  await form(h).fire('submit'); await h.settle();
  assert.deepEqual(h.called('invite_to_workspace'), [{ p_workspace_id: 'w1', p_email: 'new.agent@example.invalid', p_role: 'operator' }]);
  const result = team(h).all().find(el => el.className === 'team-result');
  assert.ok(result, 'the link is shown');
  assert.equal(result.wasFocused, true);
  assert.equal(h.control(result, 'team-link').value, 'https://veylet.com/join?i=abcdefghijklmnopqrstuvwxyz012345');
  assert.ok(h.words(result).includes('Invite link'));
  assert.equal(result.getAttribute('aria-label'), 'Invite link for new.agent@example.invalid');
  assert.ok(h.words(result).includes('It expires on 3 Oct 2026. Send it only to new.agent@example.invalid.'));
  assert.ok(h.words(result).includes('They join as an operator, who can capture and send.'));
  const copy = h.control(result, 'team-copy');
  assert.match(copy.className, /tour-action-primary/, 'Copy link is the one filled press without a share sheet');
  await copy.fire('click');
  assert.ok(h.words(result).includes('Invite link copied. Send it to them yourself.'));
  assert.equal(h.status(), 'Invite link copied. Send it to them yourself.');
  // The form is empty again, and the new invite heads the list.
  assert.equal(h.control(team(h), 'team-email').value, '');
  assert.equal(invites(h)[0].all().find(el => el.className === 'team-invite-email').textContent, 'new.agent@example.invalid');
  // A later desk read keeps the link on screen.
  await h.ids['account-refresh'].fire('click'); await h.settle();
  assert.ok(team(h).all().some(el => el.className === 'team-result'));
});

test('with a share sheet, Share is the filled press and carries only the link', async () => {
  const shared = [];
  const h = await owner({ navigator: { onLine: true, clipboard: { writeText: async () => {} }, share: async data => { shared.push(data); }, canShare: () => true } });
  h.control(team(h), 'team-email').value = 'sam2@example.invalid';
  role(h, 'reviewer').checked = true;
  await form(h).fire('submit'); await h.settle();
  const result = team(h).all().find(el => el.className === 'team-result');
  const share = h.control(result, 'team-share');
  assert.equal(share.textContent, 'Share');
  assert.match(share.className, /tour-action-primary/);
  assert.ok(h.words(result).includes('They join as a reviewer, who can review and share.'));
  await share.fire('click');
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [{ title: 'Your Veylet invite', url: 'https://veylet.com/join?i=abcdefghijklmnopqrstuvwxyz012345' }]);
});

test('refusals and failures say what happened and keep what was typed', async () => {
  // The draft's own refusals (20260926123000_team_invites.sql).
  const cases = [
    [{ code: 'P0001', message: 'workspace owner only' }, 'Only the workspace owner can invite teammates.'],
    [{ code: 'P0001', message: 'too many pending invites (20); revoke one first' }, 'You have 20 invites waiting. Revoke one first.'],
    [{ code: 'P0001', message: 'too many invites today (50); try again tomorrow' }, 'You’ve made 50 invites today. Try again tomorrow.'],
    [{ code: 'P0001', message: 'a valid email address is required' }, 'Enter an email address like name@agency.com.au.'],
    [{ code: 'P0001', message: 'role is reviewer or operator' }, 'Choose what they can do.'],
    [{ message: 'Synthetic failure' }, 'The invite wasn’t created. Try again.'],
  ];
  for (const [error, words] of cases) {
    const h = await owner({ rpc: { invite_to_workspace: () => ({ data: null, error }) } });
    h.control(team(h), 'team-email').value = 'x@example.invalid';
    role(h, 'reviewer').checked = true;
    await form(h).fire('input');
    await form(h).fire('submit'); await h.settle();
    assert.ok(h.words(team(h)).includes(words), words);
    assert.equal(h.control(team(h), 'team-email').value, 'x@example.invalid');
    assert.equal(team(h).all().some(el => el.className === 'team-result'), false);
  }
  const offline = await owner({ rpc: { invite_to_workspace: () => { throw new TypeError('Failed to fetch'); } } });
  offline.control(team(offline), 'team-email').value = 'x@example.invalid';
  role(offline, 'reviewer').checked = true;
  await form(offline).fire('submit'); await offline.settle();
  assert.ok(offline.words(team(offline)).includes('You’re offline. Nothing was created.'));
  // A success without a usable link is not claimed as one.
  const odd = await owner({ rpc: { invite_to_workspace: () => ({ data: { invite_id: 'i-9', invite_url: null } }) } });
  odd.control(team(odd), 'team-email').value = 'x@example.invalid';
  role(odd, 'reviewer').checked = true;
  await form(odd).fire('submit'); await odd.settle();
  assert.ok(odd.words(team(odd)).includes('The invite wasn’t confirmed. Check the invites below before trying again.'));
  assert.equal(team(odd).all().some(el => el.className === 'team-result'), false);
});

test('Revoke is confirmed in place, Keep it undoes the first press, and the list is read again', async () => {
  const h = await owner();
  const first = invites(h)[0];
  const revoke = h.control(first, 'team-revoke');
  await revoke.fire('click');
  assert.equal(revoke.textContent, 'Confirm: revoke invite');
  assert.equal(revoke.dataset.armed, 'true');
  assert.ok(h.words(first).includes('Revoke the invite for sam@example.invalid? The link stops working. You can invite them again later. Confirm to continue.'));
  assert.equal(h.called('revoke_workspace_invite').length, 0);
  await h.control(first, 'team-revoke-keep').fire('click');
  assert.equal(revoke.textContent, 'Revoke');
  assert.ok(h.words(first).includes('Invite left unchanged.'));
  await revoke.fire('click'); await revoke.fire('click'); await h.settle();
  assert.deepEqual(h.called('revoke_workspace_invite'), [{ p_invite_id: 'i-1' }]);
  assert.equal(invites(h)[0].all().find(el => /\bpill\b/.test(el.className)).textContent, 'Revoked');
  assert.ok(h.words(team(h)).includes('Invite revoked. The link no longer works.'));
  // A failure keeps the invite and says so.
  const failing = await owner({ rpc: { revoke_workspace_invite: () => ({ data: null, error: { message: 'Synthetic failure' } }) } });
  const control = failing.control(invites(failing)[0], 'team-revoke');
  await control.fire('click'); await control.fire('click'); await failing.settle();
  assert.ok(failing.words(invites(failing)[0]).includes('The invite wasn’t revoked. Try again.'));
  assert.equal(control.textContent, 'Revoke');
});

test('an unreadable list keeps the form and offers Try again', async () => {
  let fail = true;
  const h = await owner({ rpc: { list_workspace_invites: () => (fail ? { data: null, error: { message: 'Synthetic failure' } } : { data: [] }) } });
  assert.ok(form(h), 'the owner can still invite');
  assert.ok(h.words(team(h)).includes('Invites couldn’t be loaded. Try again.'));
  fail = false;
  await h.control(team(h), 'team-retry').fire('click'); await h.settle();
  assert.ok(h.words(team(h)).includes('No invites yet.'));
});

test('a teammate reads their role and who has joined, and changes nothing but whether they stay', async () => {
  const h = await loadDesk({ role: 'reviewer', rpc: { list_workspace_invites: () => ({ data: ROWS }) } });
  const words = h.words(team(h));
  assert.ok(words.includes('You’re a reviewer in this workspace. Only the owner can invite teammates.'));
  assert.ok(words.includes('Teammates'));
  assert.equal(form(h), undefined);
  assert.deepEqual(invites(h).map(item => item.all().find(el => el.className === 'team-invite-email').textContent), ['jo@example.invalid']);
  assert.equal(team(h).all().some(el => ['team-revoke', 'team-remove', 'team-owner'].includes(el.dataset?.control)), false);
  const refused = await loadDesk({ role: 'operator', rpc: { list_workspace_invites: () => ({ data: null, error: { code: 'P0001', message: 'not a member of this workspace' } }) } });
  assert.deepEqual(refused.words(team(refused)), ['You’re an operator in this workspace. Only the owner can invite teammates.', 'Leave this office']);
});

test('signing in from an invite comes back to /join, by the email link and by the code', async () => {
  const out = await loadDesk({ signedOut: true, search: '?join=1', formData: { email: 'invitee@example.invalid', role_intent: 'owner' } });
  assert.equal(out.ids['account-intro'].textContent, 'Sign in to accept your team invite. Use the email address the invite was sent to.');
  await out.ids['account-sign-in'].fire('submit'); await out.settle();
  assert.equal(out.otp.length, 1);
  assert.equal(out.otp[0].options.emailRedirectTo, 'https://veylet.com/auth/callback?join=1');
  // Without the invite, the link returns to the account as before.
  const plainOut = await loadDesk({ signedOut: true, formData: { email: 'agent@example.invalid', role_intent: 'owner' } });
  await plainOut.ids['account-sign-in'].fire('submit'); await plainOut.settle();
  assert.equal(plainOut.otp[0].options.emailRedirectTo, 'https://veylet.com/auth/callback');
  // A signed-in session (after the code, or on the link's return) goes straight back to the invite.
  const inside = await loadDesk({ search: '?join=1' });
  assert.deepEqual(inside.redirects, ['/join']);
  assert.equal(inside.called('get_workspace_plan').length, 0, 'the desk is not read on the way');
  const callback = await loadDesk({ search: '?join=1', pathname: '/auth/callback' });
  assert.deepEqual(callback.redirects, ['/join']);
  const plain = await loadDesk({ pathname: '/auth/callback' });
  assert.deepEqual(plain.redirects, ['/account']);
  // The app's page never takes the detour.
  const app = await loadDesk({ appMode: true, search: '?join=1' });
  assert.deepEqual(app.redirects, []);
});

// list_workspace_members as the draft answers it: owners first, names from profiles, no email.
const PEOPLE = [
  { user_id: 'aaaa0000-0000-4000-8000-000000000001', display_name: 'Alex Example', email: null, role: 'owner', status: 'active', joined_at: '2026-06-01T00:00:00Z', is_self: true },
  { user_id: 'bbbb2222-0000-4000-8000-000000000002', display_name: 'Jo Operator', email: null, role: 'operator', status: 'active', joined_at: '2026-09-20T00:00:00Z', is_self: false },
  { user_id: 'bbbb2222-0000-4000-8000-000000000003', display_name: '  ', email: null, role: 'reviewer', status: 'active', joined_at: '2026-09-24T00:00:00Z', is_self: false },
  { user_id: 'bbbb2222-0000-4000-8000-000000000004', display_name: 'Pat Pending', email: null, role: 'operator', status: 'invited', joined_at: '2026-09-25T00:00:00Z', is_self: false },
];
const members = h => team(h).all().filter(el => el.className === 'team-invite team-person');
const nameOf = item => item.all().find(el => el.className === 'team-invite-email');

test('everyone sees the teammates by name, owners first, and invites stay a list of their own', async () => {
  const h = await owner({ rpc: { list_workspace_members: () => ({ data: PEOPLE.map(row => ({ ...row })) }) } });
  assert.deepEqual(h.called('list_workspace_members'), [{ p_workspace_id: 'w1' }]);
  const words = h.words(team(h));
  assert.ok(words.indexOf('Teammates') > -1 && words.indexOf('Teammates') < words.indexOf('Invites'), 'teammates, then invites');
  assert.deepEqual(members(h).map(item => nameOf(item).textContent), ['Alex Example', 'Jo Operator', 'Teammate', 'Pat Pending']);
  assert.equal(nameOf(members(h)[0]).children[0].textContent, ' (you)');
  assert.ok(h.words(members(h)[1]).includes('Operator'));
  assert.ok(h.words(members(h)[1]).includes('Joined 20 Sep 2026'));
  assert.ok(h.words(members(h)[3]).includes('Invited'));
  // The owner manages the other active members who are not owners, never their own row.
  assert.deepEqual(members(h).map(item => [Boolean(h.control(item, 'team-remove')), Boolean(h.control(item, 'team-owner'))]),
    [[false, false], [true, true], [true, true], [false, false]]);
  assert.equal(h.control(team(h), 'team-leave'), null);
  assert.equal(invites(h).length, ROWS.length, 'every invite is still listed');
  assert.equal(team(h).all().some(el => /@/.test(el.textContent) && el.className === 'team-invite-email' && el.parent?.className !== 'team-invite'), false,
    'no member row shows an email');
});

test('the owner removes a member, confirmed in place, by name', async () => {
  let people = PEOPLE.map(row => ({ ...row }));
  const h = await owner({ rpc: {
    list_workspace_members: () => ({ data: people.map(row => ({ ...row })) }),
    remove_workspace_member: args => { people = people.filter(row => row.user_id !== args.p_user_id); return { data: { state: 'removed', changed: true, invites_revoked: 0, shared_links_stopped: 2 } }; },
  } });
  const jo = members(h)[1];
  const remove = h.control(jo, 'team-remove');
  await remove.fire('click');
  assert.equal(remove.textContent, 'Confirm: remove');
  assert.ok(h.words(jo).includes('Remove Jo Operator? They lose access to this office’s walkthroughs. Shared walkthroughs they captured stop working for clients. Confirm to continue.'));
  await h.control(jo, 'team-remove-keep').fire('click');
  assert.ok(h.words(jo).includes('They stay in this office.'));
  assert.equal(h.called('remove_workspace_member').length, 0);
  await remove.fire('click'); await remove.fire('click'); await h.settle();
  assert.deepEqual(h.called('remove_workspace_member'), [{ p_workspace_id: 'w1', p_user_id: 'bbbb2222-0000-4000-8000-000000000002' }]);
  assert.ok(h.words(team(h)).includes('Removed Jo Operator. 2 shared walkthroughs they captured stopped working for clients.'));
  assert.deepEqual(members(h).map(item => nameOf(item).textContent), ['Alex Example', 'Teammate', 'Pat Pending'], 'both lists read again');
  // The nameless member is "Teammate" in the words too.
  const nameless = members(h)[1];
  await h.control(nameless, 'team-remove').fire('click');
  assert.ok(h.words(nameless).some(text => text.startsWith('Remove Teammate? ')));
});

test('Make owner sits behind More, is confirmed by name, and refused while a plan could still charge', async () => {
  const h = await owner({ rpc: { list_workspace_members: () => ({ data: PEOPLE }), transfer_workspace_ownership: () => ({ data: { state: 'transferred' } }) } });
  const jo = members(h)[1];
  const more = jo.all().find(el => el.tagName === 'DETAILS');
  assert.equal(more.children[0].textContent, 'More');
  assert.equal(more.children[0].getAttribute('aria-label'), 'More for Jo Operator');
  const make = h.control(more, 'team-owner');
  await make.fire('click');
  assert.ok(h.words(more).includes('Make Jo Operator the owner? You become a reviewer. Only the owner can invite or remove teammates. Confirm to continue.'));
  const reads = h.called('list_workspace_members').length;
  await make.fire('click'); await h.settle();
  assert.deepEqual(h.called('transfer_workspace_ownership'), [{ p_workspace_id: 'w1', p_new_owner: 'bbbb2222-0000-4000-8000-000000000002' }]);
  assert.ok(h.called('list_workspace_members').length > reads, 'the whole desk reads the new role');
  assert.equal(h.status(), 'Jo Operator is now the owner.');
  const billing = await owner({ rpc: { list_workspace_members: () => ({ data: PEOPLE }),
    transfer_workspace_ownership: () => ({ data: null, error: { code: 'P0001', message: 'cancel this workspace\'s card or App Store subscription before transferring it' } }) } });
  const press = billing.control(members(billing)[1], 'team-owner');
  await press.fire('click'); await press.fire('click'); await billing.settle();
  assert.ok(billing.words(members(billing)[1]).includes('Cancel or move the plan first, then transfer ownership.'));
  assert.equal(press.textContent, 'Make owner');
});

test('a teammate leaves from their own row, confirmed in place', async () => {
  const mine = PEOPLE.map(row => ({ ...row, is_self: row.user_id === 'bbbb2222-0000-4000-8000-000000000002' }));
  const h = await loadDesk({ role: 'operator', rpc: { list_workspace_invites: () => ({ data: ROWS }), list_workspace_members: () => ({ data: mine }),
    leave_workspace: () => ({ data: { state: 'left', changed: true, invites_revoked: 1, shared_links_stopped: 1 } }) } });
  assert.equal(h.words(team(h)).filter(text => text === 'Teammates').length, 1, 'one list: the members replace who joined by invite');
  assert.equal(members(h).length, PEOPLE.length);
  assert.equal(invites(h).length, 0, 'invites are the owner’s list');
  assert.equal(team(h).all().some(el => ['team-remove', 'team-owner', 'team-revoke'].includes(el.dataset?.control)), false);
  const own = members(h)[1];
  assert.equal(nameOf(own).children[0].textContent, ' (you)');
  const leave = h.control(own, 'team-leave');
  assert.equal(leave.textContent, 'Leave this office');
  assert.equal(team(h).all().filter(el => el.dataset?.control === 'team-leave').length, 1, 'only on their own row');
  await leave.fire('click');
  assert.ok(h.words(own).includes('You lose access to its walkthroughs. Shared walkthroughs you captured stop working for clients. The owner can invite you again. Confirm to continue.'));
  await h.control(own, 'team-leave-keep').fire('click');
  assert.ok(h.words(own).includes('You’re still in this office.'));
  await leave.fire('click'); await leave.fire('click'); await h.settle();
  assert.deepEqual(h.called('leave_workspace'), [{ p_workspace_id: 'w1' }]);
  assert.equal(h.status(), 'You left this office. 1 shared walkthrough you captured stopped working for clients.');
});

test('without the members list, or when it fails, the rest still works and nothing is guessed', async () => {
  // Missing (PGRST202): the owner's invites as before, nobody to remove; a teammate keeps Leave on its own.
  const noList = await owner();
  assert.equal(members(noList).length, 0);
  assert.equal(team(noList).all().some(el => ['team-remove', 'team-owner'].includes(el.dataset?.control)), false);
  const teammate = await loadDesk({ role: 'reviewer', rpc: { list_workspace_invites: () => ({ data: ROWS }), leave_workspace: () => ({ data: null }) } });
  assert.ok(teammate.control(team(teammate), 'team-leave'));
  // Only the members list: the section still shows for everyone.
  const onlyMembers = await loadDesk({ rpc: { list_workspace_members: () => ({ data: PEOPLE }) } });
  assert.equal(onlyMembers.ids['account-team'].hidden, false);
  assert.equal(form(onlyMembers), undefined, 'no invite form without the invite functions');
  assert.equal(members(onlyMembers).length, PEOPLE.length);
  // A failed read says so and offers Try again; a teammate can still leave.
  let fail = true;
  const failing = await owner({ rpc: { list_workspace_members: () => (fail ? { data: null, error: { message: 'Synthetic failure' } } : { data: PEOPLE }) } });
  assert.ok(failing.words(team(failing)).includes('Teammates couldn’t be loaded. Try again.'));
  fail = false;
  await failing.control(team(failing), 'team-retry').fire('click'); await failing.settle();
  assert.equal(members(failing).length, PEOPLE.length);
  const failingMate = await loadDesk({ role: 'operator', rpc: { list_workspace_invites: () => ({ data: ROWS }), list_workspace_members: () => ({ data: null, error: { message: 'x' } }) } });
  assert.ok(failingMate.control(team(failingMate), 'team-leave'));
  // Rows the draft does not describe are left out; a Remove answered PGRST202 goes away and stays away.
  const odd = await owner({ rpc: { list_workspace_members: () => ({ data: [{ user_id: 'not-a-uuid', role: 'owner', status: 'active' }, { ...PEOPLE[1], role: 'admin' }, PEOPLE[1]] }) } });
  assert.deepEqual(members(odd).map(item => nameOf(item).textContent), ['Jo Operator']);
  const gone = await owner({ rpc: { list_workspace_members: () => ({ data: PEOPLE }), remove_workspace_member: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  const remove = gone.control(members(gone)[1], 'team-remove');
  await remove.fire('click'); await remove.fire('click'); await gone.settle();
  assert.equal(remove.parent.hidden, true);
  await gone.ids['account-refresh'].fire('click'); await gone.settle();
  assert.equal(gone.control(members(gone)[1], 'team-remove'), null);
  const failingRemove = await owner({ rpc: { list_workspace_members: () => ({ data: PEOPLE }), remove_workspace_member: () => ({ data: null, error: { message: 'Synthetic failure' } }) } });
  const press = failingRemove.control(members(failingRemove)[1], 'team-remove');
  await press.fire('click'); await press.fire('click'); await failingRemove.settle();
  assert.ok(failingRemove.words(members(failingRemove)[1]).includes('They weren’t removed. Try again.'));
  assert.equal(press.disabled, false);
});

test('deleting an owner’s account while teammates remain points to Your team, only when the refusal says so', async () => {
  const h = await owner({ rpc: { request_account_deletion: () => ({ data: null, error: { code: 'P0001', message: 'Transfer ownership or remove your teammates first.' } }) } });
  const panel = h.ids['account-deletion'];
  await h.button(panel, 'Delete my account').fire('click');
  await h.button(panel, 'Delete my account').fire('click'); await h.settle();
  assert.ok(h.words(panel).includes('Transfer ownership or remove your teammates first.'));
  const open = h.control(panel, 'deletion-team');
  assert.equal(open.textContent, 'Open Your team');
  assert.equal(open.href, '#account-team');
  assert.ok(h.button(panel, 'Keep my account'));
  assert.equal(h.status(), 'Transfer ownership or remove your teammates first.');
  // Today's refusal is one message for many conditions: it keeps the existing words.
  const generic = await owner({ rpc: { request_account_deletion: () => ({ data: null, error: { code: 'P0001', message: 'shared ownership requires reviewed transfer before deletion' } }) } });
  const panel2 = generic.ids['account-deletion'];
  await generic.button(panel2, 'Delete my account').fire('click');
  await generic.button(panel2, 'Delete my account').fire('click'); await generic.settle();
  assert.ok(generic.words(panel2).includes('The deletion request was not confirmed. Check again before asking a second time.'));
  assert.equal(generic.control(panel2, 'deletion-team'), null);
  // Files left under this account after handing an office over: the server's sentence as it is.
  const files = await owner({ rpc: { request_account_deletion: () => ({ data: null, error: { code: 'P0001',
    message: 'walkthrough files you uploaded to a workspace you handed over are stored under your account; the studio moves them before deletion' } }) } });
  const panel3 = files.ids['account-deletion'];
  await files.button(panel3, 'Delete my account').fire('click');
  await files.button(panel3, 'Delete my account').fire('click'); await files.settle();
  assert.ok(files.words(panel3).includes('Walkthrough files you uploaded to a workspace you handed over are stored under your account; the studio moves them before deletion.'));
});
