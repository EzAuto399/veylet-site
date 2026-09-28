---
version: 1
slug: "dist-offer-index-html"
primary_target: "dist/offer/index.html"
related_targets: ["dist/index.html","dist/start/index.html"]
---

# Surface brief: /offer (dist/offer/index.html)

Scope: the public offer and prices page. Mode: Persuade. Audience: a person with a LiDAR iPhone who controls or is permitted in a space (agent, property manager, buyers' agent, builder, venue, clinic, showroom, photographer) deciding whether to install the app and start; secondary, an office deciding whether one plan covers it. Job: understand what it costs over time, what counts, what never costs anything, and take one action (Start with one space). Proof and content: the real trial and plan numbers from offer.json, the real steps of the app, the pilot status (no client-accepted example yet). Constraints: static HTML/CSS/JS, the incumbent Veylet world (ink on paper, sage, Outfit, hairlines, no cards), prices carried on data-price elements, no card payments on the site, no invented proof. Related: the homepage cost answer and hero, the first-tour page, llms.txt.

## Direction contract

Seed: 8bd8ff66 (surface scope, persuade; dealt lead, structure 3 of the ranked list: the itemised statement). Attended card choice was not possible in this session; the dealt lead was taken and this is disclosed in the report.

THESIS: The offer is a statement you could pin above your desk: every line is an amount, and the first six months of lines read A$0. It refuses the pricing-page trio of plan cards and the starter/pro/enterprise ladder; there is one plan, and the page's structure is the account's own ledger over its first year.

OWN-WORLD: Ink on paper, Outfit, hairline rules; amounts right-aligned in tabular numerals at statement scale (28 to 36px) while labels stay 15 to 17px; the sage accent appears only on the line where money first changes hands and on the accepted-walkthrough tally; no cards, no icons, no eyebrows; the closing invitation sits on the incumbent deep-green surface. With all copy removed you would still see a statement: a column of dates on the left, amounts on the right, a rule, a total.

STORY: The reader learns, in order, what they would do (capture with the phone in their pocket), what they get (a reviewed walkthrough with a link and an embed), what it costs across their first year (six dated A$0 lines, then A$119 a month), what counts as a walkthrough and what never costs anything, what a visit or onboarding adds, and the straight answers. They believe it because the numbers are itemised, the zeros are dated from their own first accepted walkthrough, and the page says plainly what is not yet proven.

FIRST VIEWPORT: Left, the two-tone headline "Capture it with your iPhone. / We make it a walkthrough." with a three-sentence intro, the pilot status and the primary action "Start with one space" plus a quiet "See how a first walkthrough runs". Right, the statement "Your first year, itemised": six rows of A$0 with their month spans, a rule, "Month 7 onward: Veylet plan A$119 a month", a first-year total, then the line of what every month includes. On phones the statement follows the headline and action.

SIGNATURE: The statement is live: a native date control "If your first walkthrough is accepted on" (defaulting to today) redates the six free months and the first paid month; without JavaScript the rows read Month 1 to Month 6 and no date is invented. One authored motion only: on first paint the amounts settle from muted to ink over 240 ms, off under reduced motion.

RISK: A statement can read cold. The intro and the "what never costs anything" block carry the warmth; the pilot note keeps it honest; nothing on the page may read as an invoice for money owed.
