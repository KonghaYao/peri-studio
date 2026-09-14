#!/usr/bin/env bash
set -euo pipefail
source "${BENCHMARK_OUT_DIR:?}/.env"

for _ in $(seq 1 30); do
  (echo >/dev/tcp/127.0.0.1/"$BENCHMARK_MOCK_PORT") >/dev/null 2>&1 && break
  sleep 1
done

# peri cwd 必须是隔离 workspace，才能读取 ./.peri/settings.json
cd "$BENCHMARK_WORKSPACE"
exec "$BENCHMARK_PERI_BIN" \
  --permission-mode bypass \
  --dangerously-skip-permissions \
  --db-path "$BENCHMARK_THREADS_DB" \
  --model "${BENCHMARK_PERI_ALIAS:-haiku}" \
  --no-session-persistence \
  2>>"$BENCHMARK_OUT_DIR/logs/peri-tui.log"
