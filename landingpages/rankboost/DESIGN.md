# Rank Boost Funnel Design

## Principles

- Use the navy, gold, white, and muted-blue visual system already defined in `public/styles.css`.
- Keep one primary conversion action per funnel step and preserve clear step progress.
- Pair strong proof with nearby outcome qualifications; do not present modeled values as forecasts.
- Optimize the first viewport for mobile without hiding disclosures or recovery actions.

## Interaction states

- Keyboard and pointer users must receive equivalent controls and state changes.
- Error copy must distinguish a durably saved lead from an unsaved submission.
- Use Thanks for booking as the default welcome, including direct visits and lookup failures. Do not show a booking warning or ask the visitor to book again. Personalized meeting details, booking-dependent actions, and Schedule tracking remain gated by verified booking evidence.
- Booking verification retries webhook lag, uses the signed lead token and exact event identity, and never trusts redirect-query timestamps.
- Field errors must set `aria-invalid`, reference visible error text, and focus the first invalid control while matching server validation limits.
- Proof comparisons must expose keyboard-operable slider semantics, and enlarged images must use a labeled modal with focus restoration.
- Saved failures, capacity limits, and rate limits keep booking closed and explain the next safe action.
- Keep browser-based Meta Pixel tracking enabled across the funnel without consent banners, privacy popups, or inline tracking disclosures; disclose tracking practices in the privacy policy.
- Place the click-to-open qualification form directly after supporting VSL copy: its one-way full-width trigger reveals the native-hidden form, hides itself and its pre-open reassurance note after opening, keeps entered data intact, focuses the full-name field, and tracks the first open.
- Keep section headings and subheadings full width and centered within their section container; do not apply this alignment to ordinary card or body copy.
- The protected partner lookup may expose its login shell publicly, but its access code is session-only and the endpoint remains rate-limited.
- A canceled booking may trigger operational notice and a single cancellation SMS, but must not enroll the contact in an unbooked or abandonment email sequence.
- Kit lifecycle routing uses state tags; direct sequence enrollment is unsupported.
- Kit tag IDs come from `functions/api/_kit.js` and must match the verified live manifest.
- Downstream Kit tag-event nodes are lifecycle exit gates that pull contacts forward from the prior sequence.
- No-show follow-up uses the managed, compliance-reviewed three-email sequence in the Kit manifest.
- Boost Live reasserts the booked tag while stale booking messages remain suppressed.
- Boost Live accepts only booked leads; every live message waits for the durable booked-tag prerequisite.

- Qualification inputs use white backgrounds, dark text, and a visible focus ring against the navy section.
- Keep qualification in the original VSL section. Open live checking, results, and booking in a shared native popup for both qualified and website consultation leads. Keep all stage indicators hidden until valid form submission. Then show a filled progress bar and three-step labels: one third after details, two thirds after successful rankings, and completion only after booking. Step 2 has a prominent "Step 3: Book Your Call" action.
- Loading text describes the active request without fabricated percentages or timed claims that a particular backend stage has completed. Keep qualification gates, signed booking access, retry behavior, and tracking intact, including when session storage is unavailable.

## Responsive behaviour

- Founder and breakout videos retain their portrait 9:16 framing, use accessible playback controls, and never autoplay.
- Cap portrait cards at 380 pixels, with two FAQ columns above 680 pixels and one column on smaller screens. Show clean white and pale-blue thumbnails with bold blue questions above the center play button.
- Publish complete selected takes only. The full agency-difference claim and the free-offer sales-tool explanation remain intact at Bilal’s request.

- Use Wistia embeds for all six founder and FAQ videos, including safety and timing. Use the matching light-blue question thumbnails and Wistia center play controls. Keep FAQ titles in thumbnails only, with accessible player labels and no duplicated captions. Keep the agency, free offer, competitors, safety, and timing order.

## Verification

- Keep design-option galleries under `design/`; only launch-approved assets belong in `public/`.
- Run `npm test` after client or API changes.
- Run `npm run deploy` so remote D1 migrations complete before Pages and router deployment.
- Verify desktop and mobile views with screenshots no larger than 1568 pixels on the longest side.
- Exercise direct-entry, failure, and successful funnel states rather than reviewing only the happy path.

