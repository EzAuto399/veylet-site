/*
 * /waitlist: one form, one call. The answers go to rpc/join_waitlist (the product repository's
 * supabase/drafts/release-2/20260926102000_waitlist.sql, not yet released) with the public key and
 * the form answers only: no third-party script, no cookie. Optional website measurement is separate and
 * consent-controlled; it receives fixed outcome codes from the join_waitlist response only. A backend without the function
 * (PostgREST PGRST202 / 404), or a page without its configuration, sends the same answers once to the
 * owner's inbox through FormSubmit's JSON endpoint instead (owner decision, 29 September 2026, until the
 * release-2 waitlist is applied): no script, cookie or frame is loaded for it, and a sign-up that cannot
 * be delivered either way still gets the email route. The inbox route is not a measured conversion.
 * The server answers joined (new or already listed: the same words, so the page never says whether
 * an address was on the list), busy (its hourly limit), or invalid. The "tips and offers" box is a
 * separate, unticked choice (Spam Act): joining never depends on it. Its label is the consent wording
 * tips-v1 of the product repository's docs/lifecycle-email.md (never edited; a new wording is a new
 * version), and every join sends that version as p_consent_wording, ticked or not, so the server records
 * which words the choice was made on.
 * Attribution (owner, 29 September 2026): each sign-up carries the campaign labels of the link that
 * brought the visit (kept by /first-touch.js in session storage; else this page's own link), re-checked
 * here against the same shapes. Click identifiers (fbclid, gclid) are never read or sent, only whether
 * the click came from Meta or Google. The optional listings-volume answer matches the Meta lead form.
 */
