const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// This harness records attempted vendor loads and commands; it never contacts a vendor.
const configSource = fs.readFileSync(path.join(__dirname, '../dist/analytics-config.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../dist/analytics.js'), 'utf8');
const CHOICE = 'veylet:measurement-choice:v1';
const ACCEPTED = 'veylet:waitlist-accepted:v1';
const NOW = 1790467200000;
const consent = (analytics, ads, savedAt = NOW) => JSON.stringify({ version: 2, savedAt, analytics, ads });
const plain = value => JSON.parse(JSON.stringify(value));
const organicCampaigns = [
  { source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'faq' },
  { source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'room_connections' },
  { source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'before_capture' },
  { source: 'instagram', medium: 'organic_social', name: 'pilot_202609', content: 'link_in_bio' },
  { source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'enquiry_details' },
];
const campaignQuery = campaign => new URLSearchParams({ utm_source: campaign.source, utm_medium: campaign.medium,
  utm_campaign: campaign.name, utm_content: campaign.content });

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; this.checked = false; }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(name, fn) { this.events[name] = fn; }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name] || null; }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
  click() { this.events.click?.({ target: this }); }
  querySelector(selector) { return this.parts?.[selector] || null; }
  set innerHTML(value) {
    this.html = value;
    this.parts = { h2: new Element('h2'), '.analytics-options': new Element('div'),
      '.analytics-actions': new Element('div'), '.analytics-status': new Element('p') };
    for (const name of ['analytics', 'ads']) {
      if (value.includes('name="' + name + '"')) this.parts['input[name="' + name + '"]'] = new Element('input');
    }
    this.parts['.analytics-options'].hidden = true;
  }
}
function harness(options = {}) {
  const local = { ...(options.local || {}) }, session = { ...(options.session || {}) };
  if (options.choice !== undefined) local[CHOICE] = options.choice;
  const writes = [], cookieWrites = [], scripts = [], docEvents = {}, events = {}, timers = [], replaced = [];
  let blocked = options.blockStorage, clock = NOW, reloads = 0;
  function storage(data, name) {
    return {
      getItem(key) { if (blocked === true || blocked === name) throw new Error('SecurityError'); return data[key] ?? null; },
      setItem(key, value) { if (blocked === true || blocked === name || blocked === 'writes' || (blocked === 'choice-write' && key === CHOICE)) throw new Error('QuotaExceededError'); writes.push([name, key, value]); data[key] = String(value); },
      removeItem(key) { if (blocked === true || blocked === name) throw new Error('SecurityError'); delete data[key]; },
    };
  }
  const location = new URL(options.url || 'https://veylet.com/');
  location.reload = () => { reloads++; };
  const document = {
    referrer: options.referrer || '', readyState: 'loading', body: new Element('body'),
    head: { appendChild(node) { scripts.push(node); if (options.failScriptAppend) throw new Error('blocked'); } },
    createElement: tag => new Element(tag), addEventListener: (name, fn) => { docEvents[name] = fn; },
  };
  Object.defineProperty(document, 'cookie', {
    get: () => options.cookies || '', set: value => cookieWrites.push(value),
  });
  const window = { document, location, navigator: { userAgent: options.ua || 'Mozilla/5.0 Safari/605.1.15' },
    localStorage: storage(local, 'local'), sessionStorage: storage(session, 'session'),
    addEventListener: (name, fn) => { events[name] = fn; },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    history: { state: null, replaceState(state, title, target) {
      if (options.failReplaceState) throw new Error('blocked');
      replaced.push(target); location.href = new URL(target, location.href).href;
    } },
  };
  window.self = window; window.top = options.embedded ? {} : window;
  if (options.native) window.webkit = { messageHandlers: {} };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ window, document, URL, Date: Clock, console, Set, JSON, Object, Number });
  vm.runInContext(configSource, context);
  // Explicit full-feature fixtures preserve consent/payload regression coverage while
  // the source release is globally off and its eventual activation is page-view-only.
  if (!options.useShippedConfig) window.VEYLET_ANALYTICS_CONFIG = { ...window.VEYLET_ANALYTICS_CONFIG,
    // The shipped release blanks the Meta pixel ID; a synthetic ID keeps the Meta code paths covered.
    deploymentEnabled: true, gaEnabled: true, metaEnabled: true, pageViewsOnly: false, consentVersion: 2,
    metaPixelId: '100000000000001', ...options.config };
  else assert.equal(options.config, undefined, 'shipped flags must not be overridden');
  vm.runInContext(source, context);
  docEvents.DOMContentLoaded?.();
  const panel = document.body.children.find(node => node.id === 'analytics-consent');
  const button = label => {
    const groups = [document.body.children, panel?.querySelector('.analytics-actions')?.children || [], panel?.querySelector('.analytics-options')?.children || []];
    return groups.flat().find(node => node.textContent === label);
  };
  return { window, document, scripts, local, session, writes, cookieWrites, events, docEvents, panel, button, timers, replaced,
    ga: () => plain(Array.from(window.dataLayer || [], args => Array.from(args))),
    meta: () => plain(Array.from(window.fbq?.queue || [], args => Array.from(args))),
    track: (...args) => window.VeyletAnalytics.track(...args),
    choose(analytics, ads) {
      window.VeyletAnalytics.openPreferences();
      if (panel.querySelector('input[name="analytics"]')) panel.querySelector('input[name="analytics"]').checked = analytics;
      if (panel.querySelector('input[name="ads"]')) panel.querySelector('input[name="ads"]').checked = ads;
      button('Save choices').click();
    },
    setBlocked: value => { blocked = value; }, advance: amount => { clock += amount; }, reloads: () => reloads,
  };
}

