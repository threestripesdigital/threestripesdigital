# Plan: Rank Boost VSL simplification + confirmation page (2026-09-04)

Orchestrator: Fable 5.1 (claude-fable-5-1). Implementer: Codex gpt-5.6-sol (default model, no `-m`).
Worktree: `/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration`, branch `goal/rankboost-vsl-simplify`.
App root: `landingpages/rankboost`. Baseline commit `da472ae` (WIP snapshot). Baseline `npm test`: 62 pass / 0 fail.

## Current page → target page (index.html)

| # | Current section (id) | Target | Action |
|---|---|---|---|
| 1 | `site-header` (wordmark + "Get my free boost") | header with logo + CTA | keep |
| 2 | `#top` hero: h1 | headline | keep verbatim |
| 3 | `.hero-vsl` Wistia 8uioqg3047 + caption | VSL | keep |
| 4 | `#qualify` toggle button → inline form | application button → inline form | keep; label → "Get my free boost" |
| 5 | `#gserp` animated fake SERP (inside hero grid) | not in target list; not proof, not objection handling | **remove** (+ its inline script + CSS) |
| 6 | `#trusted` logo marquee | trust logos row | keep |
| 7 | `#problem` "Indexed, optimized, and stuck…" | — | **remove** |
| 8 | `#how` "Three steps. About forty-eight hours." | — | **remove** |
| 9 | `#wins` 31 rank-tracker cards + show-more | recent wins | keep, move up |
| 10 | `#different` founder block + comparison table | — | **remove** (both halves) |
| 11 | `#partners` 4 named on-camera video testimonials | the ONE testimonial section | keep (stronger: named, on camera, with stats, verifiable) |
| 12 | `#inbox-proof` anonymized emails/texts | second testimonial section | **remove** |
| 13 | `#faq` 10 questions | FAQ, 5–6 questions | trim to 6 (see phase 1 brief) |
| 14 | `#final` final CTA | final CTA button | keep; label → "Get my free boost" |
| — | `#sticky-cta` mobile bar, inline CTAs after wins/testimonials | buttons, not sections | keep; labels → "Get my free boost" |

FAQ keep (objections the 5-minute demo does not settle): why free · bot/black-hat · how long it lasts · local pack vs organic · exclusivity · are the wins from the free boost.
FAQ drop (covered by headline/VSL/form or tangential): how fast · what does it cost (dup) · AI search · who is this for.

## Confirmation page (thank-you.html) target

1. H1/lead (booking verification state machine, unchanged)
2. `#ty-urgency` founder urgency video — **placeholder** (no video exists yet)
3. `#ty-breakouts` four breakout placeholders, each marked ≤3 min: white hat · existing rankings · if it doesn't work · competitors
4. `#ty-testimonials` the 4 video testimonials + 3 before/after sliders + email/text proofs (wins cards dropped: they live on the landing page)
5. `#ty-next-steps` Step 1 accept invite + Step 2 save number (still hidden until server verification) + 4-step timeline + back button

## Phases

| Phase | Who | Files Codex may touch | Exit criterion |
|---|---|---|---|
| 1 landing page restructure | Codex gpt-5.6-sol | `public/index.html`, `public/styles.css`, `test/endpoints.test.js` | `bash .goal/verify-landing.sh` → exit 0 |
| 2 confirmation page | Codex gpt-5.6-sol | `public/thank-you.html`, `public/styles.css`, `test/endpoints.test.js` | `bash .goal/verify-confirmation.sh` → exit 0 |
| 3 runtime verification | orchestrator | none | `wrangler pages dev` + Chrome: zero console errors, sections render in order, form toggle works, Wistia upgrades, thank-you unconfirmed + placeholder states render at 390px and 1440px |

Phase 1 lands first because it is the deliverable the user asked to "get live first".
Each phase: dispatch once, verify by running the script, re-dispatch at most once with the failure output, else BLOCKED.

## Not in scope (disclosed in the morning report)

- The Wistia thumbnail / first caption line ("how they decide") lives inside Wistia, not this repo.
- Moving the Calendly scheduler inline onto index.html (would break the signed-token booking chain).
- The broader dead-CSS / token cleanup from `.goal/archive/2026-09-02-wistia-embed/UI-AUDIT.md`.
- Deploy.
