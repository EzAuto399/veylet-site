/* Public identifiers only. Adding a campaign requires an exact reviewed tuple. */
window.VEYLET_ANALYTICS_CONFIG = Object.freeze({
  deploymentEnabled: true,
  gaMeasurementId: 'G-M4SLEMNVP6',
  metaPixelId: '1617470229766948',
  // Keep Meta off data-entry pages until actual vendor payloads are inspected.
  metaFormTrackingEnabled: false,
  consentVersion: 1,
  consentMaxAgeDays: 180,
  // Proposed links only; this registry does not launch or fund a campaign.
  campaignRegistry: Object.freeze([
    Object.freeze({ source: 'facebook', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' }),
    Object.freeze({ source: 'instagram', medium: 'paid_social', name: 'veylet_waitlist_20260927', content: 'walkthrough_demo' }),
  ]),
});
