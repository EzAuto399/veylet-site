# Programmatic SEO plan — Veylet

**Prepared:** 2026-09-17
**Status:** proposal, not implemented. Nothing here has been published.

> **Read this first.** I could not verify a single search volume. I have no access to
> Ahrefs, Semrush or Google Keyword Planner, and I am not going to invent numbers to
> make this plan look researched. Every pattern below is a hypothesis about intent,
> grounded in provider pages I actually read and in the product marketing context.
> **Validate volumes before building more than the first three pages.**

---

## 1. Opportunity assessment

**The honest situation.** veylet.com is a new domain with no backlinks, no traffic and
no analytics. It has no customer-accepted delivery to point at. In that state,
programmatic scale is a liability: the fastest way to get a young domain filtered is to
publish 200 near-identical pages about a service nobody can yet verify it performs.

**Where the demand actually sits.** The category's search demand is overwhelmingly
*real-estate listing* intent — "virtual tour [suburb]", "3D tour real estate agent" —
and that intent is served by an ecosystem built for it: Matterport/iGUIDE suppliers,
Domain's bundled Matterport suite for eligible Platinum sale listings, and
realestate.com.au's supplier requirements, which state that unsupported suppliers'
tours do not appear on residential listings. Chasing that head term means competing
with established local photographers on features Veylet does not have (floor plans,
measured areas, photo bundles, portal plumbing) and losing.

**The exploitable gap** is the buyer the listing ecosystem does not serve well: a
clinic, a venue, a showroom, a cabinetmaker, a gallery. These buyers do not search
"virtual tour real estate"; they search their own problem, and almost nobody has built
a page for them that is not an agency advertorial.

**How many pages.** Not 200. The first tranche is **9 pages** (one hub, eight space
types). Location pages are **gated** — see §5 — because they depend on a service-area
decision that has not been made. Delivery capacity is one person and one iPhone; page
volume must not outrun the ability to answer an enquiry.

---

## 2. Playbooks chosen, and why

| Playbook | Use | Reasoning |
|---|---|---|
| **Personas / audience** | Primary play: 8 space-type pages | The genuinely underserved intent. Low competition, high intent, directly convertible. |
| **Glossary** | Support: "what is a 3D walkthrough" style explainers | Builds the topical cluster that makes the audience pages credible, and answers the question the audience page cannot. |
| **Locations** | Gated, max 5 | Highest-volume pattern in this category, but needs a real service area and cannot be faked. |
| **Comparisons** | Deliberately refused for now | "Veylet vs Matterport" would rank for a fight we lose on features and invite the portal question we cannot answer. Revisit after a customer-accepted tour exists. |
| **Templates / Examples / Directory** | Not applicable | No proprietary data set, no template product, no directory. |

**Data defensibility:** there is no proprietary data set yet. The only data this
business will own is *its own completed deliveries* — which is exactly why
customer-facing case pages must wait for a customer, and why the spine pages below are
built only from first-party operational facts (room counts, permission requirements,
capture windows, what is excluded).

---

## 3. The spine: eight audience pages

URL: `/walkthroughs/{space-type}` — subfolder, singular intent, no keyword stuffing.

| Page | URL | Search intent it answers | The specific objection it must kill |
|---|---|---|---|
| Hub | `/walkthroughs` | "does this exist for my kind of space" | "this looks like a real-estate product" |
| Clinics | `/walkthroughs/clinics` | how do patients see the practice before a first visit | "patients on camera, records visible, privacy" |
| Venues | `/walkthroughs/venues` | let event bookers see the room before they enquire | "will it show the actual setup and capacity" |
| Showrooms | `/walkthroughs/showrooms` | show a retail/interior space remotely | "stock changes, so the tour goes stale" |
| Homes | `/walkthroughs/homes` | view a home remotely, including from overseas | "is this a listing product or a private viewing" |
| Completed installs | `/walkthroughs/completed-installs` | show finished cabinetry/renovation/fitout work | "we need dimensions, not pictures" |
| Education | `/walkthroughs/education` | show a learning space to prospective students | "students cannot be in the capture" |
| Cultural spaces | `/walkthroughs/cultural-spaces` | let remote visitors see an exhibition | "loans, labels, exhibition dates" |

**Each page must answer, in its own words, not a swapped template:**
1. What this space type's viewer is actually deciding.
2. What gets captured here, and what deliberately does not.
3. Permission and privacy requirements specific to this segment (patients, students,
   loaned artworks, occupied homes).
4. What this tour is **not** — the segment's technical trap (capacity specs,
   accessibility, fabrication dimensions, compliance, measured areas, preservation).
5. One honest limitation sentence, using the shared vocabulary from the marketing
   context.
6. A segment-appropriate next step (managed `/request`, with operator `/apply` as the
   secondary path).

