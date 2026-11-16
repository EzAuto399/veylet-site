'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./fake-dom.cjs');
const { withClientHelpers } = require('./client-words.cjs');

const dist = path.join(__dirname, '..', 'dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');

function loadModule(extra = {}) {
  const window = {};
  vm.runInNewContext(read('client-page.js'), { window, URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout, ...extra });
  return window.VeyletClientPage;
}

test('campaignFactsFrom and openHomeIcs format synced listing facts and calendar invite safely', () => {
  const page = loadModule();
  const facts = page.campaignFactsFrom([{
    campaign_mode: 'sale',
    headline: '  North-facing riverfront apartment ',
    bedrooms: 3,
    bathrooms: 2,
    car_spaces: 1,
    next_open_start: '2026-11-21T00:00:00Z',
    next_open_end: '2026-11-21T00:30:00Z',
  }]);
  assert.equal(facts.modeLabel, 'For sale');
  assert.equal(facts.headline, 'North-facing riverfront apartment');
  assert.equal(facts.countsLine, '3 bed · 2 bath · 1 car');
  assert.ok(facts.nextOpenStart && facts.nextOpenEnd);

  const ics = page.openHomeIcs('14 River St', facts.nextOpenStart, facts.nextOpenEnd, 'https://veylet.com/handoff?t=abc');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Open home - 14 River St\r\n/);
  assert.match(ics, /DTSTART:20261121T000000Z\r\n/);
  assert.match(ics, /DTEND:20261121T003000Z\r\n/);

  assert.equal(page.campaignFactsFrom([{ campaign_mode: 'none' }]), null);
});

test('brandFrom accepts only #RRGGBB colours and https:// avatar/logo URLs', () => {
  const page = loadModule();
  const brand = page.brandFrom([{
    agency_brand_hex: '#18382E',
    avatar_url: 'https://cdn.veylet.com/a.webp',
    agency_logo_url: 'javascript:alert(1)',
  }]);
  assert.deepEqual({ ...brand }, {
    brandHex: '#18382e',
    avatarUrl: 'https://cdn.veylet.com/a.webp',
  });
  assert.equal(page.brandFrom([{ agency_brand_hex: 'red', avatar_url: 'http://insecure.example/a.png' }]), null);
});

test('inline enquiry sheet submits buyer details and stop number via submit_tour_enquiry', async () => {
  const page = loadModule();
  const doc = createDocument();
  const card = doc.createElement('section'); card.id = 'agent-card'; card.hidden = true; doc.body.append(card);
  const bar = doc.createElement('aside'); bar.id = 'agent-bar'; bar.hidden = true; doc.body.append(bar);
  const sheet = doc.createElement('section'); sheet.id = 'agent-enquiry-sheet'; sheet.hidden = true; doc.body.append(sheet);

  const calls = [];
  const enquiryClient = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: { accepted: true, enquiry_id: 'e1' }, error: null };
    },
  };
  const contact = page.contactFrom([{
    display_name: 'Sarah Chen',
    agency: 'Harbour Realty',
    phone: '+61 400 123 456',
    email: 'sarah@harbour.test',
    allow_viewing_request: true,
  }]);

  page.showContact(doc, contact, '14 River St', null, false, {
    token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    enquiryClient,
    getStop: () => 2,
  });

  const bookBtn = card.querySelectorAll('button').find(b => b.textContent === 'Book viewing');
  assert.ok(bookBtn, 'Book viewing opens inline sheet when enquiryClient is available');
  bookBtn.click();
  assert.equal(sheet.hidden, false);

  const inputs = sheet.querySelectorAll('input');
  inputs.find(i => i.name === 'visitor_name').value = 'Liam Buyer';
  inputs.find(i => i.name === 'visitor_phone').value = '0412 345 678';
  const textarea = sheet.querySelector('textarea');
  textarea.value = 'Can we inspect Saturday?';

  const submitBtn = sheet.querySelectorAll('button').find(b => b.type === 'submit');
  submitBtn.click();
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'submit_tour_enquiry');
  assert.equal(calls[0][1].p_name, 'Liam Buyer');
  assert.equal(calls[0][1].p_phone, '0412 345 678');
  assert.equal(calls[0][1].p_stop_number, 2);
  assert.match(sheet.textContent, /Sent\./);
});

test('/handoff?sample=1 opens Appraisal Pitch preview with sample walkthrough and agent card without RPC calls', async () => {
  const handoff = read('handoff/index.html');
  const document = createDocument();
  for (const match of handoff.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const [, tag, before, id, after] = match;
    const node = document.createElement(tag);
    node.id = id;
    if (/\shidden\b/.test(before + after)) node.hidden = true;
    document.body.append(node);
  }
  let bootOpts = null;
  const window = {
    VeyletPlayer: withClientHelpers({
      TourFailure: Error,
      showFailure() {},
      boot(opts) { bootOpts = opts; return Promise.resolve({ outcome: 'shown' }); },
    }),
  };
  const location = {
    origin: 'https://veylet.com',
    pathname: '/handoff',
    search: '?sample=1&name=Sarah+Chen&agency=Harbour+Realty&phone=%2B61+400+123+456',
  };
  document.documentElement = document.createElement('html');
  const ctx = { window, document, location, navigator: {}, URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout };
  vm.runInNewContext(read('client-page.js'), ctx);
  vm.runInNewContext(handoff.match(/<script type="module">([\s\S]*?)<\/script>/)[1], ctx);

  assert.ok(bootOpts, 'sample=1 boots the player instead of showing incomplete');
  const rpcCalls = [];
  const resolved = await bootOpts.resolve({ rpc: async name => { rpcCalls.push(name); } });
  assert.equal(rpcCalls.length, 0, 'sample preview makes zero Supabase RPC calls');
  assert.equal(resolved.packageBaseUrl, '/samples/eyeful-apartment/');
  assert.equal(resolved.packageFormatVersion, 2);
  assert.equal(document.getElementById('handoff-sample-banner').hidden, false);
  assert.equal(document.getElementById('agent-card').hidden, false);
  assert.match(document.getElementById('agent-card').textContent, /Sarah Chen/);
});
