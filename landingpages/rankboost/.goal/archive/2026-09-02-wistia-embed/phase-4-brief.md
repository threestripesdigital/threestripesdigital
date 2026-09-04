# Phase 4 brief — header is not sticky on phones

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

At the same breakpoint where the mobile sticky CTA bar exists (`@media (max-width: 720px)`), the
site header scrolls away with the page instead of sticking, and in-page anchor jumps no longer
reserve space for a sticky header.

## Files you may modify — nothing else

- `public/styles.css`

## Exact edit

`.site-header` (near line 118) is `position: sticky; top: 0;`. The mobile CTA bar is shown only
inside `@media (max-width: 720px)` (near line 3437). The last rule in the file (near line 3581) is
`[id] { scroll-margin-top: calc(var(--header-h) + 12px); }`.

Append the following block at the **very end** of `public/styles.css` (after that last `[id]`
rule, so it wins the cascade):

```css
/* Phones: the sticky CTA bar handles conversion, so the header scrolls away with the page. */
@media (max-width: 720px) {
  .site-header {
    position: static;
  }
  [id] {
    scroll-margin-top: 12px;
  }
}
```

Do not edit the existing `.site-header` rule, the `.sticky-cta` rules, or anything else.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0, and `tail -12 public/styles.css` must show the new block.
Print that tail and stop.
