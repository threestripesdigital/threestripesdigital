# Phase 5 — Add Stuart Allen Law Firm to the trust marquee; remove links from the confirmation-page footer

Working directory is the app root (`landingpages/rankboost`), static Cloudflare Pages site, no build step. `npm test` is 64/64 and `bash .goal/verify-phase4.sh` is ALL GREEN; both must stay green.

## Outcome (one sentence)

The `#trusted` marquee on `public/index.html` includes `Stuart Allen Law Firm` with its local logo, the `<footer>` on `public/thank-you.html` contains no links (matching index.html), and `bash .goal/verify-phase5.sh` prints `ALL GREEN`.

## Files you may modify

- `public/index.html`
- `public/thank-you.html`
- `test/endpoints.test.js`

`public/logos/stuart-allen-law-firm.png` already exists (128×128, added by the orchestrator). Do not touch `public/styles.css` or anything else.

## 1. Marquee — add one item to the RIGHT track

In `public/index.html`, in **both** `.marquee-right` segments (the visible one and its `aria-hidden="true"` duplicate must stay identical), append as the 7th item, after `Brar Tamber Rigby Badham`:

```html
<div class="marquee-item"><img src="logos/stuart-allen-law-firm.png" alt="" width="64" height="64"><span>Stuart Allen Law Firm</span></div>
```

Result: left track 7 items ×2, right track 7 items ×2, total `class="marquee-item"` count = 28. Same attributes pattern as every other item. Do not reorder anything else.

## 2. Confirmation page footer — remove all links

In `public/thank-you.html` the footer currently is:

```html
<footer class="site-footer">
  <div class="container footer-inner">
    <div class="footer-brand">Three Stripes Digital</div>
    <nav class="footer-links" aria-label="Footer">
      <a href="privacy">Privacy</a> …
    </nav>
  </div>
</footer>
```

Delete the whole `<nav class="footer-links" …>…</nav>`. Keep `<footer class="site-footer">`, `.footer-inner`, and `.footer-brand` exactly. Add nothing else (no copy line, no new markup). The footer must contain no `<a` element. (`.footer-inner` is already `flex-direction: column` in styles.css after phase 4, so nothing to restyle.)

## 3. Tests

In the existing `landing page keeps the simplified VSL structure` test add `assert.ok(index.includes("Stuart Allen Law Firm"))`. In the existing `thank-you page orders urgency video, breakouts, testimonials, next steps` test add an assertion that the footer block (`source.slice(source.indexOf('<footer'), source.indexOf('</footer>'))`) does not match `/<a\s/` and does not include `footer-links`. Do not weaken any other test.

## Exit criterion

```
bash .goal/verify-phase5.sh    # ALL GREEN (runs verify-phase4.sh, verify-confirmation.sh and npm test too)
```

Fix every FAIL line and re-run. Reply with a short summary. Do not commit.
