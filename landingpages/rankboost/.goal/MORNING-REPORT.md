# Morning report — Rank Boost VSL simplification (2026-09-04)

## What you have now

The Rank Boost landing page is stripped to header → headline → VSL → "Get my free boost" button/form → trust logos → recent wins → the four on-camera testimonials → six-question FAQ → final CTA, and the booking confirmation page is rebuilt as founder urgency video → four objection breakout videos → testimonials → next steps (all five videos are placeholders). Both are committed on branch `goal/rankboost-vsl-simplify` in
`/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost`, tests are 64/64, and nothing is deployed.

## Phases completed

| Phase | Outcome | Commit | Exit criteria |
|---|---|---|---|
| 0 | Snapshot of your previously uncommitted (deployed) working tree as the branch base | `da472ae` | `npm test` 62/62 |
| plan | Mission, plan, briefs, verifiers | `03d662a` | — |
| 1 | Landing page restructure (Codex gpt-5.6-sol, 2 dispatches) | `b161893` | `bash .goal/verify-landing.sh` → ALL GREEN; `npm test` 63/63 |
| 2 | Confirmation page restructure (Codex gpt-5.6-sol, 2 dispatches) | `0d6014c` | `bash .goal/verify-confirmation.sh` → ALL GREEN; `npm test` 64/64 |
| 3 | Runtime check in Chrome via `wrangler pages dev` (CSP applied) at 1440px and 500px | n/a | see below |

## Phases blocked

None.

## Landing page — what changed (`public/index.html`)

Removed: the animated fake Google SERP in the hero (`#gserp` + its script), "The problem", "Three steps / how it works", the founder + FAANG block **and** the comparison table (`#different`), and the anonymized inbox/text proof wall (`#inbox-proof`).
Kept, copy untouched: header, headline, Wistia VSL + caption, the application button → inline form (unchanged markup/JS/redirect), trust marquee, all 31 rank-tracker win cards + "Show more wins", the four named video testimonials, final CTA, sticky phone CTA, footer.
FAQ trimmed from 10 to 6 (kept: why free · bot/black-hat · how long it lasts · local pack vs organic · one firm per niche/city · are the wins from the free boost; dropped: how fast · what does it cost · AI search · who is this for). Every primary button now reads "Get my free boost". `index.html` went 1,391 → 865 lines; `styles.css` 3,868 → 2,170 lines.

## Confirmation page — what changed (`public/thank-you.html`)

New order: H1/lead (verification state machine unchanged) → `#ty-urgency` founder placeholder → `#ty-breakouts` four placeholders titled "Is this white hat?", "Will this hurt my existing rankings?", "What happens if it doesn't work?", "Do you work with my competitors?" (each marked `data-max-minutes="3"`, "Under 3 minutes") → `#ty-testimonials` (the 4 videos, 3 before/after sliders, email/text proofs, lead-inbox picture) → `#ty-next-steps` (Step 1 accept invite + Step 2 save number, still hidden until the server verifies the booking; then the 4-step timeline and back button).
Each placeholder frame contains a comment with the exact `<wistia-player media-id="MEDIA_ID" …>` line to swap in; the CSP already allows Wistia. No live player element exists on the page yet.

## Runtime verification (Chrome, http://127.0.0.1:8788, middleware CSP)

- Landing: sections in order `top qualify trusted wins partners faq final`; Wistia upgrades to 898×504; the toggle hides itself, reveals the form and focuses the name field; `tsdMetaTrackingEnabled === true`, `fbq` initialised; no horizontal overflow at 1440 or 500px; sticky CTA visible and header static on the narrow viewport; single-column grids on phone. Only console error: Wistia's metrics beacon "Failed to fetch" on plain-http localhost (same as last run; not possible on https).
- Confirmation: direct visit shows "We couldn't confirm your booking yet" + retry button, booking-actions hidden; placeholders 16:9; breakouts 2-col at 1440, 1-col at 500; sliders, lightbox and mobile column-flatten still initialise; zero console errors.
- **Not verified:** actual video playback (never has been in this Chrome profile), and the real narrowest phone width — this Mac's Chrome refuses to resize below 500px, so 390px was not exercised. The CSS breakpoints are unchanged from the deployed version, so risk is low.