const gaOnly = { deploymentEnabled: true, gaEnabled: true, metaEnabled: false, pageViewsOnly: true, consentVersion: 2 };
// /see joined the page-view allowlist on 22 October 2026 so the result page is measured too.
const pageViewPaths = ['/', '/start', '/see', '/offer', '/privacy'];

// Owner decision, 29 September 2026: the shipped config is the accepted GA-only release variant
// (config SHA-256 46c7ebe5…): GA on, Meta off with a blank pixel ID, page views only, consent v2.
test('GA-only release: the shipped config is the accepted GA-on, Meta-off, page-view-only variant', () => {
  const shipped = harness({ useShippedConfig: true }).window.VEYLET_ANALYTICS_CONFIG;
  assert.equal(shipped.deploymentEnabled, true); assert.equal(shipped.gaEnabled, true);
  assert.equal(shipped.metaEnabled, false); assert.equal(shipped.metaPixelId, '');
  assert.equal(shipped.pageViewsOnly, true); assert.equal(shipped.metaFormTrackingEnabled, false);
  assert.equal(shipped.consentVersion, 2); assert.match(shipped.gaMeasurementId, /^G-[A-Z0-9]+$/);
});

test('GA-only release: shipped config loads only GA page views, only after analytics consent, only on five pages', () => {
  for (const pathname of pageViewPaths) {
    const none = harness({ url: 'https://veylet.com' + pathname, useShippedConfig: true });
    assert.equal(none.scripts.length, 0, pathname + ' loads nothing before a choice');
    assert.deepEqual(none.ga(), []); assert.deepEqual(none.meta(), []);
    for (const choice of [consent(false, false), consent(false, true)]) {
      const h = harness({ url: 'https://veylet.com' + pathname, choice, useShippedConfig: true });
      assert.equal(h.scripts.length, 0, pathname + ' loads nothing without analytics consent');
      assert.equal(h.window.fbq, undefined); assert.deepEqual(h.meta(), []);
    }
    // A stored advertising grant is dormant consent for a disabled vendor: it is removed, nothing loads.
    const dormant = harness({ url: 'https://veylet.com' + pathname, choice: consent(true, true), useShippedConfig: true });
    assert.equal(dormant.scripts.length, 0, pathname + ' ignores a grant that includes advertising');
    assert.equal(dormant.window.fbq, undefined); assert.deepEqual(dormant.meta(), []);
    for (const choice of [consent(true, false)]) {
      const h = harness({ url: 'https://veylet.com' + pathname, choice, useShippedConfig: true });
      assert.equal(h.scripts.length, 1, pathname); assert.match(h.scripts[0].src, /googletagmanager/);
      assert.equal(h.window.fbq, undefined); assert.deepEqual(h.meta(), []);
      assert.equal(h.track('funnel_cta_click', { destination: 'offer', placement: 'hero' }), false);
      assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
      assert.deepEqual(h.ga().filter(args => args[0] === 'event').map(args => args[1]), ['page_view'], pathname);
      assert.equal(h.session[ACCEPTED], undefined);
    }
  }
  for (const pathname of ['/waitlist', '/request', '/apply', '/thanks', '/account']) {
    for (const choice of [undefined, consent(true, false), consent(true, true)]) {
      const h = harness({ url: 'https://veylet.com' + pathname, choice, useShippedConfig: true });
      assert.equal(h.scripts.length, 0, pathname + ' must not attempt vendor loading');
      assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), []);
      assert.equal(h.window.gtag, undefined); assert.equal(h.window.fbq, undefined);
      assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
      assert.equal(h.session[ACCEPTED], undefined);
    }
  }
});

test('GA-only release: four public page views require analytics consent and never load Meta', () => {
  for (const pathname of pageViewPaths) {
    const h = harness({ url: 'https://veylet.com' + pathname, config: gaOnly });
    assert.equal(h.scripts.length, 0);
    assert.equal(h.track('funnel_cta_click', { destination: 'offer', placement: 'hero' }), false);
    h.button('Accept optional').click();
    assert.equal(h.scripts.length, 1); assert.match(h.scripts[0].src, /googletagmanager/);
    assert.equal(h.window.fbq, undefined); assert.deepEqual(h.meta(), []);
    const events = h.ga().filter(args => args[0] === 'event');
    assert.deepEqual(events.map(args => args[1]), ['page_view']);
    assert.equal(events[0][2].page_location, 'https://veylet.com' + pathname);
    assert.equal(events[0][2].page_referrer, '');
    h.choose(true, true); h.events.pageshow({ persisted: true });
    assert.equal(JSON.parse(h.local[CHOICE]).ads, false);
    assert.equal(h.ga().filter(args => args[0] === 'event').length, 1);
  }
});

test('GA-only release: data-entry, thanks and private pages never load even if runtime is included', () => {
  for (const pathname of ['/request', '/apply', '/waitlist', '/thanks', '/account', '/auth/callback', '/studio']) {
    const h = harness({ url: 'https://veylet.com' + pathname, config: gaOnly, choice: consent(true, false) });
    assert.equal(h.scripts.length, 0, pathname);
    for (const [name, params] of [['funnel_cta_click', { destination: 'offer', placement: 'hero' }],
      ['form_start', { form_id: pathname.slice(1) }], ['form_submit_attempt', { form_id: pathname.slice(1) }],
      ['form_error', { form_id: pathname.slice(1), error_code: 'validation' }],
      ['waitlist_submission_accepted', { form_id: 'waitlist' }], ['page_view', {}]]) {
      assert.equal(h.track(name, params), false, name + ' on ' + pathname);
    }
    assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), []);
    assert.equal(h.session[ACCEPTED], undefined);
  }
  const h = harness({ config: gaOnly, choice: consent(true, false) });
  for (const name of ['funnel_cta_click', 'form_start', 'form_submit_attempt', 'form_error', 'waitlist_submission_accepted'])
    assert.equal(h.track(name, { destination: 'offer', placement: 'hero', form_id: 'waitlist', error_code: 'network' }), false);
  assert.deepEqual(h.ga().filter(args => args[0] === 'event').map(args => args[1]), ['page_view']);
});

