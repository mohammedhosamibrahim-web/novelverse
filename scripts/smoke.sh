#!/usr/bin/env bash
# Smoke test suite — run `npm run smoke`
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== [1/2] Download-limiter unit tests =="
node scripts/smoke-limiter.js

echo ""
echo "== [2/2] API smoke tests (in-process server, isolated temp DB) =="
node scripts/smoke-api.js

echo ""
echo "ALL SMOKE TESTS PASSED ✔"
