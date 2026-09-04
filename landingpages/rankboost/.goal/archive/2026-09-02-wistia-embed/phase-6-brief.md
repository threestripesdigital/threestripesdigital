# Phase 6 brief — cut the dead vertical space between sections (desktop + mobile)

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

Section-level vertical padding/margins in `public/styles.css` are roughly halved everywhere so
sections sit close together on all viewports, with no change to any other rule.

## Files you may modify — nothing else

- `public/styles.css`

Change **only the numeric values** listed below, in place. Do not add, remove, or reorder rules
other than adding one declaration to `#top.hero`. Do not touch HTML.

## Exact edits (old → new)

| line (approx) | selector | old | new |
|---|---|---|---|
| 97 | `.section` | `padding: clamp(4rem, 8vw, 6.5rem) 0;` | `padding: clamp(2rem, 4.5vw, 3.5rem) 0;` |
| 103 | `.section-head` | `margin-bottom: clamp(2rem, 4vw, 3rem);` | `margin-bottom: clamp(1.25rem, 2.5vw, 1.75rem);` |
| 222–224 | `#top.hero` | `padding-top: clamp(1.25rem, 3vw, 2rem);` | keep, and add a second declaration on the next line: `padding-bottom: clamp(2rem, 4vw, 3rem);` |
| 2950 | `.site-footer` | `padding: 2rem 0 2.5rem;` | `padding: 1.5rem 0 1.75rem;` |
| 3007 | `.trust-strip` | `padding: 1.75rem 0;` | `padding: 1.25rem 0;` |
| 3408 | `.cta-inline` | `margin-top: clamp(2rem, 4vw, 2.75rem);` | `margin-top: clamp(1.25rem, 2.5vw, 1.75rem);` |
| 3709 | `.marquee-section` | `padding: 2.5rem 0 2.25rem;` | `padding: 1.5rem 0 1.25rem;` |

Leave `.hero`'s own `padding:` line (line ~212) untouched — the `#top.hero` rule overrides it.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0. Then run
`grep -n -e 'clamp(2rem, 4.5vw, 3.5rem) 0' -e 'clamp(1.25rem, 2.5vw, 1.75rem)' -e 'padding-bottom: clamp(2rem, 4vw, 3rem)' -e 'padding: 1.5rem 0 1.75rem' -e 'padding: 1.25rem 0;' -e 'padding: 1.5rem 0 1.25rem' public/styles.css`
which must print 7 lines. Print them and stop.
