const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { render } = require('../scripts/plan-terms.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('dist/plan-terms.js is exactly the generated output', () => {
  assert.deepEqual({ 'plan-terms.js': read('dist/plan-terms.js') }, render());
});

test('the desks and their pages share one copy of the plan facts', () => {
  for (const page of ['dist/account/index.html', 'dist/app/account/index.html', 'dist/studio/index.html']) {
    const html = read(page);
    assert.ok(html.indexOf('src="/plan-terms.js') < html.indexOf(page.includes('studio') ? 'src="/studio.js' : 'src="/account.js'),
      `${page} loads plan-terms.js before its desk script`);
  }
  const shared = {};
  vm.runInNewContext(read('dist/plan-terms.js'), { window: shared });
  assert.ok(Object.isFrozen(shared.VeyletPlanTerms));
  const offer = JSON.parse(read('dist/offer/offer.json'));
  assert.equal(shared.VeyletPlanTerms.TRIAL_DEFAULT_MONTHS, offer.freeMonths.months);
  assert.equal(shared.VeyletPlanTerms.TRIAL_DEFAULT_ROOMS, offer.freeMonths.includedRooms);
  for (const pack of offer.packs) {
    assert.deepEqual(JSON.parse(JSON.stringify(shared.VeyletPlanTerms.PACKS[pack.code])), { walkthroughs: pack.walkthroughs, cents: Math.round(pack.webAud * 100) });
  }
  assert.equal(shared.VeyletPlanTerms.REFERRAL_ROOMS, offer.referral.referrerRooms);
});
