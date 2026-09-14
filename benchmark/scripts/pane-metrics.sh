#!/usr/bin/env bash
set -euo pipefail
BENCHMARK_ROOT="${BENCHMARK_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
source "${BENCHMARK_OUT_DIR:?}/.env"
COLLECT="${BENCHMARK_ROOT}/metrics/collect.sh"
echo $$ > "${BENCHMARK_OUT_DIR}/metrics.pid"
bash "$COLLECT" --out-dir "$BENCHMARK_OUT_DIR" \
  --interval "${BENCHMARK_METRICS_INTERVAL_SEC:-1}" \
  --pid-file "$BENCHMARK_PID_FILE" || {
  echo "[metrics] collector exited" >&2
}
sleep 3600
