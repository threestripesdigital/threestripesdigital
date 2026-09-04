# Phase 2b — Unescape the Wistia snippet inside the placeholder comments

Working directory is the app root (`landingpages/rankboost`). Phase 2 is complete and green. One cosmetic defect: in `public/thank-you.html`, the five HTML comments inside the `.ty-video-frame` placeholders show the swap-in snippet HTML-escaped:

```
&lt;wistia-player media-id="MEDIA_ID" aspect="1.7777777777777777"&gt;&lt;/wistia-player&gt;
```

Inside an HTML comment no escaping is needed, and the owner will copy this text verbatim, so it must read:

```
<wistia-player media-id="MEDIA_ID" aspect="1.7777777777777777"></wistia-player>
```

## Exact edit

In `public/thank-you.html` only, replace every `&lt;` with `<` and every `&gt;` with `>` **inside those five placeholder comments only** (the comments that begin `<!-- To go live, replace this .ty-video-frame div with:`). Change nothing else anywhere.

## Files you may modify

- `public/thank-you.html`

## Exit criterion

```
grep -c 'wistia-player media-id="MEDIA_ID"' public/thank-you.html   # prints 5
grep -c '&lt;wistia-player' public/thank-you.html                     # prints 0
bash .goal/verify-confirmation.sh                                     # ALL GREEN
```

(The structure test strips comments before asserting that no live `<wistia-player>` element exists, so it stays green.) Reply with one line. Do not commit.
