/*
 * Applies the App Store launch switch (dist/launch-config.js) to the page.
 * When window.VEYLET_LAUNCH.appStoreLive is true it reveals elements marked
 * data-launch="app-store" and hides elements marked data-launch="pre-approval".
 *
 * App Store elements carry the `hidden` attribute in the markup, so they stay
 * invisible before this runs and with JavaScript off. With the flag off this
 * script still runs but changes nothing visible: pre-approval stays shown,
 * App Store stays hidden — identical to the no-JavaScript reading.
 */
(function () {
  'use strict';
  var live = !!(window.VEYLET_LAUNCH && window.VEYLET_LAUNCH.appStoreLive === true);

  function each(doc, selector, fn) {
    var found = doc.querySelectorAll(selector);
    for (var i = 0; i < found.length; i += 1) fn(found[i]);
  }

  /** Shows the stage's elements and hides the other stage's; returns whether App Store is live. */
  function apply(doc) {
    if (doc.documentElement) doc.documentElement.setAttribute('data-app-store-live', live ? 'true' : 'false');
    each(doc, '[data-launch="app-store"]', function (el) { el.hidden = !live; });
    each(doc, '[data-launch="pre-approval"]', function (el) { el.hidden = live; });
    return live;
  }

  window.VeyletLaunch = { appStoreLive: live, apply: apply };
  if (typeof document === 'undefined' || window.VEYLET_LAUNCH_MANUAL) return;
  var run = function () { apply(document); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
