#!/usr/bin/env bash
# Smoke：2–3 轮完整 user → tools → response，验证 settings / mock / drive。
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd tmux
require_cmd python3

export BENCHMARK_ROUNDS="${BENCHMARK_ROUNDS:-${BENCHMARK_TURNS:-3}}"
export BENCHMARK_TOOL_CALLS_PER_ROUND="${BENCHMARK_TOOL_CALLS_PER_ROUND:-12}"
export BENCHMARK_MARKDOWN_BYTES="${BENCHMARK_MARKDOWN_BYTES:-8000}"
export BENCHMARK_CHUNK_BYTES="${BENCHMARK_CHUNK_BYTES:-256}"
export BENCHMARK_PROMPT_TIMEOUT_SEC="${BENCHMARK_PROMPT_TIMEOUT_SEC:-600}"
export BENCHMARK_METRICS_INTERVAL_SEC="${BENCHMARK_METRICS_INTERVAL_SEC:-1}"

eval "$("$BENCHMARK_ROOT/scripts/setup-env.sh" | grep '^BENCHMARK_OUT_DIR=')"
# shellcheck disable=SC1090
source "$BENCHMARK_OUT_DIR/.env"

"$BENCHMARK_ROOT/scripts/tmux-session.sh"

echo "[smoke] rounds=$BENCHMARK_ROUNDS tools/round=$BENCHMARK_TOOL_CALLS_PER_ROUND"
echo "[smoke] waiting for drive (max ${BENCHMARK_PROMPT_TIMEOUT_SEC}s per round)..."
deadline=$(( $(date +%s) + BENCHMARK_PROMPT_TIMEOUT_SEC * BENCHMARK_ROUNDS + 120 ))
while true; do
  if [[ -f "$BENCHMARK_OUT_DIR/drive-summary.json" ]]; then
    got=$(python3 -c "import json; print(json.load(open('$BENCHMARK_OUT_DIR/drive-summary.json'))['roundsCompleted'])" 2>/dev/null || echo 0)
    if [[ "$got" -eq "$BENCHMARK_ROUNDS" ]]; then
      break
    fi
  fi
  if [[ $(date +%s) -gt $deadline ]]; then
    echo "ERROR: smoke timed out" >&2
    exit 1
  fi
  sleep 2
done

python3 - "$BENCHMARK_MOCK_AUDIT" "$BENCHMARK_ROUNDS" "$BENCHMARK_TOOL_CALLS_PER_ROUND" <<'PY'
import json, sys
path, expected_rounds, tools_per_round = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
tool = md = 0
rounds_with_md = set()
with open(path, encoding="utf-8") as fh:
    for line in fh:
        row = json.loads(line)
        if row.get("event") != "completion":
            continue
        kind = row.get("kind")
        rnd = row.get("round")
        if kind in ("tool_json", "tool_stream"):
            tool += 1
        if kind in ("markdown_json", "markdown_stream"):
            md += 1
            if rnd:
                rounds_with_md.add(int(rnd))
min_tools = expected_rounds * tools_per_round
print(f"[smoke] mock audit: tool_events={tool} markdown_events={md} rounds_with_response={len(rounds_with_md)}")
if md < expected_rounds:
    raise SystemExit(f"ERROR: expected >= {expected_rounds} markdown phases, got {md}")
if tool < min_tools:
    raise SystemExit(f"ERROR: expected >= {min_tools} tool phases, got {tool}")
if len(rounds_with_md) < expected_rounds:
    raise SystemExit(f"ERROR: expected markdown for {expected_rounds} rounds, got {len(rounds_with_md)}")
print(f"[smoke] each of {expected_rounds} round(s) had tool_stream + markdown_stream")
PY

if [[ -f "$BENCHMARK_OUT_DIR/metrics.pid" ]]; then
  kill "$(cat "$BENCHMARK_OUT_DIR/metrics.pid")" 2>/dev/null || true
fi

tmux kill-session -t peri-benchmark 2>/dev/null || true

echo "[smoke] PASS — results in $BENCHMARK_OUT_DIR"
ls -la "$BENCHMARK_OUT_DIR"/*.json "$BENCHMARK_OUT_DIR"/*.csv 2>/dev/null || true
