'use strict';
// The plan facts the account and studio desks share; scripts/plan-terms.cjs renders this from offer.json.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PLAN_STATUSES = ['pending', 'trial', 'active', 'ended'];
  const PLAN_SOURCES = ['studio', 'apple', 'web'];
  const PLAN_NAMES = { solo: 'Veylet plan', studio: 'Team', founding: 'Team, founding rate', office: 'Office', one: 'One walkthrough' };
  const TRIAL_INCLUDED_MAX = 240;
  const APPLE_PRODUCTS = { 'dev.property3d.capture.plan.monthly': ['studio', 'monthly'], 'dev.property3d.capture.plan.annual': ['studio', 'annual'], 'dev.property3d.capture.solo.monthly': ['solo', 'monthly'], 'dev.property3d.capture.solo.annual': ['solo', 'annual'] };
  const TRIAL_DEFAULT_MONTHS = 1;
  const TRIAL_DEFAULT_ROOMS = 30;
  const PACKS = { pack3: { walkthroughs: 30, cents: 16900 }, pack10: { walkthroughs: 100, cents: 49900 } };
  const PACK_VALID_MONTHS = 12;
  const REFERRAL_ROOMS = 10;
  const RETIRED_PLANS = ['studio', 'office', 'one', 'founding'];
  root.VeyletPlanTerms = Object.freeze({ PLAN_STATUSES, PLAN_SOURCES, PLAN_NAMES, TRIAL_INCLUDED_MAX, APPLE_PRODUCTS, TRIAL_DEFAULT_MONTHS, TRIAL_DEFAULT_ROOMS, PACKS, PACK_VALID_MONTHS, REFERRAL_ROOMS, RETIRED_PLANS });
})();
