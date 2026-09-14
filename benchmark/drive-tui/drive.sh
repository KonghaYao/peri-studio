#!/usr/bin/env bash
# 每轮 send-keys 一条 user prompt；等上一轮 tool+response 全部结束、TUI idle 后再发下一轮。
set -euo pipefail

BENCHMARK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1090
[[ -f "${BENCHMARK_OUT_DIR:-}/.env" ]] && source "${BENCHMARK_OUT_DIR}/.env"

ROUNDS="${BENCHMARK_ROUNDS:-${BENCHMARK_TURNS:-${BENCHMARK_USER_PROMPTS:-3}}}"
PROMPT_TIMEOUT_SEC="${BENCHMARK_PROMPT_TIMEOUT_SEC:-3600}"
BOOT_TIMEOUT_SEC="${BENCHMARK_BOOT_TIMEOUT_SEC:-120}"
PROMPT_STABLE_POLLS="${BENCHMARK_PROMPT_STABLE_POLLS:-3}"
POLL_INTERVAL_SEC="${BENCHMARK_POLL_INTERVAL_SEC:-1}"
SESSION="${BENCHMARK_TMUX_SESSION:-peri-benchmark}"
PANE_TITLE="${BENCHMARK_TUI_PANE_TITLE:-peri-tui}"
PROMPTS_FILE="${BENCHMARK_USER_PROMPTS_FILE:-$BENCHMARK_ROOT/fixtures/user-prompts.json}"
SUMMARY="${BENCHMARK_OUT_DIR}/drive-summary.json"
AUDIT="${BENCHMARK_MOCK_AUDIT:-$BENCHMARK_OUT_DIR/mock-llm-audit.jsonl}"
TOOL_CALLS_PER_ROUND="${BENCHMARK_TOOL_CALLS_PER_ROUND:-${BENCHMARK_TOOL_CALLS_PER_PROMPT:-15}}"

usage() {
  echo "Usage: drive.sh [--rounds N] [--prompts N]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rounds) ROUNDS="$2"; shift 2 ;;
    --prompts) ROUNDS="$2"; shift 2 ;;
    --turns) ROUNDS="$2"; shift 2 ;;
    --pane) PANE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux is required but not installed" >&2
  exit 1
fi

if [[ -z "${BENCHMARK_OUT_DIR:-}" ]]; then
  echo "ERROR: BENCHMARK_OUT_DIR not set — run setup-env.sh first" >&2
  exit 1
fi

if ! tmux has-session -t "${SESSION%%:*}" 2>/dev/null; then
  echo "ERROR: tmux session not found: $SESSION" >&2
  exit 1
fi

resolve_tui_pane() {
  # tiled layout 会重排 pane index；始终以 title 为准，避免使用过期的 BENCHMARK_TUI_PANE_TARGET
  local idx
  idx=$(tmux list-panes -t "$SESSION" -F '#{pane_index} #{pane_title}' 2>/dev/null \
    | awk -v t="$PANE_TITLE" '$2 == t { print $1; exit }')
  if [[ -n "$idx" ]]; then
    echo "$SESSION:0.$idx"
    return 0
  fi
  if [[ -n "${BENCHMARK_TUI_PANE_TARGET:-}" ]]; then
    echo "$BENCHMARK_TUI_PANE_TARGET"
    return 0
  fi
  echo "ERROR: peri TUI pane not found (title=$PANE_TITLE)" >&2
  return 1
}

PANE="$(resolve_tui_pane)"

load_prompt() {
  local index="$1"
  python3 - "$index" "$PROMPTS_FILE" <<'PY'
import json, sys
idx = int(sys.argv[1]) - 1
path = sys.argv[2]
with open(path, encoding="utf-8") as fh:
    prompts = json.load(fh)
if idx < len(prompts):
    print(prompts[idx], end="")
else:
    print(f"Benchmark round {idx + 1}: run safe Bash/Read tools then stream a rich markdown summary.", end="")
PY
}

capture_tail() {
  tmux capture-pane -t "$PANE" -p -S -60 2>/dev/null || true
}

