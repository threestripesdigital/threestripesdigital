# Rank Boost Funnel Design

## Principles

- Use the navy, gold, white, and muted-blue visual system already defined in `public/styles.css`.
- Keep one primary conversion action per funnel step and preserve clear step progress.
- Pair strong proof with nearby outcome qualifications; do not present modeled values as forecasts.
- Optimize the first viewport for mobile without hiding disclosures or recovery actions.

## Interaction states

- Keyboard and pointer users must receive equivalent controls and state changes.
- Error copy must distinguish a durably saved lead from an unsaved submission.
- Booking confirmation content must remain hidden until Calendly data confirms a booking; direct or failed confirmation visits use a neutral recovery state.
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

## Verification

- Keep design-option galleries under `design/`; only launch-approved assets belong in `public/`.
- Run `npm test` after client or API changes.
- Run `npm run deploy` so remote D1 migrations complete before Pages and router deployment.
- Verify desktop and mobile views with screenshots no larger than 1568 pixels on the longest side.
- Exercise direct-entry, failure, and successful funnel states rather than reviewing only the happy path.
