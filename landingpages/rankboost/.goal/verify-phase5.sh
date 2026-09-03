#!/usr/bin/env bash
# Phase 5 exit criteria: Stuart Allen Law Firm in the marquee; thank-you footer has no links.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }
IDX=public/index.html
TY=public/thank-you.html

c=$(grep -c -F '<span>Stuart Allen Law Firm</span>' "$IDX"); [ "$c" -eq 2 ] && ok "Stuart Allen Law Firm x2" || bad "Stuart Allen Law Firm appears $c times (expected 2)"
c=$(grep -c -F 'class="marquee-item"><img src="logos/stuart-allen-law-firm.png" alt="" width="64" height="64"><span>Stuart Allen Law Firm</span>' "$IDX"); [ "$c" -eq 2 ] && ok "Stuart Allen item uses the uniform markup x2" || bad "Stuart Allen item markup count $c (expected 2)"
[ -f public/logos/stuart-allen-law-firm.png ] && ok "logo file exists" || bad "logo file missing"
n=$(grep -c 'class="marquee-item"' "$IDX"); [ "$n" -eq 28 ] && ok "marquee items == 28" || bad "marquee items == $n (expected 28)"
# Stuart Allen must be in the right track, last, and after Brar Tamber in both segments
right=$(sed -n '/marquee-track marquee-right/,/<\/div>\s*<\/div>\s*<\/section>/p' "$IDX")
c=$(printf '%s' "$right" | grep -c -F 'Stuart Allen Law Firm'); [ "$c" -eq 2 ] && ok "Stuart Allen in the right track x2" || bad "Stuart Allen in right track $c times (expected 2)"
left=$(sed -n '/marquee-track marquee-left/,/marquee-track marquee-right/p' "$IDX")
printf '%s' "$left" | grep -q -F 'Stuart Allen' && bad "Stuart Allen also appears in the left track" || ok "left track unchanged"

footer=$(sed -n '/<footer class="site-footer">/,/<\/footer>/p' "$TY")
[ -n "$footer" ] && ok "thank-you footer found" || bad "thank-you footer not found"
printf '%s' "$footer" | grep -q '<a ' && bad "thank-you footer still contains a link" || ok "thank-you footer contains no <a>"
grep -q 'footer-links' "$TY" && bad "footer-links still in thank-you.html" || ok "footer-links removed from thank-you.html"
grep -q -F 'class="footer-brand"' "$TY" && ok "thank-you footer brand kept" || bad "thank-you footer brand lost"

for f in "$IDX" "$TY" test/endpoints.test.js; do grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f" && bad "stray shell output in $f" || ok "no stray shell output in $f"; done

allowed="public/index.html public/thank-you.html test/endpoints.test.js"
changed=$(git -C "$ROOT" status --porcelain -- . ':!.goal' | awk '{print $NF}' | sed "s#^landingpages/rankboost/##")
for f in $changed; do case " $allowed " in *" $f "*) ok "changed (allowed): $f" ;; *) bad "changed OUT OF BOUNDS: $f" ;; esac; done

# Phase-4 verifier still green apart from its own out-of-bounds list (it does not allow thank-you.html); run its landing checks only
if bash .goal/verify-phase4.sh | grep '^FAIL' | grep -v 'OUT OF BOUNDS: public/thank-you.html' | grep -q .; then bad "verify-phase4.sh has new failures:"; bash .goal/verify-phase4.sh | grep '^FAIL' | grep -v 'OUT OF BOUNDS: public/thank-you.html'; else ok "verify-phase4.sh checks still pass"; fi
if bash .goal/verify-confirmation.sh | grep '^FAIL' | grep -v 'OUT OF BOUNDS: public/index.html' | grep -q .; then bad "verify-confirmation.sh has new failures:"; bash .goal/verify-confirmation.sh | grep '^FAIL' | grep -v 'OUT OF BOUNDS: public/index.html'; else ok "verify-confirmation.sh checks still pass"; fi
if npm test --silent > .goal/npm-test-phase5.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -30 .goal/npm-test-phase5.log; fi

[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
