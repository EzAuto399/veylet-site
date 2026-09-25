/*
 * /report?t=TOKEN: "Report this walkthrough" from the foot of /handoff, /tour and the embed's
 * invitation panel (launch plan C2.3). The token is taken out of the address bar at once and kept
 * only in memory. One call, rpc/report_walkthrough (the product repository's
 * supabase/drafts/release-2/20260926103000_walkthrough_reports.sql, not yet released), answers
 * received whether or not the token belongs to a walkthrough, so this page never says whether it
 * exists; busy is the hourly limit. Without the function (PostgREST PGRST202 / 404), or when the
 * call fails, the page offers an email to support carrying a SHA-256 reference of the token, never
 * the token itself (a report must not become a way to pass the link on).
 */
(function () {
  'use strict';

  var SUPPORT = 'yoda@yodalai.xyz';
  var REASONS = { privacy: 'Privacy', misleading: 'Not this property, or misleading', offensive: 'Offensive or illegal', other: 'Something else' };
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

  var COPY = {
    sending: 'Sending your report…',
    received: 'Thanks. We’ll review this within 24 hours for privacy reports.',
    chooseReason: 'Choose what is wrong before sending.',
    incomplete: 'This report link is incomplete. Email ' + SUPPORT + ' with what you saw and the address of the page you saw it on.',
    missing: 'Online reports aren’t open yet. Email your report to ' + SUPPORT + '; the button below writes it for you with a reference to this walkthrough (not its link).',
    busy: 'We can’t take more reports online just now, so nothing was sent. Email your report to ' + SUPPORT + '; the button below writes it for you.',
    error: 'Your report didn’t send, so nothing was saved. Try again, or email it to ' + SUPPORT + '; the button below writes it for you.',
    invalid: 'One answer wasn’t accepted, so nothing was sent. Check the email address, or leave it empty, and send again.',
  };

  function readToken(search) {
    var match = /(?:^|[?&])t=([^&#]*)/.exec(search || '');
    if (!match) return null;
    var token;
    try { token = decodeURIComponent(match[1]); } catch (bad) { return null; }
    return TOKEN.test(token) ? token : null;
  }

  function clean(value, max) {
    var text = String(value == null ? '' : value).trim();
    return text.length <= max ? text : text.slice(0, max);
  }

  /** The report as the server takes it. Empty optional answers are sent as null. */
  function reportFrom(data, token) {
    var reason = String(data.get('reason') || '');
    var details = clean(data.get('details'), 2000);
    var email = clean(data.get('email'), 254);
    return { p_token: token, p_reason: reason, p_details: details || null, p_email: email || null };
  }

  function problem(report) {
    if (!Object.prototype.hasOwnProperty.call(REASONS, report.p_reason)) return 'reason';
    if (report.p_email && !EMAIL.test(report.p_email)) return 'email';
    return '';
  }

  async function sha256Hex(win, value) {
    try {
      var digest = await win.crypto.subtle.digest('SHA-256', new win.TextEncoder().encode(value));
      return Array.prototype.map.call(new Uint8Array(digest), function (byte) { return ('0' + byte.toString(16)).slice(-2); }).join('');
    } catch (unavailable) {
      return '';
    }
  }

  /** An email the reporter sends themselves: the reason, their words, and the token's hash only. */
  function mailtoHref(reference, report) {
    var lines = ['Report a walkthrough', ''];
    if (reference) lines.push('Walkthrough reference (SHA-256): ' + reference);
    if (report && REASONS[report.p_reason]) lines.push('What is wrong: ' + REASONS[report.p_reason]);
    if (report && report.p_details) lines.push('', report.p_details);
    return 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Report a walkthrough') +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  async function send(fetchImpl, config, report) {
    try {
      var response = await fetchImpl(config.url + '/rest/v1/rpc/report_walkthrough', {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: 'Bearer ' + config.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      var body = null;
      try { body = await response.json(); } catch (unreadable) { body = null; }
      if (response.status === 404 || (body && body.code === 'PGRST202')) return 'missing';
      if (!response.ok) return 'error';
      var state = body && body.state;
      return state === 'received' || state === 'busy' || state === 'invalid' ? state : 'error';
    } catch (failure) {
      return 'error';
    }
  }

  function show(doc, state, mailHref) {
    var form = doc.getElementById('report-form');
    var status = doc.getElementById('report-status');
    var fallback = doc.getElementById('report-fallback');
    var done = doc.getElementById('report-done');
    var submit = doc.getElementById('report-submit');
    var mail = doc.getElementById('report-mail');
    if (submit) submit.disabled = state === 'sending';
    status.textContent = state === 'sending' ? COPY.sending : state === 'invalid' ? COPY.invalid : '';
    var offerMail = state === 'missing' || state === 'busy' || state === 'error' || state === 'incomplete';
    fallback.hidden = !offerMail;
    doc.getElementById('report-fallback-text').textContent = offerMail ? COPY[state] : '';
    if (mail && mailHref) mail.setAttribute('href', mailHref);
    if (state === 'incomplete') form.hidden = true;
    if (state === 'received') {
      form.hidden = true;
      done.hidden = false;
      var title = doc.getElementById('report-done-title');
      if (title && title.focus) title.focus();
    }
    return state;
  }

  function run(win) {
    var doc = win.document;
    var token = readToken(win.location.search);
    // The token opens the walkthrough: keep it out of history, screenshots and shared addresses.
    if (win.history && typeof win.history.replaceState === 'function') win.history.replaceState(null, '', win.location.pathname);
    var form = doc.getElementById('report-form');
    if (!form) return Promise.resolve(null);
    if (!token) return Promise.resolve(show(doc, 'incomplete', mailtoHref('', null)));
    form.hidden = false;
    var status = doc.getElementById('report-status');
    var reasonProblem = doc.getElementById('report-reason-problem');
    var place = win.VeyletPlace;
    if (place && place.inlineValidation) place.inlineValidation(form, status);
    var reference = sha256Hex(win, token);
    var busy = false;
    form.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'reason' && reasonProblem) reasonProblem.textContent = '';
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy) return;
      var data = new win.FormData(form);
      var report = reportFrom(data, token);
      // A filled honeypot is a form-filling robot: it sees the same thanks and nothing is sent.
      if (String(data.get('_honey') || '').trim()) { show(doc, 'received'); return; }
      var wrong = problem(report);
      if (wrong === 'reason') {
        if (reasonProblem) reasonProblem.textContent = COPY.chooseReason;
        var first = form.querySelector ? form.querySelector('[name="reason"]') : null;
        if (first && first.focus) first.focus();
        return;
      }
      if (wrong) { show(doc, 'invalid'); return; }
      var config = win.VEYLET_SUPABASE;
      busy = true;
      try {
        show(doc, 'sending');
        var state = config && config.url && config.anonKey ? await send(win.fetch.bind(win), config, report) : 'error';
        show(doc, state, state === 'received' || state === 'invalid' ? null : mailtoHref(await reference, report));
      } finally {
        busy = false;
      }
    });
    return reference.then(function (hash) { var mail = doc.getElementById('report-mail'); if (mail) mail.setAttribute('href', mailtoHref(hash, null)); return 'ready'; });
  }

  var api = { SUPPORT: SUPPORT, REASONS: REASONS, COPY: COPY, readToken: readToken, reportFrom: reportFrom,
    problem: problem, sha256Hex: sha256Hex, mailtoHref: mailtoHref, send: send, show: show, run: run };
  if (typeof window !== 'undefined') {
    window.VeyletReport = api;
    if (!window.VEYLET_REPORT_MANUAL) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(window); });
      else run(window);
    }
  }
})();
