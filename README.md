# Veylet public walkthrough site

A static Veylet introduction for OpenAI Sites. This dedicated checkout is the public site source of truth; the product and capture workspace remains separate.

Public files are in `dist/`. Only original concept-campaign assets, page code and the font licence are included. The application, private captures, internal reviews, campaign upload archive and local data are excluded.

## Positioning and visitor paths

Current audience direction, 14 September 2026: **3D walkthroughs for spaces people want to understand before they visit**. The managed route includes homes/property, clinics and visitor spaces, hospitality/venues, and showrooms/interiors/installation showcases. Real estate remains a segment, including private homes and overseas buyers. These are proposed uses requiring assessment, not verified deliveries in every sector.

Capture partners remain qualified independent professionals producing for their own clients through Veylet's workflow. Account creation, equipment/practice assessment and production approval are separate. A broader customer audience does not relax qualification.

The two primary paths are **Request a walkthrough** and **Apply for partner assessment**. Both currently open structured email briefs to the owner-authorised contact `yoda@yodalai.xyz`. Managed enquiries ask about space category, approximate size and areas, general region/location, viewer purpose, viewing destination, permission, excluded areas and timing/capture windows. Partner enquiries ask about work, exact equipment, operating system, service area and a permissioned portfolio. No message is sent by this website, and an email composer is not a submitted application.

No public application URL has been verified. Do not link to a localhost application or imply this static site creates accounts, grants partner access, accepts bookings or collects payment. The partner section explains equipment and practice review, approval and capture guidance. The native pilot's exact device/build still needs assessment; do not turn a broad hardware description into a compatibility guarantee.

The proposed initial hosting term is **three months**, with optional extension. Scope, price, timing, hosting and availability remain subject to an agreed quote and real delivery evidence. Residential pilot price examples are not universal prices for businesses or venues. Installation/interior walkthroughs are visual context or showcases, not measured surveys, BIM models, construction documents or installation specifications. Capture guidance supports quality within the service; no accredited qualification, lead supply or earnings promise is made.

## Evidence and publication

The film and nine-frame campaign are one original concept study. AI-generated imagery is disclosed beside the film and collection. They are not captured property proof or client case studies. There are no invented customers, ratings, production-readiness claims or unrelated product/brand-film offers.

The 13 September property-positioning revision and 14 September audience expansion are prepared locally. Neither was published by this task; actual live version must be checked independently before claiming the new copy is public. Preview it with:

```sh
python3 -m http.server 8893 --bind 127.0.0.1 --directory dist
```

Historical checks for the 13 September property revision passed at 320, 390, 768 and 1440 pixels: no horizontal overflow; primary navigation and actions meet a 44-pixel height; image loading, internal anchors, structured email destinations and gallery open/close work. The desktop hero and enquiry section were visually inspected. Evidence is in the product workspace's ignored `.local/experience-qa/public-property-results.json` and corresponding screenshots.

The ChatGPT Sites project in `.openai/hosting.json` is the **legacy** public URL (`veylet.justnewyodacc.chatgpt.site`). New hosting is Vercel from this checkout (`dist/`), with `veylet.com` as the intended custom domain after the owner purchases it. Do not treat the ChatGPT URL as the long-term operator door. The 14 September audience expansion also updates both email brief types while keeping the same authorised contact; no email was sent. Do not store source credentials in files or Git configuration.

The 14 September audience-expansion revision passed static browser checks at 320, 390, 768 and 1440 pixels: four audience groups, no horizontal overflow or card overlap, working internal anchors, complete managed enquiry fields and unchanged qualification language in the broadened partner brief. Desktop and 390-pixel audience layouts were visually inspected. Evidence is in the product workspace's ignored `.local/audience-expansion/public-verification.json` and screenshots. This is local static evidence, not a deployment or customer acceptance check.

## 17 September hardening revision (deployed)

A read-only walk of the published site found and this revision fixes:

1. **The client tour could not render.** `tour-player.js` built the iframe blob with `File.async('blob')`, which carries no MIME type, so the browser displayed the tour's HTML source as text instead of a walkthrough. It now writes `text/plain`-free HTML via `new Blob([markup], { type: 'text/html' })`.
2. **A blocked CDN froze the client page.** `/handoff` and `/play` imported `@supabase/supabase-js` and `jszip` from `cdn.jsdelivr.net` at module top level, so a blocked or offline CDN left the page on "Checking this link." with no error. Both libraries are now served from `dist/vendor/` (supabase-js 2.116.0, JSZip 3.10.2, licences alongside), loaded as local scripts.
3. **Fail-loud surfaces.** `tour-player.js` now runs the lookup, download and frame load under deadlines and always shows a message: token miss, service error with "Try again", timeout, storage failure, or non-playable package. `handoff.js` and `play.js` are removed; each page wires its own resolve step inline.
4. **`[hidden]` did not hide.** `.veylet-form { display: grid }` overrode the `hidden` attribute, so the account page showed the sign-in form, the code form and the dashboard at once. `[hidden] { display: none !important }` now wins.
5. **Sign-in emails are branded and a code path exists.** Branded templates and the Management API payload are in `.qa-review/supabase-handoff/`, with `RUNBOOK.md` for the owner steps. `/account` now accepts the six-digit code as well as the magic link, which protects against mail scanners consuming the link first.
6. **Dead navigation and stale copy.** `/apply`'s "Capture partners" and `/request`'s "Start here" pointed at `#partners` and `#enquire`, neither of which existed; both now go to the homepage route section. The desk no longer claims "There is no public client link yet" or "not a 3D player yet", and `/privacy` no longer says phone upload is not live.
7. **Concept campaign and route clarity.** All nine concept stills are now reachable (one 3:4 lead plus an eight-still rail), and the homepage explains the apply/request → assessment → pay → capture → handoff route, including that payment is invoiced until checkout is proven.

Local evidence for this revision: `.qa-review/verify_local.py` (36 page/viewport combinations, zero overflow, zero console errors, zero page errors, no tap target under 44px), `.qa-review/player_scenes.py` (stubbed handoff: renders, token miss, service error, timeout), `.qa-review/account_states.py` (stubbed sign-in: initial, code entry, wrong code, signed in), and `.qa-review/blob_mime_check.py` (the same stubbed package against live and local).

Deployed 17 September to Vercel production (`vercel --prod`, deployment `peo2dzEQwk4zdHrTgKYhnozsJXER`), aliased to `veylet.com`. After deploy, live checks confirmed: every page and asset byte-identical to `dist/` except the Cloudflare email rewrite on `/apply`, `/request`, `/privacy`, `/terms`, `/thanks`; `/play.js` and `/handoff.js` gone (404); a stubbed handoff renders `RECONSTRUCTED TOUR RENDERED` where it previously dumped source text; and no horizontal overflow at 390 or 1440. Still unverified, because they need owner credentials or the device: real share tokens, real sign-in, physical iPhone upload, FormSubmit delivery, Square.

