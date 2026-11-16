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

test('brandFrom accepts only #RRGGBB colours and https:// avatar/logo URLs up to 500 chars', () => {
  const page = loadModule();
  const longAvatar = 'https://cdn.veylet.com/' + 'a'.repeat(380) + '.webp';
  const longLogo = 'https://cdn.veylet.com/' + 'b'.repeat(460) + '.webp';
  const brand = page.brandFrom([{
    agency_brand_hex: '#18382E',
    avatar_url: longAvatar,
    agency_logo_url: longLogo,
  }]);
  assert.deepEqual({ ...brand }, {
    brandHex: '#18382e',
    avatarUrl: longAvatar,
    logoUrl: longLogo,
  });
  assert.equal(page.brandFrom([{
    agency_brand_hex: 'red',
    avatar_url: 'http://insecure.example/a.png',
    agency_logo_url: 'javascript:alert(1)',
  }]), null);
  assert.equal(page.brandFrom([{
    avatar_url: 'https://cdn.veylet.com/' + 'c'.repeat(480),
    agency_logo_url: 'https://cdn.veylet.com/has space.webp',
  }]), null);
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

test('openEnquirySheet posts to hooksUrl/tour-enquiry, handles 400/404/429 without fallback, and falls back to RPC on 503/5xx/network error', async () => {
  const submitSheet = async ({ hooksUrl, fetchImpl, rpcImpl }) => {
    const page = loadModule();
    const doc = createDocument();
    const card = doc.createElement('section'); card.id = 'agent-card'; card.hidden = true; doc.body.append(card);
    const bar = doc.createElement('aside'); bar.id = 'agent-bar'; bar.hidden = true; doc.body.append(bar);
    const sheet = doc.createElement('section'); sheet.id = 'agent-enquiry-sheet'; sheet.hidden = true; doc.body.append(sheet);
    const rpcCalls = [];
    const enquiryClient = {
      rpc: async (name, args) => {
        rpcCalls.push([name, args]);
        return rpcImpl ? rpcImpl(name, args) : { data: { accepted: true, enquiry_id: 'rpc-1' }, error: null };
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
      hooksUrl,
      fetch: fetchImpl,
      getStop: () => 3,
    });
    const bookBtn = card.querySelectorAll('button').find(b => b.textContent === 'Book viewing');
    bookBtn.focus();
    bookBtn.click();
    const inputs = sheet.querySelectorAll('input');
    inputs.find(i => i.name === 'visitor_name').value = 'Liam Buyer';
    inputs.find(i => i.name === 'visitor_email').value = 'liam@buyer.test';
    sheet.querySelector('textarea').value = 'Saturday morning?';
    sheet.querySelectorAll('button').find(b => b.type === 'submit').click();
    for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
    return { doc, sheet, rpcCalls, bookBtn };
  };

  // 1. 200 { accepted: true } via hooksUrl/tour-enquiry skips RPC
  const hookRequests = [];
  const ok = await submitSheet({
    hooksUrl: 'https://hooks.veylet.com/',
    fetchImpl: async (url, init) => {
      hookRequests.push({ url, method: init.method, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });
  assert.equal(hookRequests.length, 1);
  assert.equal(hookRequests[0].url, 'https://hooks.veylet.com/tour-enquiry');
  assert.equal(hookRequests[0].method, 'POST');
  assert.deepEqual(hookRequests[0].body, {
    token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    title: '14 River St',
    name: 'Liam Buyer',
    email: 'liam@buyer.test',
    phone: null,
    stop_number: 3,
    message: 'Saturday morning?',
    website: '',
  });
  assert.equal(ok.rpcCalls.length, 0);
  assert.match(ok.sheet.textContent, /Sent\. Sarah Chen has your enquiry\./);

  // Escape dismisses sent sheet and restores focus to opener
  for (const listener of ok.doc.listeners.get('keydown') || []) {
    listener({ key: 'Escape', preventDefault() {} });
  }
  assert.equal(ok.sheet.hidden, true);
  assert.equal(ok.doc.activeElement, ok.bookBtn);

  // 1b. hooksUrl with a subpath prefix posts to <hooksUrl>/tour-enquiry
  const subpathReqs = [];
  const subpath = await submitSheet({
    hooksUrl: 'https://staging.example.com/hooks/',
    fetchImpl: async url => {
      subpathReqs.push(url);
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });
  assert.deepEqual(subpathReqs, ['https://staging.example.com/hooks/tour-enquiry']);
  assert.equal(subpath.rpcCalls.length, 0);

  // 2. 429 / 404 / 400 show exact refusal messages with NO RPC fallback
  for (const [status, expected] of [
    [429, 'Too many enquiries right now. Use Call or Email above instead.'],
    [404, 'This walkthrough is no longer available.'],
    [400, 'Check your details and try again.'],
  ]) {
    const refused = await submitSheet({
      hooksUrl: 'https://hooks.veylet.com',
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ error: 'refused' }) }),
    });
    assert.equal(refused.rpcCalls.length, 0, `HTTP ${status} must not fall back to RPC`);
    assert.equal(refused.sheet.querySelector('.enquiry-status').textContent, expected);
  }

  // 3. 503, 500, and network error fall back to submit_tour_enquiry RPC
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_configured' }) }),
    async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
    async () => { throw new Error('network down'); },
  ]) {
    const fallback = await submitSheet({ hooksUrl: 'https://hooks.veylet.com', fetchImpl });
    assert.equal(fallback.rpcCalls.length, 1);
    assert.equal(fallback.rpcCalls[0][0], 'submit_tour_enquiry');
    assert.match(fallback.sheet.textContent, /Sent\. Sarah Chen has your enquiry\./);
  }
});