(function () {
  'use strict';

  var SUPPORT = 'yoda@yodalai.xyz';
  // Used only while the database has no join_waitlist (see above); the same inbox the /request form uses.
  var INBOX_ENDPOINT = 'https://formsubmit.co/ajax/' + SUPPORT;
  var BUSINESS = ['sales_agent', 'property_manager', 'buyers_agent', 'photographer', 'other'];
  var DEVICES = ['iphone_pro_lidar', 'ipad_pro_lidar', 'iphone_other', 'android', 'not_sure'];
  var CHANNELS = ['own_website', 'realestate_com_au', 'domain', 'social', 'client_deliverables', 'other'];
  var VOLUMES = ['none', '1_2', '3_5', '6_plus', 'not_sure'];
  // The device answers that cannot capture: the success state says what capture needs.
  var VIEW_ONLY = ['iphone_other', 'android', 'not_sure'];
  var TOUCH_KEY = 'veylet.firstTouch';
  var LABELS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  var LABEL = /^[A-Za-z0-9._~+:-]{1,100}$/;
  var LANDING = /^\/(?!\/)[A-Za-z0-9\/_.-]{0,199}$/;
  var SHARE_URL = 'https://veylet.com/waitlist?utm_source=referral&utm_medium=share&utm_campaign=waitlist-thanks';
  // FormSubmit emails this to the address typed in the form (inbox route only). Transactional: no offer.
  // This page asks for it at most once per address and 3 times per browser tab session (see autoReply),
  // which stops accidental repeats; deliberate abuse of the public endpoint is left to FormSubmit's limits.
  var AUTORESPONSE = 'Thanks for joining the Veylet waitlist. We admit new accounts in weekly groups and will email ' +
    'you when your group opens. You\'re getting this because this address was entered at veylet.com/waitlist. ' +
    'If that wasn\'t you, or to leave the list, email ' + SUPPORT + '. Veylet Studio (Yo-Da Lai)';
  var REPLIES_KEY = 'veylet.waitlistReplies';
  var REPLIES_MAX = 3;
  var repliedThisPage = false; // used only when session storage is unavailable
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
    copied: 'Link copied.',
  };

  function text(value, max) {
    var clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : clean.slice(0, max);
  }

  function keep(pattern, value) { return typeof value === 'string' && pattern.test(value) ? value : ''; }

  /** A campaign touch in its allowed shapes only: anything else becomes ''. */
  function cleanTouch(raw) {
    var touch = {};
    LABELS.forEach(function (name) { touch[name] = keep(LABEL, raw[name]); });
    touch.click = raw.click === 'meta' || raw.click === 'google' ? raw.click : '';
    touch.landing = keep(LANDING, raw.landing);
    return touch;
  }

  /** A touch counts only when a label or the click source survived cleaning; a landing path alone does not. */
  function tagged(touch) {
    return Boolean(touch.click) || LABELS.some(function (name) { return Boolean(touch[name]); });
  }

  /** The visit's first touch from /first-touch.js, else this page's own campaign labels, else all ''. */
  function attribution(win) {
    try {
      var stored = JSON.parse(win.sessionStorage.getItem(TOUCH_KEY) || 'null');
      var kept = stored && typeof stored === 'object' ? cleanTouch(stored) : null;
      if (kept && tagged(kept)) return kept;
    } catch (unavailable) { /* no storage: this page's own link below */ }
    try {
      var query = new win.URLSearchParams(win.location.search);
      var raw = { click: query.get('fbclid') ? 'meta' : query.get('gclid') ? 'google' : '', landing: '/waitlist' };
      LABELS.forEach(function (name) { raw[name] = query.get(name); });
      var own = cleanTouch(raw);
      if (tagged(own)) return own;
    } catch (unreadable) { /* no labels */ }
    return cleanTouch({});
  }

  function orNull(value) { return value ? value : null; }

  /** The answers as the server takes them, from a FormData-like reader and the visit's attribution. */
  function answersFrom(data, touch) {
    var campaign = cleanTouch(touch || {});
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
      p_volume: orNull(String(data.get('volume') || '')),
      p_utm_source: orNull(campaign.utm_source),
      p_utm_medium: orNull(campaign.utm_medium),
      p_utm_campaign: orNull(campaign.utm_campaign),
      p_utm_content: orNull(campaign.utm_content),
      p_click: orNull(campaign.click),
      p_landing: orNull(campaign.landing),
    };
  }

  /** The first field the server would refuse, or ''. The page's own validation runs first. */
  function problem(answers) {
    if (!answers.p_name) return 'name';
    if (!EMAIL.test(answers.p_email)) return 'email';
    if (BUSINESS.indexOf(answers.p_business_type) === -1) return 'business_type';
    if (DEVICES.indexOf(answers.p_device) === -1) return 'device';
    if (!answers.p_region) return 'region';
    if (answers.p_volume && VOLUMES.indexOf(answers.p_volume) === -1) return 'volume';
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

  // A short non-reversible tag of the address (FNV-1a), so session storage never holds the address itself.
  function addressTag(email) {
    var address = String(email || '').toLowerCase();
    var hash = 0x811c9dc5;
    for (var i = 0; i < address.length; i++) { hash ^= address.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return ('0000000' + hash.toString(16)).slice(-8);
  }

  function repliesSent(win) {
    var list = JSON.parse(win.sessionStorage.getItem(REPLIES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  }

  /** Whether this inbox send may ask FormSubmit for the auto-reply: once per address, 3 per session. */
  function mayAutoReply(win, email) {
    try {
      var sent = repliesSent(win);
      return sent.indexOf(addressTag(email)) === -1 && sent.length < REPLIES_MAX;
    } catch (unavailable) { return !repliedThisPage; }
  }

  function noteAutoReply(win, email) {
    try {
      var sent = repliesSent(win);
      sent.push(addressTag(email));
      win.sessionStorage.setItem(REPLIES_KEY, JSON.stringify(sent));
    } catch (unavailable) { repliedThisPage = true; }
  }

  /** The answers as one plain message to the owner's inbox; 'joined' only when FormSubmit says it sent. */
  async function joinByInbox(fetchImpl, answers, win) {
    var reply = mayAutoReply(win, answers.p_email);
    try {
      var message = {
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
          volume: answers.p_volume || '',
          utm_source: answers.p_utm_source || '',
          utm_medium: answers.p_utm_medium || '',
          utm_campaign: answers.p_utm_campaign || '',
          utm_content: answers.p_utm_content || '',
          click: answers.p_click || '',
          landing: answers.p_landing || '',
          _replyto: answers.p_email,
      };
      // The owner's copy always goes; only the auto-reply to the typed address is capped.
      if (reply) message._autoresponse = AUTORESPONSE;
      var response = await fetchImpl(INBOX_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(message),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      var body = null;
      try { body = await response.json(); } catch (unreadable) { body = null; }
      var delivered = response.ok && body && String(body.success) === 'true';
      if (delivered && reply) noteAutoReply(win, answers.p_email);
      return delivered ? 'joined' : 'missing';
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

  function show(doc, state, answers) {
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
      var device = doc.getElementById('waitlist-done-device');
      if (device) device.hidden = !(answers && VIEW_ONLY.indexOf(answers.p_device) !== -1);
      var title = doc.getElementById('waitlist-done-title');
      if (title && title.focus) title.focus();
    }
    return state;
  }

  // Only fixed outcomes from this submission may leave the form. No answers or raw errors.
  function measureResult(win, state) {
    var errorCodes = { busy: 'busy', invalid: 'validation', missing: 'unavailable', error: 'network' };
    var name = state === 'joined' ? 'waitlist_submission_accepted' : 'form_error';
    var props = { form_id: 'waitlist' };
    if (state !== 'joined') {
      if (!Object.prototype.hasOwnProperty.call(errorCodes, state)) return;
      props.error_code = errorCodes[state];
    }
    try {
      if (win.VeyletAnalytics && typeof win.VeyletAnalytics.track === 'function') {
        win.VeyletAnalytics.track(name, props);
      }
    } catch (blocked) { /* optional measurement never interrupts joining or recovery */ }
  }

  async function send(win, form) {
    var doc = win.document;
    var data = new win.FormData(form);
    // A filled honeypot is a form-filling robot: it sees the same success and nothing is sent.
    if (String(data.get('_honey') || '').trim()) return show(doc, 'joined');
    var answers = answersFrom(data, attribution(win));
    if (problem(answers)) { measureResult(win, 'invalid'); return show(doc, 'invalid'); }
    var config = win.VEYLET_SUPABASE;
    show(doc, 'sending');
    var rpc = config && config.url && config.anonKey ? await join(win.fetch.bind(win), config, answers) : null;
    var state = rpc === null || rpc === 'missing' ? await joinByInbox(win.fetch.bind(win), answers, win) : rpc;
    // Only the join_waitlist response is a receipt. The honeypot, DOM success and the FormSubmit inbox
    // route are not; an unavailable RPC is reported only when the inbox route could not take it either.
    // The measurement module enforces consent.
    if (rpc !== null && (rpc !== 'missing' || state === 'missing')) measureResult(win, state);
    return show(doc, state, answers);
  }

  /** Clears the live region, then writes in a later task, so a repeated identical message is announced again. */
  function say(win, note, words) {
    if (!note) return Promise.resolve();
    note.textContent = '';
    if (typeof win.setTimeout !== 'function') { note.textContent = words; return Promise.resolve(); }
    return new Promise(function (resolve) { win.setTimeout(function () { note.textContent = words; resolve(); }, 50); });
  }

  /** Share sheet, else copy the link, else show it to copy by hand. A dismissed share sheet does nothing. */
  async function share(win) {
    var doc = win.document;
    var nav = win.navigator || {};
    var note = doc.getElementById('waitlist-share-status');
    if (note) note.textContent = '';
    if (typeof nav.share === 'function') {
      try { await nav.share({ url: SHARE_URL }); return 'shared'; } catch (failure) {
        if (failure && failure.name === 'AbortError') return 'cancelled';
      }
    }
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      var copied = true;
      try { await nav.clipboard.writeText(SHARE_URL); } catch (blocked) { copied = false; }
      if (copied) { await say(win, note, COPY.copied); return 'copied'; }
    }
    await say(win, note, SHARE_URL);
    return 'shown';
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
    var shareButton = doc.getElementById('waitlist-share');
    if (shareButton) shareButton.addEventListener('click', function () { share(win); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy) return;
      var where = place && place.briefLocationProblem && region ? place.briefLocationProblem(region.value) : '';
      if (where) { measureResult(win, 'invalid'); status.textContent = where; if (region.focus) region.focus(); return; }
      busy = true;
      try { await send(win, form); } finally { busy = false; }
    });
    return form;
  }

  var api = { SUPPORT: SUPPORT, BUSINESS: BUSINESS, DEVICES: DEVICES, CHANNELS: CHANNELS, VOLUMES: VOLUMES, COPY: COPY, TIPS: TIPS,
    INBOX_ENDPOINT: INBOX_ENDPOINT, AUTORESPONSE: AUTORESPONSE, REPLIES_KEY: REPLIES_KEY, SHARE_URL: SHARE_URL, TOUCH_KEY: TOUCH_KEY,
    answersFrom: answersFrom, attribution: attribution, problem: problem, join: join, joinByInbox: joinByInbox,
    show: show, send: send, share: share, run: run };
  if (typeof window !== 'undefined') {
    window.VeyletWaitlist = api;
    if (!window.VEYLET_WAITLIST_MANUAL) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(window); });
      else run(window);
    }
  }
})();