**Uniqueness rule:** if two segment pages share more than the shared vocabulary and the
CTA, they are not finished. Roughly 40–60% of the body copy must be segment-specific
operational fact.

---

## 4. Keyword patterns (hypotheses, unvalidated)

| Pattern | Example | Intent | Gate |
|---|---|---|---|
| `3d walkthrough for {space type}` | 3d walkthrough for a dental clinic | commercial | none |
| `virtual tour {space type} {city}` | virtual tour dental clinic brisbane | commercial | service area |
| `{space type} virtual tour cost` | clinic virtual tour cost australia | commercial-investigation | pricing decision |
| `show {space type} online before {visit/booking}` | show venue before booking | informational → commercial | none |
| `what is a {3d walkthrough / virtual tour}` | what is a 3d walkthrough | informational | none |

**Explicitly not targeted:** "virtual tour [suburb]" for its own sake,
"Matterport alternative", "best virtual tour companies", "cheap 3d tour". Each either
attracts the listing market, invites a comparison we lose, or attracts price shoppers
for a service with no published price.

---

## 5. Gated pages (do not build yet)

| Gate | Pages blocked | Why |
|---|---|---|
| **Service area not decided** | up to 5 suburb pages (Fortitude Valley, New Farm, South Brisbane, Milton, Woolloongabba as candidates) | `docs/pricing-and-unit-economics.md` treats the travel zone as a proposal, not an established coverage claim. Publishing "we cover X" would be a claim the owner has not committed to. |
| **Pricing not accepted** | `/walkthroughs/costs`, all `cost` intent | The public site deliberately shows no number. A cost page can be written honestly without a figure (what drives cost, what is included, what is excluded) — but not until the owner agrees to that framing. |
| **No accepted delivery** | `/work/{space}` case pages | Requires a real customer with documented permission. This is the highest-value page type and the one that must not be faked. |
| **Portal compatibility unproven** | any realestate.com.au listing page | REA states unsupported suppliers' tours do not appear on residential listings. Cannot be written as a benefit today. |

---

## 6. Template specification

**Title pattern:** `3D walkthrough for {space type} | Veylet` — no city, no year, no
pipe-stuffing.

**Meta description pattern:** lead with the viewer's decision, close with the honest
boundary. Example: *"Let patients see the practice before their first visit. Veylet
captures the space and delivers a private browser walkthrough — visual context, not a
measured survey."*

**Heading structure:** one `h1` naming the space and the decision. `h2`s for what is
captured / permission / what this is not / next step. No `h3` padding.

**Required schema (per page):** `Service` with `areaServed`, plus `FAQPage` for the
objection questions already answered in the body, plus `BreadcrumbList`. Reuse the
`ProfessionalService` block already on the homepage rather than inventing a new entity.

**Internal linking:** hub → 8 spokes; each spoke links to 2 sibling spokes with a
justifying sentence (clinics ↔ education share the privacy problem; venues ↔ cultural
spaces share the visitor-flow problem); every spoke links to its glossary term; every
spoke ends at `/request`. No orphan pages; every page in `sitemap.xml`.

**Truth invariants — a page fails review if it breaks any of these:**
- No invented statistic, customer, rating, testimonial, logo or case study.
- No concept imagery presented as a captured space (applies the existing AI label).
- No "Matterport alternative", no portal compatibility claim, no earnings/leads/jobs.
- No published price; no GST language while registration is unconfirmed.
- No claim that a capture of this segment has been delivered.
- Every page states at least one real limitation.

---

## 7. Implementation order

1. **Hub + 3 segments** (clinics, venues, showrooms) — the three with the clearest
   operational scope in the audience review. Ship, then watch Search Console for
   impressions before writing more.
2. **Two glossary pages** to anchor the cluster: *what is a 3D walkthrough*, *unlisted
   walkthrough link vs public gallery*.
3. **Remaining 5 segments**, only once the first three show impressions.
4. **Suburb pages**, only after the service area and travel zone are decided.
5. **Case pages**, only after a customer accepts a delivery and signs off on publication.

Google Search Console must be connected before step 1, or step 1 is unmeasurable
(`docs/search-and-conversion.md` records that no console or analytics account is
connected).

---

## 8. Pre-launch checklist (per page)

- [ ] Answers the segment's decision, not a paraphrase of the hub
- [ ] Segment-specific permission and privacy paragraph present
- [ ] "What this is not" section present
- [ ] At least one real limitation stated
- [ ] Unique title and meta; single `h1`; logical `h2` order
- [ ] Schema: Service + FAQPage + BreadcrumbList, validated
- [ ] Linked from the hub and to 2 siblings; in `sitemap.xml`
- [ ] `noindex` absent, canonical self-referencing
- [ ] No invented proof of any kind
- [ ] Renders at 390px with no horizontal overflow (existing QA harness covers this)
