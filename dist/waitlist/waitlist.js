/*
 * /waitlist: one form, one call. The answers go to rpc/join_waitlist (the product repository's
 * supabase/drafts/release-2/20260926102000_waitlist.sql, not yet released) with the public key and
 * nothing else: no third-party script, no cookie, no analytics. A backend without the function
 * (PostgREST PGRST202 / 404), or a page without its configuration, sends the same answers once to the
 * owner's inbox through FormSubmit's JSON endpoint instead (owner decision, 29 September 2026, until the
 * release-2 waitlist is applied): no script, cookie or frame is loaded for it, and a sign-up that cannot
 * be delivered either way still gets the email route.
 * The server answers joined (new or already listed: the same words, so the page never says whether
 * an address was on the list), busy (its hourly limit), or invalid. The "tips and offers" box is a
 * separate, unticked choice (Spam Act): joining never depends on it. Its label is the consent wording
 * tips-v1 of the product repository's docs/lifecycle-email.md (never edited; a new wording is a new
 * version), and every join sends that version as p_consent_wording, ticked or not, so the server records
 * which words the choice was made on.
 */
(function () {
  'use strict';

  var SUPPORT = 'yoda@yodalai.xyz';
  // Used only while the database has no join_waitlist (see above); the same inbox the /request form uses.
  var INBOX_ENDPOINT = 'https://formsubmit.co/ajax/' + SUPPORT;
  var BUSINESS = ['sales_agent', 'property_manager', 'buyers_agent', 'photographer', 'other'];
  var DEVICES = ['iphone_pro_lidar', 'ipad_pro_lidar', 'iphone_other', 'android', 'not_sure'];
  var CHANNELS = ['own_website', 'realestate_com_au', 'domain', 'social', 'client_deliverables', 'other'];
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var TIPS = { version: 'tips-v1', wording: 'Email me tips and offers from Veylet Studio. I can unsubscribe at any time.' };

  var COPY = {
    sending: 'Adding you to the list…',
    joinedTitle: 'You’re on the list.',
    joined: 'We admit new accounts in weekly groups and will email you when it’s your turn.',
    missing: 'The waitlist opens soon. Email ' + SUPPORT + ' to be added.',
    busy: 'The waitlist is busy right now, so nothing was saved. Try again in an hour, or email ' + SUPPORT + ' to be added.',
    error: 'We couldn’t add you just now, so nothing was saved. Try again in a minute, or email ' + SUPPORT + ' to be added.',
    invalid: 'One answer wasn’t accepted, so nothing was saved. Check your email address and the other answers, then send again.',
  };

  function text(value, max) {
    var clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : clean.slice(0, max);
  }

  /** The answers as the server takes them, from a FormData-like reader. */
  function answersFrom(data) {
    var channels = (data.getAll ? data.getAll('channels') : []).map(String)
      .filter(function (value, index, all) { return CHANNELS.indexOf(value) !== -1 && all.indexOf(value) === index; });
    return {
      p_name: text(data.get('name'), 120),
      p_email: text(data.get('email'), 254),
      p_business_type: String(data.get('business_type') || ''),
      p_device: String(data.get('device') || ''),
      p_region: text(data.get('region'), 120),
      p_channels: channels,
      p_consent_tips: data.get('consent_tips') === 'yes',
      p_consent_wording: TIPS.version,
    };
  }

  /** The first field the server would refuse, or ''. The page's own validation runs first. */
  function problem(answers) {
    if (!answers.p_name) return 'name';
    if (!EMAIL.test(answers.p_email)) return 'email';
    if (BUSINESS.indexOf(answers.p_business_type) === -1) return 'business_type';
    if (DEVICES.indexOf(answers.p_device) === -1) return 'device';
    if (!answers.p_region) return 'region';
    return '';
  }

  async function join(fetchImpl, config, answers) {
    try {
      var response = await fetchImpl(config.url + '/rest/v1/rpc/join_waitlist', {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: 'Bearer ' + config.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(answers),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      var body = null;
      try { body = await response.json(); } catch (unreadable) { body = null; }
      if (response.status === 404 || (body && body.code === 'PGRST202')) return 'missing';
      if (!response.ok) return 'error';
      var state = body && body.state;
      return state === 'joined' || state === 'busy' || state === 'invalid' ? state : 'error';
    } catch (failure) {
      return 'error';
    }
  }

  /** The answers as one plain message to the owner's inbox; 'joined' only when FormSubmit says it sent. */
  async function joinByInbox(fetchImpl, answers) {
    try {
      var response = await fetchImpl(INBOX_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: 'Veylet waitlist',
          _template: 'table',
          _captcha: 'false',
          name: answers.p_name,
          email: answers.p_email,
          business: answers.p_business_type,
          device: answers.p_device,
          region: answers.p_region,
          channels: answers.p_channels.join(', '),
          tips_and_offers: answers.p_consent_tips ? 'yes' : 'no',
          consent_wording: answers.p_consent_wording,
        }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      var body = null;
      try { body = await response.json(); } catch (unreadable) { body = null; }
      return response.ok && body && String(body.success) === 'true' ? 'joined' : 'missing';
    } catch (failure) {
      return 'missing';
    }
  }

  function mailLink(doc) {
    var link = doc.createElement('a');
    link.setAttribute('href', 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Veylet waitlist'));
    link.textContent = SUPPORT;
    return link;
  }

  /** Writes a sentence that names the support address, with the address as a mail link. */
  function sayWithMail(doc, el, sentence) {
    var at = sentence.indexOf(SUPPORT);
    el.textContent = sentence.slice(0, at);
    el.append(mailLink(doc), sentence.slice(at + SUPPORT.length));
  }

  function show(doc, state) {
    var form = doc.getElementById('waitlist-form');
    var status = doc.getElementById('waitlist-status');
    var fallback = doc.getElementById('waitlist-fallback');
    var done = doc.getElementById('waitlist-done');
    var submit = doc.getElementById('waitlist-submit');
    if (submit) submit.disabled = state === 'sending';
    status.textContent = state === 'sending' ? COPY.sending : state === 'invalid' ? COPY.invalid : '';
    fallback.hidden = !(state === 'missing' || state === 'busy' || state === 'error');
    if (!fallback.hidden) sayWithMail(doc, fallback, COPY[state]);
    else fallback.textContent = '';
    if (state === 'joined') {
      form.hidden = true;
      done.hidden = false;
      var title = doc.getElementById('waitlist-done-title');
      if (title && title.focus) title.focus();
    }
    return state;
  }

  async function send(win, form) {
    var doc = win.document;
    var data = new win.FormData(form);
    // A filled honeypot is a form-filling robot: it sees the same success and nothing is sent.
    if (String(data.get('_honey') || '').trim()) return show(doc, 'joined');
    var answers = answersFrom(data);
    if (problem(answers)) return show(doc, 'invalid');
    var config = win.VEYLET_SUPABASE;
    show(doc, 'sending');
    var state = config && config.url && config.anonKey ? await join(win.fetch.bind(win), config, answers) : 'missing';
    if (state === 'missing') state = await joinByInbox(win.fetch.bind(win), answers);
    return show(doc, state);
  }

  function run(win) {
    var doc = win.document;
    var form = doc.getElementById('waitlist-form');
    if (!form) return null;
    var status = doc.getElementById('waitlist-status');
    var place = win.VeyletPlace;
    // Problems beside their fields first (the site's form pattern); a send only when none are left.
    if (place && place.inlineValidation) place.inlineValidation(form, status);
    var region = form.querySelector ? form.querySelector('[name="region"]') : null;
    var busy = false;
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy) return;
      var where = place && place.briefLocationProblem && region ? place.briefLocationProblem(region.value) : '';
      if (where) { status.textContent = where; if (region.focus) region.focus(); return; }
      busy = true;
      try { await send(win, form); } finally { busy = false; }
    });
    return form;
  }

  var api = { SUPPORT: SUPPORT, BUSINESS: BUSINESS, DEVICES: DEVICES, CHANNELS: CHANNELS, COPY: COPY, TIPS: TIPS,
    INBOX_ENDPOINT: INBOX_ENDPOINT, answersFrom: answersFrom, problem: problem, join: join, joinByInbox: joinByInbox,
    show: show, send: send, run: run };
  if (typeof window !== 'undefined') {
    window.VeyletWaitlist = api;
    if (!window.VEYLET_WAITLIST_MANUAL) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(window); });
      else run(window);
    }
  }
})();
