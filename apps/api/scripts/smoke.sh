#!/usr/bin/env bash
# Live smoke: health → login → authed CRUD + engine flows, then stop.
set -e
cd /mnt/d/SW/repos/ERP/apps/api
npx tsx src/index.ts > /tmp/erp-api.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 6

echo "health: $(curl -s http://localhost:4000/api/v1/health)"

TOK=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@acme.test","password":"Passw0rd!"}' \
  | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
echo "login token: ${TOK:0:20}..."

for path in accounts products warehouses users users/roles journals "inventory/stock" "reports/trial-balance?from=2026-01-01&to=2026-12-31" reports/dashboard; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:4000/api/v1/$path" -H "authorization: Bearer $TOK")
  echo "GET $path -> $CODE"
done

echo "unauth journals -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/journals)"
echo "404 envelope: $(curl -s http://localhost:4000/api/v1/nope)"