tui_is_idle() {
  local text="$1"
  grep -q '❯' <<<"$text" || return 1
  if grep -qE '待发送[[:space:]]*[1-9]' <<<"$text"; then
    return 1
  fi
  if grep -qE '(Running|Executing|Thinking|生成中)' <<<"$text"; then
    return 1
  fi
  return 0
}

wait_for_idle() {
  local label="$1"
  local deadline=$(( $(date +%s) + $2 ))
  local stable=0
  while (( $(date +%s) < deadline )); do
    local pane
    pane=$(capture_tail)
    if tui_is_idle "$pane"; then
      stable=$((stable + 1))
      if (( stable >= PROMPT_STABLE_POLLS )); then
        return 0
      fi
    else
      stable=0
    fi
    sleep "$POLL_INTERVAL_SEC"
  done
  echo "ERROR: timeout waiting for TUI idle ($label)" >&2
  tmux capture-pane -t "$PANE" -p -S -25 >&2 || true
  return 1
}

send_prompt() {
  local message="$1"
  tmux send-keys -t "$PANE" -l "$message"
  tmux send-keys -t "$PANE" Enter
}

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

mock_audit_counts() {
  [[ -f "$AUDIT" ]] || { echo "0 0"; return; }
  python3 - "$AUDIT" <<'PY'
import json, sys
path = sys.argv[1]
tools = markdown = 0
try:
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if row.get("event") != "completion":
                continue
            kind = row.get("kind")
            if kind in ("tool_json", "tool_stream"):
                tools += 1
            elif kind in ("markdown_json", "markdown_stream"):
                markdown += 1
except OSError:
    pass
print(tools, markdown)
PY
}

latencies=()
errors=()
started_at=$(date +%s)

echo "[drive] waiting for peri TUI boot (pane=$PANE)"
wait_for_idle "boot" "$BOOT_TIMEOUT_SEC"

echo "[drive] sending $ROUNDS full round(s): user → ${TOOL_CALLS_PER_ROUND} tools → markdown response"
for round in $(seq 1 "$ROUNDS"); do
  wait_for_idle "pre-round-$round" "$PROMPT_TIMEOUT_SEC"
  msg=$(load_prompt "$round")
  t0=$(now_ms)
  send_prompt "$msg"
  if wait_for_idle "post-round-$round" "$PROMPT_TIMEOUT_SEC"; then
    t1=$(now_ms)
    lat=$((t1 - t0))
    latencies+=("$lat")
    echo "[drive] round $round/$ROUNDS ok (${lat}ms, user+tools+response)"
  else
    errors+=("$round")
    echo "[drive] round $round/$ROUNDS FAILED" >&2
    break
  fi
done

ended_at=$(date +%s)
total=$((ended_at - started_at))
read -r mock_tools mock_markdown <<<"$(mock_audit_counts)"

python3 - "$SUMMARY" <<PY
import json
path = "$SUMMARY"
lat = [int(x) for x in """${latencies[*]-}""".split() if x]
errors = [int(x) for x in """${errors[*]-}""".split() if x]
completed = len(lat)
summary = {
    "roundsPlanned": $ROUNDS,
    "roundsCompleted": completed,
    "userPromptsPlanned": $ROUNDS,
    "userPromptsCompleted": completed,
    "toolCallsPerRound": $TOOL_CALLS_PER_ROUND,
    "failedRounds": errors,
    "totalDurationSec": $total,
    "avgRoundLatencyMs": (sum(lat) / completed) if completed else 0,
    "p95RoundLatencyMs": sorted(lat)[max(0, int(0.95 * (completed - 1)))] if completed else 0,
    "roundLatenciesMs": lat,
    "mockToolCompletionEvents": int("$mock_tools"),
    "mockMarkdownCompletionEvents": int("$mock_markdown"),
    "note": "Each round = one user prompt, then mock tool loop, then streaming markdown response",
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)
print(f"[drive] summary written to {path}")
PY

if ((${#errors[@]} > 0)); then
  exit 1
fi
