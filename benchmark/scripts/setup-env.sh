#!/usr/bin/env bash
# 创建隔离 workspace（含 ./.peri/settings.json）/ threads DB / mock 端口。
# 不写入 ~/.peri 或 peri-studio 真实目录。
set -euo pipefail

source "$(dirname "$0")/lib.sh"

RUN_ID="${BENCHMARK_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
OUT_DIR="${BENCHMARK_OUT_DIR:-$BENCHMARK_ROOT/out/$RUN_ID}"
WORKSPACE="$OUT_DIR/workspace"
PERI_DIR="$WORKSPACE/.peri"
THREADS_DIR="$OUT_DIR/peri-threads"
LOGS_DIR="$OUT_DIR/logs"
MOCK_PORT="${BENCHMARK_MOCK_PORT:-$(pick_free_port)}"

MOCK_API_KEY="${BENCHMARK_MOCK_API_KEY:-benchmark-local-key}"
MOCK_MODEL="${BENCHMARK_MOCK_MODEL:-gpt-4o-benchmark}"
# peri 工作区 settings 需用标准 alias（如 haiku）+ provider id "benchmark" 才能可靠走 OpenAI HTTP
PERI_ALIAS="${BENCHMARK_PERI_ALIAS:-haiku}"
PROVIDER_ID="${BENCHMARK_PROVIDER_ID:-benchmark}"

ROUNDS="$(benchmark_rounds)"
TOOL_CALLS_PER_ROUND="$(benchmark_tool_calls_per_round)"
MARKDOWN_BYTES="${BENCHMARK_MARKDOWN_BYTES:-50000}"
CHUNK_BYTES="${BENCHMARK_CHUNK_BYTES:-512}"
DELAY_MS="${BENCHMARK_DELAY_MS:-0}"
MARKDOWN_EVERY_N_TOOLS="${BENCHMARK_MARKDOWN_EVERY_N_TOOLS:-0}"

mkdir -p "$PERI_DIR" "$WORKSPACE/data" "$THREADS_DIR" "$LOGS_DIR"

# 工作区预置无害小文件（供 Read 工具）
cat > "$WORKSPACE/notes.txt" <<'EOF'
Benchmark workspace notes.
Safe read target for peri Read tool.
EOF

cat > "$WORKSPACE/data/sample.md" <<'EOF'
# Sample

Small markdown file for benchmark Read tool.
EOF

cat > "$WORKSPACE/data/readme.txt" <<'EOF'
Benchmark readme — read-only fixture.
EOF

# peri 工作区配置：cwd/.peri/settings.json（OpenAI 协议 → mock）
cat > "$PERI_DIR/settings.json" <<EOF
{
  "config": {
    "active_alias": "$PERI_ALIAS",
    "providers": [
      {
        "id": "$PROVIDER_ID",
        "type": "openai",
        "apiKey": "$MOCK_API_KEY",
        "baseUrl": "http://127.0.0.1:${MOCK_PORT}/v1",
        "models": {
          "opus": "$MOCK_MODEL",
          "sonnet": "$MOCK_MODEL",
          "haiku": "$MOCK_MODEL",
          "fable": "$MOCK_MODEL"
        }
      }
    ],
    "profiles": {
      "haiku": {
        "provider": "$PROVIDER_ID",
        "model": "$MOCK_MODEL",
        "effort": "low"
      },
      "sonnet": {
        "provider": "$PROVIDER_ID",
        "model": "$MOCK_MODEL",
        "effort": "low"
      },
      "opus": {
        "provider": "$PROVIDER_ID",
        "model": "$MOCK_MODEL",
        "effort": "low"
      },
      "fable": {
        "provider": "$PROVIDER_ID",
        "model": "$MOCK_MODEL",
        "effort": "low"
      }
    },
    "language": "en"
  }
}
EOF

PERI_BIN_PATH="$(peri_bin)"
MOCK_PY="$(mock_llm_server)"
AUDIT_FILE="$OUT_DIR/mock-llm-audit.jsonl"

cat > "$OUT_DIR/.env" <<EOF
export BENCHMARK_OUT_DIR="$OUT_DIR"
export BENCHMARK_MOCK_PORT="$MOCK_PORT"
export BENCHMARK_WORKSPACE="$WORKSPACE"
export BENCHMARK_THREADS_DB="$THREADS_DIR/threads.db"
export BENCHMARK_PERI_BIN="$PERI_BIN_PATH"
export BENCHMARK_PERI_ALIAS="$PERI_ALIAS"
export BENCHMARK_PROVIDER_ID="$PROVIDER_ID"
export BENCHMARK_MOCK_MODEL="$MOCK_MODEL"
export BENCHMARK_TMUX_SESSION="peri-benchmark"
export BENCHMARK_TUI_PANE_TITLE="peri-tui"
export BENCHMARK_PID_FILE="$OUT_DIR/peri.pid"
export BENCHMARK_MOCK_AUDIT="$AUDIT_FILE"
export BENCHMARK_ROUNDS="$ROUNDS"
export BENCHMARK_TURNS="$ROUNDS"
export BENCHMARK_USER_PROMPTS="$ROUNDS"
export BENCHMARK_TOOL_CALLS_PER_ROUND="$TOOL_CALLS_PER_ROUND"
export BENCHMARK_TOOL_CALLS_PER_PROMPT="$TOOL_CALLS_PER_ROUND"
export BENCHMARK_MARKDOWN_BYTES="$MARKDOWN_BYTES"
export BENCHMARK_CHUNK_BYTES="$CHUNK_BYTES"
export BENCHMARK_DELAY_MS="$DELAY_MS"
export BENCHMARK_MARKDOWN_EVERY_N_TOOLS="$MARKDOWN_EVERY_N_TOOLS"
export BENCHMARK_PROMPT_TIMEOUT_SEC="${BENCHMARK_PROMPT_TIMEOUT_SEC:-3600}"
export BENCHMARK_BOOT_TIMEOUT_SEC="${BENCHMARK_BOOT_TIMEOUT_SEC:-120}"
EOF

export BENCHMARK_OUT_DIR="$OUT_DIR"
echo "[setup] out=$OUT_DIR mock_port=$MOCK_PORT peri=$PERI_BIN_PATH"
echo "[setup] rounds=$ROUNDS tools/round=$TOOL_CALLS_PER_ROUND markdown/round=${MARKDOWN_BYTES}B"
echo "[setup] workspace settings: $PERI_DIR/settings.json"
echo "[setup] env file: $OUT_DIR/.env"
echo "BENCHMARK_OUT_DIR=$OUT_DIR"
