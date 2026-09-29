/* Optional measurement on a small public-page allowlist. No automatic form collection. */
(() => {
  'use strict';
  if (window.VeyletAnalytics) return;
  const config = window.VEYLET_ANALYTICS_CONFIG || {};
  const CHOICE = 'veylet:measurement-choice:v1';
  const ACCEPTED = 'veylet:waitlist-accepted:v1';
  const DENY = 'veylet:measurement-denied:v1';
  const DAY = 86400000;
  const TITLES = Object.freeze({ '/': 'Veylet', '/start': 'Get started | Veylet', '/see': 'See a walkthrough | Veylet',
    '/offer': 'Plans | Veylet', '/waitlist': 'Join the waitlist | Veylet', '/request': 'Enquire | Veylet',
    '/privacy': 'Privacy | Veylet' });
  const FORMS = ['waitlist', 'request'];
  const DESTINATIONS = ['waitlist', 'request', 'see', 'offer', 'start'];
  const PLACEMENTS = ['header', 'hero', 'body', 'footer', 'form', 'sticky'];
  const ERRORS = ['validation', 'network', 'unavailable', 'busy', 'unknown'];
  const REFERRAL_HOSTS = ['facebook.com', 'www.facebook.com', 'l.facebook.com', 'm.facebook.com',
    'instagram.com', 'www.instagram.com', 'l.instagram.com', 'google.com', 'www.google.com'];
  const ANCHORS = Object.freeze({ '/': ['main', 'top', 'process'], '/start': ['main', 'first-session'],
    '/offer': ['main', 'answers-title', 'counts-title', 'how-title', 'services-title', 'ways-title'],
    '/see': ['main', 'offer'], '/waitlist': ['main'], '/request': ['main'], '/privacy': ['main'] });
  const rejected = () => ({ analytics: false, ads: false });
  let choice = rejected(), storageReady = false, stopping = false;
  let gaLoaded = false, metaLoaded = false, gaPage = false, metaPage = false;
  let expiryTimer, campaign = {};
  let panel, customize, analyticsInput, adsInput, status, preferenceButton;
  const startedForms = new Set();
  const vendorScripts = [];

  function publicPath(path) {
    if (path === '/' || path === '/index.html') return '/';
    const match = /^\/(start|see|offer|waitlist|request|privacy)(?:\/|\/index\.html)?$/.exec(path);
    return match ? '/' + match[1] : '';
  }
  function publicUrl(raw, localAllowed) {
    try {
      const url = new URL(raw);
      const prod = url.protocol === 'https:' && ['veylet.com', 'www.veylet.com'].includes(url.hostname) && !url.port;
      const local = localAllowed && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const path = publicPath(url.pathname);
      if ((!prod && !local) || url.username || url.password || url.search || !path ||
          (url.hash && !ANCHORS[path].includes(url.hash.slice(1)))) return '';
      return path;
    } catch { return ''; }
  }
  function surfaceAllowed() {
    try {
      if (window.top !== window.self) return false;
      // The owned capture app does not join the public-web funnel. Social ad browsers do.
      if (/VeyletCapture|PropertyCapture/i.test(window.navigator.userAgent || '')) return false;
      return true;
    } catch { return false; }
  }
  function safeContext() {
    return surfaceAllowed() && !!publicUrl(window.location.href, false) &&
      safeReferrer();
  }
  function safeReferrer() {
    if (!document.referrer || publicUrl(document.referrer, false)) return true;
    try {
      const url = new URL(document.referrer);
      return url.protocol === 'https:' && REFERRAL_HOSTS.includes(url.hostname) && url.pathname === '/' &&
        !url.port && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }
  function categoryEnabled(category) {
    if (category === 'analytics') return config.gaEnabled === true;
    return category === 'ads' && config.metaEnabled === true && config.pageViewsOnly !== true;
  }
  function measurementPageAllowed(localAllowed = false) {
    return config.pageViewsOnly !== true || ['/', '/start', '/offer', '/privacy'].includes(publicUrl(window.location.href, localAllowed));
  }
  function choiceFromStorage() {
    try {
      if (window.sessionStorage.getItem(DENY) === '1') return null;
      const parsed = JSON.parse(window.localStorage.getItem(CHOICE) || 'null');
      const age = Date.now() - (parsed && parsed.savedAt);
      // Changed scope requires a fresh choice. Remove old grants so a disabled vendor
      // cannot inherit dormant consent if it is introduced in a later release.
      if (parsed && (parsed.version !== config.consentVersion ||
          (parsed.analytics === true && !categoryEnabled('analytics')) || (parsed.ads === true && !categoryEnabled('ads')))) {
        invalidateGrant(); return null;
      }
      if (!parsed || typeof parsed.analytics !== 'boolean' ||
          typeof parsed.ads !== 'boolean' || !Number.isFinite(parsed.savedAt) || age < 0 ||
          age >= Math.min(Number(config.consentMaxAgeDays) || 180, 180) * DAY) return null;
      return parsed;
    } catch { return null; }
  }
  function probeStorage() {
    try {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        const key = CHOICE + ':available';
        storage.setItem(key, '1');
        if (storage.getItem(key) !== '1') throw new Error('unavailable');
        storage.removeItem(key);
      }
      return true;
    } catch { return false; }
  }
  function storedChoiceMatches() {
    const current = choiceFromStorage();
    return !!current && current.analytics === choice.analytics && current.ads === choice.ads;
  }
  function canMeasure(category) {
    return !stopping && storageReady && config.deploymentEnabled === true && categoryEnabled(category) &&
      choice[category] === true && storedChoiceMatches() && safeContext() && measurementPageAllowed();
  }
  function canUseMeta() {
    const path = publicUrl(window.location.href, false);
    return canMeasure('ads') && (['/', '/start', '/see', '/offer'].includes(path) ||
      (config.metaFormTrackingEnabled === true && FORMS.includes(path.slice(1))));
  }
  function cleanupCookies() {
    try {
      const names = document.cookie.split(';').map(part => part.split('=')[0].trim())
        .filter(name => /^_ga(?:_|$)|^_gid$|^_gat(?:_|$)|^_fbp$|^_fbc$/.test(name));
      // Vendor cookies use root scope. Also clear a path-scoped copy if present.
      const paths = new Set(['/']);
      const parts = window.location.pathname.split('/').filter(Boolean);
      for (let length = 1; length <= parts.length; length += 1) paths.add('/' + parts.slice(0, length).join('/'));
      for (const name of names) for (const path of paths) for (const domain of ['', 'veylet.com', '.veylet.com', window.location.hostname]) {
        document.cookie = name + '=; Max-Age=0; Path=' + path + (domain ? '; Domain=' + domain : '') + '; SameSite=Lax';
      }
    } catch { /* Cookie access is optional; measurement still stops. */ }
    try { window.sessionStorage.removeItem(ACCEPTED); } catch { /* no further measurement */ }
  }
  function stopAndReload(reloadAllowed = true) {
    if (stopping) return;
    stopping = true;
    // Disable first, empty pending queues, and end loaded scripts with a document reload.
    try { window['ga-disable-' + config.gaMeasurementId] = true; } catch { /* best effort */ }
    try {
      if (window.fbq && window.fbq.queue) window.fbq.queue.length = 0;
      if (window.fbq) window.fbq('consent', 'revoke');
    } catch { /* vendor failure is nonfatal */ }
    try { if (window.dataLayer) window.dataLayer.length = 0; } catch { /* best effort */ }
    for (const script of vendorScripts) { try { script.remove(); } catch { /* best effort */ } }
    cleanupCookies();
    if (expiryTimer) window.clearTimeout(expiryTimer);
    if ((gaLoaded || metaLoaded) && reloadAllowed) {
      try { window.location.reload(); } catch { /* remain stopped if reload is blocked */ }
    } else if (!gaLoaded && !metaLoaded) stopping = false;
  }
  function invalidateGrant() {
    // A failed overwrite must never reload into an older stored grant.
    try {
      window.localStorage.removeItem(CHOICE);
      if (window.localStorage.getItem(CHOICE) === null) return true;
    } catch { /* try a separate session guard */ }
    try {
      window.sessionStorage.setItem(DENY, '1');
      return window.sessionStorage.getItem(DENY) === '1';
    } catch { return false; }
  }
  function scheduleExpiry() {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    if (!choice.savedAt || (!choice.analytics && !choice.ads)) return;
    const remaining = choice.savedAt + Math.min(Number(config.consentMaxAgeDays) || 180, 180) * DAY - Date.now();
    expiryTimer = window.setTimeout(reconcile, Math.max(1, Math.min(remaining, 2147483000)));
  }
  function prepareLanding() {
    try {
      const url = new URL(window.location.href);
      if (!url.search || !surfaceAllowed() || !publicPath(url.pathname)) return;
      // A click ID is discarded, never forwarded, persisted or turned into _fbc.
      const keys = Array.from(url.searchParams.keys());
      const accepted = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid'];
      if (keys.some(key => !accepted.includes(key) || url.searchParams.getAll(key).length !== 1)) return;
      const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
      const hasCampaign = campaignKeys.some(key => url.searchParams.has(key));
      let registered;
      if (hasCampaign) {
        registered = (config.campaignRegistry || []).find(entry => campaignKeys.every((key, index) =>
          url.searchParams.get(key) === entry[['source', 'medium', 'name', 'content'][index]]));
        if (!registered) return;
      } else if (keys.length !== 1 || keys[0] !== 'fbclid') return;
      // Unknown fragments remain ineligible even after query removal.
      const clean = new URL(url.href); clean.search = '';
      if (!publicUrl(clean.href, true)) return;
      window.history.replaceState(window.history.state, '', clean.pathname + clean.hash);
      if (new URL(window.location.href).search) return;
      if (registered) campaign = Object.freeze({ campaign_source: registered.source, campaign_medium: registered.medium,
        campaign_name: registered.name, campaign_content: registered.content });
    } catch { /* Failed URL cleanup keeps the original URL ineligible. */ }
  }
  function addScript(src, category) {
    if (category === 'ads' ? !canUseMeta() : !canMeasure(category)) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      if (category === 'ads' ? !canUseMeta() : !canMeasure(category)) stopAndReload();
    };
    script.onerror = () => { /* Ad blockers and network errors never block the page. */ };
    vendorScripts.push(script);
    document.head.appendChild(script);
  }
  function startGoogle() {
    if (gaLoaded || !canMeasure('analytics') || !/^G-[A-Z0-9]+$/.test(config.gaMeasurementId || '')) return;
    gaLoaded = true;
    window['ga-disable-' + config.gaMeasurementId] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('set', 'ads_data_redaction', true);
    window.gtag('js', new Date());
    window.gtag('config', config.gaMeasurementId, Object.assign({ send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, page_location: 'https://veylet.com' + publicUrl(window.location.href, false),
      page_referrer: '', page_title: TITLES[publicUrl(window.location.href, false)] }, campaign));
    addScript('https://www.googletagmanager.com/gtag/js?id=' + config.gaMeasurementId, 'analytics');
  }
  function startMeta() {
    if (metaLoaded || !canUseMeta() || !/^\d{5,30}$/.test(config.metaPixelId || '')) return;
    metaLoaded = true;
    const fbq = function () { if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments); else fbq.queue.push(arguments); };
    fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0'; fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
    fbq('consent', 'grant');
    fbq('set', 'autoConfig', false, config.metaPixelId);
    fbq('init', config.metaPixelId); // No advanced-matching argument or personal data.
    addScript('https://connect.facebook.net/en_US/fbevents.js', 'ads');
  }
  function googleEvent(name, params) {
    if (!gaLoaded || !canMeasure('analytics') || (config.pageViewsOnly === true && name !== 'page_view')) return false;
    try {
      const path = publicUrl(window.location.href, false);
      window.gtag('event', name, Object.assign({ send_to: config.gaMeasurementId, page_location: 'https://veylet.com' + path,
        page_title: TITLES[path], page_referrer: '' }, campaign, params));
      return true;
    } catch { return false; }
  }
  function metaEvent(name, params) {
    if (!metaLoaded || !canUseMeta()) return false;
    try {
      if (name === 'page_view') window.fbq('track', 'PageView');
      else window.fbq('trackCustom', name === 'waitlist_submission_accepted' ? 'VeyletWaitlistSubmissionAccepted' : 'VeyletFunnelCtaClick', params);
      return true;
    } catch { return false; }
  }
  function validatedParams(name, params) {
    params = params && typeof params === 'object' ? params : {};
    if (name === 'funnel_cta_click' && DESTINATIONS.includes(params.destination) && PLACEMENTS.includes(params.placement))
      return { destination: params.destination, placement: params.placement };
    if (['form_start', 'form_submit_attempt', 'form_error'].includes(name) && FORMS.includes(params.form_id)) {
      // Form events must belong to the current public form, not a caller-supplied page.
      if (publicUrl(window.location.href, true) !== '/' + params.form_id) return null;
      if (name === 'form_error') return ERRORS.includes(params.error_code) ? { form_id: params.form_id, error_code: params.error_code } : null;
      return { form_id: params.form_id };
    }
    if (name === 'waitlist_submission_accepted' && params.form_id === 'waitlist' && publicUrl(window.location.href, true) === '/waitlist')
      return { form_id: 'waitlist' };
    return null;
  }
  function track(name, params) {
    try {
      if (config.pageViewsOnly === true) return false;
      const safe = validatedParams(name, params);
      if (!safe || stopping || (!canMeasure('analytics') && !canUseMeta()) || !probeStorage()) return false;
      if (name === 'form_start' && startedForms.has(safe.form_id)) return false;
      if (name === 'waitlist_submission_accepted' && window.sessionStorage.getItem(ACCEPTED) === '1') return false;
      const ga = googleEvent(name, safe);
      const meta = ['funnel_cta_click', 'waitlist_submission_accepted'].includes(name) && metaEvent(name, safe);
      if (!ga && !meta) return false;
      if (name === 'form_start') startedForms.add(safe.form_id);
      if (name === 'waitlist_submission_accepted') window.sessionStorage.setItem(ACCEPTED, '1');
      return true;
    } catch { return false; }
  }
  function beginMeasurement() {
    try {
      startGoogle(); startMeta();
      if (!gaPage && googleEvent('page_view', {})) gaPage = true;
      if (!metaPage && metaEvent('page_view', {})) metaPage = true;
    } catch { /* Consent never prevents use of the website. */ }
  }
  function showStatus(message) { if (status) status.textContent = message; }
  function saveChoice(analytics, ads) {
    const next = { version: config.consentVersion, savedAt: Date.now(),
      analytics: categoryEnabled('analytics') && analytics === true, ads: categoryEnabled('ads') && ads === true };
    if (!probeStorage()) {
      storageReady = false; choice = rejected(); stopAndReload(invalidateGrant());
      showStatus('Your browser cannot save this choice. Optional tracking stays off. You can still use every form.');
      return false;
    }
    const previous = choice;
    try {
      window.localStorage.setItem(CHOICE, JSON.stringify(next));
      window.sessionStorage.removeItem(DENY);
      if (JSON.stringify(choiceFromStorage()) !== JSON.stringify(next)) throw new Error('unavailable');
    } catch {
      storageReady = false; choice = rejected(); stopAndReload(invalidateGrant());
      showStatus('Your choice could not be saved. Optional tracking stays off.');
      return false;
    }
    storageReady = true; choice = next;
    scheduleExpiry();
    if (panel) panel.hidden = true;
    if ((previous.analytics && !next.analytics) || (previous.ads && !next.ads)) {
      stopAndReload();
    } else {
      if (!next.analytics && !next.ads) cleanupCookies();
      beginMeasurement();
    }
    return true;
  }
  function openPreferences() {
    if (!panel) return;
    if (analyticsInput) analyticsInput.checked = choice.analytics;
    if (adsInput) adsInput.checked = choice.ads;
    customize.hidden = false; panel.hidden = false;
    panel.querySelector('h2').focus();
  }
  function button(label, handler) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
    node.addEventListener('click', handler); return node;
  }
  function mount() {
    // Localhost may render consent; canMeasure retains the production-only gate.
    if (!surfaceAllowed() || !publicUrl(window.location.href, true) || !measurementPageAllowed(true)) return;
    preferenceButton = button('Privacy choices', openPreferences);
    preferenceButton.className = 'analytics-preferences';
    preferenceButton.setAttribute('aria-controls', 'analytics-consent');
    document.body.appendChild(preferenceButton);
    panel = document.createElement('section'); panel.id = 'analytics-consent'; panel.className = 'analytics-consent';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', 'analytics-consent-title');
    const analyticsEnabled = categoryEnabled('analytics'), adsEnabled = categoryEnabled('ads');
    panel.innerHTML = '<h2 id="analytics-consent-title" tabindex="-1">Your privacy choices</h2>' +
      '<p>' + (analyticsEnabled ? 'Optional analytics helps us understand public website visits. ' : '') +
      (adsEnabled ? 'Optional advertising cookies help us measure ads. ' : '') +
      'Optional measurement stays off until you choose. These choices are separate from email tips and offers.</p>' +
      '<p><a href="/privacy">Read our privacy notice</a></p>' +
      '<div class="analytics-options" hidden>' +
      (analyticsEnabled ? '<label><input type="checkbox" name="analytics"> Website analytics (Google Analytics)</label>' : '') +
      (adsEnabled ? '<label><input type="checkbox" name="ads"> Advertising measurement (Meta)</label>' : '') +
      '<p class="analytics-reload-note">Turning off tracking that is already running reloads this page. Save any unfinished form answers first.</p></div>' +
      '<div class="analytics-actions"></div><p class="analytics-status" role="status"></p>';
    customize = panel.querySelector('.analytics-options');
    analyticsInput = panel.querySelector('input[name="analytics"]');
    adsInput = panel.querySelector('input[name="ads"]');
    if (analyticsInput) analyticsInput.checked = choice.analytics;
    if (adsInput) adsInput.checked = choice.ads;
    status = panel.querySelector('.analytics-status');
    const actions = panel.querySelector('.analytics-actions');
    // Equal visual weight and one click for accepting or rejecting all.
    actions.appendChild(button('Reject optional', () => saveChoice(false, false)));
    actions.appendChild(button('Accept optional', () => saveChoice(analyticsEnabled, adsEnabled)));
    actions.appendChild(button('Customize', () => { customize.hidden = false; (analyticsInput || adsInput || panel.querySelector('h2')).focus(); }));
    customize.appendChild(button('Save choices', () => saveChoice(!!analyticsInput && analyticsInput.checked, !!adsInput && adsInput.checked)));
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { panel.hidden = true; preferenceButton.focus(); }
    });
    panel.hidden = !!choiceFromStorage();
    document.body.appendChild(panel);
    if (!storageReady) showStatus('Your browser cannot save choices. Optional tracking stays off.');
    document.addEventListener('click', event => {
      const link = event.target && event.target.closest && event.target.closest('[data-analytics-cta]');
      if (link) track('funnel_cta_click', { destination: link.getAttribute('data-analytics-cta'), placement: link.getAttribute('data-analytics-placement') });
    });
    document.addEventListener('focusin', event => {
      const form = event.target && event.target.closest && event.target.closest('[data-analytics-form]');
      if (form) track('form_start', { form_id: form.getAttribute('data-analytics-form') });
    });
    document.addEventListener('submit', event => {
      const form = event.target;
      if (form && form.getAttribute) track('form_submit_attempt', { form_id: form.getAttribute('data-analytics-form') });
    });
  }
  function reconcile() {
    const next = choiceFromStorage();
    const ready = probeStorage();
    if (!next || !ready || !safeContext() || !measurementPageAllowed()) {
      choice = rejected(); storageReady = false;
      stopAndReload((!next || !ready) ? invalidateGrant() : true);
      if (panel && !next) panel.hidden = false;
      return;
    }
    const revoked = (choice.analytics && !next.analytics) || (choice.ads && !next.ads);
    choice = next; storageReady = true; scheduleExpiry();
    if (revoked) stopAndReload(); else beginMeasurement();
  }
  window.VeyletAnalytics = Object.freeze({ track, openPreferences });
  prepareLanding();
  if (!surfaceAllowed() || !publicUrl(window.location.href, true)) return;
  storageReady = probeStorage();
  const saved = storageReady && choiceFromStorage();
  choice = saved || rejected();
  scheduleExpiry();
  if (!saved) cleanupCookies();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  window.addEventListener('storage', event => { if (event.key === CHOICE || event.key === null) reconcile(); });
  window.addEventListener('pageshow', event => { if (event.persisted) reconcile(); });
  window.addEventListener('hashchange', reconcile);
  window.addEventListener('popstate', reconcile);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reconcile(); });
  beginMeasurement();
})();