- Lead the confirmation content with Step 1, Watch this before your call, and the founder video. Step 2, Accept your calendar invitation, follows immediately before FAQs. Calendar instructions are always readable; personalized invite details retain the existing verification gate. Keep the remaining FAQs and proof below, with the save-number reminder unnumbered.

- Start with “Thanks for booking. Your meeting is confirmed.” followed directly by Step 1 and its video. Keep FAQ and client-results shortcuts in normal document flow below Step 2 on every screen size. The pale-blue calendar card includes a clearly labelled sample invitation with a highlighted Yes response and an instruction to use Yes or Accept in the visitor’s own inbox. Sample responses are noninteractive illustration elements. Preserve verified-only personalization and conversion events and all six Wistia videos.

- Simplify Step 2 to its heading and a single invitation example image highlighting the Yes response. Remove numbered instruction cards. Use large high-contrast blue and pale-blue section buttons below it, stacked on mobile.

- Use the exact Calendly event name, Three Stripes Digital Rank Boost, in the invitation image. Step 2 says Please check your inbox with spam guidance and Bilal’s clickable email. Below it, use matching light cards with simple blue icons, action-led titles, supporting descriptions and clear video/case-study links.
- Preview deployments route only the public check, booking, and tracking POST APIs to the configured production funnel through a fixed upstream. Verify real API readiness and replay an existing submission before sharing a preview; mocked browser responses cannot verify environment configuration.

## Website consultation path

- A successful no-fit scan replaces steps 2 and 3 with the website offer and dedicated consultation booking. Boostable rankings are positions 2 to 50. Firms with a position-one term can qualify through other eligible terms. A scan with only first-place terms shows a neutral result, not a website downsell. Provider failures and limits never become a no-fit result.
- Explain the observed keyword result without diagnosing site speed, indexing, or code from ranking data alone. Recheck eligibility after a rebuild.
- Use Vernsten Law as the owner-confirmed website rebuild followed by Rank Boost example, with the existing on-domain testimonial. No invented ranking screenshots or numerical results.
- Preserve the main calendar for qualified leads. Website bookings use their own provider event, Kit tags, verified inline confirmation and custom Meta event. Never fire Schedule for website bookings.
- Keep pricing on the consultation and use the navy and gold card patterns in the shared popup.

- Both offers use the same modal for steps 2 and 3. Close, Escape, and backdrop dismiss preserve progress. A clearly named resume button reopens the current step. Lock background scroll, retain native modal focus containment, and keep the close control visible while scrolling.

## Website downsell language

Explain the progression in plain language: establish relevant Google rankings first, then use Rank Boost as fuel for that existing flame. Introduce the website offer after explaining why there is no eligible ranking to boost. State that the scan found no rankings for the lawyer searches checked in the first five pages, without claiming the domain ranks for nothing at all. Describe service and location pages and the goal of showing up on Google instead of technical SEO terminology or a vague stronger starting point. Label the delivery window as a 3 to 4 week build, without defensive rankings disclaimer copy. After the website is live, re-evaluate whether the firm qualifies for Rank Boost.

Use Jeremy’s approved September 9 rewrite: “We can’t boost what isn’t there yet” and “Build a website Google can actually rank.” Preserve the inline popup, Vernsten proof, two website consultation CTAs, and honest live consultation explanation.

Do not show a qualification caption beneath the Vernsten testimonial or a page-one FAQ in the website downsell popup, per the owner’s screenshot-directed removal.

The hero VSL uses the approved Watch how to reach page 1 in 48 hours graphic as both its loading background and Wistia poster, served from the production funnel assets. Keep the native player control.

- Qualified keyword results use one compact semantic table on desktop and phones: keyword, rank, monthly searches, and modeled monthly upside. Keep numbers centered, keywords left aligned, and assumptions collapsed. Do not restore tall per-keyword cards or automatically expand the first model.

Qualified results use “Upside at #1” for each monthly incremental estimate and “Total Upside at #1” for their sum, following Jeremy’s review.
