'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dist = path.join(__dirname, '..', 'dist');
const read = rel => fs.readFileSync(path.join(dist, rel), 'utf8');

function loadSharing(clipboard = { writeText: async () => {} }, storageMap = null) {
  const window = {};
  if (storageMap) {
    window.localStorage = {
      getItem: key => storageMap.get(key) ?? null,
      setItem: (key, val) => storageMap.set(key, String(val)),
    };
  }
  vm.runInNewContext(read('tour-sharing.js'), { window, URL, navigator: { clipboard } });
  return { share: window.VeyletSharing, window };
}

test('VeyletSharing provides Australian real-estate CRM presets with safe storage persistence', () => {
  const store = new Map();
  const { share, window } = loadSharing(undefined, store);

  assert.deepEqual(
    Array.from(share.crms, item => item.id),
    ['rex', 'vaultre', 'agentbox', 'propertyme', 'boxdice', 'eagle', 'ire', 'domain', 'other']
  );
  assert.equal(share.savedCrm(), 'rex');
  share.saveCrm('vaultre');
  assert.equal(share.savedCrm(), 'vaultre');
  assert.match(share.crm('vaultre').hint, /VaultRE/);
  assert.match(share.crm('propertyme').hint, /PropertyMe/);

  // Untrusted storage values fall back cleanly to rex
  store.set('veylet-portal-crm', '<img onerror=1>');
  assert.equal(share.savedCrm(), 'rex');

  // SecurityError on localStorage never throws
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  assert.doesNotThrow(() => share.saveCrm('domain'));
  assert.equal(share.savedCrm(), 'rex');
});

test('VeyletSharing builds clean portal links and ready-to-send buyer SMS follow-ups', () => {
  const { share } = loadSharing();
  const token = 'abcdefghijklmnop1234567890abcdef';
  assert.equal(share.portalUrl(token), 'https://veylet.com/tour?t=' + token);

  const msgs = share.buyerMessages('  14 River St, New Farm  ', token);
  assert.match(msgs.afterInspection, /Thanks for inspecting 14 River St, New Farm/);
  assert.match(msgs.afterInspection, /https:\/\/veylet\.com\/handoff\?t=abcdefghijklmnop1234567890abcdef&src=link/);
  assert.match(msgs.beforeVisit, /Look around 14 River St, New Farm in 3D on your phone before you visit/);
  assert.match(msgs.beforeVisit, /no app needed/i);

  const fallback = share.buyerMessages('   ', token);
  assert.match(fallback.afterInspection, /Thanks for inspecting this space/);
});

test('account desk Website panel wires CRM field selector and 1-tap buyer SMS buttons without adding radio inputs', () => {
  const accountJs = read('account.js');
  assert.match(accountJs, /data-control="crm-select"|dataset\.control = 'crm-select'/, 'CRM select control exists');
  assert.match(accountJs, /dataset\.control = 'copy-sms-after'/, 'post-inspection SMS button exists');
  assert.match(accountJs, /dataset\.control = 'copy-sms-before'/, 'pre-visit SMS button exists');
  assert.match(accountJs, /dataset\.control = 'appraisal-preview'/, 'appraisal pitch preview control exists');
});

test('VeyletSharing builds safe appraisalPreviewUrl for vendor listing presentations', () => {
  const { share } = loadSharing();
  const url = share.appraisalPreviewUrl({
    display_name: '  Sarah Chen ',
    agency: 'Harbour Realty',
    phone: '+61 400 123 456',
    email: 'sarah@harbour.com.au',
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://veylet.com/handoff');
  assert.equal(parsed.searchParams.get('sample'), '1');
  assert.equal(parsed.searchParams.get('name'), 'Sarah Chen');
  assert.equal(parsed.searchParams.get('agency'), 'Harbour Realty');
  assert.equal(parsed.searchParams.get('phone'), '+61 400 123 456');
  assert.equal(parsed.searchParams.get('email'), 'sarah@harbour.com.au');

  const emptyUrl = share.appraisalPreviewUrl({});
  assert.equal(emptyUrl, 'https://veylet.com/handoff?sample=1');
});
