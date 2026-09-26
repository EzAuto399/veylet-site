'use strict';
// Exact QA route only. This file is outside dist and never shipped.
(() => {
  const params = new URLSearchParams(location.search);
  // Player v2 (streamed packages): `?format=v2` answers every tour and share
  // with the package served by `serve-player-check.py --package-v2` at
  // /__qa/v2/. `?graphics=none` removes WebGL and WebGPU before any player
  // script runs, to see the no-3D fallback. Both exist only on QA routes.
  const streamed = params.get('format') === 'v2';
  const V2_BASE = '/__qa/v2/';
  /* The agent's opt-in contact, as the sibling repository's migration
   * 20260925130000_agent_public_contact.sql (not yet released) answers it. One
   * `?contact=` switch serves both pages; left out, each page answers as it does
   * today. The contact is the synthetic Alex Example, Example Realty,
   * +61 400 000 000, alex@example.invalid.
   * - /__qa/handoff/ and /__qa/embed/ (lookup_tour_share_contact): by default a
   *   live link returns the contact. `none`, `empty` and `hidden` return no row (not
   *   shown to clients), `shown` and `readonly` return it, `phone` or `email` return
   *   only that way to reach them, `missing` answers PGRST202 as a backend without
   *   the function does, `error` fails and `loading` never answers. A missing or
   *   failing share (`?case=missing|errors`) returns no contact either.
   * - /__qa/account/ (get_workspace_public_contact, "What your clients see"): by
   *   default `missing` (PGRST202), so the section stays away as today. `empty` is a
   *   workspace with no contact yet, `shown` the contact shown to clients, `hidden`
   *   the same details not shown, `error` fails, `loading` never answers, and
   *   `readonly` reads the shown contact while every save answers "contact permission
   *   required". `none`, `phone` and `email` read as `empty` and a shown contact with
   *   one way to reach them.
   * set_workspace_public_contact trims each field as the migration does, refuses
   * what it refuses, keeps the row for the next read and echoes it back.
   * `&contact-save=permission|phone|fail|offline|expired` answers every save with
   * "contact permission required", the phone refusal, a failure, a lost connection
   * (TypeError "Failed to fetch") or an expired sign-in (PGRST301). */
  const contactCase = params.get('contact') || 'show';
  const deskContactCase = params.get('contact') || 'missing';
  const contactSaveCase = params.get('contact-save');
  let savedContact = null;
  /* Pause, resume and views (the integrator lane's 2026092610xxxx migration, not yet
   * written): pause_tour_share(p_tour_id) keeps the token and sets
   * tours.share_paused_at, so lookup_tour_share answers nothing while it is set;
   * resume_tour_share(p_tour_id) clears it and answers the same token.
   * `?pause=paused` starts the live walkthrough on /__qa/account/ paused;
   * `missing` answers the share_paused_at column with 42703 and both functions with
   * PGRST202, as a database without the migration does (no Pause is offered);
   * `fail` fails every pause and resume. `?pause=paused` on /__qa/handoff/,
   * /__qa/embed/ and /__qa/tour/ makes the link read as paused ("not available").
   * record_tour_view(p_token, p_kind, p_src, p_host, p_detail) is recorded in
   * window.VEYLET_QA_CALLS, whether it arrives through client.rpc or through the
   * viewer beacon's own POST to /rest/v1/rpc/record_tour_view (this fixture answers
   * that URL instead of the network). get_tour_view_stats(p_tour_id) answers 14
   * opens on 5 days, 3 Call taps, 1 Email tap, 2 Share taps, by channel (link 8,
   * qr 4, embed 2) and by site (example-agency.invalid 2), last opened yesterday.
   * `?views=zero` answers no opens yet, `missing` answers PGRST202 to both functions
   * (the desk shows no views, the beacon stops), `error` fails both. */
  /* Email preferences: the tips-and-offers box of the sibling repository's
   * docs/lifecycle-email.md and its draft 20260926114000_lifecycle_email.sql (not yet
   * released). `?email=` answers get_email_preferences: by default `missing`
   * (PGRST202 for both functions, as today's backend: no box on the sign-in form and
   * no Email preferences in Account). `out` is a recorded "no" (tips_opt_in false, the
   * default for everyone), `in` a recorded "yes" on tips-v1, `v2` a "no" whose current
   * wording is a fictional tips-v2 ("Email me tips, offers and product news from Veylet
   * Studio. I can unsubscribe at any time."), `bad` an answer without a choice, `error`
   * fails the read and `loading` never answers. Signed out (`?session=out`) the function
   * refuses with "sign in required" unless it is missing, which is how the sign-in form
   * tells the box can be recorded. set_email_tips_preference checks what the draft
   * checks (a source of signup, account or app; a known wording to opt in), keeps the
   * choice for the next read (every call is in VEYLET_QA_CALLS with its arguments).
   * `&email-save=fail|offline|expired|missing|slow` answers every save with a
   * failure, a lost connection, an expired sign-in, PGRST202, or after 1.5 s.
   * `&email-open=1` opens the Email preferences disclosure for a capture. */
  const emailCase = params.get('email') || 'missing';
  const emailSaveCase = params.get('email-save');
  const EMAIL_WORDINGS = { 'tips-v1': 'Email me tips and offers from Veylet Studio. I can unsubscribe at any time.',
    'tips-v2': 'Email me tips, offers and product news from Veylet Studio. I can unsubscribe at any time.' };
  const emailMissing = name => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' } });
  let emailChoice = emailCase === 'in' ? { tips_opt_in: true, wording_version: 'tips-v1', changed_at: '2026-09-20T01:00:00Z' }
    : { tips_opt_in: false, wording_version: null, changed_at: null };
  const pauseCase = params.get('pause');
  const viewsCase = params.get('views');
  const pausedAt = new Map();
  const viewsMissing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
  /* Sharing and the connection on /__qa/account/ (the desk's S1 states).
   * `?share=review|uploader|permission` makes enable_tour_share raise the migration's
   * "review this tour before sharing", "tour uploader membership is no longer active"
   * or "sharing permission required"; `fail` fails it; `lost` turns sharing on (the
   * link is live on the next read) but the answer comes back as supabase-js reports a
   * dropped connection. Without it, sharing turns on as before.
   * `?offline=first` loses the first desk read (spaces, walkthroughs, memberships:
   * TypeError "Failed to fetch"), so the desk says it is offline with nothing to show;
   * the next read (the window's online event) succeeds. `list` reads the desk once,
   * then loses every later desk read (Refresh spaces, coming back to the tab), so the
   * drawn desk stays with its time. `status` loses every list_workspace_render_status
   * read. `?share-sheet=none` removes navigator.share (Copy link only); `native` stubs
   * a navigator.share that resolves, so the filled Share shows in a desktop browser;
   * `?share-sheet=` works on /__qa/handoff/ too (Copy link or Share). */
  const shareCase = params.get('share');
  const offlineCase = params.get('offline');
  let deskReads = 0;
  const lostConnection = () => new TypeError('Failed to fetch');
  const deskReadLost = table => ['properties', 'tours', 'memberships'].includes(table)
    && ((offlineCase === 'first' && deskReads <= 1) || (offlineCase === 'list' && deskReads > 1));
  const shareSheet = params.get('share-sheet');
  if (shareSheet === 'none' || shareSheet === 'native') {
    const stub = shareSheet === 'native'
      ? { share: async data => { window.VEYLET_QA_CALLS?.push({ name: 'navigator.share', args: { title: data?.title, url: data?.url } }); }, canShare: () => true }
      : { share: undefined, canShare: undefined };
    for (const [key, value] of Object.entries(stub)) {
      try { Object.defineProperty(navigator, key, { value, configurable: true }); } catch { /* read-only here */ }
    }
  }
  if (params.get('graphics') === 'none') {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl|webgpu/i.test(kind) ? null : getContext.call(this, kind, ...rest); };
    try { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); } catch { /* not present */ }
    try { delete window.WebGL2RenderingContext; window.WebGL2RenderingContext = undefined; } catch { /* read-only */ }
  }
  const handoffIDs = ['cccccccc-2222-4333-8444-555555555555', 'dddddddd-2222-4333-8444-555555555555'];
  const scenario = params.get('case') || (handoffIDs.includes(params.get('id')) ? 'capture-handoff' : 'review');
  const user = { id: 'synthetic-user', email: 'review@example.invalid' };
  // Per walkthrough: approval, a live link and the set-once release moment.
  const approvedTours = new Set(), tokens = new Map(), releasedAt = new Map();
  let callback;
  const revisionKey = 'veylet-qa-package-revision-v1';
  const packageRevision = () => localStorage.getItem(revisionKey) || 'a'.repeat(64);
  const tours = [{ id: 'synthetic-tour', property_id: 'synthetic-property', status: 'ready', storage_path: 'synthetic/fixture.zip', created_by: 'synthetic-user', created_at: '2026-09-20T12:00:00Z' }];
  if (scenario === 'capture-handoff') tours.splice(0, 1, ...handoffIDs.map((id, index) => ({
    ...tours[0], id, storage_path: `synthetic/handoff-${index}.zip`, created_at: '2026-09-21T12:00:00Z',
  })));
  const properties = [{ id: 'synthetic-property', title: 'Fictional practice space', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' }];
  // Hosting fixtures, on the default review desk and `?case=hosting-errors`:
  // live with the plan active, live after the plan ended (within and past its
  // term), approved but never shared, and sharing turned off after release,
  // beside the walkthrough still awaiting approval above. Dates are relative
  // to today, so the words stay true whenever this runs.
  const DAY = 86400000;
  const ago = days => new Date(Date.now() - days * DAY).toISOString();
  const addMonths = (iso, count) => { const when = new Date(iso); when.setUTCMonth(when.getUTCMonth() + count); return when.toISOString(); };
  const hostingCase = ['review', 'hosting-errors'].includes(scenario);
  const planActiveFor = { 'synthetic-workspace': true, 'synthetic-workspace-ended': false };
  const extendedUntil = new Map();
  if (hostingCase) {
    properties.push(
      { id: 'synthetic-office', title: 'Fictional corner office', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' },
      { id: 'synthetic-venue', title: 'Fictional hall', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace-ended' });
    const base = { status: 'ready', created_by: 'synthetic-user' };
    const extra = [
      { ...base, id: 'synthetic-live-active', property_id: 'synthetic-office', storage_path: 'synthetic/live-active.zip', created_at: '2026-08-02T12:00:00Z', approved: true, token: 'synthetic-fixture-token-live1', released: ago(20) },
      { ...base, id: 'synthetic-approved', property_id: 'synthetic-office', storage_path: 'synthetic/approved.zip', created_at: '2026-08-01T12:00:00Z', approved: true },
      { ...base, id: 'synthetic-live-ended', property_id: 'synthetic-venue', storage_path: 'synthetic/live-ended.zip', created_at: '2026-03-10T12:00:00Z', approved: true, token: 'synthetic-fixture-token-live2', released: ago(200) },
      { ...base, id: 'synthetic-live-past', property_id: 'synthetic-venue', storage_path: 'synthetic/live-past.zip', created_at: '2025-06-02T12:00:00Z', approved: true, token: 'synthetic-fixture-token-live3', released: ago(420) },
      { ...base, id: 'synthetic-shared-off', property_id: 'synthetic-venue', storage_path: 'synthetic/shared-off.zip', created_at: '2025-05-01T12:00:00Z', approved: true, released: ago(300) },
    ];
    for (const { approved: ok, token: live, released, ...row } of extra) {
      tours.push(row);
      if (ok) approvedTours.add(row.id);
      if (live) tokens.set(row.id, live);
      if (released) releasedAt.set(row.id, released);
    }
  }
  if (pauseCase === 'paused' && tokens.has('synthetic-live-active')) pausedAt.set('synthetic-live-active', ago(2));
  /* Listing exports (C3): the sibling repository's draft
   * supabase/drafts/release-2/20260926113000_listing_exports.sql (not released) and
   * its contract, docs/render-status-contract-20260925.md "Listing exports (C3)".
   * `?exports=` answers get_listing_exports for the live walkthrough on
   * /__qa/account/ (synthetic-live-active); every other walkthrough answers nothing
   * requested with the same statement version. By default `missing` (PGRST202 for the
   * three functions, as today's backend: no block anywhere). `soon` is the draft's
   * seeded statement, still inactive (version null: "Exports open soon."); `request` the
   * statement active with nothing requested (Make listing videos records the request,
   * which then reads `requested`); `requested`, `rendering`, `needs-attention`, `ready`
   * (three files: 18.6 MB, 6.9 MB and 520 KB), `ready-locked` (ready, downloadable false),
   * `partner-only`, `failed` (statement active, so Try again asks again), `failed-soon`
   * (failed while no statement is active: its version is null, so there is nothing to press), `unknown-version`
   * (an active version this page has no words for), `error` fails the read and `loading`
   * never answers. `&exports-request=inactive|approve|unavailable|fail|expired` refuses
   * every request with the draft's words, a failure or an expired sign-in.
   * Downloads use veylet-hooks' POST /listing-exports/download (the sibling repository's
   * deploy/hooks-vercel/listing_exports/download.py, not deployed), stood in for below: it
   * answers a link on downloads.fixture.invalid, which this fixture records instead of
   * opening. `&exports-download=` answers with its statuses and {error} codes: `invalid`
   * 400, `expired` 401, `not-allowed` 403, `unknown` 404, `not-ready` 409 needs_attention
   * (the export now reads needs_attention, so the page's re-read shows it), `too-many` 429,
   * `fail` 502, `not-open` 503 not_configured. `&exports-open=1` opens the live walkthrough's block for a capture
   * (on /__qa/account/ and /__qa/app-account/). */
  const exportsCase = params.get('exports') || 'missing';
  const exportsRequestCase = params.get('exports-request');
  const exportsDownloadCase = params.get('exports-download');
  const EXPORT_VERSION = 'export-consent-v0-draft';
  const EXPORT_TOUR = 'synthetic-live-active';
  const EXPORT_KINDS = ['stills', 'video_16x9', 'video_9x16'];
  const EXPORT_NAMES = { video_16x9: 'listing-16x9.mp4', video_9x16: 'social-9x16.mp4', stills: 'stills.zip' };
  const EXPORT_FILES = { video_16x9: { bytes: 18600000, sha256: '1'.repeat(64), content_type: 'video/mp4' },
    video_9x16: { bytes: 6900000, sha256: '2'.repeat(64), content_type: 'video/mp4' },
    stills: { bytes: 520000, sha256: '3'.repeat(64), content_type: 'application/zip' } };
  const exportsMissing = name => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' } });
  // The active statement version, as get_listing_exports names it when nothing is requested.
  const exportsVersion = exportsCase === 'unknown-version' ? 'export-consent-v9' : ['soon', 'failed-soon'].includes(exportsCase) ? null : EXPORT_VERSION;
  const exportStart = { requested: 'requested', rendering: 'rendering', 'needs-attention': 'needs_attention', ready: 'ready',
    'ready-locked': 'ready', 'partner-only': 'partner_only', failed: 'failed', 'failed-soon': 'failed' }[exportsCase] || null;
  const exportRows = new Map();
  const exportId = tourId => 'e0e0e0e0-0000-4000-8000-' + String(tourId).replace(/[^a-f0-9]/g, '').padEnd(12, '0').slice(0, 12);
  if (exportStart) exportRows.set(EXPORT_TOUR, { state: exportStart, requested_at: ago(1), consent_version: EXPORT_VERSION, locked: exportsCase === 'ready-locked' });
  // The member's view of an export (listing_export_json): sizes and hashes, never storage keys.
  function exportJson(tourId) {
    const row = exportRows.get(tourId);
    if (!row) return { tour_id: tourId, state: null, requested: false, downloadable: false, consent_version: exportsVersion };
    const rendered = ['ready', 'needs_attention', 'partner_only'].includes(row.state);
    return { export_id: exportId(tourId), tour_id: tourId, kinds: [...EXPORT_KINDS], state: row.state, requested: true,
      // A failed row names the active version (null while none is), so Try again follows a new wording.
      requested_at: row.requested_at, consent_version: row.state === 'failed' ? exportsVersion : row.consent_version, acknowledged_cannot_recall: true,
      screening: rendered ? { ready: 'clear', needs_attention: 'needs_attention', partner_only: 'unavailable' }[row.state] : null,
      screening_counts: rendered ? { face: row.state === 'needs_attention' ? 1 : 0, document: 0, text: 0 } : null,
      rendered_at: rendered || row.state === 'failed' ? ago(0.02) : null, error_code: row.state === 'failed' ? 'export_failed' : null,
      files: rendered ? EXPORT_FILES : {},
      downloadable: row.state === 'ready' && approvedTours.has(tourId) && !row.locked, updated_at: ago(0.01) };
  }
  /* Is anyone living here? (tenant consent before sharing): the backend lane's release-2
   * drafts (not released) and the sibling repository's docs/launch-readiness-plan-20260925.md
   * C2. `?occupancy=` answers get_listing_sharing_readiness for every listing: by default
   * `missing` (PGRST202 for the three functions, as today's backend: no question anywhere,
   * sharing as before). `question` has nothing declared (blocked occupancy_not_declared),
   * `tenanted` tenants without consent (tenant_consent_required), `vacant`, `owner` and
   * `consented` (tenants, consent recorded yesterday, reference "Form 18a signed copy")
   * need nothing, `mixed` is the practice space unanswered, the corner office tenanted and
   * the hall empty, `error` fails the read and `loading` never answers. A listing with a
   * live link is grandfathered while it is blocked (its link keeps working). While a
   * listing is blocked, enable_tour_share, resume_tour_share and request_listing_exports
   * refuse with "occupancy not declared" or "tenant consent required", as the drafts do.
   * set_listing_occupancy and record_tenant_consent check what the drafts check and keep
   * the answer for the next read; `&occupancy-save=permission|fail|offline|expired|missing`
   * answers every save with "sharing permission required", a failure, a lost connection,
   * an expired sign-in or PGRST202. `&occupancy-open=1` opens every grandfathered
   * listing's quiet question for a capture. */
  const occupancyCase = params.get('occupancy') || 'missing';
  const occupancySaveCase = params.get('occupancy-save');
  const occupancyMissing = name => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' } });
  const occupancyStart = { question: 'unknown', tenanted: 'tenanted', vacant: 'vacant', owner: 'owner_occupied', consented: 'tenanted' }[occupancyCase];
  const occupancy = new Map();
  for (const place of properties) {
    const start = occupancyCase === 'mixed' ? { 'synthetic-office': 'tenanted', 'synthetic-venue': 'vacant' }[place.id] || 'unknown' : occupancyStart || 'unknown';
    occupancy.set(place.id, { occupancy: start, consentAt: occupancyCase === 'consented' ? ago(1) : null, reference: occupancyCase === 'consented' ? 'Form 18a signed copy' : null });
  }
  const occupancyBlocked = propertyId => {
    if (occupancyCase === 'missing') return null;
    const row = occupancy.get(propertyId);
    if (!row) return null;
    return row.occupancy === 'unknown' ? 'occupancy_not_declared' : row.occupancy === 'tenanted' && !row.consentAt ? 'tenant_consent_required' : null;
  };
  const occupancyRefusal = propertyId => ({ occupancy_not_declared: 'occupancy not declared', tenant_consent_required: 'tenant consent required' })[occupancyBlocked(propertyId)] || null;
  const tourProperty = tourId => tours.find(tour => tour.id === tourId)?.property_id || null;
  /* Team (invite a teammate): the release-2 drafts (not released). `?team=` answers
   * list_workspace_invites on /__qa/account/: by default `missing` (PGRST202 for the
   * invite functions: no Team section). `owner` lists four invites (pending reviewer,
   * accepted operator, revoked, expired), `owner-empty` none, `member` makes this account
   * a reviewer who can read the list (read-only), `member-refused` an operator the list
   * refuses ("workspace owner required"), `error` fails and `loading` never answers.
   * invite_to_workspace (owner only, reviewer or operator) adds a pending invite and
   * answers a https://veylet.com/join?i=… link that expires in 7 days; no email is sent.
   * revoke_workspace_invite marks it revoked. `&team-invite=permission|email|role|pending|today|fail|offline|expired|bad-url`
   * and `&team-revoke=fail` refuse or fail those presses, in the draft's words
   * (20260926123000_team_invites.sql). `&team-created=1` creates an invite once (reviewer,
   * new.agent@example.invalid) for a capture of the link.
   * Members: list_workspace_members answers this account (Alex Example, the owner), Jo Operator
   * and a reviewer without a name ("Teammate"); as `member` this account is that reviewer.
   * `&team-members=missing|error` answers it with PGRST202 or a failure. The owner sees Remove
   * (remove_workspace_member) and More › Make owner (transfer_workspace_ownership; this account
   * then reads as a reviewer) on the others' rows, and `member` sees Leave this office
   * (leave_workspace) on their own row. Remove and leave answer draft 20260926126000's
   * live_links_kept (2) and departed_display_name. `&team-member=missing|fail|billing` answers those
   * three with PGRST202 or a failure, or refuses the transfer for a live subscription. While
   * a member remains, the owner's request_account_deletion is refused with the backend lane's
   * wording (draft 20260926131000: "Transfer ownership or remove your teammates first.");
   * `&deletion-refusal=generic` uses today's one message for every condition instead. */
  const teamCase = params.get('team') || 'missing';
  const teamInviteCase = params.get('team-invite');
  const teamRevokeCase = params.get('team-revoke');
  const teamMemberCase = params.get('team-member');
  let teamOwnerNow = true, teamLeft = false;
  const teamRemoved = new Set();
  const teamMissing = name => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + ' in the schema cache' } });
  const teamInvites = ['owner', 'member'].includes(teamCase) ? [
    { invite_id: 'aaaa1111-0000-4000-8000-000000000001', email: 'sam.reviewer@example.invalid', role: 'reviewer', status: 'pending', created_at: ago(1), expires_at: ago(-6) },
    { invite_id: 'aaaa1111-0000-4000-8000-000000000002', email: 'jo.operator@example.invalid', role: 'operator', status: 'accepted', created_at: ago(9), expires_at: ago(5), accepted_at: ago(8), revoked_at: null, user_id: 'bbbb2222-0000-4000-8000-000000000002' },
    { invite_id: 'aaaa1111-0000-4000-8000-000000000003', email: 'old.link@example.invalid', role: 'reviewer', status: 'revoked', created_at: ago(20), expires_at: ago(13) },
    { invite_id: 'aaaa1111-0000-4000-8000-000000000004', email: 'late.reply@example.invalid', role: 'operator', status: 'expired', created_at: ago(30), expires_at: ago(23) },
  ] : [];
  let teamSerial = 10;
  // list_workspace_members: this account, a named operator and a reviewer without a name. `&team-members=missing|error`.
  const teamMembersCase = params.get('team-members');
  const teamPeople = ['owner', 'owner-empty', 'member', 'member-refused'].includes(teamCase) ? [
    { user_id: '5e1f0000-0000-4000-8000-000000000001', display_name: 'Alex Example', email: null, role: 'owner', status: 'active', joined_at: ago(120), self: true },
    { user_id: 'bbbb2222-0000-4000-8000-000000000002', display_name: 'Jo Operator', email: null, role: 'operator', status: 'active', joined_at: ago(8) },
    { user_id: 'bbbb2222-0000-4000-8000-000000000003', display_name: null, email: null, role: 'reviewer', status: 'active', joined_at: ago(3) },
  ] : [];
  // As a teammate (`member`, `member-refused`) this account is the nameless one.
  const teamSelf = () => (['member', 'member-refused'].includes(teamCase) ? teamPeople[teamCase === 'member' ? 2 : 1] : teamPeople[0])?.user_id;
  // Downloads are recorded, never opened: the link's host does not exist.
  const DOWNLOAD_HOST = 'https://downloads.fixture.invalid/';
  if (typeof HTMLAnchorElement === 'function') {
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (String(this.href || '').startsWith(DOWNLOAD_HOST)) { window.VEYLET_QA_CALLS.push({ name: 'open download', args: { href: this.href, download: this.download } }); return; }
      return anchorClick.call(this);
    };
  }
  function hostingRow(tour) {
    const property = properties.find(row => row.id === tour.property_id);
    const released = releasedAt.get(tour.id) || null;
    const guaranteed = released ? addMonths(released, 12) : null;
    const extended = extendedUntil.get(tour.id) || null;
    const hosted = guaranteed && extended && extended > guaranteed ? extended : guaranteed;
    return { tour_id: tour.id, property_id: tour.property_id, status: tour.status, approved: approvedTours.has(tour.id),
      share_token: tokens.get(tour.id) || null, sharing_on: tokens.has(tour.id), released_at: released,
      guaranteed_until: guaranteed, extended_until: extended, hosted_until: hosted,
      plan_active: planActiveFor[property?.workspace_id] === true };
  }
  /* Corrections on one walkthrough (20260924140000). `?case=correction`: version 1
   * of a walkthrough is live and the studio's correction (version 2) waits for its
   * check; a second space holds a walkthrough whose version 2 already replaced
   * version 1, which is not listed. `?case=correction-superseded`: approving
   * version 2 is refused because a version 3 was approved meanwhile. `?lineage=missing`
   * answers the tour query as a database without the lineage columns does. */
  const everApproved = new Set();
  const WALK = { one: '1a2b3c4d-0000-4000-8000-000000000001', two: '5e6f7a8b-0000-4000-8000-000000000002',
    other: '2b3c4d5e-0000-4000-8000-000000000003', otherTwo: '6f7a8b9c-0000-4000-8000-000000000004', three: '7a8b9c0d-0000-4000-8000-000000000005' };
  const correctionCase = ['correction', 'correction-superseded'].includes(scenario);
  if (correctionCase) {
    properties.push({ id: 'synthetic-office', title: 'Fictional corner office', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' });
    const base = { status: 'ready', created_by: 'synthetic-user' };
    tours.splice(0, tours.length,
      { ...base, id: WALK.two, property_id: 'synthetic-property', storage_path: 'synthetic/correction-v2.zip', created_at: ago(1),
        walkthrough_id: WALK.one, revision: 2, revision_of: WALK.one, superseded_at: null },
      { ...base, id: WALK.one, property_id: 'synthetic-property', storage_path: 'synthetic/correction-v1.zip', created_at: ago(30),
        walkthrough_id: WALK.one, revision: 1, revision_of: null, superseded_at: null },
      { ...base, id: WALK.otherTwo, property_id: 'synthetic-office', storage_path: 'synthetic/other-v2.zip', created_at: ago(40),
        walkthrough_id: WALK.other, revision: 2, revision_of: WALK.other, superseded_at: null },
      { ...base, id: WALK.other, property_id: 'synthetic-office', storage_path: 'synthetic/other-v1.zip', created_at: ago(60),
        walkthrough_id: WALK.other, revision: 1, revision_of: null, superseded_at: ago(39) });
    for (const id of [WALK.one, WALK.otherTwo]) { approvedTours.add(id); everApproved.add(id); }
    everApproved.add(WALK.other);
    tokens.set(WALK.one, 'synthetic-fixture-token-w1'); releasedAt.set(WALK.one, ago(28));
    tokens.set(WALK.otherTwo, 'synthetic-fixture-token-w2'); releasedAt.set(WALK.otherTwo, ago(58));
  }
  const walkthroughOf = tour => tour.walkthrough_id || tour.id;
  const revisionOf = tour => tour.revision || 1;
  /* Super fast renders (code express; offer 2026-09-25.2 and the owner's 25 September
   * decision: about 30 minutes any time, no daily cap; get_express_offer, POST
   * /square/express/checkout, use_express_credit). `?express=` adds the fictional
   * terrace house with one sent capture and picks the answer: offer (A$29, ready 30
   * minutes from now, no cap), credit (4 super fast renders from the early-annual
   * bonus), full (an older answer still counted against a cap of 5, all taken),
   * not-owner, ordered (paid by card, due in 25 minutes), ordered-credit, met (ready in
   * time), missed (late, A$29 refunded), missed-pending (refund on its way),
   * missed-credit (render returned), capacity (offer 2026-09-26.3, 20260926140000: fast
   * GPUs are not starting quickly, so available false, reason 'capacity', can_order false
   * and no ready_by), error or missing (the function does not exist
   * yet). Without it the answer lists no capture, so no space shows a super fast block.
   * `&express-checkout=<error code>|fail` refuses the next card order;
   * `&express-card=open` presses Super fast for A$29 once. */
  const expressCase = params.get('express') || 'none';
  const EXPRESS_JOB = 'e1f2a3b4-0000-4000-8000-0000000000e1';
  if (!['none', 'error', 'missing'].includes(expressCase)) {
    properties.push({ id: 'synthetic-terrace', title: 'Fictional terrace house', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' });
  }
  /* Render status (the sibling repository's docs/render-status-contract-20260925.md), as
   * list_workspace_render_status answers in migration 20260925110000_render_status.sql
   * (not yet released). `?render=` picks the state of the fictional terrace house's
   * capture (the express fixture's capture): uploading, waiting, rendering, checking (an
   * older backend's studio_check: the automatic quality gate, drawn as step 5 of 5),
   * ready, live, recapture, retrying, failed or stale. `all` gives each state its own
   * fictional space; `walk` moves the capture one step on at every read (sending, 2nd
   * then 1st in line, steps 1 to 5 with Checking quality last, then ready for review
   * once its tour is released; no person checks it); `empty` answers no captures,
   * `loading` never answers, `error` fails, and `missing` (the default) is a backend
   * without the function. `&render-poll=error` fails every read after the first, and
   * `&render-fields=none` sends no percentage, step, time left, position or start. */
  const renderCase = params.get('render') || 'missing';
  const RENDER_STATES = ['uploading', 'waiting', 'rendering', 'checking', 'ready', 'live', 'recapture', 'retrying', 'failed', 'stale'];
  const RENDER_SPACES = { uploading: 'Fictional garden flat', waiting: 'Fictional corner shop', rendering: 'Fictional terrace house',
    checking: 'Fictional loft conversion', ready: 'Fictional beach cottage', live: 'Fictional dental suite', recapture: 'Fictional old bakery',
    retrying: 'Fictional town hall', failed: 'Fictional boat shed', stale: 'Fictional art gallery' };
  // One capture per state: the terrace house's is the express fixture's capture.
  const renderSpace = state => (renderCase === 'all' && state !== 'rendering' ? 'render-' + state : 'synthetic-terrace');
  const renderJobOf = state => (renderSpace(state) === 'synthetic-terrace' ? EXPRESS_JOB
    : 'f' + String(RENDER_STATES.indexOf(state) + 1).padStart(7, '0') + '-0000-4000-8000-' + String(RENDER_STATES.indexOf(state) + 1).padStart(12, '0'));
  const renderTourOf = state => 'render-tour-' + state;
  const renderShown = renderCase === 'all' ? RENDER_STATES : RENDER_STATES.includes(renderCase) ? [renderCase] : renderCase === 'walk' ? ['walk'] : [];
  if ((renderShown.length || ['empty', 'loading', 'error'].includes(renderCase)) && !properties.some(row => row.id === 'synthetic-terrace')) {
    properties.push({ id: 'synthetic-terrace', title: 'Fictional terrace house', category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' });
  }
  if (renderCase === 'all') {
    for (const state of RENDER_STATES.filter(item => item !== 'rendering')) {
      properties.push({ id: renderSpace(state), title: RENDER_SPACES[state], category: 'QA fixture', location_general: 'Example region', workspace_id: 'synthetic-workspace' });
    }
  }
  // A capture that finished into a walkthrough the account may see: ready (not yet
  // approved) or live (approved and shared).
  const renderTour = state => ({ id: renderTourOf(state), property_id: renderSpace(state), status: 'ready', storage_path: 'synthetic/render-' + state + '.zip',
    created_by: 'synthetic-user', created_at: new Date().toISOString() });
  for (const state of renderShown.filter(item => ['ready', 'live'].includes(item))) {
    tours.push(renderTour(state));
    if (state === 'live') {
      approvedTours.add(renderTourOf(state)); tokens.set(renderTourOf(state), 'synthetic-fixture-token-render');
      releasedAt.set(renderTourOf(state), new Date(Date.now() - 86400000).toISOString());
    }
  }
  if (scenario === 'new') { properties.length = 0; tours.length = 0; }
  if (['managed', 'qualified'].includes(scenario)) tours.length = 0;
  if (['draft', 'processing', 'revoked'].includes(scenario)) tours[0].status = scenario;
  // Plan fixtures (offer 2026-09-25.2). Three free months with six walkthroughs
  // in total, started by activating the plan and renewing afterwards; the one
  // Veylet plan (code solo), monthly or annual; a source that decides which price
  // is true; retired Team rows that must still read by their own name; and a
  // failed lookup that must read as unavailable. `?case=plan-monthly-banked` is an
  // active monthly plan (2 a month) with 2 walkthroughs banked (at most 4);
  // `?case=plan-annual-pool` an active annual plan with 5 of its 24 yearly walkthroughs
  // used, and `?case=plan-annual-bonus` the same with the early-annual bonus's 4
  // walkthroughs as bonus credits (28 in total). `?case=plan-pending` has not started
  // and shows the Start your free months card (see the trial fixtures below).
  // `?annual=` forces an annual plan card state and, unless `?case=plan-…`
  // says otherwise, the plan row that goes with it (see the annual fixtures below).
  const annualCase = params.get('annual');
  const ANNUAL_PLAN_ROW = { 'locked-start': 'pending', 'locked-accept': 'trial-none', 'not-owner': 'apple-trial',
    'renewal-on': 'apple-trial', 'renewal-off': 'apple-trial', 'no-bonus': 'apple-trial', pending: 'apple-trial', scheduled: 'apple-trial',
    'scheduled-team': 'team-active', conflict: 'apple-trial', 'lane-closed': 'apple-trial', 'one-month': 'apple-trial', invoice: 'trial',
    'start-today': 'trial-exhausted', 'no-plan': 'ended-after-active', active: 'web-annual',
    'start-failed': 'ended', 'start-failed-retrying': 'ended' };
  const planCase = scenario.startsWith('plan-') ? scenario.slice(5) : ANNUAL_PLAN_ROW[annualCase] || 'trial';
  const planBase = {
    workspace_id: 'synthetic-workspace', plan_code: 'solo', source: 'studio', trial_months: 3,
    trial_included_walkthroughs: 6, accepted_in_free_months: 2, extras_in_free_months: 0,
    included_per_month: 2, accepted_this_period: 0, accepted_total: 4,
    price_aud_cents: 9900, extra_walkthrough_aud_cents: null, hosting_included: true, billing_interval: 'monthly',
    app_price_aud_cents: 11999, app_extra_walkthrough_aud_cents: null,
    apple_verified: null, apple_product_id: null, auto_renews: true, cancelled_at: null,
    trial_started_at: '2026-09-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z',
    period_started_at: '2026-09-01T00:00:00Z', period_ends_at: '2026-10-01T00:00:00Z',
    current_period_ends_at: null, updated_at: '2026-09-22T00:00:00Z',
  };
  // Earlier free months (three of them) for rows already on the paid plan.
  const pastTrial = { trial_started_at: '2026-04-15T00:00:00Z', trial_ends_at: '2026-07-15T00:00:00Z' };
  const apple = { source: 'apple', apple_product_id: 'dev.property3d.capture.solo.monthly' };
  const planRows = {
    pending: { ...planBase, source: null, status: 'pending', accepted_this_period: 0, accepted_total: 0,
      accepted_in_free_months: 0, trial_started_at: null, trial_ends_at: null,
      period_started_at: null, period_ends_at: null },
    trial: { ...planBase, status: 'trial' },
    'trial-ending': { ...planBase, status: 'trial', trial_started_at: '2026-07-20T00:00:00Z', trial_ends_at: '2026-10-20T00:00:00Z' },
    // Started in the app, and not yet confirmed by Apple's server notification.
    'apple-trial': { ...planBase, ...apple, status: 'trial', apple_verified: false, accepted_in_free_months: 3 },
    active: { ...planBase, ...pastTrial, status: 'active', accepted_this_period: 1, accepted_total: 11,
      current_period_ends_at: '2026-10-01T00:00:00Z' },
    'apple-active': { ...planBase, ...apple, ...pastTrial, status: 'active', apple_verified: true,
      accepted_this_period: 1, accepted_total: 11, accepted_in_free_months: 6, extras_in_free_months: 1,
      current_period_ends_at: '2026-10-01T00:00:00Z' },
    'web-active': { ...planBase, ...pastTrial, source: 'web', status: 'active', accepted_this_period: 1, accepted_total: 14,
      accepted_in_free_months: 6, current_period_ends_at: '2026-10-05T00:00:00Z' },
    // Offer 2026-09-25.1: a monthly plan whose unused walkthroughs rolled over (the
    // capacity answer below banks 2 of at most 3), and an annual plan whose 12 (or 14,
    // with the early-annual bonus) walkthroughs are one yearly pool.
    'monthly-banked': { ...planBase, ...pastTrial, status: 'active', accepted_this_period: 0, accepted_total: 7,
      accepted_in_free_months: 6, current_period_ends_at: '2026-10-01T00:00:00Z' },
    'annual-pool': { ...planBase, ...pastTrial, source: 'web', status: 'active', billing_interval: 'annual',
      renewal_price_aud_cents: 99000, included_per_month: 24, accepted_this_period: 5, accepted_total: 11,
      accepted_in_free_months: 6, current_period_ends_at: '2027-07-15T00:00:00Z' },
    // Retired for new buyers (offer 2026-09-24.2), still read by their own names: an
    // invoiced Team month, and a verified row for the Team annual product (off sale).
    'team-active': { ...planBase, ...pastTrial, plan_code: 'studio', status: 'active', included_per_month: 3, accepted_this_period: 2,
      accepted_total: 12, accepted_in_free_months: 4, trial_included_walkthroughs: 4, price_aud_cents: 18900,
      current_period_ends_at: '2026-10-01T00:00:00Z' },
    'apple-annual': { ...planBase, ...apple, plan_code: 'studio', included_per_month: 3, status: 'active', apple_product_id: 'dev.property3d.capture.plan.annual', billing_interval: 'annual', renewal_price_aud_cents: 318999, apple_environment: 'Sandbox', apple_verified: true, current_period_ends_at: '2027-09-23T00:00:00Z' },
    'trial-credits': { ...planBase, status: 'trial', accepted_in_free_months: 6 },
    // Free months running, nothing accepted yet (an older server kept the annual plan locked here).
    'trial-none': { ...planBase, status: 'trial', accepted_in_free_months: 0, accepted_this_period: 0, accepted_total: 0 },
    // An annual plan running by card (source web): the annual plan card is hidden.
    'web-annual': { ...planBase, ...pastTrial, source: 'web', status: 'active', plan_code: 'solo', billing_interval: 'annual',
      renewal_price_aud_cents: 99000, accepted_this_period: 1, accepted_total: 8, accepted_in_free_months: 6,
      current_period_ends_at: '2027-07-15T00:00:00Z' },
    'trial-exhausted': { ...planBase, status: 'trial', accepted_in_free_months: 6 },
    'invoice-unknown': { ...planBase, status: 'trial', billing_interval: null },
    ended: { ...planBase, status: 'ended', accepted_this_period: 0, accepted_total: 7,
      trial_started_at: '2026-06-01T00:00:00Z', trial_ends_at: '2026-09-01T00:00:00Z',
      period_started_at: null, period_ends_at: null, auto_renews: false, cancelled_at: '2026-08-25T00:00:00Z' },
    // Cancelled after paying for a while: the plan ended, not the free months.
    'ended-after-active': { ...planBase, source: 'web', status: 'ended', accepted_this_period: 0,
      accepted_total: 22, accepted_in_free_months: 6,
      trial_started_at: '2025-12-01T00:00:00Z', trial_ends_at: '2026-03-01T00:00:00Z',
      period_started_at: null, period_ends_at: null, current_period_ends_at: '2026-09-01T00:00:00Z',
      auto_renews: false, cancelled_at: '2026-08-12T00:00:00Z' },
  };
  planRows['annual-bonus'] = planRows['annual-pool'];
  // What get_walkthrough_capacity appends in migration 20260925100000_offer_v8 (not yet
  // released): allowance_kind, banked_units (inside a monthly plan's included_limit)
  // and bonus_credits_available (inside extra_credits_available). Offer 2026-09-25.2:
  // 2 a month plus up to 4 banked, a 24-walkthrough yearly pool, and the early-annual
  // bonus's 4 walkthroughs as bonus credits. Every other case answers as today's
  // server does, without these fields.
  const CAPACITY_V8 = {
    'monthly-banked': { allowance_kind: 'monthly', banked_units: 2, bonus_credits_available: 0 },
    'annual-pool': { allowance_kind: 'annual_pool', banked_units: 0, bonus_credits_available: 0,
      included_limit: 24, included_used: 5, allowance_ends_at: '2027-07-15T00:00:00Z' },
    'annual-bonus': { allowance_kind: 'annual_pool', banked_units: 0, bonus_credits_available: 4,
      included_limit: 24, included_used: 5, allowance_ends_at: '2027-07-15T00:00:00Z' },
  };

  // Studio desk fixtures. Fictional accounts; no real property or person.
  const studioCase = params.get('studio') || 'member';
  const PLAN_FIELDS = ['workspace_id', 'plan_code', 'source', 'status', 'trial_months',
    'trial_included_walkthroughs', 'accepted_in_free_months', 'extras_in_free_months',
    'trial_started_at', 'trial_ends_at', 'period_started_at', 'period_ends_at',
    'current_period_ends_at', 'auto_renews', 'cancelled_at', 'included_per_month',
    'accepted_this_period', 'accepted_total', 'price_aud_cents', 'extra_walkthrough_aud_cents',
    'app_price_aud_cents', 'app_extra_walkthrough_aud_cents', 'apple_verified', 'apple_product_id',
    'hosting_included', 'updated_at', 'billing_interval', 'renewal_price_aud_cents', 'apple_environment'];
  const planFields = row => Object.fromEntries(PLAN_FIELDS.map(key => [key, row[key] ?? null]));
  const money = { price_aud_cents: 18900, extra_walkthrough_aud_cents: 8900,
    app_price_aud_cents: 21999, app_extra_walkthrough_aud_cents: 9999, hosting_included: true };
  const studioAccounts = [
    { workspace_id: 'ws-northgate', workspace_name: 'Northgate Property Co', owner_user_id: 'owner-1',
      owner_display_name: 'Alina Northgate', member_count: 4, plan_code: 'studio', source: 'apple',
      status: 'trial', apple_verified: false, apple_product_id: 'dev.property3d.capture.plan.monthly',
      trial_months: 3, trial_included_walkthroughs: 4, accepted_in_free_months: 3, extras_in_free_months: 0,
      trial_started_at: '2026-09-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z',
      period_started_at: '2026-09-01T00:00:00Z', period_ends_at: '2026-10-01T00:00:00Z',
      current_period_ends_at: null, auto_renews: true, cancelled_at: null,
      included_per_month: 3, accepted_this_period: 2, accepted_total: 5, ...money,
      tours_ready: 1, tours_processing: 1, last_activity_at: '2026-09-22T01:10:00Z',
      note: 'Asked about a second walkthrough next week.', updated_at: '2026-09-22T01:10:00Z' },
    { workspace_id: 'ws-wren', workspace_name: 'Wren & Fielding', owner_user_id: 'owner-2',
      owner_display_name: 'Marcus Fielding', member_count: 9, plan_code: 'office', source: 'studio',
      status: 'active', apple_verified: null, apple_product_id: null,
      trial_months: 3, trial_included_walkthroughs: 4, accepted_in_free_months: 4, extras_in_free_months: 2,
      trial_started_at: '2025-11-01T00:00:00Z', trial_ends_at: '2026-02-01T00:00:00Z',
      period_started_at: '2026-09-05T00:00:00Z', period_ends_at: '2026-10-05T00:00:00Z',
      current_period_ends_at: '2026-10-05T00:00:00Z', auto_renews: true, cancelled_at: null,
      included_per_month: 3, accepted_this_period: 3, accepted_total: 18, ...money,
      tours_ready: 2, tours_processing: 0, last_activity_at: '2026-09-20T05:45:00Z',
      note: 'Monthly invoice; purchase order required.', updated_at: '2026-09-20T05:45:00Z' },
    { workspace_id: 'ws-kelvin-grove', workspace_name: 'Kelvin Grove Dental', owner_user_id: 'owner-3',
      owner_display_name: null, member_count: 2, plan_code: 'studio', source: 'web',
      status: 'pending', apple_verified: null, apple_product_id: null,
      trial_months: 3, trial_included_walkthroughs: 4, accepted_in_free_months: 0, extras_in_free_months: 0,
      trial_started_at: null, trial_ends_at: null,
      period_started_at: null, period_ends_at: null,
      current_period_ends_at: null, auto_renews: false, cancelled_at: null,
      included_per_month: 3, accepted_this_period: 0, accepted_total: 0, ...money,
      tours_ready: 0, tours_processing: 1, last_activity_at: '2026-09-11T23:20:00Z',
      note: null, updated_at: '2026-09-11T23:20:00Z' },
  ];

  if (studioCase === 'invoice') studioAccounts[2].source = 'studio';
  // Offer 2026-09-25.1 on the studio desk. Three free months with six walkthroughs
  // for running and never-started free months; the proposed studio_list_accounts
  // founding fields, with Wren & Fielding the founding workspace (`?studio=founding-spent`
  // has used all four grants, `?studio=founding-unknown` sends no count); `?tier=` sets
  // the annual tier the studio reads (standard, closed or error). `?studio=trial-ended`
  // makes Kelvin Grove Dental a studio-invoiced account whose free months ended
  // yesterday, so the desk can record an annual plan from the free-months end.
  studioAccounts[0].trial_included_walkthroughs = 6;
  studioAccounts[2].trial_included_walkthroughs = 6;
  for (const row of studioAccounts) Object.assign(row, { founding_member: false, founding_grants_used: 0 });
  Object.assign(studioAccounts[1], { founding_member: true,
    founding_grants_used: studioCase === 'founding-spent' ? 4 : studioCase === 'founding-unknown' ? null : 1 });
  if (studioCase === 'trial-ended') {
    const yesterday = new Date(Date.now() - 86400000); yesterday.setUTCHours(0, 0, 0, 0);
    const began = new Date(yesterday); began.setUTCMonth(began.getUTCMonth() - 3);
    Object.assign(studioAccounts[2], { source: 'studio', status: 'ended', trial_started_at: began.toISOString(),
      trial_ends_at: yesterday.toISOString(), accepted_in_free_months: 4, auto_renews: false });
  }
  const studioTier = params.get('tier') || 'standard';
  // offer.json 2026-09-25.2: A$99 a month and A$990 a year on invoice (the year only while the tier is open).
  const STUDIO_INVOICE_CENTS = { monthly: 9900, annual: 99000 };
  const STUDIO_PACKS = { pack3: { walkthroughs: 3, cents: 16900 }, pack10: { walkthroughs: 10, cents: 49900 } };
  const studioPackReceipts = new Map(), studioGrantReceipts = new Map(), studioInvoiceReceipts = new Map();
  /* Referrals (studio_grant_referral_bonus). Wren & Fielding (paying) records Northgate
   * as its referrer, from a link; `?studio=referral-granted` has its walkthroughs granted
   * already. Grants are idempotent per referred office; the answer names why nothing was
   * granted (no_referral, already_granted, not_paying); self-referral, two offices
   * referring each other, another referrer, or no referrer and reference when none is
   * recorded, are refused as the server refuses them. */
  const studioReferrals = new Map([['ws-wren', { referrer: 'ws-northgate', source: 'link' }]]);
  const studioReferralGrants = new Set(studioCase === 'referral-granted' ? ['ws-wren'] : []);
  /* Whole home (studio_set_listing_home): a studio correction of a listing's declaration.
   * Listing 5e6f7081-…-000c has started capture, so it is locked; any other listing id is
   * an unlocked, not yet captured listing. */
  const LOCKED_LISTING = '5e6f7081-0000-4000-8000-00000000000c';
  const studioListings = new Map();
  const studioYearOn = () => { const when = new Date(); when.setUTCFullYear(when.getUTCFullYear() + 1); return when.toISOString().slice(0, 10); };

  // Hosted walkthroughs on the studio desk: due soon (plan ended, term ending
  // within 60 days), past its term, safely inside it, and an active plan whose
  // date is close but not due. `?studio=hosted-empty` lists none.
  const studioDay = 86400000;
  const fromToday = days => new Date(Date.now() + days * studioDay).toISOString();
  const studioHostedRow = (tour_id, workspace_id, property_title, plan_status, hostedIn, extra = {}) => ({
    tour_id, workspace_id, property_title, status: 'ready', sharing_on: true,
    released_at: fromToday(hostedIn - 365), guaranteed_until: fromToday(hostedIn), extended_until: null,
    hosted_until: fromToday(hostedIn), plan_status, ...extra });
  const studioHosted = studioCase === 'hosted-empty' ? [] : [
    studioHostedRow('1a2b3c4d-0000-4000-8000-000000000001', 'ws-wren', 'Fictional harbour loft', 'active', 25),
    studioHostedRow('2b3c4d5e-0000-4000-8000-000000000002', 'ws-kelvin-grove', 'Fictional corner clinic', 'ended', 40),
    studioHostedRow('3c4d5e6f-0000-4000-8000-000000000003', 'ws-kelvin-grove', 'Fictional old showroom', 'ended', -12, { sharing_on: false }),
    studioHostedRow('4d5e6f70-0000-4000-8000-000000000004', 'ws-northgate', 'Fictional garden studio', 'trial', 280),
  ];

  /* Money exceptions (studio_money_exceptions), most urgent first as the server
   * orders them: `?money=empty|error|loading`, otherwise six fictional rows, two of
   * them resolvable. Amounts follow offer.json (the A$990 annual plan, A$169 and
   * A$499 packs). Resolving records the reference and drops the row. */
  const moneyCase = params.get('money') || 'list';
  const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  const moneyRow = (exception_key, kind, severity, workspace_id, workspace_name, amount_cents, minutes, runbook, reference, detail, resolvable) =>
    ({ exception_key, kind, severity, workspace_id, workspace_name, amount_cents, currency: amount_cents === null ? null : 'AUD',
      occurred_at: minutesAgo(minutes), age_minutes: minutes, runbook, reference, detail, resolvable });
  let studioMoney = moneyCase === 'empty' ? [] : [
    moneyRow('start_failed:chk-northgate-2027', 'start_failed', 'high', 'ws-northgate', 'Northgate Property Co', 99000, 26 * 60, 'R4', 'chk-northgate-2027',
      'First yearly charge for 2026-09-23 failed: contact the member within 24 hours (new card or cancel).', false),
    moneyRow('charge_refused:chk-kelvin-0917:1', 'charge_refused', 'high', 'ws-kelvin-grove', 'Kelvin Grove Dental', 99000, 5 * 60, 'R1', 'chk-kelvin-0917',
      '1 yearly charge(s) taken while the start was cancelled, none granted: refund each in Square.', true),
    moneyRow('pack_payment:sq-pay-QA7', 'duplicate_charge', 'high', 'ws-removed-01', null, 16900, 95, 'R1', 'sq-pay-QA7',
      'A second completed payment for a pack already credited: refund it in full.', true),
    moneyRow('square_cancel:chk-wren-0930', 'square_cancel_unconfirmed', 'high', 'ws-wren', 'Wren & Fielding', 99000, 50, 'R9', 'chk-wren-0930',
      'Square start for 2026-09-30 (cancelled) is not confirmed cancelled.', false),
    moneyRow('pack_intent:0b1c2d3e:2', 'pack_intent_unresolved', 'medium', 'ws-wren', 'Wren & Fielding', 49900, 3 * 60, 'R7', '0b1c2d3e',
      'Pack try 2 has no final answer from Square (payment pending): check the payment in Square.', false),
    moneyRow('apple_waiting:Production:2000000123', 'apple_inbox_stuck', 'medium', 'ws-northgate', 'Northgate Property Co', null, 2 * 1440 + 40, 'R2', 'Production:2000000123',
      '2 App Store notice(s) waiting to apply: check the inbox and replay it.', false),
  ];

  /* Capture queue (studio_capture_queue) and its last 7 days (studio_capture_sla).
   * `?queue=empty|error|loading`, `?sla=error`. Times are relative to now: a
   * founding job first in line, a standard job promoted after waiting past 6 hours,
   * one over its target while processing, a failed founding job over its 12 hours,
   * an upload still arriving, and three finished in the last 30 days. */
  const queueCase = params.get('queue') || 'list';
  const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const queueJob = (job_id, workspace_id, founding, status, finishedHours, extra = {}) => {
    const sla = extra.express ? 2 : founding ? 12 : 24;
    const elapsed = finishedHours === null ? null : Math.round((extra.doneAfter ?? finishedHours) * 100) / 100;
    const state = finishedHours === null ? 'not_started' : elapsed > sla ? 'breached' : extra.doneAfter !== undefined ? 'met' : 'open';
    return { job_id, workspace_id, founding, status, stage: extra.stage || null, attempt: extra.attempt || 0, error_code: extra.error || null,
      queued_at: finishedHours === null ? null : hoursAgo(finishedHours), claimed_at: extra.claimed || null,
      completed_at: extra.doneAfter !== undefined ? hoursAgo(finishedHours - extra.doneAfter) : null, failed_at: status === 'failed' ? hoursAgo(1) : null,
      queue_position: extra.position || null, priority: extra.express ? 'express' : founding ? 'founding' : extra.promoted ? 'promoted' : 'standard',
      elapsed_hours: elapsed, sla_hours: sla, sla_due_at: finishedHours === null ? null : hoursAgo(finishedHours - sla), sla_state: state };
  };
  const studioQueue = queueCase === 'empty' ? [] : [
    queueJob('e1f2a3b4-0000-4000-8000-0000000000e1', 'ws-northgate', false, 'queued', 0.4, { position: 1, express: true }),
    queueJob('3f2e1d0c-0000-4000-8000-00000000000a', 'ws-wren', true, 'queued', 3.2, { position: 2 }),
    queueJob('4a3b2c1d-0000-4000-8000-00000000000b', 'ws-northgate', false, 'queued', 7.5, { position: 3, promoted: true }),
    queueJob('5b4c3d2e-0000-4000-8000-00000000000c', 'ws-kelvin-grove', false, 'queued', 1.1, { position: 4 }),
    queueJob('6c5d4e3f-0000-4000-8000-00000000000d', 'ws-northgate', false, 'processing', 26.4, { stage: 'reconstructing', attempt: 2, claimed: hoursAgo(2) }),
    queueJob('7d6e5f40-0000-4000-8000-00000000000e', 'ws-wren', true, 'failed', 14, { error: 'lease_expired', attempt: 3 }),
    queueJob('8e7f6051-0000-4000-8000-00000000000f', 'ws-kelvin-grove', false, 'uploading', null),
    queueJob('9f807162-0000-4000-8000-000000000010', 'ws-wren', true, 'awaiting_review', 50, { doneAfter: 7.25 }),
    queueJob('a0918273-0000-4000-8000-000000000011', 'ws-northgate', false, 'awaiting_review', 80, { doneAfter: 11.6 }),
    queueJob('b1a29384-0000-4000-8000-000000000012', 'ws-wren', true, 'awaiting_review', 120, { doneAfter: 13.4 }),
  ];
  /* Express renders (studio_express_queue, a proposed name). `?express=empty|error|
   * loading|missing` on the studio desk; otherwise today's orders (one open and on
   * time, one open and late, one met) and the last 7 days (one met, one missed and
   * refunded, one missed whose refund is still pending), all fictional. */
  const studioExpressCase = params.get('express') || 'list';
  const expressRow = (job_id, workspace_id, paid_with, orderedMinutesAgo, dueInMinutes, state, refund = null, completedMinutesAgo = null) => ({
    express_id: 'x-' + job_id.slice(0, 8), job_id, workspace_id, paid_with, amount_cents: paid_with === 'card' ? 2900 : null,
    ordered_at: minutesAgo(orderedMinutesAgo), due_at: minutesAgo(-dueInMinutes), completed_at: completedMinutesAgo === null ? null : minutesAgo(completedMinutesAgo),
    state, refund, refunded_at: refund === 'refunded' || refund === 'returned' ? minutesAgo(orderedMinutesAgo - 150) : null });
  const studioExpress = studioExpressCase === 'empty' ? [] : [
    expressRow('e1f2a3b4-0000-4000-8000-0000000000e1', 'ws-northgate', 'card', 25, 95, 'open'),
    expressRow('e2f3a4b5-0000-4000-8000-0000000000e2', 'ws-wren', 'credit', 150, -12, 'open'),
    expressRow('e3f4a5b6-0000-4000-8000-0000000000e3', 'ws-kelvin-grove', 'card', 200, -80, 'met', null, 110),
    expressRow('e4f5a6b7-0000-4000-8000-0000000000e4', 'ws-wren', 'card', 3 * 1440, -3 * 1440 + 120, 'met', null, 3 * 1440 - 70),
    expressRow('e5f6a7b8-0000-4000-8000-0000000000e5', 'ws-northgate', 'card', 4 * 1440, -4 * 1440 + 120, 'missed', 'refunded'),
    expressRow('e6f7a8b9-0000-4000-8000-0000000000e6', 'ws-kelvin-grove', 'card', 1440 + 30, -1440 + 90, 'missed', 'pending'),
  ];
  const studioSla = [
    { priority_class: 'founding', sla_hours: 12, completed: 4, met: 3, breached: 1, p50_hours: 7.25, p90_hours: 13.4, open_jobs: 2, open_breached: 1, oldest_queued_hours: 3.2 },
    { priority_class: 'standard', sla_hours: 24, completed: 9, met: 9, breached: 0, p50_hours: 11.6, p90_hours: 20.1, open_jobs: 4, open_breached: 1, oldest_queued_hours: 7.5 },
  ];

  /* Corrections (studio_record_tour_correction). The harbour loft's released
   * walkthrough (hosted list) has a ready, never-reviewed package 9f8e7d6c-…-0a0a;
   * a package of another space (c0ffee00-…) is refused, as the server refuses it.
   * An identical request answers the same record. `?correction=open` opens the form. */
  const correctionTours = new Map([
    ['1a2b3c4d-0000-4000-8000-000000000001', { property: 'harbour', ready: true, reviewed: true, revision: 1, walkthrough: '1a2b3c4d-0000-4000-8000-000000000001' }],
    ['9f8e7d6c-0000-4000-8000-000000000a0a', { property: 'harbour', ready: true, reviewed: false, revision: 1, walkthrough: '9f8e7d6c-0000-4000-8000-000000000a0a' }],
    ['c0ffee00-0000-4000-8000-000000000b0b', { property: 'clinic', ready: true, reviewed: false, revision: 1, walkthrough: 'c0ffee00-0000-4000-8000-000000000b0b' }],
  ]);
  const correctionRecords = new Map();
  // The harbour loft's walkthrough is its account's first accepted one; `?studio=redo-used` has used the redo already.
  const FIRST_ACCEPTED_WALKTHROUGH = '1a2b3c4d-0000-4000-8000-000000000001';
  if (studioCase === 'redo-used') correctionRecords.set('0d0d0d0d-0000-4000-8000-00000000000d', { reason: 'first_walkthrough_redo' });

  // Leaving. `?case=deletion-requested` puts the desk in the requested state;
  // every other case has nothing requested. `?studio=deletions` gives the studio
  // desk two fictional requests to look at.
  let deletion = ['deletion-requested', 'deletion-processing'].includes(scenario)
    ? { user_id: 'synthetic-user', requested_at: '2026-09-20T04:30:00Z',
        reason: 'Sold the agency; the new owner uses their own tools.',
        status: scenario === 'deletion-processing' ? 'processing' : 'requested', cancelled_at: null, completed_at: null }
    : null;
  const studioDeletions = [
    { user_id: 'aaaaaaaa-1111-4222-8333-444444444444', requested_at: '2026-09-20T04:30:00Z',
      reason: 'Sold the agency; the new owner uses their own tools.', status: 'requested',
      workspace_names: ['Northgate Property Co'], property_count: 4, tour_count: 6, active_share_count: 2 },
    { user_id: 'bbbbbbbb-1111-4222-8333-444444444444', requested_at: '2026-09-21T22:05:00Z',
      reason: null, status: 'requested',
      workspace_names: ['Kelvin Grove Dental', 'Kelvin Grove Rooms'], property_count: 2, tour_count: 1,
      active_share_count: 0 },
  ];

  /* Annual plan fixtures (offer 2026-09-25.2). `?annual=` picks the answer of
   * get_members_annual_offer; `?lane=open|sandbox|closed|error` the hooks lane
   * (default open, or closed for `lane-closed`); `?checkout=<error code>|fail`
   * refuses the next checkout; `?recheck=off` turns App Store renewal off after
   * the first read, as if the member did it in another tab; `?sdk=fail` makes
   * Square's script fail to load and `?tokenize=fail` makes the card declined;
   * `?card=open` presses "Pay yearly by card" once the card is drawn; `start-failed`
   * and `start-failed-retrying` are a first yearly charge that failed. One public
   * annual price for the Veylet plan, A$990 (offer.json membersAnnual.tiers.standard);
   * it opens once the free months have started (`locked-start` before them). Every
   * answer carries early_annual_bonus { walkthroughs: 4, express_renders: 4, granted,
   * available }: available while the free months run (dated by starts_on, their
   * end); `no-bonus` is `renewal-off` with the bonus already granted. Legacy
   * answers an older server may still send: `locked-accept` (an accepted walkthrough
   * still required) and `one-month` (a second tier); `scheduled-team` is a
   * year bought on the retired Team plan, which must still read by its own name.
   * Dates match the fixture plan rows, whose free months end on 1 December 2026.
   * No request leaves the page: the hooks origin below is answered here. */
  const brisbaneToday = (() => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(part => [part.type, part.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
  })();
  const annualPlans = months => [
    { code: 'solo', year_cents: 9900 * (12 - months), monthly_cents: 9900, months_free: months, saving_cents: 9900 * months },
  ];
  const FREE_MONTHS_END = '2026-12-01';
  // Offer 2026-09-25.2: 4 bonus walkthroughs and 4 express renders for choosing annual early.
  const annualBonusNow = { walkthroughs: 4, express_renders: 4, granted: false, available: true };
  const annualBase = { eligible: true, missing: [], tier: 'standard', plans: annualPlans(2), source: 'apple', plan_status: 'trial',
    apple_auto_renews: true, apple_in_free_trial: true, starts_on: FREE_MONTHS_END, can_start_now: false, free_walkthroughs_remaining: 1,
    scheduled: null, checkout_pending: null, conflict: false, active_annual: false, early_annual_bonus: annualBonusNow };
  const annualLocked = { eligible: false, plans: [], starts_on: null, can_start_now: false };
  const annualNoApple = { apple_auto_renews: null, apple_in_free_trial: null };
  // Not running free months (or the bonus already granted): the object says it is not available.
  const annualNoBonus = { early_annual_bonus: { walkthroughs: 4, express_renders: 4, granted: false, available: false } };
  const annualScheduled = { plan_code: 'solo', year_cents: 99000, starts_on: FREE_MONTHS_END };
  const annualOffers = {
    'locked-start': { ...annualBase, ...annualLocked, ...annualNoApple, ...annualNoBonus, missing: ['free_months_not_started'], source: null, plan_status: 'pending', free_walkthroughs_remaining: null },
    'locked-accept': { ...annualBase, ...annualLocked, ...annualNoApple, missing: ['no_accepted_walkthrough'], tier: 'twoMonthsFree', source: 'studio', free_walkthroughs_remaining: 4, early_annual_bonus: undefined },
    'not-owner': { ...annualBase, ...annualLocked, missing: ['not_owner'] },
    closed: { ...annualBase, ...annualLocked, tier: 'closed' },
    'renewal-on': { ...annualBase },
    'renewal-off': { ...annualBase, apple_auto_renews: false },
    'no-bonus': { ...annualBase, apple_auto_renews: false, early_annual_bonus: { walkthroughs: 4, express_renders: 4, granted: true, available: false } },
    'one-month': { ...annualBase, tier: 'oneMonthFree', plans: annualPlans(1), apple_auto_renews: false },
    invoice: { ...annualBase, ...annualNoApple, source: 'studio' },
    // An invoiced monthly plan running (`?case=plan-monthly-banked` and `plan-active`): no bonus once the free months are over.
    'invoice-active': { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'studio', plan_status: 'active', starts_on: '2026-10-01', free_walkthroughs_remaining: 0 },
    'start-today': { ...annualBase, ...annualNoApple, source: 'studio', can_start_now: true, free_walkthroughs_remaining: 0 },
    'no-plan': { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'web', plan_status: 'ended', starts_on: brisbaneToday, free_walkthroughs_remaining: 0 },
    // A checkout left open on the server: the page offers the card form again (no state of its own).
    pending: { ...annualBase, apple_auto_renews: false, checkout_pending: { plan_code: 'solo', created_at: '2026-09-24T02:10:00Z' } },
    scheduled: { ...annualBase, apple_auto_renews: false, scheduled: annualScheduled },
    'scheduled-team': { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'studio', plan_status: 'active', starts_on: '2026-10-01',
      scheduled: { plan_code: 'studio', year_cents: 189000, starts_on: '2026-10-01' } },
    conflict: { ...annualBase, apple_auto_renews: true, conflict: true, scheduled: annualScheduled },
    'lane-closed': { ...annualBase, apple_auto_renews: false },
    active: { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'web', plan_status: 'active', active_annual: true },
    // The first yearly charge, due when the free months ended on 1 September 2026 (the
    // `ended` plan row), failed. A retry starts today at the price it was bought at;
    // `-retrying` has asked once already and waits on Square to stop the failed start.
    'start-failed': { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'studio', plan_status: 'ended', starts_on: brisbaneToday, can_start_now: true,
      free_walkthroughs_remaining: 0, start_failed: { plan_code: 'solo', year_cents: 99000, starts_on: '2026-09-01', failed_at: '2026-09-01T00:12:00Z', retrying: false } },
    'start-failed-retrying': { ...annualBase, ...annualNoApple, ...annualNoBonus, source: 'studio', plan_status: 'ended', starts_on: brisbaneToday, can_start_now: true,
      free_walkthroughs_remaining: 0, start_failed: { plan_code: 'solo', year_cents: 99000, starts_on: '2026-09-01', failed_at: '2026-09-01T00:12:00Z', retrying: true } },
  };
  // Without `?annual=`, the answer that goes with the plan row: an active annual plan
  // hides the card, a running monthly plan starts the year when its month ends, and
  // everything else (the default invoiced trial) shows the invoice state.
  const ANNUAL_DEFAULT = { 'annual-pool': 'active', 'annual-bonus': 'active', 'web-annual': 'active',
    'monthly-banked': 'invoice-active', active: 'invoice-active' };
  const annualFallback = () => annualOffers[ANNUAL_DEFAULT[planCase]] || annualOffers.invoice;
  let annualLive = annualOffers[annualCase] ? JSON.parse(JSON.stringify(annualOffers[annualCase])) : null;
  let annualReads = 0;
  /* Walkthrough pack fixtures (offer 2026-09-24.2). `?packs=` picks the answer of
   * get_pack_offer: choose (the default on an activated desk), credits (two
   * available, the next expiring 2 March 2027), not-activated (the default on a
   * pending or ended plan), not-owner (the default for `case=operator`), error,
   * loading, or missing (the function does not exist yet, so no card).
   * `?pack-checkout=<error code>|fail` refuses the next purchase; `?tokenize=fail`
   * declines the card in Square's stand-in; `?packs-card=open` presses the buy
   * button once. Prices follow offer.json packs (web). A purchase adds its
   * walkthroughs to the same balance the plan panel's capacity reads. */
  const packsCase = params.get('packs') || (scenario === 'operator' ? 'not-owner'
    : ['pending', 'ended', 'ended-after-active', 'nomembership'].includes(planCase) ? 'not-activated' : 'choose');
  const PACKS = [{ code: 'pack3', walkthroughs: 3, price_cents: 16900 }, { code: 'pack10', walkthroughs: 10, price_cents: 49900 }];
  let extraCredits = planCase === 'trial-credits' || packsCase === 'credits' ? 2 : 0;
  let packExpiry = extraCredits ? '2027-03-02' : null;
  const packOffer = () => {
    const missing = packsCase === 'not-owner' ? ['not_owner'] : packsCase === 'not-activated' ? ['not_activated'] : [];
    return { available: !missing.length, missing, packs: missing.length ? [] : PACKS.map(pack => ({ ...pack })),
      // Bonus walkthroughs usable now are extra credits in the same ledger (walkthrough_extra_credits).
      credits_available: extraCredits + ((CAPACITY_V8[planCase] || {}).bonus_credits_available || 0), next_expiry: packExpiry };
  };
  const laneCase = params.get('lane') || (annualCase === 'lane-closed' ? 'closed' : 'open');
  /* Start the free months (offer 2026-09-25.2; get_trial_offer and POST
   * /square/trial/start are proposed names, not yet in the backend). Shown on a
   * pending plan (`?case=plan-pending`). `?trial=` picks the answer: choose (the
   * default; A$99 a month or A$990 a year, first charge 3 months from today,
   * Brisbane), used (this agency already had its free months), not-owner (the
   * default for `case=operator`), error, loading or missing (the function does not
   * exist yet, so no card). `&trial-start=<error code>|fail` refuses the next start;
   * `&trial-card=open` types the ATO's example ABN and presses the card button once.
   * A start saves no card data: the fake Square token is all that is sent, and the
   * plan row becomes free months ending on the first charge day. */
  const trialCase = params.get('trial') || (scenario === 'operator' ? 'not-owner' : 'choose');
  const addMonthsDay = (day, count) => {
    const [y, m, d] = day.split('-').map(Number);
    const total = m - 1 + count, year = y + Math.floor(total / 12), month = total % 12 + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return year + '-' + String(month).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
  };
  let trialStarted = null;
  const trialOffer = () => {
    if (trialStarted) return { eligible: false, missing: ['already_started'], plans: [] };
    if (trialCase === 'used') return { eligible: false, missing: ['trial_used'], plans: [] };
    if (trialCase === 'not-owner') return { eligible: false, missing: ['not_owner'], plans: [] };
    return { eligible: true, missing: [], months: 3, walkthroughs: 6, first_charge_on: addMonthsDay(brisbaneToday, 3),
      plans: [{ interval: 'monthly', cents: 9900, included: 2 }, { interval: 'annual', cents: 99000, included: 24 }],
      early_annual_bonus: { walkthroughs: 4, express_renders: 4 } };
  };
  // Super fast: about 30 minutes, any day, any time.
  const minutesFromNow = minutes => new Date(Date.now() + minutes * 60000).toISOString();
  const expressOrders = {
    ordered: { state: 'open', due_at: minutesFromNow(25), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null },
    'ordered-credit': { state: 'open', due_at: minutesFromNow(25), completed_at: null, paid_with: 'credit', amount_cents: null, refund: null },
    met: { state: 'met', due_at: minutesFromNow(-30), completed_at: minutesFromNow(-75), paid_with: 'card', amount_cents: 2900, refund: null },
    missed: { state: 'missed', due_at: minutesFromNow(-40), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: 'refunded' },
    'missed-pending': { state: 'missed', due_at: minutesFromNow(-10), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: 'pending' },
    'missed-credit': { state: 'missed', due_at: minutesFromNow(-40), completed_at: null, paid_with: 'credit', amount_cents: null, refund: 'returned' },
  };
  const expressLive = {
    taken: expressCase === 'full' ? 5 : 2,
    credits: expressCase === 'credit' || expressCase === 'ordered-credit' ? 4 : 0,
    order: expressOrders[expressCase] ? { ...expressOrders[expressCase] } : null,
  };
  // Only `full` is an older answer with a daily cap; the current answer has none.
  const expressCapped = expressCase === 'full';
  const expressCap = () => (expressCapped ? { daily_cap: 5, taken_today: expressLive.taken, full_today: expressLive.taken >= 5 } : { daily_cap: null, full_today: false });
  const expressNoCapacity = expressCase === 'capacity';
  const expressOffer = () => ({ price_cents: 2900, ...expressCap(), available: !expressNoCapacity, reason: expressNoCapacity ? 'capacity' : null,
    credits_available: expressLive.credits, can_order: scenario !== 'operator' && expressCase !== 'not-owner' && !expressNoCapacity,
    captures: expressCase === 'none' ? [] : [{ job_id: EXPRESS_JOB, property_id: 'synthetic-terrace',
      status: expressLive.order?.state === 'met' ? 'awaiting_review' : 'queued', ready_by: expressNoCapacity ? null : minutesFromNow(30), express: expressLive.order ? { ...expressLive.order } : null }] });
  // One capture as list_workspace_render_status answers it (migration
  // 20260925110000_render_status.sql, capture_render_status_json): the customer's state
  // as the server decides it, with only the fields that state carries. An open express
  // order on the terrace house's capture carries its due time, the one the express block shows.
  const secondsAgo = seconds => new Date(Date.now() - seconds * 1000).toISOString();
  const RENDER_STEP_LABELS = ['Preparing photos', 'Lining up camera positions', 'Building your 3D walkthrough', 'Packing it for phones', 'Checking quality'];
  const RENDER_JOBS = {
    uploading: { state: 'uploading', status: 'uploading' },
    waiting: { state: 'waiting', status: 'queued', queue_position: 2, typical_start_minutes: 40 },
    rendering: { state: 'rendering', status: 'processing', step: 3, stage: 'train', progress_pct: 64, eta_seconds: 720, heartbeat: 8, attempt: 1 },
    checking: { state: 'studio_check', status: 'awaiting_review' },
    ready: { state: 'ready_for_review', status: 'awaiting_review', tour: true },
    live: { state: 'live', status: 'awaiting_review', tour: true },
    // capture_recapture_reasons (20260926110000): an array of {room, reason, rule}, one per room the gate blocked.
    recapture: { state: 'needs_recapture', status: 'awaiting_review', recapture: [
      { room: 'Kitchen', reason: 'Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.', rule: 'few_views' },
      { room: 'Hallway', reason: 'We could not find a clear floor to walk on here. Recapture it, including the floor and doorways.', rule: 'no_floor' }] },
    retrying: { state: 'retrying', status: 'queued', attempt: 2, queue_position: 1, typical_start_minutes: 20 },
    failed: { state: 'failed', status: 'failed' },
    // No report for 5 minutes: the server's stale, with the step it last reported.
    stale: { state: 'rendering', status: 'processing', step: 3, stage: 'train', progress_pct: 64, eta_seconds: 420, heartbeat: 5 * 60, stale: true, attempt: 1 },
  };
  /* Why a queued capture waits, and the quality check's advice (migration
   * 20260926110000_admission_and_gate_policy.sql, not released). `?hold=admission|paused|
   * weekly_limit` holds every waiting capture (`?render=waiting`, `all` or `walk`) with that
   * reason; weekly_limit's until is 3 days from now; trial_limit (20260926140000, offer
   * 2026-09-26.3: a trial's 12 render attempts are used) has none. `?rooms=1|8|9|17` gives
   * every capture that many rooms and walkthroughs_used max(1, ceil(rooms / 8)) (1, 1, 2, 3);
   * without it rooms is null and walkthroughs_used 1. `?flags=all` gives the ready capture
   * (`?render=ready` or `all`) one review flag per advice rule, as the member read names
   * them ({room, reason}: the gate's own reason sentence, no rule), on five named rooms and
   * one unnamed; `unknown` adds a reason this page does not know; without it the ready
   * capture has none ([]). */
  const holdCase = params.get('hold');
  const flagsCase = params.get('flags');
  const REVIEW_FLAGS = [
    { room: 'Kitchen', reason: 'The 3D walkthrough does not match the photos closely enough (blur or movement). Recapture it moving slowly with the phone steady.' },
    { room: 'Living room', reason: 'Parts of this room were not photographed from where you stood. Recapture it, turning a full circle at each spot.' },
    { room: 'Bedroom 1', reason: 'Too few photos were saved here. Recapture it, walking slowly and turning a full circle at each spot.' },
    { room: 'Bathroom', reason: 'Stray smudges float in the air of the 3D walkthrough. Recapture moving slowly, with the lights on and nothing moving.' },
    { room: 'Hallway', reason: 'We could not find a clear floor to walk on here. Recapture it, including the floor and doorways.' },
    { room: '', reason: 'We could not find a clear path on the floor from here to the other rooms. Recapture the doorway and the floor between rooms.' },
  ];
  const roomsCase = /^\d+$/.test(params.get('rooms') || '') ? Number(params.get('rooms')) : null;
  const renderHoldOf = status => (status !== 'queued' || !['admission', 'paused', 'weekly_limit', 'trial_limit'].includes(holdCase) ? null
    : { reason: holdCase, until: holdCase === 'weekly_limit' ? new Date(Date.now() + 3 * 86400000).toISOString() : null });
  const renderFlagsOf = state => (!['ready_for_review', 'approved', 'live'].includes(state) ? null
    : flagsCase === 'all' ? REVIEW_FLAGS.map(flag => ({ ...flag }))
      : flagsCase === 'unknown' ? [...REVIEW_FLAGS.slice(0, 1), { room: 'Garage', reason: 'A check this page has never heard of found something.' }] : []);
  // `?render=walk`: one step on at every read of the account's workspace.
  const RENDER_WALK = [
    { state: 'uploading', status: 'uploading' },
    { state: 'waiting', status: 'queued', queue_position: 2, typical_start_minutes: 40 },
    { state: 'waiting', status: 'queued', queue_position: 1, typical_start_minutes: 20 },
    { state: 'rendering', status: 'processing', step: 1, stage: 'receipt', progress_pct: 3, eta_seconds: 1560, heartbeat: 2, attempt: 1 },
    { state: 'rendering', status: 'processing', step: 2, stage: 'pose_refine', progress_pct: 18, eta_seconds: 1260, heartbeat: 2, attempt: 1 },
    { state: 'rendering', status: 'processing', step: 3, stage: 'train', progress_pct: 55, eta_seconds: 840, heartbeat: 2, attempt: 1 },
    { state: 'rendering', status: 'processing', step: 4, stage: 'package', progress_pct: 88, eta_seconds: 180, heartbeat: 2, attempt: 1 },
    { state: 'rendering', status: 'processing', step: 5, stage: 'qa', progress_pct: 96, eta_seconds: 45, heartbeat: 2, attempt: 1 },
    { state: 'ready_for_review', status: 'awaiting_review', tour: true },
  ];
  let renderReads = 0;
  function renderJob(state, shape) {
    const job = state === 'walk' ? EXPRESS_JOB : renderJobOf(state);
    const { heartbeat, tour, ...fields } = shape;
    const express = job === EXPRESS_JOB && expressLive.order?.state === 'open';
    const out = { job_id: job, property_id: state === 'walk' ? 'synthetic-terrace' : renderSpace(state), state: null, status: null,
      queue_position: null, typical_start_minutes: null, step: null, steps_total: 5, step_label: null, stage: null, progress_pct: null,
      eta_seconds: null, eta_at: null, heartbeat_at: heartbeat === undefined ? null : secondsAgo(heartbeat), stale: false, attempt: null,
      attempts_allowed: 2, recapture: null, tour_id: null, express, express_due_at: express ? expressLive.order.due_at : null,
      created_at: secondsAgo(3600), updated_at: secondsAgo(heartbeat === undefined ? 4 : heartbeat), ...fields };
    out.step_label = out.step ? RENDER_STEP_LABELS[out.step - 1] : null;
    out.hold = renderHoldOf(out.status);
    out.review_flags = renderFlagsOf(out.state);
    out.rooms = roomsCase;
    out.walkthroughs_used = roomsCase === null ? 1 : Math.max(1, Math.ceil(roomsCase / 8));
    if (out.eta_seconds !== null && out.heartbeat_at) out.eta_at = new Date(Date.parse(out.heartbeat_at) + out.eta_seconds * 1000).toISOString();
    if (tour) out.tour_id = renderTourOf(state === 'walk' ? 'ready' : state);
    if (params.get('render-fields') === 'none') Object.assign(out, { step: null, step_label: null, stage: null, progress_pct: null,
      eta_seconds: null, eta_at: null, queue_position: null, typical_start_minutes: null });
    return out;
  }
  // The whole answer: every space of the workspace with its latest capture or none.
  function renderAnswer(workspaceID) {
    const jobs = new Map();
    if (workspaceID === 'synthetic-workspace') {
      if (renderCase === 'walk') {
        const shape = RENDER_WALK[Math.min(renderReads, RENDER_WALK.length) - 1];
        // Released: the walkthrough joins the account's tours as the answer names it.
        if (shape.tour && !tours.some(row => row.id === renderTourOf('ready'))) tours.push(renderTour('ready'));
        jobs.set('synthetic-terrace', renderJob('walk', shape));
      } else for (const state of renderShown) jobs.set(renderSpace(state), renderJob(state, RENDER_JOBS[state]));
    }
    return { workspace_id: workspaceID, generated_at: new Date().toISOString(),
      active: [...jobs.values()].some(job => ['uploading', 'queued', 'processing'].includes(job.status)), poll_seconds: 10,
      spaces: properties.filter(row => row.workspace_id === workspaceID).map(row => ({ property_id: row.id, job: jobs.get(row.id) || null })) };
  }
  /* Refer an office (offer 2026-09-25.1; migration 20260925100000_offer_v8, not yet
   * released). `?referral=` picks the answer of get_referral_code: missing (the
   * default: the function does not exist yet, so the block is words only), link (a
   * fictional code, 2 offices referred and 1 bonus walkthrough received), sandbox (the
   * server refuses a test workspace), invalid (a code that is not 12 hex characters),
   * error, or loading. `?ref=0123456789ab` arrives through another office's link:
   * claim_workspace_referral records it (a repeat answers recorded false);
   * `&claim=self|paid|unknown|error` refuses it with the server's own words.
   * `?session=out` shows the signed-out page (with `?ref=`, its referral line). */
  const referralCase = params.get('referral') || 'missing';
  const claimCase = params.get('claim');
  let referralClaimed = null;
  const HOOKS = 'https://hooks.fixture.invalid';
  const realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  window.VEYLET_HOOKS = { url: HOOKS };
  const REST_RPC = 'https://fixture.invalid/rest/v1/rpc/';
  window.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    // The viewer beacon and the embed's contact read post straight to PostgREST:
    // answered here from the same stand-in functions, and never sent anywhere.
    if (url.startsWith(REST_RPC)) {
      const name = decodeURIComponent(url.slice(REST_RPC.length));
      const answer = await window.supabase.createClient().rpc(name, init.body ? JSON.parse(init.body) : {});
      const status = answer?.error ? (answer.error.code === 'PGRST202' ? 404 : 400) : answer?.data === null || answer?.data === undefined ? 204 : 200;
      return new Response(status === 204 ? null : JSON.stringify(answer?.error || answer.data), { status, headers: { 'Content-Type': 'application/json' } });
    }
    if (!url.startsWith(HOOKS + '/')) return realFetch ? realFetch(input, init) : Promise.reject(new TypeError('fetch unavailable'));
    const path = url.slice(HOOKS.length);
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const bearer = /^Bearer \S+$/.test((init.headers && init.headers.Authorization) || '');
    window.VEYLET_QA_CALLS.push({ name: method + ' ' + path, args: body, bearer });
    const reply = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && path === '/square/lane') {
      if (laneCase === 'error') return reply(503, { error: 'unavailable' });
      const open = laneCase !== 'closed';
      return reply(200, { open, sandbox: laneCase === 'sandbox', ...(open ? { card_form: { sdk_url: SQUARE_SDK,
        application_id: 'sandbox-sq0idb-veylet-qa-fixture', location_id: 'LQAFIXTURE' } } : {}) });
    }
    if (!bearer) return reply(401, { error: 'unauthorized' });
    // The server lane's proposed download endpoint for listing exports (not built): it
    // calls authorize_listing_export_download with the member's session and answers a
    // presigned link of at most 600 s. Here the link's host does not exist.
    if (method === 'POST' && path === '/listing-exports/download') {
      const tourId = [...exportRows.keys()].find(id => exportId(id) === body?.export_id);
      const statuses = { invalid: [400, 'invalid_request'], expired: [401, 'unauthorized'], 'not-allowed': [403, 'not_allowed'],
        unknown: [404, 'unknown_export'], 'too-many': [429, 'rate_limited'], fail: [502, 'download_failed'], 'not-open': [503, 'not_configured'] };
      if (statuses[exportsDownloadCase]) return reply(statuses[exportsDownloadCase][0], { error: statuses[exportsDownloadCase][1] });
      if (exportsDownloadCase === 'not-ready' && tourId) { exportRows.get(tourId).state = 'needs_attention'; return reply(409, { error: 'needs_attention' }); }
      if (!body || Object.keys(body).sort().join() !== 'export_id,kind' || !/^[0-9a-f-]{36}$/.test(String(body.export_id))) return reply(400, { error: 'invalid_request' });
      const answer = tourId ? exportJson(tourId) : null;
      if (!answer || !answer.kinds.includes(body.kind)) return reply(404, { error: 'unknown_export' });
      if (!answer.downloadable) return reply(409, { error: answer.state === 'ready' ? 'not_ready' : answer.state });
      const file = EXPORT_FILES[body.kind];
      return reply(200, { url: DOWNLOAD_HOST + EXPORT_NAMES[body.kind] + '?expires=600', filename: EXPORT_NAMES[body.kind],
        bytes: file.bytes, content_type: file.content_type, expires_in: 600 });
    }
    if (method === 'POST' && path === '/square/members-annual/checkout') {
      const refusal = params.get('checkout');
      if (refusal === 'fail') return reply(500, { error: 'server_error' });
      const statuses = { unauthorized: 401, not_eligible: 403, lane_closed: 503, checkout_failed: 502, invalid_request: 400, payment_declined: 402 };
      if (refusal) return reply(statuses[refusal] || 409, { error: refusal });
      if (!body || body.plan_code !== 'solo' || !['scheduled', 'now'].includes(body.start)
        || !/^[A-Za-z0-9:_-]{8,512}$/.test(body.source_id || '')) return reply(400, { error: 'invalid_request' });
      // The server fixes the terms: the tier's price and the start it computes, never the page's copy.
      const live = annualLive || annualFallback();
      // A retry after a failed first charge keeps the price that start was bought at.
      const plan = live.start_failed ? { code: live.start_failed.plan_code, year_cents: live.start_failed.year_cents }
        : live.plans.find(entry => entry.code === body.plan_code);
      if (!plan) return reply(403, { error: 'not_eligible' });
      const today = body.start === 'now' || !(live.starts_on > brisbaneToday);
      const scheduled = { plan_code: plan.code, year_cents: plan.year_cents, starts_on: today ? brisbaneToday : live.starts_on };
      annualLive = { ...live, scheduled, checkout_pending: null, start_failed: null };
      return reply(200, { scheduled, charge_today: today, sandbox: true });
    }
    if (method === 'POST' && path === '/square/packs/checkout') {
      const refusal = params.get('pack-checkout');
      if (refusal === 'fail') return reply(500, { error: 'server_error' });
      const statuses = { unauthorized: 401, not_eligible: 403, lane_closed: 503, checkout_failed: 502, invalid_request: 400, payment_declined: 402 };
      if (refusal) return reply(statuses[refusal] || 409, { error: refusal });
      const pack = PACKS.find(entry => entry.code === (body && body.pack_code));
      if (!pack || body.workspace_id !== 'synthetic-workspace' || !/^[A-Za-z0-9:_-]{8,512}$/.test(body.source_id || '')) return reply(400, { error: 'invalid_request' });
      if (packOffer().missing.length) return reply(403, { error: 'not_eligible' });
      // The server fixes the terms: the pack's own count and price, charged now.
      extraCredits += pack.walkthroughs;
      if (!packExpiry) {
        const when = new Date(brisbaneToday + 'T00:00:00Z'); when.setUTCFullYear(when.getUTCFullYear() + 1);
        packExpiry = when.toISOString().slice(0, 10);
      }
      return reply(200, { credited: pack.walkthroughs, credits_available: extraCredits, amount_cents: pack.price_cents, sandbox: laneCase === 'sandbox' });
    }
    if (method === 'POST' && path === '/square/trial/start') {
      const refusal = params.get('trial-start');
      if (refusal === 'fail') return reply(500, { error: 'server_error' });
      const statuses = { unauthorized: 401, not_eligible: 403, trial_used: 409, already_started: 409, abn_invalid: 400, lane_closed: 503, checkout_failed: 502, invalid_request: 400, payment_declined: 402 };
      if (refusal) return reply(statuses[refusal] || 409, { error: refusal });
      const offer = trialOffer();
      if (!body || body.workspace_id !== 'synthetic-workspace' || !['monthly', 'annual'].includes(body.plan_interval)
        || !/^\d{11}$/.test(body.abn || '') || !/^[A-Za-z0-9:_-]{8,512}$/.test(body.source_id || '')
        || !/^[0-9a-f-]{36}$/.test(body.attempt_id || '')) return reply(400, { error: 'invalid_request' });
      if (!offer.eligible) return reply(409, { error: offer.missing[0] === 'trial_used' ? 'trial_used' : offer.missing[0] === 'already_started' ? 'already_started' : 'not_eligible' });
      // The server fixes the terms: the plan's own price and the first charge day it computes.
      const plan = offer.plans.find(entry => entry.interval === body.plan_interval);
      trialStarted = { plan_interval: plan.interval, amount_cents: plan.cents, first_charge_on: offer.first_charge_on, starts_on: brisbaneToday };
      return reply(200, { trial: { ...trialStarted }, charged_today: false, sandbox: laneCase === 'sandbox' });
    }
    if (method === 'POST' && path === '/square/express/checkout') {
      const refusal = params.get('express-checkout');
      if (refusal === 'fail') return reply(500, { error: 'server_error' });
      const statuses = { unauthorized: 401, not_eligible: 403, full_today: 409, already_express: 409, lane_closed: 503, checkout_failed: 502, invalid_request: 400, payment_declined: 402 };
      if (refusal) return reply(statuses[refusal] || 409, { error: refusal });
      if (!body || body.workspace_id !== 'synthetic-workspace' || body.job_id !== EXPRESS_JOB || !/^[A-Za-z0-9:_-]{8,512}$/.test(body.source_id || '')
        || !/^[0-9a-f-]{36}$/.test(body.attempt_id || '')) return reply(400, { error: 'invalid_request' });
      if (expressLive.order) return reply(409, { error: 'already_express' });
      if (expressCapped && expressLive.taken >= 5) return reply(409, { error: 'full_today' });
      expressLive.taken += 1;
      expressLive.order = { state: 'open', due_at: minutesFromNow(30), completed_at: null, paid_with: 'card', amount_cents: 2900, refund: null };
      return reply(200, { job_id: EXPRESS_JOB, express: { ...expressLive.order }, taken_today: expressLive.taken, credits_available: expressLive.credits, sandbox: laneCase === 'sandbox' });
    }
    if (method === 'POST' && path === '/square/members-annual/cancel') {
      if (!annualLive || (!annualLive.scheduled && !annualLive.start_failed)) return reply(409, { error: 'invalid_request' });
      annualLive = { ...annualLive, scheduled: null, conflict: false, start_failed: null };
      return reply(200, { cancelled: true });
    }
    return reply(404, { error: 'invalid_request' });
  };
  /* A stand-in for Square's Web Payments SDK. account.js loads the real URL
   * from the lane; here that one script element is pointed at a local data URL
   * that installs this fake (or at a missing loopback path for `?sdk=fail`), so
   * the page's own loader runs and nothing leaves loopback. The fake card draws
   * a plainly labelled fixture field; it is not Square's form. */
  const SQUARE_SDK = 'https://sandbox.web.squarecdn.com/v1/square.js';
  window.VEYLET_QA_INSTALL_SQUARE = () => {
    window.Square = { payments(applicationId, locationId) {
      window.VEYLET_QA_CALLS.push({ name: 'Square.payments', args: [applicationId, locationId] });
      return { async card(options) {
        window.VEYLET_QA_CALLS.push({ name: 'Square.card', args: options || null });
        let input = null, host = null;
        return {
          async attach(selector) {
            host = document.querySelector(selector);
            if (!host) throw new Error('No card container');
            const frame = document.createElement('div');
            frame.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-height:48px;padding:0 12px;border:1px solid #7a877c;border-radius:2px;background:#fff;font:16px system-ui;color:#10231d';
            input = document.createElement('input');
            input.setAttribute('aria-label', 'Card number (QA fixture, not Square)');
            input.value = '4111 1111 1111 1111'; input.style.cssText = 'border:0;font:inherit;color:inherit;min-width:0;background:transparent';
            const tag = document.createElement('span'); tag.textContent = 'QA fixture'; tag.style.cssText = 'font-size:12px;color:#536557';
            frame.append(input, tag); host.replaceChildren(frame);
            window.VEYLET_QA_CALLS.push({ name: 'card.attach', args: selector });
          },
          async focus() { input?.focus(); },
          async tokenize() {
            window.VEYLET_QA_CALLS.push({ name: 'card.tokenize' });
            return params.get('tokenize') === 'fail'
              ? { status: 'Invalid', errors: [{ field: 'cardNumber', type: 'VALIDATION_ERROR', message: 'Card number is not valid' }] }
              : { status: 'OK', token: 'cnon:qa-fixture-card-token' };
          },
          async destroy() { host?.replaceChildren(); window.VEYLET_QA_CALLS.push({ name: 'card.destroy' }); },
        };
      } };
    } };
  };
  const createElement = document.createElement.bind(document);
  document.createElement = (tag, options) => {
    const element = createElement(tag, options);
    if (String(tag).toLowerCase() !== 'script') return element;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    Object.defineProperty(element, 'src', { configurable: true, get() { return descriptor.get.call(element); },
      set(value) {
        if (value !== SQUARE_SDK) return descriptor.set.call(element, value);
        window.VEYLET_QA_CALLS.push({ name: 'load Square SDK', args: value });
        descriptor.set.call(element, params.get('sdk') === 'fail' ? '/__qa/square-sdk-missing.js'
          : 'data:text/javascript,window.VEYLET_QA_INSTALL_SQUARE()');
      } });
    return element;
  };

  window.VEYLET_QA_CALLS = [];
  window.VEYLET_SUPABASE = { url: 'https://fixture.invalid', anonKey: 'non-network-fixture' };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: location.pathname === '/__qa/cache-upgrade/' || params.get('session') === 'out' ? null : { user, access_token: 'synthetic-access-token' } } }),
      onAuthStateChange: fn => { callback = fn; },
      signOut: async () => { callback?.('SIGNED_OUT', null); return {}; },
      signInWithOtp: async () => ({ error: { message: 'No emails are sent from this fixture.' } }),
    },
    from(table) {
      const role = scenario === 'operator' || teamCase === 'member-refused' ? 'operator' : teamCase === 'member' || !teamOwnerNow ? 'reviewer' : 'owner';
      const memberships = teamLeft ? [] : [{ workspace_id: 'synthetic-workspace', role, status: 'active' }];
      if (hostingCase) memberships.push({ workspace_id: 'synthetic-workspace-ended', role, status: 'active' });
      let columns = '', only = null;
      const answer = () => {
        if (table === 'properties') return { data: properties };
        if (table === 'memberships') return { data: planCase === 'nomembership' ? [] : memberships };
        if (scenario === 'errors') return { error: { message: 'Synthetic unavailable tour service' } };
        if (params.get('lineage') === 'missing' && /walkthrough_id/.test(columns)) return { error: { code: '42703', message: 'column tours.walkthrough_id does not exist' } };
        if (pauseCase === 'missing' && /share_paused_at/.test(columns)) return { error: { code: '42703', message: 'column tours.share_paused_at does not exist' } };
        const rows = tours.map(tour => ({ ...tour, ...(streamed ? { storage_path: 'synthetic/v2/manifest.json' } : {}), share_token: tokens.get(tour.id) || null, share_paused_at: pausedAt.get(tour.id) || null })).filter(row => only === null || row.id === only);
        // Only the columns asked for, as PostgREST answers: a read without the lineage
        // columns sees no walkthrough, version or replacement.
        const names = columns.split(',').map(name => name.trim()).filter(Boolean);
        return { data: names.length ? rows.map(row => Object.fromEntries(names.map(name => [name, row[name] ?? null]))) : rows };
      };
      const query = { select(value) { columns = String(value || ''); return query; }, eq(key, value) { if (table === 'tours' && key === 'id') only = value; return query; }, order() { return query; }, limit() { return query; }, single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); }, then(resolve, reject) {
        // Each desk read starts with its spaces (`?offline=`).
        if (table === 'properties') deskReads += 1;
        if (deskReadLost(table)) return Promise.reject(lostConnection()).then(resolve, reject);
        return Promise.resolve(answer()).then(resolve, reject); } }; return query;
    },
    async rpc(name, args) {
      window.VEYLET_QA_CALLS.push({ name, args });
      if (name === 'can_produce_tours') return { data: scenario === 'qualified' };
      if (name === 'get_workspace_plan') {
        if (planCase === 'unavailable') return { error: { message: 'Synthetic plan service failure' } };
        // Free months started on the page: a card plan whose first charge is on the day they end.
        if (trialStarted) {
          return { data: [{ ...planBase, source: 'web', status: 'trial', billing_interval: trialStarted.plan_interval, accepted_in_free_months: 0,
            accepted_total: 0, trial_started_at: trialStarted.starts_on + 'T00:00:00+10:00', trial_ends_at: trialStarted.first_charge_on + 'T00:00:00+10:00',
            renewal_price_aud_cents: trialStarted.amount_cents, workspace_id: args.p_workspace_id || planBase.workspace_id }] };
        }
        // `?case=plan-loading`: the plan answer never arrives, so the panel's skeleton stays.
        if (planCase === 'loading') return new Promise(() => {});
        const row = planRows[planCase] || planRows.trial;
        return { data: [{ ...row, workspace_id: args.p_workspace_id || row.workspace_id }] };
      }
      if (name === 'get_walkthrough_capacity') {
        if (planCase === 'invoice-unknown') return { error: { message: 'Synthetic capacity unavailable' } };
        const row = planRows[planCase] || planRows.trial;
        const blocked = row.apple_environment === 'Sandbox' ? 'sandbox_test_only' : !['trial', 'active'].includes(row.status) ? 'plan_not_active' : null;
        const v8 = CAPACITY_V8[planCase] || {};
        const limit = blocked ? 0 : v8.included_limit ?? ((row.status === 'trial' ? row.trial_included_walkthroughs : row.included_per_month) + (v8.banked_units || 0));
        const used = blocked ? 0 : v8.included_used ?? (row.status === 'trial' ? row.accepted_in_free_months : row.accepted_this_period);
        // Bonus walkthroughs usable now are extra credits too, as the server counts them.
        const extra = extraCredits + (v8.bonus_credits_available || 0);
        const remaining = Math.max(0, limit - used);
        return { data: [{ plan_status: row.status, included_limit: limit, included_used: used, included_remaining: remaining,
          extra_credits_available: extra, pack_credits_expiring_at: packExpiry, can_accept: !blocked && remaining + extra > 0,
          reason_code: blocked || (remaining + extra === 0 ? 'allowance_exhausted' : null), ...v8,
          included_limit: limit, included_used: used }] };
      }
      if (name === 'get_members_annual_offer') {
        if (annualCase === 'loading') return new Promise(() => {});
        if (annualCase === 'error') return { error: { message: 'Synthetic members’ price failure' } };
        // `?annual=missing`: the function does not exist yet, so no card (a capture of another card alone).
        if (annualCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.get_members_annual_offer' } };
        annualReads += 1;
        if (params.get('recheck') === 'off' && annualReads > 1 && annualLive) annualLive.apple_auto_renews = false;
        // Without `?annual=`, the answer that goes with the plan row (see annualFallback).
        return { data: JSON.parse(JSON.stringify(annualLive || annualFallback())) };
      }
      if (name === 'get_trial_offer') {
        if (trialCase === 'loading') return new Promise(() => {});
        if (trialCase === 'error') return { error: { message: 'Synthetic trial offer failure' } };
        if (trialCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.get_trial_offer' } };
        return { data: trialOffer() };
      }
      if (name === 'list_workspace_render_status') {
        if (offlineCase === 'status') throw lostConnection();
        if (renderCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.list_workspace_render_status' } };
        if (renderCase === 'loading') return new Promise(() => {});
        // Only the account's own workspace has captures; any other answers its spaces with none.
        if (args.p_workspace_id === 'synthetic-workspace') renderReads += 1;
        if (renderCase === 'error' || (params.get('render-poll') === 'error' && renderReads > 1)) return { error: { message: 'Synthetic render status failure' } };
        return { data: renderAnswer(args.p_workspace_id) };
      }
      if (name === 'get_express_offer') {
        if (expressCase === 'error') return { error: { message: 'Synthetic express offer failure' } };
        if (expressCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.get_express_offer' } };
        return { data: args.p_workspace_id === 'synthetic-workspace' ? expressOffer() : { ...expressOffer(), captures: [] } };
      }
      if (name === 'use_express_credit') {
        if (args.p_job_id !== EXPRESS_JOB) return { error: { code: 'P0001', message: 'capture not eligible for express' } };
        if (expressLive.order) return { error: { code: 'P0001', message: 'this capture is already express' } };
        if (expressCapped && expressLive.taken >= 5) return { error: { code: 'P0001', message: 'express renders are full today' } };
        if (expressLive.credits < 1) return { error: { code: 'P0001', message: 'no express render left' } };
        expressLive.credits -= 1; expressLive.taken += 1;
        expressLive.order = { state: 'open', due_at: minutesFromNow(30), completed_at: null, paid_with: 'credit', amount_cents: null, refund: null };
        return { data: { job_id: EXPRESS_JOB, express: { ...expressLive.order }, taken_today: expressLive.taken, credits_available: expressLive.credits } };
      }
      if (name === 'get_pack_offer') {
        if (packsCase === 'loading') return new Promise(() => {});
        if (packsCase === 'error') return { error: { message: 'Synthetic pack offer failure' } };
        if (packsCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.get_pack_offer' } };
        return { data: packOffer() };
      }
      if (name === 'get_referral_code') {
        if (referralCase === 'loading') return new Promise(() => {});
        if (referralCase === 'error') return { error: { message: 'Synthetic referral code failure' } };
        if (referralCase === 'sandbox') return { error: { code: 'P0001', message: 'test workspaces cannot take part in referrals' } };
        if (referralCase === 'link') return { data: { code: '7a3f09c2b41e', referred_offices: 2, bonus_walkthroughs: 1 } };
        if (referralCase === 'invalid') return { data: { code: 'QA-FIXTURE', referred_offices: 0, bonus_walkthroughs: 0 } };
        return { error: { code: 'PGRST202', message: 'Could not find the function public.get_referral_code' } };
      }
      if (name === 'claim_workspace_referral') {
        const refuse = message => ({ error: { code: 'P0001', message } });
        const code = String(args.p_code || '').trim().toLowerCase();
        if (claimCase === 'error') return { error: { message: 'Synthetic referral claim failure' } };
        if (!/^[0-9a-f]{12}$/.test(code) || claimCase === 'unknown') return refuse('unknown referral link');
        if (claimCase === 'self') return refuse('an office cannot refer itself');
        if (claimCase === 'paid') return refuse('a referral is recorded before the office first pays; ask the studio');
        if (referralClaimed && referralClaimed !== code) return refuse('this office already records who referred it');
        const recorded = referralClaimed !== code;
        referralClaimed = code;
        return { data: { recorded, walkthroughs: 1, granted_when: 'first_payment' } };
      }
      if (name === 'get_account_deletion') return { data: deletion ? [deletion] : [] };
      if (name === 'request_account_deletion') {
        // `?team=owner` with a member who joined: the office still has teammates.
        if (teamCase === 'owner' && teamOwnerNow && teamPeople.some(person => person.role !== 'owner' && !teamRemoved.has(person.user_id))) {
          return { data: null, error: { code: 'P0001', message: params.get('deletion-refusal') === 'generic' ? 'shared ownership requires reviewed transfer before deletion'
            : 'Transfer ownership or remove your teammates first.' } };
        }
        deletion = { user_id: 'synthetic-user', requested_at: new Date().toISOString(),
          reason: (args && args.p_reason) || null, status: 'requested', cancelled_at: null, completed_at: null };
        return { data: [deletion] };
      }
      if (name === 'cancel_account_deletion') {
        if (deletion) deletion = { ...deletion, status: 'cancelled', cancelled_at: new Date().toISOString() };
        return { data: deletion ? [deletion] : [] };
      }
      if (name === 'studio_list_deletion_requests') {
        if (studioCase === 'unavailable') return { error: { message: 'Synthetic deletion request service failure' } };
        return { data: studioCase === 'deletions' ? studioDeletions.map(row => ({ ...row })) : [] };
      }
      if (name === 'studio_is_member') {
        return studioCase === 'unavailable'
          ? { error: { message: 'Synthetic studio membership check failure' } }
          : { data: studioCase !== 'outsider' };
      }
      if (name === 'studio_list_accounts') {
        if (studioCase === 'unavailable') return { error: { message: 'Synthetic studio account service failure' } };
        if (studioCase === 'outsider') return { error: { message: 'Synthetic studio refuses non-studio users.' } };
        return { data: studioAccounts.map(row => ({ ...row })) };
      }
      if (name === 'studio_list_hosted_tours') {
        if (studioCase === 'unavailable' || studioCase === 'hosted-errors') return { error: { message: 'Synthetic hosted list failure' } };
        return { data: studioHosted.map(row => ({ ...row })) };
      }
      if (name === 'studio_record_hosting_extension') {
        const row = studioHosted.find(item => item.tour_id === args.p_tour_id);
        if (!row) return { error: { message: 'Synthetic: unknown walkthrough.' } };
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(String(args.p_reference || ''))) return { error: { message: 'An agreement or invoice reference is required.' } };
        if (!(new Date(args.p_extended_until) > new Date(row.hosted_until))) return { error: { message: 'An extension can only move the hosting date later.' } };
        Object.assign(row, { extended_until: args.p_extended_until, hosted_until: args.p_extended_until });
        return { data: [{ ...row }] };
      }
      if (name === 'studio_activate_invoice_plan') {
        const refuse = message => ({ error: { code: 'P0001', message } });
        const account = studioAccounts.find(row => row.workspace_id === args.p_workspace_id);
        if (!account || !['invoice', 'trial-ended'].includes(studioCase) || account.source !== 'studio') return { error: { message: 'Fictional invoice fixture only' } };
        const opaque = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/;
        if (![args.p_receipt_key, args.p_agreement_id, args.p_settlement_id].every(value => opaque.test(String(value || '')))) {
          return refuse('opaque receipt, written agreement and settled invoice line references required');
        }
        // Offer 2026-09-25.1, as the migration settles it: the Veylet plan only (a retired
        // plan is never newly invoiced), 9900 a month or the annual tier's 99000 a year.
        if (!['monthly', 'annual'].includes(args.p_billing_interval)) return refuse('invoice plan and billing interval do not match');
        if (args.p_plan_code !== 'solo') return refuse('plan ' + args.p_plan_code + ' is retired for new accounts (offer 2026-09-24.2): invoice the Veylet plan (solo)');
        const prior = studioInvoiceReceipts.get(args.p_receipt_key);
        if (prior) return JSON.stringify(prior) === JSON.stringify(args) ? { data: [planFields(account)] } : refuse('invoice receipt conflicts with immutable terms');
        if (args.p_billing_interval === 'annual') {
          if (!account.trial_started_at) return refuse('the Veylet plan annual needs started free months');
          if (studioTier === 'closed') return refuse('the Veylet plan annual is paused for new sales');
        }
        const now = Date.now(), start = new Date(args.p_period_start), end = new Date(args.p_period_end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > now || start.getTime() < now - 366 * 86400000
          || end.getTime() <= now || end <= start) return refuse('current bounded invoice service period required');
        const expected = new Date(start);
        if (args.p_billing_interval === 'annual') expected.setUTCFullYear(expected.getUTCFullYear() + 1); else expected.setUTCMonth(expected.getUTCMonth() + 1);
        if (expected.getTime() !== end.getTime()) return refuse('invoice period does not match agreed billing interval');
        if (account.trial_started_at && new Date(account.trial_ends_at).getTime() > now) return refuse('early paid switch during free months is not available');
        if (account.current_period_ends_at && new Date(account.current_period_ends_at) > start) return refuse('invoice service periods must not overlap or move backwards');
        studioInvoiceReceipts.set(args.p_receipt_key, { ...args });
        // A year starting where the free months ended was chosen before they ended: the
        // early-annual bonus (4 walkthroughs and 4 express renders for its first plan year), once per workspace.
        if (args.p_billing_interval === 'annual' && account.trial_ends_at && !account.early_annual_bonus
          && start.getTime() <= new Date(account.trial_ends_at).getTime() + 86400000) account.early_annual_bonus = 4;
        Object.assign(account, { status: 'active', plan_code: 'solo', billing_interval: args.p_billing_interval,
          renewal_price_aud_cents: STUDIO_INVOICE_CENTS[args.p_billing_interval], price_aud_cents: 9900, included_per_month: args.p_billing_interval === 'annual' ? 24 : 2,
          auto_renews: false, current_period_ends_at: args.p_period_end, period_started_at: args.p_period_start });
        return { data: [planFields(account)] };
      }
      if (name === 'studio_members_annual_tier') {
        if (studioCase === 'unavailable' || studioTier === 'error') return { error: { message: 'Synthetic tier unavailable' } };
        return { data: [{ tier: studioTier, updated_at: '2026-09-24T00:00:00Z' }] };
      }
      // Proposed: a settled pack invoice for any activated account, idempotent per receipt.
      if (name === 'studio_record_pack_invoice') {
        const account = studioAccounts.find(row => row.workspace_id === args.p_workspace_id);
        const pack = STUDIO_PACKS[args.p_pack_code];
        if (!account || !pack || !['trial', 'active'].includes(account.status)) return { error: { message: 'Synthetic: a pack needs an activated account.' } };
        const prior = studioPackReceipts.get(args.p_receipt_key);
        if (prior) return JSON.stringify(prior.args) === JSON.stringify(args) ? { data: [prior.answer] } : { error: { message: 'Synthetic: receipt conflicts with recorded terms.' } };
        account.pack_credits = (account.pack_credits || 0) + pack.walkthroughs;
        const answer = { credited: pack.walkthroughs, credits_available: account.pack_credits, amount_cents: pack.cents, expires_on: studioYearOn() };
        studioPackReceipts.set(args.p_receipt_key, { args: { ...args }, answer });
        return { data: [answer] };
      }
      // Proposed: one free 3-pack per referred office, at most four, idempotent per reference.
      if (name === 'studio_grant_founding_pack') {
        const account = studioAccounts.find(row => row.workspace_id === args.p_workspace_id);
        if (!account || !(account.founding_member === true || account.plan_code === 'founding')) return { error: { message: 'Synthetic: not a founding workspace.' } };
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(String(args.p_reference || ''))) return { error: { message: 'Synthetic: an opaque reference is required.' } };
        const prior = studioGrantReceipts.get(args.p_reference);
        if (prior) return { data: [prior] };
        if (!Number.isInteger(account.founding_grants_used) || account.founding_grants_used >= 4) return { error: { message: 'Synthetic: no founding grant left.' } };
        account.founding_grants_used += 1;
        account.pack_credits = (account.pack_credits || 0) + 3;
        const answer = { credited: 3, credits_available: account.pack_credits, grants_used: account.founding_grants_used, expires_on: studioYearOn() };
        studioGrantReceipts.set(args.p_reference, answer);
        return { data: [answer] };
      }
      // Offer 2026-09-25.1 (migration 20260925100000_offer_v8): grant a referred office's
      // referral walkthroughs once it has paid, recording the referral first when the
      // studio names the referring office with a reference.
      if (name === 'studio_grant_referral_bonus') {
        const refuse = message => ({ error: { code: 'P0001', message } });
        const reference = args.p_reference === null || args.p_reference === undefined ? null : String(args.p_reference).trim() || null;
        if (reference !== null && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(reference)) return refuse('an opaque studio reference is required');
        const referred = studioAccounts.find(row => row.workspace_id === args.p_workspace_id);
        if (!referred) return refuse('workspace plan not found');
        let recorded = studioReferrals.get(referred.workspace_id);
        if (!recorded) {
          if (!args.p_referrer_workspace_id || !reference) return refuse('no referral is recorded for this office: name the referring office and a reference');
          const referrer = studioAccounts.find(row => row.workspace_id === args.p_referrer_workspace_id);
          if (!referrer) return refuse('unknown referral link');
          if (referrer === referred) return refuse('an office cannot refer itself');
          if (studioReferrals.get(referrer.workspace_id)?.referrer === referred.workspace_id) return refuse('two offices cannot refer each other');
          recorded = { referrer: referrer.workspace_id, source: 'studio', reference };
          studioReferrals.set(referred.workspace_id, recorded);
        } else if (args.p_referrer_workspace_id && args.p_referrer_workspace_id !== recorded.referrer) {
          return refuse('this office already records another referring office');
        }
        const answer = studioReferralGrants.has(referred.workspace_id) ? { granted: false, reason: 'already_granted' }
          : referred.status !== 'active' ? { granted: false, reason: 'not_paying' } : null;
        if (answer) return { data: { ...answer, referrer_workspace_id: recorded.referrer } };
        studioReferralGrants.add(referred.workspace_id);
        const expires = new Date(); expires.setUTCMonth(expires.getUTCMonth() + 12);
        return { data: { granted: true, referrer_granted: true, walkthroughs: 1, expires_at: expires.toISOString(), referrer_workspace_id: recorded.referrer } };
      }
      if (name === 'studio_set_listing_home') {
        const refuse = message => ({ error: { code: 'P0001', message } });
        const reference = String(args.p_reference || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(reference)) return refuse('an opaque studio reference (ticket or estimate) is required');
        const bedrooms = args.p_bedrooms, area = args.p_floor_area_m2 ?? null;
        if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 99 || typeof args.p_second_dwelling !== 'boolean'
          || (area !== null && (!Number.isInteger(area) || area < 1 || area > 100000))) {
          return refuse('declare the bedrooms (0 to 99), whether there is a second dwelling, and optionally the floor area in square metres');
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(args.p_property_id || ''))) return refuse('listing not available');
        const locked = args.p_property_id === LOCKED_LISTING;
        const state = { property_id: args.p_property_id, declared: true, bedrooms, second_dwelling: args.p_second_dwelling,
          floor_area_m2: area, declared_at: new Date().toISOString(),
          walkthrough_units: bedrooms >= 5 || args.p_second_dwelling || (area !== null && area > 350) ? 2 : 1,
          locked, locked_at: locked ? hoursAgo(30) : null };
        studioListings.set(args.p_property_id, state);
        return { data: { ...state } };
      }
      if (name === 'studio_money_exceptions') {
        if (moneyCase === 'loading') return new Promise(() => {});
        if (moneyCase === 'error' || studioCase === 'unavailable') return { error: { message: 'Synthetic money exceptions failure' } };
        return { data: studioMoney.map(row => ({ ...row })) };
      }
      if (name === 'studio_resolve_money_exception') {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(String(args.p_note || ''))) return { error: { message: 'an opaque reference such as the Square refund id is required' } };
        const row = studioMoney.find(item => item.exception_key === args.p_exception_key);
        if (!row) return { error: { message: 'unknown or already cleared money exception' } };
        if (!row.resolvable) return { error: { message: 'this money exception clears when its state changes' } };
        studioMoney = studioMoney.filter(item => item !== row);
        return { data: { exception_key: row.exception_key, kind: row.kind, resolved_at: new Date().toISOString(), recorded: true } };
      }
      if (name === 'studio_capture_queue') {
        if (queueCase === 'loading') return new Promise(() => {});
        if (queueCase === 'error' || studioCase === 'unavailable') return { error: { message: 'Synthetic capture queue failure' } };
        return { data: studioQueue.map(row => ({ ...row })) };
      }
      if (name === 'studio_express_queue') {
        if (studioExpressCase === 'loading') return new Promise(() => {});
        if (studioExpressCase === 'error' || studioCase === 'unavailable') return { error: { message: 'Synthetic express queue failure' } };
        if (studioExpressCase === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.studio_express_queue' } };
        return { data: studioExpress.map(row => ({ ...row })) };
      }
      if (name === 'studio_capture_sla') {
        if (queueCase === 'loading') return new Promise(() => {});
        if (params.get('sla') === 'error' || studioCase === 'unavailable') return { error: { message: 'Synthetic SLA failure' } };
        if (!Number.isInteger(args?.p_days) || args.p_days < 1 || args.p_days > 366) return { error: { message: 'window must be 1 to 366 days' } };
        return { data: studioSla.map(row => ({ ...row })) };
      }
      if (name === 'studio_record_tour_correction') {
        const reference = String(args.p_reference || '').trim();
        if (!['defect', 'requested_change', 'first_walkthrough_redo'].includes(args.p_reason)) return { error: { message: 'reason must be defect, requested_change or first_walkthrough_redo' } };
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(reference)) return { error: { message: 'an opaque studio reference (ticket or estimate) is required' } };
        if (!args.p_tour_id || !args.p_corrects_tour_id || args.p_tour_id === args.p_corrects_tour_id) return { error: { message: 'name the new package and the walkthrough revision it corrects' } };
        const next = correctionTours.get(args.p_tour_id), prior = correctionTours.get(args.p_corrects_tour_id);
        if (!next) return { error: { message: 'tour not available' } };
        if (!prior || prior.property !== next.property) return { error: { message: 'a correction revises a walkthrough of the same property; any other package is a new walkthrough' } };
        const recorded = correctionRecords.get(args.p_tour_id);
        if (recorded) {
          if (recorded.corrects_tour_id !== args.p_corrects_tour_id || recorded.reason !== args.p_reason || recorded.reference !== reference) return { error: { message: 'this package is already recorded as a correction with other details' } };
          return { data: { ...recorded, recorded: false } };
        }
        if (next.reviewed) return { error: { message: 'this package was already reviewed as its own walkthrough; reconcile it at the desk' } };
        const latest = [...correctionTours.values()].filter(row => row.walkthrough === prior.walkthrough).sort((a, b) => b.revision - a.revision)[0];
        if (latest !== prior) return { error: { message: 'correct the latest revision of this walkthrough (revision ' + latest.revision + ')' } };
        // Offer 2026-09-25.2: the free redo is for the account's first accepted walkthrough, once.
        if (args.p_reason === 'first_walkthrough_redo') {
          if (prior.walkthrough !== FIRST_ACCEPTED_WALKTHROUGH) return { error: { code: 'P0001', message: 'the first-walkthrough redo applies only to the account’s first accepted walkthrough' } };
          if ([...correctionRecords.values()].some(row => row.reason === 'first_walkthrough_redo')) return { error: { code: 'P0001', message: 'the first-walkthrough redo is already used for this account' } };
        }
        Object.assign(next, { walkthrough: prior.walkthrough, revision: prior.revision + 1 });
        const record = { tour_id: args.p_tour_id, walkthrough_id: prior.walkthrough, revision: next.revision, corrects_tour_id: args.p_corrects_tour_id,
          reason: args.p_reason, reference, recorded_at: new Date().toISOString(), walkthrough_accepted: true };
        correctionRecords.set(args.p_tour_id, record);
        return { data: { ...record, recorded: true } };
      }
      if (name === 'studio_set_plan') {
        const account = studioAccounts.find(row => row.workspace_id === args.p_workspace_id);
        if (!account || !['pending', 'trial', 'active', 'ended'].includes(args.p_status)) {
          return { error: { message: 'Synthetic studio rejected that plan change.' } };
        }
        account.status = args.p_status;
        if (args.p_trial_months) account.trial_months = args.p_trial_months;
        if (args.p_trial_included) account.trial_included_walkthroughs = args.p_trial_included;
        // An App Store subscription keeps its source whatever the desk sends.
        if (args.p_source && account.source !== 'apple') account.source = args.p_source;
        if (args.p_plan_code) account.plan_code = args.p_plan_code;
        if (typeof args.p_auto_renews === 'boolean') account.auto_renews = args.p_auto_renews;
        if (args.p_trial_started_at) account.trial_started_at = new Date(args.p_trial_started_at).toISOString();
        if (args.p_note) account.note = args.p_note;
        if (account.status === 'pending') { account.trial_started_at = null; account.trial_ends_at = null; }
        else if (account.trial_started_at) {
          const ends = new Date(account.trial_started_at);
          ends.setMonth(ends.getMonth() + (account.trial_months || 3));
          account.trial_ends_at = ends.toISOString();
        }
        account.updated_at = new Date().toISOString();
        // Exactly the plan row the contract returns: the stored note is not in it.
        return { data: [planFields(account)] };
      }
      if (name === 'get_tour_hosting') {
        if (scenario === 'hosting-errors') return { error: { message: 'Synthetic hosting dates unavailable' } };
        return { data: tours.filter(tour => !tour.superseded_at).map(hostingRow) };
      }
      // The member hosting read (20260926132000, draft): each tour's state. The ended venue's
      // plan ended 5 days ago, so its walkthroughs go offline in 9 days (offline_on); with
      // `?hosting-state=offline` it ended 20 days ago (offline 6 days ago), with `extension`
      // the older live one is kept online by a hosting extension for 200 days, and `missing`
      // answers PGRST202 (the desk then derives the state from plan_active).
      if (name === 'get_tour_hosting_states') {
        const hostingState = params.get('hosting-state');
        if (hostingState === 'missing') return { error: { code: 'PGRST202', message: 'Could not find the function public.get_tour_hosting_states' } };
        const endedAt = Date.now() - (hostingState === 'offline' ? 20 : 5) * DAY;
        const offlineAt = new Date(endedAt + 14 * DAY).toISOString();
        return { data: tours.filter(tour => !tour.superseded_at).map(hostingRow).map(row => {
          const active = row.plan_active;
          const extended = hostingState === 'extension' && row.tour_id === 'synthetic-live-past' ? new Date(Date.now() + 200 * DAY).toISOString() : null;
          const state = active ? 'live_with_plan' : extended ? 'live_with_extension' : Date.now() < Date.parse(offlineAt) ? 'offline_on' : 'offline';
          return { tour_id: row.tour_id, property_id: row.property_id, state, offline_at: active ? null : extended || offlineAt,
            extended_until: extended, sharing_on: row.sharing_on, share_paused: false, plan_active: active };
        }) };
      }
      if (name === 'get_tour_review') return { data: [{ approved: approvedTours.has(args.p_tour_id) }] };
      if (name === 'get_tour_review_target') { const tour = tours.find(row => row.id === args.p_tour_id); return { data: tour ? [{ tour_id: tour.id, storage_path: tour.storage_path, package_revision: packageRevision() }] : [] }; }
      if (name === 'review_tour_versioned') {
        if (args.p_expected_package_revision !== packageRevision() || args.p_expected_storage_path !== tours.find(row => row.id === args.p_tour_id)?.storage_path) return { error: { code: 'P0001', message: 'tour package changed; reload and review again', details: 'VEYLET_PACKAGE_REVISION_CHANGED' } };
        if (!Object.values(args.p_checks || {}).every(value => value === true) || Object.keys(args.p_checks || {}).length !== 5 || !args.p_capture_permission || !args.p_publication_permission) return { error: { message: 'Complete all release checks.' } };
        const reviewed = tours.find(row => row.id === args.p_tour_id);
        if (scenario === 'correction-superseded' && args.p_tour_id === WALK.two && !tours.some(row => row.id === WALK.three)) {
          // Meanwhile another reviewer approved version 3, which retired versions 1 and 2.
          tours.unshift({ ...reviewed, id: WALK.three, storage_path: 'synthetic/correction-v3.zip', created_at: new Date().toISOString(), revision: 3, revision_of: WALK.two });
          reviewed.superseded_at = new Date().toISOString();
          const first = tours.find(row => row.id === WALK.one); first.superseded_at = reviewed.superseded_at;
          tokens.set(WALK.three, tokens.get(WALK.one)); releasedAt.set(WALK.three, releasedAt.get(WALK.one));
          tokens.delete(WALK.one); approvedTours.delete(WALK.one); approvedTours.add(WALK.three); everApproved.add(WALK.three);
        }
        if (reviewed?.superseded_at) return { error: { code: 'P0001', message: 'A newer revision of this walkthrough is approved; review that revision instead.', details: 'VEYLET_REVISION_SUPERSEDED' } };
        if (reviewed && revisionOf(reviewed) > 1 && !approvedTours.has(reviewed.id)) {
          const earlier = tours.filter(row => walkthroughOf(row) === walkthroughOf(reviewed) && revisionOf(row) < revisionOf(reviewed));
          // The same link and embed move here: the live version's token and first release.
          const live = earlier.filter(row => tokens.has(row.id)).sort((a, b) => revisionOf(b) - revisionOf(a))[0];
          const movedToken = live ? tokens.get(live.id) : null;
          const released = earlier.map(row => releasedAt.get(row.id)).filter(Boolean).sort()[0];
          for (const row of earlier) { row.superseded_at = row.superseded_at || new Date().toISOString(); approvedTours.delete(row.id); tokens.delete(row.id); }
          if (movedToken) tokens.set(reviewed.id, movedToken);
          if (released) releasedAt.set(reviewed.id, released);
        }
        approvedTours.add(args.p_tour_id); everApproved.add(args.p_tour_id); return { data: [{ approved: true, reviewed_at: new Date().toISOString() }] };
      }
      if (name === 'get_walkthrough_revision') {
        const row = tours.find(item => item.id === args.p_tour_id);
        if (!row) return { error: { code: 'P0001', message: 'tour not available' } };
        const family = tours.filter(item => walkthroughOf(item) === walkthroughOf(row));
        const accepted = family.some(item => everApproved.has(item.id));
        const approvedNow = approvedTours.has(row.id);
        return { data: [{ tour_id: row.id, walkthrough_id: walkthroughOf(row), revision: revisionOf(row), revision_of: row.revision_of || null,
          superseded_at: row.superseded_at || null, correction_reason: revisionOf(row) > 1 ? 'requested_change' : null, walkthrough_accepted: accepted,
          approval_uses_allowance: !row.superseded_at && !approvedNow && !accepted,
          link_moves_on_approval: !row.superseded_at && !approvedNow && family.some(item => revisionOf(item) < revisionOf(row) && tokens.has(item.id)) }] };
      }
      if (name === 'review_tour') return { error: { code: '42501', message: 'Legacy review RPC is unavailable.' } };
      if (name === 'withdraw_tour_review') { approvedTours.delete(args.p_tour_id); tokens.delete(args.p_tour_id); return { data: [{ approved: false }] }; }
      if (name === 'enable_tour_share') {
        const refusal = { review: 'review this tour before sharing', uploader: 'tour uploader membership is no longer active', permission: 'sharing permission required',
          occupancy: 'occupancy not declared', consent: 'tenant consent required' }[shareCase] || occupancyRefusal(tourProperty(args.p_tour_id));
        if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
        if (shareCase === 'fail') return { data: null, error: { message: 'Synthetic sharing failure' } };
        if (!approvedTours.has(args.p_tour_id)) return { error: { message: 'Synthetic: approve before sharing.' } };
        const live = args.p_tour_id === 'synthetic-tour' ? 'synthetic-fixture-token' : 'synthetic-fixture-token-' + args.p_tour_id.slice(10);
        tokens.set(args.p_tour_id, live);
        if (!releasedAt.has(args.p_tour_id)) releasedAt.set(args.p_tour_id, new Date().toISOString());
        if (shareCase === 'lost') return { data: null, error: { message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch', hint: '', code: '' } };
        return { data: live };
      }
      if (name === 'revoke_tour_share') { tokens.delete(args.p_tour_id); pausedAt.delete(args.p_tour_id); return { data: true }; }
      if (name === 'pause_tour_share' || name === 'resume_tour_share') {
        if (pauseCase === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + '(p_tour_id) in the schema cache' } };
        if (pauseCase === 'fail') return { data: null, error: { message: 'Synthetic sharing failure' } };
        if (!tokens.has(args.p_tour_id)) return { data: null, error: { code: 'P0001', message: 'sharing is not on' } };
        if (name === 'resume_tour_share' && occupancyRefusal(tourProperty(args.p_tour_id))) return { data: null, error: { code: 'P0001', message: occupancyRefusal(tourProperty(args.p_tour_id)) } };
        if (name === 'pause_tour_share') { if (!pausedAt.has(args.p_tour_id)) pausedAt.set(args.p_tour_id, new Date().toISOString()); return { data: null }; }
        pausedAt.delete(args.p_tour_id);
        return { data: tokens.get(args.p_tour_id) };
      }
      if (name === 'get_email_preferences') {
        if (emailCase === 'missing') return emailMissing('get_email_preferences');
        if (params.get('session') === 'out') return { data: null, error: { code: 'P0001', message: 'sign in required' } };
        if (emailCase === 'error') return { data: null, error: { message: 'Synthetic email preferences failure' } };
        if (emailCase === 'loading') return new Promise(() => {});
        if (emailCase === 'bad') return { data: { current_wording_version: 'tips-v1' } };
        const current = emailCase === 'v2' ? 'tips-v2' : 'tips-v1';
        return { data: { ...emailChoice, time_zone: null, current_wording_version: current, current_wording: EMAIL_WORDINGS[current] } };
      }
      if (name === 'set_email_tips_preference') {
        if (emailCase === 'missing' || emailSaveCase === 'missing') return emailMissing('set_email_tips_preference');
        if (emailSaveCase === 'offline') throw lostConnection();
        if (emailSaveCase === 'expired') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
        if (emailSaveCase === 'fail') return { data: null, error: { message: 'Synthetic email preferences save failure' } };
        if (emailSaveCase === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
        if (typeof args?.p_opt_in !== 'boolean' || !['signup', 'account', 'app'].includes(args?.p_source)) {
          return { data: null, error: { code: 'P0001', message: 'a choice and its source (signup, account or app) are required' } };
        }
        if (args.p_opt_in && !EMAIL_WORDINGS[args.p_wording_version]) return { data: null, error: { code: 'P0001', message: 'unknown consent wording' } };
        if (emailChoice.tips_opt_in !== args.p_opt_in || (args.p_opt_in && emailChoice.wording_version !== args.p_wording_version)) {
          emailChoice = { tips_opt_in: args.p_opt_in, wording_version: args.p_opt_in ? args.p_wording_version : null, changed_at: new Date().toISOString() };
        }
        return { data: { tips_opt_in: emailChoice.tips_opt_in, wording_version: emailChoice.wording_version, changed_at: emailChoice.changed_at } };
      }
      if (name === 'record_tour_view') {
        if (viewsCase === 'missing') return viewsMissing;
        if (viewsCase === 'error') return { data: null, error: { message: 'Synthetic view failure' } };
        return { data: null };
      }
      if (['get_listing_sharing_readiness', 'set_listing_occupancy', 'record_tenant_consent'].includes(name)) {
        if (occupancyCase === 'missing') return occupancyMissing(name);
        const row = occupancy.get(args?.p_property_id);
        if (name === 'get_listing_sharing_readiness') {
          if (occupancyCase === 'error') return { data: null, error: { message: 'Synthetic readiness failure' } };
          if (occupancyCase === 'loading') return new Promise(() => {});
          if (!row) return { data: null, error: { code: 'P0001', message: 'listing unavailable' } };
          const blocked = occupancyBlocked(args.p_property_id);
          const live = tours.some(tour => tour.property_id === args.p_property_id && tokens.has(tour.id));
          return { data: { occupancy: row.occupancy, consent_recorded_at: row.consentAt, consent_reference: row.reference,
            blocked_reason: blocked, grandfathered: Boolean(blocked && live) } };
        }
        if (occupancySaveCase === 'missing') return occupancyMissing(name);
        if (occupancySaveCase === 'offline') throw lostConnection();
        if (occupancySaveCase === 'expired') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
        if (occupancySaveCase === 'permission') return { data: null, error: { code: 'P0001', message: 'sharing permission required' } };
        if (occupancySaveCase === 'fail') return { data: null, error: { message: 'Synthetic occupancy save failure' } };
        if (!row) return { data: null, error: { code: 'P0001', message: 'listing unavailable' } };
        if (name === 'set_listing_occupancy') {
          if (!['owner_occupied', 'vacant', 'tenanted'].includes(args?.p_occupancy)) return { data: null, error: { code: 'P0001', message: 'occupancy must be owner_occupied, vacant or tenanted' } };
          if (row.occupancy !== args.p_occupancy) { row.consentAt = null; row.reference = null; }
          row.occupancy = args.p_occupancy;
          return { data: null };
        }
        const reference = String(args?.p_consent_reference || '').trim();
        const today = new Date().toISOString().slice(0, 10);
        if (!reference || reference.length > 120) return { data: null, error: { code: 'P0001', message: 'consent reference must be 1 to 120 characters' } };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args?.p_consented_on || '')) || args.p_consented_on > today) return { data: null, error: { code: 'P0001', message: 'consent date must be a date that is not in the future' } };
        if (row.occupancy !== 'tenanted') return { data: null, error: { code: 'P0001', message: 'listing is not tenanted' } };
        row.consentAt = new Date().toISOString(); row.reference = reference;
        return { data: null };
      }
      if (['remove_workspace_member', 'transfer_workspace_ownership', 'leave_workspace'].includes(name)) {
        if (teamCase === 'missing' || teamMemberCase === 'missing') return teamMissing(name);
        if (teamMemberCase === 'fail') return { data: null, error: { message: 'Synthetic member failure' } };
        // The draft's answers: counts for remove and leave (two of the member's links stop), the new owner for transfer.
        // Walkthroughs belong to the office (draft 20260926126000): the departed member's two live links stay live.
        const counts = (state, target) => ({ data: { state, changed: true, invites_revoked: 0, live_links_kept: 2,
          departed_display_name: teamPeople.find(row => row.user_id === target)?.display_name ?? null } });
        if (name === 'leave_workspace') {
          if (teamCase !== 'member' && teamCase !== 'member-refused') return { data: null, error: { code: 'P0001', message: 'an owner stays until ownership is transferred' } };
          teamLeft = true; return counts('left', teamSelf());
        }
        if (!teamOwnerNow || !['owner', 'owner-empty'].includes(teamCase)) return { data: null, error: { code: 'P0001', message: 'workspace owner only' } };
        const target = name === 'remove_workspace_member' ? args?.p_user_id : args?.p_new_owner;
        const person = teamPeople.find(row => row.user_id === target);
        if (!person || teamRemoved.has(target)) return { data: null, error: { code: 'P0001', message: 'not a member of this workspace' } };
        if (target === teamSelf() || person.role === 'owner') return { data: null, error: { code: 'P0001', message: 'choose another active member of this workspace' } };
        if (name === 'transfer_workspace_ownership' && teamMemberCase === 'billing') return { data: null, error: { code: 'P0001', message: 'cancel this workspace\'s card or App Store subscription before transferring it' } };
        if (name === 'remove_workspace_member') { teamRemoved.add(target); return counts('removed', target); }
        teamOwnerNow = false; teamPeople[0].role = 'reviewer'; person.role = 'owner';
        return { data: { state: 'transferred', workspace_id: args.p_workspace_id, owner: target, previous_owner_role: 'reviewer' } };
      }
      if (name === 'list_workspace_members') {
        if (teamCase === 'missing' || teamMembersCase === 'missing') return teamMissing(name);
        if (teamCase === 'loading') return new Promise(() => {});
        if (teamMembersCase === 'error' || teamCase === 'error') return { data: null, error: { message: 'Synthetic members failure' } };
        if (teamLeft) return { data: null, error: { code: 'P0001', message: 'not a member of this workspace' } };
        const self = teamSelf();
        return { data: teamPeople.filter(person => !teamRemoved.has(person.user_id))
          .map(({ self: _unused, ...person }) => ({ ...person, is_self: person.user_id === self }))
          .sort((a, b) => (b.role === 'owner') - (a.role === 'owner')) };
      }
      if (['list_workspace_invites', 'invite_to_workspace', 'revoke_workspace_invite'].includes(name)) {
        if (teamCase === 'missing') return teamMissing(name);
        if (name === 'list_workspace_invites') {
          if (teamCase === 'error') return { data: null, error: { message: 'Synthetic invites failure' } };
          if (teamCase === 'loading') return new Promise(() => {});
          if (teamCase === 'member-refused' || teamLeft) return { data: null, error: { code: 'P0001', message: 'not a member of this workspace' } };
          return { data: teamInvites.map(row => ({ ...row })) };
        }
        if (name === 'invite_to_workspace') {
          if (teamInviteCase === 'offline') throw lostConnection();
          if (teamInviteCase === 'expired') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
          if (teamInviteCase === 'permission' || !['owner', 'owner-empty', 'error'].includes(teamCase) || !teamOwnerNow) return { data: null, error: { code: 'P0001', message: 'workspace owner only' } };
          const refusal = { email: 'a valid email address is required', role: 'role is reviewer or operator',
            pending: 'too many pending invites (20); revoke one first', today: 'too many invites today (50); try again tomorrow' }[teamInviteCase];
          if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
          if (teamInviteCase === 'fail') return { data: null, error: { message: 'Synthetic invite failure' } };
          if (!['reviewer', 'operator'].includes(args?.p_role)) return { data: null, error: { code: 'P0001', message: 'role must be reviewer or operator' } };
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(args?.p_email || ''))) return { data: null, error: { code: 'P0001', message: 'email must look like name@example.com' } };
          teamSerial += 1;
          const invite = { invite_id: 'aaaa1111-0000-4000-8000-0000000000' + teamSerial, email: String(args.p_email).toLowerCase(), role: args.p_role,
            status: 'pending', created_at: new Date().toISOString(), expires_at: ago(-7) };
          teamInvites.unshift(invite);
          if (teamInviteCase === 'bad-url') return { data: { invite_id: invite.invite_id, invite_url: null, expires_at: invite.expires_at } };
          return { data: { invite_id: invite.invite_id, invite_url: 'https://veylet.com/join?i=QAfixtureInvite' + teamSerial + 'xxxxxxxxxxxxxxxxxxxxxxxx', expires_at: invite.expires_at } };
        }
        if (teamRevokeCase === 'fail') return { data: null, error: { message: 'Synthetic revoke failure' } };
        const invite = teamInvites.find(row => row.invite_id === args?.p_invite_id);
        if (!invite || invite.status !== 'pending') return { data: null, error: { code: 'P0001', message: 'invite not pending' } };
        invite.status = 'revoked';
        return { data: null };
      }
      if (['get_listing_exports', 'request_listing_exports', 'authorize_listing_export_download'].includes(name)) {
        if (exportsCase === 'missing') return exportsMissing(name);
        const tourId = args?.p_tour_id;
        if (name === 'get_listing_exports') {
          if (exportsCase === 'error') return { data: null, error: { message: 'Synthetic export service failure' } };
          if (exportsCase === 'loading') return new Promise(() => {});
          if (!tours.some(tour => tour.id === tourId)) return { data: null, error: { code: 'P0001', message: 'tour unavailable' } };
          return { data: exportJson(tourId) };
        }
        if (name === 'request_listing_exports') {
          if (exportsRequestCase === 'expired') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
          if (occupancyRefusal(tourProperty(tourId))) return { data: null, error: { code: 'P0001', message: occupancyRefusal(tourProperty(tourId)) } };
          if (exportsRequestCase === 'fail') return { data: null, error: { message: 'Synthetic export request failure' } };
          const refusal = { inactive: 'consent statement version is not active', approve: 'approve this walkthrough before requesting exports',
            unavailable: 'tour unavailable' }[exportsRequestCase];
          if (refusal) return { data: null, error: { code: 'P0001', message: refusal } };
          // The draft's own checks, in its order.
          if (args?.p_acknowledge_cannot_recall !== true) return { data: null, error: { code: 'P0001', message: 'acknowledge that downloaded files cannot be recalled' } };
          const kinds = Array.isArray(args?.p_kinds) ? [...new Set(args.p_kinds)] : [];
          if (!kinds.length || kinds.length !== args.p_kinds.length || kinds.length > 3 || kinds.some(kind => !EXPORT_KINDS.includes(kind))) {
            return { data: null, error: { code: 'P0001', message: 'kinds are 1 to 3 distinct of video_16x9, video_9x16, stills' } };
          }
          if (!exportsVersion || args?.p_consent_version !== exportsVersion || exportsVersion !== EXPORT_VERSION) return { data: null, error: { code: 'P0001', message: 'consent statement version is not active' } };
          if (!tours.some(tour => tour.id === tourId)) return { data: null, error: { code: 'P0001', message: 'tour unavailable' } };
          if (!approvedTours.has(tourId)) return { data: null, error: { code: 'P0001', message: 'approve this walkthrough before requesting exports' } };
          const row = exportRows.get(tourId);
          // Idempotent: an existing request is answered unchanged; a failed one is asked again.
          if (!row || row.state === 'failed') exportRows.set(tourId, { state: 'requested', requested_at: new Date().toISOString(), consent_version: args.p_consent_version, locked: false });
          return { data: exportJson(tourId) };
        }
        // Never from the browser (the contract): the hooks endpoint below stands in for it.
        return { data: null, error: { code: 'P0001', message: 'Synthetic: downloads go through the server endpoint.' } };
      }
      if (name === 'get_tour_view_stats') {
        if (viewsCase === 'missing') return viewsMissing;
        if (viewsCase === 'error') return { data: null, error: { message: 'Synthetic view failure' } };
        if (viewsCase === 'zero') return { data: [{ opens: 0, days_with_opens: 0, call_taps: 0, email_taps: 0, share_taps: 0, by_src: {}, by_host: {}, last_opened_at: null }] };
        return { data: [{ opens: 14, days_with_opens: 5, call_taps: 3, email_taps: 1, share_taps: 2, by_src: { link: 8, qr: 4, embed: 2 },
          by_host: { 'example-agency.invalid': 2 }, last_opened_at: ago(1) }] };
      }
      if (name === 'lookup_tour_share' && pauseCase === 'paused') return { data: [] };
      if (name === 'lookup_tour_share') return scenario === 'missing' ? { data: [] } : scenario === 'errors' ? { error: { message: 'Synthetic service failure' } }
        : streamed ? { data: [{ storage_path: 'synthetic/v2/manifest.json', space_title: 'Fictional practice space', shared_at: '2026-09-20T12:00:00Z', package_format_version: 2, package_base_url: V2_BASE }] }
        : { data: [{ storage_path: 'synthetic/fixture.zip', space_title: 'Fictional practice space' }] };
      if (name === 'get_workspace_public_contact') {
        if (deskContactCase === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_workspace_public_contact(p_workspace_id) in the schema cache' } };
        if (deskContactCase === 'error') return { data: null, error: { message: 'Synthetic contact failure' } };
        if (deskContactCase === 'loading') return new Promise(() => {});
        if (savedContact) return { data: [{ ...savedContact }] };
        const blank = { show_on_shared: false, display_name: null, agency: null, phone: null, email: null, updated_at: null };
        if (['empty', 'none'].includes(deskContactCase)) return { data: [blank] };
        return { data: [{ ...blank, show_on_shared: deskContactCase !== 'hidden', display_name: 'Alex Example', agency: 'Example Realty',
          phone: deskContactCase === 'email' ? null : '+61 400 000 000', email: deskContactCase === 'phone' ? null : 'alex@example.invalid', updated_at: ago(3) }] };
      }
      if (name === 'set_workspace_public_contact') {
        if (contactSaveCase === 'offline') throw lostConnection();
        if (contactSaveCase === 'expired') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
        if (contactSaveCase === 'fail') return { data: null, error: { message: 'Synthetic contact save failure' } };
        if (contactSaveCase === 'permission' || deskContactCase === 'readonly') return { data: null, error: { code: 'P0001', message: 'contact permission required' } };
        if (contactSaveCase === 'phone') return { data: null, error: { code: 'P0001', message: 'phone must be up to 32 digits, spaces and + ( ) -' } };
        // The migration's own checks, on its trimmed values (an empty field clears it).
        const field = key => (typeof args[key] === 'string' && args[key].trim()) || null;
        const row = { display_name: field('p_display_name'), agency: field('p_agency'), phone: field('p_phone'), email: field('p_email') };
        const refuse = message => ({ data: null, error: { code: 'P0001', message } });
        if (typeof args.p_show !== 'boolean') return refuse('choose whether clients see the contact');
        if (row.display_name && row.display_name.length > 80) return refuse('display name must be 80 characters or fewer');
        if (row.agency && row.agency.length > 80) return refuse('agency must be 80 characters or fewer');
        if (row.phone && !(row.phone.length <= 32 && /^[0-9 +()-]+$/.test(row.phone) && /[0-9]/.test(row.phone))) return refuse('phone must be up to 32 digits, spaces and + ( ) -');
        if (row.email && !(row.email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email))) return refuse('email must look like name@example.com');
        if (args.p_show && (!row.display_name || (!row.phone && !row.email))) return refuse('showing the contact needs a display name and a phone or email');
        savedContact = { show_on_shared: args.p_show, ...row, updated_at: new Date().toISOString() };
        return { data: [{ ...savedContact }] };
      }
      if (name === 'lookup_tour_share_contact') {
        if (contactCase === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.lookup_tour_share_contact(p_token) in the schema cache' } };
        if (contactCase === 'error' || scenario === 'errors') return { data: null, error: { message: 'Synthetic contact failure' } };
        if (contactCase === 'loading') return new Promise(() => {});
        if (['none', 'empty', 'hidden'].includes(contactCase) || scenario === 'missing') return { data: [] };
        return { data: [{ display_name: 'Alex Example', agency: 'Example Realty',
          phone: contactCase === 'email' ? null : '+61 400 000 000', email: contactCase === 'phone' ? null : 'alex@example.invalid' }] };
      }
      // Proposed owner-preview locator for version 2 packages (not a live function).
      if (name === 'get_tour_package_base') return streamed ? { data: [{ package_base_url: V2_BASE }] } : { error: { code: 'PGRST202', message: 'Could not find the function public.get_tour_package_base' } };
      return { error: { message: 'This QA fixture does not change properties.' } };
    },
    storage: { from: () => ({ download: async () => {
      window.VEYLET_QA_CALLS.push({ name: 'storage.download' });
      await window.VeyletPlayer.loadScript('/vendor/jszip-3.10.2.min.js');
      const zip = new window.JSZip();
      zip.file('tour.html', '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic viewer</title><style>body{background:#10231d;color:#f4f1e9;font:20px/1.5 system-ui;padding:24px}button{padding:14px;font:inherit}</style><h1>Synthetic viewer opened</h1><p>Local browser fixture. This is not a reconstructed property.</p><button onclick="this.textContent=\'Keyboard and pointer interaction works\'">Test interaction</button></html>');
      return { data: await zip.generateAsync({ type: 'blob' }) };
    } }) },
  }) };
  document.addEventListener('DOMContentLoaded', () => {
    const notice = document.createElement('p'); notice.textContent = 'LOCAL QA FIXTURE · Fictional records · No emails, account or storage writes';
    notice.style.cssText = 'margin:0;padding:12px 20px;background:#c6dcc9;color:#10231d;font:14px system-ui';
    if (location.pathname === '/__qa/account/') {
      const replace = document.createElement('button'); replace.type = 'button'; replace.textContent = 'QA: replace package at the same path';
      replace.style.cssText = 'display:block;margin-top:8px;min-height:44px;padding:8px 12px';
      const changed = document.createElement('span'); changed.setAttribute('role', 'status');
      replace.addEventListener('click', () => {
        const revision = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(revisionKey, revision); approvedTours.delete('synthetic-tour'); tokens.delete('synthetic-tour');
        changed.textContent = ' QA package replaced; storage path unchanged. Existing preview/review snapshots are now stale.';
      });
      notice.append(replace, changed);
    }
    // Review affordance only: `?email-open=1` opens the Email preferences disclosure
    // once it is shown, so a capture can include it. It changes nothing.
    if (location.pathname === '/__qa/account/' && params.get('email-open') === '1') {
      let tries = 0;
      const open = setInterval(() => {
        const email = document.getElementById('account-email');
        if (email && !email.hidden) { email.open = true; email.scrollIntoView({ block: 'center' }); }
        if ((email && !email.hidden) || ++tries > 40) clearInterval(open);
      }, 100);
    }
    // Review affordance only: `&exports-open=1` opens the live walkthrough's Videos and
    // stills block once it is shown, so a capture can include it. It changes nothing.
    if (['/__qa/account/', '/__qa/app-account/'].includes(location.pathname) && params.get('exports-open') === '1') {
      let tries = 0;
      const open = setInterval(() => {
        const block = document.querySelector('[data-tour="' + EXPORT_TOUR + '"] .tour-exports:not([hidden])');
        if (block) { block.open = true; block.scrollIntoView({ block: 'start' }); }
        if (block || ++tries > 40) clearInterval(open);
      }, 100);
    }
    // Review affordance only: `&occupancy-open=1` opens every grandfathered listing's
    // quiet question once it is drawn, so a capture can include it. It changes nothing.
    if (['/__qa/account/', '/__qa/app-account/'].includes(location.pathname) && params.get('occupancy-open') === '1') {
      let tries = 0;
      const open = setInterval(() => {
        const boxes = document.querySelectorAll('.occupancy-later');
        for (const box of boxes) box.open = true;
        if (boxes.length || ++tries > 40) clearInterval(open);
      }, 100);
    }
    // Review affordance only: `&team-created=1` fills the invite form once (reviewer,
    // new.agent@example.invalid) and creates the link, so a capture can show it. No email is sent.
    if (location.pathname === '/__qa/account/' && params.get('team-created') === '1') {
      let tries = 0;
      const press = setInterval(() => {
        const email = document.getElementById('account-team-email');
        const role = document.querySelector('#account-team input[value="reviewer"]');
        const create = document.querySelector('#account-team [data-control="team-create"]');
        if (email && role && create) {
          email.value = 'new.agent@example.invalid'; email.dispatchEvent(new Event('input', { bubbles: true }));
          role.checked = true; role.dispatchEvent(new Event('change', { bubbles: true }));
          create.click();
        }
        if ((email && role && create) || ++tries > 40) clearInterval(press);
      }, 100);
    }
    // Review affordance only: opens the leaving disclosure so a capture can show
    // the deletion state inside it. It changes nothing and lives outside dist.
    if (location.pathname === '/__qa/account/' && scenario.startsWith('deletion')) {
      let tries = 0;
      const open = setInterval(() => {
        const leaving = document.getElementById('account-leaving');
        if (leaving) leaving.open = true;
        if (leaving || ++tries > 30) clearInterval(open);
      }, 100);
    }
    // Review affordance only: `?card=open` presses "Pay yearly by card" once, so
    // a capture can show Square's card step. It never confirms.
    if (location.pathname === '/__qa/account/' && params.get('card') === 'open') {
      let tries = 0;
      const press = setInterval(() => {
        const pay = [...document.querySelectorAll('#account-annual .tour-action-primary')].find(el => /Pay yearly by card|Start yearly plan today/.test(el.textContent));
        if (pay) pay.click();
        if (pay || ++tries > 40) clearInterval(press);
      }, 100);
    }
    // Review affordance only: `?packs-card=open` presses the pack's buy button
    // once, so a capture can show Square's card step. It never pays.
    if (location.pathname === '/__qa/account/' && params.get('packs-card') === 'open') {
      let tries = 0;
      const press = setInterval(() => {
        const buy = [...document.querySelectorAll('#account-packs .tour-action-primary')].find(el => /^(?:Test · )?Buy \d+ walkthroughs?$/.test(el.textContent));
        if (buy) buy.click();
        if (buy || ++tries > 40) clearInterval(press);
      }, 100);
    }
    // Review affordance only: `?trial-card=open` types the ATO's example ABN and
    // presses "Add a card and start free months" once. It never starts anything.
    if (location.pathname === '/__qa/account/' && params.get('trial-card') === 'open') {
      let tries = 0;
      const press = setInterval(() => {
        const abn = document.getElementById('account-trial-abn');
        const add = [...document.querySelectorAll('#account-trial .tour-action-primary')].find(el => /Add a card and start free months/.test(el.textContent));
        if (abn && add) { abn.value = '51 824 753 556'; abn.dispatchEvent(new Event('input', { bubbles: true })); add.click(); }
        if ((abn && add) || ++tries > 40) clearInterval(press);
      }, 100);
    }
    // Review affordance only: `?express-card=open` presses Super fast for A$29 once.
    if (location.pathname === '/__qa/account/' && params.get('express-card') === 'open') {
      let tries = 0;
      const press = setInterval(() => {
        const buy = [...document.querySelectorAll('.dash-express .tour-action')].find(el => /Super fast for A\$/.test(el.textContent));
        if (buy) buy.click();
        if (buy || ++tries > 40) clearInterval(press);
      }, 100);
    }
    // Review affordance only: `?correction=open` opens the Record correction form
    // so a capture can show it. It never submits.
    if (location.pathname === '/__qa/studio/' && params.get('correction') === 'open') {
      let tries = 0;
      const open = setInterval(() => {
        const form = document.getElementById('studio-correction');
        if (form) { form.open = true; form.scrollIntoView({ block: 'start' }); }
        if (form || ++tries > 30) clearInterval(open);
      }, 100);
    }
    // Review affordance only: opens every Set plan form so a capture can show
    // one. It never submits, and it exists outside dist.
    if (location.pathname === '/__qa/studio/' && params.get('setplan') === 'open') {
      let tries = 0;
      const open = setInterval(() => {
        const forms = document.querySelectorAll('details.studio-set-plan');
        for (const form of forms) form.open = true;
        if (forms.length || ++tries > 30) clearInterval(open);
      }, 100);
    }
    // Framed pages (the portal URL and the embed) must fit their frame exactly, so there the
    // notice floats over the top edge instead of pushing the page down (it made /__qa/tour/
    // scroll 41–58 px inside a frame the real page fits).
    if (['/__qa/tour/', '/__qa/embed/'].includes(location.pathname)) {
      notice.textContent = 'QA fixture';
      notice.style.cssText += ';position:fixed;bottom:0;left:0;z-index:99;padding:2px 6px;font-size:11px;opacity:.85;pointer-events:none';
    }
    document.body.prepend(notice);
  });
})();
