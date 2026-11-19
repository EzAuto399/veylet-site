# Veylet Cloudflare source adapter — 11 October 2026

## Super fast gate wording — 19 November 2026

User authority: "just mention fasteset GPU avaliable instead of Australia" (19 Nov). Source `8582aec` (`main`), frozen in the following commit: the Super fast availability gate in `/terms` and the live fields of `offer/offer.json` now say "GPU-start probe on the fastest GPU available" instead of "Sydney GPU-start probe"; offer `history[]` records are unchanged.

1. **Build:** 1130 of 1130 site tests; `check-app-pages.mjs` clean; `npm run build` and `npm run verify` pass (365 source, 364 output files); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions).
2. **Hosted release:** preview `ffe3c41a-1e97-4146-8265-2fd45c6dcdc6`; production `5cc9e1a7-6c91-4f19-9961-62bbafce4214`.
3. **Readback on veylet.com:** `/terms`, `offer/offer.json`, `account.js` and `build-info.json` match the built output byte for byte; no "Sydney GPU" left on `/terms`; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** owner legal review of the new terms wording; hosted sign-in/payment/capture journeys.
5. **Recovery:** previous production version `3d33582b-9cd9-4ad8-8b40-f1ed589ea302`: `wrangler rollback 3d33582b-9cd9-4ad8-8b40-f1ed589ea302 --config wrangler.production.jsonc`.

## Merged release lines — 19 November 2026

User authority: "we need to merge all banches and what not to main and deploy the latest improvemnts" (19 Nov). Source `be09999` (`site/main-release-20261119`, `main` `4f2cf26` plus the unmerged lines `codex/rc60-rooms-integration-20261114`, `codex/veylet-home-release-20261112`, `ui/craft-20261110` and the draft `site/privacy-20261112`), reconciled in `be09999` and frozen in `52be5b0`: server-declared allowance units end-to-end (unmarked captures say "of your allowance" and never borrow another workspace's room denominator; the studio desk reads yearly-pool counts from the account row instead of a hardcoded 360), the "Banked rooms after stopping" terms paragraph restored to public terms, and the duplicated sign-in notes block removed. ui/craft's station-tether spec was dropped: the shipped player is point-to-point only.

1. **Build:** 1130 of 1130 site tests; `check-app-pages.mjs` clean (43 states, 42,468 strings); `npm run build` and `npm run verify` pass (365 source, 364 output files, 322 unchanged, 42 transformed); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions).
2. **Hosted release:** preview `51df9c59-cbb5-4a52-a58b-845ad01ba2aa`; production `3d33582b-9cd9-4ad8-8b40-f1ed589ea302`.
3. **Readback on veylet.com:** `/`, `/terms`, `/privacy`, `/offer`, `/request`, `/see` and `build-info.json` (c745d4c, 2026-11-19T12:25:51Z) match the built output byte for byte; `www` 301s to the apex; no `insights.js` reference served; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** rendered appearance on a real phone, hosted sign-in/payment/capture/player journeys, real waitlist/booking submissions.
5. **Recovery:** previous production version `4e36b0a8-f9e3-479e-965e-b0ee4e8ca9ef`: `wrangler rollback 4e36b0a8-f9e3-479e-965e-b0ee4e8ca9ef --config wrangler.production.jsonc`.

## Main release — 19 November 2026

User authority: "deploy latest changes live" (19 Nov). Source `main` `4f2cf26` (merged PRs #10–#15: desk today-first index and space views, home hero MP4 wording, SEQ capture-session booking form, enquiry route naming, QA fixes), stamped and re-pinned in `7c59375`. The public `/privacy` Vercel page-count paragraph now sits under an `h2`; the adapter's per-path paragraph transform removes it exactly (`privacyParagraphByPath`).

1. **Build:** 1123 of 1123 site tests; `check-app-pages.mjs` clean (43 states, 42,377 strings); `npm run build` and `npm run verify` pass (365 source, 364 output files, 322 unchanged, 42 transformed); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions).
2. **Hosted release:** preview `a4f054db-2725-4f83-88ad-7a458466b93b`; production `4e36b0a8-f9e3-479e-965e-b0ee4e8ca9ef`.
3. **Readback on veylet.com:** `build-info.json` names `4f2cf26` (2026-11-19T11:35:03Z); `/`, `/privacy`, `/request` and `/see` match the built output byte for byte; `www` 301s to the apex; AASA is JSON; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** rendered appearance on a real phone, the booking form end to end, hosted sign-in/payment/capture/player journeys.
5. **Recovery:** previous production version `4e1356cc-0bb1-45fe-b93e-118e703811e0`: `wrangler rollback 4e1356cc-0bb1-45fe-b93e-118e703811e0 --config wrangler.production.jsonc`.

