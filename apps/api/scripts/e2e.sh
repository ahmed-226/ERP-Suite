#!/usr/bin/env bash
# Phase C2 — golden-path E2E smoke on a FRESH database:
#   drop + migrate + seed  →  boot API  →  run scripts/e2e.ts  →  tear down.
# Requires the ERP containers up (npm run infra:up) and the dev API stopped
# (port 4000 must be free — the script starts its own instance).
set -euo pipefail
cd "$(dirname "$0")/.."

if curl -sf -o /dev/null http://localhost:4000/api/v1/health; then
  echo "FAIL: an API is already listening on :4000 — stop the dev server first." >&2
  exit 1
fi

echo "== resetting database (drop + migrate) =="
if ! npx prisma migrate reset --force > /tmp/erp-e2e-reset.log 2>&1; then
  tail -30 /tmp/erp-e2e-reset.log >&2
  exit 1
fi

echo "== seeding =="
if ! npx prisma db seed > /tmp/erp-e2e-seed.log 2>&1; then
  tail -30 /tmp/erp-e2e-seed.log >&2
  exit 1
fi
grep 'seed complete' /tmp/erp-e2e-seed.log

npx tsx src/index.ts > /tmp/erp-e2e-api.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:4000/api/v1/health && break
  sleep 1
  if [ "$i" = 30 ]; then
    echo "FAIL: API did not become healthy — last log lines:" >&2
    tail -20 /tmp/erp-e2e-api.log >&2
    exit 1
  fi
done

echo "== golden path =="
npx tsx scripts/e2e.ts