test('GA-only release: history transitions to excluded public routes stop and unload active measurement', () => {
  for (const pathname of ['/request', '/apply', '/waitlist']) {
    const h = harness({ config: gaOnly, choice: consent(true, false) });
    assert.equal(h.scripts.length, 1);
    assert.equal(h.ga().filter(args => args[0] === 'event').length, 1);
    h.window.history.replaceState(null, '', pathname);
    h.events.popstate();
    assert.equal(h.window['ga-disable-' + h.window.VEYLET_ANALYTICS_CONFIG.gaMeasurementId], true, pathname);
    assert.deepEqual(h.ga(), [], pathname + ' clears queued commands');
    assert.ok(h.scripts.every(script => script.removed), pathname + ' removes SDK elements');
    assert.equal(h.reloads(), 1, pathname + ' ends the loaded SDK document');
    h.scripts[0].onload();
    assert.equal(h.reloads(), 1, 'a late SDK load cannot restart measurement');
    assert.equal(h.track('form_start', { form_id: pathname.slice(1) }), false);
    assert.deepEqual(h.ga(), []);
  }
});

test('GA-only release: missing or malformed vendor flags fail closed and the global kill switch wins', () => {
  for (const flags of [undefined, null, false, 'true', 1, {}]) {
    const h = harness({ config: { gaEnabled: flags, metaEnabled: flags }, choice: consent(true, true) });
    assert.equal(h.scripts.length, 0); assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), []);
  }
  const h = harness({ config: { ...gaOnly, deploymentEnabled: false }, choice: consent(true, false) });
  assert.equal(h.scripts.length, 0); h.choose(true, true); assert.equal(h.scripts.length, 0);
});

test('GA-only release: fresh v2 choice removes dormant ads grants and exposes no advertising choice', () => {
  for (const choice of [JSON.stringify({ version: 1, savedAt: NOW, analytics: true, ads: true }), consent(true, true)]) {
    const h = harness({ config: gaOnly, choice });
    assert.equal(h.scripts.length, 0); assert.equal(h.panel.hidden, false);
    assert.equal(h.local[CHOICE], undefined, 'old or disabled-category grants must not remain dormant');
    assert.equal(h.panel.querySelector('input[name="ads"]'), null);
    assert.doesNotMatch(h.panel.html, /Meta|Advertising measurement|advertising cookies/i);
    h.button('Accept optional').click();
    assert.equal(JSON.parse(h.local[CHOICE]).ads, false);
    assert.equal(JSON.parse(h.local[CHOICE]).version, 2);
    assert.equal(h.scripts.length, 1); assert.deepEqual(h.meta(), []);
  }
  const adsOnly = harness({ config: gaOnly, choice: consent(false, true) });
  assert.equal(adsOnly.scripts.length, 0);
});

test('GA-only release: sanitized campaigns, failed storage and withdrawal retain their boundaries', () => {
  const query = '?utm_source=instagram&utm_medium=organic_social&utm_campaign=pilot_202609&utm_content=link_in_bio&fbclid=PRIVATE';
  const h = harness({ url: 'https://veylet.com/' + query, config: gaOnly });
  assert.equal(h.scripts.length, 0); h.choose(true, true);
  const event = h.ga().find(args => args[0] === 'event');
  assert.equal(event[2].campaign_source, 'instagram'); assert.equal(event[2].page_location, 'https://veylet.com/');
  assert.equal(event[2].page_referrer, '');
  assert.doesNotMatch(JSON.stringify([h.ga(), h.meta(), h.local, h.session]), /PRIVATE|fbclid|utm_source/);
  h.choose(false, false); assert.equal(h.reloads(), 1); assert.deepEqual(h.ga(), []);
  for (const options of [{ blockStorage: true }, { referrer: 'https://veylet.com/account' },
    { url: 'https://veylet.com/#PRIVATE' }]) {
    const denied = harness({ ...options, config: gaOnly, choice: consent(true, false) });
    assert.equal(denied.scripts.length, 0); assert.deepEqual(denied.ga(), []);
  }
  // An unregistered private query is stripped and the clean page view still counts; nothing private is kept.
  const stripped = harness({ url: 'https://veylet.com/?email=PRIVATE', config: gaOnly, choice: consent(true, false) });
  assert.deepEqual(stripped.replaced, ['/']); assert.equal(stripped.scripts.length, 1);
  const view = stripped.ga().find(args => args[0] === 'event');
  assert.equal(view[1], 'page_view'); assert.equal(view[2].page_location, 'https://veylet.com/');
  assert.equal(view[2].campaign_source, undefined, 'an unregistered query carries no attribution');
  assert.doesNotMatch(JSON.stringify([stripped.ga(), stripped.local, stripped.session, stripped.writes]), /PRIVATE|email=/);
});

test('GA-only release: localhost and loopback render consent without any SDK or queue', () => {
  for (const url of ['http://localhost:8917/', 'http://127.0.0.1:8917/start', 'http://[::1]:8917/privacy']) {
    const local = harness({ url, config: gaOnly });
    assert.ok(local.panel, 'the real GA-only consent UI remains available for local rendered checks');
    assert.equal(local.panel.querySelector('input[name="ads"]'), null);
    local.button('Accept optional').click(); assert.equal(local.scripts.length, 0);
    assert.deepEqual(local.ga(), []); assert.deepEqual(local.meta(), []);
  }
});

