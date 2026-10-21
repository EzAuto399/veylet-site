/* Public identifiers only. Adding a campaign requires an exact reviewed tuple. */
window.VEYLET_ANALYTICS_CONFIG = Object.freeze({
  deploymentEnabled: true,
  gaEnabled: true,
  metaEnabled: false,
  pageViewsOnly: true,
  gaMeasurementId: 'G-M4SLEMNVP6',
  metaPixelId: '',
  // Keep Meta off data-entry pages until actual vendor payloads are inspected.
  metaFormTrackingEnabled: false,
  consentVersion: 2,
  consentMaxAgeDays: 180,
  // Exact reviewed links only; registry entries do not launch or fund campaigns.
  campaignRegistry: Object.freeze([
    Object.freeze({ source: 'facebook', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' }),
    Object.freeze({ source: 'instagram', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' }),
    Object.freeze({ source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'faq' }),
    Object.freeze({ source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'room_connections' }),
    Object.freeze({ source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'before_capture' }),
    // Canonical Instagram bio link prepared for the social owner; not yet live.
    Object.freeze({ source: 'instagram', medium: 'organic_social', name: 'pilot_202609', content: 'link_in_bio' }),
    // Prepared for the 10 October enquiry card; native scheduling and QA unverified.
    Object.freeze({ source: 'facebook', medium: 'organic_social', name: 'pilot_202609', content: 'enquiry_details' }),
    // App Store launch, October 2026. Warm email to short-stay hosts and real-estate agents.
    Object.freeze({ source: 'email', medium: 'warm', name: 'launch-2026-10', content: 'stays' }),
    Object.freeze({ source: 'email', medium: 'warm', name: 'launch-2026-10', content: 'agents' }),
    // App Store launch, October 2026. Organic social for the two audiences.
    Object.freeze({ source: 'instagram', medium: 'social', name: 'launch-2026-10', content: 'stays' }),
    Object.freeze({ source: 'instagram', medium: 'social', name: 'launch-2026-10', content: 'agents' }),
    Object.freeze({ source: 'facebook', medium: 'social', name: 'launch-2026-10', content: 'stays' }),
    Object.freeze({ source: 'facebook', medium: 'social', name: 'launch-2026-10', content: 'agents' }),
  ]),
});
