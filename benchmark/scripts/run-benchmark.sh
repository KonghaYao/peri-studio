#!/usr/bin/env bash
# 长跑：n 轮完整 user → tools → response；加大 BENCHMARK_ROUNDS 可拉超长 session。
set -euo pipefail

source "$(dirname "$0")/lib.sh"

require_cmd tmux
require_cmd python3

export BENCHMARK_ROUNDS="${BENCHMARK_ROUNDS:-${BENCHMARK_TURNS:-50}}"
export BENCHMARK_TOOL_CALLS_PER_ROUND="${BENCHMARK_TOOL_CALLS_PER_ROUND:-15}"
export BENCHMARK_MARKDOWN_BYTES="${BENCHMARK_MARKDOWN_BYTES:-50000}"
export BENCHMARK_CHUNK_BYTES="${BENCHMARK_CHUNK_BYTES:-512}"
export BENCHMARK_PROMPT_TIMEOUT_SEC="${BENCHMARK_PROMPT_TIMEOUT_SEC:-7200}"
export BENCHMARK_METRICS_INTERVAL_SEC="${BENCHMARK_METRICS_INTERVAL_SEC:-2}"

echo "[benchmark] rounds=$BENCHMARK_ROUNDS tools/round=$BENCHMARK_TOOL_CALLS_PER_ROUND markdown/round=$BENCHMARK_MARKDOWN_BYTES"

eval "$("$BENCHMARK_ROOT/scripts/setup-env.sh" | grep '^BENCHMARK_OUT_DIR=')"
# shellcheck disable=SC1090
source "$BENCHMARK_OUT_DIR/.env"

"$BENCHMARK_ROOT/scripts/tmux-session.sh"

echo "[benchmark] running — attach with: tmux attach -t peri-benchmark"
echo "[benchmark] output dir: $BENCHMARK_OUT_DIR"
echo "[benchmark] when drive finishes, check:"
echo "  - $BENCHMARK_OUT_DIR/drive-summary.json"
echo "  - $BENCHMARK_OUT_DIR/metrics-timeseries.csv"
echo "  - $BENCHMARK_OUT_DIR/mock-llm-audit.jsonl"
