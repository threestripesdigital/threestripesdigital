# Phase 2 brief — remove the dead space above the hero eyebrow

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

The hero section (`<section class="hero" id="top">` in `public/index.html`) has a much smaller
top padding so the "Free organic rank boost · Law firms only" eyebrow sits close under the sticky
header, and nothing else on the page moves.

## Files you may modify — nothing else

- `public/styles.css`

## Exact edit

In `public/styles.css`, the rule near line 211 is:

```css
.hero {
  padding: clamp(3.5rem, 8vw, 6rem) 0 clamp(4rem, 8vw, 6.5rem);
  ...
}
```

Do **not** edit that rule (the `.hero` class is reused elsewhere, e.g. `.step-cta-wrap.hero`).
Instead, add this new rule immediately after the closing brace of that `.hero { ... }` block:

```css
/* Hero only: tighten the gap between the sticky header and the eyebrow. */
#top.hero {
  padding-top: clamp(1.25rem, 3vw, 2rem);
}
```

Nothing else changes: no other selector, no HTML, no bottom padding.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0, and
`grep -c '#top.hero' public/styles.css` must print `1`.
Then print the new rule and stop.
