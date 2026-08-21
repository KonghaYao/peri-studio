#!/bin/bash
# 验证唯一二进制的 local/serve/connect 角色与 server 崩溃恢复语义。
set -euo pipefail
cd "$(dirname "$0")/.."

APP_BIN="${PERI_STUDIO_BIN:-$(pwd)/target/debug/peri-studio}"
if ! [ -x "${APP_BIN}" ]; then
    echo "missing ${APP_BIN}; run cargo build -p peri-studio" >&2
    exit 2
fi

ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/peri-studio-unified.XXXXXX")"
CONFIG_DIR="${ROOT_TMP}/config"
DATA_DIR="${ROOT_TMP}/data"
PORT="$((22000 + RANDOM % 12000))"
LOG="${ROOT_TMP}/local.log"
RECOVERY_LOG="${ROOT_TMP}/recovery.log"
CONFLICT_LOG="${ROOT_TMP}/conflict.log"
LOCAL_PID=""
INSTANCE_PID=""
RECOVERY_PID=""
CONFLICT_PID=""

cleanup() {
    [ -n "${RECOVERY_PID}" ] && kill -TERM "${RECOVERY_PID}" 2>/dev/null || true
    [ -n "${CONFLICT_PID}" ] && kill -TERM "${CONFLICT_PID}" 2>/dev/null || true
    [ -n "${LOCAL_PID}" ] && kill -TERM "${LOCAL_PID}" 2>/dev/null || true
    [ -n "${INSTANCE_PID}" ] && kill -TERM "${INSTANCE_PID}" 2>/dev/null || true
    sleep 1
    [ -n "${RECOVERY_PID}" ] && kill -KILL "${RECOVERY_PID}" 2>/dev/null || true
    [ -n "${CONFLICT_PID}" ] && kill -KILL "${CONFLICT_PID}" 2>/dev/null || true
    [ -n "${LOCAL_PID}" ] && kill -KILL "${LOCAL_PID}" 2>/dev/null || true
    [ -n "${INSTANCE_PID}" ] && kill -KILL "${INSTANCE_PID}" 2>/dev/null || true
    rm -rf "${ROOT_TMP}"
}
trap cleanup EXIT

wait_log() {
    local file="$1"
    local pattern="$2"
    local owner_pid="$3"
    for _ in $(seq 1 200); do
        grep -a -q "${pattern}" "${file}" 2>/dev/null && return 0
        kill -0 "${owner_pid}" 2>/dev/null || {
            tail -80 "${file}" >&2 || true
            return 1
        }
        sleep 0.1
    done
    tail -80 "${file}" >&2 || true
    return 1
}

wait_log_count() {
    local file="$1"
    local pattern="$2"
    local expected="$3"
    local owner_pid="$4"
    for _ in $(seq 1 200); do
        [ "$(grep -a -c "${pattern}" "${file}" 2>/dev/null || true)" -ge "${expected}" ] && return 0
        kill -0 "${owner_pid}" 2>/dev/null || return 1
        sleep 0.1
    done
    tail -80 "${file}" >&2 || true
    return 1
}

start_local() {
    RUST_LOG=info "${APP_BIN}" local \
        --listen-port "${PORT}" \
        --config-dir "${CONFIG_DIR}" \
        --data-dir "${DATA_DIR}" >"${LOG}" 2>&1 &
    LOCAL_PID=$!
    wait_log "${LOG}" "instance connected" "${LOCAL_PID}"
    INSTANCE_PID="$(pgrep -P "${LOCAL_PID}" -f 'peri-studio connect' | head -1)"
    [ -n "${INSTANCE_PID}" ] || {
        echo "managed local instance child was not found" >&2
        exit 1
    }
}

# 正常本地模式：同一文件派生 server 与 connect，健康检查通过。
start_local
"${APP_BIN}" status \
    --listen-port "${PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" \
    --ready >/dev/null

# 优雅退出必须同时清理受监督的本地 instance。
kill -TERM "${LOCAL_PID}"
wait "${LOCAL_PID}"
LOCAL_PID=""
for _ in $(seq 1 60); do
    kill -0 "${INSTANCE_PID}" 2>/dev/null || break
    sleep 0.1
done
if kill -0 "${INSTANCE_PID}" 2>/dev/null; then
    echo "managed local instance survived graceful shutdown" >&2
    exit 1
fi
INSTANCE_PID=""

