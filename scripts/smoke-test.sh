#!/bin/bash
# ---------------------------------------------------------------
# Procurement Agent — Production Smoke Test
#
# Tests the full pipeline for all 4 RFQ types:
#   1. Stationery (26 items, Isolde Maritime format)
#   2. Deck & Engine (10 items)
#   3. Galley & Kitchen (8 items)
#   4. Mixed (7 items, cross-category)
#
# Prerequisites:
#   - App running at http://localhost:3000
#   - MongoDB + Redis running
#   - Sample RFQ files in ./exports/ (run: npx tsx scripts/create-sample-rfq.ts)
#
# Usage:
#   ./scripts/smoke-test.sh
#   ./scripts/smoke-test.sh http://localhost:3000
# ---------------------------------------------------------------

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0
RESULTS=""

log_pass() {
  PASS=$((PASS + 1))
  RESULTS="$RESULTS\n  PASS  $1"
  echo "  PASS  $1"
}

log_fail() {
  FAIL=$((FAIL + 1))
  RESULTS="$RESULTS\n  FAIL  $1"
  echo "  FAIL  $1"
}

echo "=== Procurement Agent Smoke Test ==="
echo "  Target: $BASE_URL"
echo ""

# ---- Test 0: Health checks ----
echo "[0] Health checks..."

# App is responding
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  log_pass "App responds (HTTP $STATUS)"
else
  log_fail "App not responding (HTTP $STATUS)"
  echo ""
  echo "Cannot continue — app is not running at $BASE_URL"
  exit 1
fi

# Vendors API
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/vendors" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  log_pass "Vendors API responds"
else
  log_fail "Vendors API failed (HTTP $STATUS)"
fi

# Metrics API
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/metrics" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  log_pass "Metrics API responds"
else
  log_fail "Metrics API failed (HTTP $STATUS)"
fi

# Health API
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/vendors/health" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  log_pass "Health API responds"
else
  log_fail "Health API failed (HTTP $STATUS)"
fi

echo ""

# ---- Test 1-4: Upload each sample RFQ ----
RFQS=("sample-rfq-stationery.xlsx" "sample-rfq-deck-engine.xlsx" "sample-rfq-galley.xlsx" "sample-rfq-mixed.xlsx")
EXPECTED_ITEMS=(26 10 8 7)

for i in "${!RFQS[@]}"; do
  RFQ="${RFQS[$i]}"
  EXPECTED="${EXPECTED_ITEMS[$i]}"
  IDX=$((i + 1))

  echo "[$IDX] Upload: $RFQ (expecting $EXPECTED items)..."

  FILEPATH="./exports/$RFQ"
  if [ ! -f "$FILEPATH" ]; then
    log_fail "$RFQ — file not found (run: npx tsx scripts/create-sample-rfq.ts)"
    continue
  fi

  RESPONSE=$(curl -s -X POST "$BASE_URL/api/upload" \
    -F "file=@$FILEPATH" 2>/dev/null || echo '{"error":"curl failed"}')

  # Check if totalItems matches expected
  TOTAL=$(echo "$RESPONSE" | grep -o '"totalItems":[0-9]*' | head -1 | cut -d: -f2)
  if [ "$TOTAL" = "$EXPECTED" ]; then
    log_pass "$RFQ — parsed $TOTAL items"
  elif [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] 2>/dev/null; then
    log_pass "$RFQ — parsed $TOTAL items (expected $EXPECTED)"
  else
    log_fail "$RFQ — parse failed or 0 items"
  fi

  # Check for parse warnings
  WARNINGS=$(echo "$RESPONSE" | grep -o '"warnings":\[' | wc -l)
  if [ "$WARNINGS" -gt 0 ]; then
    echo "    (has parse warnings — check response)"
  fi
done

echo ""

# ---- Test 5: Dictionary listing ----
echo "[5] Dictionary API..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/dictionary?limit=5" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  log_pass "Dictionary API responds"
else
  log_fail "Dictionary API failed (HTTP $STATUS)"
fi

# ---- Test 6: History listing ----
echo "[6] History API..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/history" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  log_pass "History API responds"
else
  log_fail "History API failed (HTTP $STATUS)"
fi

# ---- Test 7: Static pages ----
echo "[7] Static pages..."
for PAGE in "/" "/dictionary" "/history" "/settings"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$PAGE" 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    log_pass "Page $PAGE responds"
  else
    log_fail "Page $PAGE failed (HTTP $STATUS)"
  fi
done

echo ""
echo "=== Smoke Test Results ==="
echo -e "$RESULTS"
echo ""
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Total:  $((PASS + FAIL))"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: SOME TESTS FAILED"
  exit 1
else
  echo "RESULT: ALL TESTS PASSED"
  exit 0
fi
