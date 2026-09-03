# Plan: Rank Boost VSL Wistia embed

Orchestrator: Fable 5.1. Implementer: Codex gpt-5.6-sol.
Working tree: `/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost`
(uncommitted WIP preserved; no branch switch, no commit — see MISSION.md rails).

Baseline (before dispatch): `npm test` → 61 pass / 0 fail. lines containing `fbq(` in index.html: 4.
File hashes: `.goal/md5-before.txt`.

## Phase 1 — Embed + CSP + regression test (single phase)

Outcome: the hero placeholder is replaced by Wistia player 8uioqg3047, CSP in both
`public/_headers` and `functions/_middleware.js` allows the Wistia player, and a test locks it in.

Files Codex may touch:
- public/index.html
- public/styles.css
- public/_headers
- functions/_middleware.js
- test/endpoints.test.js

Exit criteria: `bash .goal/verify-vsl.sh` exits 0.

## Phase 2 — Runtime verification (orchestrator, no Codex)

Serve locally with `wrangler pages dev public` (middleware applies the CSP), open in Chrome:
- zero CSP violation console messages
- Wistia player upgrades from `:not(:defined)` and requests fast.wistia.com assets
- meta.js loads, fbevents.js loads, PageView request fires to facebook.com/tr
