# Phase 3 brief — remove the hero eyebrow line

Working tree has uncommitted user changes. **No state-changing git commands** (no commit, stash,
checkout, reset, clean, add).

## Outcome (one sentence)

The single eyebrow line `Free organic rank boost · Law firms only` above the hero `<h1>` in
`public/index.html` is removed so the hero content moves up; nothing else changes.

## Files you may modify — nothing else

- `public/index.html`

## Exact edit

Inside `<section class="hero" id="top">` → `<div class="hero-intro">` there is exactly one line:

```html
          <p class="eyebrow">Free organic rank boost · Law firms only</p>
```

Delete that one line (and the blank line directly after the `<h1>` if it leaves two consecutive
blank lines). Do not touch any other `.eyebrow` element elsewhere on the page, the `<h1>`, the
`hero-vsl` section, the qualify form, or anything in `<head>`.

## Exit criteria

```
bash .goal/verify-vsl.sh
```

must print `ALL GREEN` and exit 0, and
`grep -c 'Free organic rank boost · Law firms only' public/index.html` must print `0`.
Then print `git diff --stat -- public/index.html` and stop.
