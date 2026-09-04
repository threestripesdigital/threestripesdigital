# Phase 1 brief — Replace the Rank Boost hero VSL placeholder with the Wistia embed

You are working in the repo at the current directory (a Cloudflare Pages project: static `public/`,
Pages Functions in `functions/`). The working tree has uncommitted changes that belong to the
user. **Do not run any git command that changes state** (no commit, stash, checkout, reset, clean,
add). Read-only git (`git diff`, `git status`) is fine.

## Outcome (one sentence)

The hero VSL placeholder on `public/index.html` is replaced by the user's Wistia embed for media
`8uioqg3047`, the Content-Security-Policy is extended (append-only, identically in both places)
so the Wistia player loads, and a regression test locks both in.

## Files you may create or modify — nothing else

- `public/index.html`
- `public/styles.css`
- `public/_headers`
- `functions/_middleware.js`
- `test/endpoints.test.js`

Anything outside this list is out of bounds. In particular **never touch** `public/meta.js`,
anything under `functions/api/`, `router/`, `public/results.js`, `public/book.html`, `wrangler.toml`.
Do not add, remove, or reorder any `fbq(...)` call in `index.html`. The file currently contains
exactly 4 lines containing `fbq(` and must still contain exactly 4 when you are done.

## Step 1 — index.html

In `public/index.html`, inside `<section class="hero-vsl" aria-labelledby="hero-vsl-title">`,
there is this block:

```html
<div class="hero-vsl-frame">
  <div class="hero-vsl-placeholder">
    <span class="hero-vsl-play" aria-hidden="true">▶</span>
    <p id="hero-vsl-title" class="hero-vsl-title">5-minute Rank Boost demo</p>
    <p class="hero-vsl-note">VSL placeholder · production demo video goes here</p>
  </div>
</div>
```

Replace **only** the `hero-vsl-placeholder` div (keep the `hero-vsl-frame` wrapper) so the
frame contains the user's embed, verbatim, plus an accessible title that keeps the
`aria-labelledby="hero-vsl-title"` reference valid. Use exactly this markup:

```html
<div class="hero-vsl-frame">
  <h2 id="hero-vsl-title" class="sr-only">5-minute Rank Boost demo</h2>
  <style>wistia-player[media-id='8uioqg3047']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/8uioqg3047/swatch'); display: block; filter: blur(5px); padding-top:56.25%; }</style>
  <wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>
</div>
```

If `styles.css` does not already define a `.sr-only` (visually hidden) utility, add the
standard one to `styles.css`. Do not change the `<p class="hero-vsl-caption hero-subcopy">`
paragraph that follows the frame, and do not change anything in `<section ... id="qualify">`.

In `<head>`, directly **after** the existing line `<script src="meta.js"></script>` (the Meta
pixel loader must stay first), add exactly:

```html
  <!-- Wistia player for the hero VSL. -->
  <script src="https://fast.wistia.com/player.js" async></script>
  <script src="https://fast.wistia.com/embed/8uioqg3047.js" async type="module"></script>
```

Add nothing else to `<head>`. Do not touch the existing inline `<style>` block for Calendly.

## Step 2 — styles.css

`.hero-vsl-frame` currently has `aspect-ratio: 16 / 9; display: grid; place-items: center;
overflow: hidden;` plus a border, radius and gradient background. Make the player fill the frame:

- Add a rule `.hero-vsl-frame wistia-player { display: block; width: 100%; height: 100%; }`
- Change `.hero-vsl-frame` from `display: grid; place-items: center;` to `display: block;`
  (keep every other declaration: position, width, margin, aspect-ratio, overflow, border,
  border-radius, background).
- Remove the now-unused `.hero-vsl-placeholder`, `.hero-vsl-play` rules and the
  `.hero-vsl-play` line inside the `@media` block near line 363-364; keep `.hero-vsl-title` and
  `.hero-vsl-note` selectors only if they are still referenced (they are not — remove them, but
  keep `.hero-vsl-caption` and its `strong` rule and `.hero-subcopy` untouched).

## Step 3 — CSP, append-only, identical in both files

The policy lives in two places that must stay byte-for-byte identical in meaning:
`public/_headers` (single-line header) and `functions/_middleware.js` (array joined with `"; "`).
The existing test `static responses enforce transport and browser security policy` checks that
several directive strings appear as **prefixes**, so you must **append** new sources to the end of
each directive and never remove or reorder existing ones.

Apply these appends to both files:

| directive | append at end of directive |
|---|---|
| `script-src` | ` https://*.wistia.com https://*.wistia.net https://src.litix.io` |
| `style-src` | ` blob: https://fast.wistia.com` |
| `font-src` | ` https://*.wistia.com` |
| `media-src` | ` blob: data: https://*.wistia.com https://*.wistia.net` |
| `frame-src` | ` https://fast.wistia.com https://fast.wistia.net` |
| `connect-src` | ` https://*.wistia.com https://*.wistia.net https://*.litix.io` |

And add one **new** directive, placed immediately after the `media-src` directive in both files:
`worker-src 'self' blob:`

`img-src` already allows `https:` and `data:` — leave it alone. `default-src`, `base-uri`,
`object-src`, `frame-ancestors`, `form-action`, `upgrade-insecure-requests` — leave alone.

## Step 4 — regression test

In `test/endpoints.test.js`, add one new `test(...)` named
`hero VSL renders the Wistia embed and the CSP allows it` that:

- reads `public/index.html` and asserts it contains
  `<wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>`,
  `https://fast.wistia.com/player.js`, `https://fast.wistia.com/embed/8uioqg3047.js`,
  and does **not** contain `hero-vsl-placeholder`;
- asserts `<script src="meta.js"></script>` appears before `fast.wistia.com/player.js`;
- reads `public/_headers` and calls the middleware (same pattern as the existing security test)
  and asserts both policies contain `https://*.wistia.com` in `script-src`, `connect-src`, and
  `media-src`, `https://fast.wistia.com` in `frame-src`, and `worker-src 'self' blob:`.

Follow the style of the surrounding tests (node:test, `assert`, `readFile(new URL(..., import.meta.url))`).

## Exit criteria

Run, from the repo root:

```
bash .goal/verify-vsl.sh
```

It must print `ALL GREEN` and exit 0. It also runs `npm test` (61 tests pass today; you add 1).
If anything is red, fix it within the allowed files and rerun. Do not edit `.goal/verify-vsl.sh`.

When done, print a short summary listing exactly which files you changed and the final line of
the verify script.
