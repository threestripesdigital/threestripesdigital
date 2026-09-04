# Rank Boost page — UI consistency audit (2026-09-02)

Method: live page captured headless at 390×844 (phone) and 1440×900 (desktop) with lazy images
loaded, plus a full static read of `public/index.html`, `public/styles.css`, `DESIGN.md`.
Line refs are to the integration worktree (`landingpages/rankboost/public/...`).

## A. Visible on the page (ranked by how much a visitor notices)

1. **Hero headline breaks "page 2–5" across two lines on phones** ("page 2–" / "5 to page 1").
   Fix: wrap the range in `white-space: nowrap` or use a non-breaking hyphen/space.
2. **Fourth testimonial video is a black tile** (Will Bortz, index.html:680 has no `poster=`; the
   other three do). Fix: add a poster frame.
3. **Two of four testimonial videos are portrait inside landscape frames** → heavy black
   letterboxing next to two full-bleed landscape videos. Fix: crop/re-export portrait sources to
   16:9, or give the grid `object-fit: cover` with a fixed 16:9 frame.
4. **Proof-wall grid leaves large empty pockets on desktop**: cards of unequal height in a 2-col
   grid (short email left / tall email right; short iMessage left / tall email right) leave
   100–150px voids under the short cards. Fix: `grid-auto-flow: dense` with row spans, or a
   CSS-columns masonry, or crop the tall screenshots.
5. **Video cards: two conflicting `.video-card` rules** (styles.css:3147 and :3829) → square black
   video frame inset inside a rounded card, doubled bottom padding. Fix: delete the :3147 block,
   card padding 0, media edge-to-edge like win/proof cards.
6. **CTA labels differ**: `GET MY FREE BOOST NOW` (hero, shouting caps), `Get my free boost`
   (header), `Get my free rank boost` (×7), `Claim my free rank boost` (final),
   `Check my current rankings · free` (submit). Fix: one label, sentence case, everywhere.
7. **"Show more wins" ghost button stacked directly on the gold CTA** (wins section), two
   full-height buttons in a column. Fix: make "Show more" a text link, or put it above the grid's
   last row.
8. **Section dividers inconsistent**: `how`, `wins`, `faq` have top+bottom borders, others none;
   `how`→`wins` produces a doubled line; `compare`→`videos` has no separation at all.
   Fix: one `border-top` on every `.section` (or alternate backgrounds, no borders).
9. **FAQ heading capped at 22ch** so it wraps to two lines on desktop while every other h2 is
   single-line full width (styles.css:3481). Fix: drop `.section-head-center`.
10. **Final CTA breaks the section-head pattern**: no eyebrow, its own h2/lead max-widths
    (styles.css:2930, :2936). Fix: wrap in `.section-head`, add an eyebrow.
11. **Founder block is the one unboxed, ornamented block**: unique three-dash eyebrow marker
    (`.tsd-stripes`), offset gold drop-shadow on the photo, 18px radius; everything else is a
    bordered card. Its stacked margins also leave ~85px above the compare heading, about double
    the new section gap. Fix: card it (an unused `.why-panel` rule exists) or remove the ornaments
    and halve the margin.
12. **Marquee logos mixed**: 24px circles vs one 64×24 rectangle (Senor Ticket). Fix: same 24px
    circular frame for all.
13. **Footer wordmark differs from header wordmark** (no gold "Digital", smaller). Fix: reuse
    `.wordmark`.
14. **Card numbering uses two mechanisms/styles**: literal `01` spans in problem cards vs CSS
    counters in steps, different weight/tracking/margin. Fix: one method, one style.
15. **Wins card art inconsistent**: one card ("immigration lawyer philadelphia") shows
    "live rank tracking" and no "in N days" while the other eight show date ranges and a
    duration. Asset-level, regenerate that image.

## B. System-level (tokens, scale, breakpoints)

16. **Border-radius has seven values** (8/9/10/12/14/16/18px). Fix: cards `--radius-lg`,
    chips/controls `--radius`.
17. **Grid gaps drift** (1 / 1.1 / 1.15 / 1.25rem; lists .65). Fix: one `--gap` token.
18. **Card body copy in four sizes and three colours** (.85/.9/.93/.95rem; `#CBD5E1`, `#E2E8F0`,
    `--muted`). Fix: `--text-sm` + one secondary colour token.
19. **h3 in five sizes** (1.05/1.1/1.15/1.25/1.35rem). Fix: base 1.15 for cards, one "name" size.
20. **Ten mono micro-label styles** with different tracking/colour/weight; `.final-micro` and
    `.cta-inline-note` are near-duplicates. Fix: one `.label-mono` with gold/muted variants.
21. **Hard-coded colours instead of tokens**: `#0A1628` ×8, `#F87171` ×7, four different
    "darker navy"s, a 12-step gold-alpha ladder, literal SVG fills. Fix: add `--navy-deep`,
    `--text-2`, `--gold-a10/20/35` tokens.
22. **Three-column grids collapse at four different breakpoints** (760/900, 860, 700, 560/900,
    720) and `.steps` has no 2-col stage. Fix: standardise on 720 and 960.
23. **Primary button in three sizes on one page** (header, sticky bar, in-flow). Fix: sticky bar →
    `.btn-lg`; header stays the single small variant.
24. **Hard-coded max-widths alongside `--max`** (800, 720, 860, 900, 1000px). Fix: two tokens.
25. **Link styles vary** (gold no-underline / muted underline / muted no-underline). Fix: one
    in-copy rule, one nav rule.

## C. Accessibility and hygiene

26. **No `:focus-visible` style on buttons, links, FAQ summaries** (only inputs get the gold
    ring). Fix: one rule for `.btn, a, summary`.
27. **Lightbox not keyboard-reachable, no focus restoration** (images aren't buttons;
    `role="dialog"` on a div). Fix: `<button>` wrappers + `<dialog>`.
28. **Inline styles in FAQ** (`strong style=…`, `p style=…`). Fix: two `.faq-body` rules.
29. **Duplicate selectors with different values** (`.video-role`, `.video-card h3`,
    `.hero-vsl-caption`, `.c3-wait`, `.proof-card figcaption`). Fix: delete the earlier copies.
30. **~700 lines of dead CSS** (old hero card/serp, pviz, cred, cases, fit, guarantee, trust-strip,
    video placeholders, stats-grid, get-started…). Deleting it also removes three orphan
    breakpoints (640, 700, 859).

## Verified OK

- No horizontal overflow at 390px; every grid collapses to one column; header is static on
  phones; sticky CTA bar and header switch at the same 720px breakpoint.
- Eyebrow + centred h2 pattern is identical on seven of nine section heads.
- `.btn-primary` gradient/shadow/hover single-sourced; card borders all use `--line`.
- Reduced-motion honoured; input focus/invalid states consistent; z-index ladder sane.
- Section padding now uniform (after today's change); the four inline CTA blocks are identical.