test('unset and rejected choices cause no vendor loads, queues, or session identifiers', () => {
  for (const choice of [undefined, consent(false, false), '{broken', 'null', consent(true, true, NOW - 180 * 86400000)]) {
    const h = harness({ choice });
    assert.equal(h.scripts.length, 0); assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), []);
    assert.deepEqual(h.session, {}); assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
    assert.ok(h.button('Reject optional')); assert.ok(h.button('Accept optional'));
  }
});

test('independent categories load only their vendor, with one page view per document', () => {
  for (const [analytics, ads, expected] of [[true, false, 'googletagmanager'], [false, true, 'facebook'], [true, true, 'both']]) {
    const h = harness(); h.choose(analytics, ads);
    assert.equal(h.scripts.length, expected === 'both' ? 2 : 1);
    if (expected !== 'both') assert.match(h.scripts[0].src, new RegExp(expected));
    assert.equal(h.ga().filter(args => args[0] === 'event' && args[1] === 'page_view').length, analytics ? 1 : 0);
    assert.equal(h.meta().filter(args => args[0] === 'track' && args[1] === 'PageView').length, ads ? 1 : 0);
    h.choose(analytics, ads);
    assert.equal(h.scripts.length, expected === 'both' ? 2 : 1);
    assert.ok(h.scripts.every(script => script.referrerPolicy === 'no-referrer'));
  }
});

test('Google disables ad data and automatic page views; Meta disables automatic config before init', () => {
  const h = harness({ choice: consent(true, true) });
  const ga = h.ga(), meta = h.meta();
  assert.deepEqual(ga[0], ['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
  const cfg = ga.find(args => args[0] === 'config')[2];
  assert.equal(cfg.send_page_view, false); assert.equal(cfg.allow_google_signals, false); assert.equal(cfg.allow_ad_personalization_signals, false);
  assert.ok(meta.findIndex(args => args[0] === 'set' && args[1] === 'autoConfig' && args[2] === false) < meta.findIndex(args => args[0] === 'init'));
  assert.equal(meta.find(args => args[0] === 'init').length, 2, 'no advanced matching');
});

test('activity before consent is dropped and never replayed on later grant', () => {
  const h = harness({ url: 'https://veylet.com/waitlist' });
  assert.equal(h.track('form_start', { form_id: 'waitlist' }), false);
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
  assert.deepEqual(h.session, {});
  h.choose(true, true);
  assert.deepEqual(h.ga().filter(args => args[0] === 'event').map(args => args[1]), ['page_view']);
  assert.equal(h.scripts.length, 1, 'Meta form collection gated off');
  assert.equal(h.track('form_start', { form_id: 'waitlist' }), true);
  assert.equal(h.track('form_start', { form_id: 'waitlist' }), false);
});

test('accepted waitlist submissions dedupe within the consented session across documents', () => {
  const h = harness({ url: 'https://veylet.com/waitlist', choice: consent(true, false) });
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), true);
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
  const next = harness({ url: 'https://veylet.com/waitlist/', choice: consent(true, false), session: h.session });
  assert.equal(next.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
  assert.deepEqual(h.session, { [ACCEPTED]: '1' });
  assert.equal(h.ga().filter(args => args[1] === 'waitlist_submission_accepted').length, 1);
  assert.equal(h.track('sign_up', {}), false); assert.equal(h.track('purchase', { value: 100 }), false);
});

test('a future verified Meta form gate uses a custom accepted-submission event, not Lead or revenue', () => {
  const h = harness({ url: 'https://veylet.com/waitlist', choice: consent(false, true), config: { metaFormTrackingEnabled: true } });
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist', value: 99, currency: 'AUD' }), true);
  assert.deepEqual(h.meta().filter(args => args[0] === 'trackCustom'), [['trackCustom', 'VeyletWaitlistSubmissionAccepted', { form_id: 'waitlist' }]]);
});

test('personal data, arbitrary parameters, unknown events and dynamic page data never enter command payloads', () => {
  const h = harness({ choice: consent(true, true), referrer: 'https://www.google.com/' });
  h.document.title = 'SECRET_PERSON_AT_PRIVATE_ADDRESS';
  assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero', email: 'PRIVATE@example.invalid',
    name: 'SECRET_PERSON', page_location: 'https://secret.invalid/address', value: 999 }), true);
  for (const params of [{ destination: 'PRIVATE', placement: 'hero' }, { destination: 'waitlist', placement: 'PRIVATE' }])
    assert.equal(h.track('funnel_cta_click', params), false);
  assert.equal(h.track('PRIVATE_EVENT', { form_id: 'waitlist' }), false);
  const payload = JSON.stringify([h.ga(), h.meta()]);
  assert.doesNotMatch(payload, /PRIVATE|SECRET|example\.invalid|secret\.invalid|999/);
  for (const args of h.ga().filter(args => args[0] === 'event')) {
    assert.equal(args[2].page_location, 'https://veylet.com/'); assert.equal(args[2].page_referrer, ''); assert.equal(args[2].page_title, 'Veylet');
  }
});

