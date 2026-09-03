#!/usr/bin/env bash
# Phase 2 exit criteria: restructured booking confirmation page. Exit 0 = ALL GREEN.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }

TY=public/thank-you.html
CSS=public/styles.css

# 1. <section id=...> order inside thank-you.html
order=$(grep -o '<section[^>]*id="[^"]*"' "$TY" | sed 's/.*id="\([^"]*\)".*/\1/' | tr '\n' ' ' | sed 's/ $//')
expect="ty-urgency ty-breakouts ty-testimonials ty-next-steps"
[ "$order" = "$expect" ] && ok "section id order: $order" || bad "section id order is '$order' (expected '$expect')"

# 2. Video placeholders
for slot in founder-urgency breakout-white-hat breakout-existing-rankings breakout-if-it-doesnt-work breakout-competitors; do
  grep -qF -- "data-video-slot=\"$slot\"" "$TY" && ok "placeholder slot: $slot" || bad "placeholder slot missing: $slot"
done
n=$(grep -c 'data-max-minutes="3"' "$TY"); [ "$n" -eq 4 ] && ok "4 breakout placeholders marked data-max-minutes=3" || bad "data-max-minutes=\"3\" count == $n (expected 4)"
n=$(grep -c 'ty-video-placeholder' "$TY"); [ "$n" -ge 5 ] && ok "placeholder class used $n times" || bad "ty-video-placeholder used $n times (expected >= 5)"
for t in 'Is this white hat?' 'Will this hurt my existing rankings?' 'What happens if it doesn’t work?' 'Do you work with my competitors?' 'Video coming soon' 'wistia-player media-id="' 'Under 3 minutes'; do
  grep -qF -- "$t" "$TY" && ok "copy present: $t" || bad "copy missing: $t"
done
n=$(perl -0pe 's/<!--.*?-->//gs' "$TY" | grep -c '<wistia-player '); [ "$n" -eq 0 ] && ok "no live wistia-player element yet (placeholders only)" || bad "found $n live <wistia-player> elements; expected 0 until videos exist"

# 3. Landmark order
pos() { grep -n -F -m1 -- "$1" "$TY" | cut -d: -f1; }
prev=0; prevname=start
for mark in 'class="site-header"' 'id="ty-title"' 'id="ty-urgency"' 'data-video-slot="founder-urgency"' 'id="ty-breakouts"' 'data-video-slot="breakout-white-hat"' 'data-video-slot="breakout-existing-rankings"' 'data-video-slot="breakout-if-it-doesnt-work"' 'data-video-slot="breakout-competitors"' 'id="ty-testimonials"' 'data-video-slot="vernsten"' 'id="ty-next-steps"' 'id="booking-actions"' 'Step 1</span>' 'Step 2</span>' 'class="ty-steps"' 'class="site-footer"' 'id="ty-lightbox"'; do
  p=$(pos "$mark"); [ -z "$p" ] && p=0
  if [ "$p" -gt "$prev" ]; then ok "order: ${prevname:0:40} < ${mark:0:40}"; else bad "order: $mark (line $p) is not after $prevname (line $prev)"; fi
  prev=$p; prevname=$mark
done

# 4. Preserved verification / tracking / interaction machinery
for keep in '<h1 id="ty-title">Confirming your call…</h1>' 'id="booking-actions" hidden' '.ty-actions[hidden] { display: none !important; }' 'title.textContent = "Your call is booked."' 'retryPendingTrack(0)' 'fetch("api/booking"' 'rankboost:booking-verified' 'fbq(' '"Schedule"' 'id="ty-lightbox"' 'data-ba' '+1 (833) 380-3706' 'ty-imsg-thread' 'ty-email-card' 'class="ty-steps"' 'href="./"' '<script src="meta.js"></script>' 'name="robots" content="noindex,nofollow"'; do
  grep -qF -- "$keep" "$TY" && ok "kept: ${keep:0:60}" || bad "missing: $keep"
done
n=$(grep -c 'fbq(' "$TY"); [ "$n" -eq 1 ] && ok "fbq( lines == 1" || bad "fbq( lines == $n (expected 1)"
n=$(grep -c 'data-video-slot="' "$TY"); [ "$n" -eq 9 ] && ok "video slots == 9 (5 placeholders + 4 testimonials)" || bad "data-video-slot count == $n (expected 9)"
n=$(grep -c '<video ' "$TY"); [ "$n" -eq 4 ] && ok "4 testimonial <video> elements" || bad "<video> count == $n (expected 4)"
n=$(grep -c 'data-ba>' "$TY"); [ "$n" -eq 3 ] && ok "3 before/after sliders" || bad "data-ba count == $n (expected 3)"
n=$(grep -c 'src="wins/' "$TY"); [ "$n" -eq 0 ] && ok "rank-tracker wins cards removed from thank-you (they live on the landing page)" || bad "wins/ images still on thank-you: $n"
n=$(grep -c 'src="proof/anon/' "$TY"); [ "$n" -ge 4 ] && ok "email/text proof figures kept ($n)" || bad "proof/anon figures == $n (expected >= 4)"
grep -qF -- 'You don’t need to prepare anything.' "$TY" && bad "lead copy still says nothing to prepare (contradicts the urgency video framing)" || ok "lead copy no longer says nothing to prepare"

# 4b. No stray shell/git output pasted into source files
for f in "$TY" "$CSS" test/endpoints.test.js; do
  if grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f"; then bad "stray shell output in $f:"; grep -n -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f"; else ok "no stray shell output in $f"; fi
done

# 5. No new undefined classes
node .goal/class-coverage.mjs "$TY" "$CSS" | sort > .goal/classes-missing-thankyou.txt
if [ -f .goal/classes-missing-thankyou-baseline.txt ]; then
  newmiss=$(comm -13 .goal/classes-missing-thankyou-baseline.txt .goal/classes-missing-thankyou.txt)
  if [ -z "$newmiss" ]; then ok "no new undefined classes in thank-you.html"; else bad "classes used in thank-you.html with no CSS rule:"; say "$newmiss"; fi
fi

# 6. Out-of-bounds files untouched (vs HEAD)
allowed="public/thank-you.html public/styles.css test/endpoints.test.js"
changed=$(git -C "$ROOT" status --porcelain -- . ':!.goal' | awk '{print $NF}' | sed "s#^landingpages/rankboost/##")
for f in $changed; do
  case " $allowed " in
    *" $f "*) ok "changed (allowed): $f" ;;
    *) bad "changed OUT OF BOUNDS: $f" ;;
  esac
done

# 7. Test suite
if npm test --silent > .goal/npm-test-phase2.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -40 .goal/npm-test-phase2.log; fi

[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
