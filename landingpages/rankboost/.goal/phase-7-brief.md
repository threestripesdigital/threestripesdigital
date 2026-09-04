# Phase 7 — Drop the closing sentence from the © line

Working directory is the app root (`landingpages/rankboost`). Tests are green.

## Exact edit

In `public/index.html`, the `<p class="final-copy">` at the end of `#final` currently ends with `… and no specific result is guaranteed. That’s why we qualify first.` Delete the sentence `That’s why we qualify first.` (and the space before it) so the paragraph ends with `no specific result is guaranteed.` Change nothing else in that paragraph or file.

In `test/endpoints.test.js`, the assertion `assert.match(finalSection, /That’s why we qualify first\./);` must become `assert.doesNotMatch(index, /qualify first\./);` (keep the surrounding assertions).

## Files you may modify

- `public/index.html`
- `test/endpoints.test.js`

## Exit criterion

```
grep -c 'qualify first' public/index.html     # prints 0
bash .goal/verify-phase6.sh                   # ALL GREEN
```

Reply with one line. Do not commit.
