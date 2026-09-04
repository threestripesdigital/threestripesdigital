#!/usr/bin/env bash
# Phase 6 exit criteria: no footer on either page; © line ends the final CTA section.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }
IDX=public/index.html
TY=public/thank-you.html
CSS=public/styles.css

for f in "$IDX" "$TY"; do grep -q '<footer' "$f" && bad "<footer> still in $f" || ok "no <footer> in $f"; done
for tok in site-footer footer-inner footer-brand footer-copy footer-links; do
  grep -q "$tok" "$IDX" "$TY" "$CSS" && bad "$tok still referenced" || ok "$tok gone"
done
final=$(sed -n '/<section class="section final-cta" id="final">/,/<\/section>/p' "$IDX")
[ -n "$final" ] && ok "#final section found" || bad "#final section not found"
printf '%s' "$final" | grep -q 'id="year"' && ok "#year span lives in #final" || bad "#year span not in #final"
printf '%s' "$final" | grep -q 'no specific result is guaranteed.' && ok "© copy lives in #final" || bad "© copy not in #final"
grep -q 'qualify first' "$IDX" && bad "'qualify first' sentence still present" || ok "'qualify first' sentence removed"
printf '%s' "$final" | grep -q 'class="final-copy"' && ok "final-copy element present" || bad "final-copy element missing"
mpos=$(printf '%s\n' "$final" | grep -n 'class="final-micro"' | head -1 | cut -d: -f1); cpos=$(printf '%s\n' "$final" | grep -n 'class="final-copy"' | head -1 | cut -d: -f1)
[ -n "$mpos" ] && [ -n "$cpos" ] && [ "$cpos" -gt "$mpos" ] && ok "final-copy comes after final-micro" || bad "final-copy is not after final-micro"
n=$(grep -c 'id="year"' "$IDX"); [ "$n" -eq 1 ] && ok "id=year appears once" || bad "id=year appears $n times"
grep -q 'getElementById("year")' "$IDX" && ok "year script intact" || bad "year script missing"
for t in 'Organic search rankings for law firms.' 'One firm per niche per city.' 'no specific result is guaranteed.'; do grep -qF -- "$t" "$IDX" && ok "copy kept: $t" || bad "copy lost: $t"; done
grep -q '^\.final-copy {' "$CSS" && ok ".final-copy rule present" || bad ".final-copy rule missing"
grep -q '<footer' "$TY" && bad "thank-you still has a footer" || ok "thank-you has no footer"
node .goal/class-coverage.mjs "$IDX" "$CSS" | sort > .goal/classes-missing-index.txt
newmiss=$(comm -13 .goal/classes-missing-index-baseline.txt .goal/classes-missing-index.txt); [ -z "$newmiss" ] && ok "no undefined classes in index.html" || { bad "undefined classes in index.html:"; say "$newmiss"; }
for f in "$IDX" "$TY" "$CSS" test/endpoints.test.js; do grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f" && bad "stray shell output in $f" || ok "no stray shell output in $f"; done
allowed="public/index.html public/thank-you.html public/styles.css test/endpoints.test.js"
changed=$(git -C "$ROOT" status --porcelain -- . ':!.goal' | awk '{print $NF}' | sed "s#^landingpages/rankboost/##")
for f in $changed; do case " $allowed " in *" $f "*) ok "changed (allowed): $f" ;; *) bad "changed OUT OF BOUNDS: $f" ;; esac; done
# Older verifiers (their own out-of-bounds lists are narrower; ignore only those lines)
for v in verify-landing.sh verify-phase4.sh verify-confirmation.sh; do
  if bash ".goal/$v" | grep '^FAIL' | grep -v 'OUT OF BOUNDS' | grep -q .; then bad "$v has new failures:"; bash ".goal/$v" | grep '^FAIL' | grep -v 'OUT OF BOUNDS'; else ok "$v checks still pass"; fi
done
if npm test --silent > .goal/npm-test-phase6.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -30 .goal/npm-test-phase6.log; fi
[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
