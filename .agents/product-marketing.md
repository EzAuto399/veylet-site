# Product Marketing Context

**Document version:** v4
**Last updated:** 2026-09-17

> **Provenance.** Auto-drafted from the live site (`~/veylet-site/dist/`), the product
> workspace docs (`~/projects/property-3d-studio/docs/`), and a read-only audit of both.
> Anything the project has not proven is marked **UNPROVEN**. The single most important
> fact in this document: **no real capture has yet become a client-accepted tour.** Every
> proof point below is therefore a plan, a local result, or a competitor observation —
> never a delivery claim.

## Product Overview

**One-liner:** Know the space before you arrive.

**What it does:** Veylet turns a real interior into a browser walkthrough a client can
open from a link. Managed route: Veylet captures the space and delivers the tour.
Partner route: a qualified independent capture professional captures with Veylet and
delivers to their own client. The space owner never installs anything.

**Product category:** The shelf customers actually search on is *3D virtual tours for
property* — a category Matterport and iGUIDE own, sold mostly through real-estate
photographers. Veylet is not trying to win that shelf on features; it is trying to win
the segments that shelf ignores (clinics, venues, showrooms, completed installations)
where the buyer is not an agent and the tour is not a listing asset.

**Product type:** Service business with a software product underneath. Managed capture
is a done-for-you service; the operator route is a tool the operator pays to use. There
is a native iPhone capture app (Veylet Capture), a local reconstruction pipeline, a
hosted identity + storage backend (Supabase), and a public website that takes
applications and enquiries by email.

**Business model:** Pay per accepted space. No subscription required, free workspace.
Two revenue routes: managed capture (customer pays Veylet) and processing/delivery for
qualified partners. Payment is **invoiced** today; card checkout is deliberately off
(Square exists only as an unproven sandbox path).

**Pricing (INTERNAL — NOT PUBLISHED):** targets under discussion are A$289 compact
managed, A$349 standard managed, A$119 qualified-partner processing, each including
three months hosting. The public site deliberately shows no number and says "agreed
quote". The A$149 assisted self-capture offer is **retired**. GST registration is
unconfirmed, so no invoice may describe a GST charge yet.

## Target Audience

**Target companies:** Owner-operated and small-team spaces in South East Queensland
(Brisbane first): real-estate agencies and property managers, dental/medical clinics,
event and hospitality venues, showrooms and retail interiors, cabinetmakers/renovators/
fitout companies, education and cultural spaces. Typical size: one site to a handful,
no in-house 3D capability.

**Decision-makers:** Agency principal or marketing manager; practice owner or practice
manager; venue/event sales manager; showroom or marketing manager; cabinetmaker or
renovator business owner; admissions or facilities lead.

**Primary use case:** A decision that currently requires physically turning up —
a first visit, a shortlist, a booking, a fitout handover — made remotely and legibly.

**Jobs to be done:**
- "Let people see whether this space suits them before they travel to it."
- "Show finished work convincingly without flying the client out or re-shooting photos."
- "Hand a client a link I control, without publishing the space publicly."

**Use cases with permission-and-scope limits documented per segment:**
clinic reception/waiting/one empty consult room (no patients, no records on screen);
one venue room plus entrance and breakout (capacity/accessibility specs stay separately
verified); one stable showroom zone (layout changes need an update policy; product
specs are not implied); one completed installation as portfolio or private handover
(no fabrication dimensions, services or compliance implied); one learning studio or
gallery room without students/visitors present.

## Personas

| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| **Capture professional** (applies) | Paid work, equipment that qualifies, not being locked out of their own client relationship | Already owns LiDAR iPhone + skills; needs a tool that produces a client-ready tour | Apply free, get assessed on device + practice capture, then pay to use the system for your own clients. No jobs, no leads, no earnings promised. |
| **Space owner / business** (requests) | Cost certainty, permission, the space looking right, no technical work | Cannot justify a video crew; a photo gallery does not answer "will this work for us?" | We capture, we process, you get a link to send. You never install an app. |
| **Signed-in operator** (web desk + iPhone) | Knowing whether the tour is live, sharing it safely, revoking it if needed | Client links leak, forward, and become public by accident | Windows: save space → capture → publish to desk → preview → create unlisted handoff → revoke. |
| **Client on a handoff link** (no account) | Does this space work for me? | Wants to look now, on a phone, without signing up for anything | One tap, no account, no app, no marketing page in the way. Private link, not a gallery. |
| **Veylet Studio concierge** (the owner, today) | Judging fit, not wasting a capture on the wrong space | Every job is currently bespoke | Scope limits (area, rooms, lighting, permission) that make the second job repeatable. |

