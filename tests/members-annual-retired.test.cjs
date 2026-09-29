'use strict';
/*
 * Owner decision, 29 September 2026: the legacy members' annual (A$990 a year, on an
 * A$99-a-month basis, from offer 2026-09-25.2) is removed completely. It is not sold,
 * quoted or started. offer.json keeps its change log (history), which may describe it;
 * nothing else in the record or on a public page may.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '../dist');
const read = file => fs.readFileSync(path.join(dist, file), 'utf8');
const offer = JSON.parse(read('offer/offer.json'));

// A$99 or A$990 as a price: not A$99.99, A$990.50, A$9,900 or A$999.
const RETIRED_PRICE = /(?:A|AU)?\$\s?99(?:0)?(?![\d]|[.,]\d)/;
const RETIRED_WORDS = /members[’']? annual|membersAnnual|members_annual|members-annual/i;

// Every value in the record outside its change log, with the path that holds it.
function* values(node, trail = []) {
  if (Array.isArray(node)) { for (const [i, item] of node.entries()) yield* values(item, [...trail, i]); return; }
  if (node && typeof node === 'object') {
    for (const [key, item] of Object.entries(node)) {
      if (trail.length === 0 && key === 'history') continue;
      yield [[...trail, key].join('.'), key];
      yield* values(item, [...trail, key]);
    }
    return;
  }
  yield [trail.join('.'), node];
}

test('(a) offer.json has no membersAnnual and no A$99 or A$990 amount outside its change log', () => {
  assert.equal(offer.membersAnnual, undefined, 'the members’ annual block is removed');
  for (const [where, value] of values(offer)) {
    if (typeof value === 'number') assert.ok(![99, 990, 9900, 99000].includes(value), `${where} is ${value}`);
    if (typeof value === 'string') {
      assert.doesNotMatch(value, RETIRED_PRICE, `${where} states a retired price`);
      assert.doesNotMatch(value, RETIRED_WORDS, `${where} names the members’ annual`);
    }
  }
  // The change log records the decision.
  assert.ok(offer.history.some(entry => /owner decision 29 September 2026: the legacy members' annual \(A\$990\) is removed; it is not sold, quoted or started/
    .test(entry.restated || entry.change || '')), 'the change log records the removal');
});

test('(b) account.js never calls get_members_annual_offer or the members-annual hooks', () => {
  const account = read('account.js');
  assert.doesNotMatch(account, /get_members_annual_offer/);
  assert.doesNotMatch(account, /\/square\/members-annual\//);
  assert.doesNotMatch(read('account/index.html'), /id="account-annual"/);
});

test('(c) no public dist file shows A$99 or A$990, or names the members’ annual', () => {
  const skip = /\/vendor\//; // third-party libraries, not our wording
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:html|js|css|txt|json|xml|md|webmanifest)$/.test(entry.name) && !skip.test(full + '/')) files.push(full);
    }
  };
  walk(dist);
  assert.ok(files.length > 50, 'the public files are read');
  for (const file of files) {
    const rel = path.relative(dist, file);
    let text = fs.readFileSync(file, 'utf8');
    // The record's change log may describe past offers; the rest of it may not.
    if (rel === path.join('offer', 'offer.json')) { const copy = JSON.parse(text); delete copy.history; text = JSON.stringify(copy); }
    assert.doesNotMatch(text, RETIRED_PRICE, `${rel} shows A$99 or A$990`);
    assert.doesNotMatch(text, RETIRED_WORDS, `${rel} names the members’ annual`);
  }
});
