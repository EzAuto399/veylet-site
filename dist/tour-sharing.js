'use strict';
/* One implementation for the desk and the public website handoff guide. */
window.VeyletSharing = (() => {
  const origin = 'https://veylet.com';
  function tokenFromLink(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { return null; }
    if (url.origin !== origin || !/^\/(handoff|embed)\/?$/.test(url.pathname)) return null;
    const token = url.searchParams.get('t');
    return token && /^[A-Za-z0-9_-]{16,256}$/.test(token) ? token : null;
  }
  function handoffUrl(token) { return origin + '/handoff?t=' + encodeURIComponent(token); }
  function embedUrl(token, opts) {
    const base = origin + '/embed?t=' + encodeURIComponent(token);
    return opts && opts.theme === 'paper' ? base + '&theme=paper' : base;
  }
  function portalUrl(token) { return origin + '/tour?t=' + encodeURIComponent(token); }
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/;
  function validToken(token) {
    return typeof token === 'string' && TOKEN_RE.test(token);
  }
  function embedCode(token, opts) {
    if (!validToken(token)) return '';
    return '<iframe src="' + embedUrl(token, opts) +
      '" title="Explore this property in 3D" style="width:100%;aspect-ratio:16/9;min-height:320px;max-height:80vh;border:0" allow="fullscreen; xr-spatial-tracking" loading="lazy" referrerpolicy="strict-origin"></iframe>' +
      '\n<p><a href="' + handoffUrl(token) + '" target="_blank" rel="noopener noreferrer">Open the property walkthrough in a new tab</a></p>';
  }
  /**
   * The on-page test embed is parsed out of the very code we hand over, so the
   * preview can never become a lookalike that behaves differently from the
   * paste. If they would differ, there is nothing to preview.
   */
  function embedFrame(token, doc, opts) {
    if (!validToken(token) || !doc || typeof doc.createElement !== 'function') return null;
    const host = doc.createElement('div');
    host.innerHTML = embedCode(token, opts);
    return host.querySelector('iframe');
  }
  function modalButtonCode(token, label = 'Explore in 3D', opts) {
    const text = typeof label === 'string' && label.trim() ? label.trim() : 'Explore in 3D';
    const themeAttr = opts && opts.theme === 'paper' ? ' data-veylet-theme="paper"' : '';
    return '<a href="' + handoffUrl(token) + '" data-veylet-modal' + themeAttr + '>' + escapeHtml(text) + '</a>\n' +
      '<script src="' + origin + '/embed.js" async></script>';
  }
  function developerBrief(token) {
    return [
      'Veylet 3D Walkthrough — Website & Listing Feed Integration Brief',
      '',
      '1. Australian Agency Websites & REA XML Feeds (Stepps, Agentpoint, WebIT, Propps)',
      'Map the CRM / REA XML Virtual Tour URL field (Rex, VaultRE, Agentbox, PropertyMe) to the unbranded walkthrough-only link:',
      portalUrl(token),
      'This route has no agent card or external links and works across portals and agency templates.',
      '',
      '2. Turnkey Modal Button (zero layout shift on listing pages)',
      modalButtonCode(token),
      'Clicking opens a full-viewport 3D overlay; modified clicks and browsers without JavaScript fall back directly to ' + handoffUrl(token),
      '',
      '3. Inline Responsive Iframe (and Light Paper Theme)',
      embedCode(token),
      'For light listing pages, use ?theme=paper on the iframe URL:',
      embedUrl(token, { theme: 'paper' }),
      '',
      '4. Content Security Policy (CSP)',
      'If your site enforces a strict CSP header, allow:',
      'frame-src https://veylet.com; script-src https://veylet.com',
    ].join('\n');
  }
  async function copy(value, field, status, message) {
    if (field) { field.value = value; field.hidden = false; }
    try {
      await navigator.clipboard.writeText(value);
      if (status) status.textContent = message;
    } catch {
      if (field) { field.focus(); field.select(); }
      if (status) status.textContent = 'Select and copy the text below. Your browser did not allow automatic copying.';
    }
  }

  /*
   * Where to paste the code, per website builder. Every step is a sentence from
   * /website-guide, word for word (tests/tour-sharing.test.cjs checks), so the
   * desk and the guide can never give different instructions.
   */
  const testPublished = 'Open the page signed out on desktop and phone, including a cellular connection.';
  const builders = Object.freeze([
    { id: 'wordpress', name: 'WordPress', steps: [
      'In the block editor add a Custom HTML block, paste the embed code, then Preview and Update.',
      'Some page-builder plugins and security plugins strip iframes for non-administrator roles; if the player does not appear after publishing, an administrator must add the block.',
      testPublished] },
    { id: 'squarespace', name: 'Squarespace', steps: [
      'Add a Code block (not a Markdown block), paste the embed code, keep “Display source” off and save.',
      'Code blocks need a Business or Commerce plan; Personal plans do not include them.',
      'The editor shows a placeholder rather than the player, which is normal — judge it on the published page.'] },
    { id: 'wix', name: 'Wix', steps: [
      'Add Embed → Embed HTML (the HTML iframe element), choose Code, paste the embed code and apply.',
      'Make the element at least 320 pixels tall.',
      'A shorter element cuts off the “Explore in 3D” button, and a visitor cannot start the tour at all.'] },
    { id: 'webflow', name: 'Webflow', steps: [
      'Drag an Embed element into the page, paste the embed code and publish.',
      'Embeds render only on the published site, not in the designer canvas.',
      testPublished] },
    { id: 'other', name: 'Other HTML', steps: [
      'Ask your developer for a custom HTML or raw HTML region on the listing template and paste the code there.',
      'Use the included direct link if the website builder removes iframe code.',
      testPublished] },
  ].map(item => Object.freeze({ ...item, steps: Object.freeze(item.steps) })));
  function builder(id) { return builders.find(item => item.id === id) || builders[0]; }
  // A per-browser convenience only: a private window or blocked storage just
  // opens on the first builder again.
  const builderKey = 'veylet-website-builder';
  function savedBuilder() {
    try { return builder(window.localStorage.getItem(builderKey)).id; } catch { return builders[0].id; }
  }
  function saveBuilder(id) {
    try { window.localStorage.setItem(builderKey, builder(id).id); } catch { /* nothing to keep */ }
  }

  /*
   * Australian real-estate CRM and portal field hints for the unbranded /tour link,
   * plus one-tap buyer follow-up SMS/WhatsApp templates using the client handoff link.
   */
  const crms = Object.freeze([
    { id: 'rex', name: 'Rex', hint: 'Rex: open Listing → Marketing → Virtual Tour URL, paste the link and save.' },
    { id: 'vaultre', name: 'VaultRE', hint: 'VaultRE: open Property → Marketing / Links → Virtual Tour / 3D Link and paste.' },
    { id: 'agentbox', name: 'Agentbox', hint: 'Agentbox: open Listing → Marketing → External / Virtual Tour Link and paste.' },
    { id: 'propertyme', name: 'PropertyMe', hint: 'PropertyMe: open Property → Rental Listing → Virtual Tour Link and paste.' },
    { id: 'domain', name: 'Domain Agent Admin', hint: 'Domain: open Listing Overview → Virtual Tour field (max 255 characters) and paste.' },
    { id: 'other', name: 'Other CRM or portal', hint: 'Paste into your CRM’s virtual tour URL field (never an HTML embed box). Portals decide whether they display it.' },
  ].map(item => Object.freeze({ ...item })));
  function crm(id) { return crms.find(item => item.id === id) || crms[0]; }
  const crmKey = 'veylet-portal-crm';
  function savedCrm() {
    try { return crm(window.localStorage.getItem(crmKey)).id; } catch { return crms[0].id; }
  }
  function saveCrm(id) {
    try { window.localStorage.setItem(crmKey, crm(id).id); } catch { /* nothing to keep */ }
  }
  function buyerMessages(title, token) {
    const cleanTitle = typeof title === 'string' && title.replace(/\s+/g, ' ').trim()
      ? title.replace(/\s+/g, ' ').trim().slice(0, 120)
      : 'this space';
    const link = handoffUrl(token) + '&src=link';
    return {
      afterInspection: 'Thanks for inspecting ' + cleanTitle + ' — look back through each room on your phone here: ' + link,
      beforeVisit: 'Look around ' + cleanTitle + ' in 3D on your phone before you visit (no app needed): ' + link,
    };
  }
  function appraisalPreviewUrl(contact = {}) {
    const url = new URL(origin + '/handoff');
    url.searchParams.set('sample', '1');
    const cleanField = (val, max) => (typeof val === 'string' ? val.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const name = cleanField(contact.display_name ?? contact.name, 80);
    const agency = cleanField(contact.agency, 80);
    const phone = cleanField(contact.phone, 32);
    const email = cleanField(contact.email, 254);
    if (name) url.searchParams.set('name', name);
    if (agency) url.searchParams.set('agency', agency);
    if (phone && /^[0-9 +()-]+$/.test(phone) && /[0-9]/.test(phone)) url.searchParams.set('phone', phone);
    if (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) url.searchParams.set('email', email);
    return url.toString();
  }

  /*
   * The hosting line, in the words the app uses too (owner decision 26 September
   * 2026). A walkthrough is live while the office has an active plan (free
   * months, monthly or yearly). When the plan ends, its link, embed and QR code
   * keep working for 14 days, then go offline; nothing is deleted or revoked, and
   * restarting the plan brings the same link back at once.
   *
   * `row` is the walkthrough's get_tour_hosting row (null when it could not load);
   * `live` says its link is shared. The member hosting read
   * (get_tour_hosting_states' state live_with_plan | live_with_extension |
   * offline_on | offline | live_not_enforced, with offline_at and extended_until;
   * the desk puts it on the row as hosting_state, offline_on and extended_until)
   * is used when the row carries it. live_with_extension (offer 2026-09-26.2): no
   * plan, and a paid hosting extension keeps this one walkthrough online until
   * it ends. Only the read says so; the derived state never guesses it; until then the state is derived from plan_active and the day the
   * plan ended (the row's plan_ended_at, else `opts.planEndedAt`, which the desk
   * reads from its plan panel). `opts.app`: the pages the app opens name no
   * purchase path, so the fix reads "Restart your plan in the app", and they
   * never name the hosting extension: an extended walkthrough reads "Online until
   * {date}." there.
   */
  const hostingGraceDays = 14;
  const HOSTING_STATES = ['live_with_plan', 'live_with_extension', 'offline_on', 'offline'];
  // Enforcement switched off on the server: served whatever the plan, so it reads as live.
  const HOSTING_ALIASES = { live_not_enforced: 'live_with_plan' };
  const hostingUnavailable = 'Hosting dates could not load. Refresh to check.';
  // Dates are the studio's day in Brisbane (as in the app), with a fixed month
  // list so a browser's locale data ("Sept") cannot change the words.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let brisbane = null;
  function hostingDate(value) {
    if (!value) return '';
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return '';
    try {
      brisbane = brisbane || new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', day: 'numeric', month: 'numeric', year: 'numeric' });
      const parts = {};
      for (const part of brisbane.formatToParts(when)) parts[part.type] = part.value;
      return Number(parts.day) + ' ' + months[Number(parts.month) - 1] + ' ' + Number(parts.year);
    } catch {
      // Brisbane keeps UTC+10 all year, so a browser without zone data agrees.
      const local = new Date(when.getTime() + 10 * 3600000);
      return local.getUTCDate() + ' ' + months[local.getUTCMonth()] + ' ' + local.getUTCFullYear();
    }
  }
  function hostingInstant(value) {
    if (typeof value !== 'string' || !value) return null;
    const at = Date.parse(value);
    return Number.isNaN(at) ? null : at;
  }
  // { state, date } in the member hosting read's words, or null when neither the
  // read nor the plan state can say. `date` is the offline day (ISO; for
  // live_with_extension, the day the extension ends), or null when it is unknown.
  function hostingState(row, now = Date.now(), planEndedAt = null) {
    if (!row || typeof row !== 'object') return null;
    const read = HOSTING_ALIASES[row.hosting_state] || row.hosting_state;
    if (HOSTING_STATES.includes(read)) {
      const day = read === 'live_with_extension'
        ? hostingInstant(row.extended_until) ?? hostingInstant(row.offline_on) ?? hostingInstant(row.offline_at)
        : hostingInstant(row.offline_on) ?? hostingInstant(row.offline_at);
      return { state: read, date: read === 'live_with_plan' || day === null ? null : new Date(day).toISOString() };
    }
    if (typeof row.plan_active !== 'boolean') return null;
    if (row.plan_active) return { state: 'live_with_plan', date: null };
    const ended = hostingInstant(row.plan_ended_at) ?? hostingInstant(planEndedAt);
    if (ended === null) return { state: 'offline_on', date: null };
    const offline = ended + hostingGraceDays * 86400000;
    return { state: now < offline ? 'offline_on' : 'offline', date: new Date(offline).toISOString() };
  }
  function restartWords(opts) { return opts && opts.app ? 'Restart your plan in the app' : 'Restart your plan'; }
  // The desk's line for the whole office once the plan has ended (n live walkthroughs).
  function planEndedLine(count, date, opts = {}) {
    const day = hostingDate(date);
    if (!day || !Number.isInteger(count) || count < 1) return 'Your plan has ended. ' + restartWords(opts) + ' to keep your walkthroughs live.';
    return 'Your plan has ended. ' + (count === 1 ? '1 live walkthrough goes' : count + ' live walkthroughs go') + ' offline on ' + day + '. '
      + restartWords(opts) + ' to keep ' + (count === 1 ? 'it' : 'them') + ' live.';
  }
  function hostingLine(row, live, now = Date.now(), opts = {}) {
    if (!row || typeof row !== 'object') return live ? hostingUnavailable : '';
    const released = hostingDate(row.released_at);
    if (!live) return released ? 'Sharing is off. The link and embed show "not available".' : '';
    const hosting = released ? hostingState(row, now, opts.planEndedAt) : null;
    if (!hosting) return hostingUnavailable;
    const day = hostingDate(hosting.date);
    // `opts.office`: the office's name when the reader belongs to more than one, so each line
    // says whose plan it is ("Harbour Realty's plan has ended.").
    const whose = typeof opts.office === 'string' && opts.office.trim() ? opts.office.trim() + '’s plan' : 'your plan';
    const Whose = whose.charAt(0).toUpperCase() + whose.slice(1);
    if (hosting.state === 'live_with_plan') return 'Live while ' + whose + ' is active.';
    if (hosting.state === 'live_with_extension') {
      if (!day) return hostingUnavailable;
      return opts.app ? 'Online until ' + day + '.' : 'Live until ' + day + ' with a hosting extension.';
    }
    if (hosting.state === 'offline_on') {
      return Whose + ' has ended. ' + (day ? 'This walkthrough goes offline on ' + day + '. ' : '') + restartWords(opts) + ' to keep it live.';
    }
    return (day ? 'Offline since ' + day + '. ' : 'Offline. ') + restartWords(opts) + ' and this link works again \u2014 same link, embed and QR.';
  }
  return { tokenFromLink, handoffUrl, embedUrl, portalUrl, embedCode, embedFrame, modalButtonCode, developerBrief, copy,
    builders, builder, savedBuilder, saveBuilder,
    crms, crm, savedCrm, saveCrm, buyerMessages, appraisalPreviewUrl,
    hostingGraceDays, hostingUnavailable, hostingDate, hostingState, planEndedLine, hostingLine };
})();
