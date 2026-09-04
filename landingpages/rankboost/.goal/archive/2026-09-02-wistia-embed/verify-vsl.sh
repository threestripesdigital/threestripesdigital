#!/usr/bin/env bash
# Phase 1 exit criteria for the Rank Boost VSL Wistia embed. Exit 0 = green.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
say() { printf '%s\n' "$*"; }
ok() { say "PASS  $*"; }
bad() { say "FAIL  $*"; fail=1; }

IDX=public/index.html
HDR=public/_headers
MW=functions/_middleware.js

# 1. Embed present, placeholder gone, caption + form bindings intact
grep -q '<wistia-player media-id="8uioqg3047" aspect="1.7777777777777777"></wistia-player>' "$IDX" && ok "wistia-player element present" || bad "wistia-player element missing/altered"
grep -q '<script src="https://fast.wistia.com/player.js" async></script>' "$IDX" && ok "player.js script tag present" || bad "player.js script tag missing"
grep -q '<script src="https://fast.wistia.com/embed/8uioqg3047.js" async type="module"></script>' "$IDX" && ok "embed module script present" || bad "embed module script missing"
grep -q "wistia-player\[media-id='8uioqg3047'\]:not(:defined)" "$IDX" && ok "swatch :not(:defined) style present" || bad "swatch style missing"
grep -q 'hero-vsl-placeholder' "$IDX" && bad "hero-vsl-placeholder still in index.html" || ok "placeholder markup removed"
grep -q 'VSL placeholder' "$IDX" && bad "placeholder copy still in index.html" || ok "placeholder copy removed"
grep -q 'class="hero-vsl-caption hero-subcopy"' "$IDX" && ok "hero-vsl-caption intact" || bad "hero-vsl-caption missing"
grep -q '<section class="hero-vsl" aria-labelledby="hero-vsl-title">' "$IDX" && ok "hero-vsl section intact" || bad "hero-vsl section changed"
grep -q 'id="hero-vsl-title"' "$IDX" && ok "hero-vsl-title id still present (aria-labelledby target)" || bad "hero-vsl-title id missing"
grep -q '<script src="meta.js"></script>' "$IDX" && ok "meta.js loader intact" || bad "meta.js loader missing"
n=$(grep -c 'fbq(' "$IDX"); [ "$n" -eq 4 ] && ok "fbq( lines == 4" || bad "fbq( lines == $n (expected 4)"

# 2. CSP: both sources contain the Wistia allowances and are identical
# directive_has <directive> <source>  (fixed-string match inside that directive only)
directive_has() {
  grep -m1 'Content-Security-Policy:' "$HDR" | tr ';' '\n' | sed 's/^[[:space:]]*//' | grep -m1 "^$1 " | grep -qF -- " $2"
}
for src in "https://*.wistia.com" "https://*.wistia.net"; do
  directive_has script-src "$src" && ok "_headers script-src has $src" || bad "_headers script-src lacks $src"
  directive_has connect-src "$src" && ok "_headers connect-src has $src" || bad "_headers connect-src lacks $src"
  directive_has media-src "$src" && ok "_headers media-src has $src" || bad "_headers media-src lacks $src"
done
directive_has frame-src "https://fast.wistia.com" && ok "_headers frame-src has fast.wistia.com" || bad "_headers frame-src lacks fast.wistia.com"
directive_has frame-src "https://fast.wistia.net" && ok "_headers frame-src has fast.wistia.net" || bad "_headers frame-src lacks fast.wistia.net"
directive_has style-src "https://fast.wistia.com" && ok "_headers style-src has fast.wistia.com" || bad "_headers style-src lacks fast.wistia.com"
directive_has media-src "blob:" && ok "_headers media-src has blob:" || bad "_headers media-src lacks blob:"
grep -qF -- "worker-src 'self' blob:" "$HDR" && ok "_headers worker-src present" || bad "_headers worker-src missing"
directive_has font-src "https://*.wistia.com" && ok "_headers font-src has *.wistia.com" || bad "_headers font-src lacks *.wistia.com"

# Existing sources must all still be present (append-only rule)
for keep in "https://connect.facebook.net" "https://assets.calendly.com" "https://static.cloudflareinsights.com" "https://fonts.googleapis.com" "https://fonts.gstatic.com" "https://www.facebook.com" "https://*.facebook.com" "https://calendly.com" "https://*.calendly.com" "https://cloudflareinsights.com" "https://*.cloudflareinsights.com" "frame-ancestors 'none'" "upgrade-insecure-requests" "media-src 'self' https://threestripesdigital.com"; do
  grep -qF -- "$keep" "$HDR" && ok "_headers still has $keep" || bad "_headers lost $keep"
done

# Identical policy in both places
hdr_policy=$(grep -m1 'Content-Security-Policy:' "$HDR" | sed 's/^[[:space:]]*Content-Security-Policy:[[:space:]]*//')
mw_policy=$(node -e '
  import("./functions/_middleware.js").then(async (m) => {
    const r = await m.onRequest({ request: new Request("https://example.test/"), next: async () => new Response("ok") });
    process.stdout.write(r.headers.get("Content-Security-Policy"));
  });')
if [ "$hdr_policy" = "$mw_policy" ]; then ok "_headers CSP == middleware CSP"; else bad "_headers CSP != middleware CSP"; say "  headers:    $hdr_policy"; say "  middleware: $mw_policy"; fi

# 3. Out-of-bounds files untouched (compare to baseline hashes)
if [ -f .goal/md5-before.txt ]; then
  find . -type f -not -path "*/.wrangler/*" -not -path "*/node_modules/*" -not -path "*/.goal/*" -not -name "_worker.bundle" -exec md5 -r {} + | sed 's# \./# #' | sort -k2 > .goal/md5-after.txt
  changed=$(diff <(awk '{print $2, $1}' .goal/md5-before.txt | sed "s#$ROOT/##" | sort) <(awk '{print $2, $1}' .goal/md5-after.txt | sort) | grep '^>' | awk '{print $2}')
  allowed="public/index.html public/styles.css public/_headers functions/_middleware.js test/endpoints.test.js"
  for f in $changed; do
    case " $allowed " in
      *" $f "*) ok "changed (allowed): $f" ;;
      *) bad "changed OUT OF BOUNDS: $f" ;;
    esac
  done
fi

# 4. Test suite, including a new Wistia regression test
grep -q '8uioqg3047' test/endpoints.test.js && ok "regression test references media id" || bad "no regression test for the Wistia embed in test/endpoints.test.js"
if npm test --silent > .goal/npm-test.log 2>&1; then ok "npm test green"; else bad "npm test failed"; tail -40 .goal/npm-test.log; fi

[ "$fail" -eq 0 ] && say "ALL GREEN" || say "RED"
exit "$fail"
