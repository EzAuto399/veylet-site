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
  function embedUrl(token) { return origin + '/embed?t=' + encodeURIComponent(token); }
  function embedCode(token) {
    return '<iframe src="' + embedUrl(token) +
      '" title="Explore this property in 3D" style="width:100%;aspect-ratio:16/9;min-height:320px;max-height:80vh;border:0" allow="fullscreen" loading="lazy" referrerpolicy="no-referrer"></iframe>' +
      '\n<p><a href="' + handoffUrl(token) + '" target="_blank" rel="noopener noreferrer">Open the property walkthrough in a new tab</a></p>';
  }
  /**
   * The on-page test embed is parsed out of the very code we hand over, so the
   * preview can never become a lookalike that behaves differently from the
   * paste. If they would differ, there is nothing to preview.
   */
  function embedFrame(token, doc) {
    const host = doc.createElement('div');
    host.innerHTML = embedCode(token);
    return host.querySelector('iframe');
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
   * The hosting line, in the words the app uses too. `row` is the walkthrough's
   * get_tour_hosting row (null when the dates could not load); `live` says its
   * link works now. A date passing switches nothing off, so these words only
   * describe the term; "ended" turns at the exact hosted_until instant.
   */
  const hostingExtensionAud = 49;
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
  function hostingLine(row, live, now = Date.now()) {
    if (!row || typeof row !== 'object') return live ? hostingUnavailable : '';
    const released = hostingDate(row.released_at);
    if (!live) return released ? 'Sharing is off. The link and embed show "not available".' : '';
    const until = hostingDate(row.hosted_until);
    if (!released || !until || typeof row.plan_active !== 'boolean') return hostingUnavailable;
    if (row.plan_active) return 'Live while your plan is active. Guaranteed until ' + until + '.';
    if (now < new Date(row.hosted_until).getTime()) return 'Live until ' + until + '. To keep it longer, extend hosting for A$' + hostingExtensionAud + ' a year.';
    return 'Guaranteed hosting ended ' + until + '. Contact Veylet support to extend it (A$' + hostingExtensionAud + ' a year).';
  }
  return { tokenFromLink, handoffUrl, embedUrl, embedCode, embedFrame, copy,
    builders, builder, savedBuilder, saveBuilder,
    hostingExtensionAud, hostingUnavailable, hostingDate, hostingLine };
})();
