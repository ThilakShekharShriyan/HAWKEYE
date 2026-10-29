#!/bin/bash
# Keeps the demo stack up: checks each service every few seconds and restarts only
# the ones that died. It never kills anything. Run it in the background:
#   nohup scripts/demo-keepalive.sh > /tmp/hawkeye-keepalive.log 2>&1 &
# Stop it with: pkill -f demo-keepalive.sh
#
# Services: FalkorDB (docker), the app (:3100), the tracker (:8766, needs TRACKER_BIN),
# the FalkorDB MCP (:3006), TrueForge (:8790) and the ngrok tunnel (-> :3100).
cd "$(dirname "$0")/.." || exit 1
APP_PORT=${APP_PORT:-3100}
TRACKER_PORT=${TRACKER_PORT:-8766}
MCP_PORT=${FALKORDB_MCP_PORT:-3006}
TRACKER_BIN=${TRACKER_BIN:-tracker/.venv/bin}
EVERY=${KEEPALIVE_EVERY:-15}
TOKEN=$(grep '^HAWKEYE_ACCESS_TOKEN=' .env.local 2>/dev/null | cut -d= -f2)

log() { echo "$(date '+%H:%M:%S') $*"; }
listening() { lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }
start() { # name, logfile, command...
  local name=$1 file=$2; shift 2
  log "restarting $name"
  nohup "$@" > "$file" 2>&1 &
}

while true; do
  if ! docker exec hawkeye-falkordb-1 redis-cli PING >/dev/null 2>&1; then
    log "restarting falkordb"; docker start hawkeye-falkordb-1 >/dev/null 2>&1
  fi
  if ! curl -s -m 8 -o /dev/null -H "x-hawkeye-token: $TOKEN" "localhost:$APP_PORT/api/health"; then
    if listening "$APP_PORT"; then log "app is listening but not answering; leaving it (never killing)"; else start app /tmp/hawkeye-dev.log npx next dev -p "$APP_PORT"; fi
  fi
  if ! curl -s -m 5 -o /dev/null "localhost:$TRACKER_PORT/health"; then
    if ! listening "$TRACKER_PORT" && [ -x "$TRACKER_BIN/uvicorn" ]; then
      start tracker /tmp/hawkeye-tracker.log bash -c "cd tracker && ../$TRACKER_BIN/uvicorn server:app --port $TRACKER_PORT"
    fi
  fi
  if ! listening "$MCP_PORT"; then start mcp /tmp/falkor-mcp.log env FALKORDB_MCP_PORT="$MCP_PORT" npm run mcp:falkor; fi
  if ! curl -s -m 5 -o /dev/null localhost:8790; then
    if ! listening 8790; then start trueforge /tmp/trueforge.log npm run trueforge; fi
  fi
  if ! curl -s -m 5 localhost:4040/api/tunnels 2>/dev/null | grep -q "localhost:$APP_PORT"; then
    if ! pgrep -f "ngrok http $APP_PORT" >/dev/null; then start tunnel /tmp/ngrok-hawkeye.log ngrok http "$APP_PORT" --log=stdout; fi
  fi
  sleep "$EVERY"
done