test('only real public route aliases are accepted; private, unknown, malformed, and token URLs fail closed', () => {
  for (const pathname of ['/', '/index.html', '/start', '/see/', '/offer/index.html', '/waitlist/', '/request', '/privacy']) {
    assert.ok(harness({ url: 'https://veylet.com' + pathname, choice: consent(true, true) }).scripts.length >= 1, pathname);
  }
  for (const suffix of ['/apply', '/account', '/app/account', '/auth/callback', '/tour', '/embed', '/join', '/client', '/studio', '/handoff',
    '/play', '/report', '/unsubscribe', '/unknown', '/waitlist.html', '/offer//', '/%77aitlist', '/#token=PRIVATE']) {
    const h = harness({ url: 'https://veylet.com' + suffix, choice: consent(true, true) });
    assert.equal(h.scripts.length, 0, suffix); assert.deepEqual(h.ga(), []);
  }
  // A query on a real public page is stripped to the clean path, which then counts; nothing private is kept or sent.
  for (const suffix of ['/?email=PRIVATE', '/?utm_source=facebook', '/?fbclid=PRIVATE&email=PRIVATE', '/?utm_campaign=arbitrary']) {
    const h = harness({ url: 'https://veylet.com' + suffix, choice: consent(true, true) });
    assert.deepEqual(h.replaced, ['/'], suffix);
    assert.ok(h.scripts.length >= 1, suffix);
    const events = h.ga().filter(args => args[0] === 'event');
    assert.deepEqual(events.map(args => args[1]), ['page_view'], suffix);
    assert.equal(events[0][2].page_location, 'https://veylet.com/', suffix);
    assert.equal(events[0][2].campaign_source, undefined, suffix);
    assert.doesNotMatch(JSON.stringify([h.ga(), h.meta(), h.local, h.session, h.writes]), /PRIVATE|email=|utm_|arbitrary|fbclid/, suffix);
  }
});

test('private or unknown referrers and non-production/custom/native/embedded surfaces load no vendors', () => {
  for (const options of [{ referrer: 'https://veylet.com/account' }, { referrer: 'https://veylet.com/?email=PRIVATE' },
    { referrer: 'https://agency.invalid/' }, { referrer: 'https://www.google.com/search?q=PRIVATE' },
    { referrer: 'https://l.facebook.com/path' }, { referrer: 'https://facebook.com/#PRIVATE' },
    { referrer: 'https://PRIVATE@facebook.com/' }, { referrer: 'https://facebook.com:444/' },
    { url: 'https://agency.veylet.com/' }, { url: 'http://veylet.com/' }, { url: 'https://veylet.com:444/' },
    { url: 'http://localhost:8917/' }, { embedded: true }, { ua: 'VeyletCapture' }]) {
    const h = harness({ ...options, choice: consent(true, true) });
    assert.equal(h.scripts.length, 0, JSON.stringify(options));
  }
  for (const referrer of ['', 'https://veylet.com/offer', 'https://www.facebook.com/', 'https://l.instagram.com/', 'https://www.google.com/'])
    assert.equal(harness({ referrer, choice: consent(true, true) }).scripts.length, 2, referrer);
  assert.equal(harness({ ua: 'Instagram 333', native: true, choice: consent(true, true) }).scripts.length, 2, 'social ad browsers with generic native bridges remain eligible');
  assert.ok(harness({ url: 'http://localhost:8917/' }).panel, 'localhost supports consent UI proof without vendor loads');
});

test('Meta stays off all data-entry routes and privacy while Google can measure consented safe form events', () => {
  for (const page of ['waitlist', 'request', 'privacy']) {
    const h = harness({ url: 'https://veylet.com/' + page, choice: consent(true, true) });
    assert.equal(h.scripts.length, 1); assert.match(h.scripts[0].src, /googletagmanager/); assert.deepEqual(h.meta(), []);
  }
  const h = harness({ url: 'https://veylet.com/request', choice: consent(true, true) });
  assert.equal(h.track('form_error', { form_id: 'request', error_code: 'network', message: 'PRIVATE' }), true);
  assert.equal(h.track('form_error', { form_id: 'request', error_code: 'PRIVATE' }), false);
  assert.equal(h.track('form_start', { form_id: 'waitlist' }), false);
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
});

test('blocked or unavailable storage prevents vendor startup and never breaks consent UI', () => {
  for (const blockStorage of [true, 'local', 'session', 'writes']) {
    const h = harness({ blockStorage, choice: consent(true, true) });
    assert.equal(h.scripts.length, 0); assert.doesNotThrow(() => h.choose(true, true));
    assert.equal(h.scripts.length, 0); assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
    assert.match(h.panel.querySelector('.analytics-status').textContent, /stays off/);
  }
  const h = harness({ url: 'https://veylet.com/waitlist', choice: consent(true, false) });
  h.setBlocked('writes');
  assert.equal(h.track('waitlist_submission_accepted', { form_id: 'waitlist' }), false);
  assert.equal(h.ga().filter(args => args[1] === 'waitlist_submission_accepted').length, 0);
});

test('withdrawal clears pending queues, own vendor cookies and dedupe; ends loaded scripts by reload', () => {
  const h = harness({ choice: consent(true, true), cookies: '_ga=one; _ga_M4SLEMNVP6=two; _fbp=three; essential=keep', session: { [ACCEPTED]: '1' } });
  h.window.VeyletAnalytics.openPreferences();
  assert.match(h.panel.html, /reloads this page.*unfinished form answers/);
  h.button('Reject optional').click();
  assert.equal(h.reloads(), 1); assert.equal(h.window['ga-disable-G-M4SLEMNVP6'], true);
  assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), [['consent', 'revoke']]);
  assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
  assert.ok(h.scripts.every(script => script.removed)); assert.deepEqual(h.session, {});
  assert.ok(h.cookieWrites.some(value => value.startsWith('_ga=;'))); assert.ok(h.cookieWrites.some(value => value.startsWith('_fbp=;')));
  assert.ok(h.cookieWrites.every(value => !value.startsWith('essential=')));
  const reload = harness({ local: h.local }); assert.equal(reload.scripts.length, 0);
  reload.choose(true, true); assert.equal(reload.scripts.length, 2, 'regrant works after the required reload');
});

