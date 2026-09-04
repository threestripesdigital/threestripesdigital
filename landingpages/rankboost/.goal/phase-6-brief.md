# Phase 6 — Dissolve the footer: drop the wordmark, move the © line into the final CTA section

Working directory is the app root (`landingpages/rankboost`), static Cloudflare Pages site, no build step. `npm test` is 64/64; `bash .goal/verify-phase5.sh` is ALL GREEN.

## Outcome (one sentence)

Neither `public/index.html` nor `public/thank-you.html` has a `<footer>` any more; on index.html the © / disclaimer line is the last element inside `#final`'s container (after `.final-micro`), the `#year` span still gets filled by the existing script, and `bash .goal/verify-phase6.sh` prints `ALL GREEN`.

## Files you may modify

- `public/index.html`
- `public/thank-you.html`
- `public/styles.css`
- `test/endpoints.test.js`

## 1. `public/index.html`

Delete the entire `<footer class="site-footer">…</footer>` block (wordmark and copy). Then, inside `<section class="section final-cta" id="final">` → `.container`, immediately after the `<p class="final-micro">…</p>` line, add:

```html
<p class="final-copy">
  © <span id="year"></span> Three Stripes Digital. Organic search rankings for law firms.
  One firm per niche per city. Ranking examples are from real client campaigns; outcomes vary
  by keyword, market, and website, and no specific result is guaranteed. That’s why we qualify first.
</p>
```

That text is the former footer copy verbatim; do not reword it. The existing script that sets `document.getElementById("year")` stays as is. `id="year"` must appear exactly once in the file. `#final` remains the last `<section>`; `<main>` closes after it, followed by the sticky CTA div and the scripts as before.

## 2. `public/thank-you.html`

Delete the entire `<footer class="site-footer">…</footer>` block. Add nothing in its place.

## 3. `public/styles.css`

- Delete the `.site-footer`, `.footer-inner`, `.footer-brand`, and `.footer-copy` rules (and the `/* ——— Footer ——— */` comment).
- Add, next to `.final-micro`:

```css
.final-copy {
  max-width: 62rem;
  margin: 2.5rem auto 0;
  padding-top: 1.25rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.55;
  text-align: center;
}
```

- Make sure the page still ends cleanly: `.final-cta` keeps its bottom padding, and on phones (≤720px) the fixed `.sticky-cta` must not cover the `.final-copy` text — if the body/main does not already reserve space for the sticky bar at that breakpoint, add `padding-bottom` on `.final-cta` inside the existing `@media (max-width: 720px)` block equal to the sticky bar height (check `.sticky-cta` in styles.css for its height/padding).

## 4. `test/endpoints.test.js`

- In `landing page keeps the simplified VSL structure`: add `assert.doesNotMatch(index, /<footer/)`; add an assertion that the `#final` section (slice from `id="final"` to the next `</section>`) includes `id="year"` and `That’s why we qualify first.`.
- In `thank-you page orders urgency video, breakouts, testimonials, next steps`: replace the footer-slice assertion with `assert.doesNotMatch(source, /<footer/)`.
- Do not weaken any other test.

## Exit criterion

```
bash .goal/verify-phase6.sh    # ALL GREEN
```

Fix every FAIL line and re-run. Reply with a short summary. Do not commit.
