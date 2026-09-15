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
