'use strict';
/*
 * Shared desk validation.
 *
 * The privacy notice promises that Veylet records hold a suburb or city and not a
 * street address, so the forms enforce that instead of trusting the field hint.
 */
window.VeyletPlace = (() => {
  const STREET_WORDS =
    /\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|crescent|cres|terrace|tce|parade|pde|highway|hwy|boulevard|blvd|close|circuit|cct|way|esplanade|grove|rise|walk|mews|unit|apt|apartment|suite|level|floor|shop|po box)\b\.?/i;

  const UNIT_AND_NUMBER = /\b\d+[a-z]?\s*\/\s*\d+/i;
  const NUMBER_THEN_NAME = /^\s*\d+[a-z]?\s+\S/i;

  /** '' when the value is acceptable, otherwise a sentence to show the user. */
  function generalLocationProblem(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (UNIT_AND_NUMBER.test(text)) {
      return 'That looks like a unit and street number. Use the suburb or city only.';
    }
    if (NUMBER_THEN_NAME.test(text)) {
      return 'That looks like a street address. Use the suburb or city only.';
    }
    if (STREET_WORDS.test(text)) {
      return 'Street names and unit numbers do not belong on a Veylet record. Use the suburb or city only.';
    }
    return '';
  }

  /** The same rule for a free-text brief field, where a whole sentence is expected. */
  function briefLocationProblem(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (NUMBER_THEN_NAME.test(text) || UNIT_AND_NUMBER.test(text)) {
      return 'Please keep the street number and unit out of this field — the suburb, region or city is enough, and Veylet records should not hold an address.';
    }
    return '';
  }

  /** Stop one intent becoming two submissions. */
  function guardDoubleSubmit(form, statusEl, message) {
    let sent = false;
    form.addEventListener('submit', (event) => {
      if (sent) {
        event.preventDefault();
        if (statusEl) {
          statusEl.textContent = 'Already sent — one brief is enough. We reply by email.';
        }
        return;
      }
      sent = true;
      const button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }
      void message;
    });
  }

  return { generalLocationProblem, briefLocationProblem, guardDoubleSubmit };
})();

/*
 * If a page fails to start, say so. A desk that silently does nothing is worse
 * than one that admits it is broken, and this is the only notification a static
 * site can produce without an analytics account.
 */
(() => {
  let reported = false;
  function report(what) {
    if (reported) return;
    reported = true;
    const status =
      document.getElementById('account-status') ||
      document.getElementById('play-status') ||
      document.getElementById('handoff-status') ||
      document.getElementById('request-status') ||
      document.getElementById('apply-status');
    const message =
      'This page did not finish loading. Reload it — if it still will not start, email yoda@yodalai.xyz and say what you were doing.';
    if (status) {
      status.textContent = message;
      return;
    }
    // No status element on this page; a small banner is better than silence.
    const banner = document.createElement('p');
    banner.setAttribute('role', 'status');
    banner.style.cssText =
      'margin:16px 0;padding:12px 14px;border-left:2px solid #10231d;font:14px/1.5 system-ui,sans-serif;color:#10231d';
    banner.textContent = message;
    (document.querySelector('main') || document.body).prepend(banner);
    void what;
  }
  window.addEventListener('error', (event) => {
    // Resource errors (a missing image) are not page failures.
    if (event.target && event.target !== window && event.target.tagName) return;
    report(event.message);
  });
  window.addEventListener('unhandledrejection', () => report('rejection'));
  window.VeyletReportFailure = report;
})();
