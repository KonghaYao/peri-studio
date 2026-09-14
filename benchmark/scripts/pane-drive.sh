#!/usr/bin/env bash
set -euo pipefail
BENCHMARK_ROOT="${BENCHMARK_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
source "${BENCHMARK_OUT_DIR:?}/.env"
sleep 4
pgrep -f "$BENCHMARK_THREADS_DB" | head -1 > "$BENCHMARK_PID_FILE" || true
ROUNDS="${BENCHMARK_ROUNDS:-${BENCHMARK_TURNS:-${BENCHMARK_USER_PROMPTS:-3}}}"
bash "$BENCHMARK_ROOT/drive-tui/drive.sh" --rounds "$ROUNDS" || {
  echo "[drive] exited with error" >&2
}
echo "[drive] done — pane stays open for inspection"
sleep 3600
