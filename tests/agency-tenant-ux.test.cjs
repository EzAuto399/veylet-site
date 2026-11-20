'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const siteLib = require('./site-lib.cjs');
const { createDocument } = require('./fake-dom.cjs');
const { loadDesk } = require('./desk-fake.cjs');

const dist = path.join(__dirname, '..', 'dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function loadClientPage(extra = {}) {
  const window = {};
  const ctx = { window, URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout, ...extra };
  siteLib.load(ctx);
  vm.runInNewContext(read('client-page.js'), ctx);
  return window.VeyletClientPage;
}

function loadSharing() {
  const window = {};
  vm.runInNewContext(read('tour-sharing.js'), { window, URL, navigator: { clipboard: { writeText: async () => {} } } });
  return window.VeyletSharing;
}

test('lease listings tailor /handoff CTA, quick-intent chips, room context and hooks payload for potential tenants', async () => {
  const page = loadClientPage();
  const doc = createDocument();
  const card = doc.createElement('section'); card.id = 'agent-card'; card.hidden = true; doc.body.append(card);
  const bar = doc.createElement('aside'); bar.id = 'agent-bar'; bar.hidden = true; doc.body.append(bar);
  const sheet = doc.createElement('dialog'); sheet.id = 'agent-enquiry-sheet'; sheet.hidden = true; doc.body.append(sheet);

  const posted = [];
  const contact = page.contactFrom([{
    display_name: 'Maya PM',
    agency: 'River Property Management',
    phone: '+61 400 222 333',
    email: 'maya@riverpm.test',
    allow_viewing_request: true,
  }]);
  page.showContact(doc, contact, 'Unit 4, New Farm', null, false, {
    token: TOKEN,
    campaignMode: 'lease',
    enquiryClient: { rpc: async () => ({ data: { accepted: true }, error: null }) },
    hooksUrl: 'https://hooks.veylet.com',
    getStop: () => 3,
    getRoom: () => 'Kitchen',
    fetch: async (url, init) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });

  const cta = card.querySelectorAll('button').find(b => b.textContent === 'Enquire to lease');
  assert.ok(cta, 'lease mode labels the action Enquire to lease');
  cta.click();
  assert.match(sheet.textContent, /Enquire about leasing with Maya PM/);
  assert.match(sheet.textContent, /Kitchen · Stop 3/);

  const leaseChip = sheet.querySelectorAll('button').find(b => b.dataset?.intent === 'lease_terms');
  assert.ok(leaseChip, 'renders lease intent chip');
  leaseChip.click();
  assert.equal(leaseChip.getAttribute('aria-pressed'), 'true');

  // Empty submit triggers inline validation error on name field
  const submitBtn = sheet.querySelectorAll('button').find(b => b.type === 'submit');
  assert.equal(submitBtn.textContent, 'Send rental enquiry');
  submitBtn.click();
  const nameInput = sheet.querySelectorAll('input').find(i => i.name === 'visitor_name');
  assert.equal(nameInput.getAttribute('aria-invalid'), 'true');

  nameInput.value = 'Sam Tenant';
  sheet.querySelectorAll('input').find(i => i.name === 'visitor_email').value = 'sam@tenant.test';
  sheet.querySelector('textarea').value = 'Available from 1 Dec?';
  submitBtn.click();
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].body.room_name, 'Kitchen');
  assert.equal(posted[0].body.intent, 'lease_terms');
  assert.equal(posted[0].body.campaign_mode, 'lease');
  assert.equal(posted[0].body.stop_number, 3);
  assert.match(sheet.textContent, /Sent\. Maya PM has your enquiry\./);
});

test('tour-sharing provides AU CRM hints, tenant SMS templates, oEmbed URL, formula-safe CSV and vendor/landlord summaries', () => {
  const share = loadSharing();
  const crmIds = share.crms.map(c => c.id);
  for (const id of ['rex', 'vaultre', 'agentbox', 'propertyme', 'boxdice', 'eagle', 'ire', 'domain']) {
    assert.ok(crmIds.includes(id), 'includes AU CRM ' + id);
  }
  const msgs = share.buyerMessages('42 River Rd', TOKEN);
  assert.match(msgs.beforeLeaseInspection, /rental inspection/i);
  assert.match(msgs.afterLeaseInspection, /before applying/i);
  assert.equal(share.oembedUrl(TOKEN), 'https://veylet.com/oembed?url=' + encodeURIComponent('https://veylet.com/tour?t=' + TOKEN));
  assert.match(share.developerBrief(TOKEN), /data-veylet-inline/);
  assert.match(share.developerBrief(TOKEN), /\/oembed\?url=/);

  const csv = share.enquiriesCsv([
    { created_at: '2026-11-20T00:00:00Z', visitor_name: '=CMD|evil', visitor_phone: '+61 400 111 222', visitor_email: 'a@b.test', stop_number: 2, message: 'Line 1\nLine 2' },
  ], 'River Unit');
  assert.match(csv, /"'=CMD\|evil"/, 'neutralizes spreadsheet formula prefix');
  assert.match(csv, /"'\+61 400 111 222"/);
  assert.match(csv, /"Stop 2"/);

  const landlord = share.vendorSummary({ title: 'River Unit', campaignMode: 'lease', opens: 42, calls: 4, emails: 2, enquiries: 3, shareUrl: share.handoffUrl(TOKEN) });
  assert.match(landlord, /^Landlord update — River Unit/);
  assert.match(landlord, /Prospective tenant contact activity: 4 calls · 2 emails · 3 enquiries/);
});