test('contactActions shows Book inspection + Ask a question when both bookingUrl and allowViewingRequest exist, and applyBrand is idempotent across all surfaces', () => {
  const page = loadModule();
  const doc = createDocument();
  const facts = doc.createElement('p'); facts.id = 'handoff-facts'; facts.hidden = true; doc.body.append(facts);
  const card = doc.createElement('section'); card.id = 'agent-card'; card.hidden = true; doc.body.append(card);
  const bar = doc.createElement('aside'); bar.id = 'agent-bar'; bar.hidden = true; doc.body.append(bar);
  const sheet = doc.createElement('section'); sheet.id = 'agent-enquiry-sheet'; sheet.hidden = true; doc.body.append(sheet);

  const contact = page.contactFrom([{
    display_name: 'Sarah Chen',
    agency: 'Harbour Realty',
    phone: '+61 400 123 456',
    email: 'sarah@harbour.test',
    booking_url: 'https://cal.example/sarah',
    allow_viewing_request: true,
  }]);
  page.showCampaignFacts(doc, { modeLabel: 'For sale', countsLine: '3 bed', headline: 'Riverfront' }, '14 River St', 'https://veylet.com/handoff?t=abc');
  page.showContact(doc, contact, '14 River St', null, false, {
    token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    enquiryClient: { rpc: async () => ({ data: { accepted: true } }) },
  });

  const cardLinks = card.querySelectorAll('a').map(a => a.textContent);
  const cardBtns = card.querySelectorAll('button').map(b => b.textContent);
  assert.deepEqual(cardLinks, ['Call', 'Email', 'Book inspection']);
  assert.deepEqual(cardBtns, ['Ask a question']);
  assert.ok(card.classList.contains('agent-card-multi'));
  assert.ok(bar.classList.contains('agent-bar-multi'));
  assert.ok(doc.body.classList.contains('has-agent-bar-multi'));
  assert.ok(doc.body.classList.contains('has-agent-bar-wrap'));

  // Clicking Ask a question opens the inline enquiry sheet
  card.querySelectorAll('button')[0].click();
  assert.equal(sheet.hidden, false);

  const brand = {
    brandHex: '#18382e',
    avatarUrl: 'https://cdn.veylet.com/avatar1.webp',
    logoUrl: 'https://cdn.veylet.com/logo1.webp',
  };
  page.applyBrand(doc, brand);
  page.applyBrand(doc, {
    brandHex: '#23453b',
    avatarUrl: 'https://cdn.veylet.com/avatar2.webp',
    logoUrl: 'https://cdn.veylet.com/logo2.webp',
  });

  const avatars = card.querySelectorAll('.agent-avatar');
  const logos = card.querySelectorAll('.agent-logo');
  assert.equal(avatars.length, 1, 'idempotent avatar replacement');
  assert.equal(logos.length, 1, 'idempotent logo replacement');
  assert.equal(avatars[0].getAttribute('src'), 'https://cdn.veylet.com/avatar2.webp');
  assert.equal(logos[0].getAttribute('src'), 'https://cdn.veylet.com/logo2.webp');
  assert.equal(card.querySelector('.agent-who').children[0], avatars[0], 'avatar stays first in .agent-who');
  for (const [el, cls] of [
    [card, 'agent-card-branded'],
    [bar, 'agent-bar-branded'],
    [sheet, 'agent-sheet-branded'],
    [facts, 'handoff-facts-branded'],
  ]) {
    assert.equal(el.style['--agent-brand'], '#23453b');
    assert.ok(el.classList.contains(cls));
  }

  // Subsequent applyBrand without brandHex clears prior brand colour & classes idempotently
  page.applyBrand(doc, { avatarUrl: 'https://cdn.veylet.com/avatar3.webp' });
  for (const [el, cls] of [
    [card, 'agent-card-branded'],
    [bar, 'agent-bar-branded'],
    [sheet, 'agent-sheet-branded'],
    [facts, 'handoff-facts-branded'],
  ]) {
    assert.equal(el.style['--agent-brand'], undefined);
    assert.equal(el.classList.contains(cls), false);
  }
  assert.equal(card.querySelectorAll('.agent-avatar').length, 1);
  assert.equal(card.querySelectorAll('.agent-logo').length, 0);
});

