#!/bin/bash
# UI Sandbox 开发启动：独立 Vite 设计稿沙箱（不启动 server / instance）。
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

for REQUIRED_COMMAND in bun lsof; do
    if ! command -v "${REQUIRED_COMMAND}" >/dev/null 2>&1; then
        echo "!! 缺少必需命令: ${REQUIRED_COMMAND}" >&2
        exit 127
    fi
done

SANDBOX_DIR="${ROOT}/ui-sandbox"
HOST="${PERI_UI_SANDBOX_HOST:-127.0.0.1}"
PORT="${PERI_UI_SANDBOX_PORT:-5273}"

if [ ! -f "${SANDBOX_DIR}/package.json" ]; then
    echo "!! 未找到 ${SANDBOX_DIR}/package.json" >&2
    exit 1
fi

stale_sandbox_listener_pids() {
    local records
    records="$(lsof -F pc -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    printf '%s\n' "${records}" | awk '
        /^p/ {
            if (pid != "" && command ~ /^(node|bun)$/) print pid
            pid = substr($0, 2)
            command = ""
            next
        }
        /^c/ { command = substr($0, 2) }
        END {
            if (pid != "" && command ~ /^(node|bun)$/) print pid
        }
    '
}

sandbox_process_for_pid() {
    local pid="$1"
    ps -p "${pid}" -o command= 2>/dev/null || true
}

is_sandbox_dev_server() {
    local cmd="$1"
    [[ "${cmd}" == *ui-sandbox* && "${cmd}" == *vite* ]]
}

cleanup_stale_sandbox() {
    local pid cmd old_pids
    old_pids="$(stale_sandbox_listener_pids)"
    [ -z "${old_pids}" ] && return 0

    echo "==> 清理旧 ui-sandbox dev server ..."
    while IFS= read -r pid; do
        [ -z "${pid}" ] && continue
        cmd="$(sandbox_process_for_pid "${pid}")"
        if is_sandbox_dev_server "${cmd}"; then
            echo "    发送 SIGTERM 到 PID ${pid}"
            kill -TERM "${pid}" 2>/dev/null || true
        fi
    done <<< "${old_pids}"

    for _ in $(seq 1 50); do
        if [ -z "$(stale_sandbox_listener_pids)" ]; then
            return 0
        fi
        sleep 0.1
    done

    if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "!! TCP ${PORT} 仍被占用；仅自动清理 ui-sandbox vite 进程，请先释放该端口。" >&2
        return 1
    fi
}

cleanup_stale_sandbox

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "!! TCP ${PORT} 仍被其他进程占用。" >&2
    exit 1
fi

if [ ! -d "${ROOT}/node_modules" ] || [ ! -e "${SANDBOX_DIR}/node_modules/@peri/ui" ]; then
    echo "==> 从 workspace 根安装依赖"
    (cd "${ROOT}" && bun install --frozen-lockfile)
fi

DEV_PID=""
CLEANED_UP=0

cleanup() {
    [ "${CLEANED_UP}" -eq 1 ] && return
    CLEANED_UP=1
    echo
    echo "==> 停止 UI Sandbox ..."
    [ -n "${DEV_PID}" ] && kill -- -"${DEV_PID}" 2>/dev/null || true
    [ -n "${DEV_PID}" ] && wait "${DEV_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> 启动 ui-sandbox dev server"
echo "    地址: http://${HOST}:${PORT}/"
echo "    Ctrl+C 停止"
echo

set -m
(
    cd "${SANDBOX_DIR}"
    exec bun run dev -- --host "${HOST}" --port "${PORT}"
) &
DEV_PID=$!

wait "${DEV_PID}"
