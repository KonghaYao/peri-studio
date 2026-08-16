#!/bin/bash
# peri-studio 开发启动：同时拉起 peri-studio-server + peri-instance，Ctrl+C 一起退出。
#
# 流程：
#   0. 校验目标端口，然后重建前端产物（禁止旧 bundle 与新 server 混跑）
#   1. 用 cargo run 编译并启动 server（增量编译，日志 .tmp/server.<pid>.log）
#   2. 等待 server bootstrap 生成 instance token（~/.config/peri-studio/tokens.toml）
#   3. 提取 token → 写入 ~/.local/share/peri-studio/instance.token（0600）
#   4. 用 cargo run 启动 instance（日志 .tmp/instance.<pid>.log）并等待认证完成
#   5. 前台滚动两个日志；退出时清理两个 cargo 进程组（cargo + 实际二进制）
#
# 注意：所有变量引用一律用 ${VAR} 花括号 —— macOS 自带 bash 3.2 对
# `$VAR` 后紧跟全角字符（如 `）`）的解析有 bug，会吞掉变量名。
set -euo pipefail
cd "$(dirname "$0")"

for REQUIRED_COMMAND in bun cargo awk grep tail lsof; do
    if ! command -v "${REQUIRED_COMMAND}" >/dev/null 2>&1; then
        echo "!! 缺少必需命令: ${REQUIRED_COMMAND}" >&2
        exit 127
    fi
done

# ---- 路径（与 server 默认 XDG 语义一致，环境变量可覆盖） ----
CONFIG_DIR="${PERI_STUDIO_CONFIG_DIR:-$HOME/.config/peri-studio}"
DATA_DIR="${PERI_STUDIO_DATA_DIR:-$HOME/.local/share/peri-studio}"
LISTEN_ADDR="${PERI_STUDIO_LISTEN_ADDR:-127.0.0.1}"
LISTEN_PORT="${PERI_STUDIO_LISTEN_PORT:-8456}"
INSTANCE_SERVER_URL="${PERI_STUDIO_SERVER_URL:-ws://${LISTEN_ADDR}:${LISTEN_PORT}/instance}"
TOKENS_FILE="${CONFIG_DIR}/tokens.toml"
INSTANCE_TOKEN_FILE="${DATA_DIR}/instance.token"
INSTANCE_DATA_DIR="${PERI_STUDIO_INSTANCE_DATA_DIR:-${DATA_DIR}/instance}"
LOG_DIR="$(pwd)/.tmp"
# 每次启动使用独立日志文件。若已有 daemon 仍持有旧日志 fd，新一轮的
# readiness 判定也不会把旧进程输出误认为本轮成功。
SERVER_LOG="${LOG_DIR}/server.${$}.log"
INSTANCE_LOG="${LOG_DIR}/instance.${$}.log"

# ---- 0. 启动前诊断 + 前端确定性重建 ----
# 在耗时构建前报告最常见的重复启动错误。检查整个目标端口而非某个地址，
# 避免 0.0.0.0 / :: listener 与指定 loopback 地址之间的冲突漏报；真正 bind
# 仍由 server 作为最终原子门禁。
if lsof -nP -iTCP:"${LISTEN_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "!! 无法启动：TCP ${LISTEN_PORT} 已被占用。若 peri-studio 已在运行，请直接打开 http://${LISTEN_ADDR}:${LISTEN_PORT}/；否则先停止占用该端口的进程。" >&2
    exit 1
fi

WEB_DIST="$(pwd)/web/dist"
echo "==> 构建 Web 前端（产物: ${WEB_DIST}）"
(cd web && bun run build)

# 日志、instance token 与运行时目录均可能包含本机路径和内部标识；默认只允许
# 当前用户访问。Web dist 已在此之前构建，不受该 umask 影响。
umask 077
mkdir -p "${LOG_DIR}" "${DATA_DIR}" "${INSTANCE_DATA_DIR}"

# 后台 cargo run 各成独立进程组（cargo + 实际二进制同组），cleanup 按组 kill，
# 避免只杀 cargo 留下孤儿 server/instance。
set -m

SERVER_PID=""
INSTANCE_PID=""
TAIL_PID=""
CLEANED_UP=0