## Problems & Pain Points

**Core problem:** the people who need to judge a space are not in it, and the current
substitutes are weak. Photos flatten a room. Video is one fixed path. A floor plan is
not a feeling. So a decision that should take ten minutes becomes a site visit — for a
clinic patient, an event booker, a showroom buyer, a homeowner overseas.

**Why alternatives fall short:**
- **Matterport/iGUIDE via a property photographer** — built for listings, priced for
  agents, awkward for a clinic or a cabinetmaker, and the capture is someone else's
  appointment to manage.
- **Domain's bundled Matterport suite** — included with eligible Platinum sale
  listings, excluded for rentals/commercial, and its 3D use is restricted to Domain and
  the agency's own site. It removes budget for a listing tour but not the need
  elsewhere. (Competitor pricing and terms were read from provider pages on
  13 September 2026 and are unverified since.)
- **A photographer with a 360 camera** — delivers stills, not navigation.
- **DIY phone video** — cheap, unwatchable, and dates instantly.
- **Doing nothing** — the site visit is the default, and it is the most expensive option.

**What it costs them:** a site visit per undecided party; a booking lost to a venue
that "looked different online"; a completed fitout that cannot be shown to a remote
client; a clinic where anxious first-time patients arrive unprepared.

**Emotional tension:** *"Will it look as good as the photos suggested?"* on the buyer
side; *"Will this photographer make my space look amateur?"* on the owner side; and for
the operator, *"Will the tool make me look bad in front of my own client?"* — which is
the one that matters most, because the operator's reputation is on the link.

## Competitive Landscape

**Direct:** Matterport (via local photographers), iGUIDE. Falls short for
non-listing spaces on price framing, capture-appointment friction, and portal-first
plumbing the buyer does not need.

**Secondary:** a local 3D-tour photographer using Matterport under their own brand
(Borderland A$215–359 by bedroom band; R24 A$200–330 bundled with stills and a floor
plan; Dan Gardner A$250–330; Visual Spaces A$299 + A$100 Brisbane travel; Showcase
A$295–495; RE Photos A$395 with floor plan A$135 extra; Wingman from A$260; Real Estate
Images A$560–870; 360 Property Tours A$249). Falls short where the customer is a
business rather than an agency, or where the tour needs to live on their own site.
Note the cluster: **A$299–399 is the ordinary-house market**, so A$349 is a
market-rate position, not a discount story.

**Indirect:** the site visit, the video walkthrough, the photo gallery, and the
assumption that a physical visit is simply how it is done.

**Where Veylet is honestly behind:** no customer-accepted tour, no portal
(realestate.com.au) compatibility evidence, no floor plan, no photography bundle, no
measured-area product, and a quality bar that has been *rejected* in review, not merely
unproven (softness, ghosting, fast turns, an early pose discontinuity in the one real
120-view capture). None of that may be hidden in copy.

## Differentiation

**Key differentiators (as designed, not yet as proven):**
- **Same spine, two routes.** A managed capture and a partner capture produce the same
  tour, the same desk, the same handoff — so Veylet is not a marketplace matching
  operators to jobs, and not custom software per client.
- **Client link with no account.** The client needs no login, no app, no gallery
  membership. One unlisted link, revocable by the operator.
- **No capture app for the customer.** The person paying never installs anything.
- **Honest labelling as a feature.** Concept imagery is labelled as concept imagery.
  No invented customers, no ratings, no earnings claims.

**How we do it differently:** capture on the operator's own device, reconstruct
locally, publish to a hosted desk, then hand off. The operator keeps the client
relationship; Veylet keeps the workflow.

**Why that's better:** the operator is not renting a lead; the client is not signing up
for a platform; the space owner is not buying a listing product they will use once.

