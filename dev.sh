#!/bin/bash
# Peri Studio 开发启动：构建 Web，再运行唯一的本地模式二进制。
set -euo pipefail
cd "$(dirname "$0")"

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
LOG_DIR="$(pwd)/.tmp"
APP_LOG="${LOG_DIR}/peri-studio.${$}.log"

if lsof -nP -iTCP:"${LISTEN_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "!! TCP ${LISTEN_PORT} 已被占用；若 Peri Studio 已运行，请直接打开 http://${LISTEN_ADDR}:${LISTEN_PORT}/。" >&2
    exit 1
fi

echo "==> 构建 Web 前端"
(cd web && bun run build)

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

echo "==> 启动 peri-studio local（日志: ${APP_LOG}）"
cargo run -q -p peri-studio -- local \
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
echo
tail -f "${APP_LOG}" &
TAIL_PID=$!
wait "${TAIL_PID}"