## Buyer paused name and design-spec release — 19 November 2026

User authority: "Push the website branch too, merge and get all into main and live operating" (19 Nov). Source `main` `a617bd2` (the `site/launch-fixes-20261119` line, `eaba8cf`), stamped and re-pinned in `a617bd2`.

1. **Build:** 1109 of 1109 site tests; `check-app-pages.mjs` clean (43 states, 42,299 strings); `npm run build` and `npm run verify` pass (365 source, 364 output files, 322 unchanged, 42 transformed); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions); local health check 39/39. The frozen allowlist was re-pinned for 6 changed hashes with no path or header change.
2. **Hosted release:** preview `45564b4b-2836-414d-b899-84f28430d3da`; production `4e1356cc-0bb1-45fe-b93e-118e703811e0`.
3. **Readback on veylet.com:** `build-info.json` names `eaba8cf` (2026-11-19T03:03:29Z); `tour-player.js` is byte-identical to the built output and contains `lookup_tour_share_pause`; the waitlist script sends `p_business_type`, `p_region` and `p_channels`; `www` 301s to the apex; AASA is JSON; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** a real paused buyer link naming an agent in a browser, a real waitlist submission (writes a row and sends staff email), rendered appearance on a phone, and hosted sign-in/payment/capture.
5. **Recovery:** previous production version `4d74f68f-9be0-4f33-8a82-97db321a1750`: `wrangler rollback 4d74f68f-9be0-4f33-8a82-97db321a1750 --config wrangler.production.jsonc`.

## Launch fixes — 19 November 2026

User authority: "Yes, deploy" (19 Nov). Source `287094f` (`site/launch-fixes-20261119`, off `main` `c98596c`), stamped and re-pinned in `d8126f0`: the buyer viewer keeps its layout under Reduce Motion and leaves room for the taller agent bars, hero buttons clear the privacy bar on phones, session links preselect, the Book viewing form fits a phone, the staff desk can admit a pending account (`studio_admit_for_purchase`), and the account desk says approval progress beside "Approve and share".

1. **Build:** 1103 of 1103 site tests; `npm run build` and `npm run verify` pass (365 source, 364 output files); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions); `scripts/check-app-pages.mjs` clean.
2. **Hosted release:** preview `2fad5ec8-e159-42db-b388-3b64a75fa160`; production `4d74f68f-9be0-4f33-8a82-97db321a1750`.
3. **Readback on veylet.com:** `index.html`, `start/index.html`, `studio.js`, `account.js`, `client-page.js`, `style.css`, `tour-stage.css`, `refinement.css` and `build-info.json` (287094f) match the build byte for byte; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** rendered appearance on a real phone (Reduce Motion viewer, Book viewing form); the desk Admit form and the approval progress line in a signed-in browser; hosted sign-in, payment, capture and player journeys.
5. **Recovery:** previous production version `c681df38-fbc6-4b4f-a02b-18e6a3b8e301`: `wrangler rollback <version> --config wrangler.production.jsonc`.

## Privacy processing location — 19 November 2026

User authority: "Yes, fix both" (the wording), then "Commit and deploy" (19 Nov). Source `4b3dfe8` (`site/privacy-render-region-20261119`, off `main` `162d958`), stamped and re-pinned in `41ed353`: `/privacy`, `/app/privacy`, the privacy guide and `llms-full.txt` now say walkthroughs are processed on cloud GPUs in the United States and that a capture is sent outside Australia for processing; both notices read "Last updated 19 November 2026". They previously said Australia (Modal, Sydney region), while client renders run in Modal's US region. Owner legal review of the new sentence is still required.

