/*
 * /waitlist: one form, one call. The answers go to rpc/join_waitlist (the product repository's
 * supabase/drafts/release-2/20260926102000_waitlist.sql, not yet released) with the public key and
 * nothing else: no third-party script, no cookie, no analytics. A backend without the function
 * (PostgREST PGRST202 / 404) says the waitlist opens soon and gives the email route instead.
 * The server answers joined (new or already listed: the same words, so the page never says whether
 * an address was on the list), busy (its hourly limit), or invalid. "Send me tips and offers" is a
 * separate, unticked choice (Spam Act): joining never depends on it.
 */
(function () {
  'use strict';

  var SUPPORT = 'yoda@yodalai.xyz';
  var BUSINESS = ['sales_agent', 'property_manager', 'buyers_agent', 'photographer', 'other'];
  var DEVICES = ['iphone_pro_lidar', 'ipad_pro_lidar', 'iphone_other', 'android', 'not_sure'];
  var CHANNELS = ['own_website', 'realestate_com_au', 'domain', 'social', 'client_deliverables', 'other'];
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
    if (!config || !config.url || !config.anonKey) return show(doc, 'error');
    show(doc, 'sending');
    return show(doc, await join(win.fetch.bind(win), config, answers));
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

  var api = { SUPPORT: SUPPORT, BUSINESS: BUSINESS, DEVICES: DEVICES, CHANNELS: CHANNELS, COPY: COPY,
    answersFrom: answersFrom, problem: problem, join: join, show: show, send: send, run: run };
  if (typeof window !== 'undefined') {
    window.VeyletWaitlist = api;
    if (!window.VEYLET_WAITLIST_MANUAL) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(window); });
      else run(window);
    }
  }
})();