test('/handoff guards lookupContact vs lookupHandoffContext race in both directions and updates visit.contact', async () => {
  const handoff = read('handoff/index.html');
  const TOKEN = '0123456789abcdef0123456789abcdef';
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

  const mountHandoff = ({ contactRpc, contextFetch }) => {
    const document = createDocument();
    for (const match of handoff.matchAll(/<([a-z][\w-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
      const [, tag, before, id, after] = match;
      const node = document.createElement(tag);
      node.id = id;
      if (/\shidden\b/.test(before + after)) node.hidden = true;
      document.body.append(node);
    }
    document.documentElement = document.createElement('html');
    document.documentElement.classList.add('client-pending', 'client-contact-pending');
    let bootOpts = null;
    const window = {
      VEYLET_SUPABASE: { url: 'https://fixture.invalid', anonKey: 'anon' },
      VEYLET_HOOKS: { url: 'https://hooks.veylet.com' },
      VeyletPlayer: withClientHelpers({
        TourFailure: Error,
        showFailure() {},
        boot(opts) { bootOpts = opts; return new Promise(() => {}); },
      }),
    };
    const location = { origin: 'https://veylet.com', pathname: '/handoff', search: '?t=' + TOKEN, hash: '' };
    const fetch = async (url, init) => {
      if (String(url).endsWith('/lookup_tour_handoff_context')) return contextFetch(url, init);
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const ctx = { window, document, location, navigator: {}, URL, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout, fetch };
    vm.runInNewContext(read('client-page.js'), ctx);
    vm.runInNewContext(handoff.match(/<script type="module">([\s\S]*?)<\/script>/)[1], ctx);
    const client = {
      rpc: async name => {
        if (name === 'lookup_tour_share') return { data: [{ storage_path: 'p/manifest.json', space_title: '14 River St', package_format_version: 2, package_base_url: 'https://tours.veylet.com/t/a/' }] };
        if (name === 'lookup_tour_share_contact') return contactRpc();
        return { data: [] };
      },
    };
    return { document, bootOpts, client };
  };

  // Case A: lookupHandoffContext resolves FIRST; slow lookupContact resolves AFTER and must NOT wipe enriched card/brand/visit.contact
  let resolveSlowContact;
  const caseA = mountHandoff({
    contactRpc: () => new Promise(resolve => { resolveSlowContact = resolve; }),
    contextFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        display_name: 'Sarah Chen',
        agency: 'Harbour Realty',
        phone: '+61 400 123 456',
        email: 'sarah@harbour.test',
        booking_url: 'https://cal.example/sarah',
        allow_viewing_request: true,
        agency_brand_hex: '#18382e',
        avatar_url: 'https://cdn.veylet.com/sarah.webp',
      }],
    }),
  });
  await caseA.bootOpts.resolve(caseA.client);
  await settle();
  assert.ok(caseA.document.getElementById('agent-card').querySelector('.agent-avatar'), 'enriched avatar rendered first');
  assert.ok(caseA.document.getElementById('agent-card').querySelectorAll('button').some(b => b.textContent === 'Ask a question'));

  // Late lookupContact resolves now -> must not overwrite card/bar/brand or visit.contact
  resolveSlowContact({ data: [{ display_name: 'Sarah Chen', agency: 'Harbour Realty', phone: '+61 400 123 456', email: 'sarah@harbour.test' }] });
  await settle();
  const cardA = caseA.document.getElementById('agent-card');
  assert.equal(cardA.querySelectorAll('.agent-avatar').length, 1, 'late lookupContact did not wipe avatar');
  assert.ok(cardA.querySelectorAll('button').some(b => b.textContent === 'Ask a question'), 'late lookupContact did not wipe Ask a question');
  const visitContactA = await caseA.bootOpts.visit.contact;
  assert.deepEqual(JSON.parse(JSON.stringify(visitContactA.actions.map(a => a.label))), ['Call', 'Email', 'Book inspection']);

  // Case B: lookupContact resolves FIRST; lookupHandoffContext resolves AFTER and updates card/bar/brand + visit.contact
  let resolveSlowContext;
  const caseB = mountHandoff({
    contactRpc: async () => ({ data: [{ display_name: 'Sarah Chen', agency: 'Harbour Realty', phone: '+61 400 123 456', email: 'sarah@harbour.test' }] }),
    contextFetch: () => new Promise(resolve => { resolveSlowContext = resolve; }),
  });
  await caseB.bootOpts.resolve(caseB.client);
  await settle();
  assert.equal(caseB.document.getElementById('agent-card').hidden, false);

  resolveSlowContext({
    ok: true,
    status: 200,
    json: async () => [{
      display_name: 'Sarah Chen',
      agency: 'Harbour Realty',
      phone: '+61 400 123 456',
      email: 'sarah@harbour.test',
      allow_viewing_request: true,
      agency_brand_hex: '#18382e',
      avatar_url: 'https://cdn.veylet.com/sarah.webp',
    }],
  });
  await settle();
  const cardB = caseB.document.getElementById('agent-card');
  assert.equal(cardB.querySelectorAll('.agent-avatar').length, 1);
  assert.ok(cardB.querySelectorAll('button').some(b => b.textContent === 'Book viewing'));
  const visitContactB = await caseB.bootOpts.visit.contact;
  assert.deepEqual(JSON.parse(JSON.stringify(visitContactB.actions.map(a => a.label))), ['Call', 'Email', 'Book viewing']);

  // Case C: contextFetch fails/rejects -> fallback still settles visit.contact from lookupContact
  const caseC = mountHandoff({
    contactRpc: async () => ({ data: [{ display_name: 'Sarah Chen', agency: 'Harbour Realty', phone: '+61 400 123 456', email: 'sarah@harbour.test' }] }),
    contextFetch: async () => { throw new Error('network outage'); },
  });
  await caseC.bootOpts.resolve(caseC.client);
  await settle();
  const visitContactC = await caseC.bootOpts.visit.contact;
  assert.deepEqual(JSON.parse(JSON.stringify(visitContactC.actions.map(a => a.label))), ['Call', 'Email']);
});