1. **Build:** 1094 of 1094 site tests; `npm run build` and `npm run verify` pass (365 source, 364 output files); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions); `scripts/check-app-pages.mjs` clean.
2. **Hosted release:** preview `137f6416-f52b-4371-9790-c2ed3e960e0c` (5 changed assets uploaded); production `c681df38-fbc6-4b4f-a02b-18e6a3b8e301`.
3. **Readback on veylet.com:** `/privacy`, `/app/privacy`, `/guides/privacy-3d-home-tour`, `llms-full.txt` and `build-info.json` (4b3dfe8) match the build byte for byte; the old sentence is gone from all three pages; `scripts/health-check.sh` 42 passed, 0 failed; `www` still redirects 301 to the apex with the path.
4. **Not checked:** rendered appearance of the pages in a browser; hosted sign-in, payment, capture and player journeys.
5. **Recovery:** previous production version `d169b66f-05fe-4fa7-911d-7b7b7323ca03`: `wrangler rollback <version> --config wrangler.production.jsonc`.

## Release 7 offer honesty — 19 November 2026

User authority: "Yes, both" (19 Nov, website deploy and build 63). Source `c1e8378` (`main`, = `site/r7-offer-honesty-20261118`), stamped and re-pinned in `bb37a57`: offer.json auto-renews and seats one account, packs not on sale, no Super fast advert, the free-month charge line on the hero, one nav that fits at 375 px, the waitlist state and the `/app/account` plan rows.

1. **Build:** 1094 of 1094 site tests; `npm run build` and `npm run verify` pass (365 source, 364 output files); 12 of 12 adapter tests; `npm run check:local` passes (4301 assertions); `scripts/check-app-pages.mjs` clean.
2. **Hosted release:** preview `a4c5f23f-698f-4cd2-81c4-a0af652f218d`; production `d169b66f-05fe-4fa7-911d-7b7b7323ca03`.
3. **Readback on veylet.com:** `index.html`, `offer/offer.json`, `account.js`, `build-info.json` (c1e8378) and `/app/account` match the build byte for byte; `scripts/health-check.sh` 42 passed, 0 failed.
4. **Not checked:** hosted sign-in, payment, capture and player journeys.
5. **Recovery:** previous production version `83ccf1e1-60d0-41d0-a61f-92c2efc05499`: `wrangler rollback <version> --config wrangler.production.jsonc`.

## App Store launch release — 17 November 2026

User authority: "Yes, preview", then "Yes, go live" (17 Nov). Source `ba376fb` on `site/launch-fix-20261117` (pushed, not merged to `main`): `site/unified-re-20261116` plus three commits that put the App Store button on all six guides, remove the TestFlight, "not on the App Store" and pilot wording, and re-pin `public-release.json`.

1. **Build:** 1030 of 1030 site tests; `npm run build` and `npm run verify` pass (362 source, 361 output files); 12 of 12 adapter tests. `npm run check:local` still fails at the known line-134 assertion described below.
2. **Hosted release:** preview `57be42c4-ea37-433f-8f70-97d52cc41fc6`; production `7196d6ed-4b15-4fc4-8abe-af168c56f620`. Deployed with `npx wrangler deploy --config wrangler.preview.jsonc`, then `--config wrangler.production.jsonc`.
3. **Readback on veylet.com:** all 98 `index.html` outputs match the build byte for byte; `scripts/health-check.sh` 42 passed, 0 failed; `www` still redirects 301 to the apex with the path.
4. **Not checked:** hosted sign-in, payment, capture and player journeys. The 125 files that changed since `main` came mostly from earlier merges and had no separate release review.
5. **Recovery:** previous production version `6f411a8c-7151-4e9e-b17e-b82bbf4f0ae7`, previous preview `ac8e9e4c-50b8-4e1e-b45b-85c3dbee6c64`: `wrangler rollback <version> --config wrangler.production.jsonc`.

## Demo sizing release — 11 October 2026

User authority: “give the demo some more space in size ratio please and fix and deploy.” Integrated source `f80b5e472cf4cd0f6fe6edc036ecef98457f28f4` changes only `/see` CSS, its HTML stylesheet version and the two matching public-release pins. The stage now fills the content width beneath compact copy/actions; the height-dependent and 900 px limits are removed. Viewer/video ratios, mobile switch, player logic, sample/licence, offer, Worker, configs, DNS and integration endpoints are preserved. The decorative connector is hidden to avoid crossing the new copy band.