test('cross-tab withdrawal, cleared choice, expiry and BFcache restoration stop active tracking', () => {
  for (const trigger of ['storage', 'clear', 'expiry', 'bfcache']) {
    const h = harness({ choice: consent(true, true) });
    if (trigger === 'expiry') h.advance(181 * 86400000);
    else if (trigger === 'clear') delete h.local[CHOICE];
    else h.local[CHOICE] = consent(false, false);
    if (trigger === 'bfcache') h.events.pageshow({ persisted: true });
    else if (trigger === 'expiry') h.events.pageshow({ persisted: true });
    else h.events.storage({ key: trigger === 'clear' ? null : CHOICE });
    assert.equal(h.reloads(), 1, trigger);
    assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
    h.scripts.forEach(script => script.onload());
    assert.equal(h.reloads(), 1, 'late loads cannot restart consent');
  }
});

test('consent changes during async script load are rechecked; blocked vendor failures are nonfatal', () => {
  const h = harness({ choice: consent(true, true) });
  h.local[CHOICE] = consent(false, false);
  h.scripts[0].onload(); assert.equal(h.reloads(), 1); assert.deepEqual(h.ga(), []);
  const blocked = harness({ choice: consent(true, true) });
  assert.doesNotThrow(() => blocked.scripts.forEach(script => script.onerror(new Error('ad blocker'))));
  assert.doesNotThrow(() => harness({ choice: consent(true, true), failScriptAppend: true }));
});

test('delegated hooks measure only fixed CTA attributes and matching forms, without reading input values', () => {
  const h = harness({ choice: consent(true, true), url: 'https://veylet.com/waitlist' });
  const form = new Element('form'); form.setAttribute('data-analytics-form', 'waitlist');
  const input = { value: 'PRIVATE@example.invalid', closest: selector => selector === '[data-analytics-form]' ? form : null };
  h.docEvents.focusin({ target: input }); h.docEvents.focusin({ target: input }); h.docEvents.submit({ target: form });
  const link = new Element('a'); link.setAttribute('data-analytics-cta', 'offer'); link.setAttribute('data-analytics-placement', 'footer');
  h.docEvents.click({ target: { closest: () => link } });
  assert.deepEqual(h.ga().filter(args => args[0] === 'event').map(args => args[1]), ['page_view', 'form_start', 'form_submit_attempt', 'funnel_cta_click']);
  assert.doesNotMatch(JSON.stringify(h.ga()), /PRIVATE/);
});

test('unknown events including manual page_view are rejected and deployment kill switch wins over consent', () => {
  const h = harness({ choice: consent(true, true), config: { deploymentEnabled: false } });
  assert.equal(h.scripts.length, 0); assert.equal(h.track('page_view', {}), false);
});

