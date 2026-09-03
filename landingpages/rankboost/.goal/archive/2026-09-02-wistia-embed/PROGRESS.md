# Progress — Rank Boost VSL Wistia embed (2026-09-02)

| Phase | Outcome | Commit | Exit criteria |
|---|---|---|---|
| 1 — embed + CSP + test | Placeholder replaced by `wistia-player` 8uioqg3047; CSP extended append-only in `_headers` + `_middleware.js`; regression test added | none (working tree only, by design — see MISSION rails) | `bash .goal/verify-vsl.sh` → `ALL GREEN`; `npm test` 62/62 |
| 1b — Sentry CDN append | `script-src` also allows `https://browser.sentry-cdn.com` (Wistia-documented; confirmed CSP-blocked at runtime before the append) | none | `bash .goal/verify-vsl.sh` → `ALL GREEN` |
| 2 — runtime verification (orchestrator) | Served via `wrangler pages dev` with middleware CSP; player upgraded, poster + HLS manifest loaded, zero CSP violations for Wistia (after 1b); `meta.js` loads first, `fbq` initialised | n/a | manual, see MORNING-REPORT |

Dispatches: 2 (`codex-phase-1.log` 57.7k tokens; `codex-phase-1b.log` 13.5k tokens).
First verify run was RED only because of an orchestrator bug in `verify-vsl.sh` (unescaped `*` in a grep
regex); Codex's output was correct. Script fixed to fixed-string matching, then green.