cleanup() {
    [ "${CLEANED_UP}" -eq 1 ] && return
    CLEANED_UP=1
    echo
    echo "==> 停止 instance / server ..."
    [ -n "${INSTANCE_PID}" ] && kill -- -"${INSTANCE_PID}" 2>/dev/null || true
    [ -n "${SERVER_PID}" ] && kill -- -"${SERVER_PID}" 2>/dev/null || true
    [ -n "${TAIL_PID}" ] && kill "${TAIL_PID}" 2>/dev/null || true
    [ -n "${INSTANCE_PID}" ] && wait "${INSTANCE_PID}" 2>/dev/null || true
    [ -n "${SERVER_PID}" ] && wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- 1. cargo run 编译并启动 server（增量编译；编译错误也落在 SERVER_LOG） ----
echo "==> 启动 peri-studio-server（cargo run，日志: ${SERVER_LOG}）"
cargo run -q -p peri-studio-server -- run \
    --listen "${LISTEN_ADDR}" \
    --listen-port "${LISTEN_PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

# ---- 2. 等待 instance token 就绪（bootstrap 首次启动生成，原子写） ----
# 首轮可能含 cargo 编译时间，上限放宽到 6 分钟；编译失败时 cargo 退出，
# kill -0 即触发诊断。
echo "==> 等待 server 初始化 instance token（含首次编译，可能较久）..."
for _ in $(seq 1 360); do
    if [ -f "${TOKENS_FILE}" ] && grep -q 'role = "instance"' "${TOKENS_FILE}" 2>/dev/null; then
        break
    fi
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
        echo "!! server（cargo run）启动失败，日志如下："
        tail -30 "${SERVER_LOG}"
        exit 1
    fi
    sleep 1
done

if ! [ -f "${TOKENS_FILE}" ] || ! grep -q 'role = "instance"' "${TOKENS_FILE}" 2>/dev/null; then
    echo "!! 等待超时：tokens.toml 中未出现 instance token（${TOKENS_FILE}）"
    tail -30 "${SERVER_LOG}"
    exit 1
fi

# token 在恢复完成前就可能生成；必须等到 listener 真正 ready 才启动 instance。
echo "==> 等待 server 监听就绪 ..."
# 冷启动含 SQLite 关联重建与 ACP 侧加载，数据量大时可达 30s+；超时放宽。
for _ in $(seq 1 240); do
    if grep -a -q 'peri-studio-server listening' "${SERVER_LOG}" 2>/dev/null; then
        break
    fi
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
        echo "!! server 在监听前退出，日志如下："
        tail -40 "${SERVER_LOG}"
        exit 1
    fi
    sleep 0.5
done
if ! grep -a -q 'peri-studio-server listening' "${SERVER_LOG}" 2>/dev/null; then
    echo "!! 等待 server 监听超时"
    tail -40 "${SERVER_LOG}"
    exit 1
fi

# ---- 3. 提取未吊销 instance token（BSD awk 兼容，按空行分段） ----
TOKEN="$(awk '
    BEGIN { RS = "" }
    /role = "instance"/ && !/revoked = true/ {
        line = $0
        sub(/^.*token = "/, "", line)
        sub(/".*$/, "", line)
        print line
        exit
    }
' "${TOKENS_FILE}")"
if [ -z "${TOKEN}" ]; then
    echo "!! 未找到未吊销的 instance token（${TOKENS_FILE}）"
    exit 1
fi

echo "${TOKEN}" > "${INSTANCE_TOKEN_FILE}"
echo "==> instance token 就绪: ${INSTANCE_TOKEN_FILE}"

# ---- 4. cargo run 启动 instance（依赖已由 server 侧编译，通常秒级） ----
echo "==> 启动 peri-instance（cargo run，日志: ${INSTANCE_LOG}）"
cargo run -q -p peri-instance --bin peri-instance -- \
    --server-url "${INSTANCE_SERVER_URL}" \
    --token-file "${INSTANCE_TOKEN_FILE}" \
    --data-dir "${INSTANCE_DATA_DIR}" >"${INSTANCE_LOG}" 2>&1 &
INSTANCE_PID=$!

# instance 进程存活不等于已连接；只有 server 观察到认证后的 hello 才算 ready。
echo "==> 等待 instance 认证并注册 ..."
for _ in $(seq 1 240); do
    # 匹配 instance 英文日志（后端日志英文化约定，fa8f61e 起不再有中文日志）。
    # resync complete 表示认证 + 补推协调均完成，是 instance 侧最强 ready 信号。
    if grep -a -q 'instance connected' "${SERVER_LOG}" 2>/dev/null && \
       grep -a -q 'resync complete, all sessions live' "${INSTANCE_LOG}" 2>/dev/null; then
        break
    fi
    if ! kill -0 "${INSTANCE_PID}" 2>/dev/null; then
        echo "!! instance 在认证前退出，日志如下："
        tail -40 "${INSTANCE_LOG}"
        exit 1
    fi
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
        echo "!! server 在等待 instance 时退出，日志如下："
        tail -40 "${SERVER_LOG}"
        exit 1
    fi
    sleep 0.5
done
if ! grep -a -q 'instance connected' "${SERVER_LOG}" 2>/dev/null || \
   ! grep -a -q 'resync complete, all sessions live' "${INSTANCE_LOG}" 2>/dev/null; then
    echo "!! 等待 instance 注册超时"
    tail -40 "${SERVER_LOG}"
    tail -40 "${INSTANCE_LOG}"
    exit 1
fi

# ---- 5. 前台滚动日志，Ctrl+C 退出 ----
echo
echo "==> 全部就绪。Web: http://${LISTEN_ADDR}:${LISTEN_PORT}/；instance 已认证并连接。Ctrl+C 停止。"
echo
# tail 放后台 + wait：信号先到 bash（执行 cleanup 并 kill tail），wait 随 tail 退出，
# 避免「kill dev.sh 但 tail 在前台阻塞、trap 不执行」的退出卡死
tail -f "${SERVER_LOG}" "${INSTANCE_LOG}" &
TAIL_PID=$!
wait "${TAIL_PID}"
