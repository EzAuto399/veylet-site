/*
 * App Store launch switch. ONE line decides whether the public site shows the
 * App Store download experience. Nothing else changes.
 *
 *   appStoreLive: false   pre-approval: waitlist/TestFlight copy shows; no App Store badge
 *   appStoreLive: true    launch: "Download on the App Store" badge shows; waitlist/TestFlight copy hides
 *
 * Only flip this to true AFTER "Veylet Capture" is publicly available at
 *   https://apps.apple.com/au/app/id6814273913
 * Apple's badge licence permits the badge only once the app is live, so the
 * App Store badge and links ship hidden and stay hidden until this is true.
 *
 * Pages carry the pre-approval words in their markup, and every App Store element
 * ships with the `hidden` attribute, so with this flag off — or with JavaScript
 * off — the site reads exactly as the pre-approval site. dist/launch.js applies
 * this flag to the marked elements (tests/launch-flag.test.cjs checks both states).
 *
 * App Store links carry a per-placement campaign token: ct=web_home_hero, web_stays,
 * web_agents, web_see, web_offer.
 * TODO: add the provider token pt=<id> to those links only once App Store Connect
 * Analytics has data and has issued the provider id; until then ct alone is used.
 */
window.VEYLET_LAUNCH = Object.freeze({ appStoreLive: false });
