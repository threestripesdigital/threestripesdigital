#!/usr/bin/env bash
# Phase 1 exit criteria: simplified Rank Boost landing page. Exit 0 = ALL GREEN.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }

IDX=public/index.html
CSS=public/styles.css

# 1. <section id=...> order, document order
order=$(grep -o '<section[^>]*id="[^"]*"' "$IDX" | sed 's/.*id="\([^"]*\)".*/\1/' | tr '\n' ' ' | sed 's/ $//')
expect="top qualify trusted wins partners faq final"
[ "$order" = "$expect" ] && ok "section id order: $order" || bad "section id order is '$order' (expected '$expect')"

# 2. Removed blocks are gone
for gone in 'id="problem"' 'id="how"' 'id="different"' 'id="why"' 'id="inbox-proof"' 'id="gserp"' 'class="problem' 'class="steps' 'class="cmp' 'why-wall' 'proof-grid' 'tsd-stripes' 'faang-row' 'gserp-track' 'initGserp' 'Built by a former FAANG engineer' 'Same organic rankings. You just see them before you pay' 'Three steps. About forty-eight hours' 'Indexed, optimized, and stuck on page' 'Lawyers texting and emailing'; do
  grep -qF -- "$gone" "$IDX" && bad "still present: $gone" || ok "removed: $gone"
done

# 3. Kept blocks intact
pos() { grep -n -F -m1 -- "$1" "$IDX" | cut -d: -f1; }
for keep in 'class="site-header"' '<h1>We move law-firm keywords from <span class="hl-num">page 2–5</span> to <span class="hl-num">page 1</span> in under 48 hours.</h1>' '<wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>' '<script src="https://fast.wistia.com/player.js" async></script>' '<script src="https://fast.wistia.com/embed/8uioqg3047.js" async type="module"></script>' '<script src="meta.js"></script>' 'id="hero-vsl-title"' 'class="hero-vsl-caption hero-subcopy"' 'id="qualify-form-toggle"' '<form class="qualify-form" id="qualify-form" action="#" method="post" novalidate hidden>' 'Check my current rankings · free' 'class="marquee-section" id="trusted"' 'id="win-grid"' 'id="win-toggle"' 'class="video-grid"' 'id="faq"' 'id="final"' 'id="sticky-cta"' 'class="site-footer"' 'fbq("trackCustom", "LeadFormOpened"' 'window.location.href = "results";'; do
  grep -qF -- "$keep" "$IDX" && ok "kept: ${keep:0:60}" || bad "missing: $keep"
done

# Landmark order
prev=0; prevname=start
for mark in 'class="site-header"' '<h1>We move' '<wistia-player media-id' 'id="qualify-form-toggle"' 'id="trusted"' 'id="wins"' 'id="partners"' 'id="faq"' 'id="final"' 'id="sticky-cta"' 'class="site-footer"'; do
  p=$(pos "$mark"); [ -z "$p" ] && p=0
  if [ "$p" -gt "$prev" ]; then ok "order: $prevname < $mark"; else bad "order: $mark (line $p) is not after $prevname (line $prev)"; fi
  prev=$p; prevname=$mark
done

# 4. Counts
n=$(grep -c '<details class="faq-item"' "$IDX"); { [ "$n" -ge 5 ] && [ "$n" -le 6 ]; } && ok "faq items == $n" || bad "faq items == $n (expected 5-6)"
for q in 'Why is this free? It seems too good to be true.' 'Is this bot traffic or some black-hat trick?' 'How long does the boost last?' 'Is this local pack / Google Maps ranking?' 'Do you take multiple firms in the same niche and city?' 'Are the case studies and wins from the free boost?'; do
  grep -qF -- "$q" "$IDX" && ok "faq kept: $q" || bad "faq missing: $q"
done
for q in 'How fast will I see movement?' 'What does it cost?' 'Will this help me show up in AI search' 'Who is this for, and who should skip it?'; do
  grep -qF -- "$q" "$IDX" && bad "faq should be dropped: $q" || ok "faq dropped: $q"
