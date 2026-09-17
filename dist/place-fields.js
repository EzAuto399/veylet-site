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
