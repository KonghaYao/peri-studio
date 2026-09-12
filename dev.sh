#!/bin/bash
# Peri Studio 开发启动：一次性构建 Web 产物，再从磁盘提供（不内嵌、不 watch）。
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

for REQUIRED_COMMAND in bun cargo grep tail lsof; do
    if ! command -v "${REQUIRED_COMMAND}" >/dev/null 2>&1; then
        echo "!! 缺少必需命令: ${REQUIRED_COMMAND}" >&2
        exit 127
    fi
done

CONFIG_DIR="${PERI_STUDIO_CONFIG_DIR:-$HOME/.config/peri-studio}"
DATA_DIR="${PERI_STUDIO_DATA_DIR:-$HOME/.local/share/peri-studio}"
LISTEN_ADDR="${PERI_STUDIO_LISTEN_ADDR:-127.0.0.1}"
LISTEN_PORT="${PERI_STUDIO_LISTEN_PORT:-8456}"
LOG_DIR="${ROOT}/.tmp"
APP_LOG="${LOG_DIR}/peri-studio.${$}.log"
DEV_LOG_FILTER="${PERI_STUDIO_DEV_LOG:-info}"
WEB_DIST="${PERI_STUDIO_WEB_DIST:-${ROOT}/web/dist}"
# 开发态：静态资源从 web/dist 读取，二进制不内嵌前端（--no-default-features）。
export PERI_STUDIO_WEB_DIST="${WEB_DIST}"

stale_local_listener_pids() {
    local records
    records="$(lsof -F pc -nP -iTCP:"${LISTEN_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    printf '%s\n' "${records}" | awk '
        /^p/ {
            if (pid != "" && command == "peri-studio") print pid
            pid = substr($0, 2)
            command = ""
            next
        }
        /^c/ { command = substr($0, 2) }
        END {
            if (pid != "" && command == "peri-studio") print pid
        }
    '
}

cleanup_stale_local_instance() {
    local old_pids pid
    old_pids="$(stale_local_listener_pids)"
    [ -z "${old_pids}" ] && return 0

    echo "==> 清理旧 peri-studio 实例 ..."
    while IFS= read -r pid; do
        [ -z "${pid}" ] && continue
        echo "    发送 SIGTERM 到 PID ${pid}"
        kill -TERM "${pid}" 2>/dev/null || true
    done <<< "${old_pids}"

    for _ in $(seq 1 100); do
        if [ -z "$(stale_local_listener_pids)" ]; then
            return 0
        fi
        sleep 0.1
    done

    echo "!! 旧 peri-studio 实例未能在 10 秒内退出，拒绝启动" >&2
    return 1
}

cleanup_stale_local_instance

if lsof -nP -iTCP:"${LISTEN_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "!! TCP ${LISTEN_PORT} 仍被其他进程占用；仅自动清理 peri-studio 实例，请先释放该端口。" >&2
    exit 1
fi

echo "==> 构建 Web 前端（产物: ${WEB_DIST}）"
(cd "${ROOT}/web" && bun run build)

# Rust 二进制：不内嵌 web/dist；仅 Rust 源码变更时才需重编。
echo "==> 构建 peri-studio 二进制（dev：无 embed-static-web；有 Rust 改动时需增量编译）"
cargo build -q -p peri-studio --no-default-features

umask 077
mkdir -p "${LOG_DIR}" "${DATA_DIR}" "${CONFIG_DIR}"
set -m
APP_PID=""
TAIL_PID=""
CLEANED_UP=0

cleanup() {
    [ "${CLEANED_UP}" -eq 1 ] && return
    CLEANED_UP=1
    echo
    echo "==> 停止 Peri Studio ..."
    [ -n "${APP_PID}" ] && kill -- -"${APP_PID}" 2>/dev/null || true
    [ -n "${TAIL_PID}" ] && kill "${TAIL_PID}" 2>/dev/null || true
    [ -n "${APP_PID}" ] && wait "${APP_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> 启动 peri-studio local（静态: PERI_STUDIO_WEB_DIST；日志: ${APP_LOG}）"
RUST_LOG="${DEV_LOG_FILTER}" ./target/debug/peri-studio local \
    --listen "${LISTEN_ADDR}" \
    --listen-port "${LISTEN_PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" >"${APP_LOG}" 2>&1 &
APP_PID=$!

echo "==> 等待 server 与本地 instance 就绪 ..."
for _ in $(seq 1 480); do
    if grep -a -q 'instance connected' "${APP_LOG}" 2>/dev/null && \
       grep -a -q 'resync complete, all sessions live' "${APP_LOG}" 2>/dev/null; then
        break
    fi
    if ! kill -0 "${APP_PID}" 2>/dev/null; then
        echo "!! Peri Studio 启动失败，日志如下：" >&2
        tail -60 "${APP_LOG}" >&2
        exit 1
    fi
    sleep 0.5
done
if ! grep -a -q 'instance connected' "${APP_LOG}" 2>/dev/null || \
   ! grep -a -q 'resync complete, all sessions live' "${APP_LOG}" 2>/dev/null; then
    echo "!! 等待本地 instance 注册超时" >&2
    tail -60 "${APP_LOG}" >&2
    exit 1
fi

echo
echo "==> 已就绪：http://${LISTEN_ADDR}:${LISTEN_PORT}/（Ctrl+C 停止）"
echo "    改前端后重新执行 ./dev.sh，或 cd web && bun run build 后刷新浏览器"
echo
tail -f "${APP_LOG}" &
TAIL_PID=$!
wait "${TAIL_PID}"