1. **Source and build:** 20 page/cache tests and 12 adapter tests passed; 437 served asset references, staged secret/hygiene scan and diff checks passed. Maintained build/verifier passed before both uploads: 351 source files, 350 outputs. `public-release.json` source/deployment fields remain baseline provenance; the two current source pins and output manifest identify this scoped release. CSS SHA-256 `6b1929b43be4669d3cdebb1ec996d30f6cbe4ba3e899f382186d8dfb480195ff`; served HTML SHA-256 `11eeee60456eff0251362a5a27b5ab160540b2c8e2d8b48d960845aed9896a04` after the existing analytics transformation.
2. **Rendered proof:** at 1512 × 900 the viewer grows from 648 × 405 to 965 × 603 CSS pixels (48.86% wider/taller). The stage-width acceptance check fails on the old layout and passes on the candidate. 1512 × 900, 1280 × 800, 1024 × 768 and 375 × 812 show no horizontal overflow; equal-height desktop frames, mobile square viewer and both video cuts were checked. A 1512 × 650 window retains the same larger frame. The loaded local and hosted sample renders; Next stop navigation was checked. This is browser viewport proof, not physical-phone or reconstruction-quality acceptance.
3. **Hosted release:** preview `b7e664dd-81f0-403e-8798-8dc3d80e9025`; production `4144ff9a-190b-495d-a57f-968ffff4dd92`. Each upload reports exactly two changed assets. Five preview and six production readbacks match frozen output, including CSS version, home/offer/licence and www-to-apex behavior. Preview retains noindex; HTML revalidates and versioned CSS stays immutable. Evidence: [demo-space receipts and screenshots](/Users/yoda/Documents/Codex/2026-10-11/veylet-demo-space).
4. **Pre-existing local-runtime limit:** `npm run check:local` reaches the final production unapproved-host assertion at line 134, then expects 403 but gets 200. The untouched `25c614d` baseline reproduces this: Wrangler infers the canonical origin from production routes and Miniflare rewrites the supplied Host before Worker dispatch. Worker, configs and harness are byte-identical. The same baseline with an explicit unapproved dev origin returns 403/noindex, preserving denial proof. The full runtime suite is not reported green; its assertion is unchanged. [Actual baseline evidence](/Users/yoda/Documents/Codex/2026-10-11/veylet-demo-space/origin-harness-baseline.json).
5. **Recovery:** previous preview version `757cda34-fd54-4b2b-9561-d0b27eb30ab7`, previous production version `32eb8ae0-1eaf-49a1-a9c7-a6f807fd0d8f`, freshly read back before release. Root can run `wrangler rollback <version> --config wrangler.preview.jsonc` or the production config, preserving existing routes/DNS. Source recovery reverts the reviewed three-file sizing commit and rebuilds. No public Git push or automatic deployment was enabled. Existing positive account/payment/capture and installed-device gates remain separate from this layout release.

## Current HTTP redirect ownership — 11 October 2026

Root installed Cloudflare rule `2391bd861f48448f8c025a35debbff55`; the actual hostname receipt records 19 checks with zero failures. Apex/www HTTP now upgrade at Cloudflare with 308 and preserved host/path/query, so this step no longer depends on Vercel. HTTPS routes, latest demo sizing release and API origins are unchanged. See [the dated update](HTTP-REDIRECT-UPDATE-2026-10-11.md). The earlier `live-release.json`/route-maintenance snapshot below remains historical. This update changes documentation only and performs no hosted action.

## Earlier adapter and route-maintenance evidence

Prepared on `codex/cloudflare-veylet-hosting` in `/Users/yoda/.codex/worktrees/cloudflare-veylet-hosting/veylet-site`, based on exact release `26d5eda6596e72603cf5dbbae30f5cd5090b23b5`. A fresh Git-object comparison confirmed 351/351 frozen production assets match before isolation. Root independently verified the same release in [veylet-source-release-reconciliation.json](/Users/yoda/Documents/Codex/2026-10-11/cloudflare-migration/veylet-source-release-reconciliation.json). No base-checkout files, original public bytes or Vercel configuration changed. Base remains `live/veylet-com` at 142a7a8 with its pre-existing untracked `.local/` intact.