**Why customers choose us:** unproven, and this document should not pretend otherwise.
The defensible reason to choose Veylet today is scope honesty plus the handoff
mechanic — not quality, price or speed, none of which have been demonstrated.

## Objections

| Objection | Response (honest version) |
|-----------|----------|
| "How is this different from the Matterport tour my agent already gets?" | Different buyer, different job. If you need a realestate.com.au listing tour, that ecosystem is built for it and we have not proven portal compatibility. We are for the spaces that do not get a listing tour. |
| "Will the capture look good enough to show my client?" | We will not claim it does until a real capture passes our own review and a customer accepts it. That has not happened yet. This is a pilot, and we say so on the site. |
| "Why should I pay before I see a result?" | You should not. Applying is free, assessment is free, and the first managed scope is quoted before anything is invoiced. Payment is invoiced today, not taken by card on the site. |
| "I already own the client — why do I need you?" | You keep the client. Veylet is the processing and delivery system; you keep the relationship, the pricing to your client, and the capture. You do not get jobs, leads or earnings from us. |
| "Can I just get the file and host it myself?" | Not today. Hosting is part of the service for the included term, and export/retention tooling is on the open list, not shipped. |

**Anti-persona:** anyone who wants a job marketplace or lead supply; anyone who wants
Android or a non-LiDAR device today (rear LiDAR + ARKit is the supported route, and even
that is modelled rather than guaranteed); anyone who needs a *measured* survey, BIM
model, construction document or installation specification — Veylet produces visual
context, which is a different product; anyone whose space needs a whole-campus,
active-clinic or live-venue capture right now; agencies wanting portal-grade
Matterport replacement with a floor plan and photo bundle.

## Switching Dynamics

**Push:** the agent/photographer bundle is priced and scoped for listings; a clinic or
showroom is buying an awkward fit. Site visits are eating staff time.

**Pull:** a link the owner controls, no account for the viewer, and a company that does
not overstate what it has done.

**Habit:** "we already have photos, and we know the space." Repeat clients of an
existing photographer will not move for a comparable product — only for a space the
current photographer cannot serve well.

**Anxiety:** *"This is a local pilot on a free backend with no customer-accepted tour —
what happens if my tour does not arrive, or looks wrong, or the link leaks?"* The
answers that exist: revocable unlisted links, noindex, no public gallery, a real
person on email, and an invoiced (not prepaid) model. The answer that does not exist
yet: a demonstrated quality bar.

## Customer Language

**How they describe the problem** — no verbatim customer quotes exist yet. Discovery
has not started (three managed-customer and three qualified-partner conversations are
the pending first step), so this section is deliberately thin and must be filled from
real calls, not invented. The closest observed language is from provider pages:
"virtual tours", "3D walkthrough", "explore before you visit", "navigate event spaces
before booking".

**How they describe us:** unknown. No customer has said anything yet.

**Words to use:** walkthrough, space, capture, reconstructed tour, unlisted link,
private handoff, assessment, practice capture, agreed quote, invoiced, pilot, concept
imagery, visual context (not survey).

**Words to avoid:** "free" as a lead-in to a paid product; "jobs", "leads", "earnings",
"work"; "guaranteed", "fast", "instant"; "Matterport alternative" (unproven and
invites a comparison we lose on features); "measurement", "survey", "BIM", "floor
plan" (different products); "gallery", "marketplace"; AI-generation hype words;
anything implying a satisfied customer.

**Glossary:**
| Term | Meaning |
|------|---------|
| Veylet Studio | The managed capture and concierge side of the business |
| Veylet Capture | The native iPhone app the operator captures with |
| Operator / capture professional | An assessed independent professional who pays to use Veylet for their own clients. Not an employee, not a lead buyer. |
| Space | A captured property/venue/room record. Named "space", not "listing", on purpose. |
| Handoff | The unlisted, revocable client link to one tour |
| Preview | The signed-in owner's own view of a tour before handoff |
| Practice capture | The assessed sample capture that precedes approval |
| Concept study | Original AI-generated campaign imagery, labelled as such |

## Brand Voice

**Tone:** plain, specific, unhurried. Comfortable saying what it does not do.

