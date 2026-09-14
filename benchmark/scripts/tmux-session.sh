#!/usr/bin/env bash
# tmux 编排：mock LLM | metrics | peri TUI | drive-tui（4 pane，tiled）
set -euo pipefail

source "$(dirname "$0")/lib.sh"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rounds) export BENCHMARK_ROUNDS="$2"; shift 2 ;;
    --prompts) export BENCHMARK_ROUNDS="$2"; shift 2 ;;
    --turns) export BENCHMARK_ROUNDS="$2"; shift 2 ;;
    *) echo "Unknown: $1" >&2; exit 1 ;;
  esac
done

require_cmd tmux
require_cmd python3

if [[ -z "${BENCHMARK_OUT_DIR:-}" ]]; then
  echo "ERROR: BENCHMARK_OUT_DIR not set — run setup-env.sh first" >&2
  exit 1
fi

SESSION="${BENCHMARK_TMUX_SESSION:-peri-benchmark}"
ROUNDS="$(benchmark_rounds)"

chmod +x "$BENCHMARK_ROOT/scripts"/pane-*.sh

tmux has-session -t "$SESSION" 2>/dev/null && tmux kill-session -t "$SESSION"

run_pane() {
  local script="$1"
  printf "BENCHMARK_OUT_DIR='%s' BENCHMARK_ROOT='%s' BENCHMARK_ROUNDS='%s' bash '%s'" \
    "$BENCHMARK_OUT_DIR" "$BENCHMARK_ROOT" "$ROUNDS" "$script"
}

tmux new-session -d -s "$SESSION" -n benchmark "$(run_pane "$BENCHMARK_ROOT/scripts/pane-mock-llm.sh")"
tmux select-pane -t "$SESSION:0.0" -T mock-llm

METRICS_IDX=$(tmux split-window -h -t "$SESSION:0.0" -P -F '#{pane_index}' "$(run_pane "$BENCHMARK_ROOT/scripts/pane-metrics.sh")")
tmux select-pane -t "$SESSION:0.$METRICS_IDX" -T metrics

PERI_IDX=$(tmux split-window -v -t "$SESSION:0.0" -P -F '#{pane_index}' "$(run_pane "$BENCHMARK_ROOT/scripts/pane-peri-tui.sh")")
tmux select-pane -t "$SESSION:0.$PERI_IDX" -T peri-tui

DRIVE_IDX=$(tmux split-window -v -t "$SESSION:0.$METRICS_IDX" -P -F '#{pane_index}' "$(run_pane "$BENCHMARK_ROOT/scripts/pane-drive.sh")")
tmux select-pane -t "$SESSION:0.$DRIVE_IDX" -T drive

{
  echo "export BENCHMARK_TUI_PANE_TARGET='$SESSION:0.$PERI_IDX'"
  echo "export BENCHMARK_TUI_PANE_TITLE='peri-tui'"
} >> "$BENCHMARK_OUT_DIR/.env"

tmux select-layout -t "$SESSION:0" tiled 2>/dev/null || true
tmux select-pane -t "$SESSION:0.$PERI_IDX" 2>/dev/null || true

echo "[tmux] session '$SESSION' created (peri pane=$SESSION:0.$PERI_IDX, rounds=$ROUNDS)"
echo "[tmux] attach: tmux attach -t $SESSION"
