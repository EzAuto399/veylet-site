# Hosted player checks

Run `node --test tests/*.test.cjs` for existing-session restore, account/review/share/revoke/withdrawal behavior, role and stale-response protection, responsive embed generation, copy recovery, package limits, iframe isolation and versioned renderer readiness checks.

For real browser verification, run:

```sh
python3 scripts/serve-player-check.py --package /absolute/path/to/an/approved-synthetic-export.zip
```

Open `http://127.0.0.1:8904/__qa/` in a browser. Confirm account isolation reports true and the retained viewer actually renders at desktop and phone width. A frame load event alone is not sufficient. Inspect console exceptions and navigation before acceptance. Stop the server afterward. Only dist and the two exact fixture routes are served; the export's parent directory is never mounted.

The 20 September check passed the account-isolation fixture and visually rendered the retained synthetic package at desktop and 390px, with no observed runtime exceptions. This does not prove physical-phone performance, customer reconstruction quality or live Supabase delivery.

The coordinated release and live checks are recorded in the sibling product repository's `docs/hosted-closeout-20260920.md`. Do not deploy these player changes as proof that the backend migration or phone update is complete.

Hosting and sharing fixture cases (23 September 2026):

- `/__qa/account/`: live on an active plan, live after the plan ended (within
  term and past its guaranteed date), approved but not shared, sharing off after
  release, awaiting approval; builder chooser and Copy embed code on live cards.
- `/__qa/account/?case=hosting-errors`: hosting dates fail; sharing still works.
- `/__qa/studio/`: Hosted walkthroughs, due soon first, Record extension
  (`?studio=hosted-empty`, `?studio=hosted-errors`).

Walkthrough packs and the single-plan members' annual price (offer 2026-09-24.2):

- `/__qa/account/?packs=choose|credits|not-activated|not-owner|error|loading|missing`:
  the Walkthrough packs card (default `choose` on an activated desk). Add
  `&lane=sandbox|closed|error` for the card lane, `&pack-checkout=payment_declined|checkout_failed|not_eligible|lane_closed|invalid_request|fail`
  to refuse the next purchase, `&tokenize=fail` to decline the card in the Square
  stand-in, and `&packs-card=open` to press the buy button once for a capture. A
  purchase adds its walkthroughs to the balance the plan panel's capacity reads.
