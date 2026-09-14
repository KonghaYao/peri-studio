#!/usr/bin/env bash
# 周期性采样 peri TUI 主进程 CPU 与 RSS，结束时输出峰值摘要（兼容 macOS bash 3.2）。
set -euo pipefail

INTERVAL="${BENCHMARK_METRICS_INTERVAL_SEC:-1}"
OUT_DIR="${BENCHMARK_OUT_DIR:-}"
DURATION_SEC="${BENCHMARK_METRICS_DURATION_SEC:-0}"
PID_FILE="${BENCHMARK_PID_FILE:-}"

usage() {
  echo "Usage: collect.sh --out-dir DIR [--interval SEC] [--duration SEC] [--pid-file FILE]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    --duration) DURATION_SEC="$2"; shift 2 ;;
    --pid-file) PID_FILE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$OUT_DIR" ]] || usage
mkdir -p "$OUT_DIR"

CSV="$OUT_DIR/metrics-timeseries.csv"
SUMMARY="$OUT_DIR/metrics-summary.json"
echo "timestamp_epoch,process,pid,cpu_pct,rss_kb" > "$CSV"

START=$(date +%s)

resolve_pids() {
  local pids=()
  if [[ -n "$PID_FILE" && -f "$PID_FILE" ]]; then
    while read -r line; do
      [[ -n "$line" ]] && pids+=("$line")
    done < "$PID_FILE"
  fi
  if [[ ${#pids[@]} -eq 0 && -n "${BENCHMARK_THREADS_DB:-}" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(pgrep -f "$BENCHMARK_THREADS_DB" 2>/dev/null || true)
  fi
  if [[ ${#pids[@]} -eq 0 ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(pgrep -x peri 2>/dev/null || true)
  fi
  printf '%s\n' "${pids[@]}"
}

sample_once() {
  local now
  now=$(date +%s)
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    if ! kill -0 "$pid" 2>/dev/null; then
      continue
    fi
    local line
    line=$(ps -p "$pid" -o ucomm= -o %cpu= -o rss= 2>/dev/null | head -1 || true)
    [[ -z "$line" ]] && continue
    local comm cpu rss
    comm=$(echo "$line" | awk '{print $1}')
    cpu=$(echo "$line" | awk '{print $2}')
    rss=$(echo "$line" | awk '{print $3}')
    echo "${now},${comm},${pid},${cpu},${rss}" >> "$CSV"
  done < <(resolve_pids)
}

write_summary() {
  python3 - "$SUMMARY" "$CSV" "$INTERVAL" <<'PY'
import csv, json, sys, time
summary_path, csv_path, interval = sys.argv[1], sys.argv[2], float(sys.argv[3])
peaks = {}
try:
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = f"{row['process']}:{row['pid']}"
            rss = int(float(row["rss_kb"]))
            peaks[key] = max(peaks.get(key, 0), rss)
except OSError:
    pass
processes = []
for key, rss_kb in sorted(peaks.items()):
    comm, pid = key.split(":", 1)
    processes.append({
        "process": comm,
        "pid": int(pid),
        "peakRssKb": rss_kb,
        "peakRssBytes": rss_kb * 1024,
    })
payload = {
    "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "intervalSec": interval,
    "processes": processes,
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
print(f"[metrics] summary written to {summary_path}")
PY
}

trap write_summary EXIT

echo "[metrics] sampling every ${INTERVAL}s → $CSV"

if [[ "$DURATION_SEC" -gt 0 ]]; then
  END=$((START + DURATION_SEC))
  while [[ $(date +%s) -lt $END ]]; do
    sample_once
    sleep "$INTERVAL"
  done
else
  trap 'exit 0' SIGTERM SIGINT
  while true; do
    sample_once
    sleep "$INTERVAL"
  done
fi
