#!/usr/bin/env bash
# Phase 8 exit criteria: scout table UI changes. Exit 0 = ALL GREEN.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }
H=public/scout.html
J=public/scout.js

for gone in 'Lookup cost' 'Priority' 'boostlbl' 'id="sc-sort"' 'Sort: priority' 'sc-why' 'class="score"'; do
  grep -qF -- "$gone" "$J" && bad "still in scout.js: $gone" || ok "gone from scout.js: $gone"
done
for gone in 'boostlbl' '.sc-why' '.score' ; do
  grep -qF -- "$gone" "$H" && bad "still in scout.html CSS: $gone" || ok "gone from scout.html: $gone"
done
for keep in 'data-sort="keyword"' 'data-sort="boost"' 'data-sort="position"' 'data-sort="volume"' 'data-sort="cpc"' '>Boostable' 'sc-boost' 'class="yes"' 'class="no"' 'aria-sort' 'sc-arrow' 'colspan="7"' 'Boost candidates' 'Searches in play' 'Buying intent' 'Copy CSV' 'Copy keywords' 'id="sc-q"' 'data-filter="boost"'; do
  grep -qF -- "$keep" "$J" && ok "scout.js has: $keep" || bad "scout.js missing: $keep"
done
grep -q 'data-sort="score"' "$J" && bad 'a header still sorts by score (priority column should be gone)' || ok "no header sorts by score"
grep -qF -- '>Intent<' "$J" && ok "Intent column kept" || bad "Intent column missing"
grep -qF -- '>#<' "$J" && ok "# column kept" || bad "# column missing"
# Column order in the header template: # Keyword Boostable Position Volume CPC Intent
hdr=$(grep -o "'<th[^']*'" "$J" | tr -d "\n")
printf '%s' "$hdr" | grep -q 'Keyword.*Boostable.*Position.*Volume.*CPC.*Intent' && ok "header order # Keyword Boostable Position Volume CPC Intent" || bad "header order wrong: $hdr"
grep -qF -- 'position: sticky' "$H" && ok "sticky thead CSS present" || bad "sticky thead CSS missing"
grep -q 'border-collapse: separate' "$H" && ok "border-collapse separate (sticky-safe)" || bad "table still border-collapse: collapse"
grep -q '\.sc-boost \.yes' "$H" && grep -q '\.sc-boost \.no' "$H" && ok "boostable yes/no styles present" || bad "boostable styles missing"
grep -q '52, 211, 153' "$H" && ok "green check colour" || bad "green check colour missing"
grep -q '248, 113, 113' "$H" && ok "red x colour" || bad "red x colour missing"
grep -q 'dir' "$J" && ok "sort direction state present" || bad "no sort direction state"
node --check "$J" && ok "scout.js parses" || bad "scout.js syntax error"
for f in "$H" "$J" test/scout.test.js test/endpoints.test.js; do grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f" && bad "stray shell output in $f" || ok "no stray shell output in $f"; done
allowed="public/scout.html public/scout.js test/scout.test.js test/endpoints.test.js"
changed=$(git -C "$ROOT" status --porcelain -- . ':!.goal' | awk '{print $NF}' | sed "s#^landingpages/rankboost/##")
for f in $changed; do case " $allowed " in *" $f "*) ok "changed (allowed): $f" ;; *) bad "changed OUT OF BOUNDS: $f" ;; esac; done
if npm test --silent > .goal/npm-test-phase8.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -30 .goal/npm-test-phase8.log; fi
[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
