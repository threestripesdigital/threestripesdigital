# Phase 1b brief — one mechanical CSP append (Wistia's Sentry CDN)

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

`script-src` in both CSP definitions additionally allows `https://browser.sentry-cdn.com`
(Wistia's documented error-reporting CDN), appended at the very end of the directive, identically
in both files; nothing else changes.

## Files you may modify — nothing else

- `public/_headers`
- `functions/_middleware.js`

## Exact edit

In both files, the `script-src` directive currently ends with
`https://*.wistia.com https://*.wistia.net https://src.litix.io`.
Append ` https://browser.sentry-cdn.com` after `https://src.litix.io` so it ends with
`https://*.wistia.com https://*.wistia.net https://src.litix.io https://browser.sentry-cdn.com`.

Do not touch any other directive, file, or line.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0 (it compares the two policies for equality and runs `npm test`).
Then print the single `script-src` directive from `public/_headers` and stop.
