# Progress — Rank Boost VSL simplification (2026-09-04)

Branch `goal/rankboost-vsl-simplify`. Base `da472ae` (WIP snapshot). Plan `03d662a`. Baseline `npm test` 62/62.

| Phase | Outcome | Commit | Exit criteria |
|---|---|---|---|
| 1 — landing page restructure | `#problem`, `#how`, `#different` (founder + comparison), `#inbox-proof`, `#gserp` + its script removed; FAQ 10 → 6; all CTAs "Get my free boost"; ~1,700 lines of now-dead CSS removed; new structure test | `b161893` | `bash .goal/verify-landing.sh` → ALL GREEN; `npm test` 63/63 |
| 1b — cleanup | Codex had pasted two lines of git error output into index.html between `#partners` and `#faq` (my verifier missed it; it now fails on stray shell output) | `b161893` | ALL GREEN |
| 2 — confirmation page | `thank-you.html`: founder urgency placeholder → 4 breakout placeholders → testimonials → next steps; wins cards dropped; verification/tracking JS untouched; new ordering test | `0d6014c` | `bash .goal/verify-confirmation.sh` → ALL GREEN; `npm test` 64/64 |
| 2b — cleanup | Un-escaped the `<wistia-player>` swap-in snippet inside the placeholder comments | `0d6014c` | ALL GREEN |
| 3 — runtime verification (orchestrator) | `wrangler pages dev` + Chrome at 1440px and 500px (the narrowest this Mac window allows): both pages render in the target order, no horizontal overflow, form toggle opens and focuses, Wistia player upgrades, sticky CTA shows on phones, thank-you unverified state + retry button intact, booking-actions stay hidden until verified, breakout grid 2-col desktop / 1-col phone | n/a | manual, see MORNING-REPORT |

Dispatches: 4 (`codex-phase-1.log` 68.8k tokens; `1b` 16.5k; `2` 55.4k; `2b` 20.2k). Total ≈ 161k Codex tokens.
