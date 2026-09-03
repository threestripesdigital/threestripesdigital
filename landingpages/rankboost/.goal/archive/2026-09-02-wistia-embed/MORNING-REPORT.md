# Morning report — Rank Boost VSL Wistia embed (2026-09-02)

## What you have now

The Rank Boost hero placeholder is replaced by your Wistia player `8uioqg3047`, the page's
Content-Security-Policy now lets Wistia load, and every tracking path is byte-for-byte unchanged.
The change sits **uncommitted** in the working tree of
`/Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost`
alongside your existing uncommitted WIP. Nothing was committed or deployed.

## Phases completed

| Phase | Outcome | Commit | Exit criteria |
|---|---|---|---|
| 1 | Embed in `public/index.html`, CSS for the frame, CSP appended in `public/_headers` + `functions/_middleware.js`, regression test in `test/endpoints.test.js` | none (by design) | `bash .goal/verify-vsl.sh` → ALL GREEN; `npm test` 62/62 |
| 1b | `script-src` also allows Wistia's documented Sentry CDN (was CSP-blocked at runtime) | none | ALL GREEN |
| 2 | Runtime check on `wrangler pages dev` with the middleware CSP in Chrome | n/a | see below |

## Phases blocked

None.

## Tracking — what was checked

- `public/meta.js` hash identical to baseline; still the first script in `<head>`, Wistia scripts come after it.
- Exactly 4 lines with `fbq(` before and after; `functions/api/*`, `router/*`, `results.js`, `book.html` hashes identical.
- CSP: every pre-existing source (Facebook, Calendly, Cloudflare Insights, Google Fonts, threestripesdigital.com media) is still present in the same order; Wistia sources were only appended. `_headers` and the middleware produce the identical policy string (asserted by the verify script and by a new test).
- In the browser: `window.tsdMetaTrackingEnabled === true`, `fbq` initialised, `tsd_ext_id` set. No CSP violation was raised for any Facebook or Calendly resource.

## Runtime verification (Chrome, http://127.0.0.1:8788)

- `wistia-player` custom element upgrades, renders 898×505 inside the 16:9 frame, poster and HLS manifest load (all 200).
- Zero CSP violations for Wistia resources after phase 1b. Before 1b, `browser.sentry-cdn.com` was blocked (script-src-elem), which is why it was added.
- HLS manifest hosts are `embed-cloudfront.wistia.com` and `fast.wistia.net`, both covered by `https://*.wistia.com` / `https://*.wistia.net` in `connect-src` and `media-src`.
- **Not verified: actual playback.** In this Chrome profile the video never leaves `beforeplay` (no media segments requested). The same happens on Wistia's own hosted page `https://fast.wistia.net/embed/iframe/8uioqg3047`, and the same profile also blocks `connect.facebook.net/en_US/fbevents.js` and Wistia's `.woff` fonts (status 0 in the browser, HTTP 200 from curl). So this is the browser environment (extension / media policy), not the page. Please click play once on the preview deploy.
- One CSP violation was observed that cannot occur in production: an `http://pipedream.wistia.com` metrics beacon, caused by serving over plain http on 127.0.0.1. On https it is `https://pipedream.wistia.com`, which is allowed.

## Decisions I made on your behalf

1. **Did not create a `goal/` branch or commit.** The placeholder only exists in your uncommitted WIP; branching/committing would have swept your unrelated WIP into a commit. Reversible: nothing to undo.
2. **CSP extended per Wistia's documented policy** rather than the bare minimum: `script-src` +`*.wistia.com *.wistia.net src.litix.io browser.sentry-cdn.com`; `style-src` +`blob: fast.wistia.com`; `font-src` +`*.wistia.com`; `media-src` +`blob: data: *.wistia.com *.wistia.net`; `frame-src` +`fast.wistia.com fast.wistia.net`; `connect-src` +`*.wistia.com *.wistia.net *.litix.io`; new `worker-src 'self' blob:`. Skipped Wistia's `*.algolia.net` (only for channel search). Trim any of these if you want a tighter policy; the verify script will tell you if the player-critical ones go missing.
3. **Accessible title kept.** The placeholder's visible "5-minute Rank Boost demo" became a visually hidden `<h2 id="hero-vsl-title" class="sr-only">` so the section's `aria-labelledby` still resolves. Delete it if you prefer.
4. **Dead CSS removed.** `.hero-vsl-placeholder`, `.hero-vsl-play`, `.hero-vsl-title`, `.hero-vsl-note` rules were dropped; `.hero-vsl-frame` switched from grid-centering to `display:block` and gained a `wistia-player` fill rule.
5. `.goal/` directory (this report, briefs, logs, hash baselines) is untracked in the worktree. Delete it or add it to `.gitignore` as you like.

## What I did not do

- No commit, no push, no deploy, no touching `meta.js`, `functions/api/*`, `router/*`, D1, or Kit/Slack code.
- Did not update the stale copy of this page in `AIDevops/landingpages/rankboost` (main branch there predates the VSL section entirely) or in `threestripesdigital-rankboost-release` (detached HEAD, older).

## How to verify

```
cd /Users/Bilal/Git/_worktrees/threestripesdigital-rankboost-integration/landingpages/rankboost
bash .goal/verify-vsl.sh          # prints ALL GREEN, runs npm test (62 tests)
git diff -- public/_headers functions/_middleware.js   # CSP appends only
grep -n wistia public/index.html  # 2 head scripts + swatch style + <wistia-player>
npx -y wrangler@4.124.0 pages dev public --port 8788   # then open http://127.0.0.1:8788 and press play
```

## Preview deploy (2026-09-02, user-approved)

- Pages project `tsd-law-firm-rank-boost`, branch `preview`, migrations and router deploy skipped.
- Deployment URL: https://39dde0c4.tsd-law-firm-rank-boost.pages.dev
- NOTE: the Pages project has `preview` as its production branch, so this deploy is the **Production** environment and is now live at https://threestripesdigital.com/rank-boost/law-firms/ (verified: embed + Wistia CSP served). Previous production deployment for rollback: 41f295ff (3 days earlier), via the Cloudflare dashboard "Rollback to this deployment".
- Local preview server stopped and browser tab closed.

- Second deploy 2026-09-02: hero eyebrow removed (+34px above the fold), header non-sticky at max-width 720px with scroll-margin-top 12px. Deployment https://7e6bd1a6.tsd-law-firm-rank-boost.pages.dev (Production env, live).

- Third deploy 2026-09-02: removed the qualify reassurance note (HTML + JS + CSS + tests), halved section spacing (.section, .section-head, hero bottom, marquee, trust-strip, cta-inline, footer). Deployment https://63f732b5.tsd-law-firm-rank-boost.pages.dev (Production env, live).