test('campaign registry contains only the approved exact tuples, preserving both paid rows and the launch tuples', () => {
  const h = harness();
  assert.deepEqual(plain(h.window.VEYLET_ANALYTICS_CONFIG.campaignRegistry), [
    { source: 'facebook', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' },
    { source: 'instagram', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' },
    ...organicCampaigns,
    // App Store launch tuples (22 October 2026): warm email and organic social, one row per audience.
    { source: 'email', medium: 'warm', name: 'launch-2026-10', content: 'stays' },
    { source: 'email', medium: 'warm', name: 'launch-2026-10', content: 'agents' },
    { source: 'instagram', medium: 'social', name: 'launch-2026-10', content: 'stays' },
    { source: 'instagram', medium: 'social', name: 'launch-2026-10', content: 'agents' },
    { source: 'facebook', medium: 'social', name: 'launch-2026-10', content: 'stays' },
    { source: 'facebook', medium: 'social', name: 'launch-2026-10', content: 'agents' },
  ]);
});

test('a launch campaign tuple attaches its attribution to the clean page view after consent', () => {
  for (const [content, pathname] of [['stays', '/'], ['agents', '/offer']]) {
    const query = new URLSearchParams({ utm_source: 'email', utm_medium: 'warm', utm_campaign: 'launch-2026-10', utm_content: content });
    const h = harness({ url: `https://veylet.com${pathname}?${query}`, config: gaOnly, choice: consent(true, false) });
    assert.deepEqual(h.replaced, [pathname]);
    const view = h.ga().find(args => args[0] === 'event' && args[1] === 'page_view')[2];
    assert.equal(view.campaign_source, 'email'); assert.equal(view.campaign_medium, 'warm');
    assert.equal(view.campaign_name, 'launch-2026-10'); assert.equal(view.campaign_content, content);
    assert.equal(view.page_location, `https://veylet.com${pathname}`);
  }
});

test('the one consented App Store click event carries only its placement, is Analytics-only, and respects page-views-only', () => {
  // Shipped-style page-views-only config: the App Store click is the single allowed custom event.
  for (const pathname of ['/', '/see', '/offer', '/start']) {
    const placement = { '/': 'web_home_hero', '/see': 'web_see', '/offer': 'web_offer', '/start': 'web_stays' }[pathname];
    const h = harness({ url: 'https://veylet.com' + pathname, config: gaOnly, choice: consent(true, false) });
    assert.equal(h.track('app_store_click', { placement, destination: 'offer', url: 'https://secret.invalid' }), true, pathname);
    const events = h.ga().filter(args => args[0] === 'event');
    assert.deepEqual(events.map(args => args[1]), ['page_view', 'app_store_click'], pathname);
    assert.deepEqual(events[1][2].placement, placement);
    assert.equal(events[1][2].url, undefined, 'no extra params leak into the event');
    assert.deepEqual(h.meta(), [], pathname + ' sends nothing to Meta');
  }
  // Unknown placements are rejected, and the event never fires without analytics consent.
  const ok = harness({ url: 'https://veylet.com/', config: gaOnly, choice: consent(true, false) });
  assert.equal(ok.track('app_store_click', { placement: 'PRIVATE_PLACEMENT' }), false);
  const noConsent = harness({ url: 'https://veylet.com/', config: gaOnly, choice: consent(false, false) });
  assert.equal(noConsent.track('app_store_click', { placement: 'web_home_hero' }), false);
  assert.deepEqual(noConsent.ga(), []);
});

test('a delegated App Store link click fires exactly one consented app_store_click', () => {
  const h = harness({ url: 'https://veylet.com/', config: gaOnly, choice: consent(true, false) });
  const link = new Element('a'); link.setAttribute('data-analytics-appstore', 'web_home_hero');
  h.docEvents.click({ target: { closest: selector => selector === '[data-analytics-appstore]' ? link : null } });
  const events = h.ga().filter(args => args[0] === 'event');
  assert.deepEqual(events.map(args => args[1]), ['page_view', 'app_store_click']);
  assert.equal(events[1][2].placement, 'web_home_hero');
});

test('failed consent overwrite cannot reload into an old grant, even if local removal also fails', () => {
  for (const failure of ['choice-write', 'local', true]) {
    const h = harness({ choice: consent(true, true) });
    h.setBlocked(failure); h.button('Reject optional').click();
    assert.equal(h.track('funnel_cta_click', { destination: 'waitlist', placement: 'hero' }), false);
    assert.deepEqual(h.ga(), []);
    if (failure === true) assert.equal(h.reloads(), 0, 'no reload when both durable refusal paths are unavailable');
    else {
      assert.equal(h.reloads(), 1);
      const reloaded = harness({ local: h.local, session: h.session });
      assert.equal(reloaded.scripts.length, 0, 'old local grant cannot resume');
      reloaded.choose(true, true); assert.equal(reloaded.scripts.length, 2, 'fresh deliberate grant clears temporary refusal');
    }
  }
});

test('expiry schedules bounded checks and visible-page resume reconciles without user interaction', () => {
  const h = harness({ choice: consent(true, true) });
  assert.ok(h.timers[0].delay > 0 && h.timers[0].delay <= 2147483000);
  h.advance(180 * 86400000); h.timers[0].fn(); assert.equal(h.reloads(), 1);
  const resumed = harness({ choice: consent(true, true) });
  resumed.advance(180 * 86400000); resumed.document.visibilityState = 'visible'; resumed.docEvents.visibilitychange();
  assert.equal(resumed.reloads(), 1);
});

test('known public anchors remain navigable without reloading; unrecognized fragments stop measurement', () => {
  const h = harness({ choice: consent(true, true) });
  for (const hash of ['#process', '#stays', '#agents']) {
    h.window.location.hash = hash; h.events.hashchange(); assert.equal(h.reloads(), 0, hash);
  }
  assert.equal(h.scripts.length, 2);
  h.window.location.hash = '#PRIVATE'; h.events.hashchange(); assert.equal(h.reloads(), 1);
  for (const url of ['https://veylet.com/#top', 'https://veylet.com/#stays', 'https://veylet.com/#agents',
    'https://veylet.com/offer#counts-title', 'https://veylet.com/start#first-session'])
    assert.ok(harness({ url, choice: consent(true, true) }).scripts.length > 0);
});

test('registered paid landing values are fixed, held only in memory and attached only after consent', () => {
  const query = '?utm_source=instagram&utm_medium=paid_social&utm_campaign=veylet_waitlist_20260927&utm_content=walkthrough_demo&fbclid=PRIVATE_CLICK_CANARY';
  const h = harness({ url: 'https://veylet.com/' + query });
  assert.deepEqual(h.replaced, ['/']); assert.equal(h.scripts.length, 0); assert.deepEqual(h.ga(), []);
  assert.doesNotMatch(JSON.stringify([h.local, h.session, h.writes]), /instagram|veylet_waitlist|PRIVATE_CLICK/);
  h.choose(true, true);
  assert.equal(h.scripts.length, 2);
  const page = h.ga().find(args => args[0] === 'event' && args[1] === 'page_view')[2];
  assert.equal(page.campaign_source, 'instagram'); assert.equal(page.campaign_medium, 'paid_social');
  assert.equal(page.campaign_name, 'veylet_waitlist_20260927'); assert.equal(page.campaign_content, 'walkthrough_demo');
  assert.equal(page.page_location, 'https://veylet.com/');
  assert.doesNotMatch(JSON.stringify([h.ga(), h.meta(), h.local, h.session, h.cookieWrites, h.scripts.map(script => script.src)]), /PRIVATE_CLICK|fbclid|_fbc=/);
});

for (const campaign of organicCampaigns) test(`registered organic ${campaign.source}/${campaign.content} reaches GA only after analytics consent`, () => {
  const pathname = campaign.source === 'facebook' ? '/request' : '/';
  const query = campaignQuery(campaign); query.set('fbclid', 'PRIVATE_CLICK_CANARY');
  const h = harness({ url: `https://veylet.com${pathname}?${query}` });
  assert.deepEqual(h.replaced, [pathname]); assert.equal(h.window.location.search, '');
  assert.equal(h.scripts.length, 0); assert.deepEqual(h.ga(), []); assert.deepEqual(h.meta(), []);
  h.choose(true, false);
  assert.equal(h.scripts.length, 1); assert.match(h.scripts[0].src, /^https:\/\/www\.googletagmanager\.com\//);
  assert.deepEqual(h.meta(), []);
  assert.equal(h.track('funnel_cta_click', { destination: 'offer', placement: 'body', email: 'PRIVATE_FORM_CANARY' }), true);
  const events = h.ga().filter(args => args[0] === 'event');
  assert.deepEqual(events.map(args => args[1]), ['page_view', 'funnel_cta_click']);
  for (const [, , params] of events) {
    assert.deepEqual([params.campaign_source, params.campaign_medium, params.campaign_name, params.campaign_content],
      [campaign.source, campaign.medium, campaign.name, campaign.content]);
    assert.equal(params.page_location, `https://veylet.com${pathname}`); assert.equal(params.page_referrer, '');
  }
  if (pathname === '/request') {
    h.choose(true, true);
    assert.equal(h.scripts.length, 1, 'Meta stays off the enquiry form even with advertising consent');
    assert.deepEqual(h.meta(), []);
  }
  assert.doesNotMatch(JSON.stringify([h.local, h.session, h.writes, h.cookieWrites]), /pilot_202609|organic_social|facebook|instagram|PRIVATE/);
  assert.doesNotMatch(JSON.stringify([h.ga(), h.meta(), h.replaced, h.local, h.session, h.writes, h.cookieWrites, h.scripts.map(script => script.src)]),
    /PRIVATE|fbclid|_fbc=|utm_source|utm_medium|utm_campaign|utm_content/);
});

test('organic missing, duplicate, unknown and legacy incomplete UTMs are stripped and counted without attribution', () => {
  const cases = [];
  for (const campaign of organicCampaigns) {
    const pathname = campaign.source === 'facebook' ? '/request' : '/';
    const known = campaignQuery(campaign);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const missing = new URLSearchParams(known); missing.delete(key);
      const duplicate = new URLSearchParams(known); duplicate.append(key, known.get(key));
      const unknown = new URLSearchParams(known); unknown.set(key, 'PRIVATE_UNREGISTERED_CANARY');
      cases.push(...[missing, duplicate, unknown].map(query => ({ pathname, url: `https://veylet.com${pathname}?${query}` })));
    }
  }
  const legacy = 'https://veylet.com/?utm_source=ig&utm_medium=social&utm_content=link_in_bio';
  cases.push({ pathname: '/', url: legacy }, { pathname: '/', url: legacy + '&fbclid=PRIVATE_CLICK_CANARY' });
  for (const { pathname, url } of cases) {
    const h = harness({ url, choice: consent(true, true) });
    // The query is stripped to the clean path, which then counts, but an unmatched tuple attaches no campaign.
    assert.deepEqual(h.replaced, [pathname], url);
    assert.ok(h.scripts.length >= 1, url);
    const events = h.ga().filter(args => args[0] === 'event' && args[1] === 'page_view');
    assert.equal(events.length, 1, url);
    assert.equal(events[0][2].campaign_source, undefined, url + ' carries no attribution');
    assert.equal(events[0][2].page_location, `https://veylet.com${pathname}`, url);
    assert.doesNotMatch(JSON.stringify([h.ga(), h.meta(), h.local, h.session, h.writes, h.cookieWrites, h.scripts.map(script => script.src)]),
      /PRIVATE|pilot_202609|organic_social|utm_source|utm_medium|utm_campaign|utm_content|link_in_bio/, url);
  }
});

test('a registered tuple keeps attribution even with an extra stripped key; the extra value is never forwarded', () => {
  for (const campaign of organicCampaigns) {
    const pathname = campaign.source === 'facebook' ? '/request' : '/';
    const query = campaignQuery(campaign); query.set('utm_term', 'PRIVATE_TERM_CANARY');
    const h = harness({ url: `https://veylet.com${pathname}?${query}`, choice: consent(true, false) });
    assert.deepEqual(h.replaced, [pathname]);
    const view = h.ga().find(args => args[0] === 'event' && args[1] === 'page_view')[2];
    assert.equal(view.campaign_source, campaign.source);
    assert.equal(view.campaign_content, campaign.content);
    assert.doesNotMatch(JSON.stringify([h.ga(), h.local, h.session, h.writes]), /PRIVATE|utm_term/);
  }
});

test('click IDs alone are discarded; unknown/duplicate campaign fields strip and count; failed URL cleanup never loads vendors', () => {
  const h = harness({ url: 'https://veylet.com/?fbclid=PRIVATE_CLICK', choice: consent(true, true) });
  assert.equal(h.scripts.length, 2); assert.deepEqual(h.replaced, ['/']);
  assert.doesNotMatch(JSON.stringify([h.ga(), h.meta()]), /PRIVATE|campaign_source/);
  const known = '?utm_source=facebook&utm_medium=paid_social&utm_campaign=veylet_waitlist_20260927&utm_content=walkthrough_demo';
  // Each of these is stripped to '/', which counts; only the exact paid tuple (first) keeps its attribution,
  // and no private value from any of them is forwarded or persisted.
  for (const query of [known + '&email=PRIVATE', known + '&utm_source=facebook', known.replace('walkthrough_demo', 'PRIVATE'),
    known.replace('facebook', 'PRIVATE'), '?fbclid=one&fbclid=two', '?fbclid=PRIVATE&token=PRIVATE']) {
    const stripped = harness({ url: 'https://veylet.com/' + query, choice: consent(true, true) });
    assert.deepEqual(stripped.replaced, ['/'], query);
    assert.ok(stripped.scripts.length >= 1, query);
    assert.doesNotMatch(JSON.stringify([stripped.ga(), stripped.meta(), stripped.local, stripped.session, stripped.writes, stripped.cookieWrites]),
      /PRIVATE|email=|token=|&utm_|\?utm_/, query);
  }
  assert.equal(harness({ url: 'https://veylet.com/' + known, choice: consent(true, true), failReplaceState: true }).scripts.length, 0);
});
