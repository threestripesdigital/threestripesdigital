# Phase 1 — Simplify the Rank Boost VSL landing page

You are working in a static Cloudflare Pages site (no build step). The working directory is the app root (`landingpages/rankboost`). Tests: `npm test` (`node --test`, currently 62/62 green).

## Outcome (one sentence)

`public/index.html` contains, top to bottom, ONLY: header (wordmark + CTA) → headline → Wistia VSL + its caption → "Get my free boost" button that opens the inline qualification form → trust-logo marquee → recent wins (rank-tracker cards) → the four on-camera video testimonials → a six-question FAQ → final CTA → sticky mobile CTA → footer, with every removed section's CSS deleted and `bash .goal/verify-landing.sh` printing `ALL GREEN`.

## Why

The page is a VSL funnel. Text sections below the video repeat what the 5-minute video says and steal attention from pressing play. Everything that stays below the VSL must be either visual proof the video cannot show (wins, logos, testimonials) or objection handling the video does not cover (FAQ).

## Files you may create or modify

- `public/index.html`
- `public/styles.css`
- `test/endpoints.test.js`

Anything else is out of bounds. In particular do NOT touch `public/meta.js`, `public/_headers`, `functions/**`, `router/**`, `public/results.js`, `public/book.*`, `public/thank-you.html`, `public/partner.*`, `public/privacy.html`, `.goal/**`.

## Exact edits to `public/index.html`

Keep (byte-for-byte unless stated):
1. `<head>` as is (meta.js loader first, then the two Wistia scripts, then the inline `<style>`).
2. `<header class="site-header">` — keep; its CTA already reads `Get my free boost`.
3. `<section class="hero" id="top">` containing `.hero-intro` (the `<h1>` — do not change a character), `<section class="hero-vsl">` (Wistia player, sr-only title, caption paragraph — unchanged), and `<section class="section qualify hero-qualify" id="qualify">` (the toggle button + form). Change ONLY the toggle button's visible text from `GET MY FREE BOOST NOW` to `Get my free boost`. Do not change the form markup, field order, ids, validation, consent paragraph, or submit button text (`Check my current rankings · free`).
4. `<section class="marquee-section" id="trusted">` — unchanged.
5. `<section class="section wins" id="wins">` — unchanged content (31 `win-card` figures, `#win-toggle`, its `.cta-inline`); only the inline CTA label changes to `Get my free boost`.
6. `<section class="section videos" id="partners">` — unchanged content (4 `video-card` articles); only the inline CTA label changes to `Get my free boost`.
7. `<section class="section faq" id="faq">` — keep the section head unchanged. Keep exactly these six `<details class="faq-item">` in this order, each with its existing answer text unchanged:
   1. `Why is this free? It seems too good to be true.`
   2. `Is this bot traffic or some black-hat trick?`
   3. `How long does the boost last?`
   4. `Is this local pack / Google Maps ranking?`
   5. `Do you take multiple firms in the same niche and city?`
   6. `Are the case studies and wins from the free boost?`
   Delete these four: `How fast will I see movement?`, `What does it cost?`, `Will this help me show up in AI search (ChatGPT, etc.)?`, `Who is this for, and who should skip it?`.
8. `<section class="section final-cta" id="final">` — keep; change the button label from `Claim my free rank boost` to `Get my free boost`. Keep the h2, lead and micro line as they are.
9. `<div class="sticky-cta">` — keep; label → `Get my free boost`.
10. `<footer>` and the form/submit `<script>` block — unchanged.

Delete entirely (markup AND the JS that drives it):
- `<aside class="gserp" id="gserp">` inside the hero grid, and the whole `<script>` block that defines `initGserp` (the animated fake Google SERP). Nothing else references it.
- `<section class="section problem" id="problem">` ("Indexed, optimized, and stuck on page 2–5").
- `<section class="section how" id="how">` ("Three steps. About forty-eight hours.").
- `<section class="section compare" id="different">` — BOTH halves: the `.why-block` founder/FAANG block and the `.cmp` comparison table, plus its inline CTA.
- `<section class="section proof-wall" id="inbox-proof">` (anonymized emails/texts; the named video testimonials are the one testimonial section we keep).
- Renumber or drop the `<!-- N. ... -->` section comments so they read in order; do not leave comments referring to deleted sections.

