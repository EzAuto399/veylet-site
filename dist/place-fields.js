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
  function guardDoubleSubmit(form, statusEl, message = 'Opening the submission page…') {
    let sent = false;
    let recoveryTimer;
    const button = form.querySelector('button[type="submit"]');
    const originalMarkup = button?.innerHTML;
    const originallyDisabled = button?.disabled;
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      if (sent) {
        event.preventDefault();
        if (statusEl) {
          statusEl.textContent = 'Submission is in progress. Wait for the submission page before trying again.';
        }
        return;
      }
      sent = true;
      if (statusEl) statusEl.textContent = message;
      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }
      recoveryTimer = window.setTimeout?.(() => {
        if (sent && statusEl) statusEl.textContent = 'The submission page has not opened. Delivery is uncertain. Keep a copy of your enquiry below and email the studio with its reference, explaining that you already tried the form. Do not send another form while delivery is uncertain.';
      }, 20000);
    });
    // Back/forward cache preserves both the disabled control and this closure.
    // Restore an editable form without automatically sending the brief again.
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted || !sent) return;
      sent = false;
      window.clearTimeout?.(recoveryTimer);
      if (button) {
        button.disabled = originallyDisabled;
        button.innerHTML = originalMarkup;
      }
      if (statusEl) {
        statusEl.textContent = 'Your details are still here. If you completed the submission, wait for our email reply before sending again.';
      }
    });
  }

  /* ---- Inline validation ------------------------------------------------
   * A native validation bubble is the browser's, not ours: it vanishes, it is
   * never announced twice, it names no field to assistive technology, and it
   * only ever appears at submit. This shows the problem in text beside the
   * field it belongs to, on blur and again at submit, and never clears what
   * somebody typed. Without JavaScript the browser's own validation still runs,
   * because `novalidate` is only set once this is wired up.
   */
  function labelText(control) {
    const label = control.closest ? control.closest('label') : null;
    let text = '';
    if (label && label.childNodes) {
      for (const node of label.childNodes) if (node.nodeType === 3) text += ' ' + node.textContent;
    }
    return text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }

  /** '' when the control is acceptable, otherwise a sentence to show beside it. */
  function controlProblem(control) {
    if (!control.willValidate || control.validity.valid) return '';
    const state = control.validity;
    const label = labelText(control);
    if (state.valueMissing) {
      if (control.type === 'checkbox' || control.type === 'radio') return 'Tick this box before sending.';
      if (control.tagName === 'SELECT') return 'Choose one from the list before sending.';
      if (!label || /\?$/.test(label)) return 'Answer this before sending.';
      // "Your name / business" must not become "Add your your name".
      return 'Add your ' + label.replace(/^your\s+/i, '').toLowerCase() + ' before sending.';
    }
    if (state.typeMismatch && control.type === 'email') {
      return 'This needs an email address with an @ and a domain, like name@agency.com.au. We reply to it.';
    }
    if (state.typeMismatch && control.type === 'url') {
      return 'This needs a full web address starting with https://, or leave it empty.';
    }
    if (state.patternMismatch && control.name === 'token') {
      return 'Enter the six digits from the email, numbers only.';
    }
    if (state.patternMismatch) return 'This is not in the format this field accepts.';
    if (state.tooLong) {
      return 'This is longer than the ' + control.maxLength + ' characters the form accepts. Shorten it and send again.';
    }
    return control.validationMessage || 'Check this answer before sending.';
  }

  function inlineValidation(form, statusEl) {
    if (!form || !form.elements || typeof form.addEventListener !== 'function') return;
    const checked = () => [...form.elements].filter((el) =>
      el.willValidate && el.name && el.name.charAt(0) !== '_' && el.type !== 'hidden');
    const touched = new Set();
    let attempted = false;

    function clear(control) {
      control.removeAttribute('aria-invalid');
      const id = control.dataset.errorId;
      if (!id) return;
      const shown = document.getElementById(id);
      if (shown) shown.remove();
      const described = (control.getAttribute('aria-describedby') || '')
        .split(/\s+/).filter((token) => token && token !== id).join(' ');
      if (described) control.setAttribute('aria-describedby', described);
      else control.removeAttribute('aria-describedby');
    }

    function show(control, problem) {
      const id = control.dataset.errorId ||
        ('field-problem-' + (control.name || 'field') + '-' + Math.random().toString(36).slice(2, 8));
      control.dataset.errorId = id;
      let shown = document.getElementById(id);
      if (!shown) {
        shown = document.createElement('small');
        shown.id = id;
        shown.className = 'field-problem';
        // The message is the field's, so it lives with the field, not in a
        // toast that has gone by the time anybody reads it.
        const label = control.closest ? control.closest('label') : null;
        if (label && label.append) label.append(shown);
        else if (control.parentNode) control.parentNode.insertBefore(shown, control.nextSibling);
      }
      shown.textContent = problem;
      control.setAttribute('aria-invalid', 'true');
      const described = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (!described.includes(id)) control.setAttribute('aria-describedby', described.concat(id).join(' '));
    }

    function check(control) {
      const problem = controlProblem(control);
      if (problem) show(control, problem); else clear(control);
      return problem;
    }

    // Blur is where a person has finished with a field. Nagging an untouched
    // one they only tabbed past is noise, so an empty, untouched field waits
    // until the first send attempt.
    form.addEventListener('blur', (event) => {
      const control = event.target;
      if (!control || !control.willValidate || !checked().includes(control)) return;
      if (!attempted && !touched.has(control) && !String(control.value || '').trim()) return;
      check(control);
    }, true);
    form.addEventListener('input', (event) => {
      const control = event.target;
      if (!control || !control.willValidate) return;
      touched.add(control);
      if (control.getAttribute('aria-invalid') === 'true' && !controlProblem(control)) clear(control);
    });
    form.addEventListener('change', (event) => {
      const control = event.target;
      if (!control || !control.willValidate) return;
      touched.add(control);
      if (control.getAttribute('aria-invalid') === 'true' && !controlProblem(control)) clear(control);
    });

    form.addEventListener('submit', (event) => {
      attempted = true;
      const problems = checked().filter((control) => Boolean(check(control)));
      if (!problems.length) return;
      event.preventDefault();
      // Nothing further may treat this as a submission attempt.
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      // A problem inside a closed optional section is a problem nobody can see.
      for (const control of problems) {
        const section = control.closest ? control.closest('details') : null;
        if (section) section.open = true;
      }
      if (statusEl) {
        statusEl.textContent = (problems.length === 1
          ? 'One answer needs checking before this can be sent.'
          : problems.length + ' answers need checking before this can be sent.') +
          ' Each one is described beside its field, and nothing you typed was cleared.';
      }
      problems[0].focus?.();
      problems[0].scrollIntoView?.({ block: 'center', behavior: 'auto' });
    }, true);

    // Our messages replace the browser's transient bubble, but only now that
    // there is something to replace it with.
    form.noValidate = true;
  }

  /* ---- Drafts -----------------------------------------------------------
   * A long brief typed on a phone must survive a refresh, a stray back gesture
   * or a tab that was closed to look something up. The answers are kept in this
   * browser only, are never sent from here, and can be discarded in one press.
   */
  function keepDraft(form, statusEl, key) {
    if (!form || !form.elements || !key) return;
    let store = null;
    try {
      store = window.localStorage;
      store.setItem('veylet-draft-probe', '1');
      store.removeItem('veylet-draft-probe');
    } catch { return; }
    if (!store) return;
    const name = 'veylet-draft-' + key;
    const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
    const kept = () => [...form.elements].filter((el) =>
      el.name && el.name.charAt(0) !== '_' &&
      !['hidden', 'submit', 'button', 'reset', 'file', 'password'].includes(el.type));

    const forget = () => { try { store.removeItem(name); } catch { /* full or blocked */ } };
    const when = (at) => {
      const moment = new Date(at);
      return Number.isNaN(moment.getTime()) ? 'earlier'
        : moment.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    };

    let record = null;
    try { record = JSON.parse(store.getItem(name) || 'null'); } catch { record = null; }
    if (record && record.values && record.at && Date.now() - record.at < MAX_AGE) {
      let restored = 0;
      for (const control of kept()) {
        const value = record.values[control.name];
        if (value === undefined) continue;
        if (control.type === 'checkbox' || control.type === 'radio') {
          if (value === true && !control.checked) { control.checked = true; restored += 1; }
        } else if (!control.value && typeof value === 'string' && value) {
          control.value = value;
          restored += 1;
          const section = control.closest ? control.closest('details') : null;
          if (section) section.open = true;
        }
      }
      if (restored) {
        const notice = document.createElement('p');
        notice.className = 'draft-notice';
        notice.setAttribute('role', 'status');
        const said = document.createElement('span');
        said.textContent = record.sent
          ? 'These are the answers you submitted on ' + when(record.sent) +
            '. They are kept in this browser only; this page cannot confirm they arrived.'
          : 'Draft from ' + when(record.at) +
            ' restored. It is kept in this browser only and has not been sent.';
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'tour-action';
        discard.textContent = 'Discard draft';
        discard.addEventListener('click', () => {
          forget();
          for (const control of kept()) {
            if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
            else control.value = '';
          }
          notice.remove();
          if (statusEl) statusEl.textContent = 'Draft discarded. The form is empty again.';
          kept()[0]?.focus?.();
        });
        notice.append(said, discard);
        form.prepend(notice);
      }
    }

    let sentAt = null;
    let saveTimer = null;
    const save = () => {
      const values = {};
      let any = false;
      for (const control of kept()) {
        if (control.type === 'checkbox' || control.type === 'radio') {
          values[control.name] = control.checked === true;
          if (control.checked) any = true;
        } else {
          values[control.name] = String(control.value || '');
          if (values[control.name].trim()) any = true;
        }
      }
      try {
        if (any) store.setItem(name, JSON.stringify({ at: Date.now(), sent: sentAt, values }));
        else forget();
      } catch { /* a full or blocked store is not worth an error here */ }
    };
    const queue = () => {
      if (saveTimer) window.clearTimeout?.(saveTimer);
      saveTimer = window.setTimeout?.(() => { saveTimer = null; save(); }, 400);
    };
    form.addEventListener('input', queue);
    form.addEventListener('change', queue);
    // A sent brief is kept, not deleted: this page never learns whether it
    // arrived, and the answers are what the person would have to retype.
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      sentAt = Date.now();
      if (saveTimer) window.clearTimeout?.(saveTimer);
      saveTimer = null;
      save();
    });
  }

  return { generalLocationProblem, briefLocationProblem, guardDoubleSubmit, controlProblem, inlineValidation, keepDraft };
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