## Decisions I made on your behalf

1. **Committed your uncommitted WIP** as `da472ae` on the new branch so the mission had a revertible base. `feature/rankboost-integration` itself is untouched (still `313d83f`, without that WIP). The worktree is now checked out on `goal/rankboost-vsl-simplify`. To get the exact previously-deployed files back at any time: `git checkout da472ae -- landingpages/rankboost`.
2. **Kept the video testimonials, cut the inbox proof wall.** Named partners on camera with numbers are the more specific and verifiable of the two; anonymized emails are neither.
3. **Cut the animated SERP** in the hero. It is a simulation, not proof, and it is a moving element competing with the play button.
4. **Cut the founder block along with the comparison table** (same section). You are on camera in the VSL, so the bio duplicates it.
5. **Kept the two inline "Get my free boost" buttons** after wins and after testimonials. They are buttons, not sections; delete them if you want a stricter reading of the brief.
6. **Unified every CTA to "Get my free boost"** (was "GET MY FREE BOOST NOW", "Get my free rank boost" ×7, "Claim my free rank boost"). The test regex was updated to match.
7. **Did not move the scheduler inline onto the landing page.** "Inline form with embedded scheduler" already exists as form → ranking check → `book` step with the Calendly inline widget behind the signed lead token; embedding Calendly on `index.html` would bypass qualification and break the booking-verification chain.
8. **Codex removed more CSS than the removed sections alone** (old hero cards, animation keyframes, duplicate rules; ~1,700 lines). I verified with a class-coverage script that every page and script (`index`, `results`, `book`, `partner`, `privacy`, `thank-you`, `results.js`, `partner.js`, `book.js`) references only classes that still exist, and that no kept rule references a dropped keyframe. The audit from 2026-09-02 had flagged this CSS as dead.
9. **Dropped the 26 rank-tracker win cards from the confirmation page.** They are on the landing page; the brief asked for testimonials there.
10. **Changed one sentence** in the confirmation page's verified state: "Two quick things below and you're set. You don't need to prepare anything." → "Watch the short videos below, then finish the two quick steps at the bottom of this page." The old line contradicted a founder video about what to prepare.
11. **Placeholder copy is titles only.** No teaser answers were written under the breakout slots, so no new claims exist on the page until your videos do.

## What I did not do

- **The Wistia thumbnail / "how they decide" caption.** That text is burned into the Wistia thumbnail image (visible in the screenshot before play) and the caption track — both live in Wistia, not in this repo. Change the thumbnail in Wistia (Customize → Thumbnail) or re-export the first frame with "the 48-hour ranking method".
- No deploy, no push, no change to `meta.js`, `_headers`, `_middleware.js`, `functions/**`, `results.*`, `book.*`, `partner.*`, `privacy.html`.
- The wider token/spacing cleanup from `.goal/archive/2026-09-02-wistia-embed/UI-AUDIT.md`.
- The slide-deck fallback (phase-two idea if play rate < 20%).

## How to verify

```
cd /Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost
git log --oneline -4                       # 0d6014c phase 2, b161893 phase 1, 03d662a plan, da472ae base
npm test                                   # 64 pass
bash .goal/verify-landing.sh               # ALL GREEN
bash .goal/verify-confirmation.sh          # ALL GREEN
git diff da472ae -- public/index.html | less
npx -y wrangler@4.124.0 pages dev public --port 8788   # open / and /thank-you
```

## To deploy (when you are ready — same command as 2026-09-02)

```
cd /Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost
CLOUDFLARE_ACCOUNT_ID=17f7c095d40a8771cf3568fdcae11770 npx -y wrangler@4.124.0 pages deploy public --project-name tsd-law-firm-rank-boost --branch preview --commit-dirty=false
```

Reminder: the Pages project's production branch is `preview`, so this goes live at https://threestripesdigital.com/rank-boost/law-firms/ immediately. Rollback is the Cloudflare dashboard "Rollback to this deployment" (previous production deploy: `63f732b5`).
