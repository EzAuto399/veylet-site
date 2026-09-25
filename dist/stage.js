/*
 * The launch stage: what the public pages say about getting an account (launch readiness
 * plan §5, "What the public site says at each stage", in the product repository).
 * To move the site to another stage, change the one line below. Nothing else changes.
 *
 *   test        stage 0   "Limited test"; no sign-up link
 *   invitation  stage 1   "By invitation"; Ask for an invitation (the enquiry, which brings the app invitation)
 *   waitlist    stage 2   "By invitation"; Join the waitlist
 *   open        stages 3-4  new accounts in weekly groups from the waitlist
 *
 * Sign-in is never removed: /account signs in existing and invited accounts at every stage.
 * The pages carry the default stage's words in their markup (tests/stage.test.cjs checks
 * they match), so without JavaScript, or before this runs, a page reads as the default.
 */
window.VEYLET_STAGE = 'invitation';

(function () {
  'use strict';

  var DEFAULT = 'invitation';
  var INVITATION = { text: 'Ask for an invitation', href: '/request?capture=self' };
  var WAITLIST = { text: 'Join the waitlist', href: '/waitlist' };
  var INVITED = 'New accounts are by invitation for now. Invited? Sign in with the email we invited.';

  var STAGES = {
    test: {
      label: 'Limited test',
      cta: null,
      account: 'Account access is in a limited test for accounts we have set up.',
      accountLink: null,
    },
    invitation: { label: 'By invitation', cta: INVITATION, account: INVITED, accountLink: INVITATION },
    waitlist: { label: 'By invitation', cta: WAITLIST, account: INVITED, accountLink: WAITLIST },
    open: {
      label: 'New accounts weekly',
      cta: WAITLIST,
      account: 'New accounts open in weekly groups from the waitlist. Admitted? Sign in with the email you joined with.',
      accountLink: WAITLIST,
    },
  };

  function resolve(value) {
    return Object.prototype.hasOwnProperty.call(STAGES, value) ? value : DEFAULT;
  }

  function each(doc, selector, fn) {
    var found = doc.querySelectorAll(selector);
    for (var i = 0; i < found.length; i++) fn(found[i]);
  }

  /** Writes one stage's words into the page's marked elements; returns the stage used. */
  function apply(doc, value) {
    var stage = resolve(value);
    var words = STAGES[stage];
    if (doc.documentElement) doc.documentElement.setAttribute('data-launch-stage', stage);
    each(doc, '[data-launch-label]', function (el) { el.textContent = words.label; });
    each(doc, '[data-launch-cta]', function (el) {
      if (!words.cta) { el.hidden = true; return; }
      var icon = el.querySelector('.icon-arrow');
      el.textContent = words.cta.text;
      if (icon) el.append(' ', icon);
      el.setAttribute('href', words.cta.href);
      el.hidden = false;
    });
    each(doc, '[data-launch-account]', function (el) {
      el.textContent = words.account;
      if (!words.accountLink) return;
      var link = doc.createElement('a');
      link.setAttribute('href', words.accountLink.href);
      link.textContent = words.accountLink.text;
      el.append(' ', link, '.');
    });
    return stage;
  }

  var api = { STAGES: STAGES, DEFAULT: DEFAULT, resolve: resolve, apply: apply };
  window.VeyletStage = api;
  if (typeof document === 'undefined' || window.VEYLET_STAGE_MANUAL) return;
  var run = function () { apply(document, window.VEYLET_STAGE); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