# server 进程被强杀时，connect/ACP 故障域必须继续存活并回连新 server。
start_local
kill -KILL "${LOCAL_PID}"
wait "${LOCAL_PID}" 2>/dev/null || true
LOCAL_PID=""
kill -0 "${INSTANCE_PID}"

RUST_LOG=info "${APP_BIN}" local \
    --listen-port "${PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" >"${RECOVERY_LOG}" 2>&1 &
RECOVERY_PID=$!
wait_log "${RECOVERY_LOG}" "adopted existing local instance" "${RECOVERY_PID}"
wait_log "${RECOVERY_LOG}" "instance connected" "${RECOVERY_PID}"

# 被接管的 owner 随后退出时，local 必须恢复 spawn/backoff 并拉起新子进程。
kill -TERM "${INSTANCE_PID}"
for _ in $(seq 1 100); do
    kill -0 "${INSTANCE_PID}" 2>/dev/null || break
    sleep 0.1
done
kill -0 "${INSTANCE_PID}" 2>/dev/null && {
    echo "adopted instance ignored TERM during owner-loss test" >&2
    exit 1
}
INSTANCE_PID=""
wait_log "${RECOVERY_LOG}" "adopted local instance exited; restarting" "${RECOVERY_PID}"
for _ in $(seq 1 200); do
    INSTANCE_PID="$(pgrep -P "${RECOVERY_PID}" -f 'peri-studio connect' | head -1 || true)"
    [ -n "${INSTANCE_PID}" ] && break
    sleep 0.1
done
[ -n "${INSTANCE_PID}" ] || {
    echo "local did not restart an exited adopted instance" >&2
    exit 1
}
wait_log_count "${RECOVERY_LOG}" "instance connected" 2 "${RECOVERY_PID}"

# 恢复后的 local 负责接管/重拉 instance；优雅退出时必须一并停止它。
kill -TERM "${RECOVERY_PID}"
wait "${RECOVERY_PID}"
RECOVERY_PID=""
for _ in $(seq 1 60); do
    kill -0 "${INSTANCE_PID}" 2>/dev/null || break
    sleep 0.1
done
if kill -0 "${INSTANCE_PID}" 2>/dev/null; then
    echo "adopted local instance survived graceful shutdown" >&2
    exit 1
fi
INSTANCE_PID=""

# 同一目录被普通 remote connect 占用时，即使 endpoint/token 相同也不能冒充
# managed-local owner；local 必须拒绝接管，更不能在退出时杀掉它。
RUST_LOG=info "${APP_BIN}" serve \
    --listen-port "${PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" >"${RECOVERY_LOG}" 2>&1 &
RECOVERY_PID=$!
wait_log "${RECOVERY_LOG}" "server role listening" "${RECOVERY_PID}"
RUST_LOG=info "${APP_BIN}" connect "ws://127.0.0.1:${PORT}/instance" \
    --token-file "${DATA_DIR}/instance.token" \
    --data-dir "${DATA_DIR}/instances/local" >"${CONFLICT_LOG}" 2>&1 &
INSTANCE_PID=$!
wait_log "${RECOVERY_LOG}" "instance connected" "${RECOVERY_PID}"
kill -KILL "${RECOVERY_PID}"
wait "${RECOVERY_PID}" 2>/dev/null || true
RECOVERY_PID=""

RUST_LOG=info "${APP_BIN}" local \
    --listen-port "${PORT}" \
    --config-dir "${CONFIG_DIR}" \
    --data-dir "${DATA_DIR}" >>"${CONFLICT_LOG}" 2>&1 &
CONFLICT_PID=$!
for _ in $(seq 1 60); do
    kill -0 "${CONFLICT_PID}" 2>/dev/null || break
    sleep 0.1
done
if kill -0 "${CONFLICT_PID}" 2>/dev/null; then
    echo "local did not reject incompatible instance owner" >&2
    exit 1
fi
wait "${CONFLICT_PID}" 2>/dev/null && {
    echo "local unexpectedly accepted incompatible instance owner" >&2
    exit 1
}
CONFLICT_PID=""
grep -a -q "incompatible process" "${CONFLICT_LOG}"
kill -0 "${INSTANCE_PID}"
kill -TERM "${INSTANCE_PID}"
wait "${INSTANCE_PID}"
INSTANCE_PID=""

echo "unified runtime verified: local self-connect, graceful stop, crash recovery"
