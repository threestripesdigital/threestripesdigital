# Phase 1b — Remove leaked shell output from `public/index.html`

Working directory is the app root (`landingpages/rankboost`). Phase 1 (simplifying the landing page) is otherwise complete and `bash .goal/verify-landing.sh` is green, but two lines of git error output were accidentally pasted into the HTML between the testimonials section and the FAQ section.

## Outcome (one sentence)

`public/index.html` no longer contains the two stray lines beginning `fatal: path 'landingpages/rankboost/public/index.html'` and `hint: Did you mean 'HEAD:landingpages/rankboost/public/index.html'`, and nothing else changes.

## Exact edit

Delete exactly these two lines (currently lines 392–393, immediately after the `</section>` that closes `#partners` and before `<!-- 5. FAQ -->`):

```
fatal: path 'landingpages/rankboost/public/index.html' exists, but not 'public/index.html'
hint: Did you mean 'HEAD:landingpages/rankboost/public/index.html' aka 'HEAD:./public/index.html'?
```

Leave one blank line between `</section>` and `<!-- 5. FAQ -->`. Change nothing else in any file.

## Files you may modify

- `public/index.html` only.

## Exit criterion

```
grep -n -E '^(fatal|hint):' public/index.html   # must print nothing
bash .goal/verify-landing.sh                      # must print ALL GREEN
```

Reply with one line confirming the two lines are gone. Do not commit.