Final `<section ... id="...">` document order must be exactly: `top qualify trusted wins partners faq final` (the `hero-vsl` section has no id and stays inside `#top`). Total `<section` count = 8.

Every primary CTA on the page (header, form toggle, the two inline CTAs, final, sticky) must read exactly `Get my free boost`. The strings `GET MY FREE BOOST NOW`, `Get my free rank boost`, `Claim my free rank boost` must not appear anywhere in the file.

Do not add any section, block, or copy that is not listed above. Do not rewrite any kept copy.

## Edits to `public/styles.css`

Delete the rules that only styled the removed markup. Before deleting a rule, `grep -rn` its class across `public/*.html` and `public/*.js` to confirm nothing else uses it. Expected to go: `.problem*`, `.steps*` / step counters used by `#how` (NOT the funnel shell classes `.step-body .step-header .step-track .step-main .step-result .step-h .step-cta* .step-back .step-footer .step-agenda .step-in`, which `results.html`/`book.html`/`results.js` use), `.how*`, `.compare`, `.cmp*` (NOT `.opp-cmp*`, used by `results.js`/`partner.js`), `.why*`, `.tsd-stripes`, `.faang-*`, `.proof-wall`, `.proof-grid`, `.proof-card*`, `.gserp*` and `@keyframes gserp-pulse`, and the long-dead `.video-ph*`, `.video-play`, `.video-ph-label`, plus the older duplicate `.video-card`/`.video-card h3`/`.video-role`/`.video-card blockquote` block near line 3147 that conflicts with the live one near line 3829 (keep the later block). Also remove media-query fragments that only targeted those selectors. Keep `.section-head-center` (the FAQ uses it).

Then make sure the sections that are now adjacent (`#trusted` → `#wins` → `#partners` → `#faq` → `#final`) do not produce a doubled divider line where two `border-top`/`border-bottom` rules now meet; fix by removing the redundant border, not by adding new decoration. Keep `.hero-qualify .qualify-form-toggle[hidden] { display: none !important; }` exactly.

## Edits to `test/endpoints.test.js`

- In `qualification form uses a one-way accessible disclosure trigger`: the slice end marker `index.indexOf("gserp", qualifyStart)` must change to a marker that still exists after the aside is removed (use `'id="trusted"'`). Update the trigger regex text from `GET MY FREE BOOST NOW` to `Get my free boost`.
- In `results UI distinguishes durable fallback from unsaved failures`: the assertion `assert.match(styles, /\.problem-card \{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;/)` references CSS that is being removed. Repoint it to the equivalent `.win-card` rule if one has `min-width: 0` / `overflow: hidden`, otherwise delete just that one assertion.
- Add one new test, `landing page keeps the simplified VSL structure`, that reads `public/index.html` and asserts: the ordered list of `<section ... id="...">` ids equals `["top","qualify","trusted","wins","partners","faq","final"]`; `id="problem"`, `id="how"`, `id="different"`, `id="inbox-proof"`, `id="gserp"` are absent; the number of `<details class="faq-item"` is between 5 and 6; `GET MY FREE BOOST NOW` is absent.
- Do not delete or weaken any other test.

## Invariants (must hold, the verifier checks them)

- `<script src="meta.js"></script>` stays first in `<head>`; exactly 4 lines in `index.html` contain `fbq(`; the `LeadFormOpened` custom event line is unchanged.
- Exactly one `<wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>`; both Wistia `<script>` tags unchanged.
- The form redirect `window.location.href = "results";` is unchanged.
- No file outside the three allowed files changes (`git status` will show it).
- `npm test` passes.

## Exit criterion

```
bash .goal/verify-landing.sh
```

must exit 0 and print `ALL GREEN`. Run it yourself, read every `FAIL` line, fix, and re-run until green. Do not edit `.goal/verify-landing.sh`. When green, reply with a short summary of what you removed and the final `npm test` count. Do not commit.
