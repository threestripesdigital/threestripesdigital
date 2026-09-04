# Phase 2 — Restructure the booking confirmation page (`public/thank-you.html`)

Static Cloudflare Pages site (no build step), working directory is the app root (`landingpages/rankboost`). Tests: `npm test` (`node --test`, currently green). This page loads after a prospect books their call on Calendly; it exists to raise their interest before the call so show rate stays high.

## Outcome (one sentence)

`public/thank-you.html` reads, top to bottom: header → booking-confirmation H1/lead (existing verification state machine, unchanged) → `#ty-urgency` founder urgency-video placeholder → `#ty-breakouts` four objection-video placeholders (each marked under 3 minutes) → `#ty-testimonials` the four on-camera testimonials plus the before/after sliders and email/text proofs → `#ty-next-steps` (the existing Step 1 / Step 2 booking actions, still hidden until the server verifies the booking, then the 4-step timeline and the back button) → footer, and `bash .goal/verify-confirmation.sh` prints `ALL GREEN`.

## Files you may create or modify

- `public/thank-you.html`
- `public/styles.css` (only if a rule genuinely belongs in the shared sheet; page-specific rules go in the page's own `<style>` block like the existing `.ty-*` rules)
- `test/endpoints.test.js`

Anything else is out of bounds: do NOT touch `public/index.html`, `public/meta.js`, `public/_headers`, `functions/**`, `router/**`, `public/results.*`, `public/book.*`, `.goal/**`.

## The videos do not exist yet

Build placeholders that the owner can swap for a Wistia embed later without touching anything else. Use this exact pattern for each of the five slots:

```html
<article class="ty-video ty-video-placeholder" data-video-slot="breakout-white-hat" data-max-minutes="3">
  <div class="ty-video-frame" role="img" aria-label="Video coming soon: Is this white hat?">
    <!-- To go live, replace this .ty-video-frame div with:
         <wistia-player media-id="MEDIA_ID" aspect="1.7777777777777777"></wistia-player>
         and add the two fast.wistia.com <script> tags from public/index.html <head> once.
         The CSP already allows Wistia. Keep this video under 3 minutes. -->
    <span class="ty-video-badge">Video coming soon</span>
  </div>
  <h3>Is this white hat?</h3>
  <p class="ty-video-meta">Under 3 minutes</p>
</article>
```

Slots and titles (use these exact `data-video-slot` values and headline strings):

| slot | data-max-minutes | h3 |
|---|---|---|
| `founder-urgency` | (omit the attribute) | `What we’ll cover on the call, and what to have ready` |
| `breakout-white-hat` | `3` | `Is this white hat?` |
| `breakout-existing-rankings` | `3` | `Will this hurt my existing rankings?` |
| `breakout-if-it-doesnt-work` | `3` | `What happens if it doesn’t work?` |
| `breakout-competitors` | `3` | `Do you work with my competitors?` |

The founder slot's `.ty-video-meta` reads `A short video from Bilal Amin, founder · coming soon`. The four breakout slots' meta reads `Under 3 minutes`. Do not write teaser answers under the placeholders and do not invent any claim; the titles are the only copy. The frame is 16:9, dark navy (`var(--navy-2)`), rounded like `.hero-vsl-frame`, with the badge centred; use the existing gold/navy tokens from `styles.css`. Breakouts sit in a 2-column grid on desktop (1 column under 700px). No live `<wistia-player>` element may appear in this file yet.

## Page structure to produce

1. `<header class="site-header">` — unchanged.
2. `<main class="ty">` opening `.ty-core` with `<h1 id="ty-title">Confirming your call…</h1>` and `<p class="lead" id="ty-lead">` — unchanged markup. In the JS `apply()` function change only the lead sentence assigned on success from `Two quick things below and you’re set. You don’t need to prepare anything.` to `Watch the short videos below, then finish the two quick steps at the bottom of this page.` The string `You don’t need to prepare anything.` must no longer appear anywhere in the file. `title.textContent = "Your call is booked."` stays exact.
3. `<section class="ty-block" id="ty-urgency" aria-labelledby="ty-urgency-h">` — `<h2 id="ty-urgency-h">A quick word from Bilal before your call</h2>`, then the `founder-urgency` placeholder (max-width ~860px, centred).
4. `<section class="ty-block" id="ty-breakouts" aria-labelledby="ty-breakouts-h">` — `<h2>Questions lawyers ask before the call</h2>`, `<p class="ty-block-sub">Each one is under three minutes.</p>`, then the four breakout placeholders in the order listed above.
5. `<section class="ty-block" id="ty-testimonials" aria-labelledby="ty-testimonials-h">` — move the existing `.ty-proof` block here (keep its h2 `While you wait: what happens when Google starts working` and sub line). Inside the `.ty-wall`, KEEP: the four `article.video-card` testimonials (add `data-video-slot="vernsten"`, `"cruzgold"`, `"ticketcrushers"`, `"wisconsinimmigration"` to them respectively, matching index.html), the three `.ba-card` before/after sliders, and every `proof/anon/*` email/text figure, plus the `.ty-wide-figure` lead-inbox picture after the wall. REMOVE every `<figure>` whose image is `wins/*.webp` (those rank-tracker cards live on the landing page). Keep the `data-m` ordering attributes on what remains so the existing mobile flatten-and-sort script still works; keep the two-column structure.
6. `<section class="ty-block" id="ty-next-steps" aria-labelledby="ty-next-steps-h">` — `<h2>Your next steps</h2>`, `<p class="ty-block-sub">Two quick things now, then here’s how the boost unfolds.</p>`, then the existing `<div class="ty-actions" id="booking-actions" hidden>` (Step 1 accept the invite with the email mock, Step 2 save the number with the iMessage mock — markup unchanged, still `hidden` until verification), then the existing `.ty-steps` 4-step timeline (unchanged), then the existing `.ty-core` with the `Back to the page` button and `.ty-note` (unchanged).
7. `<footer class="site-footer">`, the `#ty-lightbox` dialog, and the whole `<script>` — unchanged apart from the one lead sentence above. All of these must keep working: booking verification (`fetch("api/booking"`), `retryPendingTrack(0)`, `cleanTokenState()`, the `Schedule` `fbq(` call, the `rankboost:booking-verified` confetti, the mobile `[data-m]` flatten, the `[data-ba]` sliders, and the lightbox.

Section heading style: reuse the look of the existing `.ty-proof h2` / `.ty-proof-sub` (centred, same sizes) via new `.ty-block h2` / `.ty-block-sub` rules in the page's `<style>` block; give `.ty-block` consistent vertical spacing (about 3rem between blocks). Do not add a step-progress header, countdown, or any other new element.

## Edits to `test/endpoints.test.js`

Add one test, `thank-you page orders urgency video, breakouts, testimonials, next steps`, that reads `public/thank-you.html` and asserts: the ordered `<section ... id="...">` ids equal `["ty-urgency","ty-breakouts","ty-testimonials","ty-next-steps"]`; the five `data-video-slot` placeholder values above are present; there are exactly four `data-max-minutes="3"`; `id="booking-actions" hidden` appears after `id="ty-next-steps"`; no `<wistia-player` element is present; no `src="wins/` image is present. Do not delete or weaken any existing test (the existing `thank-you UI waits for booking evidence before confirmation` test must still pass unchanged).

## Invariants

- `<script src="meta.js"></script>` stays in `<head>`; exactly 1 line contains `fbq(`; `<meta name="robots" content="noindex,nofollow" />` stays.
- No file outside the three allowed files changes.
- `npm test` passes.

## Exit criterion

```
bash .goal/verify-confirmation.sh
```

must exit 0 and print `ALL GREEN`. Run it, read every `FAIL` line, fix, re-run until green. Do not edit the verifier. When green, reply with a short summary and the final `npm test` count. Do not commit.