- `/__qa/account/?annual=renewal-off|invoice|scheduled|scheduled-team|missing|…`: the
  annual plan card (formerly the members' annual price) for the Veylet plan only;
  `scheduled-team` is a year bought on the retired Team plan, which must still read by
  its own name; `missing` hides the card.
- `?case=plan-team-active`: an existing invoiced Team row, still named Team.

Billing hardening, corrections and the capture queue (backend migrations
20260924130000 and 20260924140000, not yet released):

- `/__qa/account/?annual=start-failed` (and `start-failed-retrying`): the first
  yearly charge failed; Try another card restarts the year at the price it was
  bought at, Cancel yearly plan is confirmed. `&checkout=payment_declined` answers
  402; `&lane=closed|error` shows the failure with the studio as the way forward.
- `/__qa/account/?case=correction`: version 1 of a walkthrough is live and the
  studio's correction (version 2) waits for its check, whose panel reads
  `get_walkthrough_revision`; approving it moves the link and hides version 1. A
  second space shows a walkthrough whose replaced version is not listed.
  `?case=correction-superseded` refuses the approval with
  `VEYLET_REVISION_SUPERSEDED` and reloads onto version 3. `?lineage=missing`
  answers the tour query as a database without the lineage columns.
- `/__qa/studio/`: Money exceptions (`?money=empty|error|loading`), the Capture
  queue and its last 7 days (`?queue=empty|error|loading`, `?sla=error`), and
  Record correction (`?correction=open`; package `9f8e7d6c-0000-4000-8000-000000000a0a`
  corrects the harbour loft's `1a2b3c4d-0000-4000-8000-000000000001`; a
  `c0ffee00-…-0b0b` package of another space is refused).

Offer v8 (2026-09-25.1), against the names in the sibling repository's migration
`supabase/migrations/20260925100000_offer_v8.sql` (not yet released; a case without a
new field answers as today's server):

- Plan rows run 3 free months with 6 walkthroughs, ending 1 December 2026; the
  trial sentence reads "Free until {date}, then {price} unless you cancel."
- `/__qa/account/?case=plan-monthly-banked`: an active monthly Veylet plan whose
  capacity answer carries `allowance_kind: 'monthly'` and `banked_units: 2` (inside
  `included_limit`, so 3 this month).
- `?case=plan-annual-pool`: an active annual Veylet plan (A$790 a year) whose
  capacity answer is `allowance_kind: 'annual_pool'`, 5 of 12 used, resetting
  15 July 2027; `?case=plan-annual-bonus` adds `bonus_credits_available: 2` (also
  counted in `extra_credits_available`).
- `?annual=`: one public price (tier `standard`), open once the free months have
  started (`locked-start` before them); every answer carries
  `early_annual_bonus: { walkthroughs: 2, granted, available }`, available on the
  trial cases (dated by `starts_on`, 1 December 2026); `no-bonus` is `renewal-off`
  with it already granted. `locked-accept` and `one-month` are legacy answers.
  Without `?annual=`, an active annual plan hides the card and `plan-active` /
  `plan-monthly-banked` start the year when the month ends.
- `?referral=missing|link|sandbox|invalid|error|loading` answers `get_referral_code`
  (default `missing`: the function does not exist yet, so Refer an office is words
  only; `link` builds `https://veylet.com/account?ref=7a3f09c2b41e` and shows
  2 offices referred and 1 bonus walkthrough received).
- `?ref=0123456789ab`: arrived through another office's link; the owner of the
  (trial) desk records it with `claim_workspace_referral`; add
  `&claim=self|paid|unknown|error` for the server's refusals. `?session=out` shows
  the signed-out page, with the referral line when `?ref=` is present.
- `/__qa/studio/`: accounts on 3 free months; `studio_grant_referral_bonus`
  (Wren & Fielding records Northgate as its referrer and is paying, so the grant
  succeeds once, then answers `already_granted`; `?studio=referral-granted` starts
  granted); `studio_set_listing_home` (listing `5e6f7081-0000-4000-8000-00000000000c`
  is locked, any other listing id is not); the annual invoice at 79000 cents is
  refused while free months run ("early paid switch during free months is not
  available") and while the tier is `closed`; `?studio=trial-ended` gives Kelvin
  Grove Dental studio-invoiced free months that ended yesterday, so an annual from
  that day records and earns the early-annual bonus.

Offer v9 (2026-09-25.2), built to `docs/design/offer-v9-20260925.md` with proposed
backend names (the migration `20260925105000_offer_v9.sql`, `get_trial_offer`,
`get_express_offer`, `use_express_credit`, `studio_express_queue` and the hooks routes
`POST /square/trial/start` and `POST /square/express/checkout` do not exist yet; a
missing function answers PGRST202 and its card stays away):

- Plan rows are A$99 (A$119.99 App Store) for 2 a month; `?case=plan-monthly-banked`
  banks 2 of at most 4; `?case=plan-annual-pool` is 5 of a 24-walkthrough pool at
  A$990, and `plan-annual-bonus` adds the continuity bonus's 4 walkthroughs as bonus
  credits. Every `?annual=` answer carries A$990 and
  `early_annual_bonus: { walkthroughs: 4, express_renders: 4, granted, available }`.
- `/__qa/account/?case=plan-pending`: Start your free months with a card on file.
  `?trial=choose|used|not-owner|error|loading|missing` (default `choose`: A$99 a month
  or A$990 a year, first charge 3 months from today, Brisbane); `&lane=closed|sandbox|error`;
  `&trial-start=payment_declined|trial_used|abn_invalid|not_eligible|lane_closed|checkout_failed|fail`
  refuses the next start; `&trial-card=open` types the ATO's example ABN
  (51 824 753 556) and presses the card button once. A start turns the plan row into
  web-card free months ending on the first charge day.
- `/__qa/account/?express=offer`: the fictional terrace house with one sent capture and
  the Express render block (A$29, ready 2 business hours from now, 2 of 5 taken).
  Other answers: `credit` (4 express renders from the bonus), `full` (5 of 5 taken),
  `not-owner`, `ordered`, `ordered-credit`, `met`, `missed` (A$29 refunded),
  `missed-pending`, `missed-credit`, `error` and `missing`;
  `&express-checkout=<error code>|fail` refuses the next card order and
  `&express-card=open` presses Express for A$29 once.
- `/__qa/studio/`: the Express renders band before the capture queue
  (`?express=empty|error|loading|missing`), an express job first in the capture queue
  against its 2-hour target, invoices at 9900 and 99000 cents with the early-annual
  bonus of 4 walkthroughs and 4 express renders, and the correction reason
  `first_walkthrough_redo` (the harbour loft's walkthrough is its account's first
  accepted one; `?studio=redo-used` has used the redo already).

Render status (25 September 2026), built to the sibling repository's
`docs/render-status-contract-20260925.md` and aligned with its migration
`supabase/migrations/20260925110000_render_status.sql` (not yet released):
`list_workspace_render_status(p_workspace_id)` answers `{ active, poll_seconds, spaces:
[{ property_id, job }] }`, each job carrying the server's `state`. `node --test
tests/render-status.test.cjs` covers the words, the one filled action, the live region,
polling start and stop, and that nothing unsent is shown.

Fully automatic (owner decision, 25 September 2026): no person checks a walkthrough.
An automatic quality check decides, the walkthrough is usually ready for review within
1–2 hours of the upload finishing, and the express render is now the Super fast render
(about 30 minutes, any day, no daily cap). The `studio-check` render case and the express
fixture's 2-business-hour and 5-a-day answers in this file describe the account fixture before
that decision; public pages (`/`, `/offer`, `/start`, `/terms`, `/privacy`, `llms.txt`)
already use the new words, checked by `tests/offer-page.test.cjs` and
`tests/pricing-clarity.test.cjs`.

- `/__qa/account/?render=uploading|waiting|rendering|studio-check|ready|live|recapture|retrying|failed|stale`:
  the fictional terrace house's capture (the express fixture's capture) in that state.
  `ready` and `live` add its walkthrough to the tours; `&case=operator` reads `ready` as
  the owner's turn.
- `?render=all`: one fictional space per state. `?render=walk`: every read moves the
  capture on (sending, 2nd then 1st in line, steps 1 to 5, the studio check); the studio
  check is not active, so reads stop there, and coming back to the tab (or Refresh
  spaces) reads it as ready for review, with its walkthrough on the desk.
- `?render=empty|loading|error|missing` (default `missing`: the function does not exist
  yet, so the desk reads as before); `&render-poll=error` fails every read after the
  first; `&render-fields=none` sends no step, percentage, time left, position or start.
- `?render=rendering&express=ordered`: the status's "Express: ready by …, or refunded"
  beside the express block's due time.

Additional exact QA routes on the same server:

- `/__qa/account/`: fictional signed-in owner; review, share, copy, revoke and withdraw locally.
- `/__qa/account/?case=errors`: unavailable tour query without pretending the property is empty.
- `/__qa/account/?case=operator`: operator cannot review its own work.
- `/__qa/embed/?t=synthetic-fixture-token`: click-to-load synthetic sandbox document.
- `/__qa/embed/?t=synthetic-fixture-token&case=errors` or `&case=missing`: retry or inactive-link recovery.
- `/__qa/website-guide/`: the guide with its sharing module retargeted at this
  loopback origin, so the on-page "Test it here" embed reaches the fixture.
  Paste `http://127.0.0.1:8904/handoff?t=synthetic-fixture-token`. The preview
  is parsed out of the copied snippet, so a preview that renders while the
  snippet would not is a fixture fault, not a passing check.

These synthetic components do not prove a real 3D renderer or hosted backend. Real version-1 packages need a source-checked renderer receipt and visual review. Ordinary `iframe.onload` only proves the document opened. The final candidate gate is documented in the website README and sibling product release evidence.

For the retained portable package, `/__qa/` displays `retainedPackageReadiness`. Require `viewer-ready` plus an actual visible scene. `/__qa/?graphics=disabled` creates an in-memory derivative with graphics APIs disabled before viewer startup; require `viewer-failed` and the clearly labelled source photograph. The original ZIP is not modified. This is a forced-failure fixture, not a second reconstruction.

Player v2 (streamed packages, 25 September 2026). Serve a package folder copied
out of private storage, never `.local/` itself:

```sh
python3 scripts/serve-player-check.py --port 8906 --gzip --package-v2 /path/to/scratch/package
```

Only `manifest.json` and the files its manifest lists are served, at `/__qa/v2/`.
`--gzip` compresses JS, CSS and JSON the way the CDN does.

- `/__qa/handoff/?t=synthetic-fixture-token&format=v2` and
  `/__qa/embed/?t=synthetic-fixture-token&format=v2`: the share lookup answers
  `package_format_version: 2` and `package_base_url: /__qa/v2/`.
- `/__qa/play/?id=synthetic-tour&format=v2`: the owner preview through the
  proposed `get_tour_package_base` locator.
- `&graphics=none`: WebGL and WebGPU removed before the player runs; the poster
  and the "3D can't open in this browser" message must show.

`node --test tests/tour-player-v2.test.cjs tests/vendor-qrcode.test.cjs` covers
the manifest and location rules, budgets, the frame governor, progressive load
order, stops, the fallback, v1/v2 routing and the QR generator. These use a
stand-in DOM (`tests/fake-dom.cjs`); rendering is proven only in a browser.
