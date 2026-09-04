#!/usr/bin/env bash
# Phase 4 exit criteria: footer links gone, full-width headings, new final lead, local marquee logos + corrected names.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }
IDX=public/index.html
CSS=public/styles.css

# 1. Footer has no links (phase 6 removed the footer entirely; the © line now ends #final)
grep -q 'footer-links' "$IDX" && bad "footer-links still in index.html" || ok "footer-links removed from index.html"
grep -q 'footer-links' "$CSS" && bad "footer-links CSS still present" || ok "footer-links CSS removed"
for keep in 'id="year"' 'no specific result is guaranteed.'; do grep -qF -- "$keep" "$IDX" && ok "© line kept: $keep" || bad "© line lost: $keep"; done; grep -q 'qualify first' "$IDX" && bad "'qualify first' sentence still present" || ok "'qualify first' sentence removed"

# 2. Final CTA
grep -qF -- 'See whether a rank-boost test fits your firm.' "$IDX" && ok "final h2 unchanged" || bad "final h2 text changed"
grep -qF -- 'If your best law-firm keywords are stuck between positions 2 and 50, you’ll see movement in under 48 hours.' "$IDX" && ok "new final lead present" || bad "new final lead missing"
grep -qF -- 'positions 11 and 50' "$IDX" && bad "old final lead still present" || ok "old final lead removed"
awk '/^\.final-cta h2 \{/,/\}/' "$CSS" | grep -q 'max-width: none' && ok ".final-cta h2 overrides the global 22ch cap with max-width: none" || bad ".final-cta h2 must set max-width: none (global h2 rule caps it at 22ch otherwise)"

# 3. FAQ heading
awk '/^\.section-head-center h2 \{/,/\}/' "$CSS" | grep -q 'max-width' && bad ".section-head-center h2 still has max-width" || ok ".section-head-center h2 has no max-width (full width)"
grep -qF -- 'Straight answers before you apply' "$IDX" && ok "faq h2 unchanged" || bad "faq h2 text changed"

# 4. Marquee
grep -q 'google.com/s2/favicons' "$IDX" && bad "google favicon hot-links remain" || ok "no google favicon hot-links"
grep -q 'senorticket.com' "$IDX" && bad "senorticket.com hot-link remains" || ok "no senorticket.com hot-link"
grep -q 'marquee-logo' "$IDX" "$CSS" && bad "marquee-logo (rectangle) still used" || ok "marquee-logo rectangle removed"
n=$(grep -c 'class="marquee-item"' "$IDX"); [ "$n" -eq 28 ] && ok "marquee items == 28" || bad "marquee items == $n (expected 28)"
for name in 'Cruz Gold &amp; Associates' 'Señor Ticket' 'Mahdavi &amp; Mahdavi Family Law' 'Wisconsin Immigration Lawyers' 'Thyberg Family Law' 'Macomb County Divorce Lawyer' 'Brar Tamber Rigby Badham' 'VanWa Legal' 'Rensch &amp; Rensch' 'Vernsten Law' 'Ticket Crushers' 'Priest Criminal Defense' 'Hopson Law'; do
  c=$(grep -c -F -- "<span>$name</span>" "$IDX"); [ "$c" -eq 2 ] && ok "name x2: $name" || bad "name '$name' appears $c times (expected 2)"
done
for old in 'Cruz Golden' 'Senor Ticket' 'SLM Family Law' 'WI Immigration' '>Thyberg Law<' '>Macomb Divorce<' 'Brar &amp; Tamber'; do
  grep -qF -- "$old" "$IDX" && bad "old name remains: $old" || ok "old name gone: $old"
done
missing=0
for src in $(grep -o 'class="marquee-item"><img src="[^"]*"' "$IDX" | sed 's/.*src="\([^"]*\)"/\1/'); do
  case "$src" in logos/*) [ -f "public/$src" ] || { bad "logo file missing: $src"; missing=1; } ;; *) bad "marquee img not local: $src"; missing=1 ;; esac
done
[ "$missing" -eq 0 ] && ok "every marquee img is a local existing logos/ file"
n=$(grep -c 'class="marquee-item"><img src="logos/[^"]*" alt="" width="64" height="64">' "$IDX"); [ "$n" -eq 28 ] && ok "all 28 marquee imgs use the uniform attributes" || bad "$n/28 marquee imgs use the uniform attributes"

# 5. Stray output + landing verifier (includes npm test and out-of-bounds check)
for f in "$IDX" "$CSS" test/endpoints.test.js; do grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f" && bad "stray shell output in $f" || ok "no stray shell output in $f"; done
if bash .goal/verify-landing.sh | grep -q '^ALL GREEN'; then ok "verify-landing.sh ALL GREEN"; else bad "verify-landing.sh RED:"; bash .goal/verify-landing.sh | grep '^FAIL'; fi

[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
