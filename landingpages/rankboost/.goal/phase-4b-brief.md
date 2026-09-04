# Phase 4b — Final-CTA heading still capped by the global h2 rule

Working directory is the app root (`landingpages/rankboost`). Phase 4 is green, but on the preview the heading `See whether a rank-boost test fits your firm.` still wraps to two lines: removing `max-width: 18ch` from `.final-cta h2` let the **global** `h2 { … max-width: 22ch; }` rule in `public/styles.css` apply instead.

## Exact edit

In `public/styles.css`, inside the `.final-cta h2 { … }` block, add `max-width: none;` (keep `margin-inline: auto;`). Do not change the global `h2` rule (other sections rely on it). Change nothing else.

## Files you may modify

- `public/styles.css`

## Exit criterion

```
bash .goal/verify-phase4.sh    # ALL GREEN
```

Reply with one line. Do not commit.
