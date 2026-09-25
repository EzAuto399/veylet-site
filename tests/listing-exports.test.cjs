/*
 * Videos and stills for your listing on /account and /app/account (the sibling
 * repository's docs/render-status-contract-20260925.md, "Listing exports (C3)", and
 * its draft supabase/drafts/release-2/20260926113000_listing_exports.sql, not
 * released). An approved walkthrough reads its export with get_listing_exports; a
 * request carries the active consent statement version and the "cannot be recalled"
 * acknowledgement only after the box beside the statement is ticked; each state reads
 * in the contract's words; downloads go through the server lane's proposed endpoint,
 * never authorize_listing_export_download from the browser; a backend without the
 * functions (PGRST202) shows nothing; and the app's page names no amount.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const account = fs.readFileSync(path.join(__dirname, '../dist/account.js'), 'utf8');
const sharing = fs.readFileSync(path.join(__dirname, '../dist/tour-sharing.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../dist/account/index.html'), 'utf8');

const STATEMENT = 'I confirm that the property owner, and any tenant living there, have given written consent for these videos and photos of the property to be published. I understand that Veylet cannot recall, delete or change any copy once it has been downloaded.';
const VERSION = 'export-consent-v0-draft';
const EXPORT_ID = 'e0e0e0e0-0000-4000-8000-00000000c3c3';
const MISSING = { error: { code: 'PGRST202', message: 'Could not find the function public.get_listing_exports(p_tour_id) in the schema cache' } };

class Element {
  constructor(tag = 'div', clicks = []) {
    this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.checked = false; this.textContent = ''; this.value = ''; this.className = '';
    this.classList = { add() {} }; this.clicks = clicks;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, handler) { this.events[name] = handler; }
  querySelector() { return null; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  shown() { return this.hidden ? [] : this.children.filter(child => !child.hidden).flatMap(child => [child, ...child.shown()]); }
  click() { this.clicks.push(this); }
  focus() { this.wasFocused = true; } scrollIntoView() {} select() {} reset() {}
  async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

// `options.exports(args)` answers get_listing_exports; `options.request(args)` the request;
// `options.hooks(path, init)` the hooks service ({ status, body }).
async function load(options = {}) {
  const clicks = [];
  const ids = {};
  for (const match of markup.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { ids[match[2]] = new Element(match[1], clicks); ids[match[2]].hidden = /\bhidden\b/.test(match[0]); }
  const calls = [], fetches = [];
  const user = { id: 'user-1', email: 'person@example.invalid' };
  const tours = options.tours || [{ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: options.createdBy || 'user-1', share_token: 'abcdefghijklmnop' }];
  const table = {
    properties: { data: [{ id: 'p1', title: 'Sample space', workspace_id: 'w1' }] },
    tours: { data: tours },
    memberships: { data: [{ workspace_id: 'w1', role: options.role || 'owner', status: 'active' }] },
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: options.signedOutLater && calls.some(([name]) => name === 'get_listing_exports') ? null : { user, access_token: 'token-1' } } }),
      onAuthStateChange: callback => { supabase.auth.callback = callback; },
      signOut: async () => ({}),
    },
    from(name) {
      const answer = () => table[name];
      const builder = { select() { return builder; }, order() { return builder; }, eq() { return builder; },
        single() { const result = answer(); return Promise.resolve({ data: result.data?.[0] || null, error: result.error }); },
        then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); } };
      return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'get_listing_exports') return options.exports ? options.exports(args) : MISSING;
      if (name === 'request_listing_exports') return options.request ? options.request(args) : MISSING;
      if (name === 'get_tour_review') return { data: [{ approved: options.approved !== false }] };
      if (name === 'get_tour_review_target') { const tour = tours.find(row => row.id === args.p_tour_id); return { data: [{ tour_id: tour?.id, storage_path: tour?.storage_path, package_revision: 'a'.repeat(64) }] }; }
      if (name === 'can_produce_tours') return { data: false };
      if (name === 'get_account_deletion') return { data: [] };
      return { error: { code: 'PGRST202', message: 'Could not find the function' } };
    },
  };
  const window = {
    VEYLET_SUPABASE: { url: 'https://example.invalid', anonKey: 'public' }, supabase: { createClient: () => supabase },
    VeyletPlace: { generalLocationProblem: () => '' }, VEYLET_HOOKS: { url: options.hooksUrl ?? 'https://hooks.example.invalid' }, addEventListener() {},
    fetch: async (url, init) => {
      fetches.push({ url, init });
      const reply = options.hooks ? await options.hooks(url, init) : { status: 404, body: { error: 'not_found' } };
      if (reply instanceof Error) throw reply;
      return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body };
    },
  };
  const documentStub = { hidden: false, activeElement: null, getElementById: id => ids[id], createElement: tag => new Element(tag, clicks),
    addEventListener() {}, head: { append() {} }, documentElement: { dataset: options.appMode ? { appMode: 'true' } : {} } };
  const context = { window, document: documentStub, Date, URL, URLSearchParams, navigator: {},
    location: { pathname: options.appMode ? '/app/account' : '/account', search: '', replace() {}, assign() {} },
    setTimeout: () => ({}), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    FormData: class { get() { return ''; } }, Blob: class {} };
  vm.runInNewContext(sharing, context);
  await vm.runInNewContext(account, context);
  await settle();
  const h = {
    ids, calls, fetches, clicks,
    block: (tourId = 't1') => ids['account-properties'].all().find(el => el.dataset?.tour === tourId)?.all().find(el => /\btour-exports\b/.test(el.className)) || null,
    state: () => h.block().all().find(el => el.className === 'tour-exports-state'),
    text: () => h.block().shown().map(el => el.textContent).filter(Boolean),
    buttons: () => h.block().shown().filter(el => el.tagName === 'BUTTON'),
    button: label => h.buttons().find(el => el.textContent === label),
    control: name => h.block().all().find(el => el.dataset?.control === name),
    form: () => h.block().all().find(el => el.tagName === 'FORM'),
    row: () => h.block().all().find(el => el.className === 'tour-row-status'),
    status: () => ids['account-status'].textContent,
    requests: () => calls.filter(([name]) => name === 'request_listing_exports').map(([, args]) => args),
  };
  return h;
}
const nothing = (consent = VERSION) => args => ({ data: { tour_id: args.p_tour_id, state: null, requested: false, downloadable: false, consent_version: consent } });
const FILES = { video_16x9: { bytes: 18600000, sha256: '1'.repeat(64), content_type: 'video/mp4' },
  video_9x16: { bytes: 6900000, sha256: '2'.repeat(64), content_type: 'video/mp4' },
  stills: { bytes: 520000, sha256: '3'.repeat(64), content_type: 'application/zip' } };
const row = (state, fields = {}) => args => ({ data: { export_id: EXPORT_ID, tour_id: args.p_tour_id, kinds: ['stills', 'video_16x9', 'video_9x16'], state, requested: true,
  requested_at: '2026-09-26T01:00:00Z', consent_version: VERSION, acknowledged_cannot_recall: true, screening: state === 'ready' ? 'clear' : null,
  screening_counts: null, rendered_at: null, error_code: state === 'failed' ? 'export_failed' : null,
  files: ['ready', 'needs_attention', 'partner_only'].includes(state) ? FILES : {}, downloadable: state === 'ready', updated_at: '2026-09-26T01:05:00Z', ...fields } });
const INTRO = [
  'Videos and stills for your listing',
  'From this walkthrough: a 16:9 listing video (60–180 seconds), a 9:16 social video (20–45 seconds) and still photos of each room.',
  'For the video field of a realestate.com.au or Domain listing, YouTube and social media. Each video carries a short line saying it’s a 3D reconstruction, and no web address, QR code or call to action.',
];

test('listing exports: the consent words are the draft statement exactly, by its seeded SHA-256', () => {
  const words = account.match(/'export-consent-v0-draft': '([^']+)'/);
  assert.ok(words, 'the statement lives in account.js by version');
  assert.equal(words[1], STATEMENT);
  assert.equal(crypto.createHash('sha256').update(words[1], 'utf8').digest('hex'), '914257b7e13e9c960f90296bc8887a78ffd4a5b31540901ba09b34b1c27a68ee');
});

test('listing exports: a backend without the functions (PGRST202) shows nothing and is asked once per page', async () => {
  const h = await load();
  assert.equal(h.block().hidden, true);
  assert.equal(h.calls.filter(([name]) => name === 'get_listing_exports').length, 1);
  assert.equal(h.calls.some(([name]) => ['request_listing_exports', 'authorize_listing_export_download'].includes(name)), false);
  // A malformed answer (another walkthrough's row, no requested flag, an unknown state) is hidden too.
  for (const data of [{ tour_id: 'other', state: null, requested: false }, { tour_id: 't1', state: null }, { tour_id: 't1', state: 'processing', requested: true, export_id: EXPORT_ID }, null]) {
    const odd = await load({ exports: () => ({ data }) });
    assert.equal(odd.block().hidden, true, JSON.stringify(data));
  }
});

test('listing exports: only an approved walkthrough, only for whoever may share it (the request’s roles)', async () => {
  const unapproved = await load({ approved: false, exports: nothing() });
  assert.equal(unapproved.calls.some(([name]) => name === 'get_listing_exports'), false);
  const operator = await load({ role: 'operator', createdBy: 'someone-else', exports: nothing() });
  assert.equal(operator.calls.some(([name]) => name === 'get_listing_exports'), false);
  for (const [role, createdBy] of [['owner', 'someone-else'], ['reviewer', 'someone-else'], ['operator', 'user-1']]) {
    const h = await load({ role, createdBy, exports: nothing() });
    assert.deepEqual({ ...h.calls.find(([name]) => name === 'get_listing_exports')[1] }, { p_tour_id: 't1' }, role);
    assert.equal(h.block().hidden, false, role);
  }
  // Sharing off or paused changes nothing: the server's gate is the approval.
  const off = await load({ tours: [{ id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null }], exports: nothing() });
  assert.equal(off.block().hidden, false);
});

test('listing exports: until the owner activates a statement, "Exports open soon." and nothing to press', async () => {
  const h = await load({ exports: nothing(null) });
  assert.deepEqual(h.text(), [...INTRO, 'Exports open soon.']);
  assert.equal(h.buttons().length, 0);
  assert.equal(h.form(), undefined);
  // A version this page has no words for asks for a fresh page, never shows other words.
  const newer = await load({ exports: nothing('export-consent-v9') });
  assert.deepEqual(newer.text(), [...INTRO, 'Refresh this page to make listing videos.']);
  assert.equal(newer.buttons().length, 0);
});

test('listing exports: the request is sent only after the box beside the statement is ticked', async () => {
  let requested = null;
  const h = await load({ exports: args => (requested ? row('requested')(args) : nothing()(args)), request: args => { requested = args; return row('requested')(args); } });
  const legend = h.block().all().find(el => el.tagName === 'LEGEND');
  assert.equal(legend.textContent, 'Downloaded files can’t be recalled');
  const box = h.control('exports-consent');
  assert.equal(box.type, 'checkbox'); assert.equal(box.checked, false); assert.equal(box.required, true);
  const label = h.block().all().find(el => el.tagName === 'LABEL');
  assert.deepEqual(label.children.map(el => el.textContent || el.type), ['checkbox', STATEMENT]);
  const make = h.control('exports-make');
  assert.equal(make.textContent, 'Make listing videos');
  assert.match(make.className, /\btour-action-primary\b/);
  await h.form().fire('submit'); await settle();
  assert.equal(h.requests().length, 0, 'unticked: nothing is sent');
  assert.equal(h.row().textContent, 'Tick the box to confirm first.');
  assert.equal(box.wasFocused, true);
  box.checked = true;
  await h.form().fire('submit'); await settle();
  assert.deepEqual(h.requests().map(args => ({ ...args, p_kinds: [...args.p_kinds] })), [{ p_tour_id: 't1', p_kinds: ['video_16x9', 'video_9x16', 'stills'], p_consent_version: VERSION, p_acknowledge_cannot_recall: true }]);
  // The result lands where the reader is, and is announced once.
  assert.equal(h.state().textContent, 'Preparing your video and photos.');
  assert.equal(h.state().wasFocused, true);
  assert.equal(h.state().tabIndex, -1);
  assert.equal(h.status(), 'Preparing your video and photos.');
  assert.equal(h.row().hidden, true);
});

test('listing exports: every state reads in the contract’s words, with only what it allows', async () => {
  const cases = {
    requested: [['Preparing your video and photos.'], ['Check again']],
    rendering: [['Preparing your video and photos.'], ['Check again']],
    needs_attention: [['We’re checking your video before it’s ready. We’ll tell you when it is.'], ['Check again']],
    ready: [['Ready to download.', 'Downloaded files can’t be recalled.'], ['Download listing video (16:9) · 18.6 MB', 'Download social video (9:16) · 6.9 MB', 'Download stills (ZIP) · 520 KB']],
    partner_only: [['Video isn’t available for this walkthrough yet.'], []],
    failed: [['We couldn’t make the video. Nothing was used.', 'Downloaded files can’t be recalled', STATEMENT], ['Try again']],
  };
  for (const [state, [lines, buttons]] of Object.entries(cases)) {
    const h = await load({ exports: row(state) });
    const text = h.text().filter(line => !INTRO.includes(line) && line !== 'Ready to download');
    assert.deepEqual(text.filter(line => !buttons.includes(line)), lines, state);
    assert.deepEqual(h.buttons().map(el => el.textContent), buttons, state);
    assert.equal(h.block().dataset.exports, state, state);
    // No time is promised: the contract gives none.
    assert.doesNotMatch(h.text().join(' '), /hour|minute|usually/i, state);
    assert.doesNotMatch(h.text().join(' '), /3D on realestate/i, state);
  }
  // Ready is on the summary, so it reads without opening the block; only the listing video is filled.
  const ready = await load({ exports: row('ready') });
  const chip = ready.block().children[0].children.find(el => /\btour-exports-chip\b/.test(el.className));
  assert.equal(chip.textContent, 'Ready to download');
  assert.deepEqual(ready.buttons().map(el => /\btour-action-primary\b/.test(el.className)), [true, false, false]);
  // Ready but not downloadable (this version is no longer the approved one): nothing to download.
  const locked = await load({ exports: row('ready', { downloadable: false }) });
  assert.deepEqual(locked.text().filter(line => !INTRO.includes(line)), ['These files can be downloaded only while this version is approved. Check again.', 'Check again']);
  // A file without a proper size is still offered, without one.
  const unsized = await load({ exports: row('ready', { files: { ...FILES, stills: { bytes: null } } }) });
  assert.equal(unsized.buttons()[2].textContent, 'Download stills (ZIP)');
  const small = await load({ exports: row('ready', { files: { ...FILES, stills: { bytes: 1 } }, kinds: ['stills'] }) });
  assert.deepEqual(small.buttons().map(el => el.textContent), ['Download stills (ZIP) · 1 KB']);
});

test('listing exports: Try again after a failure asks again; a withdrawn statement closes it', async () => {
  let state = 'failed';
  const h = await load({ exports: args => row(state)(args), request: args => { state = 'requested'; return row('requested')(args); } });
  h.control('exports-consent').checked = true;
  assert.equal(h.control('exports-make').textContent, 'Try again');
  await h.form().fire('submit'); await settle();
  assert.equal(h.requests()[0].p_consent_version, VERSION);
  assert.equal(h.state().textContent, 'Preparing your video and photos.');
  // A failed row names the active version; with none active there is nothing to press.
  const none = await load({ exports: row('failed', { consent_version: null }) });
  assert.deepEqual(none.text().filter(line => !INTRO.includes(line)), ['We couldn’t make the video. Nothing was used.', 'Exports open soon.']);
  assert.equal(none.form(), undefined);
  const closed = await load({ exports: row('failed'), request: () => ({ error: { code: 'P0001', message: 'consent statement version is not active' } }) });
  closed.control('exports-consent').checked = true;
  await closed.form().fire('submit'); await settle();
  assert.deepEqual(closed.text().filter(line => !INTRO.includes(line)), ['We couldn’t make the video. Nothing was used.', 'Exports open soon.']);
  assert.equal(closed.form(), undefined);
});

test('listing exports: each refusal says its one next step; the box stays ticked for a retry', async () => {
  const refusals = {
    'consent statement version is not active': null,
    'approve this walkthrough before requesting exports': 'Approve this walkthrough first, then make its videos.',
    'tour unavailable': 'Ask the workspace owner or a reviewer to make these videos.',
    'kinds are 1 to 3 distinct of video_16x9, video_9x16, stills': 'Your request wasn’t confirmed. Try again.',
  };
  for (const [message, words] of Object.entries(refusals)) {
    const h = await load({ exports: nothing(), request: () => ({ error: { code: 'P0001', message } }) });
    h.control('exports-consent').checked = true;
    await h.form().fire('submit'); await settle();
    if (words === null) {
      assert.equal(h.state().textContent, 'Exports open soon.');
      assert.equal(h.state().wasFocused, true);
      assert.equal(h.form(), undefined);
    } else {
      assert.equal(h.row().textContent, words, message);
      assert.equal(h.control('exports-make').disabled, false, message);
      assert.equal(h.control('exports-consent').checked, true, message);
    }
  }
  // An expired sign-in asks for sign-in, not a retry.
  const expired = await load({ exports: nothing(), request: () => ({ error: { code: 'PGRST301', message: 'JWT expired' } }) });
  expired.control('exports-consent').checked = true;
  await expired.form().fire('submit'); await settle();
  assert.match(expired.status(), /^Your sign-in has expired\. Sign in and check whether your listing videos were asked for\.$/);
});

test('listing exports: a download asks the server lane’s endpoint with the session and opens the signed link', async () => {
  const h = await load({ exports: row('ready'), hooks: () => ({ status: 200, body: { url: 'https://files.example.invalid/listing-16x9.mp4?sig=x', filename: 'listing-16x9.mp4', bytes: 18600000, content_type: 'video/mp4', expires_in: 600 } }) });
  await h.control('exports-download-video_16x9').fire('click'); await settle();
  // Only the export endpoint is asked (the desk's other services keep their own reads).
  const asked = h.fetches.filter(entry => /listing-exports/.test(entry.url));
  assert.equal(asked.length, 1);
  const [{ url, init }] = asked;
  assert.equal(url, 'https://hooks.example.invalid/listing-exports/download');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer token-1');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(JSON.parse(init.body), { export_id: EXPORT_ID, kind: 'video_16x9' });
  // Never the RPC from the browser: it answers a storage key, not a link.
  assert.equal(h.calls.some(([name]) => name === 'authorize_listing_export_download'), false);
  const opened = h.clicks.filter(el => el.tagName === 'A');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].href, 'https://files.example.invalid/listing-16x9.mp4?sig=x');
  assert.equal(opened[0].download, 'listing-16x9.mp4');
  assert.equal(h.row().textContent, 'Downloading listing-16x9.mp4.');
  // A link that is not https is never opened.
  const odd = await load({ exports: row('ready'), hooks: () => ({ status: 200, body: { url: 'javascript:alert(1)', filename: 'x.mp4' } }) });
  await odd.control('exports-download-stills').fire('click'); await settle();
  assert.equal(odd.clicks.filter(el => el.tagName === 'A').length, 0);
  assert.equal(odd.row().textContent, 'The download didn’t start. Try again.');
});

test('listing exports: the endpoint’s answers, in the words the app uses too', async () => {
  // deploy/hooks-vercel/listing_exports/download.py: {error} codes with these statuses.
  const words = {
    400: ['invalid_request', 'The download didn’t start. Try again.'],
    403: ['not_allowed', 'Your role in this office can’t download videos. Ask an office admin.'],
    404: ['unknown_export', 'This file isn’t available any more.'],
    429: ['rate_limited', 'You’ve downloaded a lot in the last hour. Try again later.'],
    502: ['download_failed', 'The download didn’t start. Try again.'],
    503: ['not_configured', 'Downloads aren’t open yet. Try again later.'],
    500: ['server_error', 'The download didn’t start. Try again.'],
  };
  for (const [status, [error, said]] of Object.entries(words)) {
    const h = await load({ exports: row('ready'), hooks: () => ({ status: Number(status), body: { error } }) });
    await h.control('exports-download-stills').fire('click'); await settle();
    assert.equal(h.row().textContent, said, status);
    assert.equal(h.control('exports-download-stills').disabled, false, status);
    assert.equal(h.clicks.filter(el => el.tagName === 'A').length, 0, status);
  }
  const origin = await load({ exports: row('ready'), hooks: () => ({ status: 403, body: { error: 'origin_not_allowed' } }) });
  await origin.control('exports-download-stills').fire('click'); await settle();
  assert.equal(origin.row().textContent, 'Your role in this office can’t download videos. Ask an office admin.');
  // 409: not ready after all. The export is read again and says its own state, focused.
  for (const [error, state, said] of [['needs_attention', 'needs_attention', 'We’re checking your video before it’s ready. We’ll tell you when it is.'],
    ['partner_only', 'partner_only', 'Video isn’t available for this walkthrough yet.'],
    ['not_ready', 'ready', 'These files can be downloaded only while this version is approved. Check again.']]) {
    let now = 'ready', refused = false;
    const h = await load({ exports: args => row(now, refused && now === 'ready' ? { downloadable: false } : {})(args),
      hooks: url => { if (!/listing-exports/.test(url)) return { status: 404, body: {} }; now = state; refused = true; return { status: 409, body: { error } }; } });
    await h.control('exports-download-video_16x9').fire('click'); await settle();
    assert.equal(h.calls.filter(([name]) => name === 'get_listing_exports').length, 2, error);
    assert.equal(h.state().textContent, said, error);
    assert.equal(h.state().wasFocused, true, error);
    assert.equal(h.status(), said, error);
    assert.equal(h.row().hidden, true, error);
  }
  const lost = await load({ exports: row('ready'), hooks: () => new TypeError('Failed to fetch') });
  await lost.control('exports-download-stills').fire('click'); await settle();
  assert.equal(lost.row().textContent, 'The download didn’t start. Try again.');
  // No hooks service on this page: nothing is asked.
  const unset = await load({ exports: row('ready'), hooksUrl: '' });
  await unset.control('exports-download-stills').fire('click'); await settle();
  assert.equal(unset.fetches.filter(entry => /listing-exports/.test(entry.url)).length, 0);
  assert.equal(unset.row().textContent, 'Downloads aren’t open yet. Try again later.');
  const expired = await load({ exports: row('ready'), hooks: () => ({ status: 401, body: { error: 'unauthorized' } }) });
  await expired.control('exports-download-stills').fire('click'); await settle();
  assert.equal(expired.status(), 'Your sign-in has expired. Sign in to download your listing videos.');
});

test('listing exports: Check again reads again; a failed read offers Try again', async () => {
  let state = 'rendering';
  const h = await load({ exports: args => row(state)(args) });
  state = 'ready';
  await h.button('Check again').fire('click'); await settle();
  assert.equal(h.state().textContent, 'Ready to download.');
  assert.equal(h.state().wasFocused, true);
  let fail = true;
  const broken = await load({ exports: args => (fail ? { error: { message: 'Synthetic failure' } } : nothing()(args)) });
  assert.equal(broken.state().textContent, 'Listing videos couldn’t be checked. Try again.');
  fail = false;
  await broken.button('Try again').fire('click'); await settle();
  assert.equal(broken.control('exports-make').textContent, 'Make listing videos');
});

test('listing exports: the app’s page shows the same block and never an amount', async () => {
  const h = await load({ appMode: true, exports: row('ready') });
  assert.equal(h.block().hidden, false);
  const soon = await load({ appMode: true, exports: nothing(null) });
  assert.deepEqual(soon.text(), [...INTRO, 'Exports open soon.']);
  // Every export state through the QA fixture on the app's page, as the release check renders it.
  const { renderAppAccount, findBanned } = await import(path.join(__dirname, '../scripts/check-app-pages.mjs'));
  const dist = path.join(__dirname, '../dist');
  const cases = ['soon', 'request', 'requested', 'rendering', 'needs-attention', 'ready', 'ready-locked', 'partner-only', 'failed', 'failed-soon', 'unknown-version', 'error'];
  for (const name of cases) {
    const { written, calls } = await renderAppAccount(dist, '?exports=' + name);
    assert.ok(calls.includes('get_listing_exports'), name);
    const problems = [...new Set(written)].flatMap(value => findBanned(value, name));
    assert.deepEqual(problems, [], name);
  }
  const ready = await renderAppAccount(dist, '?exports=ready');
  assert.ok(ready.written.includes('Download listing video (16:9) · 18.6 MB'));
  const soonApp = await renderAppAccount(dist, '?exports=soon');
  assert.ok(soonApp.written.includes('Exports open soon.'));
});
