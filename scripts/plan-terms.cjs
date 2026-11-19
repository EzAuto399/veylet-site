/*
 * Renders dist/plan-terms.js — the one copy of the plan facts the account and
 * studio desks share — from dist/offer/offer.json plus the declared facts below
 * that the offer record does not carry. `node scripts/plan-terms.cjs --write`
 * writes the file; write-build-info.mjs calls write() before fingerprinting.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const offer = () => JSON.parse(fs.readFileSync(path.join(root, 'dist/offer/offer.json'), 'utf8'));

/* Declared: plan facts offer.json does not carry. */
const DECLARED = {
  // The status vocabulary get_workspace_plan rows may carry.
  PLAN_STATUSES: ['pending', 'trial', 'active', 'ended'],
  // Where the money is arranged decides which price is true for an account.
  PLAN_SOURCES: ['studio', 'apple', 'web'],
  // Plan code to the name customers see. Offer 2026-09-25.2 sells one plan, the
  // Veylet plan (code solo); the retired codes keep their names so an existing
  // row still reads as the plan it was agreed on (plan code 'studio' is Team).
  PLAN_NAMES: { solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' },
  // The most rooms the studio desk may grant on a free-months allowance.
  TRIAL_INCLUDED_MAX: 240,
};

const cadenceOf = key => (/monthly/i.test(key) ? 'monthly' : 'annual');

// The desks' own literal style: single-quoted strings, bare keys where legal.
const string = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const identifier = key => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => `${identifier(key) ? key : string(key)}: ${literal(item)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return typeof value === 'string' ? string(value) : String(value);
}

function render() {
  const record = offer();
  const appleProducts = {};
  for (const key of ['monthly', 'annual', 'soloMonthly', 'soloAnnual']) {
    if (key in record.appStore.productPlans) {
      appleProducts[record.appStore.productIds[key]] = [record.appStore.productPlans[key], cadenceOf(key)];
    }
  }
  const packs = {};
  for (const pack of record.packs) packs[pack.code] = { walkthroughs: pack.walkthroughs, cents: Math.round(pack.webAud * 100) };
  const terms = {
    ...DECLARED,
    APPLE_PRODUCTS: appleProducts,
    // offer.json freeMonths.
    TRIAL_DEFAULT_MONTHS: record.freeMonths.months,
    TRIAL_DEFAULT_ROOMS: record.freeMonths.includedRooms,
    // offer.json packs (webAud is the agreed invoice price) and packRules' validity.
    PACKS: packs,
    PACK_VALID_MONTHS: record.packs[0].validMonths,
    // offer.json referral: each office gets the same bonus.
    REFERRAL_ROOMS: record.referral.referrerRooms,
    RETIRED_PLANS: record.retiredPlans.codes,
  };
  const body = Object.entries(terms)
    .map(([name, value]) => `  const ${name} = ${literal(value)};`)
    .join('\n');
  return {
    'plan-terms.js': `'use strict';
// The plan facts the account and studio desks share; scripts/plan-terms.cjs renders this from offer.json.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
${body}
  root.VeyletPlanTerms = Object.freeze({ ${Object.keys(terms).join(', ')} });
})();
`,
  };
}

function write() {
  for (const [name, text] of Object.entries(render())) {
    fs.writeFileSync(path.join(root, 'dist', name), text);
  }
}

module.exports = { render, write };
if (require.main === module && process.argv.includes('--write')) write();