1. **Owned files.** Only `cloudflare/`: adapter/package/lock, public-release receipt, reviewed policy/Worker, configurations, tests/docs and new `live-release.json`. Generated `output/`, dependency `node_modules/` and `verification/` are ignored; private capture/customer/credential files are never deployment inputs. Root owns provider state and final acceptance.
2. **Current build and validation.** `npm run build` and `npm run verify` pass: 351 original public hashes checked; 350 outputs; 308 unchanged; 42 guarded HTML analytics transformations; one omitted Vercel-only insights asset. Twelve Node tests pass. The added configuration test rejects missing production routes, HTTP/scheme-less/wildcard/custom-domain routes, preview binding and account/Worker identity drift. Original guards still cover deterministic output, analytics/privacy transformations, public source boundary, tamper denial, origin/routing/cache/robots/range/error behavior. Worker, policy, public integration/media/AASA output bytes remain unchanged from the reviewed source adapter.
3. **Prior actual local runtime.** The earlier `npm run check:local` passed 4,146 assertions with pinned Wrangler 4.143.0 and the then-unbound configurations. It checked all preview bodies, exact headers, production loopback HTTPS routes/redirects, full 404/robots validator/range behavior, exclusions, media ranges, conditional/HEAD/write denial and origin controls. Its dated [receipt](verification/local-workerd.json) refers to the earlier manifest/config, not a new runtime run after declaring live routes. The route-only maintenance changes no Worker/public behavior; no broad repeat was needed. Ports 8896/8897 were stopped. The independent review of that runtime/source remains [veylet-adapter-review.md](/Users/yoda/Documents/Codex/2026-10-11/cloudflare-migration/veylet-adapter-review.md).
4. **Current live-route packaging.** Official Wrangler production dry-run passes at 61.87 KiB / 8.46 KiB gzip with only ASSETS and production marker. The 350 public regular files remain unchanged. Production now declares exactly `https://veylet.com/*` and `https://www.veylet.com/*`, zone `veylet.com`, over retained proxied Vercel CNAMEs. Account/name/vars unchanged; no custom domains/crons/secrets, production workers.dev/version URLs disabled. The new manifest binds the dated root-reported live release context and config hashes. No provider call, deployment, DNS update, remote push or automatic workflow was performed by this maintenance task.
5. **Root live phase and remaining gate.** Root reports production version `32eb8ae0-1eaf-49a1-a9c7-a6f807fd0d8f` active on the two exact HTTPS routes, apex 350-asset + 9 extra checks passing, www 301 to apex with path/query and retained HTTP-to-HTTPS upgrade through Vercel. Positive auth/account/lead/payment/capture and installed-device universal-link acceptance remain unverified by this adapter; endpoint bytes are not those journeys. Continuous deployment still needs reviewed remote branch/protection and route-edit authorization wiring. To roll back, root removes both HTTPS Worker routes while preserving existing CNAMEs/Vercel website/hooks/Supabase, pauses further deployments, then deliberately updates the maintained config/verifier before deploying again so routes are not recreated.

Retained-origin plan: the website's provider inventory has zero functions; original Vercel config has no function rewrites and frozen first-party scripts have no relative `/api/` reference. Supabase account/studio/lead origins and the separate Vercel-hosted hooks/payment/export origin remain unchanged. Keep both services active during website cutover; no website reverse proxy is introduced. Hooks migration is a separate backend step, and positive integration behavior still needs root acceptance at the same production callback domain. See [README.md](README.md) for exact source pointers.

Next action: root runs `npm run verify` in `cloudflare/` and reviews the exact two declared routes in `wrangler.production.jsonc`. Later owner-run production deploys use that configuration, preserving the active routes.

Independent read-only review was clear after the robots fix before live-route maintenance. The reviewer reconciled all 351 source bytes/header profiles, reran native 206/304 robots probes and verified the then-current 4,146-assertion receipt. This maintenance does not relabel that historical review or claim new hosted/device acceptance.