test('account desk status filter pills combine with text search, and enquiries expose tel:/mailto:, CSV and landlord/vendor updates', async () => {
  const properties = [
    { id: 'p1', title: 'Corner office', workspace_id: 'w1' },
    { id: 'p2', title: 'River apartment', workspace_id: 'w1' },
    { id: 'p3', title: 'Garden villa', workspace_id: 'w1' },
    { id: 'p4', title: 'Harbour studio', workspace_id: 'w1' },
  ];
  const tours = [
    { id: 't1', property_id: 'p1', status: 'ready', storage_path: 'w1/t1/package.zip', created_by: 'user-1', share_token: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 't2', property_id: 'p2', status: 'ready', storage_path: 'w1/t2/package.zip', created_by: 'user-1', share_token: TOKEN, created_at: '2026-10-02T00:00:00Z' },
  ];
  const h = await loadDesk({
    tables: { tours: { data: tours }, properties: { data: properties } },
    approved: ['t2'],
    rpc: {
      get_tour_view_stats: async () => ({ data: [{ opens: 12, call_taps: 2, email_taps: 1 }] }),
      get_property_campaign_details: async () => ({ data: [{ campaign_mode: 'lease', headline: 'River apartment', bedrooms: 2, bathrooms: 1, car_spaces: 1 }] }),
      list_workspace_tour_enquiries: async () => ({ data: [{
        id: 'e1', tour_id: 't2', visitor_name: 'Sam Tenant', visitor_phone: '+61 400 123 456',
        visitor_email: 'sam@tenant.test', stop_number: 2, message: '[Lease terms & bond] Pets ok?', created_at: '2026-11-20T00:00:00Z',
      }] }),
    },
  });
  await h.settle();

  const statesEl = h.ids['account-space-states'];
  assert.equal(statesEl.hidden, false, 'status filter pills appear past 3 spaces');
  const livePill = statesEl.children.find(b => b.dataset?.stateFilter === 'live');
  await livePill.fire('click');
  const rows = h.ids['account-space-list'].children.filter(el => el.className === 'space-row');
  assert.deepEqual(rows.map(r => r.hidden), [true, false, true, true], 'Live filter shows only live space');
  assert.equal(h.ids['account-space-filter-status'].textContent, 'Showing 1 of 4 spaces.');

  // Open Listing details & enquiries on live tour t2
  const card = h.card('t2');
  const details = card.all().find(el => el.tagName === 'DETAILS' && el.className.includes('tour-campaign'));
  details.open = true;
  await details.fire('toggle');
  await h.settle();

  const tel = details.all().find(el => el.tagName === 'A' && el.getAttribute('href') === 'tel:+61400123456');
  const mail = details.all().find(el => el.tagName === 'A' && el.getAttribute('href') === 'mailto:sam%40tenant.test');
  const csvLink = details.all().find(el => el.dataset?.control === 'download-enquiries-csv');
  const updateBtn = details.all().find(el => el.dataset?.control === 'copy-vendor-update');
  assert.ok(tel, 'enquiry phone is a clickable tel: link');
  assert.ok(mail, 'enquiry email is a clickable mailto: link');
  assert.ok(csvLink && csvLink.getAttribute('href').startsWith('data:text/csv;charset=utf-8,'), 'CSV download link present');
  assert.equal(updateBtn.textContent, 'Copy landlord update');
});

test('tour-player-v2 exposes accessible progressbar, Auto-tour toggle, and 44px touch Look/Zoom controls', () => {
  const playerJs = read('tour-player-v2.js');
  const playerCss = read('tour-player-v2.css');
  assert.match(playerJs, /role:\s*'progressbar'/);
  assert.match(playerJs, /aria-valuenow/);
  assert.match(playerJs, /v2-autotour/);
  assert.match(playerJs, /v2-view-toggle/);
  assert.match(playerJs, /Look left/);
  assert.match(playerJs, /Zoom in/);
  assert.match(playerCss, /\.v2-room-pill\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(playerCss, /\.v2-view-bar\s*\{/);
});

test('embed.js auto-upgrades data-veylet-inline anchors into lazy responsive iframes idempotently', () => {
  const doc = createDocument();
  doc.readyState = 'complete';
  const wrap = doc.createElement('div');
  const a = doc.createElement('a');
  a.setAttribute('href', 'https://veylet.com/tour?t=' + TOKEN + '&theme=paper');
  a.setAttribute('data-veylet-inline', '');
  a.textContent = 'Open 3D walkthrough';
  const foreign = doc.createElement('a');
  foreign.setAttribute('href', 'https://evil.example/tour?t=' + TOKEN);
  foreign.setAttribute('data-veylet-inline', '');
  wrap.append(a, foreign);
  doc.body.append(wrap);

  // Add insertBefore shim if fake-dom lacks it
  if (typeof wrap.insertBefore !== 'function') {
    wrap.insertBefore = (node, ref) => {
      const idx = wrap.children.indexOf(ref);
      node.parentNode = wrap;
      if (idx === -1) wrap.children.push(node);
      else wrap.children.splice(idx, 0, node);
      return node;
    };
  }
  const window = {};
  vm.runInNewContext(read('embed.js'), { window, document: doc, URL, encodeURIComponent, location: { href: 'https://agency.example/listing/1' } });
  window.VeyletEmbed.upgrade();
  const iframes = wrap.children.filter(el => el.tagName === 'IFRAME');
  assert.equal(iframes.length, 1, 'upgrades valid Veylet link once and skips foreign origins');
  assert.equal(iframes[0].getAttribute('src'), 'https://veylet.com/embed?t=' + TOKEN + '&theme=paper');
  assert.equal(iframes[0].getAttribute('loading'), 'lazy');
});
