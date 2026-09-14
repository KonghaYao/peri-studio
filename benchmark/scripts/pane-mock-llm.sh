#!/usr/bin/env bash
set -euo pipefail
BENCHMARK_ROOT="${BENCHMARK_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
source "${BENCHMARK_OUT_DIR:?}/.env"
exec python3 "$BENCHMARK_ROOT/mock-llm/server.py" \
  --port "$BENCHMARK_MOCK_PORT" \
  --audit-file "$BENCHMARK_MOCK_AUDIT" \
  --tool-calls-per-round "${BENCHMARK_TOOL_CALLS_PER_ROUND:-15}" \
  --markdown-bytes "${BENCHMARK_MARKDOWN_BYTES:-50000}" \
  --chunk-bytes "${BENCHMARK_CHUNK_BYTES:-512}" \
  --delay-ms "${BENCHMARK_DELAY_MS:-0}" \
  --markdown-every-n-tools "${BENCHMARK_MARKDOWN_EVERY_N_TOOLS:-0}"