done
n=$(grep -c 'class="win-card' "$IDX"); [ "$n" -eq 31 ] && ok "win-card count == 31" || bad "win-card count == $n (expected 31)"
n=$(grep -c 'data-video-slot=' "$IDX"); [ "$n" -eq 4 ] && ok "video testimonial cards == 4" || bad "video testimonial cards == $n (expected 4)"
n=$(grep -c 'class="marquee-item"' "$IDX"); [ "$n" -eq 26 ] && ok "marquee items == 26" || bad "marquee items == $n (expected 26)"
n=$(grep -c 'fbq(' "$IDX"); [ "$n" -eq 4 ] && ok "fbq( lines == 4" || bad "fbq( lines == $n (expected 4)"
n=$(grep -c '<wistia-player' "$IDX"); [ "$n" -eq 1 ] && ok "exactly one wistia-player" || bad "wistia-player count == $n (expected 1)"
n=$(grep -c '<section' "$IDX"); [ "$n" -eq 8 ] && ok "<section> count == 8 (hero, hero-vsl, qualify, trusted, wins, partners, faq, final)" || bad "<section> count == $n (expected 8)"

# 5. CTA label unified
for old in 'GET MY FREE BOOST NOW' 'Get my free rank boost' 'Claim my free rank boost'; do
  grep -qF -- "$old" "$IDX" && bad "old CTA label still present: $old" || ok "old CTA label gone: $old"
done
n=$(grep -c 'Get my free boost' "$IDX"); [ "$n" -ge 4 ] && ok "'Get my free boost' used $n times" || bad "'Get my free boost' used only $n times (expected header, toggle, final, sticky at least)"

# 5b. No stray shell/git output pasted into source files
for f in "$IDX" "$CSS" test/endpoints.test.js; do
  if grep -q -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f"; then bad "stray shell output in $f:"; grep -n -E '^(fatal|hint|error|warning|usage|zsh|bash|npm ERR):' "$f"; else ok "no stray shell output in $f"; fi
done

# 6. CSS: removed-section rules gone, kept rules present, no new undefined classes
for sel in '.problem-card {' '.problem {' '.steps {' '.how {' '.cmp {' '.cmp-col' '.why-wall' '.why-stat' '.proof-grid' '.proof-wall' '.gserp {' '.gserp-row' '.tsd-stripes' '.faang-logo' '.video-ph' '.video-play'; do
  grep -qF -- "$sel" "$CSS" && bad "dead CSS still present: $sel" || ok "dead CSS removed: $sel"
done
for sel in '.opp-cmp' '.step-h' '.step-result' '.video-card' '.video-frame' '.win-card' '.marquee-item' '.faq-item' '.final-cta' '.sticky-cta' '.hero-vsl-frame' '.hero-qualify .qualify-form-toggle[hidden]' '.problem-card, .why-panel' ; do
  case "$sel" in '.problem-card, .why-panel') continue;; esac
  grep -qF -- "$sel" "$CSS" && ok "CSS kept: $sel" || bad "CSS lost: $sel"
done
node .goal/class-coverage.mjs "$IDX" "$CSS" | sort > .goal/classes-missing-index.txt
if [ -f .goal/classes-missing-index-baseline.txt ]; then
  newmiss=$(comm -13 .goal/classes-missing-index-baseline.txt .goal/classes-missing-index.txt)
  if [ -z "$newmiss" ]; then ok "no new undefined classes in index.html"; else bad "classes used in index.html with no CSS rule:"; say "$newmiss"; fi
fi

# 7. Out-of-bounds files untouched (vs HEAD)
allowed="public/index.html public/styles.css test/endpoints.test.js"
changed=$(git -C "$ROOT" status --porcelain -- . ':!.goal' | awk '{print $NF}' | sed "s#^landingpages/rankboost/##")
for f in $changed; do
  case " $allowed " in
    *" $f "*) ok "changed (allowed): $f" ;;
    *) bad "changed OUT OF BOUNDS: $f" ;;
  esac
done

# 8. Test suite
if npm test --silent > .goal/npm-test-phase1.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -40 .goal/npm-test-phase1.log; fi

[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