**Style:** short declarative sentences. Numbers only when real. No exclamation marks.
No superlatives. States limitations in the same breath as capability — "we capture, or
independent operators apply, pay to use Veylet, and deliver for their clients."

**Personality:** exacting, quiet, architectural, candid, unglamorous about the work.

## Proof Points

**Metrics:** none publishable. There is no conversion rate, no delivery count, no
satisfaction score and no accepted tour.

**Customers:** none. No logos, no testimonials, no case studies. The site is
deliberately free of invented social proof.

**Testimonials:** none exist. Do not fabricate one.

**Value themes with real supporting evidence:**
| Theme | Proof that actually exists |
|-------|---------------------------|
| The technical spine works end to end | Local pipeline: real 120-view phone capture → Mac reconstruction → private preview (HTTP 200, anonymous 401), 68.42 s. **Local evidence only.** |
| The web journey works | Client handoff → tour renders → revoke kills the link, verified against stubbed contracts and deployed code. |
| Nothing is taken by surprise | Public pages state what does not happen: no account from applying, no payment on the site, no client link without a handoff, no earnings promise. |
| The pilot is honest about itself | Concept imagery labelled AI-generated; reviews that rejected quality are in the project record, not hidden. |

## Goals

**Business goal:** one real, customer-accepted walkthrough delivered through the full
spine — phone capture → reconstruction → desk → unlisted client link — with the
customer's permission documented. Everything else is downstream of that.

**Conversion actions (in priority order):** operator application via `/apply`; managed
walkthrough enquiry via `/request`; sign-in at `/account` for existing operators.

**Current metrics:** zero customers, zero accepted tours, zero discovery calls, no
analytics installed (deliberately). Enquiries arrive by email to
yoda@yodalai.xyz via FormSubmit, which is itself unverified end-to-end.

**Known structural constraints (audited 2026-09-17, read-only):**
1. **The app cannot reach a second person.** Personal-Team development profile,
   wildcard App ID, four provisioned devices, no TestFlight or App Store record, no
   export pipeline, no CI for iOS. `build-native.sh` explicitly never touches
   provisioning.
2. ~~**The app on the phone does not contain the hosted feature.**~~ — **fixed
   2026-09-17**: a signed Release-iphoneos build (`0.1.0` build 12, compiled 19:10)
   containing `hosted-supabase.json` was installed on the paired iPhone 17 Pro Max and
   launched. The capture library in `Documents/Captures` survived the reinstall. Not yet
   exercised: a real sign-in and a real publish from the device.
3. **The app cannot produce a tour package.** It has no code that emits
   `tour.html`/`manifest.json`/voxel data; the Mac/website pipeline does that and the
   package is hand-imported. Capture itself is bound to a paired loopback studio
   session on the owner's Mac.
4. **Publish is mock-only.** The upload path's only coverage is simulator unit tests
   against a mock transport; `URLSessionHostedTransport` is never exercised in a test.
   It has never run against the real backend.
5. ~~**App sign-in has two live defects**~~ — **fixed 2026-09-17** in commit `6ad319d`:
   the email return is now accepted without a state the app never sent (mismatches are
   still rejected), and a refresh exchange renews the session inside a 60-second skew
   window. Seven new tests; full suite 143 passing. Still **not device-verified**.

Until 1–3 change, "operators apply, pay, capture" cannot serve a second operator
regardless of marketing, and the honest conversion action today is a **managed
enquiry** (`/request`), not an operator application.

## Changelog
- v4 (2026-09-17) — Recorded the device build that now contains the hosted config and is installed on the phone; capture library verified intact after reinstall.
- v3 (2026-09-17) — Marked the two app sign-in defects fixed after commit 6ad319d, with seven new tests; noted they remain device-unverified.
- v2 (2026-09-17) — Added the audited iOS constraints in Goals: the app is owner-only, the installed build predates the hosted feature, and publish has never run against the real backend.
- v1 (2026-09-17) — Initial context, auto-drafted from the live site and the product
  workspace docs after a read-only audit of both. Pricing marked internal and
  unpublished; competitive set taken from provider pages read 2026-09-13; all proof
  points scoped to local evidence because no customer-accepted delivery exists yet.
