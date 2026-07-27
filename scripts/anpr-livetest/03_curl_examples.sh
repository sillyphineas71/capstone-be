#!/usr/bin/env bash
# GAW-001 / UC-105 — bắn 2 sự kiện vehicle (vào/ra) vào webhook thật.
# Route: @Controller() rỗng + @Post('internal/ivss/vehicle-events') + prefix api/v1
#   ⇒ /api/v1/internal/ivss/vehicle-events (KHÔNG có đoạn 'anpr').
# Guard AnprInternalTokenGuard: header X-Internal-Token = $IVSS_BRIDGE_TOKEN.
#
# ⚠ THAY <CHANNEL_IN>/<CHANNEL_OUT> bằng channel THẬT đã map ở 02_*.
#   plateNumber: biển đã ĐĂNG KÝ (test matched) — đổi sang biển lạ để test user_id NULL.
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
URL="$BASE/api/v1/internal/ivss/vehicle-events"
TOKEN="${IVSS_BRIDGE_TOKEN:?can dat bien moi truong IVSS_BRIDGE_TOKEN}"
PLATE="${PLATE:-51F-12345}"
CHANNEL_IN="${CHANNEL_IN:-0}"
CHANNEL_OUT="${CHANNEL_OUT:-$CHANNEL_IN}"

# utc = now (ISO-8601 UTC) để parseUtc KHÔNG fallback bad_utc.
now_iso() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }

echo "[IN ] $URL channel=$CHANNEL_IN plate=$PLATE"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $TOKEN" \
  -d "{\"plateNumber\":\"$PLATE\",\"channelId\":$CHANNEL_IN,\"utc\":\"$(now_iso)\",\"eventAction\":\"enter\"}"
echo

sleep 3

echo "[OUT] $URL channel=$CHANNEL_OUT plate=$PLATE"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $TOKEN" \
  -d "{\"plateNumber\":\"$PLATE\",\"channelId\":$CHANNEL_OUT,\"utc\":\"$(now_iso)\",\"eventAction\":\"leave\"}"
echo
echo "→ Kiem ket qua: psql -f 04_check_gate_logs.sql"
