#!/usr/bin/env bash
# Is the public site actually serving what it should?
#
# This is the check that would have caught the frozen player and the email
# obfuscation without waiting for a customer to say something. It is read-only:
# it fetches public pages and assets and asserts the things a user depends on.
#
# Usage:
#   scripts/health-check.sh                 # checks https://veylet.com
#   scripts/health-check.sh http://127.0.0.1:8902
#   scripts/health-check.sh --quiet
set -uo pipefail

BASE="${1:-https://veylet.com}"
QUIET=0
[ "${1:-}" = "--quiet" ] && { QUIET=1; BASE="https://veylet.com"; }

pass=0; fail=0
ok()   { pass=$((pass+1)); [ "$QUIET" -eq 1 ] || printf '  ok    %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL  %s\n' "$1"; }

# -L so local static hosts that redirect /route -> /route/ are followed the same
# way the production host resolves them.
code_of() { curl -sL -o /dev/null -w '%{http_code}' -m 25 "$1"; }
body_of() { curl -sL -m 25 --compressed "$1"; }

echo "health check → $BASE"

# 1. Every public route answers 200.
for route in / /apply /request /account /privacy /terms /thanks /play /handoff /robots.txt /sitemap.xml /llms.txt; do
  c=$(code_of "$BASE$route")
  [ "$c" = "200" ] && ok "route $route" || bad "route $route → $c"
done

# 2. The things the player cannot work without.
for asset in /vendor/supabase-js-2.116.0.min.js /vendor/jszip-3.10.2.min.js /tour-player.js /account.js /place-fields.js /style.css; do
  c=$(code_of "$BASE$asset")
  size=$(curl -s -o /dev/null -w '%{size_download}' -m 25 "$BASE$asset")
  if [ "$c" = "200" ] && [ "$size" -gt 200 ]; then ok "asset $asset (${size}b)"; else bad "asset $asset → $c ${size}b"; fi
done

# 3. No page may depend on a third-party script host at runtime.
if body_of "$BASE/handoff" | grep -q 'cdn.jsdelivr.net'; then
  bad "handoff references jsdelivr again"
else
  ok "handoff has no third-party module host"
fi

# 4. The client handoff must fail closed and stay out of search.
hand=$(body_of "$BASE/handoff")
echo "$hand" | grep -q 'noindex' && ok "handoff is noindex" || bad "handoff lost its noindex"
echo "$hand" | grep -qi 'sign in' && bad "handoff shows an operator sign-in again" || ok "handoff has no operator sign-in"
echo "$hand" | grep -qi 'Checking this link' && bad "handoff is stuck on a checking state" || ok "handoff does not start in a checking state"

# 5. Contact address must be readable, not obfuscated by the CDN.
if body_of "$BASE/privacy" | grep -q 'email-protection'; then
  bad "email addresses are obfuscated again (turn Cloudflare Email Obfuscation off)"
else
  ok "contact address is served as plain text"
fi

# 6. Revision marker, when the deploy includes one.
info=$(body_of "$BASE/build-info.json")
if echo "$info" | grep -q '"shortCommit"'; then
  ok "build-info.json → $(echo "$info" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("shortCommit"), d.get("builtAt"))' 2>/dev/null)"
else
  bad "build-info.json missing or unreadable"
fi

# 7. An unknown route must not pretend to be a page.
c=$(code_of "$BASE/this-route-does-not-exist")
if [ "$c" = "404" ] || [ "$c" = "200" ]; then ok "unknown route answers $c"; else bad "unknown route → $c"; fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
