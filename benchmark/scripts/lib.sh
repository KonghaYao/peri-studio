#!/usr/bin/env bash
# benchmark 脚本共享库
set -euo pipefail

BENCHMARK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$BENCHMARK_ROOT/.." && pwd)"

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $name" >&2
    exit 1
  fi
}

pick_free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

peri_bin() {
  if [[ -n "${PERI_BIN:-}" && -x "$PERI_BIN" ]]; then
    echo "$PERI_BIN"
    return
  fi
  if command -v peri >/dev/null 2>&1; then
    command -v peri
    return
  fi
  if [[ -x "$HOME/.peri/peri" ]]; then
    echo "$HOME/.peri/peri"
    return
  fi
  echo "ERROR: peri binary not found. Install peri or set PERI_BIN=/path/to/peri" >&2
  exit 1
}

mock_llm_server() {
  local py="$BENCHMARK_ROOT/mock-llm/server.py"
  if [[ ! -f "$py" ]]; then
    echo "ERROR: mock LLM server not found at $py" >&2
    exit 1
  fi
  chmod +x "$py" 2>/dev/null || true
  echo "$py"
}

wait_tcp() {
  local port="$1"
  local timeout="${2:-30}"
  local i=0
  while (( i < timeout )); do
    if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "ERROR: port $port not ready after ${timeout}s" >&2
  return 1
}

# 完整轮次数：user → tools → response；兼容旧 env 名
benchmark_rounds() {
  echo "${BENCHMARK_ROUNDS:-${BENCHMARK_TURNS:-${BENCHMARK_USER_PROMPTS:-3}}}"
}

benchmark_tool_calls_per_round() {
  echo "${BENCHMARK_TOOL_CALLS_PER_ROUND:-${BENCHMARK_TOOL_CALLS_PER_PROMPT:-15}}"
}
