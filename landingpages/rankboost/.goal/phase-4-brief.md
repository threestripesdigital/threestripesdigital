# Phase 4 — Owner feedback on the preview: footer, final CTA, FAQ heading, trust marquee

Working directory is the app root (`landingpages/rankboost`), static Cloudflare Pages site, no build step. `npm test` is 64/64 green and `bash .goal/verify-landing.sh` is ALL GREEN; both must stay that way.

## Outcome (one sentence)

On `public/index.html` the footer has no links, the final-CTA heading and the FAQ heading span the full container width, the final-CTA lead reads the new sentence, and the trust marquee shows corrected firm names with every logo served from `public/logos/` as a 24px circle, with `bash .goal/verify-phase4.sh` printing `ALL GREEN`.

## Files you may modify

- `public/index.html`
- `public/styles.css`
- `test/endpoints.test.js`

The logo files already exist in `public/logos/` (added by the orchestrator, do not edit or add images). Everything else is out of bounds.

## 1. Footer — remove all links

In `<footer class="site-footer">` delete the whole `<nav class="footer-links" …>…</nav>` element (Privacy, Terms, Contact, Qualify). Keep `.footer-brand` and `.footer-copy` with their text unchanged. In `styles.css` delete the `.footer-links` rules and adjust `.footer-inner` so brand and copy still lay out cleanly without the nav (brand on its own line, copy below; no empty gap where the nav was). The footer must contain no `<a` element at all.

## 2. Final CTA (`#final`)

- Heading `See whether a rank-boost test fits your firm.` must span full width: remove `max-width: 18ch` from `.final-cta h2` (keep it centred). It should render on one line on desktop.
- Replace the lead paragraph text exactly with:
  `If your best law-firm keywords are stuck between positions 2 and 50, you’ll see movement in under 48 hours.`
  (The old sentence about "positions 11 and 50 … without handing over logins" must not remain anywhere in the file.) Give `.final-cta .lead` the same max-width as `.section-head .lead` so it matches the other section leads.

## 3. FAQ heading

`Straight answers before you apply` must span full width: remove `max-width: 22ch` from `.section-head-center h2` (keep `.section-head-center` centring and the eyebrow rule).

## 4. Trust marquee (`#trusted`) — names and logos

Rebuild the items in both `.marquee-left` segments (the visible one and its `aria-hidden="true"` duplicate must be identical) and both `.marquee-right` segments as follows, in this order. Every `<img>` uses a local file, `alt=""`, `width="64" height="64"`, no `class="marquee-logo"`.

Left track (7):
1. `logos/vanwa-sm.png` — `VanWa Legal`
2. `logos/rensch-rensch.png` — `Rensch &amp; Rensch`
3. `logos/mahdavi-family-law.png` — `Mahdavi &amp; Mahdavi Family Law`
4. `logos/senor-ticket.png` — `Señor Ticket`
5. `logos/vernsten-law.png` — `Vernsten Law`
6. `logos/ticket-crushers.png` — `Ticket Crushers`
7. `logos/cruz-golden-associates.png` — `Cruz Gold &amp; Associates`

Right track (6):
1. `logos/priest-sm.png` — `Priest Criminal Defense`
2. `logos/wisconsin-immigration.png` — `Wisconsin Immigration Lawyers`
3. `logos/macomb-divorce.png` — `Macomb County Divorce Lawyer`
4. `logos/hopson-law.png` — `Hopson Law`
5. `logos/thyberg-family-law.png` — `Thyberg Family Law`
6. `logos/brar-tamber.png` — `Brar Tamber Rigby Badham`

No `google.com/s2/favicons` URL and no `senorticket.com` URL may remain in the file. In `styles.css` delete the `.marquee-item img.marquee-logo` rule; every marquee image is the same 24px circle (`.marquee-item img` rule unchanged). Keep the marquee animation, label, and the `.marquee-section` rule that the tests assert (`overflow-x: clip; contain: paint;`).

## 5. Tests

Extend the existing `landing page keeps the simplified VSL structure` test (or add one test) to assert: `index.html` contains no `footer-links`, no `google.com/s2/favicons`, no `senorticket.com`; contains `Cruz Gold &amp; Associates` and `Señor Ticket`; and contains the new final-CTA lead sentence. Do not delete or weaken other tests.

## Invariants

- The `<footer>` still has `class="site-footer"`, `.footer-brand`, `.footer-copy`, and the `id="year"` span.
- Section order, CTA labels, Wistia embed, `meta.js`, `fbq(` count (4), form markup: unchanged (`verify-landing.sh` checks all of it).
- No stray shell output in any file.

## Exit criterion

```
bash .goal/verify-phase4.sh
```

must print `ALL GREEN` (it also runs `verify-landing.sh` and `npm test`). Fix every `FAIL` line and re-run. Do not edit the verifiers. Reply with a short summary. Do not commit.
